import { notFound } from "next/navigation";
import { TeamView } from "@/components/views/TeamView";
import { getTeamView, type Span } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ abbrev: string }>;
  searchParams: Promise<{ span?: string }>;
}) {
  const { abbrev } = await params;
  const { span } = await searchParams;
  const s: Span = span === "5" || span === "season" ? span : "game";
  const data = getTeamView(abbrev, s);
  if (!data) notFound();
  return <TeamView data={data} />;
}
