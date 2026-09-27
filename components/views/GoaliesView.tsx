"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Box, Text } from "@chakra-ui/react";
import { PageHeader } from "@/components/AppShell";
import { Grade } from "@/components/ui/Grade";

type Row = Record<string, any>;
type Key = "week_fp" | "week_starts" | "fp_per_start" | "proj_start_share" | "rest_fp" | "p_win" | "p_so" | "proj_ga" | "proj_sv" | "gsax_raw" | "fantasy_pctl" | "workload_pctl" | "quality_pctl";

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function GoaliesView({ asOf, rows }: { asOf: string | null; rows: Row[] }) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "week_fp", dir: -1 });
  const list = useMemo(() => [...rows].sort((a, b) => ((a[sort.key] ?? -1e9) - (b[sort.key] ?? -1e9)) * sort.dir), [rows, sort]);
  if (!asOf) return <PageHeader title="Goalies" subtitle="No goalie projections yet. Run npm run run:models." />;
  const week = rows[0] ? `${rows[0].week_start} → ${rows[0].week_end}` : "";

  const th = (key: Key, label: string, title: string, align: "right" | "center" = "right") => (
    <Box
      as="th"
      position="sticky"
      top="0"
      bg="rink.surface2"
      px="2"
      py="2"
      textAlign={align}
      fontSize="xs"
      fontWeight="semibold"
      whiteSpace="nowrap"
      cursor="pointer"
      title={title}
      color={sort.key === key ? "rink.text" : "rink.muted"}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "proj_ga" ? 1 : -1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </Box>
  );
  const td = (c: React.ReactNode, align: "right" | "left" | "center" = "right") => (
    <Box as="td" px="2" py="1.5" textAlign={align} fontSize="sm" color="rink.text" whiteSpace="nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>
      {c}
    </Box>
  );

  return (
    <Box>
      <PageHeader
        title="Goalie board"
        subtitle={`Projections as of ${asOf}. Week ${week}${rows[0]?.week_games === 0 ? "" : ""}. Weekly value = projected starts × fantasy points per start.`}
      />
      <Box bg="rink.surface" borderWidth="1px" borderColor="rink.border" rounded="lg" overflow="auto" maxH="calc(100vh - 200px)">
        <Box as="table" w="full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <Box as="thead">
            <Box as="tr">
              <Box as="th" position="sticky" top="0" bg="rink.surface2" px="2" py="2" textAlign="left" fontSize="xs" color="rink.muted">
                Goalie
              </Box>
              {th("week_starts", "Starts", "Projected starts this week")}
              {th("week_fp", "Week FP", "Projected fantasy points this week")}
              {th("fp_per_start", "FP/start", "Expected fantasy points per start")}
              {th("proj_start_share", "Share", "Projected share of the team's starts")}
              {th("rest_fp", "Season FP", "Projected fantasy points over the remaining schedule")}
              {th("p_win", "W%", "Win probability per start")}
              {th("p_so", "SO%", "Shutout probability per start")}
              {th("proj_ga", "GA", "Goals against per start")}
              {th("proj_sv", "SV", "Saves per start")}
              {th("gsax_raw", "GSAx", "Goals saved above expected, this season and last")}
              {th("fantasy_pctl", "Fant", "Fantasy grade", "center")}
              {th("workload_pctl", "Work", "Workload grade", "center")}
              {th("quality_pctl", "Qual", "Quality grade", "center")}
            </Box>
          </Box>
          <Box as="tbody">
            {list.map((r) => (
              <Box as="tr" key={r.id} _hover={{ bg: "rink.hover" }}>
                <Box as="td" px="2" py="1.5" minW="190px">
                  <Link href={`/player/${r.id}`}>
                    <Text as="span" fontSize="sm" fontWeight="semibold" color="rink.text" _hover={{ color: "rink.accent" }}>
                      {r.name}
                    </Text>
                  </Link>
                  <Text as="span" fontSize="xs" color="rink.muted" ml="2">
                    {r.team}
                  </Text>
                </Box>
                {td(r.week_starts.toFixed(1))}
                {td(<Text as="span" fontWeight="semibold">{r.week_fp.toFixed(1)}</Text>)}
                {td(`${r.fp_per_start.toFixed(2)}`)}
                {td(pct(r.proj_start_share))}
                {td(r.rest_fp.toFixed(0))}
                {td(pct(r.p_win))}
                {td(pct(r.p_so))}
                {td(r.proj_ga.toFixed(2))}
                {td(r.proj_sv.toFixed(1))}
                {td(<Text as="span" color={r.gsax_raw >= 0 ? "rink.pos" : "rink.neg"}>{`${r.gsax_raw >= 0 ? "+" : ""}${r.gsax_raw.toFixed(1)}`}</Text>)}
                {td(<Grade letter={r.fantasy_grade} pctl={r.fantasy_pctl} />, "center")}
                {td(<Grade letter={r.workload_grade} pctl={r.workload_pctl} />, "center")}
                {td(<Grade letter={r.quality_grade} pctl={r.quality_pctl} />, "center")}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      <Text fontSize="xs" color="rink.muted" mt="3">
        Grades need 5+ NHL games in the window. Start shares blend the last 10 team games with the season and account for back-to-backs.
      </Text>
    </Box>
  );
}
