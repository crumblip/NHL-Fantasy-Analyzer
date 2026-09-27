"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "nhlfa.roster";
const EVENT = "nhlfa-roster";

function read(): Set<number> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

/** The manual "rostered" toggle (SPEC 11): a per-browser set of player ids. */
export function useRoster() {
  const [ids, setIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    setIds(read());
    const sync = () => setIds(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const toggle = useCallback((id: number) => {
    const next = read();
    if (next.has(id)) next.delete(id);
    else next.add(id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* storage blocked: keep the in-memory state only */
    }
    setIds(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { has: (id: number) => ids.has(id), toggle, size: ids.size };
}
