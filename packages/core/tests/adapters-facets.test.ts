// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  FACET_PICK_POLL_JS,
  facetPickerJs,
  facetPresetsFor,
  loginRedirect,
  sessionProbeJs,
  sessionWatchJs,
  sessionVerdict,
  presetFacet,
  presetSelectorNames,
  representativeRect,
  representativeShare,
  setupStatusFor,
  slotClassSlug,
  stableSelector,
  tunedPresetFor,
  type CatalogEntryWithFacets,
} from "../src/adapters-facets.js";
import { clickControlJs, lintAdapterData, parseControl } from "../src/adapters.js";
import { TIER_SHARE, classifyRect, formatSlotClass } from "../src/scene-model.js";

const weather: CatalogEntryWithFacets = {
  id: "weather", name: "Weather", url: "https://forecast.weather.gov/", aspectHint: "4:3", audio: "mute",
  poster: { source: "site", fallback: "wordmark" }, zoom: 1,
  focusPresets: [{ id: "whole", label: "Whole page", selector: null }, { id: "current-conditions", label: "Current conditions", selector: "current-conditions" }],
  facetPresets: {
    "4:3·M": [{ id: "current-conditions", label: "Current conditions", selector: "current-conditions", zoom: 1.6, pad: 8 }],
    "16:9": [{ id: "seven-day", label: "7-day forecast", selector: "seven-day", zoom: 1.2 }],
  },
};
const table = { "current-conditions": "#current-conditions", "seven-day": "#seven-day-forecast" };

describe("facet presets (§31 utility presets, by slot class)", () => {
  it("lists exact-class presets first, then aspect-wide ones; nothing for other classes", () => {
    expect(facetPresetsFor(weather, "4:3·M").map((p) => p.id)).toEqual(["current-conditions"]);
    expect(facetPresetsFor(weather, "16:9·L").map((p) => p.id)).toEqual(["seven-day"]);
    expect(facetPresetsFor(weather, "16:9·S").map((p) => p.id)).toEqual(["seven-day"]);
    expect(facetPresetsFor(weather, "4:3·XL")).toEqual([]);
    expect(facetPresetsFor(undefined, "4:3·M")).toEqual([]);
    expect(facetPresetsFor(weather, "not a class")).toEqual([]);
  });
  it("a template role's tunedPreset resolves to the class preset, else the plain focus preset, else null", () => {
    expect(tunedPresetFor(weather, "4:3·M", "current-conditions")?.zoom).toBe(1.6);
    expect(tunedPresetFor(weather, "3:4·M", "current-conditions")).toEqual({ id: "current-conditions", label: "Current conditions", selector: "current-conditions" });
    expect(tunedPresetFor(weather, "4:3·M", "agenda")).toBeNull();
  });
  it("collects every selector NAME the entry references (the dangling-name test's input)", () => {
    expect(presetSelectorNames(weather).sort()).toEqual(["current-conditions", "seven-day"]);
    expect(lintAdapterData({ selectors: { "current-conditions": "#c" } }, presetSelectorNames(weather))).toEqual(['preset selector "seven-day" is not in the adapter\'s selectors table']);
    expect(lintAdapterData({ selectors: table }, presetSelectorNames(weather))).toEqual([]);
  });
  it("a preset becomes a plain facet: selector resolved through the adapter table, zoom tuned, class hint set", () => {
    const f = presetFacet(weather, facetPresetsFor(weather, "4:3·M")[0]!, { id: "weather" }, "4:3·M", table);
    expect(f).toEqual({
      id: "weather-current-conditions-4x3-m", app: "weather", url: "https://forecast.weather.gov/", slotClass: "4:3·M",
      label: "Current conditions", focus: { selector: "#current-conditions", pad: 8 }, zoom: 1.6, aspectHint: "4:3", audio: "mute",
    });
  });
  it("an unresolvable name degrades to whole page - no dangling names persist", () => {
    const f = presetFacet(weather, facetPresetsFor(weather, "4:3·M")[0]!, { id: "weather" }, "4:3·M", {});
    expect(f.focus).toBeUndefined();
    expect(presetFacet(weather, facetPresetsFor(weather, "4:3·M")[0]!, { id: "weather" }, "4:3·M").focus).toBeUndefined();
  });
  it("class slugs are filesystem-plain", () => {
    expect(slotClassSlug("16:9·XL")).toBe("16x9-xl");
    expect(slotClassSlug("8:1-ticker·M")).toBe("8x1-ticker-m");
  });
});

describe("representative shape (scene-model §4 preview)", () => {
  it("derives from TIER_SHARE - the midpoint of each band - so the preview follows the tier line", () => {
    expect(representativeShare("XL")).toBeCloseTo((TIER_SHARE.XL + 1) / 2);
    expect(representativeShare("L")).toBeCloseTo((TIER_SHARE.L + TIER_SHARE.XL) / 2);
    expect(representativeShare("M")).toBeCloseTo((TIER_SHARE.M + TIER_SHARE.L) / 2);
    expect(representativeShare("S")).toBeCloseTo(TIER_SHARE.M / 2);
  });
  it("the rect classes back to the class it previews, on the canvas it was made for", () => {
    const canvas = { w: 1920, h: 1080 };
    for (const cls of ["16:9·XL", "16:9·M", "4:3·M", "3:4·M", "8:1-ticker·M", "9:16·S", "1:1·L"]) {
      const r = representativeRect(cls, canvas)!;
      expect(r.w).toBeLessThanOrEqual(canvas.w + 1e-6);
      expect(r.h).toBeLessThanOrEqual(canvas.h + 1e-6);
      const back = formatSlotClass(classifyRect({ x: r.x / canvas.w, y: r.y / canvas.h, w: r.w / canvas.w, h: r.h / canvas.h }, canvas));
      expect(back, cls).toBe(cls);
    }
    expect(representativeRect("nope", canvas)).toBeNull();
  });
});

describe("session probe (the sign-in wizard's evidence)", () => {
  it("embeds selectors as JSON literals and evaluates to a JSON string", () => {
    // B-123: the standing watch carries the same selectors and sets window.__prismSession only on evidence
    const watch = sessionWatchJs({ signedIn: "#avatar-btn", signedOut: 'a[href*="ServiceLogin"]' });
    expect(watch).toContain('"#avatar-btn"');
    expect(watch).toContain("window.__prismSession=s");
    expect(sessionWatchJs({ signedIn: null, signedOut: null })).toContain("var i=false,o=false");
    const js = sessionProbeJs({ signedIn: "#avatar-btn", signedOut: 'a[href*="ServiceLogin"]' });
    expect(js).toContain('document.querySelector("#avatar-btn")');
    expect(js).toContain('document.querySelector("a[href*=' + String.fromCharCode(92) + '"ServiceLogin' + String.fromCharCode(92) + '"]")');
    expect(js.startsWith("(function(){")).toBe(true);
    // a selector cannot break out of its literal
    expect(sessionProbeJs({ signedIn: '");alert(1);("' })).toContain(JSON.stringify('");alert(1);("'));
    // no probe at all: both sides read false, never a throw
    expect(sessionProbeJs({})).toContain("signedIn:false,signedOut:false");
  });
  it("turns the probe's answer into a status only on evidence, and reads ExecuteScript's double encoding", () => {
    expect(sessionVerdict(JSON.stringify({ signedIn: true, signedOut: false }))).toBe("signed-in");
    expect(sessionVerdict(JSON.stringify({ signedIn: false, signedOut: true }))).toBe("needs-attention");
    expect(sessionVerdict(JSON.stringify({ signedIn: false, signedOut: false }))).toBeNull();     // nothing seen: not "signed in"
    expect(sessionVerdict(JSON.stringify({ signedIn: true, signedOut: true }))).toBeNull();       // contradictory: no verdict
    expect(sessionVerdict(JSON.stringify(JSON.stringify({ signedIn: true })))).toBe("signed-in");  // as ExecuteScript returns it
    expect(sessionVerdict("not json")).toBeNull();
    expect(sessionVerdict(null)).toBeNull();
  });
});

describe("login redirect heuristic (scene-model §2 passive verification)", () => {
  it("the adapter's login prefix wins", () => {
    expect(loginRedirect("https://auth.hulu.com/web/login?next=x", { login: "https://auth.hulu.com/web/login", baseUrl: "https://www.hulu.com" })).toBe("login");
    expect(loginRedirect("https://www.hulu.com/hub/home", { login: "https://auth.hulu.com/web/login", baseUrl: "https://www.hulu.com" })).toBe("app");
  });
  it("well-known login hosts and paths count without an adapter", () => {
    expect(loginRedirect("https://accounts.google.com/ServiceLogin?service=youtube", { baseUrl: "https://www.youtube.com" })).toBe("login");
    expect(loginRedirect("https://www.example.com/signin", { baseUrl: "https://www.example.com" })).toBe("login");
    expect(loginRedirect("https://open.spotify.com/", { baseUrl: "https://open.spotify.com" })).toBe("app");
    expect(loginRedirect("https://news.ycombinator.com/", { baseUrl: "https://open.spotify.com" })).toBe("elsewhere");
    expect(loginRedirect("not a url")).toBe("elsewhere");
  });
  it("maps to setup status: login → needs-attention, app → signed-in, elsewhere → no change", () => {
    expect(setupStatusFor("login")).toBe("needs-attention");
    expect(setupStatusFor("app")).toBe("signed-in");
    expect(setupStatusFor("elsewhere")).toBeNull();
  });
});

describe("control bindings (§26 pass-through grammar)", () => {
  it("parses selectors, deep selectors and key bindings", () => {
    expect(parseControl(".ytp-next-button")).toEqual({ kind: "selector", selector: ".ytp-next-button" });
    expect(parseControl("amp-playback-controls-play >>> button")).toEqual({ kind: "deep", path: ["amp-playback-controls-play", "button"] });
    expect(parseControl("key:Shift+N")).toEqual({ kind: "key", key: "N", modifiers: ["shift"] });
    expect(parseControl("key:Space")).toEqual({ kind: "key", key: "Space", modifiers: [] });
  });
  it("emits page JS that clicks the site's own control, descends shadow roots, or delivers the key pair", () => {
    expect(clickControlJs(".x")).toContain('document.querySelector(".x")');
    const deep = clickControlJs("amp-playback-controls-play >>> button");
    expect(deep).toContain("shadowRoot");
    expect(deep).toContain('["amp-playback-controls-play","button"]');
    const key = clickControlJs("key:Space");
    expect(key).toContain("'keydown'");
    expect(key).toContain('"code":"Space"');
    expect(key).toContain('"key":" "');
  });
  it("lints unknown names and empties", () => {
    expect(lintAdapterData({ controls: { play: "#p", jump: "#j" } as never })).toEqual(["controls.jump: unknown control name"]);
    expect(lintAdapterData({ presentation: { enterFullscreen: "", skip: "#s" } as never })).toEqual(["presentation.enterFullscreen: empty", "presentation.skip: unknown presentation action"]);
  });
});

describe("stable selector + element picker (§31 tap records a selector)", () => {
  it("prefers a stable id, then a test hook, then a short class path - always verified unique", () => {
    document.body.innerHTML = `
      <div id="app">
        <nav class="css-1x2y3z4"><button data-testid="control-button-playpause" aria-label="Play"></button></nav>
        <main class="feed"><article class="story"><h2>a</h2></article><article class="story"><h2>b</h2></article></main>
        <section id="current-conditions" class="panel"><p class="temp">69°F</p></section>
        <ul class="list"><li><a href="#" class="topic-title">one</a></li><li><a href="#" class="topic-title">two</a></li></ul>
      </div>`;
    const q = (s: string) => document.querySelector(s)!;
    expect(stableSelector(q("#current-conditions"), document)).toEqual({ selector: "#current-conditions", unique: true });
    expect(stableSelector(q("[data-testid]"), document)).toEqual({ selector: 'button[data-testid="control-button-playpause"]', unique: true });
    const temp = stableSelector(q(".temp"), document)!;
    expect(temp.unique).toBe(true);
    expect(document.querySelectorAll(temp.selector)).toHaveLength(1);
    expect(temp.selector.startsWith("#current-conditions")).toBe(true);
    const second = stableSelector(document.querySelectorAll("article")[1]!, document)!;
    expect(second.unique).toBe(true);
    expect(document.querySelector(second.selector)?.textContent).toBe("b");
    const link = stableSelector(document.querySelectorAll(".topic-title")[1]!, document)!;
    expect(link.unique).toBe(true);
    expect(document.querySelector(link.selector)?.textContent).toBe("two");
  });
  it("the picker script is self-contained (embeds the tested selector logic) and installs its hooks", () => {
    const js = facetPickerJs();
    expect(js).toContain("__prismFacetPick");
    expect(js).toContain("data-prism-ui");
    expect(js).not.toMatch(/\bimport\b|\brequire\(/);
    document.body.innerHTML = "<div id='x'></div>";
    const w = window as unknown as { __prismFacetPickStop?: () => void; __prismFacetPicking?: boolean };
    // eslint-disable-next-line no-new-func
    new Function(js)();
    expect(w.__prismFacetPicking).toBe(true);
    expect(document.querySelectorAll("[data-prism-ui='facet-pick']")).toHaveLength(2);
    // eslint-disable-next-line no-new-func
    expect(new Function("return " + FACET_PICK_POLL_JS)()).toBe("null");
    w.__prismFacetPickStop!();
    expect(w.__prismFacetPicking).toBe(false);
    expect(document.querySelectorAll("[data-prism-ui='facet-pick']")).toHaveLength(0);
  });
});
