import { getDb } from "../lib/db";
import { backtestProspects } from "../lib/prospects/model";
import { printProspectBoard } from "./prospects";

const db = getDb();

console.log("== League translation factors (NHLe, 90% bootstrap interval)");
const factors = db
  .prepare("SELECT * FROM league_factors ORDER BY observations DESC LIMIT 40")
  .all() as any[];
if (factors.length) console.log(`  fitted on seasons through ${factors[0].fitted_through}; ${(db.prepare("SELECT COUNT(*) n FROM league_factors").get() as any).n} leagues in total`);
console.log("  League                  factor   90% CI          linked seasons  direct→NHL");
for (const f of factors) {
  console.log(
    `  ${String(f.league).padEnd(22)} ${f.factor.toFixed(3).padStart(6)}   ${f.ci_low.toFixed(3)}–${f.ci_high.toFixed(3)}   ${String(f.observations).padStart(8)}   ${String(f.direct_to_nhl).padStart(8)}`
  );
}

console.log("\n== Age curve: expected change in translated PPG from this age to the next");
const curve = db.prepare("SELECT * FROM age_curve WHERE age BETWEEN 16 AND 28 ORDER BY age, position_group").all() as any[];
for (let age = 16; age <= 28; age++) {
  const f = curve.find((c) => c.age === age && c.position_group === "F");
  const d = curve.find((c) => c.age === age && c.position_group === "D");
  const pc = (x: any) => (x ? `${x.log_growth >= 0 ? "+" : ""}${(100 * (Math.exp(x.log_growth) - 1)).toFixed(0)}%` : "-");
  console.log(`  ${age} → ${age + 1}:  F ${pc(f).padStart(5)}   D ${pc(d).padStart(5)}`);
}

console.log("\n== Backtest (SPEC 10.8)");
const bt = backtestProspects();
console.log(`  Factors fitted on seasons through ${bt.factorsFittedThrough}; comparables from drafts through the training cutoff.`);
console.log(`  Evaluated ${bt.evaluated} drafted skaters from their draft-year season (${bt.missing} had no usable draft-year season).`);
console.log(`  Rank correlation with actual peak fantasy PPG: model ${bt.spearmanModel.toFixed(3)} vs draft position ${bt.spearmanDraft.toFixed(3)}.`);
console.log(`  First-round picks only: model ${bt.spearmanModelFirstRound.toFixed(3)} vs draft position ${bt.spearmanDraftFirstRound.toFixed(3)}.`);
console.log(`  P(200+ GP): predicted ${(100 * bt.predictedRegularRate).toFixed(1)}% vs actual ${(100 * bt.regularRate).toFixed(1)}%. Brier ${bt.brierRegular.toFixed(4)} vs ${bt.brierRegularBase.toFixed(4)} for the base rate.`);

const asOf = (db.prepare("SELECT MAX(as_of_date) d FROM prospect_outputs").get() as { d: string | null }).d;
if (asOf) printProspectBoard(asOf, 30);
