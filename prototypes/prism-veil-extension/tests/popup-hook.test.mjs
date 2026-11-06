import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The main-world hook, end to end under happy-dom: window.open returns a stub
// for an intercepted attempt (nothing opens), reports it over a DOM event,
// and lets a click-consistent open through to the real window.open.
const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, "..", f), "utf8");

function loadHook() {
  window.__prismPopupHook = undefined;
  window.PrismPopups = undefined;
  (0, eval)(read("src/core-popups.js") + ";window.PrismPopups = PrismPopups;");
  const opened = [];
  window.open = function (url, name) { opened.push({ url: String(url), name }); return { real: true }; };
  (0, eval)(read("popup-hook.js"));
  const reports = [];
  document.addEventListener("prism-popup", (e) => reports.push(e.detail));
  return { opened, reports };
}
function setHost(host) { try { window.happyDOM.setURL("https://" + host + "/page"); } catch (e) {} }

describe("popup hook (main world)", () => {
  beforeEach(() => { document.body.innerHTML = ""; setHost("shop.com"); });

  it("intercepts an open with no gesture: stub window, one report, nothing opened", () => {
    const { opened, reports } = loadHook();
    const w = window.open("https://tracker.example/land");
    expect(opened).toEqual([]);
    expect(w.closed).toBe(false);
    expect(typeof w.focus).toBe("function");
    w.close(); expect(w.closed).toBe(true);
    expect(reports.length).toBe(1);
    expect(reports[0].attempt).toEqual({ site: "shop.com", url: "https://tracker.example/land" });
    expect(reports[0].decision).toEqual({ action: "intercept", reason: "opened without a click" });
  });

  it("lets a click-consistent open through and intercepts the burst after it", () => {
    const { opened, reports } = loadHook();
    document.body.innerHTML = `<a id="l" href="https://shop.com/help">help</a>`;
    const a = document.getElementById("l");
    a.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const w1 = window.open("https://shop.com/help", "_blank");
    expect(w1).toEqual({ real: true });
    expect(opened).toEqual([{ url: "https://shop.com/help", name: "_blank" }]);
    // a second window from the same click is a burst
    const w2 = window.open("https://shop.com/help");
    expect(w2.real).toBeUndefined();
    expect(reports.at(-1).decision.reason).toMatch(/^burst/);
  });

  it("intercepts gesture laundering (click on shop.com opens elsewhere) and resolves relative URLs", () => {
    const { opened, reports } = loadHook();
    document.body.innerHTML = `<a id="l" href="https://shop.com/help">help</a>`;
    document.getElementById("l").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.open("https://ads.example/pop");
    expect(opened).toEqual([]);
    expect(reports[0].decision.reason).toBe("unknown destination");
    window.open("/local");
    expect(reports[1].attempt.url).toBe("https://shop.com/local");
  });

  it("honors a policy snapshot pushed from the UI: allowed destinations open for real", () => {
    const { opened } = loadHook();
    const state = { global: "intercept", sites: { "shop.com": { allowed: { "checkout.example.com": { since: "2026-08-27T00:00:00Z" } } } } };
    document.dispatchEvent(new CustomEvent("prism-popup-policy", { detail: { state: JSON.stringify(state) } }));
    const w = window.open("https://checkout.example.com/x");
    expect(w).toEqual({ real: true });
    expect(opened.length).toBe(1);
  });

  it("wraps a same-origin frame's open() too (the popunder trick: createElement(iframe) -> contentWindow.open)", () => {
    const { opened, reports } = loadHook();
    const f = document.createElement("iframe");
    document.body.appendChild(f);
    const w = f.contentWindow;
    if (!w) return; // environment without frame windows: nothing to assert
    const fakeNative = () => ({ real: true });
    // simulate the frame's own native open, then let the hook wrap it on access
    let stub;
    try { w.open = fakeNative; } catch (e) { return; }
    delete w.__prismPopupHook;
    const w2 = f.contentWindow;   // access again: the getter wraps
    stub = w2.open("https://ay267.com/?rb=x");
    expect(opened).toEqual([]);
    expect(stub && stub.closed).toBe(false);
    expect(reports.at(-1).attempt.url).toBe("https://ay267.com/?rb=x");
    expect(reports.at(-1).decision.action).toBe("intercept");
  });

});
