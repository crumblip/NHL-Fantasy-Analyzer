import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, situationCode, type TimelineEvent } from "../lib/derive/timeline";

const minor = (sec: number, side: "home" | "away", minutes = 2): TimelineEvent => ({
  sec, kind: "penalty", side, penaltyType: "MIN", penaltyMinutes: minutes,
});
const major = (sec: number, side: "home" | "away"): TimelineEvent => ({
  sec, kind: "penalty", side, penaltyType: "MAJ", penaltyMinutes: 5,
});
const goal = (sec: number, side: "home" | "away"): TimelineEvent => ({ sec, kind: "goal", side });

function run(events: TimelineEvent[], endSec = 3600) {
  const goalies = new Uint8Array(endSec).fill(1);
  const tl = buildTimeline(endSec, events, goalies, goalies);
  return { tl, at: (t: number) => `${tl.homeSkaters[t]}v${tl.awaySkaters[t]}` };
}

test("a minor runs two minutes", () => {
  const { at } = run([minor(100, "home")]);
  assert.equal(at(99), "5v5");
  assert.equal(at(100), "4v5");
  assert.equal(at(219), "4v5");
  assert.equal(at(220), "5v5");
});

test("a power-play goal ends the minor; the goal itself is recorded at 4v5", () => {
  const events = [minor(100, "home"), goal(150, "away")];
  const { tl, at } = run(events);
  assert.deepEqual(tl.eventState[1], { home: 4, away: 5 });
  assert.equal(at(149), "4v5");
  assert.equal(at(150), "5v5");
});

test("a short-handed goal does not end the penalty", () => {
  const { at } = run([minor(100, "home"), goal(150, "home")]);
  assert.equal(at(150), "4v5");
  assert.equal(at(220), "5v5");
});

test("a PP goal in the first half of a double minor starts the second half", () => {
  const { at } = run([minor(100, "home", 4), goal(150, "away")]);
  assert.equal(at(150), "4v5");
  assert.equal(at(269), "4v5");
  assert.equal(at(270), "5v5");
});

test("a PP goal in the second half of a double minor ends it", () => {
  const { at } = run([minor(100, "home", 4), goal(250, "away")]);
  assert.equal(at(249), "4v5");
  assert.equal(at(250), "5v5");
});

test("single coincidental minors at full strength play 4-on-4, goals don't end them", () => {
  const { at } = run([minor(100, "home"), minor(100, "away"), goal(150, "home")]);
  assert.equal(at(100), "4v4");
  assert.equal(at(150), "4v4");
  assert.equal(at(220), "5v5");
});

test("coincidental minors while a team is already short cancel out", () => {
  const { at } = run([minor(100, "home"), minor(130, "home"), minor(130, "away")]);
  assert.equal(at(130), "4v5");
  assert.equal(at(220), "5v5");
});

test("roughing vs roughing + slashing leaves one power play", () => {
  const { at } = run([minor(100, "home"), minor(100, "away"), minor(100, "away")]);
  assert.equal(at(100), "5v4");
  assert.equal(at(220), "5v5");
});

test("two minors to one player are served back to back (4v5 for four minutes, not 3v5)", () => {
  const { at } = run([
    { ...minor(100, "home"), playerId: 7 },
    { ...minor(100, "home"), playerId: 7 },
  ]);
  assert.equal(at(100), "4v5");
  assert.equal(at(339), "4v5");
  assert.equal(at(340), "5v5");
});

test("minors to two different players at one stoppage are a 5-on-3", () => {
  const { at } = run([
    { ...minor(100, "home"), playerId: 7 },
    { ...minor(100, "home"), playerId: 8 },
  ]);
  assert.equal(at(100), "3v5");
  assert.equal(at(220), "5v5");
});

test("fight plus a minor each: everything cancels, stays 5-on-5 (no 4-on-4)", () => {
  const { at } = run([
    { ...minor(100, "home"), playerId: 1 },
    { ...major(100, "home"), playerId: 1 },
    { ...minor(100, "away"), playerId: 2 },
    { ...major(100, "away"), playerId: 2 },
  ]);
  assert.equal(at(100), "5v5");
});

test("three minors vs two at one stoppage leave a single power play", () => {
  const { at } = run([
    { ...minor(100, "away"), playerId: 1 },
    { ...minor(100, "away"), playerId: 1 },
    { ...minor(100, "away"), playerId: 1 },
    { ...minor(100, "home"), playerId: 2 },
    { ...minor(100, "home"), playerId: 2 },
  ]);
  assert.equal(at(100), "5v4");
  assert.equal(at(220), "5v5");
});

test("a player's major and minor are served back to back, major first", () => {
  const { at } = run([
    { ...minor(100, "home"), playerId: 7 },
    { ...major(100, "home"), playerId: 7 },
    goal(150, "away"), // during the major: doesn't end anything
    goal(450, "away"), // during the minor: ends it
  ]);
  assert.equal(at(150), "4v5");
  assert.equal(at(399), "4v5");
  assert.equal(at(400), "4v5");
  assert.equal(at(449), "4v5");
  assert.equal(at(450), "5v5");
});

test("a minor against a major is served in full: 4-on-4, then the power play", () => {
  const { at } = run([major(100, "away"), minor(100, "home")]);
  assert.equal(at(100), "4v4");
  assert.equal(at(219), "4v4");
  assert.equal(at(220), "5v4");
  assert.equal(at(400), "5v5");
});

test("coincidental fighting majors don't change strength", () => {
  const { at } = run([major(100, "home"), major(100, "away")]);
  assert.equal(at(100), "5v5");
});

test("a major isn't ended by a power-play goal", () => {
  const { at } = run([major(100, "home"), goal(150, "away")]);
  assert.equal(at(150), "4v5");
  assert.equal(at(399), "4v5");
  assert.equal(at(400), "5v5");
});

test("a third penalty waits until a spot frees up (never below 3 skaters)", () => {
  const { at } = run([minor(100, "home"), minor(110, "home"), minor(120, "home")]);
  assert.equal(at(125), "3v5");
  assert.equal(at(220), "3v5"); // first expires, the third starts now and runs to 340
  assert.equal(at(230), "4v5");
  assert.equal(at(339), "4v5");
  assert.equal(at(340), "5v5");
});

test("5-on-3 goal ends only one minor", () => {
  const { at } = run([minor(100, "home"), minor(110, "home"), goal(150, "away")]);
  assert.equal(at(149), "3v5");
  assert.equal(at(150), "4v5");
  assert.equal(at(230), "5v5");
});

test("overtime is 3-on-3 and a penalty gives the other team a skater", () => {
  const { at } = run([minor(3700, "home")], 3900);
  assert.equal(at(3650), "3v3");
  assert.equal(at(3700), "3v4");
  assert.equal(at(3819), "3v4");
});

test("a penalty carried into overtime becomes 3-on-4", () => {
  const { at } = run([minor(3550, "home"), { sec: 3700, kind: "stoppage" }], 3900);
  assert.equal(at(3599), "4v5");
  assert.equal(at(3600), "3v4");
  assert.equal(at(3670), "4v4");
  assert.equal(at(3700), "3v3");
});

test("in overtime an expired penalty makes it 4-on-4 until the next whistle", () => {
  const whistle = (sec: number): TimelineEvent => ({ sec, kind: "stoppage" });
  const { at } = run([minor(3700, "home"), whistle(3850)], 3900);
  assert.equal(at(3700), "3v4");
  assert.equal(at(3820), "4v4");
  assert.equal(at(3849), "4v4");
  assert.equal(at(3850), "3v3");
});

test("situationCode adds the extra attacker when a goalie is pulled", () => {
  assert.equal(situationCode(5, 5, true, true), "1551");
  assert.equal(situationCode(5, 5, true, false), "0651");
  assert.equal(situationCode(4, 5, true, true), "1541");
  assert.equal(situationCode(4, 5, false, true), "1550"); // shorthanded home pulls its goalie
});
