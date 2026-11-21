// The token radar's model: one sealed snapshot in, one ranked board out.
//
// Nothing on the board is hand-picked and no protocol name is ever special-cased. Two numbers are
// derived for every pre-token protocol, and both are read off the snapshot itself:
//
//   Implied value. The snapshot's traded protocols are the comparable set. For each category the
//   model takes the median market-cap/TVL ratio of that category's traded members, shrunk toward
//   the global median by sample size, and prices a pre-token protocol as if its token traded at
//   its own category's ratio — adjusted by its seven-day TVL growth and by how long it has run
//   with no token (maturity).
//
//   Token odds. A logistic score for "issues a token within roughly a year". Its prior is the
//   snapshot's own tokenisation rate per category (the share that already records a token),
//   moved by size, an age curve that peaks near two tokenless years, growth and chain breadth.
//
// Farm plans and effort signals are generated from the same record: the category picks the
// actions, the primary chain picks the gas figures, the TVL picks the position size and the
// age picks the hold. Rename every protocol in the snapshot and the board is unchanged.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard's Model view so a reader can audit every row. */
export interface ModelConstants {
  shrink_k: number;
  multiple_min: number;
  multiple_max: number;
  growth_floor: number;
  growth_cap: number;
  growth_weight: number;
  maturity_base: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  odds_intercept: number;
  odds_category_weight: number;
  odds_size_weight: number;
  odds_age_weight: number;
  odds_age_peak_days: number;
  odds_growth_weight: number;
  odds_chains_weight: number;
  odds_min: number;
  odds_max: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 6,
  multiple_min: 0.03,
  multiple_max: 2.5,
  growth_floor: -40,
  growth_cap: 80,
  growth_weight: 0.5,
  maturity_base: 0.75,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  odds_intercept: -0.9,
  odds_category_weight: 1.6,
  odds_size_weight: 0.55,
  odds_age_weight: 0.8,
  odds_age_peak_days: 730,
  odds_growth_weight: 0.5,
  odds_chains_weight: 0.3,
  odds_min: 0.02,
  odds_max: 0.9,
};

/** The model's version label, printed on the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** How many launched protocols the dashboard's Launched view carries, by market cap. */
export const LIVE_ROWS = 48;

/** One category's derived statistics: its traded comparables and its tokenisation rate. */
export interface CategoryStat {
  category: string;
  comps: number;
  median_ratio: number;
  multiple: number;
  token_rate: number;
  pre_token: number;
  tokenised: number;
}

/** A farm plan's effort signals, all derived from the protocol's own record. */
export interface Effort {
  capital_usd: number;
  weekly_minutes: number;
  hold_days: number;
  score: number;
}

/** One row of board.json: the ranked board's row, with the model's working shown. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  watchlist: boolean;
  implied_value_usd: number;
  odds_pct: number;
  expected_value_usd: number;
  category_multiple: number;
  model: {
    comps: number;
    growth_factor: number;
    maturity_factor: number;
    category_token_rate: number;
  };
  effort: Effort;
  signals: string[];
  farm_steps: string[];
}

/** The dashboard's view of one board row: the board row's fields, as written. */
export type RadarRow = BoardRow;

/** A launched protocol: it already trades, so the page shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The board's headline figures. */
export interface RadarStats {
  scanned: number;
  pre_token: number;
  ranked: number;
  watchlist_size: number;
  launched: number;
  total_implied_usd: number;
  total_expected_usd: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_median_ratio: number;
  global_token_rate: number;
  stats: RadarStats;
  categories: CategoryStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when the date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The exchanges the house's watchlist rule names: a name that begins with one is that exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word that marks a product of an asset that already exists, never a launch of its own. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** A bare bridged-asset ticker (WBTC, sBTC, USDT0): no space, a short run of capitals and digits. */
const ASSET_TICKER = /^[a-z]{0,2}[A-Z][A-Z0-9]{1,6}$/;

/**
 * Whether a protocol is one the board may rank: pre-token, and a protocol waiting on a launch of
 * its own — not an exchange listing or an exchange's own product, not a canonical bridge's or a
 * restaked-BTC wrapper, not a bridged asset wearing a ticker for a name, not a versioned pool of
 * an earlier protocol, and not a product whose name says wrapped, staked or staking. The patterns
 * are the house watchlist rule's own, read off names and categories, never a list of protocols.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX' || p.category === 'Canonical Bridge' || p.category === 'Restaked BTC') return false;
  if (VERSIONED.test(p.name) || PRODUCT_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  if ((p.category === 'Bridge' || p.category === 'Cross Chain Bridge') && !p.name.includes(' ') && ASSET_TICKER.test(p.name)) return false;
  return true;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Every category's derived statistics, from the snapshot alone: the traded comparables' median
 * market-cap/TVL ratio (each ratio clamped so one misprint cannot move a category), shrunk toward
 * the global median, and the category's tokenisation rate, shrunk toward the global rate.
 */
export function categoryStats(snapshot: Snapshot, model: ModelConstants = MODEL): { stats: Map<string, CategoryStat>; globalMedian: number; globalRate: number } {
  const ratios = new Map<string, number[]>();
  const counts = new Map<string, { pre: number; tok: number }>();
  const allRatios: number[] = [];
  let pre = 0;
  let tok = 0;
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Uncategorised';
    const c = counts.get(key) ?? { pre: 0, tok: 0 };
    if (isPreToken(p)) {
      c.pre++;
      pre++;
    } else {
      c.tok++;
      tok++;
      if (p.mcap_usd !== null && p.tvl_usd > 0) {
        const ratio = clamp(p.mcap_usd / p.tvl_usd, 0.005, 20);
        const list = ratios.get(key) ?? [];
        list.push(ratio);
        ratios.set(key, list);
        allRatios.push(ratio);
      }
    }
    counts.set(key, c);
  }
  const globalMedian = allRatios.length > 0 ? median(allRatios) : 0.2;
  const globalRate = pre + tok > 0 ? tok / (pre + tok) : 0.5;
  const stats = new Map<string, CategoryStat>();
  for (const [category, c] of counts) {
    const comps = ratios.get(category) ?? [];
    const med = comps.length > 0 ? median(comps) : globalMedian;
    const multiple = clamp((comps.length * med + model.shrink_k * globalMedian) / (comps.length + model.shrink_k), model.multiple_min, model.multiple_max);
    const tokenRate = (c.tok + 10 * globalRate) / (c.pre + c.tok + 10);
    stats.set(category, {
      category,
      comps: comps.length,
      median_ratio: round4(med),
      multiple: round4(multiple),
      token_rate: round4(tokenRate),
      pre_token: c.pre,
      tokenised: c.tok,
    });
  }
  return { stats, globalMedian, globalRate };
}

/** A scored protocol: its implied value, its odds, and the model's working for both. */
export interface Scored {
  implied: number;
  odds: number;
  growthFactor: number;
  maturityFactor: number;
  age: number | null;
}

/** Score one pre-token protocol from its own record and its category's derived statistics. */
export function score(p: SnapshotProtocol, asOf: string, stat: CategoryStat, globalRate: number, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const growthPct = clamp(p.change_7d ?? 0, model.growth_floor, model.growth_cap);
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const maturityFactor = model.maturity_base + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * stat.multiple * growthFactor * maturityFactor));

  const ageClamped = clamp(ageForModel, 7, 3650);
  const ageCurve = Math.exp(-(Math.log(ageClamped / model.odds_age_peak_days) ** 2) / 1.62);
  const logit =
    model.odds_intercept +
    model.odds_category_weight * (stat.token_rate - globalRate) +
    model.odds_size_weight * (Math.log10(Math.max(p.tvl_usd, 1)) - 8) +
    model.odds_age_weight * ageCurve +
    model.odds_growth_weight * (clamp(p.change_7d ?? 0, -30, 60) / 100) +
    model.odds_chains_weight * (Math.min(p.chains.length, 6) / 6);
  const odds = clamp(1 / (1 + Math.exp(-logit)), model.odds_min, model.odds_max);
  return { implied, odds, growthFactor, maturityFactor, age };
}

// ---------------------------------------------------------------- farm plans

/** One action's gas cost on a chain, in dollars: the snapshot's chain names price the plan. */
const CHAIN_GAS: Record<string, number> = {
  Ethereum: 12, Solana: 0.05, Base: 0.25, Arbitrum: 0.35, Optimism: 0.4, Polygon: 0.05,
  Binance: 0.6, Avalanche: 0.5, Sui: 0.1, Tron: 1.2, Linea: 0.3, Mantle: 0.2, Sonic: 0.1,
  Fantom: 0.1, 'Hyperliquid L1': 0.05, Monad: 0.1, Plasma: 0.1, Bitcoin: 4, Ripple: 0.1,
};

function gasFor(chain: string): number {
  return CHAIN_GAS[chain] ?? 1.5;
}

function money(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2).replace(/\.?0+$/, '')}`;
}

/** The position size one farm position carries, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 300;
  if (tvl >= 250_000_000) return 200;
  if (tvl >= 50_000_000) return 120;
  if (tvl >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: a younger protocol needs a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category family's core and second actions, in words a farmer can follow. */
function actionsFor(category: string | null, name: string, chain: string, capital: number): { core: string; second: string; weekly: string; minutes: number } {
  const c = (category ?? '').toLowerCase();
  const usd = `$${capital}`;
  if (c.includes('uncollateralized')) return {
    core: `Supply ${usd} of USDC to one of ${name}'s credit pools on ${chain} after reading the pool's borrower and its terms.`,
    second: `Split the position across two ${name} pools so one borrower cannot strand the whole farm.`,
    weekly: `Check the pool's repayment status and the protocol's credit updates.`, minutes: 10 };
  if (c.includes('lend')) return {
    core: `Supply ${usd} of USDC to ${name} on ${chain} and leave the supplied balance untouched.`,
    second: `Borrow a small amount against the position and repay it, so the wallet shows both sides of the market.`,
    weekly: `Add or move a small amount so the position is active in a fresh week.`, minutes: 10 };
  if (c.includes('cdp')) return {
    core: `Deposit ${usd} of collateral into ${name} on ${chain} and mint a modest amount of its stablecoin against it.`,
    second: `Repay part of the minted debt and mint again, keeping the collateral ratio comfortably safe.`,
    weekly: `Check the collateral ratio and top up if the market moved against the position.`, minutes: 10 };
  if (c.includes('dex')) return {
    core: `Provide ${usd} of liquidity to ${name}'s most traded pool on ${chain} and keep the position open.`,
    second: `Make several swaps through ${name} across different days, in sizes a real user would trade.`,
    weekly: `Swap or rebalance the pool position once so the week shows genuine activity.`, minutes: 15 };
  if (c.includes('deriv') || c.includes('option') || c.includes('synthetic')) return {
    core: `Deposit ${usd} of USDC as margin on ${name} and open one small, hedged position.`,
    second: `Close the position and open another on a different market, so the wallet is not a one-trade account.`,
    weekly: `Trade once a week in small size; volume, not profit, is what a points program counts.`, minutes: 15 };
  if (c.includes('bridge')) return {
    core: `Bridge ${usd} of USDC from Ethereum to ${chain === 'Ethereum' ? 'a chain ' + name + ' serves' : chain} through ${name}, then use the bridged funds in an app on that chain.`,
    second: `Bridge a smaller amount back a week later, so the wallet shows two-way use rather than a single hop.`,
    weekly: `Make one small bridge transfer so each week adds a genuine crossing.`, minutes: 10 };
  if (c.includes('restak')) return {
    core: `Restake ${usd} of a liquid staking token through ${name} on ${chain} and keep the receipt token.`,
    second: `Claim any restaking rewards and restake them, so the position compounds on the record.`,
    weekly: `Check the operator set and the position's rewards once a week.`, minutes: 5 };
  if (c.includes('staking')) return {
    core: `Stake ${usd} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt.`,
    second: `Use the receipt token in one other protocol the dashboard ranks, so both farms share one position.`,
    weekly: `Claim and restake any staking rewards so the position stays active.`, minutes: 5 };
  if (c.includes('curator') || c.includes('allocator') || c.includes('collateral')) return {
    core: `Deposit ${usd} into one of ${name}'s vaults on ${chain}, choosing the vault whose curator and strategy you can explain.`,
    second: `Move a small part of the position to a second ${name} vault so the wallet is not tied to one strategy.`,
    weekly: `Read the vault's weekly update and check its reported yield against its risk.`, minutes: 10 };
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity manager') || c.includes('basis')) return {
    core: `Deposit ${usd} into ${name}'s main vault or pool on ${chain} and keep the shares it issues.`,
    second: `Harvest the yield once and redeposit it, so the wallet shows a full cycle of use.`,
    weekly: `Harvest or rebalance once a week and note the yield the position actually paid.`, minutes: 10 };
  if (c.includes('rwa')) return {
    core: `Mint ${usd} of ${name}'s yield-bearing asset on ${chain} after completing any eligibility check it asks for.`,
    second: `Hold the asset through one full yield period and claim the distribution it pays.`,
    weekly: `Check the asset's reported backing and yield once a week.`, minutes: 5 };
  if (c.includes('stable') || c.includes('reserve currency')) return {
    core: `Mint or deposit ${usd} of the stable asset through ${name} on ${chain} and hold it in the farm wallet.`,
    second: `Use the stable asset in one lending or pool position so it works while it waits.`,
    weekly: `Check the peg and the protocol's reserve report once a week.`, minutes: 5 };
  if (c.includes('chain')) return {
    core: `Bridge ${usd} to ${name}'s chain and make real transactions there: swaps, a name or NFT mint, and its native apps.`,
    second: `Use two or three of the chain's own applications so the wallet looks like a resident, not a passer-by.`,
    weekly: `Transact on the chain once a week; consistency is what early-chain programs reward.`, minutes: 15 };
  if (c.includes('index')) return {
    core: `Buy ${usd} of a ${name} index token on ${chain} and hold it in the farm wallet.`,
    second: `Add a second, smaller index so the wallet shows more than one product in use.`,
    weekly: `Check the index composition and rebalance notices once a week.`, minutes: 5 };
  if (c.includes('insurance')) return {
    core: `Buy ${usd} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy.`,
    second: `Stake a small amount in ${name}'s capital pool if it offers one, on the other side of the market.`,
    weekly: `Check the policy and the pool's capacity once a week.`, minutes: 5 };
  if (c.includes('prediction')) return {
    core: `Fund ${usd} on ${name} and take positions in several markets you have a view on.`,
    second: `Trade out of one position before it settles, so the wallet shows two-way activity.`,
    weekly: `Trade in one or two markets a week; settled volume is what these programs count.`, minutes: 15 };
  if (c.includes('launchpad')) return {
    core: `Complete ${name}'s participation steps on ${chain} and take a small allocation in one launch.`,
    second: `Hold the launched token rather than selling at once, and join the project's own channels.`,
    weekly: `Check for new launches and their participation windows once a week.`, minutes: 10 };
  if (c.includes('payment') || c.includes('card')) return {
    core: `Open a ${name} account, fund ${usd}, and route one real payment or card spend through it.`,
    second: `Hold a balance in the account across a statement period rather than emptying it at once.`,
    weekly: `Make one genuine payment a week so the account reads as a user's, not a farmer's.`, minutes: 5 };
  if (c.includes('marketplace')) return {
    core: `List or buy one item on ${name} with ${usd} of funds on ${chain}, completing the trade in full.`,
    second: `Make a second trade on a different day so the wallet has a history, not a single event.`,
    weekly: `Browse and make one small trade a week while the program runs.`, minutes: 10 };
  if (c.includes('ai')) return {
    core: `Use ${name}'s product on ${chain} with ${usd} of funds: run its agent or task flow end to end once.`,
    second: `Repeat the flow with a second task type so the account shows real, varied use.`,
    weekly: `Run one task a week; usage history is the signal these programs can see.`, minutes: 10 };
  if (c.includes('privacy')) return {
    core: `Deposit ${usd} through ${name} on ${chain} using its own interface, and keep the note it gives you safe.`,
    second: `Withdraw to a fresh address after a delay, completing one full private cycle.`,
    weekly: `Make one small cycle a month rather than many at once, and follow the protocol's own guidance.`, minutes: 5 };
  if (c.includes('btc') || c.includes('bitcoin')) return {
    core: `Deposit ${usd} of BTC value through ${name} on ${chain} and keep the issued position open.`,
    second: `Use the issued asset in one lending or pool position so it earns while it waits.`,
    weekly: `Check the backing and redemption terms once a week.`, minutes: 5 };
  return {
    core: `Deposit ${usd} of USDC into ${name} on ${chain} through its own app and keep the position open.`,
    second: `Use a second feature of ${name} — a different pool, vault or market — so the wallet is not single-purpose.`,
    weekly: `Make one qualifying action a week, such as a deposit, a swap, a claim or a vote.`, minutes: 10 };
}

/** A step as one string: its action, then its cost and time, kept inside the gate's 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page before acting.`;
  return s;
}

/** A protocol's farm plan: seven steps, each an action with a cost and a time, from its own record. */
export function farmPlan(p: SnapshotProtocol, age: number | null): { steps: string[]; effort: Effort } {
  const chain = p.chains[0] ?? 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const a = actionsFor(p.category, p.name, chain, capital);
  const weeks = Math.max(2, Math.round(hold / 7));
  const steps = [
    stepText(
      `Create a fresh wallet for ${p.name}, keep its seed phrase offline, and fund it on ${chain} with the position money plus gas.`,
      `about ${money(gas + 1)} to fund and make the first transaction`,
      '10 minutes',
    ),
    stepText(a.core, `${money(capital)} of capital and about ${money(gas)} of gas`, '20 minutes to set up'),
    stepText(a.second, `about ${money(gas)} of gas, plus any amount you choose to add`, '15 minutes'),
    stepText(
      `${a.weekly} Repeat for ${weeks} weeks so the activity spans more than one snapshot.`,
      `about ${money(gas)} of gas a week`,
      `${a.minutes} minutes a week`,
    ),
    p.chains.length >= 2
      ? stepText(
          `Extend the farm to ${p.chains[1]}, the protocol's second chain: bridge a smaller amount and repeat the core action there.`,
          `about ${money(gas + 2)} in bridge and gas fees`,
          '20 minutes',
        )
      : stepText(
          `Deepen the position once: add about a quarter as much again, or set a small recurring deposit, so the balance is not static.`,
          `about ${money(Math.round(capital / 4))} more capital and ${money(gas)} of gas`,
          '10 minutes',
        ),
    stepText(
      `Hold the position for at least ${hold} days, checking the protocol's own points or rewards page weekly and claiming only from links it publishes.`,
      `the ${money(capital)} stays in the position; checking costs nothing`,
      `${hold} days`,
    ),
    stepText(
      `Log every transaction with its date in a farm note, and when you exit, withdraw through the same interface you entered by — never pay anyone to "unlock" a claim.`,
      'nothing to log; exit gas about ' + money(gas),
      '10 minutes',
    ),
  ];
  const score = clamp(
    (capital >= 300 ? 2 : capital >= 150 ? 1 : 0) + (a.minutes >= 15 ? 1 : 0) + (p.chains.length >= 4 ? 1 : 0) + (hold >= 60 ? 1 : 0),
    1,
    5,
  );
  return { steps, effort: { capital_usd: capital, weekly_minutes: a.minutes, hold_days: hold, score } };
}

/** Short factual tags for a row, each read off its own record. */
export function signalsFor(p: SnapshotProtocol, age: number | null, odds: number, watchlist: boolean, categoryRank: number): string[] {
  const out: string[] = [];
  if (watchlist) out.push('On the house watchlist');
  if (categoryRank <= 3 && p.category !== null) out.push(`Top ${categoryRank} by TVL in ${p.category}`);
  if (p.change_7d !== null && p.change_7d >= 15) out.push(`TVL up ${p.change_7d.toFixed(1)}% in 7 days`);
  if (p.change_7d !== null && p.change_7d <= -20) out.push(`TVL down ${Math.abs(p.change_7d).toFixed(1)}% in 7 days — cooling, cheaper attention`);
  if (age !== null && age >= 1095) out.push(`Running ${(age / 365).toFixed(1)} years with no token`);
  if (age !== null && age <= 90) out.push(`New on the index: listed ${age} days before the snapshot`);
  if (p.chains.length >= 8) out.push(`Live on ${p.chains.length} chains`);
  if (odds >= 0.55) out.push('Model odds above 55%');
  return out.slice(0, 4);
}

/** The ranked board: every rankable pre-token protocol, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { stats, globalRate } = categoryStats(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter(isRankable);

  // Each protocol's rank by TVL inside its own category, for the signal tags.
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of chosen) {
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  const tvlRank = new Map<string, number>();
  for (const list of byCategory.values()) {
    [...list].sort((a, b) => b.tvl_usd - a.tvl_usd).forEach((p, i) => tvlRank.set(p.slug, i + 1));
  }

  const scored = chosen.map((p) => {
    const stat = stats.get(p.category ?? 'Uncategorised')!;
    const s = score(p, snapshot.as_of, stat, globalRate, model);
    return { p, stat, s };
  });
  scored.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, stat, s }, i) => {
    const { steps, effort } = farmPlan(p, s.age);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: s.age,
      token_status: 'pre-token' as const,
      watchlist: watch.has(p.slug),
      implied_value_usd: s.implied,
      odds_pct: Math.round(s.odds * 1000) / 10,
      expected_value_usd: Math.round(s.implied * s.odds),
      category_multiple: stat.multiple,
      model: {
        comps: stat.comps,
        growth_factor: round4(s.growthFactor),
        maturity_factor: round4(s.maturityFactor),
        category_token_rate: stat.token_rate,
      },
      effort,
      signals: signalsFor(p, s.age, s.odds, watch.has(p.slug), tvlRank.get(p.slug) ?? 99),
      farm_steps: steps,
    };
  });
}

/** The launched protocols, by market cap, for the dashboard's Launched view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const { stats, globalMedian, globalRate } = categoryStats(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median_ratio: round4(globalMedian),
    global_token_rate: round4(globalRate),
    stats: {
      scanned: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      ranked: board.length,
      watchlist_size: snapshot.watchlist.length,
      launched: snapshot.protocols.filter((p) => !isPreToken(p)).length,
      total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
      total_expected_usd: board.reduce((n, r) => n + r.expected_value_usd, 0),
    },
    categories: [...stats.values()].sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1)),
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
