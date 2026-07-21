// ============================================================================
// physics.js - EGOBALL Server-Authoritative Physics v2.0
// Features: Realistic ball physics, bounciness, smaller ball, improved collisions
// ============================================================================

const TICK_HZ = 60;
const TICK_MS = 1000 / TICK_HZ;

const PLAYER_RADIUS = 15;
const BALL_RADIUS = 8; // Smaller ball for better gameplay

const PLAYER_INV_MASS = 0.5;
const BALL_INV_MASS = 1;

const PLAYER_DAMPING = 0.96;
const KICKING_DAMPING = 0.96;
const BALL_DAMPING = 0.992; // Less damping = more bounce/roll

const PLAYER_ACCEL = 0.11;
const KICKING_ACCEL = 0.078;
const PLAYER_MAX_SPEED = 4.2;

const KICK_STRENGTH = 0.35; // Normal kick - not too fast
const POWER_KICK_STRENGTH = 0.75; // Power kick - strong but not crazy
const BALL_MAX_SPEED = 14;

const WALL_B_COEF = 0.7; // More bouncy walls
const PLAYER_B_COEF = 0.5;

const KICKOFF_FREEZE_MS = 3000;
const GOAL_PAUSE_MS = 5500;
const GOAL_COUNTDOWN_MS = 3000;
const PRACTICE_TIME_MS = 999 * 60 * 1000;

// Sprint settings
const SPRINT_DURATION_MS = 800;
const SPRINT_COOLDOWN_MS = 3000;
const SPRINT_SPEED_MULT = 1.6;
const SPRINT_ACCEL_MULT = 1.4;

// Ball bounciness (restitution)
const BALL_RESTITUTION = 0.85; // High restitution = bouncy ball
const BALL_WALL_RESTITUTION = 0.75;

function stadiumFor(teamSize) {
  const scales = { 1: 0.7, 2: 1.0, 3: 1.35, 4: 1.7 };
  const scale = scales[teamSize] || 1.0;
  return {
    width: Math.round(760 * scale),
    height: Math.round(400 * scale),
    goalWidth: Math.round(100 * Math.sqrt(scale)),
    goalDepth: Math.round(26 * scale),
    wallCornerRadius: 18,
    kickOffRadius: Math.round(90 * scale)
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

const DEFAULT_SKILLS = { speed: 1.0, kick: 1.0, jump: 1.0, weight: 1.0 };
const MAX_SKILL_POINTS = 3.0;

class PlayerBody {
  constructor(id, team, username, stats = null) {
    this.id = id;
    this.team = team;
    this.username = username || 'Player';
    this.radius = PLAYER_RADIUS;
    this.invMass = PLAYER_INV_MASS;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.input = { up: false, down: false, left: false, right: false, kick: false, sprint: false, powerKick: false };
    this.disconnected = false;
    this.stats = stats || { speed: 1, kick: 1, jump: 1, size: 1 };
    this.sprinting = false;
    this.sprintEndTime = 0;
    this.sprintCooldownEnd = 0;
    this.goals = 0;
  }

  getMaxSpeed() {
    let spd = PLAYER_MAX_SPEED * (this.stats.speed || 1);
    if (this.sprinting) spd *= SPRINT_SPEED_MULT;
    return spd;
  }

  getAccel() {
    let acc = this.input.kick ? KICKING_ACCEL : PLAYER_ACCEL;
    acc *= (this.stats.speed || 1);
    if (this.sprinting) acc *= SPRINT_ACCEL_MULT;
    return acc;
  }

  getKickStrength() {
    const base = this.input.powerKick ? POWER_KICK_STRENGTH : KICK_STRENGTH;
    return base * (this.stats.kick || 1);
  }

  getRadius() {
    return PLAYER_RADIUS * (this.stats.size || 1);
  }

  updateSprint(simTimeMs) {
    if (this.sprinting && simTimeMs >= this.sprintEndTime) {
      this.sprinting = false;
      this.sprintCooldownEnd = simTimeMs + SPRINT_COOLDOWN_MS;
    }
    if (this.input.sprint && !this.sprinting && simTimeMs >= this.sprintCooldownEnd) {
      this.sprinting = true;
      this.sprintEndTime = simTimeMs + SPRINT_DURATION_MS;
    }
  }
}

class Match {
  constructor(roomId, teamSize, onGoal, onEnd, isPractice = false) {
    this.roomId = roomId;
    this.teamSize = teamSize;
    this.stadium = stadiumFor(teamSize);
    this.ball = new Ball(this.stadium);
    this.players = new Map();
    this.score = { red: 0, blue: 0 };
    this.running = false;
    this.simTimeMs = 0;
    this.paused = false;
    this.pauseUntil = 0;
    this.kickoffTeam = Math.random() < 0.5 ? 'red' : 'blue';
    this.onGoal = onGoal || (() => {});
    this.onEnd = onEnd || (() => {});
    this.isPractice = isPractice;
    this.timeLeftMs = isPractice ? PRACTICE_TIME_MS : (5 * 60 * 1000);
    this.lastTouch = null;
    this.lastTouchName = null;
    this.goalScorer = null;
    this.countdownActive = false;
    this.countdownUntil = 0;
    this.countdownValue = 0;
  }

  addPlayer(id, team, username, stats = null) {
    const p = new PlayerBody(id, team, username, stats);
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
    p.input.up = !!input.up;
    p.input.down = !!input.down;
    p.input.left = !!input.left;
    p.input.right = !!input.right;
    p.input.kick = !!input.kick;
    p.input.sprint = !!input.sprint;
    p.input.powerKick = !!input.powerKick;
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
    this.lastTouchName = null;
  }

  start() {
    this.running = true;
    this.simTimeMs = 0;
    this.kickoffFreezeUntil = this.simTimeMs + KICKOFF_FREEZE_MS;
  }

  stop() { this.running = false; }

  scoreGoal(concedingTeam) {
    const scoringTeam = concedingTeam === 'red' ? 'blue' : 'red';

    if (!this.isPractice) {
      this.score[scoringTeam]++;
    }

    let scorerName = this.lastTouchName || 'Unknown';
    let scorerId = this.lastTouch;
    if (scorerId) {
      const p = this.players.get(scorerId);
      if (p) {
        scorerName = p.username;
        p.goals++;
      }
    }
    this.goalScorer = { name: scorerName, team: scoringTeam, id: scorerId };

    this.onGoal({ 
      scoringTeam, 
      score: { ...this.score }, 
      scorerId: this.lastTouch,
      scorerName: scorerName,
      isPractice: this.isPractice
    });

    this.paused = true;
    this.pauseUntil = this.simTimeMs + GOAL_PAUSE_MS;
    this.kickoffTeam = concedingTeam;
  }

  tick(dtMs) {
    if (!this.running) return;
    this.simTimeMs += dtMs;

    if (this.paused) {
      if (this.simTimeMs >= this.pauseUntil) {
        this.paused = false;
        this.countdownActive = true;
        this.countdownUntil = this.simTimeMs + GOAL_COUNTDOWN_MS;
        this.countdownValue = 3;
        this.resetFormation();
      } else {
        return;
      }
    }

    if (this.countdownActive) {
      const remaining = this.countdownUntil - this.simTimeMs;
      this.countdownValue = Math.ceil(remaining / 1000);
      if (remaining <= 0) {
        this.countdownActive = false;
        this.kickoffFreezeUntil = this.simTimeMs + KICKOFF_FREEZE_MS;
      }
      return;
    }

    const frozen = this.simTimeMs < this.kickoffFreezeUntil;

    if (!this.isPractice && !frozen) {
      this.timeLeftMs = Math.max(0, this.timeLeftMs - dtMs);
    }

    if (!this.isPractice && this.timeLeftMs <= 0) { 
      this.running = false; 
      this.onEnd({ score: { ...this.score } }); 
      return; 
    }

    this.stepPlayers(frozen);
    this.stepPlayerCollisions();
    if (!frozen) this.stepBallContactAndKick();
    this.stepBallMotion(frozen);
  }

  stepPlayers(frozen) {
    this.players.forEach(p => {
      if (frozen) { p.vx = 0; p.vy = 0; return; }
      p.updateSprint(this.simTimeMs);
      let ax = 0, ay = 0;
      if (p.input.up) ay -= 1;
      if (p.input.down) ay += 1;
      if (p.input.left) ax -= 1;
      if (p.input.right) ax += 1;
      const mag = len(ax, ay);
      const accel = p.getAccel();
      const damping = p.input.kick ? KICKING_DAMPING : PLAYER_DAMPING;
      if (mag > 0) {
        p.vx += (ax / mag) * accel;
        p.vy += (ay / mag) * accel;
      }
      p.vx *= damping; p.vy *= damping;
      const spd = len(p.vx, p.vy);
      const maxSpd = p.getMaxSpeed();
      if (spd > maxSpd) { p.vx = p.vx / spd * maxSpd; p.vy = p.vy / spd * maxSpd; }
      p.x += p.vx; p.y += p.vy;

      const hw = this.stadium.width / 2, hh = this.stadium.height / 2;
      const pr = p.getRadius();
      if (p.x < -hw + pr) { p.x = -hw + pr; p.vx *= -PLAYER_B_COEF; }
      if (p.x > hw - pr) { p.x = hw - pr; p.vx *= -PLAYER_B_COEF; }
      if (p.y < -hh + pr) { p.y = -hh + pr; p.vy *= -PLAYER_B_COEF; }
      if (p.y > hh - pr) { p.y = hh - pr; p.vy *= -PLAYER_B_COEF; }
    });
  }

  stepPlayerCollisions() {
    const arr = Array.from(this.players.values());
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy);
        const minD = a.getRadius() + b.getRadius();
        if (d < minD && d > 0.0001) {
          const nx = dx / d, ny = dy / d, overlap = (minD - d) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          const rel = rvx * nx + rvy * ny;
          if (rel < 0) {
            const totalInv = a.invMass + b.invMass;
            const aShare = a.invMass / totalInv;
            const bShare = b.invMass / totalInv;
            const imp = -rel * PLAYER_B_COEF;
            a.vx -= nx * imp * bShare; a.vy -= ny * imp * bShare;
            b.vx += nx * imp * aShare; b.vy += ny * imp * aShare;
          }
        }
      }
    }
  }

  stepBallContactAndKick() {
    const ball = this.ball;
    this.players.forEach(p => {
      const dx = ball.x - p.x, dy = ball.y - p.y, d = len(dx, dy);
      const minD = p.getRadius() + ball.radius;
      if (d < minD && d > 0.0001) {
        const nx = dx / d, ny = dy / d, overlap = minD - d;
        ball.x += nx * overlap; ball.y += ny * overlap;

        // Only apply kick force if player is actively kicking
        if (p.input.kick || p.input.powerKick) {
          const kickStr = p.getKickStrength();
          // Add player's velocity to kick for more realistic physics
          ball.vx += nx * kickStr + p.vx * 0.3;
          ball.vy += ny * kickStr + p.vy * 0.3;
        } else {
          // Just touching the ball - gentle push
          const closing = p.vx * nx + p.vy * ny;
          if (closing > 0) {
            const totalInv = p.invMass + BALL_INV_MASS;
            const ballShare = BALL_INV_MASS / totalInv;
            ball.vx += nx * closing * ballShare * BALL_RESTITUTION;
            ball.vy += ny * closing * ballShare * BALL_RESTITUTION;
          }
        }
        this.lastTouch = p.id;
        this.lastTouchName = p.username;
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
        ball.x = -hw + ball.radius; 
        ball.vx = Math.abs(ball.vx) * BALL_WALL_RESTITUTION;
      }
    }
    if (ball.x > hw - ball.radius) {
      if (inGoalMouth) {
        if (ball.x > hw + this.stadium.goalDepth) { this.scoreGoal('blue'); return; }
      } else {
        ball.x = hw - ball.radius; 
        ball.vx = -Math.abs(ball.vx) * BALL_WALL_RESTITUTION;
      }
    }
    if (ball.y < -hh + ball.radius) { 
      ball.y = -hh + ball.radius; 
      ball.vy = Math.abs(ball.vy) * BALL_WALL_RESTITUTION; 
    }
    if (ball.y > hh - ball.radius) { 
      ball.y = hh - ball.radius; 
      ball.vy = -Math.abs(ball.vy) * BALL_WALL_RESTITUTION; 
    }
  }

  serialize() {
    return {
      stadium: this.stadium,
      score: this.score,
      timeLeftMs: Math.round(this.timeLeftMs),
      paused: this.paused,
      frozen: this.simTimeMs < this.kickoffFreezeUntil,
      kickoffTeam: this.kickoffTeam,
      isPractice: this.isPractice,
      countdownActive: this.countdownActive,
      countdownValue: this.countdownValue,
      goalScorer: this.goalScorer,
      ball: { x: Math.round(this.ball.x), y: Math.round(this.ball.y) },
      players: Array.from(this.players.values()).map(p => ({
        id: p.id, team: p.team, username: p.username, x: Math.round(p.x), y: Math.round(p.y),
        sprinting: p.sprinting, sprintCooldown: Math.max(0, p.sprintCooldownEnd - this.simTimeMs),
        goals: p.goals
      }))
    };
  }
}

module.exports = { 
  Match, TICK_MS, TICK_HZ, stadiumFor, 
  PLAYER_RADIUS, BALL_RADIUS, 
  DEFAULT_SKILLS, MAX_SKILL_POINTS 
};
