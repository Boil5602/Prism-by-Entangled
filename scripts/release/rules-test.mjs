#!/usr/bin/env node
/*
  The stand-in test of a rule update (docs/features/rule-updates.md): the real packages, in a headless Chromium and a headless
  Firefox, on the made-up pages in assets/store/standin/, first with the packaged rules alone and then with this exact rule file
  in the extension's storage as the background would have kept it.

    node scripts/release/rules-test.mjs <rules.json> <expect.json> [--only chromium|firefox]

  It passes when, in every browser:
    - the file passes the extension's own schema check (src/rules-pack.js) for the version in the tree;
    - a page the file is not meant to change has exactly the covers it had before;
    - each page in expect.json has the covers it names: { host, page, why: { "update: <id>": count }, total? };
    - no cover is as large as half the window.
  On a pass with both browsers it writes scripts/release/out/rules/tested.json with the file's SHA-256. publish-rules.py uploads a
  file only when that hash is the hash of the file it is about to send.

  Sealed: the made-up host names go to this PC and nothing else is reachable. Nothing on the pages draws a cover. No Node
  packages (Node 22 or newer). CHROME and FIREFOX name other browsers.
*/
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const EXT = path.join(ROOT, "prototypes", "prism-veil-extension");
const PAGES = path.join(ROOT, "assets", "store", "standin");
const OUT = path.join(HERE, "out", "rules");
const CHROME = process.env.CHROME || path.join(os.homedir(), "AppData", "Local", "ms-playwright", "chromium-1248", "chrome-win64", "chrome.exe");
const FIREFOX = process.env.FIREFOX || "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const GECKO_ID = "prism-veil@entangled.world", FF_UUID = "5b1d6a0e-3c1f-4e0a-9a53-2f6f0c8d7e11";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2), files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--only");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
if (files.length < 2) { console.error("usage: rules-test.mjs <rules.json> <expect.json> [--only chromium|firefox]"); process.exit(2); }
const rulesPath = path.resolve(files[0]), expectPath = path.resolve(files[1]);
const bytes = fs.readFileSync(rulesPath), sha256 = createHash("sha256").update(bytes).digest("hex");
const rulesFile = JSON.parse(bytes.toString("utf8"));
const expect = JSON.parse(fs.readFileSync(expectPath, "utf8"));
const version = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")).version;

// the extension's own reader, as it is in the tree
vm.runInThisContext(fs.readFileSync(path.join(EXT, "src", "rules-pack.js"), "utf8"));
const RP = globalThis.PrismRulesPack;
const report = { file: rulesPath, sha256, serial: rulesFile.serial, version, browsers: {}, problems: [] };
const fail = (m) => report.problems.push(m);
const v = RP.validate(rulesFile, version);
if (!v.ok) fail("the file does not pass the schema: " + v.error);
if (bytes.length > RP.LIMITS.bytes) fail("the file is " + bytes.length + " bytes");
if (v.ok && !RP.newer(v.rules.serial, RP.BASE_SERIAL)) fail("the serial " + v.rules.serial + " is not newer than the package's own rules (" + RP.BASE_SERIAL + ")");

const BASELINE = [
  { host: "quillhaven-courier.example", page: "news.html" },
  { host: "loopline.example", page: "feed.html" },
  { host: "saltmarsh-kitchen.example", page: "recipes.html" },
];
const wanted = (expect.pages || []).map((p) => ({ host: p.host, page: p.page, why: p.why || {}, total: p.total }));
const key = (p) => p.host + "/" + p.page;
const all = BASELINE.filter((b) => !wanted.some((w) => key(w) === key(b))).concat(wanted);
const hosts = Array.from(new Set(all.map((p) => p.host)));
for (const p of all) if (!fs.existsSync(path.join(PAGES, p.page))) fail("no stand-in page " + p.page);
for (const b of ["chromium", "firefox"]) {
  const mf = path.join(EXT, "dist", b, "manifest.json");
  if (!fs.existsSync(mf) || JSON.parse(fs.readFileSync(mf, "utf8")).version !== version || !fs.existsSync(path.join(EXT, "dist", b, "src", "rules-pack.js"))) fail("dist/" + b + " is not a build of " + version + ": run node build-firefox.mjs first");
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const server = http.createServer((req, res) => {
  const name = path.basename(decodeURIComponent((req.url || "/").split("?")[0])), file = path.join(PAGES, name);
  if (!TYPES[path.extname(name)] || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(name)], "cache-control": "no-store" }); res.end(fs.readFileSync(file));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const port = server.address().port;
const urlOf = (p) => "http://" + p.host + ":" + port + "/" + p.page;

const COVERS = `JSON.stringify({ w: innerWidth, h: innerHeight, version: document.documentElement.getAttribute("data-prism-version") || "", title: document.title,
  covers: Array.from(document.querySelectorAll("[data-prism-why]")).map(function (c) { var r = c.getBoundingClientRect(); return { why: c.getAttribute("data-prism-why"), w: Math.round(r.width), h: Math.round(r.height) }; }) })`;
// a page's covers once they have stood still for a second and a half (four seconds at least, twelve at most)
async function settled(read) {
  const t0 = Date.now(); let last = "", since = Date.now(), got = null;
  while (Date.now() - t0 < 12000) {
    await sleep(500);
    try { got = JSON.parse(await read()); } catch (e) { continue; }
    const sig = JSON.stringify(got.covers);
    if (sig !== last) { last = sig; since = Date.now(); }
    if (Date.now() - t0 >= 4000 && Date.now() - since >= 1500) break;
  }
  return got || { covers: [], version: "", title: "" };
}
const SEED = (file) => `new Promise(function (r) { chrome.storage.local.set({ "pv:ui": { packUpdates: true }, "pv:rules": { serial: ${JSON.stringify(file.serial)}, date: ${JSON.stringify(file.date || "")}, notes: "", at: Date.now(), file: ${JSON.stringify(file)} } }, function () { r("seeded"); }); })`;

async function chromium() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "prism-rules-cr-"));
  fs.writeFileSync(path.join(profile, "Local State"), JSON.stringify({ dns_over_https: { mode: "off" } }));
  const ext = path.join(EXT, "dist", "chromium");
  const proc = spawn(CHROME, ["--headless=new", "--mute-audio", "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--load-extension=" + ext, "--disable-extensions-except=" + ext, "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--window-size=1280,800", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--host-resolver-rules=" + hosts.map((h) => "MAP " + h + " 127.0.0.1").concat(["MAP * ~NOTFOUND"]).join(", "),
    "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=" + hosts.concat(["127.0.0.1"]).join(";"), "about:blank"], { stdio: "ignore", windowsHide: true });
  const out = { before: {}, after: {} };
  try {
    let wsUrl = "";
    for (let i = 0; i < 150 && !wsUrl; i++) { await sleep(100); try { const t = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n"); if (t[1]) wsUrl = "ws://127.0.0.1:" + t[0].trim() + t[1].trim(); } catch (e) {} }
    if (!wsUrl) throw new Error("no DevTools port");
    const ws = new WebSocket(wsUrl); await new Promise((ok, no) => { ws.addEventListener("open", ok); ws.addEventListener("error", no); });
    let id = 0; const waits = new Map();
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
    const send = (method, params = {}, sessionId) => new Promise((r) => { const n = ++id; waits.set(n, r); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });
    let extId = "";
    for (let i = 0; i < 100 && !extId; i++) { const t = (await send("Target.getTargets")).result.targetInfos.find((x) => x.type === "service_worker" && /\/bg\.js$/.test(x.url)); if (t) extId = new URL(t.url).host; else await sleep(100); }
    if (!extId) throw new Error("the extension did not load");
    const open = async (url) => {
      const targetId = (await send("Target.createTarget", { url })).result.targetId;
      const s = (await send("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
      const ev = async (expression) => { const r = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s)).result; if (r.exceptionDetails) throw new Error("evaluate failed"); return r.result.value; };
      return { ev, close: () => send("Target.closeTarget", { targetId }) };
    };
    const pass = async (into) => { for (const p of all) { const pg = await open(urlOf(p)); into[key(p)] = await settled(() => pg.ev(COVERS)); await pg.close(); } };
    await pass(out.before);
    const pop = await open("chrome-extension://" + extId + "/popup.html"); await sleep(1000);
    out.seed = await pop.ev(SEED(rulesFile)); await sleep(500); await pop.close();
    await pass(out.after);
    try { await send("Browser.close"); } catch (e) {}
  } catch (e) { out.error = String(e && e.message || e); }
  await sleep(500); try { proc.kill(); } catch (e) {} await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  return out;
}

async function firefox() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "prism-rules-ff-"));
  const pref = (k, val) => "user_pref(" + JSON.stringify(k) + ", " + JSON.stringify(val) + ");";
  fs.writeFileSync(path.join(profile, "user.js"), [
    pref("extensions.webextensions.uuids", JSON.stringify({ [GECKO_ID]: FF_UUID })),
    pref("browser.shell.checkDefaultBrowser", false), pref("datareporting.policy.dataSubmissionEnabled", false), pref("browser.aboutwelcome.enabled", false),
    pref("app.update.enabled", false), pref("network.dns.localDomains", hosts.join(",")),
    // sealed: everything but the made-up hosts goes to a proxy that is not there
    pref("network.proxy.type", 1), pref("network.proxy.http", "127.0.0.1"), pref("network.proxy.http_port", 9), pref("network.proxy.ssl", "127.0.0.1"), pref("network.proxy.ssl_port", 9),
    pref("network.proxy.no_proxies_on", hosts.concat(["127.0.0.1", "localhost"]).join(",")), pref("network.proxy.allow_hijacking_localhost", false),
  ].join("\n"));
  const rdp = 9300 + Math.floor(Math.random() * 400);
  const proc = spawn(FIREFOX, ["-headless", "-no-remote", "-new-instance", "-profile", profile, "--remote-debugging-port", String(rdp), "-remote-allow-system-access"], { stdio: "ignore", windowsHide: true });
  const out = { before: {}, after: {} };
  try {
    let ws = null;
    for (let i = 0; i < 80 && !ws; i++) { await sleep(500); try { const w = new WebSocket("ws://127.0.0.1:" + rdp + "/session"); await new Promise((ok, no) => { w.addEventListener("open", ok); w.addEventListener("error", no); }); ws = w; } catch (e) {} }
    if (!ws) throw new Error("no BiDi socket");
    let id = 0; const waits = new Map();
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
    const send = (method, params = {}) => new Promise((ok, no) => { const n = ++id; waits.set(n, (m) => m.type === "error" ? no(new Error(method + ": " + m.error + " " + m.message)) : ok(m.result)); ws.send(JSON.stringify({ id: n, method, params })); });
    await send("session.new", { capabilities: {} });
    await send("webExtension.install", { extensionData: { type: "path", path: path.join(EXT, "dist", "firefox") } });
    await sleep(2500);
    const evalIn = async (context, expression) => { const r = await send("script.evaluate", { expression, target: { context }, awaitPromise: true }); if (r.type !== "success") throw new Error("evaluate failed"); return r.result.value; };
    const pass = async (into) => {
      for (const p of all) {
        const ctx = (await send("browsingContext.create", { type: "tab" })).context;
        await send("browsingContext.navigate", { context: ctx, url: urlOf(p), wait: "complete" });
        into[key(p)] = await settled(() => evalIn(ctx, COVERS));
        await send("browsingContext.close", { context: ctx });
      }
    };
    await pass(out.before);
    const win = (await send("browsingContext.getTree", { "moz:scope": "chrome" })).contexts[0].context;
    const popup = "moz-extension://" + FF_UUID + "/popup.html";
    await evalIn(win, `gBrowser.selectedTab = gBrowser.addTab(${JSON.stringify(popup)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); "ok"`);
    let pctx = "";
    for (let i = 0; i < 40 && !pctx; i++) { await sleep(500); const c = (await send("browsingContext.getTree", {})).contexts.find((x) => x.url === popup); if (c) pctx = c.context; }
    if (!pctx) throw new Error("the settings page did not open");
    await sleep(1500);
    out.seed = await evalIn(pctx, SEED(rulesFile)); await sleep(500);
    await pass(out.after);
    try { await send("browser.close"); } catch (e) {}
  } catch (e) { out.error = String(e && e.message || e); }
  await sleep(1000); try { proc.kill(); } catch (e) {} await sleep(1000);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  return out;
}

function judge(name, run) {
  const said = (m) => fail(name + ": " + m);
  if (run.error) { said(run.error); return; }
  if (run.seed !== "seeded") said("the rule file was not put into storage");
  const tally = (covers) => { const t = {}; covers.forEach((c) => { t[c.why] = (t[c.why] || 0) + 1; }); return t; };
  for (const p of all) {
    const k = key(p), b = run.before[k], a = run.after[k];
    if (!b || !a) { said(k + " was not read"); continue; }
    if (!a.title) said(k + ": the page did not load");
    for (const c of a.covers) if (c.w * c.h >= a.w * a.h * 0.5) said(k + ": a cover of " + c.w + "x" + c.h + " (" + c.why + ") is half the window or more");
    const tb = tally(b.covers), ta = tally(a.covers), want = wanted.find((w) => key(w) === k);
    if (!want) { if (JSON.stringify(Object.entries(tb).sort()) !== JSON.stringify(Object.entries(ta).sort())) said(k + ": the covers changed, " + JSON.stringify(tb) + " before and " + JSON.stringify(ta) + " with the file"); continue; }
    for (const why of Object.keys(want.why)) if ((ta[why] || 0) !== want.why[why]) said(k + ": " + (ta[why] || 0) + " covers for \"" + why + "\", " + want.why[why] + " expected");
    if (want.total !== undefined && a.covers.length !== want.total) said(k + ": " + a.covers.length + " covers in all, " + want.total + " expected (" + JSON.stringify(ta) + ")");
  }
}

if (!report.problems.length) {
  const todo = ["chromium", "firefox"].filter((b) => !only || b === only);
  for (const b of todo) { const run = b === "chromium" ? await chromium() : await firefox(); report.browsers[b] = run; judge(b, run); }
  report.passed = !report.problems.length;
  if (report.passed && todo.length === 2) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, "tested.json"), JSON.stringify({ sha256, file: path.relative(ROOT, rulesPath).replace(/\\/g, "/"), serial: rulesFile.serial, version, at: new Date().toISOString(), browsers: todo, pages: all.map(key) }, null, 1) + "\n");
    report.recorded = path.join(OUT, "tested.json");
  }
} else report.passed = false;
server.close();
const brief = {};
for (const b of Object.keys(report.browsers)) { brief[b] = {}; for (const k of Object.keys(report.browsers[b].after || {})) brief[b][k] = { before: (report.browsers[b].before[k] || { covers: [] }).covers.map((c) => c.why), after: report.browsers[b].after[k].covers.map((c) => c.why) }; }
console.log(JSON.stringify({ file: report.file, sha256, serial: report.serial, version, passed: report.passed, recorded: report.recorded || "", problems: report.problems, covers: brief }, null, 1));
process.exit(report.passed ? 0 : 1);
