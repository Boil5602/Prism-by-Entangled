import { useState, useEffect, useRef } from "react";

/* ================================================================
   PRISM — Website mockup gallery (staged, screenshot-safe)
   Rules followed: no third-party content frames (abstract "playing"
   surfaces + CC-style placeholders), demo household ("the Parkers"),
   service names as wordmark chips only, no tokens/IPs/emails.
   ================================================================ */

const T = {
  wall: "#14171C", wallLight: "#2A2F38", panel: "#1E232B", edge: "#2C333E",
  ink: "#D7DCE3", dim: "#8A93A0", faint: "#5A6270", accent: "#F0A83C",
  // PRISM_BANDS — the brand's four bands: amber, teal, violet, rose. These are
  // the shipped values (packages/core/src/visualization.ts), used by every style
  // pack, the Veil and the wizard. This draft previously carried a palette of
  // its own (#E8654F red-orange, #F0A83C, #8FBF6B green, #5B9BD5 blue); the
  // maintainer REJECTED that as proposal P2 on 2026-09-03 — a marketing draft
  // does not move the brand's bands — and the mockup was redrawn instead
  // (docs/concept-scenes.md §2.5.4).
  beams: ["#F0A83C", "#5CC8C0", "#C86CF0", "#F05C7A"],
};

/* ---------- shared: a frame on a wall ---------- */
function Wall({ children, caption, tall }) {
  return (
    <section style={{ margin: "0 0 46px" }}>
      <div style={{
        borderRadius: 16, padding: "clamp(22px,4.5vw,52px)",
        background: `radial-gradient(ellipse 85% 65% at 50% 6%, ${T.wallLight} 0%, ${T.wall} 70%)`,
      }}>
        <div style={{ background: "#0A0C0F", borderRadius: 12, padding: 10, boxShadow: "0 26px 52px -20px rgba(0,0,0,.75), 0 2px 0 rgba(255,255,255,.04) inset", maxWidth: 880, margin: "0 auto" }}>
          <div style={{ position: "relative", width: "100%", aspectRatio: tall ? "9/14" : "16/9", background: "#0C0F14", borderRadius: 5, overflow: "hidden" }}>
            {children}
          </div>
        </div>
      </div>
      <p style={{ textAlign: "center", color: T.dim, fontSize: 13, margin: "12px auto 0", maxWidth: 620, lineHeight: 1.5 }}>{caption}</p>
    </section>
  );
}

const mono = { fontFamily: "'IBM Plex Mono', monospace" };
const grotesk = { fontFamily: "'Space Grotesk', sans-serif" };

/* ---------- fake playing video surface (no real content) ---------- */
function Playing({ label, hue = "#22304a", playing = true }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(140deg, ${hue} 0%, #101623 100%)`, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(112deg, rgba(255,255,255,.045) 0 16px, transparent 16px 34px)" }} />
      <div style={{ position: "absolute", left: "8%", bottom: "16%", width: "40%", height: 5, borderRadius: 3, background: "rgba(255,255,255,.25)" }}>
        <div style={{ width: "62%", height: "100%", borderRadius: 3, background: "rgba(255,255,255,.75)" }} />
      </div>
      <div style={{ position: "absolute", left: "8%", bottom: "9%", color: "rgba(255,255,255,.66)", fontSize: 10, ...mono }}>
        {playing ? "▶" : "⏸"} {label}
      </div>
    </div>
  );
}

/* ---------- tiny facet cards ---------- */
function CalendarFacet() {
  const ev = [
    ["8:00", "Bus — Maya & Leo", "#8FBF6B"],
    ["9:30", "Sam · design review", "#5B9BD5"],
    ["12:00", "Alex · client lunch", "#E8654F"],
    ["3:45", "Maya — soccer practice", "#8FBF6B"],
    ["6:30", "Family dinner 🍝", "#F0A83C"],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: "#151A22", padding: "7% 8%", display: "flex", flexDirection: "column" }}>
      <div style={{ color: T.ink, fontSize: 12, fontWeight: 600, ...grotesk }}>Today · The Parkers</div>
      <div style={{ color: T.faint, fontSize: 8.5, marginBottom: 8, ...mono }}>MERGE · family + 2 work calendars</div>
      {ev.map(([t, l, c]) => (
        <div key={t} style={{ display: "flex", gap: 7, alignItems: "center", padding: "4.5% 0", borderBottom: "1px solid #202734" }}>
          <span style={{ color: T.faint, fontSize: 8.5, width: 30, ...mono }}>{t}</span>
          <span style={{ width: 3, height: 12, borderRadius: 2, background: c }} />
          <span style={{ color: T.ink, fontSize: 9.5, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{l}</span>
        </div>
      ))}
    </div>
  );
}

function WeatherFacet() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#1B2836 0%,#141A24 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
      <div style={{ fontSize: 22 }}>⛅</div>
      <div style={{ color: T.ink, fontSize: 20, fontWeight: 600, ...grotesk }}>72°</div>
      <div style={{ color: T.dim, fontSize: 9 }}>Partly sunny · H 78° L 61°</div>
      <div style={{ color: T.faint, fontSize: 7.5, ...mono }}>rain 6pm · grab a jacket, Maya</div>
    </div>
  );
}

function Ticker() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#10141B", display: "flex", alignItems: "center", gap: 18, padding: "0 14px", overflow: "hidden" }}>
      <span style={{ color: T.accent, fontSize: 8, letterSpacing: ".1em", flexShrink: 0, ...mono }}>NEWS</span>
      {["Wire desk: markets steady ahead of jobs report", "City council approves riverfront trail extension", "Voyager data yields new heliosphere findings"].map((h) => (
        <span key={h} style={{ color: T.dim, fontSize: 9.5, whiteSpace: "nowrap" }}>{h}<span style={{ color: T.faint, margin: "0 0 0 18px" }}>·</span></span>
      ))}
    </div>
  );
}

function Chip({ children, active }) {
  return <span style={{ background: active ? "#2E4A32" : "#1A202B", border: `1px solid ${active ? "#4C7A5E" : T.edge}`, color: active ? "#AFE0B4" : T.dim, borderRadius: 20, padding: "3px 9px", fontSize: 8.5, ...mono }}>{children}</span>;
}

/* ---------- Mock 1: Kitchen Command ---------- */
function Kitchen({ veiled }) {
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: "66.5%", height: "82%", padding: 3 }}>
        <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 5, overflow: "hidden", outline: `1.5px solid ${T.accent}55` }}>
          {veiled ? (
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 28% 72%, #7a6a45 0%, #4a4a62 42%, #15192a 100%)" }}>
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 70% 30%, rgba(240,168,60,.18), transparent 55%)" }} />
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", background: "rgba(10,12,16,.55)", backdropFilter: "blur(2px)", borderRadius: 11, padding: "12px 20px", textAlign: "center" }}>
                <div style={{ color: T.accent, fontSize: 13, fontWeight: 600, ...grotesk }}>◑ Intermission</div>
                <div style={{ color: "#cfd4db", fontSize: 10, margin: "3px 0" }}>Your show will be paused after the break</div>
                <div style={{ color: T.ink, fontSize: 12, ...mono }}>0:52 left</div>
              </div>
              <div style={{ position: "absolute", right: 10, bottom: 8, color: "rgba(255,255,255,.45)", fontSize: 7.5, ...mono }}>The Rocky Mountains, Lander's Peak · Albert Bierstadt · The Metropolitan Museum of Art, Open Access (CC0 1.0) · Public domain (CC0 1.0)</div>
            </div>
          ) : (
            <Playing label="Open movie night · Big Buck Bunny (CC-BY)" hue="#2a3a2e" />
          )}
        </div>
      </div>
      <div style={{ position: "absolute", left: "66.5%", top: 0, width: "33.5%", height: "82%", padding: 3 }}>
        <div style={{ position: "relative", width: "100%", height: "58%", borderRadius: 5, overflow: "hidden" }}><CalendarFacet /></div>
        <div style={{ position: "relative", width: "100%", height: "42%", borderRadius: 5, overflow: "hidden", marginTop: 3 }}><WeatherFacet /></div>
      </div>
      <div style={{ position: "absolute", left: 0, top: "82%", width: "100%", height: "18%", padding: 3 }}>
        <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 5, overflow: "hidden" }}><Ticker /></div>
      </div>
      <div style={{ position: "absolute", right: 12, bottom: "20%", background: "rgba(20,23,28,.6)", border: `1px solid ${T.edge}`, borderRadius: 20, padding: "3px 10px", color: T.dim, fontSize: 8.5, ...mono }}>Prism</div>
    </>
  );
}

/* ---------- Mock 3: Sports multiview ---------- */
function Sports() {
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: "66.5%", height: "84%", padding: 3 }}>
        <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 5, overflow: "hidden", outline: `1.5px solid ${T.accent}55` }}>
          <Playing label="Game 1 · LIVE · audio: room + 1 phone" hue="#233047" />
          <span style={{ position: "absolute", right: 8, top: 8 }}><Chip active>♪ room</Chip></span>
        </div>
      </div>
      <div style={{ position: "absolute", left: "66.5%", top: 0, width: "33.5%", height: "84%", padding: 3, display: "flex", flexDirection: "column", gap: 3 }}>
        {[["Game 2 · preview · 0:12 ago", false], ["Game 3 · preview · 0:28 ago", false]].map(([l, live], i) => (
          <div key={i} style={{ position: "relative", flex: 1, borderRadius: 5, overflow: "hidden" }}>
            <Playing label={l} hue={i ? "#3a2f28" : "#2c2440"} playing={!!live} />
            <span style={{ position: "absolute", right: 6, top: 6 }}><Chip>still</Chip></span>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 0, top: "84%", width: "100%", height: "16%", padding: 3 }}>
        <div style={{ position: "absolute", inset: 3, background: "#10141B", borderRadius: 5, display: "flex", alignItems: "center", gap: 14, padding: "0 14px" }}>
          <span style={{ color: T.accent, fontSize: 8, ...mono }}>SCORES</span>
          {["HOME 21 — 17 AWAY · Q3", "EAST 3 — 2 WEST · P2", "BLUE 88 — 84 RED · 4Q 5:12"].map((s) => (
            <span key={s} style={{ color: T.dim, fontSize: 9.5, ...mono }}>{s}</span>
          ))}
        </div>
      </div>
      {/* §14 chips. Every private listener hears the SAME slot: §14 streams the
          frame's own audio (one capture of system output), so both phones are on
          the audio owner. Two phones on two different games would need
          per-surface capture (B-25) and a §14 amendment — maintainer's decision
          of 2026-09-03 was to draw what §14 supports (concept-scenes §2.2). */}
      <div style={{ position: "absolute", left: 12, bottom: "20%", display: "flex", gap: 6 }}>
        <Chip active>♪ Alex's phone ▸ Game 1</Chip><Chip>♪ Sam's phone ▸ Game 1 (paused)</Chip>
      </div>
    </>
  );
}

/* ---------- Mock 4: visualizer ---------- */
function Visualizer() {
  const bars = 42;
  const [t, setT] = useState(0);
  const raf = useRef();
  useEffect(() => {
    const loop = () => { setT((x) => x + 0.045); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);
  return (
    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 40%, #2a2438 0%, #0d0f16 70%)" }}>
      {/* art backdrop */}
      <div style={{ position: "absolute", inset: "-10%", background: "conic-gradient(from 200deg at 60% 40%, #4a3358, #2c4a58, #58402c, #4a3358)", filter: "blur(38px) brightness(.55)", opacity: .8 }} />
      {/* prism + beams */}
      <div style={{ position: "absolute", left: "50%", top: "44%", transform: "translate(-50%,-50%) rotate(0deg)" }}>
        <div style={{ width: 0, height: 0, borderLeft: "26px solid transparent", borderRight: "26px solid transparent", borderBottom: "44px solid rgba(215,220,227,.85)", filter: "drop-shadow(0 0 14px rgba(255,255,255,.35))" }} />
      </div>
      <svg viewBox="0 0 800 450" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <line x1="0" y1="196" x2="374" y2="196" stroke="rgba(255,255,255,.5)" strokeWidth="2.5" />
        {T.beams.map((c, i) => {
          const spread = (i - 1.5) * (10 + 6 * Math.abs(Math.sin(t * 0.9 + i)));
          return <line key={c} x1="418" y1="200" x2="800" y2={200 + spread * 3.2} stroke={c} strokeWidth={3 + 1.6 * Math.abs(Math.sin(t + i))} opacity="0.85" />;
        })}
        {Array.from({ length: bars }).map((_, i) => {
          const h = 14 + 46 * Math.abs(Math.sin(t * 1.15 + i * 0.48)) * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.9)));
          return <rect key={i} x={90 + i * 15} y={400 - h} width={7} height={h} rx={3} fill={T.beams[i % 4]} opacity="0.5" />;
        })}
      </svg>
      <div style={{ position: "absolute", left: 20, bottom: 16 }}>
        <div style={{ color: T.ink, fontSize: 13, fontWeight: 600, ...grotesk }}>Aurora Skies</div>
        <div style={{ color: T.dim, fontSize: 10 }}>The Refractions · <span style={mono}>hidden facet · ♪ exclusive</span></div>
      </div>
      <div style={{ position: "absolute", right: 16, bottom: 16, display: "flex", gap: 10, color: T.dim, fontSize: 13 }}>
        <span>⏮</span><span style={{ color: T.ink }}>⏸</span><span>⏭</span>
      </div>
      <div style={{ position: "absolute", right: 16, top: 12, color: T.faint, fontSize: 8, ...mono }}>PRISM BEAMS · backdrop: album art</div>
    </div>
  );
}

/* ---------- Mock 5: popup control center ---------- */
function ControlCenter() {
  const rows = [
    ["trk-adserve-example.net", 14, "EasyList · $popup"],
    ["win-a-prize-example.com", 6, "click-consistency"],
    ["video-plyr-popcdn-example.io", 3, "EasyList · $popup"],
    ["checkout.stripe.com", 1, "allowed · payment"],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(150deg,#1a2030 0%, #12151d 100%)" }}>
      <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, rgba(255,255,255,.02) 0 2px, transparent 2px 26px)" }} />
      <div style={{ position: "absolute", right: 22, bottom: 52, width: 300, background: "rgba(23,27,34,.97)", border: `1px solid ${T.edge}`, borderRadius: 12, padding: 14, boxShadow: "0 18px 40px rgba(0,0,0,.55)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <span style={{ color: T.ink, fontSize: 12, fontWeight: 600, ...grotesk }}>Popup Control Center</span>
          <span style={{ color: T.faint, fontSize: 8.5, marginLeft: "auto", ...mono }}>this site · 24 intercepted</span>
        </div>
        {rows.map(([d, n, why]) => (
          <div key={d} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #232a36" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: T.ink, fontSize: 10, ...mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d}</div>
              <div style={{ color: T.faint, fontSize: 8 }}>{why}</div>
            </div>
            <span style={{ color: T.dim, fontSize: 9, ...mono }}>×{n}</span>
            <button style={{ background: "none", border: `1px solid ${T.edge}`, color: T.dim, borderRadius: 5, fontSize: 8.5, padding: "2px 7px" }}>Open</button>
            <button style={{ background: "none", border: `1px solid #8A6524`, color: T.accent, borderRadius: 5, fontSize: 8.5, padding: "2px 7px" }}>Always allow</button>
          </div>
        ))}
        <div style={{ color: T.faint, fontSize: 8, marginTop: 8, ...mono }}>4h 12m reclaimed this month · everything stays on this device</div>
      </div>
      <div style={{ position: "absolute", right: 22, bottom: 14, background: "rgba(20,23,28,.75)", border: `1px solid ${T.edge}`, borderRadius: 20, padding: "4px 12px", color: T.ink, fontSize: 9.5, ...mono }}>Prism · 3 popups blocked</div>
    </div>
  );
}

/* ---------- Mock 6: portrait family hub ---------- */
function Portrait() {
  return (
    <>
      <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "46%", padding: 3 }}>
        <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 5, overflow: "hidden" }}><CalendarFacet /></div>
      </div>
      <div style={{ position: "absolute", left: 0, top: "46%", width: "100%", height: "30%", padding: 3 }}>
        <div style={{ position: "absolute", inset: 3, borderRadius: 5, overflow: "hidden", background: "linear-gradient(150deg,#3d4a3a 0%, #22301f 60%, #131a12 100%)" }}>
          <div style={{ position: "absolute", left: 10, bottom: 8, color: "rgba(255,255,255,.7)", fontSize: 8.5, ...mono }}>Shared album · Lake weekend (demo)</div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, top: "76%", width: "50%", height: "24%", padding: 3 }}>
        <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 5, overflow: "hidden" }}><WeatherFacet /></div>
      </div>
      <div style={{ position: "absolute", left: "50%", top: "76%", width: "50%", height: "24%", padding: 3 }}>
        <div style={{ position: "absolute", inset: 3, background: "#151A22", borderRadius: 5, padding: "8% 10%" }}>
          <div style={{ color: T.ink, fontSize: 10, fontWeight: 600, ...grotesk, marginBottom: 5 }}>Chores</div>
          {["✓ Feed Biscuit — Leo", "○ Trash out — Maya", "○ Water plants — Sam"].map((c) => (
            <div key={c} style={{ color: c.startsWith("✓") ? T.faint : T.dim, fontSize: 8.5, padding: "2.5px 0" }}>{c}</div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------- page ---------- */
export default function Mockups() {
  return (
    <div style={{ minHeight: "100vh", background: "#0E1014", color: T.ink, fontFamily: "'IBM Plex Sans', sans-serif", padding: "36px 20px 60px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono&display=swap');`}</style>
      <header style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ color: T.accent, fontSize: 11, letterSpacing: ".1em", ...mono }}>PRISM · WEBSITE MOCKUPS · STAGED CONTENT ONLY</div>
        <h1 style={{ ...grotesk, fontSize: "clamp(24px,4vw,34px)", fontWeight: 700, margin: "8px 0 4px" }}>Six shots for the site</h1>
        <p style={{ color: T.dim, fontSize: 13, maxWidth: 560, margin: "0 auto", lineHeight: 1.5 }}>Demo household ("the Parkers"), open-licensed media labels, no real service frames, no tokens. Each is a composition reference for the real screenshots.</p>
      </header>

      <Wall caption="1 · Kitchen Command — the archetype: video hero, Merge family + work calendars, weather, derived-shelf news ticker. The quiet Prism pill sits bottom-right."><Kitchen veiled={false} /></Wall>
      <Wall caption="2 · The moment that sells everything: the ad break becomes a Bierstadt. Intermission card with pause-after-break, and the full §3.2 attribution in the corner — title · creator · credit · licence, never the credit alone unless the card is minimised."><Kitchen veiled={true} /></Wall>
      <Wall caption="3 · Sports Multiview — a main game with two beside it, both advancing as living previews. The scoreboard strip below; §14 listener chips bottom-left, both phones on the game that owns the sound (one capture of the wall's audio, not a per-slot feed)."><Sports /></Wall>
      <Wall caption="4 · Prism Beams — the signature visualizer over an album-art backdrop, fed by a hidden music facet. The logo is the feature."><Visualizer /></Wall>
      <Wall caption="5 · Popup Control Center — the transparency receipt: every intercepted popup named, attributed to the rule that caught it, one tap to open or always-allow. Time-reclaimed ledger underneath."><ControlCenter /></Wall>
      <Wall tall caption="6 · Family Hub, portrait — the solver's range: Merge week, shared album, weather-to-wear, chores. Proof the frame isn't TV-shaped."><Portrait /></Wall>

      <footer style={{ textAlign: "center", color: T.faint, fontSize: 11, marginTop: 8, ...mono }}>
        compositions reference · rebuild each with the real app + the staged demo household for final assets
      </footer>
    </div>
  );
}
