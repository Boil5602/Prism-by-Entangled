// The popup backstop in bg.js (opener tracking) must not close the browser's own new tab (2026-10-20, Edge: "blocking me from opening
// another tab, and mistakenly thinks the site is launching it"). Edge names the tab you were on as the opener of a Ctrl+T tab, the tab is
// born on edge://newtab, and its New Tab page then loads from https://ntp.msn.com within the bounce window. A real bounce (about:blank,
// then navigated by the opener) must still be judged and, on intercept, closed.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "bg.js"), "utf8");

function load(decision) {
  const created = [], updated = [], removed = [], asked = [];
  const deep = () => new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : deep()), apply: () => undefined });
  const chrome = new Proxy({
    runtime: new Proxy({ lastError: undefined }, { get: (t, k) => (k in t ? t[k] : deep()) }),
    tabs: new Proxy({
      onCreated: { addListener: (fn) => created.push(fn) },
      onUpdated: { addListener: (fn) => updated.push(fn) },
      sendMessage: (tabId, msg, cb) => { asked.push({ tabId, msg }); cb && cb(decision); },
      remove: (tabId) => removed.push(tabId),
      update: () => undefined,
    }, { get: (t, k) => (k in t ? t[k] : deep()) }),
    storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb(), remove: () => undefined }, session: deep(), onChanged: deep() },
  }, { get: (t, k) => (k in t ? t[k] : deep()) });
  const ctx = vm.createContext({ chrome, setTimeout, clearTimeout, Date, Promise, console: { log() {}, warn() {}, error() {} }, fetch: async () => ({ ok: false }), self: {}, globalThis: {} });
  vm.runInContext(src, ctx);
  const create = (tab) => created.forEach((fn) => fn(tab));
  const update = (id, change, tab) => updated.forEach((fn) => fn(id, change, tab));
  return { create, update, removed, asked };
}

const intercept = { action: "intercept", reason: "no click (new tab)" };

describe("the popup backstop and the browser's own new tab", () => {
  it("leaves Edge's Ctrl+T tab alone: born on edge://newtab with an opener, then the MSN page loads at once", () => {
    const { create, update, removed, asked } = load(intercept);
    create({ id: 9, openerTabId: 7, pendingUrl: "edge://newtab/", active: true });
    update(9, { url: "https://ntp.msn.com/edge/ntp?locale=en-US" }, { id: 9, active: true, url: "https://ntp.msn.com/edge/ntp?locale=en-US" });
    expect(asked).toEqual([]);
    expect(removed).toEqual([]);
  });
  it("leaves a tab born on any browser page alone (downloads, an extension page), whatever it navigates to next", () => {
    const { create, update, removed, asked } = load(intercept);
    create({ id: 11, openerTabId: 7, url: "edge://downloads/", active: true });
    create({ id: 12, openerTabId: 7, url: "chrome-extension://abc/ntp.html", active: true });
    update(11, { url: "https://example.com/file.pdf" }, { id: 11, active: true, url: "https://example.com/file.pdf" });
    update(12, { url: "https://example.com/" }, { id: 12, active: true, url: "https://example.com/" });
    expect(asked).toEqual([]);
    expect(removed).toEqual([]);
  });
  it("still judges a real bounce: about:blank from the page, navigated by its opener, closed on intercept", () => {
    const { create, update, removed, asked } = load(intercept);
    create({ id: 21, openerTabId: 7, url: "about:blank", active: false });
    update(21, { url: "https://ads.example/pop" }, { id: 21, active: false, url: "https://ads.example/pop" });
    expect(asked.length).toBe(1);
    expect(asked[0].tabId).toBe(7);
    expect(asked[0].msg).toEqual({ type: "prism-popup-evaluate", url: "https://ads.example/pop", tabId: 21 });
    expect(removed).toEqual([21]);
  });
  it("still judges a tab born on a web address, and lets it be when the page allows it", () => {
    const { create, removed, asked } = load({ action: "allow", reason: "you clicked a link" });
    create({ id: 31, openerTabId: 7, pendingUrl: "https://shop.example/deal", active: true });
    expect(asked.length).toBe(1);
    expect(removed).toEqual([]);
  });
});
