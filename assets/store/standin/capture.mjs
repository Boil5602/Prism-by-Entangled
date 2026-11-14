/*
  The PRISM extension's store screenshots, made from the real package running in a headless Chromium.

    node assets/store/standin/capture.mjs            all five shots and the text-reading smoke test
    node assets/store/standin/capture.mjs --no-ocr   the shots only

  What it does:
    - serves this folder's stand-in pages (made-up sites, no network resources) on 127.0.0.1, a free port that is never 4321;
    - starts Playwright's Chromium headless and muted, on a new temporary profile, with prototypes/prism-veil-extension/dist/chromium
      loaded as the only extension. Name resolution is switched off, so nothing in the run reaches another machine;
    - opens each page at 1280x800, waits for the extension's own covers or UI, and writes assets/store/shot-N-*.png as 24-bit RGB;
    - reads text with the package's Tesseract the way offscreen.js ocrWorker() does, and lists every request the browser made meanwhile;
    - prints a JSON report: per shot the covers the extension made and why, the PNG header read back, and every error seen in the
      extension's service worker and pages.

  Nothing on the pages draws a cover. No Node packages: the DevTools protocol over Node's own WebSocket (Node 22 or newer).
  The browser: set CHROME to another chrome.exe that accepts --load-extension.
*/
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..");
const REPO = path.resolve(HERE, "..", "..", "..");
const EXT = path.join(REPO, "prototypes", "prism-veil-extension", "dist", "chromium");
const CHROME = process.env.CHROME || path.join(os.homedir(), "AppData", "Local", "ms-playwright", "chromium-1248", "chrome-win64", "chrome.exe");
const W = 1280, H = 800;
const WITH_OCR = !process.argv.includes("--no-ocr");
const PLAIN = process.argv.includes("--plain");
// Three of the package's pictures are scanned slides with a black edge. A shot that drew one, or the same picture twice in view, is taken again.
const EDGED = /mt_rainier_liberty_ridge|snow_covered_trees|upper_tipsoo_lake/;
const TRIES = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the pages' server
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
function serve() {
  return new Promise((ok) => {
    const srv = http.createServer((req, res) => {
      const name = path.basename(decodeURIComponent((req.url || "/").split("?")[0]));
      if (name === "favicon.ico") { res.writeHead(204); res.end(); return; }
      const file = path.join(HERE, name);
      if (!TYPES[path.extname(name)] || !fs.existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(name)], "cache-control": "no-store" });
      res.end(fs.readFileSync(file));
    });
    const listen = () => srv.listen(0, "127.0.0.1", () => {
      if (srv.address().port === 4321) { srv.close(listen); return; }   // 4321 is the developer's reload hook
      ok(srv);
    });
    listen();
  });
}

// ---------------------------------------------------------------- PNG: RGBA in, 24-bit RGB out
function pngChunks(buf) {
  const out = []; let p = 8;
  while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8); out.push({ type, data: buf.subarray(p + 8, p + 8 + len) }); p += 12 + len; }
  return out;
}
function pngHeader(buf) {
  const ihdr = pngChunks(buf).find((c) => c.type === "IHDR").data;
  return { width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4), bitDepth: ihdr[8], colorType: ihdr[9] };
}
function toRgbPng(buf) {
  const chunks = pngChunks(buf), h = pngHeader(buf);
  if (h.bitDepth !== 8 || (h.colorType !== 6 && h.colorType !== 2) ) throw new Error("unexpected PNG: depth " + h.bitDepth + " type " + h.colorType);
  const bpp = h.colorType === 6 ? 4 : 3, stride = h.width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const px = Buffer.alloc(stride * h.height);
  for (let y = 0; y < h.height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y ? px[dst - stride + x] : 0, c = (x >= bpp && y) ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      px[dst + x] = v & 255;
    }
  }
  const rows = Buffer.alloc((h.width * 3 + 1) * h.height);
  for (let y = 0; y < h.height; y++) {
    const o = y * (h.width * 3 + 1); rows[o] = 0;
    for (let x = 0; x < h.width; x++) { const s = y * stride + x * bpp; rows[o + 1 + x * 3] = px[s]; rows[o + 2 + x * 3] = px[s + 1]; rows[o + 3 + x * 3] = px[s + 2]; }
  }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, "latin1"); data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)) >>> 0, 8 + data.length); return b;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(h.width, 0); ihdr.writeUInt32BE(h.height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([buf.subarray(0, 8), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- DevTools protocol
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.waiting = new Map(); this.handlers = [];
    ws.addEventListener("message", (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.waiting.has(msg.id)) { const w = this.waiting.get(msg.id); this.waiting.delete(msg.id); if (msg.error) w.no(new Error(w.method + ": " + msg.error.message)); else w.ok(msg.result); return; }
      for (const h of this.handlers) { try { h(msg); } catch (e) { console.error("handler:", e); } }
    });
  }
  static connect(url) { return new Promise((ok, no) => { const ws = new WebSocket(url); ws.addEventListener("open", () => ok(new Cdp(ws))); ws.addEventListener("error", (e) => no(new Error("websocket: " + (e.message || "failed")))); }); }
  send(method, params, sessionId) {
    const id = ++this.id;
    return new Promise((ok, no) => { this.waiting.set(id, { ok, no, method }); this.ws.send(JSON.stringify({ id, method, params: params || {}, sessionId })); });
  }
  on(fn) { this.handlers.push(fn); }
}

async function main() {
  if (!fs.existsSync(path.join(EXT, "manifest.json"))) throw new Error("no extension package at " + EXT);
  if (!fs.existsSync(CHROME)) throw new Error("no browser at " + CHROME);
  const srv = await serve();
  const port = srv.address().port;
  // Each stand-in site under a made-up name of its own (.example is reserved for this), so the extension's panel names a site and
  // not an address. The browser maps the names to this PC; --plain uses 127.0.0.1 as it is.
  const site = (name) => "http://" + (PLAIN ? "127.0.0.1" : name + ".example") + ":" + port + "/";
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "prism-store-shots-"));
  const netlog = path.join(profile, "netlog.json");
  // the browser's own secure-DNS lookups off (they go to a public resolver by address, past the name rules below)
  fs.writeFileSync(path.join(profile, "Local State"), JSON.stringify({ dns_over_https: { mode: "off" } }));
  const chrome = spawn(CHROME, [
    "--headless=new", "--mute-audio", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--load-extension=" + EXT, "--disable-extensions-except=" + EXT, "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--window-size=" + W + "," + H, "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--autoplay-policy=no-user-gesture-required",
    // sealed: the made-up names go to this PC, every other name does not resolve, and anything else is sent to a proxy that is not there
    "--host-resolver-rules=MAP *.example 127.0.0.1, MAP * ~NOTFOUND",
    "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=*.example;127.0.0.1",
    "--log-net-log=" + netlog,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  const exited = new Promise((r) => chrome.on("exit", r));
  const report = { extension: EXT, browser: CHROME, pages: site("<name>"), shots: [], errors: [], ocr: null };
  let phase = "start";
  try {
    let wsUrl = "";
    for (let i = 0; i < 100 && !wsUrl; i++) {
      await sleep(100);
      try { const t = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n"); if (t[1]) wsUrl = "ws://127.0.0.1:" + t[0].trim() + t[1].trim(); } catch (e) {}
    }
    if (!wsUrl) throw new Error("the browser did not give a DevTools port");
    const cdp = await Cdp.connect(wsUrl);

    // Every target (pages, the extension's service worker, workers under them): errors and requests.
    const sessions = new Map();   // sessionId -> { url, type }
    const requests = [];          // { at, url, where }
    cdp.on((m) => {
      const s = m.sessionId && sessions.get(m.sessionId), where = (s ? (s.type + " " + s.url) : "?") + " [" + phase + "]";
      if (m.method === "Target.attachedToTarget") {
        const ti = m.params.targetInfo, sid = m.params.sessionId;
        sessions.set(sid, { url: ti.url, type: ti.type });
        const quiet = () => {};
        cdp.send("Runtime.enable", {}, sid).catch(quiet);
        cdp.send("Log.enable", {}, sid).catch(quiet);
        cdp.send("Network.enable", {}, sid).catch(quiet);
        cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(quiet);
      } else if (m.method === "Target.targetInfoChanged") {
        for (const [sid, v] of sessions) if (v.targetId === m.params.targetInfo.targetId) v.url = m.params.targetInfo.url;
      } else if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        report.errors.push({ where, kind: "exception", text: ((d.exception && (d.exception.description || d.exception.value)) || d.text || "").toString().slice(0, 600), at: (d.url || "") + ":" + d.lineNumber });
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        report.errors.push({ where, kind: "console.error", text: m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(" ").slice(0, 600) });
      } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
        report.errors.push({ where, kind: "log", text: (m.params.entry.text || "").slice(0, 400), at: m.params.entry.url || "" });
      } else if (m.method === "Network.requestWillBeSent") {
        requests.push({ at: Date.now(), url: m.params.request.url, where });
      }
    });
    await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await cdp.send("Target.setDiscoverTargets", { discover: true });

    // the extension's id, from its service worker
    let extId = "";
    for (let i = 0; i < 100 && !extId; i++) {
      const { targetInfos } = await cdp.send("Target.getTargets");
      const sw = targetInfos.find((t) => t.type === "service_worker" && /^chrome-extension:\/\/[a-p]{32}\/bg\.js$/.test(t.url));
      if (sw) extId = new URL(sw.url).host; else await sleep(100);
    }
    if (!extId) throw new Error("the extension did not load (no service worker)");
    report.extensionId = extId;
    const extUrl = "chrome-extension://" + extId + "/";

    async function open(url) {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      sessions.set(sessionId, { url, type: "page", targetId });
      const s = (method, params) => cdp.send(method, params, sessionId);
      await s("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await s("Page.enable"); await s("Runtime.enable"); await s("Log.enable"); await s("Network.enable");
      await s("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      await s("Page.navigate", { url });
      const ev = async (expression, awaitPromise) => {
        const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: !!awaitPromise });
        if (r.exceptionDetails) throw new Error("evaluate: " + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
        return r.result.value;
      };
      for (let i = 0; i < 100; i++) { try { if (await ev("document.readyState") === "complete" && await ev("location.href") !== "about:blank") break; } catch (e) {} await sleep(100); }
      return { s, ev, targetId, close: () => cdp.send("Target.closeTarget", { targetId }) };
    }
    // The covers the extension has on the page now: its reason for each, the box, and whether the picture has loaded.
    const COVERS = `(function () {
      return Promise.all(Array.from(document.querySelectorAll("[data-prism-why]")).map(function (c) {
        var r = c.getBoundingClientRect(), bg = "";
        var all = [c].concat(Array.from(c.querySelectorAll("*")));
        for (var i = 0; i < all.length && !bg; i++) { var m = /url\\(["']?([^"')]+)/.exec(getComputedStyle(all[i]).backgroundImage || ""); if (m) bg = m[1]; }
        var out = { why: c.getAttribute("data-prism-why"), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], picture: bg.replace(/^chrome-extension:\\/\\/[^/]+\\//, ""), loaded: false };
        if (!bg) return out;
        return new Promise(function (ok) { var im = new Image(); im.onload = function () { out.loaded = true; ok(out); }; im.onerror = function () { ok(out); }; im.src = bg; });
      }));
    })()`;
    async function waitCovers(page, want, ms) {
      const until = Date.now() + (ms || 20000); let covers = [];
      while (Date.now() < until) {
        covers = await page.ev(COVERS, true);
        if (covers.length >= want && covers.every((c) => c.loaded)) break;
        await sleep(250);
      }
      await sleep(1500);   // the fade-in
      return page.ev(COVERS, true);
    }
    async function save(page, name, shows, how, extra, zoom) {
      // zoom: the top left of the page, enlarged to fill the picture (the same as the browser's own zoom would show it)
      const { data } = await page.s("Page.captureScreenshot", zoom ? { format: "png", clip: { x: 0, y: 0, width: W / zoom, height: H / zoom, scale: zoom } } : { format: "png" });
      const file = path.join(OUT, name);
      fs.writeFileSync(file, toRgbPng(Buffer.from(data, "base64")));
      const h = pngHeader(fs.readFileSync(file));
      const ok = h.width === W && h.height === H && h.bitDepth === 8 && h.colorType === 2;
      report.shots.push(Object.assign({ file, png: h, pngOk: ok, shows, how }, extra || {}));
      if (!ok) throw new Error(name + " is not " + W + "x" + H + " RGB: " + JSON.stringify(h));
    }
    // An element inside the extension's closed shadow roots, by a test on its attributes: the centre of its box.
    async function findInShadow(page, test) {
      const { root } = await page.s("DOM.getDocument", { depth: -1, pierce: true });
      let hit = null;
      (function walk(n) {
        if (hit) return;
        const at = {}; for (let i = 0; n.attributes && i < n.attributes.length; i += 2) at[n.attributes[i]] = n.attributes[i + 1];
        if (n.nodeType === 1 && test(n, at)) { hit = n; return; }
        (n.children || []).forEach(walk); (n.shadowRoots || []).forEach(walk); if (n.contentDocument) walk(n.contentDocument);
      })(root);
      if (!hit) return null;
      const { model } = await page.s("DOM.getBoxModel", { nodeId: hit.nodeId });
      const q = model.border; return { x: (q[0] + q[4]) / 2, y: (q[1] + q[5]) / 2, w: model.width, h: model.height };
    }
    async function click(page, x, y) {
      await page.s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await page.s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await page.s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    }

    // The video veil: the big cover over the player, what its card says, and its picture.
    const VEIL = `(function () {
      var a = Array.from(document.querySelectorAll("[data-prism-veil]")).filter(function (e) { var r = e.getBoundingClientRect(); return e.tagName !== "PRISM-POPUP-BUTTON" && r.width > 400 && r.height > 200; });
      if (!a.length) return null;
      var r = a[0].getBoundingClientRect(), bg = "", all = [a[0]].concat(Array.from(a[0].querySelectorAll("*")));
      for (var i = 0; i < all.length && !bg; i++) { var m = /url\\(["']?([^"')]+)/.exec(getComputedStyle(all[i]).backgroundImage || ""); if (m) bg = m[1]; }
      return { box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], text: a[0].innerText.replace(/\\s+/g, " ").slice(0, 300), picture: bg.replace(/^chrome-extension:\\/\\/[^/]+\\//, "") };
    })()`;
    const inView = (c) => c.box[0] < W && c.box[1] < H && c.box[0] + c.box[2] > 0 && c.box[1] + c.box[3] > 0;
    const poor = (list) => { const seen = new Set(); for (const c of list.filter(inView)) { if (EDGED.test(c.picture) || seen.has(c.picture)) return true; seen.add(c.picture); } return false; };
    // Open a page, and again while the pictures drawn are poor ones. The extension picks each picture at random; this only takes the shot again.
    async function scene(url, ready) {
      for (let n = 1; ; n++) {
        const page = await open(url);
        const got = await ready(page);
        if (n >= TRIES || !poor(got.pictures)) return Object.assign(got, { page, tries: n });
        await page.close();
      }
    }
    const display = async (page) => { const covers = await waitCovers(page, 2); return { covers, pictures: covers }; };

    // 1 - the news front page: display ad slots
    phase = "shot 1";
    let sc = await scene(site("quillhaven-courier") + "news.html", display);
    await save(sc.page, "shot-1-news.png", "a stand-in news front page, its ad slots covered", "display slot selectors (src/rules.js)", { covers: sc.covers, tries: sc.tries });
    await sc.page.close();

    // 2 - the social feed: sponsored posts
    phase = "shot 2";
    sc = await scene(site("loopline") + "feed.html", display);
    await save(sc.page, "shot-2-feed.png", "a stand-in social feed, the sponsored post and the promoted card covered", "the label walker (src/rules.js): a post that says Sponsored or Promoted", { covers: sc.covers, tries: sc.tries });
    await sc.page.close();

    // 3 - the video player in an ad break: the intermission
    phase = "shot 3";
    sc = await scene(site("lanternreel") + "video.html", async (page) => {
      let veil = null;
      for (let i = 0; i < 160 && !veil; i++) { await sleep(250); veil = await page.ev(VEIL); }
      const state = await page.ev("JSON.stringify({ state: window.__standin && window.__standin.state, cls: document.getElementById('player').className, sdk: document.documentElement.getAttribute('data-prism-ad') })");
      if (!veil) throw new Error("no video veil came up: " + state);
      await sleep(2500);
      veil = await page.ev(VEIL);
      return { veil, state: JSON.parse(state), pictures: [veil] };
    });
    await save(sc.page, "shot-3-intermission.png", "a stand-in video player in an ad break, the intermission card over it", "the Video.js player family (src/video.js): the player root gains vjs-ad-playing", { veil: sc.veil, page: sc.state, tries: sc.tries });
    await sc.page.close();

    // 4 - the popup list: a page that opens windows by itself, the PRISM button's panel listing them
    phase = "shot 4";
    let page = await open(site("brindlemoor-games") + "popups.html");
    await sleep(4500);   // the page's four opens, 0.9 s to 2.7 s after load
    const pill4 = await findInShadow(page, (n, at) => n.localName === "div" && /(^| )pill( |$)/.test(at.class || ""));
    if (!pill4) throw new Error("no PRISM button on the popups page");
    await click(page, pill4.x - 12, pill4.y);
    await sleep(900);
    const panel4 = await findInShadow(page, (n, at) => n.localName === "div" && at.class === "panel");
    if (!panel4) throw new Error("the PRISM button's panel did not open on the popups page");
    const rows4 = [];
    { const { root } = await page.s("DOM.getDocument", { depth: -1, pierce: true });
      const text = (n) => (n.nodeValue || "") + (n.children || []).map(text).join(" ");
      (function walk(n) { const at = {}; for (let i = 0; n.attributes && i < n.attributes.length; i += 2) at[n.attributes[i]] = n.attributes[i + 1];
        if (n.nodeType === 1 && (at.class === "row" || at.class === "sub")) rows4.push(text(n).replace(/\s+/g, " ").trim());
        (n.children || []).forEach(walk); (n.shadowRoots || []).forEach(walk); })(root); }
    const { targetInfos: after4 } = await cdp.send("Target.getTargets");
    await page.s("Input.dispatchMouseEvent", { type: "mouseMoved", x: 300, y: 620 });
    await sleep(400);
    await save(page, "shot-4-popups.png", "a stand-in games page that opened four windows by itself, the PRISM button's panel listing them with Open and Always allow", "the page calls window.open with no click behind it (popup-hook.js, src/popups-ui.js)",
      { pill: pill4, panel: panel4, rows: rows4, pagesOpen: after4.filter((t) => t.type === "page").map((t) => t.url) });
    await page.close();

    // 5 - the PRISM button's panel, with Report an ad
    phase = "shot 5";
    sc = await scene(site("saltmarsh-kitchen") + "recipes.html", display);
    page = sc.page;
    const pill = await findInShadow(page, (n, at) => n.localName === "div" && /(^| )pill( |$)/.test(at.class || ""));
    if (!pill) throw new Error("no PRISM button on the page");
    await click(page, pill.x - 12, pill.y);
    await sleep(900);
    const panel = await findInShadow(page, (n, at) => n.localName === "div" && at.class === "panel");
    if (!panel) throw new Error("the PRISM button's panel did not open");
    await page.s("Input.dispatchMouseEvent", { type: "mouseMoved", x: 400, y: 300 });
    await sleep(400);
    await save(page, "shot-5-report.png", "a stand-in recipe page, the PRISM button's panel open with Report an ad", "a real click on the on-page PRISM button (src/popups-ui.js)", { covers: sc.covers, tries: sc.tries, pill, panel });
    await page.close();

    // The smoke test: text reading as offscreen.js ocrWorker() does it.
    if (WITH_OCR) {
      phase = "text reading";
      page = await open(extUrl + "offscreen.html");
      await sleep(800);
      const t0 = Date.now();
      let result;
      try {
        result = JSON.parse(await page.ev(`(async function () {
          var base = chrome.runtime.getURL("vendor/tesseract/"), loadedHere = false;
          if (typeof Tesseract === "undefined") { loadedHere = true; await new Promise(function (ok, no) { var s = document.createElement("script"); s.src = base + "tesseract.min.js"; s.onload = ok; s.onerror = function () { no(new Error("tesseract.min.js did not load")); }; document.head.appendChild(s); }); }
          var worker = await Tesseract.createWorker("eng", 1, { workerPath: base + "worker.min.js", corePath: base + "core", langPath: base + "lang",
            workerBlobURL: false, gzip: true, cacheMethod: "none", logger: function () {} });
          var c = document.createElement("canvas"); c.width = 1000; c.height = 240; var g = c.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#000"; g.font = "bold 72px Arial, sans-serif"; g.textBaseline = "middle"; g.fillText("BACK IN TWO MINUTES", 40, 120);
          var t = performance.now(), r = await worker.recognize(c), ms = Math.round(performance.now() - t);
          await worker.terminate();
          return JSON.stringify({ text: r.data.text, confidence: r.data.confidence, ms: ms, scriptLoadedHere: loadedHere });
        })()`, true));
      } catch (e) { result = { error: String(e.message || e) }; }
      const t1 = Date.now();
      await sleep(500);
      report.ocr = Object.assign(result, { from: t0, to: t1,
        requestsSeen: requests.filter((r) => r.at >= t0 && r.at <= t1 + 500).map((r) => r.url.length > 160 ? r.url.slice(0, 60) + "... (" + r.url.length + " characters)" : r.url.replace(extUrl, "chrome-extension://<id>/")),
        notExtensionSeen: requests.filter((r) => r.at >= t0 && r.at <= t1 + 500 && !/^(chrome-extension|data|blob):/.test(r.url)).map((r) => r.url.slice(0, 160)),
      });
      await page.close();
    }
    await sleep(300);
    phase = "the browser closing";
    await cdp.send("Browser.close").catch(() => {});
  } finally {
    const done = await Promise.race([exited, sleep(8000).then(() => "timeout")]);
    if (done === "timeout") { try { chrome.kill(); } catch (e) {} await Promise.race([exited, sleep(3000)]); }
    srv.close();
    // The browser's own net log: every URL request it started in the run, whoever made it (pages, workers, the browser itself).
    try {
      const lines = fs.readFileSync(netlog, "utf8").split("\n");
      let offset = 0, startType = -1;
      const head = /"timeTickOffset":\s*"?(\d+)/.exec(lines[0] || ""); if (head) offset = +head[1];
      const ty = /"URL_REQUEST_START_JOB":\s*(\d+)/.exec(lines[0] || ""); if (ty) startType = +ty[1];
      const all = [];
      for (const ln of lines) {
        if (ln.indexOf('"url"') < 0 || ln.indexOf('"type":' + startType + "}") < 0) continue;
        const u = /"url":"([^"]+)"/.exec(ln), tm = /"time":"(\d+)"/.exec(ln);
        if (u) all.push({ at: tm ? +tm[1] + offset : 0, url: u[1] });
      }
      const outside = (u) => !/^(chrome-extension|chrome|devtools|data|blob|about):/.test(u) && !/^http:\/\/(127\.0\.0\.1|[a-z-]+\.example)[:/]/.test(u);
      report.netlog = { requests: all.length, notExtensionOrLocal: Array.from(new Set(all.filter((r) => outside(r.url)).map((r) => r.url))) };
      if (report.ocr && report.ocr.from) {
        const win = all.filter((r) => r.at >= report.ocr.from && r.at <= report.ocr.to + 500);
        report.ocr.netlogDuring = { requests: win.length, notExtension: Array.from(new Set(win.filter((r) => !/^chrome-extension:/.test(r.url)).map((r) => r.url))) };
      }
    } catch (e) { report.netlog = { error: String(e.message || e) }; }
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) {}
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch((e) => { console.error("FAILED: " + (e.stack || e)); process.exitCode = 1; });
