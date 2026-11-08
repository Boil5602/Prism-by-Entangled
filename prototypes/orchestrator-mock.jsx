import { useState, useRef, useMemo, useEffect, useCallback } from "react";

/* ================================================================
   Prism — Window Orchestrator mock
   Six "browser windows" on a screen. Drag one into another's region and
   the layout brain re-solves; everyone else animates around it. Drag the
   amber hero edge to resize. Fire an ad break to see the veil inside a
   tile, hero or satellite alike.
   ================================================================ */

const T = { wall: "#14171C", panel: "#1E232B", edge: "#2C333E", ink: "#D7DCE3", dim: "#8A93A0", faint: "#5A6270", accent: "#F0A83C" };

const TILES = [
  { id: "netflix",  name: "Netflix",  hint: 16 / 9, weight: 1.0, hue: "#5A1F27", glyph: "N" },
  { id: "hulu",     name: "Hulu",     hint: 16 / 9, weight: 1.0, hue: "#1F4A3A", glyph: "h" },
  { id: "youtube",  name: "YouTube",  hint: 16 / 9, weight: 0.9, hue: "#4A2323", glyph: "▶" },
  { id: "twitch",   name: "Twitch",   hint: 16 / 9, weight: 0.8, hue: "#3A2A5A", glyph: "◉" },
  { id: "calendar", name: "Merge",    hint: 3 / 4,  weight: 0.6, hue: "#2B4A33", glyph: "▦" },
  { id: "cams",     name: "Cams",     hint: 4 / 3,  weight: 0.5, hue: "#2C3A4A", glyph: "◫" },
];

/* ---------- solver (§8, same as the editor) ---------- */
function cost(w, h, hint, weight) { return w <= 0 || h <= 0 ? Infinity : weight * Math.abs(Math.log(w / h / hint)); }
function solve(order, heroId, heroSize, W, H) {
  const rects = {};
  const hero = TILES.find((t) => t.id === heroId);
  const sats = order.filter((id) => id !== heroId).map((id) => TILES.find((t) => t.id === id));
  let hw = heroSize * W, hh = Math.min(H, hw / hero.hint);
  if (H - hh < 0.15 * H || !sats.length) hh = H;
  rects[hero.id] = { x: 0, y: 0, w: hw, h: hh };
  if (!sats.length) { rects[hero.id] = { x: 0, y: 0, w: W, h: H }; return rects; }
  const A = { x: hw, y: 0, w: W - hw, h: H }, B = { x: 0, y: hh, w: hw, h: H - hh };
  const aOK = A.w > 1, bOK = B.h > 1;
  let best = null; const k = sats.length;
  for (let m = 0; m < 1 << k; m++) {
    const inA = [], inB = [];
    for (let i = 0; i < k; i++) (m & (1 << i) ? inA : inB).push(sats[i]);
    if ((inA.length && !aOK) || (inB.length && !bOK)) continue;
    let c = 0;
    if (inA.length) { const s = { w: A.w, h: A.h / inA.length }; for (const t of inA) c += cost(s.w, s.h, t.hint, t.weight); }
    if (inB.length) { const s = { w: B.w / inB.length, h: B.h }; for (const t of inB) c += cost(s.w, s.h, t.hint, t.weight); }
    if (!best || c < best.c - 1e-9) best = { c, m };
  }
  const inA = [], inB = [];
  for (let i = 0; i < k; i++) (best.m & (1 << i) ? inA : inB).push(sats[i]);
  inA.forEach((t, i) => (rects[t.id] = { x: A.x, y: A.y + (A.h / inA.length) * i, w: A.w, h: A.h / inA.length }));
  inB.forEach((t, i) => (rects[t.id] = { x: B.x + (B.w / inB.length) * i, y: B.y, w: B.w / inB.length, h: B.h }));
  return rects;
}

const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
function nearestSlot(rect, target) {
  const c = center(rect); let best = null;
  for (const [id, r] of Object.entries(target)) {
    const rc = center(r), d = Math.hypot(c.x - rc.x, c.y - rc.y);
    if (!best || d < best.d) best = { id, d };
  }
  return best.id;
}

export default function OrchestratorMock() {
  const W = 1000, H = 562; // 16:9 logical screen
  const [order, setOrder] = useState(TILES.map((t) => t.id));
  const [hero, setHero] = useState("netflix");
  const [heroSize, setHeroSize] = useState(0.64);
  const [adBreak, setAdBreak] = useState(null); // tile id under veil
  const [log, setLog] = useState(["Layout brain online. Drag a window into another's region."]);
  const [drag, setDrag] = useState(null); // { id, dx, dy, x, y }
  const screenRef = useRef(null);
  const target = useMemo(() => solve(order, hero, heroSize, W, H), [order, hero, heroSize]);

  const say = (m) => setLog((l) => [m, ...l].slice(0, 6));

  /* -------- drag a window -------- */
  const toLogical = (e) => {
    const b = screenRef.current.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H };
  };
  const onDown = (id) => (e) => {
    if (e.target.dataset.edge) return;
    e.preventDefault();
    const p = toLogical(e), r = target[id];
    setDrag({ id, dx: p.x - r.x, dy: p.y - r.y, x: r.x, y: r.y });
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e) => { const p = toLogical(e); setDrag((d) => d && { ...d, x: p.x - d.dx, y: p.y - d.dy }); };
    const up = () => {
      setDrag((d) => {
        if (!d) return null;
        const r = { ...target[d.id], x: d.x, y: d.y };
        const slot = nearestSlot(r, target);
        if (slot !== d.id) {
          if (slot === hero) { setHero(d.id); say(`${name(d.id)} dragged into the hero region → promoted; others re-solve.`); }
          else if (d.id === hero) { setHero(slot); say(`Hero dragged into ${name(slot)}'s slot → ${name(slot)} promoted, ${name(d.id)} demoted.`); }
          else {
            setOrder((o) => { const n = [...o], i = n.indexOf(d.id), j = n.indexOf(slot); [n[i], n[j]] = [n[j], n[i]]; return n; });
            say(`${name(d.id)} swapped with ${name(slot)}.`);
          }
        } else say(`${name(d.id)} released in its own slot → snapped back.`);
        return null;
      });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [drag, target, hero]);

  /* -------- hero edge resize -------- */
  const onEdgeDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const move = (ev) => { const p = toLogical(ev); setHeroSize(Math.min(0.85, Math.max(0.3, p.x / W))); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); say("Hero resized → satellites re-flowed."); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const name = (id) => TILES.find((t) => t.id === id).name;
  const fireAd = () => {
    const id = adBreak ? null : (["netflix", "hulu", "youtube"].find((x) => x !== adBreak) || "netflix");
    setAdBreak(id);
    say(id ? `Ad break detected in ${name(id)} → veil raised inside its window (hero or not).` : "Content resumed → veil dissolved.");
  };

  return (
    <div style={{ minHeight: "100vh", background: T.wall, color: T.ink, fontFamily: "'IBM Plex Sans', sans-serif", padding: 18 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono&display=swap');
        .win { position:absolute; transition: left .22s cubic-bezier(.2,.8,.2,1), top .22s cubic-bezier(.2,.8,.2,1), width .22s cubic-bezier(.2,.8,.2,1), height .22s cubic-bezier(.2,.8,.2,1); }
        .win.dragging { transition:none; z-index:20; }
        .veil { position:absolute; inset:0; background: radial-gradient(ellipse at 30% 70%, #6b5b3a 0%, #3a3a52 45%, #101420 100%); display:flex; align-items:center; justify-content:center; animation: fade .35s ease both; }
        @keyframes fade { from{opacity:0} to{opacity:1} }
        .btn { background:none; border:1px solid ${T.edge}; color:${T.dim}; border-radius:6px; padding:6px 12px; font:12px 'IBM Plex Sans'; cursor:pointer; }
        .btn:hover { color:${T.ink}; border-color:${T.faint}; }
        @media (prefers-reduced-motion: reduce){ .win{ transition:none } .veil{ animation:none } }
      `}</style>

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: T.accent, letterSpacing: ".08em" }}>PRISM · ORCHESTRATOR MOCK</span>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 600 }}>Six windows, one layout brain</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: T.faint }}>drag windows · drag the amber edge · fire an ad break</span>
      </div>

      {/* the screen */}
      <div ref={screenRef} style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: "#0B0D11", borderRadius: 8, border: `1px solid ${T.edge}`, overflow: "hidden", userSelect: "none", touchAction: "none" }}>
        {order.map((id) => {
          const t = TILES.find((x) => x.id === id);
          const r = target[id]; const isDrag = drag?.id === id;
          const x = isDrag ? drag.x : r.x, y = isDrag ? drag.y : r.y;
          const isHero = id === hero, veiled = adBreak === id;
          return (
            <div key={id} className={`win${isDrag ? " dragging" : ""}`} onPointerDown={onDown(id)}
              style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, width: `${(r.w / W) * 100}%`, height: `${(r.h / H) * 100}%`, padding: 3, cursor: isDrag ? "grabbing" : "grab", zIndex: isHero ? 2 : 1 }}>
              <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 6, overflow: "hidden", background: t.hue, outline: isHero ? `1.5px solid ${T.accent}88` : "1px solid rgba(255,255,255,.07)", boxShadow: isDrag ? "0 18px 40px rgba(0,0,0,.6)" : "none" }}>
                {/* fake app-window title strip */}
                <div style={{ height: 18, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", gap: 6, padding: "0 8px", fontSize: 10, color: "rgba(255,255,255,.7)", fontFamily: "'IBM Plex Mono', monospace" }}>
                  <span style={{ opacity: .9 }}>{t.glyph}</span><span>{t.name}</span>
                  {isHero && <span style={{ marginLeft: "auto", color: T.accent }}>HERO</span>}
                </div>
                {/* fake content: moving bars to read as 'video' */}
                <div style={{ position: "absolute", inset: "18px 0 0 0", background: `repeating-linear-gradient(115deg, rgba(255,255,255,.04) 0 14px, rgba(255,255,255,0) 14px 28px)` }} />
                <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: 11, color: "rgba(255,255,255,.55)" }}>{isHero ? "playing · 4K in Edge" : "tile · veil ready"}</div>
                {veiled && (
                  <div className="veil">
                    <div style={{ background: "rgba(0,0,0,.45)", borderRadius: 10, padding: "10px 16px", textAlign: "center", fontSize: r.w > 300 ? 13 : 10 }}>
                      <div style={{ color: T.accent, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>◑ Intermission</div>
                      <div style={{ color: "#ddd", marginTop: 2 }}>0:52 left</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {/* hero drag edge */}
        <div data-edge="1" onPointerDown={onEdgeDown} style={{ position: "absolute", left: `calc(${heroSize * 100}% - 7px)`, top: 0, width: 14, height: `${(target[hero].h / H) * 100}%`, cursor: "ew-resize", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30 }}>
          <div data-edge="1" style={{ width: 4, height: "22%", background: T.accent, borderRadius: 3, boxShadow: `0 0 10px ${T.accent}66` }} />
        </div>
      </div>

      {/* controls + brain log */}
      <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" style={{ borderColor: "#8A6524", color: T.accent }} onClick={fireAd}>{adBreak ? "Resume content" : "Fire ad break"}</button>
          {TILES.map((t) => <button key={t.id} className="btn" onClick={() => { setHero(t.id); say(`${t.name} promoted by click.`); }}>{t.name} → hero</button>)}
        </div>
        <div style={{ flex: "1 1 320px", background: T.panel, border: `1px solid ${T.edge}`, borderRadius: 8, padding: "8px 12px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: 1.6 }}>
          <div style={{ color: T.faint, letterSpacing: ".08em", marginBottom: 4 }}>LAYOUT BRAIN · intent = {`{hero:${hero}, heroSize:${heroSize.toFixed(2)}}`}</div>
          {log.map((l, i) => <div key={i} style={{ color: i === 0 ? T.ink : T.dim }}>› {l}</div>)}
        </div>
      </div>
    </div>
  );
}
