import type Database from "better-sqlite3";
import { endpoints } from "./nhl/endpoints";
import { readCached } from "./nhl/http";
import type { PlayByPlay } from "./nhl/types";

/** Player names from the players table, falling back to play-by-play roster spots for given games. */
export function playerNames(db: Database.Database, gameIds: number[] = []): (id: number | null) => string {
  const names = new Map(
    (db.prepare("SELECT id, full_name FROM players").all() as { id: number; full_name: string }[]).map((r) => [
      r.id,
      r.full_name,
    ])
  );
  for (const g of gameIds) {
    const pbp = readCached<PlayByPlay & { rosterSpots: { playerId: number; firstName: { default: string }; lastName: { default: string } }[] }>(
      endpoints.playByPlay(g)
    );
    for (const r of pbp?.rosterSpots ?? []) {
      if (!names.has(r.playerId)) names.set(r.playerId, `${r.firstName.default} ${r.lastName.default}`);
    }
  }
  return (id) => (id === null ? "-" : (names.get(id) ?? `#${id}`));
}
