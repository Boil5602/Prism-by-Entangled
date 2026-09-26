import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CONTEXT_SHEET_ACTIONS,
  REACH,
  ROUTES,
  RouteStack,
  SELECTION_GESTURES,
  SHEET_LABELS,
  actionCount,
  buildRoute,
  contextSheetActions,
  cornerAffordance,
  isPrismRoute,
  matchRoute,
  needsAttentionRoute,
  routeForAction,
  routeRegistry,
  routes,
  tapRoute,
} from "../src/routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = join(here, "../routes.registry.json");
const fixturePath = join(here, "../../../scripts/fixtures/walk-6a.json");

describe("§6a prism:// routes — matching and building", () => {
  it("every route pattern is unique, prism://, and returns to the scene", () => {
    const seen = new Set<string>();
    for (const r of ROUTES) {
      expect(r.route.startsWith("prism://")).toBe(true);
      expect(seen.has(r.route), r.route).toBe(false);
      seen.add(r.route);
      expect(r.back).toBe("scene");
      expect(r.title.length).toBeGreaterThan(0);
    }
    const ids = ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("round-trips params and query", () => {
    const url = buildRoute("scene.visualization.edit", { id: "kitchen evening", viz: "viz-1" });
    expect(url).toBe("prism://scene/kitchen%20evening/visualization/viz-1/edit");
    const m = matchRoute(url)!;
    expect(m.def.id).toBe("scene.visualization.edit");
    expect(m.params).toEqual({ id: "kitchen evening", viz: "viz-1" });
    const withQuery = buildRoute("app.setup", { id: "hulu" }, { url: "https://www.hulu.com/live?x=1", return: "scene", empty: undefined });
    const mq = matchRoute(withQuery)!;
    expect(mq.def.id).toBe("app.setup");
    expect(mq.query).toEqual({ url: "https://www.hulu.com/live?x=1", return: "scene" });
  });
  it("literal segments win over params: scenes vs scene/:id, layouts/new vs layout/:id/edit", () => {
    expect(matchRoute("prism://scenes")!.def.id).toBe("scenes");
    expect(matchRoute("prism://scene/scenes")!.def.id).toBe("scene.view");
    expect(matchRoute("prism://layouts/new")!.def.id).toBe("layout.new");
    expect(matchRoute("prism://layout/new/edit")!.def.id).toBe("layout.edit");
    expect(matchRoute("prism://facets/new?app=hulu&class=16%3A9%C2%B7XL")!.query).toEqual({ app: "hulu", class: "16:9·XL" });
  });
  it("rejects what is not a route", () => {
    expect(matchRoute("https://example.com")).toBeNull();
    expect(matchRoute("prism://")).toBeNull();
    expect(matchRoute("prism://scene")).toBeNull();
    expect(matchRoute("prism://scene//edit")).toBeNull();
    expect(matchRoute("prism://facet/x/frobnicate")).toBeNull();
    expect(matchRoute("prism://facet/x/edit y")).toBeNull();
    expect(isPrismRoute("prism://scenes")).toBe(true);
    expect(isPrismRoute("prism://")).toBe(false);
    expect(() => buildRoute("nope")).toThrow();
    expect(() => buildRoute("facet.edit", {})).toThrow();
  });
});

describe("§6a context sheet, tap, badge, corner", () => {
  const video = { kind: "video-facet" as const, scene: "kitchen", item: "hero", facet: "hulu-live", app: "hulu", url: "https://www.hulu.com/live" };
  it("the sheet lists the five §6a actions, each a deep link, in the spec's order", () => {
    const sheet = contextSheetActions(video);
    expect(sheet.map((a) => a.action)).toEqual([...CONTEXT_SHEET_ACTIONS]);
    expect(sheet.map((a) => a.label)).toEqual(["Open full page (setup mode)", "Edit facet", "App settings / sign in", "Swap facet in this slot", "Mute"]);
    expect(sheet[0]!.route).toBe("prism://app/hulu/setup?url=https%3A%2F%2Fwww.hulu.com%2Flive&return=scene");
    expect(sheet[1]!.route).toBe(routes.facetEdit("hulu-live"));
    expect(sheet[2]!.route).toBe("prism://app/hulu/setup?return=scene");
    expect(sheet[3]!.route).toBe(routes.slotSwap("hero"));
    expect(sheet[4]!.route).toBe("prism://item/hero/mute");
    for (const a of sheet) expect(matchRoute(a.route!)).not.toBeNull();
    // the builders the runtime / remote use resolve in the registry too
    for (const url of [routes.scene("k"), routes.sceneEdit("k"), routes.appSetup("a"), routes.appSettings("a"), routes.facetEdit("f"), routes.itemSheet("i"), routes.slotSwap("i"), routes.itemMute("i"), routes.facetFull("f"), routes.facetReveal("f")])
      expect(matchRoute(url), url).not.toBeNull();
    expect(routeForAction("swap-facet", { item: "hero" })).toBe(routes.slotSwap("hero"));
    expect(routeForAction("edit-facet", { item: "hero" })).toBeNull();
  });
  it("actions that do not apply are disabled with a note, never dropped", () => {
    const floating = contextSheetActions({ kind: "floating-facet", scene: "kitchen", item: "cams", facet: "cams-1x1", app: "cams" });
    expect(floating).toHaveLength(5);
    expect(floating[3]).toMatchObject({ label: SHEET_LABELS["swap-facet"], route: null, note: "not in a slot" });
    const muted = contextSheetActions({ ...video, muted: true });
    expect(muted[4]!.label).toBe("Unmute");   // a video item has no choose-music row, so mute stays fifth
    const placeholder = contextSheetActions({ kind: "placeholder-slot", scene: "kitchen", item: "side1" });
    expect(placeholder.map((a) => a.route)).toEqual([null, "prism://item/side1/swap", "prism://scene/kitchen/edit?slot=side1"]);
    expect(placeholder[0]!.note).toMatch(/not a template scene/);
    // a template scene answers an empty slot with the wizard, at that role
    const templated = contextSheetActions({ kind: "placeholder-slot", scene: "kitchen", item: "hero", template: "kitchen-command" });
    expect(templated[0]).toMatchObject({ action: "choose-app", label: "Choose an app…", route: "prism://template/kitchen-command?scene=kitchen&role=hero" });
    // a stage with no service says so and routes to the hidden role; with one it offers a change
    const bare = contextSheetActions({ kind: "music-visualization", scene: "lounge", item: "stage", facet: "demo:placeholder", template: "music-lounge", role: "hidden:0" });
    expect(bare[0]).toMatchObject({ action: "choose-music", label: "Choose the music service…", route: "prism://item/stage/music/service" });   // a modal picker, not the wizard (2026-09-06)
    const sourced = contextSheetActions({ kind: "music-visualization", scene: "lounge", item: "stage", facet: "am-lib", app: "apple-music", template: "music-lounge", role: "hidden:0" });
    // B-146: the source's group first - sign in and the inline app window; a stage with no service has no group
    expect(sourced[0]).toMatchObject({ action: "sign-in", route: "prism://app/apple-music/setup?return=scene&signin=1" });
    expect(sourced[1]).toMatchObject({ action: "open-app", label: "Open the full app", route: "prism://facet/am-lib/reveal?mode=window" });
    expect(sourced[2]!.label).toBe("Change the music service…");
    // a stage's sheet is about music, not facets (2026-09-06): no Edit facet, no Swap facet
    expect(sourced.map((a) => a.action)).toEqual(["sign-in", "open-app", "choose-music", "add-music", "remove-music", "ads-sound", "next-visual", "visual-style", "open-setup", "app-settings", "mute"]);
    expect(sourced[3]!.route).toBe("prism://item/stage/music/add");   // multi-service lounge (2026-09-07)
    expect(sourced[4]!.route).toBe("prism://item/stage/music/remove");   // B-195 (2026-09-09): a service leaves the way it joined
    expect(sourced[5]!.route).toBe("prism://item/stage/music/ads");   // section 26 ambient audio (2026-09-07)
    // every OTHER service on the wall gets its own "Open X (sign in)…" - App settings alone went to the source's (2026-09-07)
    const multi = contextSheetActions({ kind: "music-visualization", scene: "lounge", item: "stage", facet: "am", app: "apple-music", services: [{ app: "apple-music", name: "Apple Music" }, { app: "spotify", name: "Spotify", session: "signed-out" }] });
    expect(multi.filter((a) => a.label.startsWith("Open Spotify")).map((a) => a.route)).toEqual(["prism://app/spotify/setup?return=scene&signin=1"]);
    expect(multi.some((a) => a.label.startsWith("Open Apple Music"))).toBe(false);
    expect(sourced[6]!.route).toBe("prism://item/stage/visual/next");
    expect(sourced[7]!.route).toBe("prism://item/stage/visual/style");
    expect(sourced[8]!.label).toBe("Open the player (sign in)…");
  });
  it("single tap promotes video, reveals music, assigns a placeholder; nothing else", () => {
    expect(tapRoute(video)).toBe("prism://facet/hulu-live/full");
    expect(tapRoute({ kind: "music-visualization", scene: "k", item: "viz-1", facet: "spotify-controller", app: "spotify", visualization: "viz-1" })).toBeNull();   // B-145: a stage tap does nothing
    expect(tapRoute({ kind: "placeholder-slot", scene: "k", item: "side1" })).toBe("prism://item/side1/swap");
    expect(tapRoute({ kind: "utility-facet", scene: "k", item: "cal", facet: "merge-week", app: "merge" })).toBeNull();
  });
  it("the badge and the corner affordance are the deep links §6a names", () => {
    expect(needsAttentionRoute("hulu")).toBe("prism://app/hulu/setup?return=scene&signin=1");
    expect(cornerAffordance("hulu-live", "hulu")).toEqual({ editFacet: "prism://facet/hulu-live/edit", appSettings: "prism://app/hulu/setup?return=scene" });
  });
});

describe("§6a reach table — editor ≤ 1, App settings ≤ 2, Back = scene (the walk-test's rule, checked here too)", () => {
  const fixture = existsSync(fixturePath) ? (JSON.parse(readFileSync(fixturePath, "utf8")) as { states: Array<{ id: string; reach: Record<string, { route: string; max: number; via?: string[] }> }>; routesRequired: string[]; actionsVocabulary: string[] }) : null;
  it("every reach target is a registered route and every gesture is in the fixture vocabulary", () => {
    const routes = new Set(ROUTES.map((r) => r.route));
    for (const r of REACH) {
      expect(routes.has(r.to), r.to).toBe(true);
      if (fixture) for (const a of r.actions) expect(fixture.actionsVocabulary, `${r.from} → ${r.to}: ${a}`).toContain(a);
    }
  });
  it("counts: selection gestures are 0, the rest 1 each", () => {
    expect(actionCount(["long-press", "sheet:Edit facet"])).toBe(1);
    expect(actionCount(["right-click", "sheet:App settings / sign in"])).toBe(1);
    expect(actionCount(["tap"])).toBe(1);
    expect(SELECTION_GESTURES).toEqual(["long-press", "right-click", "remote-hold"]);
  });
  it("satisfies the fixture: every state × destination reachable within max, via the spec's own gestures", () => {
    if (!fixture) return;
    for (const route of fixture.routesRequired) expect(ROUTES.some((r) => r.route === route), route).toBe(true);
    for (const s of fixture.states) {
      for (const [dest, r] of Object.entries(s.reach)) {
        const paths = REACH.filter((x) => x.from === s.id && x.to === r.route);
        expect(paths.length, `${s.id}.${dest}`).toBeGreaterThan(0);
        const best = Math.min(...paths.map((p) => actionCount(p.actions)));
        expect(best, `${s.id}.${dest}`).toBeLessThanOrEqual(r.max);
        if (r.via) expect(paths.some((p) => p.actions.join("|") === r.via!.join("|")), `${s.id}.${dest} via ${r.via.join(" → ")}`).toBe(true);
      }
    }
  });
  it("the committed registry IS routeRegistry() (regenerate with npm run routes:generate)", () => {
    expect(existsSync(registryPath), "packages/core/routes.registry.json missing").toBe(true);
    const committed = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(committed).toEqual(routeRegistry());
  });
});

describe("§6a back stack — Back returns exactly to the scene, Done resumes the opener", () => {
  it("push / back / done", () => {
    const stack = new RouteStack(() => "prism://scene/kitchen");
    expect(stack.push("prism://template/kitchen-classic")!.def.id).toBe("template.wizard");
    expect(stack.push("prism://app/hulu/setup?return=scene")!.def.id).toBe("app.setup");
    expect(stack.push("prism://facets/new?app=hulu&class=16%3A9%C2%B7XL")!.def.id).toBe("facet.new");
    expect(stack.depth()).toBe(3);
    // Done on the facet editor resumes the App setup step, Done there resumes the wizard
    expect(stack.done().resume!.def.id).toBe("app.setup");
    expect(stack.done().resume!.def.id).toBe("template.wizard");
    // Done on the last screen lands on the scene
    const last = stack.done();
    expect(last.resume).toBeNull();
    expect(last.scene).toBe("prism://scene/kitchen");
    // Back from deep in a flow: the scene, nothing else
    stack.push("prism://template/kitchen-classic");
    stack.push("prism://app/hulu/setup");
    expect(stack.back()).toBe(routes.scene("kitchen"));
    expect(stack.depth()).toBe(0);
  });
  it("a transient state replaces a transient state; an unknown url is refused", () => {
    const stack = new RouteStack(() => null);
    stack.push("prism://facet/a/full");
    stack.push("prism://facet/b/full");
    expect(stack.depth()).toBe(1);
    expect(stack.top()!.params.id).toBe("b");
    expect(stack.push("https://not.a.route")).toBeNull();
    expect(stack.back()).toBeNull();
  });
});
