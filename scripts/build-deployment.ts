import { buildDeployment } from "../lib/deploy/build";

const args = process.argv.slice(2);
const seasons = args.flatMap((a, i) => (a === "--season" && args[i + 1] ? [Number(args[i + 1])] : []));

const started = Date.now();
const res = buildDeployment(seasons);
console.log(`Built deployment for ${res.games} games in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
