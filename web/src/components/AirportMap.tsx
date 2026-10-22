"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { GeoJSONSource, Map as MlMap, StyleSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { MAP_STYLE_URL } from "@/lib/config";
import { fmtDateTime, fmtTime } from "@/lib/format";
import type { Airport, Position, Zone } from "@/lib/types";

const TRAIL_MS = 4 * 60_000;
const STALE_MS = 60_000;
const SPEEDS = [15, 30, 60, 120];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function fallbackStyle(): StyleSpecification {
  // Used when the basemap cannot load (offline, blocked, or tile outage): the map still shows our layers.
  return { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": cssVar("--surface-2") } }] };
}

type Track = { id: string; pts: { t: number; lon: number; lat: number; alt: number | null }[] };

function groupTracks(positions: Position[]): Track[] {
  const m = new Map<string, Track>();
  for (const p of positions) {
    const t = m.get(p.id) ?? { id: p.id, pts: [] };
    t.pts.push({ t: Date.parse(p.t), lon: p.lon, lat: p.lat, alt: p.alt });
    m.set(p.id, t);
  }
  for (const t of m.values()) t.pts.sort((a, b) => a.t - b.t);
  return [...m.values()];
}

function frame(tracks: Track[], now: number) {
  const trails: GeoJSON.Feature[] = [];
  const planes: GeoJSON.Feature[] = [];
  for (const tr of tracks) {
    const seg = tr.pts.filter((p) => p.t <= now && p.t >= now - TRAIL_MS);
    if (!seg.length) continue;
    const last = seg[seg.length - 1];
    if (now - last.t > STALE_MS) continue;
    if (seg.length > 1) {
      trails.push({ type: "Feature", properties: { id: tr.id }, geometry: { type: "LineString", coordinates: seg.map((p) => [p.lon, p.lat]) } });
    }
    planes.push({ type: "Feature", properties: { id: tr.id, alt: last.alt ?? 0 }, geometry: { type: "Point", coordinates: [last.lon, last.lat] } });
  }
  return {
    trails: { type: "FeatureCollection", features: trails } as GeoJSON.FeatureCollection,
    planes: { type: "FeatureCollection", features: planes } as GeoJSON.FeatureCollection,
    count: planes.length,
  };
}

export default function AirportMap({ airport, zones, positions, selectedZone, onSelectZone, start, end, isDemo }: {
  airport: Airport; zones: Zone[]; positions: Position[]; selectedZone: string | null; onSelectZone: (id: string | null) => void;
  start: string; end: string; isDemo: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<"loading" | "ok" | "fallback">("loading");
  const t0 = Date.parse(start);
  const t1 = Date.parse(end);
  // Open mid-window so the first view shows traffic rather than an empty sky.
  const [now, setNow] = useState(t0 + (t1 - t0) / 2);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const tracks = useMemo(() => groupTracks(positions), [positions]);
  const current = useMemo(() => frame(tracks, now), [tracks, now]);
  const onSelectRef = useRef(onSelectZone);
  onSelectRef.current = onSelectZone;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let m: MlMap | null = null;
    (async () => {
      const maplibre = (await import("maplibre-gl")).default;
      if (cancelled || !el.current) return;
      m = new maplibre.Map({
        container: el.current,
        style: MAP_STYLE_URL,
        center: [airport.lon, airport.lat],
        zoom: 11.6,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      map.current = m;
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      let switched = false;
      const switchToFallback = () => {
        if (switched || !m) return;
        switched = true;
        setBasemap("fallback");
        m.setStyle(fallbackStyle());
      };
      const timer = setTimeout(() => !m?.isStyleLoaded() && switchToFallback(), 6000);
      m.on("error", (e) => {
        const msg = String((e as { error?: Error }).error?.message ?? "");
        if (!m?.isStyleLoaded() || /style|Failed to fetch|NetworkError/i.test(msg)) switchToFallback();
      });
      m.on("style.load", () => {
        clearTimeout(timer);
        if (!switched) setBasemap("ok");
        addLayers(m!, airport, zones);
        setReady(true);
      });
      m.on("click", "zones-fill", (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelectRef.current(id);
      });
      m.on("mouseenter", "zones-fill", () => (m!.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "zones-fill", () => (m!.getCanvas().style.cursor = ""));
    })();
    return () => {
      cancelled = true;
      m?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push the playback frame into the map.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("trails") as GeoJSONSource | undefined)?.setData(current.trails);
    (m.getSource("planes") as GeoJSONSource | undefined)?.setData(current.planes);
  }, [current, ready]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !m.getLayer("zones-selected")) return;
    m.setFilter("zones-selected", ["==", ["get", "id"], selectedZone ?? ""]);
  }, [selectedZone, ready]);

  // Playback clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (ts: number) => {
      const dt = ts - last;
      last = ts;
      setNow((n) => {
        const next = n + dt * speed;
        if (next >= t1) {
          setPlaying(false);
          return t1;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, t1]);

  const tz = airport.timezone;
  const empty = positions.length === 0;

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border border-line">
        <div ref={el} className="h-[360px] w-full sm:h-[460px]" aria-label={`Map of ${airport.name} with runway, neighborhood zones and replayed aircraft positions`} role="region" />
        {basemap === "fallback" && (
          <p className="absolute bottom-2 left-2 rounded bg-surface/90 px-2 py-1 text-xs text-ink-2">Basemap unavailable; showing runway and zones only.</p>
        )}
        {empty && (
          <div className="absolute inset-0 grid place-items-center bg-surface/60">
            <p className="rounded-md bg-surface px-3 py-2 text-sm text-ink-2 shadow">No recent positions to show. This is a data gap, not proof of zero activity.</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { if (now >= t1) setNow(t0); setPlaying((p) => !p); }}
          disabled={empty}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
          aria-pressed={playing}
        >
          {playing ? "Pause" : now >= t1 ? "Replay" : "Play"}
        </button>
        <label className="flex min-w-[12rem] flex-1 items-center gap-2 text-sm">
          <span className="sr-only">Playback time</span>
          <input
            type="range" min={t0} max={t1} step={5000} value={now} disabled={empty}
            onChange={(e) => { setPlaying(false); setNow(Number(e.target.value)); }}
            className="w-full accent-[var(--accent)]"
            aria-valuetext={fmtTime(new Date(now).toISOString(), tz)}
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-ink-2">
          Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded border border-line bg-surface px-1 py-1">
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
      </div>
      <p className="mt-2 text-sm text-ink-2" aria-live="polite">
        <span className="tabular font-medium text-ink">{fmtDateTime(new Date(now).toISOString(), tz, { weekday: "short" })}</span>
        {" · "}{current.count} aircraft shown{isDemo ? " (synthetic)" : ""}. Positions are approximate, delayed and use daily pseudonyms, not tail numbers.
      </p>
      <ul className="mt-2 flex flex-wrap gap-4 text-xs text-ink-3" aria-label="Map legend">
        <li className="flex items-center gap-1"><span className="inline-block h-0.5 w-5" style={{ background: "var(--runway)" }} /> Runway 15/33 (approximate)</li>
        <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: "var(--zone)" }} /> Neighborhood zone</li>
        <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border-2" style={{ borderColor: "var(--zone-selected)" }} /> Selected zone</li>
        <li className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--sky)" }} /> Aircraft (color darkens with altitude)</li>
      </ul>
    </div>
  );
}

function addLayers(m: MlMap, airport: Airport, zones: Zone[]) {
  const zoneColor = cssVar("--zone");
  const selColor = cssVar("--zone-selected");
  const sky = cssVar("--sky");
  const ink = cssVar("--runway");
  m.addSource("zones", {
    type: "geojson",
    data: { type: "FeatureCollection", features: zones.map((z) => ({ type: "Feature", properties: { id: z.id, label: z.label }, geometry: z.geometry })) },
  });
  m.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": zoneColor, "fill-opacity": 0.12 } });
  m.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": zoneColor, "line-width": 1.5 } });
  m.addLayer({ id: "zones-selected", type: "line", source: "zones", filter: ["==", ["get", "id"], ""], paint: { "line-color": selColor, "line-width": 3 } });
  m.addSource("runways", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: airport.runways.map((r) => ({ type: "Feature", properties: { id: r.id }, geometry: { type: "LineString", coordinates: r.ends.map((e) => [e.lon, e.lat]) } })),
    },
  });
  m.addLayer({ id: "runways", type: "line", source: "runways", paint: { "line-color": ink, "line-width": 5 } });
  m.addSource("trails", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  m.addLayer({ id: "trails", type: "line", source: "trails", paint: { "line-color": sky, "line-width": 1.5, "line-opacity": 0.55 } });
  m.addSource("planes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  m.addLayer({
    id: "planes", type: "circle", source: "planes",
    paint: {
      "circle-radius": 5,
      "circle-color": ["interpolate", ["linear"], ["get", "alt"], airport.elevationFt, "#8fc1f0", airport.elevationFt + 3000, sky, 12000, "#173e66"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });
}
