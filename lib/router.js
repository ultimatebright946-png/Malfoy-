'use strict';
const core = require('./core');
const { cmds } = require('./registry');

const PREFIX = process.env.PREFIX || '.';
const OWNER = (process.env.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
const seen = new Set();

function ctxInfo(m) {
  try { for (const k in m.message) { const v = m.message[k]; if (v && typeof v === 'object' && v.contextInfo) return v.contextInfo; } } catch (e) {}
  return null;
}
function getText(m) {
  const x = m.message;
  return x.conversation || (x.extendedTextMessage && x.extendedTextMessage.text) ||
    (x.imageMessage && x.imageMessage.caption) || (x.videoMessage && x.videoMessage.caption) || '';
}

async function handle(sock, msg, env) {
  if (!msg || !msg.message || !msg.key) return;
  if (msg.key.fromMe && process.env.ALLOW_SELF !== 'true') return;
  if (seen.has(msg.key.id)) return; seen.add(msg.key.id); if (seen.size > 800) seen.clear();
  try { if (env.normalize) msg.message = env.normalize(msg.message) || msg.message; } catch (e) {}
  if (!msg.message) return;

  const jid = msg.key.remoteJid;
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
  const isGroup = jid.endsWith('@g.us');
  const sids = [msg.key.participant, msg.key.participantAlt, msg.key.participantPn].filter(Boolean);
  let sender;
  if (msg.key.fromMe) sender = sock.user.id.split(':')[0] + '@s.whatsapp.net';
  else if (isGroup) sender = sids.find(function (i) { return i.endsWith('@s.whatsapp.net'); }) || sids[0] || jid;
  else sender = (msg.key.remoteJidAlt && msg.key.remoteJidAlt.endsWith('@s.whatsapp.net')) ? msg.key.remoteJidAlt : jid;

  const text = getText(msg).trim();
  if (!text) return;
  const user = core.getUser(sender, msg.pushName);
  if (user.banned) return;

  // muted users get their messages removed
  if (isGroup && core.mutedList(jid).indexOf(sender) > -1) {
    try { await sock.sendMessage(jid, { delete: msg.key }); } catch (e) {} return;
  }
  // anti-link
  if (isGroup && core.groupSet(jid).antilink && /(chat\.whatsapp\.com\/|https?:\/\/)/i.test(text)) {
    try {
      const a = await core.adminInfo(sock, jid, sender, sids);
      if (!a.senderAdmin && a.botAdmin) {
        await sock.sendMessage(jid, { delete: msg.key });
        return sock.sendMessage(jid, { text: '🔗 @' + sender.split('@')[0] + ' links are not allowed here.', mentions: [sender] });
      }
    } catch (e) {}
  }

  const ci = ctxInfo(msg);
  const mentions = (ci && ci.mentionedJid) || [];
  const reply = function (t, m) {
    return sock.sendMessage(jid, { text: t, mentions: m || [] }).catch(function (e) { console.log('REPLY FAIL', e.message); });
  };

  // "malfoy hello" without prefix -> AI chat
  const lower = text.toLowerCase();
  if (text.indexOf(PREFIX) !== 0) {
    if (lower === 'malfoy' || lower.indexOf('malfoy ') === 0) {
      const a = await core.ai(text.slice(6).trim() || 'hi', 'Malfoy', sender + ':malfoy');
      return reply(a ? '🐍 Malfoy: ' + a : '🐍 Malfoy: Hey hey! You came!');
    }
    return;
  }

  const parts = text.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (parts.shift() || '').toLowerCase();
  if (!cmd) return;
  const e = cmds.get(cmd);
  if (!e) { if (!isGroup) return reply('Unknown: ' + PREFIX + cmd + '\nType ' + PREFIX + 'menu'); return; }

  const isOwner = !!msg.key.fromMe || (OWNER && sender.split('@')[0] === OWNER) || sids.some(function (i) { return OWNER && i.split('@')[0] === OWNER; });
  const c = {
    sock, msg, jid, sender, sids, isGroup, user, cmd, args: parts, full: parts.join(' '),
    pushName: msg.pushName || user.name || 'User', mentions, ci, isOwner, dl: env.dl, PREFIX,
    reply: reply,
    // image + text in as few messages as possible (captions longer than ~900 chars are split)
    card: async function (src, header, body, men) {
      men = men || [];
      const all = header + (body ? '\n' + body : '');
      if (all.length <= 900) return core.sendImg(sock, jid, src, all, men);
      await core.sendImg(sock, jid, src, header, men);
      return sock.sendMessage(jid, { text: body, mentions: men });
    },
    target: function () { return mentions[0] || (ci && ci.participant) || null; },
    quoted: function () { return ci && ci.quotedMessage ? ci.quotedMessage : null; },
    admin: async function (needBot) {
      if (!isGroup) return { ok: false, reason: 'Only in groups' };
      let a;
      try { a = await core.adminInfo(sock, jid, sender, sids); } catch (er) { return { ok: false, reason: 'No group info' }; }
      if (!a.senderAdmin && !isOwner) { a.ok = false; a.reason = 'Only admins can use this'; return a; }
      if (needBot && !a.botAdmin) { a.ok = false; a.reason = 'Make Malfoy ADMIN first'; return a; }
      a.ok = true; return a;
    }
  };
  try { await e.fn(c); core.save(); }
  catch (er) { console.log('CMD ERROR', cmd, er && er.stack || er); reply('Oops, error in .' + cmd + ' but Malfoy is alive. Try again.'); }
}

module.exports = { handle, PREFIX };
