# Token Radar

![bounty](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/elangramsyah/token-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/elangramsyah/token-radar/reward.svg)

A token launch radar for the [token-radar-01](https://make.fun/bounty/token-radar-01) bounty on make.fun: a Node 22 program
(standard library only) that reads the sealed DefiLlama snapshot, ranks every
pre-token protocol by implied value, and renders a static, offline dashboard
with token odds and a farm plan for each row.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

The program writes `board.json` (the ranked board), `data.js` (the dashboard's
dataset), `dashboard/` and `screenshots/` (copied from this repository) and
`dossier.json` (built with `vendor/makefun-board.ts`, the scorer's own library)
into the output directory. Runs are deterministic: the same snapshot always
writes the same bytes.

## The model

Nothing is hand-picked and no protocol name is special-cased:

- **Implied value** prices each pre-token protocol at the median market-cap/TVL
  ratio its own category's launched tokens actually trade at (read off the
  snapshot, shrunk toward the global median), adjusted for seven-day TVL growth
  and for how long the protocol has run with no token.
- **Token odds** are a logistic score whose prior is each category's own
  tokenisation rate in the snapshot, moved by size, age, growth and chain
  breadth. Expected value = implied × odds.
- **Farm plans** are generated per protocol from its category (the actions),
  its primary chain (the gas figures), its TVL (the position size) and its age
  (the hold) — seven steps each, every one with a cost and a time.
- Wrapped, staked, exchange-branded and bridged-asset products are set aside by
  name/category patterns (the house watchlist rule's own): they are products of
  tokens that already exist, not launches. Launched protocols are shown at
  market value in the dashboard's Launched view, never ranked as farms.

See `DESIGN.md` for the full design note, and the dashboard's Model view for
the formulas and the category table derived from the snapshot.

## Layout

- `main.ts` — the program entry
- `lib/model.ts` — snapshot parsing, the value/odds model, farm plans, board checks
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`), no network
- `screenshots/` — the board, a protocol detail, and a filtered view
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte

## License

MIT — see `LICENSE`.
