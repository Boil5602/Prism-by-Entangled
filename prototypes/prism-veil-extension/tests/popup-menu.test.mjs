// A link opened from the browser's own menu (right-click, "Open link in new tab" / "in new window") is the person's ask however long
// the menu stayed up (2026-11-10: a new window to another site closed as it opened, because the press was older than a plain click's
// 1.5 s). The page side (src/popups-ui.js) answers the backstop's question; these tests drive that answer with a clock of their own.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", "src", f), "utf8");

function load() {
  let now = 1_000_000;
  const listeners = {}, onMessage = [];
  class Clock extends Date { static now() { return now; } }
  const quiet = () => undefined;
  const sandbox = {
    Date: Clock, Promise, JSON, Object, String, Array, Math, console: { log: quiet, warn: quiet, error: quiet },
    setTimeout: quiet, clearTimeout: quiet, setInterval: quiet, clearInterval: quiet,
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    location: { hostname: "news.example", href: "https://news.example/" },
    document: { body: null, addEventListener: quiet, dispatchEvent: quiet },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    matchMedia: () => ({ matches: false }),
    chrome: {
      storage: { local: { get: (k, cb) => cb && cb({}), set: quiet, remove: quiet }, onChanged: { addListener: quiet } },
      runtime: { onMessage: { addListener: (fn) => onMessage.push(fn) }, sendMessage: quiet, getURL: (p) => p },
    },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext("var window = this, top = this;", ctx);
  vm.runInContext(read("core-popups-iso.js"), ctx);
  vm.runInContext(read("popups-ui.js"), ctx);
  const link = (href) => ({ href, matches: (s) => s === "a[href]", closest: () => null });
  const fire = (type, a, more) => (listeners[type] || []).forEach((fn) => fn(Object.assign({ type, target: a || { closest: () => null }, composedPath: () => (a ? [a] : []), button: 0 }, more || {})));
  const ask = (url) => { let out; onMessage.forEach((fn) => fn({ type: "prism-popup-evaluate", url, tabId: 5 }, {}, (d) => { out = d; })); return out; };
  const rightClick = (a) => { fire("pointerdown", a, { button: 2 }); fire("mousedown", a, { button: 2 }); fire("contextmenu", a, { button: 2 }); };
  return { link, fire, ask, rightClick, wait: (ms) => { now += ms; } };
}

describe("a link opened from the browser's own menu", () => {
  it("is allowed to another site long after the right-click, where a tab with no press behind it is not", () => {
    const p = load();
    p.wait(20000);
    expect(p.ask("https://other.example/story").action).toBe("intercept");
    p.rightClick(p.link("https://other.example/story"));
    p.wait(20000);
    expect(p.ask("https://other.example/story")).toEqual({ action: "allow", reason: "you opened the link from its menu" });
  });
  it("covers that link's own address only, and one open", () => {
    const p = load();
    p.rightClick(p.link("https://other.example/story#top"));
    p.wait(5000);
    expect(p.ask("https://ads.example/pop").action).toBe("intercept");
    expect(p.ask("https://other.example/story").action).toBe("allow");
    expect(p.ask("https://other.example/story").action).toBe("intercept");
  });
  it("ends at the person's next press on the page, and after two minutes", () => {
    const p = load();
    p.rightClick(p.link("https://other.example/story"));
    p.wait(5000);
    p.fire("pointerdown", null);
    p.wait(5000);
    expect(p.ask("https://other.example/story").action).toBe("intercept");
    p.rightClick(p.link("https://other.example/story"));
    p.wait(121000);
    expect(p.ask("https://other.example/story").action).toBe("intercept");
  });
  it("is not given by a right-click that was not on a link", () => {
    const p = load();
    p.rightClick(p.link("https://other.example/story"));
    p.rightClick(null);
    p.wait(5000);
    expect(p.ask("https://other.example/story").action).toBe("intercept");
  });
  it("follows a link the page rewrote after the menu opened", () => {
    const p = load();
    const a = p.link("https://other.example/story");
    p.rightClick(a);
    a.href = "https://news.example/out?to=other.example%2Fstory";
    p.wait(5000);
    expect(p.ask("https://news.example/out?to=other.example%2Fstory").action).toBe("allow");
  });
});
