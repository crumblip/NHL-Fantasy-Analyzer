export const PERIOD_SEC = 1200;
export const REG_END = 3 * PERIOD_SEC;
const MINOR = 120;
const MAJOR = 300;
const MAX_ACTIVE = 2;

export type Side = "home" | "away";
const other = (s: Side): Side => (s === "home" ? "away" : "home");

export function gameSec(period: number, timeInPeriod: string): number {
  const [m, s] = timeInPeriod.split(":").map(Number);
  return (period - 1) * PERIOD_SEC + m * 60 + s;
}

export function periodOf(sec: number): number {
  return Math.floor(sec / PERIOD_SEC) + 1;
}

export interface TimelineEvent {
  sec: number;
  /** Needed at boundaries: the period-end event of the 3rd sits at 3600 but is still regulation. */
  period?: number;
  /** "stoppage" = any whistle (stoppage, faceoff, period end); it resets overtime strength. */
  kind: "goal" | "penalty" | "stoppage" | "other";
  side?: Side;
  /** Player serving the penalty: two minors to one player at one stoppage are served back to back. */
  playerId?: number;
  /** NHL penalty typeCode (MIN, BEN, MAJ, MAT, MIS, GAM, PS) and duration in minutes. */
  penaltyType?: string;
  penaltyMinutes?: number;
}

/** One penalty as called: a double minor is a single 240s minor here. */
export interface RawPenalty {
  duration: number;
  major: boolean;
  playerId?: number;
}

interface Segment {
  duration: number;
  major: boolean;
}

/**
 * What a team actually serves in one penalty-box slot: everything one player got at a
 * stoppage, back to back, majors first. A double minor is two 120s segments.
 */
interface Penalty {
  segments: Segment[];
  /** Coincidental 4-on-4 minors aren't wiped out by power-play goals. */
  terminable: boolean;
}

interface ActivePenalty extends Penalty {
  segEndsAt: number;
}

export interface Timeline {
  endSec: number;
  /** Skaters per second from penalties only (no extra attacker). */
  homeSkaters: Int8Array;
  awaySkaters: Int8Array;
  homeGoalieIn: Uint8Array;
  awayGoalieIn: Uint8Array;
  /** Per input event: penalty-based skaters just before that event took effect. */
  eventState: { home: number; away: number }[];
}

function toRawPenalty(e: TimelineEvent): RawPenalty | null {
  switch (e.penaltyType) {
    case "MIN":
    case "BEN":
      return { duration: (e.penaltyMinutes ?? 2) * 60, major: false, playerId: e.playerId };
    case "MAJ":
    case "MAT":
      return { duration: MAJOR, major: true, playerId: e.playerId };
    default:
      return null; // misconducts, game misconducts and penalty shots don't change strength
  }
}

function segmentsOf(p: RawPenalty): Segment[] {
  if (p.major) return [{ duration: p.duration, major: true }];
  return Array.from({ length: Math.max(1, Math.round(p.duration / MINOR)) }, () => ({
    duration: MINOR,
    major: false,
  }));
}

/** One slot per penalized player, majors served first. Penalties without a player each get their own slot. */
function toServed(list: RawPenalty[]): Penalty[] {
  const byPlayer = new Map<number | string, RawPenalty[]>();
  list.forEach((p, i) => {
    const key = p.playerId ?? `anon-${i}`;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), p]);
  });
  return [...byPlayer.values()].map((ps) => ({
    segments: ps.sort((x, y) => Number(y.major) - Number(x.major)).flatMap(segmentsOf),
    terminable: true,
  }));
}

/**
 * Cancels coincidental penalties assessed at one stoppage, then groups what's left into
 * served penalties. Cancellation looks at individual calls, regardless of who took them.
 */
export function resolveCoincidental(
  home: RawPenalty[],
  away: RawPenalty[],
  bothAtFullStrength: boolean
): { home: Penalty[]; away: Penalty[] } {
  const isSingleMinor = (p: RawPenalty[]) => p.length === 1 && !p[0].major && p[0].duration === MINOR;
  if (bothAtFullStrength && isSingleMinor(home) && isSingleMinor(away)) {
    const fourOnFour = (): Penalty[] => [{ segments: [{ duration: MINOR, major: false }], terminable: false }];
    return { home: fourOnFour(), away: fourOnFour() };
  }

  const h = home.map((p) => ({ ...p }));
  const a = away.map((p) => ({ ...p }));
  const cancelPairs = (pred: (p: RawPenalty) => boolean) => {
    for (;;) {
      const i = h.findIndex(pred);
      const j = a.findIndex(pred);
      if (i < 0 || j < 0) return;
      h.splice(i, 1);
      a.splice(j, 1);
    }
  };
  cancelPairs((p) => p.major);
  cancelPairs((p) => !p.major && p.duration === 2 * MINOR);
  cancelPairs((p) => !p.major && p.duration === MINOR);
  // A double minor against a single minor: two minutes cancel, two remain.
  for (const [x, y] of [
    [h, a],
    [a, h],
  ]) {
    for (;;) {
      const i = x.findIndex((p) => !p.major && p.duration === 2 * MINOR);
      const j = y.findIndex((p) => !p.major && p.duration === MINOR);
      if (i < 0 || j < 0) break;
      x[i].duration = MINOR;
      y.splice(j, 1);
    }
  }
  // A minor against a major is NOT offset: both are served in full (4-on-4, then the power
  // play). The NHL data is inconsistent here, but offsetting matched fewer games (see NOTES.md).
  return { home: toServed(h), away: toServed(a) };
}

export function buildTimeline(
  endSec: number,
  events: TimelineEvent[],
  homeGoalieIn: Uint8Array,
  awayGoalieIn: Uint8Array
): Timeline {
  const active: Record<Side, ActivePenalty[]> = { home: [], away: [] };
  const pending: Record<Side, Penalty[]> = { home: [], away: [] };

  // Overtime: when a penalty ends the player returns (4v3 → 4v4) and teams only drop back
  // to the 3-on-3 formula at the next whistle.
  let otHold: Record<Side, number> | null = null;

  const skaters = (t: number, period = periodOf(t)): Record<Side, number> => {
    const h = active.home.length;
    const a = active.away.length;
    if (period <= 3) return { home: 5 - h, away: 5 - a };
    if (otHold) return { ...otHold };
    // Regular-season overtime is 3-on-3; penalties add skaters to the other side instead.
    const diff = a - h;
    return { home: Math.min(5, 3 + Math.max(0, diff)), away: Math.min(5, 3 + Math.max(0, -diff)) };
  };

  const start = (side: Side, p: Penalty, t: number) => {
    active[side].push({ ...p, segments: [...p.segments], segEndsAt: t + p.segments[0].duration });
  };

  const promote = (t: number) => {
    for (const side of ["home", "away"] as const) {
      while (active[side].length < MAX_ACTIVE && pending[side].length) start(side, pending[side].shift()!, t);
    }
  };

  /** Ends the current segment; the next one (if any) starts now. */
  const advance = (p: ActivePenalty, t: number) => {
    p.segments.shift();
    if (p.segments.length) p.segEndsAt = t + p.segments[0].duration;
  };

  const expire = (t: number) => {
    const before = skaters(t);
    const returned: Side[] = [];
    for (const side of ["home", "away"] as const) {
      for (const p of active[side]) if (p.segEndsAt <= t) advance(p, t);
      const kept = active[side].filter((p) => p.segments.length > 0);
      if (kept.length < active[side].length) returned.push(side);
      active[side] = kept;
    }
    promote(t);
    if (periodOf(t) >= 4 && returned.length) {
      const hold = otHold ?? before;
      for (const side of returned) hold[side] = Math.min(5, before[side] + 1);
      otHold = hold;
    }
  };

  const powerPlayGoal = (scorer: Side, t: number) => {
    const s = skaters(t);
    if (s[scorer] <= s[other(scorer)]) return;
    // Only a minor currently being served can end early, and only the one ending soonest.
    const victims = active[other(scorer)].filter((p) => p.terminable && !p.segments[0].major);
    if (!victims.length) return;
    const first = victims.reduce((x, y) => (y.segEndsAt < x.segEndsAt ? y : x));
    advance(first, t);
    active[other(scorer)] = active[other(scorer)].filter((p) => p.segments.length > 0);
    promote(t);
  };

  const assess = (group: TimelineEvent[], t: number) => {
    const raw: Record<Side, RawPenalty[]> = { home: [], away: [] };
    for (const e of group) {
      const p = toRawPenalty(e);
      if (p && e.side) raw[e.side].push(p);
    }
    const full =
      !active.home.length && !active.away.length && !pending.home.length && !pending.away.length;
    const served = resolveCoincidental(raw.home, raw.away, full);
    for (const side of ["home", "away"] as const) {
      for (const p of served[side]) {
        if (active[side].length < MAX_ACTIVE) start(side, p, t);
        else pending[side].push(p);
      }
    }
  };

  const homeSkaters = new Int8Array(endSec);
  const awaySkaters = new Int8Array(endSec);
  const eventState: { home: number; away: number }[] = new Array(events.length);

  const bySec = new Map<number, number[]>();
  events.forEach((e, i) => {
    const list = bySec.get(e.sec);
    if (list) list.push(i);
    else bySec.set(e.sec, [i]);
  });

  for (let t = 0; t <= endSec; t++) {
    expire(t);
    const idx = bySec.get(t) ?? [];
    let penaltiesDone = false;
    let beforePenalties = skaters(t);
    for (const i of idx) {
      const e = events[i];
      const s = e.kind === "penalty" && penaltiesDone ? beforePenalties : skaters(t, e.period);
      eventState[i] = { home: s.home, away: s.away };
      if (e.kind !== "other") otHold = null;
      if (e.kind === "goal" && e.side) powerPlayGoal(e.side, t);
      if (e.kind === "penalty" && !penaltiesDone) {
        beforePenalties = s;
        // All penalties at one stoppage are resolved together for coincidental rules.
        assess(
          idx.map((j) => events[j]).filter((x) => x.kind === "penalty"),
          t
        );
        penaltiesDone = true;
      }
    }
    if (t < endSec) {
      const s = skaters(t);
      homeSkaters[t] = s.home;
      awaySkaters[t] = s.away;
    }
  }

  return { endSec, homeSkaters, awaySkaters, homeGoalieIn, awayGoalieIn, eventState };
}

/** NHL situationCode format: away goalie, away skaters, home skaters, home goalie. An empty net adds an attacker. */
export function situationCode(
  homeSkaters: number,
  awaySkaters: number,
  homeGoalieIn: boolean,
  awayGoalieIn: boolean
): string {
  const a = awaySkaters + (awayGoalieIn ? 0 : 1);
  const h = homeSkaters + (homeGoalieIn ? 0 : 1);
  return `${awayGoalieIn ? 1 : 0}${a}${h}${homeGoalieIn ? 1 : 0}`;
}

export type StrengthState = "5v5" | "PP" | "PK" | "other";

export function strengthState(own: number, opp: number, bothGoaliesIn: boolean): StrengthState {
  if (own > opp) return "PP";
  if (own < opp) return "PK";
  return own === 5 && bothGoaliesIn ? "5v5" : "other";
}

export function timelineSegments(tl: Timeline) {
  const segs: {
    start_sec: number;
    end_sec: number;
    home_skaters: number;
    away_skaters: number;
    home_goalie_in: number;
    away_goalie_in: number;
  }[] = [];
  for (let t = 0; t < tl.endSec; t++) {
    const cur = {
      home_skaters: tl.homeSkaters[t],
      away_skaters: tl.awaySkaters[t],
      home_goalie_in: tl.homeGoalieIn[t],
      away_goalie_in: tl.awayGoalieIn[t],
    };
    const last = segs[segs.length - 1];
    if (
      last &&
      last.end_sec === t &&
      last.home_skaters === cur.home_skaters &&
      last.away_skaters === cur.away_skaters &&
      last.home_goalie_in === cur.home_goalie_in &&
      last.away_goalie_in === cur.away_goalie_in
    ) {
      last.end_sec = t + 1;
    } else {
      segs.push({ start_sec: t, end_sec: t + 1, ...cur });
    }
  }
  return segs;
}
