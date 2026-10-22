import ReviewQueue from "@/components/admin/ReviewQueue";
import { getAdminContext } from "@/lib/admin-data";

export const dynamic = "force-dynamic";

export default async function AdminReviewPage() {
  const { mode, data, events } = await getAdminContext();
  return <ReviewQueue mode={mode} airport={data.airport} zones={data.zones} initial={events} />;
}
