'use strict';
(function () {
  var view = document.getElementById('view'), who = document.getElementById('who');
  var state = { me: null, shop: null, hallBy: 'level', shopCat: 'ALL' };
  var NF = new Intl.NumberFormat();

  // ---------- helpers ----------
  function h(tag, props) {
    var e = document.createElement(tag); props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k]; if (v == null || v === false) return;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return e;
  }
  function api(path, body) {
    var o = { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } };
    if (body !== undefined) { o.method = 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(path, o).then(function (r) { return r.json().catch(function () { return { ok: false, msg: 'Something went wrong. Try again.' }; }); })
      .catch(function () { return { ok: false, msg: 'Could not reach the server. Check your connection.' }; });
  }
  var tt;
  function toast(t) { var el = document.getElementById('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(function () { el.classList.remove('on'); }, 3200); }
  function avatar(url, name, cls) {
    if (url) return h('img', { class: 'av ' + (cls || ''), src: url, alt: '', loading: 'lazy' });
    return h('span', { class: 'av ' + (cls || ''), 'aria-hidden': 'true', text: (name || '?').trim().charAt(0).toUpperCase() });
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // ---------- header ----------
  function renderWho() {
    clear(who);
    if (state.me) who.appendChild(h('a', { href: '#/me', 'aria-label': 'Your profile' }, avatar(state.me.pfp, state.me.name, 'sm')));
    if (state.me) who.appendChild(h('span', { class: 'geo', text: NF.format(state.me.coins) + ' Geo' }));
    else who.appendChild(h('a', { class: 'btn small', href: '#/', text: 'Sign in' }));
  }

  // ---------- views ----------
  var GROUP = 'https://chat.whatsapp.com/LSz4eEkKBS3FC86mCy0abL?s=cl&p=a&iam=2';
  function genderPrompt() {
    if (!state.me || state.me.genderSet) return;
    function pick(g) { api('/api/gender', { gender: g }).then(function (r) { if (r.ok) { state.me = r.me; renderWho(); toast('Saved. The bot will bring you the opposite gender in .sm'); route(); } else toast(r.msg || 'Could not save that.'); }); }
    view.appendChild(h('section', { class: 'section gender' }, h('h2', { text: 'Who are you?' }), h('p', { class: 'muted', text: 'The bot uses this to bring you a soulmate of the opposite gender when you send .sm. You can change it later on your profile.' }), h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: "I'm a guy", onclick: function () { pick('male'); } }), h('button', { class: 'btn', type: 'button', text: "I'm a girl", onclick: function () { pick('female'); } }))));
  }
  function homeView() {
    var box = h('div', { class: 'hero' });
    var left = h('div');
    left.appendChild(h('h1', { text: 'Malfoy' }));
    left.appendChild(h('p', { class: 'lede', text: 'A quest bot for WhatsApp. Explore Hallownest, grow stronger, collect gear and win over anime characters.' }));
    if (state.me) {
      left.appendChild(h('p', { text: 'Signed in as ' + state.me.name + '. You are ranked #' + NF.format(state.me.rank) + ' of ' + NF.format(state.me.players) + '.' }));
      left.appendChild(h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/me', text: 'Open your profile' }), h('a', { class: 'btn quiet', href: '#/shop', text: 'Visit the shop' })));
    } else {
      var inp = h('input', { type: 'text', id: 'code', maxlength: '12', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXXXXXX', 'aria-describedby': 'codehelp' });
      var msg = h('p', { class: 'msg', role: 'alert' });
      var btn = h('button', { class: 'btn', type: 'submit', text: 'Sign in' });
      var form = h('form', { class: 'signin', onsubmit: function (e) {
        e.preventDefault(); btn.disabled = true; msg.className = 'msg'; msg.textContent = '';
        api('/api/login', { code: inp.value }).then(function (r) {
          btn.disabled = false;
          if (!r.ok) { msg.className = 'msg bad'; msg.textContent = r.msg; return; }
          state.me = r.me; renderWho(); toast('Signed in as ' + r.me.name); var nx = null; try { nx = sessionStorage.getItem('mf_next'); sessionStorage.removeItem('mf_next'); } catch (e) {} location.hash = nx && /^#\/duel\/[a-f0-9]{8}$/.test(nx) ? nx : '#/me';
        });
      } },
        h('label', { for: 'code', text: 'Login code from the bot' }),
        h('div', { class: 'field' }, inp, btn), msg,
        h('p', { class: 'hint', id: 'codehelp', text: 'Send .weblogin to the bot in a private chat. The code works once and lasts 10 minutes.' }));
      left.appendChild(form);
    }
    left.appendChild(h('p', { class: 'hint' }, 'Join the ', h('a', { href: GROUP, target: '_blank', rel: 'noopener noreferrer', text: 'official Malfoy group' }), ' on WhatsApp.'));
    var art = h('figure', { class: 'art' }, h('img', { src: '/gallery/dementor-girl.jpg', alt: 'Illustration of a girl in a green and black robe with a hand over her mouth, labelled Dementor, Dementor', width: '736', height: '1009' }), h('figcaption', { text: 'Art by @GaVeaul' }));
    box.appendChild(left); box.appendChild(art);
    var top = h('section', { class: 'section' }, h('header', {}, h('h2', { text: 'Top hunters' }), h('p', { class: 'muted', text: 'Highest levels across every group the bot is in.' })));
    var holder = h('div'); top.appendChild(holder);
    top.appendChild(h('p', {}, h('a', { href: '#/hall', text: 'See the full leaderboard' })));
    view.appendChild(box); view.appendChild(top);
    api('/api/leaderboard?by=level').then(function (r) { fillHall(holder, (r.list || []).slice(0, 5), 'level'); });
  }

  function valueOf(p, by) { return by === 'coins' ? NF.format(p.coins) + ' Geo' : by === 'kills' ? NF.format(p.kills) + ' kills' : 'Level ' + p.level; }
  function fillHall(holder, list, by) {
    clear(holder);
    if (!list.length) { holder.appendChild(h('p', { class: 'empty', text: 'No hunters yet. Play on WhatsApp with .explore to take the first place.' })); return; }
    var ul = h('ol', { class: 'rows' });
    list.forEach(function (p) {
      var cls = 'row hallrow' + (p.rank <= 3 ? ' top' + p.rank : '') + (state.me && state.me.pid === p.pid ? ' mine' : '');
      ul.appendChild(h('li', { class: cls },
        h('span', { class: 'rk', text: String(p.rank) }), avatar(p.pfp, p.name),
        h('div', { class: 'nm' }, p.name, h('div', { class: 'sub', text: by === 'level' ? NF.format(p.xp) + ' XP' : 'Level ' + p.level })),
        h('span', { class: 'val', text: valueOf(p, by) })));
    });
    holder.appendChild(ul);
  }
  function hallView() {
    view.appendChild(h('section', { class: 'section' }, h('header', {}, h('h2', { text: 'Global leaderboard' }), h('p', { class: 'muted', text: 'Every player from every group, ranked together.' }))));
    var holder = h('div'), tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Rank by' });
    [['level', 'Level'], ['coins', 'Geo'], ['kills', 'Kills']].forEach(function (t) {
      var b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.hallBy === t[0]), text: t[1], onclick: function () { state.hallBy = t[0]; Array.prototype.forEach.call(tabs.children, function (c) { c.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); load(); } });
      tabs.appendChild(b);
    });
    view.lastChild.appendChild(tabs); view.lastChild.appendChild(holder);
    function load() { api('/api/leaderboard?by=' + state.hallBy).then(function (r) { fillHall(holder, r.list || [], state.hallBy); }); }
    load();
  }

  function shopView() {
    var sec = h('section', { class: 'section' }, h('header', {}, h('h2', { text: 'Shop' }), h('p', { class: 'muted', text: 'Gear you buy here is yours in the bot right away.' })));
    var tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Category' }), holder = h('div');
    sec.appendChild(tabs); sec.appendChild(holder); view.appendChild(sec);
    function draw() {
      clear(holder);
      var items = state.shop.items.filter(function (i) { return state.shopCat === 'ALL' || i.cat === state.shopCat; });
      var ul = h('ul', { class: 'rows' });
      items.forEach(function (it) {
        var action;
        if (it.owned) action = h('span', { class: 'owned', text: 'Owned' });
        else if (!state.me) action = h('a', { class: 'btn quiet small', href: '#/', text: 'Sign in to buy' });
        else action = h('button', { class: 'btn small', type: 'button', disabled: state.me.coins < it.price, text: 'Buy', onclick: function (e) { buy(it, e.currentTarget); } });
        ul.appendChild(h('li', { class: 'row shoprow' }, h('span', { class: 'em', 'aria-hidden': 'true', text: it.emoji }),
          h('div', {}, h('div', { class: 'nm', text: it.name }), h('div', { class: 'ds', text: it.desc })),
          h('div', { class: 'buy' }, h('span', { class: 'price', text: NF.format(it.price) + ' Geo' }), action)));
      });
      holder.appendChild(ul);
    }
    function buy(it, btn) {
      btn.disabled = true;
      api('/api/buy', { id: it.id }).then(function (r) {
        if (r.ok) { state.me.coins = r.coins; renderWho(); }
        toast(r.msg);
        loadShop(function () { draw(); });
      });
    }
    function chips() {
      clear(tabs);
      ['ALL'].concat(state.shop.cats).forEach(function (c) {
        var label = c === 'ALL' ? 'All' : c.charAt(0) + c.slice(1).toLowerCase();
        tabs.appendChild(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.shopCat === c), text: label, onclick: function () { state.shopCat = c; chips(); draw(); } }));
      });
    }
    loadShop(function () { chips(); draw(); });
  }
  function loadShop(cb) { api('/api/shop').then(function (r) { if (r.ok) { state.shop = r; if (state.me && r.coins != null) state.me.coins = r.coins; renderWho(); cb(); } }); }

  function meView() {
    var m = state.me;
    if (!m) { view.appendChild(h('section', { class: 'section' }, h('h2', { text: 'Sign in to see your profile' }), h('p', { class: 'muted', text: 'Send .weblogin to the bot in a private chat, then enter the code on the home page.' }), h('a', { class: 'btn', href: '#/', text: 'Go to sign in' }))); return; }
    var fileIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, id: 'file' });
    fileIn.addEventListener('change', function () { var f = fileIn.files[0]; if (f) upload(f); fileIn.value = ''; });
    var nameIn = h('input', { type: 'text', value: m.name, maxlength: '20', 'aria-label': 'Display name' });
    var galleryBox = h('div', { class: 'gallery', hidden: true });
    m.gallery.forEach(function (g) { galleryBox.appendChild(h('button', { type: 'button', title: g.title, 'aria-label': 'Use picture: ' + g.title, onclick: function () { send('/api/pfp/gallery', { key: g.key }, 'Picture updated'); } }, h('img', { src: g.url, alt: g.title, loading: 'lazy' }))); });
    var head = h('div', { class: 'me-head' }, avatar(m.pfp, m.name, 'lg'),
      h('div', {}, h('h2', { text: m.name }), h('p', { class: 'muted', text: 'Level ' + m.level + ', ranked #' + NF.format(m.rank) + ' of ' + NF.format(m.players) }),
        h('div', { class: 'field' }, nameIn, h('button', { class: 'btn quiet small', type: 'button', text: 'Save name', onclick: function () { send('/api/name', { name: nameIn.value }, 'Name saved'); } })),
        h('div', { class: 'actions' },
          h('button', { class: 'btn small', type: 'button', text: 'Upload photo', onclick: function () { fileIn.click(); } }),
          h('button', { class: 'btn quiet small', type: 'button', text: 'Choose from gallery', onclick: function () { galleryBox.hidden = !galleryBox.hidden; } }),
          m.pfp ? h('button', { class: 'btn quiet small', type: 'button', text: 'Remove photo', onclick: function () { send('/api/pfp/clear', {}, 'Photo removed'); } }) : null),
        galleryBox, fileIn));
    var pct = Math.floor(m.xp / m.xpNeeded * 100), fill = h('div', { class: 'bar-fill' }); fill.style.width = pct + '%';
    function row(k, v) { return h('div', {}, h('dt', { text: k }), h('dd', { text: v })); }
    var stats = h('dl', { class: 'stats' }, row('Geo', NF.format(m.coins)), row('Gems', NF.format(m.gems)), row('Charm', NF.format(m.charm)), row('Masks', m.hp + ' of ' + m.masks), row('Nail damage', String(m.damage)), row('Crit chance', m.crit + '%'), row('XP bonus', '+' + m.xpBonus + '%'), row('Kills', NF.format(m.kills)), row('Quests done', String(m.quests)), row('Bosses beaten', String(m.bosses)), row('Location', m.zone), row('Gender', m.genderSet ? m.gender : 'not set'), row('Bank', NF.format(m.bank) + ' Geo'), row('Daily streak', String(m.streak)), row('Best arena run', m.game.best + ' defeated'));
    var prog = h('section', { class: 'section' }, h('header', {}, h('h3', { text: 'Level progress' })), h('div', { class: 'bar-track', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'XP progress' }, fill), h('p', { class: 'muted', text: NF.format(m.xp) + ' of ' + NF.format(m.xpNeeded) + ' XP to level ' + (m.level + 1) }));
    view.appendChild(head); view.appendChild(prog);
    view.appendChild(h('section', { class: 'section' }, h('header', {}, h('h3', { text: 'Stats' })), stats));
    view.appendChild(h('section', { class: 'section' }, h('header', {}, h('h3', { text: 'Gender' }), h('p', { class: 'muted', text: 'Your .sm soulmates are the opposite gender.' })), h('div', { class: 'actions' },
      h('button', { class: m.gender === 'male' && m.genderSet ? 'btn small' : 'btn quiet small', type: 'button', text: 'Male', onclick: function () { send('/api/gender', { gender: 'male' }, 'Gender saved'); } }),
      h('button', { class: m.gender === 'female' && m.genderSet ? 'btn small' : 'btn quiet small', type: 'button', text: 'Female', onclick: function () { send('/api/gender', { gender: 'female' }, 'Gender saved'); } }))));
    var sm = h('section', { class: 'section' }, h('header', {}, h('h3', { text: 'Soulmate' })));
    if (m.soulmate) sm.appendChild(h('div', { class: 'soul-row' }, m.soulmate.img ? h('img', { src: m.soulmate.img, alt: m.soulmate.name, loading: 'lazy', referrerpolicy: 'no-referrer' }) : null, h('div', {}, h('div', { class: 'nm', text: m.soulmate.name }), h('div', { class: 'muted', text: m.soulmate.anime + ', bond level ' + m.soulmate.bond + ' of 10' }))));
    else sm.appendChild(h('p', { class: 'muted', text: 'No soulmate yet. Send .sm to the bot to meet one.' }));
    view.appendChild(sm);
    var dn = h('section', { class: 'section' }, h('header', {}, h('h3', { text: 'Anime DNA' })));
    if (m.dna) { var ul = h('ul', { class: 'dna' }); m.dna.forEach(function (p) { var f = h('div', { class: 'bar-fill' }); f.style.width = p.p + '%'; ul.appendChild(h('li', {}, h('span', { class: 'pc', text: p.p + '%' }), h('span', {}, p.n, ' ', h('small', { text: p.a })), h('div', { class: 'bar-track ct' }, f))); }); dn.appendChild(ul); }
    else dn.appendChild(h('p', { class: 'muted', text: 'Send .animedna to the bot to find out which characters you are made of.' }));
    view.appendChild(dn);
    view.appendChild(h('p', { class: 'section' }, h('button', { class: 'btn quiet', type: 'button', text: 'Sign out', onclick: function () { api('/api/logout', {}).then(function () { state.me = null; renderWho(); toast('Signed out'); location.hash = '#/'; }); } })));

    function send(path, body, okText) { api(path, body).then(function (r) { if (r.ok) { state.me = r.me; renderWho(); toast(okText); route(); } else toast(r.msg || 'Could not save that.'); }); }
    function upload(file) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Choose a PNG, JPG or WebP image.'); return; }
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 512;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 512, 512);
        URL.revokeObjectURL(url); send('/api/pfp', { data: c.toDataURL('image/jpeg', 0.85) }, 'Picture updated');
      };
      img.onerror = function () { URL.revokeObjectURL(url); toast('That file is not a valid image.'); };
      img.src = url;
    }
  }


  function playView() {
    var m = state.me;
    if (!m) { view.appendChild(h('section', { class: 'section' }, h('h2', { text: 'Sign in to play' }), h('p', { class: 'muted', text: 'Your rewards go to your bot profile, so sign in first. Send .weblogin to the bot to get a code.' }), h('a', { class: 'btn', href: '#/', text: 'Go to sign in' }))); return; }
    var root = h('div', { class: 'game-root' });
    view.appendChild(h('section', { class: 'section' }, h('header', {}, h('h2', { text: 'Hallownest Arena' }), h('p', { class: 'muted', text: 'A 60 second Hollow Knight run. Every enemy you defeat earns XP and Geo for your bot profile.' })), root));
    state.game = window.MalfoyGame.mount(root, {
      info: m.game,
      start: function () { return api('/api/game/start', {}).then(function (r) { if (r.ok) { state.runId = r.runId; state.me.game = r.info; } return r; }); },
      finish: function (rep) { return api('/api/game/finish', { runId: state.runId, kills: rep.kills, geo: rep.geo, survived: rep.survived }); },
      onDone: function (r) { if (r && r.ok) { state.me.coins = r.coins; state.me.level = r.level; state.me.game = r.info; renderWho(); } },
    });
  }

  function bankView() {
    var m = state.me;
    if (!m) { view.appendChild(h('section', { class: 'section' }, h('h2', { text: 'Sign in to use the bank' }), h('p', { class: 'muted', text: 'Send .weblogin to the bot to get a code.' }), h('a', { class: 'btn', href: '#/', text: 'Go to sign in' }))); return; }
    var sec = h('section', { class: 'section' }, h('header', {}, h('h2', { text: 'Bank' }), h('p', { class: 'muted', text: 'Geo in the bank is safe from your Shade and earns 1% interest every day. It is the same bank as .bank in WhatsApp.' })));
    var stats = h('dl', { class: 'stats' }), form = h('form', { class: 'actions' });
    var amt = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'Amount or all', 'aria-label': 'Amount', maxlength: '12', autocomplete: 'off' });
    var bd = h('button', { class: 'btn small', type: 'button', text: 'Deposit' }), bw = h('button', { class: 'btn quiet small', type: 'button', text: 'Withdraw' });
    form.appendChild(amt); form.appendChild(bd); form.appendChild(bw);
    function row(k, v) { return h('div', {}, h('dt', { text: k }), h('dd', { text: v })); }
    function show(i) {
      while (stats.firstChild) stats.removeChild(stats.firstChild);
      stats.appendChild(row('Wallet', NF.format(i.wallet) + ' Geo')); stats.appendChild(row('In the bank', NF.format(i.bank) + ' Geo')); stats.appendChild(row('Bank limit', NF.format(i.cap) + ' Geo')); stats.appendChild(row('Interest', i.rate + '% per day'));
      state.me.coins = i.wallet; state.me.bank = i.bank; renderWho();
    }
    function go(path) { bd.disabled = bw.disabled = true; api(path, { amount: amt.value.trim() }).then(function (r) { bd.disabled = bw.disabled = false; toast(r.msg); if (r.wallet !== undefined) show(r); if (r.ok) amt.value = ''; }); }
    bd.addEventListener('click', function () { go('/api/bank/deposit'); }); bw.addEventListener('click', function () { go('/api/bank/withdraw'); });
    form.addEventListener('submit', function (e) { e.preventDefault(); go('/api/bank/deposit'); });
    sec.appendChild(stats); sec.appendChild(form); view.appendChild(sec);
    api('/api/bank').then(function (r) { if (r.ok) show(r); });
  }

  function walletView() {
    var m = state.me;
    if (!m) { view.appendChild(h('section', { class: 'section' }, h('h2', { text: 'Sign in to see your wallet' }), h('p', { class: 'muted', text: 'Send .weblogin to the bot to get a code.' }), h('a', { class: 'btn', href: '#/', text: 'Go to sign in' }))); return; }
    var sec = h('section', { class: 'section' }, h('header', {}, h('h2', { text: 'Wallet' }), h('p', { class: 'muted', text: 'Every Geo you earn or spend, from the bot and the website.' })));
    var bal = h('p', { class: 'em', text: '' }), list = h('ul', { class: 'rows' }), form = h('form', { class: 'actions' });
    var to = h('input', { type: 'text', placeholder: 'Player ID', 'aria-label': 'Player ID', maxlength: '20', autocomplete: 'off' });
    var amt = h('input', { type: 'number', placeholder: 'Amount', 'aria-label': 'Amount', min: '1', inputmode: 'numeric' });
    form.appendChild(to); form.appendChild(amt); form.appendChild(h('button', { class: 'btn small', type: 'submit', text: 'Send Geo' }));
    var idLine = h('p', { class: 'muted', text: '' });
    function load() {
      api('/api/transactions').then(function (r) {
        if (!r.ok) { toast(r.msg || 'Could not load your wallet.'); return; }
        state.me.coins = r.coins; renderWho(); bal.textContent = NF.format(r.coins) + ' Geo'; idLine.textContent = 'Your player ID: ' + r.pid + '. Share it so friends can send you Geo.';
        clear(list);
        if (!r.list.length) list.appendChild(h('li', { class: 'row' }, h('div', { class: 'muted', text: 'No transactions yet. Play the arena or use .daily in the bot.' })));
        r.list.forEach(function (x) {
          list.appendChild(h('li', { class: 'row shoprow' }, h('div', {}, h('div', { class: 'nm', text: x.n || x.k }), h('div', { class: 'ds', text: new Date(x.t).toLocaleString() })),
            h('div', { class: 'buy' }, h('span', { class: 'price', text: x.a === 0 ? 'Bank' : (x.a > 0 ? '+' : '') + NF.format(x.a) + ' Geo' }), h('span', { class: 'muted', text: 'balance ' + NF.format(x.b) }))));
        });
      });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      api('/api/give', { to: to.value, amount: parseInt(amt.value, 10) }).then(function (r) { toast(r.msg); if (r.ok) { to.value = ''; amt.value = ''; load(); } });
    });
    sec.appendChild(bal); sec.appendChild(idLine); sec.appendChild(form); view.appendChild(sec);
    view.appendChild(h('section', { class: 'section' }, h('header', {}, h('h3', { text: 'History' })), list));
    load();
  }

  function duelView(id) {
    if (!state.me) { try { sessionStorage.setItem('mf_next', location.hash); } catch (e) {} view.appendChild(h('section', { class: 'section' }, h('h2', { text: 'Sign in to enter the duel' }), h('p', { class: 'muted', text: 'Send .weblogin to the bot and type the code on the home page. You will come straight back to this duel.' }), h('a', { class: 'btn', href: '#/', text: 'Go to sign in' }))); return; }
    var root = h('div', { class: 'duel-root' }); view.appendChild(root);
    state.game = window.MalfoyDuel.mount(root, { id: id, api: api, toast: toast, onChange: function () { api('/api/me').then(function (r) { if (r.ok) { state.me = r.me; renderWho(); } }); } });
  }
  // ---------- router ----------
  var TITLES = { bank: 'Bank - Malfoy',  duel: 'Duel - Malfoy',  home: 'Malfoy', hall: 'Leaderboard - Malfoy', shop: 'Shop - Malfoy', play: 'Arena - Malfoy', me: 'Profile - Malfoy', wallet: 'Wallet - Malfoy' };
  function route() {
    var hash = (location.hash.replace(/^#\/?/, '') || 'home'), duelId = (/^duel\/([a-f0-9]{8})$/.exec(hash) || [])[1], r = duelId ? 'duel' : hash.split('/')[0]; if (!TITLES[r]) r = 'home';
    if (state.game) { state.game.destroy(); state.game = null; }
    clear(view); document.title = TITLES[r]; genderPrompt();
    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) { if (a.getAttribute('data-r') === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    ({ home: homeView, hall: hallView, shop: shopView, play: playView, me: meView, wallet: walletView, bank: bankView, duel: function () { duelView(duelId); } })[r]();
  }
  window.addEventListener('hashchange', function () { route(); window.scrollTo(0, 0); });
  api('/api/me').then(function (r) { state.me = r.ok ? r.me : null; renderWho(); route(); });
})();
