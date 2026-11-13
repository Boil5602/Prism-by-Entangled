#!/usr/bin/env node
// Pictures of the PRISM extension at work on the made-up pages of this folder (2026-11-11, for the website's Web subject).
// The pages are served from this PC, a browser is started with the unpacked extension of the repo loaded, and each picture is the
// browser's page area alone: 1600 x 862 CSS px at 2x. Nothing is drawn on a picture: a cover in it is one the extension made, and the
// run fails a picture whose page got no cover. Each picture is taken again in a browser started without the extension, at the same
// size and scroll position, for a before and after.
//
//     node prototypes/prism-extension-demo/shoot.mjs [--out=<dir>] [--takes=4] [--only=any-site,popups] [--browser=edge|chrome] [--show]
//
// --takes: how many times each covered picture is taken (the extension picks its photos by chance, so each take differs); the
// before picture is taken once. --show: a window on the desktop in place of a headless browser. Output: <out>/<id>.c<n>.png,
// <out>/<id>-before.png and <out>/run.json (for every take, the covers the extension made: its reason and the box).
// The browser's own sound is off (--mute-audio), so the streaming page is never heard on this PC.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, "..", "prism-veil-extension");
const args = process.argv.slice(2);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };
const out = resolve(opt("--out", join(here, "out"))), takes = Number(opt("--takes", "4")), only = opt("--only", "").split(",").filter(Boolean);
const W = 1600, H = 862, PORT = Number(opt("--port", "4330")), DBG = 9340;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(new Date().toTimeString().slice(0, 8) + " " + s);
mkdirSync(out, { recursive: true });

// the pages
const types = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".css": "text/css", ".js": "text/javascript", ".png": "image/png" };
const server = createServer((req, res) => {
  const p = normalize(join(here, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!p.startsWith(here) || !existsSync(p) || !types[extname(p)]) { res.writeHead(404); res.end("no"); return; }
  res.writeHead(200, { "content-type": types[extname(p)], "cache-control": "no-store" }); res.end(readFileSync(p));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
// Each page has a made-up address of its own, so no picture carries this PC's name for the site: the reserved .example names, sent
// to this PC's server by the browser itself (--host-resolver-rules); nothing leaves the PC.
const hosts = { "news.html": "quillhaven-dispatch.example", "search.html": "tamberlook.example", "watch.html": "halcyard.example", "music.html": "ostrel-radio.example","popups.html": "sorrelbrook-kitchen.example" };
const urlOf = (page) => `http://${hosts[page.split("?")[0]]}/${page}`;

const exe = opt("--browser", "edge") === "chrome" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

async function browser(withExt) {
  const profile = join(out, withExt ? ".profile-on" : ".profile-off");
  rmSync(profile, { recursive: true, force: true });
  const flags = ["--remote-debugging-port=" + DBG, "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--mute-audio", "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--force-device-scale-factor=1", `--window-size=${W},${H + 140}`, "--disable-features=DisableLoadExtensionCommandLineSwitch,msEdgeWelcomePage,Translate",
    "--host-resolver-rules=" + Object.values(hosts).map((h) => `MAP ${h}:80 127.0.0.1:${PORT}`).join(", ")];
  if (!args.includes("--show")) flags.push("--headless=new");
  if (withExt) flags.push("--load-extension=" + ext, "--disable-extensions-except=" + ext);
  const proc = spawn(exe, [...flags, "about:blank"], { stdio: "ignore" });
  // Edge hands its work to processes the first one does not own, so ending that one's tree leaves them (55 were left after a run):
  // every browser process started on this run's profile folder is ended, and no other
  const kill = async () => {
    try { spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch { proc.kill(); }
    await sleep(800);
    const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('" + profile.replace(/'/g, "''") + "') -and $_.Name -ne 'powershell.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
    await new Promise((r) => spawn("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore" }).on("exit", r).on("error", r));
  };
  const fail = async (why) => { await kill(); throw new Error(why); };   // never leave a browser behind
  const list = async () => { try { return await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json(); } catch { return []; } };
  let target = null;
  for (let i = 0; i < 80 && !target; i++) { await sleep(250); target = (await list()).find((t) => t.type === "page" && !t.url.startsWith("chrome-extension:")); }
  if (!target) await fail("the browser gave no page");
  if (withExt) {
    let worker = null;
    for (let i = 0; i < 80 && !worker; i++) { await sleep(250); worker = (await list()).find((t) => t.type === "service_worker" && t.url.startsWith("chrome-extension:")); }
    if (!worker) await fail("the extension did not load in this browser (no service worker)");
    await sleep(2500);   // its first run: the settings it writes for an unpacked build
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { const [r, j] = waiting.get(d.id); waiting.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); } };
  const cdp = (method, params = {}) => new Promise((r, j) => { const n = ++id; waiting.set(n, [r, j]); ws.send(JSON.stringify({ id: n, method, params })); });
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("DOM.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  const js = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || "")); return r.result.value; };
  const go = async (url) => { await cdp("Page.navigate", { url }); for (let i = 0; i < 60; i++) { await sleep(150); if (await js("document.readyState").catch(() => "") === "complete") break; } };
  const press = async (x, y) => { await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await sleep(120); await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); };
  const move = (x, y) => cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  // the middle of the element whose own text is `text`, wherever it is (the extension's panels are in closed shadow trees)
  const textAt = async (text) => {
    const { root } = await cdp("DOM.getDocument", { depth: -1, pierce: true });
    let hit = null;
    const walk = (n, parent) => { if (hit) return; if (n.nodeType === 3 && (n.nodeValue || "").includes(text)) { hit = parent; return; } for (const c of n.children || []) walk(c, n); for (const s of n.shadowRoots || []) walk(s, n); if (n.contentDocument) walk(n.contentDocument, n); };
    walk(root, null);
    if (!hit) return null;
    const { model } = await cdp("DOM.getBoxModel", { nodeId: hit.nodeId }); const q = model.border;
    return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2 };
  };
  const shot = async (file) => { const r = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(file, Buffer.from(r.data, "base64")); };
  const covers = () => js(`Array.from(document.querySelectorAll("[data-prism-veil]")).map(function (c) { var r = c.getBoundingClientRect(); return { tag: c.tagName.toLowerCase(), why: c.getAttribute("data-prism-why") || "", box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; }).filter(function (c) { return c.box[2] > 0 && c.box[3] > 0 && c.box[1] < innerHeight && c.box[1] + c.box[3] > 0; })`);
  const others = async () => { for (const t of await list()) if (t.type === "page" && t.id !== target.id) await fetch(`http://127.0.0.1:${DBG}/json/close/${t.id}`).catch(() => {}); };
  const close = async () => { try { await Promise.race([cdp("Browser.close"), sleep(2000)]); } catch {} try { ws.close(); } catch {} await kill(); };
  return { cdp, js, go, press, move, textAt, shot, covers, others, close };
}

// Each picture: the page, where it is scrolled to, and what is done before the picture. `on` steps need the extension.
const scrollTo = (b, sel, above) => b.js(`(function () { var e = document.querySelector(${JSON.stringify(sel)}); scrollTo(0, Math.max(0, Math.round(e.getBoundingClientRect().top + scrollY - ${above}))); return scrollY; })()`);
const shots = [
  { id: "any-site", page: "news.html", settle: 2600, need: 2 },
  { id: "banners", page: "news.html", settle: 2600, need: 3, at: (b) => scrollTo(b, ".inline-ad", 44) },
  { id: "sponsored-links", page: "search.html", settle: 2600, need: 2 },
  { id: "video-ads", page: "watch.html?break=3&ads=40", settle: 11000, need: 1 },
  { id: "audio-ads", page: "music.html?break=3&ads=40", settle: 11000, need: 2 },
  { id: "report-button", page: "news.html", settle: 2200, need: 0, at: (b) => scrollTo(b, ".partners", 150),
    on: async (b) => {
      const pill = await b.textAt("PRISM"); if (!pill) throw new Error("no PRISM button on the page");
      await b.press(pill.x, pill.y); await sleep(900);
      const rep = await b.textAt("Report an ad"); if (!rep) throw new Error("no Report an ad button in the panel");
      await b.press(rep.x, rep.y); await sleep(900);
      const box = await b.js(`(function () { var r = document.querySelector(".promo-box").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await b.press(box.x, box.y); await sleep(2200); await b.move(1300, 300);
    } },
  // last: without the extension the two windows really open, and they are left alone until the browser is closed
  { id: "popups", page: "popups.html?wait=900", settle: 3000, need: 0 },
  // the same page with the PRISM button's panel open: a second way to show the count (it shares the before picture of "popups")
  { id: "popups-panel", page: "popups.html?wait=900", settle: 1200, need: 0, noBefore: true,
    on: async (b) => { await sleep(3000); const pill = await b.textAt("popups blocked"); if (!pill) throw new Error("the PRISM button shows no count"); await b.press(pill.x, pill.y); await b.move(700, 300); } },
].filter((s) => !only.length || only.includes(s.id));

const run = { size: { width: W, height: H, scale: 2 }, takes: {} };
for (const withExt of [true, false]) {
  const b = await browser(withExt);
  log(withExt ? "browser with the extension" : "browser without the extension");
  try {
    for (const s of shots) {
      if (!withExt && s.noBefore) continue;
      for (let n = 1; n <= (withExt ? takes : 1); n++) {
        await b.go("about:blank"); await b.go(urlOf(s.page));
        const y = s.at ? await s.at(b) : 0;
        await b.move(1300, 500);
        if (withExt && s.on) await s.on(b); else if (s.id !== "video-ads" && s.id !== "audio-ads" && s.id !== "popups") await sleep(200);
        await sleep(s.settle);
        const file = join(out, withExt ? `${s.id}.c${n}.png` : `${s.id}-before.png`);
        await b.shot(file);
        if (withExt) {
          const c = await b.covers();
          const real = c.filter((x) => x.tag !== "prism-popup-button");
          (run.takes[s.id] ||= []).push({ file: `${s.id}.c${n}.png`, scrollY: y, covers: c });
          log(`${s.id} take ${n}: ${real.length} covers` + (real.length < s.need ? "  ** FEWER THAN " + s.need + " **" : "") + " " + [...new Set(real.map((x) => x.why.split(":")[0] || x.tag))].join(", "));
        } else log(`${s.id} before`);
      }
    }
  } finally { await b.close(); }
}
writeFileSync(join(out, "run.json"), JSON.stringify(run, null, 1));
server.close();
log("done: " + out);
process.exit(0);
