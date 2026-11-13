'use strict';
// Core helpers: in-memory DB (debounced save), HTTP, image pools, character images, AI.
const fs = require('fs');
const os = require('os');
const util = require('util');
const { execFile } = require('child_process');
const execF = util.promisify(execFile);

const DATA_DIR = process.env.DATA_DIR || '.';
const TMP = os.tmpdir();
fs.mkdirSync(DATA_DIR + '/database', { recursive: true });
const DB_FILE = DATA_DIR + '/database/db.json';
const IMG_FILE = DATA_DIR + '/database/charimgs.json';

// ---------- database (everything lives in RAM, flushed every 4s) ----------
const db = { users: {}, muted: {}, groups: {} };
try { Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) {}
let dirty = false;
function save() { dirty = true; }
function flush() {
  if (!dirty) return; dirty = false;
  try { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); }
  catch (e) { console.log('SAVE FAIL', e.message); }
}
setInterval(flush, 4000).unref();
['SIGTERM', 'SIGINT'].forEach(function (s) { process.on(s, function () { flush(); process.exit(0); }); });

function defaults(jid, name) {
  return {
    id: jid, name: name || 'User', gender: 'male', age: 18, registered: false, banned: false, warns: 0,
    level: 1, xp: 0, totalXp: 0, coins: 1000, gems: 5, streak: 0, lastDaily: 0, lastWork: 0, lastRest: 0,
    hp: 60, energy: 100, energyAt: Date.now(), area: 'crossroads', kills: 0, bossKills: 0, deaths: 0,
    inv: {}, gear: { nail: null, armor: null, charm: null }, buff: { xp: 0, coin: 0 },
    done: {}, qprog: {}, bosses: {}, characters: {}, lifelongChar: '', sm: 0, mineEnds: 0
  };
}
function getUser(jid, name) {
  var u = db.users[jid];
  if (!u) { u = db.users[jid] = defaults(jid, name); save(); }
  else {
    var d = defaults(jid, name);
    for (var k in d) if (u[k] === undefined) u[k] = d[k];
    if (Array.isArray(u.inv)) u.inv = {};
    if (name && !u.registered && u.name !== name) u.name = name;
  }
  return u;
}
function groupSet(jid) { if (!db.groups[jid]) db.groups[jid] = { antilink: false, welcome: false }; return db.groups[jid]; }
function mutedList(jid) { if (!db.muted[jid]) db.muted[jid] = []; return db.muted[jid]; }

// ---------- small utils ----------
function rnd(n) { return Math.floor(Math.random() * n); }
function pick(a) { return a[rnd(a.length)]; }
function dur(ms) { if (ms < 0) ms = 0; var s = Math.floor(ms / 1000); var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + (s % 60) + 's'; }
function bar(p, n) { n = n || 10; p = Math.max(0, Math.min(100, p)); var f = Math.round(p / 100 * n); return '█'.repeat(f) + '░'.repeat(n - f); }
function rm(f) { try { fs.unlinkSync(f); } catch (e) {} }
function tmpName(ext) { return TMP + '/mf_' + Date.now() + '_' + rnd(1e6) + (ext || ''); }
function safeUrl(u) { try { var x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; } catch (e) { return null; } }
function isYT(u) { try { return /(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(u).hostname); } catch (e) { return false; } }
function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

// ---------- http ----------
async function http(url, opts, t) {
  var c = new AbortController(); var to = setTimeout(function () { c.abort(); }, t || 8000);
  try {
    var o = Object.assign({}, opts || {}); o.signal = c.signal;
    o.headers = Object.assign({ 'User-Agent': 'Mozilla/5.0' }, o.headers || {});
    return await fetch(url, o);
  } finally { clearTimeout(to); }
}
async function fetchJSON(u, t) { try { var r = await http(u, {}, t); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } }
async function fetchText(u, t) { try { var r = await http(u, {}, t); if (!r.ok) return null; return await r.text(); } catch (e) { return null; } }

var bufCache = new Map(); var bufBytes = 0;
async function getBuf(url, referer, t) {
  if (bufCache.has(url)) { var v = bufCache.get(url); bufCache.delete(url); bufCache.set(url, v); return v; }
  try {
    var h = referer ? { Referer: referer } : {};
    var r = await http(url, { headers: h }, t || 10000); if (!r.ok) return null;
    var b = Buffer.from(await r.arrayBuffer()); if (b.length < 500) return null;
    if (b.length < 6e6) {
      bufCache.set(url, b); bufBytes += b.length;
      while (bufBytes > 40e6 || bufCache.size > 40) { var k = bufCache.keys().next().value; bufBytes -= bufCache.get(k).length; bufCache.delete(k); }
    }
    return b;
  } catch (e) { return null; }
}

// ---------- local media ----------
var localCache = {};
function localImg(name) {
  if (localCache[name] !== undefined) return localCache[name];
  var c = [DATA_DIR + '/media/' + name, './media/' + name, './' + name];
  for (var i = 0; i < c.length; i++) { try { if (fs.existsSync(c[i])) return (localCache[name] = fs.readFileSync(c[i])); } catch (e) {} }
  return (localCache[name] = null);
}
function localWaifu() {
  try {
    var f = fs.readdirSync('./waifu').filter(function (x) { return /\.(jpe?g|png)$/i.test(x); });
    if (!f.length) return null; return fs.readFileSync('./waifu/' + pick(f));
  } catch (e) { return null; }
}

// ---------- image pools (pre-fetched so replies are instant) ----------
var pools = {}; var refilling = {};
async function refill(tag) {
  if (refilling[tag]) return; refilling[tag] = true;
  try {
    var r = await http('https://api.waifu.pics/many/sfw/' + tag, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"exclude":[]}' }, 8000);
    var d = await r.json();
    if (d && d.files) pools[tag] = (pools[tag] || []).concat(d.files).slice(-60);
  } catch (e) {}
  refilling[tag] = false;
}
async function poolUrl(tag) {
  var p = pools[tag] || (pools[tag] = []);
  if (p.length < 6) refill(tag);
  if (p.length) return p.splice(rnd(p.length), 1)[0];
  var d = await fetchJSON('https://api.waifu.pics/sfw/' + tag, 5000);
  if (d && d.url) return d.url;
  var n = await fetchJSON('https://nekos.best/api/v2/' + (tag === 'kill' ? 'shoot' : tag), 5000);
  return n && n.results && n.results[0] ? n.results[0].url : null;
}

// ---------- gif -> mp4 clips (kill, hug, slap ...) ----------
var ready = {}; var busy = {};
async function makeMp4(url) {
  var gif = await getBuf(url, null, 10000); if (!gif) return null;
  var i = tmpName('.gif'), o = tmpName('.mp4'); fs.writeFileSync(i, gif);
  try {
    await execF('ffmpeg', ['-y', '-i', i, '-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-an', o], { timeout: 20000 });
    return fs.readFileSync(o);
  } catch (e) { return null; } finally { rm(i); rm(o); }
}
function topup(tag) {
  if (busy[tag] || (ready[tag] || []).length >= 2) return; busy[tag] = true;
  (async function () {
    try { var u = await poolUrl(tag); if (u && /\.gif/i.test(u)) { var b = await makeMp4(u); if (b) (ready[tag] = ready[tag] || []).push(b); } }
    catch (e) {} finally { busy[tag] = false; }
  })();
}
// returns {video:Buffer} | {image:src} | null
async function clip(tag) {
  var r = ready[tag]; topup(tag);
  if (r && r.length) return { video: r.shift() };
  var u = await poolUrl(tag); if (!u) return null;
  if (!/\.gif($|\?)/i.test(u)) return { image: u };
  var b = await makeMp4(u); return b ? { video: b } : { image: u };
}

// ---------- sending ----------
async function toBuf(src) {
  if (!src) return null; if (Buffer.isBuffer(src)) return src;
  if (typeof src === 'string') {
    if (!/^https?:/i.test(src)) { try { return fs.readFileSync(src); } catch (e) { return null; } }
    return getBuf(src, /myanimelist|jikan/.test(src) ? 'https://myanimelist.net/' : null);
  }
  return null;
}
// srcs: Buffer | url | path | function returning one | array of those (tried in order)
async function sendImg(sock, jid, srcs, cap, men, q) {
  var list = [].concat(srcs);
  for (var i = 0; i < list.length; i++) {
    var s = typeof list[i] === 'function' ? await list[i]() : list[i];
    var b = await toBuf(s);
    if (b) { try { return await sock.sendMessage(jid, { image: b, caption: cap || '', mentions: men || [] }, q ? { quoted: q } : {}); } catch (e) { console.log('IMG SEND FAIL', e.message); } }
  }
  return sock.sendMessage(jid, { text: cap || '', mentions: men || [] });
}
async function pfp(sock, jid) {
  try { return await Promise.race([sock.profilePictureUrl(jid, 'image'), new Promise(function (_, rej) { setTimeout(function () { rej(new Error('t')); }, 3000); })]); }
  catch (e) { return null; }
}
function menuSrc() { return [localImg('menu.jpg'), localWaifu, function () { return poolUrl('waifu'); }]; }
function animeSrc(tag) { return [function () { return poolUrl(tag || 'waifu'); }, localWaifu]; }

// ---------- character images (Jikan/MyAnimeList, cached on disk) ----------
var charImgs = {}; try { charImgs = JSON.parse(fs.readFileSync(IMG_FILE, 'utf8')); } catch (e) {}
var imgDirty = false; setInterval(function () { if (imgDirty) { imgDirty = false; try { fs.writeFileSync(IMG_FILE, JSON.stringify(charImgs)); } catch (e) {} } }, 6000).unref();
async function jikan(q) {
  var d = await fetchJSON('https://api.jikan.moe/v4/characters?limit=3&order_by=favorites&sort=desc&q=' + encodeURIComponent(q), 6000);
  var hit = d && d.data && d.data.find(function (x) { var u = x.images && x.images.jpg && x.images.jpg.image_url; return u && !/questionmark/.test(u); });
  return hit ? hit.images.jpg.image_url : null;
}
async function charImage(ch) {
  if (charImgs[ch.id]) return charImgs[ch.id];
  var u = await jikan(ch.name); if (!u && ch.first !== ch.name) u = await jikan(ch.first);
  if (u) { charImgs[ch.id] = u; imgDirty = true; }
  return u;
}
async function warm(chars) {
  ['waifu', 'neko', 'kill', 'hug', 'slap', 'kiss', 'pat'].forEach(function (t, i) { setTimeout(function () { refill(t); topup(t); }, i * 1500); });
  for (var i = 0; i < chars.length; i++) { if (!charImgs[chars[i].id]) { await charImage(chars[i]); await new Promise(function (r) { setTimeout(r, 1200); }); } }
}

// ---------- AI (Groq first, free fallback) ----------
var hist = {};
async function ai(prompt, persona, key) {
  var G = process.env.GROQ_API_KEY || ''; var h = hist[key] || (hist[key] = []);
  var sys = 'You are ' + (persona || 'Malfoy') + ', a funny sassy anime character acting as a WhatsApp bot. Reply in the language of the user, short (max 3 lines), with emojis.';
  if (G && G.indexOf('PASTE') === -1 && G.indexOf('your_') === -1) {
    try {
      var msgs = [{ role: 'system', content: sys }].concat(h.slice(-6), [{ role: 'user', content: prompt }]);
      var r = await http('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + G, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: msgs, temperature: 0.8, max_tokens: 220 }) }, 7000);
      var d = await r.json();
      if (d.choices && d.choices[0]) { var a = d.choices[0].message.content; h.push({ role: 'user', content: prompt }, { role: 'assistant', content: a }); if (h.length > 12) h.splice(0, 2); return a; }
    } catch (e) {}
  }
  var t = await fetchText('https://text.pollinations.ai/' + encodeURIComponent(sys + ' User: ' + prompt), 7000);
  return t && t.length > 1 && t.length < 1200 ? t.trim() : null;
}

// ---------- group helpers ----------
var metaCache = new Map();
async function getMeta(sock, jid, force) {
  var c = metaCache.get(jid); if (c && !force && Date.now() - c.t < 60000) return c.m;
  var m = await sock.groupMetadata(jid); metaCache.set(jid, { t: Date.now(), m: m }); return m;
}
function dropMeta(jid) { metaCache.delete(jid); }
function pids(p) { return [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean); }
async function adminInfo(sock, jid, sender, sids) {
  var meta = await getMeta(sock, jid); var admins = [];
  meta.participants.forEach(function (p) { if (p.admin) admins = admins.concat(pids(p)); });
  var botIds = [sock.user.id.split(':')[0] + '@s.whatsapp.net']; if (sock.user.lid) botIds.push(sock.user.lid.split(':')[0] + '@lid');
  var botAdmin = meta.participants.some(function (p) { return p.admin && pids(p).some(function (i) { return botIds.indexOf(i) > -1; }); });
  var mine = (sids || []).concat([sender]);
  return { meta: meta, admins: admins, botIds: botIds, botAdmin: botAdmin, senderAdmin: mine.some(function (i) { return admins.indexOf(i) > -1; }) };
}

module.exports = {
  db, save, flush, getUser, groupSet, mutedList, DATA_DIR, TMP, execF,
  rnd, pick, dur, bar, rm, tmpName, safeUrl, isYT, hash,
  http, fetchJSON, fetchText, getBuf, localImg, localWaifu, poolUrl, clip, sendImg, pfp, menuSrc, animeSrc,
  charImage, warm, ai, getMeta, dropMeta, adminInfo
};
