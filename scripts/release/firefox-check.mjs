/*
  The PRISM extension's Firefox build, walked in a hidden Firefox before a release (2026-11-19). Dev tooling: nothing here ships.

      node scripts/release/firefox-check.mjs [<built folder>]      (default prototypes/prism-veil-extension/dist/firefox)

  Why: 0.9.41 went to the store with a settings panel whose Close did nothing in Firefox. Firefox gives a frame of the extension
  inside a web page no tabs calls, the panel is such a frame, and the tests run in a made-up page that has every call. This
  walk is in the browser itself.

  What it does, on a COPY of the built folder in the temp folder (the build is never changed):
  - adds three test files to the copy: a page script that opens the settings as the PRISM button's menu does, and an error
    catcher in the background and in the settings page (a thrown error, a refused promise, a console.error). The page's own
    log does not carry those two, so they are gathered here;
  - opens a plain page, opens the settings over it, and reads: the page was told the panel's height, the panel names the
    site, Picture detection can be switched, Close closes;
  - serves a page of its own on 127.0.0.1 with a silent moving picture in a <video> (drawn on a canvas, no file, no sound track),
    turns Picture detection on for that address as the settings do (pv:ui in the extension's storage), and reads that the
    reader comes on and judges a frame about once a second (the state the reader writes on the page in a development install);
  - prints every error gathered from the page's scripts, the settings page and the background.
  Exit 0 when every check passes and no error was gathered, 1 otherwise, 2 when Firefox is not installed (said loudly).

  A fresh profile, no sign-in, no sound (the page plays nothing), nothing on the screen.
*/
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIREFOX, launchFirefox } from "../doctor/bidi.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const built = resolve(process.argv[2] || join(here, "..", "..", "prototypes", "prism-veil-extension", "dist", "firefox"));
const PAGE = "https://example.com/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(FIREFOX)) { console.log("FIREFOX CHECK NOT RUN: no Firefox at " + FIREFOX + " (PRISM_FIREFOX names another)"); process.exit(2); }
if (!existsSync(join(built, "manifest.json"))) { console.log("no built Firefox folder at " + built + " (node build-firefox.mjs makes it)"); process.exit(1); }

// ---- the copy, with the test files
const copy = mkdtempSync(join(tmpdir(), "prism-ffcheck-"));
cpSync(built, copy, { recursive: true });
const manifest = JSON.parse(readFileSync(join(copy, "manifest.json"), "utf8"));
const CATCH = [
  "(function () {",
  "  var where = WHERE, seen = [];",
  "  function say(kind, text) {",
  "    var e = { where: where, kind: kind, text: String(text).slice(0, 300) };",
  "    if (where === 'background') seen.push(e);",
  "    else { try { chrome.runtime.sendMessage({ type: 't-error', e: e }, function () { void chrome.runtime.lastError; }); } catch (x) {} }",
  "  }",
  "  addEventListener('error', function (ev) { say('thrown', (ev.message || ev.error) + ' @ ' + String(ev.filename || '').replace(/^moz-extension:\\/\\/[^/]+/, '') + ':' + ev.lineno); });",
  "  addEventListener('unhandledrejection', function (ev) { say('refused promise', ev.reason && ev.reason.message || ev.reason); });",
  "  var ce = console.error; console.error = function () { try { say('console.error', [].map.call(arguments, String).join(' ')); } catch (x) {} return ce.apply(console, arguments); };",
  "  if (where === 'background') chrome.runtime.onMessage.addListener(function (msg, sender, reply) {",
  "    if (msg && msg.type === 't-error') { seen.push(msg.e); return; }",
  "    if (msg && msg.type === 't-errors') { reply(seen); return; }",
  "  });",
  "})();",
].join("\n");
writeFileSync(join(copy, "t-catch-bg.js"), CATCH.replace("WHERE", "'background'"));
writeFileSync(join(copy, "t-catch-page.js"), CATCH.replace("WHERE", "'settings page'"));
writeFileSync(join(copy, "t-open.js"), [
  "document.addEventListener('t-open', function () { chrome.runtime.sendMessage({ type: 'prism-open-settings' }, function () { void chrome.runtime.lastError; }); });",
  "document.addEventListener('t-live', function () { chrome.storage.local.get('pv:ui', function (r) { var ui = (r && r['pv:ui']) || {}; ui.livePicture = true; ui.liveTvSites = ['127.0.0.1']; chrome.storage.local.set({ 'pv:ui': ui }, function () { document.documentElement.setAttribute('data-t-live', 'set'); }); }); });",
  "document.addEventListener('t-errors', function () { chrome.runtime.sendMessage({ type: 't-errors' }, function (r) { void chrome.runtime.lastError; document.documentElement.setAttribute('data-t-errors', JSON.stringify(r || [])); }); });",
].join("\n"));
manifest.background.scripts = ["t-catch-bg.js"].concat(manifest.background.scripts || []);
manifest.content_scripts.push({ matches: [PAGE + "*", "http://127.0.0.1/*"], js: ["t-open.js"], run_at: "document_idle" });
writeFileSync(join(copy, "manifest.json"), JSON.stringify(manifest));
const html = readFileSync(join(copy, "popup.html"), "utf8");
if (html.indexOf("<head>") < 0) { console.log("popup.html has no <head> to put the error catcher in"); process.exit(1); }
writeFileSync(join(copy, "popup.html"), html.replace("<head>", '<head><script src="t-catch-page.js"></script>'));

// ---- the silent film: a canvas that changes every frame, played by a <video> as a stream (no file, no sound track)
const FILM = `<!doctype html><meta charset="utf-8"><title>PRISM check film</title><body style="margin:0;background:#101318">
<video id="v" muted playsinline style="display:block;width:960px;height:540px"></video>
<script>
var c = document.createElement("canvas"); c.width = 640; c.height = 360; var g = c.getContext("2d"), n = 0;
setInterval(function () { n++; g.fillStyle = "hsl(" + (n * 7 % 360) + ",60%,40%)"; g.fillRect(0, 0, 640, 360);
  g.fillStyle = "#fff"; g.fillRect((n * 9) % 640, 120, 90, 90); g.font = "40px sans-serif"; g.fillText("frame " + n, 40, 300); }, 100);
var v = document.getElementById("v"); v.srcObject = c.captureStream(10); v.play();
</script>`;
const server = createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(FILM); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const FILM_URL = "http://127.0.0.1:" + server.address().port + "/";

// ---- the walk
const checks = [], errors = [];
const check = (name, ok, got) => { checks.push({ name, ok: !!ok, got }); };
const HOST = 'function () { var s = document.querySelector("div[data-prism-settings-h]"); var all = [].filter.call(document.documentElement.children, function (e) { return e.tagName === "DIV" && e.hasAttribute("data-prism-ui") && !e.childElementCount; }); return JSON.stringify({ height: s ? s.getAttribute("data-prism-settings-h") : null, hosts: all.length }); }';
const ff = await launchFirefox({});
let failed = null;
try {
  await ff.call("session.subscribe", { events: ["log.entryAdded"] });
  await ff.install(copy);
  await ff.navigate(PAGE); await wait(2500);
  const before = JSON.parse(await ff.run(HOST));
  await ff.run('function () { document.dispatchEvent(new Event("t-open")); return 1; }'); await wait(3500);
  const tree = await ff.call("browsingContext.getTree", {});
  const frame = (tree.contexts[0].children || []).find((c) => /\/popup\.html\?/.test(c.url));
  check("the settings open over the page", !!frame, frame ? "a frame of the extension" : "no frame");
  if (frame) {
    const open = JSON.parse(await ff.run(HOST));
    check("the page was told the panel's height", open.height && +open.height > 200, "height " + open.height);
    const r = await ff.call("script.callFunction", { awaitPromise: false, target: { context: frame.context }, functionDeclaration:
      'function () { var p = document.getElementById("live-picture"), c = document.getElementById("settings-close"); var out = JSON.stringify({ shown: document.documentElement.style.display !== "none", site: /example\\.com/.test(document.body.innerText), picture: !!p && !p.disabled, close: !!c && !c.hidden }); if (c) c.click(); return out; }' });
    const inFrame = r.type === "exception" ? {} : JSON.parse(r.result.value);
    check("the settings page is shown in its frame", inFrame.shown, JSON.stringify(inFrame));
    check("the panel names the site", inFrame.site, "site named: " + inFrame.site);
    check("Picture detection can be switched", inFrame.picture, "enabled: " + inFrame.picture);
    check("the panel has its Close button", inFrame.close, "shown: " + inFrame.close);
    await wait(1200);
    const after = JSON.parse(await ff.run(HOST));
    check("Close closes the panel", after.hosts < open.hosts || (after.height === null && open.height !== null), "panels before " + before.hosts + ", open " + open.hosts + ", after Close " + after.hosts);
  }
  // the picture reader on the silent film
  await ff.navigate(FILM_URL); await wait(2000);
  const film = JSON.parse(await ff.run('function () { var v = document.querySelector("video"); return JSON.stringify({ playing: !!v && !v.paused && v.videoWidth > 0, muted: !!v && v.muted }); }'));
  check("the test film plays, muted", film.playing && film.muted, JSON.stringify(film));
  await ff.run('function () { document.dispatchEvent(new Event("t-live")); return 1; }'); await wait(1500);
  const READ = 'function () { return document.documentElement.getAttribute("data-prism-live-picture") || ""; }';
  let st1 = await ff.run(READ);
  if (!st1) { await ff.navigate(FILM_URL); await wait(3000); st1 = await ff.run(READ); }   // the reader is put into pages opened after the switch
  await wait(4000); const a = String(await ff.run(READ)).split("|");
  await wait(8000); const b = String(await ff.run(READ)).split("|");
  check("the picture reader comes on", b[0] === "on", "state " + (b[0] || "(none)"));
  check("the reader judges frames, about one a second", +b[1] - +a[1] >= 5 && +b[1] - +a[1] <= 10, (+b[1] - +a[1]) + " frames in 8 s (" + a[1] + " to " + b[1] + "), the model's chance of a break " + b[4] + ", cover " + b[5]);
  await ff.run('function () { document.dispatchEvent(new Event("t-errors")); return 1; }'); await wait(800);
  const gathered = JSON.parse((await ff.run('function () { return document.documentElement.getAttribute("data-t-errors") || "null"; }')) || "null");
  check("the background answered for its errors", Array.isArray(gathered), Array.isArray(gathered) ? gathered.length + " gathered" : "no answer");
  (gathered || []).forEach((e) => errors.push(e));
  ff.events.filter((e) => e.method === "log.entryAdded" && e.params.level === "error")
    .forEach((e) => errors.push({ where: "page scripts", kind: e.params.type, text: String(e.params.text).slice(0, 300) }));
} catch (e) { failed = e; } finally { await ff.close(); server.close(); try { rmSync(copy, { recursive: true, force: true }); } catch { /* the temp folder's own cleanup */ } }

console.log("Firefox check, version " + manifest.version + " (" + built + ")");
checks.forEach((c) => console.log("  " + (c.ok ? "ok  " : "FAIL") + "  " + c.name + "  [" + c.got + "]"));
console.log("  errors gathered: " + errors.length);
errors.forEach((e) => console.log("    " + e.where + " / " + e.kind + ": " + e.text));
if (failed) console.log("  the walk stopped: " + failed.message);
const bad = failed || errors.length || checks.some((c) => !c.ok) || checks.length < 11;
console.log(bad ? "FIREFOX CHECK FAILED" : "Firefox check passed: " + checks.length + " checks, no errors");
process.exit(bad ? 1 : 0);
