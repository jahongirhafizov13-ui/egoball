// ============================================================================
// rooms.js - room/lobby management. Each room owns exactly one authoritative
// Match instance once it starts. Clients never touch Match directly - only
// through the socket events wired up in server.js.
// ============================================================================
const { Match } = require('./physics');

const MAX_TEAM_SIZE = 4; // up to 4v4 per room
const MIN_TO_START = 2;  // need at least 1 per side

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> room
    this.tickHandle = setInterval(() => this.tickAll(), 1000 / 60);
    this.broadcastHandle = setInterval(() => this.broadcastAll(), 1000 / 30);
  }

  createRoom(hostUsername, hostSocketId, teamSize) {
    const code = makeCode();
    const room = {
      code,
      teamSize: Math.min(MAX_TEAM_SIZE, Math.max(1, teamSize || 2)),
      members: new Map(), // socketId -> { username, team }
      match: null,
      started: false
    };
    this.rooms.set(code, room);
    this.joinRoom(code, hostUsername, hostSocketId);
    return room;
  }

  joinRoom(code, username, socketId) {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'no_such_room' };
    if (room.members.size >= room.teamSize * 2) return { ok: false, error: 'room_full' };
    const redCount = this.countTeam(room, 'red');
    const blueCount = this.countTeam(room, 'blue');
    const team = redCount <= blueCount ? 'red' : 'blue';
    room.members.set(socketId, { username, team });
    if (room.match) room.match.addPlayer(socketId, team);
    return { ok: true, room, team };
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
        }
        return room;
      }
    }
    return null;
  }

  startMatch(code) {
    const room = this.rooms.get(code);
    if (!room || room.started) return { ok: false };
    if (room.members.size < MIN_TO_START) return { ok: false, error: 'not_enough_players' };
    room.started = true;
    room.match = new Match(
      code,
      room.teamSize,
      (goalInfo) => this.io.to(code).emit('goal', goalInfo),
      (endInfo) => this.handleMatchEnd(room, endInfo)
    );
    room.members.forEach((m, socketId) => room.match.addPlayer(socketId, m.team));
    room.match.start();
    this.io.to(code).emit('matchStarted', { stadium: room.match.stadium });
    return { ok: true };
  }

  handleMatchEnd(room, endInfo) {
    this.io.to(room.code).emit('matchEnded', endInfo);
    room.started = false;
    room.match = null;
  }

  setInput(socketId, input) {
    for (const room of this.rooms.values()) {
      if (room.match && room.members.has(socketId)) {
        room.match.setInput(socketId, input);
        return;
      }
    }
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
      if (room.match) this.io.to(room.code).emit('state', room.match.serialize());
    });
  }

  roomOf(socketId) {
    for (const room of this.rooms.values()) if (room.members.has(socketId)) return room;
    return null;
  }

  publicList() {
    return Array.from(this.rooms.values()).map(r => ({
      code: r.code, teamSize: r.teamSize, players: r.members.size, started: r.started
    }));
  }
}

module.exports = { RoomManager, MAX_TEAM_SIZE };
