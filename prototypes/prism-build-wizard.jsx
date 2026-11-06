import { useState, useRef, useEffect, useMemo } from "react";

/* ================================================================
   PRISM — Build Wizard (Entangled)
   Four decision axes = four dimensions. Each answer applies a real
   4D rotation to the tesseract; the projection settles as the
   recommendation resolves.
   ================================================================ */

const T = {
  wall: "#14171C", wallLight: "#262C36", panel: "#1E232B", panelEdge: "#2C333E",
  ink: "#D7DCE3", inkDim: "#8A93A0", inkFaint: "#5A6270",
  accent: "#F0A83C",
  beam: ["#E8654F", "#F0A83C", "#8FBF6B", "#5B9BD5"], // prism split
};

/* ---------- the four axes ---------- */
const AXES = [
  {
    id: "place", dim: "X", title: "Where will it live?",
    options: [
      { id: "counter", label: "Kitchen counter / shelf", v: 0.0 },
      { id: "wall", label: "On the wall, like a picture", v: 0.35 },
      { id: "tv", label: "The living-room TV", v: 0.7 },
      { id: "anywhere", label: "Big screen, my choice", v: 1.0 },
    ],
  },
  {
    id: "budget", dim: "Y", title: "Budget comfort?",
    options: [
      { id: "b0", label: "Under $50 — use what I own", v: 0.0 },
      { id: "b1", label: "Around $150", v: 0.4 },
      { id: "b2", label: "$200–300, done right", v: 0.75 },
      { id: "b3", label: "Whatever it takes", v: 1.0 },
    ],
  },
  {
    id: "effort", dim: "Z", title: "How much do you want to build?",
    options: [
      { id: "none", label: "30 minutes, zero tools", v: 0.0 },
      { id: "evening", label: "One fun evening", v: 0.4 },
      { id: "weekend", label: "A proper weekend project", v: 0.75 },
      { id: "hacker", label: "I flash SD cards for fun", v: 1.0 },
    ],
  },
  {
    id: "control", dim: "W", title: "Control philosophy?",
    options: [
      { id: "easy", label: "Simplest thing that works", v: 0.0 },
      { id: "private", label: "Private, but pragmatic", v: 0.5 },
      { id: "sovereign", label: "No Google. Auditable. Mine.", v: 1.0 },
    ],
  },
];

/* ---------- builds ---------- */
const BUILDS = [
  {
    id: 1, name: "Tablet Base", cost: "~$130", time: "30 min · zero tools",
    tag: "The everyone build",
    feats: ["14″ touchscreen dashboard", "YouTube, radio, Merge, photos", "Phone remote via QR", "Bluetooth speaker pairing"],
    limits: ["720p cap on DRM video", "Counter/shelf placement"],
  },
  {
    id: 2, name: "Tablet Pro", cost: "~$220–240", time: "one evening",
    tag: "The Skylight killer",
    feats: ["Everything in Base", "Wall-mounted wood frame, hidden cable", "8BitDo physical remote", "Wired soundbar audio"],
    limits: ["720p cap on DRM video", "14–15″ screen class"],
  },
  {
    id: 3, name: "Pi Frame", cost: "~$160–300", time: "a weekend",
    tag: "The open appliance",
    feats: ["Flash PrismOS, boot to dashboard", "Any screen — portrait walls included", "PIR motion wake, CEC power", "Zero Google, fully auditable", "Strongest content blocking"],
    limits: ["720p DRM · 1 video tile + 4–5 light tiles", "Touch costs extra — phone-first control"],
  },
  {
    id: 4, name: "TV Build", cost: "$20–150", time: "none – one evening",
    tag: "The living room",
    feats: ["Your TV becomes the frame", "Launch tiles → native Netflix at full 4K", "TV remote drives it via CEC", "10-foot interface"],
    limits: ["No touch (by design)", "Home-button behavior varies by device"],
  },
  {
    id: 5, name: "The Videophile", cost: "~$150–200", time: "a weekend · Windows recipe",
    tag: "Community-supported · the only 4K-in-a-tile build",
    feats: ["4K premium streaming inside grid tiles (Edge + hardware DRM)", "16GB mini PC — zero tile limits", "Full private listening capture", "Any display, any size"],
    limits: ["Community-maintained recipe, not core", "Windows kiosk quirks are yours", "Not the privacy-max build"],
  },
];

/* ---------- parts sourcing ----------
   Listings churn; criteria don't. Each part teaches what to look
   for, offers a live example, and can be marked "already have". */
const PARTS = {
  1: [
    { id: "tablet", name: "14″ Android tablet", lo: 110, hi: 160, canOwn: true,
      criteria: "1920×1200 IPS · Android 13+ · 8GB+ RAM · stand case & USB-C charger included · brand is interchangeable, specs aren't",
      localTip: "Micro Center / used marketplaces often beat online pricing on open-box tablets",
      links: [
        { label: "Example listing", url: "https://www.amazon.com/Android-Widevine-10000mAh-Charging-Bluetooth/dp/B0F43F4VXZ" },
        { label: "Browse category", url: "https://www.amazon.com/14-inch-tablet-android/s?k=14+inch+tablet+android" },
      ] },
    { id: "speaker", name: "Bluetooth speaker (optional)", lo: 0, hi: 40, canOwn: true, optional: true,
      criteria: "Any BT speaker you like — pairs in settings, no wiring",
      localTip: "Thrift stores are full of great speakers",
      links: [{ label: "Search", url: "https://www.amazon.com/s?k=bluetooth+speaker" }] },
  ],
  2: [
    { id: "tablet", name: "14″ Android tablet", lo: 110, hi: 160, canOwn: true,
      criteria: "1920×1200 IPS · Android 13+ · 8GB+ RAM · case & charger included",
      localTip: "Micro Center / used marketplaces often beat online on open-box tablets",
      links: [
        { label: "Example listing", url: "https://www.amazon.com/Android-Widevine-10000mAh-Charging-Bluetooth/dp/B0F43F4VXZ" },
        { label: "Browse category", url: "https://www.amazon.com/14-inch-tablet-android/s?k=14+inch+tablet+android" },
      ] },
    { id: "remote", name: "8BitDo Micro remote", lo: 15, hi: 25, canOwn: false,
      criteria: "Keyboard mode is the feature — 16 mappable buttons, rechargeable · often $15–20 on sale",
      links: [
        { label: "Amazon", url: "https://www.amazon.com/8Bitdo-Micro-Bluetooth-Pocket-sized-Controller-Switch-Raspberry-Nintendo/dp/B0CDG2HKBF" },
        { label: "Official shop", url: "https://shop.8bitdo.com/products/8bitdo-micro-bluetooth-gamepad" },
      ] },
    { id: "audio", name: "Wired soundbar / speakers", lo: 30, hi: 50, canOwn: true,
      criteria: "Powered, with 3.5mm aux in — wired beats Bluetooth for video sync",
      localTip: "Thrift stores and pawn shops: quality powered speakers for a few dollars",
      links: [{ label: "Search", url: "https://www.amazon.com/s?k=small+powered+soundbar+aux+input" }] },
    { id: "frame", name: "Frame + keyhole hanger", lo: 15, hi: 30, canOwn: false,
      criteria: "Deep shadow box sized to your tablet, or rout your own · craft stores work",
      localTip: "Local craft store, Habitat ReStore, or a frame shop — or your makerspace's laser cutter with the community templates",
      links: [{ label: "Search", url: "https://www.amazon.com/s?k=shadow+box+frame+deep" }] },
    { id: "cable", name: "In-wall cable kit", lo: 12, hi: 18, canOwn: false,
      criteria: "Code-compliant low-voltage kit — the difference between gadget and furniture",
      localTip: "Any hardware store carries these",
      links: [{ label: "Search", url: "https://www.amazon.com/s?k=in+wall+cable+management+kit+tv" }] },
  ],
  3: [
    { id: "pi", name: "Raspberry Pi 5 (8GB) + PSU + SD", lo: 95, hi: 115, canOwn: true,
      criteria: "8GB model · official 27W PSU · A2-class SD card — or swap the whole line for a used x86 mini PC",
      localTip: "Micro Center stocks Pi 5s in-store; local e-waste refurbishers sell tested mini PCs",
      links: [
        { label: "The Pi Hut", url: "https://thepihut.com" },
        { label: "x86 alternative (eBay)", url: "https://www.ebay.com/sch/i.html?_nkw=dell+optiplex+micro" },
      ] },
    { id: "display", name: "Display", lo: 30, hi: 150, canOwn: true,
      criteria: "IPS panel for viewing angles · any size, portrait welcome · used monitors are the value play · touch optional (+$110)",
      localTip: "The best local part: Craigslist/FB Marketplace/Buy Nothing monitors for $20–40, and every one is e-waste diverted",
      links: [{ label: "Used market (eBay)", url: "https://www.ebay.com/sch/i.html?_nkw=ips+monitor+used" }] },
    { id: "pir", name: "PIR motion sensor", lo: 3, hi: 6, canOwn: false, optional: true,
      criteria: "HC-SR501 on GPIO — wakes the frame when someone walks in",
      links: [{ label: "Search", url: "https://www.amazon.com/s?k=HC-SR501+PIR+motion+sensor" }] },
    { id: "remote", name: "8BitDo Micro (optional — phone works)", lo: 0, hi: 25, canOwn: true, optional: true,
      criteria: "Phone-as-remote is built in; add this for couch buttons",
      links: [{ label: "Amazon", url: "https://www.amazon.com/8Bitdo-Micro-Bluetooth-Pocket-sized-Controller-Switch-Raspberry-Nintendo/dp/B0CDG2HKBF" }] },
    { id: "mount", name: "Frame / mount materials", lo: 20, hi: 40, canOwn: false,
      criteria: "VESA-to-wall or custom wood frame — the community gallery has templates",
      localTip: "Lumber offcuts + a makerspace or a woodworking friend — the most personal part of the build",
      links: [] },
  ],
  4: [
    { id: "box", name: "Android TV box", lo: 20, hi: 150, canOwn: true,
      criteria: "onn 4K class ($20–30) runs it fine · Nvidia Shield (~$150) adds certified 4K/Dolby Vision in launched apps",
      links: [
        { label: "Walmart (onn)", url: "https://www.walmart.com/search?q=onn+google+tv+4k+streaming+box" },
        { label: "Amazon (Shield)", url: "https://www.amazon.com/s?k=nvidia+shield+tv" },
      ] },
    { id: "tv", name: "A TV with HDMI-CEC", lo: 0, hi: 0, canOwn: true, own: true,
      criteria: "You almost certainly own this — CEC ships on everything from the last decade",
      links: [] },
  ],
  5: [
    { id: "pc", name: "Used x86 mini PC (16GB, 8th-gen Intel+)", lo: 120, hi: 180, canOwn: true,
      criteria: "16GB RAM · 8th-gen Intel or newer iGPU for 4K decode · Dell/Lenovo/HP micro form factor · Windows license usually included",
      localTip: "Local IT refurbishers and university surplus sales are gold for off-lease mini PCs",
      links: [{ label: "eBay search", url: "https://www.ebay.com/sch/i.html?_nkw=dell+optiplex+micro+i5" }] },
    { id: "display", name: "4K display or TV", lo: 0, hi: 250, canOwn: true,
      criteria: "The point of this build — use the 4K panel you have, or any HDMI display",
      links: [] },
    { id: "remote", name: "8BitDo Micro / phone remote", lo: 0, hi: 25, canOwn: true, optional: true,
      criteria: "Phone remote is built in; Micro adds physical buttons",
      links: [{ label: "Amazon", url: "https://www.amazon.com/8Bitdo-Micro-Bluetooth-Pocket-sized-Controller-Switch-Raspberry-Nintendo/dp/B0CDG2HKBF" }] },
  ],
};

/* ---------- guided walkthrough ----------
   From parts-in-hand to dashboard-on-wall. Steps are per build. */
const GUIDE = {
  1: [
    { phase: "Set up", steps: [
      "Unbox the tablet, run Android setup on your WiFi, install all pending updates",
      "Install the Prism shell APK from the site (one QR scan)",
      "Prism asks to become the device owner — approve it; the tablet is now an appliance and Android disappears",
    ]},
    { phase: "Make it yours", steps: [
      "Scan the pairing QR with your phone — the remote installs to your home screen",
      "Pick a starter dashboard (Kitchen, Family Center) or open the editor and drag your own",
      "Pair a Bluetooth speaker in Prism's settings if you want bigger sound",
      "Set the sleep schedule and motion wake — done",
    ]},
  ],
  2: [
    { phase: "Software first", steps: [
      "Complete the Tablet Base setup above before any woodwork — verify everything works on the counter",
    ]},
    { phase: "Frame it", steps: [
      "Fit the tablet in the shadow box; mark and cut the USB-C pass-through",
      "Mount the keyhole hanger; find a stud or use a proper anchor",
      "Install the in-wall cable kit and drop the power cable through",
      "Hang it, level it, step back and admire",
    ]},
    { phase: "Finish", steps: [
      "Pair the 8BitDo Micro: hold its pairing combo, then Prism → Add remote → tap it in the list",
      "Wire the soundbar to the 3.5mm/USB-C out and set it as the audio output",
      "Nudge tile zoom levels for wall-viewing distance in the editor",
    ]},
  ],
  3: [
    { phase: "Flash", steps: [
      "Download PrismOS, flash the SD with Raspberry Pi Imager (WiFi credentials go in the flasher)",
      "Connect display and power — it boots straight to the pairing screen in about 30 seconds",
    ]},
    { phase: "Pair & shape", steps: [
      "Scan the QR with your phone — the remote is your control surface from here on",
      "Pick or design a dashboard in the editor; portrait layouts auto-solve if your display is rotated",
      "Sign tiles into their accounts from the phone (isolated per tile — two people, two logins, no conflict)",
    ]},
    { phase: "Make it an appliance", steps: [
      "Wire the PIR sensor to GPIO and flip motion wake on",
      "Set CEC display power + sleep schedule so the screen sleeps and wakes itself",
      "Mount it — VESA bracket or the community frame templates — and hide the cable",
    ]},
  ],
  4: [
    { phase: "Set up the box", steps: [
      "Plug the Android TV box into HDMI, complete Google TV setup on WiFi",
      "Sideload the Prism shell (the site walks you through the one-time developer toggle)",
      "Optionally set Prism as the home launcher — or just know that Back always returns to it",
    ]},
    { phase: "Make it yours", steps: [
      "Scan the pairing QR with your phone; do all editing from the phone or web editor",
      "Add launch tiles for your streaming apps — they open natively at full quality",
      "Confirm CEC works: frame sleep should put the TV on standby",
      "Map your TV remote's keys the way you want them",
    ]},
  ],
  5: [
    { phase: "Prep the machine", steps: [
      "Fresh Windows 11 install or debloat the used machine; all updates, then pause them",
      "Follow the repo's kiosk recipe: auto-login, Edge kiosk launch, update suppression, sleep settings",
      "Verify hardware DRM: the repo's check page confirms PlayReady + 4K decode on your GPU/display chain",
    ]},
    { phase: "Prism", steps: [
      "Install the Windows shell recipe (community-maintained) — same dashboards, same editor",
      "Scan the pairing QR; sign streaming tiles into their accounts and confirm full-resolution playback in a tile",
      "Set schedules, pair remotes, mount it — you're running the only 4K-in-a-tile build in the lineup",
    ]},
  ],
};

function recommend(ans) {
  if (!ans.place) return null;
  const p = ans.place, e = ans.effort?.id, c = ans.control?.id, b = ans.budget?.id;
  // Videophile: big-screen ambition + max budget + real effort appetite, but not the sovereignty path
  if ((p.id === "anywhere" || p.id === "tv") && b === "b3" && (e === "weekend" || e === "hacker") && c !== "sovereign") return 5;
  if (p.id === "tv") return c === "sovereign" ? 3 : 4;
  if (c === "sovereign" || e === "hacker" || p.id === "anywhere") return 3;
  if (p.id === "wall" || e === "weekend" || e === "evening" || b === "b2" || b === "b3") return 2;
  return 1;
}

/* ---------- 4D tesseract math ---------- */
function makeVerts() {
  const v = [];
  for (let i = 0; i < 16; i++)
    v.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
  return v;
}
function makeEdges(verts) {
  const e = [];
  for (let i = 0; i < 16; i++)
    for (let j = i + 1; j < 16; j++) {
      let d = 0;
      for (let k = 0; k < 4; k++) if (verts[i][k] !== verts[j][k]) d++;
      if (d === 1) e.push([i, j]);
    }
  return e;
}
const VERTS = makeVerts();
const EDGES = makeEdges(VERTS);

function rot(v, a, b, th) {
  const c = Math.cos(th), s = Math.sin(th), out = v.slice();
  out[a] = v[a] * c - v[b] * s;
  out[b] = v[a] * s + v[b] * c;
  return out;
}

export default function PrismWizard() {
  const [step, setStep] = useState(-1); // -1 = intro
  const [answers, setAnswers] = useState({});
  const [pulse, setPulse] = useState(0); // transition burst
  const [sourcing, setSourcing] = useState(false);
  const [owned, setOwned] = useState({});       // partId -> already have it
  const [acquired, setAcquired] = useState({}); // partId -> checked off
  const [copiedList, setCopiedList] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const [doneSteps, setDoneSteps] = useState({});
  const canvasRef = useRef(null);
  const stateRef = useRef({ answers: {}, pulse: 0, t: 0, reduced: false });

  const rec = useMemo(() => recommend(answers), [answers]);
  const done = step >= AXES.length;
  const build = done && rec ? BUILDS.find((b) => b.id === rec) : null;

  stateRef.current.answers = answers;

  useEffect(() => {
    stateRef.current.reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  /* pulse decays */
  useEffect(() => {
    if (pulse <= 0) return;
    stateRef.current.pulse = pulse;
    const id = setInterval(
      () => setPulse((p) => (p <= 0.02 ? 0 : p * 0.9)),
      40
    );
    return () => clearInterval(id);
  }, [pulse]);

  /* render loop */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    let raf;

    const draw = () => {
      const S = stateRef.current;
      S.t += S.reduced ? 0.0015 : 0.006 + S.pulse * 0.05;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const a = S.answers;
      const ax = (a.place?.v ?? 0.5) * 1.2;
      const ay = (a.budget?.v ?? 0.5) * 1.2;
      const az = (a.effort?.v ?? 0.5) * 1.2;
      const aw = (a.control?.v ?? 0.5) * 1.4;
      const t = S.t;

      const pts = VERTS.map((v0) => {
        let v = v0;
        v = rot(v, 0, 3, t * 0.9 + ax);        // XW — place
        v = rot(v, 1, 3, t * 0.6 + ay);        // YW — budget
        v = rot(v, 2, 3, t * 0.45 + az);       // ZW — effort
        v = rot(v, 0, 1, t * 0.3 + aw * 2.0);  // XY — control tint
        // 4D -> 3D
        const dw = 2.6;
        const k3 = dw / (dw - v[3]);
        const x3 = v[0] * k3, y3 = v[1] * k3, z3 = v[2] * k3;
        // 3D -> 2D
        const d3 = 4.2;
        const k2 = d3 / (d3 - z3);
        return { x: x3 * k2, y: y3 * k2, depth: (k3 + k2) / 2, wc: v[3] };
      });

      const sc = Math.min(w, h) * 0.22;
      const cx = w / 2, cy = h / 2;

      // edges — colored by W coordinate (the prism split)
      for (const [i, j] of EDGES) {
        const p1 = pts[i], p2 = pts[j];
        const wAvg = (p1.wc + p2.wc) / 2;
        const band = Math.min(3, Math.max(0, Math.floor((wAvg + 1.4) / 0.7)));
        const depth = (p1.depth + p2.depth) / 2;
        ctx.strokeStyle = T.beam[band];
        ctx.globalAlpha = 0.18 + Math.max(0, Math.min(0.55, (depth - 0.8) * 0.5)) + S.pulse * 0.3;
        ctx.lineWidth = 1 + depth * 0.6;
        ctx.beginPath();
        ctx.moveTo(cx + p1.x * sc, cy + p1.y * sc);
        ctx.lineTo(cx + p2.x * sc, cy + p2.y * sc);
        ctx.stroke();
      }
      // vertices
      for (const p of pts) {
        ctx.globalAlpha = 0.5 + S.pulse * 0.4;
        ctx.fillStyle = T.accent;
        ctx.beginPath();
        ctx.arc(cx + p.x * sc, cy + p.y * sc, 1.4 + p.depth, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const choose = (axis, opt) => {
    setAnswers((p) => ({ ...p, [axis.id]: opt }));
    setPulse(1);
    setTimeout(() => setStep((s) => s + 1), 380);
  };
  const restart = () => { setAnswers({}); setStep(-1); setPulse(1); setSourcing(false); setOwned({}); setAcquired({}); setGuiding(false); setDoneSteps({}); };

  const guide = build ? GUIDE[build.id] : [];
  const allSteps = guide.flatMap((g, gi) => g.steps.map((s, si) => `${gi}-${si}`));
  const doneCount = allSteps.filter((k) => doneSteps[k]).length;
  const buildComplete = allSteps.length > 0 && doneCount === allSteps.length;

  const parts = build ? PARTS[build.id] : [];
  const isOwned = (p) => p.own || owned[p.id];
  const total = parts.reduce(
    (acc, p) => isOwned(p) ? acc : { lo: acc.lo + p.lo, hi: acc.hi + p.hi },
    { lo: 0, hi: 0 }
  );
  const remaining = parts.filter((p) => !isOwned(p) && !acquired[p.id]).length;

  const copyList = async () => {
    const lines = [
      `PRISM — ${build.name} shopping list`,
      ...parts.filter((p) => !isOwned(p)).map((p) =>
        `[${acquired[p.id] ? "x" : " "}] ${p.name} ($${p.lo}–${p.hi})${p.links[0] ? " — " + p.links[0].url : ""}`),
      `Estimated total: $${total.lo}–${total.hi}`,
    ];
    try { await navigator.clipboard.writeText(lines.join("\n")); setCopiedList(true); setTimeout(() => setCopiedList(false), 1500); }
    catch { /* clipboard unavailable */ }
  };

  const axis = step >= 0 && step < AXES.length ? AXES[step] : null;

  return (
    <div style={{ minHeight: "100vh", background: T.wall, color: T.ink, fontFamily: "'IBM Plex Sans', sans-serif", position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        .opt { display:block; width:100%; text-align:left; background:${T.panel}; border:1px solid ${T.panelEdge};
               color:${T.ink}; border-radius:10px; padding:13px 16px; font-size:15px; font-family:inherit;
               cursor:pointer; transition: border-color .15s, transform .15s; }
        .opt:hover { border-color:${T.accent}; transform: translateX(3px); }
        .opt:focus-visible { outline: 2px solid ${T.accent}; outline-offset: 2px; }
        .primary { background:${T.accent}; color:#1A1408; border:none; border-radius:10px; padding:13px 26px;
                   font-size:15px; font-weight:600; font-family:'Space Grotesk',sans-serif; cursor:pointer; }
        .ghost { background:none; border:1px solid ${T.panelEdge}; color:${T.inkDim}; border-radius:8px;
                 padding:8px 14px; font-size:13px; cursor:pointer; font-family:inherit; }
        .ghost:hover { color:${T.ink}; border-color:${T.inkFaint}; }
        .fadein { animation: fi .45s ease both; }
        @keyframes fi { from { opacity:0; transform: translateY(8px);} to { opacity:1; transform:none;} }
        @media (prefers-reduced-motion: reduce) { .fadein { animation:none; } .opt { transition:none; } }
      `}</style>

      {/* tesseract layer */}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true" />
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 75% 60% at 50% 42%, transparent 30%, ${T.wall} 86%)`, pointerEvents: "none" }} />

      {/* content layer */}
      <div style={{ position: "relative", maxWidth: 640, margin: "0 auto", padding: "clamp(24px,6vh,64px) 22px 48px", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: "0.02em" }}>PRISM</span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: T.inkDim }}>by Entangled · open source</span>
          {step >= 0 && !done && (
            <span style={{ marginLeft: "auto", fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: T.inkFaint }}>
              axis {step + 1}/4 · dim {axis?.dim}
            </span>
          )}
        </header>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingTop: "34vh" }}>
          {/* intro */}
          {step === -1 && (
            <div className="fadein">
              <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(26px,5vw,38px)", fontWeight: 600, lineHeight: 1.15, margin: "0 0 10px" }}>
                One dashboard.<br />Four dimensions of build.
              </h1>
              <p style={{ color: T.inkDim, fontSize: 15, lineHeight: 1.55, margin: "0 0 22px", maxWidth: 460 }}>
                Every Prism build is a point in a four-dimensional space: place, budget, effort, control.
                Answer four questions and watch the projection settle on yours.
              </p>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button className="primary" onClick={() => { setStep(0); setPulse(1); }}>Find my build</button>
                <span style={{ fontSize: 12, color: T.inkFaint }}>$20–$300 · all open source</span>
              </div>
            </div>
          )}

          {/* question */}
          {axis && (
            <div className="fadein" key={axis.id}>
              <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: T.accent, letterSpacing: "0.1em", margin: "0 0 6px" }}>
                DIMENSION {axis.dim}
              </p>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(21px,4vw,28px)", fontWeight: 600, margin: "0 0 16px" }}>{axis.title}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {axis.options.map((o) => (
                  <button key={o.id} className="opt" onClick={() => choose(axis, o)}>{o.label}</button>
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                {step > 0 && <button className="ghost" onClick={() => setStep((s) => s - 1)}>Back</button>}
              </div>
            </div>
          )}

          {/* guide */}
          {done && build && guiding && (
            <div className="fadein">
              <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: T.accent, letterSpacing: "0.1em", margin: "0 0 6px" }}>
                BUILD GUIDE · {build.name.toUpperCase()} · {doneCount}/{allSteps.length}
              </p>
              <div style={{ height: 3, background: T.panelEdge, borderRadius: 2, margin: "0 0 12px", overflow: "hidden" }}>
                <div style={{ width: `${allSteps.length ? (doneCount / allSteps.length) * 100 : 0}%`, height: "100%", background: T.accent, transition: "width .3s ease" }} />
              </div>
              {buildComplete ? (
                <div>
                  <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(22px,4.5vw,30px)", fontWeight: 600, margin: "0 0 8px" }}>
                    It's alive. Welcome to Prism.
                  </h2>
                  <p style={{ color: T.inkDim, fontSize: 14, lineHeight: 1.55, margin: "0 0 16px", maxWidth: 460 }}>
                    Your frame is on and paired. From here: design more dashboards in the editor,
                    add tiles for the sites you live in, and share your build with the community —
                    photos, frame templates, and dashboard layouts all welcome in the gallery.
                  </p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="primary" onClick={() => {}}>Open the dashboard editor</button>
                    <button className="ghost" onClick={restart}>Plan another build</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "50vh", overflowY: "auto", paddingRight: 4 }}>
                  {guide.map((g, gi) => (
                    <div key={gi} style={{ background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: "12px 14px" }}>
                      <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: "0.09em", textTransform: "uppercase", color: T.inkDim, margin: "0 0 8px" }}>
                        {gi + 1} · {g.phase}
                      </p>
                      {g.steps.map((s, si) => {
                        const k = `${gi}-${si}`;
                        const isDone = !!doneSteps[k];
                        return (
                          <button key={k}
                            onClick={() => setDoneSteps((d) => ({ ...d, [k]: !d[k] }))}
                            style={{
                              display: "flex", gap: 10, alignItems: "flex-start", width: "100%", textAlign: "left",
                              background: "none", border: "none", padding: "5px 0", cursor: "pointer",
                              color: isDone ? T.inkFaint : T.ink, fontSize: 13.5, lineHeight: 1.5, fontFamily: "inherit",
                            }}>
                            <span style={{
                              width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1,
                              border: `1.5px solid ${isDone ? "#7FBF85" : T.inkFaint}`,
                              background: isDone ? "#2E4A32" : "transparent",
                              color: "#AFE0B4", fontSize: 11, lineHeight: "16px", textAlign: "center",
                            }}>{isDone ? "✓" : ""}</span>
                            <span style={{ textDecoration: isDone ? "line-through" : "none" }}>{s}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
              {!buildComplete && (
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button className="ghost" onClick={() => setGuiding(false)}>Back to parts</button>
                  <button className="ghost" onClick={restart}>Start over</button>
                </div>
              )}
            </div>
          )}

          {/* sourcing */}
          {done && build && sourcing && !guiding && (
            <div className="fadein">
              <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: T.accent, letterSpacing: "0.1em", margin: "0 0 6px" }}>
                SOURCE YOUR PARTS · {build.name.toUpperCase()}
              </p>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(20px,4vw,26px)", fontWeight: 600, margin: "0 0 4px" }}>
                {remaining === 0 ? "Everything sourced — time to build." : `${remaining} part${remaining === 1 ? "" : "s"} to source`}
              </h2>
              <p style={{ color: T.inkDim, fontSize: 13, margin: "0 0 14px" }}>
                Listings churn; specs don't. Match the criteria, not the brand.
                Estimated cost: <strong style={{ color: T.ink }}>${total.lo}–${total.hi}</strong>
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "44vh", overflowY: "auto", paddingRight: 4 }}>
                {parts.map((p) => {
                  const have = isOwned(p);
                  const got = acquired[p.id];
                  return (
                    <div key={p.id} style={{
                      background: T.panel, border: `1px solid ${got || have ? "#3A5A3E" : T.panelEdge}`,
                      borderRadius: 10, padding: "11px 13px", opacity: have ? 0.65 : 1,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                        {!p.own && (
                          <button
                            aria-label={got ? `Mark ${p.name} not acquired` : `Mark ${p.name} acquired`}
                            onClick={() => setAcquired((s) => ({ ...s, [p.id]: !s[p.id] }))}
                            disabled={have}
                            style={{
                              width: 20, height: 20, borderRadius: 5, cursor: have ? "default" : "pointer",
                              border: `1.5px solid ${got ? "#7FBF85" : T.inkFaint}`,
                              background: got ? "#2E4A32" : "transparent",
                              color: "#AFE0B4", fontSize: 12, lineHeight: 1, flexShrink: 0,
                            }}>{got ? "✓" : ""}</button>
                        )}
                        <span style={{ fontWeight: 500, fontSize: 14, textDecoration: got ? "line-through" : "none" }}>{p.name}</span>
                        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: T.inkDim }}>
                          {have ? "$0" : `$${p.lo}–${p.hi}`}{p.optional ? " · optional" : ""}
                        </span>
                        {p.canOwn && !p.own && (
                          <label style={{ marginLeft: "auto", fontSize: 11, color: T.inkDim, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                            <input type="checkbox" checked={!!owned[p.id]}
                              onChange={(e) => setOwned((s) => ({ ...s, [p.id]: e.target.checked }))}
                              style={{ accentColor: T.accent }} />
                            already have it
                          </label>
                        )}
                      </div>
                      <p style={{ fontSize: 12, color: T.inkDim, margin: "7px 0 0", lineHeight: 1.45 }}>{p.criteria}</p>
                      {p.localTip && (
                        <p style={{ fontSize: 12, color: "#9FBF8F", margin: "5px 0 0", lineHeight: 1.45 }}>⌂ {p.localTip}</p>
                      )}
                      {!have && p.links.length > 0 && (
                        <p style={{ margin: "7px 0 0", display: "flex", gap: 12, flexWrap: "wrap" }}>
                          {p.links.map((l) => (
                            <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
                              style={{ fontSize: 12, color: T.accent, textDecoration: "none", borderBottom: `1px solid ${T.accentDim ?? "#8A6524"}` }}>
                              {l.label} ↗
                            </a>
                          ))}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                <button className="primary" onClick={() => { setGuiding(true); setPulse(1); }}>
                  {remaining === 0 ? "Start the build guide" : "I have my parts — start building"}
                </button>
                <button className="ghost" onClick={copyList}>{copiedList ? "Copied" : "Copy shopping list"}</button>
                <button className="ghost" onClick={() => setSourcing(false)}>Back</button>
              </div>
              <p style={{ fontSize: 11, color: T.inkFaint, marginTop: 12 }}>
                Example links are illustrative, not sponsored — no affiliate tags, ever. The community keeps a live parts list in the repo.
              </p>
            </div>
          )}

          {/* result */}
          {done && build && !sourcing && !guiding && (
            <div className="fadein">
              <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: T.accent, letterSpacing: "0.1em", margin: "0 0 6px" }}>
                PROJECTION RESOLVED · BUILD {build.id} OF 5
              </p>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(24px,4.5vw,32px)", fontWeight: 600, margin: "0 0 2px" }}>{build.name}</h2>
              <p style={{ color: T.inkDim, margin: "0 0 14px", fontSize: 14 }}>
                {build.tag} · <strong style={{ color: T.ink }}>{build.cost}</strong> · {build.time}
              </p>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: 14 }}>
                  <p style={miniLabel()}>You get</p>
                  {build.feats.map((f) => <p key={f} style={liStyle()}>◇ {f}</p>)}
                </div>
                <div style={{ flex: "1 1 200px", background: T.panel, border: `1px solid ${T.panelEdge}`, borderRadius: 10, padding: 14 }}>
                  <p style={miniLabel()}>Honest limits</p>
                  {build.limits.map((f) => <p key={f} style={liStyle()}>— {f}</p>)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <button className="primary" onClick={() => { setSourcing(true); setPulse(1); }}>Source my parts</button>
                <button className="ghost" onClick={restart}>Start over</button>
              </div>
              <p style={{ fontSize: 11, color: T.inkFaint, marginTop: 14 }}>
                Every build runs the same open-source software. Change your mind later — your dashboards move with you.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  function miniLabel() {
    return { fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, letterSpacing: "0.09em", textTransform: "uppercase", color: T.inkDim, margin: "0 0 8px" };
  }
  function liStyle() {
    return { fontSize: 13, lineHeight: 1.45, margin: "0 0 6px", color: T.ink };
  }
}
