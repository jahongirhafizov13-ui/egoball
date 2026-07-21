// ============================================================================
// auth.js - registration/login. Passwords are always bcrypt-hashed before
// they touch disk. Sessions are JWTs so the server stays stateless between
// restarts (no server-side session table to lose).
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
const USERNAME_RE = /^[A-Za-z0-9_\-]{3,16}$/;

function validUsername(u) { return typeof u === 'string' && USERNAME_RE.test(u); }
function validPassword(p) { return typeof p === 'string' && p.length >= 4 && p.length <= 100; }

async function register(username, password) {
  if (!validUsername(username)) return { ok: false, error: 'bad_username' };
  if (!validPassword(password)) return { ok: false, error: 'bad_password' };
  if (store.getUser(username)) return { ok: false, error: 'username_taken' };
  const passHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = store.createUser(username, passHash);
  return { ok: true, token: issueToken(user), profile: publicProfile(user) };
}

async function login(username, password) {
  if (!validUsername(username) || !validPassword(password)) return { ok: false, error: 'bad_credentials' };
  const user = store.getUser(username);
  if (!user) return { ok: false, error: 'no_such_user' };
  const match = await bcrypt.compare(password, user.passHash);
  if (!match) return { ok: false, error: 'wrong_password' };
  return { ok: true, token: issueToken(user), profile: publicProfile(user) };
}

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
  return { username: user.username, wins: user.wins || 0, goals: user.goals || 0 };
}

module.exports = { register, login, verifyToken, publicProfile };
