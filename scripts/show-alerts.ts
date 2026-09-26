import { getDb } from "../lib/db";
import { playerNames } from "../lib/names";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const db = getDb();
const asOf =
  opt("--date") ??
  (db.prepare("SELECT MAX(as_of_date) d FROM opportunity_signal").get() as { d: string | null }).d;
if (!asOf) {
  console.error("No opportunity signals yet. Run npm run build:deployment first.");
  process.exit(1);
}
const limit = Number(opt("--limit") ?? 20);

// Each player's latest signal on or before the date, within the date's season.
const latest = db
  .prepare(
    `WITH ranked AS (
       SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.as_of_date DESC, s.game_id DESC) rn
       FROM opportunity_signal s
       WHERE s.as_of_date <= ? AND s.season = (SELECT MAX(season) FROM opportunity_signal WHERE as_of_date <= ?)
     )
     SELECT r.*, t.abbrev FROM ranked r LEFT JOIN teams t ON t.id = r.team_id WHERE rn = 1`
  )
  .all(asOf, asOf) as any[];
const name = playerNames(db, [...new Set(latest.map((r) => r.game_id as number))]);

const line = (r: any) =>
  `  ${name(r.player_id).padEnd(24)} ${String(r.abbrev ?? "").padEnd(4)} ${r.position}  delta ${r.opportunity_delta >= 0 ? "+" : ""}${r.opportunity_delta.toFixed(2)}  (as of ${r.as_of_date})  ${r.alert_text ?? ""}`;

console.log(`\nAs of ${asOf}`);
const pickups = latest.filter((r) => r.alert === "pickup").sort((a, b) => b.opportunity_delta - a.opportunity_delta);
console.log(`\nPickup alerts (${pickups.length})`);
pickups.slice(0, limit).forEach((r) => console.log(line(r)));

const downgrades = latest.filter((r) => r.alert === "downgrade").sort((a, b) => a.opportunity_delta - b.opportunity_delta);
console.log(`\nDowngrade alerts, rostered-quality players (${downgrades.length})`);
downgrades.slice(0, limit).forEach((r) => console.log(line(r)));

const promos = latest.filter((r) => r.promotion_flag).sort((a, b) => b.promotion_games - a.promotion_games);
console.log(`\nIn-game promotion badge (${promos.length})`);
promos
  .slice(0, limit)
  .forEach((r) =>
    console.log(`  ${name(r.player_id).padEnd(24)} ${String(r.abbrev ?? "").padEnd(4)} ${r.position}  late-game promotion in ${r.promotion_games} of last 5 games`)
  );
