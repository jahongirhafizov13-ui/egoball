const express = require('express');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const store = require('./store');

const app = express();
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// ---------------------------------------------------------------------------
// Serve the "skins" folder (character images used by OpenCase) over HTTP.
// IMPORTANT: this folder must sit right next to this server.js file (same
// repo/folder on Render), and filenames must match exactly, lowercase, as
// .png: isagi.png, bachira.png, nagi.png, aiku.png, rin.png, lorenzo.png,
// sae.png, kaiser.png. Once deployed, an image is reachable at e.g.
//   https://YOUR-RENDER-URL/skins/isagi.png
// The client (egoball.html) already points at SERVER_URL + '/skins/...',
// so as long as the files exist here with the right names, they'll load.
// ---------------------------------------------------------------------------
app.use('/skins', express.static(path.join(__dirname, 'skins')));
app.use('/auras', express.static(path.join(__dirname, 'auras')));

// ---------------------------------------------------------------------------
// HOST/ADMIN endpoint - reachable only by visiting a URL with the secret key
// you set in Render's dashboard (Settings -> Environment -> ADMIN_KEY). This
// works on hosts like Render where there is no way to type into the running
// process's own terminal. It is NOT reachable from inside the game itself -
// no client code calls it, and without the correct key it just returns 403.
//
// Usage (paste in any browser, or share with yourself only):
//   https://YOUR-RENDER-URL/admin/pay?key=YOUR_ADMIN_KEY&name=nickname&amount=500
//   https://YOUR-RENDER-URL/admin/pay?key=YOUR_ADMIN_KEY&name=nickname&amount=90&currency=gcoin
// A negative amount removes coins instead of granting them.
// ---------------------------------------------------------------------------
app.get('/admin/pay', async (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const name = String(req.query.name || '').trim();
  const amount = Number(req.query.amount);
  const field = req.query.currency === 'gcoin' ? 'gcoin' : 'coins';
  if (!name || !Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ ok: false, error: 'usage: /admin/pay?key=...&name=...&amount=500&currency=coins|gcoin' });
  }
  const nameLower = name.toLowerCase();
  try {
    const account = await store.getAccount(nameLower);
    if (!account) return res.status(404).json({ ok: false, error: 'account_not_found' });
    account[field] = (account[field] || 0) + amount;
    await store.saveAccount(account);
    if (isOnline(nameLower)) emitToName(nameLower, 'coinsGranted', { currency: field, amount, newBalance: account[field] });
    res.json({ ok: true, name: account.name, currency: field, amount, newBalance: account[field] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // tighten this to your GitHub Pages origin before going to production
});

const PORT = process.env.PORT || 3000;
const LOCAL_SERVER_COUNT = 10;
const LOCAL_SERVER_CAP = 10; // shown as "10/X" in the list, regardless of the current round's team size
const MAX_TEAM_SIZE = 5; // caps the auto-balance format at 5v5

// ---------------------------------------------------------------------------
// In-memory room store (game rooms only - accounts/leaderboard live in store.js)
//
// room = {
//   code, mode, cap, isPublic, isLocal, started,
//   hostId, players: [{id,name,team,spectator}],
//   passwordHash (private rooms only, or null),
//   chat: [{name,msg}] / [{sys:true,msg}]
// }
// ---------------------------------------------------------------------------
const rooms = {};
const socketRoom = {};      // socket.id -> game room code
const hubUsers = {};        // socket.id -> display name (present in the Hub)

// ---------------------------------------------------------------------------
// Online presence, keyed by lowercase account name (supports multiple tabs/
// devices per account by tracking a Set of socket ids per name).
// ---------------------------------------------------------------------------
const onlineByName = {};

// ---------------------------------------------------------------------------
// OpenCase (lootbox). The roll happens here, not in the browser, so nobody
// can fake a Legendary pull from devtools. Chances are percentages and sum to 100.
// ---------------------------------------------------------------------------
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
// scaled by how rare it is (this only matters for higher rarities since Common/Rare have decent
// odds of repeating - Myth basically never repeats, but pays out big if it ever does).
const DUPLICATE_BONUS_BY_RANK = { Common:500, Rare:1000, Epic:2500, Legendary:6000, Myth:15000 };
function rollCaseItem(){
  const total = CASE_ITEMS.reduce((sum, item) => sum + item.chance, 0); // percentages don't have to sum to 100 - treated as relative weights
  const roll = Math.random()*total;
  let acc = 0;
  for(const item of CASE_ITEMS){ acc += item.chance; if(roll < acc) return item; }
  return CASE_ITEMS[CASE_ITEMS.length-1]; // floating-point safety net
}

// ---------------------------------------------------------------------------
// Goal auras (Do'kon -> Aura). Bought with G Coin; the equipped one glows
// behind your player for 5s after you score. Prices/ownership are validated
// here, never trusted from the client.
// ---------------------------------------------------------------------------
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
const lastChatAt = {}; // socket.id -> timestamp, shared throttle for both hub and room chat
function chatAllowed(socket){
  const now = Date.now();
  const last = lastChatAt[socket.id] || 0;
  if (now - last < 500) return false; // max ~2 messages/sec per connection
  lastChatAt[socket.id] = now;
  return true;
}
function markOnline(socket, nameLower) {
  if (!onlineByName[nameLower]) onlineByName[nameLower] = new Set();
  onlineByName[nameLower].add(socket.id);
  socket.data = socket.data || {};
  socket.data.accountName = nameLower;
}
function markOffline(socket) {
  const nameLower = socket.data && socket.data.accountName;
  if (!nameLower) return null;
  const set = onlineByName[nameLower];
  if (set) { set.delete(socket.id); if (set.size === 0) delete onlineByName[nameLower]; }
  return nameLower;
}
function isOnline(nameLower) { return !!(onlineByName[nameLower] && onlineByName[nameLower].size > 0); }
function emitToName(nameLower, event, payload) {
  const set = onlineByName[nameLower];
  if (!set) return;
  set.forEach(id => io.to(id).emit(event, payload));
}
async function notifyFriendsPresence(nameLower, online) {
  try {
    const account = await store.getAccount(nameLower);
    if (!account || !account.friends) return;
    account.friends.forEach(fLower => {
      emitToName(fLower, 'friendPresence', { name: account.name, online });
    });
  } catch (e) { /* ignore */ }
}

function activeCount(room) { return room.players.filter(p => !p.spectator).length; }
function pickTeam(room) {
  const a = room.players.filter(p => p.team === 'A' && !p.spectator).length;
  const b = room.players.filter(p => p.team === 'B' && !p.spectator).length;
  return a <= b ? 'A' : 'B';
}
function publicRoomState(room) {
  return {
    code: room.code, mode: room.mode, cap: room.cap, isPublic: room.isPublic,
    isLocal: !!room.isLocal, started: room.started, hostId: room.hostId,
    players: room.players, chat: room.chat, hasPassword: !!room.passwordHash,
    practice: !!room.practice, queueCount: (room.queue || []).length
  };
}
function broadcastRoom(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('roomUpdate', publicRoomState(room));
}
function pushSystemMsg(room, msg) {
  room.chat.push({ sys: true, msg });
  if (room.chat.length > 40) room.chat.shift();
  io.to(room.code).emit('chatUpdate', room.chat);
}

const MODE_TEAM_SIZE = { '1v1':1, '2v2':2, '3v3':3, '4v4':4, '5v5':5 };
// mirrors the client's COLORS palette so the server can resolve a party
// member's equipped color index into a real hex value for teammates to see
const COLORS = ["#e5484d","#e0b13c","#4fb0ff","#39c477","#ff8ac4","#9a6bff","#ff9d4d","#43dede","#c2e04a","#ff5c9e",
  "#5c6bff","#ff7043","#2fd4b0","#f2f2f2","#8a8f98","#101418","#c77dff","#4dd0e1","#ffd166","#ef476f"];

// ---------------------------------------------------------------------------
// HUB PARTY (squad) - up to 4 players (1 host + 3 invited) who see each
// other's avatar live in the Hub screen, then can press Play together to
// face bots as a team. Membership lives only in memory (per server process),
// keyed by lowercase account name so it survives reconnects within a session.
// ---------------------------------------------------------------------------
const MAX_PARTY_SIZE = 4;
const partyHostOf = {};   // memberNameLower -> hostNameLower (host maps to itself once a party exists)
const partyMembers = {};  // hostNameLower -> [memberNameLower, ...] in join order, host first

async function partySnapshot(hostNameLower) {
  const members = partyMembers[hostNameLower] || [hostNameLower];
  const out = [];
  for (const m of members) {
    const acc = await store.getAccount(m);
    out.push({
      name: acc ? acc.name : m,
      avatar: acc ? acc.avatar : null,
      frame: acc ? acc.frame : null,
      equippedColor: acc ? (acc.equippedColor || 0) : 0,
      equippedCharacterId: acc ? acc.equippedCharacterId : null,
      equippedAura: acc ? acc.equippedAura : null,
      online: isOnline(m),
      isHost: m === hostNameLower
    });
  }
  return out;
}
async function broadcastParty(hostNameLower) {
  const snap = await partySnapshot(hostNameLower);
  const members = partyMembers[hostNameLower] || [hostNameLower];
  members.forEach(m => emitToName(m, 'partyUpdate', { hostName: hostNameLower, members: snap }));
}
function leaveOrDisbandParty(nameLower) {
  const hostNameLower = partyHostOf[nameLower];
  if (!hostNameLower) return null;
  if (hostNameLower === nameLower) {
    const members = partyMembers[hostNameLower] || [];
    members.forEach(m => { delete partyHostOf[m]; });
    delete partyMembers[hostNameLower];
    return { disbanded: true, formerMembers: members };
  }
  partyMembers[hostNameLower] = (partyMembers[hostNameLower] || []).filter(m => m !== nameLower);
  delete partyHostOf[nameLower];
  return { disbanded: false, hostNameLower };
}

function findOpenQuickRoom(mode) {
  return Object.values(rooms).find(r => r.isQuick && r.mode === mode && !r.started && activeCount(r) < r.cap);
}
function createQuickRoom(mode) {
  const teamSize = MODE_TEAM_SIZE[mode] || 2;
  const code = 'Q' + Math.random().toString(36).substring(2, 7).toUpperCase();
  const room = {
    code, mode, cap: teamSize * 2, isPublic: true, isLocal: false, isQuick: true, started: false,
    hostId: null, players: [], passwordHash: null, chat: []
  };
  rooms[code] = room;
  return room;
}
function ensureQuickRoom(mode) { return findOpenQuickRoom(mode) || createQuickRoom(mode); }

const LOCAL_FORM_GRACE_MS = 5000; // once a 2nd real player joins, wait this long for more before locking team sizes

function localTeamSize(total){ return Math.min(MAX_TEAM_SIZE, Math.max(1, Math.ceil(total/2))); }

function localServerCode(i) { return 'LOCAL' + i; }
function ensureLocalServer(i) {
  const code = localServerCode(i);
  if (!rooms[code]) {
    rooms[code] = {
      code, mode: null, cap: LOCAL_SERVER_CAP, isPublic: true, isLocal: true,
      started: false, practice: false,
      hostId: null, players: [], queue: [], formTimer: null,
      passwordHash: null, chat: []
    };
  }
  return rooms[code];
}
for (let i = 1; i <= LOCAL_SERVER_COUNT; i++) ensureLocalServer(i);

// Locks in the team sizes/roster for a fresh match, using however many real
// players are present right now, then tells everyone in the room to kick off.
function finalizeLocalMatch(room) {
  clearTimeout(room.formTimer); room.formTimer = null;
  const roster = room.players.filter(p => !p.left);
  if (roster.length < 2) { room.started = false; room.practice = roster.length === 1; broadcastRoom(room.code); return; }
  const teamSize = localTeamSize(roster.length);
  const cap = teamSize * 2;
  let idx = 0;
  roster.forEach(p => {
    if (idx < cap) { p.team = (idx % 2 === 0) ? 'A' : 'B'; p.spectator = false; idx++; }
    else { p.team = null; p.spectator = true; } // more showed up than this round's size fits - queued for next round
  });
  room.queue = roster.filter(p => p.spectator).map(p => p.id);
  room.mode = teamSize + 'v' + teamSize;
  room.cap = LOCAL_SERVER_CAP; // display cap always stays 10 - the number actually playing this round is teamSize*2
  room.practice = false;
  room.started = true;
  initRoomPhysics(room);
  io.to(room.code).emit('matchStarting', publicRoomState(room));
}

// Called by the host when a local-server match's timer runs out. Re-forms the
// room for the next round: the winning team stays, fresh queue challengers
// get priority to replace the losing team, and team size is recomputed from
// however many real players are still around (so it can grow or shrink).
function reformLocalMatch(room, winningTeam) {
  clearTimeout(room.formTimer); room.formTimer = null;
  const winners = room.players.filter(p => !p.left && p.team === winningTeam && !p.spectator);
  const losers = room.players.filter(p => !p.left && p.team && p.team !== winningTeam && !p.spectator);
  const queued = room.queue.map(id => room.players.find(p => p.id === id && !p.left)).filter(Boolean);
  const total = winners.length + losers.length + queued.length;

  if (total < 2) {
    room.players.forEach(p => { p.team = null; p.spectator = false; });
    room.queue = [];
    room.started = false;
    room.practice = total === 1;
    room.mode = null;
    broadcastRoom(room.code);
    return;
  }

  const teamSize = localTeamSize(total);
  const newA = winners.slice(0, teamSize);
  let pool = queued.concat(losers); // fresh challengers get first pick, then the players who just lost
  while (newA.length < teamSize && pool.length) newA.push(pool.shift());
  const newB = pool.slice(0, teamSize);
  pool = pool.slice(teamSize);

  room.players.forEach(p => {
    if (newA.includes(p)) { p.team = 'A'; p.spectator = false; }
    else if (newB.includes(p)) { p.team = 'B'; p.spectator = false; }
    else if (!p.left) { p.team = null; p.spectator = true; }
  });
  room.queue = pool.map(p => p.id);
  room.mode = teamSize + 'v' + teamSize;
  room.started = true;
  initRoomPhysics(room);
  room.practice = false;
  io.to(room.code).emit('matchStarting', publicRoomState(room));
}


function removePlayerFromRoom(socket) {
  const code = socketRoom[socket.id];
  if (!code || !rooms[code]) return;
  const room = rooms[code];
  const leaving = room.players.find(p => p.id === socket.id);
  room.players = room.players.filter(p => p.id !== socket.id);
  room.queue = (room.queue || []).filter(id => id !== socket.id);
  delete socketRoom[socket.id];
  socket.leave(code);

  if (leaving) pushSystemMsg(room, `${leaving.name} chiqib ketdi`);

  if (room.players.length === 0) {
    if (room.isLocal) {
      clearTimeout(room.formTimer); room.formTimer = null;
      room.hostId = null; room.started = false; room.practice = false; room.mode = null; room.queue = [];
      room.phys = null;
    } else {
      delete rooms[code]; // private room with nobody left - tear it down
    }
    return;
  }

  if (room.isLocal && room.started && leaving && !leaving.spectator) {
    // someone actively playing left mid-match - reform immediately using whoever's left,
    // crediting the OTHER team as the "winner" of this interrupted round
    const otherTeam = leaving.team === 'A' ? 'B' : 'A';
    reformLocalMatch(room, otherTeam);
  } else if (room.isLocal && !room.started && room.players.length === 1) {
    room.practice = true;
    broadcastRoom(code);
  }

  if (room.hostId === socket.id) {
    const next = room.players.find(p => !p.spectator) || room.players[0];
    room.hostId = next.id;
    io.to(code).emit('hostChanged', { newHostId: next.id, room: publicRoomState(room) });
  } else if (!(room.isLocal && room.started && leaving && !leaving.spectator)) {
    broadcastRoom(code); // reformLocalMatch (above) already broadcasts its own matchStarting/state
  }
}

function removeFromHub(socket) {
  const name = hubUsers[socket.id];
  if (!name) return;
  delete hubUsers[socket.id];
  socket.leave('hub');
  io.to('hub').emit('hubOnlineUpdate', Object.values(hubUsers));
}

// =============================================================================
// SERVER-AUTHORITATIVE PHYSICS
// One real simulation per active room, ticking on the server itself - not on
// whichever player's phone happened to become "host". Every client (regardless
// of join order) only ever does two things for a multiplayer match: send its
// own input, and render whatever state the server just broadcast. There is no
// more "first player / second player" distinction and nothing for two clients
// to disagree about, because there is only one simulation, running in one
// place, on a fixed clock.
// =============================================================================
const MODES_SRV = {
  '1v1': { teamSize: 1, w: 540, h: 300, goalH: 100 },
  '2v2': { teamSize: 2, w: 880, h: 460, goalH: 150 },
  '3v3': { teamSize: 3, w: 1060, h: 540, goalH: 170 },
  '4v4': { teamSize: 4, w: 1060, h: 540, goalH: 170 }, // 4v4 shares the 3v3 pitch (busier, tighter football)
  '5v5': { teamSize: 5, w: 1420, h: 660, goalH: 210 }
};
const PHYS = {
  TICK_MS: 50, // 20 Hz - light enough for a free host, plenty smooth for a 2D arcade pitch
  PLAYER_SPEED: 2.0, SPEED_PER_LEVEL: 0.11, ACCEL_LERP: 0.25, FRICTION_IDLE: 0.92,
  KICK_BASE: 2.0, KICK_POWER_BONUS: 0.28, KICK_POWER_EXTRA: 7.0, KICK_COOLDOWN_MS: 300, KICK_RANGE: 3,
  POWER_KICK_COOLDOWN_MS: 8000, SPRINT_MULT: 1.6, SPRINT_DURATION_MS: 300, SPRINT_COOLDOWN_MS: 4500,
  BALL_RADIUS: 6, PLAYER_RADIUS: 16, NET_DEPTH: 32, RUNOFF: 40,
  WALL_RESTITUTION: 0.74, BALL_FRICTION: 0.99, MAX_BALL_SPEED: 8,
  BOT_SPEED: 2.0, BOT_ACCEL_LERP: 0.40, BOT_KICK_POWER: 2.8, BOT_KICK_COOLDOWN_MS: 240, BOT_KICK_ANGLE_CONE: 0.52,
  KICKOFF_BARRIER_R: 95, KICKOFF_MS: 3000, GOAL_CELEBRATION_MS: 5000,
  PLAYER_INV_MASS: 0.15, BALL_INV_MASS: 0.85, CONTACT_RESTITUTION: 0.82,
  MATCH_WIN_GOALS: 3, MATCH_DURATION_SEC: 180
};
const DEFAULT_STATS = { speed: 0, kickPower: 0, power: 1, control: 0 }; // "0" bonus baseline for bots/unset

function statOf(p, key) { return (p.stats && typeof p.stats[key] === 'number') ? p.stats[key] : DEFAULT_STATS[key]; }

function buildPhysicsPlayers(room, teamSize, field) {
  const real = room.players.filter(p => !p.spectator && p.team);
  const teamAReal = real.filter(p => p.team === 'A').slice(0, teamSize);
  const teamBReal = real.filter(p => p.team === 'B').slice(0, teamSize);
  const players = [];
  function slotFor(team, idx, entry) {
    const laneY = field.h / (teamSize + 1) * (idx + 1);
    const x = team === 'A' ? field.w * 0.25 : field.w * 0.75;
    return {
      netId: entry ? entry.id : null, team, num: idx + 1,
      x, y: laneY, vx: 0, vy: 0, radius: PHYS.PLAYER_RADIUS,
      isBot: !entry, name: entry ? (entry.name || 'Guest') : 'BOT',
      color: team === 'A' ? '#4fb0ff' : '#ff6b6b', accentColor: entry ? entry.color : null,
      characterId: entry ? entry.characterId : null, auraId: entry ? entry.auraId : null,
      auraUntil: 0, stats: entry ? (entry.stats || DEFAULT_STATS) : DEFAULT_STATS,
      kickCd: 0, powerCd: 0, sprintCd: 0, sprintT: 0, prevKick: false, prevPower: false, facing: 0, kickFlashUntil: 0
    };
  }
  for (let i = 0; i < teamSize; i++) players.push(slotFor('A', i, teamAReal[i]));
  for (let i = 0; i < teamSize; i++) players.push(slotFor('B', i, teamBReal[i]));
  return players;
}

function startKickoffPhys(phys, possessionTeam) {
  const teamSize = phys.field.teamSize;
  phys.players.forEach(p => {
    const idx = p.num - 1;
    const laneY = phys.field.h / (teamSize + 1) * (idx + 1);
    p.x = p.team === 'A' ? phys.field.w * 0.25 : phys.field.w * 0.75;
    p.y = laneY; p.vx = 0; p.vy = 0;
  });
  phys.ball.x = phys.field.w / 2; phys.ball.y = phys.field.h / 2; phys.ball.vx = 0; phys.ball.vy = 0;
  phys.kickoffActive = true; phys.kickoffTeam = possessionTeam; phys.kickoffDeadline = Date.now() + PHYS.KICKOFF_MS;
}

function initRoomPhysics(room) {
  const modeInfo = MODES_SRV[room.mode] || MODES_SRV['2v2'];
  const field = { w: modeInfo.w, h: modeInfo.h, goalH: modeInfo.goalH, teamSize: modeInfo.teamSize };
  const players = buildPhysicsPlayers(room, modeInfo.teamSize, field);
  room.phys = {
    field, players,
    ball: { x: field.w / 2, y: field.h / 2, vx: 0, vy: 0, radius: PHYS.BALL_RADIUS },
    score: { A: 0, B: 0 }, matchTimeLeft: PHYS.MATCH_DURATION_SEC,
    ballFrozen: false, botsFrozen: false, playersFrozen: false,
    netEnteringA: false, netEnteringB: false,
    lastToucherId: null, ended: false, countdown: 0,
    lastTickAt: Date.now()
  };
  startKickoffPhys(room.phys, Math.random() < 0.5 ? 'A' : 'B');
}

const roomInputs = {}; // socket.id -> {mvx,mvy,kick,power,sprint}

function applyHumanControl(p, snap, phys) {
  if (phys.playersFrozen) { p.vx = 0; p.vy = 0; p.prevKick = !!snap.kick; p.prevPower = !!snap.power; return; }
  if (p.sprintCd > 0) p.sprintCd -= PHYS.TICK_MS;
  if (p.powerCd > 0) p.powerCd -= PHYS.TICK_MS;
  if (p.kickCd > 0) p.kickCd -= PHYS.TICK_MS;
  const len = Math.hypot(snap.mvx || 0, snap.mvy || 0);
  let targetSpeed = PHYS.PLAYER_SPEED + statOf(p, 'speed') * PHYS.SPEED_PER_LEVEL;
  if (snap.sprint && p.sprintCd <= 0) { p.sprintT = PHYS.SPRINT_DURATION_MS; p.sprintCd = PHYS.SPRINT_COOLDOWN_MS; }
  if (p.sprintT > 0) { targetSpeed *= PHYS.SPRINT_MULT; p.sprintT -= PHYS.TICK_MS; }
  const moveLerp = snap.kick ? PHYS.ACCEL_LERP * 0.72 : PHYS.ACCEL_LERP;
  if (len > 0.08) {
    const nx = snap.mvx / (len || 1), ny = snap.mvy / (len || 1);
    const dvx = nx * targetSpeed, dvy = ny * targetSpeed;
    p.vx += (dvx - p.vx) * moveLerp; p.vy += (dvy - p.vy) * moveLerp;
    p.facing = Math.atan2(snap.mvy, snap.mvx);
  } else { p.vx *= PHYS.FRICTION_IDLE; p.vy *= PHYS.FRICTION_IDLE; }

  const ball = phys.ball;
  const dist = Math.hypot(ball.x - p.x, ball.y - p.y);
  const inRange = dist < p.radius + ball.radius + PHYS.KICK_RANGE;
  const kickEdge = snap.kick && !p.prevKick;
  if (kickEdge && p.kickCd <= 0 && inRange) {
    const ang = Math.atan2(ball.y - p.y, ball.x - p.x);
    const power = PHYS.KICK_BASE + statOf(p, 'kickPower') * PHYS.KICK_POWER_BONUS;
    ball.vx += Math.cos(ang) * power; ball.vy += Math.sin(ang) * power;
    p.kickCd = PHYS.KICK_COOLDOWN_MS; p.kickFlashUntil = Date.now() + 140;
    phys.lastToucherId = p.netId; p.lastGoalCandidate = true;
  }
  const powerEdge = snap.power && !p.prevPower;
  if (powerEdge && p.powerCd <= 0 && inRange) {
    const ang = Math.atan2(ball.y - p.y, ball.x - p.x);
    const power = PHYS.KICK_BASE + statOf(p, 'kickPower') * PHYS.KICK_POWER_BONUS + PHYS.KICK_POWER_EXTRA * 0.55;
    ball.vx += Math.cos(ang) * power; ball.vy += Math.sin(ang) * power;
    p.powerCd = PHYS.POWER_KICK_COOLDOWN_MS; p.kickFlashUntil = Date.now() + 200;
    phys.lastToucherId = p.netId;
  }
  p.prevKick = !!snap.kick; p.prevPower = !!snap.power;
}

function applyBotAI(p, phys) {
  if (phys.playersFrozen || phys.botsFrozen) { p.vx = 0; p.vy = 0; return; }
  if (p.kickCd > 0) p.kickCd -= PHYS.TICK_MS;
  const field = phys.field, ball = phys.ball, players = phys.players;
  const goalX = p.team === 'A' ? field.w : 0;
  const distBall = Math.hypot(ball.x - p.x, ball.y - p.y);
  const teammates = players.filter(o => o !== p && o.team === p.team);
  const teammatesCloser = teammates.some(o => Math.hypot(ball.x - o.x, ball.y - o.y) < distBall);
  const teamArr = players.filter(pp => pp.team === p.team);
  const laneIndex = teamArr.indexOf(p);
  const laneY = field.h / (teamArr.length + 1) * (laneIndex + 1);
  let tx, ty;
  if (!teammatesCloser) {
    const leadTime = 6;
    const predX = Math.max(24, Math.min(field.w - 24, ball.x + ball.vx * leadTime));
    const predY = Math.max(24, Math.min(field.h - 24, ball.y + ball.vy * leadTime));
    const approachOffset = p.radius + ball.radius - 3;
    tx = predX + (p.team === 'A' ? -approachOffset : approachOffset);
    ty = predY;
  } else {
    const homeX = p.team === 'A' ? field.w * (0.24 + 0.10 * (laneIndex % 3)) : field.w * (0.76 - 0.10 * (laneIndex % 3));
    tx = homeX + (ball.x - field.w / 2) * 0.22;
    ty = laneY * 0.55 + ball.y * 0.35 + (field.h / 2) * 0.10;
  }
  const dx = tx - p.x, dy = ty - p.y; const d = Math.hypot(dx, dy);
  let botSpeed = PHYS.BOT_SPEED;
  const slowRadius = 40;
  if (d < slowRadius) botSpeed *= Math.max(0.25, d / slowRadius);
  if (d > 2) {
    const nx = dx / d, ny = dy / d;
    p.vx += (nx * botSpeed - p.vx) * PHYS.BOT_ACCEL_LERP; p.vy += (ny * botSpeed - p.vy) * PHYS.BOT_ACCEL_LERP;
  } else { p.vx *= 0.85; p.vy *= 0.85; }
  teammates.forEach(o => {
    const ddx = p.x - o.x, ddy = p.y - o.y, dd = Math.hypot(ddx, ddy);
    const minSep = p.radius * 2.6;
    if (dd < minSep && dd > 0.01) { const push = (minSep - dd) / minSep; p.vx += (ddx / dd) * push * 1.4; p.vy += (ddy / dd) * push * 1.4; }
  });
  if (distBall < p.radius + ball.radius + PHYS.KICK_RANGE && p.kickCd <= 0) {
    const opp = players.filter(o => o.team !== p.team);
    const toGoalAng = Math.atan2((field.h / 2) - p.y, goalX - p.x);
    const blocker = opp.find(o => {
      const dOpp = Math.hypot(o.x - p.x, o.y - p.y);
      if (dOpp > 95) return false;
      const toOppAng = Math.atan2(o.y - p.y, o.x - p.x);
      let diff = Math.abs(toGoalAng - toOppAng); if (diff > Math.PI) diff = Math.PI * 2 - diff;
      return diff < 0.55;
    });
    let targetAng;
    if (blocker && Math.random() < 0.65) {
      const aimX = goalX, aimY = field.h / 2 + (Math.random() - 0.5) * 70;
      const useTopWall = p.y < field.h / 2;
      const mirrorY = useTopWall ? -aimY : (2 * field.h - aimY);
      targetAng = Math.atan2(mirrorY - p.y, aimX - p.x);
    } else {
      let bestMate = null, bestScore = -1;
      teammates.forEach(m => {
        const advancement = p.team === 'A' ? (m.x - p.x) : (p.x - m.x);
        if (advancement > 30) {
          const openness = opp.length ? Math.min(...opp.map(o => Math.hypot(o.x - m.x, o.y - m.y))) : 999;
          const scoreV = advancement + openness * 0.5;
          if (scoreV > bestScore) { bestScore = scoreV; bestMate = m; }
        }
      });
      const goalDist = Math.hypot(goalX - p.x, (field.h / 2) - p.y);
      if (goalDist > field.w * 0.42 && bestMate && Math.random() < 0.55) {
        targetAng = Math.atan2(bestMate.y - p.y, bestMate.x - p.x);
      } else {
        targetAng = Math.atan2((field.h / 2 + (Math.random() - 0.5) * 70) - p.y, goalX - p.x);
      }
    }
    const realAng = Math.atan2(ball.y - p.y, ball.x - p.x);
    let angDiff = targetAng - realAng;
    angDiff = Math.atan2(Math.sin(angDiff), Math.cos(angDiff));
    angDiff = Math.max(-PHYS.BOT_KICK_ANGLE_CONE, Math.min(PHYS.BOT_KICK_ANGLE_CONE, angDiff));
    targetAng = realAng + angDiff;
    ball.vx += Math.cos(targetAng) * PHYS.BOT_KICK_POWER; ball.vy += Math.sin(targetAng) * PHYS.BOT_KICK_POWER;
    p.kickCd = PHYS.BOT_KICK_COOLDOWN_MS; p.kickFlashUntil = Date.now() + 140;
    phys.lastToucherId = p.netId;
  }
}

function scoreGoalPhys(room, team) {
  const phys = room.phys;
  phys.netEnteringA = false; phys.netEnteringB = false;
  phys.score[team]++;
  const scorer = phys.players.find(p => p.netId === phys.lastToucherId);
  if (scorer && scorer.team === team && scorer.auraId) scorer.auraUntil = Date.now() + 5000;
  io.to(room.code).emit('matchEvent', { type: 'goal', team, scorerName: scorer ? scorer.name : null, scorerId: scorer ? scorer.netId : null, score: phys.score });
  phys.ballFrozen = true; phys.botsFrozen = true;
  phys.ball.x = phys.field.w / 2; phys.ball.y = phys.field.h / 2; phys.ball.vx = 0; phys.ball.vy = 0;
  setTimeout(() => {
    if (!room.phys || room.phys !== phys) return; // room/match already gone
    if (phys.score.A >= PHYS.MATCH_WIN_GOALS || phys.score.B >= PHYS.MATCH_WIN_GOALS) {
      endRoomMatch(room); return;
    }
    startKickoffPhys(phys, team === 'A' ? 'B' : 'A');
    phys.playersFrozen = true;
    phys.countdown = 3;
    const tickDown = () => {
      if (!room.phys || room.phys !== phys) return;
      io.to(room.code).emit('matchEvent', { type: 'countdown', n: phys.countdown });
      if (phys.countdown <= 0) {
        phys.ballFrozen = false; phys.playersFrozen = false; phys.botsFrozen = false;
        io.to(room.code).emit('matchEvent', { type: 'kickoffGo' });
        return;
      }
      phys.countdown--;
      setTimeout(tickDown, 1000);
    };
    tickDown();
  }, PHYS.GOAL_CELEBRATION_MS);
}

function endRoomMatch(room) {
  const phys = room.phys;
  if (!phys || phys.ended) return;
  phys.ended = true;
  io.to(room.code).emit('matchEvent', { type: 'end', score: phys.score });
  room.started = false;
  room.phys = null;
  if (room.isLocal) {
    const winningTeam = phys.score.A === phys.score.B ? 'A' : (phys.score.A > phys.score.B ? 'A' : 'B');
    reformLocalMatch(room, winningTeam);
  }
}

function tickRoomPhysics(room) {
  const phys = room.phys;
  if (!phys || phys.ended) return;
  const field = phys.field, ball = phys.ball, players = phys.players;

  players.forEach(p => {
    if (p.isBot) return;
    const snap = roomInputs[p.netId] || { mvx: 0, mvy: 0, kick: false, power: false, sprint: false };
    applyHumanControl(p, snap, phys);
  });
  players.forEach(p => { if (p.isBot) applyBotAI(p, phys); });

  players.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.93; p.vy *= 0.93;
    if (Math.abs(p.vx) < 0.02) p.vx = 0; if (Math.abs(p.vy) < 0.02) p.vy = 0;
    const r = p.radius;
    if (p.x < r - PHYS.RUNOFF) { p.x = r - PHYS.RUNOFF; p.vx *= -0.3; } if (p.x > field.w - r + PHYS.RUNOFF) { p.x = field.w - r + PHYS.RUNOFF; p.vx *= -0.3; }
    if (p.y < r - PHYS.RUNOFF) { p.y = r - PHYS.RUNOFF; p.vy *= -0.3; } if (p.y > field.h - r + PHYS.RUNOFF) { p.y = field.h - r + PHYS.RUNOFF; p.vy *= -0.3; }
  });

  if (phys.kickoffActive) {
    if (Date.now() > phys.kickoffDeadline) phys.kickoffActive = false;
    else {
      const restrictedTeam = phys.kickoffTeam === 'A' ? 'B' : 'A';
      const mid = field.w / 2;
      players.forEach(p => {
        if (p.team !== restrictedTeam) return;
        if (restrictedTeam === 'B') { if (p.x < mid + PHYS.KICKOFF_BARRIER_R) { p.x = mid + PHYS.KICKOFF_BARRIER_R; if (p.vx < 0) p.vx = 0; } }
        else { if (p.x > mid - PHYS.KICKOFF_BARRIER_R) { p.x = mid - PHYS.KICKOFF_BARRIER_R; if (p.vx > 0) p.vx = 0; } }
      });
    }
  }

  const goalTop = field.h / 2 - field.goalH / 2, goalBot = field.h / 2 + field.goalH / 2;
  if (!phys.netEnteringA && !phys.netEnteringB) {
    ball.x += ball.vx; ball.y += ball.vy;
    ball.vx *= PHYS.BALL_FRICTION; ball.vy *= PHYS.BALL_FRICTION;
    if (Math.hypot(ball.vx, ball.vy) < 0.03) { ball.vx = 0; ball.vy = 0; }
    const bspd = Math.hypot(ball.vx, ball.vy);
    if (bspd > PHYS.MAX_BALL_SPEED) { ball.vx = ball.vx / bspd * PHYS.MAX_BALL_SPEED; ball.vy = ball.vy / bspd * PHYS.MAX_BALL_SPEED; }
    if (ball.x < ball.radius) {
      if (ball.y > goalTop && ball.y < goalBot) {
        if (ball.x <= -ball.radius) { phys.netEnteringB = true; setTimeout(() => { if (phys.netEnteringB) scoreGoalPhys(room, 'B'); }, 120); }
      } else { ball.x = ball.radius; ball.vx *= -PHYS.WALL_RESTITUTION; }
    }
    if (ball.x > field.w - ball.radius) {
      if (ball.y > goalTop && ball.y < goalBot) {
        if (ball.x >= field.w + ball.radius) { phys.netEnteringA = true; setTimeout(() => { if (phys.netEnteringA) scoreGoalPhys(room, 'A'); }, 120); }
      } else { ball.x = field.w - ball.radius; ball.vx *= -PHYS.WALL_RESTITUTION; }
    }
    if (ball.y < ball.radius) { ball.y = ball.radius; ball.vy *= -PHYS.WALL_RESTITUTION; }
    if (ball.y > field.h - ball.radius) { ball.y = field.h - ball.radius; ball.vy *= -PHYS.WALL_RESTITUTION; }
  } else {
    ball.x += ball.vx * 0.6; ball.y += ball.vy * 0.4;
    if (phys.netEnteringB) ball.x = Math.max(ball.x, -PHYS.NET_DEPTH + 2);
    if (phys.netEnteringA) ball.x = Math.min(ball.x, field.w + PHYS.NET_DEPTH - 2);
  }

  players.forEach(p => {
    const dx = ball.x - p.x, dy = ball.y - p.y, dist = Math.hypot(dx, dy);
    const minD = p.radius + ball.radius;
    if (dist < minD && dist > 0.01 && !phys.netEnteringA && !phys.netEnteringB) {
      const nx = dx / dist, ny = dy / dist, overlap = minD - dist;
      ball.x += nx * overlap; ball.y += ny * overlap;
      const rvx = p.vx - ball.vx, rvy = p.vy - ball.vy;
      const rvn = rvx * nx + rvy * ny;
      if (rvn > 0) {
        const j = (1 + PHYS.CONTACT_RESTITUTION) * rvn / (PHYS.PLAYER_INV_MASS + PHYS.BALL_INV_MASS);
        ball.vx += j * PHYS.BALL_INV_MASS * nx; ball.vy += j * PHYS.BALL_INV_MASS * ny;
        p.vx -= j * PHYS.PLAYER_INV_MASS * nx; p.vy -= j * PHYS.PLAYER_INV_MASS * ny;
      }
      const incomingSpeed = -(ball.vx * nx + ball.vy * ny);
      if (incomingSpeed > 0) {
        const absorb = Math.min(0.35, statOf(p, 'control') * 0.05);
        ball.vx += nx * incomingSpeed * absorb; ball.vy += ny * incomingSpeed * absorb;
      }
      phys.lastToucherId = p.netId;
    }
  });
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
      const minD = a.radius + b.radius;
      if (dist < minD && dist > 0.01) {
        const nx = dx / dist, ny = dy / dist, overlap = (minD - dist) / 2;
        const weightA = 1 + statOf(a, 'power') * 0.08, weightB = 1 + statOf(b, 'power') * 0.08;
        a.x -= nx * overlap * (weightB / (weightA + weightB)) * 2; a.y -= ny * overlap * (weightB / (weightA + weightB)) * 2;
        b.x += nx * overlap * (weightA / (weightA + weightB)) * 2; b.y += ny * overlap * (weightA / (weightA + weightB)) * 2;
        [a, b].forEach(pl => {
          const rr = pl.radius;
          pl.x = Math.max(rr - PHYS.RUNOFF, Math.min(field.w - rr + PHYS.RUNOFF, pl.x));
          pl.y = Math.max(rr - PHYS.RUNOFF, Math.min(field.h - rr + PHYS.RUNOFF, pl.y));
        });
      }
    }
  }
  if (phys.ballFrozen) { ball.x = field.w / 2; ball.y = field.h / 2; ball.vx = 0; ball.vy = 0; }

  const now = Date.now();
  const dt = (now - phys.lastTickAt) / 1000;
  phys.lastTickAt = now;
  if (!phys.playersFrozen && !phys.ballFrozen) {
    phys.matchTimeLeft -= dt;
    if (phys.matchTimeLeft <= 0) { phys.matchTimeLeft = 0; endRoomMatch(room); return; }
  }
}

function serializePhysics(room) {
  const phys = room.phys;
  if (!phys) return null;
  return {
    field: phys.field,
    ball: { x: phys.ball.x, y: phys.ball.y },
    players: phys.players.map(p => ({
      id: p.netId, x: p.x, y: p.y, team: p.team, num: p.num, isBot: p.isBot, name: p.name,
      color: p.color, accentColor: p.accentColor, characterId: p.characterId, auraId: p.auraId, auraUntil: p.auraUntil || 0,
      kickFlashUntil: p.kickFlashUntil || 0, facing: p.facing
    })),
    score: phys.score, matchTimeLeft: Math.max(0, Math.round(phys.matchTimeLeft)),
    kickoffActive: phys.kickoffActive, kickoffTeam: phys.kickoffTeam,
    kickoffMsLeft: phys.kickoffActive ? Math.max(0, phys.kickoffDeadline - Date.now()) : 0,
    ballFrozen: phys.ballFrozen, playersFrozen: phys.playersFrozen
  };
}

setInterval(() => {
  Object.values(rooms).forEach(room => {
    if (!room.phys) return;
    tickRoomPhysics(room);
    if (room.phys) io.to(room.code).emit('physicsState', serializePhysics(room));
  });
}, PHYS.TICK_MS);

io.on('connection', (socket) => {

  // ---- accounts (persistent, replaces the old window.storage login) --------
  // Single "login" flow, same UX as before: first time a name+password is used,
  // the account is created; after that the password must match.
  // `seed` is the client's own default account shape (stats, colors, etc.) so
  // the server doesn't need to know every gameplay field - it only owns the
  // password hash and persistence.
  socket.on('login', async ({ name, pass, seed }, cb) => {
    try {
      const nameLower = (name || '').trim().toLowerCase();
      if (!nameLower || !pass) return cb({ ok: false, error: 'invalid' });
      if (name.trim().length > 12) return cb({ ok: false, error: 'name_too_long' });
      if (pass.length > 20) return cb({ ok: false, error: 'password_too_long' });
      let account = await store.getAccount(nameLower);
      if (!account) {
        const passHash = await bcrypt.hash(pass, 10);
        account = Object.assign({}, seed || {}, { name: name.trim(), passHash, friends: [], friendRequests: [] });
        delete account.pass;
        account.coins = (account.coins || 0) + 150; // welcome bonus for brand-new players
        await store.saveAccount(account);
      } else {
        const match = await bcrypt.compare(pass, account.passHash || '');
        if (!match) return cb({ ok: false, error: 'wrong_password' });
        if (!account.friends) account.friends = [];
        if (!account.friendRequests) account.friendRequests = [];
      }
      // Enforce a single active session per account: if this account is already
      // logged in elsewhere (another browser/tab/device), kick that old session
      // out with a clear notice before letting the new login proceed. This is
      // what actually prevents "one account controlled from two places at once" -
      // the account itself was always unique (storage keys are lowercased), the
      // missing piece was that nothing ever stopped a second concurrent session.
      if (onlineByName[nameLower] && onlineByName[nameLower].size > 0) {
        const oldSocketIds = Array.from(onlineByName[nameLower]);
        oldSocketIds.forEach(oldId => {
          io.to(oldId).emit('forceLoggedOut', { reason: 'another_login' });
          const oldSocket = io.sockets.sockets.get(oldId);
          if (oldSocket) { removePlayerFromRoom(oldSocket); oldSocket.disconnect(true); }
        });
        delete onlineByName[nameLower];
      }
      markOnline(socket, nameLower);
      const { passHash, ...safe } = account;
      cb({ ok: true, account: safe });
      notifyFriendsPresence(nameLower, true);
    } catch (e) { cb({ ok: false, error: 'server_error' }); }
  });

  socket.on('saveAccount', async ({ account }, cb) => {
    try {
      const nameLower = (account.name || '').trim().toLowerCase();
      const existing = await store.getAccount(nameLower);
      const merged = { ...existing, ...account, passHash: existing ? existing.passHash : undefined };
      await store.saveAccount(merged);
      await store.upsertLeaderboardEntry({
        name: merged.name, goals: merged.totalGoals || 0, assists: merged.totalAssists || 0,
        coins: merged.coins || 0, wins: merged.totalWins || 0, frame: merged.frame, avatar: merged.avatar,
        cups: merged.cups || 0, level: merged.level || 1
      });
      if (cb) cb({ ok: true });
    } catch (e) { if (cb) cb({ ok: false }); }
  });

  socket.on('openCase', async (payload, cb) => {
    if (typeof cb !== 'function') return;
    try {
      const nameLower = socket.data && socket.data.accountName;
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
      const nameLower = socket.data && socket.data.accountName;
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
      const nameLower = socket.data && socket.data.accountName;
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
      const nameLower = socket.data && socket.data.accountName;
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
      const nameLower = socket.data && socket.data.accountName;
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
      const nameLower = socket.data && socket.data.accountName;
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

  socket.on('getLeaderboard', async (cb) => {
    try { cb(await store.getLeaderboard()); } catch (e) { cb([]); }
  });

  socket.on('getProfile', async ({ name }, cb) => {
    try {
      const account = await store.getAccount((name || '').trim().toLowerCase());
      if (!account) return cb({ ok: false });
      cb({
        ok: true, profile: {
          name: account.name, avatar: account.avatar, frame: account.frame,
          equippedColor: account.equippedColor, equippedCharacterId: account.equippedCharacterId,
          equippedAura: account.equippedAura, equippedBanner: account.equippedBanner,
          avatarRing: account.avatarRing, lastNumber: account.lastNumber,
          level: account.level || 1, exp: account.exp || 0, cups: account.cups || 0,
          totalGoals: account.totalGoals || 0, totalAssists: account.totalAssists || 0,
          totalWins: account.totalWins || 0, coins: account.coins || 0
        }
      });
    } catch (e) { cb({ ok: false }); }
  });

  // ---- hub: global chat + online presence ------------------------------
  socket.on('hubEnter', ({ name }) => {
    hubUsers[socket.id] = name || 'Guest';
    socket.join('hub');
    io.to('hub').emit('hubOnlineUpdate', Object.values(hubUsers));
  });
  socket.on('hubLeave', () => removeFromHub(socket));

  // ---- hub party (squad) --------------------------------------------------
  socket.on('getParty', async ({ name }, cb) => {
    const nameLower = (name || '').trim().toLowerCase();
    const hostNameLower = partyHostOf[nameLower] || nameLower;
    const members = await partySnapshot(hostNameLower);
    cb && cb({ ok: true, hostName: hostNameLower, members });
  });

  socket.on('partyInvite', async ({ from, to }, cb) => {
    try {
      const fromLower = (from || '').trim().toLowerCase();
      const toLower = (to || '').trim().toLowerCase();
      if (!fromLower || !toLower || fromLower === toLower) return cb({ ok: false, error: 'invalid' });
      const fromHost = partyHostOf[fromLower] || fromLower;
      if (fromHost !== fromLower) return cb({ ok: false, error: 'not_host' }); // only the party host invites more people
      const current = partyMembers[fromHost] || [fromHost];
      if (current.length >= MAX_PARTY_SIZE) return cb({ ok: false, error: 'party_full' });
      if (current.includes(toLower)) return cb({ ok: false, error: 'already_in_party' });
      if (partyHostOf[toLower] && (partyMembers[partyHostOf[toLower]] || []).length > 1) {
        return cb({ ok: false, error: 'target_in_other_party' });
      }
      if (!isOnline(toLower)) return cb({ ok: false, error: 'offline' });
      const fromAcc = await store.getAccount(fromLower);
      const toAcc = await store.getAccount(toLower);
      if (!toAcc) return cb({ ok: false, error: 'not_found' });
      emitToName(toLower, 'partyInviteReceived', { fromName: fromAcc ? fromAcc.name : from, fromNameLower: fromLower });
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: 'server_error' }); }
  });

  socket.on('partyInviteRespond', async ({ name, fromNameLower, accept }, cb) => {
    try {
      const nameLower = (name || '').trim().toLowerCase();
      if (!accept) { cb && cb({ ok: true }); return; }
      leaveOrDisbandParty(nameLower); // drop out of whatever party you were already in (even if solo)
      const hostNameLower = partyHostOf[fromNameLower] || fromNameLower;
      if (!partyMembers[hostNameLower]) partyMembers[hostNameLower] = [hostNameLower];
      if (!partyHostOf[hostNameLower]) partyHostOf[hostNameLower] = hostNameLower;
      if (partyMembers[hostNameLower].length >= MAX_PARTY_SIZE) return cb && cb({ ok: false, error: 'party_full' });
      if (!partyMembers[hostNameLower].includes(nameLower)) partyMembers[hostNameLower].push(nameLower);
      partyHostOf[nameLower] = hostNameLower;
      await broadcastParty(hostNameLower);
      cb && cb({ ok: true });
    } catch (e) { cb && cb({ ok: false, error: 'server_error' }); }
  });

  socket.on('partyLeave', async ({ name }, cb) => {
    const nameLower = (name || '').trim().toLowerCase();
    const result = leaveOrDisbandParty(nameLower);
    if (result) {
      if (result.disbanded) {
        result.formerMembers.forEach(m => emitToName(m, 'partyUpdate', { hostName: m, members: [] }));
      } else {
        await broadcastParty(result.hostNameLower);
        emitToName(nameLower, 'partyUpdate', { hostName: nameLower, members: [] });
      }
    }
    cb && cb({ ok: true });
  });

  // host presses Play with 2+ real party members present: everyone currently
  // online in the party is dropped straight into a fresh private match on the
  // same team, with any empty slots auto-filled by bots (spawnPlayersMulti on
  // the client already fills unfilled roster slots with bots automatically)
  socket.on('partyStartVsBots', async ({ name, mode }, cb) => {
    try {
      const nameLower = (name || '').trim().toLowerCase();
      const hostNameLower = partyHostOf[nameLower] || nameLower;
      if (hostNameLower !== nameLower) return cb({ ok: false, error: 'not_host' });
      if (!MODE_TEAM_SIZE[mode]) return cb({ ok: false, error: 'bad_mode' });
      const members = partyMembers[hostNameLower] || [hostNameLower];
      const teamSize = MODE_TEAM_SIZE[mode];
      const code = 'P' + Math.random().toString(36).substring(2, 7).toUpperCase();
      const room = {
        code, mode, cap: teamSize * 2, isPublic: false, isLocal: false, started: true,
        hostId: null, players: [], passwordHash: null, chat: []
      };
      for (const m of members) {
        const sid = (m === nameLower) ? socket.id : (onlineByName[m] && onlineByName[m].values().next().value);
        if (!sid) continue; // skip anyone who disconnected but wasn't cleaned up yet
        const acc = await store.getAccount(m);
        if (!room.hostId) room.hostId = sid;
        room.players.push({
          id: sid, name: acc ? acc.name : m, team: 'A', spectator: false,
          color: acc ? COLORS[acc.equippedColor || 0] : null,
          characterId: acc ? acc.equippedCharacterId : null,
          auraId: acc ? acc.equippedAura : null,
          cups: acc ? (acc.cups||0) : 0, level: acc ? (acc.level||1) : 1
        });
        socketRoom[sid] = code;
        io.sockets.sockets.get(sid) && io.sockets.sockets.get(sid).join(code);
      }
      if (room.players.length === 0) return cb({ ok: false, error: 'party_empty' });
      rooms[code] = room;
      initRoomPhysics(room);
      const state = publicRoomState(room);
      // tell every OTHER online party member to jump straight into this match
      members.forEach(m => { if (m !== nameLower) emitToName(m, 'partyMatchReady', { code, room: state }); });
      cb({ ok: true, code, room: state, myId: room.hostId });
    } catch (e) { cb({ ok: false, error: 'server_error' }); }
  });
  socket.on('hubChat', async ({ msg }) => {
    const name = hubUsers[socket.id];
    if (!name || typeof msg !== 'string' || !msg.trim() || msg.length > 140) return;
    if (!chatAllowed(socket)) return;
    let level = 1, cups = 0;
    try {
      const acc = await store.getAccount(name.toLowerCase());
      if (acc) { level = acc.level || 1; cups = acc.cups || 0; }
    } catch (e) {}
    io.to('hub').emit('hubChatUpdate', { name, msg: msg.trim().slice(0,140), level, cups });
  });

  // ---- friends: requests, list with online status, and game invites ------
  socket.on('getFriends', async ({ name }, cb) => {
    try {
      const nameLower = (name || '').trim().toLowerCase();
      const account = await store.getAccount(nameLower);
      if (!account) return cb({ ok: false, friends: [], requests: [] });
      const friendNames = account.friends || [];
      const friends = [];
      for (const fLower of friendNames) {
        const facc = await store.getAccount(fLower);
        friends.push({ name: facc ? facc.name : fLower, online: isOnline(fLower) });
      }
      const requests = (account.friendRequests || []).map(r => ({ from: r.from, fromName: r.fromName || r.from, ts: r.ts }));
      cb({ ok: true, friends, requests });
    } catch (e) { cb({ ok: false, friends: [], requests: [] }); }
  });

  socket.on('sendFriendRequest', async ({ from, to }, cb) => {
    try {
      const fromLower = (from || '').trim().toLowerCase();
      const toLower = (to || '').trim().toLowerCase();
      if (!fromLower || !toLower || fromLower === toLower) return cb({ ok: false, error: 'invalid' });
      const fromAcc = await store.getAccount(fromLower);
      const toAcc = await store.getAccount(toLower);
      if (!fromAcc || !toAcc) return cb({ ok: false, error: 'not_found' });
      fromAcc.friends = fromAcc.friends || [];
      if (fromAcc.friends.includes(toLower)) return cb({ ok: false, error: 'already_friends' });
      toAcc.friendRequests = toAcc.friendRequests || [];
      if (toAcc.friendRequests.some(r => r.from === fromLower)) return cb({ ok: false, error: 'already_sent' });
      toAcc.friendRequests.push({ from: fromLower, fromName: fromAcc.name, ts: Date.now() });
      await store.saveAccount(toAcc);
      emitToName(toLower, 'friendRequestReceived', { from: fromAcc.name });
      cb({ ok: true });
    } catch (e) { cb({ ok: false, error: 'server_error' }); }
  });

  socket.on('respondFriendRequest', async ({ name, from, accept }, cb) => {
    try {
      const nameLower = (name || '').trim().toLowerCase();
      const fromLower = (from || '').trim().toLowerCase();
      const account = await store.getAccount(nameLower);
      if (!account) return cb && cb({ ok: false });
      account.friendRequests = (account.friendRequests || []).filter(r => r.from !== fromLower);
      if (accept) {
        account.friends = account.friends || [];
        if (!account.friends.includes(fromLower)) account.friends.push(fromLower);
        const fromAcc = await store.getAccount(fromLower);
        if (fromAcc) {
          fromAcc.friends = fromAcc.friends || [];
          if (!fromAcc.friends.includes(nameLower)) fromAcc.friends.push(nameLower);
          await store.saveAccount(fromAcc);
        }
      }
      await store.saveAccount(account);
      emitToName(fromLower, 'friendRequestResult', { name: account.name, accepted: !!accept });
      cb && cb({ ok: true });
    } catch (e) { cb && cb({ ok: false }); }
  });

  socket.on('removeFriend', async ({ name, friend }, cb) => {
    try {
      const nameLower = (name || '').trim().toLowerCase();
      const friendLower = (friend || '').trim().toLowerCase();
      const account = await store.getAccount(nameLower);
      if (account) { account.friends = (account.friends || []).filter(f => f !== friendLower); await store.saveAccount(account); }
      const facc = await store.getAccount(friendLower);
      if (facc) { facc.friends = (facc.friends || []).filter(f => f !== nameLower); await store.saveAccount(facc); }
      cb && cb({ ok: true });
    } catch (e) { cb && cb({ ok: false }); }
  });

  // invite an online friend into the room/match you're currently in
  socket.on('inviteFriendToGame', ({ fromName, toName, code }) => {
    const toLower = (toName || '').trim().toLowerCase();
    if (!toLower || !code) return;
    emitToName(toLower, 'gameInvite', { fromName, code });
  });

  // ---- quick random-fill match (any format), used by the friend-invite flow:
  // caller joins/creates an open public room of the chosen size; remaining
  // slots keep auto-filling with whoever else queues into that same format ----
  socket.on('quickPlay', ({ name, mode, color, characterId, auraId, cups, level, stats }, cb) => {
    if (socketRoom[socket.id]) removePlayerFromRoom(socket);
    if (!MODE_TEAM_SIZE[mode]) return cb({ ok: false, error: 'bad_mode' });
    const room = ensureQuickRoom(mode);
    const isHost = !room.hostId;
    if (isHost) room.hostId = socket.id;
    const spectator = activeCount(room) >= room.cap;
    const team = spectator ? null : pickTeam(room);
    room.players.push({ id: socket.id, name: name || 'Guest', team, spectator, color: color || null, characterId: characterId || null, auraId: auraId || null, cups: cups||0, level: level||1, stats: stats||null });
    socketRoom[socket.id] = room.code;
    socket.join(room.code);
    pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);
    if (!room.started && activeCount(room) >= room.cap) {
      room.started = true;
      initRoomPhysics(room);
      socket.to(room.code).emit('matchStarting', publicRoomState(room));
    } else {
      socket.to(room.code).emit('roomUpdate', publicRoomState(room));
    }
    cb({ ok: true, code: room.code, room: publicRoomState(room), myId: socket.id, isHost, spectator });
  });

  // ---- 10 local auto-balance servers -------------------------------------
  // These are a continuous "drop-in/drop-out" arena: the moment anyone joins,
  // the match is live. New joiners are folded into the running match on
  // whichever team is smaller. The field is always sized for up to 5v5.
  socket.on('listLocalServers', (cb) => {
    const list = [];
    for (let i = 1; i <= LOCAL_SERVER_COUNT; i++) {
      const room = ensureLocalServer(i);
      const count = room.players.filter(p => !p.left).length;
      list.push({ index: i, count, cap: LOCAL_SERVER_CAP, full: count >= LOCAL_SERVER_CAP, mode: room.mode, practice: room.practice });
    }
    cb(list);
  });

  socket.on('joinLocalServer', ({ index, name, color, characterId, auraId, cups, level, stats }, cb) => {
    if (socketRoom[socket.id]) removePlayerFromRoom(socket); // leave any room they were already in first - no duplicate entries
    const room = ensureLocalServer(index);
    const currentCount = room.players.filter(p => !p.left).length;
    if (currentCount >= LOCAL_SERVER_CAP) return cb({ ok: false, error: 'full' });

    const isHost = !room.hostId;
    if (isHost) room.hostId = socket.id;
    const willQueue = !!room.started; // only a spectator if a match is already running
    const player = { id: socket.id, name: name || 'Guest', team: null, spectator: willQueue, color: color || null, characterId: characterId || null, auraId: auraId || null, cups: cups||0, level: level||1, stats: stats||null };
    room.players.push(player);
    socketRoom[socket.id] = room.code;
    socket.join(room.code);

    const total = room.players.filter(p => !p.left).length;
    if (room.started) {
      // a match is already running - queue up for the next round
      room.queue.push(socket.id);
      pushSystemMsg(room, `${name || 'Guest'} navbatga qo'shildi`);
      broadcastRoom(room.code);
    } else if (total === 1) {
      // alone - practice mode: no timer, no goals, just the ball
      room.practice = true;
      pushSystemMsg(room, `${name || 'Guest'} kirdi (mashq)`);
      broadcastRoom(room.code);
    } else {
      room.practice = false;
      pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);
      if (total >= LOCAL_SERVER_CAP) {
        finalizeLocalMatch(room);
      } else {
        clearTimeout(room.formTimer);
        room.formTimer = setTimeout(() => finalizeLocalMatch(room), LOCAL_FORM_GRACE_MS);
        broadcastRoom(room.code);
      }
    }

    cb({ ok: true, code: room.code, room: publicRoomState(room), myId: socket.id, isHost, spectator: player.spectator });
  });

  // host reports a local-server match has ended (timer ran out); server
  // re-forms the room for the next round (winner stays, queue promoted)
  // Match end and local-room reform are now decided entirely by the server's
  // own physics loop (see endRoomMatch), so a client-reported end is ignored -
  // acting on it here would risk reforming the room twice.
  socket.on('localMatchEnded', () => {});

  // ---- private rooms (optional password) ---------------------------------
  socket.on('createRoom', async ({ mode, name, cap, password, color, characterId, auraId, roomName, cups, level, stats }, cb) => {
    if (socketRoom[socket.id]) removePlayerFromRoom(socket);
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const passwordHash = password ? await bcrypt.hash(password, 8) : null;
    const room = {
      code, mode, cap: cap || 2, isPublic: false, isLocal: false, started: false,
      roomName: (roomName || '').trim().slice(0, 24) || null,
      hostId: socket.id, players: [{ id: socket.id, name: name || 'Host', team: 'A', spectator: false, color: color || null, characterId: characterId || null, auraId: auraId || null, cups: cups||0, level: level||1, stats: stats||null }],
      passwordHash, chat: []
    };
    rooms[code] = room;
    socketRoom[socket.id] = code;
    socket.join(code);
    cb({ ok: true, code, room: publicRoomState(room), myId: socket.id, isHost: true });
  });

  socket.on('listPrivateRooms', (cb) => {
    const list = Object.values(rooms)
      .filter(r => !r.isPublic && !r.isLocal && !r.started)
      .map(r => ({
        code: r.code, hostName: (r.players.find(p => p.id === r.hostId) || {}).name || '?',
        roomName: r.roomName || null,
        count: activeCount(r), cap: r.cap, hasPassword: !!r.passwordHash
      }));
    cb(list);
  });

  socket.on('joinRoomByCode', async ({ code, name, cap, password, color, characterId, auraId, cups, level, stats }, cb) => {
    if (socketRoom[socket.id]) removePlayerFromRoom(socket);
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'not_found' });
    if (room.passwordHash) {
      if (!password) return cb({ ok: false, error: 'password_required' });
      const match = await bcrypt.compare(password, room.passwordHash);
      if (!match) return cb({ ok: false, error: 'wrong_password' });
    }

    const isHost = !room.hostId;
    if (isHost) room.hostId = socket.id;

    const spectator = activeCount(room) >= room.cap;
    const team = spectator ? null : pickTeam(room);
    room.players.push({ id: socket.id, name: name || 'Guest', team, spectator, color: color || null, characterId: characterId || null, auraId: auraId || null, cups: cups||0, level: level||1, stats: stats||null });
    socketRoom[socket.id] = code;
    socket.join(code);
    pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);

    if (!room.started && activeCount(room) >= room.cap) {
      room.started = true;
      initRoomPhysics(room);
      // exclude the joiner - they get told directly via their own cb below
      socket.to(code).emit('matchStarting', publicRoomState(room));
    } else {
      broadcastRoom(code);
    }
    cb({ ok: true, room: publicRoomState(room), myId: socket.id, isHost, spectator });
  });

  socket.on('startMatch', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    room.started = true;
    initRoomPhysics(room);
    io.to(code).emit('matchStarting', publicRoomState(room));
  });

  socket.on('leaveRoom', () => removePlayerFromRoom(socket));

  // ---- host kicks a player (private rooms only - never public/local servers,
  // and only the room's real host can do it) ---------------------------------
  socket.on('kickPlayer', ({ code, targetId }) => {
    const room = rooms[code];
    if (!room) return;
    if (room.isPublic || room.isLocal) return; // admin powers never apply to public/local servers
    if (room.hostId !== socket.id) return; // only the actual host can kick
    if (targetId === socket.id) return; // can't kick yourself
    const target = room.players.find(p => p.id === targetId);
    if (!target) return;
    room.players = room.players.filter(p => p.id !== targetId);
    delete socketRoom[targetId];
    pushSystemMsg(room, `${target.name} chiqarib yuborildi`);
    io.to(targetId).emit('kicked');
    io.sockets.sockets.get(targetId)?.leave(code);
    broadcastRoom(code);
  });

  // ---- realtime match relay (host-authoritative, unchanged) ---------------
  socket.on('hostState', ({ code, state }) => { socket.to(code).emit('stateUpdate', state); });
  socket.on('guestInput', ({ code, snap }) => {
    const room = rooms[code];
    if (!room || !room.hostId) return;
    io.to(room.hostId).emit('inputUpdate', { id: socket.id, snap });
  });

  // ---- in-room chat --------------------------------------------------
  socket.on('chatMessage', async ({ code, name, msg }) => {
    const room = rooms[code];
    if (!room) return;
    if (typeof msg !== 'string' || !msg.trim() || msg.length > 140) return;
    if (!chatAllowed(socket)) return;
    let level = 1, cups = 0;
    try {
      const acc = await store.getAccount((name || '').toLowerCase());
      if (acc) { level = acc.level || 1; cups = acc.cups || 0; }
    } catch (e) {}
    room.chat.push({ name, msg: msg.trim().slice(0,140), level, cups });
    if (room.chat.length > 40) room.chat.shift();
    io.to(code).emit('chatUpdate', room.chat);
  });

  // ---- authoritative-physics input channel --------------------------------
  // Clients no longer send full state - just their own controls, at whatever
  // rate their device manages. The server always simulates on its own clock.
  socket.on('input', (snap) => {
    roomInputs[socket.id] = {
      mvx: Number(snap && snap.mvx) || 0,
      mvy: Number(snap && snap.mvy) || 0,
      kick: !!(snap && snap.kick),
      power: !!(snap && snap.power),
      sprint: !!(snap && snap.sprint)
    };
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
    removeFromHub(socket);
    delete lastChatAt[socket.id];
    delete roomInputs[socket.id];
    const nameLower = markOffline(socket);
    if (nameLower) {
      notifyFriendsPresence(nameLower, false);
      if (!isOnline(nameLower)) {
        const result = leaveOrDisbandParty(nameLower);
        if (result) {
          if (result.disbanded) {
            result.formerMembers.forEach(m => emitToName(m, 'partyUpdate', { hostName: m, members: [] }));
          } else {
            broadcastParty(result.hostNameLower);
          }
        }
      }
    }
  });
});

store.init().then(() => {
  server.listen(PORT, () => console.log(`EgoBall Socket.io server listening on port ${PORT}`));
});

// ---------------------------------------------------------------------------
// HOST/ADMIN CONSOLE - typed directly into this Node process's own terminal.
// This reads process.stdin only; it is never reachable from a browser, a
// socket event, or any in-game action, so no client-side cheat can trigger it.
//
// Commands:
//   /pay <playerName> <amount> [ecoin|gcoin]
//                                - grants (or, with a negative amount, removes)
//                                  Ecoin (default) or G Coin to/from an account,
//                                  persisted via store.js. If the player is
//                                  online, their balance updates live in their client.
// ---------------------------------------------------------------------------
const readline = require('readline');
const adminConsole = readline.createInterface({ input: process.stdin, terminal: false });
adminConsole.on('line', async (raw) => {
  const line = raw.trim();
  if (!line.startsWith('/')) return;
  const parts = line.slice(1).split(/\s+/).filter(Boolean);
  const cmd = (parts.shift() || '').toLowerCase();

  if (cmd === 'pay') {
    const name = parts[0];
    const amount = Number(parts[1]);
    const field = (parts[2] === 'gcoin') ? 'gcoin' : 'coins';
    const label = field === 'gcoin' ? 'G Coin' : 'Ecoin';
    if (!name || !Number.isFinite(amount) || amount === 0) {
      console.log('Foydalanish: /pay <o\'yinchi_ismi> <miqdor> [ecoin|gcoin]');
      return;
    }
    const nameLower = name.trim().toLowerCase();
    try {
      const account = await store.getAccount(nameLower);
      if (!account) { console.log(`[pay] "${name}" nomli hisob topilmadi.`); return; }
      account[field] = (account[field] || 0) + amount;
      await store.saveAccount(account);
      console.log(`[pay] ${account.name} hisobiga ${amount} ${label} qo'shildi. Yangi balans: ${account[field]}`);
      if (isOnline(nameLower)) {
        emitToName(nameLower, 'coinsGranted', { currency: field, amount, newBalance: account[field] });
      }
    } catch (e) {
      console.log('[pay] Xatolik:', e.message);
    }
    return;
  }

  console.log(`Noma'lum buyruq: /${cmd}. Mavjud: /pay <ism> <miqdor> [ecoin|gcoin]`);
});
console.log("Admin konsol tayyor. Coin berish: /pay <ism> <miqdor> [ecoin|gcoin]  (masalan: /pay Xarun 90 gcoin)");
