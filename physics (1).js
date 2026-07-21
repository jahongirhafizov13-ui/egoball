// ============================================================================
// physics.js
//
// Server-authoritative simulation of a Haxball-style match.
// Added: Player skills system (speed, kick, weight)
// ============================================================================

const TICK_HZ = 60;
const TICK_MS = 1000 / TICK_HZ;

const PLAYER_RADIUS = 15;
const BALL_RADIUS = 10;

const PLAYER_INV_MASS = 0.5;      // mass 2
const BALL_INV_MASS = 1;          // mass 1

const PLAYER_DAMPING = 0.96;
const KICKING_DAMPING = 0.96;
const BALL_DAMPING = 0.99;

const PLAYER_ACCEL = 0.11;
const KICKING_ACCEL = 0.078;
const PLAYER_MAX_SPEED = 4.2;

const KICK_STRENGTH = 0.42;
const POWER_KICK_STRENGTH = 0.85;  // kuchli zarb
const BALL_MAX_SPEED = 13;

const WALL_B_COEF = 0.5;
const PLAYER_B_COEF = 0.5;

const KICKOFF_FREEZE_MS = 3000;
const GOAL_PAUSE_MS = 2600;

// Sprint (tez ishqalanish) sozlamalari
const SPRINT_DURATION_MS = 800;    // sprint davomiyligi
const SPRINT_COOLDOWN_MS = 3000;   // sprint orasidagi tanaffus
const SPRINT_SPEED_MULT = 1.6;     // sprint tezlik ko'paytirgichi
const SPRINT_ACCEL_MULT = 1.4;     // sprint tezlanish ko'paytirgichi

function stadiumFor(teamSize) {
  const scale = 1 + (teamSize - 1) * 0.18;
  return {
    width: Math.round(760 * scale),
    height: Math.round(400 * Math.sqrt(scale)),
    goalWidth: 100,
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

// Skill tizimi: har bir o'yinchiga 3 ta skill
// speed - tezlik, kick - zarba kuchi, weight - og'irlik (fizika)
const DEFAULT_SKILLS = { speed: 1.0, kick: 1.0, weight: 1.0 };
const MAX_SKILL_POINTS = 3.0; // jami skill ballar

class PlayerBody {
  constructor(id, team, skills = null) {
    this.id = id;
    this.team = team;
    this.radius = PLAYER_RADIUS;
    this.invMass = PLAYER_INV_MASS;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.input = { up: false, down: false, left: false, right: false, kick: false, sprint: false, powerKick: false };
    this.disconnected = false;

    // Skill tizimi
    this.skills = skills || { ...DEFAULT_SKILLS };
    this.normalizeSkills();

    // Sprint holati
    this.sprinting = false;
    this.sprintEndTime = 0;
    this.sprintCooldownEnd = 0;
  }

  normalizeSkills() {
    // Skill lar yig'indisi MAX_SKILL_POINTS ga teng bo'lishi kerak
    const total = this.skills.speed + this.skills.kick + this.skills.weight;
    if (total > 0) {
      const factor = MAX_SKILL_POINTS / total;
      this.skills.speed *= factor;
      this.skills.kick *= factor;
      this.skills.weight *= factor;
    }
    // Og'irlik (weight) -> invMass: katta weight = kichik invMass (og'irroq)
    // weight 1.0 -> invMass 0.5 (default)
    // weight 2.0 -> invMass 0.25 (og'irroq, kamroq tepiladi)
    this.invMass = PLAYER_INV_MASS / this.skills.weight;
  }

  getMaxSpeed() {
    let spd = PLAYER_MAX_SPEED * this.skills.speed;
    if (this.sprinting) spd *= SPRINT_SPEED_MULT;
    return spd;
  }

  getAccel() {
    let acc = this.input.kick ? KICKING_ACCEL : PLAYER_ACCEL;
    acc *= this.skills.speed;
    if (this.sprinting) acc *= SPRINT_ACCEL_MULT;
    return acc;
  }

  getKickStrength() {
    const base = this.input.powerKick ? POWER_KICK_STRENGTH : KICK_STRENGTH;
    return base * this.skills.kick;
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
  constructor(roomId, teamSize, onGoal, onEnd) {
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
    this.timeLeftMs = 5 * 60 * 1000;
    this.lastTouch = null;
    this.playerSkills = new Map(); // id -> skills
  }

  addPlayer(id, team, skills = null) {
    const p = new PlayerBody(id, team, skills);
    this.players.set(id, p);
    if (skills) this.playerSkills.set(id, skills);
    this.resetFormation();
    return p;
  }
  removePlayer(id) {
    this.players.delete(id);
    this.playerSkills.delete(id);
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

  tick(dtMs) {
    if (!this.running) return;
    this.simTimeMs += dtMs;

    if (this.paused) {
      if (this.simTimeMs >= this.pauseUntil) {
        this.paused = false;
        this.resetFormation();
        this.kickoffFreezeUntil = this.simTimeMs + KICKOFF_FREEZE_MS;
      } else {
        return;
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

      // Sprint holatini yangilash
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
          const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          const rel = rvx * nx + rvy * ny;
          if (rel < 0) {
            // Og'irlik (mass) hisobga olinadi
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
      const minD = p.radius + ball.radius;
      if (d < minD && d > 0.0001) {
        const nx = dx / d, ny = dy / d, overlap = minD - d;
        ball.x += nx * overlap; ball.y += ny * overlap;
        const closing = p.vx * nx + p.vy * ny;
        if (closing > 0) {
          const totalInv = p.invMass + BALL_INV_MASS;
          const ballShare = BALL_INV_MASS / totalInv;
          ball.vx += nx * closing * ballShare * 1.9;
          ball.vy += ny * closing * ballShare * 1.9;
        }
        if (p.input.kick || p.input.powerKick) {
          const kickStr = p.getKickStrength();
          ball.vx += nx * kickStr;
          ball.vy += ny * kickStr;
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
        id: p.id, team: p.team, x: Math.round(p.x), y: Math.round(p.y),
        skills: p.skills,
        sprinting: p.sprinting,
        sprintCooldown: Math.max(0, p.sprintCooldownEnd - this.simTimeMs)
      }))
    };
  }
}

module.exports = { Match, TICK_MS, TICK_HZ, stadiumFor, PLAYER_RADIUS, BALL_RADIUS, DEFAULT_SKILLS, MAX_SKILL_POINTS };
