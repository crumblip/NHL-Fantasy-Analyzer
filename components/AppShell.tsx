"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Box, Flex, IconButton, Input, Text } from "@chakra-ui/react";
import { useTheme } from "next-themes";
import { LuMoon, LuSearch, LuSun } from "react-icons/lu";

const NAV = [
  { href: "/rankings", label: "Rankings" },
  { href: "/alerts", label: "Alerts" },
  { href: "/goalies", label: "Goalies" },
  { href: "/teams", label: "Teams" },
  { href: "/prospects", label: "Prospects" },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <IconButton aria-label="Toggle colour mode" variant="ghost" size="sm" color="rink.sub" onClick={() => setTheme(dark ? "light" : "dark")}>
      {mounted ? dark ? <LuSun /> : <LuMoon /> : null}
    </IconButton>
  );
}

function PlayerSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: number; name: string; position: string; team: string | null }[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (id: number) => {
    setOpen(false);
    setQ("");
    router.push(`/player/${id}`);
  };

  return (
    <Box position="relative" ref={box} w={{ base: "full", md: "240px" }}>
      <Box position="absolute" left="2.5" top="50%" transform="translateY(-50%)" color="rink.muted" pointerEvents="none">
        <LuSearch size={14} />
      </Box>
      <Input
        size="sm"
        pl="8"
        placeholder="Search players"
        aria-label="Search players"
        value={q}
        bg="rink.surface2"
        borderColor="rink.border"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) go(results[0].id);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && results.length > 0 && (
        <Box position="absolute" top="calc(100% + 4px)" left="0" right="0" zIndex="dropdown" bg="rink.surface" borderWidth="1px" borderColor="rink.border" rounded="md" shadow="lg" overflow="hidden">
          {results.map((r) => (
            <Box key={r.id} as="button" display="flex" w="full" textAlign="left" px="3" py="2" gap="2" _hover={{ bg: "rink.hover" }} onClick={() => go(r.id)}>
              <Text flex="1" fontSize="sm" color="rink.text">
                {r.name}
              </Text>
              <Text fontSize="xs" color="rink.muted">
                {r.position} {r.team ?? ""}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <Box minH="100vh">
      <Box as="header" borderBottomWidth="1px" borderColor="rink.border" bg="rink.surface" position="sticky" top="0" zIndex="sticky">
        <Flex maxW="1400px" mx="auto" px={{ base: "4", md: "6" }} py="2.5" gap={{ base: "2", md: "6" }} align="center" wrap={{ base: "wrap", md: "nowrap" }}>
          <Link href="/rankings">
            <Text fontWeight="bold" color="rink.text" whiteSpace="nowrap">
              NHL Fantasy Analyzer
            </Text>
          </Link>
          <Flex as="nav" gap="1" order={{ base: 3, md: 0 }} w={{ base: "full", md: "auto" }} overflowX="auto" flex={{ md: "1" }}>
            {NAV.map((n) => {
              const active = path === n.href || path.startsWith(`${n.href}/`);
              return (
                <Link key={n.href} href={n.href}>
                  <Box
                    px="3"
                    py="1.5"
                    rounded="md"
                    fontSize="sm"
                    fontWeight={active ? "semibold" : "normal"}
                    color={active ? "rink.text" : "rink.sub"}
                    bg={active ? "rink.surface2" : "transparent"}
                    _hover={{ bg: "rink.hover" }}
                    whiteSpace="nowrap"
                  >
                    {n.label}
                  </Box>
                </Link>
              );
            })}
          </Flex>
          <Flex gap="2" align="center" ml={{ base: "auto", md: "0" }} flex={{ base: "1", md: "none" }} justify="flex-end">
            <PlayerSearch />
            <ThemeToggle />
          </Flex>
        </Flex>
      </Box>
      <Box as="main" maxW="1400px" mx="auto" px={{ base: "4", md: "6" }} py={{ base: "4", md: "6" }}>
        {children}
      </Box>
    </Box>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Flex mb="4" gap="3" align={{ base: "flex-start", md: "flex-end" }} justify="space-between" direction={{ base: "column", md: "row" }}>
      <Box>
        <Text as="h1" fontSize="2xl" fontWeight="bold" color="rink.text">
          {title}
        </Text>
        {subtitle && (
          <Text fontSize="sm" color="rink.muted" mt="0.5">
            {subtitle}
          </Text>
        )}
      </Box>
      {children}
    </Flex>
  );
}

export function Panel({ children, title, action, ...rest }: { children: React.ReactNode; title?: string; action?: React.ReactNode } & React.ComponentProps<typeof Box>) {
  return (
    <Box bg="rink.surface" borderWidth="1px" borderColor="rink.border" rounded="lg" p="4" {...rest}>
      {title && (
        <Flex justify="space-between" align="center" mb="3" gap="2">
          <Text fontSize="xs" fontWeight="semibold" color="rink.muted" textTransform="uppercase" letterSpacing="wide">
            {title}
          </Text>
          {action}
        </Flex>
      )}
      {children}
    </Box>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <Flex role="group" aria-label={label} bg="rink.surface2" p="0.5" rounded="md" borderWidth="1px" borderColor="rink.border" w="fit-content" maxW="full" overflowX="auto">
      {options.map((o) => (
        <Box
          key={o.value}
          as="button"
          px="3"
          py="1"
          rounded="sm"
          fontSize="sm"
          whiteSpace="nowrap"
          fontWeight={value === o.value ? "semibold" : "normal"}
          bg={value === o.value ? "rink.surface" : "transparent"}
          color={value === o.value ? "rink.text" : "rink.sub"}
          shadow={value === o.value ? "xs" : undefined}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Box>
      ))}
    </Flex>
  );
}
