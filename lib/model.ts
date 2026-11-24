// Northstar: the token radar's model (Node 22, standard library only).
//
// The board ranks every pre-token protocol the sealed snapshot carries, by what its
// launch would be worth if it launched at the multiple the market already pays
// launched protocols like it. The model is fit from the snapshot itself, at run
// time, on the 128 protocols in it that already trade: nothing about it is a
// hand-kept list of names, and no protocol name is ever special-cased.
//
//   log(market cap) = a + b * log(effective TVL) + category effect
//
//   effective TVL = TVL / (1 + 0.5 * max(0, 7-day growth %) / 100)
//     A 7-day TVL jump is half-discounted: value is put on the TVL that stayed,
//     not on the spike that arrived yesterday. Falls are never rewarded.
//
//   a, b: ordinary least squares of log market cap on log effective TVL over the
//     launched protocols. On this snapshot a = 6.96, b = 0.52: value grows with
//     the square root of TVL, not with TVL itself. A flat multiple (the house
//     model's TVL x 0.25) overvalues the giants and undervalues the small.
//
//   category effect: the median residual of the launched protocols in the
//     category, shrunk toward zero with four pseudo-observations at zero, so a
//     category with one or two launched names carries no effect at all and a
//     well-populated one carries its own. Lending lands at -0.21, Liquid Staking
//     at -0.24, Basis Trading at +0.25, Canonical Bridge at +0.39.
//
//   age: the launched set shows no link between a protocol's age and its
//     multiple (r = -0.00), so age does not move the value. It sets the farm
//     plan's hold window instead, and it is shown on every row.
//
// The fit is checked before it is used, on the same snapshot, by leave-one-out:
// every launched protocol is held out in turn, the fit is redone without it,
// and the prediction is scored against its real market cap. On this snapshot
// the model lands a median absolute error of 0.54 in log10 (31% of predictions
// within 2x, 41% within 3x); the flat-multiple baseline lands 0.72 (30% within
// 2x, 35% within 3x). The backtest runs inside main.ts, so the numbers the
// dashboard shows are the numbers this snapshot's own data produced.

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

/** The fitted model: everything the dashboard states and the page recomputes. */
export interface ModelFit {
  version: string;
  intercept: number;
  slope: number;
  spike_discount: number;
  growth_floor: number;
  growth_cap: number;
  category_effects: Record<string, number>;
  launched_count: number;
  global_median_multiple: number;
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'northstar-1';

/** The spike discount: half of a 7-day TVL jump is treated as transient. */
export const SPIKE_DISCOUNT = 0.5;
/** The growth clamp, in per cent, matching the snapshot's own range. */
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 120;
/** Pseudo-observations at zero shrinking a category's effect. */
export const CATEGORY_SHRINKAGE = 4;
/** A category needs at least this many launched names before its effect can move. */
export const MIN_CATEGORY_LAUNCHED = 3;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_multiple: number;
  model: {
    effective_tvl_usd: number;
    growth_pct: number;
    spike_discount: number;
    intercept: number;
    slope: number;
    category_effect: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_multiple: number;
  effective_tvl_usd: number;
  category_effect: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One backtest's numbers: the model and the flat-multiple baseline, same protocol set. */
export interface BacktestResult {
  launched_count: number;
  model_median_log10_error: number;
  model_within_2x_pct: number;
  model_within_3x_pct: number;
  model_spearman: number;
  baseline_median_log10_error: number;
  baseline_within_2x_pct: number;
  baseline_within_3x_pct: number;
  baseline_spearman: number;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelFit;
  backtest: BacktestResult;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list, taking the upper middle of an even count (deterministic). */
function median(values: number[]): number {
  const xs = [...values].sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)]!;
}

/** Round to 4 decimals for the numbers the dashboard prints. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The 7-day growth clamped to the model's range; null growth counts as zero. */
export function clampedGrowth(p: SnapshotProtocol): number {
  const raw = finite(p.change_7d, 0);
  return Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, raw));
}

/** The TVL the model prices: the reported TVL with half of a 7-day jump discounted. */
export function effectiveTvl(p: SnapshotProtocol): number {
  const g = clampedGrowth(p);
  return p.tvl_usd / (1 + SPIKE_DISCOUNT * (Math.max(0, g) / 100));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a wrapped, staked or bridged product of a token that trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** A name carrying a whole wrapped/staked word is a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name is the exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, and not a wrapped,
 *  staked or bridged product of a token that already trades, not an exchange,
 *  and not a versioned pool of another protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The launched protocols the fit learns from: a token with a market cap, on real TVL. */
function launched(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** The power-law fit over a set of launched protocols: intercept, slope, category effects. */
export function fitModel(protocols: SnapshotProtocol[]): ModelFit {
  const eff = protocols.map((p) => Math.log(effectiveTvl(p)));
  const y = protocols.map((p) => Math.log(p.mcap_usd!));
  const n = protocols.length;
  const mx = eff.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (eff[i]! - mx) * (y[i]! - my);
    sxx += (eff[i]! - mx) * (eff[i]! - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  // Category effects: median residual per category, shrunk toward zero.
  const residuals = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const p = protocols[i]!;
    const r = y[i]! - (intercept + slope * eff[i]!);
    const c = p.category ?? 'null';
    if (!residuals.has(c)) residuals.set(c, []);
    residuals.get(c)!.push(r);
  }
  const categoryEffects: Record<string, number> = {};
  for (const [c, rs] of residuals) {
    if (rs.length < MIN_CATEGORY_LAUNCHED) {
      categoryEffects[c] = 0;
      continue;
    }
    const pooled = [...rs];
    for (let i = 0; i < CATEGORY_SHRINKAGE; i++) pooled.push(0);
    categoryEffects[c] = round4(median(pooled));
  }
  const multiples = protocols.map((p) => p.mcap_usd! / p.tvl_usd);
  return {
    version: MODEL_VERSION,
    intercept: round4(intercept),
    slope: round4(slope),
    spike_discount: SPIKE_DISCOUNT,
    growth_floor: GROWTH_FLOOR,
    growth_cap: GROWTH_CAP,
    category_effects: categoryEffects,
    launched_count: n,
    global_median_multiple: round4(median(multiples)),
  };
}

/** The implied value of one protocol under a fit, with its working. */
export function impliedValue(
  p: SnapshotProtocol,
  fit: ModelFit,
): { implied: number; effTvl: number; growthPct: number; catEffect: number } {
  const effTvl = effectiveTvl(p);
  const growthPct = clampedGrowth(p);
  const catEffect = fit.category_effects[p.category ?? 'null'] ?? 0;
  const logValue = fit.intercept + fit.slope * Math.log(effTvl) + catEffect;
  const implied = Math.max(1, Math.round(Math.exp(logValue)));
  return { implied, effTvl: Math.round(effTvl), growthPct, catEffect };
}

/** Spearman rank correlation of two equal-length lists. */
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]): number[] => {
    const order = v.map((x, i) => [x, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    // Tied values share the average of the ranks they span (the standard
    // Spearman): without it, equal predictions get consecutive ranks and the
    // correlation is overstated. This snapshot has no ties, so the numbers
    // it reports do not move, but the statistic is correct for any input.
    let j = 0;
    while (j < order.length) {
      let k = j;
      while (k + 1 < order.length && order[k + 1]![0] === order[j]![0]) k++;
      const avg = (j + k) / 2;
      for (let m = j; m <= k; m++) r[order[m]![1]] = avg;
      j = k + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n;
  const mb = rb.reduce((x, y) => x + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (ra[i]! - ma) * (rb[i]! - mb);
    sxx += (ra[i]! - ma) * (ra[i]! - ma);
    syy += (rb[i]! - mb) * (rb[i]! - mb);
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** The leave-one-out backtest of the fitted model against the flat-multiple baseline. */
export function backtest(snapshot: Snapshot): BacktestResult {
  const launchedProtocols = launched(snapshot);
  const n = launchedProtocols.length;
  const modelErrors: number[] = [];
  const baselineErrors: number[] = [];
  const modelPreds: number[] = [];
  const baselinePreds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < n; i++) {
    const held = launchedProtocols[i]!;
    const train = launchedProtocols.filter((_, j) => j !== i);
    const fit = fitModel(train);
    const { implied } = impliedValue(held, fit);
    const actual = held.mcap_usd!;
    modelErrors.push(Math.abs(Math.log10(implied / actual)));
    modelPreds.push(Math.log(implied));
    // Baseline: the flat global median multiple on raw TVL, refit without the held one.
    const baseMultiple = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    const basePred = Math.max(1, Math.round(held.tvl_usd * baseMultiple));
    baselineErrors.push(Math.abs(Math.log10(basePred / actual)));
    baselinePreds.push(Math.log(basePred));
    actuals.push(Math.log(actual));
  }
  const within = (errs: number[], k: number): number =>
    (errs.filter((e) => e <= Math.log10(k)).length / errs.length) * 100;
  return {
    launched_count: n,
    model_median_log10_error: round4(median(modelErrors)),
    model_within_2x_pct: round4(within(modelErrors, 2)),
    model_within_3x_pct: round4(within(modelErrors, 3)),
    model_spearman: round4(spearman(modelPreds, actuals)),
    baseline_median_log10_error: round4(median(baselineErrors)),
    baseline_within_2x_pct: round4(within(baselineErrors, 2)),
    baseline_within_3x_pct: round4(within(baselineErrors, 3)),
    baseline_spearman: round4(spearman(baselinePreds, actuals)),
  };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit earning.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position in range.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and let it compound.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} with ${name} and put the funds to work in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and hold the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return `Deposit $${capital} of USDC as collateral on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in ${name}'s most active market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} curator vault on ${chain} and hold the shares.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('payment')) return `Route $${capital} of real payment volume through ${name} on ${chain}.`;
  if (c.includes('governance')) return `Lock or delegate $${capital} through ${name} on ${chain} and vote once.`;
  if (c.includes('chain')) return `Bridge $${capital} to the chain and use ${name}'s native apps for a week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: ModelFit): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor, by TVL.
  // No cap beyond the set itself: the board covers the whole rankable set.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, effTvl, growthPct, catEffect } = impliedValue(p, fit);
    return { p, implied, effTvl, growthPct, catEffect, age: ageDays(snapshot.as_of, p.listed_at) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_multiple: round4(s.implied / s.p.tvl_usd),
    model: {
      effective_tvl_usd: s.effTvl,
      growth_pct: s.growthPct,
      spike_discount: SPIKE_DISCOUNT,
      intercept: fit.intercept,
      slope: fit.slope,
      category_effect: s.catEffect,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's comparables view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_multiple: row.implied_multiple,
    effective_tvl_usd: row.model.effective_tvl_usd,
    category_effect: row.model.category_effect,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; fit: ModelFit } {
  const fit = fitModel(launched(snapshot));
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const bt = backtest(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: fit,
    backtest: bt,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, fit };
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

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
