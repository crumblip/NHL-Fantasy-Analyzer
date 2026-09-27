import { listSeasons } from "../lib/ingest";
import { fetchStats } from "../lib/nhl/http";
import { ingestDraft, ingestDraftedLandings, ingestNhlSeasons } from "../lib/prospects/ingest";

const FIRST_DRAFT = 2005;
const FIRST_NHL_SEASON = 20052006; // hits and blocks are tracked from 2005-06

async function main() {
  const started = Date.now();
  const current = (await listSeasons()).slice(-1)[0].id;
  const lastDraft = new Date().getUTCFullYear();
  const years = Array.from({ length: lastDraft - FIRST_DRAFT + 1 }, (_, i) => FIRST_DRAFT + i);
  const seasons: number[] = [];
  for (let s = FIRST_NHL_SEASON; s < current; s += 10001) seasons.push(s);

  console.log(`== Drafts ${FIRST_DRAFT}-${lastDraft}`);
  await ingestDraft(years);
  console.log("== NHL season totals (outcomes)");
  await ingestNhlSeasons(seasons, current);
  console.log("== Drafted skaters' landing pages (all-league season totals)");
  await ingestDraftedLandings();

  const s = fetchStats();
  console.log(`\nDone in ${((Date.now() - started) / 60000).toFixed(1)} min: ${s.network} requests, ${s.cached} cache hits, ${s.retries} retries.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
