import { getDb } from "../lib/db";
import { playerNames } from "../lib/names";

export function printProspectBoard(asOf: string, limit: number, position?: string) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM prospect_outputs WHERE as_of_date = ? ${position ? "AND position = ?" : ""}
       ORDER BY expected_peak_fpg DESC LIMIT ?`
    )
    .all(...(position ? [asOf, position, limit] : [asOf, limit])) as any[];
  const name = playerNames(db);
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  const cols = (c: string[]) =>
    [c[0].padStart(3), c[1].padEnd(24), c[2].padEnd(2), c[3].padStart(4), c[4].padStart(9), c[5].padEnd(14), c[6].padStart(5), c[7].padStart(5), c[8].padStart(5), c[9].padStart(5), c[10].padStart(5), c[11].padStart(5), c[12].padStart(5), c[13].padEnd(3), c[14].padEnd(6), " " + c[15]].join(" ");
  console.log(`\nProspect board as of ${asOf}${position ? ` (${position})` : ""}`);
  console.log(cols(["#", "Prospect", "P", "Age", "Draft", "League", "NHLe", "Peak", "P200", "P50", "P70", "xFPG", "medFP", "Gr", "Risk", "closest comparables"]));
  rows.forEach((r, i) => {
    const comps = JSON.parse(r.comparables) as { id: number; peakFpg: number }[];
    console.log(
      cols([
        String(i + 1),
        name(r.player_id).slice(0, 24),
        r.position,
        r.age.toFixed(1),
        r.draft_year ? `${r.draft_year} #${r.draft_overall}` : "undrafted",
        String(r.league).slice(0, 14),
        r.nhle_ppg.toFixed(2),
        r.peak_nhle_ppg.toFixed(2),
        pct(r.p_regular),
        pct(r.p_peak50),
        pct(r.p_peak70),
        r.expected_peak_fpg.toFixed(2),
        r.median_peak_fpg.toFixed(2),
        r.grade,
        r.risk,
        comps.slice(0, 3).map((c) => `${name(c.id)} (${c.peakFpg.toFixed(1)})`).join(", "),
      ])
    );
  });
  console.log("\nNHLe = league-translated points per game in the snapshot season; Peak = projected to age 25.");
  console.log("P200 / P50 / P70 = share of the 25 comparables with 200+ NHL games / a 50-point / a 70-point season.");
  console.log("xFPG = expected peak fantasy points per game (busts count as 0); medFP = median. Comparables show their peak FP/GP.");
}

export function printProspect(asOf: string, playerId: number) {
  const db = getDb();
  const r = db.prepare("SELECT * FROM prospect_outputs WHERE as_of_date = ? AND player_id = ?").get(asOf, playerId) as any;
  if (!r) return console.log(`No prospect output for ${playerId} as of ${asOf}.`);
  const name = playerNames(db);
  console.log(`\n${name(playerId)} (${r.position}, age ${r.age.toFixed(1)}), ${r.league} ${r.snapshot_season}: NHLe ${r.nhle_ppg.toFixed(2)} → peak ${r.peak_nhle_ppg.toFixed(2)} PPG`);
  console.log(`Grade ${r.grade} (risk ${r.risk}). P(200 GP) ${Math.round(100 * r.p_regular)}%, P(50-pt season) ${Math.round(100 * r.p_peak50)}%, P(70) ${Math.round(100 * r.p_peak70)}%, expected peak ${r.expected_peak_fpg.toFixed(2)} FP/GP.`);
  console.log("Comparables (snapshot at the same age):");
  for (const c of JSON.parse(r.comparables)) {
    console.log(`  ${name(c.id).padEnd(24)} ${c.league.padEnd(12)} ${c.season}  NHLe ${c.nhle.toFixed(2)}  draft #${c.draft ?? "-"}  → ${c.gp} NHL GP, peak ${c.peakPts} pts, ${c.peakFpg.toFixed(2)} FP/GP`);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
  const db = getDb();
  const asOf = opt("--as-of") ?? (db.prepare("SELECT MAX(as_of_date) d FROM prospect_outputs").get() as { d: string }).d;
  if (opt("--player")) printProspect(asOf, Number(opt("--player")));
  else printProspectBoard(asOf, Number(opt("--limit") ?? 30), opt("--pos")?.toUpperCase());
}
