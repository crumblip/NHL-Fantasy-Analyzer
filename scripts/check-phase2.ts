import { getDb } from "../lib/db";

const TOI_TOLERANCE = 10;
const TOI_TARGET = 0.98;
const SITUATION_TARGET = 0.99;

const db = getDb();
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
let failed = false;

const games = (db.prepare("SELECT COUNT(DISTINCT game_id) n FROM player_game").get() as any).n;
console.log(`Derived games: ${games}\n`);

console.log("== situationCode agreement (derived timeline vs NHL)");
const sit = db
  .prepare(
    `SELECT COUNT(*) n, SUM(situation_code = derived_situation_code) ok FROM events
     WHERE situation_code IS NOT NULL`
  )
  .get() as { n: number; ok: number };
const sitRate = sit.ok / sit.n;
console.log(`  ${sit.ok}/${sit.n} events agree: ${pct(sitRate)} (target > ${pct(SITUATION_TARGET)})`);
if (sitRate <= SITUATION_TARGET) failed = true;
const sitMiss = db
  .prepare(
    `SELECT situation_code nhl, derived_situation_code ours, COUNT(*) n FROM events
     WHERE situation_code IS NOT NULL AND situation_code != derived_situation_code
     GROUP BY 1, 2 ORDER BY n DESC LIMIT 12`
  )
  .all() as any[];
for (const m of sitMiss) console.log(`    NHL ${m.nhl} vs ours ${m.ours}: ${m.n}`);

console.log(`\n== Skater TOI by strength vs official (±${TOI_TOLERANCE}s)`);
const tol = TOI_TOLERANCE;
const toi = db
  .prepare(
    `SELECT COUNT(*) n,
       SUM(ABS(toi - official_toi) <= ${tol}) total_ok,
       SUM(ABS(toi_ev - official_ev) <= ${tol}) ev_ok,
       SUM(ABS(toi_pp - official_pp) <= ${tol}) pp_ok,
       SUM(ABS(toi_sh - official_sh) <= ${tol}) sh_ok,
       SUM(ABS(toi - official_toi) <= ${tol} AND ABS(toi_ev - official_ev) <= ${tol}
           AND ABS(toi_pp - official_pp) <= ${tol} AND ABS(toi_sh - official_sh) <= ${tol}) all_ok
     FROM player_game WHERE is_goalie = 0 AND official_toi IS NOT NULL`
  )
  .get() as Record<string, number>;
console.log(`  ${toi.n} skater-games with official TOI`);
for (const k of ["total", "ev", "pp", "sh"]) console.log(`    ${k.padEnd(5)} ${pct(toi[`${k}_ok`] / toi.n)}`);
const toiRate = toi.all_ok / toi.n;
console.log(`  all four within tolerance: ${pct(toiRate)} (target ≥ ${pct(TOI_TARGET)})`);
if (!(toiRate >= TOI_TARGET)) failed = true;

const missingOfficial = (
  db.prepare("SELECT COUNT(*) n FROM player_game WHERE is_goalie = 0 AND official_toi IS NULL").get() as any
).n;
if (missingOfficial) console.log(`  (${missingOfficial} skater-games had no official TOI row)`);

const outliers = db
  .prepare(
    `SELECT pg.game_id, pg.player_id, p.full_name, pg.toi - pg.official_toi d_total,
       pg.toi_ev - pg.official_ev d_ev, pg.toi_pp - pg.official_pp d_pp, pg.toi_sh - pg.official_sh d_sh
     FROM player_game pg LEFT JOIN players p ON p.id = pg.player_id
     WHERE pg.is_goalie = 0 AND pg.official_toi IS NOT NULL
       AND MAX(ABS(pg.toi - pg.official_toi), ABS(pg.toi_ev - pg.official_ev),
               ABS(pg.toi_pp - pg.official_pp), ABS(pg.toi_sh - pg.official_sh)) > ${tol}
     ORDER BY MAX(ABS(pg.toi - pg.official_toi), ABS(pg.toi_ev - pg.official_ev),
                  ABS(pg.toi_pp - pg.official_pp), ABS(pg.toi_sh - pg.official_sh)) DESC
     LIMIT 15`
  )
  .all() as any[];
if (outliers.length) {
  console.log("  Largest outliers (ours − official, seconds):");
  for (const o of outliers) {
    console.log(
      `    ${o.game_id} ${String(o.full_name ?? o.player_id).padEnd(22)} total ${o.d_total} ev ${o.d_ev} pp ${o.d_pp} sh ${o.d_sh}`
    );
  }
}
const outlierGames = db
  .prepare(
    `SELECT game_id, COUNT(*) n FROM player_game
     WHERE is_goalie = 0 AND official_toi IS NOT NULL
       AND MAX(ABS(toi - official_toi), ABS(toi_ev - official_ev), ABS(toi_pp - official_pp), ABS(toi_sh - official_sh)) > ${tol}
     GROUP BY game_id ORDER BY n DESC LIMIT 10`
  )
  .all() as any[];
if (outlierGames.length) {
  console.log(`  Games with the most outliers: ${outlierGames.map((g) => `${g.game_id} (${g.n})`).join(", ")}`);
}

console.log("\n== Cross-checks");
const shiftVsBox = db
  .prepare(
    `SELECT COUNT(*) n, SUM(ABS(toi - boxscore_toi) <= ${tol}) ok FROM player_game WHERE boxscore_toi > 0`
  )
  .get() as any;
console.log(`  shift-summed TOI vs boxscore TOI within ±${tol}s: ${pct(shiftVsBox.ok / shiftVsBox.n)}`);
const ppg = db
  .prepare(
    `SELECT COUNT(*) n, SUM(ppg = boxscore_ppg) ok, SUM(boxscore_ppg) official, SUM(ppg) ours
     FROM player_game WHERE is_goalie = 0 AND boxscore_ppg IS NOT NULL`
  )
  .get() as any;
console.log(
  `  power-play goals, ours vs boxscore: ${pct(ppg.ok / ppg.n)} of skater-games match (${ppg.ours} vs ${ppg.official} total)`
);

console.log(failed ? "\nPhase 2 acceptance: FAIL" : "\nPhase 2 acceptance: PASS (fantasy-point unit tests: npm test)");
process.exit(failed ? 1 : 0);
