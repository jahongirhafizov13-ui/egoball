// ============================================================================
// economy-ui.js - Donate/Ecoin store + OpenCase
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= DONATE / ECOIN STORE ============================= */
const DONATE_TIERS = [
  {ecoin:'1,000', price:'0.99$'},
  {ecoin:'5,000', price:'4.88$'},
  {ecoin:'10,000', price:'9.55$'},
  {ecoin:'20,000', price:'18.80$'}
];
const DONATE_TELEGRAM_URL = 'https://t.me/EgoBall';
function renderDonateTiers(){
  const box = document.getElementById('donateTierList');
  if(!box) return;
  box.innerHTML = DONATE_TIERS.map(tr=>`
    <div class="hubrow donate-tier" style="cursor:pointer;">
      <span>${tr.ecoin} Ecoin</span>
      <span class="cnt">${tr.price}</span>
    </div>
  `).join('');
  box.querySelectorAll('.donate-tier').forEach((el,i)=>{
    el.addEventListener('click', ()=> openDonateConfirm(DONATE_TIERS[i]));
  });
}
function openDonateConfirm(tier){
  const msg = LANG==='uz'
    ? `${tier.ecoin} Ecoin (${tier.price}) sotib olish uchun Telegram kanalimizga o'tasiz. Davom etasizmi?`
    : LANG==='ru'
    ? `Чтобы купить ${tier.ecoin} Ecoin (${tier.price}), вы перейдёте в наш Telegram-канал. Продолжить?`
    : `To buy ${tier.ecoin} Ecoin (${tier.price}) you'll be taken to our Telegram channel. Continue?`;
  if(confirm(msg)){ window.open(DONATE_TELEGRAM_URL, '_blank'); }
}
document.getElementById('coinBadgeMain').addEventListener('click', ()=>{
  renderDonateTiers();
  document.getElementById('donateOverlay').style.display='flex';
});
document.getElementById('gcoinBadgeMain').addEventListener('click', openCasePanel);
document.getElementById('btnDonateClose').addEventListener('click', ()=>{
  document.getElementById('donateOverlay').style.display='none';
});

/* ============================= OPENCASE ============================= */
const CASE_CARD_W = 84, CASE_CARD_GAP = 8, CASE_STEP = CASE_CARD_W+CASE_CARD_GAP;
const CASE_TARGET_INDEX = 40; // winner always lands at this slot in the generated strip
let caseSpinning = false;
function randomCharacterId(){ const ids=Object.keys(CHARACTERS); return ids[Math.floor(Math.random()*ids.length)]; }
function caseCardHTML(ch, isWinnerSlot){
  return `<div class="case-item-card" ${isWinnerSlot?'id="caseWinnerCard"':''} style="border-color:${RANK_COLORS[ch.rank]}">
    ${charAvatarHTML(ch, 52)}
    <div class="case-item-name">${ch.name}</div>
    <div class="rk" style="color:${RANK_COLORS[ch.rank]}">${ch.rank}</div>
  </div>`;
}
function renderCaseOddsGrid(){
  const grid = document.getElementById('caseOddsGrid');
  if(!grid) return;
  const sorted = Object.values(CHARACTERS).sort((a,b)=> b.chance-a.chance);
  grid.innerHTML = sorted.map(ch=>{
    const glow = RANK_COLORS[ch.rank] || '#9aa0a8';
    return `<div class="case-odds-row">
      <div class="char-avatar" style="--glow:${glow};">
        <span class="fallback-letter" style="background:${glow}33;color:${glow};font-size:22px;">${(ch.name||'?').charAt(0).toUpperCase()}</span>
        <img src="${ch.img}" alt="${escapeHtml(ch.name)}" onerror="this.style.display='none';">
      </div>
      <div class="odds-main">
        <div class="odds-name">${escapeHtml(ch.name)}</div>
        <div class="odds-rank-chance">
          <span style="color:${glow};">${ch.rank}</span>
          <span style="color:var(--txt-dim);">· ${ch.chance}%</span>
        </div>
        <div class="odds-stats">
          <div>Speed: <b>${ch.speed.toFixed(2)}</b></div>
          <div>Kick: <b>${ch.kickPower.toFixed(2)}</b></div>
          <div>Power: <b>${Math.round(ch.power*100)}%</b></div>
          <div>Control: <b>${Math.round(ch.control*100)}%</b></div>
        </div>
      </div>
    </div>`;
  }).join('');
}
function openCasePanel(){
  document.getElementById('caseGcoinBalance').textContent = account? (account.gcoin||0) : 0;
  document.getElementById('caseReveal').style.display='none';
  document.getElementById('btnCaseOpenGo').style.display='block';
  renderCaseOddsGrid();
  const track = document.getElementById('caseTrack');
  track.style.transition='none';
  track.innerHTML='';
  const previewCount = 16;
  let html='';
  for(let i=0;i<previewCount;i++) html += caseCardHTML(CHARACTERS[randomCharacterId()], false);
  track.innerHTML = html;
  requestAnimationFrame(()=>{
    const viewportW = document.getElementById('caseTrackViewport').clientWidth;
    const stripW = previewCount*CASE_STEP - CASE_CARD_GAP;
    track.style.transform = `translateX(${(viewportW-stripW)/2}px)`;
  });
  document.getElementById('caseOverlay').style.display='flex';
}
async function runCaseSpin(){
  if(caseSpinning || !account) return;
  if((account.gcoin||0) < CASE_COST_GCOIN){
    flashMsg(LANG==='uz'?"G Coin yetarli emas":(LANG==='ru'?'Недостаточно G Coin':'Not enough G Coin'));
    return;
  }
  caseSpinning = true;
  document.getElementById('btnCaseOpenGo').style.display='none';
  document.getElementById('caseReveal').style.display='none';

  socket.emit('openCase', {}, (res)=>{
    if(!res || !res.ok){
      caseSpinning=false;
      document.getElementById('btnCaseOpenGo').style.display='block';
      const errMsgs = { not_enough_gcoin:"G Coin yetarli emas", not_logged_in:"Qayta kiring", server_error:"Server xatosi" };
      flashMsg(errMsgs[res&&res.error] || "Xatolik yuz berdi");
      return;
    }
    account.gcoin = res.gcoin;
    document.getElementById('caseGcoinBalance').textContent = account.gcoin;
    const winnerData = res.item; // authoritative result from the server
    const winner = CHARACTERS[winnerData.id];

    // build a long filler strip of random cards with the real winner fixed at CASE_TARGET_INDEX
    const track = document.getElementById('caseTrack');
    let html = '';
    for(let i=0;i<70;i++){
      const ch = (i===CASE_TARGET_INDEX) ? winner : CHARACTERS[randomCharacterId()];
      html += caseCardHTML(ch, i===CASE_TARGET_INDEX);
    }
    track.style.transition='none';
    track.style.transform='translateX(0px)';
    track.innerHTML = html;
    void track.offsetWidth; // force reflow so the transition below actually animates from 0

    const viewportW = document.getElementById('caseTrackViewport').clientWidth;
    // small random jitter so it doesn't always stop dead-center of the card, feels more "alive"
    const jitter = (Math.random()-0.5) * (CASE_CARD_W*0.5);
    const targetX = -(CASE_TARGET_INDEX*CASE_STEP + CASE_CARD_W/2 - viewportW/2) + jitter;

    requestAnimationFrame(()=>{
      track.style.transition = 'transform 4.2s cubic-bezier(0.12,0.72,0.15,1)';
      track.style.transform = `translateX(${targetX}px)`;
    });
    (function scheduleCaseTicks(totalMs){
      let elapsed=0, interval=55;
      (function tick(){
        if(elapsed >= totalMs-150) return;
        playSfx('casetick');
        interval = Math.min(240, interval*1.09);
        elapsed += interval;
        setTimeout(tick, interval);
      })();
    })(4200);

    setTimeout(()=>{
      caseSpinning = false;
      const glowColor = RANK_COLORS[winner.rank];
      const winnerEl = document.getElementById('caseWinnerCard');
      if(winnerEl){ winnerEl.style.setProperty('--glow-color', glowColor); winnerEl.classList.add('winner-glow'); }
      const flash = document.getElementById('caseWinFlash');
      flash.style.setProperty('--glow-color', glowColor);
      flash.classList.remove('fire'); void flash.offsetWidth; flash.classList.add('fire');
      const revealImg = document.getElementById('caseRevealImg');
      revealImg.style.display='block';
      revealImg.src = winner.img;
      const fb = document.getElementById('caseRevealFallback');
      fb.textContent = (winner.name||'?').charAt(0).toUpperCase();
      fb.style.background = glowColor+'33';
      fb.style.color = glowColor;
      document.getElementById('caseRevealName').textContent = winner.name + (winnerData.alreadyOwned? ' (takror)':'');
      const rankEl = document.getElementById('caseRevealRank');
      rankEl.textContent = winner.rank;
      rankEl.style.background = RANK_COLORS[winner.rank]+'33';
      rankEl.style.color = RANK_COLORS[winner.rank];
      document.getElementById('caseRevealStats').innerHTML = `
        <div>Speed: <b>${winner.speed.toFixed(2)}</b></div>
        <div>Kick: <b>${winner.kickPower.toFixed(2)}</b></div>
        <div>Power: <b>${Math.round(winner.power*100)}%</b></div>
        <div>Control: <b>${Math.round(winner.control*100)}%</b></div>
      `;
      const revealCard = document.getElementById('caseRevealCard');
      revealCard.classList.toggle('myth-card', winner.rank==='Myth');
      revealCard.querySelectorAll('.myth-bolt').forEach(b=>b.remove());
      if(winner.rank==='Myth'){
        ['b1','b2','b3'].forEach(cls=>{
          const bolt = document.createElement('div'); bolt.className = 'myth-bolt '+cls;
          revealCard.appendChild(bolt);
        });
      }
      const dupRow = document.getElementById('caseDuplicateRow');
      if(winnerData.alreadyOwned && res.duplicateBonus){
        account.coins = res.coins;
        updateCoinDisplays();
        if(dupRow){ dupRow.style.display='block'; dupRow.textContent = `Takror chiqdi: +${res.duplicateBonus} Ecoin`; }
      } else if(dupRow){ dupRow.style.display='none'; }
      account.skinsOwned = account.skinsOwned || [];
      if(!account.skinsOwned.includes(winner.id)) account.skinsOwned.push(winner.id);
      document.getElementById('caseReveal').style.display='flex';
      playSfx('casewin');
      if(winner.rank==='Legendary') setTimeout(()=>playSfx('goal'), 120);
      if(winner.rank==='Myth'){ setTimeout(()=>playSfx('goal'), 120); setTimeout(()=>playSfx('goal'), 320); }
    }, 4300);
  });
}
document.getElementById('btnOpenCase').addEventListener('click', openCasePanel);
document.getElementById('btnCaseClose').addEventListener('click', ()=>{
  if(caseSpinning) return;
  document.getElementById('caseOverlay').style.display='none';
});
document.getElementById('caseXClose').addEventListener('click', ()=>{
  if(caseSpinning) return;
  document.getElementById('caseOverlay').style.display='none';
});
document.getElementById('rankChip').addEventListener('click', ()=>{
  if(!account) return;
  const rInfo = getRankInfo(account.cups||0);
  document.getElementById('rankBadgeBig').innerHTML = rankBadgeSVG(rInfo.tierIndex, rInfo.division, 100);
  const divRoman = rInfo.division? ' '+['','I','II','III','IV','V'][rInfo.division] : '';
  document.getElementById('rankBigName').textContent = rInfo.tier.name + divRoman;
  document.getElementById('rankBigCups').textContent = rInfo.totalCups + ' Cup';
  if(rInfo.cupsForDiv){
    const pct = Math.min(100, Math.round(rInfo.cupsIntoDiv/rInfo.cupsForDiv*100));
    document.getElementById('rankProgressBar').style.width = pct+'%';
    document.getElementById('rankProgressText').textContent = `${rInfo.cupsIntoDiv} / ${rInfo.cupsForDiv} - keyingi darajaga`;
  } else {
    document.getElementById('rankProgressBar').style.width = '100%';
    document.getElementById('rankProgressText').textContent = "Eng yuqori daraja - cheksiz yig'iladi";
  }
  document.getElementById('rankOverlay').style.display='flex';
  renderRankLadder(rInfo.tierIndex);
});
function renderRankLadder(currentTierIndex){
  const list = document.getElementById('rankLadderList'); list.innerHTML='';
  // walk tiers from the top (Legendary) down to Player Rank, like a proper ladder
  for(let i=RANK_TIERS.length-1;i>=0;i--){
    const tier = RANK_TIERS[i];
    const isCurrent = i===currentTierIndex;
    const cupFrom = RANK_TIERS.slice(0,i).reduce((sum,t)=> sum + t.perDiv*5, 0);
    const cupRange = tier.perDiv ? `${cupFrom} - ${cupFrom+tier.perDiv*5} Cup` : `${cupFrom}+ Cup`;
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;
      background:${isCurrent?'rgba(224,177,60,.16)':'rgba(255,255,255,.04)'};
      border:1px solid ${isCurrent?'rgba(224,177,60,.5)':'rgba(255,255,255,.06)'};`;
    row.innerHTML = `${rankBadgeSVG(i, tier.perDiv?3:null, 38)}
      <div style="text-align:left;flex:1;">
        <div style="font-size:13px;font-weight:${isCurrent?800:600};color:${isCurrent?'var(--gold2)':'var(--txt)'};">${tier.name}</div>
        <div style="font-size:11px;color:var(--txt-dim);">${cupRange}</div>
      </div>
      ${isCurrent?'<span style="font-size:10px;color:var(--gold);font-weight:800;">SIZ</span>':''}`;
    list.appendChild(row);
  }
}
document.getElementById('rankXClose').addEventListener('click', ()=>{
  document.getElementById('rankOverlay').style.display='none';
});
document.getElementById('btnCaseOpenGo').addEventListener('click', runCaseSpin);
document.getElementById('caseOpenAgain').addEventListener('click', runCaseSpin);
document.getElementById('caseEquipNow').addEventListener('click', async ()=>{
  const img = document.getElementById('caseRevealImg').src;
  const winner = Object.values(CHARACTERS).find(c=> img.endsWith(c.img));
  if(!winner) return;
  socket.emit('equipCharacter', {characterId: winner.id}, (res)=>{
    if(res && res.ok){
      account.equippedCharacterId = winner.id;
      flashMsg(LANG==='uz'?`${winner.name} kiyildi`:(LANG==='ru'?`${winner.name} надет`:`${winner.name} equipped`));
      renderPlayerStats();
      renderProfileBadge();
    }
  });
});

