"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Box, Flex, Input, Text } from "@chakra-ui/react";
import { LuStar } from "react-icons/lu";
import type { RankingRow } from "@/lib/queries";
import { PageHeader, Segmented } from "@/components/AppShell";
import { Grade, Tag, TrendArrow } from "@/components/ui/Grade";
import { NativeSelect } from "@/components/ui/NativeSelect";
import { useRoster } from "@/components/useRoster";

type SortKey =
  | "value" | "fpg" | "floor" | "ceiling" | "next7_fp" | "vor" | "fantasy_pctl" | "offense_pctl" | "opportunity_pctl"
  | "peripheral_pctl" | "g" | "a" | "ppp" | "sog" | "hit" | "blk" | "toi_pp" | "name";

const POSITIONS = [
  { value: "ALL", label: "All" },
  { value: "C", label: "C" },
  { value: "LW", label: "LW" },
  { value: "RW", label: "RW" },
  { value: "D", label: "D" },
];

const PAGE = 100;

export function RankingsView({ asOf, rows }: { asOf: string | null; rows: RankingRow[] }) {
  const [pos, setPos] = useState("ALL");
  const [team, setTeam] = useState("ALL");
  const [q, setQ] = useState("");
  const [owned, setOwned] = useState<"all" | "available" | "mine">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "value", dir: -1 });
  const [limit, setLimit] = useState(PAGE);
  const roster = useRoster();

  const teams = useMemo(() => [...new Set(rows.map((r) => r.team).filter(Boolean))].sort() as string[], [rows]);
  const preseason = rows.length > 0 && rows.every((r) => r.games_left > 70);

  const value = (r: RankingRow) => (r.games_left ? r.rest : r.fpg);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const get = (r: RankingRow): number | string =>
      sort.key === "value" ? value(r) : sort.key === "name" ? r.name : ((r[sort.key] as number | null) ?? -Infinity);
    return rows
      .filter((r) => pos === "ALL" || r.position === pos)
      .filter((r) => team === "ALL" || r.team === team)
      .filter((r) => !needle || r.name.toLowerCase().includes(needle))
      .filter((r) => owned === "all" || (owned === "mine" ? roster.has(r.id) : !roster.has(r.id)))
      .sort((a, b) => {
        const x = get(a);
        const y = get(b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
  }, [rows, pos, team, q, owned, sort, roster]);

  useEffect(() => setLimit(PAGE), [pos, team, q, owned, sort]);

  const header = (key: SortKey, label: string, title?: string, align: "left" | "right" | "center" = "right") => (
    <Box
      as="th"
      position="sticky"
      top="0"
      bg="rink.surface2"
      zIndex="1"
      px="2"
      py="2"
      textAlign={align}
      fontSize="xs"
      fontWeight="semibold"
      color={sort.key === key ? "rink.text" : "rink.muted"}
      whiteSpace="nowrap"
      cursor="pointer"
      userSelect="none"
      title={title}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </Box>
  );
  const td = (content: React.ReactNode, align: "left" | "right" | "center" = "right", extra?: object) => (
    <Box as="td" px="2" py="1.5" textAlign={align} fontSize="sm" color="rink.text" whiteSpace="nowrap" style={{ fontVariantNumeric: "tabular-nums" }} {...extra}>
      {content}
    </Box>
  );

  return (
    <Box>
      <PageHeader
        title="Rankings"
        subtitle={
          asOf
            ? `Projections as of ${asOf}. ${preseason ? "Ranked by projected season fantasy points (FP/GP × expected games)." : "Ranked by projected rest-of-season fantasy points."} ${rows.length} skaters.`
            : "No projections yet. Run npm run run:models."
        }
      />

      <Flex gap="3" mb="3" wrap="wrap" align="center">
        <Segmented label="Position" value={pos} options={POSITIONS} onChange={setPos} />
        <Segmented
          label="Roster filter"
          value={owned}
          options={[
            { value: "all", label: "All players" },
            { value: "available", label: "Available" },
            { value: "mine", label: `My roster (${roster.size})` },
          ]}
          onChange={setOwned}
        />
        <NativeSelect aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="ALL">All teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
        <Input size="sm" maxW="220px" placeholder="Filter by name" aria-label="Filter by name" value={q} onChange={(e) => setQ(e.target.value)} bg="rink.surface2" borderColor="rink.border" />
      </Flex>

      <Box bg="rink.surface" borderWidth="1px" borderColor="rink.border" rounded="lg" overflow="auto" maxH="calc(100vh - 220px)">
        <Box as="table" w="full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <Box as="thead">
            <Box as="tr">
              <Box as="th" position="sticky" top="0" left="0" zIndex="2" bg="rink.surface2" px="2" py="2" fontSize="xs" color="rink.muted" textAlign="right">
                #
              </Box>
              <Box as="th" position="sticky" top="0" zIndex="1" bg="rink.surface2" px="1" py="2" aria-label="On my roster" />
              {header("name", "Player", undefined, "left")}
              {header("fpg", "FP/GP", "Projected fantasy points per game, opponent-adjusted")}
              {header("floor", "Floor–Ceil", "20th and 80th percentile of a single game")}
              {header("value", preseason ? "Season FP" : "Rest FP", "Projected fantasy points over the remaining schedule, adjusted for availability")}
              {header("next7_fp", "Next 7", "Projected fantasy points over the next 7 days (opening week before the season)")}
              {header("vor", "VOR", "Value over replacement over the remaining schedule")}
              {header("fantasy_pctl", "Fant", "Fantasy grade", "center")}
              {header("offense_pctl", "Off", "Offense grade: talent independent of role", "center")}
              {header("opportunity_pctl", "Opp", "Opportunity grade: current deployment, with trend", "center")}
              {header("peripheral_pctl", "Per", "Peripheral grade: SOG + HIT + BLK + PIM", "center")}
              {header("g", "G", "Projected goals per game")}
              {header("a", "A", "Projected assists per game")}
              {header("ppp", "PPP", "Projected power-play points per game")}
              {header("sog", "SOG", "Projected shots per game")}
              {header("hit", "HIT", "Projected hits per game")}
              {header("blk", "BLK", "Projected blocks per game")}
              {header("toi_pp", "PP min", "Projected power-play minutes per game")}
            </Box>
          </Box>
          <Box as="tbody">
            {list.slice(0, limit).map((r, i) => (
              <Box as="tr" key={r.id} _hover={{ bg: "rink.hover" }} borderTopWidth="1px" borderColor="rink.borderSubtle">
                <Box as="td" position="sticky" left="0" bg="rink.surface" px="2" py="1.5" fontSize="xs" color="rink.muted" textAlign="right">
                  {i + 1}
                </Box>
                <Box as="td" px="1">
                  <Box
                    as="button"
                    aria-label={roster.has(r.id) ? `Remove ${r.name} from my roster` : `Add ${r.name} to my roster`}
                    aria-pressed={roster.has(r.id)}
                    onClick={() => roster.toggle(r.id)}
                    color={roster.has(r.id) ? "rink.warn" : "rink.muted"}
                    display="flex"
                    p="1"
                  >
                    <LuStar size={14} fill={roster.has(r.id) ? "currentColor" : "none"} />
                  </Box>
                </Box>
                <Box as="td" px="2" py="1.5" minW="220px">
                  <Flex align="baseline" gap="2">
                    <Link href={`/player/${r.id}`}>
                      <Text fontSize="sm" fontWeight="semibold" color="rink.text" _hover={{ color: "rink.accent" }}>
                        {r.name}
                      </Text>
                    </Link>
                    <Text fontSize="xs" color="rink.muted" whiteSpace="nowrap">
                      {r.team} · {r.position}
                    </Text>
                  </Flex>
                  {Boolean(r.alert || r.promotion || r.mismatch || r.new_team) && (
                    <Flex gap="1" mt="1" wrap="wrap">
                      {r.alert && (
                        <Tag tone={r.alert === "pickup" ? "pos" : "neg"} title={r.alert_text ?? undefined}>
                          {r.alert === "pickup" ? "Pickup alert" : "Downgrade"}
                        </Tag>
                      )}
                      {r.promotion ? <Tag tone="accent">In-game promotion</Tag> : null}
                      {r.mismatch && <Tag tone="warn">{r.mismatch}</Tag>}
                      {r.new_team ? <Tag>New team</Tag> : null}
                    </Flex>
                  )}
                </Box>
                {td(<Text as="span" fontWeight="semibold">{r.fpg.toFixed(2)}</Text>)}
                {td(<Text as="span" color="rink.sub">{`${r.floor.toFixed(1)}–${r.ceiling.toFixed(1)}`}</Text>)}
                {td(value(r).toFixed(r.games_left ? 0 : 2))}
                {td(r.next7_games ? `${r.next7_fp.toFixed(1)} (${r.next7_games}g)` : "–")}
                {td(<Text as="span" color={r.vor >= 0 ? "rink.pos" : "rink.muted"}>{r.vor >= 0 ? `+${r.vor.toFixed(0)}` : r.vor.toFixed(0)}</Text>)}
                {td(<Grade letter={r.fantasy_grade} pctl={r.fantasy_pctl} />, "center")}
                {td(<Grade letter={r.offense_grade} pctl={r.offense_pctl} />, "center")}
                {td(
                  <Flex align="center" justify="center">
                    <Grade letter={r.opportunity_grade} pctl={r.opportunity_pctl} />
                    <TrendArrow trend={r.trend} delta={r.delta} />
                  </Flex>,
                  "center"
                )}
                {td(<Grade letter={r.peripheral_grade} pctl={r.peripheral_pctl} />, "center")}
                {td(r.g.toFixed(2))}
                {td(r.a.toFixed(2))}
                {td(r.ppp.toFixed(2))}
                {td(r.sog.toFixed(1))}
                {td(r.hit.toFixed(1))}
                {td(r.blk.toFixed(1))}
                {td((r.toi_pp / 60).toFixed(1))}
              </Box>
            ))}
          </Box>
        </Box>
        {list.length === 0 && (
          <Text p="6" textAlign="center" color="rink.muted">
            {owned === "mine" ? "Star players to add them to your roster." : "No players match these filters."}
          </Text>
        )}
      </Box>
      {list.length > limit && (
        <Flex justify="center" mt="3">
          <Box as="button" px="4" py="2" rounded="md" fontSize="sm" bg="rink.surface2" borderWidth="1px" borderColor="rink.border" color="rink.text" onClick={() => setLimit((l) => l + PAGE)}>
            Show more ({list.length - limit} left)
          </Box>
        </Flex>
      )}
      <Text fontSize="xs" color="rink.muted" mt="3">
        Grades are percentiles within position (hover a grade for the percentile). Arrows show the Opportunity Delta trend. Stars mark your roster; they're saved in this browser only.
      </Text>
    </Box>
  );
}
