// ---------------------------------------------------------------------------
// Persistence layer.
//
// If a MONGODB_URI environment variable is set, accounts + leaderboard are
// stored in MongoDB (Atlas free tier works great and survives Render
// redeploys/restarts, since Render's own filesystem is ephemeral).
//
// If MONGODB_URI is NOT set, we fall back to a local data.json file so the
// server still works out of the box with zero setup - just be aware that on
// Render's free plan this file is wiped on every redeploy/restart, since free
// services don't get a persistent disk. For real persistence, set
// MONGODB_URI in your Render service's environment variables
// (Settings -> Environment) to a MongoDB Atlas free-tier connection string.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const MONGO_URI = process.env.MONGODB_URI || '';

let mode = 'file';
let db = null;
let accountsCol = null;
let leaderboardCol = null;

let fileData = { accounts: {}, leaderboard: [] };

function loadFile() {
  try {
    fileData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    fileData = { accounts: {}, leaderboard: [] };
  }
}
function saveFile() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(fileData));
  } catch (e) {
    console.error('Failed to write data.json', e.message);
  }
}

async function init() {
  if (MONGO_URI) {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(MONGO_URI);
      await client.connect();
      db = client.db('egoball');
      accountsCol = db.collection('accounts');
      leaderboardCol = db.collection('leaderboard');
      await accountsCol.createIndex({ nameLower: 1 }, { unique: true });
      mode = 'mongo';
      console.log('[store] Using MongoDB persistence.');
      return;
    } catch (e) {
      console.error('[store] MongoDB connection failed, falling back to local file:', e.message);
    }
  }
  loadFile();
  mode = 'file';
  console.log('[store] Using local JSON file persistence (NOT durable on Render free tier redeploys).');
}

async function getAccount(nameLower) {
  if (mode === 'mongo') {
    return accountsCol.findOne({ nameLower });
  }
  return fileData.accounts[nameLower] || null;
}

async function saveAccount(account) {
  const nameLower = account.name.toLowerCase();
  account.nameLower = nameLower;
  if (mode === 'mongo') {
    await accountsCol.updateOne({ nameLower }, { $set: account }, { upsert: true });
    return;
  }
  fileData.accounts[nameLower] = account;
  saveFile();
}

async function getLeaderboard() {
  if (mode === 'mongo') {
    return leaderboardCol.find({}).sort({ goals: -1 }).limit(500).toArray();
  }
  return fileData.leaderboard;
}

async function upsertLeaderboardEntry(entry) {
  if (mode === 'mongo') {
    await leaderboardCol.updateOne(
      { nameLower: entry.name.toLowerCase() },
      { $set: { ...entry, nameLower: entry.name.toLowerCase() } },
      { upsert: true }
    );
    return;
  }
  const idx = fileData.leaderboard.findIndex(e => e.name.toLowerCase() === entry.name.toLowerCase());
  if (idx >= 0) fileData.leaderboard[idx] = entry;
  else fileData.leaderboard.push(entry);
  if (fileData.leaderboard.length > 500) fileData.leaderboard = fileData.leaderboard.slice(-500);
  saveFile();
}

module.exports = { init, getAccount, saveAccount, getLeaderboard, upsertLeaderboardEntry };
