"use client";

import { Box } from "@chakra-ui/react";

const tier = (letter: string | null | undefined) => {
  const c = letter?.[0];
  return c === "A" ? "a" : c === "B" ? "b" : c === "C" ? "c" : "d";
};

/** Letter grade chip. The percentile is in the tooltip and the accessible label, so color is never alone. */
export function Grade({ letter, pctl, size = "sm" }: { letter: string | null | undefined; pctl?: number | null; size?: "sm" | "lg" }) {
  if (!letter) {
    return (
      <Box as="span" fontSize="sm" color="rink.muted">
        –
      </Box>
    );
  }
  const t = tier(letter);
  const label = pctl !== null && pctl !== undefined ? `${letter}, ${Math.round(pctl)}th percentile at position` : letter;
  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      minW={size === "lg" ? "44px" : "30px"}
      h={size === "lg" ? "36px" : "22px"}
      px="1.5"
      rounded="sm"
      bg={`grade.${t}Bg`}
      color={`grade.${t}Fg`}
      fontWeight="bold"
      fontSize={size === "lg" ? "lg" : "xs"}
      title={label}
      aria-label={label}
    >
      {letter}
    </Box>
  );
}

export function TrendArrow({ trend, delta }: { trend: string | null; delta?: number | null }) {
  if (!trend) return null;
  const up = trend === "up";
  const down = trend === "down";
  const label = `Opportunity trend ${trend}${delta !== null && delta !== undefined ? ` (delta ${delta >= 0 ? "+" : ""}${delta.toFixed(2)})` : ""}`;
  return (
    <Box
      as="span"
      title={label}
      aria-label={label}
      color={up ? "rink.pos" : down ? "rink.neg" : "rink.muted"}
      fontWeight="bold"
      ml="1"
    >
      {up ? "↑" : down ? "↓" : "→"}
    </Box>
  );
}

export function Tag({ children, tone = "neutral", title }: { children: React.ReactNode; tone?: "pos" | "neg" | "warn" | "neutral" | "accent"; title?: string }) {
  const fg = tone === "pos" ? "rink.pos" : tone === "neg" ? "rink.neg" : tone === "warn" ? "rink.warn" : tone === "accent" ? "rink.accent" : "rink.sub";
  return (
    <Box
      as="span"
      display="inline-block"
      px="1.5"
      py="0.5"
      rounded="sm"
      borderWidth="1px"
      borderColor={fg}
      color={fg}
      fontSize="2xs"
      fontWeight="semibold"
      whiteSpace="nowrap"
      title={title}
    >
      {children}
    </Box>
  );
}
