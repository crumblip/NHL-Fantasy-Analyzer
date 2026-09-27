import { ProspectsView } from "@/components/views/ProspectsView";
import { getProspects } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ProspectsPage() {
  const { asOf, rows } = getProspects();
  return <ProspectsView asOf={asOf} rows={rows} />;
}
