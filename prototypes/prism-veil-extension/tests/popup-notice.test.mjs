// The button's notice of a blocked popup is not used up where nobody can see it (2026-11-10: the toolbar's count showed popups
// the button had never mentioned). The count was taken, and its one notice spent, while the button was not yet made (a popup at the
// page's load), hidden for fullscreen, or in a tab behind another. src/popups-ui.js now holds the count until the button can show it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, "..", "src", f), "utf8");
const realAttach = Element.prototype.attachShadow;

function load({ holdBoot = false } = {}) {
  window.__prismVeilNS = undefined;
  window.PrismPopups = undefined;
  let hidden = false, fullscreen = null, release = null;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
  Object.defineProperty(document, "pictureInPictureElement", { configurable: true, get: () => null });
  // the button's shadow root is closed; the test opens it to read the label
  Element.prototype.attachShadow = function () { return realAttach.call(this, { mode: "open" }); };
  window.chrome = {
    storage: {
      local: { get: (k, cb) => { if (holdBoot && !release) release = () => cb({}); else cb({}); }, set: () => {}, remove: () => {} },
      onChanged: { addListener: () => {} },
    },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {}, getURL: (p) => p },
  };
  (0, eval)(read("core-popups-iso.js"));
  (0, eval)(read("popups-ui.js"));
  const label = () => { const h = document.querySelector("prism-popup-button"); return h ? h.shadowRoot.querySelector(".lbl").textContent : null; };
  const block = (url) => document.dispatchEvent(new CustomEvent("prism-popup", { detail: { attempt: { site: "news.example", url }, decision: { action: "intercept", reason: "opened without a click" } } }));
  return {
    label, block,
    pass: (ms) => vi.advanceTimersByTimeAsync(ms),
    mount: () => release && release(),
    fullscreen: (on) => { fullscreen = on ? document.body : null; document.dispatchEvent(new Event("fullscreenchange")); },
    tabHidden: (on) => { hidden = on; document.dispatchEvent(new Event("visibilitychange")); },
  };
}

describe("the button's notice of a blocked popup", () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ""; try { window.happyDOM.setURL("https://news.example/"); } catch (e) {} });
  afterEach(() => { vi.useRealTimers(); Element.prototype.attachShadow = realAttach; document.querySelectorAll("prism-popup-button").forEach((h) => h.remove()); });

  it("shows at once, goes back to the name after five seconds, and holds a second block for ten", async () => {
    const p = load(); await p.pass(0);
    expect(p.label()).toBe("PRISM");
    p.block("https://ads.example/a"); await p.pass(0);
    expect(p.label()).toBe("1 popup blocked");
    p.block("https://ads.example/b"); p.block("https://ads.example/c");
    await p.pass(5000);
    expect(p.label()).toBe("PRISM");
    await p.pass(5000);
    expect(p.label()).toBe("2 popups blocked");
  });

  it("waits for the button when a popup is blocked before the button is made", async () => {
    const p = load({ holdBoot: true }); await p.pass(0);
    expect(p.label()).toBe(null);
    p.block("https://ads.example/a");
    await p.pass(2000);
    p.mount(); await p.pass(0);
    expect(p.label()).toBe("1 popup blocked");
  });

  it("waits for fullscreen to end", async () => {
    const p = load(); await p.pass(0);
    p.fullscreen(true);
    p.block("https://ads.example/a"); p.block("https://ads.example/b");
    await p.pass(60000);
    expect(p.label()).toBe("PRISM");
    p.fullscreen(false); await p.pass(0);
    expect(p.label()).toBe("2 popups blocked");
    await p.pass(5000);
    expect(p.label()).toBe("PRISM");
  });

  it("waits for the tab to be shown again", async () => {
    const p = load(); await p.pass(0);
    p.tabHidden(true);
    p.block("https://ads.example/a");
    await p.pass(30000);
    expect(p.label()).toBe("PRISM");
    p.tabHidden(false); await p.pass(0);
    expect(p.label()).toBe("1 popup blocked");
  });
});
