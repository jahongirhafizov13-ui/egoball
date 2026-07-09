const express = require('express');
const http = require('http');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const store = require('./store');

const app = express();
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// ---------------------------------------------------------------------------
// HOST/ADMIN endpoint - reachable only by visiting a URL with the secret key
// you set in Render's dashboard (Settings -> Environment -> ADMIN_KEY). This
// works on hosts like Render where there is no way to type into the running
// process's own terminal. It is NOT reachable from inside the game itself -
// no client code calls it, and without the correct key it just returns 403.
//
// Usage (paste in any browser, or share with yourself only):
//   https://YOUR-RENDER-URL/admin/pay?key=YOUR_ADMIN_KEY&name=nickname&amount=500
// A negative amount removes coins instead of granting them.
// ---------------------------------------------------------------------------
app.get('/admin/pay', async (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const name = String(req.query.name || '').trim();
  const amount = Number(req.query.amount);
  if (!name || !Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ ok: false, error: 'usage: /admin/pay?key=...&name=...&amount=500' });
  }
  const nameLower = name.toLowerCase();
  try {
    const account = await store.getAccount(nameLower);
    if (!account) return res.status(404).json({ ok: false, error: 'account_not_found' });
    account.coins = (account.coins || 0) + amount;
    await store.saveAccount(account);
    if (isOnline(nameLower)) emitToName(nameLower, 'coinsGranted', { amount, newBalance: account.coins });
    res.json({ ok: true, name: account.name, amount, newBalance: account.coins });
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
    players: room.players, chat: room.chat, hasPassword: !!room.passwordHash
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

function localServerCode(i) { return 'LOCAL' + i; }
function ensureLocalServer(i) {
  const code = localServerCode(i);
  if (!rooms[code]) {
    rooms[code] = {
      code, mode: '5v5', cap: MAX_TEAM_SIZE * 2, isPublic: true, isLocal: true, started: false,
      hostId: null, players: [], passwordHash: null, chat: []
    };
  }
  return rooms[code];
}
for (let i = 1; i <= LOCAL_SERVER_COUNT; i++) ensureLocalServer(i);

function removePlayerFromRoom(socket) {
  const code = socketRoom[socket.id];
  if (!code || !rooms[code]) return;
  const room = rooms[code];
  const leaving = room.players.find(p => p.id === socket.id);
  room.players = room.players.filter(p => p.id !== socket.id);
  delete socketRoom[socket.id];
  socket.leave(code);

  if (leaving) pushSystemMsg(room, `${leaving.name} chiqib ketdi`);

  if (room.players.length === 0) {
    if (room.isLocal) {
      room.hostId = null; // format/cap stay fixed - just wait for the next arrivals
      room.started = false; // require a fresh, fully-staffed group of real players before the next match begins
    } else {
      delete rooms[code]; // private room with nobody left - tear it down
    }
    return;
  }

  if (room.hostId === socket.id) {
    const next = room.players.find(p => !p.spectator) || room.players[0];
    room.hostId = next.id;
    io.to(code).emit('hostChanged', { newHostId: next.id, room: publicRoomState(room) });
  } else {
    broadcastRoom(code);
  }
}

function removeFromHub(socket) {
  const name = hubUsers[socket.id];
  if (!name) return;
  delete hubUsers[socket.id];
  socket.leave('hub');
  io.to('hub').emit('hubOnlineUpdate', Object.values(hubUsers));
}

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
      let account = await store.getAccount(nameLower);
      if (!account) {
        const passHash = await bcrypt.hash(pass, 10);
        account = Object.assign({}, seed || {}, { name: name.trim(), passHash, friends: [], friendRequests: [] });
        delete account.pass;
        await store.saveAccount(account);
      } else {
        const match = await bcrypt.compare(pass, account.passHash || '');
        if (!match) return cb({ ok: false, error: 'wrong_password' });
        if (!account.friends) account.friends = [];
        if (!account.friendRequests) account.friendRequests = [];
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
        coins: merged.coins || 0, wins: merged.totalWins || 0, frame: merged.frame, avatar: merged.avatar
      });
      if (cb) cb({ ok: true });
    } catch (e) { if (cb) cb({ ok: false }); }
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
  socket.on('hubChat', ({ msg }) => {
    const name = hubUsers[socket.id];
    if (!name || !msg) return;
    io.to('hub').emit('hubChatUpdate', { name, msg });
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
  socket.on('quickPlay', ({ name, mode, color }, cb) => {
    if (!MODE_TEAM_SIZE[mode]) return cb({ ok: false, error: 'bad_mode' });
    const room = ensureQuickRoom(mode);
    const isHost = !room.hostId;
    if (isHost) room.hostId = socket.id;
    const spectator = activeCount(room) >= room.cap;
    const team = spectator ? null : pickTeam(room);
    room.players.push({ id: socket.id, name: name || 'Guest', team, spectator, color: color || null });
    socketRoom[socket.id] = room.code;
    socket.join(room.code);
    pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);
    if (!room.started && activeCount(room) >= room.cap) {
      room.started = true;
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
      list.push({ index: i, count: activeCount(room), cap: MAX_TEAM_SIZE * 2 });
    }
    cb(list);
  });

  socket.on('joinLocalServer', ({ index, name, color }, cb) => {
    const room = ensureLocalServer(index);
    const isHost = !room.hostId;
    if (isHost) room.hostId = socket.id;
    const spectator = activeCount(room) >= room.cap; // only overflow beyond 5v5 (10) becomes spectator
    const team = spectator ? null : pickTeam(room);
    room.players.push({ id: socket.id, name: name || 'Guest', team, spectator, color: color || null });
    socketRoom[socket.id] = room.code;
    socket.join(room.code);
    pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);
    if (!room.started && activeCount(room) >= room.cap) {
      room.started = true;
      // exclude the joiner - they get told directly via their own cb below
      socket.to(room.code).emit('matchStarting', publicRoomState(room));
    } else {
      // still waiting for enough real players - just update everyone's roster/lobby view
      socket.to(room.code).emit('roomUpdate', publicRoomState(room));
    }
    cb({ ok: true, code: room.code, room: publicRoomState(room), myId: socket.id, isHost, spectator });
  });

  // ---- private rooms (optional password) ---------------------------------
  socket.on('createRoom', async ({ mode, name, cap, password, color }, cb) => {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const passwordHash = password ? await bcrypt.hash(password, 8) : null;
    const room = {
      code, mode, cap: cap || 2, isPublic: false, isLocal: false, started: false,
      hostId: socket.id, players: [{ id: socket.id, name: name || 'Host', team: 'A', spectator: false, color: color || null }],
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
        count: activeCount(r), cap: r.cap, hasPassword: !!r.passwordHash
      }));
    cb(list);
  });

  socket.on('joinRoomByCode', async ({ code, name, cap, password, color }, cb) => {
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
    room.players.push({ id: socket.id, name: name || 'Guest', team, spectator, color: color || null });
    socketRoom[socket.id] = code;
    socket.join(code);
    pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);

    if (!room.started && activeCount(room) >= room.cap) {
      room.started = true;
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
  socket.on('chatMessage', ({ code, name, msg }) => {
    const room = rooms[code];
    if (!room) return;
    room.chat.push({ name, msg });
    if (room.chat.length > 40) room.chat.shift();
    io.to(code).emit('chatUpdate', room.chat);
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
    removeFromHub(socket);
    const nameLower = markOffline(socket);
    if (nameLower) notifyFriendsPresence(nameLower, false);
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
//   /pay <playerName> <amount>   - grants (or, with a negative amount, removes)
//                                  Ecoin to/from an account, persisted via
//                                  store.js. If the player is online, their
//                                  balance updates live in their client.
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
    if (!name || !Number.isFinite(amount) || amount === 0) {
      console.log('Foydalanish: /pay <o\'yinchi_ismi> <miqdor>');
      return;
    }
    const nameLower = name.trim().toLowerCase();
    try {
      const account = await store.getAccount(nameLower);
      if (!account) { console.log(`[pay] "${name}" nomli hisob topilmadi.`); return; }
      account.coins = (account.coins || 0) + amount;
      await store.saveAccount(account);
      console.log(`[pay] ${account.name} hisobiga ${amount} Ecoin qo'shildi. Yangi balans: ${account.coins}`);
      if (isOnline(nameLower)) {
        emitToName(nameLower, 'coinsGranted', { amount, newBalance: account.coins });
      }
    } catch (e) {
      console.log('[pay] Xatolik:', e.message);
    }
    return;
  }

  console.log(`Noma'lum buyruq: /${cmd}. Mavjud: /pay <ism> <miqdor>`);
});
console.log("Admin konsol tayyor. Coin (Ecoin) berish uchun yozing: /pay <o'yinchi_ismi> <miqdor>");
