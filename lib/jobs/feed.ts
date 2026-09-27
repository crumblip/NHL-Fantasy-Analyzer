import { loadModelConfig } from "../config";
import { getDb } from "../db";

export type FeedType = "pickup" | "downgrade" | "promotion";

export interface SignalLike {
  player_id: number;
  as_of_date: string;
  season: number;
  team_id: number | null;
  position: string | null;
  opportunity_delta: number | null;
  alert: string | null;
  alert_text: string | null;
  promotion_flag: number;
}

export interface FeedEntry {
  player_id: number;
  type: FeedType;
  as_of_date: string;
  season: number;
  team_id: number | null;
  position: string | null;
  delta: number | null;
  text: string | null;
}

const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;

/**
 * Turns per-game signals (in date order) into feed entries: an alert enters the feed the first
 * time it fires, and again only after `cooldownDays` without an entry of the same type.
 * `lastSeen` carries the latest existing entry per player and type across runs.
 */
export function computeFeed(
  signals: SignalLike[],
  cooldownDays: number,
  lastSeen: Map<string, string> = new Map()
): FeedEntry[] {
  const out: FeedEntry[] = [];
  const sorted = [...signals].sort((a, b) => a.as_of_date.localeCompare(b.as_of_date) || a.player_id - b.player_id);
  for (const s of sorted) {
    const types: FeedType[] = [];
    if (s.alert === "pickup" || s.alert === "downgrade") types.push(s.alert);
    if (s.promotion_flag) types.push("promotion");
    for (const type of types) {
      const key = `${s.player_id}|${type}`;
      const prev = lastSeen.get(key);
      if (prev && days(prev, s.as_of_date) < cooldownDays) continue;
      lastSeen.set(key, s.as_of_date);
      out.push({
        player_id: s.player_id,
        type,
        as_of_date: s.as_of_date,
        season: s.season,
        team_id: s.team_id,
        position: s.position,
        delta: s.opportunity_delta,
        text: type === "promotion" ? "Late-game time with the 1C or top line jumped in 3+ of the last 5 games" : s.alert_text,
      });
    }
  }
  return out;
}

/**
 * Adds feed entries for signals newer than what the feed already covers (or a whole season with
 * `rebuild`). Deterministic from opportunity_signal, so it can always be rebuilt.
 */
export function updateAlertFeed(opts: { season?: number; rebuild?: boolean } = {}) {
  const db = getDb();
  const cooldown = loadModelConfig().jobs.feed_cooldown_days;
  const season =
    opts.season ?? (db.prepare("SELECT MAX(season) s FROM opportunity_signal").get() as { s: number | null }).s;
  if (!season) return { season: null, added: 0 };

  if (opts.rebuild) db.prepare("DELETE FROM alert_feed WHERE season = ?").run(season);
  const lastSeen = new Map(
    (
      db
        .prepare("SELECT player_id, type, MAX(as_of_date) d FROM alert_feed WHERE season = ? GROUP BY player_id, type")
        .all(season) as { player_id: number; type: string; d: string }[]
    ).map((r) => [`${r.player_id}|${r.type}`, r.d])
  );
  const since = (db.prepare("SELECT MAX(as_of_date) d FROM alert_feed WHERE season = ?").get(season) as { d: string | null }).d;
  const signals = db
    .prepare(
      `SELECT player_id, as_of_date, season, team_id, position, opportunity_delta, alert, alert_text, promotion_flag
       FROM opportunity_signal WHERE season = ? AND (alert IS NOT NULL OR promotion_flag = 1) ${since ? "AND as_of_date > ?" : ""}`
    )
    .all(...(since ? [season, since] : [season])) as SignalLike[];

  const entries = computeFeed(signals, cooldown, lastSeen);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO alert_feed (player_id, type, as_of_date, season, team_id, position, delta, text)
     VALUES (@player_id, @type, @as_of_date, @season, @team_id, @position, @delta, @text)`
  );
  db.transaction(() => entries.forEach((e) => ins.run(e)))();
  return { season, added: entries.length };
}
