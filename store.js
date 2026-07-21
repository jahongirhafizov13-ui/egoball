// ============================================================================
// store.js - minimal persistent user storage, single JSON file on disk.
// Kept deliberately simple (no external DB dependency) so this project runs
// anywhere with zero setup. Swap this module out for a real database later
// without touching anything else - it's the only file that touches disk.
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
  const user = { username, passHash, wins: 0, goals: 0, createdAt: Date.now() };
  users[key] = user;
  persist();
  return user;
}
function recordResult(username, { won, goals }) {
  const key = username.toLowerCase();
  const u = users[key];
  if (!u) return;
  if (won) u.wins = (u.wins || 0) + 1;
  u.goals = (u.goals || 0) + (goals || 0);
  persist();
}

module.exports = { getUser, createUser, recordResult };
