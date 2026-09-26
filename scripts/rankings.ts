import { getDb } from "../lib/db";
import { playerNames } from "../lib/names";

export function printRankings(asOf: string, positions: string[], limit: number) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.*, t.abbrev FROM model_outputs m LEFT JOIN teams t ON t.id = m.team_id
       WHERE m.as_of_date = ? ORDER BY m.position, COALESCE(m.rest_fp, 0) DESC, m.proj_fp_gp DESC`
    )
    .all(asOf) as any[];
  const lastGames = db
    .prepare(`SELECT player_id, MAX(game_id) g FROM player_game GROUP BY player_id`)
    .all() as { player_id: number; g: number }[];
  const name = playerNames(db, [...new Set(lastGames.filter((r) => rows.some((x) => x.player_id === r.player_id)).map((r) => r.g))]);
  const arrow = (t: string | null) => (t === "up" ? "↑" : t === "down" ? "↓" : t === "flat" ? "→" : " ");
  const f1 = (x: number | null) => (x === null ? "  -  " : x.toFixed(2).padStart(5));

  for (const pos of positions) {
    const list = rows
      .filter((r) => r.position === pos)
      .sort((a, b) => (b.games_remaining ? b.rest_fp : b.proj_fp_gp) - (a.games_remaining ? a.rest_fp : a.proj_fp_gp))
      .slice(0, limit);
    console.log(`\n${pos} — top ${list.length} (as of ${asOf})`);
    const cols = (c: string[]) =>
      [c[0].padStart(3), c[1].padEnd(22), c[2].padEnd(4), c[3].padStart(5), c[4].padStart(9), c[5].padEnd(4), c[6].padEnd(4), c[7].padEnd(5), c[8].padEnd(4), c[9].padStart(5), c[10].padStart(5), c[11].padStart(5), c[12].padStart(4), c[13].padStart(4), c[14].padStart(4), c[15].padStart(5), " " + c[16]].join(" ");
    console.log(cols(["#", "Player", "Team", "FP/GP", "floor-ceil", "Fant", "Off", "Opp", "Per", "VOR", "G/gp", "A/gp", "SOG", "HIT", "BLK", "PPmin", "note"]));
    list.forEach((r, i) => {
      const note = [r.mismatch, r.alert ? `${r.alert}: ${r.alert_text}` : null, r.promotion_flag ? "in-game promotion" : null, r.new_team ? "new team" : null]
        .filter(Boolean)
        .join("; ");
      console.log(
        cols([
          String(i + 1),
          name(r.player_id).slice(0, 22),
          r.abbrev ?? "",
          f1(r.proj_fp_gp).trim(),
          `${r.floor_fp.toFixed(1)}-${r.ceiling_fp.toFixed(1)}`,
          r.fantasy_grade,
          r.offense_grade,
          `${r.opportunity_grade ?? "-"}${arrow(r.trend)}`,
          r.peripheral_grade,
          r.vor.toFixed(0),
          r.proj_g.toFixed(2),
          r.proj_a.toFixed(2),
          r.proj_sog.toFixed(1),
          r.proj_hit.toFixed(1),
          r.proj_blk.toFixed(1),
          (r.proj_toi_pp / 60).toFixed(1),
          note,
        ])
      );
    });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
  const db = getDb();
  const asOf = opt("--as-of") ?? (db.prepare("SELECT MAX(as_of_date) d FROM model_outputs").get() as { d: string }).d;
  if (!asOf) {
    console.error("No model outputs yet. Run npm run run:models first.");
    process.exit(1);
  }
  const pos = opt("--pos");
  printRankings(asOf, pos ? [pos.toUpperCase()] : ["C", "LW", "RW", "D"], Number(opt("--limit") ?? 30));
}
