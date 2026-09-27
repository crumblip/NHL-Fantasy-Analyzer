import { loadLeagueConfig } from "../lib/config";
import { getDb } from "../lib/db";
import { franchiseOf } from "../lib/models/calendar";
import { projectGoalies } from "../lib/models/goalies";
import { goaliePoints } from "../lib/scoring";
import { printGoalieBoard } from "./goalies";

// Backtest: project as of a mid-season date, then score the rest of that season.
const args = process.argv.slice(2);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
const backtestAsOf = opt("--backtest-as-of") ?? "2025-12-31";
const db = getDb();
const { scoring } = loadLeagueConfig();

const proj = projectGoalies(backtestAsOf);
const fr = new Map(
  (db.prepare("SELECT team_id, abbrev FROM team_seasons").all() as { team_id: number; abbrev: string }[]).map((r) => [
    r.team_id,
    franchiseOf(r.abbrev),
  ])
);
const actual = db
  .prepare(
    `SELECT pg.game_id, pg.player_id, pg.team_id, pg.gs, pg.w, pg.otl, pg.sv, pg.ga, pg.so, pg.fantasy_points
     FROM player_game pg WHERE pg.is_goalie = 1 AND pg.season = ? AND pg.game_date > ?`
  )
  .all(proj.season, backtestAsOf) as any[];

// Predictions indexed by (game, franchise).
const pred = new Map<string, Map<number, (typeof proj.goalies)[number]["games"][number]>>();
for (const g of proj.goalies) {
  for (const x of g.games) {
    const key = `${x.gameId}|${g.team}`;
    const m = pred.get(key) ?? new Map();
    m.set(g.playerId, x);
    pred.set(key, m);
  }
}

let teamGames = 0, correct = 0, covered = 0, logLoss = 0;
const bins = Array.from({ length: 5 }, () => ({ n: 0, p: 0, started: 0 }));
const winPairs: [number, number][] = [];
let gaPred = 0, gaAct = 0, fpPred = 0, fpAct = 0, nStarts = 0;
const perGoalie = new Map<number, { pred: number; act: number; n: number }>();

for (const a of actual.filter((r) => r.gs === 1)) {
  const team = fr.get(a.team_id)!;
  const m = pred.get(`${a.game_id}|${team}`);
  if (!m) continue;
  teamGames++;
  const probs = [...m.entries()];
  const best = probs.sort((x, y) => y[1].pStart - x[1].pStart)[0][0];
  if (best === a.player_id) correct++;
  const pActual = m.get(a.player_id)?.pStart ?? 0;
  logLoss -= Math.log(Math.max(0.01, pActual));
  for (const [gid, x] of m) {
    const b = bins[Math.min(4, Math.floor(x.pStart * 5))];
    b.n++;
    b.p += x.pStart;
    if (gid === a.player_id) b.started++;
  }
  const x = m.get(a.player_id);
  if (!x) continue;
  covered++;
  winPairs.push([x.outcome.pWin, a.w]);
  gaPred += x.outcome.expectedGa;
  gaAct += a.ga;
  fpPred += x.outcome.fantasyPoints;
  fpAct += goaliePoints({ w: a.w, otl: a.otl, sv: a.sv, ga: a.ga, so: a.so }, scoring);
  nStarts++;
  const pg = perGoalie.get(a.player_id) ?? { pred: 0, act: 0, n: 0 };
  pg.pred += x.outcome.fantasyPoints;
  pg.act += a.fantasy_points;
  pg.n++;
  perGoalie.set(a.player_id, pg);
}

const brier = winPairs.reduce((s, [p, y]) => s + (p - y) ** 2, 0) / winPairs.length;
const baseRate = winPairs.reduce((s, [, y]) => s + y, 0) / winPairs.length;
const brierBase = winPairs.reduce((s, [, y]) => s + (baseRate - y) ** 2, 0) / winPairs.length;

// Before the backtest date: each goalie's own FP/start so far that season (the naive forecast).
const before = new Map(
  (
    db
      .prepare(
        `SELECT player_id, AVG(fantasy_points) fp, COUNT(*) n FROM player_game
         WHERE is_goalie = 1 AND gs = 1 AND season = ? AND game_date <= ? GROUP BY player_id`
      )
      .all(proj.season, backtestAsOf) as { player_id: number; fp: number; n: number }[]
  ).map((r) => [r.player_id, r])
);
const corr = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i] - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
};
const qualified = [...perGoalie].filter(([id, g]) => g.n >= 15 && (before.get(id)?.n ?? 0) >= 5);
const actualFp = qualified.map(([, g]) => g.act / g.n);
const modelFp = qualified.map(([, g]) => g.pred / g.n);
const naiveFp = qualified.map(([id]) => before.get(id)!.fp);

console.log(`== Goalie backtest: projected as of ${backtestAsOf}, scored on the rest of ${proj.season}`);
console.log(`  Back-to-back effect learned from history: primary goalie starts ×${proj.b2b.primaryB2b.toFixed(2)} as often on the 2nd night, backups ×${proj.b2b.backupB2b.toFixed(2)}.`);
console.log(`  Starter prediction: ${teamGames} team-games, most-likely goalie started ${(100 * correct / teamGames).toFixed(1)}%. Actual starter in the projected pool: ${(100 * covered / teamGames).toFixed(1)}%. Log loss ${(logLoss / teamGames).toFixed(3)}.`);
console.log("  Start-probability calibration (predicted → actual start rate):");
bins.forEach((b, i) => b.n && console.log(`    ${(i * 20).toString().padStart(3)}–${((i + 1) * 20).toString().padEnd(3)}%  ${(100 * b.p / b.n).toFixed(0).padStart(3)}% → ${(100 * b.started / b.n).toFixed(0).padStart(3)}%   (${b.n})`));
console.log(`  Win probability for the actual starter: Brier ${brier.toFixed(4)} vs ${brierBase.toFixed(4)} for a constant ${(100 * baseRate).toFixed(1)}% (${(100 * (1 - brier / brierBase)).toFixed(1)}% better), ${winPairs.length} starts.`);
console.log(`  Per start, predicted vs actual: GA ${(gaPred / nStarts).toFixed(2)} vs ${(gaAct / nStarts).toFixed(2)}, fantasy points ${(fpPred / nStarts).toFixed(2)} vs ${(fpAct / nStarts).toFixed(2)}.`);
console.log(`  Goalies with 15+ starts after the date (${qualified.length}): correlation of FP/start with actual — model ${corr(modelFp, actualFp).toFixed(2)}, naive season-to-date ${corr(naiveFp, actualFp).toFixed(2)}.`);
const rmse = (xs: number[]) => Math.sqrt(xs.reduce((s, x, i) => s + (x - actualFp[i]) ** 2, 0) / xs.length);
console.log(`  RMSE of FP/start: model ${rmse(modelFp).toFixed(2)}, naive ${rmse(naiveFp).toFixed(2)}.`);

const asOf = opt("--as-of") ?? (db.prepare("SELECT MAX(as_of_date) d FROM goalie_outputs").get() as { d: string }).d;
if (asOf) printGoalieBoard(asOf, 40);
