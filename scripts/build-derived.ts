import { buildDerived } from "../lib/derive/build";

const USAGE = `Usage:
  npm run build:derived                        build games not yet derived
  npm run build:derived -- --rebuild           rebuild every game
  npm run build:derived -- --season 20252026   limit to a season (repeatable)
  npm run build:derived -- --limit 50          only the first N games`;

const args = process.argv.slice(2);
const values = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));

if (args.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}

const started = Date.now();
const res = buildDerived({
  rebuild: args.includes("--rebuild"),
  seasons: values("--season").map(Number),
  limit: values("--limit")[0] ? Number(values("--limit")[0]) : undefined,
});
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`Built ${res.built} of ${res.total} games in ${secs}s${res.skipped ? `, ${res.skipped} skipped (raw data missing)` : ""}.`);
