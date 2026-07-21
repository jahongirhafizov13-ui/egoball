// ============================================================================
// server.js - EGOBALL Server v2.0
// Features: Google OAuth, E-Coin economy, bot matches, skins, horizontal layout
// ============================================================================
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const auth = require('./auth');
const { RoomManager, MAX_TEAM_SIZE } = require('./rooms');
const { BotMatch } = require('./botmatch');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(__dirname));

let rooms = new RoomManager(io);
let botMatches = new Map(); // socketId -> BotMatch

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

  // ========== GOOGLE AUTH ==========
  socket.on('googleAuth', async ({ googleId, email, name } = {}, cb) => {
    cb = cb || (() => {});
    if (rateLimited(socket, 'googleAuth', 2000)) return cb({ ok: false, error: 'too_fast' });
    const result = await auth.googleAuth(googleId, email, name);
    if (result.ok) socket.data.user = result.profile.username;
    cb(result);
  });

  socket.on('setPlayerInfo', async ({ displayName, playerNumber } = {}, cb) => {
    cb = cb || (() => {});
    if (!socket.data.user) return cb({ ok: false, error: 'not_authenticated' });
    const result = await auth.setPlayerInfo(socket.data.user, displayName, playerNumber);
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

  // ========== PLAYER PROFILE ==========
  socket.on('getProfile', (cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    const user = auth.getUserByUsername(socket.data.user);
    if (!user) return cb({ ok: false, error: 'not_found' });
    cb({ ok: true, profile: auth.publicProfile(user) });
  });

  socket.on('upgradeStat', ({ stat } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    const result = auth.upgradeStat(socket.data.user, stat);
    cb(result);
  });

  socket.on('getSkins', (cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    cb({ ok: true, skins: auth.getSkins(socket.data.user) });
  });

  socket.on('buySkin', ({ skinId } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    const result = auth.buySkin(socket.data.user, skinId);
    cb(result);
  });

  socket.on('equipSkin', ({ skinId } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    const result = auth.equipSkin(socket.data.user, skinId);
    cb(result);
  });

  // ========== BOT MATCH (PLAY) ==========
  socket.on('startBotMatch', ({ level } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    if (rateLimited(socket, 'startBotMatch', 2000)) return cb({ ok: false, error: 'too_fast' });

    const user = auth.getUserByUsername(socket.data.user);
    if (!user) return cb({ ok: false, error: 'not_found' });

    // Clean up old bot match
    if (botMatches.has(socket.id)) {
      botMatches.get(socket.id).stop();
      botMatches.delete(socket.id);
    }

    const match = new BotMatch(socket, user, level || user.level || 1, io);
    botMatches.set(socket.id, match);
    match.start();
    cb({ ok: true });
  });

  socket.on('botMatchInput', (input) => {
    const match = botMatches.get(socket.id);
    if (match) match.setPlayerInput(input);
  });

  socket.on('claimBotMatchReward', ({ goals, won } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;

    const match = botMatches.get(socket.id);
    if (!match) return cb({ ok: false, error: 'no_active_match' });

    match.stop();
    botMatches.delete(socket.id);

    // Calculate E-Coin reward
    let ecoinReward = 30 + Math.floor(Math.random() * 41); // 30-70 base
    if (won) ecoinReward += 20;
    ecoinReward += goals * 10;

    const result = auth.addEcoin(socket.data.user, ecoinReward);
    const xpGain = won ? 50 + goals * 10 : 20 + goals * 5;
    auth.addXp(socket.data.user, xpGain);

    cb({ ok: true, ecoinReward, xpGain, newBalance: result.newBalance });
  });

  // ========== LOCAL SERVERS ==========
  socket.on('listLocalServers', (cb) => {
    cb = cb || (() => {});
    cb({ ok: true, servers: rooms.getLocalServers() });
  });

  socket.on('joinLocalServer', ({ serverId } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;

    const user = auth.getUserByUsername(socket.data.user);
    if (!user) return cb({ ok: false, error: 'not_found' });

    const result = rooms.joinLocalServer(serverId, socket.data.user, socket.id, user);
    if (!result.ok) return cb(result);
    socket.join(result.room.code);
    cb({ ok: true, code: result.room.code, team: result.team, teamSize: result.room.teamSize });
    broadcastRoomUpdate(result.room.code);
  });

  // ========== PRIVATE ROOMS ==========
  socket.on('listPrivateRooms', (cb) => {
    cb = cb || (() => {});
    cb({ ok: true, rooms: rooms.getPrivateRooms() });
  });

  socket.on('createRoom', ({ teamSize, isPrivate, password } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    if (rateLimited(socket, 'createRoom', 1000)) return cb({ ok: false, error: 'too_fast' });

    const size = Math.min(MAX_TEAM_SIZE, Math.max(1, parseInt(teamSize) || 2));
    const room = rooms.createRoom(socket.data.user, socket.id, size, isPrivate, password);
    socket.join(room.code);
    cb({ ok: true, code: room.code, teamSize: room.teamSize, isPrivate: room.isPrivate });
    broadcastRoomUpdate(room.code);
  });

  socket.on('joinRoom', ({ code, password } = {}, cb) => {
    cb = cb || (() => {});
    if (!requireAuth(cb)) return;
    if (rateLimited(socket, 'joinRoom', 500)) return cb({ ok: false, error: 'too_fast' });

    const result = rooms.joinRoom((code || '').toUpperCase(), socket.data.user, socket.id, password);
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
    if (rateLimited(socket, 'startMatch', 1000)) return cb({ ok: false, error: 'too_fast' });

    const room = rooms.roomOf(socket.id);
    if (!room) return cb({ ok: false, error: 'no_room' });

    const result = rooms.startMatch(room.code);
    cb(result);
  });

  socket.on('input', (input) => {
    if (!input || typeof input !== 'object') return;
    rooms.setInput(socket.id, input);
  });

  socket.on('chat', ({ message } = {}, cb) => {
    cb = cb || (() => {});
    if (!message || typeof message !== 'string') return cb({ ok: false });
    if (message.length > 200) return cb({ ok: false, error: 'message_too_long' });
    if (rateLimited(socket, 'chat', 500)) return cb({ ok: false, error: 'too_fast' });

    const result = rooms.addChatMessage(socket.id, message.trim());
    cb(result);
  });

  socket.on('disconnect', () => {
    // Clean up bot match
    if (botMatches.has(socket.id)) {
      botMatches.get(socket.id).stop();
      botMatches.delete(socket.id);
    }
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
server.listen(PORT, '0.0.0.0', () => console.log(`EGOBALL Server v2.0 listening on port ${PORT}`));
