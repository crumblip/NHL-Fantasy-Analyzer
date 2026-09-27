import { AlertsView } from "@/components/views/AlertsView";
import { getAlerts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  return <AlertsView data={getAlerts()} />;
}
