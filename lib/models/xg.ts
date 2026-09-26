import { getDb } from "../db";
import { auc, calibration, fitLogistic, logLoss, predictLogistic, type LogitModel } from "./logistic";

const SHOT_TYPES = ["snap", "slap", "backhand", "tip-in", "deflected", "wrap-around"]; // baseline: wrist
const PENALTY_SHOT = new Set(["0101", "1010"]);

export const XG_FEATURES = [
  "distance",
  "distance_sq",
  "log_distance",
  "angle",
  "angle_sq",
  "behind_net",
  "rebound",
  "rush",
  "rebound_x_distance",
  "pp",
  "sh",
  ...SHOT_TYPES.map((t) => `type_${t}`),
  "type_other",
];

export interface ShotRow {
  game_id: number;
  event_id: number;
  season: number;
  type: string;
  shot_type: string | null;
  shot_distance: number;
  shot_angle: number;
  is_rebound: number;
  is_rush: number;
  strength: string | null;
  situation_code: string | null;
  empty_net: number;
}

export function xgFeatures(s: ShotRow): number[] {
  const d = s.shot_distance;
  const a = s.shot_angle;
  const type = s.shot_type ?? "";
  return [
    d,
    (d * d) / 100,
    Math.log(d + 1),
    a,
    (a * a) / 100,
    a > 90 ? 1 : 0,
    s.is_rebound,
    s.is_rush,
    s.is_rebound * d,
    s.strength === "PP" ? 1 : 0,
    s.strength === "SH" ? 1 : 0,
    ...SHOT_TYPES.map((t) => (type === t ? 1 : 0)),
    type && type !== "wrist" && !SHOT_TYPES.includes(type) ? 1 : 0,
  ];
}

/** Unblocked attempts with a goalie in net, excluding penalty shots: what the model is trained on. */
const isModelShot = (s: ShotRow) => !s.empty_net && !PENALTY_SHOT.has(s.situation_code ?? "");

function matrix(rows: ShotRow[]) {
  const k = XG_FEATURES.length;
  const X = new Float64Array(rows.length * k);
  const y = new Uint8Array(rows.length);
  rows.forEach((r, i) => {
    X.set(xgFeatures(r), i * k);
    y[i] = r.type === "goal" ? 1 : 0;
  });
  return { X, y };
}

export interface XgReport {
  trainSeasons: number[];
  testSeason: number;
  testShots: number;
  logLoss: number;
  baselineLogLoss: number;
  auc: number;
  calibration: { bin: number; n: number; predicted: number; observed: number }[];
  finalShots: number;
  goalRate: number;
  emptyNetRate: number;
  penaltyShotRate: number;
  coefficients: Record<string, number>;
}

export function trainXg(): XgReport {
  const db = getDb();
  const shots = db
    .prepare(
      `SELECT e.game_id, e.event_id, g.season, e.type, e.shot_type, e.shot_distance, e.shot_angle,
         e.is_rebound, e.is_rush, e.strength, e.situation_code, COALESCE(e.empty_net, 0) empty_net
       FROM events e JOIN games g ON g.id = e.game_id
       WHERE e.type IN ('goal', 'shot-on-goal', 'missed-shot') AND e.shot_distance IS NOT NULL`
    )
    .all() as ShotRow[];
  if (!shots.length) throw new Error("No shots with geometry. Run npm run build:derived -- --rebuild first.");

  const seasons = [...new Set(shots.map((s) => s.season))].sort();
  const modelShots = shots.filter(isModelShot);

  // Honest evaluation: fit on earlier seasons, score the most recent one.
  const testSeason = seasons[seasons.length - 1];
  const train = modelShots.filter((s) => s.season !== testSeason);
  const test = modelShots.filter((s) => s.season === testSeason);
  const tr = matrix(train);
  const evalFit = train.length ? fitLogistic(tr.X, tr.y, XG_FEATURES) : null;
  const t = matrix(test);
  const k = XG_FEATURES.length;
  const pTest = evalFit
    ? Float64Array.from({ length: test.length }, (_, i) => predictLogistic(evalFit, t.X.subarray(i * k, (i + 1) * k)))
    : new Float64Array(test.length);
  const trainRate = train.filter((s) => s.type === "goal").length / Math.max(1, train.length);

  // Final model on every season.
  const all = matrix(modelShots);
  const model = fitLogistic(all.X, all.y, XG_FEATURES);

  const rateOf = (list: ShotRow[]) => list.filter((s) => s.type === "goal").length / Math.max(1, list.length);
  const emptyNetRate = rateOf(shots.filter((s) => s.empty_net));
  const penaltyShotRate = rateOf(shots.filter((s) => PENALTY_SHOT.has(s.situation_code ?? "")));

  const report: XgReport = {
    trainSeasons: seasons.filter((s) => s !== testSeason),
    testSeason,
    testShots: test.length,
    logLoss: logLoss(pTest, t.y),
    baselineLogLoss: logLoss(new Float64Array(test.length).fill(trainRate), t.y),
    auc: auc(pTest, t.y),
    calibration: calibration(pTest, t.y, 10),
    finalShots: modelShots.length,
    goalRate: rateOf(modelShots),
    emptyNetRate,
    penaltyShotRate,
    coefficients: Object.fromEntries(model.names.map((n, i) => [n, model.coef[i] / model.sd[i]])),
  };

  db.prepare(
    `INSERT INTO model_params (name, params, metrics, trained_at) VALUES ('xg', ?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET params = excluded.params, metrics = excluded.metrics, trained_at = excluded.trained_at`
  ).run(JSON.stringify({ model, emptyNetRate, penaltyShotRate }), JSON.stringify(report));

  // Score every unblocked attempt. Empty-net and penalty-shot attempts get their league rate.
  const update = db.prepare("UPDATE events SET xg = ? WHERE game_id = ? AND event_id = ?");
  db.transaction(() => {
    for (const s of shots) {
      const xg = s.empty_net
        ? emptyNetRate
        : PENALTY_SHOT.has(s.situation_code ?? "")
          ? penaltyShotRate
          : predictLogistic(model, xgFeatures(s));
      update.run(Math.round(xg * 1e5) / 1e5, s.game_id, s.event_id);
    }
  })();
  return report;
}

export function loadXgModel(): { model: LogitModel; emptyNetRate: number; penaltyShotRate: number } | null {
  const row = getDb().prepare("SELECT params FROM model_params WHERE name = 'xg'").get() as { params: string } | undefined;
  return row ? JSON.parse(row.params) : null;
}
