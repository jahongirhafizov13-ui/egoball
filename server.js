// ============================================================================
// server.js - entrypoint only. Every domain lives in its own file now:
//   physics.js  - ball/player/stadium simulation (server-authoritative)
//   rooms.js    - local auto-balance servers, private rooms, quick play
//   auth.js     - accounts, sessions, hub presence, party, friends
//   economy.js  - OpenCase, Auras, Field Skins
//   admin.js    - operator tools (HTTP endpoint + terminal console)
//   store.js    - account/leaderboard persistence (unchanged)
// This file's only job is to construct each module and connect them - it
// should never grow game logic of its own.
// ============================================================================
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { createPhysics } = require('./physics');
const { createRoomManager, MODE_TEAM_SIZE } = require('./rooms');
const { createAuth } = require('./auth');
const economy = require('./economy');
const admin = require('./admin');

const app = express();

// Character images (OpenCase) and aura effect assets, served as static files.
// Must sit next to this server.js: /skins/isagi.png, /auras/aura1.png, etc.
app.use('/skins', express.static(path.join(__dirname, 'skins')));
app.use('/auras', express.static(path.join(__dirname, 'auras')));

const server = http.createServer(app);
const io = new Server(server, {
  // Set ALLOWED_ORIGIN in your host's environment to your real deployed
  // site's exact URL once you know it - until then this stays open.
  cors: { origin: process.env.ALLOWED_ORIGIN || '*' }
});
const PORT = process.env.PORT || 3000;

// ---- wire the modules together --------------------------------------------
// physics has no dependency on rooms; rooms depends on physics; auth depends
// on rooms (to remove a kicked/double-logged-in player from whatever room
// they're in). This order is the only one that avoids a circular require.
let roomManager; // declared here so physics' onLocalMatchEnded closure can see it once assigned below
const physics = createPhysics({
  io,
  onLocalMatchEnded: (room, winningTeam) => {
    if (roomManager) roomManager.reformLocalMatch(room, winningTeam);
  }
});
roomManager = createRoomManager({ io, physics });
const auth = createAuth({ io, removePlayerFromRoom: roomManager.removePlayerFromRoom });

admin.registerAdminHttp(app, { isOnline: auth.isOnline, emitToName: auth.emitToName });
admin.startAdminConsole({ isOnline: auth.isOnline, emitToName: auth.emitToName });

io.on('connection', (socket) => {
  auth.registerHandlers(socket, {
    rooms: roomManager.rooms,
    socketRoom: roomManager.socketRoom,
    initRoomPhysics: physics.initRoomPhysics,
    publicRoomState: roomManager.publicRoomState,
    MODE_TEAM_SIZE
  });
  roomManager.registerHandlers(socket, {
    chatAllowed: auth.chatAllowed,
    getAccountLevelCups: auth.getAccountLevelCups
  });
  economy.registerHandlers(socket);
});

server.listen(PORT, () => {
  console.log(`EgoBall server running on port ${PORT}`);
});
