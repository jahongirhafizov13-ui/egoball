// ============================================================================
// render-engine.js - Canvas setup + input capture
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= CANVAS ============================= */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
function resizeCanvas(){
  const targetH = settings.resolution || 1080;
  const scale = Math.min(1, targetH/1080);
  const dpr = Math.min(window.devicePixelRatio||1, 2) * scale;
  canvas.width = window.innerWidth*dpr;
  canvas.height = window.innerHeight*dpr;
  canvas.style.width = window.innerWidth+'px';
  canvas.style.height = window.innerHeight+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener('resize', resizeCanvas);

let matchActive = false, matchPaused=false, ballFrozen=false, playersFrozen=false, botsFrozen=false;
let ballRotation = 0, ballRotAxisX = 1, ballRotAxisY = 0; // tracks rolling spin for the 3D ball render
let field, players, ball, score, matchTimer, matchTimeLeft, matchType, matchMode, matchWinGoals=3, matchDurationSec=180;
let practiceMode = false; // local server, alone: physics runs, but no timer/goals - just kicking the ball around
// Kickoff possession rule: after a kickoff, the team WITHOUT the ball can't cross the halfway
// line into the other team's half until the ball is actually touched - or 10s pass, whichever
// comes first (stops someone just holding the ball forever to lock the opponent out).
let kickoffActive=false, kickoffTeam=null, kickoffDeadline=0;
const KICKOFF_BARRIER_R = 95; // single source of truth: physics enforcement and the glowing arc both use this
function startKickoff(possessionTeam){
  resetPositions();
  kickoffTeam = possessionTeam || (Math.random()<0.5?'A':'B');
  kickoffActive = true;
  kickoffDeadline = Date.now() + 10000;
}
let humanGoalsScored = 0;
let humanAssists = 0;
let lastToucher = null;
let secondLastToucher = null;
function touchBall(p){ if(lastToucher!==p){ secondLastToucher = lastToucher; } lastToucher = p; kickoffActive=false; }
let camX=0, camY=0;
let netEnteringA=false, netEnteringB=false;

/* ---- tuned constants (Haxball-ratio based: ball is lighter & less "frictiony" than the player,
   roughly player:ball mass 2:1, player damping 0.96 vs ball damping 0.99) ---- */
const PLAYER_SPEED = 2.0; // +1 across the board per feedback (was 1.0)
const SPEED_PER_LEVEL = 0.11;
const ACCEL_LERP = 0.25;
const FRICTION_IDLE = 0.92;
const BALL_FRICTION = 0.99; // ball keeps rolling longer than the player decelerates (Haxball ratio) - unchanged
const WALL_RESTITUTION = 0.74;
const KICK_RANGE = 3; // must be >= the bot's approach offset (3px) or bots line up perfectly and then
  // never actually cross into kicking distance - was 1, which caused bots to "stand next to the ball
  // forever without kicking." Still tight enough that nobody kicks from a visible gap.
const KICK_BASE = 2.0;
const KICK_POWER_BONUS = 0.28;
const POWER_KICK_COOLDOWN_MS = 8000;
const KICK_POWER_EXTRA = 7.0; // Power Kick itself left as-is per instruction
const KICK_COOLDOWN_MS = 300;
const SPRINT_MULT = 1.6;
const SPRINT_DURATION_MS = 300;
const SPRINT_COOLDOWN_MS = 4500;
const CORNER_RADIUS = 42;
const RUNOFF = 40;
const BALL_RADIUS = 6;
const PLAYER_RADIUS = 16;
const NET_DEPTH = 32;

/* ---- bot-only movement/kick tuning, deliberately separate from the player's numbers above
   so the two can be tuned independently going forward ---- */
const BOT_SPEED = 2.0; // was left at 1.0 after the player speed was bumped +1 - bots were literally
  // half the player's speed, which is why they couldn't catch the ball in time and shots came from
  // desperate/bad positions instead of a clean strike at goal
const BOT_ACCEL_LERP = 0.40;
const BOT_KICK_POWER = 2.8; // small bump so a clean shot actually threatens the goal
const BOT_KICK_COOLDOWN_MS = 240;
const BOT_KICK_ANGLE_CONE = 0.52; // ~30 degrees - a believable first-touch redirect, not a magnetic hand
  // toward a plan (bank shot / pass / goal) but the resulting angle is now clamped to within this
  // many radians of the ball's REAL angle-of-approach to the bot, so it can no longer whip the ball
  // off to some unrelated direction with no physical basis

function initField(modeKey){ const m = fieldDimsFor(modeKey); field = { w:m.w, h:m.h, goalH:m.goalH }; }
function statVal(p, key){ return (p.isHuman && account)? getStatsObj()[key] : 0; }

function drawMiniStar(ctx, cx, cy, radius, color){
  ctx.beginPath();
  for(let i=0;i<5;i++){
    const outerA = -Math.PI/2 + i*(Math.PI*2/5);
    const innerA = outerA + Math.PI/5;
    const ox = cx+Math.cos(outerA)*radius, oy = cy+Math.sin(outerA)*radius;
    const ix = cx+Math.cos(innerA)*radius*0.45, iy = cy+Math.sin(innerA)*radius*0.45;
    if(i===0) ctx.moveTo(ox,oy); else ctx.lineTo(ox,oy);
    ctx.lineTo(ix,iy);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function makePlayer(team,x,y){
  return { team,x,y,vx:0,vy:0, radius:PLAYER_RADIUS, isBot:true, isHuman:false, netId:null, num:0,
    color: team==='A' ? '#4fb0ff':'#ff6b6b', facing:0, sprintT:0, sprintCd:0, kickCd:0, powerCd:0, prevKick:false, prevPower:false, kickFlashUntil:0 };
}
function resetBall(){ ball = { x:field.w/2, y:field.h/2, vx:0, vy:0, radius:BALL_RADIUS }; netEnteringA=false; netEnteringB=false; }
function resetPositions(){
  players.forEach(p=>{
    const teamPlayers = players.filter(pp=>pp.team===p.team);
    const idx = teamPlayers.indexOf(p);
    const spacingY = field.h/(teamPlayers.length+1);
    p.x = p.team==='A'? field.w*0.25 : field.w*0.75;
    p.y = spacingY*(idx+1);
    p.vx=0;p.vy=0;
  });
  resetBall();
  lastToucher = null;
  secondLastToucher = null;
}

/* ---- bots-mode single player spawn ---- */
function spawnPlayers(modeKey, humanTeam, humanNum){
  const m = MODES[modeKey];
  players = [];
  const teamSize = m.teamSize;
  const spacingY = field.h/(teamSize+1);
  for(let i=0;i<teamSize;i++){
    const y = spacingY*(i+1);
    players.push(makePlayer('A', field.w*0.25, y));
    players.push(makePlayer('B', field.w*0.75, y));
  }
  players.forEach(p=>{ p.num = players.filter(pp=>pp.team===p.team).indexOf(p)+1; p.name = 'Bot '+p.num; });
  const humanSlot = players.find(p=>p.team===humanTeam);
  humanSlot.isBot=false; humanSlot.isHuman=true; humanSlot.num=humanNum||1;
  if(account) humanSlot.accentColor = COLORS[account.equippedColor];
  if(account) humanSlot.characterId = account.equippedCharacterId || null;
  if(account) humanSlot.auraId = account.equippedAura || null;
  if(account){ humanSlot.cups = account.cups||0; humanSlot.level = account.level||1; }
  humanSlot.name = playerDisplayName || (account? account.name : 'Player');
  window.__humanPlayer = humanSlot;
}

/* ---- multiplayer host spawn ---- */
function spawnPlayersMulti(room){
  const m = MODES[room.mode];
  const teamSize = m.teamSize;
  const activeA = room.players.filter(p=>p.team==='A' && !p.spectator);
  const activeB = room.players.filter(p=>p.team==='B' && !p.spectator);
  players = [];
  window.__roomRosterCache = room.players;
  function buildTeam(team, list){
    const spacingY = field.h/(teamSize+1);
    for(let i=0;i<teamSize;i++){
      const y = spacingY*(i+1);
      const x = team==='A'? field.w*0.25: field.w*0.75;
      const entry = list[i];
      const p = makePlayer(team,x,y);
      p.num = i+1;
      if(entry){
        p.isBot=false; p.netId = entry.id;
        if(entry.color) p.accentColor = entry.color;
      if(entry.characterId) p.characterId = entry.characterId;
        if(entry.auraId) p.auraId = entry.auraId;
        p.cups = entry.cups||0; p.level = entry.level||1; p.name = entry.name||'';
        if(entry.id===myId){ p.isHuman=true; if(account) p.accentColor = COLORS[account.equippedColor]; if(account) p.characterId = account.equippedCharacterId || null; if(account) p.auraId = account.equippedAura || null; if(account){ p.cups=account.cups||0; p.level=account.level||1; } window.__humanPlayer = p; }
      }
      players.push(p);
    }
  }
  buildTeam('A', activeA);
  buildTeam('B', activeB);
}

/* ---- local auto-balance arena spawn: real players only, no bot padding, grows/shrinks live ---- */
function spawnPlayersLocalArena(room){
  players = [];
  window.__roomRosterCache = room.players;
  const activeA = room.players.filter(p=>p.team==='A' && !p.spectator);
  const activeB = room.players.filter(p=>p.team==='B' && !p.spectator);
  function build(team, list){
    const spacingY = field.h/(list.length+1);
    list.forEach((entry,i)=>{
      const y = spacingY*(i+1);
      const x = team==='A'? field.w*0.25: field.w*0.75;
      const p = makePlayer(team,x,y);
      p.num = i+1; p.isBot=false; p.netId = entry.id;
      if(entry.color) p.accentColor = entry.color;
      if(entry.characterId) p.characterId = entry.characterId;
      if(entry.auraId) p.auraId = entry.auraId;
      p.cups = entry.cups||0; p.level = entry.level||1; p.name = entry.name||'';
      if(entry.id===myId){ p.isHuman=true; if(account) p.accentColor = COLORS[account.equippedColor]; if(account) p.characterId = account.equippedCharacterId || null; if(account) p.auraId = account.equippedAura || null; if(account){ p.cups=account.cups||0; p.level=account.level||1; } window.__humanPlayer = p; }
      players.push(p);
    });
  }
  build('A', activeA);
  build('B', activeB);
}

/* ============================= INPUT ============================= */
const keys = {};
window.addEventListener('keydown', e=>{ keys[e.key.toLowerCase()]=true; });
window.addEventListener('keyup', e=>{ keys[e.key.toLowerCase()]=false; });
let joyVec = {x:0,y:0};
let kickHeld=false, powerHeld=false, sprintTrigger=false;

function captureLocalInput(){
  let mvx=0, mvy=0;
  if(settings.controlMode==='mobile'){ mvx=joyVec.x; mvy=joyVec.y; }
  else {
    if(keys['w']||keys['arrowup']) mvy-=1;
    if(keys['s']||keys['arrowdown']) mvy+=1;
    if(keys['a']||keys['arrowleft']) mvx-=1;
    if(keys['d']||keys['arrowright']) mvx+=1;
  }
  const kickWanted = !!(keys[' ']||kickHeld);
  const powerWanted = !!(keys['x']||powerHeld);
  const sprintWanted = !!(keys['shift']||sprintTrigger);
  sprintTrigger = false; // one-shot trigger - must be consumed immediately or it corrupts sprint state forever
  return {mvx,mvy,kick:kickWanted,power:powerWanted,sprint:sprintWanted};
}

/* ---- mobile joystick: ONE robust, always-reliable floating stick (no customization) ----
   Decision: an earlier drag-to-customize layout editor turned out unreliable in practice,
   so per the fallback spec we removed it entirely in favor of a single well-tested,
   always-visible-when-needed dynamic joystick (appears exactly where you touch, like
   Brawl Stars / Stumble Guys), plus fixed, guaranteed-on-screen action buttons. */
function setupMobileControls(){
  const zone = document.getElementById('joyZone');
  const base = document.getElementById('joyBase');
  const stick = document.getElementById('joyStick');
  let activePointerId=null, originX=0, originY=0;
  const RADIUS = 66;

  function showBaseAt(x,y){
    // The CSS zone (#joyZone) already excludes the menu/chat strip up top and stays clear of the
    // very bottom edge, so any touch landing inside it is already in a safe spot. Only a tiny
    // edge margin is needed here - a big clamp moves the visual base away from the real touch
    // point and throws off all the direction math (that was the "stick stuck at the bottom" bug).
    const edge = 16;
    x = Math.max(edge, Math.min(window.innerWidth-edge, x));
    y = Math.max(edge, Math.min(window.innerHeight-edge, y));
    // Purely visual: draw the joystick a bit above the raw touch point. On a real touchscreen the
    // finger's pad registers slightly below where it visually feels like you pressed (and the
    // fingertip itself covers whatever's directly under it) - most mobile games (Brawl Stars,
    // Stumble Guys, etc.) deliberately float the stick above the finger for exactly this reason.
    // This offset never touches originX/originY, so it can't bias the actual input.
    const VISUAL_LIFT = 34;
    const drawY = y - VISUAL_LIFT;
    base.style.display='block'; base.style.left=(x-RADIUS)+'px'; base.style.top=(drawY-RADIUS)+'px';
    originX=x; originY=y;
  }
  function hideBase(){
    base.style.display='none';
    stick.style.transform='translate(0,0)'; joyVec.x=0; joyVec.y=0;
  }
  function updateFromPoint(x,y){
    let dx=x-originX, dy=y-originY;
    let dist=Math.hypot(dx,dy);
    const dead = (settings.joyDead||10)/100 * RADIUS;
    if(dist<dead){ stick.style.transform='translate(0,0)'; joyVec.x=0; joyVec.y=0; return; }
    dist = Math.min(dist,RADIUS);
    const ang=Math.atan2(dy,dx);
    const effDist = (dist-dead)/(RADIUS-dead);
    const nx=Math.cos(ang)*dist, ny=Math.sin(ang)*dist;
    stick.style.transform = `translate(${nx}px,${ny}px)`;
    const sens = (settings.joySens||100)/100;
    joyVec.x = Math.cos(ang)*Math.min(1,effDist*sens);
    joyVec.y = Math.sin(ang)*Math.min(1,effDist*sens);
  }
  zone.addEventListener('pointerdown', e=>{
    if(activePointerId!==null && activePointerId!==e.pointerId){
      try{ zone.releasePointerCapture(activePointerId); }catch(err){}
    }
    activePointerId = e.pointerId;
    try{ zone.setPointerCapture(e.pointerId); }catch(err){}
    showBaseAt(e.clientX, e.clientY);
    updateFromPoint(e.clientX,e.clientY);
    e.preventDefault();
  });
  zone.addEventListener('pointermove', e=>{
    if(e.pointerId!==activePointerId) return;
    updateFromPoint(e.clientX,e.clientY);
    e.preventDefault();
  });
  function release(e){
    if(e.pointerId!==activePointerId) return;
    activePointerId=null; hideBase();
  }
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
  zone.addEventListener('lostpointercapture', ()=>{ activePointerId=null; hideBase(); });

  const bindBtn = (id, downFn, upFn)=>{
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', e=>{ e.preventDefault(); try{el.setPointerCapture(e.pointerId);}catch(err){} downFn(); });
    el.addEventListener('pointerup', e=>{ e.preventDefault(); if(upFn) upFn(); });
    el.addEventListener('pointercancel', e=>{ if(upFn) upFn(); });
  };
  bindBtn('btnKick', ()=>kickHeld=true, ()=>kickHeld=false);
  bindBtn('btnPower', ()=>powerHeld=true, ()=>powerHeld=false);
  bindBtn('btnSprint', ()=>sprintTrigger=true);
}
setupMobileControls();

function applyPlayerControl(p, snap){
  if(playersFrozen){ p.vx=0; p.vy=0; p.prevKick=snap.kick; p.prevPower=snap.power; return; }
  if(p.sprintCd>0) p.sprintCd -= 16;
  if(p.powerCd>0) p.powerCd -= 16;
  if(p.kickCd>0) p.kickCd -= 16;
  const len = Math.hypot(snap.mvx,snap.mvy);
  let targetSpeed = PLAYER_SPEED + statVal(p,'speed')*SPEED_PER_LEVEL;
  if(snap.sprint && p.sprintCd<=0){ p.sprintT = SPRINT_DURATION_MS; p.sprintCd = SPRINT_COOLDOWN_MS; }
  if(p.sprintT>0){ targetSpeed *= SPRINT_MULT; p.sprintT -= 16; }
  // while actively kicking, movement gets a touch less crisp (Haxball's kickingAcceleration) -
  // it's what makes striking the ball feel a little "unsteady" instead of perfectly composed
  const moveLerp = snap.kick ? ACCEL_LERP*0.72 : ACCEL_LERP;
  if(len>0.08){
    const nx=snap.mvx/(len||1), ny=snap.mvy/(len||1);
    const dvx=nx*targetSpeed, dvy=ny*targetSpeed;
    p.vx += (dvx-p.vx)*moveLerp; p.vy += (dvy-p.vy)*moveLerp;
    p.facing = Math.atan2(snap.mvy,snap.mvx);
  } else { p.vx *= FRICTION_IDLE; p.vy *= FRICTION_IDLE; }

  const dist = Math.hypot(ball.x-p.x, ball.y-p.y);
  const inRange = dist < p.radius+ball.radius+KICK_RANGE;

  // regular Kick: ONE clean discrete strike per press, like hitting a billiard ball with a cue -
  // never a sustained push. A held button just means "ready to strike the instant you touch it";
  // it can't drag/carry the ball no matter how long it's held.
  const kickEdge = snap.kick && !p.prevKick;
  if(kickEdge && p.kickCd<=0 && inRange){
    const ang = Math.atan2(ball.y-p.y, ball.x-p.x);
    const kp = statVal(p,'kickPower');
    const power = KICK_BASE + kp*KICK_POWER_BONUS;
    ball.vx += Math.cos(ang)*power; ball.vy += Math.sin(ang)*power;
    p.kickCd = KICK_COOLDOWN_MS;
    p.kickFlashUntil = Date.now()+140;
    touchBall(p);
    if(p.isHuman) playSfx('kick');
  }
  // Power Kick: a separate, even bigger deliberate one-shot burst, once every 8 seconds
  const powerEdge = snap.power && !p.prevPower;
  if(powerEdge && p.powerCd<=0 && inRange){
    const ang = Math.atan2(ball.y-p.y, ball.x-p.x);
    const kp = statVal(p,'kickPower');
    const power = KICK_BASE + kp*KICK_POWER_BONUS + KICK_POWER_EXTRA*0.55;
    ball.vx += Math.cos(ang)*power; ball.vy += Math.sin(ang)*power;
    p.powerCd = POWER_KICK_COOLDOWN_MS;
    p.kickFlashUntil = Date.now()+200;
    touchBall(p);
    if(p.isHuman) playSfx('powerkick');
  }
  p.prevKick = snap.kick; p.prevPower = snap.power;
}

