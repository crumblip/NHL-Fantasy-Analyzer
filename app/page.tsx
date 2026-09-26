"use client";

import { useEffect, useState } from "react";
import { Badge, Box, Flex, Heading, IconButton, SimpleGrid, Text } from "@chakra-ui/react";
import { useTheme } from "next-themes";
import { LuMoon, LuSun } from "react-icons/lu";

interface Health {
  ok: boolean;
  tables: string[];
  league: { teams: number; roster: Record<string, number> };
  scoring: { skater: Record<string, number>; goalie: Record<string, number> };
}

const VIEWS: { name: string; blurb: string; phase: number }[] = [
  { name: "Alerts feed", blurb: "Pickup and downgrade alerts ranked by Opportunity Delta", phase: 3 },
  { name: "Team lines", blurb: "Forward lines, D pairs, PP and PK units with % shared TOI", phase: 3 },
  { name: "Rankings", blurb: "Every skater, sortable by any grade or projection", phase: 4 },
  { name: "Player card", blurb: "Grades, projection with floor/ceiling, linemates, badges", phase: 4 },
  { name: "Goalie board", blurb: "Projected starts this week and weekly value", phase: 5 },
  { name: "Prospect board", blurb: "Peak-value grades, probabilities and comparables", phase: 6 },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <IconButton
      aria-label="Toggle colour mode"
      variant="ghost"
      size="sm"
      color="rink.sub"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {mounted ? dark ? <LuSun /> : <LuMoon /> : null}
    </IconButton>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Box bg="rink.surface" borderWidth="1px" borderColor="rink.border" rounded="lg" p="4">
      {children}
    </Box>
  );
}

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <Box maxW="1200px" mx="auto" px={{ base: "4", md: "6" }} py="6">
      <Flex align="center" justify="space-between" mb="6">
        <Box>
          <Heading size="lg" color="rink.text">
            NHL Fantasy Analyzer
          </Heading>
          <Text color="rink.muted" fontSize="sm">
            Opportunity and deployment first
          </Text>
        </Box>
        <ThemeToggle />
      </Flex>

      <SimpleGrid columns={{ base: 1, md: 2 }} gap="4" mb="6">
        <Panel>
          <Text fontSize="xs" color="rink.muted" textTransform="uppercase" mb="2">
            League
          </Text>
          {health ? (
            <>
              <Text color="rink.text">{health.league.teams} teams</Text>
              <Text fontFamily="mono" fontSize="sm" color="rink.sub">
                {Object.entries(health.league.roster)
                  .map(([pos, n]) => `${pos}×${n}`)
                  .join("  ")}
              </Text>
            </>
          ) : (
            <Text color={error ? "rink.neg" : "rink.muted"}>{error ? "API unreachable" : "Loading…"}</Text>
          )}
        </Panel>
        <Panel>
          <Text fontSize="xs" color="rink.muted" textTransform="uppercase" mb="2">
            Skater scoring
          </Text>
          {health && (
            <Text fontFamily="mono" fontSize="sm" color="rink.sub">
              {Object.entries(health.scoring.skater)
                .map(([k, v]) => `${k} ${v}`)
                .join("  ·  ")}
            </Text>
          )}
          <Text fontSize="xs" color="rink.muted" mt="3">
            Database tables: {health ? health.tables.length : "…"}
          </Text>
        </Panel>
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap="4">
        {VIEWS.map((v) => (
          <Panel key={v.name}>
            <Flex justify="space-between" align="center" mb="1">
              <Text fontWeight="semibold" color="rink.text">
                {v.name}
              </Text>
              <Badge variant="subtle" size="sm">
                Phase {v.phase}
              </Badge>
            </Flex>
            <Text fontSize="sm" color="rink.sub">
              {v.blurb}
            </Text>
          </Panel>
        ))}
      </SimpleGrid>
    </Box>
  );
}
