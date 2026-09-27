import type { ModelConfig } from "../config";
import { getDb } from "../db";
import { fitSparseWls, type SparseObs } from "../models/wls";

/** Same league under an older name. */
const ALIASES: Record<string, string> = {
  Sweden: "SHL",
  SEL: "SHL",
  "J20 SuperElit": "J20 Nationell",
  "U20 Nationell": "J20 Nationell",
  "SM-liiga": "Liiga",
  Finland: "Liiga",
  NLA: "NL",
  Swiss: "NL",
  "Czech": "Czechia",
  Russia: "KHL",
};

export const MIN_AGE = 16;
export const MAX_AGE = 30;
export type Group = "F" | "D";

export interface SeasonRow {
  playerId: number;
  season: number;
  league: string;
  gp: number;
  g: number | null;
  pts: number;
  age: number;
  group: Group;
}

/** Age on Sept 15 of the season's first year (SPEC 10.3). */
export function ageAt(birthDate: string, season: number): number {
  const start = Math.floor(season / 10000);
  return (Date.parse(`${start}-09-15T00:00:00Z`) - Date.parse(`${birthDate}T00:00:00Z`)) / (365.25 * 86400000);
}

export const ageKey = (age: number) => Math.min(MAX_AGE, Math.max(MIN_AGE, Math.floor(age)));
const logPpg = (pts: number, gp: number) => Math.log((pts + 0.5) / gp);

/** Regular-season club rows per skater, one per (player, season, league), with age and F/D group. */
export function loadSeasonRows(): SeasonRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.player_id, t.season, t.league, SUM(t.gp) gp, SUM(t.g) g, SUM(t.pts) pts, COUNT(t.g) g_known, COUNT(*) n,
         p.birth_date, p.position
       FROM player_season_totals t JOIN players p ON p.id = t.player_id
       WHERE t.game_type = 2 AND p.position != 'G' AND p.birth_date IS NOT NULL AND t.gp > 0 AND t.pts IS NOT NULL
       GROUP BY t.player_id, t.season, t.league`
    )
    .all() as { player_id: number; season: number; league: string; gp: number; g: number | null; pts: number; g_known: number; n: number; birth_date: string; position: string }[];
  const merged = new Map<string, SeasonRow>();
  for (const r of rows) {
    const league = ALIASES[r.league] ?? r.league;
    const key = `${r.player_id}|${r.season}|${league}`;
    const prev = merged.get(key);
    const g = r.g_known === r.n ? r.g : null;
    if (prev) {
      prev.gp += r.gp;
      prev.pts += r.pts;
      prev.g = prev.g !== null && g !== null ? prev.g + g : null;
    } else {
      merged.set(key, {
        playerId: r.player_id,
        season: r.season,
        league,
        gp: r.gp,
        g,
        pts: r.pts,
        age: ageAt(r.birth_date, r.season),
        group: r.position === "D" ? "D" : "F",
      });
    }
  }
  return [...merged.values()];
}

export interface Translation {
  factors: Map<string, { factor: number; low: number; high: number; obs: number; toNhl: number }>;
  /** Log growth in PPG from age a to a+1, by group. */
  growth: Record<Group, number[]>;
  maxSeason: number;
}

interface Pair {
  playerId: number;
  from: string;
  to: string;
  y: number;
  w: number;
  ageKey: number | null; // null for same-season pairs (no development between them)
  group: Group;
}

function buildPairs(rows: SeasonRow[], minGp: number, maxSeason: number): Pair[] {
  const byPlayer = new Map<number, SeasonRow[]>();
  for (const r of rows) {
    if (r.gp < minGp || r.season > maxSeason) continue;
    byPlayer.set(r.playerId, [...(byPlayer.get(r.playerId) ?? []), r]);
  }
  const pairs: Pair[] = [];
  const weight = (a: SeasonRow, b: SeasonRow) => 1 / (1 / (a.pts + 1) + 1 / (b.pts + 1));
  for (const [playerId, list] of byPlayer) {
    const bySeason = new Map<number, SeasonRow[]>();
    list.forEach((r) => bySeason.set(r.season, [...(bySeason.get(r.season) ?? []), r]));
    for (const [season, now] of bySeason) {
      // Two leagues in the same season: a direct comparison with no development in between.
      for (let i = 0; i < now.length; i++) {
        for (let j = i + 1; j < now.length; j++) {
          pairs.push({
            playerId, from: now[i].league, to: now[j].league, group: now[i].group, ageKey: null,
            y: logPpg(now[j].pts, now[j].gp) - logPpg(now[i].pts, now[i].gp), w: weight(now[i], now[j]),
          });
        }
      }
      // Next season: development between ages a and a+1 on top of the league change.
      for (const a of now) {
        for (const b of bySeason.get(season + 10001) ?? []) {
          pairs.push({
            playerId, from: a.league, to: b.league, group: a.group, ageKey: ageKey(a.age),
            y: logPpg(b.pts, b.gp) - logPpg(a.pts, a.gp), w: weight(a, b),
          });
        }
      }
    }
  }
  return pairs;
}

/**
 * League translation factors by a network fit (SPEC 10.2): every pair of seasons gives
 * log PPG(to) − log PPG(from) = log f(from) − log f(to) + growth(age), with f(NHL) = 1.
 * Leagues with few direct NHL graduates are pinned down through the AHL and everything else.
 */
export function fitTranslation(rows: SeasonRow[], cfg: ModelConfig["prospects"], maxSeason: number): Translation {
  let pairs = buildPairs(rows, cfg.min_gp, maxSeason);
  // Keep leagues with enough observations; repeat since dropping one can thin out another.
  for (let iter = 0; iter < 5; iter++) {
    const count = new Map<string, number>();
    for (const p of pairs) {
      count.set(p.from, (count.get(p.from) ?? 0) + 1);
      count.set(p.to, (count.get(p.to) ?? 0) + 1);
    }
    const keep = (l: string) => l === "NHL" || (count.get(l) ?? 0) >= cfg.min_league_obs;
    const next = pairs.filter((p) => keep(p.from) && keep(p.to));
    if (next.length === pairs.length) break;
    pairs = next;
  }

  const leagues = [...new Set(pairs.flatMap((p) => [p.from, p.to]))].filter((l) => l !== "NHL").sort();
  const li = new Map(leagues.map((l, i) => [l, i]));
  const ages = MAX_AGE - MIN_AGE + 1;
  const gi = (group: Group, age: number) => leagues.length + (group === "D" ? ages : 0) + (age - MIN_AGE);
  const nParams = leagues.length + 2 * ages;

  const solveFor = (subset: Pair[]) => {
    const obs: SparseObs[] = subset.map((p) => {
      const terms: [number, number][] = [];
      if (p.from !== "NHL") terms.push([li.get(p.from)!, 1]);
      if (p.to !== "NHL") terms.push([li.get(p.to)!, -1]);
      if (p.ageKey !== null) terms.push([gi(p.group, p.ageKey), 1]);
      return { y: p.y, w: p.w, terms };
    });
    return fitSparseWls(obs, nParams, 1e-3);
  };

  const beta = solveFor(pairs);

  // Bootstrap over players for the factor intervals.
  const players = [...new Set(pairs.map((p) => p.playerId))];
  const byPlayer = new Map<number, Pair[]>();
  pairs.forEach((p) => byPlayer.set(p.playerId, [...(byPlayer.get(p.playerId) ?? []), p]));
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const draws: number[][] = [];
  for (let b = 0; b < cfg.bootstrap; b++) {
    const sample: Pair[] = [];
    for (let k = 0; k < players.length; k++) sample.push(...byPlayer.get(players[Math.floor(rand() * players.length)])!);
    draws.push(solveFor(sample));
  }
  const quantile = (xs: number[], q: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  };

  const factors = new Map<string, { factor: number; low: number; high: number; obs: number; toNhl: number }>();
  factors.set("NHL", { factor: 1, low: 1, high: 1, obs: pairs.filter((p) => p.from === "NHL" || p.to === "NHL").length, toNhl: 0 });
  for (const l of leagues) {
    const i = li.get(l)!;
    const d = draws.map((x) => x[i]);
    factors.set(l, {
      factor: Math.exp(beta[i]),
      low: Math.exp(quantile(d, 0.05)),
      high: Math.exp(quantile(d, 0.95)),
      obs: pairs.filter((p) => p.from === l || p.to === l).length,
      toNhl: pairs.filter((p) => p.from === l && p.to === "NHL").length,
    });
  }
  const growth: Record<Group, number[]> = { F: [], D: [] };
  for (const group of ["F", "D"] as const) {
    for (let a = MIN_AGE; a <= MAX_AGE; a++) growth[group][a] = beta[gi(group, a)];
  }
  return { factors, growth, maxSeason };
}

/** Log growth from age a to the peak age along the fitted curve (no decline after the peak). */
export function growthToPeak(t: Translation, group: Group, age: number, peakAge: number): number {
  let g = 0;
  for (let a = ageKey(age); a < peakAge; a++) g += Math.max(0, t.growth[group][a] ?? 0);
  return g;
}
