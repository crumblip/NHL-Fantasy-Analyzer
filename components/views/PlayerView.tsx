"use client";

import Link from "next/link";
import { Box, Flex, Grid, Image, Text } from "@chakra-ui/react";
import type { PlayerData } from "@/lib/queries";
import { Panel } from "@/components/AppShell";
import { Grade, Tag, TrendArrow } from "@/components/ui/Grade";
import { FpBars } from "@/components/charts/FpBars";
import { TrendLines } from "@/components/charts/TrendLines";

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);
const mins = (secs: number | null | undefined) => (secs === null || secs === undefined ? "–" : (secs / 60).toFixed(1));
const mmss = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`;

const INPUT_LABELS: Record<string, string> = {
  pp_toi_share: "PP share",
  pp1_rate: "PP1 rate",
  ev_toi_share: "5v5 share",
  with_1c_share: "Time with 1C",
  top_line_rate: "Top-unit rate",
  linemate_quality: "Linemate quality",
};

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Box>
      <Text fontSize="xs" color="rink.muted">
        {label}
      </Text>
      <Text fontSize="xl" fontWeight="bold" color="rink.text" lineHeight="1.2">
        {value}
      </Text>
      {sub && (
        <Text fontSize="xs" color="rink.sub">
          {sub}
        </Text>
      )}
    </Box>
  );
}

function GradeTile({ label, letter, pctl, extra }: { label: string; letter: string | null; pctl: number | null; extra?: React.ReactNode }) {
  return (
    <Flex direction="column" align="center" gap="1" minW="72px">
      <Flex align="center">
        <Grade letter={letter} pctl={pctl} size="lg" />
        {extra}
      </Flex>
      <Text fontSize="xs" color="rink.muted">
        {label}
      </Text>
      <Text fontSize="2xs" color="rink.muted">
        {pctl !== null && pctl !== undefined ? `${Math.round(pctl)}th pct` : ""}
      </Text>
    </Flex>
  );
}

function Table({ head, rows, align }: { head: string[]; rows: React.ReactNode[][]; align?: ("left" | "right" | "center")[] }) {
  return (
    <Box overflowX="auto">
      <Box as="table" w="full" fontSize="sm" style={{ borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
        <Box as="thead">
          <Box as="tr">
            {head.map((h, i) => (
              <Box as="th" key={i} px="2" py="1.5" textAlign={align?.[i] ?? (i === 0 ? "left" : "right")} fontSize="xs" color="rink.muted" fontWeight="semibold" whiteSpace="nowrap" borderBottomWidth="1px" borderColor="rink.border">
                {h}
              </Box>
            ))}
          </Box>
        </Box>
        <Box as="tbody">
          {rows.map((r, i) => (
            <Box as="tr" key={i} borderBottomWidth="1px" borderColor="rink.borderSubtle">
              {r.map((c, j) => (
                <Box as="td" key={j} px="2" py="1.5" textAlign={align?.[j] ?? (j === 0 ? "left" : "right")} color="rink.text" whiteSpace="nowrap">
                  {c}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export function PlayerView({ data }: { data: PlayerData }) {
  const { bio, skater, goalie, prospect, deployment, signal } = data;
  const isGoalie = bio.position === "G";
  const recent = [...data.gameLog].reverse();
  const bars = recent.map((g) => ({
    label: `${g.date.slice(5)} ${g.opp}`,
    value: g.fp,
    detail: g.isGoalie ? `${g.decision} · ${g.sv} SV, ${g.ga} GA` : `${g.g}G ${g.a}A · ${g.sog} SOG · ${g.hit} HIT · ${g.blk} BLK`,
  }));
  const avgFp = recent.length ? recent.reduce((s, g) => s + g.fp, 0) / recent.length : undefined;
  const inputs = signal?.inputs as Record<string, { prior: number; recent: number; z?: number }> | null;

  return (
    <Box>
      {/* Header */}
      <Panel mb="4">
        <Flex gap="4" align="center" wrap="wrap">
          {bio.headshot && <Image src={bio.headshot} alt={bio.name} boxSize={{ base: "72px", md: "96px" }} rounded="full" bg="rink.surface2" />}
          <Box flex="1" minW="200px">
            <Text as="h1" fontSize="2xl" fontWeight="bold" color="rink.text">
              {bio.name}
            </Text>
            <Text fontSize="sm" color="rink.sub">
              {[bio.team, bio.position, bio.age ? `age ${bio.age.toFixed(0)}` : null, bio.height ? `${Math.floor(bio.height / 12)}'${bio.height % 12}"` : null, bio.weight ? `${bio.weight} lb` : null, bio.shoots ? `shoots ${bio.shoots}` : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <Text fontSize="xs" color="rink.muted" mt="0.5">
              {bio.draft}
            </Text>
            <Flex gap="1" mt="2" wrap="wrap">
              {skater?.alert && (
                <Tag tone={skater.alert === "pickup" ? "pos" : "neg"}>{skater.alert === "pickup" ? "Pickup alert" : "Downgrade alert"}</Tag>
              )}
              {skater?.promotion_flag ? <Tag tone="accent">In-game promotion</Tag> : null}
              {skater?.mismatch && <Tag tone="warn">{skater.mismatch}</Tag>}
              {skater?.new_team ? <Tag>New team</Tag> : null}
            </Flex>
          </Box>
          {skater && (
            <Flex gap="3" wrap="wrap">
              <GradeTile label="Fantasy" letter={skater.fantasy_grade} pctl={skater.fantasy_pctl} />
              <GradeTile label="Offense" letter={skater.offense_grade} pctl={skater.offense_pctl} />
              <GradeTile label="Opportunity" letter={skater.opportunity_grade} pctl={skater.opportunity_pctl} extra={<TrendArrow trend={skater.trend} delta={skater.opportunity_delta} />} />
              <GradeTile label="Peripheral" letter={skater.peripheral_grade} pctl={skater.peripheral_pctl} />
            </Flex>
          )}
          {goalie && (
            <Flex gap="3" wrap="wrap">
              <GradeTile label="Fantasy" letter={goalie.fantasy_grade} pctl={goalie.fantasy_pctl} />
              <GradeTile label="Workload" letter={goalie.workload_grade} pctl={goalie.workload_pctl} />
              <GradeTile label="Quality" letter={goalie.quality_grade} pctl={goalie.quality_pctl} />
            </Flex>
          )}
        </Flex>
      </Panel>

      {skater?.alert_text && (
        <Box mb="4" px="4" py="3" rounded="lg" borderWidth="1px" borderColor={skater.alert === "pickup" ? "rink.pos" : "rink.neg"} bg="rink.surface">
          <Text fontSize="sm" color="rink.text">
            <Text as="span" fontWeight="semibold">
              {skater.alert === "pickup" ? "Why the pickup alert: " : "Why the downgrade: "}
            </Text>
            {skater.alert_text}
          </Text>
        </Box>
      )}

      <Grid templateColumns={{ base: "1fr", lg: "3fr 2fr" }} gap="4">
        <Flex direction="column" gap="4" minW="0">
          {skater && (
            <Panel title={`Projection (as of ${skater.as_of_date})`}>
              <Grid templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }} gap="4" mb="4">
                <Stat label="FP per game" value={skater.proj_fp_gp.toFixed(2)} sub={`floor ${skater.floor_fp.toFixed(1)} · ceiling ${skater.ceiling_fp.toFixed(1)}`} />
                <Stat label={skater.games_remaining > 70 ? "Season FP" : "Rest of season FP"} value={skater.rest_fp.toFixed(0)} sub={`${skater.expected_games.toFixed(0)} expected games`} />
                <Stat label="Next 7 days" value={skater.next7_games ? skater.next7_fp.toFixed(1) : "–"} sub={`${skater.next7_games} games`} />
                <Stat label="Value over replacement" value={`${skater.vor >= 0 ? "+" : ""}${skater.vor.toFixed(0)}`} sub={`replacement ${skater.replacement_fp_gp.toFixed(2)} FP/GP`} />
              </Grid>
              <Table
                head={["Per game", "G", "A", "PPP", "SHP", "SOG", "HIT", "BLK", "PIM", "EV min", "PP min", "SH min"]}
                rows={[
                  [
                    "Projected",
                    skater.proj_g.toFixed(2),
                    skater.proj_a.toFixed(2),
                    skater.proj_ppp.toFixed(2),
                    skater.proj_shp.toFixed(2),
                    skater.proj_sog.toFixed(2),
                    skater.proj_hit.toFixed(2),
                    skater.proj_blk.toFixed(2),
                    skater.proj_pim.toFixed(2),
                    mins(skater.proj_toi_ev),
                    mins(skater.proj_toi_pp),
                    mins(skater.proj_toi_sh),
                  ],
                ]}
              />
            </Panel>
          )}

          {goalie && (
            <Panel title={`Goalie projection (as of ${goalie.as_of_date})`}>
              <Grid templateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }} gap="4">
                <Stat label="FP per start" value={goalie.fp_per_start.toFixed(2)} sub={`floor ${goalie.floor_fp.toFixed(1)} · ceiling ${goalie.ceiling_fp.toFixed(1)}`} />
                <Stat label="Projected start share" value={pct(goalie.proj_start_share)} sub={`last 10: ${pct(goalie.start_share_l10)} · season: ${pct(goalie.start_share_season)}`} />
                <Stat label={`Week ${goalie.week_start.slice(5)} → ${goalie.week_end.slice(5)}`} value={goalie.week_fp.toFixed(1)} sub={`${goalie.week_starts.toFixed(1)} projected starts of ${goalie.week_games}`} />
                <Stat label="GSAx (this + last season)" value={`${goalie.gsax_raw >= 0 ? "+" : ""}${goalie.gsax_raw.toFixed(1)}`} sub="goals saved above expected" />
                <Stat label="Win probability" value={pct(goalie.p_win)} sub={`OT loss ${pct(goalie.p_otl)}`} />
                <Stat label="Shutout chance" value={pct(goalie.p_so)} />
                <Stat label="Goals against" value={goalie.proj_ga.toFixed(2)} sub="per start" />
                <Stat label="Saves" value={goalie.proj_sv.toFixed(1)} sub="per start" />
              </Grid>
            </Panel>
          )}

          <Panel title={`Fantasy points, last ${bars.length} games`} action={avgFp !== undefined ? <Text fontSize="xs" color="rink.muted">avg {avgFp.toFixed(2)} (dashed)</Text> : null}>
            {bars.length ? <FpBars data={bars} average={avgFp} /> : <Text fontSize="sm" color="rink.muted">No games in our data.</Text>}
          </Panel>

          {data.trend.length > 1 && (
            <Panel title={`Deployment trend, ${String(data.trendSeason).slice(0, 4)}-${String(data.trendSeason).slice(6)} (rolling last 5 games)`}>
              <TrendLines
                dates={data.trend.map((t) => t.date)}
                series={[
                  { key: "ev", label: "5v5 share", short: "5v5", color: "chart.s1", values: data.trend.map((t) => t.ev) },
                  { key: "pp", label: "PP share", short: "PP", color: "chart.s2", values: data.trend.map((t) => t.pp) },
                  ...(data.trend.some((t) => t.c1 !== null)
                    ? [{ key: "c1", label: "With 1C", short: "1C", color: "chart.s3", values: data.trend.map((t) => t.c1) }]
                    : []),
                ]}
              />
            </Panel>
          )}

          <Panel title="Game log">
            <Table
              head={
                isGoalie
                  ? ["Date", "Opp", "Result", "Dec", "SV", "GA", "SO", "TOI", "FP"]
                  : ["Date", "Opp", "Result", "G", "A", "PPP", "SOG", "HIT", "BLK", "PIM", "TOI", "PP TOI", "FP"]
              }
              rows={data.gameLog.map((g) =>
                isGoalie
                  ? [g.date, g.opp, g.result, g.decision, g.sv, g.ga, g.so ? "✓" : "", mmss(g.toi), g.fp.toFixed(2)]
                  : [g.date, g.opp, g.result, g.g, g.a, g.ppp, g.sog, g.hit, g.blk, g.pim, mmss(g.toi), mmss(g.toiPp), <Text as="span" fontWeight="semibold" key="fp">{g.fp.toFixed(2)}</Text>]
              )}
            />
          </Panel>
        </Flex>

        <Flex direction="column" gap="4" minW="0">
          {deployment && (
            <Panel title={`Deployment (last game ${deployment.date})`}>
              <Flex direction="column" gap="3">
                {deployment.line && (
                  <Box>
                    <Text fontSize="xs" color="rink.muted">
                      {deployment.lineKind === "F" ? `Forward line ${deployment.line.rank}` : `D pair ${deployment.line.rank}`}
                    </Text>
                    <Text fontSize="sm" color="rink.text">
                      with {deployment.line.mates.join(", ")}
                    </Text>
                  </Box>
                )}
                <Box>
                  <Text fontSize="xs" color="rink.muted">
                    Power play
                  </Text>
                  <Text fontSize="sm" color="rink.text">
                    {deployment.pp ? `PP${deployment.pp.rank} last game` : "No PP unit last game"}
                    {deployment.l10 ? ` · ${pct(deployment.l10.pp_toi_share)} of team PP time (last 10) · PP1 in ${pct(deployment.l10.pp1_rate)} of games` : ""}
                  </Text>
                </Box>
                <Box>
                  <Text fontSize="xs" color="rink.muted">
                    Penalty kill
                  </Text>
                  <Text fontSize="sm" color="rink.text">
                    {deployment.pk ? `PK${deployment.pk.rank} last game` : "No PK unit last game"}
                    {deployment.l10 ? ` · ${pct(deployment.l10.pk_toi_share)} of team PK time (last 10)` : ""}
                  </Text>
                </Box>
                {deployment.l10 && (
                  <Grid templateColumns="repeat(2, 1fr)" gap="3">
                    <Stat label="5v5 share (last 10)" value={pct(deployment.l10.ev_toi_share)} />
                    <Stat label="Top-unit rate" value={pct(deployment.l10.top_line_rate)} />
                    {deployment.oneC === bio.name ? (
                      <Stat label="Top center" value="1C" sub="He is the team's 1C" />
                    ) : (
                      <Stat label={`With 1C${deployment.oneC ? ` (${deployment.oneC})` : ""}`} value={pct(deployment.l10.with_1c_share)} />
                    )}
                    <Stat label="OZ faceoff share" value={pct(deployment.l10.oz_fo_share)} />
                  </Grid>
                )}
                <Box>
                  <Text fontSize="xs" color="rink.muted" mb="1">
                    Top 5v5 linemates, last 10 games (% of his 5v5 time)
                  </Text>
                  {deployment.mates.map((m: { id: number; name: string; share: number }) => (
                    <Flex key={m.id} align="center" gap="2" mb="1">
                      <Link href={`/player/${m.id}`}>
                        <Text fontSize="sm" color="rink.text" _hover={{ color: "rink.accent" }} minW="150px">
                          {m.name}
                        </Text>
                      </Link>
                      <Box flex="1" h="6px" bg="rink.surface2" rounded="full" overflow="hidden">
                        <Box h="full" w={`${Math.min(100, m.share * 100)}%`} bg="chart.s1" rounded="full" />
                      </Box>
                      <Text fontSize="xs" color="rink.sub" w="36px" textAlign="right">
                        {pct(m.share)}
                      </Text>
                    </Flex>
                  ))}
                </Box>
              </Flex>
            </Panel>
          )}

          {signal && inputs && (
            <Panel title={`Opportunity Delta (as of ${signal.as_of_date})`} action={<Text fontSize="sm" fontWeight="bold" color={signal.opportunity_delta >= 0 ? "rink.pos" : "rink.neg"}>{signal.opportunity_delta >= 0 ? "+" : ""}{signal.opportunity_delta.toFixed(2)}</Text>}>
              <Text fontSize="xs" color="rink.muted" mb="2">
                Last 5 games vs the 20 before. z = change in league-wide standard deviations.
              </Text>
              <Table
                head={["Input", "Prior 20", "Last 5", "z"]}
                rows={Object.entries(inputs).map(([k, v]) => [
                  INPUT_LABELS[k] ?? k,
                  k === "linemate_quality" ? v.prior.toFixed(2) : pct(v.prior),
                  k === "linemate_quality" ? v.recent.toFixed(2) : pct(v.recent),
                  <Text as="span" key="z" color={(v.z ?? 0) >= 1 ? "rink.pos" : (v.z ?? 0) <= -1 ? "rink.neg" : "rink.sub"}>
                    {v.z === undefined ? "–" : `${v.z >= 0 ? "+" : ""}${v.z.toFixed(1)}`}
                  </Text>,
                ])}
              />
            </Panel>
          )}

          {!isGoalie && data.promotion.length > 0 && (
            <Panel title="In-game promotion check (last 5 games)">
              <Text fontSize="xs" color="rink.muted" mb="2">
                Share of his 5v5 time with the 1C / established top line, 1st period vs 3rd + OT. A late jump in 3 of 5 games earns the badge.
              </Text>
              <Table
                head={["Game", "1C: P1 → late", "Top line: P1 → late", "Flag"]}
                rows={data.promotion.map((p: any) => {
                  const share = (a: number | null, b: number) => (a === null || !b ? "–" : pct(a / b));
                  return [
                    p.date,
                    `${share(p.p1_with_1c, p.p1_5v5)} → ${share(p.late_with_1c, p.late_5v5)}`,
                    `${share(p.p1_with_top, p.p1_5v5)} → ${share(p.late_with_top, p.late_5v5)}`,
                    p.promo_game ? "↑" : "",
                  ];
                })}
              />
            </Panel>
          )}

          {prospect && (
            <Panel title={`Prospect outlook (${prospect.league} ${String(prospect.snapshot_season).slice(0, 4)}-${String(prospect.snapshot_season).slice(6)})`} action={<Flex gap="1" align="center"><Grade letter={prospect.grade} pctl={prospect.pctl} /><Tag>{prospect.risk} risk</Tag></Flex>}>
              <Grid templateColumns="repeat(2, 1fr)" gap="3" mb="3">
                <Stat label="League-translated PPG" value={prospect.nhle_ppg.toFixed(2)} sub={`peak projection ${prospect.peak_nhle_ppg.toFixed(2)}`} />
                <Stat label="Expected peak FP/GP" value={prospect.expected_peak_fpg.toFixed(2)} sub={`median ${prospect.median_peak_fpg.toFixed(2)}`} />
                <Stat label="P(200+ NHL games)" value={pct(prospect.p_regular)} />
                <Stat label="P(50 / 70-pt season)" value={`${pct(prospect.p_peak50)} / ${pct(prospect.p_peak70)}`} />
              </Grid>
              <Text fontSize="xs" color="rink.muted" mb="1">
                Closest comparables at the same age
              </Text>
              <Table
                head={["Player", "League", "NHLe", "GP", "Peak pts", "Peak FP/GP"]}
                rows={prospect.comparables.slice(0, 10).map((c: any) => [
                  <Link key="n" href={`/player/${c.id}`}>{c.name}</Link>,
                  c.league,
                  c.nhle.toFixed(2),
                  c.gp,
                  c.peakPts,
                  c.peakFpg.toFixed(2),
                ])}
              />
            </Panel>
          )}
        </Flex>
      </Grid>
    </Box>
  );
}
