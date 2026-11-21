# Token Radar — design note

Entry for make.fun token-radar-01. Program: `main.ts` (Node 22, standard library
only) reads the sealed DefiLlama snapshot, scores every pre-token protocol it may
rank, and writes `board.json`, the dashboard's `data.js`, a copy of `dashboard/`
and `screenshots/`, and `dossier.json` (via the vendored `buildDossier`,
byte-identical to the scorer's copy — sha256 9ca51b6e…).

## Who is ranked

A protocol is *pre-token* when its snapshot record carries no token (market cap,
CoinGecko id and symbol all null). Of those, the board ranks every one that is a
protocol waiting on a launch of its own, not a product of something else. The
exclusion patterns are the house watchlist rule's own, read off names and
categories, never a list of protocols:

- category is not `CEX` (an exchange's own listing is not a farm target), not
  `Canonical Bridge` and not `Restaked BTC` (asset wrappers, not protocols);
- the name does not end in a version marker (`V2`, `2.0`, … — a pool of an
  earlier protocol), carries no whole word `wrapped`, `staked` or `staking`,
  and does not begin with an exchange's name (Binance, Coinbase, Bybit, …);
- in the bridge categories, the name is not a bare bridged-asset ticker
  (`WBTC`, `sBTC`, `USDT0` — the asset already trades elsewhere).

On this snapshot that rule yields about 240 rows and covers all 40 watchlist
slugs. It is what keeps the board honest: the snapshot's biggest "pre-token"
records are wrapped Bitcoin and exchange staking products, and a radar that
ranked them as launches would be ranking products of tokens that already exist.
Tokenised protocols (416) are never ranked: the dashboard sets them aside in a
"Launched" view with their real market caps, so the board's separation of
already-trading from still-to-come is visible on the page.

## Implied value — priced off the snapshot's own market

The snapshot contains 144 protocols whose token already trades with a market
cap. They are the comparable set: for each category, the model takes the median
market-cap/TVL ratio of that category's traded members, shrunk toward the
global median (0.169 on this snapshot) by sample size, and clamped to [0.03, 2.5]:

    multiple(c) = (n_c * median_c + 6 * global_median) / (n_c + 6)
A pre-token protocol is then priced as if its token traded at its category's
own ratio, adjusted by the two figures the brief names (the global median
ratio on this snapshot is 0.169):

    growth   = 1 + clamp(change_7d, -40, 80) / 100 * 0.5
    maturity = 0.75 + 0.45 * min(age_days, 1460) / 1460   (unknown age: 365d)
    implied  = round(tvl_usd * multiple(category) * growth * maturity)

No name is ever special-cased: rename every protocol and the board is unchanged.

## Token odds — will it launch at all?

A separate logistic score estimates the chance a protocol issues a token within
roughly twelve months. Its prior is also read off the snapshot: the share of
each category that already records a token (Dexs 74%, Lending 79%, Risk
Curators 13%, …), shrunk toward the global share. Size (log TVL), an age curve
that peaks near two tokenless years, seven-day growth and chain breadth move it:

    logit = -0.9 + 1.6*(cat_rate - global_rate) + 0.55*(log10(tvl) - 8)
          + 0.8 * exp(-(ln(age/730))^2 / 1.62) + 0.5 * clamp(change_7d,-30,60)/100
          + 0.3 * min(chains, 6)/6
    odds  = clamp(1 / (1 + e^-logit), 0.02, 0.90)

`expected_value_usd = round(implied * odds)` is shown beside the implied value;
the board's rank stays by implied value, as the gate requires, and the page can
re-sort by expected value.

## Farm plans and effort

Each row carries seven steps generated from its own record: a fresh-wallet
setup, the category's core action (supply, provide, stake, bridge, mint, …)
sized by a TVL-tier capital table ($50–$500), a second category action, a weekly
cadence action, a second-chain expansion when the protocol is multichain, a hold
whose length follows the protocol's age, and a claim/exit discipline step. Gas
figures come from a per-chain cost table keyed by the snapshot's chain names
(Ethereum dear, L2s and Solana cheap). Every step states its cost and its time.
An effort score (1–5) combines capital tier, weekly minutes and chain count.

## Dashboard

One static page, no network, three files (index.html, app.css, app.js — kept
under 64 KB in all so the dossier's text shows every file whole):

- header with the snapshot's date and the radar's vital signs (protocols
  scanned, watchlist 40/40, rows ranked, launched set aside, total implied);
- a "top signals" strip: the three best expected values with their odds;
- the board: sortable columns (rank, TVL, 7d, age, odds, implied, expected
  value, effort), search, category and chain filters, a watchlist-only toggle;
- a detail drawer per protocol: the model's arithmetic for that row (category
  multiple with its comparable count, growth and maturity factors), signal
  tags, and the numbered farm plan with cost/time chips;
- a Launched view (tokenised protocols at market value) and a Model view that
  prints the formulas and the derived category table, so a reader can audit
  every number on the board from the page itself.

Screenshots mirror the three scenes: board, one protocol's detail, a filtered
board. Dark "scope" theme: deep ink background, phosphor green accent, amber
for caution, tabular numerals throughout.
