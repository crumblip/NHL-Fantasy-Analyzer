import { loadLeagueConfig, loadModelConfig, type ModelConfig } from "../config";
import { getDb } from "../db";
import { letterGrade, percentiles, poissonAtLeast } from "../models/project";
import { ageKey, fitTranslation, growthToPeak, loadSeasonRows, type Group, type SeasonRow, type Translation } from "./leagues";

type Cfg = ModelConfig["prospects"];

interface SeasonAgg {
  season: number;
  age: number;
  gp: number;
  nhle: number; // league-translated PPG
  peak: number; // projected to peak age
  g: number;
  ptsWithG: number;
  league: string;
  nhlGp: number;
}

export interface Snapshot {
  playerId: number;
  group: Group;
  season: number;
  age: number;
  ageKey: number;
  league: string;
  nhle: number;
  peak: number;
  features: number[];
  draftYear: number | null;
  draftOverall: number | null;
}

export interface Outcome {
  careerGp: number;
  peakPts: number;
  peakFpg: number;
}

export const FEATURES = ["peak_nhle", "blended_nhle", "trajectory", "goal_share", "height", "weight", "draft_slot"] as const;
const UNDRAFTED = 260;

/** Per player, per season: translated production across leagues with a factor (tournaments have none). */
function aggregateSeasons(rows: SeasonRow[], t: Translation, peakAge: number) {
  const out = new Map<number, Map<number, SeasonAgg>>();
  const groupOf = new Map<number, Group>();
  for (const r of rows) {
    const f = t.factors.get(r.league);
    if (!f || r.season > t.maxSeason) continue;
    groupOf.set(r.playerId, r.group);
    const seasons = out.get(r.playerId) ?? new Map<number, SeasonAgg>();
    const s = seasons.get(r.season) ?? { season: r.season, age: r.age, gp: 0, nhle: 0, peak: 0, g: 0, ptsWithG: 0, league: r.league, nhlGp: 0 };
    const ppg = r.pts / r.gp;
    const bigger = r.gp > s.gp;
    // GP-weighted average of translated PPG across the season's leagues.
    s.nhle = (s.nhle * s.gp + ppg * f.factor * r.gp) / (s.gp + r.gp);
    s.gp += r.gp;
    if (bigger) s.league = r.league;
    if (r.g !== null) {
      s.g += r.g;
      s.ptsWithG += r.pts;
    }
    if (r.league === "NHL") s.nhlGp += r.gp;
    seasons.set(r.season, s);
    out.set(r.playerId, seasons);
  }
  for (const [pid, seasons] of out) {
    for (const s of seasons.values()) s.peak = s.nhle * Math.exp(growthToPeak(t, groupOf.get(pid)!, s.age, peakAge));
  }
  return { seasons: out, groupOf };
}

/** Peak season outcomes under this league's scoring (SPEC 10.6), from NHL season totals since 2005-06. */
export function loadOutcomes(cfg: Cfg): Map<number, Outcome> {
  const db = getDb();
  const k = loadLeagueConfig().scoring.skater;
  const out = new Map<number, Outcome>();
  for (const r of db
    .prepare(
      `SELECT s.*, p.position pos FROM nhl_skater_seasons s LEFT JOIN players p ON p.id = s.player_id`
    )
    .all() as any[]) {
    const o = out.get(r.player_id) ?? { careerGp: 0, peakPts: 0, peakFpg: 0 };
    o.careerGp += r.gp;
    o.peakPts = Math.max(o.peakPts, r.pts);
    if (r.gp >= cfg.peak_season_min_gp) {
      const isD = (r.pos ?? r.position) === "D";
      // Hat tricks aren't in season totals: expected count from a Poisson on goals per game.
      const hats = r.gp * poissonAtLeast(3, r.g / r.gp);
      const fp =
        r.g * k.G + r.a * k.A + r.pim * k.PIM + r.ppp * k.PPP + r.shp * k.SHP + hats * k.HAT +
        r.sog * k.SOG + (r.hit ?? 0) * k.HIT + (r.blk ?? 0) * k.BLK + (isD ? r.pts * k.DEF : 0);
      o.peakFpg = Math.max(o.peakFpg, fp / r.gp);
    }
    out.set(r.player_id, o);
  }
  return out;
}

interface Bio {
  height: number | null;
  weight: number | null;
  draftYear: number | null;
  draftOverall: number | null;
}

function loadBio(): Map<number, Bio> {
  const db = getDb();
  const bio = new Map<number, Bio>();
  for (const r of db.prepare("SELECT id, height_in, weight_lb FROM players").all() as any[]) {
    bio.set(r.id, { height: r.height_in, weight: r.weight_lb, draftYear: null, draftOverall: null });
  }
  // A player drafted twice keeps his latest draft.
  for (const r of db
    .prepare("SELECT player_id, draft_year, overall FROM draft_picks WHERE player_id IS NOT NULL ORDER BY draft_year")
    .all() as any[]) {
    const b = bio.get(r.player_id) ?? { height: null, weight: null, draftYear: null, draftOverall: null };
    b.draftYear = r.draft_year;
    b.draftOverall = r.overall;
    bio.set(r.player_id, b);
  }
  return bio;
}

function snapshotAt(
  pid: number,
  season: number,
  seasons: Map<number, SeasonAgg>,
  group: Group,
  bio: Bio | undefined,
  cfg: Cfg
): Snapshot | null {
  const cur = seasons.get(season);
  if (!cur || cur.gp < cfg.snapshot_min_gp) return null;
  const prev = seasons.get(season - 10001);
  const blend = prev && prev.gp > 0 ? (2 * cur.gp * cur.peak + prev.gp * prev.peak) / (2 * cur.gp + prev.gp) : cur.peak;
  const lp = (x: number) => Math.log(x + 0.05);
  return {
    playerId: pid,
    group,
    season,
    age: cur.age,
    ageKey: ageKey(cur.age),
    league: cur.league,
    nhle: cur.nhle,
    peak: cur.peak,
    draftYear: bio?.draftYear ?? null,
    draftOverall: bio?.draftOverall ?? null,
    features: [
      lp(cur.peak),
      lp(blend),
      prev && prev.gp > 0 ? lp(cur.peak) - lp(prev.peak) : NaN,
      cur.ptsWithG > 0 ? cur.g / cur.ptsWithG : NaN,
      bio?.height ?? NaN,
      bio?.weight ?? NaN,
      Math.log(bio?.draftOverall ?? UNDRAFTED),
    ],
  };
}

type PoolIndex = Map<string, { snaps: Snapshot[]; mean: number[]; sd: number[] }>;

function indexPool(snaps: Snapshot[]): PoolIndex {
  const idx: PoolIndex = new Map();
  const groups = new Map<string, Snapshot[]>();
  for (const s of snaps) groups.set(`${s.group}|${s.ageKey}`, [...(groups.get(`${s.group}|${s.ageKey}`) ?? []), s]);
  for (const [key, list] of groups) {
    const mean: number[] = [];
    const sd: number[] = [];
    FEATURES.forEach((_, j) => {
      const xs = list.map((s) => s.features[j]).filter((x) => Number.isFinite(x));
      const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      mean.push(m);
      sd.push(Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)) || 1);
    });
    idx.set(key, { snaps: list, mean, sd });
  }
  return idx;
}

export function findComparables(target: Snapshot, idx: PoolIndex, cfg: Cfg) {
  // Same position group and age; widen to the nearest age with a usable pool if needed.
  let entry = idx.get(`${target.group}|${target.ageKey}`);
  for (let d = 1; (!entry || entry.snaps.length < cfg.comparables * 2) && d <= 3; d++) {
    entry = idx.get(`${target.group}|${target.ageKey - d}`) ?? idx.get(`${target.group}|${target.ageKey + d}`) ?? entry;
  }
  if (!entry) return [];
  const w = FEATURES.map((f) => cfg.feature_weights[f]);
  const fill = (x: number, j: number) => (Number.isFinite(x) ? x : entry!.mean[j]);
  return entry.snaps
    .filter((s) => s.playerId !== target.playerId)
    .map((s) => {
      let d2 = 0;
      FEATURES.forEach((_, j) => {
        const z = (fill(s.features[j], j) - fill(target.features[j], j)) / entry!.sd[j];
        d2 += w[j] * z * z;
      });
      return { snap: s, distance: Math.sqrt(d2) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, cfg.comparables);
}

function quantile(xs: number[], q: number) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (pos - lo);
}

export function predictFromComps(comps: { snap: Snapshot }[], outcomes: Map<number, Outcome>, cfg: Cfg) {
  const outs = comps.map((c) => outcomes.get(c.snap.playerId) ?? { careerGp: 0, peakPts: 0, peakFpg: 0 });
  const n = Math.max(1, outs.length);
  const fpg = outs.map((o) => o.peakFpg);
  return {
    pRegular: outs.filter((o) => o.careerGp >= cfg.regular_gp).length / n,
    p50: outs.filter((o) => o.peakPts >= 50).length / n,
    p70: outs.filter((o) => o.peakPts >= 70).length / n,
    medianFpg: quantile(fpg, 0.5),
    expectedFpg: fpg.reduce((a, b) => a + b, 0) / n,
    iqr: quantile(fpg, 0.75) - quantile(fpg, 0.25),
  };
}

/** Historical snapshots: drafted skaters, every season before they had 82 NHL games. */
function buildPool(
  seasons: Map<number, Map<number, SeasonAgg>>,
  groupOf: Map<number, Group>,
  bio: Map<number, Bio>,
  lastDraft: number,
  cfg: Cfg
): Snapshot[] {
  const pool: Snapshot[] = [];
  for (const [pid, list] of seasons) {
    const b = bio.get(pid);
    if (!b?.draftYear || b.draftYear > lastDraft) continue;
    let nhlGp = 0;
    for (const season of [...list.keys()].sort()) {
      if (nhlGp < 82) {
        const s = snapshotAt(pid, season, list, groupOf.get(pid)!, b, cfg);
        if (s && s.ageKey <= 23) pool.push(s);
      }
      nhlGp += list.get(season)!.nhlGp;
    }
  }
  return pool;
}

function latestSeason(rows: SeasonRow[], minGp: number): number {
  return Math.max(...rows.filter((r) => r.gp >= minGp).map((r) => r.season));
}

export function runProspects(asOf: string) {
  const db = getDb();
  const cfg = loadModelConfig().prospects;
  const letters = loadModelConfig().grades.letters;
  const rows = loadSeasonRows();
  const maxSeason = latestSeason(rows, cfg.min_gp);
  const t = fitTranslation(rows, cfg, maxSeason);

  db.transaction(() => {
    db.prepare("DELETE FROM league_factors").run();
    const ins = db.prepare(
      "INSERT INTO league_factors (league, factor, ci_low, ci_high, observations, direct_to_nhl, fitted_through) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const [l, f] of t.factors) ins.run(l, f.factor, f.low, f.high, f.obs, f.toNhl, maxSeason);
    db.prepare("DELETE FROM age_curve").run();
    const ac = db.prepare("INSERT INTO age_curve (position_group, age, log_growth) VALUES (?, ?, ?)");
    for (const g of ["F", "D"] as const) t.growth[g].forEach((v, age) => v !== undefined && ac.run(g, age, v));
  })();

  const { seasons, groupOf } = aggregateSeasons(rows, t, cfg.peak_age);
  const bio = loadBio();
  const outcomes = loadOutcomes(cfg);
  const asOfYear = Number(asOf.slice(0, 4));
  const idx = indexPool(buildPool(seasons, groupOf, bio, asOfYear - cfg.maturity_years, cfg));

  // Board: drafted in the last 7 drafts, under 82 NHL games, with a qualifying recent season.
  const board: Record<string, any>[] = [];
  for (const [pid, list] of seasons) {
    const b = bio.get(pid);
    if (!b?.draftYear || b.draftYear < asOfYear - 7) continue;
    if ((outcomes.get(pid)?.careerGp ?? 0) >= 82) continue;
    const recent = [maxSeason, maxSeason - 10001].find((s) => list.get(s) && list.get(s)!.gp >= cfg.snapshot_min_gp);
    if (!recent) continue;
    const snap = snapshotAt(pid, recent, list, groupOf.get(pid)!, b, cfg);
    if (!snap) continue;
    const comps = findComparables(snap, idx, cfg);
    if (!comps.length) continue;
    const p = predictFromComps(comps, outcomes, cfg);
    board.push({
      player_id: pid,
      as_of_date: asOf,
      snapshot_season: snap.season,
      age: snap.age,
      position: snap.group,
      draft_year: b.draftYear,
      draft_overall: b.draftOverall,
      league: snap.league,
      nhle_ppg: snap.nhle,
      peak_nhle_ppg: snap.peak,
      p_regular: p.pRegular,
      p_peak50: p.p50,
      p_peak70: p.p70,
      median_peak_fpg: p.medianFpg,
      expected_peak_fpg: p.expectedFpg,
      risk_iqr: p.iqr,
      comparables: JSON.stringify(
        comps.map((c) => {
          const o = outcomes.get(c.snap.playerId);
          return {
            id: c.snap.playerId,
            season: c.snap.season,
            league: c.snap.league,
            nhle: +c.snap.nhle.toFixed(3),
            draft: c.snap.draftOverall,
            gp: o?.careerGp ?? 0,
            peakPts: o?.peakPts ?? 0,
            peakFpg: +(o?.peakFpg ?? 0).toFixed(2),
            distance: +c.distance.toFixed(3),
          };
        })
      ),
    });
  }

  const pct = percentiles(board.map((r) => r.expected_peak_fpg));
  const iqrs = board.map((r) => r.risk_iqr).sort((a, b) => a - b);
  const lowCut = quantile(iqrs, 1 / 3);
  const highCut = quantile(iqrs, 2 / 3);
  board.forEach((r, i) => {
    r.pctl = pct[i];
    r.grade = letterGrade(pct[i], letters);
    r.risk = r.risk_iqr <= lowCut ? "low" : r.risk_iqr >= highCut ? "high" : "medium";
  });

  db.transaction(() => {
    db.prepare("DELETE FROM prospect_outputs WHERE as_of_date = ?").run(asOf);
    if (!board.length) return;
    const cols = Object.keys(board[0]);
    const st = db.prepare(`INSERT INTO prospect_outputs (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`);
    for (const r of board) st.run(r);
  })();
  return { asOf, maxSeason, leagues: t.factors.size, pool: [...idx.values()].reduce((s, e) => s + e.snaps.length, 0), prospects: board.length };
}

function spearman(xs: number[], ys: number[]) {
  const rank = (v: number[]) => {
    const p = percentiles(v);
    return p;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length;
  const my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let sxy = 0, sxx = 0, syy = 0;
  rx.forEach((x, i) => {
    sxy += (x - mx) * (ry[i] - my);
    sxx += (x - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
}

/** SPEC 10.8: fit on older drafts, predict later drafts from their draft-year season. */
export function backtestProspects() {
  const cfg = loadModelConfig().prospects;
  const rows = loadSeasonRows();
  const last = cfg.backtest_train_last_draft;
  const maxSeason = last * 10000 + (last + 1); // data through the season after the last training draft
  const t = fitTranslation(rows, cfg, maxSeason);
  const { seasons, groupOf } = aggregateSeasons(rows, t, cfg.peak_age);
  const bio = loadBio();
  const outcomes = loadOutcomes(cfg);
  const idx = indexPool(buildPool(seasons, groupOf, bio, last, cfg));

  // Evaluation snapshots use only seasons up to each player's draft year, translated with factors
  // fitted through the training window.
  const allSeasons = aggregateSeasons(rows, { ...t, maxSeason: 99999999 }, cfg.peak_age);
  const results: { pid: number; group: Group; pred: ReturnType<typeof predictFromComps>; actual: Outcome; overall: number }[] = [];
  let missing = 0;
  for (const [pid, b] of bio) {
    if (!b.draftYear || !cfg.backtest_eval_drafts.includes(b.draftYear)) continue;
    const list = allSeasons.seasons.get(pid);
    const group = allSeasons.groupOf.get(pid);
    if (!list || !group) continue; // goalies and players with no club seasons
    const draftSeason = (b.draftYear - 1) * 10000 + b.draftYear;
    const snap = snapshotAt(pid, draftSeason, list, group, b, cfg);
    if (!snap) {
      missing++;
      continue;
    }
    const comps = findComparables(snap, idx, cfg);
    results.push({
      pid,
      group: snap.group,
      pred: predictFromComps(comps, outcomes, cfg),
      actual: outcomes.get(pid) ?? { careerGp: 0, peakPts: 0, peakFpg: 0 },
      overall: b.draftOverall ?? UNDRAFTED,
    });
  }
  const actual = results.map((r) => r.actual.peakFpg);
  const brier = (p: number[], y: number[]) => p.reduce((s, x, i) => s + (x - y[i]) ** 2, 0) / p.length;
  const regular = results.map((r) => (r.actual.careerGp >= cfg.regular_gp ? 1 : 0));
  const pReg = results.map((r) => r.pred.pRegular);
  const base = regular.reduce((a: number, b) => a + b, 0) / regular.length;
  return {
    evaluated: results.length,
    missing,
    spearmanModel: spearman(results.map((r) => r.pred.expectedFpg), actual),
    spearmanDraft: spearman(results.map((r) => -r.overall), actual),
    spearmanModelFirstRound: spearman(
      results.filter((r) => r.overall <= 32).map((r) => r.pred.expectedFpg),
      results.filter((r) => r.overall <= 32).map((r) => r.actual.peakFpg)
    ),
    spearmanDraftFirstRound: spearman(
      results.filter((r) => r.overall <= 32).map((r) => -r.overall),
      results.filter((r) => r.overall <= 32).map((r) => r.actual.peakFpg)
    ),
    regularRate: base,
    predictedRegularRate: pReg.reduce((a, b) => a + b, 0) / pReg.length,
    brierRegular: brier(pReg, regular),
    brierRegularBase: brier(pReg.map(() => base), regular),
    factorsFittedThrough: maxSeason,
  };
}
