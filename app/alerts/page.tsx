import { AlertsView } from "@/components/views/AlertsView";
import { getAlertFeed, getAlerts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  return <AlertsView data={getAlerts()} feed={getAlertFeed(60)} />;
}
