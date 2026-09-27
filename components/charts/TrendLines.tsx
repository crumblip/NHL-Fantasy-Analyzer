"use client";

import { useState } from "react";
import { Box, Flex, Text } from "@chakra-ui/react";
import { useWidth } from "./useWidth";

export interface Series {
  key: string;
  label: string;
  /** Short name for the direct label at the line's end. */
  short: string;
  color: string; // a chart.sN token
  values: (number | null)[];
}

/**
 * Shares over time on one 0-100% axis (all series are the same unit, so one scale).
 * Legend above, direct labels at the line ends, crosshair tooltip on hover.
 */
export function TrendLines({ dates, series, height = 200 }: { dates: string[]; series: Series[]; height?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const labelW = 64;
  const pad = { top: 10, right: labelW, bottom: 20, left: 40 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.min(1, Math.max(0.25, Math.ceil((Math.max(...all, 0.1) + 0.05) * 10) / 10));
  const x = (i: number) => pad.left + (dates.length > 1 ? (i / (dates.length - 1)) * w : w / 2);
  const y = (v: number) => pad.top + h - (v / max) * h;
  const ticks = [0, max / 2, max];

  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };

  // Direct labels at each line's last value, nudged apart so they don't collide.
  const ends = series
    .map((s) => {
      const i = s.values.map((v, k) => (v === null ? -1 : k)).filter((k) => k >= 0).pop();
      return i === undefined ? null : { s, i, v: s.values[i] as number, ly: y(s.values[i] as number) };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < ends.length; k++) if (ends[k].ly - ends[k - 1].ly < 12) ends[k].ly = ends[k - 1].ly + 12;

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round((px / rect.width) * (dates.length - 1));
    setHover(Math.max(0, Math.min(dates.length - 1, i)));
  };

  return (
    <Box ref={ref} position="relative">
      <Flex gap="4" mb="2" wrap="wrap" as="ul" listStyleType="none">
        {series.map((s) => (
          <Flex as="li" key={s.key} align="center" gap="1.5">
            <Box w="12px" h="2px" bg={s.color} rounded="full" />
            <Text fontSize="xs" color="rink.sub">
              {s.label}
            </Text>
          </Flex>
        ))}
      </Flex>
      <svg width={width} height={height} role="img" aria-label={`Deployment trend over ${dates.length} games`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={pad.left + w} y1={y(t)} y2={y(t)} stroke="var(--chakra-colors-chart-grid)" strokeWidth={1} />
            <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10" fill="var(--chakra-colors-rink-muted)">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        <line x1={pad.left} x2={pad.left + w} y1={y(0)} y2={y(0)} stroke="var(--chakra-colors-chart-axis)" strokeWidth={1} />
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={`var(--chakra-colors-${s.color.replace(".", "-")})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {ends.map((e) => (
          <text key={e.s.key} x={pad.left + w + 6} y={e.ly} dy="0.32em" fontSize="10" fill="var(--chakra-colors-rink-sub)">
            {Math.round(e.v * 100)}% {e.s.short}
          </text>
        ))}
        {dates.length > 0 && (
          <>
            <text x={pad.left} y={height - 4} fontSize="10" fill="var(--chakra-colors-rink-muted)">
              {dates[0]}
            </text>
            <text x={pad.left + w} y={height - 4} fontSize="10" textAnchor="end" fill="var(--chakra-colors-rink-muted)">
              {dates[dates.length - 1]}
            </text>
          </>
        )}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + h} stroke="var(--chakra-colors-rink-muted)" strokeWidth={1} />
            {series.map((s) =>
              s.values[hover] === null ? null : (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] as number)} r={4} fill={`var(--chakra-colors-${s.color.replace(".", "-")})`} stroke="var(--chakra-colors-rink-surface)" strokeWidth={2} />
              )
            )}
          </g>
        )}
        <rect x={pad.left} y={pad.top} width={w} height={h} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <Box
          position="absolute"
          top="28px"
          left={`${Math.min(width - 190, Math.max(0, x(hover) + 10))}px`}
          bg="rink.surface"
          borderWidth="1px"
          borderColor="rink.border"
          rounded="md"
          shadow="md"
          px="2.5"
          py="1.5"
          pointerEvents="none"
          minW="170px"
        >
          <Text fontSize="xs" color="rink.muted" mb="1">
            Last 5 games to {dates[hover]}
          </Text>
          {series.map((s) => (
            <Flex key={s.key} align="center" gap="2" justify="space-between">
              <Flex align="center" gap="1.5">
                <Box w="8px" h="8px" rounded="full" bg={s.color} />
                <Text fontSize="xs" color="rink.sub">
                  {s.label}
                </Text>
              </Flex>
              <Text fontSize="xs" fontWeight="semibold" color="rink.text">
                {s.values[hover] === null ? "–" : `${Math.round((s.values[hover] as number) * 100)}%`}
              </Text>
            </Flex>
          ))}
        </Box>
      )}
    </Box>
  );
}
