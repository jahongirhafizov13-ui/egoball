// ============================================================================
// match-ui.js - In-match roster + chat overlay
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= ROSTER / CHAT (in-match) ============================= */
document.getElementById('btnMenuRoster').addEventListener('click', ()=>{
  renderRoster();
  const testBtn = document.getElementById('btnTestAura');
  testBtn.style.display = (account && account.equippedAura) ? 'block' : 'none';
  document.getElementById('rosterOverlay').classList.add('show');
});
document.getElementById('btnTestAura').addEventListener('click', ()=>{
  const human = window.__humanPlayer;
  if(!human || !account || !account.equippedAura){ flashMsg("Avval do'konda aura kiying"); return; }
  human.auraId = account.equippedAura;
  human.auraUntil = Date.now() + AURA_GOAL_DURATION_MS;
  document.getElementById('rosterOverlay').classList.remove('show');
});
document.getElementById('btnRosterClose').addEventListener('click', ()=> document.getElementById('rosterOverlay').classList.remove('show'));
document.getElementById('btnMatchSettings').addEventListener('click', ()=>{
  document.getElementById('rosterOverlay').classList.remove('show');
  settingsOpenedInMatch = true;
  document.getElementById('screen-settings').classList.remove('hidden');
});
document.getElementById('btnChatToggle').addEventListener('click', ()=>{ document.getElementById('chatOverlay').classList.toggle('show'); refreshChat(); });
document.getElementById('chatCloseBtn').addEventListener('click', ()=>{ document.getElementById('chatOverlay').classList.remove('show'); });
document.getElementById('chatSend').addEventListener('click', sendChat);
document.getElementById('chatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });
function sendChat(){
  const inp = document.getElementById('chatInput');
  const msg = inp.value.trim(); if(!msg) return;
  inp.value='';
  if(matchType==='multi' && roomCode){
    socket.emit('chatMessage', {code:roomCode, name:playerDisplayName, msg});
  } else {
    localChat.push({name:playerDisplayName, msg});
    refreshChat();
  }
}
let localChat = [];
let multiChatCache = [];
socket.on('chatUpdate', (chat)=>{ multiChatCache = chat; refreshChat(); });
function refreshChat(){
  const log = document.getElementById('chatLog');
  const msgs = (matchType==='multi' && roomCode) ? multiChatCache : localChat;
  log.innerHTML = msgs.map(m=>{
    if(m.sys) return `<div class="sys">${escapeHtml(m.msg)}</div>`;
    const rInfo = getRankInfo(m.cups||0);
    const badge = rankBadgeSVG(rInfo.tierIndex, rInfo.division, 15);
    return `<div class="chat-line">
      <span class="chat-rank-badge" data-name="${escapeHtml(m.name)}" title="${escapeHtml(rInfo.tier.short)} · LV${m.level||1}">${badge}</span>
      <b class="hub-name" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}:</b> ${escapeHtml(m.msg)}
    </div>`;
  }).join('');
  log.scrollTop = log.scrollHeight;
  log.querySelectorAll('.hub-name, .chat-rank-badge').forEach(el=>{
    el.addEventListener('click', ()=> openProfileByName(el.getAttribute('data-name')));
  });
}
function renderRoster(){
  const colSpec = document.getElementById('colSpectators');
  const colA = document.getElementById('colTeamA');
  const colB = document.getElementById('colTeamB');
  colSpec.innerHTML = `<h4>${t('spectatorsCol')}</h4>`;
  colA.innerHTML = `<h4>Team A</h4>`;
  colB.innerHTML = `<h4>Team B</h4>`;
  const canDrag = (matchType==='bots') || (matchType==='multi' && isHost && !roomIsPublic);
  document.getElementById('rosterHintTxt').textContent = canDrag? t('rosterHint') : t('rosterHintReadonly');
  const roster = matchType==='multi' ? (window.__roomRosterCache||[]) : players.map(p=>({name:p.isHuman?playerDisplayName:('Bot '+p.num), team:p.team, spectator:false, ref:p}));
  roster.forEach(p=>{
    const chip = document.createElement('div'); chip.className='roster-chip'+(canDrag?'':' locked');
    const label = document.createElement('span'); label.textContent = p.name; chip.appendChild(label);
    chip.draggable = canDrag;
    chip.addEventListener('dragstart', ()=>{ draggedChip = p; chip.classList.add('dragging'); });
    chip.addEventListener('dragend', ()=> chip.classList.remove('dragging'));
    // real kick/removal - not just reassigning to spectator - admin only, never available on public servers
    if(canDrag && !(p.ref && p.ref.isHuman) && p.id!==myId){
      const kickBtn = document.createElement('span');
      kickBtn.textContent = '✕'; kickBtn.className='roster-kick'; kickBtn.title = t('kickPlayer');
      kickBtn.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(matchType==='bots' && p.ref){
          const idx = players.indexOf(p.ref);
          if(idx>=0) players.splice(idx,1);
          renderRoster();
        } else if(matchType==='multi' && p.id){
          socket.emit('kickPlayer', {code:roomCode, targetId:p.id});
        }
      });
      chip.appendChild(kickBtn);
    }
    (p.spectator? colSpec : (p.team==='A'?colA:colB)).appendChild(chip);
  });
  [colSpec,colA,colB].forEach((col,i)=>{
    col.addEventListener('dragover', e=> e.preventDefault());
    col.addEventListener('drop', e=>{
      e.preventDefault();
      if(!draggedChip || !canDrag) return;
      if(i===0){
        // dropped into Spectators: in bots-mode there's no real bench, so this actually
        // removes the bot from the match (same effect as the kick button)
        if(matchType==='bots' && draggedChip.ref){
          const idx = players.indexOf(draggedChip.ref);
          if(idx>=0) players.splice(idx,1);
        } else {
          draggedChip.spectator = true;
        }
      } else {
        draggedChip.spectator = false;
        draggedChip.team = i===1?'A':'B';
        if(draggedChip.ref){ draggedChip.ref.team = draggedChip.team; }
      }
      renderRoster();
    });
  });
}
let draggedChip=null;
socket.on('kicked', ()=>{
  flashMsg(LANG==='uz'?'Xona egasi sizni chiqardi':LANG==='ru'?'Хост удалил вас':'The host removed you');
  quitMatch();
});
socket.on('forceLoggedOut', ()=>{
  quitMatch();
  account = null;
  show('screen-login');
  flashMsg(LANG==='uz'?'Hisobingizga boshqa qurilmadan kirildi, shu sabab chiqarildingiz':
    LANG==='ru'?'В ваш аккаунт вошли с другого устройства, вы вышли':
    'Your account was logged in elsewhere, so you were signed out here');
});

