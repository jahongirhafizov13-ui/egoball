// ============================================================================
// server.js - entry point. This is the ONLY process that ever runs game
// physics. Every connected client is equally "just a client" - there is no
// host/guest distinction anywhere in this codebase, unlike a peer-relay
// design. That asymmetry is exactly the class of bug this project avoids.
// ============================================================================
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const auth = require('./auth');
const { RoomManager, MAX_TEAM_SIZE } = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));


let rooms = new RoomManager(io);

// simple per-socket rate limit for chatty events (input is exempt - it's just
// booleans and needs to feel instant, but auth/room actions are rate-limited
// to stop someone from hammering the server)
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
    const user = auth.verifyToken(token);
    if (!user) return cb({ ok: false });
    socket.data.user = user.username;
    cb({ ok: true, profile: auth.publicProfile(user) });
  });

  function requireAuth(cb) {
    if (!socket.data.user) { cb({ ok: false, error: 'not_authenticated' }); return false; }
    return true;
  }

  socket.on('listRooms', (cb) => {
    cb = cb || (() => {});
    cb({ ok: true, rooms: rooms.publicList() });
  });

  socket.on('createRoom', ({ teamSize } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    const size = Math.min(MAX_TEAM_SIZE, Math.max(1, parseInt(teamSize) || 2));
    const room = rooms.createRoom(socket.data.user, socket.id, size);
    socket.join(room.code);
    cb({ ok: true, code: room.code, teamSize: room.teamSize });
    broadcastRoomUpdate(room.code);
  });

  socket.on('joinRoom', ({ code } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    const result = rooms.joinRoom((code || '').toUpperCase(), socket.data.user, socket.id);
    if (!result.ok) return cb(result);
    socket.join(result.room.code);
    cb({ ok: true, code: result.room.code, team: result.team, teamSize: result.room.teamSize });
    broadcastRoomUpdate(result.room.code);
  });

  socket.on('leaveRoom', (cb) => {
    cb = cb || (() => {});
    const room = rooms.leaveRoom(socket.id);
    if (room) { socket.leave(room.code); broadcastRoomUpdate(room.code); }
    cb({ ok: true });
  });

  socket.on('startMatch', (cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    const room = rooms.roomOf(socket.id);
    if (!room) return cb({ ok: false, error: 'no_room' });
    cb(rooms.startMatch(room.code));
  });

  // Input: fire-and-forget, no ack needed, needs to feel instant. Booleans only -
  // this is the ONLY thing a client ever tells the server about what it wants to do.
  socket.on('input', (input) => {
    if (!input || typeof input !== 'object') return;
    rooms.setInput(socket.id, input);
  });

  socket.on('disconnect', () => {
    const room = rooms.leaveRoom(socket.id);
    if (room) broadcastRoomUpdate(room.code);
  });

  function broadcastRoomUpdate(code) {
    const room = rooms.rooms.get(code);
    if (!room) return;
    const members = Array.from(room.members.values());
    io.to(code).emit('roomUpdate', { code, teamSize: room.teamSize, started: room.started, members });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server listening on port ${PORT}`));

