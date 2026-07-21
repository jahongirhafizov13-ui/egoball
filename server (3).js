// ============================================================================
// server.js - EGOBALL Server
// Features: Local servers, private rooms, chat, practice mode
// ============================================================================
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const auth = require('./auth');
const { RoomManager, MAX_TEAM_SIZE, DEFAULT_SKILLS, MAX_SKILL_POINTS, LOCAL_SERVER_COUNT } = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));

let rooms = new RoomManager(io);

function rateLimited(socket, key, minIntervalMs) {
  socket.data._rl = socket.data._rl || {};
  const now = Date.now();
  const last = socket.data._rl[key] || 0;
  if (now - last < minIntervalMs) return true;
  socket.data._rl[key] = now;
  return false;
}

io.on('connection', (socket) => {
  socket.data.user = null;

  // Auth events
  socket.on('register', async ({ username, password } = {}, cb) => {
    cb = cb || (() => {});
    if (rateLimited(socket, 'register', 2000)) return cb({ ok: false, error: 'too_fast' });
    const result = await auth.register(username, password);
    if (result.ok) socket.data.user = result.profile.username;
    cb(result);
  });

  socket.on('login', async ({ username, password } = {}, cb) => {
    cb = cb || (() => {});
    if (rateLimited(socket, 'login', 1000)) return cb({ ok: false, error: 'too_fast' });
    const result = await auth.login(username, password);
    if (result.ok) socket.data.user = result.profile.username;
    cb(result);
  });

  socket.on('authenticate', ({ token } = {}, cb) => {
    cb = cb || (() => {});
    if (rateLimited(socket, 'authenticate', 1000)) return cb({ ok: false, error: 'too_fast' });
    const user = auth.verifyToken(token);
    if (!user) return cb({ ok: false, error: 'invalid_token' });
    socket.data.user = user.username;
    cb({ ok: true, profile: auth.publicProfile(user) });
  });

  function requireAuth(cb) {
    if (!socket.data.user) { cb({ ok: false, error: 'not_authenticated' }); return false; }
    return true;
  }

  // Local serverlar ro'yxati
  socket.on('listLocalServers', (cb) => {
    cb = cb || (() => {});
    cb({ ok: true, servers: rooms.getLocalServers() });
  });

  // Private xonalar ro'yxati
  socket.on('listPrivateRooms', (cb) => {
    cb = cb || (() => {});
    cb({ ok: true, rooms: rooms.getPrivateRooms() });
  });

  // Public xonalar ro'yxati
  socket.on('listRooms', (cb) => {
    cb = cb || (() => {});
    cb({ ok: true, rooms: rooms.publicList() });
  });

  // Local serverga qo'shilish
  socket.on('joinLocalServer', ({ serverId, skills } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;

    const server = rooms.localServers.find(s => s.id === serverId);
    if (!server) return cb({ ok: false, error: 'no_such_server' });
    if (server.status === 'playing') return cb({ ok: false, error: 'server_playing' });
    if (server.players >= server.maxPlayers) return cb({ ok: false, error: 'server_full' });

    // Agar serverda xona bo'lmasa, yangi yaratish
    let roomCode = server.roomCode;
    if (!roomCode || server.status === 'empty') {
      const room = rooms.createRoom(socket.data.user, socket.id, 2, false);
      roomCode = room.code;
      rooms.assignRoomToLocalServer(roomCode);
    }

    const result = rooms.joinRoom(roomCode, socket.data.user, socket.id, skills);
    if (!result.ok) return cb(result);
    socket.join(result.room.code);
    cb({ ok: true, code: result.room.code, team: result.team, teamSize: result.room.teamSize });
    broadcastRoomUpdate(result.room.code);
  });

  // Xona yaratish
  socket.on('createRoom', ({ teamSize, isPrivate, password } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    if (rateLimited(socket, 'createRoom', 1000)) return cb({ ok: false, error: 'too_fast' });

    const size = Math.min(MAX_TEAM_SIZE, Math.max(1, parseInt(teamSize) || 2));
    const room = rooms.createRoom(socket.data.user, socket.id, size, isPrivate, password);

    if (!isPrivate) {
      rooms.assignRoomToLocalServer(room.code);
    }

    socket.join(room.code);
    cb({ ok: true, code: room.code, teamSize: room.teamSize, isPrivate: room.isPrivate });
    broadcastRoomUpdate(room.code);
  });

  // Xonaga qo'shilish
  socket.on('joinRoom', ({ code, skills, password } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    if (rateLimited(socket, 'joinRoom', 500)) return cb({ ok: false, error: 'too_fast' });

    const result = rooms.joinRoom((code || '').toUpperCase(), socket.data.user, socket.id, skills, password);
    if (!result.ok) return cb(result);
    socket.join(result.room.code);
    cb({ ok: true, code: result.room.code, team: result.team, teamSize: result.room.teamSize });
    broadcastRoomUpdate(result.room.code);
  });

  // Xonani tark etish
  socket.on('leaveRoom', (cb) => {
    cb = cb || (() => {});
    const room = rooms.leaveRoom(socket.id);
    if (room) { socket.leave(room.code); broadcastRoomUpdate(room.code); }
    cb({ ok: true });
  });

  // O'yinni boshlash
  socket.on('startMatch', (cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    if (rateLimited(socket, 'startMatch', 1000)) return cb({ ok: false, error: 'too_fast' });

    const room = rooms.roomOf(socket.id);
    if (!room) return cb({ ok: false, error: 'no_room' });

    const result = rooms.startMatch(room.code);
    cb(result);
  });

  // Input
  socket.on('input', (input) => {
    if (!input || typeof input !== 'object') return;
    rooms.setInput(socket.id, input);
  });

  // Chat
  socket.on('chat', ({ message } = {}, cb) => {
    cb = cb || (() => {});
    if (!message || typeof message !== 'string') return cb({ ok: false });
    if (message.length > 200) return cb({ ok: false, error: 'message_too_long' });
    if (rateLimited(socket, 'chat', 500)) return cb({ ok: false, error: 'too_fast' });

    const result = rooms.addChatMessage(socket.id, message.trim());
    cb(result);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const room = rooms.leaveRoom(socket.id);
    if (room) broadcastRoomUpdate(room.code);
  });

  function broadcastRoomUpdate(code) {
    const room = rooms.rooms.get(code);
    if (!room) return;
    const members = Array.from(room.members.values());
    io.to(code).emit('roomUpdate', { 
      code, teamSize: room.teamSize, started: room.started, 
      isPractice: room.match ? room.match.isPractice : false,
      members 
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`EGOBALL Server listening on port ${PORT}`));
