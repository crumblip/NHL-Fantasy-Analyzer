import { runGoalies } from "../lib/models/goalies";
import { runProjections } from "../lib/models/run";
import { trainXg } from "../lib/models/xg";

const USAGE = `Usage: npm run run:models [-- --as-of YYYY-MM-DD] [--skip-xg]
  Trains the xG model (and scores every shot), then computes talent, projections and grades
  as of the date (default: today). Run build:derived and build:deployment first.`;

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}
const i = args.indexOf("--as-of");
const asOf = i >= 0 ? args[i + 1] : new Date().toISOString().slice(0, 10);

const started = Date.now();
if (!args.includes("--skip-xg")) {
  console.log("== xG model");
  const r = trainXg();
  console.log(
    `  held-out ${r.testSeason}: log loss ${r.logLoss.toFixed(4)} (baseline ${r.baselineLogLoss.toFixed(4)}), AUC ${r.auc.toFixed(3)}, ${r.testShots} shots`
  );
  console.log(`  final model: ${r.finalShots} shots, goal rate ${(100 * r.goalRate).toFixed(2)}%`);
}
console.log(`== Projections and grades as of ${asOf}`);
const res = runProjections(asOf);
console.log(`  season ${res.season}: ${res.players} skaters projected`);
const gl = runGoalies(asOf);
console.log(`  ${gl.goalies} goalies projected (${gl.graded} graded)`);
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
