// ============================================================================
// render.js - Frame rendering (field, players, ball, effects)
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= RENDER ============================= */
function updatePowerKickUI(){
  const overlay = document.getElementById('powerCdOverlay');
  const kickOverlay = document.getElementById('kickCdOverlay');
  const pcCd = document.getElementById('pcPowerCd');
  const human = window.__humanPlayer;
  const cooling = matchActive && human && human.powerCd>0;
  const kickCooling = matchActive && human && human.kickCd>0;
  if(overlay) overlay.style.display = (cooling && settings.controlMode==='mobile') ? 'flex' : 'none';
  if(overlay && cooling) overlay.textContent = Math.ceil(human.powerCd/1000);
  if(kickOverlay) kickOverlay.style.display = (kickCooling && settings.controlMode==='mobile') ? 'flex' : 'none';
  if(pcCd){
    if(cooling && settings.controlMode==='pc'){
      pcCd.style.display='block';
      pcCd.textContent = (LANG==='uz'?'Kuchli zarba: ':LANG==='ru'?'Сильный удар: ':'Power kick: ')+Math.ceil(human.powerCd/1000)+'s';
    } else pcCd.style.display='none';
  }
}
function render(){
  updatePowerKickUI();
  const w = window.innerWidth, h = window.innerHeight;
  ctx.clearRect(0,0,w,h);
  if(!matchActive || !field) return;
  const zoom = (settings.camZoom||100)/100;
  let viewW, viewH, cx, cy;
  if(matchType==='multi' && mySpectator){
    // spectators aren't playing, so show the whole stadium instead of following a player
    viewW = field.w * 1.06;
    viewH = field.h * 1.18;
    cx = field.w/2; cy = field.h/2;
  } else if(field.w <= 760){
    // Compact maps (1v1) are meant to be seen in full at a glance - no cropping/follow-cam,
    // otherwise the same proportional crop used for bigger modes made 1v1 feel just as "wide" as 3v3.
    viewW = field.w * 1.08;
    viewH = field.h * 1.2;
    cx = field.w/2; cy = field.h/2;
  } else {
    viewW = Math.min(field.w, Math.max(360, (field.w*0.62)/zoom));
    viewH = Math.min(field.h, Math.max(220, (field.h*0.62)/zoom));
    cx = camX; cy = camY;
    cx = Math.max(viewW/2, Math.min(field.w-viewW/2, cx));
    cy = Math.max(viewH/2, Math.min(field.h-viewH/2, cy));
  }
  const scale = Math.min(w/viewW, h/viewH);
  const offX = w/2 - cx*scale, offY = h/2 - cy*scale;
  ctx.save(); ctx.translate(offX,offY); ctx.scale(scale,scale);

  const equippedSkin = (account && FIELD_SKINS.find(f=>f.id===account.equippedFieldSkin)) || FIELD_SKINS[0];
  ctx.fillStyle = equippedSkin.top; ctx.fillRect(-40,-40,field.w+80,field.h+80);
  ctx.fillStyle = equippedSkin.bottom; ctx.fillRect(0,0,field.w,field.h);
  for(let i=0;i<10;i++){ ctx.fillStyle = i%2===0? 'rgba(255,255,255,0.02)':'rgba(0,0,0,0.03)'; ctx.fillRect(i*field.w/10,0,field.w/10,field.h); }
  ctx.strokeStyle=equippedSkin.line; ctx.lineWidth=3; ctx.strokeRect(0,0,field.w,field.h);
  ctx.beginPath(); ctx.moveTo(field.w/2,0); ctx.lineTo(field.w/2,field.h); ctx.stroke();
  ctx.beginPath(); ctx.arc(field.w/2,field.h/2,55,0,Math.PI*2); ctx.stroke();

  if(kickoffActive){
    const restrictedTeam = kickoffTeam==='A' ? 'B' : 'A';
    const teamColor = kickoffTeam==='A' ? '#4fb0ff' : '#ff6b6b';
    const secsLeft = Math.max(0, Math.ceil((kickoffDeadline-Date.now())/1000));
    const mid = field.w/2, midY = field.h/2, r = KICKOFF_BARRIER_R;
    ctx.save();
    ctx.strokeStyle = teamColor; ctx.lineWidth = 5; ctx.lineCap='round';
    ctx.shadowColor = teamColor; ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(mid, 0);
    ctx.lineTo(mid, midY-r);
    if(restrictedTeam==='B'){ ctx.arc(mid, midY, r, -Math.PI/2, Math.PI/2, false); } // bulges right, into B's half
    else { ctx.arc(mid, midY, r, -Math.PI/2, Math.PI/2, true); } // bulges left, into A's half
    ctx.lineTo(mid, field.h);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.font='bold 18px Rajdhani, sans-serif'; ctx.textAlign='center';
    ctx.fillText((restrictedTeam==='A'? '◀':'▶')+' '+secsLeft+'s', field.w/2, 26);
  }

  const goalTop=field.h/2-field.goalH/2, goalBot=field.h/2+field.goalH/2;
  // recessed goal net boxes
  [{x0:-NET_DEPTH,x1:0},{x0:field.w,x1:field.w+NET_DEPTH}].forEach(box=>{
    ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(box.x0,goalTop,box.x1-box.x0,goalBot-goalTop);
    ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1;
    const step=8;
    for(let yy=goalTop; yy<=goalBot; yy+=step){ ctx.beginPath(); ctx.moveTo(box.x0,yy); ctx.lineTo(box.x1,yy); ctx.stroke(); }
    for(let xx=box.x0; xx<=box.x1; xx+=step){ ctx.beginPath(); ctx.moveTo(xx,goalTop); ctx.lineTo(xx,goalBot); ctx.stroke(); }
  });
  ctx.strokeStyle='#e0b13c'; ctx.lineWidth=5;
  ctx.strokeRect(-NET_DEPTH,goalTop,NET_DEPTH,goalBot-goalTop);
  ctx.strokeRect(field.w,goalTop,NET_DEPTH,goalBot-goalTop);
  ctx.beginPath(); ctx.moveTo(0,goalTop); ctx.lineTo(0,goalBot); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(field.w,goalTop); ctx.lineTo(field.w,goalBot); ctx.stroke();

  // goal frame - thick round white posts + crossbar line, like a real goal mouth
  [0, field.w].forEach(gx=>{
    const dir = gx===0? 1 : -1;
    [goalTop, goalBot].forEach(gy=>{
      const grad = ctx.createRadialGradient(gx-dir*2,gy-2,1, gx,gy,7);
      grad.addColorStop(0,'#ffffff'); grad.addColorStop(1,'#c7ccd1');
      ctx.beginPath(); ctx.arc(gx,gy,6.5,0,Math.PI*2);
      ctx.fillStyle=grad; ctx.fill();
      ctx.lineWidth=1.5; ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.stroke();
    });
    // post shafts running along the goal line
    const postGrad = ctx.createLinearGradient(gx-4,0,gx+4,0);
    postGrad.addColorStop(0,'#9aa0a6'); postGrad.addColorStop(0.5,'#ffffff'); postGrad.addColorStop(1,'#9aa0a6');
    ctx.fillStyle = postGrad;
    ctx.fillRect(gx-4, goalTop, 8, goalBot-goalTop);
  });
  // crossbar hint across the goal mouth (drawn thin since we view the pitch from above)
  ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(0,goalTop); ctx.lineTo(0,goalBot); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(field.w,goalTop); ctx.lineTo(field.w,goalBot); ctx.stroke();

  const CHARACTER_IMG_CACHE = window.__charImgCache || (window.__charImgCache = {});
  function getCharacterImg(id){
    if(!CHARACTER_IMG_CACHE[id]){
      const img = new Image();
      img.src = CHARACTERS[id].img;
      CHARACTER_IMG_CACHE[id] = img;
    }
    return CHARACTER_IMG_CACHE[id];
  }
  players.forEach(p=>{
    const r = p.radius||PLAYER_RADIUS;
    // goal aura: burns behind the scorer for 5s after a goal - fully drawn in
    // code (no video/image to load), so it always renders instantly
    if(p.auraUntil){
      if(Date.now() < p.auraUntil && p.auraId){
        const auraMeta = AURAS.find(a=>a.id===p.auraId);
        if(auraMeta) drawGoalAura(ctx, p, auraMeta);
      } else {
        p.auraUntil = null;
      }
    }
    ctx.beginPath(); ctx.arc(p.x,p.y+r*0.7,r*0.9,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2);
    const ch = (p.characterId && CHARACTERS[p.characterId]) ? CHARACTERS[p.characterId] : null;
    const chImg = ch ? getCharacterImg(p.characterId) : null;
    if(ch && chImg && chImg.complete && chImg.naturalWidth>0){
      ctx.save();
      ctx.clip();
      // same radius (r) as every other player's disc, so the face image is never bigger/smaller than normal
      ctx.drawImage(chImg, p.x-r, p.y-r, r*2, r*2);
      ctx.restore();
    } else {
      ctx.fillStyle = p.color; ctx.fill();
    }
    if(p.accentColor){
      ctx.lineWidth=3; ctx.strokeStyle = p.accentColor;
      ctx.beginPath(); ctx.arc(p.x,p.y,r+2,0,Math.PI*2); ctx.stroke();
    }
    ctx.lineWidth=2.5; ctx.strokeStyle = (Date.now()<(p.kickFlashUntil||0)) ? '#ffffff' : '#0a0a0a'; ctx.stroke();
    if(!ch){
      ctx.fillStyle='#0b0d10'; ctx.font='bold 13px Rajdhani, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(p.num||'', p.x, p.y);
    }
    if(p.isHuman){
      // persistent self-identification marker - always visible regardless of team/accent color,
      // so you never lose track of yourself when both teams look similar
      ctx.beginPath();
      ctx.moveTo(p.x, p.y-r-8);
      ctx.lineTo(p.x-7, p.y-r-18);
      ctx.lineTo(p.x+7, p.y-r-18);
      ctx.closePath();
      ctx.fillStyle = '#ffe9a8';
      ctx.fill();
    }
    if(p.name){
      // small nickname banner beneath the player - kept compact so it never gets in the way;
      // a rank star only appears for notable ranks (Gold tier and above), not every player
      const rInfo = getRankInfo(p.cups||0);
      const showStar = rInfo.tierIndex >= 2;
      ctx.font = '600 9px Rajdhani, sans-serif';
      const label = p.name.length>10 ? p.name.slice(0,10)+'…' : p.name;
      const textW = ctx.measureText(label).width;
      const starW = showStar ? 11 : 0;
      const padX = 7;
      const pillW = textW + starW + padX*2;
      const pillY = p.y + r + 10;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(p.x-pillW/2, pillY, pillW, 14, 7); else ctx.rect(p.x-pillW/2, pillY, pillW, 14);
      ctx.fill();
      let tx = p.x - (textW+starW)/2 + starW;
      if(showStar) drawMiniStar(ctx, p.x-(textW+starW)/2+4, pillY+7, 4.5, rInfo.tier.metal[1]);
      ctx.fillStyle = '#f2ede8'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(label, tx + textW/2 - (showStar?2:0), pillY+7.5);
    }
  });
  ctx.beginPath(); ctx.arc(ball.x,ball.y+5,ball.radius*0.9,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fill();

  // base sphere: radial gradient standing in for a fixed light source (top-left), giving real
  // curvature instead of a flat painted disc
  const br = ball.radius;
  ctx.save();
  ctx.beginPath(); ctx.arc(ball.x,ball.y,br,0,Math.PI*2); ctx.clip();
  const sphereGrad = ctx.createRadialGradient(ball.x-br*0.4,ball.y-br*0.45,br*0.15, ball.x,ball.y,br*1.25);
  sphereGrad.addColorStop(0,'#ffffff');
  sphereGrad.addColorStop(0.55,'#f0f0ea');
  sphereGrad.addColorStop(1,'#c7c7bd');
  ctx.fillStyle = sphereGrad;
  ctx.fillRect(ball.x-br,ball.y-br,br*2,br*2);

  // rotating pentagon seam marks - real rolling physics: they spin around the axis perpendicular
  // to the ball's travel direction, foreshortened along that axis so it reads as a sphere turning,
  // not a flat disc sliding
  const axX=ballRotAxisX, axY=ballRotAxisY; // in-plane rotation axis (perpendicular to velocity)
  const perpX=-axY, perpY=axX;              // perpendicular to axis = direction of visible "tumble"
  const seamAngles = [0,1.05,2.1,3.15,4.2,5.25];
  seamAngles.forEach((a0,i)=>{
    const ang = a0 + ballRotation;
    const along = Math.cos(ang), across = Math.sin(ang);
    const depth = across; // -1..1, simulates how far around the sphere this seam currently is
    if(depth < -0.15) return; // facing away from camera - don't draw the far side
    const px = ball.x + (perpX*along*br*0.82) + (axX*depth*br*0.30);
    const py = ball.y + (perpY*along*br*0.82) + (axY*depth*br*0.30);
    const scale = 0.45 + 0.55*Math.max(0,depth+0.15)/1.15;
    const size = br*0.24*scale;
    ctx.beginPath();
    for(let k=0;k<5;k++){
      const pa = -Math.PI/2 + k*(Math.PI*2/5);
      const vx = px+Math.cos(pa)*size, vy = py+Math.sin(pa)*size;
      if(k===0) ctx.moveTo(vx,vy); else ctx.lineTo(vx,vy);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(15,15,15,${0.55+0.35*Math.max(0,depth)})`;
    ctx.fill();
  });
  ctx.restore();
  ctx.beginPath(); ctx.arc(ball.x,ball.y,br,0,Math.PI*2);
  ctx.lineWidth=2; ctx.strokeStyle='#0b0d10'; ctx.stroke();
  ctx.restore();
}

