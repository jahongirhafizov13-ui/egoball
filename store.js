// ============================================================================
// store.js - EGOBALL User Storage with levels and cosmetics
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

function createUser(username, passHash) {
  const key = username.toLowerCase();
  const user = { 
    username, 
    passHash, 
    wins: 0, 
    goals: 0, 
    level: 0,
    xp: 0,
    playerNumber: 7,
    coins: 0,
    items: [],
    createdAt: Date.now() 
  };
  users[key] = user;
  persist();
  return user;
}

function recordResult(username, { won, goals, xp = 0 }) {
  const key = username.toLowerCase();
  const u = users[key];
  if (!u) return;
  if (won) u.wins = (u.wins || 0) + 1;
  u.goals = (u.goals || 0) + (goals || 0);
  u.xp = (u.xp || 0) + (xp || 0);
  // Level up logic
  const newLevel = Math.floor(u.xp / 100);
  if (newLevel > u.level) {
    u.level = newLevel;
    u.coins = (u.coins || 0) + (newLevel * 10);
  }
  persist();
}

function updatePlayerNumber(username, number) {
  const key = username.toLowerCase();
  const u = users[key];
  if (!u) return;
  u.playerNumber = Math.max(1, Math.min(99, parseInt(number) || 7));
  persist();
}

module.exports = { getUser, createUser, recordResult, updatePlayerNumber };
