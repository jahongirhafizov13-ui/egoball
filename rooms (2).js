// ============================================================================
// rooms.js - EGOBALL Room Management
// Features: 8 local servers, private rooms with password, practice mode
// ============================================================================
const { Match, DEFAULT_SKILLS, MAX_SKILL_POINTS } = require('./physics');

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
    this.rooms = new Map(); // code -> room
    this.localServers = []; // 8 ta local server
    this.privateRooms = new Map(); // code -> private room
    this.tickHandle = setInterval(() => this.tickAll(), 1000 / 60);
    this.broadcastHandle = setInterval(() => this.broadcastAll(), 1000 / 30);
    this.initLocalServers();
  }

  // 8 ta local server yaratish
  initLocalServers() {
    for (let i = 1; i <= LOCAL_SERVER_COUNT; i++) {
      this.localServers.push({
        id: i,
        name: `Local Server ${i}`,
        players: 0,
        maxPlayers: 8,
        status: 'empty', // empty, waiting, playing
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
      match: null,
      started: false,
      isPrivate,
      password, // null = ochiq, string = parolli
      hostId: hostSocketId,
      playerSkills: new Map(),
      chat: [],
      createdAt: Date.now()
    };
    this.rooms.set(code, room);
    if (isPrivate) this.privateRooms.set(code, room);
    this.joinRoom(code, hostUsername, hostSocketId);
    return room;
  }

  joinRoom(code, username, socketId, skills = null, password = null) {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: 'no_such_room' };
    if (room.members.size >= room.teamSize * 2) return { ok: false, error: 'room_full' };

    // Parol tekshirish
    if (room.isPrivate && room.password && room.password !== password) {
      return { ok: false, error: 'wrong_password' };
    }

    const redCount = this.countTeam(room, 'red');
    const blueCount = this.countTeam(room, 'blue');
    const team = redCount <= blueCount ? 'red' : 'blue';
    room.members.set(socketId, { username, team });
    if (skills) room.playerSkills.set(socketId, skills);
    if (room.match) room.match.addPlayer(socketId, team, username, skills);

    // Local server status yangilash
    this.updateLocalServerStatus(room);

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
        room.playerSkills.delete(socketId);
        if (room.match) room.match.removePlayer(socketId);

        // Xona bo'sh bo'lsa o'chirish
        if (room.members.size === 0) {
          if (room.match) room.match.stop();
          this.rooms.delete(room.code);
          if (room.isPrivate) this.privateRooms.delete(room.code);
        }

        this.updateLocalServerStatus(room);
        return room;
      }
    }
    return null;
  }

  updateLocalServerStatus(room) {
    // Local serverga bog'langan xonani yangilash
    for (let server of this.localServers) {
      if (server.roomCode === room.code) {
        server.players = room.members.size;
        if (room.started) server.status = 'playing';
        else if (room.members.size > 0) server.status = 'waiting';
        else server.status = 'empty';
        break;
      }
    }
  }

  // Local serverga xona biriktirish
  assignRoomToLocalServer(roomCode) {
    for (let server of this.localServers) {
      if (server.status === 'empty') {
        server.roomCode = roomCode;
        server.status = 'waiting';
        return server.id;
      }
    }
    return null;
  }

  startMatch(code) {
    const room = this.rooms.get(code);
    if (!room || room.started) return { ok: false };

    // 1 ta o'yinchida amaliyot rejimi
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
      const skills = room.playerSkills.get(socketId) || null;
      room.match.addPlayer(socketId, m.team, m.username, skills);
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
      if (room.members.has(socketId)) {
        const member = room.members.get(socketId);
        const chatMsg = { username: member.username, message, time: Date.now() };
        room.chat.push(chatMsg);
        if (room.chat.length > 50) room.chat.shift(); // 50 ta xabarni saqlash
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
      if (room.match) this.io.to(room.code).emit('state', room.match.serialize());
    });
  }

  roomOf(socketId) {
    for (const room of this.rooms.values()) if (room.members.has(socketId)) return room;
    return null;
  }

  // Local serverlar ro'yxati
  getLocalServers() {
    return this.localServers.map(s => ({
      id: s.id,
      name: s.name,
      players: s.players,
      maxPlayers: s.maxPlayers,
      status: s.status
    }));
  }

  // Private xonalar ro'yxati (faqat nom va o'yinchilar soni, parol ko'rsatilmaydi)
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

module.exports = { RoomManager, MAX_TEAM_SIZE, DEFAULT_SKILLS, MAX_SKILL_POINTS, LOCAL_SERVER_COUNT };
