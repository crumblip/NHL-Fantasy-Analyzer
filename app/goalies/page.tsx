import { GoaliesView } from "@/components/views/GoaliesView";
import { getGoalies } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function GoaliesPage() {
  const { asOf, rows } = getGoalies();
  return <GoaliesView asOf={asOf} rows={rows} />;
}
