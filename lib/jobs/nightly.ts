import fs from "fs";
import path from "path";
import { loadModelConfig } from "../config";
import { DATA_DIR, getDb } from "../db";
import { buildDeployment } from "../deploy/build";
import { buildDerived } from "../derive/build";
import { ingestLandings, ingestSeasons, listSeasons } from "../ingest";
import { runGoalies } from "../models/goalies";
import { runProjections } from "../models/run";
import { scoreUnscoredShots, trainXg, xgTrainedAt } from "../models/xg";
import { fetchStats } from "../nhl/http";
import { ingestDraft, ingestNhlSeasons } from "../prospects/ingest";
import { runProspects } from "../prospects/model";
import { updateAlertFeed } from "./feed";

export interface StepResult {
  step: string;
  status: "ok" | "skipped" | "failed";
  seconds: number;
  detail: string;
}

export interface NightlyOptions {
  asOf: string;
  forceXg?: boolean;
  forceProspects?: boolean;
  log?: (line: string) => void;
}

const LOCK = path.join(DATA_DIR, "nightly.lock");
const STALE_LOCK_MS = 6 * 3600_000;

function acquireLock(): boolean {
  try {
    const raw = fs.readFileSync(LOCK, "utf8");
    const { pid, started } = JSON.parse(raw) as { pid: number; started: number };
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive && Date.now() - started < STALE_LOCK_MS) return false;
  } catch {
    /* no lock, or unreadable: take it */
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, started: Date.now() }));
  return true;
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK);
  } catch {
    /* already gone */
  }
}

const daysSince = (sqliteUtc: string | null, asOf: string) =>
  sqliteUtc ? (Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${sqliteUtc.replace(" ", "T")}Z`)) / 86400000 : Infinity;

/**
 * The nightly pipeline (SPEC phase 8). Every step is incremental: only new games are fetched and
 * derived, so a normal night takes a few minutes. Steps run even if an earlier one failed, so a
 * flaky NHL endpoint doesn't stop projections from refreshing on the data we have.
 */
export async function runNightly(opts: NightlyOptions): Promise<{ status: string; steps: StepResult[] }> {
  const log = opts.log ?? console.log;
  if (!acquireLock()) {
    log("Another nightly run is in progress (data/nightly.lock). Exiting.");
    return { status: "locked", steps: [] };
  }
  const db = getDb();
  const cfg = loadModelConfig().jobs;
  const runId = Number(
    db.prepare("INSERT INTO job_runs (job, started_at, status) VALUES ('nightly', datetime('now'), 'running')").run().lastInsertRowid
  );
  const steps: StepResult[] = [];

  const step = async (name: string, fn: () => Promise<string | null> | string | null) => {
    const t0 = Date.now();
    log(`\n== ${name}`);
    try {
      const detail = await fn();
      const r: StepResult = { step: name, status: detail === null ? "skipped" : "ok", seconds: (Date.now() - t0) / 1000, detail: detail ?? "nothing to do" };
      steps.push(r);
      log(`  ${r.status}: ${r.detail} (${r.seconds.toFixed(1)}s)`);
    } catch (err) {
      const r: StepResult = { step: name, status: "failed", seconds: (Date.now() - t0) / 1000, detail: String((err as Error)?.stack ?? err) };
      steps.push(r);
      log(`  FAILED: ${r.detail}`);
    }
  };

  try {
    const seasons = await listSeasons();
    const current = seasons[seasons.length - 1];
    const gamesDone = () =>
      (db.prepare("SELECT COUNT(*) n FROM game_ingest i JOIN games g ON g.id = i.game_id WHERE g.season = ? AND i.pbp_events > 0").get(current.id) as { n: number }).n;

    await step("Ingest current season", async () => {
      const before = gamesDone();
      const net0 = fetchStats().network;
      await ingestSeasons([current]);
      return `${gamesDone() - before} new games (${gamesDone()} total in ${current.id}), ${fetchStats().network - net0} requests`;
    });

    await step("Derived tables", () => {
      const r = buildDerived({});
      return r.total ? `${r.built} games built${r.skipped ? `, ${r.skipped} skipped` : ""}` : null;
    });

    await step("xG", () => {
      const age = daysSince(xgTrainedAt(), opts.asOf);
      if (opts.forceXg || age >= cfg.xg_retrain_days) {
        const r = trainXg();
        return `retrained (held-out log loss ${r.logLoss.toFixed(4)} vs ${r.baselineLogLoss.toFixed(4)}, AUC ${r.auc.toFixed(3)})`;
      }
      const n = scoreUnscoredShots();
      return n ? `scored ${n} new shots with the model from ${Math.floor(age)} days ago` : null;
    });

    await step("Deployment and alerts", () => {
      const has = db.prepare("SELECT 1 FROM team_game WHERE season = ? LIMIT 1").get(current.id);
      if (!has) return null;
      const r = buildDeployment([current.id]);
      const feed = updateAlertFeed({ season: current.id });
      return `${r.games} games; ${feed.added} new feed entries`;
    });

    await step("Projections and grades", () => {
      const s = runProjections(opts.asOf);
      const g = runGoalies(opts.asOf);
      return `${s.players} skaters, ${g.goalies} goalies as of ${opts.asOf}`;
    });

    await step("Prospects", async () => {
      const last = (db.prepare("SELECT MAX(as_of_date) d FROM prospect_outputs").get() as { d: string | null }).d;
      const age = last ? (Date.parse(opts.asOf) - Date.parse(last)) / 86400000 : Infinity;
      if (!opts.forceProspects && age < cfg.prospects_refresh_days) return null;
      const year = Number(opts.asOf.slice(0, 4));
      await ingestDraft([year - 1, year]);
      await ingestNhlSeasons([current.id - 10001, current.id], current.id);
      const recent = (
        db.prepare("SELECT DISTINCT player_id FROM draft_picks WHERE player_id IS NOT NULL AND draft_year >= ? AND COALESCE(position, '') != 'G'").all(year - 7) as { player_id: number }[]
      ).map((r) => r.player_id);
      await ingestLandings(recent, "recent draftee landings");
      const r = runProspects(opts.asOf);
      return `${r.prospects} prospects graded (${recent.length} recent draftees refreshed)`;
    });
  } finally {
    const failed = steps.filter((s) => s.status === "failed").length;
    const status = failed === 0 ? "ok" : failed === steps.length ? "failed" : "partial";
    db.prepare("UPDATE job_runs SET finished_at = datetime('now'), status = ?, summary = ? WHERE id = ?").run(status, JSON.stringify(steps), runId);
    releaseLock();
    log(`\nNightly ${status}: ${steps.map((s) => `${s.step} ${s.status}`).join(", ")}`);
    return { status, steps };
  }
}
