"use client";

import { useState } from "react";
import { Box, Text } from "@chakra-ui/react";
import { useWidth } from "./useWidth";

export interface FpBar {
  label: string; // e.g. "Apr 14 vs TOR"
  value: number;
  detail?: string; // e.g. "1G 1A 4 SOG"
}

/** Fantasy points per game, oldest to newest. One series, so no legend: the panel title names it. */
export function FpBars({ data, height = 120, average }: { data: FpBar[]; height?: number; average?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 8, bottom: 18, left: 30 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const y = (v: number) => pad.top + h - ((v - min) / (max - min)) * h;
  const slot = data.length ? w / data.length : w;
  const barW = Math.max(3, Math.min(18, slot - 2)); // 2px surface gap between bars
  const ticks = [0, Math.round(max / 2), Math.round(max)].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <Box ref={ref} position="relative">
      <svg width={width} height={height} role="img" aria-label={`Fantasy points in the last ${data.length} games`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--chakra-colors-chart-grid)" strokeWidth={1} />
            <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--chakra-colors-rink-muted)">
              {t}
            </text>
          </g>
        ))}
        {average !== undefined && (
          <line x1={pad.left} x2={width - pad.right} y1={y(average)} y2={y(average)} stroke="var(--chakra-colors-rink-muted)" strokeDasharray="3 3" strokeWidth={1} />
        )}
        {data.map((d, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          const top = y(Math.max(0, d.value));
          const bottom = y(Math.min(0, d.value));
          const r = Math.min(4, barW / 2, (bottom - top) / 2);
          // 4px rounded data-end, square at the baseline.
          const path =
            d.value >= 0
              ? `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${bottom} Z`
              : `M${x},${top} V${bottom - r} Q${x},${bottom} ${x + r},${bottom} H${x + barW - r} Q${x + barW},${bottom} ${x + barW},${bottom - r} V${top} Z`;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={h} fill="transparent" />
              <path d={path} fill="var(--chakra-colors-chart-s1)" opacity={hover === null || hover === i ? 1 : 0.45} />
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--chakra-colors-chart-axis)" strokeWidth={1} />
        {data.length > 0 && (
          <>
            <text x={pad.left} y={height - 4} fontSize="10" fill="var(--chakra-colors-rink-muted)">
              {data[0].label.split(" ")[0]}
            </text>
            <text x={width - pad.right} y={height - 4} fontSize="10" textAnchor="end" fill="var(--chakra-colors-rink-muted)">
              {data[data.length - 1].label.split(" ")[0]}
            </text>
          </>
        )}
      </svg>
      {hover !== null && data[hover] && (
        <Box
          position="absolute"
          top="0"
          left={`${Math.min(width - 170, Math.max(0, pad.left + hover * slot - 60))}px`}
          bg="rink.surface"
          borderWidth="1px"
          borderColor="rink.border"
          rounded="md"
          shadow="md"
          px="2.5"
          py="1.5"
          pointerEvents="none"
          minW="150px"
        >
          <Text fontSize="xs" color="rink.muted">
            {data[hover].label}
          </Text>
          <Text fontSize="sm" fontWeight="semibold" color="rink.text">
            {data[hover].value.toFixed(2)} FP
          </Text>
          {data[hover].detail && (
            <Text fontSize="xs" color="rink.sub">
              {data[hover].detail}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
