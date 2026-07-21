// ============================================================================
// rooms.js - EGOBALL Room Management v2.0
// Features: Local servers (spectator mode), private rooms, practice mode
// ============================================================================
const { Match } = require('./physics');

const MAX_TEAM_SIZE = 4;
const MIN_TO_START = 2;
const LOCAL_SERVER_COUNT = 8;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function makePrivateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.localServers = [];
    this.privateRooms = new Map();
    this.tickHandle = setInterval(() => this.tickAll(), 1000 / 60);
    this.broadcastHandle = setInterval(() => this.broadcastAll(), 1000 / 30);
    this.initLocalServers();
  }

  initLocalServers() {
    for (let i = 1; i <= LOCAL_SERVER_COUNT; i++) {
      this.localServers.push({
        id: i,
        name: `Local Server ${i}`,
        players: 0,
        maxPlayers: 8,
        status: 'empty',
        roomCode: null
      });
    }
  }

  createRoom(hostUsername, hostSocketId, teamSize, isPrivate = false, password = null) {
    const code = isPrivate ? makePrivateCode() : makeCode();
    const room = {
      code,
      teamSize: Math.min(MAX_TEAM_SIZE, Math.max(1, teamSize || 2)),
      members: new Map(),
      spectators: new Set(),
      match: null,
      started: false,
      isPrivate,
      password,
      hostId: hostSocketId,
      chat: [],
      createdAt: Date.now()
    };
    this.rooms.set(code, room);
    if (isPrivate) this.privateRooms.set(code, room);
    this.joinRoom(code, hostUsername, hostSocketId);
    return room;
  }

  joinRoom(code, username, socketId, password = null) {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'no_such_room' };

    // If match is running, join as spectator
    if (room.started && room.match && room.match.running) {
      room.spectators.add(socketId);
      return { ok: true, room, team: 'spectator', isSpectator: true };
    }

    if (room.members.size >= room.teamSize * 2) {
      // Room full but not started - join as spectator too
      if (!room.started) {
        room.spectators.add(socketId);
        return { ok: true, room, team: 'spectator', isSpectator: true };
      }
      return { ok: false, error: 'room_full' };
    }

    if (room.isPrivate && room.password && room.password !== password) {
      return { ok: false, error: 'wrong_password' };
    }

    const redCount = this.countTeam(room, 'red');
    const blueCount = this.countTeam(room, 'blue');
    const team = redCount <= blueCount ? 'red' : 'blue';
    room.members.set(socketId, { username, team });
    if (room.match) room.match.addPlayer(socketId, team, username);

    this.updateLocalServerStatus(room);
    return { ok: true, room, team };
  }

  joinLocalServer(serverId, username, socketId, userData) {
    const server = this.localServers.find(s => s.id === serverId);
    if (!server) return { ok: false, error: 'no_such_server' };

    // If server has a running room, join as spectator or player
    let roomCode = server.roomCode;

    if (roomCode) {
      const room = this.rooms.get(roomCode);
      if (room) {
        // If match running, always allow joining (spectator or player if slot available)
        if (room.started && room.match && room.match.running) {
          room.spectators.add(socketId);
          return { ok: true, room, team: 'spectator', isSpectator: true };
        }
        // If waiting, join as player
        if (!room.started && room.members.size < room.teamSize * 2) {
          const result = this.joinRoom(roomCode, username, socketId);
          if (result.ok) {
            server.players = room.members.size;
            server.status = 'waiting';
            return result;
          }
        }
        // Full but not started - spectator
        if (!room.started) {
          room.spectators.add(socketId);
          return { ok: true, room, team: 'spectator', isSpectator: true };
        }
      }
    }

    // Create new room for this server
    const room = this.createRoom(username, socketId, 2, false);
    roomCode = room.code;
    server.roomCode = roomCode;
    server.players = 1;
    server.status = 'waiting';

    return { ok: true, room, team: 'red' };
  }

  countTeam(room, team) {
    let n = 0;
    room.members.forEach(m => { if (m.team === team) n++; });
    return n;
  }

  leaveRoom(socketId) {
    for (const room of this.rooms.values()) {
      if (room.members.has(socketId)) {
        room.members.delete(socketId);
        if (room.match) room.match.removePlayer(socketId);

        if (room.members.size === 0) {
          if (room.match) room.match.stop();
          this.rooms.delete(room.code);
          if (room.isPrivate) this.privateRooms.delete(room.code);
        }

        this.updateLocalServerStatus(room);
        return room;
      }
      if (room.spectators.has(socketId)) {
        room.spectators.delete(socketId);
        return room;
      }
    }
    return null;
  }

  updateLocalServerStatus(room) {
    for (let server of this.localServers) {
      if (server.roomCode === room.code) {
        server.players = room.members.size + room.spectators.size;
        if (room.started && room.match && room.match.running) server.status = 'playing';
        else if (room.members.size > 0) server.status = 'waiting';
        else server.status = 'empty';
        break;
      }
    }
  }

  startMatch(code) {
    const room = this.rooms.get(code);
    if (!room || room.started) return { ok: false };

    const isPractice = room.members.size === 1;

    if (!isPractice && room.members.size < MIN_TO_START) {
      return { ok: false, error: 'not_enough_players' };
    }

    room.started = true;
    room.match = new Match(
      code,
      room.teamSize,
      (goalInfo) => this.io.to(code).emit('goal', goalInfo),
      (endInfo) => this.handleMatchEnd(room, endInfo),
      isPractice
    );

    room.members.forEach((m, socketId) => {
      room.match.addPlayer(socketId, m.team, m.username);
    });

    room.match.start();
    this.io.to(code).emit('matchStarted', { 
      stadium: room.match.stadium, 
      isPractice: room.match.isPractice 
    });

    this.updateLocalServerStatus(room);
    return { ok: true, isPractice };
  }

  handleMatchEnd(room, endInfo) {
    this.io.to(room.code).emit('matchEnded', endInfo);
    room.started = false;
    room.match = null;
    this.updateLocalServerStatus(room);
  }

  setInput(socketId, input) {
    for (const room of this.rooms.values()) {
      if (room.match && room.members.has(socketId)) {
        room.match.setInput(socketId, input);
        return;
      }
    }
  }

  addChatMessage(socketId, message) {
    for (const room of this.rooms.values()) {
      if (room.members.has(socketId) || room.spectators.has(socketId)) {
        const member = room.members.get(socketId);
        const name = member ? member.username : 'Spectator';
        const chatMsg = { username: name, message, time: Date.now() };
        room.chat.push(chatMsg);
        if (room.chat.length > 50) room.chat.shift();
        this.io.to(room.code).emit('chat', chatMsg);
        return { ok: true };
      }
    }
    return { ok: false, error: 'not_in_room' };
  }

  tickAll() {
    const now = Date.now();
    this._lastTick = this._lastTick || now;
    const dt = now - this._lastTick;
    this._lastTick = now;
    this.rooms.forEach(room => { if (room.match) room.match.tick(dt); });
  }

  broadcastAll() {
    this.rooms.forEach(room => {
      if (room.match) {
        const state = room.match.serialize();
        this.io.to(room.code).emit('state', state);
      }
    });
  }

  roomOf(socketId) {
    for (const room of this.rooms.values()) {
      if (room.members.has(socketId)) return room;
    }
    return null;
  }

  getLocalServers() {
    return this.localServers.map(s => ({
      id: s.id,
      name: s.name,
      players: s.players,
      maxPlayers: s.maxPlayers,
      status: s.status
    }));
  }

  getPrivateRooms() {
    return Array.from(this.privateRooms.values())
      .filter(r => !r.started)
      .map(r => ({
        code: r.code,
        teamSize: r.teamSize,
        players: r.members.size,
        hasPassword: !!r.password
      }));
  }

  publicList() {
    return Array.from(this.rooms.values())
      .filter(r => !r.isPrivate)
      .map(r => ({
        code: r.code, teamSize: r.teamSize, players: r.members.size, started: r.started
      }));
  }
}

module.exports = { RoomManager, MAX_TEAM_SIZE, LOCAL_SERVER_COUNT };
