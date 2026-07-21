// ============================================================================
// store.js - EGOBALL User Storage v2.0
// Features: Google auth, E-Coin, stats, skins, XP/Level system, team color
// ============================================================================
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');

let users = {};
try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { users = {}; }

let saveTimer = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), (err) => {
      if (err) console.error('Failed to save users.json:', err);
    });
  }, 200);
}

function getUser(username) {
  return users[username.toLowerCase()] || null;
}

function getUserByGoogleId(googleId) {
  for (const key in users) {
    if (users[key].googleId === googleId) return users[key];
  }
  return null;
}

function createUserFromGoogle(username, googleId, email, name) {
  const key = username.toLowerCase();
  const user = { 
    username, 
    googleId,
    email,
    displayName: name || username,
    wins: 0, 
    goals: 0, 
    assists: 0,
    level: 1,
    xp: 0,
    ecoin: 500, // Starting E-Coin
    playerNumber: 7,
    teamColor: null, // red or blue - chosen during setup
    stats: { speed: 1, kick: 1, jump: 1, size: 1 },
    skins: [],
    equippedSkin: null,
    cups: 0,
    championCups: 0,
    createdAt: Date.now() 
  };
  users[key] = user;
  persist();
  return user;
}

function recordResult(username, { won, goals, ecoin = 0, xp = 0 }) {
  const key = username.toLowerCase();
  const u = users[key];
  if (!u) return;
  if (won) u.wins = (u.wins || 0) + 1;
  u.goals = (u.goals || 0) + (goals || 0);
  u.ecoin = (u.ecoin || 0) + (ecoin || 0);
  u.xp = (u.xp || 0) + (xp || 0);
  const newLevel = Math.floor(u.xp / 100) + 1;
  if (newLevel > (u.level || 1)) {
    u.level = newLevel;
    u.ecoin += newLevel * 20;
  }
  persist();
}

module.exports = { getUser, getUserByGoogleId, createUserFromGoogle, recordResult, persist };