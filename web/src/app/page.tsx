import Dashboard from "@/components/Dashboard";
import { getDashboardData } from "@/lib/data";

// Aggregates are cached and refreshed at most once a minute; the page shows the
// actual age of the latest observation rather than implying real time.
export const revalidate = 60;

export default async function Home() {
  const data = await getDashboardData();
  return <Dashboard data={data} />;
}
