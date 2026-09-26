import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import {
  boxscorePlayerCount,
  mmssToSec,
  parseLanding,
  parseScheduleGame,
  playersMissingShifts,
  rosterPlayers,
} from "../lib/nhl/parse";
import { cachePath } from "../lib/nhl/http";
import { endpoints } from "../lib/nhl/endpoints";

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8"));

test("mmssToSec", () => {
  assert.equal(mmssToSec("17:38"), 1058);
  assert.equal(mmssToSec("00:00"), 0);
  assert.equal(mmssToSec(null), 0);
});

test("parseLanding keeps headshot, draft and all-league totals", () => {
  const { player, totals } = parseLanding(fixture("player-landing-8479318"));
  assert.equal(player.full_name, "Auston Matthews");
  assert.equal(player.position, "C");
  assert.match(player.headshot_url!, /^https:\/\/assets\.nhle\.com\/mugs\/nhl\//);
  assert.equal(player.draft_overall, 1);
  assert.equal(totals.length, 36);

  const rookie = totals.find((t) => t.league === "NHL" && t.season === 20162017 && t.game_type === 2)!;
  assert.deepEqual([rookie.gp, rookie.g, rookie.a, rookie.pts, rookie.pim], [82, 40, 29, 69, 14]);

  // Some minor leagues report only GP and PTS.
  const peewee = totals.find((t) => t.league === "QC Int PW")!;
  assert.equal(peewee.g, null);
  assert.equal(peewee.pts, 6);

  const keys = new Set(totals.map((t) => `${t.season}|${t.game_type}|${t.league}|${t.sequence}`));
  assert.equal(keys.size, totals.length, "primary key must be unique");
});

test("parseScheduleGame", () => {
  const games = fixture("club-schedule-season-TOR-20252026").games;
  const g = parseScheduleGame(games.find((x: any) => x.id === 2025020004));
  assert.equal(g.home_abbrev, "TOR");
  assert.equal(g.away_abbrev, "MTL");
  assert.equal(g.home_score, 5);
  assert.equal(g.game_state, "OFF");
  assert.equal(g.last_period_type, "REG");
});

test("Arizona 2023-24 roster endpoint is empty, so game rosters are the player source", () => {
  const empty = { forwards: [], defensemen: [], goalies: [] };
  assert.equal(rosterPlayers(empty).length, 0);
  assert.equal(rosterPlayers(fixture("roster-TOR-current")).length, 24);
});

test("every skater and goalie with ice time has shift rows", () => {
  const box = fixture("boxscore-2025020004");
  const shifts = fixture("shiftcharts-2025020004").data;
  assert.equal(boxscorePlayerCount(box), 40);
  assert.deepEqual(playersMissingShifts(box, shifts), []);
  assert.deepEqual(playersMissingShifts(box, []).length > 30, true);
});

test("cache paths are deterministic and Windows-safe", () => {
  const p = cachePath(endpoints.skaterToiByDate("2025-10-08"));
  const rel = path.relative(process.cwd(), p);
  assert.doesNotMatch(rel, /[<>:"|?*\s]/);
  assert.equal(p, cachePath(endpoints.skaterToiByDate("2025-10-08")));
  assert.notEqual(p, cachePath(endpoints.skaterToiByDate("2025-10-09")));
  assert.match(cachePath(endpoints.playByPlay(2025020004)), /gamecenter[\\/]2025020004[\\/]play-by-play\.json\.gz$/);
});
