// ============================================================================
// social.js - Profile, Friends, Hub Party (squad)
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= PROFILE ============================= */
function frameClassOf(frameIdx){ return (frameIdx!=null && FRAMES[frameIdx]) ? FRAMES[frameIdx].cls : ''; }
function jerseyColorOf(idx){ return (idx!=null && COLORS[idx]) ? COLORS[idx] : 'transparent'; }
function currentAvatarRing(){
  if(!account) return 'frame';
  if(account.avatarRing) return account.avatarRing;
  return (account.frame!=null) ? 'frame' : 'color';
}
function applyAvatarDeco(wrapEl, imgEl){
  const ring = currentAvatarRing();
  if(ring==='frame' && account.frame!=null){
    wrapEl.className = wrapEl.className.replace(/\bframe-\d+\b/g,'').trim() + ' ' + frameClassOf(account.frame);
    imgEl.style.setProperty('--jersey','transparent');
  } else {
    wrapEl.className = wrapEl.className.replace(/\bframe-\d+\b/g,'').trim();
    imgEl.style.setProperty('--jersey', jerseyColorOf(account.equippedColor));
  }
}
function avatarImageUrl(acc){
  if(!acc) return '';
  if(acc.equippedCharacterId && CHARACTERS[acc.equippedCharacterId]) return CHARACTERS[acc.equippedCharacterId].img;
  return acc.avatar || '';
}
function renderProfileBadge(){
  if(!account) return;
  document.getElementById('profileNick').textContent = account.name;
  document.getElementById('profileNum').textContent = account.lastNumber? '#'+account.lastNumber : '';
  const mini = document.getElementById('profileAvatarMini');
  const url = avatarImageUrl(account);
  mini.style.backgroundImage = url? `url(${url})` : '';
  mini.className = 'avatar-mini';
  applyAvatarDeco(mini, mini);
  document.getElementById('profileLevelBadge').textContent = account.level||1;
  const rInfo = getRankInfo(account.cups||0);
  document.getElementById('profileBanner').style.setProperty('--tier-color', rInfo.tier.metal[1]);
  const chip = document.getElementById('rankChip');
  chip.innerHTML = rankBadgeSVG(rInfo.tierIndex, rInfo.division, 20) +
    `<div class="rank-chip-text"><b>${rInfo.tier.short}${rInfo.division?' '+['','I','II','III','IV','V'][rInfo.division]:''}</b><span>${rInfo.totalCups} Cup</span></div>`;
  renderHubPlayerBadge();
}
function renderHubPlayerBadge(){
  if(!account) return;
  const hubNameEl = document.getElementById('hubPlayerName');
  hubNameEl.innerHTML = `<span style="position:relative;z-index:1;">${escapeHtml(playerDisplayName || account.name || '-')}</span>`;
  if(account.equippedBanner!=null){
    hubNameEl.style.cssText = 'display:inline-block;padding:3px 14px;border-radius:8px;position:relative;'+nicknameBannerStyle(account.equippedBanner);
  } else {
    hubNameEl.style.cssText = '';
  }
  attachBannerFX(hubNameEl, account.equippedBanner);
  const big = document.getElementById('hubPlayerAvatar');
  const wrap = document.getElementById('hubPlayerAvatarWrap');
  const url = avatarImageUrl(account);
  big.style.backgroundImage = url? `url(${url})` : '';
  wrap.className = 'avatar-wrap';
  applyAvatarDeco(wrap, big);
  const numBadge = document.getElementById('hubPlayerNumBadge');
  if(numBadge){
    numBadge.textContent = account.lastNumber ? '#'+account.lastNumber : '#?';
    numBadge.style.display='flex';
  }
  const aura = account.equippedAura ? AURAS.find(a=>a.id===account.equippedAura) : null;
  big.classList.toggle('avatar-aura-glow', !!aura);
  if(aura) big.style.setProperty('--aura-color', aura.glow);
  renderPartyRow();
}

/* ============================= FRIENDS ============================= */
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
let friendsData = { friends: [], requests: [] };
let selectedPartyMode = '2v2';

function renderPartyModeRow(){
  const row = document.getElementById('partyModeRow');
  if(!row) return;
  row.innerHTML = MODE_KEYS.map(k=>`<div class="mode-pill${k===selectedPartyMode?' sel':''}" data-pmode="${k}">${k}</div>`).join('');
  row.querySelectorAll('[data-pmode]').forEach(el=> el.addEventListener('click', ()=>{
    selectedPartyMode = el.getAttribute('data-pmode'); renderPartyModeRow();
  }));
}

function quickPlayWithFriends(mode, friendNames){
  playerDisplayName = playerDisplayName || (account?account.name:'Guest');
  socket.emit('quickPlay', {name:playerDisplayName, mode, color: account? COLORS[account.equippedColor] : null, characterId: account? account.equippedCharacterId : null, auraId: account? account.equippedAura : null, cups: account?(account.cups||0):0, level: account?(account.level||1):1, stats: account? computeEffectiveStats() : null}, (res)=>{
    if(!res || !res.ok) return;
    roomCode = res.code; roomIsPublic = true; myId = res.myId; lastKnownRoomPlayerIds = new Set();
    isHost = res.isHost; mySpectator = res.spectator;
    currentMode = res.room.mode;
    multiChatCache = res.room.chat||[];
    (friendNames||[]).forEach(fn=> socket.emit('inviteFriendToGame', {fromName:playerDisplayName, toName:fn, code:roomCode}));
    closeFriendsPanel();
    beginMultiMatch(res.room);
  });
}

function refreshFriends(cb){
  if(!playerDisplayName) return;
  socket.emit('getFriends', {name:playerDisplayName}, (res)=>{
    if(res && res.ok){ friendsData.friends = res.friends||[]; friendsData.requests = res.requests||[]; }
    renderFriendsPanel();
    if(cb) cb();
  });
}

function renderFriendsPanel(){
  const reqBox = document.getElementById('friendRequestsBox');
  const listBox = document.getElementById('friendsListBox');
  const reqCount = friendsData.requests.length;
  reqBox.innerHTML = reqCount ? ('<h4 data-i18n="friendRequestsTitle">So\'rovlar</h4>' + friendsData.requests.map(r=>`
    <div class="lbrow">
      <span class="lbname">${escapeHtml(r.fromName||r.from)}</span>
      <span style="display:flex;gap:6px;">
        <button class="btn small primary" style="padding:6px 12px;" data-accept="${escapeHtml(r.from)}">✓</button>
        <button class="btn small danger" style="padding:6px 12px;" data-decline="${escapeHtml(r.from)}">✕</button>
      </span>
    </div>`).join('')) : '';
  listBox.innerHTML = friendsData.friends.length ? friendsData.friends.map(f=>{
    const inMatch = f.online && matchActive && matchType==='multi' && roomCode;
    const canPartyInvite = f.online && !inMatch;
    let actionHtml = '';
    if(inMatch) actionHtml = `<span class="fr-summon" data-invite="${escapeHtml(f.name)}">+</span>`;
    else if(canPartyInvite) actionHtml = `<span class="fr-summon" data-party="${escapeHtml(f.name)}" title="Guruhga taklif qilish">👥</span>`;
    return `<div class="lbrow">
      <span class="fr-dot" style="background:${f.online?'#39c477':'#666'};"></span>
      <span class="lbname">${escapeHtml(f.name)}</span>
      <span style="font-size:11px;color:var(--txt-dim);margin-right:4px;">${f.online? (LANG==='uz'?'Onlayn':LANG==='ru'?'Онлайн':'Online') : (LANG==='uz'?'Offlayn':LANG==='ru'?'Оффлайн':'Offline')}</span>
      ${actionHtml}
    </div>`;
  }).join('') : `<div class="footer-note" style="margin:6px 0 12px;">${LANG==='uz'?"Hali do'stlar yo'q":LANG==='ru'?'Пока нет друзей':'No friends yet'}</div>`;

  reqBox.querySelectorAll('[data-accept]').forEach(b=> b.addEventListener('click', ()=> respondFriendRequest(b.getAttribute('data-accept'), true)));
  reqBox.querySelectorAll('[data-decline]').forEach(b=> b.addEventListener('click', ()=> respondFriendRequest(b.getAttribute('data-decline'), false)));
  listBox.querySelectorAll('[data-invite]').forEach(b=> b.addEventListener('click', ()=> inviteFriendToGame(b.getAttribute('data-invite'))));
  listBox.querySelectorAll('[data-party]').forEach(b=> b.addEventListener('click', ()=> inviteToParty(b.getAttribute('data-party'))));

  document.getElementById('partyModeRow').style.display = 'none';

  [document.getElementById('friendReqCount'), document.getElementById('friendReqCountMenu'), document.getElementById('friendReqCountHub')].forEach(el=>{
    if(!el) return;
    el.textContent = reqCount;
    el.style.display = reqCount? 'flex' : 'none';
  });
}

function respondFriendRequest(from, accept){
  socket.emit('respondFriendRequest', {name:playerDisplayName, from, accept}, ()=> refreshFriends());
}
function inviteFriendToGame(toName){
  socket.emit('inviteFriendToGame', {fromName:playerDisplayName, toName, code:roomCode});
}
function renderDecoPicker(){
  if(!account) return;
  const ring = currentAvatarRing();
  const frameGrid = document.getElementById('decoFrameGrid');
  const ownedFrames = account.framesOwned || [];
  frameGrid.innerHTML = ownedFrames.length ? ownedFrames.map(idx=>{
    const fr = FRAMES[idx]; if(!fr) return '';
    const sel = ring==='frame' && account.frame===idx;
    return `<div class="deco-cell ${fr.cls}${sel?' deco-sel':''}" data-deco-frame="${idx}"></div>`;
  }).join('') : `<div class="deco-none-note" data-i18n="decoNoneOwned">Hali ramka sotib olinmagan</div>`;

  const colorGrid = document.getElementById('decoColorGrid');
  const ownedColors = account.colors || [0];
  colorGrid.innerHTML = ownedColors.map(idx=>{
    const sel = ring==='color' && account.equippedColor===idx;
    return `<div class="deco-cell${sel?' deco-sel':''}" style="background:${COLORS[idx]}" data-deco-color="${idx}"></div>`;
  }).join('');

  frameGrid.querySelectorAll('[data-deco-frame]').forEach(el=> el.addEventListener('click', async ()=>{
    account.frame = Number(el.getAttribute('data-deco-frame'));
    account.avatarRing = 'frame';
    await persistAccount();
    renderProfileBadge(); renderDecoPicker(); renderHubPlayerBadge();
  }));
  colorGrid.querySelectorAll('[data-deco-color]').forEach(el=> el.addEventListener('click', async ()=>{
    account.equippedColor = Number(el.getAttribute('data-deco-color'));
    account.avatarRing = 'color';
    await persistAccount();
    renderProfileBadge(); renderDecoPicker(); renderHubPlayerBadge();
  }));
}
function openDecoPicker(){ renderDecoPicker(); document.getElementById('decoOverlay').classList.add('show'); }
document.getElementById('hubAvatarEditBtn').addEventListener('click', (e)=>{ e.stopPropagation(); openDecoPicker(); });
document.getElementById('decoCloseBtn').addEventListener('click', ()=> document.getElementById('decoOverlay').classList.remove('show'));
function openFriendsPanel(){ refreshFriends(); document.getElementById('friendsOverlay').classList.add('show'); }
function closeFriendsPanel(){ document.getElementById('friendsOverlay').classList.remove('show'); }
document.getElementById('friendsCloseBtn').addEventListener('click', closeFriendsPanel);
document.getElementById('hubFriendPlusBtn').addEventListener('click', openFriendsPanel);
document.getElementById('btnOpenFriendsMenu').addEventListener('click', openFriendsPanel);
document.getElementById('friendAddBtn').addEventListener('click', ()=>{
  const input = document.getElementById('friendAddInput');
  const msg = document.getElementById('friendAddMsg');
  const to = input.value.trim();
  if(!to) return;
  socket.emit('sendFriendRequest', {from:playerDisplayName, to}, (res)=>{
    if(res && res.ok){
      input.value='';
      msg.style.color = 'var(--gold2)';
      msg.textContent = LANG==='uz'?"So'rov yuborildi":LANG==='ru'?'Запрос отправлен':'Request sent';
    } else {
      const errs = {
        not_found: LANG==='uz'?'Bunday foydalanuvchi topilmadi':LANG==='ru'?'Пользователь не найден':'User not found',
        already_friends: LANG==='uz'?"Allaqachon do'stsizlar":LANG==='ru'?'Уже друзья':'Already friends',
        already_sent: LANG==='uz'?"So'rov allaqachon yuborilgan":LANG==='ru'?'Запрос уже отправлен':'Request already sent',
        invalid: LANG==='uz'?"Nickname noto'g'ri":LANG==='ru'?'Неверный никнейм':'Invalid nickname'
      };
      msg.style.color = '#ff8f8f';
      msg.textContent = (res&&errs[res.error]) || (LANG==='uz'?'Xatolik yuz berdi':'Error');
    }
  });
});
socket.on('friendRequestReceived', ()=>{ refreshFriends(); });
socket.on('friendRequestResult', ()=>{ refreshFriends(); });
socket.on('friendPresence', ({name, online})=>{
  const f = friendsData.friends.find(x=>x.name.toLowerCase()===String(name).toLowerCase());
  if(f){ f.online = online; renderFriendsPanel(); }
});
socket.on('gameInvite', ({fromName, code})=>{
  const ok = confirm(LANG==='uz'? `${fromName} sizni o'yinga taklif qildi. Qo'shilasizmi?` : LANG==='ru'? `${fromName} приглашает вас в игру. Присоединиться?` : `${fromName} invited you to a match. Join?`);
  if(ok && code) joinRoomByCode(code);
});
socket.on('coinsGranted', ({currency, amount, newBalance})=>{
  if(!account) return;
  if(currency==='gcoin'){
    account.gcoin = newBalance;
    const bal = document.getElementById('caseGcoinBalance'); if(bal) bal.textContent = newBalance;
    flashMsg(LANG==='uz'? `Sizga ${amount} G Coin sovg'a qilindi!` : LANG==='ru'? `Вам подарили ${amount} G Coin!` : `You received ${amount} G Coin!`);
    return;
  }
  account.coins = newBalance;
  updateCoinDisplays();
  flashMsg(LANG==='uz'? `Sizga ${amount} Ecoin sovg'a qilindi!` : LANG==='ru'? `Вам подарили ${amount} Ecoin!` : `You received ${amount} Ecoin!`);
});

/* ============================= HUB PARTY (squad) ============================= */
let currentParty = { hostName: null, members: [] };

function myNameLower(){ return (playerDisplayName||(account?account.name:'')||'').trim().toLowerCase(); }
function isPartyHost(){ return currentParty.hostName && currentParty.hostName === myNameLower(); }

function refreshParty(){
  if(!playerDisplayName) return;
  socket.emit('getParty', {name:playerDisplayName}, (res)=>{
    if(res && res.ok){ currentParty = { hostName: res.hostName, members: res.members||[] }; renderPartyRow(); }
  });
}

function partyMiniAvatarHTML(member){
  const img = (member.equippedCharacterId && CHARACTERS[member.equippedCharacterId]) ? CHARACTERS[member.equippedCharacterId].img : (member.avatar||'');
  const frameCls = member.frame!=null ? frameClassOf(member.frame) : '';
  const jersey = member.frame!=null ? 'transparent' : (COLORS[member.equippedColor||0]||COLORS[0]);
  const aura = member.equippedAura ? AURAS.find(a=>a.id===member.equippedAura) : null;
  const auraCls = aura ? 'avatar-aura-glow' : '';
  const auraStyle = aura ? `--aura-color:${aura.glow};` : '';
  return `<div class="hub-party-slot-mini">
    <div class="hub-player-name">${escapeHtml(member.name)}</div>
    <div class="party-mini-avatar ${frameCls} ${auraCls}" style="background-image:${img?`url(${img})`:'none'};--jersey:${jersey};${auraStyle}">
      ${member.isHost? `<div class="party-host-tag">HOST</div>` : ''}
    </div>
  </div>`;
}

function renderPartyRow(){
  const extra = document.getElementById('hubPartyExtra');
  const others = (currentParty.members||[]).filter(m=> m.name.toLowerCase() !== myNameLower());
  extra.innerHTML = others.map(partyMiniAvatarHTML).join('');
  const inRealParty = (currentParty.members||[]).length > 1;
  document.getElementById('btnLeaveParty').style.display = inRealParty ? 'block' : 'none';
}

function inviteToParty(name){
  socket.emit('partyInvite', {from:playerDisplayName, to:name}, (res)=>{
    if(res && res.ok){
      flashMsg(LANG==='uz'?`${name}ga guruh taklifi yuborildi`:LANG==='ru'?`Приглашение в группу отправлено ${name}`:`Party invite sent to ${name}`);
    } else {
      const errs = {
        not_host: LANG==='uz'?"Faqat guruh boshlig'i taklif qila oladi":LANG==='ru'?'Только лидер группы может приглашать':'Only the party leader can invite',
        party_full: LANG==='uz'?"Guruh to'lgan (maks 4)":LANG==='ru'?'Группа заполнена (макс 4)':'Party is full (max 4)',
        already_in_party: LANG==='uz'?"U allaqachon guruhingizda":LANG==='ru'?'Уже в вашей группе':'Already in your party',
        target_in_other_party: LANG==='uz'?"U boshqa guruhda":LANG==='ru'?'Он в другой группе':"They're in another party",
        offline: LANG==='uz'?"U hozir oflayn":LANG==='ru'?'Сейчас оффлайн':"They're offline",
        not_found: LANG==='uz'?'Topilmadi':LANG==='ru'?'Не найден':'Not found'
      };
      flashMsg((res&&errs[res.error]) || (LANG==='uz'?'Xatolik':'Error'));
    }
  });
}

document.getElementById('btnLeaveParty').addEventListener('click', ()=>{
  socket.emit('partyLeave', {name:playerDisplayName}, ()=> refreshParty());
});

socket.on('partyUpdate', ({hostName, members})=>{
  currentParty = { hostName, members: members||[] };
  renderPartyRow();
});

socket.on('partyInviteReceived', ({fromName, fromNameLower})=>{
  const ok = confirm(LANG==='uz'? `${fromName} sizni guruhiga taklif qildi. Qo'shilasizmi?` : LANG==='ru'? `${fromName} приглашает вас в группу. Присоединиться?` : `${fromName} invited you to their party. Join?`);
  socket.emit('partyInviteRespond', {name:playerDisplayName, fromNameLower, accept:ok}, (res)=>{
    if(ok && res && res.ok) refreshParty();
    else if(ok && res && !res.ok) flashMsg(LANG==='uz'?"Guruhga qo'shilib bo'lmadi (to'lgan bo'lishi mumkin)":'Could not join the party (it may be full)');
  });
});

socket.on('partyMatchReady', ({code, room})=>{
  roomCode = code; roomIsPublic = false; myId = socket.id; isHost = false; mySpectator = false; lastKnownRoomPlayerIds = new Set();
  currentMode = room.mode; multiChatCache = room.chat||[];
  beginMultiMatch(room);
});

function startPartyVsBots(){
  const onlineCount = (currentParty.members||[]).filter(m=>m.online).length || 1;
  const size = Math.min(4, Math.max(1, onlineCount));
  const modeKey = size+'v'+size;
  socket.emit('partyStartVsBots', {name:playerDisplayName, mode:modeKey}, (res)=>{
    if(!res || !res.ok){
      flashMsg(res && res.error==='not_host' ? (LANG==='uz'?"Faqat guruh boshlig'i o'yinni boshlay oladi":"Only the party leader can start the match") : (LANG==='uz'?'Xatolik yuz berdi':'Error'));
      return;
    }
    roomCode = res.code; roomIsPublic = false; myId = res.myId; isHost = true; mySpectator = false; lastKnownRoomPlayerIds = new Set();
    currentMode = res.room.mode; multiChatCache = res.room.chat||[];
    beginMultiMatch(res.room);
  });
}


let viewingProfile = null; // null = own profile; otherwise a leaderboard/hub entry object (read-only)
let profileOrigin = 'screen-main';
function openProfile(entry, editable, origin){
  viewingProfile = editable? null : entry;
  profileOrigin = origin || (editable? 'screen-main' : 'screen-leaderboard');
  const data = editable? account : entry;
  const titleEl = document.getElementById('profileTitleName');
  titleEl.innerHTML = `<span style="position:relative;z-index:1;">${escapeHtml(data.name)}</span>`;
  if(data.equippedBanner!=null){
    titleEl.style.cssText = 'display:inline-block;padding:4px 18px;border-radius:8px;position:relative;'+nicknameBannerStyle(data.equippedBanner);
  } else {
    titleEl.style.cssText = '';
  }
  attachBannerFX(titleEl, data.equippedBanner);
  const big = document.getElementById('profileAvatarBig');
  big.style.backgroundImage = avatarImageUrl(data)? `url(${avatarImageUrl(data)})` : '';
  const wrapBig = document.getElementById('profileAvatarWrapBig');
  wrapBig.className = 'avatar-wrap '+frameClassOf(data.frame);
  big.style.setProperty('--jersey', jerseyColorOf(data.equippedColor));
  const profAura = data.equippedAura ? AURAS.find(a=>a.id===data.equippedAura) : null;
  big.classList.toggle('avatar-aura-glow', !!profAura);
  if(profAura) big.style.setProperty('--aura-color', profAura.glow);
  document.getElementById('profGoals').textContent = data.totalGoals!=null? data.totalGoals : (data.goals||0);
  document.getElementById('profAssists').textContent = data.totalAssists!=null? data.totalAssists : (data.assists||0);
  document.getElementById('profWins').textContent = data.totalWins!=null? data.totalWins : (data.wins||0);
  const rInfo = getRankInfo(data.cups||0);
  document.getElementById('profileRankBadge').innerHTML = rankBadgeSVG(rInfo.tierIndex, rInfo.division, 34);
  const divRoman = rInfo.division? ' '+['','I','II','III','IV','V'][rInfo.division] : '';
  document.getElementById('profileRankName').textContent = rInfo.tier.name + divRoman;
  document.getElementById('profileRankLevel').textContent = rInfo.totalCups+' Cup';
  const myLevel = data.level||1, myExp = data.exp||0, expNeed = expNeededForLevel(myLevel);
  document.getElementById('profileLevelBig').textContent = myLevel;
  document.getElementById('profileExpText').textContent = myExp+' / '+expNeed+' EXP';
  const rankCell = document.getElementById('showcaseRankCell');
  rankCell.style.cursor = 'pointer';
  rankCell.onclick = ()=>{
    document.getElementById('rankBadgeBig').innerHTML = rankBadgeSVG(rInfo.tierIndex, rInfo.division, 100);
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
  };
  document.getElementById('profileEditRow').style.display = editable? 'flex':'none';
  document.getElementById('profileCustomizeRow').style.display = editable? 'block':'none';
  show('screen-profile');
}
function openProfileByName(name){
  if(account && name.toLowerCase()===account.name.toLowerCase()){ openProfile(account, true); return; }
  socket.emit('getProfile', {name}, (res)=>{
    if(!res || !res.ok) return;
    document.getElementById('hubChatOverlay').classList.remove('show');
    document.getElementById('chatOverlay').classList.remove('show');
    openProfile(res.profile, false, matchActive ? 'in-match' : 'screen-main');
  });
}
document.getElementById('profilePill').addEventListener('click', ()=>{ if(account) openProfile(account, true); });
document.getElementById('profileBack').addEventListener('click', ()=>{
  if(viewingProfile && profileOrigin==='in-match'){ document.getElementById('screen-profile').classList.add('hidden'); return; }
  show(viewingProfile? profileOrigin : 'screen-main');
});
document.getElementById('btnChangeAvatar').addEventListener('click', ()=> document.getElementById('avatarFileInput').click());
document.getElementById('avatarFileInput').addEventListener('change', e=>{
  const file = e.target.files[0]; if(!file || !account) return;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = ev=>{
    img.onload = async ()=>{
      const size=96;
      const canv = document.createElement('canvas'); canv.width=size; canv.height=size;
      const cctx = canv.getContext('2d');
      const scale = Math.max(size/img.width, size/img.height);
      const w=img.width*scale, h=img.height*scale;
      cctx.drawImage(img, (size-w)/2, (size-h)/2, w, h);
      account.avatar = canv.toDataURL('image/jpeg', 0.72);
      await persistAccount();
      openProfile(account, true);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});
document.querySelectorAll('.profcust-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    show('screen-shop');
    switchShopTab(btn.getAttribute('data-tab'));
  });
});

