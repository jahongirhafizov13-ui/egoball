// ============================================================================
// auth.js - EGOBALL Authentication v2.0
// Features: Google OAuth, E-Coin economy, skin system, stat upgrades
// ============================================================================
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('./store');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: set JWT_SECRET in your environment before starting the server.');
  process.exit(1);
}
const TOKEN_TTL = '30d';
const BCRYPT_ROUNDS = 10;

// Random skin names (non-Uzbek, non-player names)
const SKIN_NAMES = [
  'Blaze', 'Frost', 'Shadow', 'Thunder', 'Viper', 'Phantom', 'Titan', 'Nova',
  'Rex', 'Zephyr', 'Onyx', 'Crimson', 'Steel', 'Venom', 'Storm', 'Havoc',
  'Spectre', 'Doom', 'Raptor', 'Fury', 'Ghost', 'Wraith', 'Bullet', 'Spartan',
  'Cobra', 'Dragon', 'Eagle', 'Falcon', 'Hunter', 'Jaguar', 'Knight', 'Lion',
  'Mamba', 'Ninja', 'Panther', 'Rocket', 'Shark', 'Tiger', 'Viking', 'Wolf'
];

const SKIN_RARITIES = {
  common: { chance: 0.6, price: 500, color: '#888' },
  rare: { chance: 0.3, price: 1500, color: '#4488ff' },
  epic: { chance: 0.09, price: 3000, color: '#aa44ff' },
  legendary: { chance: 0.01, price: 8000, color: '#ffaa00' }
};

function generateSkins() {
  const skins = [];
  let id = 1;
  for (const name of SKIN_NAMES) {
    const rand = Math.random();
    let rarity = 'common';
    if (rand > 0.99) rarity = 'legendary';
    else if (rand > 0.9) rarity = 'epic';
    else if (rand > 0.6) rarity = 'rare';

    skins.push({
      id: `skin_${id}`,
      name: name,
      rarity: rarity,
      price: SKIN_RARITIES[rarity].price,
      color: SKIN_RARITIES[rarity].color,
      stats: {
        speed: rarity === 'common' ? 0.05 : rarity === 'rare' ? 0.1 : rarity === 'epic' ? 0.15 : 0.2,
        kick: rarity === 'common' ? 0.05 : rarity === 'rare' ? 0.1 : rarity === 'epic' ? 0.15 : 0.2,
        jump: rarity === 'common' ? 0.05 : rarity === 'rare' ? 0.1 : rarity === 'epic' ? 0.15 : 0.2,
        size: rarity === 'common' ? 0.02 : rarity === 'rare' ? 0.04 : rarity === 'epic' ? 0.06 : 0.08
      }
    });
    id++;
  }
  return skins;
}

const ALL_SKINS = generateSkins();

function issueToken(user) {
  return jwt.sign({ u: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = store.getUser(payload.u);
    return user ? user : null;
  } catch (e) { return null; }
}

function publicProfile(user) {
  return { 
    username: user.username,
    displayName: user.displayName || user.username,
    wins: user.wins || 0, 
    goals: user.goals || 0,
    level: user.level || 1,
    xp: user.xp || 0,
    ecoin: user.ecoin || 0,
    playerNumber: user.playerNumber || 7,
    stats: user.stats || { speed: 1, kick: 1, jump: 1, size: 1 },
    equippedSkin: user.equippedSkin || null,
    skins: user.skins || []
  };
}

async function googleAuth(googleId, email, name) {
  if (!googleId || !email) return { ok: false, error: 'invalid_google_data' };

  let user = store.getUserByGoogleId(googleId);
  if (!user) {
    // Create new user from Google data
    const username = `player_${googleId.slice(-8)}`;
    user = store.createUserFromGoogle(username, googleId, email, name);
  }

  return { ok: true, token: issueToken(user), profile: publicProfile(user), isNew: !user.displayName };
}

async function setPlayerInfo(username, displayName, playerNumber) {
  const user = store.getUser(username);
  if (!user) return { ok: false, error: 'not_found' };

  if (displayName && displayName.length >= 2 && displayName.length <= 16) {
    user.displayName = displayName;
  }
  if (playerNumber) {
    user.playerNumber = Math.max(1, Math.min(99, parseInt(playerNumber) || 7));
  }
  store.persist();
  return { ok: true, profile: publicProfile(user) };
}

function getUserByUsername(username) {
  return store.getUser(username);
}

function upgradeStat(username, stat) {
  const user = store.getUser(username);
  if (!user) return { ok: false, error: 'not_found' };

  const validStats = ['speed', 'kick', 'jump', 'size'];
  if (!validStats.includes(stat)) return { ok: false, error: 'invalid_stat' };

  const currentLevel = (user.stats || {})[stat] || 1;
  const cost = 1500 * currentLevel;

  if ((user.ecoin || 0) < cost) return { ok: false, error: 'not_enough_ecoin', required: cost, have: user.ecoin };

  user.ecoin -= cost;
  user.stats = user.stats || { speed: 1, kick: 1, jump: 1, size: 1 };
  user.stats[stat] = currentLevel + 0.5;
  store.persist();

  return { ok: true, stat, newLevel: user.stats[stat], cost, newBalance: user.ecoin };
}

function addEcoin(username, amount) {
  const user = store.getUser(username);
  if (!user) return { ok: false, error: 'not_found' };
  user.ecoin = (user.ecoin || 0) + amount;
  store.persist();
  return { ok: true, newBalance: user.ecoin };
}

function addXp(username, amount) {
  const user = store.getUser(username);
  if (!user) return;
  user.xp = (user.xp || 0) + amount;
  const newLevel = Math.floor(user.xp / 100) + 1;
  if (newLevel > (user.level || 1)) {
    user.level = newLevel;
    // Level up bonus
    user.ecoin = (user.ecoin || 0) + newLevel * 20;
  }
  store.persist();
}

function getSkins(username) {
  const user = store.getUser(username);
  if (!user) return [];
  return ALL_SKINS.map(skin => ({
    ...skin,
    owned: (user.skins || []).includes(skin.id),
    equipped: user.equippedSkin === skin.id
  }));
}

function buySkin(username, skinId) {
  const user = store.getUser(username);
  if (!user) return { ok: false, error: 'not_found' };

  const skin = ALL_SKINS.find(s => s.id === skinId);
  if (!skin) return { ok: false, error: 'skin_not_found' };
  if ((user.skins || []).includes(skinId)) return { ok: false, error: 'already_owned' };
  if ((user.ecoin || 0) < skin.price) return { ok: false, error: 'not_enough_ecoin' };

  user.ecoin -= skin.price;
  user.skins = user.skins || [];
  user.skins.push(skinId);
  store.persist();

  return { ok: true, skinId, newBalance: user.ecoin };
}

function equipSkin(username, skinId) {
  const user = store.getUser(username);
  if (!user) return { ok: false, error: 'not_found' };
  if (skinId && !(user.skins || []).includes(skinId)) return { ok: false, error: 'not_owned' };

  user.equippedSkin = skinId || null;
  store.persist();
  return { ok: true, equippedSkin: skinId };
}

module.exports = { 
  googleAuth, setPlayerInfo, verifyToken, publicProfile,
  getUserByUsername, upgradeStat, addEcoin, addXp,
  getSkins, buySkin, equipSkin, ALL_SKINS
};
