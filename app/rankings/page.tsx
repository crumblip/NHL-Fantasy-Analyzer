import { RankingsView } from "@/components/views/RankingsView";
import { getRankings } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function RankingsPage() {
  const { asOf, rows } = getRankings();
  return <RankingsView asOf={asOf} rows={rows} />;
}
