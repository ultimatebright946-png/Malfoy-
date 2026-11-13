// Express routes for the website. Shares the bot's in-memory database, so everything is live.
const express = require('express');
const path = require('path');
const db = require('./db');
const W = require('./webcore');
const S = require('./shop');

function token(req) { const m = /(?:^|;\s*)mf_s=([a-f0-9]{64})/.exec(req.headers.cookie || ''); return m ? m[1] : null; }

const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + req.path, now = Date.now(); let h = hits.get(k);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
    if (++h.n > max) return res.status(429).json({ ok: false, msg: 'Too many tries. Wait a minute and try again.' });
    next();
  };
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 60000).unref();

function mount(app) {
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY || '1', 10)); // set TRUST_PROXY=2 when the site sits behind Vercel
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use('/api', express.json({ limit: '700kb' }));
  // POST requests must be JSON sent by our own script (blocks cross-site form posts)
  app.use('/api', (req, res, next) => {
    if (req.method === 'POST' && (!req.is('application/json') || req.get('X-Requested-With') !== 'fetch')) return res.status(400).json({ ok: false, msg: 'Bad request.' });
    next();
  });
  app.use('/api', (err, req, res, next) => res.status(400).json({ ok: false, msg: 'That request was too large or invalid.' }));

  const auth = (req, res, next) => { const u = W.sessionUser(token(req)); if (!u) return res.status(401).json({ ok: false, msg: 'Sign in first.' }); req.u = u; next(); };

  app.post('/api/login', limit(10, 60000), (req, res) => {
    const uid = W.redeem(req.body && req.body.code);
    if (!uid) return res.status(400).json({ ok: false, msg: 'That code is wrong or expired. Send .weblogin to the bot for a new one.' });
    const t = W.newSession(uid);
    res.cookie('mf_s', t, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 86400000, path: '/' });
    res.json({ ok: true, me: W.me(db.data.users[uid]) });
  });
  app.post('/api/logout', (req, res) => { W.endSession(token(req)); res.clearCookie('mf_s', { path: '/' }); res.json({ ok: true }); });
  app.get('/api/me', (req, res) => { const u = W.sessionUser(token(req)); res.json(u ? { ok: true, me: W.me(u) } : { ok: false }); });

  app.get('/api/leaderboard', (req, res) => res.json({ ok: true, list: W.leaderboard(['level', 'coins', 'kills'].indexOf(req.query.by) > -1 ? req.query.by : 'level', 50) }));
  app.get('/api/transactions', auth, (req, res) => res.json({ ok: true, coins: req.u.coins, pid: W.pid(req.u), list: W.transactions(req.u, 100) }));
  app.post('/api/give', limit(20, 60000), auth, (req, res) => { const r = W.give(req.u, req.body && req.body.to, req.body && req.body.amount); res.status(r.ok ? 200 : 400).json(r); });
  const DU = require('./duel');
  const room = (req, res) => { const r = /^[a-f0-9]{8}$/.test(req.params.id) && DU.get(req.params.id); if (!r) { res.status(404).json({ ok: false, msg: 'This duel room does not exist or has closed.' }); return null; } return r; };
  app.get('/api/duel/:id', limit(240, 60000), auth, (req, res) => { const r = room(req, res); if (r) res.json({ ok: true, d: DU.view(r, req.u) }); });
  app.post('/api/duel/:id/join', limit(30, 60000), auth, (req, res) => { const r = room(req, res); if (!r) return; const x = DU.join(r, req.u); res.status(x.ok ? 200 : 400).json(Object.assign({}, x, x.ok ? { d: DU.view(r, req.u) } : {})); });
  app.post('/api/duel/:id/move', limit(120, 60000), auth, (req, res) => { const r = room(req, res); if (!r) return; const x = DU.move(r, req.u, String(req.body && req.body.m || '')); res.status(x.ok ? 200 : 400).json(Object.assign({}, x, { d: DU.view(r, req.u) })); });
  const BK = require('./bank');
  app.post('/api/gender', limit(20, 60000), auth, (req, res) => { const r = W.setGender(req.u, req.body && req.body.gender); res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true, me: W.me(req.u) } : r); });
  app.get('/api/bank', auth, (req, res) => res.json(Object.assign({ ok: true }, BK.info(req.u))));
  app.post('/api/bank/deposit', limit(40, 60000), auth, (req, res) => { const r = BK.deposit(req.u, req.body && req.body.amount); res.status(r.ok ? 200 : 400).json(Object.assign({}, r, BK.info(req.u), { ok: r.ok, msg: r.msg })); });
  app.post('/api/bank/withdraw', limit(40, 60000), auth, (req, res) => { const r = BK.withdraw(req.u, req.body && req.body.amount); res.status(r.ok ? 200 : 400).json(Object.assign({}, r, BK.info(req.u), { ok: r.ok, msg: r.msg })); });
  app.get('/api/shop', (req, res) => { const u = W.sessionUser(token(req)); res.json({ ok: true, cats: W.CATS, items: W.shopList(u), coins: u ? u.coins : null }); });

  app.post('/api/buy', limit(40, 60000), auth, (req, res) => {
    const r = S.buy(req.u, String(req.body && req.body.id || ''));
    if (r.ok) db.save();
    res.status(r.ok ? 200 : 400).json({ ok: r.ok, msg: r.msg, coins: req.u.coins });
  });
  app.post('/api/pfp', limit(15, 60000), auth, (req, res) => { const r = W.savePfp(req.u, req.body && req.body.data); res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true, me: W.me(req.u) } : r); });
  app.post('/api/pfp/gallery', limit(30, 60000), auth, (req, res) => { const r = W.setGallery(req.u, req.body && req.body.key); res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true, me: W.me(req.u) } : r); });
  app.post('/api/pfp/clear', auth, (req, res) => { W.clearPfp(req.u); res.json({ ok: true, me: W.me(req.u) }); });
  app.post('/api/name', limit(15, 60000), auth, (req, res) => { const r = W.setName(req.u, req.body && req.body.name); res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true, me: W.me(req.u) } : r); });

  app.post('/api/game/start', limit(20, 60000), auth, (req, res) => { const r = W.gameStart(req.u); res.status(r.ok ? 200 : 400).json(r); });
  app.post('/api/game/finish', limit(20, 60000), auth, (req, res) => { const b = req.body || {}; const r = W.gameFinish(req.u, b.runId, { kills: b.kills, geo: b.geo, survived: b.survived }); res.status(r.ok ? 200 : 400).json(r); });

  app.get('/pfp/:pid', (req, res) => {
    const u = W.byPid(String(req.params.pid).replace(/[^a-f0-9]/g, ''));
    const p = u && W.pfpPath(u); if (!p) return res.status(404).end();
    res.set({ 'Content-Type': p.type, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.sendFile(path.resolve(p.file), err => { if (err && !res.headersSent) res.status(404).end(); });
  });
  app.use(express.static(W.WEB, { maxAge: '1h', index: 'index.html', dotfiles: 'ignore' }));
}
module.exports = { mount };
