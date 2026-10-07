// The veil's tab mute runs in order (2026-09-29, a YouTube report: "Audio is coming through, veil was up"): an ad's end (unmute) followed at once
// by the next ad's start (mute) must leave the tab muted, however the browser's async steps interleave.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "bg.js"), "utf8");

function load(delays) {
  const tab = { id: 7, mutedInfo: { muted: false } };
  const store = {};
  let listener = null, n = 0;
  const later = (fn) => setTimeout(fn, delays[n++ % delays.length]);
  const deep = () => new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : deep()), apply: () => undefined });
  const chrome = new Proxy({
    runtime: new Proxy({ onMessage: { addListener: (fn) => { listener = fn; } }, lastError: undefined }, { get: (t, k) => (k in t ? t[k] : deep()) }),
    tabs: new Proxy({
      get: (id, cb) => later(() => cb({ ...tab, mutedInfo: { ...tab.mutedInfo } })),
      update: (id, p, cb) => later(() => { if ("muted" in p) tab.mutedInfo.muted = p.muted; cb && cb(); }),
    }, { get: (t, k) => (k in t ? t[k] : deep()) }),
    storage: { local: {
      get: (k, cb) => later(() => cb({ [k]: store[k] })),
      set: (o, cb) => later(() => { Object.assign(store, o); cb && cb(); }),
      remove: (k, cb) => later(() => { delete store[k]; cb && cb(); }),
    }, session: deep(), onChanged: deep() },
  }, { get: (t, k) => (k in t ? t[k] : deep()) });
  const ctx = vm.createContext({ chrome, setTimeout, clearTimeout, Promise, console: { log() {}, warn() {}, error() {} }, fetch: async () => ({ ok: false }), self: {}, globalThis: {} });
  try { vm.runInContext(src, ctx); } catch { /* the rest of the worker may want more of the browser; the mute listener is what matters */ }
  const send = (muted) => new Promise((res) => listener({ type: "prism-tab-mute", muted }, { tab: { id: 7 } }, res));
  return { tab, send };
}

describe("the veil's tab mute", () => {
  it("an unmute followed at once by a mute leaves the tab muted, whatever order the browser's steps finish in", async () => {
    for (const delays of [[30, 1, 1, 30, 1, 1], [1, 30, 30, 1, 1, 1], [5, 5, 1, 40, 1, 1]]) {
      const { tab, send } = load(delays);
      await send(true);                              // ad one: muted
      expect(tab.mutedInfo.muted).toBe(true);
      const a = send(false), b = send(true);         // ad one ends, ad two starts at once
      await Promise.all([a, b]);
      await new Promise((r) => setTimeout(r, 120));
      expect(tab.mutedInfo.muted).toBe(true);
      await send(false);                             // ad two ends: the tab's own state back
      expect(tab.mutedInfo.muted).toBe(false);
    }
  });
});
