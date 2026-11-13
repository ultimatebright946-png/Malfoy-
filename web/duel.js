/* Duel room client. The server decides every result; this file only shows the state and sends your move. */
(function () {
  'use strict';
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
  var NAMES = { S: 'Strike', D: 'Dash', F: 'Focus', C: 'Cast' };
  var MOVES = [
    { k: 'S', name: 'Strike', sub: '1 damage. Beats Focus (2 damage)' },
    { k: 'D', name: 'Dash', sub: 'Dodges Strike and Cast, and counters Strike' },
    { k: 'F', name: 'Focus', sub: 'Heal 1 mask. Beats Dash. Loses to Strike' },
    { k: 'C', name: 'Cast', sub: 'Costs 3 soul. 2 damage, only Dash dodges it' },
  ];

  function mount(root, o) {
    var alive = true, timer = null, tickT = null, d = null, shownFx = 0, sentRound = -1;
    var box = h('div', { class: 'duel' }); root.appendChild(box);

    function masks(n, max) { var w = h('div', { class: 'masks', role: 'img', 'aria-label': n + ' of ' + max + ' masks' }); for (var i = 0; i < max; i++) w.appendChild(h('span', { class: 'mask' + (i < n ? '' : ' empty') })); return w; }
    function soul(n, max) { var t = h('div', { class: 'soulbar', role: 'img', 'aria-label': 'Soul ' + n + ' of ' + max }); for (var i = 0; i < max; i++) t.appendChild(h('span', { class: 'orb' + (i < n ? ' on' : '') })); return t; }
    function side(p, label) {
      return h('div', { class: 'fighter' + (p.moved ? ' ready' : '') },
        p.pfp ? h('img', { class: 'fp', src: p.pfp, alt: '', width: '56', height: '56' }) : h('div', { class: 'fp ph', 'aria-hidden': 'true', text: (p.name || '?').charAt(0).toUpperCase() }),
        h('div', { class: 'fi' }, h('div', { class: 'fn', text: label + p.name }), h('div', { class: 'muted', text: 'Level ' + p.level + (p.moved ? '  ·  ready' : '') }), masks(p.hp, p.maxHp), soul(p.soul, p.maxSoul)));
    }
    function lineFor(l) {
      var t = 'Round ' + l.r + ': you ' + NAMES[l.you].toLowerCase() + (l.youAuto ? ' (too slow)' : '') + ', they ' + NAMES[l.opp].toLowerCase() + (l.oppAuto ? ' (too slow)' : '') + '. ';
      if (!l.took && !l.dealt) return t + 'No damage.';
      var bits = []; if (l.dealt) bits.push('you hit for ' + l.dealt); if (l.took) bits.push('you took ' + l.took); return t + bits.join(', ') + '.';
    }

    function draw() {
      if (!alive || !d) return;
      while (box.firstChild) box.removeChild(box.firstChild);
      var bet = d.bet ? d.bet + ' Geo bet each' : 'No bet';
      if (!d.member) {
        box.appendChild(h('section', { class: 'section' }, h('h2', { text: 'Duel with ' + d.host.name }), h('p', { class: 'muted', text: bet + '. First to lose all six masks falls.' }),
          d.canJoin ? h('button', { class: 'btn', type: 'button', text: 'Join duel', onclick: join })
            : h('p', { class: 'msg bad', text: d.status === 'waiting' ? 'This duel is for someone else.' : 'This room is closed.' })));
        return;
      }
      var head = h('header', {}, h('h2', { text: 'Duel' }), h('p', { class: 'muted', text: bet + (d.status === 'active' ? '  ·  Round ' + d.round + ' of ' + d.maxRounds : '') }));
      var sec = h('section', { class: 'section' }, head);
      if (d.status === 'waiting') {
        sec.appendChild(h('div', { class: 'wait' }, side(d.you, ''), h('p', { class: 'muted', text: 'Waiting for your opponent. Share the link the bot sent to the chat.' })));
        box.appendChild(sec); return;
      }
      if (d.status === 'expired' || d.status === 'cancelled') { sec.appendChild(h('p', { class: 'msg bad', text: 'This room closed before anyone joined.' })); box.appendChild(sec); return; }
      sec.appendChild(h('div', { class: 'ring' }, side(d.opp, ''), h('div', { class: 'vs', 'aria-hidden': 'true', text: 'vs' }), side(d.you, 'You: ')));
      if (d.status === 'active') {
        var secs = Math.ceil(d.left / 1000);
        sec.appendChild(h('p', { class: 'clock', id: 'duelclock', text: d.you.moved ? 'Waiting for your opponent... ' + secs + 's' : 'Choose your move. ' + secs + 's' }));
        var pad = h('div', { class: 'moves', role: 'group', 'aria-label': 'Moves' });
        MOVES.forEach(function (m) {
          var off = d.you.moved || (m.k === 'C' && d.you.soul < d.castCost);
          pad.appendChild(h('button', { class: 'move m' + m.k, type: 'button', disabled: off, onclick: function () { send(m.k); } }, h('b', { text: m.name }), h('small', { text: m.sub })));
        });
        sec.appendChild(pad);
      } else {
        var win = d.result === 'win', draw = d.result === 'draw';
        var res = h('div', { class: 'result ' + (win ? 'won' : draw ? 'drew' : 'lost') }, h('h3', { text: win ? 'You won the duel' : draw ? 'The duel was a draw' : 'You were defeated' }));
        if (d.reward) {
          var parts = []; if (d.reward.xp) parts.push('+' + d.reward.xp + ' XP'); if (d.reward.geo) parts.push('+' + d.reward.geo + ' Geo'); if (d.reward.bet) parts.push((d.reward.bet > 0 ? '+' : '') + d.reward.bet + ' Geo bet');
          res.appendChild(h('p', { text: parts.length ? parts.join('   ') : 'No reward this time.' }));
          if (!d.reward.counted) res.appendChild(h('p', { class: 'muted', text: 'Daily duel limit reached or same opponent too often, so no XP.' }));
        }
        res.appendChild(h('p', { class: 'muted', text: 'Challenge again from WhatsApp with .duel @friend' }));
        sec.appendChild(res);
      }
      box.appendChild(sec);
      if (d.log && d.log.length) {
        var ul = h('ul', { class: 'duellog' }); d.log.slice().reverse().forEach(function (l) { ul.appendChild(h('li', { text: lineFor(l) })); });
        box.appendChild(h('section', { class: 'section' }, h('header', {}, h('h3', { text: 'Last rounds' })), ul));
      }
      box.appendChild(h('section', { class: 'section' }, h('details', {}, h('summary', { text: 'How to fight' }),
        h('p', { class: 'muted', text: 'Both players choose at the same time. Strike beats Focus. Dash beats Strike and Cast. Focus beats Dash. Cast needs 3 soul and ignores everything except Dash. Hitting, dodging and focusing build soul. If you wait too long you Focus by default, and three slow turns lose the duel.' }))));
    }

    function apply(r) { if (!alive) return; if (r.d) { var prev = d && d.status; d = r.d; if (prev === 'active' && d.status === 'done' && o.onChange) o.onChange(); draw(); } if (r.ok === false && r.msg) o.toast(r.msg); }
    function fetchState() {
      o.api('/api/duel/' + o.id).then(function (r) {
        if (!alive) return;
        if (!r.ok) { while (box.firstChild) box.removeChild(box.firstChild); box.appendChild(h('section', { class: 'section' }, h('h2', { text: 'Duel not found' }), h('p', { class: 'muted', text: r.msg || 'This room has closed.' }))); stop(); return; }
        var changed = !d || JSON.stringify(strip(d)) !== JSON.stringify(strip(r.d)); d = r.d; d._at = Date.now();
        if (changed) draw();
        if (d.status === 'done' || d.status === 'expired' || d.status === 'cancelled') stop();
      });
    }
    function strip(x) { var c = JSON.parse(JSON.stringify(x)); delete c.left; delete c._at; return c; }
    function join() { o.api('/api/duel/' + o.id + '/join', {}).then(function (r) { apply(r); }); }
    function send(m) { o.api('/api/duel/' + o.id + '/move', { m: m }).then(function (r) { apply(r); }); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    // The countdown redraws only the clock text so buttons never flicker.
    tickT = setInterval(function () {
      var el = document.getElementById('duelclock'); if (!el || !d || d.status !== 'active') return;
      var secs = Math.max(0, Math.ceil((d.left - (Date.now() - (d._at || Date.now()))) / 1000));
      el.textContent = (d.you.moved ? 'Waiting for your opponent... ' : 'Choose your move. ') + secs + 's';
    }, 500);
    fetchState(); timer = setInterval(fetchState, 1200);
    return { destroy: function () { alive = false; stop(); clearInterval(tickT); while (root.firstChild) root.removeChild(root.firstChild); }, state: function () { return d; } };
  }
  window.MalfoyDuel = { mount: mount };
})();
