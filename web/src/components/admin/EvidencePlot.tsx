import type { Airport, ReviewPoint, Zone } from "@/lib/types";

const R = 6371008.8;

function project(lat0: number, lon0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return (lat: number, lon: number): [number, number] => [((lon - lon0) * Math.PI / 180) * R * k, ((lat - lat0) * Math.PI / 180) * R];
}

/** Plan view of the evidence: runway, the relevant zone, and every position report around the event. */
export function PlanView({ airport, zone, points }: { airport: Airport; zone: Zone | null; points: ReviewPoint[] }) {
  const p = project(airport.lat, airport.lon);
  const rw = airport.runways.flatMap((r) => r.ends.map((e) => p(e.lat, e.lon)));
  const zp = zone ? zone.geometry.coordinates[0].map(([lon, lat]) => p(lat, lon)) : [];
  const pts = points.map((q) => ({ ...q, xy: p(q.lat, q.lon) }));
  const all = [...rw, ...zp, ...pts.map((q) => q.xy)];
  const xs = all.map((a) => a[0]);
  const ys = all.map((a) => a[1]);
  const pad = 300;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const span = Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const S = 400;
  const tx = ([x, y]: [number, number]) => [((x - cx) / span + 0.5) * S, (0.5 - (y - cy) / span) * S] as const;
  const path = (a: [number, number][]) => a.map((q, i) => `${i ? "L" : "M"}${tx(q).join(",")}`).join(" ");
  const scaleM = span > 6000 ? 2000 : span > 3000 ? 1000 : 500;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full rounded-lg border border-line bg-surface-2" role="img" aria-label="Plan view of the position reports used as evidence">
      {zp.length > 0 && <path d={path(zp) + "Z"} fill="var(--zone)" fillOpacity={0.12} stroke="var(--zone-selected)" strokeWidth={2} />}
      {airport.runways.map((r) => <path key={r.id} d={path(r.ends.map((e) => p(e.lat, e.lon)))} stroke="var(--runway)" strokeWidth={5} />)}
      <path d={path(pts.map((q) => q.xy))} fill="none" stroke="var(--sky)" strokeWidth={1.2} strokeOpacity={0.6} />
      {pts.map((q, i) => {
        const [x, y] = tx(q.xy);
        return <circle key={i} cx={x} cy={y} r={q.evidence ? 3.2 : 2.2} fill={q.evidence ? "var(--sky)" : "var(--surface)"} stroke="var(--sky)" strokeWidth={1}>
          <title>{`${q.t.slice(11, 19)}Z · ${q.alt ?? "?"} ft · ${q.gs ?? "?"} kt`}</title>
        </circle>;
      })}
      {pts[0] && <text x={tx(pts[0].xy)[0] + 5} y={tx(pts[0].xy)[1] - 5} fontSize={11} fill="var(--ink-2)">start</text>}
      <g transform={`translate(12 ${S - 14})`}>
        <line x1={0} x2={(scaleM / span) * S} y1={0} y2={0} stroke="var(--ink-2)" strokeWidth={2} />
        <text x={0} y={-5} fontSize={10} fill="var(--ink-2)">{scaleM >= 1000 ? `${scaleM / 1000} km` : `${scaleM} m`}</text>
      </g>
      <text x={S - 14} y={20} fontSize={11} textAnchor="end" fill="var(--ink-2)">N ↑</text>
    </svg>
  );
}

/** Altitude (estimated above field) and groundspeed over time. */
export function Profile({ airport, points }: { airport: Airport; points: ReviewPoint[] }) {
  if (points.length < 2) return null;
  const W = 400, H = 150, L = 34, B = 18;
  const t0 = Date.parse(points[0].t), t1 = Date.parse(points[points.length - 1].t);
  const agl = points.map((q) => (q.alt ?? airport.elevationFt) - airport.elevationFt);
  const pattern = (airport.patternAltitudeFt ?? airport.elevationFt + 1000) - airport.elevationFt;
  const maxA = Math.max(pattern + 200, ...agl);
  const maxG = Math.max(100, ...points.map((q) => q.gs ?? 0));
  const x = (t: string) => L + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - L - 6);
  const ya = (a: number) => (H - B) - (Math.max(a, 0) / maxA) * (H - B - 8);
  const yg = (g: number) => (H - B) - (g / maxG) * (H - B - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Altitude and groundspeed profile">
      <line x1={L} x2={W} y1={ya(pattern)} y2={ya(pattern)} stroke="var(--caution)" strokeDasharray="4 3" />
      <text x={W - 4} y={ya(pattern) - 3} fontSize={9} textAnchor="end" fill="var(--caution)">pattern altitude</text>
      <line x1={L} x2={W} y1={ya(0)} y2={ya(0)} stroke="var(--line)" />
      <text x={L - 4} y={ya(0)} fontSize={9} textAnchor="end" fill="var(--ink-3)">0</text>
      <text x={L - 4} y={ya(maxA) + 8} fontSize={9} textAnchor="end" fill="var(--ink-3)">{Math.round(maxA)}</text>
      <polyline fill="none" stroke="var(--chart-3)" strokeWidth={1} strokeOpacity={0.8} points={points.map((q) => `${x(q.t)},${yg(q.gs ?? 0)}`).join(" ")} />
      <polyline fill="none" stroke="var(--sky)" strokeWidth={1.8} points={points.map((q, i) => `${x(q.t)},${ya(agl[i])}`).join(" ")} />
      {points.map((q, i) => q.evidence && <circle key={i} cx={x(q.t)} cy={ya(agl[i])} r={1.8} fill="var(--sky)" />)}
      <text x={L} y={H - 4} fontSize={9} fill="var(--ink-3)">{points[0].t.slice(11, 19)}Z</text>
      <text x={W - 4} y={H - 4} fontSize={9} textAnchor="end" fill="var(--ink-3)">{points[points.length - 1].t.slice(11, 19)}Z</text>
      <text x={L + 4} y={12} fontSize={9} fill="var(--sky)">ft above field</text>
      <text x={L + 80} y={12} fontSize={9} fill="var(--chart-3)">groundspeed (kt, scaled)</text>
    </svg>
  );
}
