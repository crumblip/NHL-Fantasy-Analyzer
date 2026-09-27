import { notFound } from "next/navigation";
import { PlayerView } from "@/components/views/PlayerView";
import { getPlayer } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getPlayer(Number(id));
  if (!data) notFound();
  return <PlayerView data={data} />;
}
