import type { LeagueConfig } from "../config";
import { skaterPoints } from "../scoring";
import type { Talent } from "./talent";

export interface ToiPerGame {
  ev: number;
  pp: number;
  sh: number;
}

/** Expected counts for one game. */
export interface Lambdas {
  g: number;
  a: number;
  ppp: number;
  shp: number;
  sog: number;
  hit: number;
  blk: number;
  pim: number;
}

export function lambdas(t: Talent, toi: ToiPerGame, goalFactor = 1, shotFactor = 1): Lambdas {
  const h = (secs: number) => secs / 3600;
  const sum = (r: Record<"ev" | "pp" | "sh", number>) => r.ev * h(toi.ev) + r.pp * h(toi.pp) + r.sh * h(toi.sh);
  const a = { ev: t.a160.ev + t.a260.ev, pp: t.a160.pp + t.a260.pp, sh: t.a160.sh + t.a260.sh };
  return {
    g: sum(t.g60) * goalFactor,
    a: sum(a) * goalFactor,
    ppp: t.p60.pp * h(toi.pp) * goalFactor,
    shp: t.p60.sh * h(toi.sh) * goalFactor,
    sog: sum(t.sog60) * shotFactor,
    hit: t.hit60 * h(toi.ev + toi.pp + toi.sh),
    blk: t.blk60NonPk * h(toi.ev + toi.pp) + t.blk60Pk * h(toi.sh),
    pim: t.pim60 * h(toi.ev + toi.pp + toi.sh),
  };
}

export function poissonAtLeast(k: number, lambda: number): number {
  let term = Math.exp(-lambda);
  let cdf = 0;
  for (let i = 0; i < k; i++) {
    cdf += term;
    term *= lambda / (i + 1);
  }
  return Math.max(0, 1 - cdf);
}

/** SPEC 7: FP/GP = Σ proj_s × scoring[s] + PPP, SHP, DEF bonuses + P(G ≥ 3 | Poisson) × HAT. */
export function expectedPoints(l: Lambdas, isD: boolean, scoring: LeagueConfig["scoring"]): number {
  const k = scoring.skater;
  return (
    l.g * k.G +
    l.a * k.A +
    l.pim * k.PIM +
    l.ppp * k.PPP +
    l.shp * k.SHP +
    poissonAtLeast(3, l.g) * k.HAT +
    l.sog * k.SOG +
    l.hit * k.HIT +
    l.blk * k.BLK +
    (isD ? (l.g + l.a) * k.DEF : 0)
  );
}

export function peripheralPoints(l: Lambdas, scoring: LeagueConfig["scoring"]): number {
  const k = scoring.skater;
  return l.sog * k.SOG + l.hit * k.HIT + l.blk * k.BLK + l.pim * k.PIM;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

function binomial(n: number, p: number, rand: () => number): number {
  let x = 0;
  for (let i = 0; i < n; i++) if (rand() < p) x++;
  return x;
}

/**
 * Floor and ceiling (20th / 80th percentile of one game) by simulation. PPP and SHP are drawn
 * from the game's points so they can't exceed them; SOG always includes the goals.
 */
export function simulateRange(
  l: Lambdas,
  isD: boolean,
  scoring: LeagueConfig["scoring"],
  n: number,
  seed: number
): { floor: number; ceiling: number } {
  const rand = mulberry32(seed);
  const pts = l.g + l.a;
  const pPP = pts > 0 ? Math.min(1, l.ppp / pts) : 0;
  const pSH = pts > 0 && pPP < 1 ? Math.min(1, l.shp / pts / (1 - pPP)) : 0;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const g = poisson(l.g, rand);
    const a = poisson(l.a, rand);
    const ppp = binomial(g + a, pPP, rand);
    const shp = binomial(g + a - ppp, pSH, rand);
    out[i] = skaterPoints(
      {
        g,
        a,
        ppp,
        shp,
        sog: g + poisson(Math.max(0, l.sog - l.g), rand),
        hit: poisson(l.hit, rand),
        blk: poisson(l.blk, rand),
        pim: 2 * poisson(l.pim / 2, rand),
      },
      isD,
      scoring
    );
  }
  out.sort();
  return { floor: out[Math.floor(0.2 * (n - 1))], ceiling: out[Math.floor(0.8 * (n - 1))] };
}

/** Rank-based percentile (0-100) of each value within its list; ties share the average rank. */
export function percentiles(values: number[]): number[] {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    const below = lo;
    let eq = 0;
    while (below + eq < n && sorted[below + eq] === v) eq++;
    return n > 1 ? (100 * (below + (eq - 1) / 2)) / (n - 1) : 50;
  });
}

export function letterGrade(pctl: number, letters: [number, string][]): string {
  for (const [min, letter] of letters) if (pctl >= min) return letter;
  return letters[letters.length - 1][1];
}
