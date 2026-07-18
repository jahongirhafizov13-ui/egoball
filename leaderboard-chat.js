// ============================================================================
// leaderboard-chat.js - Leaderboard + Hub global chat
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= LEADERBOARD ============================= */
let lbMode = 'goals';
document.getElementById('btnOpenLeaderboard').addEventListener('click', ()=>{ show('screen-leaderboard'); renderLeaderboard(); });
document.getElementById('lbTabGoals').addEventListener('click', ()=>{ lbMode='goals'; setLbTab(); renderLeaderboard(); });
document.getElementById('lbTabAssists').addEventListener('click', ()=>{ lbMode='assists'; setLbTab(); renderLeaderboard(); });
document.getElementById('lbTabCoins').addEventListener('click', ()=>{ lbMode='coins'; setLbTab(); renderLeaderboard(); });
document.getElementById('lbTabCups').addEventListener('click', ()=>{ lbMode='cups'; setLbTab(); renderLeaderboard(); });
document.getElementById('lbTabLevel').addEventListener('click', ()=>{ lbMode='level'; setLbTab(); renderLeaderboard(); });
function setLbTab(){
  document.getElementById('lbTabGoals').classList.toggle('active', lbMode==='goals');
  document.getElementById('lbTabAssists').classList.toggle('active', lbMode==='assists');
  document.getElementById('lbTabCoins').classList.toggle('active', lbMode==='coins');
  document.getElementById('lbTabCups').classList.toggle('active', lbMode==='cups');
  document.getElementById('lbTabLevel').classList.toggle('active', lbMode==='level');
}
async function renderLeaderboard(){
  const list = document.getElementById('leaderboardList'); list.innerHTML = LANG==='uz'?'Yuklanmoqda...':LANG==='ru'?'Загрузка...':'Loading...';
  socket.emit('getLeaderboard', (board)=>{
    board = board || [];
    const sorted = [...board].sort((a,b)=> (b[lbMode]||0)-(a[lbMode]||0)).slice(0,20);
    list.innerHTML='';
    if(sorted.length===0){ list.innerHTML = `<div class="footer-note">${LANG==='uz'?"Hali hech kim yo'q":LANG==='ru'?'Пока никого нет':'Nobody yet'}</div>`; return; }
    sorted.forEach((entry,i)=>{
      const row = document.createElement('div'); row.className='lbrow';
      const valDisplay = lbMode==='cups'
        ? `<span class="lbval" style="display:flex;align-items:center;gap:4px;"><span style="width:18px;height:18px;display:inline-block;">${rankBadgeSVG(getRankInfo(entry.cups||0).tierIndex, getRankInfo(entry.cups||0).division, 18)}</span>${entry.cups||0}</span>`
        : lbMode==='level'
        ? `<span class="lbval">LV ${entry.level||1}</span>`
        : `<span class="lbval">${entry[lbMode]||0}</span>`;
      row.innerHTML = `<span class="rank">${i+1}</span>
        <div class="avatar-mini ${frameClassOf(entry.frame)}" style="${entry.avatar?`background-image:url(${escapeHtml(entry.avatar)})`:''}"></div>
        <span class="lbname">${escapeHtml(entry.name)}</span>${valDisplay}`;
      row.addEventListener('click', ()=> openProfile(entry, entry.name.toLowerCase()===(account?account.name.toLowerCase():''), 'screen-leaderboard'));
      list.appendChild(row);
    });
  });
}

/* ============================= HUB GLOBAL CHAT ============================= */
let hubChatLog = [];
document.getElementById('btnHubChatToggle').addEventListener('click', ()=>{
  document.getElementById('hubChatOverlay').classList.add('show');
  renderHubChatLog();
});
document.getElementById('hubChatClose').addEventListener('click', ()=> document.getElementById('hubChatOverlay').classList.remove('show'));
document.getElementById('hubChatSend').addEventListener('click', sendHubChat);
document.getElementById('hubChatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendHubChat(); });
function sendHubChat(){
  const inp = document.getElementById('hubChatInput');
  const msg = inp.value.trim(); if(!msg || !account) return;
  inp.value='';
  socket.emit('hubChat', {msg});
}
socket.on('hubChatUpdate', ({name, msg, level, cups})=>{
  hubChatLog.push({name, msg, level:level||1, cups:cups||0});
  if(hubChatLog.length>60) hubChatLog.shift();
  renderHubChatLog();
});
function renderHubChatLog(){
  const log = document.getElementById('hubChatLog'); if(!log) return;
  log.innerHTML = hubChatLog.map(m=>{
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
socket.on('hubOnlineUpdate', (names)=>{
  const tag = document.getElementById('hubOnlineTag');
  if(tag) tag.textContent = `· ${names.length} online`;
  const list = document.getElementById('hubOnlineList');
  if(list) list.innerHTML = names.map(n=>`<span>${n}</span>`).join('');
});

