const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // tighten this to your GitHub Pages origin before going to production
});

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// In-memory room store.
// room = {
//   code, mode, cap, isPublic, started,
//   hostId: socket.id of the current host (technical authority, not shown as admin UI),
//   players: [{ id, name, team, spectator }],
//   chat: [{ name, msg }]
// }
// ---------------------------------------------------------------------------
const rooms = {};
// socket.id -> room code, so we can clean up fast on disconnect
const socketRoom = {};

function genRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function activeCount(room) {
  return room.players.filter(p => !p.spectator).length;
}

function pickTeam(room) {
  const a = room.players.filter(p => p.team === 'A' && !p.spectator).length;
  const b = room.players.filter(p => p.team === 'B' && !p.spectator).length;
  return a <= b ? 'A' : 'B';
}

function publicRoomState(room) {
  // safe-to-broadcast snapshot (no server-internal fields)
  return {
    mode: room.mode,
    cap: room.cap,
    isPublic: room.isPublic,
    started: room.started,
    hostId: room.hostId,
    players: room.players,
    chat: room.chat
  };
}

function broadcastRoom(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('roomUpdate', publicRoomState(room));
}

function removePlayerFromRoom(socket) {
  const code = socketRoom[socket.id];
  if (!code || !rooms[code]) return;
  const room = rooms[code];
  room.players = room.players.filter(p => p.id !== socket.id);
  delete socketRoom[socket.id];
  socket.leave(code);

  if (room.players.length === 0) {
    // nobody left - tear the room down (public room codes get recreated on demand)
    delete rooms[code];
    return;
  }

  if (room.hostId === socket.id) {
    // promote the next remaining active player to host
    const next = room.players.find(p => !p.spectator) || room.players[0];
    room.hostId = next.id;
    io.to(code).emit('hostChanged', { newHostId: next.id, room: publicRoomState(room) });
  } else {
    broadcastRoom(code);
  }
}

io.on('connection', (socket) => {

  // ---- create a private room -------------------------------------------------
  socket.on('createRoom', ({ mode, name, cap }, cb) => {
    const code = genRoomCode();
    const room = {
      code, mode, cap: cap || 2,
      isPublic: false, started: false,
      hostId: socket.id,
      players: [{ id: socket.id, name: name || 'Host', team: 'A', spectator: false }],
      chat: []
    };
    rooms[code] = room;
    socketRoom[socket.id] = code;
    socket.join(code);
    cb({ ok: true, code, room: publicRoomState(room), myId: socket.id, isHost: true });
  });

  // ---- join a private room by code -------------------------------------------
  socket.on('joinRoomByCode', ({ code, name, cap }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'not_found' });

    const isHost = !room.hostId;
    if (isHost) room.hostId = socket.id;

    const spectator = activeCount(room) >= room.cap;
    const team = spectator ? null : pickTeam(room);
    room.players.push({ id: socket.id, name: name || 'Guest', team, spectator });
    socketRoom[socket.id] = code;
    socket.join(code);

    if (!room.started && activeCount(room) >= room.cap) {
      room.started = true;
      io.to(code).emit('matchStarting', publicRoomState(room));
    } else {
      broadcastRoom(code);
    }

    cb({ ok: true, room: publicRoomState(room), myId: socket.id, isHost, spectator });
  });

  // ---- list / join public servers --------------------------------------------
  socket.on('listPublicServers', ({ mode, count }, cb) => {
    const n = count || 2;
    const list = [];
    for (let i = 1; i <= n; i++) {
      const code = 'PUB' + i + '-' + mode;
      const room = rooms[code];
      list.push({ code, count: room ? activeCount(room) : 0 });
    }
    cb(list);
  });

  socket.on('joinPublicServer', ({ code, mode, name, cap }, cb) => {
    let room = rooms[code];
    if (!room) {
      room = {
        code, mode, cap: cap || 2,
        isPublic: true, started: true, // public servers play instantly, no lobby wait
        hostId: null,
        players: [],
        chat: []
      };
      rooms[code] = room;
    }
    const isHost = !room.hostId;
    if (isHost) room.hostId = socket.id;

    const spectator = activeCount(room) >= room.cap;
    const team = spectator ? null : pickTeam(room);
    room.players.push({ id: socket.id, name: name || 'Guest', team, spectator });
    socketRoom[socket.id] = code;
    socket.join(code);

    broadcastRoom(code);
    cb({ ok: true, code, room: publicRoomState(room), myId: socket.id, isHost, spectator });
  });

  // ---- explicit lobby start (private rooms, host presses Start) --------------
  socket.on('startMatch', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    room.started = true;
    io.to(code).emit('matchStarting', publicRoomState(room));
  });

  socket.on('leaveRoom', () => {
    removePlayerFromRoom(socket);
  });

  // ---- realtime match relay ---------------------------------------------------
  // Host pushes full authoritative simulation state; server just relays it to
  // every other client in the room (the guests).
  socket.on('hostState', ({ code, state }) => {
    socket.to(code).emit('stateUpdate', state);
  });

  // Guests push their input snapshot; server relays straight to the host only.
  socket.on('guestInput', ({ code, snap }) => {
    const room = rooms[code];
    if (!room || !room.hostId) return;
    io.to(room.hostId).emit('inputUpdate', { id: socket.id, snap });
  });

  // ---- chat --------------------------------------------------------------
  socket.on('chatMessage', ({ code, name, msg }) => {
    const room = rooms[code];
    if (!room) return;
    room.chat.push({ name, msg });
    if (room.chat.length > 40) room.chat.shift();
    io.to(code).emit('chatUpdate', room.chat);
  });

  socket.on('disconnect', () => {
    removePlayerFromRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`EgoBall Socket.io server listening on port ${PORT}`);
});
