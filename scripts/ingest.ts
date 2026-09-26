import { ingestSeasons, listSeasons } from "../lib/ingest";
import { fetchStats } from "../lib/nhl/http";

const USAGE = `Usage:
  npm run ingest:all                      current season + 3 prior
  npm run ingest:yesterday                current season only (picks up newly finished games)
  npm run ingest:season -- --season 20252026 [--season 20242025]
Options:
  --limit-games N    only process N pending games and N TOI dates (for testing)
  --skip-players     skip player landing pages`;

function argValues(args: string[], name: string): string[] {
  return args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
}

async function main() {
  const args = process.argv.slice(2);
  const all = await listSeasons();

  let seasons;
  if (args.includes("--all")) seasons = all.slice(-4);
  else if (args.includes("--current")) seasons = all.slice(-1);
  else {
    const ids = argValues(args, "--season").map(Number);
    seasons = all.filter((s) => ids.includes(s.id));
    if (seasons.length === 0 || seasons.length !== ids.length) {
      console.error(USAGE);
      process.exit(1);
    }
  }

  const limit = argValues(args, "--limit-games")[0];
  const started = Date.now();
  await ingestSeasons(seasons, {
    limitGames: limit ? Number(limit) : undefined,
    skipPlayers: args.includes("--skip-players"),
  });

  const s = fetchStats();
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\nDone in ${mins} min: ${s.network} requests, ${s.cached} cache hits, ${s.retries} retries.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
