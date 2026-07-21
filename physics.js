// ============================================================================
// physics.js
//
// Server-authoritative simulation of a Haxball-style match. This is the ONLY
// place ball/player positions are ever computed. Clients never simulate
// physics themselves - they send input, they receive state, that's it.
//
// The numbers below follow Haxball's actual model (reverse-engineered from
// its public Stadium Editor format and community documentation):
//   - player invMass 0.5 (mass 2), ball invMass 1 (mass 1) -> the ball is
//     always lighter than a player, so contact always favors the player
//     pushing the ball around, never the reverse.
//   - player damping 0.96, ball damping 0.99 per tick -> the ball keeps
//     rolling noticeably longer than a player coasts, because it has less
//     "friction" against the pitch.
//   - kicking is a continuous force applied every tick the kick button is
//     held AND the ball is touching the player - not a single impulse on
//     press. Short taps give a light touch, holding through contact gives
//     a full-blooded strike.
//   - fixed 60Hz tick, fully decoupled from render/broadcast rate.
// ============================================================================

const TICK_HZ = 60;
const TICK_MS = 1000 / TICK_HZ;

const PLAYER_RADIUS = 15;
const BALL_RADIUS = 10;

const PLAYER_INV_MASS = 0.5;      // mass 2
const BALL_INV_MASS = 1;          // mass 1 - always lighter than a player

const PLAYER_DAMPING = 0.96;
const KICKING_DAMPING = 0.96;
const BALL_DAMPING = 0.99;

const PLAYER_ACCEL = 0.11;        // speed gained per tick while a direction is held
const KICKING_ACCEL = 0.078;      // slightly less stable footing while actively kicking
const PLAYER_MAX_SPEED = 4.2;

const KICK_STRENGTH = 0.42;       // continuous force added to the ball, per tick, while
                                   // the kick button is held AND the ball is in contact
const BALL_MAX_SPEED = 13;

const WALL_B_COEF = 0.5;          // restitution against the pitch walls
const PLAYER_B_COEF = 0.5;

const KICKOFF_FREEZE_MS = 3000;
const GOAL_PAUSE_MS = 2600;

// Classic-proportioned stadium, scaled to comfortable canvas pixels.
function stadiumFor(teamSize) {
  const scale = 1 + (teamSize - 1) * 0.18;
  return {
    width: Math.round(760 * scale),
    height: Math.round(400 * Math.sqrt(scale)),
    goalWidth: 100,       // the opening in the end wall
    goalDepth: 26,
    wallCornerRadius: 18,
    kickOffRadius: 90
  };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function len(x, y) { return Math.sqrt(x * x + y * y); }

class Ball {
  constructor(stadium) {
    this.radius = BALL_RADIUS;
    this.invMass = BALL_INV_MASS;
    this.reset(stadium);
  }
  reset(stadium) {
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
  }
}

class PlayerBody {
  constructor(id, team) {
    this.id = id;
    this.team = team;        // 'red' | 'blue'
    this.radius = PLAYER_RADIUS;
    this.invMass = PLAYER_INV_MASS;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.input = { up: false, down: false, left: false, right: false, kick: false };
    this.disconnected = false;
  }
}

class Match {
  constructor(roomId, teamSize, onGoal, onEnd) {
    this.roomId = roomId;
    this.teamSize = teamSize;
    this.stadium = stadiumFor(teamSize);
    this.ball = new Ball(this.stadium);
    this.players = new Map();      // id -> PlayerBody
    this.score = { red: 0, blue: 0 };
    this.running = false;
    this.simTimeMs = 0;
    this.paused = false;
    this.pauseUntil = 0;
    this.kickoffTeam = Math.random() < 0.5 ? 'red' : 'blue';
    this.kickoffFreezeUntil = 0;
    this.onGoal = onGoal || (() => {});
    this.onEnd = onEnd || (() => {});
    this.timeLeftMs = 5 * 60 * 1000;
    this.lastTouch = null;
  }

  addPlayer(id, team) {
    const p = new PlayerBody(id, team);
    this.players.set(id, p);
    this.resetFormation();
    return p;
  }
  removePlayer(id) {
    this.players.delete(id);
  }

  setInput(id, input) {
    const p = this.players.get(id);
    if (!p) return;
    // never trust the client further than "which keys are down" - booleans only,
    // no positions, no velocities, nothing that could be used to teleport/cheat
    p.input.up = !!input.up;
    p.input.down = !!input.down;
    p.input.left = !!input.left;
    p.input.right = !!input.right;
    p.input.kick = !!input.kick;
  }

  resetFormation() {
    const byTeam = { red: [], blue: [] };
    this.players.forEach(p => byTeam[p.team].push(p));
    const w = this.stadium.width, h = this.stadium.height;
    ['red', 'blue'].forEach(team => {
      const arr = byTeam[team];
      const side = team === 'red' ? -1 : 1;
      arr.forEach((p, i) => {
        const rows = arr.length;
        const spacing = h / (rows + 1);
        p.x = side * w * 0.28;
        p.y = -h / 2 + spacing * (i + 1);
        p.vx = 0; p.vy = 0;
      });
    });
    this.ball.x = 0; this.ball.y = 0; this.ball.vx = 0; this.ball.vy = 0;
    this.lastTouch = null;
  }

  start() {
    this.running = true;
    this.simTimeMs = 0;
    this.kickoffFreezeUntil = this.simTimeMs + KICKOFF_FREEZE_MS;
  }
  stop() { this.running = false; }

  scoreGoal(concedingTeam) {
    const scoringTeam = concedingTeam === 'red' ? 'blue' : 'red';
    this.score[scoringTeam]++;
    this.onGoal({ scoringTeam, score: { ...this.score }, scorerId: this.lastTouch });
    this.paused = true;
    this.pauseUntil = this.simTimeMs + GOAL_PAUSE_MS;
    this.kickoffTeam = concedingTeam;
  }

  // one fixed 60Hz simulation step
  tick(dtMs) {
    if (!this.running) return;
    this.simTimeMs += dtMs;

    if (this.paused) {
      if (this.simTimeMs >= this.pauseUntil) {
        this.paused = false;
        this.resetFormation();
        this.kickoffFreezeUntil = this.simTimeMs + KICKOFF_FREEZE_MS;
      } else {
        return; // frozen during the goal pause
      }
    }

    const frozen = this.simTimeMs < this.kickoffFreezeUntil;
    if (!frozen) this.timeLeftMs = Math.max(0, this.timeLeftMs - dtMs);
    if (this.timeLeftMs <= 0) { this.running = false; this.onEnd({ score: { ...this.score } }); return; }

    this.stepPlayers(frozen);
    this.stepPlayerCollisions();
    if (!frozen) this.stepBallContactAndKick();
    this.stepBallMotion(frozen);
  }

  stepPlayers(frozen) {
    this.players.forEach(p => {
      if (frozen) { p.vx = 0; p.vy = 0; return; }
      let ax = 0, ay = 0;
      if (p.input.up) ay -= 1;
      if (p.input.down) ay += 1;
      if (p.input.left) ax -= 1;
      if (p.input.right) ax += 1;
      const mag = len(ax, ay);
      const accel = p.input.kick ? KICKING_ACCEL : PLAYER_ACCEL;
      const damping = p.input.kick ? KICKING_DAMPING : PLAYER_DAMPING;
      if (mag > 0) {
        p.vx += (ax / mag) * accel;
        p.vy += (ay / mag) * accel;
      }
      // damping every tick, always - this is what "keeps 96% per tick" means
      p.vx *= damping; p.vy *= damping;
      const spd = len(p.vx, p.vy);
      if (spd > PLAYER_MAX_SPEED) { p.vx = p.vx / spd * PLAYER_MAX_SPEED; p.vy = p.vy / spd * PLAYER_MAX_SPEED; }
      p.x += p.vx; p.y += p.vy;

      const hw = this.stadium.width / 2, hh = this.stadium.height / 2;
      if (p.x < -hw + p.radius) { p.x = -hw + p.radius; p.vx *= -PLAYER_B_COEF; }
      if (p.x > hw - p.radius) { p.x = hw - p.radius; p.vx *= -PLAYER_B_COEF; }
      if (p.y < -hh + p.radius) { p.y = -hh + p.radius; p.vy *= -PLAYER_B_COEF; }
      if (p.y > hh - p.radius) { p.y = hh - p.radius; p.vy *= -PLAYER_B_COEF; }
    });
  }

  stepPlayerCollisions() {
    const arr = Array.from(this.players.values());
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy);
        const minD = a.radius + b.radius;
        if (d < minD && d > 0.0001) {
          const nx = dx / d, ny = dy / d, overlap = (minD - d) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          // equal-mass players exchange a little velocity along the contact normal
          const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          const rel = rvx * nx + rvy * ny;
          if (rel < 0) {
            const imp = -rel * PLAYER_B_COEF;
            a.vx -= nx * imp * 0.5; a.vy -= ny * imp * 0.5;
            b.vx += nx * imp * 0.5; b.vy += ny * imp * 0.5;
          }
        }
      }
    }
  }

  stepBallContactAndKick() {
    const ball = this.ball;
    this.players.forEach(p => {
      const dx = ball.x - p.x, dy = ball.y - p.y, d = len(dx, dy);
      const minD = p.radius + ball.radius;
      if (d < minD && d > 0.0001) {
        const nx = dx / d, ny = dy / d, overlap = minD - d;
        ball.x += nx * overlap; ball.y += ny * overlap;
        // mass-ratio impulse: player (invMass 0.5) barely slows, ball (invMass 1)
        // takes almost all of the relative closing speed - this is the fix for the
        // classic "ball feels heavy and shoves the player around" bug
        const closing = p.vx * nx + p.vy * ny;
        if (closing > 0) {
          const totalInv = PLAYER_INV_MASS + BALL_INV_MASS;
          const ballShare = BALL_INV_MASS / totalInv;
          ball.vx += nx * closing * ballShare * 1.9;
          ball.vy += ny * closing * ballShare * 1.9;
        }
        // continuous kick: only while the button is actually held AND still touching -
        // no cooldown, no single impulse. A tap gives a light touch, holding through
        // contact gives a full strike.
        if (p.input.kick) {
          ball.vx += nx * KICK_STRENGTH;
          ball.vy += ny * KICK_STRENGTH;
        }
        this.lastTouch = p.id;
      }
    });
  }

  stepBallMotion(frozen) {
    const ball = this.ball;
    if (frozen) { ball.vx = 0; ball.vy = 0; return; }

    ball.vx *= BALL_DAMPING; ball.vy *= BALL_DAMPING;
    const spd = len(ball.vx, ball.vy);
    if (spd > BALL_MAX_SPEED) { ball.vx = ball.vx / spd * BALL_MAX_SPEED; ball.vy = ball.vy / spd * BALL_MAX_SPEED; }
    ball.x += ball.vx; ball.y += ball.vy;

    const hw = this.stadium.width / 2, hh = this.stadium.height / 2;
    const goalHalf = this.stadium.goalWidth / 2;
    const inGoalMouth = Math.abs(ball.y) < goalHalf;

    if (ball.x < -hw + ball.radius) {
      if (inGoalMouth) {
        if (ball.x < -hw - this.stadium.goalDepth) { this.scoreGoal('red'); return; }
      } else {
        ball.x = -hw + ball.radius; ball.vx *= -WALL_B_COEF;
      }
    }
    if (ball.x > hw - ball.radius) {
      if (inGoalMouth) {
        if (ball.x > hw + this.stadium.goalDepth) { this.scoreGoal('blue'); return; }
      } else {
        ball.x = hw - ball.radius; ball.vx *= -WALL_B_COEF;
      }
    }
    if (ball.y < -hh + ball.radius) { ball.y = -hh + ball.radius; ball.vy *= -WALL_B_COEF; }
    if (ball.y > hh - ball.radius) { ball.y = hh - ball.radius; ball.vy *= -WALL_B_COEF; }
  }

  serialize() {
    return {
      stadium: this.stadium,
      score: this.score,
      timeLeftMs: Math.round(this.timeLeftMs),
      paused: this.paused,
      frozen: this.simTimeMs < this.kickoffFreezeUntil,
      kickoffTeam: this.kickoffTeam,
      ball: { x: Math.round(this.ball.x), y: Math.round(this.ball.y) },
      players: Array.from(this.players.values()).map(p => ({
        id: p.id, team: p.team, x: Math.round(p.x), y: Math.round(p.y)
      }))
    };
  }
}

module.exports = { Match, TICK_MS, TICK_HZ, stadiumFor, PLAYER_RADIUS, BALL_RADIUS };
