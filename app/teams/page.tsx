import { TeamsIndex } from "@/components/views/TeamView";
import { getTeams } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function TeamsPage() {
  return <TeamsIndex teams={getTeams()} />;
}
