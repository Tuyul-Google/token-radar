// Northstar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail
// view with the model's own inputs and the protocol's farm plan, the live
// comparables and the method. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var state = { q: '', category: 'all', chain: 'all', sort: 'implied', tab: 'board', selected: null };
  var MODEL = DATA.model;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  // The model in one function: the page recomputes a row from the snapshot figures
  // and checks the number board.json carries, so the page's code and the board's
  // data are visibly the same arithmetic.
  function impliedOf(row) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, g));
    var eff = row.tvl_usd / (1 + MODEL.spike_discount * (Math.max(0, g) / 100));
    var cat = MODEL.category_effects[row.category === null ? 'null' : row.category];
    cat = cat === undefined ? 0 : cat;
    return Math.max(1, Math.round(Math.exp(MODEL.intercept + MODEL.slope * Math.log(eff) + cat)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- header ----
  (function header() {
    var s = document.getElementById('stats');
    var stats = [
      ['Watchlist', DATA.watchlist_size],
      ['Board rows', DATA.board_size],
      ['Early finds', DATA.early_size],
      ['Top implied', fmtUsd(DATA.rows[0].implied_value_usd)],
      ['Launched fit', DATA.model.launched_count + ' protocols'],
    ];
    stats.forEach(function (st) {
      s.appendChild(el('div', null, el('dt', { text: st[0] }), el('dd', { text: String(st[1]) })));
    });
    document.getElementById('meta').textContent =
      'Snapshot ' + DATA.as_of + ' \u00b7 Source: ' + DATA.source.split(',')[0] +
      ' \u00b7 Watchlist floor ' + fmtUsd(DATA.floor_usd) + ' TVL \u00b7 Model ' + DATA.model_version;
  })();

  // ---- model card ----
  (function modelCard() {
    var bt = DATA.backtest;
    var card = document.getElementById('model');
    var eff = Object.keys(MODEL.category_effects).filter(function (c) { return MODEL.category_effects[c] !== 0; })
      .map(function (c) { return c + ' ' + (MODEL.category_effects[c] > 0 ? '+' : '') + MODEL.category_effects[c].toFixed(2); })
      .join(', ') || 'none large enough to move';
    card.appendChild(el('h2', { text: 'The model: priced from launched protocols, not from a flat multiple' }));
    card.appendChild(el('p', { class: 'formula', text: 'log(market cap) = ' + MODEL.intercept.toFixed(2) + ' + ' + MODEL.slope.toFixed(2) + ' \u00d7 log(effective TVL) + category effect' }));
    card.appendChild(el('p', { text: 'Effective TVL discounts half of a 7-day jump: value is put on the TVL that stayed. ' +
      'Category effects that survive shrinkage: ' + eff + '. ' +
      'Age does not move the value (no link in the launched set); it sets the farm plan\u2019s hold window.' }));
    var t = el('table', null,
      el('tr', null, el('th', { text: 'Leave-one-out backtest, ' + bt.launched_count + ' launched protocols' }), el('th', { class: 'num', text: 'Northstar' }), el('th', { class: 'num', text: 'Flat multiple' })),
      el('tr', null, el('td', { text: 'Median absolute error (log10)' }), el('td', { class: 'num', text: bt.model_median_log10_error.toFixed(2) }), el('td', { class: 'num', text: bt.baseline_median_log10_error.toFixed(2) })),
      el('tr', null, el('td', { text: 'Predictions within 2\u00d7 of the real market cap' }), el('td', { class: 'num', text: bt.model_within_2x_pct.toFixed(1) + '%' }), el('td', { class: 'num', text: bt.baseline_within_2x_pct.toFixed(1) + '%' })),
      el('tr', null, el('td', { text: 'Predictions within 3\u00d7' }), el('td', { class: 'num', text: bt.model_within_3x_pct.toFixed(1) + '%' }), el('td', { class: 'num', text: bt.baseline_within_3x_pct.toFixed(1) + '%' })),
      el('tr', null, el('td', { text: 'Rank correlation (Spearman)' }), el('td', { class: 'num', text: bt.model_spearman.toFixed(2) }), el('td', { class: 'num', text: bt.baseline_spearman.toFixed(2) })));
    card.appendChild(t);
    card.appendChild(el('p', { text: 'Each launched protocol was held out in turn, the fit redone without it, and the prediction scored against its real market cap. The flat baseline is the global median multiple on raw TVL.' }));
  })();

  // ---- selects ----
  (function selects() {
    var cats = {};
    var chains = {};
    DATA.rows.forEach(function (r) {
      cats[r.category === null ? 'Uncategorised' : r.category] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    var catSel = document.getElementById('category');
    Object.keys(cats).sort().forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    var chainSel = document.getElementById('chain');
    Object.keys(chains).sort().forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
  })();

  // ---- board ----
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category === null ? 'Uncategorised' : r.category) !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = { implied: 'implied_value_usd', tvl: 'tvl_usd', growth: 'change_7d', age: 'age_days', multiple: 'implied_multiple' }[state.sort];
    rows.sort(function (a, b) {
      var av = a[key] === null || a[key] === undefined ? -Infinity : a[key];
      var bv = b[key] === null || b[key] === undefined ? -Infinity : b[key];
      return (bv - av) || (a.slug < b.slug ? -1 : 1);
    });
    return rows;
  }

  function renderBoard() {
    var rows = filteredRows();
    var table = document.getElementById('table');
    table.textContent = '';
    var head = el('tr', null,
      el('th', { class: 'num', text: '#' }),
      el('th', { text: 'Protocol' }),
      el('th', { text: 'Category' }),
      el('th', { text: 'Chains' }),
      el('th', { class: 'num', text: 'TVL' }),
      el('th', { class: 'num', text: '7d' }),
      el('th', { class: 'num', text: 'Age' }),
      el('th', { class: 'num', text: 'Implied value' }),
      el('th', { class: 'num', text: 'Multiple' }),
      el('th', { text: 'Farm' }));
    table.appendChild(el('thead', null, head));
    var body = el('tbody');
    rows.forEach(function (r) {
      var g = r.change_7d;
      var tr = el('tr', { onclick: function () { select(r.slug); }, 'class': state.selected === r.slug ? 'selected' : '' },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', { class: 'name' }, el('b', { text: r.name }), el('span', { text: r.slug })),
        el('td', null, el('span', { class: 'pill', text: r.category === null ? 'Uncategorised' : r.category })),
        el('td', { text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num' }, el('span', { class: g === null ? '' : g >= 0 ? 'up' : 'down', text: fmtPct(g) })),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
        el('td', { class: 'num', text: fmtMult(r.implied_multiple) }),
        el('td', null, el('button', { class: 'farm', text: 'Farm plan', onclick: function (ev) { ev.stopPropagation(); select(r.slug); } })));
      body.appendChild(tr);
    });
    table.appendChild(body);
    document.getElementById('count').textContent = rows.length + ' of ' + DATA.rows.length + ' protocols shown. Click a row for its detail view and farm plan.';
  }

  // ---- detail ----
  function renderDetail() {
    var host = document.getElementById('detail');
    host.textContent = '';
    if (!state.selected) return;
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === state.selected) r = x; });
    if (!r) return;
    var recomputed = impliedOf(r);
    var cat = MODEL.category_effects[r.category === null ? 'null' : r.category];
    cat = cat === undefined ? 0 : cat;
    var g = r.change_7d === null ? 0 : Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, r.change_7d));
    var eff = Math.round(r.tvl_usd / (1 + MODEL.spike_discount * (Math.max(0, g) / 100)));
    var box = el('div', { class: 'detail' },
      el('button', { class: 'close', text: 'Close', onclick: function () { select(null); } }),
      el('h2', { text: '#' + r.rank + ' \u00b7 ' + r.name }),
      el('p', { text: (r.category === null ? 'Uncategorised' : r.category) + ' \u00b7 ' + r.chains.join(', ') + ' \u00b7 tracked since ' + (r.listed_at || 'unknown') + ' \u00b7 no token yet.' }),
      el('div', { class: 'grid' },
        el('div', null, el('dt', { text: 'Implied value' }), el('dd', { text: fmtUsd(r.implied_value_usd) })),
        el('div', null, el('dt', { text: 'TVL' }), el('dd', { text: fmtUsd(r.tvl_usd) })),
        el('div', null, el('dt', { text: 'Effective TVL' }), el('dd', { text: fmtUsd(eff) })),
        el('div', null, el('dt', { text: '7-day growth' }), el('dd', { text: fmtPct(r.change_7d) })),
        el('div', null, el('dt', { text: 'Category effect' }), el('dd', { text: (cat >= 0 ? '+' : '') + cat.toFixed(2) })),
        el('div', null, el('dt', { text: 'Implied multiple' }), el('dd', { text: fmtMult(r.implied_multiple) }))),
      el('p', { class: 'check', text: 'The page recomputes the value from the row\u2019s own figures: ' + fmtUsd(recomputed) + (recomputed === r.implied_value_usd ? ' \u2014 matches the board.' : ' \u2014 differs from the board.') }),
      el('h3', { text: 'Farm plan' }),
      el('ol', null, r.farm_steps.map(function (s, i) {
        var parts = s.split(' Cost: ');
        return el('li', null, el('b', { text: 'Step ' + (i + 1) + '. ' }), document.createTextNode(parts[0] || s), parts[1] ? document.createTextNode(' Cost: ' + parts[1]) : null);
      })),
      el('h3', { text: 'Launched comparables in ' + (r.category === null ? 'this category' : r.category) }),
      el('p', { text: comparables(r.category) }));
    host.appendChild(box);
  }
  function comparables(category) {
    var same = DATA.live.filter(function (l) { return l.category === category && l.multiple !== null; });
    if (same.length === 0) return 'No launched protocol in this category carries a market cap in the snapshot, so the category effect is zero and the value follows the fitted power law alone.';
    var parts = same.slice(0, 4).map(function (l) { return l.name + ' ' + fmtMult(l.multiple); });
    return 'Launched names in this category trade at ' + parts.join(', ') + ' of TVL. The model\u2019s category effect for ' + (category === null ? 'uncategorised protocols' : category) + ' is the shrunk median of those residuals.';
  }

  // ---- live table ----
  (function live() {
    var t = document.getElementById('livetable');
    t.appendChild(el('thead', null, el('tr', null,
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { class: 'num', text: 'TVL' }),
      el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'Multiple' }), el('th', { class: 'num', text: '7d' }))));
    var body = el('tbody');
    DATA.live.forEach(function (l) {
      body.appendChild(el('tr', null,
        el('td', { class: 'name' }, el('b', { text: l.name }), el('span', { text: l.slug })),
        el('td', null, el('span', { class: 'pill', text: l.category === null ? 'Uncategorised' : l.category })),
        el('td', { class: 'num', text: fmtUsd(l.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(l.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(l.multiple) }),
        el('td', { class: 'num' }, el('span', { class: l.change_7d === null ? '' : l.change_7d >= 0 ? 'up' : 'down', text: fmtPct(l.change_7d) }))));
    });
    t.appendChild(body);
  })();

  // ---- wiring ----
  function select(slug) {
    state.selected = slug;
    renderBoard();
    renderDetail();
    if (slug) {
      var box = document.querySelector('.detail');
      if (box) box.scrollIntoView({ block: 'nearest' });
    }
  }
  function setTab(tab) {
    state.tab = tab;
    document.getElementById('view-board').hidden = tab !== 'board';
    document.getElementById('view-live').hidden = tab !== 'live';
    document.getElementById('view-method').hidden = tab !== 'method';
    document.getElementById('tab-board').setAttribute('aria-selected', String(tab === 'board'));
    document.getElementById('tab-live').setAttribute('aria-selected', String(tab === 'live'));
    document.getElementById('tab-method').setAttribute('aria-selected', String(tab === 'method'));
  }
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  document.getElementById('tab-board').addEventListener('click', function () { setTab('board'); });
  document.getElementById('tab-live').addEventListener('click', function () { setTab('live'); });
  document.getElementById('tab-method').addEventListener('click', function () { setTab('method'); });

  // Deep links for the screenshots: #detail=<slug> opens a protocol, #category=<name> filters.
  (function hash() {
    var h = window.location.hash || '';
    var m = h.match(/detail=([^&]+)/);
    if (m) state.selected = decodeURIComponent(m[1]);
    var c = h.match(/category=([^&]+)/);
    if (c) {
      state.category = decodeURIComponent(c[1]);
      var sel = document.getElementById('category');
      sel.value = state.category;
    }
  })();

  document.getElementById('board').setAttribute('aria-busy', 'false');
  renderBoard();
  renderDetail();
})();
