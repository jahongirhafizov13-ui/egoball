// ============================================================================
// shop-progression.js - Shop, Level/EXP, Rank/Cups
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= SHOP ============================= */
const STAT_KEYS = ['speed','power','kickPower','control'];
const SHOP_TABS = { tabColors:'colorsPanel', tabFrames:'framesPanel', tabShopSkills:'shopSkillsPanel', tabCharacters:'charactersPanel', tabAura:'auraPanel', tabStadium:'stadiumPanel', tabBanner:'bannerPanel' };
function switchShopTab(activeId){
  Object.entries(SHOP_TABS).forEach(([tabId,panelId])=>{
    document.getElementById(tabId).classList.toggle('active', tabId===activeId);
    document.getElementById(panelId).style.display = (tabId===activeId)?'flex':'none';
  });
  if(activeId==='tabShopSkills') renderPlayerStats();
  if(activeId==='tabCharacters') renderCharactersPanel();
  if(activeId==='tabAura') renderAuraPanel();
  if(activeId==='tabStadium') renderStadiumPanel();
  if(activeId==='tabBanner') renderBannerPanel();
}
document.getElementById('tabColors').addEventListener('click', ()=> switchShopTab('tabColors'));
document.getElementById('tabFrames').addEventListener('click', ()=> switchShopTab('tabFrames'));
document.getElementById('tabShopSkills').addEventListener('click', ()=> switchShopTab('tabShopSkills'));
document.getElementById('tabCharacters').addEventListener('click', ()=> switchShopTab('tabCharacters'));
document.getElementById('tabAura').addEventListener('click', ()=> switchShopTab('tabAura'));
document.getElementById('tabStadium').addEventListener('click', ()=> switchShopTab('tabStadium'));
document.getElementById('tabBanner').addEventListener('click', ()=> switchShopTab('tabBanner'));
function renderStadiumPanel(){
  const panel = document.getElementById('stadiumPanel'); panel.innerHTML='';
  if(!account) return;
  const owned = account.fieldSkinsOwned || [];
  FIELD_SKINS.forEach(skin=>{
    const isOwned = skin.price===0 || owned.includes(skin.id);
    const equipped = (account.equippedFieldSkin||'field0')===skin.id;
    const row = document.createElement('div'); row.className='hubrow';
    row.innerHTML = `<div style="display:flex;align-items:center;gap:10px;">
        <div style="width:56px;height:36px;border-radius:8px;flex-shrink:0;border:2px solid ${skin.line};
          background:linear-gradient(180deg, ${skin.top}, ${skin.bottom});"></div>
        <div><div style="font-weight:700;">${escapeHtml(skin.name)}</div>
          <div style="font-size:11px;color:${skin.line}">${isOwned? (LANG==='uz'?"Sizda bor":LANG==='ru'?'Есть у вас':'Owned') : skin.price+' G Coin'}</div>
        </div>
      </div>
      <div class="btn small ${equipped?'':'primary'}" style="padding:6px 14px;">${isOwned ? (equipped? (LANG==='uz'?"Kiyilgan":LANG==='ru'?'Надето':'Equipped') : (LANG==='uz'?"Kiyish":LANG==='ru'?'Надеть':'Equip')) : (LANG==='uz'?"Sotib olish":LANG==='ru'?'Купить':'Buy')}</div>`;
    row.querySelector('.btn').addEventListener('click', ()=>{
      if(!isOwned){
        socket.emit('buyFieldSkin', {skinId:skin.id}, (res)=>{
          if(res && res.ok){
            account.fieldSkinsOwned = account.fieldSkinsOwned || []; account.fieldSkinsOwned.push(skin.id);
            account.gcoin = res.gcoin; account.equippedFieldSkin = skin.id;
            updateCoinDisplays(); renderStadiumPanel();
            flashMsg(LANG==='uz'?`${skin.name} sotib olindi va kiyildi!`:LANG==='ru'?`${skin.name} куплен и надет!`:`${skin.name} bought and equipped!`);
          } else {
            const errs = { not_enough_gcoin: LANG==='uz'?'G Coin yetarli emas':LANG==='ru'?'Недостаточно G Coin':'Not enough G Coin' };
            flashMsg((res&&errs[res.error]) || (LANG==='uz'?'Xatolik':'Error'));
          }
        });
      } else if(equipped){
        // already equipped - nothing to do (skins aren't "unequippable" to nothing, unlike auras)
      } else {
        socket.emit('equipFieldSkin', {skinId:skin.id}, (res)=>{
          if(res && res.ok){ account.equippedFieldSkin = skin.id; renderStadiumPanel(); }
        });
      }
    });
    panel.appendChild(row);
  });
}
document.getElementById('btnOpenStadiumShop').addEventListener('click', ()=>{
  show('screen-shop'); switchShopTab('tabStadium');
});
function renderAuraPanel(){
  const panel = document.getElementById('auraPanel'); panel.innerHTML='';
  if(!account) return;
  const owned = account.aurasOwned || [];
  AURAS.forEach(aura=>{
    const isOwned = owned.includes(aura.id);
    const equipped = account.equippedAura===aura.id;
    const row = document.createElement('div'); row.className='hubrow';
    row.innerHTML = `<div style="display:flex;align-items:center;gap:10px;">
        <canvas class="aura-preview-canvas" data-aura-id="${aura.id}" width="56" height="56" style="width:56px;height:56px;flex-shrink:0;"></canvas>
        <div><div style="font-weight:700;">${escapeHtml(aura.name)}</div>
          <div style="font-size:11px;color:${aura.glow}">${isOwned? (LANG==='uz'?"Sizda bor":LANG==='ru'?'Есть у вас':'Owned') : aura.price+' G Coin'}</div>
        </div>
      </div>
      <div class="btn small ${equipped?'':'primary'}" style="padding:6px 14px;">${isOwned ? (equipped? (LANG==='uz'?"Yechish":LANG==='ru'?'Снять':'Unequip') : (LANG==='uz'?"Kiyish":LANG==='ru'?'Надеть':'Equip')) : (LANG==='uz'?"Sotib olish":LANG==='ru'?'Купить':'Buy')}</div>`;
    row.querySelector('.btn').addEventListener('click', ()=>{
      if(!isOwned){
        socket.emit('buyAura', {auraId:aura.id}, (res)=>{
          if(res && res.ok){
            account.aurasOwned = account.aurasOwned || []; account.aurasOwned.push(aura.id);
            account.gcoin = res.gcoin; account.equippedAura = aura.id;
            updateCoinDisplays(); renderAuraPanel();
            flashMsg(LANG==='uz'?`${aura.name} sotib olindi va kiyildi!`:LANG==='ru'?`${aura.name} куплена и надета!`:`${aura.name} bought and equipped!`);
          } else {
            const errs = { not_enough_gcoin: LANG==='uz'?'G Coin yetarli emas':LANG==='ru'?'Недостаточно G Coin':'Not enough G Coin' };
            flashMsg((res&&errs[res.error]) || (LANG==='uz'?'Xatolik':'Error'));
          }
        });
      } else {
        const newId = equipped ? null : aura.id;
        socket.emit('equipAura', {auraId:newId}, (res)=>{
          if(res && res.ok){ account.equippedAura = newId; renderAuraPanel(); }
        });
      }
    });
    panel.appendChild(row);
  });
  startAuraPreviewLoop();
}
// Live-animates every small aura preview canvas currently in the shop list, using the EXACT same
// drawGoalAura() routine the real in-match goal celebration uses - so what you see in the shop is
// truthfully what you'll see on the pitch, not a generic placeholder glow.
let auraPreviewRafId = null;
function startAuraPreviewLoop(){
  if(auraPreviewRafId) cancelAnimationFrame(auraPreviewRafId);
  function frame(){
    const panel = document.getElementById('auraPanel');
    const stillVisible = panel && panel.offsetParent !== null;
    if(!stillVisible){ auraPreviewRafId = null; return; }
    const canvases = panel.querySelectorAll('canvas.aura-preview-canvas');
    canvases.forEach(cv=>{
      const cctx = cv.getContext('2d');
      cctx.clearRect(0,0,cv.width,cv.height);
      const aura = AURAS.find(a=>a.id===cv.dataset.auraId);
      if(!aura) return;
      const fakePlayer = { x: cv.width/2, y: cv.height/2, radius: 9 };
      drawGoalAura(cctx, fakePlayer, aura);
    });
    auraPreviewRafId = requestAnimationFrame(frame);
  }
  auraPreviewRafId = requestAnimationFrame(frame);
}
function renderCharactersPanel(){
  const panel = document.getElementById('charactersPanel'); panel.innerHTML='';
  if(!account) return;
  const owned = account.skinsOwned || [];
  if(owned.length===0){
    panel.innerHTML = `<div class="subtitle" style="padding:20px 0;text-align:center;">
      Hali hech qanday personaj yo'q. Hub'dagi 📦 OpenCase tugmasidan case oching!</div>`;
    return;
  }
  owned.forEach(id=>{
    const ch = CHARACTERS[id]; if(!ch) return;
    const equipped = account.equippedCharacterId===id;
    const row = document.createElement('div'); row.className='hubrow';
    row.innerHTML = `<div style="display:flex;align-items:center;gap:10px;">
        <span style="border-radius:50%;border:2px solid ${RANK_COLORS[ch.rank]};display:inline-flex;">${charAvatarHTML(ch, 36)}</span>
        <div><div style="font-weight:700;">${ch.name}</div><div style="font-size:11px;color:${RANK_COLORS[ch.rank]}">${ch.rank}</div></div>
      </div>
      <div class="btn small ${equipped?'':'primary'}" style="padding:6px 14px;">${equipped? "Yechish" : "Kiyish"}</div>`;
    row.querySelector('.btn').addEventListener('click', ()=>{
      const newId = equipped ? null : id;
      socket.emit('equipCharacter', {characterId:newId}, (res)=>{
        if(res && res.ok){ account.equippedCharacterId = newId; renderCharactersPanel(); renderPlayerStats(); renderProfileBadge(); renderHubPlayerBadge(); }
      });
    });
    panel.appendChild(row);
  });
}
function totalStatLevels(){ if(!account) return 0; return STAT_KEYS.reduce((a,k)=>a+getStatsObj()[k],0); }
function currentStatsKey(){ return (account && account.equippedCharacterId) || 'base'; }
function getStatsObj(){
  if(!account) return {speed:0,power:0,kickPower:0,control:0};
  if(!account.charStats) account.charStats = {};
  const key = currentStatsKey();
  if(!account.charStats[key]) account.charStats[key] = {speed:0,power:0,kickPower:0,control:0};
  return account.charStats[key];
}

// --- effective ability numbers: single source of truth for "what number does the player actually have" ---
// Computed lazily (inside the function, not as top-level consts) so it never matters what order this
// code sits in relative to PLAYER_SPEED/KICK_BASE/etc - those are only read at call time, by which point
// everything in the file has already been declared.
const CASE_COST_GCOIN = 45;
const CHARACTERS = {
  isagi:    { id:'isagi',    name:'Isagi',        img:SERVER_URL+'/skins/isagi.png',    rank:'Common',    chance:24,  speed:2.50, kickPower:3.30, power:1.35, control:0.50 },
  eita:     { id:'eita',     name:'Eita',         img:SERVER_URL+'/skins/eita.png',     rank:'Rare',      chance:20,  speed:2.80, kickPower:3.60, power:1.45, control:0.75 },
  aiku:     { id:'aiku',     name:'Aiku',         img:SERVER_URL+'/skins/aiku.png',     rank:'Rare',      chance:20,  speed:2.65, kickPower:3.50, power:1.80, control:0.70 },
  nagi:     { id:'nagi',     name:'Nagi',         img:SERVER_URL+'/skins/nagi.png',     rank:'Epic',      chance:15,  speed:2.85, kickPower:4.80, power:1.70, control:0.96 },
  reo:      { id:'reo',      name:'Reo',          img:SERVER_URL+'/skins/reo.png',      rank:'Epic',      chance:15,  speed:2.80, kickPower:4.50, power:1.55, control:0.92 },
  yukimiya: { id:'yukimiya', name:'Yukimiya',     img:SERVER_URL+'/skins/yukimiya.png', rank:'Epic',      chance:15,  speed:2.90, kickPower:4.10, power:1.55, control:0.88 },
  rin:      { id:'rin',      name:'Rin',          img:SERVER_URL+'/skins/rin.png',      rank:'Epic',      chance:15,  speed:2.85, kickPower:4.90, power:1.60, control:0.75 },
  barou:    { id:'barou',    name:'Barou',        img:SERVER_URL+'/skins/barou.png',    rank:'Epic',      chance:15,  speed:2.75, kickPower:5.10, power:1.95, control:0.70 },
  shidou:   { id:'shidou',   name:'Shidou',       img:SERVER_URL+'/skins/shidou.png',   rank:'Legendary', chance:10,  speed:2.95, kickPower:5.70, power:1.85, control:0.75 },
  kunigami: { id:'kunigami', name:'Kunigami',     img:SERVER_URL+'/skins/kunigami.png', rank:'Legendary', chance:10,  speed:2.80, kickPower:5.50, power:2.15, control:0.65 },
  lorenzo:  { id:'lorenzo',  name:'Lorenzo',      img:SERVER_URL+'/skins/lorenzo.png',  rank:'Legendary', chance:10,  speed:2.90, kickPower:4.00, power:2.10, control:0.85 },
  bunny:    { id:'bunny',    name:'Bunny',        img:SERVER_URL+'/skins/bunny.png',    rank:'Legendary', chance:5,   speed:3.15, kickPower:3.50, power:1.30, control:0.90 },
  sae:      { id:'sae',      name:'Sae',          img:SERVER_URL+'/skins/sae.png',      rank:'Legendary', chance:5,   speed:2.95, kickPower:5.20, power:1.50, control:0.98 },
  hugo:     { id:'hugo',     name:'Hugo',         img:SERVER_URL+'/skins/hugo.png',     rank:'Legendary', chance:3,   speed:3.05, kickPower:5.00, power:1.65, control:0.85 },
  kaiser:   { id:'kaiser',   name:'Kaiser',       img:SERVER_URL+'/skins/kaiser.png',   rank:'Legendary', chance:3,   speed:3.10, kickPower:6.00, power:1.75, control:0.80 },
  noelnoa:  { id:'noelnoa',  name:'Noel Noa',     img:SERVER_URL+'/skins/noelnoa.png',  rank:'Myth',      chance:0.5, speed:3.20, kickPower:7.00, power:2.20, control:0.95 },
  loki:     { id:'loki',     name:'Julian Loki',  img:SERVER_URL+'/skins/loki.png',     rank:'Myth',      chance:0.5, speed:4.00, kickPower:5.50, power:1.80, control:0.90 },
  chris:    { id:'chris',    name:'Chris Prince', img:SERVER_URL+'/skins/chris.png',    rank:'Myth',      chance:0.5, speed:3.15, kickPower:6.50, power:2.50, control:0.92 },
  snuffy:   { id:'snuffy',   name:'Marc Snuffy',  img:SERVER_URL+'/skins/snuffy.png',   rank:'Myth',      chance:0.5, speed:3.00, kickPower:5.80, power:2.00, control:1.00 },
  lawinho:  { id:'lawinho',  name:'Lavinho',      img:SERVER_URL+'/skins/lawinho.png',  rank:'Myth',      chance:0.5, speed:3.25, kickPower:5.90, power:1.75, control:0.97 }
};
const RANK_COLORS = { Common:'#9aa0a8', Rare:'#4fa3ff', Epic:'#b25cff', Legendary:'#e0b13c', Myth:'#ff2222' };

/* ============================= LEVEL / EXP ============================= */
// Doubling curve: level N -> N+1 costs 100 * 2^(N-1) exp (100, 200, 400, 800, ...)
function expNeededForLevel(level){ return 100 * Math.pow(2, Math.max(1,level)-1); }
function matchExpGain(goals, assists, won){
  return 5 + goals*5 + assists*3 + (won?10:0);
}
function applyExpGain(acc, gain){
  acc.exp = (acc.exp||0) + gain;
  acc.level = acc.level||1;
  while(acc.exp >= expNeededForLevel(acc.level)){
    acc.exp -= expNeededForLevel(acc.level);
    acc.level += 1;
  }
}
function showLevelUpAnim(newLevel){
  const overlay = document.getElementById('levelUpOverlay');
  const card = document.getElementById('levelUpCard');
  document.getElementById('levelUpNumber').textContent = newLevel;
  overlay.style.display = 'flex';
  card.style.animation = 'none';
  void card.offsetWidth; // restart the animation even if triggered again quickly
  card.style.animation = 'levelUpPop 2.2s ease forwards';
  playSfx && playSfx('goal');
  setTimeout(()=>{ overlay.style.display='none'; }, 2200);
}

// Nickname banners - one per rank tier (same metal colors as the rank badges, so it reads as
// "the same rank system", not a separate unrelated cosmetic). Unlocked permanently once you reach
// that tier (tracked via account.highestTierReached), even if your cups later drop below it -
// like real games, a banner earned is never taken away. Locked ones can still be browsed/previewed.
/* ============================= RANK / CUPS ============================= */
// 6 tiers, 5 divisions each (V entry -> I about to promote) except Legendary which has none -
// it's an open-ended climb once you reach it. Cups are one continuous number; rank/division are
// derived live from the total, floored at 0 for the whole account.
const RANK_TIERS = [
  { name:'Player Rank',            short:'PR',  perDiv:100, metal:['#8a5a2b','#d99a5c'] }, // bronze
  { name:"Good Player Rank",       short:'GPR', perDiv:150, metal:['#9aa3ad','#e8edf0'] }, // silver
  { name:'Pro Player Rank',        short:'PPR', perDiv:200, metal:['#b8871f','#ffd875'] }, // gold
  { name:'Master Player Rank',     short:'MPR', perDiv:300, metal:['#2e8fae','#bdf3ff'] }, // diamond
  { name:'Pro Master Player Rank', short:'PMR', perDiv:400, metal:['#1f8a5a','#7dffc0'] }, // emerald
  { name:'Legendary',              short:'LGD', perDiv:0,   metal:['#1a1414','#ff3b3b'] }  // black + red
];
function getRankInfo(cups){
  cups = Math.max(0, cups||0);
  let floor = 0;
  for(let i=0;i<RANK_TIERS.length-1;i++){
    const tier = RANK_TIERS[i];
    const span = tier.perDiv*5;
    if(cups < floor+span){
      const into = cups-floor;
      const division = 5 - Math.min(4, Math.floor(into/tier.perDiv)); // 5..1
      const intoDiv = into - ((5-division)*tier.perDiv);
      return { tierIndex:i, tier, division, cupsIntoDiv:intoDiv, cupsForDiv:tier.perDiv, totalCups:cups };
    }
    floor += span;
  }
  const legend = RANK_TIERS[RANK_TIERS.length-1];
  return { tierIndex:RANK_TIERS.length-1, tier:legend, division:null, cupsIntoDiv:cups-floor, cupsForDiv:null, totalCups:cups };
}
function matchCupGain(goals, won, currentTierIndex){
  if(won){
    let gain = 12 + Math.floor(Math.random()*4);
    gain += goals*5;
    return gain;
  }
  if(currentTierIndex===0) return 0; // Player Rank never loses cups - only climbing happens there
  return -(10 + Math.floor(Math.random()*11));
}
// Nickname banners - one per rank tier (same metal colors as the rank badges, so it reads as
// "the same rank system", not a separate unrelated cosmetic). Unlocked permanently once you reach
// that tier (tracked via account.highestTierReached), even if your cups later drop below it -
// like real games, a banner earned is never taken away. Locked ones can still be browsed/previewed.
const NICKNAME_BANNERS = RANK_TIERS.map((tier,i)=> ({ tierIndex:i, name:tier.name, short:tier.short, metal:tier.metal }));
function nicknameBannerStyle(tierIndex){
  if(tierIndex==null) return '';
  const b = NICKNAME_BANNERS[tierIndex]; if(!b) return '';
  return `background:linear-gradient(90deg, ${b.metal[0]}66, ${b.metal[1]}3d, ${b.metal[0]}66);
    border:1px solid ${b.metal[1]}; box-shadow:0 0 10px -2px ${b.metal[1]}aa;`;
}
// Legendary banner FX: real forking lightning strikes + rising black smoke, drawn live every frame -
// not a static icon. Reused everywhere the Legendary banner is shown (shop preview, profile, hub name).
function drawLegendaryBannerFX(ctx, w, h, t){
  ctx.clearRect(0,0,w,h);
  for(let i=0;i<5;i++){
    const seed = i*53.1;
    const cycle = h*1.5;
    const py = h - (((t*18 + seed*40) % cycle));
    const px = (w*0.5) + Math.sin(seed + t*0.6)*w*0.42;
    const alpha = 0.22*Math.max(0, 1-(h-py)/h);
    if(alpha<=0.01) continue;
    const r = h*0.5 + Math.sin(t*1.7+seed)*h*0.1;
    const grad = ctx.createRadialGradient(px,py,0,px,py,r);
    grad.addColorStop(0, `rgba(8,3,3,${alpha})`);
    grad.addColorStop(1, 'rgba(8,3,3,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.fill();
  }
  const cyclePos = (t*1.3)%1;
  if(cyclePos < 0.12){
    const flash = 1-(cyclePos/0.12);
    const seedX = Math.floor(t*1.3)*97.13;
    const startX = w*(0.25+((seedX*13)%50)/100);
    ctx.save();
    ctx.strokeStyle = `rgba(255,90,80,${0.55*flash})`;
    ctx.lineWidth = 3; ctx.shadowColor='rgba(255,60,50,0.9)'; ctx.shadowBlur=8;
    let x=startX, y=0;
    ctx.beginPath(); ctx.moveTo(x,y);
    for(let s=1;s<=5;s++){
      x += Math.sin(seedX+s*7.7)*w*0.09;
      y = h*(s/5);
      ctx.lineTo(x,y);
      if(s===3){ // a small fork branching off
        ctx.moveTo(x,y);
        ctx.lineTo(x+w*0.12*Math.sign(Math.sin(seedX)), y+h*0.15);
        ctx.moveTo(x,y);
      }
    }
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.8*flash})`; ctx.lineWidth=1.1; ctx.shadowBlur=0;
    ctx.stroke();
    ctx.restore();
  }
}
// Attaches (or removes) the live FX canvas behind a nickname/banner wrapper element. Safe to call
// repeatedly - it tears down any previous canvas+loop first so nothing leaks or double-draws.
function attachBannerFX(wrapperEl, tierIndex){
  if(!wrapperEl) return;
  const old = wrapperEl.querySelector('.banner-fx-canvas');
  if(old){ if(old.__stopFX) old.__stopFX(); old.remove(); }
  if(tierIndex!==5) return; // only the top Legendary tier gets the animated treatment for now
  wrapperEl.style.position = wrapperEl.style.position || 'relative';
  const canvas = document.createElement('canvas');
  canvas.className = 'banner-fx-canvas';
  canvas.width = 220; canvas.height = 60;
  wrapperEl.insertBefore(canvas, wrapperEl.firstChild);
  const cctx = canvas.getContext('2d');
  let raf, stopped=false;
  function frame(){
    if(stopped) return;
    if(!document.body.contains(canvas)) return;
    drawLegendaryBannerFX(cctx, canvas.width, canvas.height, performance.now()/1000);
    raf = requestAnimationFrame(frame);
  }
  canvas.__stopFX = ()=>{ stopped=true; if(raf) cancelAnimationFrame(raf); };
  raf = requestAnimationFrame(frame);
}
function renderBannerPanel(){
  const panel = document.getElementById('bannerPanel'); if(!panel) return;
  panel.innerHTML='';
  if(!account) return;
  const myTier = account.highestTierReached||0;
  NICKNAME_BANNERS.forEach(b=>{
    const unlocked = b.tierIndex <= myTier;
    const equipped = (account.equippedBanner===b.tierIndex);
    const row = document.createElement('div'); row.className='hubrow';
    row.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex:1;">
        <div class="banner-preview-wrap" style="position:relative;width:130px;height:30px;border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;letter-spacing:1px;color:#fff;${nicknameBannerStyle(b.tierIndex)}">
          <span style="position:relative;z-index:1;">${escapeHtml(account.name||'NICKNAME')}</span>
          ${!unlocked? '<span style="position:absolute;top:2px;right:4px;z-index:2;font-size:11px;">🔒</span>' : ''}
        </div>
        <div style="font-size:11px;color:${unlocked?'var(--txt-dim)':'#e0a3a1'};">${unlocked? b.name : (LANG==='uz'?`${b.name} darajasiga yetganda ochiladi`:LANG==='ru'?`Откроется на ранге ${b.name}`:`Unlocks at ${b.name}`)}</div>
      </div>
      <div class="btn small ${equipped?'':'primary'}" style="padding:6px 14px;${unlocked?'':'opacity:.4;pointer-events:none;'}">${equipped? (LANG==='uz'?"Yechish":LANG==='ru'?'Снять':'Unequip') : (LANG==='uz'?"Kiyish":LANG==='ru'?'Надеть':'Equip')}</div>`;
    attachBannerFX(row.querySelector('.banner-preview-wrap'), b.tierIndex);
    if(unlocked){
      row.querySelector('.btn').addEventListener('click', async ()=>{
        account.equippedBanner = equipped ? null : b.tierIndex;
        await persistAccount(); renderBannerPanel(); renderProfileBadge();
      });
    }
    panel.appendChild(row);
  });
}
// Original badge artwork (shield + gem + roman numeral), generated in code - not copied from any
// reference image. Division is 1-5, or null for Legendary (which gets a wings/star motif instead).
function rankBadgeSVG(tierIndex, division, sizePx){
  sizePx = sizePx || 24;
  const tier = RANK_TIERS[tierIndex];
  const [c1,c2] = tier.metal;
  const uid = 'rt'+tierIndex+'_'+(division||0)+'_'+Math.random().toString(36).slice(2,7);
  const legendary = tierIndex===RANK_TIERS.length-1;
  // glow strength: division 5 (entry) is faint, division 1 (about to promote) is strongest; Legendary maxes it out
  const glowLevel = legendary ? 6 : (division? (6-division) : 1); // 1..6
  const glowPx = 3 + glowLevel*3.5;
  const glowColor = legendary ? '#ff2d2d' : c2;
  const lightning = legendary ? `
    <path class="cup-bolt" d="M13 18 L21 18 L15 27 L22 27 L9 41 L14 29 L7 29 Z" fill="#fff5f5"/>
    <path class="cup-bolt cup-bolt2" d="M51 16 L44 16 L50 25 L43 25 L55 39 L49 27 L56 27 Z" fill="#fff5f5"/>` : '';
  return `<div class="cup-wrap" style="width:${sizePx}px;height:${sizePx}px;filter:drop-shadow(0 0 ${glowPx}px ${glowColor}) drop-shadow(0 0 ${glowPx*0.5}px ${glowColor});">
  <svg viewBox="0 0 64 64" width="${sizePx}" height="${sizePx}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c2}"/><stop offset="100%" stop-color="${c1}"/>
    </linearGradient></defs>
    <rect x="22" y="53" width="20" height="6" rx="2" fill="url(#${uid})" stroke="#1a1a1a" stroke-width="1.4"/>
    <rect x="28" y="43" width="8" height="11" fill="url(#${uid})" stroke="#1a1a1a" stroke-width="1.4"/>
    <path d="M16 12 Q16 34 32 40 Q48 34 48 12 Z" fill="url(#${uid})" stroke="#1a1a1a" stroke-width="2"/>
    <path d="M16 14 C7 14 7 27 18 29" fill="none" stroke="url(#${uid})" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M48 14 C57 14 57 27 46 29" fill="none" stroke="url(#${uid})" stroke-width="3.5" stroke-linecap="round"/>
    <ellipse cx="32" cy="12" rx="16" ry="4" fill="url(#${uid})" stroke="#1a1a1a" stroke-width="1.4"/>
    <circle cx="32" cy="23" r="6.5" fill="rgba(255,255,255,.92)" stroke="#1a1a1a" stroke-width="1"/>
    <path d="M32 18 L35.8 20.7 L34.3 25.2 L29.7 25.2 L28.2 20.7 Z" fill="#1a1a1a"/>
    ${lightning}
  </svg></div>`;
}

const AURAS = [
  { id:'aura1', name:'Ametist', price:100, glow:'#c77dff', style:'orbit'  },
  { id:'aura2', name:"Bo'ron",  price:150, glow:'#4fb0ff', style:'rings'  },
  { id:'aura3', name:'Chaqmoq', price:180, glow:'#43dede', style:'bolt'   },
  { id:'aura4', name:"Yong'in", price:220, glow:'#ff9d4d', style:'flame'  },
  { id:'aura5', name:'Zumrad',  price:250, glow:'#39c477', style:'orbit' },
  // ---- 20 new auras, each a genuinely distinct animation technique, priced by how
  // much rendering work the style actually costs (more layers/particles = pricier) ----
  { id:'aura6',  name:'Zanjir',          price:220, glow:'#8a8f98', style:'chain'     },
  { id:'aura7',  name:'Kristall',        price:260, glow:'#4dd0e1', style:'crystal'   },
  { id:'aura8',  name:'Kamalak prizma',  price:280, glow:'#ff5c9e', style:'prism'     },
  { id:'aura9',  name:'Glitch',          price:280, glow:'#39c477', style:'glitch'    },
  { id:'aura10', name:'Soya',            price:300, glow:'#9a6bff', style:'shadow'    },
  { id:'aura11', name:'Portlash',        price:300, glow:'#ffd166', style:'burst'     },
  { id:'aura12', name:'Suv toʻlqini',    price:320, glow:'#4fb0ff', style:'wave'      },
  { id:'aura13', name:'Tornado',         price:320, glow:'#c2e04a', style:'tornado'   },
  { id:'aura14', name:'Zilzila',         price:360, glow:'#f2f2f2', style:'spiral'    },
  { id:'aura15', name:'Yulduzlar',       price:360, glow:'#5c6bff', style:'starfield' },
  { id:'aura16', name:'Halqa tanti',     price:380, glow:'#f6dd8a', style:'halo'      },
  { id:'aura17', name:'Kometa',          price:400, glow:'#43dede', style:'comet'     },
  { id:'aura18', name:'Aurora',          price:420, glow:'#39c477', style:'aurora'    },
  { id:'aura19', name:'Marmar shar',     price:440, glow:'#ef476f', style:'marble'    },
  { id:'aura20', name:'Chaqmoq qafasi',  price:460, glow:'#4fb0ff', style:'cage'      },
  { id:'aura21', name:'Sehrli doira',    price:480, glow:'#e0b13c', style:'runes'     },
  { id:'aura22', name:"Feniks qanotlari",price:500, glow:'#ff7043', style:'wings'     },
  { id:'aura23', name:"Ajdar alangasi",  price:550, glow:'#ff9d4d', style:'dragon'    },
  { id:'aura24', name:"Qora olov",       price:750, glow:'#c77dff', style:'blackfire' },
  { id:'aura25', name:'VIP Oltin',       price:900, glow:'#f6dd8a', style:'vip'       }
];

// Stadium/field skins - purely cosmetic pitch colors, equipped locally (no need to sync
// to other players in multiplayer, same as any other personal visual preference).
const FIELD_SKINS = [
  { id:'field0', name:"Klassik", price:0,   top:'#0a2e22', bottom:'#0d3d2e', line:'rgba(255,255,255,0.55)' },
  { id:'field1', name:"Kechqurun Binafsha", price:150, top:'#1a0a2e', bottom:'#2d0d3e', line:'rgba(200,150,255,0.5)' },
  { id:'field2', name:"Muzli Ko'k",         price:180, top:'#0a1f2e', bottom:'#0d2f3e', line:'rgba(150,220,255,0.55)' },
  { id:'field3', name:"Cho'l Sariq",        price:200, top:'#2e260a', bottom:'#3e330d', line:'rgba(255,224,150,0.5)' },
  { id:'field4', name:"Qorayu Tun",         price:220, top:'#05060a', bottom:'#0a0d14', line:'rgba(180,190,220,0.45)' },
  { id:'field5', name:"Qip-qizil Arena",    price:260, top:'#2e0a0f', bottom:'#3e0d14', line:'rgba(255,160,160,0.5)' },
  { id:'field6', name:"Yorqin Zumrad",      price:280, top:'#0a2e1a', bottom:'#0d3e22', line:'rgba(160,255,190,0.5)' },
  { id:'field7', name:"Neon Pushti",        price:320, top:'#2e0a24', bottom:'#3e0d30', line:'rgba(255,150,220,0.55)' },
  { id:'field8', name:"Kulrang Metall",     price:360, top:'#1c1f22', bottom:'#282c30', line:'rgba(220,225,230,0.5)' },
  { id:'field9', name:"Oltin VIP Stadion",  price:600, top:'#2e2408', bottom:'#3e3010', line:'rgba(255,222,140,0.7)' }
];

const AURA_GOAL_DURATION_MS = 5000;
function hexToRgba(hex, alpha){
  const h = (hex||'#e0b13c').replace('#','');
  const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
// Fully procedural goal aura - drawn entirely with canvas primitives (no video
// files, nothing to load or fail), so it always renders instantly everywhere.
function drawGoalAura(ctx, p, aura){
  const r = p.radius||PLAYER_RADIUS;
  const t = Date.now()/1000;
  const glow = (aura && aura.glow) || '#e0b13c';
  const style = (aura && aura.style) || 'orbit';
  ctx.save();
  ctx.globalCompositeOperation='lighter';

  // soft pulsing base glow (shared foundation under every style)
  const pulse = 0.78 + 0.22*Math.sin(t*6);
  const R = r*3.3*pulse;
  const grad = ctx.createRadialGradient(p.x,p.y,r*0.35, p.x,p.y, R);
  grad.addColorStop(0, hexToRgba(glow,0.55));
  grad.addColorStop(0.6, hexToRgba(glow,0.22));
  grad.addColorStop(1, hexToRgba(glow,0));
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(p.x,p.y,R,0,Math.PI*2); ctx.fill();

  if(style==='rings' || style==='bolt'){
    const ringCount = style==='bolt' ? 2 : 3;
    for(let i=0;i<ringCount;i++){
      const ringR = r*(1.55+i*0.55);
      const speed = (i%2===0? 1:-1) * (1.1+i*0.35);
      const startA = t*speed + i*2.3;
      const sweep = style==='bolt' ? 1.0 : 1.7;
      ctx.beginPath();
      ctx.arc(p.x,p.y,ringR, startA, startA+sweep);
      ctx.strokeStyle = hexToRgba(glow, 0.85-i*0.18);
      ctx.lineWidth = 2.8-i*0.5;
      ctx.shadowColor = glow; ctx.shadowBlur = 10;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  } else if(style==='flame'){
    drawFlameTongues(ctx,p,r,t,glow,7,1.1,3.2);
  } else if(style==='orbit'){
    drawOrbitEmbers(ctx,p,r,t,glow,6);
  } else if(style==='chain'){
    // a ring of small tangentially-oriented links, alternating bright/dim to read as interlocking
    const n=10, ringR=r*2.0, spin=t*1.4;
    for(let i=0;i<n;i++){
      const a = spin + (Math.PI*2/n)*i;
      const cx=p.x+Math.cos(a)*ringR, cy=p.y+Math.sin(a)*ringR*0.85;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(a+Math.PI/2);
      ctx.strokeStyle = hexToRgba(glow, i%2===0?0.9:0.45);
      ctx.lineWidth=2.4; ctx.shadowColor=glow; ctx.shadowBlur=6;
      ctx.beginPath(); ctx.ellipse(0,0, r*0.34, r*0.2, 0, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
    ctx.shadowBlur=0;
  } else if(style==='crystal'){
    // spinning diamond shards orbiting the player, each with its own facet highlight
    const n=6;
    for(let i=0;i<n;i++){
      const orbitA = t*0.9 + (Math.PI*2/n)*i;
      const cx=p.x+Math.cos(orbitA)*r*2.1, cy=p.y+Math.sin(orbitA)*r*2.1*0.85;
      const spin = t*2.4 + i*1.3;
      const s = r*0.42;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(spin);
      const g2 = ctx.createLinearGradient(-s,0,s,0);
      g2.addColorStop(0, hexToRgba(glow,0.15)); g2.addColorStop(0.5, hexToRgba('#ffffff',0.9)); g2.addColorStop(1, hexToRgba(glow,0.15));
      ctx.fillStyle = g2; ctx.shadowColor=glow; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.moveTo(0,-s); ctx.lineTo(s*0.6,0); ctx.lineTo(0,s); ctx.lineTo(-s*0.6,0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur=0;
  } else if(style==='prism'){
    // like 'rings' but the hue itself cycles continuously through the spectrum
    for(let i=0;i<3;i++){
      const hue = (t*70 + i*120) % 360;
      const col = `hsl(${hue},90%,62%)`;
      const ringR = r*(1.5+i*0.5);
      const startA = t*(1+i*0.4)*(i%2===0?1:-1);
      ctx.beginPath(); ctx.arc(p.x,p.y,ringR, startA, startA+1.9);
      ctx.strokeStyle = col; ctx.lineWidth=3; ctx.shadowColor=col; ctx.shadowBlur=10;
      ctx.stroke();
    }
    ctx.shadowBlur=0;
  } else if(style==='glitch'){
    // quantized-time RGB-split rectangles - jumps every ~90ms instead of smoothly animating
    const step = Math.floor(t*11);
    const rnd = (seed)=> { const x=Math.sin(seed*12.9898+step*78.233)*43758.5453; return x-Math.floor(x); };
    ctx.globalCompositeOperation='screen';
    for(let i=0;i<5;i++){
      const ang = rnd(i)*Math.PI*2, dist=r*(1.2+rnd(i+10)*1.3);
      const bx=p.x+Math.cos(ang)*dist, by=p.y+Math.sin(ang)*dist*0.8;
      const w=r*(0.5+rnd(i+20)*0.6), h=r*0.22;
      ctx.fillStyle = hexToRgba('#ff2e5b',0.55); ctx.fillRect(bx-w/2-3,by-h/2,w,h);
      ctx.fillStyle = hexToRgba('#2ee6ff',0.55); ctx.fillRect(bx-w/2+3,by-h/2,w,h);
      ctx.fillStyle = hexToRgba(glow,0.8); ctx.fillRect(bx-w/2,by-h/2,w,h);
    }
  } else if(style==='shadow'){
    // dark smoky tendrils with a thin glowing rim - inverted from the usual bright-fill approach
    ctx.globalCompositeOperation='source-over';
    for(let i=0;i<4;i++){
      const a = t*0.7 + i*1.6;
      const dist = r*(1.3+0.4*Math.sin(t*1.5+i));
      const bx=p.x+Math.cos(a)*dist, by=p.y+Math.sin(a)*dist*0.85;
      const g3 = ctx.createRadialGradient(bx,by,0, bx,by, r*1.1);
      g3.addColorStop(0, 'rgba(8,4,14,0.85)'); g3.addColorStop(1,'rgba(8,4,14,0)');
      ctx.fillStyle=g3; ctx.beginPath(); ctx.arc(bx,by,r*1.1,0,Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation='lighter';
    ctx.strokeStyle=hexToRgba(glow,0.5); ctx.lineWidth=1.6; ctx.shadowColor=glow; ctx.shadowBlur=8;
    ctx.beginPath(); ctx.arc(p.x,p.y,r*1.7,0,Math.PI*2); ctx.stroke();
    ctx.shadowBlur=0;
  } else if(style==='burst'){
    // repeating radial shockwave pulses that expand outward and fade
    for(let i=0;i<3;i++){
      const cyc = ((t*0.9+i*0.33)%1);
      const rad = r*0.6 + cyc*r*2.6;
      ctx.beginPath(); ctx.arc(p.x,p.y,rad,0,Math.PI*2);
      ctx.strokeStyle = hexToRgba(glow, (1-cyc)*0.7); ctx.lineWidth=3*(1-cyc)+0.5;
      ctx.shadowColor=glow; ctx.shadowBlur=8; ctx.stroke();
    }
    ctx.shadowBlur=0;
  } else if(style==='wave'){
    // segmented crescent arcs that sweep back and forth like splashing water
    for(let i=0;i<4;i++){
      const baseA = (Math.PI*2/4)*i + t*0.6;
      const sweep = 0.9 + 0.3*Math.sin(t*2+i);
      const ringR = r*1.9;
      ctx.beginPath(); ctx.arc(p.x,p.y,ringR, baseA, baseA+sweep);
      const g4 = ctx.createLinearGradient(p.x-ringR,p.y,p.x+ringR,p.y);
      g4.addColorStop(0, hexToRgba('#ffffff',0.1)); g4.addColorStop(0.5, hexToRgba(glow,0.9)); g4.addColorStop(1, hexToRgba('#ffffff',0.1));
      ctx.strokeStyle=g4; ctx.lineWidth=3.6; ctx.lineCap='round';
      ctx.shadowColor=glow; ctx.shadowBlur=8; ctx.stroke();
    }
    ctx.shadowBlur=0; ctx.lineCap='butt';
  } else if(style==='tornado'){
    // stacked narrowing ellipses forming a funnel, spinning faster near the top
    const layers=8;
    for(let i=0;i<layers;i++){
      const frac = i/(layers-1);
      const yOff = -r*0.4 - frac*r*2.6;
      const wid = r*(1.9 - frac*1.5);
      const spin = t*(2+frac*4) + i*0.7;
      ctx.save(); ctx.translate(p.x, p.y+yOff);
      ctx.beginPath(); ctx.ellipse(0,0, wid, wid*0.32, 0, spin, spin+Math.PI*1.3);
      ctx.strokeStyle = hexToRgba(glow, 0.75-frac*0.5); ctx.lineWidth=2.2;
      ctx.shadowColor=glow; ctx.shadowBlur=6; ctx.stroke();
      ctx.restore();
    }
    ctx.shadowBlur=0;
  } else if(style==='spiral'){
    // logarithmic spiral arms winding inward, traced as polylines
    const arms=3;
    for(let a=0;a<arms;a++){
      ctx.beginPath();
      const rot = t*1.3 + a*(Math.PI*2/arms);
      for(let s=0;s<=24;s++){
        const frac = s/24;
        const ang = rot + frac*Math.PI*3.2;
        const rad = r*2.4*(1-frac*0.85);
        const x=p.x+Math.cos(ang)*rad, y=p.y+Math.sin(ang)*rad*0.88;
        if(s===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.strokeStyle=hexToRgba(glow,0.75); ctx.lineWidth=2;
      ctx.shadowColor=glow; ctx.shadowBlur=7; ctx.stroke();
    }
    ctx.shadowBlur=0;
  } else if(style==='starfield'){
    // twinkling points scattered in an elliptical field, plus one periodic shooting star
    const n=14;
    for(let i=0;i<n;i++){
      const seed=i*13.7;
      const a = seed + t*0.25;
      const rad = r*(1.3 + 1.4*((Math.sin(seed)+1)/2));
      const x=p.x+Math.cos(a)*rad, y=p.y+Math.sin(a)*rad*0.8;
      const tw = 0.4+0.6*Math.max(0,Math.sin(t*4+seed));
      ctx.beginPath(); ctx.arc(x,y, 1.3+tw*1.2, 0, Math.PI*2);
      ctx.fillStyle=hexToRgba('#ffffff',0.5+tw*0.5); ctx.fill();
    }
    const cyc=(t*0.6)%1;
    if(cyc<0.35){
      const sa = -0.6, dist=cyc/0.35;
      const sx=p.x-r*2.2+dist*r*4.4, sy=p.y-r*1.8+dist*r*1.6;
      const g5=ctx.createLinearGradient(sx-r*1.1,sy-r*0.4, sx,sy);
      g5.addColorStop(0,hexToRgba(glow,0)); g5.addColorStop(1,hexToRgba('#ffffff',0.9));
      ctx.strokeStyle=g5; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(sx-r*1.1,sy-r*0.4); ctx.lineTo(sx,sy); ctx.stroke();
    }
  } else if(style==='halo'){
    // a flattened ring hovering above the head, with a soft cone of light falling below it
    const hy = p.y - r*2.6;
    ctx.beginPath(); ctx.ellipse(p.x,hy, r*1.15, r*0.34, 0, 0, Math.PI*2);
    ctx.strokeStyle=hexToRgba(glow,0.9); ctx.lineWidth=3; ctx.shadowColor=glow; ctx.shadowBlur=12; ctx.stroke();
    ctx.shadowBlur=0;
    const g6=ctx.createLinearGradient(p.x,hy,p.x,p.y);
    g6.addColorStop(0,hexToRgba(glow,0.28)); g6.addColorStop(1,hexToRgba(glow,0));
    ctx.fillStyle=g6;
    ctx.beginPath(); ctx.moveTo(p.x-r*0.5,hy); ctx.lineTo(p.x+r*0.5,hy); ctx.lineTo(p.x+r*1.3,p.y); ctx.lineTo(p.x-r*1.3,p.y); ctx.closePath(); ctx.fill();
    for(let i=0;i<5;i++){
      const fa = t*1.5+i*1.3, fx=p.x+Math.sin(fa)*r*0.8, fy = hy + ((t*0.8+i*0.2)%1)*(p.y-hy);
      ctx.beginPath(); ctx.arc(fx,fy,1.6,0,Math.PI*2); ctx.fillStyle=hexToRgba('#ffffff',0.6); ctx.fill();
    }
  } else if(style==='comet'){
    // one bright point with a faked fading trail (offset phase copies, no stored history needed)
    const orbitR=r*2.0, speed=2.2;
    for(let i=8;i>=0;i--){
      const a = t*speed - i*0.12;
      const x=p.x+Math.cos(a)*orbitR, y=p.y+Math.sin(a)*orbitR*0.85;
      const alpha = (1-i/8)*0.85;
      ctx.beginPath(); ctx.arc(x,y, 4.2*(1-i/10), 0, Math.PI*2);
      ctx.fillStyle=hexToRgba(i===0?'#ffffff':glow, alpha); ctx.fill();
    }
  } else if(style==='aurora'){
    // 2-3 flowing horizontal ribbons drifting upward, like polar lights
    for(let band=0;band<3;band++){
      ctx.beginPath();
      const yBase = p.y - r*0.8 - band*r*0.55 - ((t*18+band*30)%(r*3));
      for(let s=0;s<=16;s++){
        const frac=s/16, x=p.x-r*2.2+frac*r*4.4;
        const y=yBase+Math.sin(frac*Math.PI*2+t*2+band)*r*0.35;
        if(s===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      const hue=(140+band*60+t*20)%360;
      ctx.strokeStyle=`hsla(${hue},85%,65%,0.55)`; ctx.lineWidth=4;
      ctx.shadowColor=`hsl(${hue},85%,60%)`; ctx.shadowBlur=9; ctx.stroke();
    }
    ctx.shadowBlur=0;
  } else if(style==='marble'){
    // a soft solid-ish sphere with swirling marble texture (several overlapping soft blobs)
    ctx.beginPath(); ctx.arc(p.x,p.y,r*1.5,0,Math.PI*2);
    const gBase=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r*1.5);
    gBase.addColorStop(0,hexToRgba(glow,0.35)); gBase.addColorStop(1,hexToRgba(glow,0.05));
    ctx.fillStyle=gBase; ctx.fill();
    for(let i=0;i<5;i++){
      const a=t*0.8+i*1.7, sr=r*(0.35+0.25*Math.sin(t+i));
      const x=p.x+Math.cos(a)*r*0.6, y=p.y+Math.sin(a)*r*0.6*0.8;
      const g7=ctx.createRadialGradient(x,y,0,x,y,sr);
      g7.addColorStop(0,hexToRgba('#ffffff',0.35)); g7.addColorStop(1,hexToRgba('#ffffff',0));
      ctx.fillStyle=g7; ctx.beginPath(); ctx.arc(x,y,sr,0,Math.PI*2); ctx.fill();
    }
    ctx.strokeStyle=hexToRgba(glow,0.6); ctx.lineWidth=1.5; ctx.shadowColor=glow; ctx.shadowBlur=8;
    ctx.beginPath(); ctx.arc(p.x,p.y,r*1.5,0,Math.PI*2); ctx.stroke(); ctx.shadowBlur=0;
  } else if(style==='cage'){
    // procedural jagged lightning bolts forming a crackling net/cage around the player
    const nodes=6, radius=r*2.1, segs=4;
    const pts=[];
    for(let i=0;i<nodes;i++){
      const a=(Math.PI*2/nodes)*i + t*0.4;
      pts.push([p.x+Math.cos(a)*radius, p.y+Math.sin(a)*radius*0.85]);
    }
    ctx.strokeStyle=hexToRgba(glow,0.85); ctx.lineWidth=1.8; ctx.shadowColor=glow; ctx.shadowBlur=9;
    for(let i=0;i<nodes;i++){
      const [x1,y1]=pts[i], [x2,y2]=pts[(i+1)%nodes];
      ctx.beginPath(); ctx.moveTo(x1,y1);
      for(let s=1;s<segs;s++){
        const frac=s/segs;
        const mx=x1+(x2-x1)*frac, my=y1+(y2-y1)*frac;
        const jag=Math.sin(t*30+i*7+s*3)*r*0.18;
        const nx=-(y2-y1), ny=(x2-x1); const nl=Math.hypot(nx,ny)||1;
        ctx.lineTo(mx+nx/nl*jag, my+ny/nl*jag);
      }
      ctx.lineTo(x2,y2); ctx.stroke();
    }
    ctx.shadowBlur=0;
  } else if(style==='runes'){
    // concentric rings with tick-mark "runes", each ring spinning at a different rate
    for(let ring=0;ring<3;ring++){
      const ringR = r*(1.4+ring*0.5);
      const spin = t*(0.5+ring*0.4)*(ring%2===0?1:-1);
      ctx.beginPath(); ctx.arc(p.x,p.y,ringR,0,Math.PI*2);
      ctx.strokeStyle=hexToRgba(glow,0.35); ctx.lineWidth=1; ctx.stroke();
      const n=8+ring*2;
      for(let i=0;i<n;i++){
        const a=spin+(Math.PI*2/n)*i;
        const x1=p.x+Math.cos(a)*(ringR-3), y1=p.y+Math.sin(a)*(ringR-3)*0.9;
        const x2=p.x+Math.cos(a)*(ringR+3), y2=p.y+Math.sin(a)*(ringR+3)*0.9;
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
        ctx.strokeStyle=hexToRgba(glow,0.85); ctx.lineWidth=1.6; ctx.shadowColor=glow; ctx.shadowBlur=5; ctx.stroke();
      }
    }
    ctx.shadowBlur=0;
  } else if(style==='wings'){
    // two feathered wing shapes spreading from behind the player
    for(const side of [-1,1]){
      for(let f=0;f<5;f++){
        const spread = (f/4);
        const flap = Math.sin(t*3+f*0.4)*0.15;
        const baseA = Math.PI/2 + side*(0.5+spread*0.9) + flap*side;
        const len = r*(1.6+spread*1.1);
        const x1=p.x, y1=p.y-r*0.2;
        const cx=p.x+Math.cos(baseA)*len*0.6*side*side, cy=p.y-r*0.2-Math.sin(baseA)*len*0.3;
        const x2=p.x+side*Math.cos(spread*1.1)*len, y2=p.y-r*0.2-Math.sin(0.3+spread*0.8)*len;
        ctx.beginPath(); ctx.moveTo(x1,y1);
        ctx.quadraticCurveTo(p.x+side*len*0.5, p.y-r*0.2-len*0.25, x2,y2);
        ctx.strokeStyle=hexToRgba(glow,0.7-spread*0.35); ctx.lineWidth=2.6-spread*1.2;
        ctx.shadowColor=glow; ctx.shadowBlur=7; ctx.stroke();
      }
    }
    ctx.shadowBlur=0;
  } else if(style==='dragon'){
    // premium dual-layer flame: bigger gold outer tongues + red inner tongues + rising embers
    drawFlameTongues(ctx,p,r,t,'#ffd166',10,1.4,3.8);
    drawFlameTongues(ctx,p,r*0.7,t+0.5,'#ff4d4d',8,1.7,2.6);
    for(let i=0;i<6;i++){
      const cyc=((t*0.7+i*0.17)%1);
      const ex=p.x+Math.sin(i*2.1)*r*0.9, ey=p.y-cyc*r*3.2;
      ctx.beginPath(); ctx.arc(ex,ey,2.2*(1-cyc),0,Math.PI*2);
      ctx.fillStyle=hexToRgba('#ffd166',(1-cyc)*0.8); ctx.fill();
    }
  } else if(style==='blackfire'){
    // inverted flame: near-black tongues with only the tips actually lit - genuinely
    // different compositing (source-over for the dark body, lighter for the glowing tip)
    const n=8;
    for(let i=0;i<n;i++){
      const baseA=(Math.PI*2/n)*i;
      const flick=0.5+0.5*Math.sin(t*7+i*1.9);
      const len=r*(1.4+flick*1.2);
      const ang=baseA+Math.sin(t*2.5+i)*0.22;
      const x1=p.x+Math.cos(ang)*r*0.65, y1=p.y+Math.sin(ang)*r*0.65;
      const xm=p.x+Math.cos(ang)*(r*0.65+len*0.7), ym=p.y+Math.sin(ang)*(r*0.65+len*0.7);
      const x2=p.x+Math.cos(ang)*(r*0.65+len), y2=p.y+Math.sin(ang)*(r*0.65+len);
      ctx.globalCompositeOperation='source-over';
      ctx.strokeStyle='rgba(6,2,10,0.92)'; ctx.lineWidth=4.5;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(xm,ym); ctx.stroke();
      ctx.globalCompositeOperation='lighter';
      const gt=ctx.createLinearGradient(xm,ym,x2,y2);
      gt.addColorStop(0,hexToRgba(glow,0.7)); gt.addColorStop(1,hexToRgba(glow,0));
      ctx.strokeStyle=gt; ctx.lineWidth=2.6; ctx.shadowColor=glow; ctx.shadowBlur=10;
      ctx.beginPath(); ctx.moveTo(xm,ym); ctx.lineTo(x2,y2); ctx.stroke();
    }
    ctx.shadowBlur=0;
  } else if(style==='vip'){
    // the ultimate combo aura: golden halo + sunburst rays + double rotating rings + sparkles
    const rayN=12;
    for(let i=0;i<rayN;i++){
      const a=(Math.PI*2/rayN)*i+t*0.5;
      const len=r*(2.0+0.3*Math.sin(t*3+i));
      const x1=p.x+Math.cos(a)*r*0.9, y1=p.y+Math.sin(a)*r*0.9;
      const x2=p.x+Math.cos(a)*len, y2=p.y+Math.sin(a)*len;
      const gr=ctx.createLinearGradient(x1,y1,x2,y2);
      gr.addColorStop(0,hexToRgba('#f6dd8a',0.55)); gr.addColorStop(1,hexToRgba('#f6dd8a',0));
      ctx.strokeStyle=gr; ctx.lineWidth=2.2; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
    for(let i=0;i<2;i++){
      const ringR=r*(1.6+i*0.5), spin=t*(1+i*0.6)*(i%2===0?1:-1);
      ctx.beginPath(); ctx.arc(p.x,p.y,ringR,spin,spin+2.3);
      ctx.strokeStyle=hexToRgba('#f6dd8a',0.8-i*0.2); ctx.lineWidth=2.6;
      ctx.shadowColor='#f6dd8a'; ctx.shadowBlur=12; ctx.stroke();
    }
    ctx.shadowBlur=0;
    const hy=p.y-r*2.6;
    ctx.beginPath(); ctx.ellipse(p.x,hy,r*1.1,r*0.3,0,0,Math.PI*2);
    ctx.strokeStyle=hexToRgba('#fff5cf',0.95); ctx.lineWidth=3; ctx.shadowColor='#fff5cf'; ctx.shadowBlur=14; ctx.stroke();
    ctx.shadowBlur=0;
    for(let i=0;i<8;i++){
      const seed=i*11.3, a=seed+t*0.6, rad=r*(1.2+1.1*((Math.sin(seed)+1)/2));
      const x=p.x+Math.cos(a)*rad, y=p.y+Math.sin(a)*rad*0.8;
      const tw=0.4+0.6*Math.max(0,Math.sin(t*5+seed));
      ctx.beginPath(); ctx.arc(x,y,1.4+tw*1.3,0,Math.PI*2);
      ctx.fillStyle=hexToRgba('#fff5cf',0.5+tw*0.5); ctx.fill();
    }
  }
  ctx.restore();
}
function drawFlameTongues(ctx,p,r,t,glow,n,flickSpeed,lineW){
  for(let i=0;i<n;i++){
    const baseA = (Math.PI*2/n)*i;
    const flick = 0.5+0.5*Math.sin(t*8*flickSpeed*0.14+i*1.7);
    const len = r*(1.3+flick*1.1);
    const ang = baseA + Math.sin(t*3+i)*0.25;
    const x1 = p.x+Math.cos(ang)*r*0.7, y1 = p.y+Math.sin(ang)*r*0.7;
    const x2 = p.x+Math.cos(ang)*(r*0.7+len), y2 = p.y+Math.sin(ang)*(r*0.7+len);
    const g2 = ctx.createLinearGradient(x1,y1,x2,y2);
    g2.addColorStop(0, hexToRgba(glow,0.75)); g2.addColorStop(1, hexToRgba(glow,0));
    ctx.strokeStyle = g2; ctx.lineWidth = lineW;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }
}
function drawOrbitEmbers(ctx,p,r,t,glow,n){
  for(let i=0;i<n;i++){
    const a = t*(1.3+i*0.22) + i*(Math.PI*2/n);
    const rad = r*(1.9 + 0.55*Math.sin(t*2+i));
    const ex = p.x+Math.cos(a)*rad, ey = p.y+Math.sin(a)*rad*0.88;
    ctx.beginPath(); ctx.arc(ex,ey, 3.4, 0, Math.PI*2);
    ctx.fillStyle = hexToRgba(glow, 0.55); ctx.fill();
    ctx.beginPath(); ctx.arc(ex,ey, 1.5+Math.sin(t*5+i)*0.5, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
  }
}
function charAvatarHTML(ch, sizePx){
  const initial = (ch.name||'?').charAt(0).toUpperCase();
  const color = RANK_COLORS[ch.rank] || '#9aa0a8';
  return `<span class="char-avatar" style="width:${sizePx}px;height:${sizePx}px;">
    <span class="fallback-letter" style="background:${color}33;color:${color};font-size:${Math.round(sizePx*0.42)}px;">${initial}</span>
    <img src="${ch.img}" alt="${ch.name}" onerror="this.style.display='none';">
  </span>`;
}
function getCharacterBonus(key){
  if(!account || !account.equippedCharacterId) return 0;
  const ch = CHARACTERS[account.equippedCharacterId];
  if(!ch) return 0;
  const base = { speed: PLAYER_SPEED, kickPower: KICK_BASE, power: 1.0, control: 0 };
  return ch[key] - base[key];
}
function computeEffectiveStats(){
  const base = { speed: PLAYER_SPEED, kickPower: KICK_BASE, power: 1.0, control: 0 };
  const perLevel = { speed: SPEED_PER_LEVEL, kickPower: KICK_POWER_BONUS, power: 0.08, control: 0.05 };
  const out = {};
  STAT_KEYS.forEach(key=>{
    const lvl = account ? getStatsObj()[key] : 0;
    let val = base[key] + lvl*perLevel[key] + getCharacterBonus(key);
    if(key==='control') val = Math.min(1.0, val);
    out[key] = val;
  });
  return out;
}
function formatStatValue(key, val){
  if(key==='power' || key==='control') return Math.round(val*100)+'%';
  return val.toFixed(2);
}

// Player Statistics panel - now rendered into BOTH the dedicated hub "Skill" screen AND a tab inside
// the Shop, so both entry points stay in sync automatically whenever either is opened or a purchase happens.
function renderPlayerStats(){
  if(!account) return;
  const totalLevels = totalStatLevels();
  const effective = computeEffectiveStats();
  const activeCharName = account.equippedCharacterId && CHARACTERS[account.equippedCharacterId] ? CHARACTERS[account.equippedCharacterId].name : (LANG==='uz'?'Asosiy o\'yinchi':LANG==='ru'?'Базовый игрок':'Base player');
  const targets = ['playerStatsPanel','shopSkillsPanel'].map(id=>document.getElementById(id)).filter(Boolean);
  targets.forEach(sp=>{
    sp.innerHTML=`<div class="stat-char-label">${LANG==='uz'?'Skill\'lar quyidagi o\'yinchi uchun':LANG==='ru'?'Навыки для игрока':'Skills for'}: <b>${escapeHtml(activeCharName)}</b></div>`;
    STAT_KEYS.forEach(key=>{
      const lvl = getStatsObj()[key];
      const row = document.createElement('div'); row.className='stat-row';
      let pips=''; for(let i=0;i<5;i++) pips += `<div class="pip ${i<lvl?'filled':''}"></div>`;
      const maxedOverall = totalLevels>=15;
      const maxedThis = lvl>=5;
      row.innerHTML = `<div class="head"><b>${t(key)}</b><span class="stat-value">${formatStatValue(key, effective[key])}</span></div>
        <div class="pips">${pips}<span class="stat-lvl-sub">Lvl ${lvl}/5</span></div>
        <button class="buy-btn ${(maxedThis||maxedOverall)?'maxed':''}">${(maxedThis||maxedOverall)? t('maxed') : 'Skill up (1500)'}</button>`;
      row.querySelector('button').addEventListener('click', async ()=>{
        if(account.coins<1500){ flashMsg(LANG==='uz'?'Ecoin yetarli emas':LANG==='ru'?'Недостаточно Ecoin':'Not enough Ecoin'); return; }
        const stats = getStatsObj();
        if(stats[key]>=5 || totalStatLevels()>=15) return;
        account.coins -= 1500; stats[key]++;
        await persistAccount(); renderPlayerStats(); updateCoinDisplays();
      });
      sp.appendChild(row);
    });
  });
}
function renderShop(){
  if(!account) return;
  updateCoinDisplays();
  renderPlayerStats();
  const cp = document.getElementById('colorsPanel'); cp.innerHTML='';
  const grid = document.createElement('div'); grid.className='colorgrid';
  COLORS.forEach((hex,idx)=>{
    const owned = account.colors.includes(idx);
    const equipped = account.equippedColor===idx;
    const cell = document.createElement('div');
    cell.className = 'colorcell'+(owned?' owned':'')+(equipped?' equipped':'');
    cell.style.background = hex;
    if(!owned) cell.innerHTML = '<div class="lock">500</div>';
    cell.addEventListener('click', async ()=>{
      if(!owned){
        if(account.coins<500){ flashMsg(LANG==='uz'?'Ecoin yetarli emas':LANG==='ru'?'Недостаточно Ecoin':'Not enough Ecoin'); return; }
        account.coins-=500; account.colors.push(idx); account.equippedColor=idx;
      } else { account.equippedColor = idx; }
      account.avatarRing = 'color';
      await persistAccount(); renderShop(); renderProfileBadge(); renderHubPlayerBadge();
    });
    grid.appendChild(cell);
  });
  cp.appendChild(grid);

  const fp = document.getElementById('framesPanel'); fp.innerHTML='';
  const fgrid = document.createElement('div'); fgrid.className='colorgrid';
  FRAMES.forEach((fr,idx)=>{
    const owned = (account.framesOwned||[]).includes(idx);
    const equipped = account.frame===idx;
    const cell = document.createElement('div');
    cell.className = 'frame-cell '+fr.cls+(equipped?' equipped':'');
    if(equipped) cell.style.boxShadow = '0 0 0 2px var(--gold)';
    if(!owned) cell.innerHTML = `<div class="lock">${fr.price}</div>`;
    cell.addEventListener('click', async ()=>{
      if(!owned){
        if(account.coins<fr.price){ flashMsg(LANG==='uz'?'Ecoin yetarli emas':LANG==='ru'?'Недостаточно Ecoin':'Not enough Ecoin'); return; }
        account.coins-=fr.price; account.framesOwned=account.framesOwned||[]; account.framesOwned.push(idx); account.frame=idx;
      } else { account.frame = idx; }
      account.avatarRing = 'frame';
      await persistAccount(); renderShop(); renderProfileBadge();
    });
    fgrid.appendChild(cell);
  });
  fp.appendChild(fgrid);
}
function flashMsg(msg){
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#c11f2b;color:#fff;padding:10px 20px;border-radius:8px;z-index:99;font-weight:700;';
  document.body.appendChild(el); setTimeout(()=>el.remove(),2200);
}

