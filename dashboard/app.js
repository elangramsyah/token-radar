// Token Radar's dashboard. It reads window.RADAR (the data file main.ts writes beside dashboard/)
// and renders the ranked board, a Launched view of the protocols that already trade, a Model view
// that states the scoring, and a detail drawer per protocol with its farm plan. No network: every
// byte it shows was computed by the program from the sealed snapshot.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // The value model, recomputed in the page from the row's own snapshot figures and the category
  // table data.js carries: the detail view checks this number against the one board.json holds,
  // so the page's arithmetic and the board's data are visibly the same.
  function categoryOf(name) {
    for (var i = 0; i < DATA.categories.length; i++) if (DATA.categories[i].category === name) return DATA.categories[i];
    return null;
  }
  function impliedOf(row) {
    var stat = categoryOf(row.category || 'Uncategorised');
    var multiple = stat ? stat.multiple : row.category_multiple;
    var growth = 1 + (clamp(row.change_7d === null ? 0 : row.change_7d, M.growth_floor, M.growth_cap) / 100) * M.growth_weight;
    var age = row.age_days === null ? M.unknown_age_days : row.age_days;
    var maturity = M.maturity_base + (clamp(age, 0, M.maturity_days) / M.maturity_days) * M.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * multiple * growth * maturity));
  }
  function oddsOf(row) {
    var stat = categoryOf(row.category || 'Uncategorised');
    var rate = stat ? stat.token_rate : 0.5;
    var age = clamp(row.age_days === null ? M.unknown_age_days : row.age_days, 7, 3650);
    var curve = Math.exp(-Math.pow(Math.log(age / M.odds_age_peak_days), 2) / 1.62);
    var logit = M.odds_intercept + M.odds_category_weight * (rate - DATA.global_token_rate)
      + M.odds_size_weight * (Math.log10(Math.max(row.tvl_usd, 1)) - 8)
      + M.odds_age_weight * curve
      + M.odds_growth_weight * (clamp(row.change_7d === null ? 0 : row.change_7d, -30, 60) / 100)
      + M.odds_chains_weight * (Math.min(row.chains.length, 6) / 6);
    return clamp(1 / (1 + Math.exp(-logit)), M.odds_min, M.odds_max);
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

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', r.chains.join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'odds') { av = a.odds_pct; bv = b.odds_pct; }
      else if (key === 'ev') { av = a.expected_value_usd; bv = b.expected_value_usd; }
      else if (key === 'effort') { av = a.effort.score; bv = b.effort.score; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.rank - b.rank;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'rings', 'aria-hidden': 'true' }, el('i')),
        el('div', null,
          el('div', { class: 'brand-name', text: 'TOKEN RADAR' }),
          el('div', { class: 'brand-sub', text: 'pre-token launch radar — farm what has no token yet' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version })),
        el('span', null, 'Watchlist floor ', el('b', { text: fmtUsd(DATA.floor_usd) }))
      )
    );
  }

  function lede() {
    var s = DATA.stats;
    return el('section', { class: 'lede' },
      el('h1', { text: s.ranked + ' pre-token protocols, ranked by what their token would be worth' }),
      el('p', null,
        'Every protocol in the DefiLlama index that records no token is priced by one model: its TVL, priced at the rate its own category\'s launched tokens actually trade at, adjusted for seven-day growth and for how long it has run tokenless. ',
        el('b', { text: 'Implied value is the model\'s claim, not a price' }),
        ' — and each row carries the odds the model gives a launch, what farming it costs, and the steps to do it.'
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Protocols scanned' }), el('b', { text: String(s.scanned) })),
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', null, el('em', { text: s.watchlist_size + ' / ' + s.watchlist_size }))),
        el('div', { class: 'stat' }, el('span', { text: 'Pre-token ranked' }), el('b', { text: String(s.ranked) })),
        el('div', { class: 'stat' }, el('span', { text: 'Already launched, set aside' }), el('b', { text: String(s.launched) })),
        el('div', { class: 'stat' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(s.total_implied_usd) })),
        el('div', { class: 'stat' }, el('span', { text: 'Total expected value' }), el('b', { text: fmtUsd(s.total_expected_usd) }))
      )
    );
  }

  function signals() {
    var top = DATA.rows.slice().sort(function (a, b) { return b.expected_value_usd - a.expected_value_usd; }).slice(0, 3);
    return el('section', { class: 'signals', 'aria-label': 'Top signals by expected value' },
      top.map(function (r) {
        return el('button', { class: 'signal-card', type: 'button', onclick: function () { openDetail(r.slug); } },
          el('div', { class: 'sig-head' },
            el('span', { class: 'sig-rank', text: 'SIGNAL · RANK ' + r.rank }),
            el('span', { class: 'sig-sub', text: (r.category || 'Uncategorised') })
          ),
          el('div', { class: 'sig-name', text: r.name }),
          el('div', { class: 'sig-nums' },
            el('div', null, el('span', { text: 'Implied' }), el('b', { text: fmtUsd(r.implied_value_usd) })),
            el('div', null, el('span', { text: 'Odds' }), el('b', { text: r.odds_pct.toFixed(0) + '%' })),
            el('div', null, el('span', { text: 'Expected' }), el('b', { text: fmtUsd(r.expected_value_usd) }))
          ),
          el('div', { class: 'oddsbar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.round(r.odds_pct) + '%' })),
          el('div', { class: 'sig-sub', text: r.signals[0] || 'Highest expected value on the board' })
        );
      })
    );
  }

  function controls() {
    var categories = DATA.categories.map(function (c) { return c.category; }).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).slice(0, 20);
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var wl = el('button', { class: 'toggle', type: 'button', 'aria-pressed': state.wl ? 'true' : 'false', onclick: function () { state.wl = !state.wl; writeHash(); render(); } },
      el('span', { class: 'pip', 'aria-hidden': 'true' }), 'Watchlist only');
    function tabBtn(id, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === id ? 'true' : 'false', text: label, onclick: function () { state.tab = id; writeHash(); render(); } });
    }
    var shown = state.tab === 'board' ? rows().length + ' of ' + DATA.rows.length + ' rows' : state.tab === 'launched' ? DATA.live.length + ' launched shown' : DATA.categories.length + ' categories';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Radar' }), wl),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }),
        el('div', { class: 'tabs' }, tabBtn('board', 'Board'), tabBtn('launched', 'Launched'), tabBtn('model', 'Model'))),
      el('span', { class: 'count', text: shown })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        render();
      } }, label, state.sort === key ? el('span', { class: 'arr', 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null)
    );
  }

  function dots(score) {
    var out = el('span', { class: 'dots', title: 'Effort ' + score + ' of 5' });
    for (var i = 1; i <= 5; i++) out.appendChild(el('i', { class: i <= score ? 'on' : '' }));
    return out;
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'Nothing on the radar matches' }),
        el('p', { text: 'Clear the search, or widen the category, chain and watchlist filters.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render();
        } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d;
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        class: r.rank <= 3 ? 'top3' : '',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, r.watchlist ? el('span', { class: 'wl', text: 'WATCHLIST' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'no chain listed') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (g === null ? '' : g >= 0 ? 'pos' : 'neg'), text: fmtPct(g) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'odds' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round(r.odds_pct)) + '%' })),
          el('span', { class: 'num', text: r.odds_pct.toFixed(0) + '%' })
        )),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.expected_value_usd) }),
        el('td', null, dots(r.effort.score)),
        el('td', null, el('span', { class: 'status', text: 'no token on record' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols ranked by implied value. Odds are the model\'s chance of a token within about a year; expected value is implied × odds. Select any row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', '#'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Odds'),
            sortHeader('implied', 'Implied value'),
            sortHeader('ev', 'Expected'),
            sortHeader('effort', 'Effort'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains.length ? r.chains.slice(0, 3).join(', ') : 'no chain listed') })
        )),
        el('td', { class: 'num', text: r.symbol || '—' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Already launched: these protocols\' tokens trade, so their market cap is a fact, not a model. They are the comparable set the board\'s category multiples are read from — and they are never ranked as farms.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Symbol' }),
            el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelView() {
    var tbody = el('tbody');
    DATA.categories.forEach(function (c) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.comps) }),
        el('td', { class: 'num', text: c.median_ratio.toFixed(3) + '×' }),
        el('td', { class: 'num', text: c.multiple.toFixed(3) + '×' }),
        el('td', { class: 'num', text: Math.round(c.token_rate * 100) + '%' }),
        el('td', { class: 'num', text: String(c.pre_token) }),
        el('td', { class: 'num', text: String(c.tokenised) })
      ));
    });
    return el('div', { class: 'modelwrap' },
      el('section', { class: 'modelcard' },
        el('h2', { text: 'How the radar prices a protocol with no token' }),
        el('p', null,
          'The snapshot\'s launched protocols are the comparable set. For each category the model takes the ',
          el('b', { text: 'median market-cap / TVL ratio of that category\'s traded members' }),
          ' — the global median is ' + DATA.global_median_ratio.toFixed(3) + '× — shrinks it toward that global median by sample size, and prices every pre-token protocol at its own category\'s rate. No protocol name is read anywhere in the model: rename every protocol and the board is unchanged.'
        ),
        el('div', { class: 'formula' },
          el('span', { class: 'k', text: 'multiple' }), ' = (n × category median + ' + M.shrink_k + ' × global median) / (n + ' + M.shrink_k + '), clamped to [' + M.multiple_min + ', ' + M.multiple_max + ']', el('br'),
          el('span', { class: 'k', text: 'implied' }), ' = round( tvl × multiple × (1 + clamp(7d growth, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 × ' + M.growth_weight + ') × (' + M.maturity_base + ' + min(age, ' + M.maturity_days + 'd) / ' + M.maturity_days + ' × ' + M.maturity_range + ') )'
        ),
        el('p', null,
          el('b', { text: 'Token odds' }),
          ' are a logistic score on top of that: the prior is each category\'s own tokenisation rate in the snapshot (' + Math.round(DATA.global_token_rate * 100) + '% of all protocols already record a token), moved by size, an age curve that peaks near two tokenless years, seven-day growth and chain breadth. ',
          el('b', { text: 'Expected value = implied × odds' }),
          '; the board\'s rank is by implied value, and the page can re-sort by expected value.'
        ),
        el('ul', null,
          el('li', null, el('b', { text: 'Coverage. ' }), 'Every watchlist slug is ranked; the watchlist is the floor, and the radar adds every other rankable pre-token protocol it finds — ' + (DATA.stats.ranked - DATA.stats.watchlist_size) + ' of them here.'),
          el('li', null, el('b', { text: 'Set aside, not ranked. ' }), 'Exchange listings and exchange-branded products, canonical-bridge and restaked-BTC wrappers, bridged assets wearing a ticker for a name, versioned pools of an earlier protocol, and anything whose name says wrapped, staked or staking: products of a token that exists, not launches of their own. The biggest pre-token records in the snapshot are exactly those — wrapped Bitcoin and exchange staking products — and the radar refuses to call them launches.'),
          el('li', null, el('b', { text: 'Honest wording. ' }), 'The snapshot says a protocol records no token; it cannot prove it has none. A row may still have a token its record does not carry.')
        )
      ),
      el('div', { class: 'panel' },
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('caption', { text: 'The category table the model derived from this snapshot: traded comparables, their median ratio, the shrunk multiple each pre-token protocol is priced at, and how often the category has tokenised.' }),
            el('thead', null, el('tr', null,
              el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Traded comps' }),
              el('th', { scope: 'col', text: 'Median mcap/TVL' }), el('th', { scope: 'col', text: 'Multiple used' }),
              el('th', { scope: 'col', text: 'Tokenised share' }), el('th', { scope: 'col', text: 'Pre-token' }),
              el('th', { scope: 'col', text: 'Launched' })
            )),
            tbody
          )
        )
      )
    );
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Implied value is this entry\'s own model claim, never a price or a promise; a protocol\'s record staying as it is, is the question the board answers. Farm plans are starting points — check the protocol\'s own pages before committing funds, and never pay anyone to unlock a claim.' }),
      el('p', { text: 'Data: ' + DATA.source + '. Board computed by the ' + DATA.model_version + ' model from that snapshot alone; this page made no network calls.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function stepItem(s) {
    var at = s.indexOf(' Cost: ');
    var action = at >= 0 ? s.slice(0, at) : s;
    var tail = at >= 0 ? s.slice(at + 1) : '';
    return el('li', null, el('div', null, el('b', { text: action }), tail ? el('span', { class: 'costline', text: tail }) : null));
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    render();
    var recomputed = impliedOf(row);
    var odds = oddsOf(row);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sig-rank', text: 'RANK ' + row.rank + ' OF ' + DATA.stats.ranked + (row.watchlist ? ' · WATCHLIST' : ' · EARLY RADAR') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains.length ? row.chains.join(', ') : 'no chain listed') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('div', { class: 'bignums' },
      el('div', { class: 'bignum' }, el('span', { text: 'Implied value' }), el('b', { class: 'green', text: fmtUsd(row.implied_value_usd) })),
      el('div', { class: 'bignum' }, el('span', { text: 'Token odds' }), el('b', { class: 'blue', text: row.odds_pct.toFixed(0) + '%' })),
      el('div', { class: 'bignum' }, el('span', { text: 'Expected value' }), el('b', { text: fmtUsd(row.expected_value_usd) }))
    ));
    if (row.signals.length) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Why it is on the radar' }),
        el('div', { class: 'chips' }, row.signals.map(function (s, i) { return el('span', { class: 'chip' + (i === 0 ? ' hot' : ''), text: s }); }))
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The model\'s arithmetic' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'Uncategorised') + ', ' + (row.model.comps === 1 ? '1 traded comp' : row.model.comps + ' traded comps') + ')' }), el('b', { text: row.category_multiple.toFixed(3) + '×' })),
        el('div', null, el('span', { text: 'Seven-day growth ' + fmtPct(row.change_7d) + ' → factor' }), el('b', { text: row.model.growth_factor.toFixed(3) + '×' })),
        el('div', null, el('span', { text: 'Age with no token ' + fmtAge(row.age_days) + ' → maturity' }), el('b', { text: row.model.maturity_factor.toFixed(3) + '×' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'This page recomputes the row from the same figures as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board, so the data would be stale.') + ' Odds recomputed here: ' + (odds * 100).toFixed(0) + '%. An estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('div', { class: 'effortline' },
        el('span', null, 'Capital ', el('b', { text: fmtUsd(row.effort.capital_usd) })),
        el('span', null, 'Weekly ', el('b', { text: row.effort.weekly_minutes + ' min' })),
        el('span', null, 'Hold ', el('b', { text: row.effort.hold_days + ' days' })),
        el('span', null, 'Effort ', el('b', { text: row.effort.score + ' / 5' }))
      ),
      el('ol', { class: 'steps' }, row.farm_steps.map(stepItem))
    ));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function render() {
    var keepDialog = state.selected;
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'board') {
      shell.appendChild(signals());
      shell.appendChild(controls());
      shell.appendChild(boardTable());
    } else if (state.tab === 'launched') {
      shell.appendChild(controls());
      shell.appendChild(liveTable());
    } else {
      shell.appendChild(controls());
      shell.appendChild(modelView());
    }
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    state.selected = keepDialog;
  }

  readHash();
  render();
  if (state.selected) openDetail(state.selected);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
