// ============================================================================
// auth.js - accounts, sessions, hub presence, party (squad), and friends.
// This module owns all of that state; nothing outside it should touch
// onlineByName/hubUsers/partyMembers directly. rooms.js/economy.js only ever
// read through the small helper functions this module returns.
// ============================================================================
const bcrypt = require('bcryptjs');
const store = require('./store');

// mirrors the client's COLORS palette so the server can resolve a party
// member's equipped color index into a real hex value for teammates to see
const COLORS = ["#e5484d","#e0b13c","#4fb0ff","#39c477","#ff8ac4","#9a6bff","#ff9d4d","#43dede","#c2e04a","#ff5c9e",
  "#5c6bff","#ff7043","#2fd4b0","#f2f2f2","#8a8f98","#101418","#c77dff","#4dd0e1","#ffd166","#ef476f"];

const MAX_PARTY_SIZE = 4;

function createAuth({ io, removePlayerFromRoom }) {
  const onlineByName = {};  // nameLower -> Set<socket.id>
  const hubUsers = {};      // socket.id -> display name (present in the Hub)
  const partyHostOf = {};   // memberNameLower -> hostNameLower (host maps to itself once a party exists)
  const partyMembers = {};  // hostNameLower -> [memberNameLower, ...] in join order, host first
  const lastChatAt = {};    // socket.id -> timestamp, shared throttle for hub/room chat

  function markOnline(socket, nameLower) {
    if (!onlineByName[nameLower]) onlineByName[nameLower] = new Set();
    onlineByName[nameLower].add(socket.id);
    socket.data = socket.data || {};
    socket.data.accountName = nameLower;
  }
  function markOffline(socket) {
    const nameLower = socket.data && socket.data.accountName;
    if (!nameLower) return null;
    const set = onlineByName[nameLower];
    if (set) { set.delete(socket.id); if (set.size === 0) delete onlineByName[nameLower]; }
    return nameLower;
  }
  function isOnline(nameLower) { return !!(onlineByName[nameLower] && onlineByName[nameLower].size > 0); }
  function firstSocketIdFor(nameLower) { return onlineByName[nameLower] && onlineByName[nameLower].values().next().value; }
  function emitToName(nameLower, event, payload) {
    const set = onlineByName[nameLower];
    if (!set) return;
    set.forEach(id => io.to(id).emit(event, payload));
  }
  async function notifyFriendsPresence(nameLower, online) {
    try {
      const account = await store.getAccount(nameLower);
      if (!account || !account.friends) return;
      account.friends.forEach(fLower => emitToName(fLower, 'friendPresence', { name: account.name, online }));
    } catch (e) { /* ignore */ }
  }

  function removeFromHub(socket) {
    if (hubUsers[socket.id]) {
      delete hubUsers[socket.id];
      socket.leave('hub');
      io.to('hub').emit('hubOnlineUpdate', Object.values(hubUsers));
    }
  }

  function chatAllowed(socket) {
    const now = Date.now();
    const last = lastChatAt[socket.id] || 0;
    if (now - last < 500) return false; // max ~2 messages/sec per connection
    lastChatAt[socket.id] = now;
    return true;
  }

  async function getAccountLevelCups(name) {
    const acc = await store.getAccount((name || '').trim().toLowerCase());
    return acc ? { level: acc.level || 1, cups: acc.cups || 0 } : null;
  }

  // ---- party (squad) helpers ------------------------------------------------
  async function partySnapshot(hostNameLower) {
    const members = partyMembers[hostNameLower] || [hostNameLower];
    const out = [];
    for (const m of members) {
      const acc = await store.getAccount(m);
      out.push({
        name: acc ? acc.name : m,
        avatar: acc ? acc.avatar : null,
        frame: acc ? acc.frame : null,
        equippedColor: acc ? (acc.equippedColor || 0) : 0,
        equippedCharacterId: acc ? acc.equippedCharacterId : null,
        equippedAura: acc ? acc.equippedAura : null,
        online: isOnline(m),
        isHost: m === hostNameLower
      });
    }
    return out;
  }
  async function broadcastParty(hostNameLower) {
    const snap = await partySnapshot(hostNameLower);
    const members = partyMembers[hostNameLower] || [hostNameLower];
    members.forEach(m => emitToName(m, 'partyUpdate', { hostName: hostNameLower, members: snap }));
  }
  function leaveOrDisbandParty(nameLower) {
    const hostNameLower = partyHostOf[nameLower];
    if (!hostNameLower) return null;
    if (hostNameLower === nameLower) {
      const members = partyMembers[hostNameLower] || [];
      members.forEach(m => { delete partyHostOf[m]; });
      delete partyMembers[hostNameLower];
      return { disbanded: true, formerMembers: members };
    }
    partyMembers[hostNameLower] = (partyMembers[hostNameLower] || []).filter(m => m !== nameLower);
    delete partyHostOf[nameLower];
    return { disbanded: false, hostNameLower };
  }

  function registerHandlers(socket, { rooms, socketRoom, initRoomPhysics, publicRoomState, MODE_TEAM_SIZE }) {
    socket.on('login', async ({ name, pass, seed }, cb) => {
      try {
        const nameLower = (name || '').trim().toLowerCase();
        if (!nameLower || !pass) return cb({ ok: false, error: 'invalid' });
        if (name.trim().length > 12) return cb({ ok: false, error: 'name_too_long' });
        if (pass.length > 20) return cb({ ok: false, error: 'password_too_long' });
        let account = await store.getAccount(nameLower);
        if (!account) {
          const passHash = await bcrypt.hash(pass, 10);
          account = Object.assign({}, seed || {}, { name: name.trim(), passHash, friends: [], friendRequests: [] });
          delete account.pass;
          account.coins = (account.coins || 0) + 150; // welcome bonus for brand-new players
          await store.saveAccount(account);
        } else {
          const match = await bcrypt.compare(pass, account.passHash || '');
          if (!match) return cb({ ok: false, error: 'wrong_password' });
          if (!account.friends) account.friends = [];
          if (!account.friendRequests) account.friendRequests = [];
        }
        // Enforce a single active session per account: kick any other active
        // connection for this account before letting the new login through.
        if (onlineByName[nameLower] && onlineByName[nameLower].size > 0) {
          const oldSocketIds = Array.from(onlineByName[nameLower]);
          oldSocketIds.forEach(oldId => {
            io.to(oldId).emit('forceLoggedOut', { reason: 'another_login' });
            const oldSocket = io.sockets.sockets.get(oldId);
            if (oldSocket) { removePlayerFromRoom(oldSocket); oldSocket.disconnect(true); }
          });
          delete onlineByName[nameLower];
        }
        markOnline(socket, nameLower);
        const { passHash, ...safe } = account;
        cb({ ok: true, account: safe });
        notifyFriendsPresence(nameLower, true);
      } catch (e) { cb({ ok: false, error: 'server_error' }); }
    });

    socket.on('saveAccount', async ({ account }, cb) => {
      try {
        const nameLower = (account.name || '').trim().toLowerCase();
        const existing = await store.getAccount(nameLower);
        const merged = { ...existing, ...account, passHash: existing ? existing.passHash : undefined };
        await store.saveAccount(merged);
        await store.upsertLeaderboardEntry({
          name: merged.name, goals: merged.totalGoals || 0, assists: merged.totalAssists || 0,
          coins: merged.coins || 0, wins: merged.totalWins || 0, frame: merged.frame, avatar: merged.avatar,
          cups: merged.cups || 0, level: merged.level || 1
        });
        if (cb) cb({ ok: true });
      } catch (e) { if (cb) cb({ ok: false }); }
    });

    socket.on('getLeaderboard', async (cb) => {
      try { cb(await store.getLeaderboard()); } catch (e) { cb([]); }
    });

    socket.on('getProfile', async ({ name }, cb) => {
      try {
        const account = await store.getAccount((name || '').trim().toLowerCase());
        if (!account) return cb({ ok: false });
        cb({
          ok: true, profile: {
            name: account.name, avatar: account.avatar, frame: account.frame,
            totalGoals: account.totalGoals || 0, totalAssists: account.totalAssists || 0,
            totalWins: account.totalWins || 0, coins: account.coins || 0,
            cups: account.cups || 0, level: account.level || 1
          }
        });
      } catch (e) { cb({ ok: false }); }
    });

    // ---- hub presence ---------------------------------------------------
    socket.on('hubEnter', ({ name }) => {
      hubUsers[socket.id] = name || 'Guest';
      socket.join('hub');
      io.to('hub').emit('hubOnlineUpdate', Object.values(hubUsers));
    });
    socket.on('hubLeave', () => removeFromHub(socket));
    socket.on('hubChat', async ({ msg }) => {
      const name = hubUsers[socket.id];
      if (!name || typeof msg !== 'string' || !msg.trim() || msg.length > 140) return;
      if (!chatAllowed(socket)) return;
      let level = 1, cups = 0;
      try {
        const acc = await store.getAccount(name.toLowerCase());
        if (acc) { level = acc.level || 1; cups = acc.cups || 0; }
      } catch (e) {}
      io.to('hub').emit('hubChatUpdate', { name, msg: msg.trim().slice(0, 140), level, cups });
    });

    // ---- party (squad) ---------------------------------------------------
    socket.on('getParty', async ({ name }, cb) => {
      const nameLower = (name || '').trim().toLowerCase();
      const hostNameLower = partyHostOf[nameLower] || nameLower;
      const members = await partySnapshot(hostNameLower);
      cb && cb({ ok: true, hostName: hostNameLower, members });
    });

    socket.on('partyInvite', async ({ from, to }, cb) => {
      try {
        const fromLower = (from || '').trim().toLowerCase();
        const toLower = (to || '').trim().toLowerCase();
        if (!fromLower || !toLower || fromLower === toLower) return cb({ ok: false, error: 'invalid' });
        const fromHost = partyHostOf[fromLower] || fromLower;
        if (fromHost !== fromLower) return cb({ ok: false, error: 'not_host' });
        const current = partyMembers[fromHost] || [fromHost];
        if (current.length >= MAX_PARTY_SIZE) return cb({ ok: false, error: 'party_full' });
        if (current.includes(toLower)) return cb({ ok: false, error: 'already_in_party' });
        if (partyHostOf[toLower] && (partyMembers[partyHostOf[toLower]] || []).length > 1) {
          return cb({ ok: false, error: 'target_in_other_party' });
        }
        if (!isOnline(toLower)) return cb({ ok: false, error: 'offline' });
        const fromAcc = await store.getAccount(fromLower);
        const toAcc = await store.getAccount(toLower);
        if (!toAcc) return cb({ ok: false, error: 'not_found' });
        emitToName(toLower, 'partyInviteReceived', { fromName: fromAcc ? fromAcc.name : from, fromNameLower: fromLower });
        cb({ ok: true });
      } catch (e) { cb({ ok: false, error: 'server_error' }); }
    });

    socket.on('partyInviteRespond', async ({ name, fromNameLower, accept }, cb) => {
      try {
        const nameLower = (name || '').trim().toLowerCase();
        if (!accept) { cb && cb({ ok: true }); return; }
        leaveOrDisbandParty(nameLower);
        const hostNameLower = partyHostOf[fromNameLower] || fromNameLower;
        if (!partyMembers[hostNameLower]) partyMembers[hostNameLower] = [hostNameLower];
        if (!partyHostOf[hostNameLower]) partyHostOf[hostNameLower] = hostNameLower;
        if (partyMembers[hostNameLower].length >= MAX_PARTY_SIZE) return cb && cb({ ok: false, error: 'party_full' });
        if (!partyMembers[hostNameLower].includes(nameLower)) partyMembers[hostNameLower].push(nameLower);
        partyHostOf[nameLower] = hostNameLower;
        await broadcastParty(hostNameLower);
        cb && cb({ ok: true });
      } catch (e) { cb && cb({ ok: false, error: 'server_error' }); }
    });

    socket.on('partyLeave', async ({ name }, cb) => {
      const nameLower = (name || '').trim().toLowerCase();
      const result = leaveOrDisbandParty(nameLower);
      if (result) {
        if (result.disbanded) {
          result.formerMembers.forEach(m => emitToName(m, 'partyUpdate', { hostName: m, members: [] }));
        } else {
          await broadcastParty(result.hostNameLower);
          emitToName(nameLower, 'partyUpdate', { hostName: nameLower, members: [] });
        }
      }
      cb && cb({ ok: true });
    });

    // host presses Play with 2+ real party members present: everyone currently
    // online in the party is dropped straight into a fresh private match on the
    // same team, with any empty slots auto-filled by bots client-side.
    socket.on('partyStartVsBots', async ({ name, mode }, cb) => {
      try {
        const nameLower = (name || '').trim().toLowerCase();
        const hostNameLower = partyHostOf[nameLower] || nameLower;
        if (hostNameLower !== nameLower) return cb({ ok: false, error: 'not_host' });
        if (!MODE_TEAM_SIZE[mode]) return cb({ ok: false, error: 'bad_mode' });
        const members = partyMembers[hostNameLower] || [hostNameLower];
        const teamSize = MODE_TEAM_SIZE[mode];
        const code = 'P' + Math.random().toString(36).substring(2, 7).toUpperCase();
        const room = {
          code, mode, cap: teamSize * 2, isPublic: false, isLocal: false, started: true,
          hostId: null, players: [], passwordHash: null, chat: []
        };
        for (const m of members) {
          const sid = (m === nameLower) ? socket.id : firstSocketIdFor(m);
          if (!sid) continue;
          const acc = await store.getAccount(m);
          if (!room.hostId) room.hostId = sid;
          room.players.push({
            id: sid, name: acc ? acc.name : m, team: 'A', spectator: false,
            color: acc ? COLORS[acc.equippedColor || 0] : null,
            characterId: acc ? acc.equippedCharacterId : null,
            auraId: acc ? acc.equippedAura : null,
            cups: acc ? (acc.cups || 0) : 0, level: acc ? (acc.level || 1) : 1
          });
          socketRoom[sid] = code;
          io.sockets.sockets.get(sid) && io.sockets.sockets.get(sid).join(code);
        }
        if (room.players.length === 0) return cb({ ok: false, error: 'party_empty' });
        rooms[code] = room;
        initRoomPhysics(room);
        const state = publicRoomState(room);
        members.forEach(m => { if (m !== nameLower) emitToName(m, 'partyMatchReady', { code, room: state }); });
        cb({ ok: true, code, room: state, myId: room.hostId });
      } catch (e) { cb({ ok: false, error: 'server_error' }); }
    });

    // ---- friends: requests, list with online status, and game invites ------
    socket.on('getFriends', async ({ name }, cb) => {
      try {
        const nameLower = (name || '').trim().toLowerCase();
        const account = await store.getAccount(nameLower);
        if (!account) return cb({ ok: false, friends: [], requests: [] });
        const friendNames = account.friends || [];
        const friends = [];
        for (const fLower of friendNames) {
          const facc = await store.getAccount(fLower);
          friends.push({ name: facc ? facc.name : fLower, online: isOnline(fLower) });
        }
        const requests = (account.friendRequests || []).map(r => ({ from: r.from, fromName: r.fromName || r.from, ts: r.ts }));
        cb({ ok: true, friends, requests });
      } catch (e) { cb({ ok: false, friends: [], requests: [] }); }
    });

    socket.on('sendFriendRequest', async ({ from, to }, cb) => {
      try {
        const fromLower = (from || '').trim().toLowerCase();
        const toLower = (to || '').trim().toLowerCase();
        if (!fromLower || !toLower || fromLower === toLower) return cb({ ok: false, error: 'invalid' });
        const fromAcc = await store.getAccount(fromLower);
        const toAcc = await store.getAccount(toLower);
        if (!fromAcc || !toAcc) return cb({ ok: false, error: 'not_found' });
        fromAcc.friends = fromAcc.friends || [];
        if (fromAcc.friends.includes(toLower)) return cb({ ok: false, error: 'already_friends' });
        toAcc.friendRequests = toAcc.friendRequests || [];
        if (toAcc.friendRequests.some(r => r.from === fromLower)) return cb({ ok: false, error: 'already_sent' });
        toAcc.friendRequests.push({ from: fromLower, fromName: fromAcc.name, ts: Date.now() });
        await store.saveAccount(toAcc);
        emitToName(toLower, 'friendRequestReceived', { from: fromAcc.name });
        cb({ ok: true });
      } catch (e) { cb({ ok: false, error: 'server_error' }); }
    });

    socket.on('respondFriendRequest', async ({ name, from, accept }, cb) => {
      try {
        const nameLower = (name || '').trim().toLowerCase();
        const fromLower = (from || '').trim().toLowerCase();
        const account = await store.getAccount(nameLower);
        if (!account) return cb && cb({ ok: false });
        account.friendRequests = (account.friendRequests || []).filter(r => r.from !== fromLower);
        if (accept) {
          account.friends = account.friends || [];
          if (!account.friends.includes(fromLower)) account.friends.push(fromLower);
          const fromAcc = await store.getAccount(fromLower);
          if (fromAcc) {
            fromAcc.friends = fromAcc.friends || [];
            if (!fromAcc.friends.includes(nameLower)) fromAcc.friends.push(nameLower);
            await store.saveAccount(fromAcc);
          }
        }
        await store.saveAccount(account);
        emitToName(fromLower, 'friendRequestResult', { name: account.name, accepted: !!accept });
        cb && cb({ ok: true });
      } catch (e) { cb && cb({ ok: false }); }
    });

    socket.on('removeFriend', async ({ name, friend }, cb) => {
      try {
        const nameLower = (name || '').trim().toLowerCase();
        const friendLower = (friend || '').trim().toLowerCase();
        const account = await store.getAccount(nameLower);
        if (account) { account.friends = (account.friends || []).filter(f => f !== friendLower); await store.saveAccount(account); }
        const facc = await store.getAccount(friendLower);
        if (facc) { facc.friends = (facc.friends || []).filter(f => f !== nameLower); await store.saveAccount(facc); }
        cb && cb({ ok: true });
      } catch (e) { cb && cb({ ok: false }); }
    });

    socket.on('inviteFriendToGame', ({ fromName, toName, code }) => {
      const toLower = (toName || '').trim().toLowerCase();
      if (!toLower || !code) return;
      emitToName(toLower, 'gameInvite', { fromName, code });
    });

    socket.on('disconnect', () => {
      removeFromHub(socket);
      delete lastChatAt[socket.id];
      const nameLower = markOffline(socket);
      if (nameLower) notifyFriendsPresence(nameLower, false);
    });
  }

  return {
    COLORS, markOnline, markOffline, isOnline, emitToName, notifyFriendsPresence,
    removeFromHub, chatAllowed, getAccountLevelCups, registerHandlers, onlineByName
  };
}

module.exports = { createAuth, COLORS, MAX_PARTY_SIZE };
