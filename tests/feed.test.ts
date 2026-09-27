import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFeed, type SignalLike } from "../lib/jobs/feed";

const sig = (player: number, date: string, alert: string | null, promo = 0): SignalLike => ({
  player_id: player,
  as_of_date: date,
  season: 20252026,
  team_id: 1,
  position: "C",
  opportunity_delta: alert === "pickup" ? 1.5 : alert === "downgrade" ? -1.5 : 0,
  alert,
  alert_text: alert ? `${alert} text` : null,
  promotion_flag: promo,
});

test("an ongoing alert enters the feed once, then again only after the cooldown", () => {
  const feed = computeFeed(
    [
      sig(1, "2025-11-01", "pickup"),
      sig(1, "2025-11-03", "pickup"),
      sig(1, "2025-11-10", "pickup"),
      sig(1, "2025-11-20", "pickup"), // 19 days after the first entry: re-fires
    ],
    14
  );
  assert.deepEqual(feed.map((f) => f.as_of_date), ["2025-11-01", "2025-11-20"]);
});

test("different types and players are tracked separately; promotions get their own entry", () => {
  const feed = computeFeed(
    [sig(1, "2025-11-01", "pickup", 1), sig(2, "2025-11-01", "downgrade"), sig(1, "2025-11-02", null, 1)],
    14
  );
  assert.deepEqual(
    feed.map((f) => `${f.player_id}:${f.type}`),
    ["1:pickup", "1:promotion", "2:downgrade"]
  );
});

test("the cooldown carries over from earlier runs", () => {
  const lastSeen = new Map([["1|pickup", "2025-11-01"]]);
  assert.equal(computeFeed([sig(1, "2025-11-05", "pickup")], 14, lastSeen).length, 0);
  assert.equal(computeFeed([sig(1, "2025-11-16", "pickup")], 14, lastSeen).length, 1);
});
