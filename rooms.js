// ============================================================================
// rooms.js - room & matchmaking management (local auto-balance servers,
// private password-protected rooms, quick-play matchmaking). Owns the live
// `rooms` map and `socketRoom` lookup - nothing outside this file should
// mutate them directly. Delegates all match simulation to physics.js.
// ============================================================================
const bcrypt = require('bcryptjs');

const LOCAL_SERVER_COUNT = 10;
const LOCAL_SERVER_CAP = 10; // shown as "10/X" in the list, regardless of the current round's team size
const MAX_TEAM_SIZE = 5;     // caps the auto-balance format at 5v5
const LOCAL_FORM_GRACE_MS = 5000; // once a 2nd real player joins, wait this long for more before locking team sizes
const MODE_TEAM_SIZE = { '1v1': 1, '2v2': 2, '3v3': 3, '4v4': 4, '5v5': 5 };

function createRoomManager({ io, physics }) {
  const rooms = {};        // code -> room
  const socketRoom = {};   // socket.id -> room code

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

  function localTeamSize(total) { return Math.min(MAX_TEAM_SIZE, Math.max(1, Math.ceil(total / 2))); }
  function localServerCode(i) { return 'LOCAL' + i; }
  function ensureLocalServer(i) {
    const code = localServerCode(i);
    if (!rooms[code]) {
      rooms[code] = {
        code, mode: '1v1', cap: LOCAL_SERVER_CAP, isPublic: true, isLocal: true,
        started: false, practice: false,
        hostId: null, players: [], queue: [], formTimer: null,
        passwordHash: null, chat: []
      };
    }
    return rooms[code];
  }
  for (let i = 1; i <= LOCAL_SERVER_COUNT; i++) ensureLocalServer(i);

  function finalizeLocalMatch(room) {
    clearTimeout(room.formTimer); room.formTimer = null;
    const roster = room.players.filter(p => !p.left);
    if (roster.length < 2) { room.started = false; room.practice = roster.length === 1; broadcastRoom(room.code); return; }
    const teamSize = localTeamSize(roster.length);
    const cap = teamSize * 2;
    let idx = 0;
    roster.forEach(p => {
      if (idx < cap) { p.team = (idx % 2 === 0) ? 'A' : 'B'; p.spectator = false; idx++; }
      else { p.team = null; p.spectator = true; }
    });
    room.queue = roster.filter(p => p.spectator).map(p => p.id);
    room.mode = teamSize + 'v' + teamSize;
    room.cap = LOCAL_SERVER_CAP;
    room.practice = false;
    room.started = true;
    physics.initRoomPhysics(room);
    io.to(room.code).emit('matchStarting', publicRoomState(room));
  }

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
    let pool = queued.concat(losers);
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
    physics.initRoomPhysics(room);
    room.practice = false;
    io.to(room.code).emit('matchStarting', publicRoomState(room));
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
        delete rooms[code];
      }
      return;
    }

    if (room.isLocal && room.started && leaving && !leaving.spectator) {
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
      broadcastRoom(code);
    }
  }

  // ---- wire up all room-related socket events for one connection ----------
  function registerHandlers(socket, { chatAllowed, getAccountLevelCups }) {
    socket.on('quickPlay', ({ name, mode, color, characterId, auraId, cups, level, stats }, cb) => {
      if (socketRoom[socket.id]) removePlayerFromRoom(socket);
      if (!MODE_TEAM_SIZE[mode]) return cb({ ok: false, error: 'bad_mode' });
      const room = ensureQuickRoom(mode);
      const isHost = !room.hostId;
      if (isHost) room.hostId = socket.id;
      const spectator = activeCount(room) >= room.cap;
      const team = spectator ? null : pickTeam(room);
      room.players.push({ id: socket.id, name: name || 'Guest', team, spectator, color: color || null, characterId: characterId || null, auraId: auraId || null, cups: cups || 0, level: level || 1, stats: stats || null });
      socketRoom[socket.id] = room.code;
      socket.join(room.code);
      pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);
      if (!room.started && activeCount(room) >= room.cap) {
        room.started = true;
        physics.initRoomPhysics(room);
        socket.to(room.code).emit('matchStarting', publicRoomState(room));
      } else {
        socket.to(room.code).emit('roomUpdate', publicRoomState(room));
      }
      cb({ ok: true, code: room.code, room: publicRoomState(room), myId: socket.id, isHost, spectator });
    });

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
      if (socketRoom[socket.id]) removePlayerFromRoom(socket);
      const room = ensureLocalServer(index);
      const currentCount = room.players.filter(p => !p.left).length;
      if (currentCount >= LOCAL_SERVER_CAP) return cb({ ok: false, error: 'full' });

      const isHost = !room.hostId;
      if (isHost) room.hostId = socket.id;
      const willQueue = !!room.started;
      const player = { id: socket.id, name: name || 'Guest', team: null, spectator: willQueue, color: color || null, characterId: characterId || null, auraId: auraId || null, cups: cups || 0, level: level || 1, stats: stats || null };
      room.players.push(player);
      socketRoom[socket.id] = room.code;
      socket.join(room.code);

      const total = room.players.filter(p => !p.left).length;
      if (room.started) {
        room.queue.push(socket.id);
        pushSystemMsg(room, `${name || 'Guest'} navbatga qo'shildi`);
        broadcastRoom(room.code);
      } else if (total === 1) {
        room.practice = true;
        pushSystemMsg(room, `${name || 'Guest'} kirdi (mashq)`);
        broadcastRoom(room.code);
      } else {
        room.practice = false;
        pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);
        // live preview of the format this round will lock in as, so the lobby
        // never shows a stale/invalid mode while people are still gathering
        const previewTeamSize = localTeamSize(total);
        room.mode = previewTeamSize + 'v' + previewTeamSize;
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

    // Match end/reform is decided entirely by the server's physics loop now
    // (see physics.js endRoomMatch) - a client-reported end is a no-op so an
    // old/cached client can't trigger a double reform.
    socket.on('localMatchEnded', () => {});

    socket.on('createRoom', async ({ mode, name, cap, password, color, characterId, auraId, roomName, cups, level, stats }, cb) => {
      if (socketRoom[socket.id]) removePlayerFromRoom(socket);
      const safeMode = MODE_TEAM_SIZE[mode] ? mode : '2v2'; // never let an invalid/missing mode into a room's state
      const code = Math.random().toString(36).substring(2, 7).toUpperCase();
      const passwordHash = password ? await bcrypt.hash(password, 8) : null;
      const room = {
        code, mode: safeMode, cap: cap || MODE_TEAM_SIZE[safeMode] * 2, isPublic: false, isLocal: false, started: false,
        roomName: (roomName || '').trim().slice(0, 24) || null,
        hostId: socket.id, players: [{ id: socket.id, name: name || 'Host', team: 'A', spectator: false, color: color || null, characterId: characterId || null, auraId: auraId || null, cups: cups || 0, level: level || 1, stats: stats || null }],
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
      room.players.push({ id: socket.id, name: name || 'Guest', team, spectator, color: color || null, characterId: characterId || null, auraId: auraId || null, cups: cups || 0, level: level || 1, stats: stats || null });
      socketRoom[socket.id] = code;
      socket.join(code);
      pushSystemMsg(room, `${name || 'Guest'} qo'shildi`);
      if (!room.started && activeCount(room) >= room.cap) {
        room.started = true;
        physics.initRoomPhysics(room);
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
      physics.initRoomPhysics(room);
      io.to(code).emit('matchStarting', publicRoomState(room));
    });

    socket.on('leaveRoom', () => removePlayerFromRoom(socket));

    // Fired by a client whose socket just reconnected (new socket.id) while it still
    // believes it's in a room under its OLD id. Re-keys everything so the match doesn't
    // silently lose track of that player - see network.js's 'connect' handler.
    socket.on('rejoinRoom', ({ code, oldId }, cb) => {
      if (typeof cb !== 'function') cb = () => {};
      const room = rooms[code];
      if (!room) return cb({ ok: false, error: 'not_found' });
      const player = room.players.find(p => p.id === oldId);
      if (!player) return cb({ ok: false, error: 'not_in_room' });
      player.id = socket.id;
      delete socketRoom[oldId];
      socketRoom[socket.id] = code;
      socket.join(code);
      if (room.hostId === oldId) room.hostId = socket.id;
      physics.updatePlayerNetId(room, oldId, socket.id);
      broadcastRoom(code);
      cb({ ok: true });
    });

    socket.on('kickPlayer', ({ code, targetId }) => {
      const room = rooms[code];
      if (!room) return;
      if (room.isPublic || room.isLocal) return;
      if (room.hostId !== socket.id) return;
      if (targetId === socket.id) return;
      const target = room.players.find(p => p.id === targetId);
      if (!target) return;
      room.players = room.players.filter(p => p.id !== targetId);
      delete socketRoom[targetId];
      pushSystemMsg(room, `${target.name} chiqarib yuborildi`);
      io.to(targetId).emit('kicked');
      io.sockets.sockets.get(targetId)?.leave(code);
      broadcastRoom(code);
    });

    // legacy host-relay channel - unused by the current server-authoritative
    // client, kept only in case an old cached client is still connected.
    socket.on('hostState', ({ code, state }) => { socket.to(code).emit('stateUpdate', state); });
    socket.on('guestInput', ({ code, snap }) => {
      const room = rooms[code];
      if (!room || !room.hostId) return;
      io.to(room.hostId).emit('inputUpdate', { id: socket.id, snap });
    });

    socket.on('chatMessage', async ({ code, name, msg }) => {
      const room = rooms[code];
      if (!room) return;
      if (typeof msg !== 'string' || !msg.trim() || msg.length > 140) return;
      if (!chatAllowed(socket)) return;
      let level = 1, cups = 0;
      try {
        const found = await getAccountLevelCups(name);
        if (found) { level = found.level; cups = found.cups; }
      } catch (e) { /* ignore */ }
      room.chat.push({ name, msg: msg.trim().slice(0, 140), level, cups });
      if (room.chat.length > 40) room.chat.shift();
      io.to(code).emit('chatUpdate', room.chat);
    });

    socket.on('input', (snap) => physics.setInput(socket.id, snap));

    socket.on('disconnect', () => {
      removePlayerFromRoom(socket);
      physics.clearInput(socket.id);
    });
  }

  physics.startLoop(rooms);

  return { rooms, socketRoom, registerHandlers, removePlayerFromRoom, activeCount, publicRoomState, reformLocalMatch };
}

module.exports = { createRoomManager, LOCAL_SERVER_COUNT, LOCAL_SERVER_CAP, MAX_TEAM_SIZE, MODE_TEAM_SIZE };
