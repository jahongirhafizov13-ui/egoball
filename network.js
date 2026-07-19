// ============================================================================
// network.js - Socket.io connection + i18n strings
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= REALTIME (Socket.io) ============================= */
// Point this at your deployed server when you move off localhost.
const SERVER_URL = 'http://176.101.56.51:3000';
const socket = io(SERVER_URL, { autoConnect: true });
let socketReady = false;
let hasConnectedOnce = false;
socket.on('connect', ()=>{
  socketReady = true;
  if(hasConnectedOnce && typeof roomCode !== 'undefined' && roomCode && typeof myId !== 'undefined'){
    // This is a RECONNECT (not the first connect) while we were in a room - Socket.IO
    // hands out a brand new socket.id after any drop/reconnect, but the server still
    // has us registered under the OLD id. Without this, we'd render as "gone" from our
    // own point of view even though our opponent (who never dropped) still sees us -
    // exactly the "faqat raqib ko'rinadi" symptom.
    const oldId = myId;
    socket.emit('rejoinRoom', { code: roomCode, oldId }, (res)=>{
      if(res && res.ok){ myId = socket.id; }
    });
  }
  hasConnectedOnce = true;
});
socket.on('disconnect', ()=>{ socketReady = false; });

/* ============================= I18N ============================= */
const I18N = {
  uz:{play:"O'ynash",shop:"Do'kon",skillsBtn:"Skill",settings:"Sozlamalar",quit:"Chiqish",tagline:"O'ZINGNI KO'RSAT. MAYDONNI BOSHQAR.",
    loginTitle:"O'yin nomi va parol",namePh:"O'yinchi nomi",passPh:"Parol",continue:"Kirish",back:"Orqaga",
    loginHint:"Birinchi marta bo'lsa, shu nom va parol bilan yangi hisob ochiladi.",
    chooseMode:"Formatni tanlang",chooseType:"O'yin turini tanlang",botsGame:"Bots Game",botsTag:"Botlar bilan",
    multiGame:"Multiplayer Game",multiTag:"Onlayn",pickNumber:"Qaysi raqamda o'ynaysiz?",
    pickNumberHint:"Bu — dumaloq o'yinchingiz ichida chiqadigan jamoaviy raqam (telefon raqam emas)",
    startMatch:"O'yinni boshlash",saveNumber:"Saqlash",onlineRoom:"Xususiy xona",createRoom:"Xona yaratish",joinRoom:"Xonaga qo'shilish",
    roomCodePh:"Xona kodi",roomNote:"Eslatma: onlayn rejim demo tarzda sinxronlanadi, biroz kechikish bo'lishi mumkin.",
    lobby:"Kutish xonasi",language:"Til",controlMode:"Boshqaruv rejimi",pcMode:"PC",mobileMode:"Mobile",
    playerControls:"O'yinchi uchun boshqaruv",joySensitivity:"Jostik sezgirligi",joyDeadzone:"Jostik chegarasi (deadzone)",
    joyFixed:"Statik jostik",joyDynamic:"Dinamik jostik",cameraZoom:"Kamera yaqinlashtirish",soundSettings:"Ovoz sozlamalari",sfxVolume:"Ovoz balandligi",soundOn:"Ovoz yoqilgan",soundOff:"Ovoz o'chirilgan",leaderboard:"Reyting",framesTab:"Ramkalar",donateTitle:"Ecoin sotib olish",donateSub:"Tanlangan miqdorga bosgach, Telegram kanalimizga o'tasiz",donateNote:"To'lov Telegram kanalimiz orqali admin bilan bevosita amalga oshiriladi.",changePhoto:"Rasm qo'yish",pickFrame:"Ramka tanlash (Do'kon)",goalsLbl:"Gol",assistsLbl:"Assist",winsLbl:"G'alaba",kickPlayer:"Chiqarish",buyFrame:"Sotib olish",equipped:"Kiyilgan",equip:"Kiyish",
    pcControlsTitle:"PC boshqaruvi",kMove:"Harakat",kKick:"Zarba",kPower:"Kuchli zarba",kSprint:"Rivojlanish (sprint)",
    resolution:"Tiniqlik (grafika)",account:"Hisob",logout:"Hisobdan chiqish",changeNumber:"Raqamni qayta tanlash",
    statsTab:"Statslar",colorsTab:"Ranglar",playerStatsTitle:"O'yinchi statistikasi",customizeTitle:"Bezash",levelLbl:"Daraja",exit:"Chiqish",kick:"ZARBA",powerKick:"KUCHLI",sprint:"RIVOJ",
    win:"G'ALABA",lose:"MAG'LUBIYAT",draw:"DURANG",speed:"Tezlik",power:"Vazn",kickPower:"Zarba kuchi",control:"Nazorat",
    buy:"Sotib olish (1500)",maxed:"MAKSIMUM",spectator:"Tomoshabin sifatida qo'shildingiz",players:"O'yinchilar",
    menuBtn:"MENYU",chatBtn:"CHAT",rosterTitle:"O'yinchilar",rosterHint:"Nikni boshqa ustunga sudrab olib o'ting",donateTitle:"Ecoin sotib olish",donateHint:"Narxni tanlang - Telegram orqali xarid qilinadi",
    rosterHintReadonly:"Faqat xona egasi o'yinchilarni ko'chira oladi",
    spectatorsCol:"Tomoshabinlar",close:"Yopish",chatPh:"Xabar yozing...",send:"Yuborish",
    playAgain:"Yana o'ynash",exitToMenu:"Chiqish",youScored:"SIZ GOL URDINGIZ!",teamScored:"JAMOADOSHINGIZ GOL URDI!",
    oppScored:"QARSHI JAMOA GOL URDI",hubTitle:"Multiplayer",hubChooseSub:"Ommaviy serverda o'ynang yoki o'zingiz xona oching",
    hubSub:"Har bir formatda 2 tadan ommaviy server bor",publicServers:"Ommaviy serverlar",publicTag:"Admin yo'q",privateTag:"Siz host",
    publicNote:"Ommaviy serverga qo'shilgan o'yinchilar host/admin bo'la olmaydi — faqat o'yinchi sifatida o'ynaydi.",
    privateRoom:"Shaxsiy xona",allFull:"Barcha serverlar to'la — tomoshabin sifatida qo'shildingiz",
    multiplayerBtn:"Multiplayer",hubChatTitle:"Umumiy chat",localServers:"Serverlar",roomPassOptPh:"Parol (ixtiyoriy)",
    editLayout:"Tugmalar joylashuvini tahrirlash",editLayoutHint:"Belgilarni istagan joyga suring, so'ng saqlang",
    joyMarker:"JOY",resetLayout:"Standart holat",saveLayout:"Saqlash",
    friendsBtn:"Do'stlar",friendAddPh:"Nickname kiriting...",friendAddBtn:"Yuborish",friendsListTitle:"Do'stlar",friendRequestsTitle:"So'rovlar",
    decoTitle:"RAMKA / RANG TANLASH",decoFramesTitle:"Ramkalar",decoColorsTitle:"Ranglar",decoNoneOwned:"Hali ramka sotib olinmagan",
    leavePartyBtn:"Guruhdan chiqish",
    caseOddsTitle:"Skinlar va tushish foizi",auraTab:"Aura",stadiumTab:"Stadion",bannerTab:"Banner",
    autoDetectNote:"Qurilma turi avtomatik aniqlanadi, xohlasangiz qo'lda o'zgartiring."},
  ru:{play:"Играть",shop:"Магазин",skillsBtn:"Скилл",settings:"Настройки",quit:"Выход",tagline:"ПОКАЖИ СЕБЯ. УПРАВЛЯЙ ПОЛЕМ.",
    loginTitle:"Имя и пароль",namePh:"Имя игрока",passPh:"Пароль",continue:"Войти",back:"Назад",
    loginHint:"Если впервые — будет создан новый аккаунт с этим именем и паролем.",
    chooseMode:"Выберите формат",chooseType:"Выберите режим игры",botsGame:"Игра с ботами",botsTag:"С ботами",
    multiGame:"Мультиплеер",multiTag:"Онлайн",pickNumber:"Какой у вас номер?",
    pickNumberHint:"Это номер игрока на поле (не телефонный номер)",
    startMatch:"Начать матч",saveNumber:"Сохранить",onlineRoom:"Личная комната",createRoom:"Создать комнату",joinRoom:"Присоединиться",
    roomCodePh:"Код комнаты",roomNote:"Внимание: онлайн-режим синхронизируется в демо-формате, возможна задержка.",
    lobby:"Комната ожидания",language:"Язык",controlMode:"Режим управления",pcMode:"ПК",mobileMode:"Мобильный",
    playerControls:"Управление игроком",joySensitivity:"Чувствительность стика",joyDeadzone:"Мёртвая зона стика",
    joyFixed:"Статичный стик",joyDynamic:"Динамичный стик",cameraZoom:"Приближение камеры",soundSettings:"Настройки звука",sfxVolume:"Громкость звука",soundOn:"Звук включён",soundOff:"Звук выключен",leaderboard:"Рейтинг",framesTab:"Рамки",donateTitle:"Купить Ecoin",donateSub:"После выбора суммы вы перейдёте в наш Telegram-канал",donateNote:"Оплата производится напрямую через админа в нашем Telegram-канале.",changePhoto:"Загрузить фото",pickFrame:"Выбрать рамку (Магазин)",goalsLbl:"Голы",assistsLbl:"Ассисты",winsLbl:"Победы",kickPlayer:"Удалить",buyFrame:"Купить",equipped:"Надето",equip:"Надеть",
    pcControlsTitle:"Управление на ПК",kMove:"Движение",kKick:"Удар",kPower:"Сильный удар",kSprint:"Рывок",
    resolution:"Чёткость (графика)",account:"Аккаунт",logout:"Выйти из аккаунта",changeNumber:"Выбрать номер заново",
    statsTab:"Статы",colorsTab:"Цвета",playerStatsTitle:"Статистика игрока",customizeTitle:"Оформление",levelLbl:"Уровень",exit:"Выход",kick:"УДАР",powerKick:"СИЛЬНЫЙ",sprint:"РЫВОК",
    win:"ПОБЕДА",lose:"ПОРАЖЕНИЕ",draw:"НИЧЬЯ",speed:"Скорость",power:"Вес",kickPower:"Сила удара",control:"Контроль",
    buy:"Купить (1500)",maxed:"МАКСИМУМ",spectator:"Вы вошли как зритель",players:"Игроки",
    menuBtn:"МЕНЮ",chatBtn:"ЧАТ",rosterTitle:"Игроки",rosterHint:"Перетащите ник в другую колонку",donateTitle:"Купить Ecoin",donateHint:"Выберите сумму - покупка через Telegram",
    rosterHintReadonly:"Только хозяин комнаты может перемещать игроков",
    spectatorsCol:"Зрители",close:"Закрыть",chatPh:"Напишите сообщение...",send:"Отправить",
    playAgain:"Играть снова",exitToMenu:"Выход",youScored:"ВЫ ЗАБИЛИ ГОЛ!",teamScored:"ВАША КОМАНДА ЗАБИЛА!",
    oppScored:"СОПЕРНИК ЗАБИЛ ГОЛ",hubTitle:"Мультиплеер",hubChooseSub:"Играйте на публичном сервере или создайте свою комнату",
    hubSub:"В каждом формате по 2 публичных сервера",publicServers:"Публичные серверы",publicTag:"Без админа",privateTag:"Вы хост",
    publicNote:"Игроки на публичном сервере не могут быть хостом/админом — только игра.",
    privateRoom:"Личная комната",allFull:"Все серверы заполнены — вы зритель",
    multiplayerBtn:"Мультиплеер",hubChatTitle:"Общий чат",localServers:"Серверы",roomPassOptPh:"Пароль (необязательно)",
    editLayout:"Изменить расположение кнопок",editLayoutHint:"Перетащите метки куда нужно, затем сохраните",
    joyMarker:"СТИК",resetLayout:"По умолчанию",saveLayout:"Сохранить",
    friendsBtn:"Друзья",friendAddPh:"Введите никнейм...",friendAddBtn:"Отправить",friendsListTitle:"Друзья",friendRequestsTitle:"Запросы",
    decoTitle:"ВЫБОР РАМКИ / ЦВЕТА",decoFramesTitle:"Рамки",decoColorsTitle:"Цвета",decoNoneOwned:"Рамки ещё не куплены",
    leavePartyBtn:"Покинуть группу",
    caseOddsTitle:"Скины и шанс выпадения",auraTab:"Аура",stadiumTab:"Стадион",bannerTab:"Баннер",
    autoDetectNote:"Тип устройства определяется автоматически, можно изменить вручную."},
  en:{play:"Play",shop:"Shop",skillsBtn:"Skill",settings:"Settings",quit:"Quit",tagline:"SHOW YOUR EGO. RULE THE PITCH.",
    loginTitle:"Game name & password",namePh:"Player name",passPh:"Password",continue:"Enter",back:"Back",
    loginHint:"First time here? A new account is created with this name and password.",
    chooseMode:"Choose a format",chooseType:"Choose game type",botsGame:"Bots Game",botsTag:"vs Bots",
    multiGame:"Multiplayer Game",multiTag:"Online",pickNumber:"Which number do you play?",
    pickNumberHint:"This is the on-field team number shown inside your player circle (not a phone number)",
    startMatch:"Start Match",saveNumber:"Save",onlineRoom:"Private Room",createRoom:"Create Room",joinRoom:"Join Room",
    roomCodePh:"Room code",roomNote:"Note: online mode syncs in demo fashion, some lag may occur.",
    lobby:"Waiting Room",language:"Language",controlMode:"Control Mode",pcMode:"PC",mobileMode:"Mobile",
    playerControls:"Player controls",joySensitivity:"Joystick sensitivity",joyDeadzone:"Joystick deadzone",
    joyFixed:"Fixed joystick",joyDynamic:"Dynamic joystick",cameraZoom:"Camera zoom",soundSettings:"Sound settings",sfxVolume:"Sound volume",soundOn:"Sound on",soundOff:"Sound off",leaderboard:"Leaderboard",framesTab:"Frames",donateTitle:"Buy Ecoin",donateSub:"After picking an amount you'll be taken to our Telegram channel",donateNote:"Payment is arranged directly with the admin in our Telegram channel.",changePhoto:"Upload photo",pickFrame:"Pick frame (Shop)",goalsLbl:"Goals",assistsLbl:"Assists",winsLbl:"Wins",kickPlayer:"Kick",buyFrame:"Buy",equipped:"Equipped",equip:"Equip",
    pcControlsTitle:"PC controls",kMove:"Move",kKick:"Kick",kPower:"Power kick",kSprint:"Sprint",
    resolution:"Resolution (graphics)",account:"Account",logout:"Log out",changeNumber:"Re-pick number",
    statsTab:"Stats",colorsTab:"Colors",playerStatsTitle:"Player Statistics",customizeTitle:"Customize",levelLbl:"Level",exit:"Exit",kick:"KICK",powerKick:"POWER",sprint:"SPRINT",
    win:"VICTORY",lose:"DEFEAT",draw:"DRAW",speed:"Speed",power:"Power",kickPower:"Kick Power",control:"Control",
    buy:"Buy (1500)",maxed:"MAXED",spectator:"You joined as a spectator",players:"Players",
    menuBtn:"MENU",chatBtn:"CHAT",rosterTitle:"Players",rosterHint:"Drag a nick into another column",donateTitle:"Buy Ecoin",donateHint:"Pick an amount - purchased via Telegram",
    rosterHintReadonly:"Only the room owner can move players",
    spectatorsCol:"Spectators",close:"Close",chatPh:"Type a message...",send:"Send",
    playAgain:"Play again",exitToMenu:"Exit",youScored:"YOU SCORED!",teamScored:"YOUR TEAM SCORED!",
    oppScored:"OPPONENT SCORED",hubTitle:"Multiplayer",hubChooseSub:"Play on a public server or open your own room",
    hubSub:"Each format has 2 public servers",publicServers:"Public Servers",publicTag:"No admin",privateTag:"You're host",
    publicNote:"Players who join a public server can never become host/admin — they just play.",
    privateRoom:"Private Room",allFull:"All servers full — you joined as spectator",
    multiplayerBtn:"Multiplayer",hubChatTitle:"Global chat",localServers:"Servers",roomPassOptPh:"Password (optional)",
    editLayout:"Edit control layout",editLayoutHint:"Drag the markers where you want, then save",
    joyMarker:"STICK",resetLayout:"Reset to default",saveLayout:"Save",
    friendsBtn:"Friends",friendAddPh:"Enter nickname...",friendAddBtn:"Send",friendsListTitle:"Friends",friendRequestsTitle:"Requests",
    decoTitle:"CHOOSE FRAME / COLOR",decoFramesTitle:"Frames",decoColorsTitle:"Colors",decoNoneOwned:"No frames owned yet",
    leavePartyBtn:"Leave party",
    caseOddsTitle:"Skins & drop chance",auraTab:"Aura",stadiumTab:"Stadium",bannerTab:"Banner",
    autoDetectNote:"Device type is auto-detected; change manually if you like."}
};
let LANG = 'uz';
function t(k){ return (I18N[LANG]&&I18N[LANG][k]) || I18N.uz[k] || k; }
function applyI18n(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const k = el.getAttribute('data-i18n');
    if(el.children.length===0){ el.textContent = t(k); }
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  document.getElementById('autoDetectNote').textContent = t('autoDetectNote');
  renderModeGrid(); renderShop(); renderNumberGrid();
  if(account) renderPlayerStats();
}

document.getElementById('btnFullscreen').addEventListener('click', ()=>{
  if(!document.fullscreenElement){
    (document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen||function(){}).call(document.documentElement);
  } else {
    (document.exitFullscreen||document.webkitExitFullscreen||function(){}).call(document);
  }
});
document.addEventListener('fullscreenchange', ()=>{
  document.getElementById('btnFullscreen').textContent = document.fullscreenElement ? '⤢' : '⛶';
  // some mobile browsers don't immediately recompute % heights right after a fullscreen
  // transition - nudge everything to re-measure against the real, current viewport
  setTimeout(()=>{
    window.dispatchEvent(new Event('resize'));
    if(typeof resizeCanvas==='function') resizeCanvas();
  }, 60);
});

