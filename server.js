const express = require('express');
const http = require('http');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const store = require('./store');

const app = express();
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

function localServerCode(i) { return 'LOCAL' + i; }
function ensureLocalServer(i) {
  const code = localServerCode(i);
  if (!rooms[code]) {
    rooms[code] = {
      code, mode: null, cap: null, isPublic: true, isLocal: true, started: false,
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
      // reset the slot so the next arrivals get a fresh auto-balance decision
      room.started = false; room.mode = null; room.cap = null; room.hostId = null;
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
        account = Object.assign({}, seed || {}, { name: name.trim(), passHash });
        delete account.pass;
        await store.saveAccount(account);
      } else {
        const match = await bcrypt.compare(pass, account.passHash || '');
        if (!match) return cb({ ok: false, error: 'wrong_password' });
      }
      const { passHash, ...safe } = account;
      cb({ ok: true, account: safe });
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

  // ---- 10 local auto-balance servers -------------------------------------
  socket.on('listLocalServers', (cb) => {
    const list = [];
    for (let i = 1; i <= LOCAL_SERVER_COUNT; i++) {
      const room = ensureLocalServer(i);
      list.push({ index: i, count: activeCount(room), cap: room.cap, mode: room.mode });
    }
    cb(list);
  });

  socket.on('joinLocalServer', ({ index, name }, cb) => {
    const room = ensureLocalServer(index);
    const spectatorOverflow = room.started && activeCount(room) >= room.cap;

    if (!room.started) {
      // decide the format now, based on how many people will be present
      const prospectiveTotal = activeCount(room) + (spectatorOverflow ? 0 : 1);
      const teamSize = Math.min(MAX_TEAM_SIZE, Math.max(1, Math.ceil(prospectiveTotal / 2)));
      room.mode = teamSize + 'v' + teamSize;
      room.cap = teamSize * 2;
    }

    const isHost = !room.hostId;
    if (isHost) room.hostId = socket.id;
    const spectator = activeCount(room) >= room.cap;
    const team = spectator ? null : pickTeam(room);
    room.players.push({ id: socket.id, name: name || 'Guest', team, spectator });
    socketRoom[socket.id] = room.code;
    socket.join(room.code);
    pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);

    if (!room.started && activeCount(room) >= room.cap) {
      room.started = true;
      io.to(room.code).emit('matchStarting', publicRoomState(room));
    } else {
      broadcastRoom(room.code);
    }
    cb({ ok: true, code: room.code, room: publicRoomState(room), myId: socket.id, isHost, spectator });
  });

  // ---- private rooms (optional password) ---------------------------------
  socket.on('createRoom', async ({ mode, name, cap, password }, cb) => {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const passwordHash = password ? await bcrypt.hash(password, 8) : null;
    const room = {
      code, mode, cap: cap || 2, isPublic: false, isLocal: false, started: false,
      hostId: socket.id, players: [{ id: socket.id, name: name || 'Host', team: 'A', spectator: false }],
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

  socket.on('joinRoomByCode', async ({ code, name, cap, password }, cb) => {
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
    room.players.push({ id: socket.id, name: name || 'Guest', team, spectator });
    socketRoom[socket.id] = code;
    socket.join(code);
    pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);

    if (!room.started && activeCount(room) >= room.cap) {
      room.started = true;
      io.to(code).emit('matchStarting', publicRoomState(room));
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
  });
});

store.init().then(() => {
  server.listen(PORT, () => console.log(`EgoBall Socket.io server listening on port ${PORT}`));
});
