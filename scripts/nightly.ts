import fs from "fs";
import path from "path";
import { DATA_DIR } from "../lib/db";
import { runNightly } from "../lib/jobs/nightly";

const USAGE = `Usage: npm run nightly [-- --as-of YYYY-MM-DD] [--force-xg] [--force-prospects]
  Fetches new games, rebuilds derived data, deployment and alerts, and refreshes projections.
  Logs to data/logs/nightly-<date>.log. Safe to rerun; only new data is fetched.`;

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}
const i = args.indexOf("--as-of");
// Local date: the job runs in the morning after the night's games.
const asOf = i >= 0 ? args[i + 1] : new Date().toLocaleDateString("en-CA");

const logDir = path.join(DATA_DIR, "logs");
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `nightly-${asOf}.log`);
const log = (line: string) => {
  console.log(line);
  fs.appendFileSync(logFile, `${line}\n`);
};

log(`Nightly run started ${new Date().toISOString()} (as of ${asOf})`);
runNightly({ asOf, forceXg: args.includes("--force-xg"), forceProspects: args.includes("--force-prospects"), log })
  .then((r) => process.exit(r.status === "ok" || r.status === "locked" ? 0 : 1))
  .catch((err) => {
    log(String(err?.stack ?? err));
    process.exit(1);
  });
