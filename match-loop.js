// ============================================================================
// match-loop.js - Match loop, physics prediction, networking sync
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= MATCH LOOP ============================= */
let rafId=null; let lastTs=0; let accumMs=0;
let myInputIntervalPub=null;
let hostInputsCache = {};

function startMatch({mode,type}){
  currentMode = mode; matchType = type; matchMode = mode;
  initField(mode);
  spawnPlayers(mode, 'A', selectedNumber);
  startKickoff('A'); // human (always team A vs bots) always gets the ball first, like choosing to kick off
  score = {A:0,B:0};
  matchTimeLeft = matchDurationSec;
  humanGoalsScored = 0;
  humanAssists = 0;
  matchActive = true; matchPaused=false; ballFrozen=false;
  document.getElementById('hud').classList.add('active');
  document.getElementById('btnFullscreen').style.display='none';
  document.getElementById('btnMenuRoster').style.display = 'block';
  document.getElementById('btnChatToggle').style.display = 'block';
  applyControlModeUI();
  resizeCanvas();
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  updateHud();
  camX = window.__humanPlayer.x; camY = window.__humanPlayer.y;
  if(matchTimer) clearInterval(matchTimer);
  playersFrozen = true; botsFrozen = true;
  startCountdown(3, ()=>{
    playersFrozen=false; botsFrozen=false;
    document.getElementById('goalBanner').classList.remove('show');
    playSfx('whistle');
  });
  matchTimer = setInterval(()=>{
    if(!matchActive || matchPaused) return;
    matchTimeLeft--; updateHud();
    if(matchTimeLeft<=0) endMatch();
  },1000);
  lastTs = performance.now(); accumMs=0;
  if(rafId) cancelAnimationFrame(rafId);
  loop();
  setTimeout(()=>{ startAmbience(); }, 150);
}

async function beginMultiMatch(room){
  window.__humanPlayer = null;
  practiceMode = false;
  currentMode = room.mode; matchType='multi'; matchMode = room.mode;
  initField(room.mode);
  // Physics now lives entirely on the server. Every client - regardless of
  // join order or host status - starts with an empty placeholder and just
  // waits for the first 'physicsState' broadcast to populate everything.
  players = []; const fd = fieldDimsFor(room.mode); ball = { x: fd.w/2, y: fd.h/2, vx:0, vy:0, radius:BALL_RADIUS };
  score = {A:0,B:0}; matchTimeLeft = matchDurationSec; humanGoalsScored=0; humanAssists=0;
  matchActive = true; matchPaused = true; ballFrozen=false; // waiting on the server's first tick
  document.getElementById('hud').classList.add('active');
  document.getElementById('btnFullscreen').style.display='none';
  document.getElementById('btnMenuRoster').style.display = 'block';
  document.getElementById('btnChatToggle').style.display = 'block';
  applyControlModeUI();
  resizeCanvas();
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  updateHud();
  camX = field.w/2; camY = field.h/2;
  if(myInputIntervalPub) clearInterval(myInputIntervalPub);
  myInputIntervalPub = setInterval(sendMyInput, 50);
  lastTs = performance.now(); accumMs=0;
  if(rafId) cancelAnimationFrame(rafId);
  loop();
  setTimeout(()=>{ startAmbience(); }, 150);
}

// Every client just reports its own controls - the server is the only place
// that actually simulates anything, so there is nothing for two clients to
// ever disagree about.
function sendMyInput(){
  if(!(matchType==='multi' && matchActive && roomCode)) return;
  socket.emit('input', captureLocalInput());
}
socket.on('physicsState', (st)=>{
  if(practiceMode) return; // solo practice runs its own local physics - never let server state clobber it mid-transition
  if(!(matchType==='multi' && matchActive)) return;
  field = st.field;
  const prevHuman = window.__humanPlayer; // keep our own predicted x/y across updates - see reconcileHuman()
  const prevPlayersById = {}; (players||[]).forEach(p=>{ prevPlayersById[p.id] = p; });
  const prevBall = ball;
  // Ball: keep whatever we were already rendering as the current x/y, and just move the TARGET -
  // per-frame smoothing (below, in loop()) eases toward it instead of snapping every 50ms tick.
  ball = { x: prevBall? prevBall.x : st.ball.x, y: prevBall? prevBall.y : st.ball.y,
           targetX: st.ball.x, targetY: st.ball.y, vx:0, vy:0, radius:BALL_RADIUS };
  players = st.players.map(p=>{
    const isHuman = p.id===myId;
    const merged = {...p, netId:p.id, radius:PLAYER_RADIUS, isHuman};
    if(isHuman && prevHuman){
      // don't hard-snap our own on-screen position - that's what caused the "sluggish" feel
      // combined with the round-trip delay. Predicted x/y stays as visual truth; we just steer it
      // toward the server's real x/y (serverX/Y) every predicted frame in predictLocalMovement().
      merged.x = prevHuman.x; merged.y = prevHuman.y;
      merged.vx = prevHuman.vx; merged.vy = prevHuman.vy;
      merged.sprintT = prevHuman.sprintT||0; merged.sprintCd = prevHuman.sprintCd||0;
    } else if(!isHuman){
      // opponents/teammates: same idea as the ball - keep current rendered position, move the target,
      // and let the per-frame smoother in loop() ease toward it. Without this every other player on
      // the pitch visibly teleported in little steps 20 times a second.
      const prev = prevPlayersById[p.id];
      merged.x = prev ? prev.x : p.x;
      merged.y = prev ? prev.y : p.y;
    }
    merged.targetX = p.x; merged.targetY = p.y;
    merged.serverX = p.x; merged.serverY = p.y;
    return merged;
  });
  window.__humanPlayer = players.find(p=>p.isHuman) || null;
  score = st.score; matchTimeLeft = st.matchTimeLeft; matchPaused = st.playersFrozen;
  kickoffActive = st.kickoffActive; kickoffTeam = st.kickoffTeam;
  if(st.kickoffActive) kickoffDeadline = Date.now() + st.kickoffMsLeft;
  updateHud();
  const me = players.find(p=>p.id===myId);
  if(me){ camX += (me.x-camX)*0.2; camY += (me.y-camY)*0.2; }
  else if(!window.__lastSelfWarnAt || Date.now()-window.__lastSelfWarnAt > 3000){
    window.__lastSelfWarnAt = Date.now();
    console.warn('[EgoBall] Could not find myself in physicsState.', { myId, receivedIds: players.map(p=>p.id), socketId: socket.id });
  }
});

// Purely visual movement prediction for our OWN player during a multiplayer match - it makes our
// own on-screen movement feel instant instead of waiting a full network round-trip. It never
// touches the ball, kicks, or scoring - those effects only ever appear once the server's real
// physicsState arrives, so nothing here can be used to cheat.
function predictLocalMovement(p, snap){
  if(playersFrozen){ p.vx=0; p.vy=0; return; }
  if(p.sprintCd>0) p.sprintCd -= 16;
  const len = Math.hypot(snap.mvx,snap.mvy);
  let targetSpeed = PLAYER_SPEED + statVal(p,'speed')*SPEED_PER_LEVEL;
  if(snap.sprint && p.sprintCd<=0){ p.sprintT = SPRINT_DURATION_MS; p.sprintCd = SPRINT_COOLDOWN_MS; }
  if(p.sprintT>0){ targetSpeed *= SPRINT_MULT; p.sprintT -= 16; }
  const moveLerp = snap.kick ? ACCEL_LERP*0.72 : ACCEL_LERP;
  if(len>0.08){
    const nx=snap.mvx/(len||1), ny=snap.mvy/(len||1);
    const dvx=nx*targetSpeed, dvy=ny*targetSpeed;
    p.vx += (dvx-p.vx)*moveLerp; p.vy += (dvy-p.vy)*moveLerp;
    p.facing = Math.atan2(snap.mvy,snap.mvx);
  } else { p.vx *= FRICTION_IDLE; p.vy *= FRICTION_IDLE; }
  p.x += p.vx; p.y += p.vy;
  const r = p.radius||PLAYER_RADIUS;
  p.x = Math.max(r-RUNOFF, Math.min(field.w-r+RUNOFF, p.x));
  p.y = Math.max(r-RUNOFF, Math.min(field.h-r+RUNOFF, p.y));
  // Gently reconcile toward the server's real position rather than fighting it. A small
  // steady pull keeps us honest over time; a much bigger pull kicks in only if we've drifted far
  // from the server's truth (e.g. we got shoved by another player or the ball - something our own
  // local prediction has no way to know about in advance).
  if(p.serverX!=null){
    const dx=p.serverX-p.x, dy=p.serverY-p.y;
    const drift = Math.hypot(dx,dy);
    const pull = drift>60 ? 0.35 : 0.06;
    p.x += dx*pull; p.y += dy*pull;
  }
}
socket.on('matchEvent', (evt)=>{
  if(practiceMode) return;
  if(matchType!=='multi') return;
  const banner = document.getElementById('goalBanner');
  if(evt.type==='goal'){
    playSfx('goal'); playCrowdCheer();
    const human = window.__humanPlayer;
    let announceKey='oppScored';
    if(human && evt.scorerId===myId){ humanGoalsScored++; announceKey='youScored'; }
    else if(human && evt.team===human.team){ announceKey='teamScored'; }
    banner.textContent = t(announceKey);
    banner.classList.add('show');
    score = evt.score; updateHud();
  } else if(evt.type==='countdown'){
    banner.textContent = evt.n>0 ? String(evt.n) : t('go');
    banner.classList.add('show');
  } else if(evt.type==='kickoffGo'){
    banner.classList.remove('show');
    playSfx('whistle');
  } else if(evt.type==='end'){
    score = evt.score; endMatch();
  }
});

function updateHud(){
  document.getElementById('scoreA').textContent = practiceMode? '—' : score.A;
  document.getElementById('scoreB').textContent = practiceMode? '—' : score.B;
  if(practiceMode){ document.getElementById('hudTimer').textContent = LANG==='uz'?'MASHQ':LANG==='ru'?'ТРЕНИРОВКА':'PRACTICE'; return; }
  const m = Math.floor(Math.max(0,matchTimeLeft)/60), s = Math.max(0,matchTimeLeft)%60;
  document.getElementById('hudTimer').textContent = m+':'+String(s).padStart(2,'0');
}
document.getElementById('hudExit').addEventListener('click', ()=> quitMatch());
function stopAllMatchIntervals(){
  [matchTimer,myInputIntervalPub].forEach(i=>{ if(i) clearInterval(i); });
  matchTimer=myInputIntervalPub=null;
}
function quitMatch(){
  if(matchType==='multi' && roomCode){ socket.emit('leaveRoom'); }
  matchActive=false; stopAllMatchIntervals(); if(rafId) cancelAnimationFrame(rafId);
  roomCode=null; myId=null; isHost=false; mySpectator=false;
  stopAmbience();
  document.getElementById('hud').classList.remove('active');
  document.getElementById('btnFullscreen').style.display='flex';
  document.getElementById('mobileControls').classList.remove('active');
  document.getElementById('rosterOverlay').classList.remove('show');
  document.getElementById('chatOverlay').classList.remove('show');
  document.getElementById('goalBanner').classList.remove('show');
  show('screen-main');
}

const PHYSICS_HZ = 60;
const PHYSICS_TICK_MS = 1000/PHYSICS_HZ;
function loop(ts){
  rafId = requestAnimationFrame(loop);
  if(!matchActive) return;
  const now = ts||performance.now();
  let dt = now-lastTs;
  lastTs = now;
  if(dt>250) dt=250; // clamp huge gaps (tab was backgrounded) to avoid a burst of catch-up ticks
  accumMs += dt;
  let ticks=0;
  if(matchType==='multi'){
    // Server remains fully authoritative for the ball, kicks, collisions and scoring - none of
    // that is simulated here. This just predicts OUR OWN player's movement locally every frame
    // so pressing a direction feels instant, instead of waiting a full network round-trip to see
    // yourself move (that round-trip delay was the "sluggish" feeling compared to Bots Game).
    while(accumMs>=PHYSICS_TICK_MS && ticks<8){
      const human = window.__humanPlayer;
      if(human && !mySpectator) predictLocalMovement(human, captureLocalInput());
      accumMs -= PHYSICS_TICK_MS;
      ticks++;
    }
    const SMOOTH = 0.28;
    if(ball && ball.targetX!=null){ ball.x += (ball.targetX-ball.x)*SMOOTH; ball.y += (ball.targetY-ball.y)*SMOOTH; }
    (players||[]).forEach(p=>{
      if(p.isHuman || p.targetX==null) return; // human already has its own reconciliation pull in predictLocalMovement
      p.x += (p.targetX-p.x)*SMOOTH; p.y += (p.targetY-p.y)*SMOOTH;
    });
    render();
    return;
  }
  while(accumMs>=PHYSICS_TICK_MS && ticks<8){
    if(!matchPaused) step();
    accumMs -= PHYSICS_TICK_MS;
    ticks++;
  }
  render();
}

function step(){
  const human = window.__humanPlayer;
  players.forEach(p=>{
    if(p.isBot) return;
    let snap;
    if(p.isHuman) snap = captureLocalInput();
    else if(p.netId) snap = hostInputsCache[p.netId] || {mvx:0,mvy:0,kick:false,power:false,sprint:false};
    else snap = {mvx:0,mvy:0,kick:false,power:false,sprint:false};
    applyPlayerControl(p, snap);
  });

  const teamSizeCount = {};
  players.forEach(p=>{ teamSizeCount[p.team]=(teamSizeCount[p.team]||0)+1; });

  players.forEach(p=>{
    if(!p.isBot) return;
    if(playersFrozen || botsFrozen){ p.vx=0; p.vy=0; return; }
    if(p.kickCd>0) p.kickCd -= 16;
    const goalX = p.team==='A'? field.w : 0;
    const distBall = Math.hypot(ball.x-p.x, ball.y-p.y);
    const teammates = players.filter(o=>o!==p && o.team===p.team);
    const teammatesCloser = teammates.some(o=> Math.hypot(ball.x-o.x,ball.y-o.y) < distBall);
    const teamArr = players.filter(pp=>pp.team===p.team);
    const laneIndex = teamArr.indexOf(p);
    const laneY = field.h/(teamArr.length+1)*(laneIndex+1);
    let tx,ty;
    if(!teammatesCloser){
      // intercept where the ball is heading, not where it currently is - stops the bot from
      // riding glued to the ball like a magnet and makes chasing look natural
      const leadTime = 6;
      const predX = Math.max(24, Math.min(field.w-24, ball.x+ball.vx*leadTime));
      const predY = Math.max(24, Math.min(field.h-24, ball.y+ball.vy*leadTime));
      const approachOffset = p.radius+ball.radius-3;
      tx = predX + (p.team==='A'? -approachOffset : approachOffset);
      ty = predY;
    } else {
      const homeX = p.team==='A'? field.w*(0.24+0.10*(laneIndex%3)) : field.w*(0.76-0.10*(laneIndex%3));
      tx = homeX + (ball.x-field.w/2)*0.22;
      ty = laneY*0.55 + ball.y*0.35 + (field.h/2)*0.10;
    }
    const dx=tx-p.x, dy=ty-p.y; const d=Math.hypot(dx,dy);
    let botSpeed = BOT_SPEED;
    const slowRadius=40;
    if(d<slowRadius) botSpeed *= Math.max(0.25, d/slowRadius);
    if(d>2){
      const nx=dx/d, ny=dy/d;
      p.vx += (nx*botSpeed-p.vx)*BOT_ACCEL_LERP; p.vy += (ny*botSpeed-p.vy)*BOT_ACCEL_LERP;
    } else { p.vx*=0.85; p.vy*=0.85; }
    // separation from teammates to avoid clumping
    teammates.forEach(o=>{
      const ddx=p.x-o.x, ddy=p.y-o.y, dd=Math.hypot(ddx,ddy);
      const minSep = p.radius*2.6;
      if(dd<minSep && dd>0.01){ const push=(minSep-dd)/minSep; p.vx+=(ddx/dd)*push*1.4; p.vy+=(ddy/dd)*push*1.4; }
    });
    if(distBall < p.radius+ball.radius+KICK_RANGE && p.kickCd<=0){
      const goalDist = Math.hypot(goalX-p.x, (field.h/2)-p.y);
      const opp = players.filter(o=>o.team!==p.team);
      // is an opponent standing right in the direct lane between me and the goal?
      const toGoalAng = Math.atan2((field.h/2)-p.y, goalX-p.x);
      const blocker = opp.find(o=>{
        const dOpp = Math.hypot(o.x-p.x,o.y-p.y);
        if(dOpp>95) return false;
        const toOppAng = Math.atan2(o.y-p.y, o.x-p.x);
        let diff = Math.abs(toGoalAng-toOppAng); if(diff>Math.PI) diff = Math.PI*2-diff;
        return diff < 0.55;
      });
      let targetAng;
      if(blocker && Math.random()<0.65){
        // banked pass off the sideline, like a hockey give-and-go off the boards - slips the ball
        // past the defender instead of holding it up in front of them
        const aimX = goalX, aimY = field.h/2 + (Math.random()-0.5)*70;
        const useTopWall = p.y < field.h/2;
        const mirrorY = useTopWall ? -aimY : (2*field.h-aimY);
        targetAng = Math.atan2(mirrorY-p.y, aimX-p.x);
      } else {
        let bestMate=null,bestScore=-1;
        teammates.forEach(m=>{
          const advancement = p.team==='A'? (m.x-p.x) : (p.x-m.x);
          if(advancement>30){
            const openness = opp.length? Math.min(...opp.map(o=>Math.hypot(o.x-m.x,o.y-m.y))) : 999;
            const scoreV = advancement + openness*0.5;
            if(scoreV>bestScore){ bestScore=scoreV; bestMate=m; }
          }
        });
        if(goalDist>field.w*0.42 && bestMate && Math.random()<0.55){
          targetAng = Math.atan2(bestMate.y-p.y, bestMate.x-p.x);
        } else {
          targetAng = Math.atan2((field.h/2 + (Math.random()-0.5)*70)-p.y, goalX-p.x);
        }
      }
      // a bot can PLAN to send the ball wherever it wants, but the actual kick angle it's
      // physically capable of producing is limited to a cone around the ball's real approach
      // angle to its body - no more "ball comes in straight, snaps off sideways with no contact"
      const realAng = Math.atan2(ball.y-p.y, ball.x-p.x);
      let angDiff = targetAng - realAng;
      angDiff = Math.atan2(Math.sin(angDiff), Math.cos(angDiff));
      angDiff = Math.max(-BOT_KICK_ANGLE_CONE, Math.min(BOT_KICK_ANGLE_CONE, angDiff));
      targetAng = realAng + angDiff;
      const power = BOT_KICK_POWER;
      ball.vx += Math.cos(targetAng)*power; ball.vy += Math.sin(targetAng)*power;
      p.kickCd = BOT_KICK_COOLDOWN_MS;
      p.kickFlashUntil = Date.now()+140;
      touchBall(p);
      if(human && Math.hypot(p.x-human.x,p.y-human.y) < 260) playSfx('kick');
    }
  });

  players.forEach(p=>{
    p.x+=p.vx; p.y+=p.vy;
    p.vx*=0.93; p.vy*=0.93;
    if(Math.abs(p.vx)<0.02) p.vx=0; if(Math.abs(p.vy)<0.02) p.vy=0;
    const r=p.radius;
    // players may run past the painted sideline into the run-off strip (like a real stadium),
    // but the RUNOFF outer wall still stops them leaving the pitch surrounds entirely
    if(p.x<r-RUNOFF){p.x=r-RUNOFF;p.vx*=-0.3;} if(p.x>field.w-r+RUNOFF){p.x=field.w-r+RUNOFF;p.vx*=-0.3;}
    if(p.y<r-RUNOFF){p.y=r-RUNOFF;p.vy*=-0.3;} if(p.y>field.h-r+RUNOFF){p.y=field.h-r+RUNOFF;p.vy*=-0.3;}
  });

  if(kickoffActive){
    if(Date.now() > kickoffDeadline){ kickoffActive = false; }
    else {
      const restrictedTeam = kickoffTeam==='A' ? 'B' : 'A';
      const mid = field.w/2;
      players.forEach(p=>{
        if(p.team!==restrictedTeam) return;
        // barrier radius MUST match the glowing arc drawn in render() (KICKOFF_BARRIER_R) -
        // previously this used p.radius (~16px) while the visible arc was drawn at 95px,
        // so a restricted player's center could sit deep inside the glowing arc while still
        // technically obeying the (much smaller, invisible) real constraint. Now what you see
        // glowing is exactly where the wall actually is.
        if(restrictedTeam==='B'){ if(p.x < mid+KICKOFF_BARRIER_R){ p.x = mid+KICKOFF_BARRIER_R; if(p.vx<0) p.vx=0; } }
        else { if(p.x > mid-KICKOFF_BARRIER_R){ p.x = mid-KICKOFF_BARRIER_R; if(p.vx>0) p.vx=0; } }
      });
    }
  }

  const goalTop = field.h/2-field.goalH/2, goalBot = field.h/2+field.goalH/2;
  if(!netEnteringA && !netEnteringB){
    ball.x+=ball.vx; ball.y+=ball.vy;
    const moveSpd = Math.hypot(ball.vx,ball.vy);
    if(moveSpd>0.05){
      // a rolling ball spins around an axis perpendicular to its travel direction -
      // angular speed = linear speed / radius, exactly like a real rolling sphere
      ballRotAxisX = -ball.vy/moveSpd; ballRotAxisY = ball.vx/moveSpd;
      ballRotation += moveSpd/ball.radius;
    }
    ball.vx*=BALL_FRICTION; ball.vy*=BALL_FRICTION;
    if(Math.hypot(ball.vx,ball.vy) < 0.03){ ball.vx=0; ball.vy=0; }
    const maxBallSpeed=8; const bspd=Math.hypot(ball.vx,ball.vy);
    if(bspd>maxBallSpeed){ ball.vx=ball.vx/bspd*maxBallSpeed; ball.vy=ball.vy/bspd*maxBallSpeed; }

    // corners are a straight rectangle (matches the drawn boundary lines), so the ball is allowed to
    // travel all the way into the true corner - the per-axis wall bounce below handles that correctly
    // on its own; there used to be an extra circular deflection zone here that kept the ball ~48px
    // away from every corner, which is exactly what was reported as "ball can't reach the corners"
    if(ball.x<ball.radius){
      if(!practiceMode && ball.y>goalTop && ball.y<goalBot){
        // inside the goal mouth: let it keep traveling (no bounce) until the WHOLE ball has crossed the line
        if(ball.x <= -ball.radius){ netEnteringB=true; setTimeout(()=>{ if(netEnteringB){ scoreGoal('B'); } }, 120); }
      } else { ball.x=ball.radius; ball.vx*=-WALL_RESTITUTION; throttledWallSfx(); }
    }
    if(ball.x>field.w-ball.radius){
      if(!practiceMode && ball.y>goalTop && ball.y<goalBot){
        if(ball.x >= field.w+ball.radius){ netEnteringA=true; setTimeout(()=>{ if(netEnteringA){ scoreGoal('A'); } }, 120); }
      } else { ball.x=field.w-ball.radius; ball.vx*=-WALL_RESTITUTION; throttledWallSfx(); }
    }
    if(ball.y<ball.radius){ ball.y=ball.radius; ball.vy*=-WALL_RESTITUTION; throttledWallSfx(); }
    if(ball.y>field.h-ball.radius){ ball.y=field.h-ball.radius; ball.vy*=-WALL_RESTITUTION; throttledWallSfx(); }
  } else {
    // coasting into the net (cosmetic): keep moving, clamp inside net box
    ball.x += ball.vx*0.6; ball.y += ball.vy*0.4;
    if(netEnteringB) ball.x = Math.max(ball.x, -NET_DEPTH+2);
    if(netEnteringA) ball.x = Math.min(ball.x, field.w+NET_DEPTH-2);
  }

  const PLAYER_INV_MASS = 0.15, BALL_INV_MASS = 0.85; // players barely get knocked back from touching the ball - was skating too much
  const CONTACT_RESTITUTION = 0.82; // lively billiard-style bounce
  players.forEach(p=>{
    const dx=ball.x-p.x, dy=ball.y-p.y, dist=Math.hypot(dx,dy);
    const minD = p.radius+ball.radius;
    if(dist<minD && dist>0.01 && !netEnteringA && !netEnteringB){
      const nx=dx/dist, ny=dy/dist;
      const overlap = minD-dist;
      // pure geometric separation - never a pull/stick, just push the overlap apart
      ball.x += nx*overlap; ball.y += ny*overlap;
      // real elastic collision (billiard physics): the ball's new velocity depends ONLY on the
      // relative velocity and mass ratio at the instant of contact - nothing here "holds" or
      // "carries" the ball, whether or not Kick is pressed. Touch it while moving and it bounces
      // off cleanly, exactly like a cue ball striking an object ball.
      const rvx = p.vx-ball.vx, rvy = p.vy-ball.vy;
      const rvn = rvx*nx + rvy*ny;
      if(rvn>0){
        const j = (1+CONTACT_RESTITUTION)*rvn / (PLAYER_INV_MASS+BALL_INV_MASS);
        ball.vx += j*BALL_INV_MASS*nx; ball.vy += j*BALL_INV_MASS*ny;
        p.vx -= j*PLAYER_INV_MASS*nx; p.vy -= j*PLAYER_INV_MASS*ny;
      }
      // control stat = better first touch: slightly absorbs an incoming fast ball's rebound instead
      // of it bouncing straight off - still a one-time absorption at contact, not a hold
      const incomingSpeed = -(ball.vx*nx+ball.vy*ny);
      if(incomingSpeed>0){
        const absorb = Math.min(0.35, statVal(p,'control')*0.05);
        ball.vx += nx*incomingSpeed*absorb; ball.vy += ny*incomingSpeed*absorb;
      }
      touchBall(p);
    }
  });
  for(let i=0;i<players.length;i++){
    for(let j=i+1;j<players.length;j++){
      const a=players[i], b=players[j];
      const dx=b.x-a.x, dy=b.y-a.y, dist=Math.hypot(dx,dy);
      const minD=a.radius+b.radius;
      if(dist<minD && dist>0.01){
        const nx=dx/dist, ny=dy/dist, overlap=(minD-dist)/2;
        const weightA = 1+statVal(a,'power')*0.08, weightB = 1+statVal(b,'power')*0.08;
        a.x -= nx*overlap*(weightB/(weightA+weightB))*2; a.y -= ny*overlap*(weightB/(weightA+weightB))*2;
        b.x += nx*overlap*(weightA/(weightA+weightB))*2; b.y += ny*overlap*(weightA/(weightA+weightB))*2;
        // even if the shove happens right at the touchline, neither player gets pushed
        // past the true stadium wall - a blocking player can never be knocked out of the ground
        [a,b].forEach(pl=>{
          const rr=pl.radius;
          pl.x = Math.max(rr-RUNOFF, Math.min(field.w-rr+RUNOFF, pl.x));
          pl.y = Math.max(rr-RUNOFF, Math.min(field.h-rr+RUNOFF, pl.y));
        });
      }
    }
  }

  if(human){ camX += (human.x-camX)*0.12; camY += (human.y-camY)*0.12; }

  if(ballFrozen){ ball.x=field.w/2; ball.y=field.h/2; ball.vx=0; ball.vy=0; }
}

function scoreGoal(team){
  netEnteringA=false; netEnteringB=false;
  score[team]++;
  const human = window.__humanPlayer;
  let announceKey='oppScored';
  if(lastToucher===human && human && human.team===team){ humanGoalsScored++; announceKey='youScored'; }
  else if(human && human.team===team){ announceKey='teamScored'; }
  if(secondLastToucher===human && human && secondLastToucher!==lastToucher && human.team===team){ humanAssists++; }
  if(lastToucher && lastToucher.team===team && lastToucher.auraId){
    lastToucher.auraUntil = Date.now() + AURA_GOAL_DURATION_MS;
  }
  updateHud();
  playSfx('goal');
  playCrowdCheer();
  const banner = document.getElementById('goalBanner');
  banner.textContent = t(announceKey);
  banner.classList.add('show');
  ballFrozen = true;
  botsFrozen = true; // bots stand down immediately - the ball is dead, nothing to chase
  ball.x = field.w/2; ball.y = field.h/2; ball.vx=0; ball.vy=0;
  setTimeout(()=>{
    // 5s of free celebration time are over
    if(score.A>=matchWinGoals || score.B>=matchWinGoals){ ballFrozen=false; botsFrozen=false; endMatch(); return; }
    // send every player back to their original kickoff spot, then hold everyone (including the human) still for the countdown
    startKickoff(team==='A' ? 'B' : 'A'); // the team that conceded restarts with the ball, like real football
    playersFrozen = true;
    startCountdown(3, ()=>{ ballFrozen=false; playersFrozen=false; botsFrozen=false; banner.classList.remove('show'); playSfx('whistle'); });
  }, 5000);
}
function startCountdown(n, done){
  const banner = document.getElementById('goalBanner');
  if(n<=0){ done(); return; }
  banner.textContent = String(n); banner.classList.add('show');
  setTimeout(()=>startCountdown(n-1, done), 1000);
}

async function endMatch(){
  matchActive=false; matchPaused=false; ballFrozen=false;
  stopAllMatchIntervals();
  stopAmbience();
  document.getElementById('goalBanner').classList.remove('show');
  playSfx('whistle');
  const humanTeam = window.__humanPlayer ? window.__humanPlayer.team : 'A';
  const won = score[humanTeam] > score[humanTeam==='A'?'B':'A'];
  const lost = score[humanTeam] < score[humanTeam==='A'?'B':'A'];
  // NOTE: match end/local-room reform is now decided entirely server-side by
  // the authoritative physics loop (endRoomMatch -> reformLocalMatch), so we
  // no longer report it from the client.
  let base;
  if(won) base = 12+Math.floor(Math.random()*4);
  else if(lost) base = 2+Math.floor(Math.random()*2);
  else base = 6+Math.floor(Math.random()*3);
  const total = base + humanGoalsScored*20;
  const expGain = matchExpGain(humanGoalsScored, humanAssists, won);
  let cupGain = 0, cupLine = null;
  if(account){
    account.coins += total;
    account.totalGoals = (account.totalGoals||0) + humanGoalsScored;
    account.totalAssists = (account.totalAssists||0) + humanAssists;
    if(won) account.totalWins = (account.totalWins||0) + 1;
    const levelBeforeGain = account.level||1;
    applyExpGain(account, expGain);
    if((account.level||1) > levelBeforeGain) showLevelUpAnim(account.level);
    if(matchType==='multi'){
      const before = getRankInfo(account.cups||0);
      cupGain = matchCupGain(humanGoalsScored, won, before.tierIndex);
      account.cups = Math.max(0, (account.cups||0) + cupGain);
      const after = getRankInfo(account.cups);
      account.highestTierReached = Math.max(account.highestTierReached||0, after.tierIndex);
    }
    await persistAccount();
    renderProfileBadge();
  }
  document.getElementById('endResult').textContent = won? t('win') : lost? t('lose') : t('draw');
  document.getElementById('endResult').className = 'result '+(won?'win':lost?'lose':'draw');
  document.getElementById('endScoreline').textContent = score.A+' : '+score.B;
  document.getElementById('endCoins').textContent = '+'+total;
  document.getElementById('endExp').textContent = '+'+expGain+' EXP';
  const cupLineEl = document.getElementById('endCupLine');
  if(matchType==='multi'){
    cupLineEl.style.display='flex';
    document.getElementById('endCup').textContent = (cupGain>=0?'+':'')+cupGain+' Cup';
    document.getElementById('endCup').parentElement.style.color = cupGain<0 ? '#ff6b6b' : 'var(--gold2)';
  } else {
    cupLineEl.style.display='none';
  }
  document.getElementById('hud').classList.remove('active');
  document.getElementById('btnFullscreen').style.display='flex';
  document.getElementById('mobileControls').classList.remove('active');
  document.getElementById('rosterOverlay').classList.remove('show');
  document.getElementById('chatOverlay').classList.remove('show');
  updateCoinDisplays();
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  document.getElementById('screen-end').classList.remove('hidden');
}
function leaveMultiplayerRoomIfAny(){
  if(matchType==='multi' && roomCode){ socket.emit('leaveRoom'); }
  roomCode=null; myId=null; isHost=false; mySpectator=false;
}
document.getElementById('btnEndReplay').addEventListener('click', ()=>{
  if(matchType==='multi'){ leaveMultiplayerRoomIfAny(); show('screen-main'); return; }
  startMatch({mode:matchMode, type:matchType});
});
document.getElementById('btnEndExit').addEventListener('click', ()=>{ leaveMultiplayerRoomIfAny(); show('screen-main'); });

