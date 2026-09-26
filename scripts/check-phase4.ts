import { getDb } from "../lib/db";
import { playerNames } from "../lib/names";
import type { XgReport } from "../lib/models/xg";
import { printRankings } from "./rankings";

const args = process.argv.slice(2);
const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
const db = getDb();

const xg = db.prepare("SELECT metrics, trained_at FROM model_params WHERE name = 'xg'").get() as
  | { metrics: string; trained_at: string }
  | undefined;
if (xg) {
  const r = JSON.parse(xg.metrics) as XgReport;
  console.log(`== xG model (trained ${xg.trained_at})`);
  console.log(`  Evaluation: trained on ${r.trainSeasons.join(", ")}, scored on held-out ${r.testSeason} (${r.testShots} unblocked shots, goalie in net)`);
  console.log(`  Log loss ${r.logLoss.toFixed(4)} vs ${r.baselineLogLoss.toFixed(4)} for a constant rate (${(100 * (1 - r.logLoss / r.baselineLogLoss)).toFixed(1)}% better). AUC ${r.auc.toFixed(3)}.`);
  console.log("  Calibration (deciles of predicted xG):  predicted → observed goal rate");
  for (const c of r.calibration) {
    console.log(`    ${String(c.bin).padStart(2)}  ${(100 * c.predicted).toFixed(1).padStart(5)}% → ${(100 * c.observed).toFixed(1).padStart(5)}%   (${c.n} shots)`);
  }
  console.log(`  Final fit on all ${r.finalShots} shots. Empty-net conversion ${(100 * r.emptyNetRate).toFixed(1)}%, penalty shots ${(100 * r.penaltyShotRate).toFixed(1)}%.`);
}

const asOf = opt("--as-of") ?? (db.prepare("SELECT MAX(as_of_date) d FROM model_outputs").get() as { d: string }).d;
printRankings(asOf, ["C", "LW", "RW", "D"], 30);

// Top 20 alerts: the most recent in-season signals, by Opportunity Delta then Fantasy Grade.
const alertDate =
  opt("--alerts-as-of") ??
  (db.prepare("SELECT MAX(as_of_date) d FROM opportunity_signal WHERE as_of_date <= ?").get(asOf) as { d: string }).d;
const alerts = db
  .prepare(
    `WITH latest AS (
       SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.as_of_date DESC) rn
       FROM opportunity_signal s
       WHERE s.as_of_date <= ? AND s.season = (SELECT season FROM opportunity_signal WHERE as_of_date <= ? ORDER BY as_of_date DESC LIMIT 1))
     SELECT l.*, t.abbrev, m.fantasy_grade, m.fantasy_pctl FROM latest l
     LEFT JOIN teams t ON t.id = l.team_id
     LEFT JOIN model_outputs m ON m.player_id = l.player_id AND m.as_of_date = ?
     WHERE l.rn = 1 AND l.alert IS NOT NULL
     ORDER BY ABS(l.opportunity_delta) DESC, COALESCE(m.fantasy_pctl, 0) DESC LIMIT 20`
  )
  .all(alertDate, alertDate, asOf) as any[];
const name = playerNames(db, [...new Set(alerts.map((a) => a.game_id as number))]);
console.log(`\n== Top 20 alerts (latest in-season signals as of ${alertDate}; fantasy grade as of ${asOf})`);
for (const a of alerts) {
  console.log(
    `  ${a.alert.padEnd(9)} ${name(a.player_id).padEnd(24)} ${String(a.abbrev ?? "").padEnd(4)} ${a.position}  delta ${a.opportunity_delta >= 0 ? "+" : ""}${a.opportunity_delta.toFixed(2)}  grade ${a.fantasy_grade ?? "-"}  ${a.alert_text}`
  );
}
