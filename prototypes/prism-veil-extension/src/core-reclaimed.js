/* GENERATED from packages/core/src/reclaimed.ts by build:veil - do not edit. */
"use strict";
var PrismReclaimed = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // packages/core/src/reclaimed.ts
  var reclaimed_exports = {};
  __export(reclaimed_exports, {
    ReclaimedLedger: () => ReclaimedLedger,
    dayKey: () => dayKey,
    monthStartKey: () => monthStartKey,
    weekStartKey: () => weekStartKey,
    windowsFrom: () => windowsFrom
  });
  var KEY = "reclaimed:days";
  function dayKey(ms) {
    const d = new Date(ms);
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
  }
  function weekStartKey(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    const back = (dow + 6) % 7;
    d.setDate(d.getDate() - back);
    return dayKey(d.getTime());
  }
  function monthStartKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${d.getMonth() + 1 < 10 ? "0" : ""}${d.getMonth() + 1}-01`;
  }
  function windowsFrom(days, now) {
    const wk = weekStartKey(now), mo = monthStartKey(now);
    let week = 0, month = 0, all = 0;
    for (const day in days) {
      const s = days[day] || 0;
      all += s;
      if (day >= wk) week += s;
      if (day >= mo) month += s;
    }
    return { week: Math.round(week), month: Math.round(month), all: Math.round(all) };
  }
  var ReclaimedLedger = class {
    constructor(store, opts = {}) {
      __publicField(this, "store", store);
      __publicField(this, "days", {});
      __publicField(this, "now");
      var _a;
      this.now = (_a = opts.now) != null ? _a : (() => Date.now());
    }
    async load() {
      if (!this.store) return;
      try {
        const s = await this.store.get(KEY);
        if (s) this.days = JSON.parse(s);
      } catch (e) {
      }
    }
    persist() {
      if (this.store) void this.store.set(KEY, JSON.stringify(this.days));
    }
    /** Add veiled seconds, dated `at` (default now). Non-positive is ignored. */
    add(seconds, at = this.now()) {
      if (!(seconds > 0)) return;
      const k = dayKey(at);
      this.days[k] = (this.days[k] || 0) + seconds;
      this.persist();
    }
    /** The three windows as of `at` (default now). */
    windows(at = this.now()) {
      return windowsFrom(this.days, at);
    }
    /** Clear every window (the §26 reset control). */
    reset() {
      this.days = {};
      this.persist();
    }
    /** Raw dated entries (for inspection/export). */
    entries() {
      return Object.keys(this.days).sort().map((day) => ({ day, seconds: this.days[day] }));
    }
  };
  return __toCommonJS(reclaimed_exports);
})();
try { window.PrismReclaimed = PrismReclaimed; } catch (e) {}
