"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Box, Flex, Input, Spinner, Text } from "@chakra-ui/react";
import { PageHeader, Segmented } from "@/components/AppShell";
import { Grade, Tag } from "@/components/ui/Grade";

type Row = Record<string, any>;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const season = (s: number) => `${String(s).slice(0, 4)}-${String(s).slice(6)}`;
const PAGE = 100;

/** Comparables load when a row is opened, so the board itself stays light. */
function Comparables({ playerId }: { playerId: number }) {
  const [comps, setComps] = useState<any[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/prospects/${playerId}/comparables`)
      .then((r) => r.json())
      .then((d) => live && setComps(d.comparables ?? []))
      .catch(() => live && setComps([]));
    return () => {
      live = false;
    };
  }, [playerId]);
  if (!comps) return <Spinner size="sm" color="rink.muted" />;
  return (
    <Flex wrap="wrap" gap="2">
      {comps.map((c) => (
        <Link key={c.id} href={`/player/${c.id}`}>
          <Box px="2" py="1" rounded="md" bg="rink.surface" borderWidth="1px" borderColor="rink.border" fontSize="xs" _hover={{ borderColor: "rink.accent" }}>
            <Text as="span" color="rink.text" fontWeight="semibold">
              {c.name}
            </Text>{" "}
            <Text as="span" color="rink.muted">
              {c.league} {season(c.season)} · {c.gp} GP · peak {c.peakPts} pts · {c.peakFpg.toFixed(2)} FP/GP
            </Text>
          </Box>
        </Link>
      ))}
    </Flex>
  );
}

export function ProspectsView({ asOf, rows }: { asOf: string | null; rows: Row[] }) {
  const [pos, setPos] = useState<"ALL" | "F" | "D">("ALL");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (pos === "ALL" || r.position === pos) && (!needle || String(r.name).toLowerCase().includes(needle)));
  }, [rows, pos, q]);
  useEffect(() => setLimit(PAGE), [pos, q]);
  if (!asOf) return <PageHeader title="Prospects" subtitle="No prospect grades yet. Run npm run ingest:prospects, then npm run run:prospects." />;

  const th = (label: string, title?: string, align: "left" | "right" | "center" = "right") => (
    <Box as="th" position="sticky" top="0" bg="rink.surface2" px="2" py="2" textAlign={align} fontSize="xs" fontWeight="semibold" color="rink.muted" whiteSpace="nowrap" title={title}>
      {label}
    </Box>
  );
  const td = (c: React.ReactNode, align: "left" | "right" | "center" = "right") => (
    <Box as="td" px="2" py="1.5" textAlign={align} fontSize="sm" color="rink.text" whiteSpace="nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>
      {c}
    </Box>
  );

  return (
    <Box>
      <PageHeader
        title="Prospect board"
        subtitle={`As of ${asOf}. Expected peak fantasy value from the 25 most similar drafted players at the same age (busts count as 0). Click a row for the comparables.`}
      >
        <Segmented
          label="Position"
          value={pos}
          options={[
            { value: "ALL", label: "All" },
            { value: "F", label: "Forwards" },
            { value: "D", label: "Defense" },
          ]}
          onChange={setPos}
        />
      </PageHeader>
      <Input size="sm" maxW="240px" mb="3" placeholder="Filter by name" aria-label="Filter prospects by name" value={q} onChange={(e) => setQ(e.target.value)} bg="rink.surface2" borderColor="rink.border" />
      <Box bg="rink.surface" borderWidth="1px" borderColor="rink.border" rounded="lg" overflow="auto" maxH="calc(100vh - 200px)">
        <Box as="table" w="full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <Box as="thead">
            <Box as="tr">
              {th("#", undefined, "right")}
              {th("Prospect", undefined, "left")}
              {th("Age", "Age on Sept 15 of the snapshot season")}
              {th("Draft", undefined, "left")}
              {th("League", "Main league of the snapshot season", "left")}
              {th("NHLe", "League-translated points per game")}
              {th("Peak", "Projected NHLe points per game at age 25")}
              {th("P(200 GP)", "Share of comparables who played 200+ NHL games")}
              {th("P(50 pts)", "Share of comparables with a 50-point season")}
              {th("P(70 pts)", "Share of comparables with a 70-point season")}
              {th("Exp. peak FP/GP", "Mean peak fantasy points per game of the comparables")}
              {th("Grade", undefined, "center")}
              {th("Risk", "Spread of comparables' outcomes", "left")}
            </Box>
          </Box>
          <Box as="tbody">
            {list.slice(0, limit).map((r, i) => (
              <Fragment key={r.player_id}>
                <Box
                  as="tr"
                  cursor="pointer"
                  _hover={{ bg: "rink.hover" }}
                  aria-expanded={open === r.player_id}
                  onClick={() => setOpen(open === r.player_id ? null : r.player_id)}
                >
                  {td(<Text as="span" fontSize="xs" color="rink.muted">{i + 1}</Text>)}
                  <Box as="td" px="2" py="1.5" minW="180px">
                    <Link href={`/player/${r.player_id}`} onClick={(e) => e.stopPropagation()}>
                      <Text as="span" fontSize="sm" fontWeight="semibold" color="rink.text" _hover={{ color: "rink.accent" }}>
                        {r.name}
                      </Text>
                    </Link>
                    <Text as="span" fontSize="xs" color="rink.muted" ml="2">
                      {r.position}
                    </Text>
                  </Box>
                  {td(r.age.toFixed(1))}
                  {td(r.draft_year ? `${r.draft_year} #${r.draft_overall}` : "undrafted", "left")}
                  {td(<Text as="span" color="rink.sub">{`${r.league} ${season(r.snapshot_season)}`}</Text>, "left")}
                  {td(r.nhle_ppg.toFixed(2))}
                  {td(r.peak_nhle_ppg.toFixed(2))}
                  {td(pct(r.p_regular))}
                  {td(pct(r.p_peak50))}
                  {td(pct(r.p_peak70))}
                  {td(<Text as="span" fontWeight="semibold">{r.expected_peak_fpg.toFixed(2)}</Text>)}
                  {td(<Grade letter={r.grade} pctl={r.pctl} />, "center")}
                  {td(<Tag tone={r.risk === "low" ? "pos" : r.risk === "high" ? "neg" : "neutral"}>{r.risk}</Tag>, "left")}
                </Box>
                {open === r.player_id && (
                  <Box as="tr">
                    <td colSpan={13} style={{ padding: 0 }}>
                    <Box px="4" py="3" bg="rink.surface2">
                      <Text fontSize="xs" color="rink.muted" mb="2">
                        25 closest comparables (their season at the same age → NHL outcome)
                      </Text>
                      <Comparables playerId={r.player_id} />
                    </Box>
                    </td>
                  </Box>
                )}
              </Fragment>
            ))}
          </Box>
        </Box>
      </Box>
      {list.length > limit && (
        <Flex justify="center" mt="3">
          <Box as="button" px="4" py="2" rounded="md" fontSize="sm" bg="rink.surface2" borderWidth="1px" borderColor="rink.border" color="rink.text" onClick={() => setLimit((l) => l + PAGE)}>
            Show more ({list.length - limit} left)
          </Box>
        </Flex>
      )}
    </Box>
  );
}
