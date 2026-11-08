import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assertPlainTile,
  clampZoom,
  exportLayout,
  fitQuality,
  fitReport,
  parseAspectHint,
  pickerTile,
  solveHero,
  validCatalogEntry,
  wordmark,
  type AudioPolicy,
  type CatalogEntry,
  type DashboardDocument,
  type TileSpec,
} from "prism-core";

/* ================================================================
   Prism Editor — the reference renderer (spec §23).
   Ported from prototypes/frame-editor.jsx; the solver and fit math
   now come from prism-core, so this preview is pixel-identical to
   every shell. Adds §20 fit badges and §15 sanitized share export.
   ================================================================ */

/* ----------------------- design tokens ----------------------- */
const T = {
  wall: "#14171C",
  wallLight: "#2A2F38",
  panel: "#1E232B",
  panelEdge: "#2C333E",
  ink: "#D7DCE3",
  inkDim: "#8A93A0",
  inkFaint: "#5A6270",
  accent: "#F0A83C",
  accentDim: "#8A6524",
  bezel: "#0A0C0F",
  danger: "#D06A5A",
  good: "#9FD8A5",
};

interface TileType {
  label: string;
  hint: number;
  hintStr: string;
  weight: number;
  audio: AudioPolicy;
  hue: string;
  glyph: string;
}

const TILE_TYPES: Record<string, TileType> = {
  youtube:  { label: "YouTube",  hint: 16 / 9, hintStr: "16:9", weight: 1.0, audio: "exclusive", hue: "#3D5A80", glyph: "▶" },
  calendar: { label: "Calendar", hint: 3 / 4,  hintStr: "3:4",  weight: 0.6, audio: "mute",      hue: "#4C7A5E", glyph: "▦" },
  radio:    { label: "Radio",    hint: 4 / 3,  hintStr: "4:3",  weight: 0.2, audio: "exclusive", hue: "#8A5A44", glyph: "♫" },
  photos:   { label: "Photos",   hint: 3 / 2,  hintStr: "3:2",  weight: 0.8, audio: "mute",      hue: "#6B5B8A", glyph: "❏" },
  weather:  { label: "Weather",  hint: 1,      hintStr: "1:1",  weight: 0.5, audio: "mute",      hue: "#41707F", glyph: "☂" },
  notes:    { label: "Notes",    hint: 3 / 4,  hintStr: "3:4",  weight: 0.5, audio: "mute",      hue: "#7A7148", glyph: "✎" },
  ticker:   { label: "Ticker",   hint: 8,      hintStr: "8:1",  weight: 0.9, audio: "mute",      hue: "#575F6B", glyph: "→" },
  custom:   { label: "Custom",   hint: 16 / 9, hintStr: "16:9", weight: 0.5, audio: "mute",      hue: "#4A5568", glyph: "◇" },
};

const HINT_OPTIONS = [
  { str: "16:9", v: 16 / 9 }, { str: "4:3", v: 4 / 3 }, { str: "3:2", v: 3 / 2 },
  { str: "1:1", v: 1 }, { str: "3:4", v: 3 / 4 }, { str: "9:16", v: 9 / 16 }, { str: "8:1", v: 8 },
];

/* ---------------- §31 site catalog (prism-adapters/catalog, data) -------
   Loaded straight from the staged adapter repo; the validator (npm test)
   guarantees shape. Posters in the editor are always the wordmark fallback:
   fetching a service's own icons is the shells' job (cross-origin here). */
const catalogModules = import.meta.glob("../../../prism-adapters/catalog/*.json", { eager: true });
const adapterModules = import.meta.glob("../../../prism-adapters/adapters/*.json", { eager: true });
const CATALOG: CatalogEntry[] = Object.values(catalogModules)
  .map((m) => (m as { default: unknown }).default)
  .filter(validCatalogEntry)
  .sort((a, b) => a.name.localeCompare(b.name));
const ADAPTER_SELECTORS: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(adapterModules).map(([path, m]) => [
    path.match(/([a-z0-9-]+)\.json$/)?.[1] ?? path,
    ((m as { default: { selectors?: Record<string, string> } }).default.selectors ?? {}),
  ]),
);
/* §31 DRM badge: expectations set before a tile exists, from recorded evidence. */
function drmBadge(entry: CatalogEntry): string {
  switch (entry.drm?.["windows-host"]) {
    case "hardware": return "4K embedded";
    case "software": return "1080p embedded";
    case "none": return "no DRM";
    default: return "";
  }
}

const DEVICES = [
  { id: "tablet",   label: "Tablet 14″",     w: 16, h: 10 },
  { id: "tv",       label: "TV",             w: 16, h: 9 },
  { id: "portrait", label: "Portrait frame", w: 9,  h: 16 },
  { id: "monitor",  label: "Monitor 4:3",    w: 4,  h: 3 },
];

interface TileDraft {
  id: string;
  type: string;
  name: string;
  hint: number;
  hintStr: string;
  weight: number;
  audio: AudioPolicy;
  /** §31 catalog tile: the entry it came from. */
  catalogId?: string;
  /** Chosen focus preset id (resolved via the adapter's selector table on export). */
  presetId?: string;
  /** §31 zoom (0.5–3); undefined = 1. */
  zoom?: number;
  /** "Any website" tile: the real URL. */
  customUrl?: string;
  /** §10 account: share another tile's profile (tile id) instead of an isolated one. */
  shareProfileWith?: string;
}

/* Look for draft tiles the mock palette doesn't know (catalog picks, any-website). */
function draftLook(t: TileDraft): { hue: string; glyph: string } {
  const d = TILE_TYPES[t.type];
  if (d) return { hue: d.hue, glyph: d.glyph };
  return { hue: wordmark(t.name, null).background, glyph: t.customUrl ? "◇" : "▣" };
}

let idCounter = 0;
function makeTile(type: string): TileDraft {
  const d = TILE_TYPES[type]!;
  idCounter += 1;
  return {
    id: `${type}-${idCounter}`,
    type,
    name: d.label,
    hint: d.hint,
    hintStr: d.hintStr,
    weight: d.weight,
    audio: d.audio,
  };
}

function makeCatalogTile(entry: CatalogEntry, existing: TileDraft[]): TileDraft {
  idCounter += 1;
  const n = existing.filter((t) => t.catalogId === entry.id).length;
  return {
    id: n ? `${entry.id}-${n + 1}` : entry.id,
    type: "catalog",
    name: entry.name,
    hint: parseAspectHint(entry.aspectHint) ?? 16 / 9,
    hintStr: entry.aspectHint,
    weight: 1.0,
    audio: entry.audio,
    catalogId: entry.id,
    presetId: entry.focusPresets?.[0]?.id ?? "whole",
    zoom: entry.zoom !== 1 ? entry.zoom : undefined,
  };
}

function makeCustomTile(url: string): TileDraft {
  idCounter += 1;
  let name = "Website";
  try { name = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep default */ }
  return {
    id: `web-${idCounter}`,
    type: "web",
    name,
    hint: 16 / 9,
    hintStr: "16:9",
    weight: 0.5,
    audio: "mute",
    customUrl: url,
  };
}

function toSchema(
  tiles: TileDraft[],
  heroId: string,
  heroSize: number,
  dashName: string,
): DashboardDocument {
  return {
    schema: "frame.dashboard/v0.1",
    id: dashName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dashboard",
    name: dashName,
    layout: { mode: "hero", hero: heroId, heroSize: Number(heroSize.toFixed(2)), satellites: "auto", gap: 8 },
    audio: { policy: "exclusive" },
    tiles: tiles.map((t) => {
      // §31 catalog picks and any-website tiles go through the shared picker
      // logic: PLAIN tile schema, asserted — nothing picker-specific persists.
      let base: TileSpec;
      if (t.catalogId) {
        const entry = CATALOG.find((c) => c.id === t.catalogId)!;
        base = pickerTile(entry, {
          tileId: t.id,
          presetId: t.presetId,
          zoom: t.zoom,
          profile: t.shareProfileWith
            ? (tiles.find((o) => o.id === t.shareProfileWith)?.id ?? t.id)
            : undefined,
        }, ADAPTER_SELECTORS[entry.adapter ?? ""]);
        assertPlainTile(base as unknown as Record<string, unknown>);
      } else if (t.customUrl) {
        base = { id: t.id, url: t.customUrl, profile: t.id, aspectHint: t.hintStr, audio: t.audio };
        if (t.zoom && t.zoom !== 1) base.zoom = clampZoom(t.zoom);
        assertPlainTile(base as unknown as Record<string, unknown>);
      } else {
        // mock tiles for layout play (pre-§31 placeholder palette)
        base = {
          id: t.id,
          url: t.type === "youtube" ? "https://www.youtube.com"
            : t.type === "custom" ? "https://example.com"
            : `https://app.yourdomain.com/tiles/${t.type}`,
          adapter: t.type === "youtube" ? "youtube" : null,
          aspectHint: t.hintStr,
          audio: t.audio,
        };
      }
      return {
        ...base,
        aspectHint: t.hintStr,
        aspectWeight: t.weight,
        audio: t.audio,
        touch: t.audio === "mute" ? "scroll" : "full",
        persist: t.audio !== "mute",
      };
    }),
  };
}

export function App() {
  const [device, setDevice] = useState(DEVICES[0]!);
  const [tiles, setTiles] = useState<TileDraft[]>(() => [
    makeTile("youtube"), makeTile("calendar"), makeTile("radio"),
  ]);
  const [heroId, setHeroId] = useState(() => tiles[0]?.id ?? "");
  const [heroSize, setHeroSize] = useState(0.62);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dashName, setDashName] = useState("Kitchen");
  const [showJSON, setShowJSON] = useState<false | "schema" | "share">(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef(false);

  useEffect(() => {
    if (!tiles.find((t) => t.id === heroId) && tiles.length) setHeroId(tiles[0]!.id);
  }, [tiles, heroId]);

  const W = 1000;
  const H = (1000 * device.h) / device.w;
  const rects = useMemo(
    () => solveHero(tiles, heroId, heroSize, W, H),
    [tiles, heroId, heroSize, W, H],
  );
  const landscape = W >= H;
  const hero = tiles.find((t) => t.id === heroId);
  const selected = tiles.find((t) => t.id === selectedId);

  const doc = useMemo(
    () => toSchema(tiles, heroId, heroSize, dashName),
    [tiles, heroId, heroSize, dashName],
  );
  const fits = useMemo(() => fitReport(doc), [doc]);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = true;
      const move = (ev: PointerEvent) => {
        if (!dragRef.current || !canvasRef.current) return;
        const box = canvasRef.current.getBoundingClientRect();
        const frac = landscape
          ? (ev.clientX - box.left) / box.width
          : (ev.clientY - box.top) / box.height;
        setHeroSize(Math.min(0.85, Math.max(0.3, frac)));
      };
      const up = () => {
        dragRef.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [landscape],
  );

  const addTile = (type: string) => {
    if (tiles.length >= 7) return;
    const t = makeTile(type);
    setTiles((p) => [...p, t]);
    setSelectedId(t.id);
  };
  const addCatalogTile = (entry: CatalogEntry) => {
    if (tiles.length >= 7) return;
    const t = makeCatalogTile(entry, tiles);
    setTiles((p) => [...p, t]);
    setSelectedId(t.id);
  };
  const [customUrl, setCustomUrl] = useState("");
  const addCustomTile = () => {
    if (tiles.length >= 7 || !/^https:\/\/.+/.test(customUrl.trim())) return;
    const t = makeCustomTile(customUrl.trim());
    setTiles((p) => [...p, t]);
    setSelectedId(t.id);
    setCustomUrl("");
  };
  const removeTile = (id: string) => {
    setTiles((p) => p.filter((t) => t.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const patchTile = (id: string, patch: Partial<TileDraft>) =>
    setTiles((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const json = useMemo(() => {
    if (showJSON === "share") return JSON.stringify(exportLayout(doc), null, 2);
    return JSON.stringify(doc, null, 2);
  }, [doc, showJSON]);

  const copyJSON = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — JSON is selectable below */
    }
  };

  const previewAspect = device.w / device.h;

  return (
    <div style={{ minHeight: "100vh", background: T.wall, color: T.ink, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        button { font-family: inherit; cursor: pointer; }
        input, select { font-family: inherit; }
        input[type=range] { accent-color: ${T.accent}; }
        .tileblock { transition: left .18s ease, top .18s ease, width .18s ease, height .18s ease; }
        .dragging .tileblock { transition: none; }
        @media (prefers-reduced-motion: reduce) { .tileblock { transition: none; } }
        .ghostbtn { background: none; border: 1px solid ${T.panelEdge}; color: ${T.inkDim}; border-radius: 6px; padding: 5px 10px; font-size: 12px; }
        .ghostbtn:hover { border-color: ${T.inkFaint}; color: ${T.ink}; }
        .ghostbtn:focus-visible, .palettebtn:focus-visible { outline: 2px solid ${T.accent}; outline-offset: 1px; }
      `}</style>

      <header style={{ display: "flex", alignItems: "baseline", gap: 14, padding: "18px 22px 10px", borderBottom: `1px solid ${T.panelEdge}` }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: T.accent, letterSpacing: "0.08em" }}>frame.dashboard/v0.1</span>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 19, fontWeight: 600, margin: 0 }}>Prism Editor</h1>
        <span style={{ fontSize: 12, color: T.inkFaint, marginLeft: "auto" }}>drag the amber edge · tap a tile to select · powered by prism-core</span>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: 20, alignItems: "flex-start" }}>
        {/* ------------ the wall ------------ */}
        <div style={{ flex: "1 1 480px", minWidth: 320 }}>
          <div style={{
            borderRadius: 14, padding: "clamp(20px, 5vw, 56px)",
            background: `radial-gradient(ellipse 90% 70% at 50% 8%, ${T.wallLight} 0%, ${T.wall} 68%)`,
          }}>
            <div style={{ background: T.bezel, borderRadius: 10, padding: 10, boxShadow: "0 24px 48px -18px rgba(0,0,0,0.7), 0 2px 0 rgba(255,255,255,0.04) inset" }}>
              <div
                ref={canvasRef}
                className={dragRef.current ? "dragging" : ""}
                style={{ position: "relative", width: "100%", aspectRatio: `${previewAspect}`, background: "#0E1116", borderRadius: 4, overflow: "hidden" }}
              >
                {tiles.map((t) => {
                  const r = rects[t.id];
                  if (!r) return null;
                  const d = draftLook(t);
                  const isHero = t.id === heroId;
                  const isSel = t.id === selectedId;
                  const q = fitQuality(r, t.hint);
                  return (
                    <div
                      key={t.id}
                      className="tileblock"
                      onClick={() => setSelectedId(isSel ? null : t.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && setSelectedId(t.id)}
                      style={{
                        position: "absolute",
                        left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`,
                        width: `${(r.w / W) * 100}%`, height: `${(r.h / H) * 100}%`,
                        padding: 3,
                      }}
                    >
                      <div style={{
                        width: "100%", height: "100%", borderRadius: 6, position: "relative", overflow: "hidden",
                        background: `linear-gradient(160deg, ${d.hue} 0%, ${d.hue}CC 100%)`,
                        outline: isSel ? `2px solid ${T.accent}` : isHero ? `1.5px solid ${T.accent}66` : "1px solid rgba(255,255,255,0.06)",
                        outlineOffset: -1,
                        display: "flex", flexDirection: "column", justifyContent: "space-between",
                        padding: "6px 8px", color: "rgba(255,255,255,0.92)", cursor: "pointer",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, minWidth: 0 }}>
                          <span style={{ opacity: 0.85 }}>{d.glyph}</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                          {isHero && <span style={{ marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: T.accent, letterSpacing: "0.06em" }}>HERO</span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, opacity: 0.7 }}>{t.hintStr}</span>
                          <span title={`aspect fit ${(q * 100) | 0}%`} style={{ flex: "0 0 34px", height: 3, borderRadius: 2, background: "rgba(255,255,255,0.18)", overflow: "hidden" }}>
                            <span style={{ display: "block", width: `${q * 100}%`, height: "100%", background: q > 0.75 ? T.good : q > 0.45 ? T.accent : T.danger }} />
                          </span>
                          {t.audio !== "mute" && <span style={{ fontSize: 9, opacity: 0.7 }}>{t.audio === "exclusive" ? "♪ excl" : "♪ mix"}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {hero && rects[hero.id] && tiles.length > 1 && (
                  <div
                    onPointerDown={onDragStart}
                    role="slider"
                    aria-label="Hero size"
                    aria-valuenow={Math.round(heroSize * 100)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight" || e.key === "ArrowUp") setHeroSize((s) => Math.min(0.85, s + 0.02));
                      if (e.key === "ArrowLeft" || e.key === "ArrowDown") setHeroSize((s) => Math.max(0.3, s - 0.02));
                    }}
                    style={{
                      position: "absolute",
                      ...(landscape
                        ? { left: `calc(${heroSize * 100}% - 7px)`, top: 0, width: 14, height: "100%", cursor: "ew-resize" }
                        : { top: `calc(${heroSize * 100}% - 7px)`, left: 0, height: 14, width: "100%", cursor: "ns-resize" }),
                      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5,
                    }}
                  >
                    <div style={{
                      background: T.accent, borderRadius: 3, boxShadow: `0 0 10px ${T.accent}66`,
                      ...(landscape ? { width: 4, height: "26%" } : { height: 4, width: "26%" }),
                    }} />
                  </div>
                )}
              </div>
            </div>

            {/* §20 fit badges — computed by the same core the gallery uses */}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {fits.map((f) => (
                <span key={f.profile} title={`fit ${(f.score * 100) | 0}%${f.sliverTiles.length ? ` · slivers: ${f.sliverTiles.join(", ")}` : ""}`}
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.04em",
                    padding: "3px 8px", borderRadius: 5, border: `1px solid ${T.panelEdge}`,
                    color: f.grade === "excellent" ? T.good : f.grade === "good" ? T.accent : T.danger,
                    background: "#171B22",
                  }}>
                  {f.profile} · {f.grade}
                </span>
              ))}
            </div>
            <p style={{ textAlign: "center", fontSize: 11, color: T.inkFaint, margin: "10px 0 0", fontFamily: "'IBM Plex Mono', monospace" }}>
              {device.label} · hero {(heroSize * 100) | 0}% · {tiles.length}/7 tiles
            </p>
          </div>
        </div>

        {/* ------------ controls ------------ */}
        <div style={{ flex: "1 1 300px", minWidth: 280, maxWidth: 420, display: "flex", flexDirection: "column", gap: 14 }}>
          <section style={panelStyle()}>
            <div style={{ display: "flex", gap: 10 }}>
              <label style={{ flex: 1 }}>
                <span style={labelStyle()}>Dashboard name</span>
                <input value={dashName} onChange={(e) => setDashName(e.target.value)} style={inputStyle()} />
              </label>
              <label style={{ flex: 1 }}>
                <span style={labelStyle()}>Device</span>
                <select value={device.id} onChange={(e) => setDevice(DEVICES.find((d) => d.id === e.target.value)!)} style={inputStyle()}>
                  {DEVICES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section style={panelStyle()}>
            <span style={labelStyle()}>Add from catalog {tiles.length >= 7 && <em style={{ color: T.accentDim, fontStyle: "normal" }}>· grid full</em>}</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8, marginTop: 8 }}>
              {CATALOG.map((entry) => {
                const wm = wordmark(entry.name, null);
                const badge = drmBadge(entry);
                return (
                  <button key={entry.id} onClick={() => addCatalogTile(entry)} disabled={tiles.length >= 7}
                    title={entry.notes ?? entry.name}
                    style={{
                      border: `1px solid ${T.panelEdge}`, borderRadius: 8, overflow: "hidden", padding: 0,
                      background: "#171B22", opacity: tiles.length >= 7 ? 0.5 : 1, textAlign: "left",
                    }}>
                    <div style={{
                      aspectRatio: "16/10", display: "flex", alignItems: "center", justifyContent: "center",
                      background: wm.background, color: wm.foreground,
                      fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: "0.02em",
                    }}>{entry.name}</div>
                    <div style={{ padding: "5px 7px", display: "flex", alignItems: "baseline", gap: 5 }}>
                      <span style={{ fontSize: 11, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                      {badge && <span style={{ marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace", fontSize: 8, color: T.inkDim, whiteSpace: "nowrap" }}>{badge}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <input value={customUrl} placeholder="https://any-website…  (adds as a tile)"
                onChange={(e) => setCustomUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustomTile()}
                style={{ ...inputStyle(), marginTop: 0, flex: 1 }} />
              <button className="ghostbtn" onClick={addCustomTile}
                disabled={tiles.length >= 7 || !/^https:\/\/.+/.test(customUrl.trim())}>Add</button>
            </div>
            <p style={{ fontSize: 11, color: T.inkDim, margin: "8px 0 0" }}>
              Posters here are wordmarks — frames fetch each service's own icon (§31). Region tap-to-frame
              runs on the frame's live preview; presets below cover the common regions.
            </p>
          </section>

          <section style={panelStyle()}>
            <span style={labelStyle()}>Mock tiles (layout play)</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {Object.entries(TILE_TYPES).map(([key, d]) => (
                <button key={key} className="palettebtn" onClick={() => addTile(key)} disabled={tiles.length >= 7}
                  style={{
                    border: `1px solid ${T.panelEdge}`, background: "#171B22", color: tiles.length >= 7 ? T.inkFaint : T.ink,
                    borderRadius: 6, padding: "6px 10px", fontSize: 12, display: "flex", gap: 6, alignItems: "center",
                  }}>
                  <span style={{ color: d.hue, filter: "brightness(1.6)" }}>{d.glyph}</span>{d.label}
                </button>
              ))}
            </div>
          </section>

          <section style={panelStyle()}>
            <span style={labelStyle()}>{selected ? "Selected tile" : "Tiles"}</span>
            {!selected && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {tiles.map((t) => (
                  <button key={t.id} onClick={() => setSelectedId(t.id)}
                    style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", color: T.ink, padding: "5px 2px", fontSize: 13, textAlign: "left", borderRadius: 4 }}>
                    <span style={{ color: draftLook(t).hue, filter: "brightness(1.6)" }}>{draftLook(t).glyph}</span>
                    <span style={{ flex: 1 }}>{t.name}</span>
                    {t.id === heroId && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: T.accent }}>HERO</span>}
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: T.inkFaint }}>{t.hintStr}</span>
                  </button>
                ))}
                {!tiles.length && <p style={{ fontSize: 12, color: T.inkFaint, margin: "6px 0 0" }}>Add a tile above to start the layout.</p>}
              </div>
            )}
            {selected && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                <label>
                  <span style={labelStyle()}>Name</span>
                  <input value={selected.name} onChange={(e) => patchTile(selected.id, { name: e.target.value })} style={inputStyle()} />
                </label>
                <div style={{ display: "flex", gap: 10 }}>
                  <label style={{ flex: 1 }}>
                    <span style={labelStyle()}>Aspect hint</span>
                    <select value={selected.hintStr}
                      onChange={(e) => { const o = HINT_OPTIONS.find((h) => h.str === e.target.value)!; patchTile(selected.id, { hintStr: o.str, hint: o.v }); }}
                      style={inputStyle()}>
                      {HINT_OPTIONS.map((h) => <option key={h.str} value={h.str}>{h.str}</option>)}
                    </select>
                  </label>
                  <label style={{ flex: 1 }}>
                    <span style={labelStyle()}>Audio</span>
                    <select value={selected.audio} onChange={(e) => patchTile(selected.id, { audio: e.target.value as AudioPolicy })} style={inputStyle()}>
                      <option value="exclusive">exclusive</option>
                      <option value="mix">mix</option>
                      <option value="mute">mute</option>
                    </select>
                  </label>
                </div>
                {selected.catalogId && (() => {
                  const entry = CATALOG.find((c) => c.id === selected.catalogId)!;
                  const table = ADAPTER_SELECTORS[entry.adapter ?? ""] ?? {};
                  return (
                    <div>
                      <span style={labelStyle()}>Focus preset</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                        {(entry.focusPresets ?? []).map((p) => {
                          const resolvable = p.selector === null || !!table[p.selector];
                          const on = (selected.presetId ?? "whole") === p.id;
                          return (
                            <button key={p.id} className="ghostbtn" disabled={!resolvable}
                              title={resolvable ? p.label : `adapter selector "${p.selector}" missing`}
                              onClick={() => patchTile(selected.id, { presetId: p.id })}
                              style={on ? { color: T.accent, borderColor: T.accentDim } : { opacity: resolvable ? 1 : 0.45 }}>
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                {(selected.catalogId || selected.customUrl) && (
                  <label>
                    <span style={labelStyle()}>Zoom · {(selected.zoom ?? 1).toFixed(2)}×</span>
                    <input type="range" min="0.5" max="3" step="0.05" value={selected.zoom ?? 1}
                      onChange={(e) => patchTile(selected.id, { zoom: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}
                      style={{ width: "100%", marginTop: 4 }} />
                  </label>
                )}
                {selected.catalogId && tiles.some((t) => t.id !== selected.id && t.catalogId === selected.catalogId) && (
                  <label>
                    <span style={labelStyle()}>Account (§10)</span>
                    <select value={selected.shareProfileWith ?? ""}
                      onChange={(e) => patchTile(selected.id, { shareProfileWith: e.target.value || undefined })}
                      style={inputStyle()}>
                      <option value="">New isolated profile</option>
                      {tiles.filter((t) => t.id !== selected.id && t.catalogId === selected.catalogId).map((t) => (
                        <option key={t.id} value={t.id}>Share with {t.name} ({t.id})</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <span style={labelStyle()}>Aspect weight · {selected.weight.toFixed(1)} {selected.weight < 0.3 ? "(flexible)" : selected.weight > 0.8 ? "(rigid)" : ""}</span>
                  <input type="range" min="0" max="1" step="0.1" value={selected.weight}
                    onChange={(e) => patchTile(selected.id, { weight: Number(e.target.value) })}
                    style={{ width: "100%", marginTop: 4 }} />
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selected.id !== heroId && (
                    <button className="ghostbtn" style={{ borderColor: T.accentDim, color: T.accent }} onClick={() => setHeroId(selected.id)}>Make hero</button>
                  )}
                  <button className="ghostbtn" style={{ color: T.danger, borderColor: "#4A3230" }} onClick={() => removeTile(selected.id)}>Remove</button>
                  <button className="ghostbtn" style={{ marginLeft: "auto" }} onClick={() => setSelectedId(null)}>Done</button>
                </div>
              </div>
            )}
          </section>

          <section style={panelStyle()}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={labelStyle()}>Export</span>
              <button className="ghostbtn" style={{ marginLeft: "auto", ...(showJSON === "schema" ? { color: T.accent, borderColor: T.accentDim } : {}) }}
                onClick={() => setShowJSON(showJSON === "schema" ? false : "schema")}>Schema</button>
              <button className="ghostbtn" style={showJSON === "share" ? { color: T.accent, borderColor: T.accentDim } : {}}
                onClick={() => setShowJSON(showJSON === "share" ? false : "share")}>Share</button>
              {showJSON && <button className="ghostbtn" style={{ borderColor: T.accentDim, color: T.accent }} onClick={copyJSON}>{copied ? "Copied" : "Copy"}</button>}
            </div>
            {showJSON === "share" && (
              <p style={{ fontSize: 11, color: T.inkDim, margin: "8px 0 0" }}>
                Sanitized for sharing (§15): accounts stripped, personal URLs are slots.
              </p>
            )}
            {showJSON && (
              <pre style={{
                margin: "10px 0 0", padding: 12, background: "#10141A", border: `1px solid ${T.panelEdge}`, borderRadius: 8,
                fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: 1.5, color: "#A8C0A8",
                overflowX: "auto", maxHeight: 320, userSelect: "text",
              }}>{json}</pre>
            )}
          </section>
        </div>
      </div>
    </div>
  );

  function panelStyle(): React.CSSProperties {
    return { background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: 14 };
  }
  function labelStyle(): React.CSSProperties {
    return { display: "block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: T.inkDim, marginBottom: 2 };
  }
  function inputStyle(): React.CSSProperties {
    return { width: "100%", background: "#171B22", border: `1px solid ${T.panelEdge}`, borderRadius: 6, color: T.ink, padding: "7px 9px", fontSize: 13, marginTop: 3 };
  }
}
