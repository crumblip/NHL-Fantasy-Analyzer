import { runProspects } from "../lib/prospects/model";

const args = process.argv.slice(2);
const i = args.indexOf("--as-of");
const asOf = i >= 0 ? args[i + 1] : new Date().toISOString().slice(0, 10);
const started = Date.now();
const res = runProspects(asOf);
console.log(
  `Prospects as of ${asOf}: ${res.leagues} leagues translated (data through ${res.maxSeason}), ` +
    `${res.pool} historical snapshots, ${res.prospects} prospects graded in ${((Date.now() - started) / 1000).toFixed(1)}s.`
);
