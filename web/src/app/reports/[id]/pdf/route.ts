import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

import { getDashboardData } from "@/lib/data";
import { fmtDay, fmtNumber } from "@/lib/format";
import { getReport, metricLabel } from "@/lib/reports";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getReport(id);
  if (!r) return new Response("Report not found", { status: 404 });
  const data = await getDashboardData();

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Erie AirWatch: ${r.title}`);
  pdf.setProducer("Erie AirWatch");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 740;
  const ink = rgb(0.1, 0.14, 0.13);
  const muted = rgb(0.35, 0.4, 0.38);
  const line = (text: string, opts: { size?: number; f?: typeof font; color?: typeof ink; gap?: number; x?: number } = {}) => {
    if (y < 60) { page = pdf.addPage([612, 792]); y = 740; }
    page.drawText(text, { x: opts.x ?? 56, y, size: opts.size ?? 10, font: opts.f ?? font, color: opts.color ?? ink });
    y -= opts.gap ?? (opts.size ?? 10) + 6;
  };
  const wrap = (text: string, size = 9, color = muted) => {
    const words = text.split(" ");
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > 500) { line(cur, { size, color }); cur = w; } else cur = next;
    }
    if (cur) line(cur, { size, color });
  };

  line("Erie AirWatch", { size: 11, f: bold, color: rgb(0.12, 0.44, 0.36) });
  line(`${data.airport.name} (${data.airport.icao})`, { size: 18, f: bold, gap: 22 });
  line(`${r.title}: ${fmtDay(r.periodStart, { month: "short", day: "numeric", year: "numeric" })} to ${fmtDay(r.periodEnd, { month: "short", day: "numeric", year: "numeric" })}`, { size: 12, gap: 18 });
  line(`Report version ${r.version} · methodology ${r.methodologyVersion} · generated ${r.generatedAt.slice(0, 16).replace("T", " ")} UTC`, { size: 9, color: muted, gap: 20 });
  if (r.synthetic) {
    line("SYNTHETIC DEMONSTRATION DATA. These figures are generated and describe no real aircraft.", { size: 10, f: bold, color: rgb(0.64, 0.36, 0), gap: 20 });
  }
  line(`Mean data coverage: ${r.metrics.mean_coverage_pct ?? "n/a"}%`, { size: 11, f: bold, gap: 20 });

  line("Airport-wide", { size: 12, f: bold, gap: 16 });
  for (const [m, v] of Object.entries(r.metrics.totals).sort()) {
    page.drawText(metricLabel(m), { x: 56, y, size: 10, font, color: ink });
    line(fmtNumber(v), { x: 470, size: 10, f: bold });
  }
  y -= 8;
  line("By neighborhood zone", { size: 12, f: bold, gap: 16 });
  for (const z of r.metrics.zones) {
    page.drawText(`${z.label}: ${metricLabel(z.metric)}`.slice(0, 85), { x: 56, y, size: 9, font, color: ink });
    line(fmtNumber(z.total), { x: 470, size: 9, f: bold, gap: 14 });
  }
  y -= 12;
  line("How to read this report", { size: 12, f: bold, gap: 16 });
  wrap("Counts come from ADS-B position reports. They do not measure noise, do not confirm runway contact, do not identify owners or pilots and do not show that any rule was broken. 'Likely touch-and-go' means an approach and departure near the runway without evidence of a full stop. Altitudes are barometric and converted to an estimated height above the field. Periods with missing data are not counted as zero activity; the coverage figure above shows how complete the record is.");
  y -= 6;
  wrap("Definitions, thresholds and the correction process are published at /methodology. Report corrections are listed with each report version.");
  if (r.corrections.length) {
    y -= 6;
    line("Corrections", { size: 12, f: bold, gap: 16 });
    for (const c of r.corrections) wrap(`${c.at.slice(0, 10)}: ${c.note}`, 9, ink);
  }

  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="erie-airwatch-${r.periodStart}-v${r.version}.pdf"`,
      "cache-control": "public, max-age=300",
    },
  });
}
