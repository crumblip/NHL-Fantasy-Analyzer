import { getDb } from "../lib/db";
import { updateAlertFeed } from "../lib/jobs/feed";

// Rebuilds the alert feed from stored signals, one season at a time (all seasons by default).
const args = process.argv.slice(2);
const i = args.indexOf("--season");
const seasons = i >= 0
  ? [Number(args[i + 1])]
  : (getDb().prepare("SELECT DISTINCT season FROM opportunity_signal ORDER BY season").all() as { season: number }[]).map((r) => r.season);
for (const season of seasons) {
  const r = updateAlertFeed({ season, rebuild: true });
  console.log(`${season}: ${r.added} feed entries`);
}
