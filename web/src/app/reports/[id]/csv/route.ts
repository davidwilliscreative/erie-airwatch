import { getDashboardData } from "@/lib/data";
import { getReport, reportCsv } from "@/lib/reports";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) return new Response("Report not found", { status: 404 });
  const data = await getDashboardData();
  return new Response(reportCsv(report, data.airport.name), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="erie-airwatch-${report.periodStart}-v${report.version}.csv"`,
      "cache-control": "public, max-age=300",
    },
  });
}
