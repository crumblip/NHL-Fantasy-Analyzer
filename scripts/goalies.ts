import { getDb } from "../lib/db";
import { playerNames } from "../lib/names";

export function printGoalieBoard(asOf: string, limit: number) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT o.*, t.abbrev FROM goalie_outputs o LEFT JOIN teams t ON t.id = o.team_id
       WHERE o.as_of_date = ? ORDER BY o.week_fp DESC, o.rest_fp DESC`
    )
    .all(asOf) as any[];
  if (!rows.length) {
    console.log(`No goalie outputs as of ${asOf}.`);
    return;
  }
  const name = playerNames(db);
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  const cols = (c: string[]) =>
    [c[0].padStart(3), c[1].padEnd(22), c[2].padEnd(4), c[3].padStart(6), c[4].padStart(6), c[5].padStart(6), c[6].padStart(6), c[7].padStart(9), c[8].padStart(5), c[9].padStart(5), c[10].padStart(5), c[11].padStart(5), c[12].padStart(6), c[13].padEnd(4), c[14].padEnd(4), c[15].padEnd(4)].join(" ");

  console.log(`\nGoalie board as of ${asOf} — week ${rows[0].week_start} → ${rows[0].week_end}`);
  console.log(cols(["#", "Goalie", "Team", "Starts", "FP/st", "Week", "Share", "floor-ceil", "W%", "SO%", "GA", "SV", "GSAx", "Fant", "Work", "Qual"]));
  rows.slice(0, limit).forEach((r, i) =>
    console.log(
      cols([
        String(i + 1),
        name(r.player_id).slice(0, 22),
        r.abbrev ?? "",
        r.week_starts.toFixed(1),
        r.fp_per_start.toFixed(2),
        r.week_fp.toFixed(1),
        pct(r.proj_start_share),
        `${r.floor_fp.toFixed(1)}-${r.ceiling_fp.toFixed(1)}`,
        pct(r.p_win),
        pct(r.p_so),
        r.proj_ga.toFixed(2),
        r.proj_sv.toFixed(1),
        r.gsax_raw.toFixed(1),
        r.fantasy_grade ?? "-",
        r.workload_grade ?? "-",
        r.quality_grade ?? "-",
      ])
    )
  );
  console.log("\nStarts/Week = projected starts and fantasy points this week; Share = projected start share;");
  console.log("GSAx = goals saved above expected, current + last season. Grades need 5+ games in the window.");
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
  const db = getDb();
  const asOf = opt("--as-of") ?? (db.prepare("SELECT MAX(as_of_date) d FROM goalie_outputs").get() as { d: string }).d;
  printGoalieBoard(asOf, Number(opt("--limit") ?? 40));
}
