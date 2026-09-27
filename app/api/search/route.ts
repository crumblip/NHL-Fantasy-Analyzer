import { NextResponse } from "next/server";
import { searchPlayers } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  return NextResponse.json({ results: q.length >= 2 ? searchPlayers(q) : [] });
}
