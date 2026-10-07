// Fixtures for the companion's Home Screen nudge (docs/features/companion-install.md, 2026-10-05): the phone page's install block, lifted
// out of RemotePage.cs and run under stubs - absent when installed, unpaired or on a desktop; Not now for 14 days; Don't show again and an
// install for good; iOS's two steps and no button; Android's button only once beforeinstallprompt fired; nothing fetched; the 10 s timer
// is the only way in. A verify step (scripts/verify.mjs).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cs = readFileSync(path.join(root, "targets/win-host/PrismHost/Services/RemotePage.cs"), "utf8");
const html = cs.slice(cs.indexOf('"""') + 3, cs.lastIndexOf('"""'));
const js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
// syntax of the whole page script
new Function(js);
// the nudge block alone
const start = js.indexOf("const INSTALL_KEY"), end = js.indexOf("setTimeout(showInstall, 10000);");
const block = js.slice(start, end);

function run({ standalone = false, ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", stored = null, paired = true, prompt = null, touch = 5, width = 390 } = {}) {
  const store = new Map(); if (stored) store.set("prism.install", JSON.stringify(stored));
  const els = {};
  const el = (id) => {
    if (els[id]) return els[id];
    const e = { id, classes: new Set(), style: {}, innerHTML: "", children: [] };
    e.classList = { add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c), contains: (c) => e.classes.has(c) };
    e.appendChild = (c) => e.children.push(c);
    return (els[id] = e);
  };
  const q = (sel) => el(sel.replace("#", ""));
  const fetches = [];
  const ctx = {
    q, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    window: { matchMedia: () => ({ matches: standalone }), addEventListener() {} },
    navigator: { standalone: false, userAgent: ua, platform: "iPhone", maxTouchPoints: touch }, screen: { width, height: 844 },
    document: { createElement: () => ({ innerHTML: "", appendChild() {}, set textContent(v) {} }), createTextNode: (t) => t },
    installPrompt: prompt, installPaired_: paired, fetch: (...a) => { fetches.push(a); return Promise.resolve({}); }, Date,
  };
  const body = block.replace("let installPaired = false, installShown = false;", "let installPaired = installPaired_, installShown = false;") + "\nreturn { showInstall, installEligible, installState, q };";
  const fn = new Function(...Object.keys(ctx), body);
  const r = fn(...Object.values(ctx));
  r.showInstall();
  return { shown: q("#install").classes.has("on"), steps: q("#installSteps").children.length, button: q("#installGo").style.display !== "none", store, fetches, api: r };
}
const assert = (c, m) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };

assert(!run({ standalone: true }).shown, "absent in standalone mode");
assert(!run({ paired: false }).shown, "absent when the page is not paired");
assert(!run({ touch: 0, width: 1400 }).shown, "absent on a desktop-class device");
assert(!run({ stored: { later: Date.now() - 3 * 24 * 3600 * 1000 } }).shown, "Not now suppresses it for 14 days");
assert(run({ stored: { later: Date.now() - 15 * 24 * 3600 * 1000 } }).shown, "and it comes back after 14 days");
assert(!run({ stored: { never: true } }).shown, "Don't show again suppresses it for good");
assert(!run({ stored: { installed: true } }).shown, "an install suppresses it for good");
const ios = run();
assert(ios.shown && ios.steps === 2 && !ios.button, "iOS shows the two-step overlay and no button");
const iosChrome = run({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/118.0 Mobile/15E148 Safari/604.1" });
assert(iosChrome.shown && iosChrome.steps === 2 && !iosChrome.button, "another iOS browser shows the same two steps");
const androidNoEvent = run({ ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36" });
assert(androidNoEvent.shown && androidNoEvent.steps === 2 && !androidNoEvent.button, "Android without beforeinstallprompt shows its own two steps, no button");
const androidEvent = run({ ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36", prompt: { prompt() {}, userChoice: Promise.resolve({ outcome: "accepted" }) } });
assert(androidEvent.shown && androidEvent.steps === 0 && androidEvent.button, "Android with beforeinstallprompt shows the button only");
assert(ios.fetches.length === 0 && androidEvent.fetches.length === 0, "no network request carries prompt state");
// the timer: the only call to showInstall outside a handler is the 10 s one
assert(/setTimeout\(showInstall, 10000\)/.test(js) && (js.match(/showInstall\(\)/g) || []).length === 1, "appears on the 10 s timer only, never on first paint");
