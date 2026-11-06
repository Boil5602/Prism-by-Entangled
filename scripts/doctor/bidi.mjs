/*
  Headless Firefox over WebDriver BiDi, for the doctor (scripts/doctor, 2026-11-03). Dev tooling only: nothing here ships.

  A fresh profile in a temp folder every run (no sign-ins, no cookies, no history: a page is read as a stranger sees it), the
  Veil installed from its built Firefox package when asked, one tab, a function run in the page, a screenshot when asked, and
  the profile deleted at the end. Built from the notes of the 2026-09-23 harness (memory: firefox-bidi-harness): raw BiDi over
  Node's own WebSocket, no Playwright.
*/
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIREFOX = process.env.PRISM_FIREFOX || "C:/Program Files/Mozilla Firefox/firefox.exe";

const PREFS = [
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
  'user_pref("toolkit.telemetry.enabled", false);',
  'user_pref("app.update.enabled", false);',
  'user_pref("app.update.auto", false);',
  'user_pref("browser.startup.homepage", "about:blank");',
  'user_pref("browser.startup.page", 0);',
  'user_pref("browser.aboutwelcome.enabled", false);',
  'user_pref("remote.active-protocols", 1);',
  'user_pref("extensions.autoDisableScopes", 0);',
  'user_pref("xpinstall.signatures.required", false);',
  'user_pref("media.autoplay.default", 0);',
  'user_pref("media.autoplay.blocking_policy", 0);',
  'user_pref("privacy.trackingprotection.enabled", false);',
  'user_pref("dom.disable_beforeunload", true);',
];

/** Launches Firefox and opens a BiDi session. Returns { call, close, context, install, navigate, run, screenshot, log }. */
export async function launchFirefox({ headless = true, width = 1600, height = 900, log = () => {} } = {}) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), "prism-doctor-"));
  writeFileSync(join(profile, "user.js"), PREFS.join("\n") + "\n");
  const args = ["-no-remote", "-new-instance", "-profile", profile, "--remote-debugging-port", String(port), "-remote-allow-system-access", "-width", String(width), "-height", String(height)];
  if (headless) args.unshift("-headless");
  const proc = spawn(FIREFOX, args, { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.stderr.on("data", (d) => { out += d; });
  // Firefox says when ready; a connect attempt a second is the fallback.
  const ws = await new Promise((resolve, reject) => {
    const started = Date.now();
    const tryConnect = () => {
      if (proc.exitCode !== null) return reject(new Error("Firefox exited: " + out.slice(-400)));
      if (Date.now() - started > 30000) return reject(new Error("Firefox gave no BiDi endpoint in 30 s: " + out.slice(-400)));
      const s = new WebSocket("ws://127.0.0.1:" + port + "/session");
      s.onopen = () => resolve(s);
      s.onerror = () => { s.onclose = null; setTimeout(tryConnect, 500); };
    };
    setTimeout(tryConnect, 700);
  });
  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.type === "error") p.reject(new Error(m.error + ": " + m.message)); else p.resolve(m.result); }
    else if (m.method) events.push(m);
  };
  ws.onclose = () => { for (const p of pending.values()) p.reject(new Error("BiDi socket closed")); pending.clear(); };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await call("session.new", { capabilities: {} });
  const tree = await call("browsingContext.getTree", {});
  let context = tree.contexts?.[0]?.context;
  if (!context) context = (await call("browsingContext.create", { type: "tab" })).context;
  try { await call("browsingContext.setViewport", { context, viewport: { width, height } }); } catch (e) { log("viewport: " + e.message); }

  const api = {
    call, context, events, log,
    /** The Veil (or any extension folder) installed; its id comes back. */
    install: async (path) => (await call("webExtension.install", { extensionData: { type: "path", path } })).extension,
    /** Navigates and waits for the load event (wait "complete"), with a cap: heavy ad pages never finish loading. */
    navigate: async (url, { wait = "complete", capMs = 25000 } = {}) => {
      const nav = call("browsingContext.navigate", { context, url, wait });
      const cap = new Promise((r) => setTimeout(() => r({ capped: true }), capMs));
      const r = await Promise.race([nav, cap]);
      if (r?.capped) log("navigate: load did not complete in " + capMs + " ms, reading the page as it stands");
      return r;
    },
    /** Runs a function in the page (its source as a string, `function (a, b) { ... }`), awaiting a promise it returns; the value comes back as the page serialised it. */
    run: async (fn, args = [], { awaitPromise = true } = {}) => {
      const r = await call("script.callFunction", {
        functionDeclaration: fn, target: { context }, awaitPromise, resultOwnership: "none",
        arguments: args.map((a) => typeof a === "number" ? { type: "number", value: a } : typeof a === "boolean" ? { type: "boolean", value: a } : { type: "string", value: String(a) }),
        serializationOptions: { maxDomDepth: 0, maxObjectDepth: 4 },
      });
      if (r.type === "exception") throw new Error("page threw: " + JSON.stringify(r.exceptionDetails?.text ?? r.exceptionDetails).slice(0, 400));
      return remoteValue(r.result);
    },
    /** A PNG of the viewport, base64. */
    screenshot: async () => (await call("browsingContext.captureScreenshot", { context, origin: "viewport" })).data,
    close: async () => {
      try { await Promise.race([call("browser.close", {}), new Promise((r) => setTimeout(r, 3000))]); } catch { /* closing */ }
      try { ws.close(); } catch { /* closed */ }
      try { proc.kill(); } catch { /* gone */ }
      await new Promise((r) => setTimeout(r, 500));
      for (let i = 0; i < 5; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 700)); } }
    },
  };
  return api;
}

/** A BiDi RemoteValue to a plain value (strings, numbers, booleans, arrays and objects; anything else its type name). */
function remoteValue(v) {
  if (!v || typeof v !== "object") return v;
  switch (v.type) {
    case "string": case "number": case "boolean": return v.value;
    case "null": return null;
    case "undefined": return undefined;
    case "array": return (v.value ?? []).map(remoteValue);
    case "object": { const o = {}; for (const [k, x] of v.value ?? []) o[typeof k === "string" ? k : remoteValue(k)] = remoteValue(x); return o; }
    default: return "[" + v.type + "]";
  }
}
