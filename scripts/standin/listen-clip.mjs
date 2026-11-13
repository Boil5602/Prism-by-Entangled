// The phone's Listen page drawn frame by frame, for a clip of it (2026-11-11, asked for clips of the visuals for the website).
//
//   node scripts/standin/listen-clip.mjs <vizlog> <first line> <frames> <out folder> [--album 0] [--song "Slow Lanterns"] [--art focal|backdrop|off]
//
// The page is the one the PC serves (Services/ListenPage.cs with VizScene.cs spliced in), loaded from a local copy in a headless Edge at a
// phone's size (360 x 640 at 2x: 720 x 1280 pixels). Nothing is asked of a PC: the page's own calls are answered here with a made-up
// song, artist and album and the generated cover of the stand-in folder, and its bands are the levels a vizlog holds (the 64 levels the
// PC's stage was given, laid onto the page's 48), one frame of the log to one frame of the page. Each frame is saved as a PNG; the
// Listen gate and the page's top bar are off, as they are once a person has tapped and the page has come to rest. No sound is made.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = resolve(HERE, "..", "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const albumIx = parseInt(opt("--album", "0"), 10), songName = opt("--song", ""), artMode = opt("--art", "off");
const [logPath, firstS, countS, outDir] = args;
if (!outDir) { console.error("usage: listen-clip.mjs <vizlog> <first line> <frames> <out folder>"); process.exit(2); }
const first = parseInt(firstS, 10), count = parseInt(countS, 10);

const raw = (file, name) => { const s = readFileSync(join(REPO, "targets/win-host/PrismHost/Services", file), "utf8"); const a = s.indexOf('public const string ' + name + ' = """'); const b = s.indexOf('\n""";', a); return s.slice(s.indexOf("\n", a) + 1, b); };
const html = raw("ListenPage.cs", "Html").replace("__VIZ_SCENE__", () => raw("VizScene.cs", "Js")).replace("__LISTEN_PLAYER__", () => raw("ListenPlayer.cs", "Js"));
const standin = join(process.env.LOCALAPPDATA, "Prism", "diagnostics", "standin");
const words = JSON.parse(readFileSync(join(standin, "standin.json"), "utf8"));
const album = words.albums[albumIx], cover = "data:image/png;base64," + readFileSync(join(standin, "album-" + String(albumIx).padStart(2, "0") + ".png")).toString("base64");
const song = songName || words.songs[(albumIx * 7 + 3) % words.songs.length];
const pal = JSON.parse(readFileSync(join(REPO, "packages/core/data/visualization-styles/sunrise-meadow.json"), "utf8")).palette;

const lines = readFileSync(logPath, "utf8").split("\n").filter((l) => l.includes("|"));
const levels = (i) => { const lv = lines[i].split("|")[1].trim().split(/\s+/).map(Number), out = []; for (let k = 0; k < 48; k++) { const x = k * (lv.length - 1) / 47, a = Math.floor(x), b = Math.min(lv.length - 1, a + 1); out.push(+(lv[a] + (lv[b] - lv[a]) * (x - a)).toFixed(4)); } return out; };

const server = createServer((req, res) => { if (req.url === "/" || req.url.startsWith("/?")) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html); } else { res.writeHead(404); res.end(); } });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port, dbg = 9300 + Math.floor(Math.random() * 500);
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const profile = mkdtempSync(join(tmpdir(), "listen-clip-"));
const proc = spawn(edge, ["--headless=new", "--remote-debugging-port=" + dbg, "--user-data-dir=" + profile, "--no-first-run", "--hide-scrollbars", "--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find((t) => t.type === "page"); } catch {} }
if (!target) { proc.kill(); server.close(); throw new Error("the browser did not start"); }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const waits = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { const [ok, no] = waits.get(m.id); waits.delete(m.id); m.error ? no(new Error(m.error.message)) : ok(m.result); } };
const cdp = (method, params = {}) => new Promise((ok, no) => { const id = ++seq; waits.set(id, [ok, no]); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (waits.delete(id)) no(new Error("no answer to " + method)); }, 8000).unref(); });
const js = async (expression) => { const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

try {
  await cdp("Emulation.setDeviceMetricsOverride", { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true }); await cdp("Page.enable"); await cdp("Page.navigate", { url: `http://127.0.0.1:${port}/` }); await sleep(1500);
  const NOW = { service: "Apple Music", playbackState: "playing", metadata: { title: song, artist: album.artist, album: album.album, artwork: cover }, collection: { label: "Evening Mix", kind: "playlist" }, position: 61, duration: 214 };
  const FEED = { artworkMode: artMode, artwork: artMode === "off" ? "" : cover, palette: pal };
  await js(`(() => {
    window.requestAnimationFrame = () => 0; cancelAnimationFrame(viz.raf);
    Object.defineProperty(document, 'hidden', { get: () => false });   // a headless page can turn hidden, and the page draws nothing while it is
    api = async (p) => p === '/listen/now' ? { now: ${JSON.stringify(NOW)}, feed: ${JSON.stringify(FEED)} } : { ticket: '' };
    const clk = document.querySelector('#clock'), mine = clk.cloneNode(); mine.id = 'clock2'; clk.replaceWith(mine);   // the page's own clock runs on the wall's time: this one on the clip's
    document.querySelector('#gate').classList.add('off'); document.body.classList.add('rest');
    now = ${JSON.stringify(NOW)}; viz.feed = ${JSON.stringify(FEED)};
    viz.pal = viz.feed.palette.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    viz.artUrl = viz.feed.artwork; if (viz.artUrl) vizArtLoad(viz.artUrl);
    if (viz.feed.artworkMode !== 'focal') { const card = document.querySelector('#card'); card.src = now.metadata.artwork; card.classList.add('on'); }   // as the page's own poll does
    try { drawInfo(); } catch (e) {}
    window.__step = (i, bands) => { for (let k = 0; k < 48; k++) viz.bands[k] = bands[k]; draw(100000 + i * 1000 / 30); const s = 61 + i / 30; document.querySelector('#clock2').textContent = Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') + ' / 3:34'; document.body.classList.add('rest'); };
    return true; })()`);
  await sleep(800);
  for (let i = Math.max(0, first - 300); i < first; i++) await js(`__step(${i - first}, ${JSON.stringify(levels(i))})`);   // the scene warmed up on the ten seconds before
  mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < count && first + i < lines.length; i++) {
    await js(`__step(${i}, ${JSON.stringify(levels(first + i))})`);
    let shot = null;   // a headless page now and then gives no picture: asked again, the frame is the same one (nothing steps in between)
    for (let tries = 0; !shot; tries++) { try { shot = await cdp("Page.captureScreenshot", { format: "png" }); } catch (e) { if (tries >= 5) throw e; await cdp("Page.bringToFront").catch(() => {}); } }
    writeFileSync(join(outDir, "f" + String(i).padStart(4, "0") + ".png"), Buffer.from(shot.data, "base64"));
  }
  console.log("frames", count, "in", outDir, "| song", song, "| artist", album.artist, "| album", album.album);
} finally {
  try { ws.close(); } catch {}
  try { spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch { proc.kill(); }   // the browser's whole tree: kill() leaves its children running
  server.close();
}
