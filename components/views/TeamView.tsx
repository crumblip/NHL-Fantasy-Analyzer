"use client";

import Link from "next/link";
import { Box, Flex, Grid, Image, Text } from "@chakra-ui/react";
import { useTheme } from "next-themes";
import type { TeamViewData } from "@/lib/queries";
import { PageHeader, Panel } from "@/components/AppShell";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const mins = (s: number) => `${(s / 60).toFixed(1)} min`;

function Unit({ label, unit }: { label: string; unit: TeamViewData["F"][number] }) {
  return (
    <Box py="2.5" borderTopWidth="1px" borderColor="rink.borderSubtle" _first={{ borderTopWidth: 0, pt: 0 }}>
      <Flex align="center" gap="2" mb="1.5">
        <Text fontSize="sm" fontWeight="bold" color="rink.text" w="40px">
          {label}
        </Text>
        <Box flex="1" h="6px" bg="rink.surface2" rounded="full" overflow="hidden" title={`${pct(unit.sharedShare)} of team time in this state, together`}>
          <Box h="full" w={`${Math.min(100, unit.sharedShare * 100)}%`} bg="chart.s1" rounded="full" />
        </Box>
        <Text fontSize="xs" color="rink.sub" whiteSpace="nowrap">
          together {mins(unit.sharedSeconds)} · {pct(unit.sharedShare)}
        </Text>
      </Flex>
      <Flex gap="x" wrap="wrap" columnGap="3" rowGap="1" pl={{ base: 0, sm: "48px" }}>
        {unit.players.map((p) => (
          <Link key={p.id} href={`/player/${p.id}`}>
            <Text as="span" fontSize="sm" color="rink.text" _hover={{ color: "rink.accent" }}>
              {p.name}{" "}
              <Text as="span" fontSize="xs" color="rink.muted">
                {pct(p.share)}
              </Text>
            </Text>
          </Link>
        ))}
      </Flex>
    </Box>
  );
}

export function TeamView({ data }: { data: TeamViewData }) {
  const { resolvedTheme } = useTheme();
  const spans: { value: string; label: string }[] = [
    { value: "game", label: "Last game" },
    { value: "5", label: "Last 5" },
    { value: "season", label: "Season" },
  ];
  const first = data.games[0];
  const last = data.games[data.games.length - 1];
  return (
    <Box>
      <PageHeader
        title={data.team.name}
        subtitle={
          data.games.length === 1
            ? `${last.matchup}, ${last.date}. 1C going in: ${data.oneC ?? "–"}.`
            : `${data.games.length} games, ${first.date} → ${last.date}. Units re-detected from combined shared ice time.`
        }
      >
        <Flex gap="3" align="center">
          <Image src={resolvedTheme === "dark" ? data.team.dark_logo : data.team.logo} alt="" boxSize="44px" />
          <Flex role="group" aria-label="Time span" bg="rink.surface2" p="0.5" rounded="md" borderWidth="1px" borderColor="rink.border">
            {spans.map((s) => (
              <Link key={s.value} href={`/teams/${data.team.abbrev}?span=${s.value}`}>
                <Box
                  px="3"
                  py="1"
                  rounded="sm"
                  fontSize="sm"
                  whiteSpace="nowrap"
                  fontWeight={data.span === s.value ? "semibold" : "normal"}
                  bg={data.span === s.value ? "rink.surface" : "transparent"}
                  color={data.span === s.value ? "rink.text" : "rink.sub"}
                  aria-current={data.span === s.value ? "true" : undefined}
                >
                  {s.label}
                </Box>
              </Link>
            ))}
          </Flex>
        </Flex>
      </PageHeader>

      <Text fontSize="xs" color="rink.muted" mb="3">
        Team time: 5v5 {mins(data.teamSeconds.v5)}, PP {mins(data.teamSeconds.pp)}, PK {mins(data.teamSeconds.pk)}. % after a name = that player's share of the team's time in that state.
      </Text>

      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="4">
        <Panel title="Forward lines (5v5)">
          {data.F.length ? data.F.map((u) => <Unit key={u.rank} label={`L${u.rank}`} unit={u} />) : <Text color="rink.muted">None detected.</Text>}
        </Panel>
        <Panel title="Defense pairs (5v5)">
          {data.D.length ? data.D.map((u) => <Unit key={u.rank} label={`D${u.rank}`} unit={u} />) : <Text color="rink.muted">None detected.</Text>}
        </Panel>
        <Panel title="Power play">
          {data.PP.length ? data.PP.map((u) => <Unit key={u.rank} label={`PP${u.rank}`} unit={u} />) : <Text color="rink.muted">None detected.</Text>}
        </Panel>
        <Panel title="Penalty kill">
          {data.PK.length ? data.PK.map((u) => <Unit key={u.rank} label={`PK${u.rank}`} unit={u} />) : <Text color="rink.muted">None detected.</Text>}
        </Panel>
      </Grid>
    </Box>
  );
}

export function TeamsIndex({ teams }: { teams: { id: number; abbrev: string; name: string; logo: string; dark_logo: string }[] }) {
  const { resolvedTheme } = useTheme();
  return (
    <Box>
      <PageHeader title="Teams" subtitle="Lines, D pairs, power-play and penalty-kill units from shift data." />
      <Grid templateColumns={{ base: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", md: "repeat(4, 1fr)", lg: "repeat(6, 1fr)" }} gap="3">
        {teams.map((t) => (
          <Link key={t.id} href={`/teams/${t.abbrev}`}>
            <Flex direction="column" align="center" gap="2" p="3" bg="rink.surface" borderWidth="1px" borderColor="rink.border" rounded="lg" _hover={{ bg: "rink.hover" }}>
              <Image src={resolvedTheme === "dark" ? t.dark_logo : t.logo} alt="" boxSize="48px" />
              <Text fontSize="sm" color="rink.text" textAlign="center">
                {t.name}
              </Text>
            </Flex>
          </Link>
        ))}
      </Grid>
    </Box>
  );
}
