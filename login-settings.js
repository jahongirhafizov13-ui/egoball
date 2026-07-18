// ============================================================================
// login-settings.js - Login screen + Settings screen
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= LOGIN ============================= */
document.getElementById('btnLoginGo').addEventListener('click', ()=>{
  const name = document.getElementById('loginName').value.trim();
  const pass = document.getElementById('loginPass').value;
  const msg = document.getElementById('loginMsg');
  if(!name || !pass){ msg.textContent = LANG==='uz'?'Ism va parolni kiriting':(LANG==='ru'?'Введите имя и пароль':'Enter name and password'); return; }
  msg.textContent = LANG==='uz'?'Kirilmoqda...':LANG==='ru'?'Вход...':'Signing in...';
  socket.emit('login', {name, pass, seed:newAccount(name,pass)}, async (res)=>{
    if(!res || !res.ok){
      const errMsgs = {
        wrong_password: LANG==='uz'?"Parol noto'g'ri":(LANG==='ru'?'Неверный пароль':'Wrong password'),
        server_error: LANG==='uz'?'Server xatosi, qayta urinib ko\'ring':(LANG==='ru'?'Ошибка сервера':'Server error')
      };
      msg.textContent = (res&&errMsgs[res.error]) || errMsgs.server_error;
      return;
    }
    const acc = res.account;
    if(acc.lastNumber===undefined) acc.lastNumber=null;
    if(acc.totalGoals===undefined) acc.totalGoals=0;
    if(acc.totalAssists===undefined) acc.totalAssists=0;
    if(acc.totalWins===undefined) acc.totalWins=0;
    if(acc.avatar===undefined) acc.avatar=null;
    if(acc.frame===undefined) acc.frame=null;
    if(acc.framesOwned===undefined) acc.framesOwned=[];
    if(acc.gcoin===undefined) acc.gcoin=0;
    if(acc.skinsOwned===undefined) acc.skinsOwned=[];
    if(acc.equippedCharacterId===undefined) acc.equippedCharacterId=null;
    if(acc.aurasOwned===undefined) acc.aurasOwned=[];
    if(acc.equippedAura===undefined) acc.equippedAura=null;
    if(acc.exp===undefined) acc.exp=0;
    if(acc.level===undefined) acc.level=1;
    if(acc.cups===undefined) acc.cups=0;
    if(acc.stats===undefined) acc.stats={speed:0,power:0,kickPower:0,control:0};
    if(acc.charStats===undefined){
      // migrate the old account-wide stats into the "base" (no-character) slot,
      // so nobody loses progress; from now on every character keeps its own stats
      acc.charStats = { base: acc.stats };
    }
    if(acc.colors===undefined) acc.colors=[0];
    account = acc;
    playerDisplayName = name;
    await loadSettings();
    updateCoinDisplays();
    renderProfileBadge();
    document.getElementById('accountNote').textContent = (LANG==='uz'?'Xush kelibsiz, ':LANG==='ru'?'Добро пожаловать, ':'Welcome, ') + name;
    socket.emit('hubEnter', {name:playerDisplayName});
    refreshFriends();
    refreshParty();
    show('screen-main');
  });
});
async function persistAccount(){
  if(!account) return;
  socket.emit('saveAccount', {account});
  renderProfileBadge();
}
document.getElementById('btnLogout').addEventListener('click', ()=>{ socket.emit('hubLeave'); account = null; show('screen-login'); });
function updateCoinDisplays(){
  const c = account? account.coins : 0;
  const g = account? (account.gcoin||0) : 0;
  ['coinMain','coinModes','coinShop','coinSkills'].forEach(id=>{ const el=document.getElementById(id); if(el) el.textContent = c; });
  const gEl = document.getElementById('gcoinMain'); if(gEl) gEl.textContent = g;
}
document.getElementById('btnChangeNumber').addEventListener('click', ()=>{
  selectedNumber = account? account.lastNumber : selectedNumber;
  renderNumberGrid(); show('screen-number');
});

/* ============================= SETTINGS ============================= */
let settings = { lang:'uz', controlMode:'pc', controlModeManual:false, resolution:1080, joySens:100, joyDead:10, camZoom:100, sfxVolume:70, sfxMuted:false };
function detectTouch(){ return ('ontouchstart' in window) || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches); }
async function loadSettings(){
  const s = await sGet('egoball:settings', false);
  if(s) settings = Object.assign(settings, s);
  if(!settings.controlModeManual){ settings.controlMode = detectTouch() ? 'mobile' : 'pc'; }
  LANG = settings.lang;
  applySettingsToUI();
  applyI18n();
  applyControlModeUI();
}
async function saveSettings(){ await sSet('egoball:settings', settings, false); }
function applySettingsToUI(){
  document.querySelectorAll('#langRow .chip').forEach(c=>c.classList.toggle('active', c.getAttribute('data-lang')===settings.lang));
  document.getElementById('ctrlPC').classList.toggle('active', settings.controlMode==='pc');
  document.getElementById('ctrlMobile').classList.toggle('active', settings.controlMode==='mobile');
  document.querySelectorAll('#resRow .chip').forEach(c=>c.classList.toggle('active', +c.getAttribute('data-res')===settings.resolution));
  document.getElementById('sensRange').value = settings.joySens;
  document.getElementById('sensVal').textContent = (settings.joySens/100).toFixed(1)+'x';
  document.getElementById('deadRange').value = settings.joyDead;
  document.getElementById('deadVal').textContent = settings.joyDead+'%';
  document.getElementById('mobileOnlyBlock').style.display = settings.controlMode==='mobile' ? 'block':'none';
  document.getElementById('pcKeysBlock').style.display = settings.controlMode==='pc' ? 'block':'none';
  document.getElementById('zoomRange').value = settings.camZoom;
  document.getElementById('zoomVal').textContent = (settings.camZoom/100).toFixed(1)+'x';
  document.getElementById('sfxVolRange').value = settings.sfxVolume;
  document.getElementById('sfxVolVal').textContent = settings.sfxVolume+'%';
  document.getElementById('sfxOn').classList.toggle('active', !settings.sfxMuted);
  document.getElementById('sfxOff').classList.toggle('active', settings.sfxMuted);
}
document.getElementById('sfxVolRange').addEventListener('input', e=>{ settings.sfxVolume = +e.target.value; applySettingsToUI(); updateAmbienceVolume(); });
document.getElementById('sfxVolRange').addEventListener('change', saveSettings);
document.getElementById('sfxOn').addEventListener('click', async ()=>{ settings.sfxMuted=false; applySettingsToUI(); await saveSettings(); playSfx('click'); updateAmbienceVolume(); });
document.getElementById('sfxOff').addEventListener('click', async ()=>{ settings.sfxMuted=true; applySettingsToUI(); await saveSettings(); updateAmbienceVolume(); });
document.getElementById('langRow').addEventListener('click', async e=>{
  const c = e.target.closest('.chip'); if(!c) return;
  settings.lang = c.getAttribute('data-lang'); LANG = settings.lang;
  applySettingsToUI(); applyI18n(); await saveSettings();
});
document.getElementById('ctrlPC').addEventListener('click', async ()=>{ settings.controlMode='pc'; settings.controlModeManual=true; applySettingsToUI(); applyControlModeUI(); await saveSettings(); });
document.getElementById('ctrlMobile').addEventListener('click', async ()=>{ settings.controlMode='mobile'; settings.controlModeManual=true; applySettingsToUI(); applyControlModeUI(); await saveSettings(); });
document.getElementById('resRow').addEventListener('click', async e=>{
  const c = e.target.closest('.chip'); if(!c) return;
  settings.resolution = +c.getAttribute('data-res'); applySettingsToUI(); await saveSettings(); resizeCanvas();
});

document.getElementById('sensRange').addEventListener('input', e=>{ settings.joySens = +e.target.value; applySettingsToUI(); });
document.getElementById('sensRange').addEventListener('change', saveSettings);
document.getElementById('deadRange').addEventListener('input', e=>{ settings.joyDead = +e.target.value; applySettingsToUI(); });
document.getElementById('deadRange').addEventListener('change', saveSettings);
document.getElementById('zoomRange').addEventListener('input', e=>{ settings.camZoom = +e.target.value; applySettingsToUI(); });
document.getElementById('zoomRange').addEventListener('change', saveSettings);

function applyControlModeUI(){
  document.getElementById('mobileControls').classList.toggle('active', settings.controlMode==='mobile' && matchActive);
  if(window.__refreshJoyRestingBase) window.__refreshJoyRestingBase();
}

