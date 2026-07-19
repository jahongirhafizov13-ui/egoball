// ============================================================================
// physics.js - server-authoritative simulation (ball + player + stadium).
// This is the ONLY place match positions are ever computed. Clients never
// simulate physics themselves - they send input, they receive state.
//
// Exposes a factory, createPhysics({ io }), so this file has zero dependency
// on rooms.js/server.js beyond the socket.io instance it's given to broadcast
// with - rooms.js calls into this module, this module never calls back into
// rooms.js directly (it reports match-end through a callback instead, to
// avoid a circular require between the two files).
// ============================================================================

const MODES = {
  '1v1': { teamSize: 1, w: 540, h: 300, goalH: 100 },
  '2v2': { teamSize: 2, w: 880, h: 460, goalH: 150 },
  '3v3': { teamSize: 3, w: 1060, h: 540, goalH: 170 },
  '4v4': { teamSize: 4, w: 1060, h: 540, goalH: 170 }, // 4v4 shares the 3v3 pitch (busier, tighter football)
  '5v5': { teamSize: 5, w: 1420, h: 660, goalH: 210 }
};

const PHYS = {
  TICK_MS: 50, // 20 Hz - light enough for a free/small host, plenty smooth for a 2D arcade pitch
  PLAYER_SPEED: 2.0, SPEED_PER_LEVEL: 0.11, ACCEL_LERP: 0.25, FRICTION_IDLE: 0.92,
  KICK_BASE: 2.0, KICK_POWER_BONUS: 0.28, KICK_POWER_EXTRA: 7.0, KICK_COOLDOWN_MS: 300, KICK_RANGE: 3,
  POWER_KICK_COOLDOWN_MS: 8000, SPRINT_MULT: 1.6, SPRINT_DURATION_MS: 300, SPRINT_COOLDOWN_MS: 4500,
  BALL_RADIUS: 6, PLAYER_RADIUS: 16, NET_DEPTH: 32, RUNOFF: 40,
  WALL_RESTITUTION: 0.74, BALL_FRICTION: 0.99, MAX_BALL_SPEED: 8,
  BOT_SPEED: 2.0, BOT_ACCEL_LERP: 0.40, BOT_KICK_POWER: 2.8, BOT_KICK_COOLDOWN_MS: 240, BOT_KICK_ANGLE_CONE: 0.52,
  KICKOFF_BARRIER_R: 95, KICKOFF_MS: 3000, GOAL_CELEBRATION_MS: 5000,
  PLAYER_INV_MASS: 0.15, BALL_INV_MASS: 0.85, CONTACT_RESTITUTION: 0.82,
  MATCH_WIN_GOALS: 3, MATCH_DURATION_SEC: 180
};

const DEFAULT_STATS = { speed: 0, kickPower: 0, power: 1, control: 0 };
function statOf(p, key) { return (p.stats && typeof p.stats[key] === 'number') ? p.stats[key] : DEFAULT_STATS[key]; }

function buildPhysicsPlayers(room, teamSize, field) {
  const real = room.players.filter(p => !p.spectator && p.team);
  const teamAReal = real.filter(p => p.team === 'A').slice(0, teamSize);
  const teamBReal = real.filter(p => p.team === 'B').slice(0, teamSize);
  const players = [];
  function slotFor(team, idx, entry) {
    const laneY = field.h / (teamSize + 1) * (idx + 1);
    const x = team === 'A' ? field.w * 0.25 : field.w * 0.75;
    return {
      netId: entry ? entry.id : null, team, num: idx + 1,
      x, y: laneY, vx: 0, vy: 0, radius: PHYS.PLAYER_RADIUS,
      isBot: !entry, name: entry ? (entry.name || 'Guest') : 'BOT',
      color: team === 'A' ? '#4fb0ff' : '#ff6b6b', accentColor: entry ? entry.color : null,
      characterId: entry ? entry.characterId : null, auraId: entry ? entry.auraId : null,
      auraUntil: 0, stats: entry ? (entry.stats || DEFAULT_STATS) : DEFAULT_STATS,
      kickCd: 0, powerCd: 0, sprintCd: 0, sprintT: 0, prevKick: false, prevPower: false, facing: 0, kickFlashUntil: 0
    };
  }
  for (let i = 0; i < teamSize; i++) players.push(slotFor('A', i, teamAReal[i]));
  for (let i = 0; i < teamSize; i++) players.push(slotFor('B', i, teamBReal[i]));
  return players;
}

function startKickoffPhys(phys, possessionTeam) {
  const teamSize = phys.field.teamSize;
  phys.players.forEach(p => {
    const idx = p.num - 1;
    const laneY = phys.field.h / (teamSize + 1) * (idx + 1);
    p.x = p.team === 'A' ? phys.field.w * 0.25 : phys.field.w * 0.75;
    p.y = laneY; p.vx = 0; p.vy = 0;
  });
  phys.ball.x = phys.field.w / 2; phys.ball.y = phys.field.h / 2; phys.ball.vx = 0; phys.ball.vy = 0;
  phys.kickoffActive = true; phys.kickoffTeam = possessionTeam; phys.kickoffDeadline = Date.now() + PHYS.KICKOFF_MS;
}

function initRoomPhysics(room) {
  const modeInfo = MODES[room.mode] || MODES['2v2'];
  const field = { w: modeInfo.w, h: modeInfo.h, goalH: modeInfo.goalH, teamSize: modeInfo.teamSize };
  const players = buildPhysicsPlayers(room, modeInfo.teamSize, field);
  room.phys = {
    field, players,
    ball: { x: field.w / 2, y: field.h / 2, vx: 0, vy: 0, radius: PHYS.BALL_RADIUS },
    score: { A: 0, B: 0 }, matchTimeLeft: PHYS.MATCH_DURATION_SEC,
    ballFrozen: false, botsFrozen: false, playersFrozen: false,
    netEnteringA: false, netEnteringB: false,
    lastToucherId: null, ended: false, countdown: 0,
    lastTickAt: Date.now()
  };
  startKickoffPhys(room.phys, Math.random() < 0.5 ? 'A' : 'B');
}

function applyHumanControl(p, snap, phys) {
  if (phys.playersFrozen) { p.vx = 0; p.vy = 0; p.prevKick = !!snap.kick; p.prevPower = !!snap.power; return; }
  if (p.sprintCd > 0) p.sprintCd -= PHYS.TICK_MS;
  if (p.powerCd > 0) p.powerCd -= PHYS.TICK_MS;
  if (p.kickCd > 0) p.kickCd -= PHYS.TICK_MS;
  const len = Math.hypot(snap.mvx || 0, snap.mvy || 0);
  let targetSpeed = PHYS.PLAYER_SPEED + statOf(p, 'speed') * PHYS.SPEED_PER_LEVEL;
  if (snap.sprint && p.sprintCd <= 0) { p.sprintT = PHYS.SPRINT_DURATION_MS; p.sprintCd = PHYS.SPRINT_COOLDOWN_MS; }
  if (p.sprintT > 0) { targetSpeed *= PHYS.SPRINT_MULT; p.sprintT -= PHYS.TICK_MS; }
  const moveLerp = snap.kick ? PHYS.ACCEL_LERP * 0.72 : PHYS.ACCEL_LERP;
  if (len > 0.08) {
    const nx = snap.mvx / (len || 1), ny = snap.mvy / (len || 1);
    const dvx = nx * targetSpeed, dvy = ny * targetSpeed;
    p.vx += (dvx - p.vx) * moveLerp; p.vy += (dvy - p.vy) * moveLerp;
    p.facing = Math.atan2(snap.mvy, snap.mvx);
  } else { p.vx *= PHYS.FRICTION_IDLE; p.vy *= PHYS.FRICTION_IDLE; }

  const ball = phys.ball;
  const dist = Math.hypot(ball.x - p.x, ball.y - p.y);
  const inRange = dist < p.radius + ball.radius + PHYS.KICK_RANGE;
  const kickEdge = snap.kick && !p.prevKick;
  if (kickEdge && p.kickCd <= 0 && inRange) {
    const ang = Math.atan2(ball.y - p.y, ball.x - p.x);
    const power = PHYS.KICK_BASE + statOf(p, 'kickPower') * PHYS.KICK_POWER_BONUS;
    ball.vx += Math.cos(ang) * power; ball.vy += Math.sin(ang) * power;
    p.kickCd = PHYS.KICK_COOLDOWN_MS; p.kickFlashUntil = Date.now() + 140;
    phys.lastToucherId = p.netId;
  }
  const powerEdge = snap.power && !p.prevPower;
  if (powerEdge && p.powerCd <= 0 && inRange) {
    const ang = Math.atan2(ball.y - p.y, ball.x - p.x);
    const power = PHYS.KICK_BASE + statOf(p, 'kickPower') * PHYS.KICK_POWER_BONUS + PHYS.KICK_POWER_EXTRA * 0.55;
    ball.vx += Math.cos(ang) * power; ball.vy += Math.sin(ang) * power;
    p.powerCd = PHYS.POWER_KICK_COOLDOWN_MS; p.kickFlashUntil = Date.now() + 200;
    phys.lastToucherId = p.netId;
  }
  p.prevKick = !!snap.kick; p.prevPower = !!snap.power;
}

function applyBotAI(p, phys) {
  if (phys.playersFrozen || phys.botsFrozen) { p.vx = 0; p.vy = 0; return; }
  if (p.kickCd > 0) p.kickCd -= PHYS.TICK_MS;
  const field = phys.field, ball = phys.ball, players = phys.players;
  const goalX = p.team === 'A' ? field.w : 0;
  const distBall = Math.hypot(ball.x - p.x, ball.y - p.y);
  const teammates = players.filter(o => o !== p && o.team === p.team);
  const teammatesCloser = teammates.some(o => Math.hypot(ball.x - o.x, ball.y - o.y) < distBall);
  const teamArr = players.filter(pp => pp.team === p.team);
  const laneIndex = teamArr.indexOf(p);
  const laneY = field.h / (teamArr.length + 1) * (laneIndex + 1);
  let tx, ty;
  if (!teammatesCloser) {
    const leadTime = 6;
    const predX = Math.max(24, Math.min(field.w - 24, ball.x + ball.vx * leadTime));
    const predY = Math.max(24, Math.min(field.h - 24, ball.y + ball.vy * leadTime));
    const approachOffset = p.radius + ball.radius - 3;
    tx = predX + (p.team === 'A' ? -approachOffset : approachOffset);
    ty = predY;
  } else {
    const homeX = p.team === 'A' ? field.w * (0.24 + 0.10 * (laneIndex % 3)) : field.w * (0.76 - 0.10 * (laneIndex % 3));
    tx = homeX + (ball.x - field.w / 2) * 0.22;
    ty = laneY * 0.55 + ball.y * 0.35 + (field.h / 2) * 0.10;
  }
  const dx = tx - p.x, dy = ty - p.y; const d = Math.hypot(dx, dy);
  let botSpeed = PHYS.BOT_SPEED;
  const slowRadius = 40;
  if (d < slowRadius) botSpeed *= Math.max(0.25, d / slowRadius);
  if (d > 2) {
    const nx = dx / d, ny = dy / d;
    p.vx += (nx * botSpeed - p.vx) * PHYS.BOT_ACCEL_LERP; p.vy += (ny * botSpeed - p.vy) * PHYS.BOT_ACCEL_LERP;
  } else { p.vx *= 0.85; p.vy *= 0.85; }
  teammates.forEach(o => {
    const ddx = p.x - o.x, ddy = p.y - o.y, dd = Math.hypot(ddx, ddy);
    const minSep = p.radius * 2.6;
    if (dd < minSep && dd > 0.01) { const push = (minSep - dd) / minSep; p.vx += (ddx / dd) * push * 1.4; p.vy += (ddy / dd) * push * 1.4; }
  });
  if (distBall < p.radius + ball.radius + PHYS.KICK_RANGE && p.kickCd <= 0) {
    const opp = players.filter(o => o.team !== p.team);
    const toGoalAng = Math.atan2((field.h / 2) - p.y, goalX - p.x);
    const blocker = opp.find(o => {
      const dOpp = Math.hypot(o.x - p.x, o.y - p.y);
      if (dOpp > 95) return false;
      const toOppAng = Math.atan2(o.y - p.y, o.x - p.x);
      let diff = Math.abs(toGoalAng - toOppAng); if (diff > Math.PI) diff = Math.PI * 2 - diff;
      return diff < 0.55;
    });
    let targetAng;
    if (blocker && Math.random() < 0.65) {
      const aimX = goalX, aimY = field.h / 2 + (Math.random() - 0.5) * 70;
      const useTopWall = p.y < field.h / 2;
      const mirrorY = useTopWall ? -aimY : (2 * field.h - aimY);
      targetAng = Math.atan2(mirrorY - p.y, aimX - p.x);
    } else {
      let bestMate = null, bestScore = -1;
      teammates.forEach(m => {
        const advancement = p.team === 'A' ? (m.x - p.x) : (p.x - m.x);
        if (advancement > 30) {
          const openness = opp.length ? Math.min(...opp.map(o => Math.hypot(o.x - m.x, o.y - m.y))) : 999;
          const scoreV = advancement + openness * 0.5;
          if (scoreV > bestScore) { bestScore = scoreV; bestMate = m; }
        }
      });
      const goalDist = Math.hypot(goalX - p.x, (field.h / 2) - p.y);
      if (goalDist > field.w * 0.42 && bestMate && Math.random() < 0.55) {
        targetAng = Math.atan2(bestMate.y - p.y, bestMate.x - p.x);
      } else {
        targetAng = Math.atan2((field.h / 2 + (Math.random() - 0.5) * 70) - p.y, goalX - p.x);
      }
    }
    const realAng = Math.atan2(ball.y - p.y, ball.x - p.x);
    let angDiff = targetAng - realAng;
    angDiff = Math.atan2(Math.sin(angDiff), Math.cos(angDiff));
    angDiff = Math.max(-PHYS.BOT_KICK_ANGLE_CONE, Math.min(PHYS.BOT_KICK_ANGLE_CONE, angDiff));
    targetAng = realAng + angDiff;
    ball.vx += Math.cos(targetAng) * PHYS.BOT_KICK_POWER; ball.vy += Math.sin(targetAng) * PHYS.BOT_KICK_POWER;
    p.kickCd = PHYS.BOT_KICK_COOLDOWN_MS; p.kickFlashUntil = Date.now() + 140;
    phys.lastToucherId = p.netId;
  }
}

function updatePlayerNetId(room, oldId, newId){
  if(room.phys){
    const p = room.phys.players.find(pp => pp.netId === oldId);
    if(p) p.netId = newId;
  }
}

function serializePhysics(room) {
  const phys = room.phys;
  if (!phys) return null;
  return {
    field: phys.field,
    ball: { x: phys.ball.x, y: phys.ball.y },
    players: phys.players.map(p => ({
      id: p.netId, x: p.x, y: p.y, team: p.team, num: p.num, isBot: p.isBot, name: p.name,
      color: p.color, accentColor: p.accentColor, characterId: p.characterId, auraId: p.auraId, auraUntil: p.auraUntil || 0,
      kickFlashUntil: p.kickFlashUntil || 0, facing: p.facing
    })),
    score: phys.score, matchTimeLeft: Math.max(0, Math.round(phys.matchTimeLeft)),
    kickoffActive: phys.kickoffActive, kickoffTeam: phys.kickoffTeam,
    kickoffMsLeft: phys.kickoffActive ? Math.max(0, phys.kickoffDeadline - Date.now()) : 0,
    ballFrozen: phys.ballFrozen, playersFrozen: phys.playersFrozen
  };
}

// createPhysics({ io, onLocalMatchEnded }) - onLocalMatchEnded(room, winningTeam) is called
// instead of this module reaching into rooms.js directly (keeps the dependency one-directional).
function createPhysics({ io, onLocalMatchEnded }) {
  const roomInputs = {}; // socket.id -> {mvx,mvy,kick,power,sprint}

  function scoreGoalPhys(room, team) {
    const phys = room.phys;
    phys.netEnteringA = false; phys.netEnteringB = false;
    phys.score[team]++;
    const scorer = phys.players.find(p => p.netId === phys.lastToucherId);
    if (scorer && scorer.team === team && scorer.auraId) scorer.auraUntil = Date.now() + 5000;
    io.to(room.code).emit('matchEvent', { type: 'goal', team, scorerName: scorer ? scorer.name : null, scorerId: scorer ? scorer.netId : null, score: phys.score });
    phys.ballFrozen = true; phys.botsFrozen = true;
    phys.ball.x = phys.field.w / 2; phys.ball.y = phys.field.h / 2; phys.ball.vx = 0; phys.ball.vy = 0;
    setTimeout(() => {
      if (!room.phys || room.phys !== phys) return; // room/match already gone
      if (phys.score.A >= PHYS.MATCH_WIN_GOALS || phys.score.B >= PHYS.MATCH_WIN_GOALS) {
        endRoomMatch(room); return;
      }
      startKickoffPhys(phys, team === 'A' ? 'B' : 'A');
      phys.playersFrozen = true;
      phys.countdown = 3;
      const tickDown = () => {
        if (!room.phys || room.phys !== phys) return;
        io.to(room.code).emit('matchEvent', { type: 'countdown', n: phys.countdown });
        if (phys.countdown <= 0) {
          phys.ballFrozen = false; phys.playersFrozen = false; phys.botsFrozen = false;
          io.to(room.code).emit('matchEvent', { type: 'kickoffGo' });
          return;
        }
        phys.countdown--;
        setTimeout(tickDown, 1000);
      };
      tickDown();
    }, PHYS.GOAL_CELEBRATION_MS);
  }

  function endRoomMatch(room) {
    const phys = room.phys;
    if (!phys || phys.ended) return;
    phys.ended = true;
    io.to(room.code).emit('matchEvent', { type: 'end', score: phys.score });
    room.started = false;
    room.phys = null;
    if (room.isLocal && typeof onLocalMatchEnded === 'function') {
      const winningTeam = phys.score.A === phys.score.B ? 'A' : (phys.score.A > phys.score.B ? 'A' : 'B');
      onLocalMatchEnded(room, winningTeam);
    }
  }

  function tickRoomPhysics(room) {
    const phys = room.phys;
    if (!phys || phys.ended) return;
    const field = phys.field, ball = phys.ball, players = phys.players;

    players.forEach(p => {
      if (p.isBot) return;
      const snap = roomInputs[p.netId] || { mvx: 0, mvy: 0, kick: false, power: false, sprint: false };
      applyHumanControl(p, snap, phys);
    });
    players.forEach(p => { if (p.isBot) applyBotAI(p, phys); });

    players.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.93; p.vy *= 0.93;
      if (Math.abs(p.vx) < 0.02) p.vx = 0; if (Math.abs(p.vy) < 0.02) p.vy = 0;
      const r = p.radius;
      if (p.x < r - PHYS.RUNOFF) { p.x = r - PHYS.RUNOFF; p.vx *= -0.3; } if (p.x > field.w - r + PHYS.RUNOFF) { p.x = field.w - r + PHYS.RUNOFF; p.vx *= -0.3; }
      if (p.y < r - PHYS.RUNOFF) { p.y = r - PHYS.RUNOFF; p.vy *= -0.3; } if (p.y > field.h - r + PHYS.RUNOFF) { p.y = field.h - r + PHYS.RUNOFF; p.vy *= -0.3; }
    });

    if (phys.kickoffActive) {
      if (Date.now() > phys.kickoffDeadline) phys.kickoffActive = false;
      else {
        const restrictedTeam = phys.kickoffTeam === 'A' ? 'B' : 'A';
        const mid = field.w / 2;
        players.forEach(p => {
          if (p.team !== restrictedTeam) return;
          if (restrictedTeam === 'B') { if (p.x < mid + PHYS.KICKOFF_BARRIER_R) { p.x = mid + PHYS.KICKOFF_BARRIER_R; if (p.vx < 0) p.vx = 0; } }
          else { if (p.x > mid - PHYS.KICKOFF_BARRIER_R) { p.x = mid - PHYS.KICKOFF_BARRIER_R; if (p.vx > 0) p.vx = 0; } }
        });
      }
    }

    const goalTop = field.h / 2 - field.goalH / 2, goalBot = field.h / 2 + field.goalH / 2;
    if (!phys.netEnteringA && !phys.netEnteringB) {
      ball.x += ball.vx; ball.y += ball.vy;
      ball.vx *= PHYS.BALL_FRICTION; ball.vy *= PHYS.BALL_FRICTION;
      if (Math.hypot(ball.vx, ball.vy) < 0.03) { ball.vx = 0; ball.vy = 0; }
      const bspd = Math.hypot(ball.vx, ball.vy);
      if (bspd > PHYS.MAX_BALL_SPEED) { ball.vx = ball.vx / bspd * PHYS.MAX_BALL_SPEED; ball.vy = ball.vy / bspd * PHYS.MAX_BALL_SPEED; }
      if (ball.x < ball.radius) {
        if (ball.y > goalTop && ball.y < goalBot) {
          if (ball.x <= -ball.radius) { phys.netEnteringB = true; setTimeout(() => { if (phys.netEnteringB) scoreGoalPhys(room, 'B'); }, 120); }
        } else { ball.x = ball.radius; ball.vx *= -PHYS.WALL_RESTITUTION; }
      }
      if (ball.x > field.w - ball.radius) {
        if (ball.y > goalTop && ball.y < goalBot) {
          if (ball.x >= field.w + ball.radius) { phys.netEnteringA = true; setTimeout(() => { if (phys.netEnteringA) scoreGoalPhys(room, 'A'); }, 120); }
        } else { ball.x = field.w - ball.radius; ball.vx *= -PHYS.WALL_RESTITUTION; }
      }
      if (ball.y < ball.radius) { ball.y = ball.radius; ball.vy *= -PHYS.WALL_RESTITUTION; }
      if (ball.y > field.h - ball.radius) { ball.y = field.h - ball.radius; ball.vy *= -PHYS.WALL_RESTITUTION; }
    } else {
      ball.x += ball.vx * 0.6; ball.y += ball.vy * 0.4;
      if (phys.netEnteringB) ball.x = Math.max(ball.x, -PHYS.NET_DEPTH + 2);
      if (phys.netEnteringA) ball.x = Math.min(ball.x, field.w + PHYS.NET_DEPTH - 2);
    }

    players.forEach(p => {
      const dx = ball.x - p.x, dy = ball.y - p.y, dist = Math.hypot(dx, dy);
      const minD = p.radius + ball.radius;
      if (dist < minD && dist > 0.01 && !phys.netEnteringA && !phys.netEnteringB) {
        const nx = dx / dist, ny = dy / dist, overlap = minD - dist;
        ball.x += nx * overlap; ball.y += ny * overlap;
        const rvx = p.vx - ball.vx, rvy = p.vy - ball.vy;
        const rvn = rvx * nx + rvy * ny;
        if (rvn > 0) {
          const j = (1 + PHYS.CONTACT_RESTITUTION) * rvn / (PHYS.PLAYER_INV_MASS + PHYS.BALL_INV_MASS);
          ball.vx += j * PHYS.BALL_INV_MASS * nx; ball.vy += j * PHYS.BALL_INV_MASS * ny;
          p.vx -= j * PHYS.PLAYER_INV_MASS * nx; p.vy -= j * PHYS.PLAYER_INV_MASS * ny;
        }
        const incomingSpeed = -(ball.vx * nx + ball.vy * ny);
        if (incomingSpeed > 0) {
          const absorb = Math.min(0.35, statOf(p, 'control') * 0.05);
          ball.vx += nx * incomingSpeed * absorb; ball.vy += ny * incomingSpeed * absorb;
        }
        phys.lastToucherId = p.netId;
      }
    });
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i], b = players[j];
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
        const minD = a.radius + b.radius;
        if (dist < minD && dist > 0.01) {
          const nx = dx / dist, ny = dy / dist, overlap = (minD - dist) / 2;
          const weightA = 1 + statOf(a, 'power') * 0.08, weightB = 1 + statOf(b, 'power') * 0.08;
          a.x -= nx * overlap * (weightB / (weightA + weightB)) * 2; a.y -= ny * overlap * (weightB / (weightA + weightB)) * 2;
          b.x += nx * overlap * (weightA / (weightA + weightB)) * 2; b.y += ny * overlap * (weightA / (weightA + weightB)) * 2;
          [a, b].forEach(pl => {
            const rr = pl.radius;
            pl.x = Math.max(rr - PHYS.RUNOFF, Math.min(field.w - rr + PHYS.RUNOFF, pl.x));
            pl.y = Math.max(rr - PHYS.RUNOFF, Math.min(field.h - rr + PHYS.RUNOFF, pl.y));
          });
        }
      }
    }
    if (phys.ballFrozen) { ball.x = field.w / 2; ball.y = field.h / 2; ball.vx = 0; ball.vy = 0; }

    const now = Date.now();
    const dt = (now - phys.lastTickAt) / 1000;
    phys.lastTickAt = now;
    if (!phys.playersFrozen && !phys.ballFrozen) {
      phys.matchTimeLeft -= dt;
      if (phys.matchTimeLeft <= 0) { phys.matchTimeLeft = 0; endRoomMatch(room); return; }
    }
  }

  // The single, global tick loop - defined once here (not per-connection).
  function startLoop(rooms) {
    setInterval(() => {
      Object.values(rooms).forEach(room => {
        if (!room.phys) return;
        tickRoomPhysics(room);
        if (room.phys) io.to(room.code).emit('physicsState', serializePhysics(room));
      });
    }, PHYS.TICK_MS);
  }

  function setInput(socketId, snap) {
    roomInputs[socketId] = {
      mvx: Number(snap && snap.mvx) || 0,
      mvy: Number(snap && snap.mvy) || 0,
      kick: !!(snap && snap.kick),
      power: !!(snap && snap.power),
      sprint: !!(snap && snap.sprint)
    };
  }
  function clearInput(socketId) { delete roomInputs[socketId]; }

  return { initRoomPhysics, startLoop, setInput, clearInput, serializePhysics, endRoomMatch, updatePlayerNetId, MODES, PHYS };
}

module.exports = { createPhysics, MODES, PHYS };
