// ============================================================================
// server.js - entry point with bug fixes and skill system
// ============================================================================
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const auth = require('./auth');
const { RoomManager, MAX_TEAM_SIZE, DEFAULT_SKILLS, MAX_SKILL_POINTS } = require('./rooms');

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

  socket.on('listRooms', (cb) => {
    cb = cb || (() => {});
    cb({ ok: true, rooms: rooms.publicList() });
  });

  socket.on('createRoom', ({ teamSize } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    if (rateLimited(socket, 'createRoom', 1000)) return cb({ ok: false, error: 'too_fast' });
    const size = Math.min(MAX_TEAM_SIZE, Math.max(1, parseInt(teamSize) || 2));
    const room = rooms.createRoom(socket.data.user, socket.id, size);
    socket.join(room.code);
    cb({ ok: true, code: room.code, teamSize: room.teamSize });
    broadcastRoomUpdate(room.code);
  });

  socket.on('joinRoom', ({ code, skills } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    if (rateLimited(socket, 'joinRoom', 500)) return cb({ ok: false, error: 'too_fast' });
    const result = rooms.joinRoom((code || '').toUpperCase(), socket.data.user, socket.id, skills);
    if (!result.ok) return cb(result);
    socket.join(result.room.code);
    cb({ ok: true, code: result.room.code, team: result.team, teamSize: result.room.teamSize });
    broadcastRoomUpdate(result.room.code);
  });

  socket.on('setSkills', ({ skills } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    // Validate skills
    if (!skills || typeof skills !== 'object') return cb({ ok: false, error: 'bad_skills' });
    const s = {
      speed: clamp(parseFloat(skills.speed) || 1, 0.1, 2.5),
      kick: clamp(parseFloat(skills.kick) || 1, 0.1, 2.5),
      weight: clamp(parseFloat(skills.weight) || 1, 0.1, 2.5)
    };
    const result = rooms.setPlayerSkills(socket.id, s);
    cb(result);
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
    if (rateLimited(socket, 'startMatch', 1000)) return cb({ ok: false, error: 'too_fast' });
    const room = rooms.roomOf(socket.id);
    if (!room) return cb({ ok: false, error: 'no_room' });
    cb(rooms.startMatch(room.code));
  });

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

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server listening on port ${PORT}`));
