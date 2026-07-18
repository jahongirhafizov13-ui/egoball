// ============================================================================
// admin.js - operator tools only. Grants/removes Ecoin or G Coin on an
// account, two ways: an HTTP endpoint guarded by a secret key (for hosts like
// Render with no shell access), and a terminal console (for a VPS where you
// do have a shell). Nothing here is reachable by the game client itself.
// ============================================================================
const readline = require('readline');
const store = require('./store');

function registerAdminHttp(app, { isOnline, emitToName }) {
  const ADMIN_KEY = process.env.ADMIN_KEY || '';

  // Usage (paste in any browser, or share with yourself only):
  //   https://YOUR-HOST/admin/pay?key=YOUR_ADMIN_KEY&name=nickname&amount=500
  //   https://YOUR-HOST/admin/pay?key=YOUR_ADMIN_KEY&name=nickname&amount=90&currency=gcoin
  // A negative amount removes coins instead of granting them.
  app.get('/admin/pay', async (req, res) => {
    if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const name = String(req.query.name || '').trim();
    const amount = Number(req.query.amount);
    const field = req.query.currency === 'gcoin' ? 'gcoin' : 'coins';
    if (!name || !Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ ok: false, error: 'usage: /admin/pay?key=...&name=...&amount=500&currency=coins|gcoin' });
    }
    const nameLower = name.toLowerCase();
    try {
      const account = await store.getAccount(nameLower);
      if (!account) return res.status(404).json({ ok: false, error: 'account_not_found' });
      account[field] = (account[field] || 0) + amount;
      await store.saveAccount(account);
      if (isOnline(nameLower)) emitToName(nameLower, 'coinsGranted', { currency: field, amount, newBalance: account[field] });
      res.json({ ok: true, name: account.name, currency: field, amount, newBalance: account[field] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

function startAdminConsole({ isOnline, emitToName }) {
  const adminConsole = readline.createInterface({ input: process.stdin, terminal: false });
  adminConsole.on('line', async (raw) => {
    const line = raw.trim();
    if (!line.startsWith('/')) return;
    const parts = line.slice(1).split(/\s+/).filter(Boolean);
    const cmd = (parts.shift() || '').toLowerCase();

    if (cmd === 'pay') {
      const name = parts[0];
      const amount = Number(parts[1]);
      const field = (parts[2] === 'gcoin') ? 'gcoin' : 'coins';
      const label = field === 'gcoin' ? 'G Coin' : 'Ecoin';
      if (!name || !Number.isFinite(amount) || amount === 0) {
        console.log('Foydalanish: /pay <o\'yinchi_ismi> <miqdor> [ecoin|gcoin]');
        return;
      }
      const nameLower = name.trim().toLowerCase();
      try {
        const account = await store.getAccount(nameLower);
        if (!account) { console.log(`[pay] "${name}" nomli hisob topilmadi.`); return; }
        account[field] = (account[field] || 0) + amount;
        await store.saveAccount(account);
        console.log(`[pay] ${account.name} hisobiga ${amount} ${label} qo'shildi. Yangi balans: ${account[field]}`);
        if (isOnline(nameLower)) emitToName(nameLower, 'coinsGranted', { currency: field, amount, newBalance: account[field] });
      } catch (e) {
        console.log('[pay] Xatolik:', e.message);
      }
      return;
    }

    console.log(`Noma'lum buyruq: /${cmd}. Mavjud: /pay <ism> <miqdor> [ecoin|gcoin]`);
  });
  console.log("Admin konsol tayyor. Coin berish: /pay <ism> <miqdor> [ecoin|gcoin]  (masalan: /pay Xarun 90 gcoin)");
}

module.exports = { registerAdminHttp, startAdminConsole };
