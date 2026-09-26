import fs from "fs";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";

export const CACHE_DIR = path.join(process.cwd(), "data", "cache");

const MIN_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 6;
const USER_AGENT = "nhl-fantasy-analyzer/0.1 (personal, non-commercial)";

export class NotFoundError extends Error {
  constructor(public url: string) {
    super(`404 Not Found: ${url}`);
  }
}

export interface FetchOptions<T> {
  /** Omit for immutable data (completed games): cached forever. */
  maxAgeMs?: number;
  /** A cached response that passes this never expires, e.g. a schedule whose games are all final. */
  final?: (json: T) => boolean;
  /** Return false to use the response but not cache it, so the next run refetches (e.g. empty shift charts). */
  cacheIf?: (json: T) => boolean;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-host slot reservation: concurrent callers against the same host queue up
// one second apart, while the two NHL hosts proceed in parallel.
const nextSlot = new Map<string, number>();
async function throttle(host: string) {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + MIN_INTERVAL_MS);
  if (slot > now) await sleep(slot - now);
}

const stats = { network: 0, cached: 0, retries: 0 };
export function fetchStats() {
  return { ...stats };
}

export function cachePath(url: string): string {
  const u = new URL(url);
  const query = decodeURIComponent(u.search.slice(1))
    .replace(/[<>:"|?*\\/\s]+/g, "_")
    .replace(/_+/g, "_");
  // Raw response bytes, gzipped: a season of play-by-play + shifts is ~600 MB uncompressed.
  const file = u.pathname.replace(/\/+$/, "") + (query ? `__${query}` : "") + ".json.gz";
  return path.join(CACHE_DIR, u.host, ...file.split("/").filter(Boolean));
}

function readCache<T>(file: string, opts: FetchOptions<T> = {}): T | undefined {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return undefined;
  }
  const json = JSON.parse(gunzipSync(fs.readFileSync(file)).toString("utf8")) as T;
  const expired = opts.maxAgeMs !== undefined && Date.now() - st.mtimeMs > opts.maxAgeMs;
  if (expired && !opts.final?.(json)) return undefined;
  return json;
}

function writeCache(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, gzipSync(body));
  fs.renameSync(tmp, file);
}

/** Cache only, never the network: the derived layer is rebuilt purely from what's on disk. */
export function readCached<T>(url: string): T | undefined {
  return readCache<T>(cachePath(url));
}

export async function fetchJson<T>(url: string, opts: FetchOptions<T> = {}): Promise<T> {
  const file = cachePath(url);
  const hit = readCache<T>(file, opts);
  if (hit !== undefined) {
    stats.cached++;
    return hit;
  }

  const host = new URL(url).host;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await throttle(host);
    let res: Response;
    try {
      stats.network++;
      res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    } catch (err) {
      lastErr = err;
      await backoff(attempt);
      continue;
    }
    if (res.status === 404) throw new NotFoundError(url);
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status} ${url}`);
      const retryAfter = Number(res.headers.get("retry-after"));
      await backoff(attempt, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);

    const body = await res.text();
    const json = JSON.parse(body) as T;
    if (!opts.cacheIf || opts.cacheIf(json)) writeCache(file, body);
    return json;
  }

  // Upstream is down: a stale copy of TTL-cached data beats failing the whole run.
  const stale = readCache<T>(file);
  if (stale !== undefined) {
    console.warn(`  ! serving stale cache for ${url}`);
    return stale;
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function backoff(attempt: number, floorMs = 0) {
  stats.retries++;
  const ms = Math.max(floorMs, 2000 * 2 ** attempt) * (1 + Math.random() * 0.25);
  await sleep(ms);
}
