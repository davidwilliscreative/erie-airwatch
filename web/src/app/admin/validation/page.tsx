import ValidationPanel from "@/components/admin/ValidationPanel";
import { getAdminContext } from "@/lib/admin-data";

export const dynamic = "force-dynamic";

export default async function ValidationPage() {
  const { mode, data, events } = await getAdminContext();
  return <ValidationPanel mode={mode} events={events.map((e) => ({ ...e, points: [] }))} airportId={data.airport.id} />;
}
