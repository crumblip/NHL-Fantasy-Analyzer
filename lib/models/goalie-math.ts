import type { LeagueConfig } from "../config";
import { goaliePoints } from "../scoring";

const MAX_GOALS = 15;

export function poissonPmf(lambda: number, max = MAX_GOALS): number[] {
  const out = new Array(max + 1).fill(0);
  let p = Math.exp(-lambda);
  for (let k = 0; k <= max; k++) {
    out[k] = p;
    p *= lambda / (k + 1);
  }
  return out;
}

/**
 * Joint distribution of (goals for, goals against) in regulation from two Poissons, with the
 * diagonal rescaled so ties happen as often as they really do (independent Poissons give ~13%,
 * the NHL is ~22%). Off-diagonal cells keep their relative weights.
 */
export function scoreMatrix(lambdaGf: number, lambdaGa: number, tieShare: number): number[][] {
  const gf = poissonPmf(lambdaGf);
  const ga = poissonPmf(lambdaGa);
  const m = gf.map((pf) => ga.map((pa) => pf * pa));
  let tie = 0;
  let total = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      total += m[i][j];
      if (i === j) tie += m[i][j];
    }
  }
  tie /= total;
  const diag = tie > 0 ? tieShare / tie : 1;
  const off = tie < 1 ? (1 - tieShare) / (1 - tie) : 1;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) m[i][j] = (m[i][j] / total) * (i === j ? diag : off);
  }
  return m;
}

export interface StartOutcome {
  pWin: number;
  pOtl: number;
  pLoss: number;
  pShutout: number;
  expectedGa: number;
  expectedSaves: number;
  fantasyPoints: number;
}

export interface StartCalibration {
  /** Share of the team's saves the starter makes (starters get pulled or relieved). */
  saveShare?: number;
  /** Multiplier on the model's shutout probability to match the league's real rate. */
  shutoutCalibration?: number;
}

/** SPEC 8: per start = W×3.25 + OTL×0.5 + SV×0.15 − GA×0.5 + P(SO)×4 (values from league.yaml). */
export function startOutcome(
  lambdaGf: number,
  lambdaGa: number,
  expectedShotsOnGoal: number,
  tieShare: number,
  otWinShare: number,
  scoring: LeagueConfig["scoring"],
  cal: StartCalibration = {}
): StartOutcome {
  const m = scoreMatrix(lambdaGf, lambdaGa, tieShare);
  let win = 0;
  let tie = 0;
  let shutout = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      if (i > j) win += m[i][j];
      if (i === j) tie += m[i][j];
      if (j === 0 && i > 0) shutout += m[i][j];
    }
  }
  // A 0-0 game decided in the shootout still counts as a shutout win.
  shutout += otWinShare * m[0][0];
  shutout = Math.min(1, shutout * (cal.shutoutCalibration ?? 1));
  const pWin = win + otWinShare * tie;
  const pOtl = (1 - otWinShare) * tie;
  const expectedSaves = Math.max(0, expectedShotsOnGoal - lambdaGa) * (cal.saveShare ?? 1);
  const fantasyPoints = goaliePoints({ w: pWin, otl: pOtl, sv: expectedSaves, ga: lambdaGa, so: shutout }, scoring);
  return {
    pWin,
    pOtl,
    pLoss: 1 - pWin - pOtl,
    pShutout: shutout,
    expectedGa: lambdaGa,
    expectedSaves,
    fantasyPoints,
  };
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
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

/** 20th / 80th percentile of one start, drawing the scoreline from the same matrix. */
export function simulateStart(
  lambdaGf: number,
  lambdaGa: number,
  expectedShotsOnGoal: number,
  tieShare: number,
  otWinShare: number,
  scoring: LeagueConfig["scoring"],
  n: number,
  seed: number,
  cal: StartCalibration = {}
): { floor: number; ceiling: number } {
  const m = scoreMatrix(lambdaGf, lambdaGa, tieShare);
  const cells: { i: number; j: number; cum: number }[] = [];
  let cum = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      cum += m[i][j];
      cells.push({ i, j, cum });
    }
  }
  const rand = mulberry32(seed);
  const expectedSaves = Math.max(0, expectedShotsOnGoal - lambdaGa) * (cal.saveShare ?? 1);
  const soKeep = Math.min(1, cal.shutoutCalibration ?? 1);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const u = rand() * cum;
    let lo = 0;
    let hi = cells.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cells[mid].cum < u) lo = mid + 1;
      else hi = mid;
    }
    const { i, j } = cells[lo];
    const tieWin = i === j && rand() < otWinShare;
    const w = i > j || tieWin ? 1 : 0;
    const otl = i === j && !tieWin ? 1 : 0;
    const so = w && j === 0 && rand() < soKeep ? 1 : 0;
    out[k] = goaliePoints({ w, otl, sv: poisson(expectedSaves, rand), ga: j, so }, scoring);
  }
  out.sort();
  return { floor: out[Math.floor(0.2 * (n - 1))], ceiling: out[Math.floor(0.8 * (n - 1))] };
}
