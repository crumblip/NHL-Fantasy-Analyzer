"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Box, Flex, Grid, Text } from "@chakra-ui/react";
import type { AlertRow } from "@/lib/queries";
import { PageHeader, Panel, Segmented } from "@/components/AppShell";
import { Grade, Tag } from "@/components/ui/Grade";

function AlertCard({ a }: { a: AlertRow }) {
  const up = a.alert === "pickup";
  return (
    <Box py="3" borderTopWidth="1px" borderColor="rink.borderSubtle" _first={{ borderTopWidth: 0, pt: 0 }}>
      <Flex align="center" gap="2" wrap="wrap">
        <Link href={`/player/${a.id}`}>
          <Text fontWeight="semibold" color="rink.text" _hover={{ color: "rink.accent" }}>
            {a.name}
          </Text>
        </Link>
        <Text fontSize="xs" color="rink.muted">
          {a.team} · {a.position}
        </Text>
        <Box flex="1" />
        <Grade letter={a.grade} pctl={a.gradePctl} />
        <Text fontSize="sm" fontWeight="bold" color={up ? "rink.pos" : "rink.neg"} minW="52px" textAlign="right" title="Opportunity Delta">
          {a.delta !== null ? `${a.delta >= 0 ? "+" : ""}${a.delta.toFixed(2)}` : ""}
        </Text>
      </Flex>
      <Text fontSize="sm" color="rink.sub" mt="1">
        {a.text}
      </Text>
      <Flex gap="2" mt="1" align="center">
        <Text fontSize="xs" color="rink.muted">
          as of {a.date}
        </Text>
        {a.promotion && <Tag tone="accent">In-game promotion</Tag>}
      </Flex>
    </Box>
  );
}

export function AlertsView({ data }: { data: { asOf: string | null; gradeDate?: string | null; pickups: AlertRow[]; downgrades: AlertRow[]; promotions: AlertRow[] } }) {
  const [sort, setSort] = useState<"delta" | "grade">("delta");
  const sorted = (list: AlertRow[], dir: 1 | -1) =>
    [...list].sort((a, b) => (sort === "delta" ? dir * ((b.delta ?? 0) - (a.delta ?? 0)) : (b.gradePctl ?? -1) - (a.gradePctl ?? -1)));
  const pickups = useMemo(() => sorted(data.pickups, 1), [data.pickups, sort]);
  const downgrades = useMemo(() => sorted(data.downgrades, -1), [data.downgrades, sort]);

  if (!data.asOf) return <PageHeader title="Alerts" subtitle="No signals yet. Run npm run build:deployment." />;

  return (
    <Box>
      <PageHeader
        title="Alerts"
        subtitle={`Latest deployment signals through ${data.asOf}. Opportunity Delta compares each player's last 5 games with the 20 before. Fantasy grades as of ${data.gradeDate ?? "–"}.`}
      >
        <Segmented
          label="Sort alerts"
          value={sort}
          options={[
            { value: "delta", label: "By Opportunity Delta" },
            { value: "grade", label: "By Fantasy Grade" },
          ]}
          onChange={setSort}
        />
      </PageHeader>
      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="4">
        <Panel title={`Pickup alerts (${pickups.length})`}>
          {pickups.length ? pickups.map((a) => <AlertCard key={a.id} a={a} />) : <Text color="rink.muted">None right now.</Text>}
        </Panel>
        <Flex direction="column" gap="4">
          <Panel title={`Downgrades, rostered-quality players (${downgrades.length})`}>
            {downgrades.length ? downgrades.map((a) => <AlertCard key={a.id} a={a} />) : <Text color="rink.muted">None right now.</Text>}
          </Panel>
          <Panel title={`In-game promotion badge (${data.promotions.length})`}>
            <Text fontSize="xs" color="rink.muted" mb="2">
              Forwards whose late-game time with the 1C or top line jumped in 3+ of their last 5 games — often the earliest sign of a real promotion.
            </Text>
            {data.promotions.map((a) => (
              <Flex key={a.id} align="center" gap="2" py="1.5" borderTopWidth="1px" borderColor="rink.borderSubtle" _first={{ borderTopWidth: 0 }}>
                <Link href={`/player/${a.id}`}>
                  <Text fontSize="sm" fontWeight="semibold" color="rink.text" _hover={{ color: "rink.accent" }}>
                    {a.name}
                  </Text>
                </Link>
                <Text fontSize="xs" color="rink.muted">
                  {a.team} · {a.position}
                </Text>
                <Box flex="1" />
                <Text fontSize="xs" color="rink.sub">
                  {a.promotionGames} of last 5 games
                </Text>
                <Grade letter={a.grade} pctl={a.gradePctl} />
              </Flex>
            ))}
          </Panel>
        </Flex>
      </Grid>
    </Box>
  );
}
