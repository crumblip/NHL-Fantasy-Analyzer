import { loadModelConfig } from "../config";
import { getDb } from "../db";
import { detectUnits, pairLookup, rankByToi, type Unit } from "./units";

export type UnitKind = "F" | "D" | "PP" | "PK";

/**
 * A team's units over a set of games. One game returns what the deployment engine stored;
 * several games re-run detection on the summed pair overlaps.
 */
export function teamUnits(teamId: number, gameIds: number[]) {
  const db = getDb();
  const model = loadModelConfig();
  const marks = gameIds.map(() => "?").join(",");
  const secs = db
    .prepare(`SELECT SUM(secs_5v5) v5, SUM(secs_pp) pp, SUM(secs_pk) pk FROM team_game WHERE team_id = ? AND game_id IN (${marks})`)
    .get(teamId, ...gameIds) as { v5: number; pp: number; pk: number };
  const toi = new Map(
    (
      db
        .prepare(
          `SELECT player_id, SUM(toi_5v5) v5, SUM(toi_pp) pp, SUM(toi_sh) sh FROM player_game
           WHERE team_id = ? AND is_goalie = 0 AND game_id IN (${marks}) GROUP BY player_id`
        )
        .all(teamId, ...gameIds) as { player_id: number; v5: number; pp: number; sh: number }[]
    ).map((r) => [r.player_id, r])
  );

  let units: Record<UnitKind, Unit[]>;
  if (gameIds.length === 1) {
    units = { F: [], D: [], PP: [], PK: [] };
    for (const r of db
      .prepare("SELECT unit_type, player_ids, shared_seconds FROM line_assignments WHERE game_id = ? AND team_id = ? ORDER BY unit_type, rank")
      .all(gameIds[0], teamId) as { unit_type: UnitKind; player_ids: string; shared_seconds: number }[]) {
      units[r.unit_type].push({ players: JSON.parse(r.player_ids), sharedSeconds: r.shared_seconds });
    }
  } else {
    const pairs = db
      .prepare(
        `SELECT player_a, player_b, strength_state, SUM(shared_seconds) secs FROM pair_overlap
         WHERE team_id = ? AND game_id IN (${marks}) GROUP BY 1, 2, 3`
      )
      .all(teamId, ...gameIds) as { player_a: number; player_b: number; strength_state: string; secs: number }[];
    const look = (state: string) => pairLookup(pairs.filter((p) => p.strength_state === state));
    const pos = new Map(
      (
        db
          .prepare(`SELECT player_id, position_code FROM game_rosters WHERE team_id = ? AND game_id IN (${marks})`)
          .all(teamId, ...gameIds) as { player_id: number; position_code: string }[]
      ).map((r) => [r.player_id, r.position_code])
    );
    const skaters = [...toi.values()];
    const min = model.deployment.min_unit_seconds;
    const byToi = (id: number) => toi.get(id)?.v5 ?? 0;
    const cand = (f: (id: number) => boolean, key: "v5" | "pp" | "sh") =>
      skaters.filter((s) => f(s.player_id)).map((s) => ({ id: s.player_id, secs: s[key] }));
    const isF = (id: number) => ["C", "L", "R"].includes(pos.get(id) ?? "");
    units = {
      F: rankByToi(detectUnits(cand(isF, "v5"), 3, 4, look("5v5"), min.forward_line), byToi),
      D: rankByToi(detectUnits(cand((id) => pos.get(id) === "D", "v5"), 2, 3, look("5v5"), min.d_pair), byToi),
      PP: detectUnits(cand(() => true, "pp"), 5, 2, look("PP"), min.pp_unit),
      PK: detectUnits(cand(() => true, "sh"), 4, 2, look("PK"), min.pk_unit),
    };
  }

  const denom: Record<UnitKind, number> = { F: secs.v5, D: secs.v5, PP: secs.pp, PK: secs.pk };
  const own: Record<UnitKind, (id: number) => number> = {
    F: (id) => toi.get(id)?.v5 ?? 0,
    D: (id) => toi.get(id)?.v5 ?? 0,
    PP: (id) => toi.get(id)?.pp ?? 0,
    PK: (id) => toi.get(id)?.sh ?? 0,
  };
  const shaped = (kind: UnitKind) =>
    units[kind].map((u, i) => ({
      rank: i + 1,
      sharedSeconds: u.sharedSeconds,
      sharedShare: denom[kind] ? u.sharedSeconds / denom[kind] : 0,
      players: u.players.map((id) => ({ id, share: denom[kind] ? own[kind](id) / denom[kind] : 0 })),
    }));
  return {
    teamSeconds: secs,
    F: shaped("F"),
    D: shaped("D"),
    PP: shaped("PP"),
    PK: shaped("PK"),
  };
}
