import { getDb } from "../db";

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Season the as-of date belongs to: the next regular-season game's season, else the latest. */
export function seasonForDate(asOf: string): number {
  const db = getDb();
  const next = db
    .prepare("SELECT season FROM games WHERE game_type = 2 AND game_date > ? ORDER BY game_date LIMIT 1")
    .get(asOf) as { season: number } | undefined;
  if (next) return next.season;
  return (db.prepare("SELECT MAX(season) s FROM games").get() as { s: number }).s;
}

/**
 * The "next 7 days" window for weekly value. Before a season starts it's opening week,
 * so preseason rankings still show a useful weekly number.
 */
export function weekWindow(asOf: string, season: number, days = 7): { start: string; end: string } {
  const db = getDb();
  const started = db
    .prepare("SELECT 1 FROM games WHERE season = ? AND game_type = 2 AND game_date <= ? LIMIT 1")
    .get(season, asOf);
  const first = db
    .prepare("SELECT MIN(game_date) d FROM games WHERE season = ? AND game_type = 2 AND game_date > ?")
    .get(season, asOf) as { d: string | null };
  const start = started || !first.d ? addDays(asOf, 1) : first.d;
  return { start, end: addDays(start, days - 1) };
}

/** Team history follows the franchise: Arizona's players and staff became Utah's. */
export function franchiseOf(abbrev: string): string {
  return abbrev === "ARI" ? "UTA" : abbrev;
}
