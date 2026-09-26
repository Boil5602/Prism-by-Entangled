import { useState, useRef, useCallback, useMemo, useEffect } from "react";

/* ================================================================
   frame.dashboard/v0.1 — Dashboard Editor (reference implementation)
   - Deterministic hero-layout solver (spec §8)
   - Drag the hero's edge; satellites reflow live
   - Click a tile to select; promote any tile to hero
   - Exports schema-valid JSON
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
};

const TILE_TYPES = {
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

const DEVICES = [
  { id: "tablet",   label: "Tablet 14″",     w: 16, h: 10 },
  { id: "tv",       label: "TV",             w: 16, h: 9 },
  { id: "portrait", label: "Portrait frame", w: 9,  h: 16 },
  { id: "monitor",  label: "Monitor 4:3",    w: 4,  h: 3 },
];

/* ----------------------- the solver (§8) -----------------------
   Deterministic. Hero claims `heroSize` of the long axis, sized
   toward its aspect hint. Leftover space = up to two strips
   (cross-strip beside hero, long-strip after it). Satellites are
   assigned by exhaustive subset search minimizing
   Σ weight·|log(actual/hint)|. Ties break on subset encoding,
   preserving tile order. Identical inputs ⇒ identical rects.     */

function aspectCost(w, h, hint, weight) {
  if (w <= 0 || h <= 0) return Infinity;
  return weight * Math.abs(Math.log(w / h / hint));
}

function solveHero(tiles, heroId, heroSize, W, H) {
  const rects = {};
  if (!tiles.length) return rects;
  const hero = tiles.find((t) => t.id === heroId) || tiles[0];
  const sats = tiles.filter((t) => t.id !== hero.id);
  const landscape = W >= H;

  let hw, hh;
  if (landscape) {
    hw = heroSize * W;
    hh = Math.min(H, hw / hero.hint);
    if (H - hh < 0.15 * H || sats.length === 0) hh = H; // avoid sliver strips
  } else {
    hh = heroSize * H;
    hw = Math.min(W, hh * hero.hint);
    if (W - hw < 0.15 * W || sats.length === 0) hw = W;
  }
  rects[hero.id] = { x: 0, y: 0, w: hw, h: hh };

  if (!sats.length) {
    rects[hero.id] = { x: 0, y: 0, w: W, h: H };
    return rects;
  }

  // strip A: beside hero along the long axis; strip B: after hero on the cross axis
  const A = landscape
    ? { x: hw, y: 0, w: W - hw, h: H }
    : { x: 0, y: hh, w: W, h: H - hh };
  const B = landscape
    ? { x: 0, y: hh, w: hw, h: H - hh }
    : { x: hw, y: 0, w: W - hw, h: hh };
  const aOK = A.w > 1 && A.h > 1;
  const bOK = B.w > 1 && B.h > 1;

  // v2 (2026-08-31): each strip subdivides into a COLUMN GRID, columns
  // chosen by the same cost the strip assignment minimizes - four 16:9
  // satellites in a tall strip go 2x2 instead of four letterboxed bars.
  // The last row stretches to fill its width; ties prefer fewer columns.
  const gridCost = (S, arr, cols) => {
    const rows = Math.ceil(arr.length / cols);
    let cost = 0;
    for (let i = 0; i < arr.length; i++) {
      const r = Math.floor(i / cols);
      const rowCount = Math.min(cols, arr.length - r * cols);
      cost += aspectCost(S.w / rowCount, S.h / rows, arr[i].hint, arr[i].weight);
    }
    return cost;
  };
  const placeGrid = (S, arr, cols) => {
    const rows = Math.ceil(arr.length / cols);
    arr.forEach((t, i) => {
      const r = Math.floor(i / cols);
      const rowCount = Math.min(cols, arr.length - r * cols);
      const c = i - r * cols;
      const w = S.w / rowCount, h = S.h / rows;
      rects[t.id] = { x: S.x + c * w, y: S.y + r * h, w, h };
    });
  };

  let best = null;
  const k = sats.length;
  for (let mask = 0; mask < 1 << k; mask++) {
    const inA = [], inB = [];
    for (let i = 0; i < k; i++) (mask & (1 << i) ? inA : inB).push(sats[i]);
    if (inA.length && !aOK) continue;
    if (inB.length && !bOK) continue;
    if (!inA.length && !inB.length) continue;
    for (let ca = 1; ca <= Math.max(1, inA.length); ca++) {
      for (let cb = 1; cb <= Math.max(1, inB.length); cb++) {
        let cost = 0;
        if (inA.length) cost += gridCost(A, inA, ca);
        if (inB.length) cost += gridCost(B, inB, cb);
        if (!best || cost < best.cost - 1e-9) best = { cost, mask, ca, cb };
        if (!inB.length) break;
      }
      if (!inA.length) break;
    }
  }

  if (!best) { // degenerate: everything overlaps hero region; stack in A anyway
    const s = { w: W, h: H / k };
    sats.forEach((t, i) => (rects[t.id] = { x: 0, y: i * s.h, w: s.w, h: s.h }));
    return rects;
  }

  const inA = [], inB = [];
  for (let i = 0; i < k; i++) (best.mask & (1 << i) ? inA : inB).push(sats[i]);
  if (inA.length) placeGrid(A, inA, best.ca);
  if (inB.length) placeGrid(B, inB, best.cb);
  return rects;
}

/* ----------------------- helpers ----------------------- */
let idCounter = 0;
function makeTile(type) {
  const d = TILE_TYPES[type];
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

function fitQuality(rect, hint) {
  if (!rect || rect.w <= 0 || rect.h <= 0) return 0;
  const dev = Math.abs(Math.log(rect.w / rect.h / hint));
  return Math.max(0, 1 - dev / Math.log(3)); // 1 = perfect, 0 = 3× off
}

function toSchema(tiles, heroId, heroSize, dashName) {
  return {
    schema: "frame.dashboard/v0.1",
    id: dashName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dashboard",
    name: dashName,
    layout: { mode: "hero", hero: heroId, heroSize: Number(heroSize.toFixed(2)), satellites: "auto", gap: 8 },
    audio: { policy: "exclusive" },
    tiles: tiles.map((t) => ({
      id: t.id,
      url: t.type === "youtube" ? "https://www.youtube.com"
        : t.type === "custom" ? "https://example.com"
        : `https://app.yourdomain.com/tiles/${t.type}`,
      adapter: t.type === "youtube" ? "youtube" : null,
      aspectHint: t.hintStr,
      aspectWeight: t.weight,
      audio: t.audio,
      touch: t.audio === "mute" ? "scroll" : "full",
      persist: t.audio !== "mute",
    })),
  };
}

/* ----------------------- component ----------------------- */
export default function FrameEditor() {
  const [device, setDevice] = useState(DEVICES[0]);
  const [tiles, setTiles] = useState(() => [makeTile("youtube"), makeTile("calendar"), makeTile("radio")]);
  const [heroId, setHeroId] = useState(() => tiles?.[0]?.id);
  const [heroSize, setHeroSize] = useState(0.62);
  const [selectedId, setSelectedId] = useState(null);
  const [dashName, setDashName] = useState("Kitchen");
  const [showJSON, setShowJSON] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fullscreenId, setFullscreenId] = useState(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  // keep heroId valid
  useEffect(() => {
    if (!tiles.find((t) => t.id === heroId) && tiles.length) setHeroId(tiles[0].id);
  }, [tiles, heroId]);

  const W = 1000;
  const H = (1000 * device.h) / device.w;
  const rects = useMemo(
    () => solveHero(tiles, heroId, heroSize, W, H),
    [tiles, heroId, heroSize, W, H]
  );
  const landscape = W >= H;
  const hero = tiles.find((t) => t.id === heroId);
  const selected = tiles.find((t) => t.id === selectedId);

  /* drag hero edge */
  const onDragStart = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = true;
    const move = (ev) => {
      if (!dragRef.current || !canvasRef.current) return;
      const box = canvasRef.current.getBoundingClientRect();
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const frac = landscape ? (cx - box.left) / box.width : (cy - box.top) / box.height;
      setHeroSize(Math.min(0.85, Math.max(0.3, frac)));
    };
    const up = () => {
      dragRef.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [landscape]);

  const addTile = (type) => {
    if (tiles.length >= 7) return;
    const t = makeTile(type);
    setTiles((p) => [...p, t]);
    setSelectedId(t.id);
  };
  const removeTile = (id) => {
    setTiles((p) => p.filter((t) => t.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (fullscreenId === id) setFullscreenId(null);
  };
  const patchTile = (id, patch) =>
    setTiles((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const json = useMemo(
    () => JSON.stringify(toSchema(tiles, heroId, heroSize, dashName), null, 2),
    [tiles, heroId, heroSize, dashName]
  );
  const copyJSON = async () => {
    try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard unavailable in sandbox — JSON is selectable below */ }
  };

  /* preview scaling */
  const previewAspect = device.w / device.h;

  return (
    <div style={{ minHeight: "100vh", background: T.wall, color: T.ink, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
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

      {/* header */}
      <header style={{ display: "flex", alignItems: "baseline", gap: 14, padding: "18px 22px 10px", borderBottom: `1px solid ${T.panelEdge}` }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: T.accent, letterSpacing: "0.08em" }}>frame.dashboard/v0.1</span>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 19, fontWeight: 600, margin: 0 }}>Dashboard editor</h1>
        <span style={{ fontSize: 12, color: T.inkFaint, marginLeft: "auto" }}>drag the amber edge · tap a tile to select</span>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: 20, alignItems: "flex-start" }}>
        {/* ------------ the wall ------------ */}
        <div style={{ flex: "1 1 480px", minWidth: 320 }}>
          <div style={{
            borderRadius: 14, padding: "clamp(20px, 5vw, 56px)",
            background: `radial-gradient(ellipse 90% 70% at 50% 8%, ${T.wallLight} 0%, ${T.wall} 68%)`,
          }}>
            {/* the frame */}
            <div style={{ background: T.bezel, borderRadius: 10, padding: 10, boxShadow: "0 24px 48px -18px rgba(0,0,0,0.7), 0 2px 0 rgba(255,255,255,0.04) inset" }}>
              <div
                ref={canvasRef}
                className={dragRef.current ? "dragging" : ""}
                style={{ position: "relative", width: "100%", aspectRatio: `${previewAspect}`, background: "#0E1116", borderRadius: 4, overflow: "hidden" }}
              >
                {fullscreenId ? (
                  (() => {
                    const t = tiles.find((x) => x.id === fullscreenId);
                    const d = t ? TILE_TYPES[t.type] : null;
                    return (
                      <button
                        onClick={() => setFullscreenId(null)}
                        aria-label="Exit fullscreen preview"
                        style={{ position: "absolute", inset: 0, border: "none", background: d ? d.hue : "#333", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}
                      >
                        <span style={{ fontSize: 34, opacity: 0.9 }}>{d?.glyph}</span>
                        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16 }}>{t?.name} — fullscreen</span>
                        <span style={{ fontSize: 11, opacity: 0.75 }}>tap to return to grid</span>
                      </button>
                    );
                  })()
                ) : (
                  tiles.map((t) => {
                    const r = rects[t.id];
                    if (!r) return null;
                    const d = TILE_TYPES[t.type];
                    const isHero = t.id === heroId;
                    const isSel = t.id === selectedId;
                    const q = fitQuality(r, t.hint);
                    const gap = 3;
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
                          padding: gap,
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
                              <span style={{ display: "block", width: `${q * 100}%`, height: "100%", background: q > 0.75 ? "#9FD8A5" : q > 0.45 ? T.accent : T.danger }} />
                            </span>
                            {t.audio !== "mute" && <span style={{ fontSize: 9, opacity: 0.7 }}>{t.audio === "exclusive" ? "♪ excl" : "♪ mix"}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* hero drag edge */}
                {!fullscreenId && hero && rects[hero.id] && tiles.length > 1 && (
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
            <p style={{ textAlign: "center", fontSize: 11, color: T.inkFaint, margin: "12px 0 0", fontFamily: "'IBM Plex Mono', monospace" }}>
              {device.label} · hero {(heroSize * 100) | 0}% · {tiles.length}/7 tiles
            </p>
          </div>
        </div>

        {/* ------------ controls ------------ */}
        <div style={{ flex: "1 1 300px", minWidth: 280, maxWidth: 420, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* dashboard + device */}
          <section style={panelStyle()}>
            <div style={{ display: "flex", gap: 10 }}>
              <label style={{ flex: 1 }}>
                <span style={labelStyle()}>Dashboard name</span>
                <input value={dashName} onChange={(e) => setDashName(e.target.value)} style={inputStyle()} />
              </label>
              <label style={{ flex: 1 }}>
                <span style={labelStyle()}>Device</span>
                <select value={device.id} onChange={(e) => setDevice(DEVICES.find((d) => d.id === e.target.value))} style={inputStyle()}>
                  {DEVICES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </label>
            </div>
          </section>

          {/* add tiles */}
          <section style={panelStyle()}>
            <span style={labelStyle()}>Add tile {tiles.length >= 7 && <em style={{ color: T.accentDim, fontStyle: "normal" }}>· grid full</em>}</span>
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

          {/* selected tile */}
          <section style={panelStyle()}>
            <span style={labelStyle()}>{selected ? "Selected tile" : "Tiles"}</span>
            {!selected && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {tiles.map((t) => (
                  <button key={t.id} onClick={() => setSelectedId(t.id)}
                    style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", color: T.ink, padding: "5px 2px", fontSize: 13, textAlign: "left", borderRadius: 4 }}>
                    <span style={{ color: TILE_TYPES[t.type].hue, filter: "brightness(1.6)" }}>{TILE_TYPES[t.type].glyph}</span>
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
                      onChange={(e) => { const o = HINT_OPTIONS.find((h) => h.str === e.target.value); patchTile(selected.id, { hintStr: o.str, hint: o.v }); }}
                      style={inputStyle()}>
                      {HINT_OPTIONS.map((h) => <option key={h.str} value={h.str}>{h.str}</option>)}
                    </select>
                  </label>
                  <label style={{ flex: 1 }}>
                    <span style={labelStyle()}>Audio</span>
                    <select value={selected.audio} onChange={(e) => patchTile(selected.id, { audio: e.target.value })} style={inputStyle()}>
                      <option value="exclusive">exclusive</option>
                      <option value="mix">mix</option>
                      <option value="mute">mute</option>
                    </select>
                  </label>
                </div>
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
                  <button className="ghostbtn" onClick={() => setFullscreenId(selected.id)}>Preview fullscreen</button>
                  <button className="ghostbtn" style={{ color: T.danger, borderColor: "#4A3230" }} onClick={() => removeTile(selected.id)}>Remove</button>
                  <button className="ghostbtn" style={{ marginLeft: "auto" }} onClick={() => setSelectedId(null)}>Done</button>
                </div>
              </div>
            )}
          </section>

          {/* export */}
          <section style={panelStyle()}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={labelStyle()}>Schema JSON</span>
              <button className="ghostbtn" style={{ marginLeft: "auto" }} onClick={() => setShowJSON((s) => !s)}>{showJSON ? "Hide" : "Show"}</button>
              <button className="ghostbtn" style={{ borderColor: T.accentDim, color: T.accent }} onClick={copyJSON}>{copied ? "Copied" : "Copy"}</button>
            </div>
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

  function panelStyle() {
    return { background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: 14 };
  }
  function labelStyle() {
    return { display: "block", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: T.inkDim, marginBottom: 2 };
  }
  function inputStyle() {
    return { width: "100%", background: "#171B22", border: `1px solid ${T.panelEdge}`, borderRadius: 6, color: T.ink, padding: "7px 9px", fontSize: 13, marginTop: 3 };
  }
}
