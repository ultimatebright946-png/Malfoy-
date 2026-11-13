// Online duels. A bot command (.duel) creates a room, the players open the link and fight turn by turn.
// The server decides everything; the browser only sends the move you picked.
const crypto = require('crypto');
const db = require('./db');
const R = require('./rpg');
const W = require('./webcore');

const CFG = { TURN: 25000, MAX_ROUNDS: 15, OPEN_TTL: 15 * 60e3, LIFE: 45 * 60e3, HP: 6, SOUL_MAX: 6, CAST_COST: 3, MAX_BET: 5000, WIN_XP: 12, LOSE_XP: 3, WIN_GEO: 40, MAX_REWARDED_DAY: 5, PAIR_DAY: 2, IDLE_LIMIT: 3 };
const MOVES = ['S', 'D', 'F', 'C'];
const ROOMS = new Map();
const hooks = { notify: null };
const today = () => new Date().toISOString().slice(0, 10);
const link = id => W.baseUrl() + '/#/duel/' + id;

function sweep() {
  const now = Date.now();
  ROOMS.forEach((r, id) => {
    if (r.status === 'waiting' && now - r.created > CFG.OPEN_TTL) { r.status = 'expired'; }
    if (now - r.created > CFG.LIFE) ROOMS.delete(id);
  });
}
setInterval(sweep, 60000).unref();

function create(u, targetId, bet, jid) {
  bet = Math.floor(Number(bet) || 0);
  if (bet < 0 || bet > CFG.MAX_BET) return { ok: false, msg: 'Bets go from 0 to ' + CFG.MAX_BET + ' Geo.' };
  if (u.coins < bet) return { ok: false, msg: 'You only have ' + u.coins + ' Geo.' };
  const target = targetId ? db.getUser(targetId).id : null;
  if (target && target === u.id) return { ok: false, msg: 'You cannot duel yourself.' };
  if (target && db.getUser(target).coins < bet) return { ok: false, msg: 'They cannot afford that bet.' };
  ROOMS.forEach(r => { if (r.status === 'waiting' && r.players[0].id === u.id) r.status = 'cancelled'; });
  const id = crypto.randomBytes(4).toString('hex');
  const room = { id, jid, bet, target, status: 'waiting', created: Date.now(), round: 0, deadline: 0, log: [], winner: null, reason: '', rewards: {}, players: [fighter(u)] };
  ROOMS.set(id, room);
  return { ok: true, room, link: link(id) };
}
function fighter(u) { return { id: u.id, hp: CFG.HP, soul: 1, move: null, idle: 0, crit: Math.min(25, R.stats(u).crit) }; }
const get = id => ROOMS.get(String(id || '')) || null;
const idx = (room, u) => room.players.findIndex(p => p.id === u.id);

function join(room, u) {
  tick(room);
  if (room.status !== 'waiting') return { ok: false, msg: room.status === 'active' ? 'This duel already started.' : 'This room is closed.' };
  if (u.id === room.players[0].id) return { ok: false, msg: 'Waiting for your opponent. Share the link.' };
  if (room.target && room.target !== u.id) return { ok: false, msg: 'This duel is for someone else.' };
  const host = db.getUser(room.players[0].id);
  if (u.coins < room.bet || host.coins < room.bet) return { ok: false, msg: 'Someone cannot afford the ' + room.bet + ' Geo bet anymore.' };
  room.players.push(fighter(u)); room.status = 'active'; room.round = 1; room.deadline = Date.now() + CFG.TURN;
  notify(room, '⚔️ *DUEL STARTED*\n@' + room.players[0].id.split('@')[0] + ' vs @' + u.id.split('@')[0] + '\nGood luck, Wanderers!', room.players.map(p => p.id));
  return { ok: true };
}

function move(room, u, m) {
  tick(room);
  const i = idx(room, u);
  if (i < 0) return { ok: false, msg: 'You are not in this duel.' };
  if (room.status !== 'active') return { ok: false, msg: 'This duel is not running.' };
  if (MOVES.indexOf(m) < 0) return { ok: false, msg: 'Unknown move.' };
  const p = room.players[i];
  if (p.move) return { ok: false, msg: 'You already chose this round.' };
  if (m === 'C' && p.soul < CFG.CAST_COST) return { ok: false, msg: 'Not enough soul to cast.' };
  p.move = m; p.idle = 0;
  if (room.players.every(x => x.move)) resolve(room);
  return { ok: true };
}

function tick(room) {
  const now = Date.now();
  if (room.status === 'waiting' && now - room.created > CFG.OPEN_TTL) room.status = 'expired';
  if (room.status === 'active' && now > room.deadline) {
    room.players.forEach(p => { if (!p.move) { p.idle++; p.move = 'F'; p.auto = true; } });
    const out = room.players.findIndex(p => p.idle >= CFG.IDLE_LIMIT);
    if (out > -1) return finish(room, 1 - out, 'forfeit');
    resolve(room);
  }
}

// What one player takes this round, given my move m and their move t.
function taken(m, t, theirCrit) {
  let d = 0;
  if (t === 'S' && m !== 'D') d += (m === 'F' ? 2 : 1) + (Math.random() * 100 < theirCrit ? 1 : 0);
  if (t === 'C' && m !== 'D') d += 2;
  if (m === 'S' && t === 'D') d += 1;          // dash counter
  return d;
}
function resolve(room) {
  const [A, B] = room.players, ma = A.move, mb = B.move;
  const dA = taken(ma, mb, B.crit), dB = taken(mb, ma, A.crit);
  [[A, ma, mb, dA], [B, mb, ma, dB]].forEach(([p, m, t, d]) => {
    let heal = 0, soul = 0;
    if (m === 'F' && t !== 'S' && t !== 'C') { heal = 1; soul = 1; }
    if (m === 'S' && t !== 'D') soul = 1;
    if (m === 'D' && (t === 'S' || t === 'C')) soul = 1;
    if (m === 'C') soul = -CFG.CAST_COST;
    p.hp = Math.max(0, Math.min(CFG.HP, p.hp - d + heal)); p.soul = Math.max(0, Math.min(CFG.SOUL_MAX, p.soul + soul));
  });
  room.log.push({ r: room.round, m: [ma, mb], d: [dA, dB], auto: [!!A.auto, !!B.auto] });
  if (room.log.length > 30) room.log.shift();
  A.move = B.move = null; A.auto = B.auto = false;
  if (A.hp <= 0 && B.hp <= 0) return finish(room, null, 'both fell');
  if (A.hp <= 0) return finish(room, 1, 'defeat');
  if (B.hp <= 0) return finish(room, 0, 'defeat');
  if (room.round >= CFG.MAX_ROUNDS) return finish(room, A.hp === B.hp ? null : A.hp > B.hp ? 0 : 1, 'time');
  room.round++; room.deadline = Date.now() + CFG.TURN;
}

function eligible(u, oppId) {
  const d = u.duel || (u.duel = { day: today(), n: 0, pairs: {}, w: 0, l: 0 });
  if (d.day !== today()) { d.day = today(); d.n = 0; d.pairs = {}; }
  return d.n < CFG.MAX_REWARDED_DAY && (d.pairs[oppId] || 0) < CFG.PAIR_DAY;
}
function finish(room, w, reason) {
  room.status = 'done'; room.reason = reason; room.winner = w; room.deadline = 0;
  const names = room.players.map(p => db.getUser(p.id).name);
  if (w === null) { notify(room, '🤝 *DUEL ENDED IN A DRAW*\n' + names.join(' vs ') + ' (' + reason + ')', room.players.map(p => p.id)); return; }
  const win = db.getUser(room.players[w].id), lose = db.getUser(room.players[1 - w].id);
  [win, lose].forEach(u => { if (!u.duel) u.duel = { day: today(), n: 0, pairs: {}, w: 0, l: 0 }; });
  win.duel.w++; lose.duel.l++;
  const ok = eligible(win, lose.id) && eligible(lose, win.id);
  room.rewards[win.id] = { xp: 0, geo: 0, bet: 0, counted: ok }; room.rewards[lose.id] = { xp: 0, geo: 0, bet: 0, counted: ok };
  if (room.bet) {
    const pay = Math.min(room.bet, lose.coins);
    if (pay > 0) { db.money(lose, -pay, 'duel_bet', 'Lost duel bet to ' + win.name); db.money(win, pay, 'duel_bet', 'Won duel bet against ' + lose.name); }
    room.rewards[win.id].bet = pay; room.rewards[lose.id].bet = -pay;
  }
  if (ok) {
    const rw = R.gainXp(win, CFG.WIN_XP); db.money(win, CFG.WIN_GEO, 'duel', 'Won a duel against ' + lose.name);
    const rl = R.gainXp(lose, CFG.LOSE_XP);
    room.rewards[win.id].xp = rw.gain; room.rewards[win.id].geo = CFG.WIN_GEO; room.rewards[lose.id].xp = rl.gain;
    win.duel.n++; lose.duel.n++; win.duel.pairs[lose.id] = (win.duel.pairs[lose.id] || 0) + 1; lose.duel.pairs[win.id] = (lose.duel.pairs[win.id] || 0) + 1;
  }
  db.save();
  notify(room, '🏆 *DUEL OVER*\n@' + win.id.split('@')[0] + ' defeated @' + lose.id.split('@')[0] + (reason === 'forfeit' ? ' (opponent left)' : '') +
    (room.bet ? '\n💰 Bet: *' + room.rewards[win.id].bet + '* Geo' : '') + (ok ? '\n🎖️ +' + room.rewards[win.id].xp + ' XP, +' + CFG.WIN_GEO + ' Geo' : '\n_(No XP: daily duel limit or same opponent too often.)_'), [win.id, lose.id]);
}
function notify(room, text, mentions) { try { if (hooks.notify && room.jid) hooks.notify(room.jid, text, mentions || []); } catch (e) {} }

function pview(p) { const u = db.getUser(p.id); return { name: u.name, pfp: W.pfpUrl(u), level: u.level, hp: p.hp, maxHp: CFG.HP, soul: p.soul, maxSoul: CFG.SOUL_MAX, moved: !!p.move }; }
function view(room, u) {
  tick(room);
  const i = idx(room, u);
  const host = db.getUser(room.players[0].id);
  const v = { id: room.id, status: room.status, bet: room.bet, round: room.round, maxRounds: CFG.MAX_ROUNDS, left: room.deadline ? Math.max(0, room.deadline - Date.now()) : 0, turn: CFG.TURN, castCost: CFG.CAST_COST, member: i > -1,
    host: { name: host.name, pfp: W.pfpUrl(host) }, forYou: !room.target || room.target === u.id };
  if (i < 0) { v.canJoin = room.status === 'waiting' && v.forYou; return v; }
  v.you = pview(room.players[i]);
  if (room.players[1 - i]) v.opp = pview(room.players[1 - i]);
  v.log = room.log.slice(-8).map(l => ({ r: l.r, you: l.m[i], opp: l.m[1 - i], took: l.d[i], dealt: l.d[1 - i], youAuto: l.auto[i], oppAuto: l.auto[1 - i] }));
  if (room.status === 'done') { v.result = room.winner === null ? 'draw' : room.winner === i ? 'win' : 'loss'; v.reason = room.reason; v.reward = room.rewards[u.id] || null; }
  return v;
}
module.exports = { CFG, create, get, join, move, view, hooks, link };
