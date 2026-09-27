import { NextResponse } from "next/server";
import { getProspectComparables } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ comparables: getProspectComparables(Number(id)) });
}
