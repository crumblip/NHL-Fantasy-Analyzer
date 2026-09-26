import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadLeagueConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  const config = loadLeagueConfig();
  return NextResponse.json({
    ok: true,
    tables: tables.map((t) => t.name),
    league: config.league,
    scoring: config.scoring,
  });
}
