// ============================================================================
// hub-multiplayer.js - Modes, Play-vs-bots entry, Multiplayer (local servers + private rooms)
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= MODES ============================= */
const MODES = {
  '1v1':{teamSize:1, w:540, h:300, goalH:100},
  '2v2':{teamSize:2, w:880, h:460, goalH:150},
  '3v3':{teamSize:3, w:1060, h:540, goalH:170},
  '4v4':{teamSize:4, w:1240, h:600, goalH:190},
  '5v5':{teamSize:5, w:1420, h:660, goalH:210},
};
// Which stadium size a given roster mode actually plays on. 4v4 intentionally
// shares the 3v3-sized pitch (busier, tighter football) rather than getting its
// own bigger size - everything else maps to itself.
const FIELD_SIZE_FOR_MODE = { '1v1':'1v1', '2v2':'2v2', '3v3':'3v3', '4v4':'3v3', '5v5':'5v5' };
function fieldDimsFor(mode){ return MODES[FIELD_SIZE_FOR_MODE[mode] || mode]; }
const MODE_KEYS = Object.keys(MODES);
function renderModeGrid(){
  const grid = document.getElementById('modeGrid');
  grid.innerHTML='';
  MODE_KEYS.forEach(k=>{
    const m = MODES[k];
    const card = document.createElement('div');
    card.className='modecard';
    const labelMap = {
      '1v1': {uz:'Kichik',ru:'Малая',en:'Small'}, '2v2': {uz:"O'rtacha",ru:'Средняя',en:'Medium'},
      '3v3': {uz:"Sal katta",ru:'Больше',en:'Larger'}, '4v4': {uz:'Katta',ru:'Большая',en:'Big'},
      '5v5': {uz:'Eng katta',ru:'Огромная',en:'Huge'}
    };
    card.innerHTML = `<div class="num">${k}</div><div class="lbl">${labelMap[k][LANG]}</div><div class="field-hint">${m.w}×${m.h}</div>`;
    card.addEventListener('click', ()=>{ currentMode = k; goBotsFlow(); });
    grid.appendChild(card);
  });
}
document.getElementById('btnPlay').addEventListener('click', ()=>{
  const inRealParty = (currentParty.members||[]).length > 1;
  if(inRealParty){
    if(isPartyHost()) startPartyVsBots();
    else flashMsg(LANG==='uz'?"Faqat guruh boshlig'i o'yinni boshlay oladi":LANG==='ru'?'Только лидер группы может начать матч':'Only the party leader can start the match');
    return;
  }
  show('screen-modes');
});
document.getElementById('btnShop').addEventListener('click', ()=> show('screen-shop'));
document.getElementById('btnGoSkills').addEventListener('click', ()=>{ renderPlayerStats(); show('screen-skills'); });
document.getElementById('btnSettings').addEventListener('click', ()=> show('screen-settings'));
document.getElementById('btnQuit').addEventListener('click', ()=>{
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;background:#0a0101;color:#b98f8a;font-family:sans-serif;font-size:18px;">EgoBall yopildi.</div>';
});

/* ============================= PLAY = BOTS ONLY ============================= */
async function goBotsFlow(){
  playerDisplayName = account? account.name : 'Player';
  if(account){
    if(!account.lastNumber){ account.lastNumber = 1+Math.floor(Math.random()*9); await persistAccount(); renderHubPlayerBadge(); }
    selectedNumber = account.lastNumber;
  } else if(!selectedNumber){ selectedNumber = 1+Math.floor(Math.random()*9); }
  startMatch({mode:currentMode, type:'bots'});
}
function renderNumberGrid(){
  const grid = document.getElementById('numGrid');
  if(!grid) return;
  grid.innerHTML='';
  for(let i=1;i<=10;i++){
    const cell=document.createElement('div');
    cell.className='numcell'+(i===selectedNumber?' sel':'');
    cell.textContent = i;
    cell.addEventListener('click', async ()=>{
      selectedNumber=i; renderNumberGrid();
      if(account){ account.lastNumber = i; await persistAccount(); renderHubPlayerBadge(); }
    });
    grid.appendChild(cell);
  }
}
// the number screen is now reached ONLY from the Hub (tap your number badge, or Settings ->
// "change number") - it just saves the pick and returns to the Hub, it never gates match start
document.getElementById('numBack').addEventListener('click', ()=> show('screen-main'));
document.getElementById('btnStartMatch').addEventListener('click', ()=>{
  if(!selectedNumber && account) selectedNumber = account.lastNumber || (1+Math.floor(Math.random()*9));
  show('screen-main');
});
document.getElementById('hubPlayerNumBadge').addEventListener('click', ()=>{
  selectedNumber = account? account.lastNumber : selectedNumber;
  renderNumberGrid(); show('screen-number');
});

/* ============================= MULTIPLAYER: 10 local auto-balance servers + private rooms ============================= */
let roomIsPublic = false;
document.getElementById('btnGoMultiplayer').addEventListener('click', ()=>{
  show('screen-mp');
  renderLocalServers(); renderPrivateRooms();
  startMpRefresh();
});
document.querySelectorAll('[data-back="screen-main"]').forEach(b=>{
  b.addEventListener('click', ()=>{ if(b.closest('#screen-mp')) stopMpRefresh(); });
});
let mpRefreshTimer=null;
function stopMpRefresh(){ if(mpRefreshTimer){ clearInterval(mpRefreshTimer); mpRefreshTimer=null; } }
function startMpRefresh(){ stopMpRefresh(); mpRefreshTimer = setInterval(()=>{ renderLocalServers(); renderPrivateRooms(); }, 2500); }
function renderLocalServers(){
  const list = document.getElementById('localServerList'); if(!list) return;
  socket.emit('listLocalServers', (servers)=>{
    list.innerHTML='';
    (servers||[]).forEach(s=>{
      const row = document.createElement('div'); row.className='hubrow'+(s.full?' full-row':'');
      const countStyle = s.full? 'color:#ff5c5c;font-weight:800;' : '';
      row.innerHTML = `<span>${LANG==='uz'?'Server':LANG==='ru'?'Сервер':'Server'} ${s.index}</span><span class="cnt" style="${countStyle}">${s.cap}/${s.count}</span>`;
      row.addEventListener('click', ()=>{
        if(s.full){ flashMsg(t('allFull')); return; }
        stopMpRefresh(); joinLocalServer(s.index);
      });
      list.appendChild(row);
    });
  });
}
function joinLocalServer(index){
  playerDisplayName = playerDisplayName || (account?account.name:'Guest');
  socket.emit('joinLocalServer', {index, name:playerDisplayName, color: account? COLORS[account.equippedColor] : null, characterId: account? account.equippedCharacterId : null, auraId: account? account.equippedAura : null, cups: account?(account.cups||0):0, level: account?(account.level||1):1, stats: account? computeEffectiveStats() : null}, (res)=>{
    if(!res || !res.ok){
      if(res && res.error==='full') flashMsg(t('allFull'));
      return;
    }
    roomCode = res.code; roomIsPublic = true; myId = res.myId; lastKnownRoomPlayerIds = new Set();
    isHost = res.isHost; // technical authority only - never exposed as admin UI for local servers
    mySpectator = res.spectator;
    currentMode = res.room.mode;
    currentRoomSnapshot = res.room; multiChatCache = res.room.chat||[];
    stopMpRefresh();
    if(res.room.practice){ beginPracticeMode(res.room); return; } // alone - free practice, no timer/goals
    if(res.room.started){ enterLobby(); return; } // a match is already running - you're queued, watch from the lobby
    enterLobby(); // 2+ real players gathering - waiting out the short grace window before kickoff
  });
}
function beginPracticeMode(room){
  currentMode = '1v1'; matchType='multi'; matchMode = currentMode; roomCode = room.code;
  initField('1v1');
  practiceMode = true;
  players = [];
  const p = makePlayer('A', 0, 0); p.x = MODES['1v1'].w*0.32; p.y = MODES['1v1'].h/2;
  p.isBot=false; p.isHuman=true; p.num=1; p.netId=myId;
  if(account){ p.accentColor=COLORS[account.equippedColor]; p.characterId=account.equippedCharacterId||null; p.auraId=account.equippedAura||null; p.cups=account.cups||0; p.level=account.level||1; }
  p.name = playerDisplayName || (account? account.name : 'Player');
  window.__humanPlayer = p;
  players.push(p);
  resetBall();
  score = {A:0,B:0}; matchTimeLeft = 0; humanGoalsScored=0; humanAssists=0;
  matchActive = true; matchPaused=false; ballFrozen=false; playersFrozen=false; botsFrozen=false;
  kickoffActive=false;
  document.getElementById('hud').classList.add('active');
  document.getElementById('btnFullscreen').style.display='none';
  document.getElementById('btnMenuRoster').style.display = 'none';
  document.getElementById('btnChatToggle').style.display = 'block';
  applyControlModeUI();
  resizeCanvas();
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  updateHud();
  camX = p.x; camY = p.y;
  stopAllMatchIntervals();
  lastTs = performance.now(); accumMs=0;
  if(rafId) cancelAnimationFrame(rafId);
  loop();
  flashMsg(LANG==='uz'?"Mashq rejimi - biror kim kirishini kuting":(LANG==='ru'?'Тренировка - ждите соперника':'Practice mode - waiting for someone to join'));
}
let selectedPrivateRoom = null;
function renderPrivateRooms(){
  const list = document.getElementById('privateRoomList'); if(!list) return;
  socket.emit('listPrivateRooms', (rooms)=>{
    list.innerHTML='';
    selectedPrivateRoom = null;
    document.getElementById('btnJoinSelected').style.display='none';
    (rooms||[]).forEach(r=>{
      const row = document.createElement('div'); row.className='hubrow'+(r.hasPassword?' locked-row':'');
      const label = r.roomName || (r.hostName+(LANG==='uz'?"ning xonasi":LANG==='ru'?' — комната':"'s room"));
      row.innerHTML = `<span>${label}</span><span class="cnt">${r.count}/${r.cap}</span>`;
      row.addEventListener('click', ()=>{
        document.querySelectorAll('#privateRoomList .hubrow').forEach(x=>x.classList.remove('selected-row'));
        row.classList.add('selected-row');
        selectedPrivateRoom = r;
        document.getElementById('btnJoinSelected').style.display='block';
      });
      list.appendChild(row);
    });
  });
}
document.getElementById('btnJoinSelected').addEventListener('click', ()=>{
  if(!selectedPrivateRoom) return;
  stopMpRefresh();
  let pass = '';
  if(selectedPrivateRoom.hasPassword){
    pass = prompt(LANG==='uz'?'Xona paroli:':LANG==='ru'?'Пароль комнаты:':'Room password:') || '';
  }
  joinRoomByCode(selectedPrivateRoom.code, pass);
});


/* ============================= ROOM (create / join / lobby) - PRIVATE ============================= */
let roomCode = null; let myId = null; let isHost=false; let mySpectator=false;
let privateRoomMode = '1v1';
document.getElementById('privateModeRow').addEventListener('click', e=>{
  const c = e.target.closest('.chip'); if(!c) return;
  privateRoomMode = c.getAttribute('data-mode');
  document.querySelectorAll('#privateModeRow .chip').forEach(x=> x.classList.toggle('active', x===c));
});
let passwordEnabled = false;
document.getElementById('passwordToggleRow').addEventListener('click', ()=>{
  passwordEnabled = !passwordEnabled;
  document.getElementById('passwordToggleSwitch').classList.toggle('on', passwordEnabled);
  document.getElementById('createRoomPass').style.display = passwordEnabled? 'block':'none';
  if(!passwordEnabled) document.getElementById('createRoomPass').value='';
});
document.getElementById('btnCreateRoom').addEventListener('click', ()=>{
  playerDisplayName = playerDisplayName || (account?account.name:'Host');
  const cap = MODES[privateRoomMode].teamSize*2;
  const password = passwordEnabled ? document.getElementById('createRoomPass').value.trim() : '';
  const roomName = document.getElementById('createRoomName').value.trim();
  socket.emit('createRoom', {mode:privateRoomMode, name:playerDisplayName, cap, password, roomName, color: account? COLORS[account.equippedColor] : null, characterId: account? account.equippedCharacterId : null, auraId: account? account.equippedAura : null, cups: account?(account.cups||0):0, level: account?(account.level||1):1, stats: account? computeEffectiveStats() : null}, (res)=>{
    if(!res || !res.ok) return;
    roomCode = res.code; isHost = true; roomIsPublic = false; myId = res.myId; lastKnownRoomPlayerIds = new Set();
    currentMode = res.room.mode;
    currentRoomSnapshot = res.room; multiChatCache = res.room.chat||[];
    stopMpRefresh();
    enterLobby();
  });
});
document.getElementById('btnJoinRoom').addEventListener('click', ()=>{
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  if(!code) return;
  joinRoomByCode(code);
});
function joinRoomByCode(code, password){
  playerDisplayName = playerDisplayName || (account?account.name:'Guest');
  const cap = MODES[currentMode].teamSize*2;
  socket.emit('joinRoomByCode', {code, name:playerDisplayName, cap, password, color: account? COLORS[account.equippedColor] : null, characterId: account? account.equippedCharacterId : null, auraId: account? account.equippedAura : null, cups: account?(account.cups||0):0, level: account?(account.level||1):1, stats: account? computeEffectiveStats() : null}, (res)=>{
    if(!res || !res.ok){
      const msgs = {
        not_found: LANG==='uz'?'Xona topilmadi':LANG==='ru'?'Комната не найдена':'Room not found',
        password_required: LANG==='uz'?'Parol kerak':LANG==='ru'?'Нужен пароль':'Password required',
        wrong_password: LANG==='uz'?"Parol noto'g'ri":LANG==='ru'?'Неверный пароль':'Wrong password'
      };
      alert((res&&msgs[res.error]) || msgs.not_found);
      return;
    }
    roomCode = code; roomIsPublic = !!res.room.isPublic; myId = res.myId; lastKnownRoomPlayerIds = new Set();
    isHost = res.isHost; mySpectator = res.spectator;
    currentMode = res.room.mode;
    currentRoomSnapshot = res.room; multiChatCache = res.room.chat||[];
    stopMpRefresh();
    if(res.room.started){ beginMultiMatch(res.room); return; } // room filled up the instant we joined
    enterLobby();
  });
}
let currentRoomSnapshot = null;
function enterLobby(){
  document.getElementById('lobbyCode').textContent = roomCode;
  show('screen-lobby');
  renderLobbyFromRoom(currentRoomSnapshot);
}
let lastKnownRoomPlayerIds = new Set();
function showJoinToast(msg){
  const el = document.getElementById('joinNotifyToast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el.__hideTimer);
  el.__hideTimer = setTimeout(()=> el.classList.remove('show'), 3000);
}
socket.on('roomUpdate', (room)=>{
  currentRoomSnapshot = room;
  window.__roomRosterCache = room.players;
  if(room.code===roomCode){
    const nowIds = new Set(room.players.map(p=>p.id));
    room.players.forEach(p=>{
      if(p.id!==myId && !lastKnownRoomPlayerIds.has(p.id)){
        showJoinToast(`${p.name} ${LANG==='uz'?"qo'shildi":LANG==='ru'?'присоединился':'joined'}`);
      }
    });
    lastKnownRoomPlayerIds = nowIds;
    // A solo practicing player never had a reason to be watching the lobby screen (they were
    // dropped straight into practiceMode instead), so this update would otherwise be silently
    // ignored below - meaning they'd never learn someone joined, never see the room name, and
    // keep running their own local practice physics loop right alongside the server's now-real
    // authoritative match for the same room (physicsState updates were still being accepted and
    // applied on top of that local loop, since practiceMode also sets matchType/matchActive the
    // same as a real match). Two physics sources fighting over the same state is exactly what
    // produced the stutter/slowdown - so this transition fixes both symptoms at once.
    if(practiceMode && !room.practice){
      practiceMode = false;
      matchActive = false;
      if(rafId){ cancelAnimationFrame(rafId); rafId=null; }
      stopAllMatchIntervals();
      document.getElementById('hud').classList.remove('active');
      document.getElementById('mobileControls').classList.remove('active');
      enterLobby();
    }
  }
  if(!document.getElementById('screen-lobby').classList.contains('hidden')) renderLobbyFromRoom(room);
});
socket.on('matchStarting', (room)=>{
  if(practiceMode) return; // roomUpdate's practice->lobby transition handles this properly; ignore stray early events
  currentRoomSnapshot = room;
  beginMultiMatch(room);
});
function renderLobbyFromRoom(room){
  if(!room) return;
  const list = document.getElementById('lobbyList'); list.innerHTML='';
  room.players.forEach(p=>{
    const row = document.createElement('div'); row.className='btn small';
    row.style.cursor='default';
    row.innerHTML = `${escapeHtml(p.name)} ${p.id===room.hostId?'👑':''} <span class="tag">${p.spectator? '👁' : (p.team? 'Team '+p.team : (LANG==='uz'?'Kutmoqda':LANG==='ru'?'Ожидание':'Waiting'))}</span>`;
    list.appendChild(row);
  });
  document.getElementById('lobbySpectateNote').textContent = mySpectator? t('spectator') : '';
  document.getElementById('btnLobbyStart').style.display = isHost? 'block':'none';
}
document.getElementById('btnLobbyStart').addEventListener('click', ()=>{
  socket.emit('startMatch', {code:roomCode});
});
document.getElementById('lobbyBack').addEventListener('click', ()=>{ socket.emit('leaveRoom'); show('screen-mp'); renderLocalServers(); renderPrivateRooms(); startMpRefresh(); });
socket.on('hostChanged', ({newHostId, room})=>{
  // "host" is now just a lobby-display/privilege concept (who can press Start) -
  // the server simulates the match either way, so there is nothing to hand off.
  isHost = (myId === newHostId);
  currentRoomSnapshot = room;
  window.__roomRosterCache = room.players;
  if(!document.getElementById('screen-lobby').classList.contains('hidden')) renderLobbyFromRoom(room);
});

