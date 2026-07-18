// ============================================================================
// economy.js - everything paid for with in-game currency: OpenCase (character
// skins), Auras (goal celebration effects), and Field Skins (pitch themes).
// All costs/ownership are validated here against the account on disk, never
// trusted from the client.
// ============================================================================
const store = require('./store');

const CASE_COST_GCOIN = 45;
const CASE_ITEMS = [
  { id:'isagi',    rank:'Common',    chance:24,  speed:2.50, kickPower:3.30, power:1.35, control:0.50 },
  { id:'eita',     rank:'Rare',      chance:20,  speed:2.80, kickPower:3.60, power:1.45, control:0.75 },
  { id:'aiku',     rank:'Rare',      chance:20,  speed:2.65, kickPower:3.50, power:1.80, control:0.70 },
  { id:'nagi',     rank:'Epic',      chance:15,  speed:2.85, kickPower:4.80, power:1.70, control:0.96 },
  { id:'reo',      rank:'Epic',      chance:15,  speed:2.80, kickPower:4.50, power:1.55, control:0.92 },
  { id:'yukimiya', rank:'Epic',      chance:15,  speed:2.90, kickPower:4.10, power:1.55, control:0.88 },
  { id:'rin',      rank:'Epic',      chance:15,  speed:2.85, kickPower:4.90, power:1.60, control:0.75 },
  { id:'barou',    rank:'Epic',      chance:15,  speed:2.75, kickPower:5.10, power:1.95, control:0.70 },
  { id:'shidou',   rank:'Legendary', chance:10,  speed:2.95, kickPower:5.70, power:1.85, control:0.75 },
  { id:'kunigami', rank:'Legendary', chance:10,  speed:2.80, kickPower:5.50, power:2.15, control:0.65 },
  { id:'lorenzo',  rank:'Legendary', chance:10,  speed:2.90, kickPower:4.00, power:2.10, control:0.85 },
  { id:'bunny',    rank:'Legendary', chance:5,   speed:3.15, kickPower:3.50, power:1.30, control:0.90 },
  { id:'sae',      rank:'Legendary', chance:5,   speed:2.95, kickPower:5.20, power:1.50, control:0.98 },
  { id:'hugo',     rank:'Legendary', chance:3,   speed:3.05, kickPower:5.00, power:1.65, control:0.85 },
  { id:'kaiser',   rank:'Legendary', chance:3,   speed:3.10, kickPower:6.00, power:1.75, control:0.80 },
  { id:'noelnoa',  rank:'Myth',      chance:0.5, speed:3.20, kickPower:7.00, power:2.20, control:0.95 },
  { id:'loki',     rank:'Myth',      chance:0.5, speed:4.00, kickPower:5.50, power:1.80, control:0.90 },
  { id:'chris',    rank:'Myth',      chance:0.5, speed:3.15, kickPower:6.50, power:2.50, control:0.92 },
  { id:'snuffy',   rank:'Myth',      chance:0.5, speed:3.00, kickPower:5.80, power:2.00, control:1.00 },
  { id:'lawinho',  rank:'Myth',      chance:0.5, speed:3.25, kickPower:5.90, power:1.75, control:0.97 }
];
// Duplicate-pull compensation: if you pull a character you already own, you get Ecoin instead,
// scaled by how rare it is.
const DUPLICATE_BONUS_BY_RANK = { Common:500, Rare:1000, Epic:2500, Legendary:6000, Myth:15000 };
function rollCaseItem(){
  const total = CASE_ITEMS.reduce((sum, item) => sum + item.chance, 0); // treated as relative weights, don't need to sum to 100
  const roll = Math.random()*total;
  let acc = 0;
  for(const item of CASE_ITEMS){ acc += item.chance; if(roll < acc) return item; }
  return CASE_ITEMS[CASE_ITEMS.length-1]; // floating-point safety net
}

// Goal auras (Do'kon -> Aura). Bought with G Coin; the equipped one glows
// behind your player for 5s after you score.
const AURAS = [
  { id:'aura1', name:'Ametist', price:100 },
  { id:'aura2', name:"Bo'ron",  price:150 },
  { id:'aura3', name:'Chaqmoq', price:180 },
  { id:'aura4', name:'Yong\'in', price:220 },
  { id:'aura5', name:'Zumrad',  price:250 },
  { id:'aura6',  name:'Zanjir',           price:220 },
  { id:'aura7',  name:'Kristall',         price:260 },
  { id:'aura8',  name:'Kamalak prizma',   price:280 },
  { id:'aura9',  name:'Glitch',           price:280 },
  { id:'aura10', name:'Soya',             price:300 },
  { id:'aura11', name:'Portlash',         price:300 },
  { id:'aura12', name:'Suv to\'lqini',    price:320 },
  { id:'aura13', name:'Tornado',          price:320 },
  { id:'aura14', name:'Zilzila',          price:360 },
  { id:'aura15', name:'Yulduzlar',        price:360 },
  { id:'aura16', name:'Halqa tanti',      price:380 },
  { id:'aura17', name:'Kometa',           price:400 },
  { id:'aura18', name:'Aurora',           price:420 },
  { id:'aura19', name:'Marmar shar',      price:440 },
  { id:'aura20', name:'Chaqmoq qafasi',   price:460 },
  { id:'aura21', name:'Sehrli doira',     price:480 },
  { id:'aura22', name:'Feniks qanotlari', price:500 },
  { id:'aura23', name:'Ajdar alangasi',   price:550 },
  { id:'aura24', name:'Qora olov',        price:750 },
  { id:'aura25', name:'VIP Oltin',        price:900 }
];
const FIELD_SKINS = [
  { id:'field0', name:"Klassik",              price:0   },
  { id:'field1', name:"Kechqurun Binafsha",   price:150 },
  { id:'field2', name:"Muzli Ko'k",           price:180 },
  { id:'field3', name:"Cho'l Sariq",          price:200 },
  { id:'field4', name:"Qorayu Tun",           price:220 },
  { id:'field5', name:"Qip-qizil Arena",      price:260 },
  { id:'field6', name:"Yorqin Zumrad",        price:280 },
  { id:'field7', name:"Neon Pushti",          price:320 },
  { id:'field8', name:"Kulrang Metall",       price:360 },
  { id:'field9', name:"Oltin VIP Stadion",    price:600 }
];

function registerHandlers(socket) {
  function accountNameOf(socket) { return socket.data && socket.data.accountName; }

  socket.on('openCase', async (payload, cb) => {
    if (typeof cb !== 'function') return;
    try {
      const nameLower = accountNameOf(socket);
      if (!nameLower) return cb({ ok: false, error: 'not_logged_in' });
      const account = await store.getAccount(nameLower);
      if (!account) return cb({ ok: false, error: 'not_found' });
      const gcoin = account.gcoin || 0;
      if (gcoin < CASE_COST_GCOIN) return cb({ ok: false, error: 'not_enough_gcoin' });
      account.gcoin = gcoin - CASE_COST_GCOIN;
      const item = rollCaseItem();
      account.skinsOwned = account.skinsOwned || [];
      const alreadyOwned = account.skinsOwned.includes(item.id);
      let duplicateBonus = 0;
      if (alreadyOwned) {
        duplicateBonus = DUPLICATE_BONUS_BY_RANK[item.rank] || 500;
        account.coins = (account.coins || 0) + duplicateBonus;
      } else {
        account.skinsOwned.push(item.id);
      }
      await store.saveAccount(account);
      cb({ ok: true, item, alreadyOwned, duplicateBonus, coins: account.coins, gcoin: account.gcoin });
    } catch (e) { cb({ ok: false, error: 'server_error' }); }
  });

  socket.on('equipCharacter', async ({ characterId }, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    try {
      const nameLower = accountNameOf(socket);
      if (!nameLower) return cb({ ok: false, error: 'not_logged_in' });
      const account = await store.getAccount(nameLower);
      if (!account) return cb({ ok: false, error: 'not_found' });
      if (characterId && !(account.skinsOwned || []).includes(characterId)) return cb({ ok: false, error: 'not_owned' });
      account.equippedCharacterId = characterId || null;
      await store.saveAccount(account);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: 'server_error' }); }
  });

  socket.on('buyAura', async ({ auraId }, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    try {
      const nameLower = accountNameOf(socket);
      if (!nameLower) return cb({ ok: false, error: 'not_logged_in' });
      const aura = AURAS.find(a => a.id === auraId);
      if (!aura) return cb({ ok: false, error: 'not_found' });
      const account = await store.getAccount(nameLower);
      if (!account) return cb({ ok: false, error: 'not_found' });
      account.aurasOwned = account.aurasOwned || [];
      if (account.aurasOwned.includes(auraId)) return cb({ ok: false, error: 'already_owned' });
      const gcoin = account.gcoin || 0;
      if (gcoin < aura.price) return cb({ ok: false, error: 'not_enough_gcoin' });
      account.gcoin = gcoin - aura.price;
      account.aurasOwned.push(auraId);
      account.equippedAura = auraId;
      await store.saveAccount(account);
      cb({ ok: true, gcoin: account.gcoin });
    } catch (e) { cb({ ok: false, error: 'server_error' }); }
  });

  socket.on('equipAura', async ({ auraId }, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    try {
      const nameLower = accountNameOf(socket);
      if (!nameLower) return cb({ ok: false, error: 'not_logged_in' });
      const account = await store.getAccount(nameLower);
      if (!account) return cb({ ok: false, error: 'not_found' });
      if (auraId && !(account.aurasOwned || []).includes(auraId)) return cb({ ok: false, error: 'not_owned' });
      account.equippedAura = auraId || null;
      await store.saveAccount(account);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: 'server_error' }); }
  });

  socket.on('buyFieldSkin', async ({ skinId }, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    try {
      const nameLower = accountNameOf(socket);
      if (!nameLower) return cb({ ok: false, error: 'not_logged_in' });
      const skin = FIELD_SKINS.find(s => s.id === skinId);
      if (!skin) return cb({ ok: false, error: 'not_found' });
      const account = await store.getAccount(nameLower);
      if (!account) return cb({ ok: false, error: 'not_found' });
      account.fieldSkinsOwned = account.fieldSkinsOwned || [];
      if (skin.price === 0 || account.fieldSkinsOwned.includes(skinId)) return cb({ ok: false, error: 'already_owned' });
      const gcoin = account.gcoin || 0;
      if (gcoin < skin.price) return cb({ ok: false, error: 'not_enough_gcoin' });
      account.gcoin = gcoin - skin.price;
      account.fieldSkinsOwned.push(skinId);
      account.equippedFieldSkin = skinId;
      await store.saveAccount(account);
      cb({ ok: true, gcoin: account.gcoin });
    } catch (e) { cb({ ok: false, error: 'server_error' }); }
  });

  socket.on('equipFieldSkin', async ({ skinId }, cb) => {
    if (typeof cb !== 'function') cb = () => {};
    try {
      const nameLower = accountNameOf(socket);
      if (!nameLower) return cb({ ok: false, error: 'not_logged_in' });
      const account = await store.getAccount(nameLower);
      if (!account) return cb({ ok: false, error: 'not_found' });
      const isFree = skinId === 'field0' || !skinId;
      if (!isFree && !(account.fieldSkinsOwned || []).includes(skinId)) return cb({ ok: false, error: 'not_owned' });
      account.equippedFieldSkin = skinId || 'field0';
      await store.saveAccount(account);
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: 'server_error' }); }
  });
}

module.exports = { registerHandlers, CASE_ITEMS, CASE_COST_GCOIN, AURAS, FIELD_SKINS };
