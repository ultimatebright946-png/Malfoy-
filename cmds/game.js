'use strict';
// Quest game (Hallownest style), shop, exp, economy, casino.
const G = require('../data/game');
const rpg = require('../lib/rpg');

module.exports = function (R, core) {
  const { rnd, pick, dur, bar } = core;
  const HEAD = '╭━━『 *Malfoy* 』━━╮\n';
  const FOOT = '\n╰━━━━━━━━━━━━━━━━━\n🐍 MALFOY • OWNER BENJAMIN';

  // ---------- helpers ----------
  function currentQuest(u) { return G.QUESTS.find(function (q) { return !u.done[q.id] && u.level >= q.minLvl; }); }
  function nextLockedQuest(u) { return G.QUESTS.find(function (q) { return !u.done[q.id]; }); }
  function completeQuest(u, q, out) {
    u.done[q.id] = true;
    u.coins += q.coins; u.gems += q.gems; rpg.addXP(u, q.xp, out, true);
    let t = '✅ QUEST COMPLETE: ' + q.title + '\n   +' + q.coins + ' 🪙 +' + q.xp + ' XP +' + q.gems + ' 💎';
    if (q.item) { u.inv[q.item] = (u.inv[q.item] || 0) + 1; t += ' +1 ' + G.ITEMS[q.item].emoji + ' ' + G.ITEMS[q.item].name; }
    out.push(t);
  }
  function questHook(u, areaId, isBoss, out) {
    const q = currentQuest(u); if (!q || q.area !== areaId) return;
    if (q.type === 'kill' && !isBoss) { u.qprog[q.id] = (u.qprog[q.id] || 0) + 1; if (u.qprog[q.id] >= q.need) completeQuest(u, q, out); }
    else if (q.type === 'boss' && isBoss) completeQuest(u, q, out);
  }
  function battle(u, en, maxRounds) {
    const st = rpg.stats(u); let ph = u.hp, eh = en.hp, rounds = 0;
    while (ph > 0 && eh > 0 && rounds < maxRounds) {
      rounds++;
      const crit = Math.random() < 0.08 + st.luck / 100;
      eh -= Math.max(1, Math.round(st.atk * (0.85 + Math.random() * 0.3))) * (crit ? 2 : 1);
      if (eh <= 0) break;
      ph -= Math.max(1, Math.round(en.atk * (0.85 + Math.random() * 0.3)) - st.def);
    }
    return { win: eh <= 0, dead: ph <= 0, hp: Math.max(ph, 0), rounds: rounds };
  }
  function die(u, en) {
    const lost = Math.floor(u.coins * 0.1); u.coins -= lost; u.deaths++;
    u.hp = Math.max(1, Math.floor(rpg.stats(u).maxhp * 0.5));
    return '💀 You were slain by ' + en + '. Your shade took ' + lost + ' 🪙. You wake at the bench with half HP.';
  }
  function rewardMul(u, st) { return (1 + st.coin / 100) * (u.buff.coin > 0 ? 2 : 1); }
  function tickBuffs(u) { if (u.buff.xp > 0) u.buff.xp--; if (u.buff.coin > 0) u.buff.coin--; }
  function needEnergy(c, cost) {
    const u = c.user; rpg.refreshEnergy(u);
    if (u.energy < cost) { c.reply('⚡ Not enough energy (' + u.energy + '/' + cost + '). +1 every 45s. Use .use energydrink or .rest'); return false; }
    return true;
  }

  // ---------- account ----------
  R('Economy', ['signup', 'start'], function (c) {
    const u = c.user; if (u.registered) return c.reply('You already have an account. Use .profile');
    u.name = (c.args[0] || c.pushName).slice(0, 20); u.gender = (c.args[1] || 'male').toLowerCase(); u.age = parseInt(c.args[2]) || 18; u.registered = true;
    return c.reply('🐍 WELCOME ' + u.name + '!\nCoins: ' + u.coins + ' | Level: 1\n\nStart your quest: .quest\nExplore: .explore\nShop: .shop');
  }, 'Create your account');

  R('Economy', 'profile', async function (c) {
    const u = c.user; rpg.refreshEnergy(u); const st = rpg.stats(u);
    const src = [await core.pfp(c.sock, c.sender)].concat(core.menuSrc());
    const body = '👤 *' + u.name + '* — ' + G.rankOf(u.level) + '\n' +
      '│ ➜ Level ' + u.level + ' | XP ' + u.xp + '/' + G.xpNeed(u.level) + '\n' +
      '│ ➜ ❤️ ' + u.hp + '/' + st.maxhp + ' | ⚡ ' + u.energy + '/100\n' +
      '│ ➜ ⚔️ ATK ' + st.atk + ' | 🛡️ DEF ' + st.def + ' | 💖 CHA ' + st.cha + '\n' +
      '│ ➜ 🪙 ' + u.coins + ' | 💎 ' + u.gems + '\n' +
      '│ ➜ 📍 ' + G.AREA[u.area].name + '\n' +
      '│ ➜ Kills ' + u.kills + ' | Bosses ' + u.bossKills + ' | Deaths ' + u.deaths;
    return c.card(src, HEAD + body + FOOT, '');
  }, 'Your profile');

  R('Quest', ['stats', 'stat'], function (c) {
    const u = c.user; const st = rpg.stats(u); const g = u.gear;
    const nm = function (id) { return id ? G.ITEMS[id].emoji + ' ' + G.ITEMS[id].name : '—'; };
    return c.reply(HEAD + '⚔️ COMBAT STATS\n│ ➜ HP ' + u.hp + '/' + st.maxhp + '\n│ ➜ ATK ' + st.atk + ' | DEF ' + st.def + '\n│ ➜ Crit ' + (8 + st.luck) + '% | CHA ' + st.cha +
      '\n\n🎒 EQUIPPED\n│ ➜ Nail: ' + nm(g.nail) + '\n│ ➜ Armor: ' + nm(g.armor) + '\n│ ➜ Charm: ' + nm(g.charm) + '\n\n.shop gear to upgrade' + FOOT);
  }, 'Combat stats and equipment');

  R('Quest', ['exp', 'xp', 'level', 'lvl'], function (c) {
    const u = c.user; const st = rpg.stats(u); const need = G.xpNeed(u.level); const pct = Math.floor(u.xp / need * 100);
    const rank = Object.values(core.db.users).filter(function (x) { return x.totalXp > u.totalXp; }).length + 1;
    let bonus = '+' + st.xp + '% from gear'; if (u.buff.xp > 0) bonus += ' | x2 boost (' + u.buff.xp + ' fights left)';
    return c.reply(HEAD + '⭐ EXPERIENCE\n│ ➜ ' + u.name + ' — ' + G.rankOf(u.level) + '\n│ ➜ Level: ' + u.level +
      '\n│ ➜ XP: ' + u.xp + '/' + need + '\n│ ➜ [' + bar(pct) + '] ' + pct + '%\n│ ➜ To next level: ' + (need - u.xp) +
      '\n│ ➜ Total XP: ' + u.totalXp + '\n│ ➜ Server rank: #' + rank + '\n│ ➜ Bonus: ' + bonus + '\n\n💡 .explore .boss .quest give XP' + FOOT);
  }, 'Show your EXP and level progress');

  R('Quest', 'rank', function (c) { return c.reply('🏆 ' + c.user.name + ' — ' + G.rankOf(c.user.level) + ' Lvl ' + c.user.level + ' | ' + c.user.totalXp + ' total XP'); }, 'Your rank');

  R('Economy', ['leaderboard', 'lb', 'top', 'richest'], function (c) {
    const rich = c.cmd === 'richest';
    const arr = Object.values(core.db.users).sort(function (a, b) { return rich ? b.coins - a.coins : b.totalXp - a.totalXp; }).slice(0, 10);
    let t = HEAD + (rich ? '💰 RICHEST' : '🏆 LEADERBOARD') + '\n';
    arr.forEach(function (u, i) { t += '│ ' + (i + 1) + '. ' + u.name + ' — Lvl ' + u.level + ' — ' + u.coins + ' 🪙\n'; });
    return c.reply(t + FOOT);
  }, 'Top players');

  // ---------- world / quests ----------
  R('Quest', ['map', 'areas'], function (c) {
    const u = c.user; let t = HEAD + '🗺️ HALLOWNEST MAP\n';
    G.AREAS.forEach(function (a) {
      const lock = u.level < a.lvl ? '🔒 Lvl ' + a.lvl : (u.area === a.id ? '📍 you are here' : '✅ open');
      t += '│ ' + a.emoji + ' ' + a.name + ' (' + a.id + ') — ' + lock + (u.bosses[a.id] ? ' ☠️' : '') + '\n';
    });
    return c.reply(t + '\nTravel: .travel greenpath' + FOOT);
  }, 'World map');

  R('Quest', ['travel', 'goto'], function (c) {
    const u = c.user; const id = (c.args[0] || '').toLowerCase();
    const a = G.AREA[id] || G.AREAS.find(function (x) { return x.name.toLowerCase().indexOf(c.full.toLowerCase()) > -1 && c.full; });
    if (!a) return c.reply('Use: .travel <area>  (see .map)');
    if (u.level < a.lvl) return c.reply('🔒 ' + a.name + ' needs level ' + a.lvl);
    u.area = a.id; return c.reply(a.emoji + ' You travel to *' + a.name + '*.\nBoss: ' + a.boss.name + ' (.boss)\nFight: .explore');
  }, 'Travel to an area');

  R('Quest', ['quest', 'quests', 'q'], function (c) {
    const u = c.user;
    if (c.args[0] === 'list') {
      let t = HEAD + '📜 ALL QUESTS\n';
      G.QUESTS.forEach(function (q) { t += '│ ' + (u.done[q.id] ? '✅' : (u.level >= q.minLvl ? '🔸' : '🔒')) + ' ' + q.title + ' (Lvl ' + q.minLvl + ')\n'; });
      return c.reply(t + FOOT);
    }
    const q = currentQuest(u); const done = Object.keys(u.done).length;
    if (!q) {
      const n = nextLockedQuest(u);
      return c.reply(n ? '📜 No quest available. Reach level ' + n.minLvl + ' for "' + n.title + '". Keep exploring!' : '👑 You completed every quest. You are the Pale King!');
    }
    const a = G.AREA[q.area]; const p = u.qprog[q.id] || 0;
    return c.reply(HEAD + '📜 CURRENT QUEST (' + done + '/' + G.QUESTS.length + ')\n│ ➜ ' + q.title + '\n│ ➜ ' + q.desc + '\n│ ➜ 📍 ' + a.emoji + ' ' + a.name +
      (u.area !== a.id ? '  (.travel ' + a.id + ')' : '') + '\n│ ➜ Progress: ' + (q.type === 'boss' ? (p ? 1 : 0) + '/1' : p + '/' + q.need + ' [' + bar(p / q.need * 100) + ']') +
      '\n│ ➜ Reward: ' + q.coins + ' 🪙 ' + q.xp + ' XP ' + q.gems + ' 💎' + (q.item ? ' +' + G.ITEMS[q.item].name : '') + '\n\n.quest list — all quests' + FOOT);
  }, 'Current quest / .quest list');

  R('Quest', ['explore', 'hunt', 'fight', 'adventure'], function (c) {
    const u = c.user; const area = G.AREA[u.area]; const st = rpg.stats(u);
    if (!needEnergy(c, 4)) return;
    if (u.hp < st.maxhp * 0.2) return c.reply('❤️ HP too low (' + u.hp + '/' + st.maxhp + '). Use .rest or .use lifevial');
    u.energy -= 4;
    const en = G.enemyOf(area); const r = battle(u, en, 25);
    const out = [];
    if (r.win) {
      const m = rewardMul(u, st); const coins = Math.round(en.coins * m); const xp = rpg.addXP(u, en.xp, out);
      u.hp = r.hp; u.coins += coins; u.kills++;
      let drop = '';
      if (Math.random() < 0.05 + st.luck / 200) { u.gems++; drop = '\n💎 You found a Gem!'; }
      else if (Math.random() < 0.04 + st.luck / 200) { u.inv.lifevial = (u.inv.lifevial || 0) + 1; drop = '\n🧪 Found a Lifeblood Vial!'; }
      tickBuffs(u); questHook(u, area.id, false, out);
      return c.reply(area.emoji + ' *' + area.name + '*\n⚔️ ' + en.name + ' (HP ' + en.hp + ') defeated in ' + r.rounds + ' rounds\n❤️ ' + u.hp + '/' + st.maxhp + ' | ⚡ ' + u.energy +
        '\n+' + coins + ' 🪙 +' + xp + ' XP' + drop + (out.length ? '\n' + out.join('\n') : ''));
    }
    if (r.dead) { const t = die(u, en.name); return c.reply(area.emoji + ' ' + area.name + '\n' + t + '\nBuy gear: .shop gear'); }
    u.hp = r.hp; return c.reply('😮‍💨 ' + en.name + ' was too tough — you retreated. HP ' + u.hp + '/' + st.maxhp);
  }, 'Fight a monster in your area');

  R('Quest', 'boss', function (c) {
    const u = c.user; const area = G.AREA[u.area]; const b = area.boss; const st = rpg.stats(u);
    if (u.hp < st.maxhp * 0.6) return c.reply('❤️ Heal first! Boss fights need 60% HP (' + u.hp + '/' + st.maxhp + '). .rest or .use lifevial');
    if (!needEnergy(c, 15)) return;
    u.energy -= 15;
    const r = battle(u, { hp: b.hp, atk: b.atk }, 45); const out = [];
    if (r.win) {
      const first = !u.bosses[area.id]; const k = first ? 1 : 0.3;
      const m = rewardMul(u, st); const coins = Math.round(b.coins * k * m); const gems = first ? b.gems : 0;
      u.hp = r.hp; u.coins += coins; u.gems += gems; u.bossKills++; u.bosses[area.id] = true;
      const xp = rpg.addXP(u, Math.round(b.xp * k), out); tickBuffs(u); questHook(u, area.id, true, out);
      return c.reply('☠️ *' + b.name + '* has fallen! (' + r.rounds + ' rounds)\n❤️ ' + u.hp + '/' + st.maxhp + '\n+' + coins + ' 🪙 +' + xp + ' XP' + (gems ? ' +' + gems + ' 💎' : '') + (first ? '' : '\n(rewards reduced: already defeated)') + (out.length ? '\n' + out.join('\n') : ''));
    }
    if (r.dead) return c.reply('☠️ ' + b.name + ' (HP ' + b.hp + ', ATK ' + b.atk + ')\n' + die(u, b.name) + '\n💡 Upgrade your nail/armor: .shop gear');
    u.hp = r.hp; return c.reply('😮‍💨 ' + b.name + ' outlasted you. You escaped with ' + u.hp + ' HP. Get stronger: .shop gear');
  }, 'Fight the area boss');

  R('Quest', ['rest', 'bench'], function (c) {
    const u = c.user; const left = 120000 - (Date.now() - u.lastRest);
    if (left > 0) return c.reply('🪑 The bench is busy. Rest again in ' + dur(left));
    u.lastRest = Date.now(); u.hp = rpg.stats(u).maxhp; rpg.refreshEnergy(u); u.energy = Math.min(100, u.energy + 10);
    return c.reply('🪑 You rest at the bench.\n❤️ HP fully restored | ⚡ +10 energy');
  }, 'Rest at a bench: full HP (2 min cooldown)');

  // ---------- shop ----------
  function itemLine(it) { return '│ ' + it.emoji + ' *' + it.name + '* — ' + it.price + ' 🪙\n│    ' + it.desc + ' | .buy ' + it.id; }
  R('Economy', 'shop', function (c) {
    const u = c.user; const want = (c.args[0] || '').toLowerCase();
    const cats = G.SHOP_CATS.filter(function (x) { return !want || x[0] === want; });
    if (want && !cats.length) return c.reply('Categories: gear, potions, boosts, style, gifts');
    let body = '';
    cats.forEach(function (cat) { body += '\n┏━━━━━━━━━━━━━━━━━\n┃ ' + cat[1] + '\n┗━━━━━━━━━━━━━━━━━\n' + G.SHOP.filter(function (i) { return i.cat === cat[0]; }).map(itemLine).join('\n│\n') + '\n'; });
    body += '\n💡 .buy <id> [qty] | .inventory | .use <id> | .equip <id>\n.shop gear | potions | boosts | style | gifts';
    const hdr = HEAD + '🛒 SHOP\n│ ➜ 🪙 ' + u.coins + ' | 💎 ' + u.gems + ' | 💖 CHA ' + rpg.charisma(u) + '\n';
    return c.card(core.menuSrc(), hdr, body + FOOT);
  }, 'Buy gear, potions, boosts, style');

  R('Economy', 'buy', function (c) {
    const u = c.user; const a = c.args.slice(); let qty = 1;
    if (a.length > 1 && /^\d+$/.test(a[a.length - 1])) qty = Math.min(99, parseInt(a.pop()));
    const q = a.join(' ').toLowerCase().trim(); if (!q) return c.reply('Use: .buy <id> [qty]  (see .shop)');
    const it = G.ITEMS[q] || G.SHOP.find(function (s) { return s.name.toLowerCase().indexOf(q) > -1; });
    if (!it) return c.reply('Item not found. See .shop');
    const unique = ['nail', 'armor', 'charm', 'style'].indexOf(it.type) > -1; if (unique) qty = 1;
    if (unique && u.inv[it.id]) return c.reply('You already own ' + it.emoji + ' ' + it.name + (it.type !== 'style' ? '. Use .equip ' + it.id : ''));
    const cost = it.price * qty; if (u.coins < cost) return c.reply('Not enough coins! Need ' + cost + ', you have ' + u.coins);
    u.coins -= cost; u.inv[it.id] = (u.inv[it.id] || 0) + qty;
    let eff = it.desc;
    if (['nail', 'armor', 'charm'].indexOf(it.type) > -1) {
      const cur = G.ITEMS[u.gear[it.type]]; if (!cur || rpg.power(it) > rpg.power(cur)) { u.gear[it.type] = it.id; eff += ' — equipped!'; } else eff += ' — owned (.equip ' + it.id + ')';
    }
    if (it.type === 'style') eff += ' → Charisma now ' + rpg.charisma(u);
    if (it.type === 'gift') eff += ' (use: .use ' + it.id + ')';
    return c.reply('✅ BOUGHT ' + (qty > 1 ? qty + 'x ' : '') + it.emoji + ' ' + it.name + '\nPaid: ' + cost + ' | Left: ' + u.coins + '\n' + eff);
  }, 'Buy an item');

  R('Economy', ['inventory', 'inv', 'bag'], function (c) {
    const u = c.user; const ids = Object.keys(u.inv).filter(function (i) { return u.inv[i] > 0 && G.ITEMS[i]; });
    if (!ids.length) return c.reply('🎒 Inventory empty — .shop');
    let t = HEAD + '🎒 ' + u.name + ' INVENTORY\n';
    G.SHOP_CATS.forEach(function (cat) {
      const l = ids.filter(function (i) { return G.ITEMS[i].cat === cat[0]; }); if (!l.length) return;
      t += '\n' + cat[1] + '\n' + l.map(function (i) { const it = G.ITEMS[i]; const eq = u.gear[it.type] === i ? ' ✅' : ''; return '│ ' + it.emoji + ' ' + it.name + ' x' + u.inv[i] + eq; }).join('\n') + '\n';
    });
    return c.reply(t + '\n.use <id> | .equip <id>' + FOOT);
  }, 'Your items');

  R('Quest', 'equip', function (c) {
    const u = c.user; const it = G.ITEMS[(c.args[0] || '').toLowerCase()];
    if (!it || ['nail', 'armor', 'charm'].indexOf(it.type) === -1) return c.reply('Use: .equip <nail/armor/charm id>');
    if (!u.inv[it.id]) return c.reply("You don't own that. .shop gear");
    u.gear[it.type] = it.id; u.hp = Math.min(u.hp, rpg.stats(u).maxhp); return c.reply('✅ Equipped ' + it.emoji + ' ' + it.name + ' (' + it.desc + ')');
  }, 'Equip gear');

  function giveGift(c, it) {
    const u = c.user; const cid = u.lifelongChar; if (!cid) return c.reply('Pick your lifelong character first: .setchar yuna');
    const b = rpg.bondOf(u, cid); const g = rpg.bondGain(u, it.s.bond); b.bond += g;
    const inf = G.CINFO[cid];
    return c.reply(it.emoji + ' You gave ' + it.name + ' to ' + inf.e + ' ' + inf.n + '!\n+' + g + ' Bond (CHA bonus applied) → ' + b.bond + '\nAttraction: ' + rpg.attraction(u, b.bond) + '%');
  }
  R('Economy', ['use', 'gift'], function (c) {
    const u = c.user; const id = (c.args[0] || '').toLowerCase(); const it = G.ITEMS[id];
    if (!it) return c.reply('Use: .use <item id>  (see .inventory)');
    if (!u.inv[id]) return c.reply("You don't have that. .buy " + id);
    if (it.type === 'potion') {
      u.inv[id]--; const st = rpg.stats(u);
      if (it.s.heal) { u.hp = Math.min(st.maxhp, u.hp + it.s.heal); return c.reply('🧪 Used ' + it.name + ' → ❤️ ' + u.hp + '/' + st.maxhp); }
      rpg.refreshEnergy(u); u.energy = Math.min(100, u.energy + it.s.energy); return c.reply('🥤 Used ' + it.name + ' → ⚡ ' + u.energy + '/100');
    }
    if (it.type === 'boost') { u.inv[id]--; if (it.s.xp) u.buff.xp += it.s.xp; if (it.s.coin) u.buff.coin += it.s.coin; return c.reply('🚀 ' + it.name + ' active! XP x2 left: ' + u.buff.xp + ' | Coins x2 left: ' + u.buff.coin + ' fights'); }
    if (it.type === 'gift') { u.inv[id]--; return giveGift(c, it); }
    return c.reply(it.type === 'style' ? 'Style items work automatically (Charisma ' + rpg.charisma(u) + ').' : 'Use .equip ' + id);
  }, 'Use a potion, boost or gift');

  // ---------- income ----------
  R('Economy', ['daily'], function (c) {
    const u = c.user; const now = Date.now();
    if (now - u.lastDaily < 86400000) return c.reply('🎁 Daily already claimed. Back in ' + dur(86400000 - (now - u.lastDaily)));
    u.streak = (now - u.lastDaily < 172800000) ? u.streak + 1 : 1; u.lastDaily = now;
    const coins = 500 + Math.min(u.streak, 30) * 20; u.coins += coins; const out = []; rpg.addXP(u, 250, out, true); u.energy = 100;
    return c.reply('🎁 DAILY\n+' + coins + ' 🪙 +250 XP | ⚡ energy refilled\nStreak: ' + u.streak + ' days' + (out.length ? '\n' + out.join('\n') : ''));
  }, 'Daily reward');
  R('Economy', ['balance', 'bal', 'wallet'], function (c) { return c.reply('💰 ' + c.user.name + '\n🪙 Coins: ' + c.user.coins + '\n💎 Gems: ' + c.user.gems); }, 'Your wallet');
  R('Economy', 'work', function (c) {
    const u = c.user; const left = 3600000 - (Date.now() - u.lastWork); if (left > 0) return c.reply('⏳ Work cooldown: ' + dur(left));
    u.lastWork = Date.now(); const e = 100 + rnd(100) + u.level * 5; u.coins += e; const out = []; rpg.addXP(u, 20, out, true);
    return c.reply('🔨 You worked in Dirtmouth: +' + e + ' 🪙 +20 XP' + (out.length ? '\n' + out.join('\n') : ''));
  }, 'Work for coins (1h)');
  R('Economy', 'mine', function (c) {
    const u = c.user; if (c.args[0] === 'status' || u.mineEnds > Date.now()) return c.reply(u.mineEnds > Date.now() ? '⛏️ Mining... ' + dur(u.mineEnds - Date.now()) + ' left' : 'Not mining. Use .mine');
    if (u.mineEnds && u.mineEnds <= Date.now()) return c.reply('⛏️ Mining done! Use .collect');
    u.mineEnds = Date.now() + 1800000; return c.reply('⛏️ Mining started (30 min). Then .collect');
  }, 'Start mining (30 min)');
  R('Economy', 'collect', function (c) {
    const u = c.user; if (!u.mineEnds) return c.reply('Nothing mining. Use .mine');
    if (u.mineEnds > Date.now()) return c.reply('Not ready. ' + dur(u.mineEnds - Date.now()) + ' left');
    u.mineEnds = 0; const g = 150 + u.level * 10; u.coins += g; let t = '⛏️ COLLECTED +' + g + ' 🪙';
    if (Math.random() < 0.12) { u.gems++; t += ' +1 💎'; } return c.reply(t);
  }, 'Collect mining rewards');
  R('Economy', ['pay', 'transfer'], function (c) {
    const u = c.user; const t = c.target(); const amt = parseInt((c.full.match(/\d+/) || ['0'])[0]) || 0;
    if (!t || amt < 1) return c.reply('Use: .pay @user 500'); if (t === c.sender) return c.reply("You can't pay yourself.");
    if (u.coins < amt) return c.reply('Not enough coins'); const o = core.getUser(t, 'User'); u.coins -= amt; o.coins += amt;
    return c.reply('💸 Sent ' + amt + ' 🪙 to @' + t.split('@')[0], [t]);
  }, 'Send coins');

  // ---------- casino ----------
  function bet(c, def) {
    const b = parseInt(c.args[0]) || def; if (b < 10) { c.reply('Minimum bet is 10'); return 0; }
    if (b > 20000) { c.reply('Maximum bet is 20000'); return 0; }
    if (c.user.coins < b) { c.reply('Not enough coins'); return 0; } return b;
  }
  R('Games', 'slot', function (c) {
    const b = bet(c, 100); if (!b) return; const u = c.user; const s = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
    const r = [pick(s), pick(s), pick(s)]; let win = 0;
    if (r[0] === r[1] && r[1] === r[2]) win = b * 5; else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) win = Math.floor(b * 1.5);
    u.coins += win - b; return c.reply('🎰 ' + r.join(' ') + '\n' + (win ? 'WIN +' + (win - b) : 'Lost ' + b) + ' | 🪙 ' + u.coins);
  }, 'Slot machine');
  R('Games', 'coinflip', function (c) {
    const b = bet(c, 100); if (!b) return; const pk = (c.args[1] || 'heads').toLowerCase(); const r = Math.random() < 0.5 ? 'heads' : 'tails';
    c.user.coins += r === pk ? b : -b; return c.reply('🪙 ' + r + ' — ' + (r === pk ? 'WIN +' + b : 'LOST ' + b) + ' | 🪙 ' + c.user.coins);
  }, 'Coinflip: .coinflip 100 heads');
  R('Games', 'dice', function (c) {
    const b = bet(c, 100); if (!b) return; const p = parseInt(c.args[1]) || 1; const r = 1 + rnd(6);
    c.user.coins += r === p ? b * 5 : -b; return c.reply('🎲 ' + r + ' — ' + (r === p ? 'JACKPOT +' + (b * 5) : 'Lost ' + b) + ' | 🪙 ' + c.user.coins);
  }, 'Dice: .dice 100 4');
  R('Games', 'blackjack', function (c) {
    const b = bet(c, 100); if (!b) return; const y = 12 + rnd(10), d = 12 + rnd(10);
    const win = y <= 21 && (d > 21 || y > d); c.user.coins += win ? b : -b;
    return c.reply('🃏 You ' + y + ' vs Dealer ' + d + ' — ' + (win ? 'WIN +' + b : 'LOSE ' + b) + ' | 🪙 ' + c.user.coins);
  }, 'Blackjack-style bet');
};
