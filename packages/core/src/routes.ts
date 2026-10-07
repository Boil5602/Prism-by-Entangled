/**
 * §6a deep links (docs/scene-model-spec.md): every entity screen is
 * addressable as a prism:// route so any surface - the scene, the pill, the
 * phone remote, a needs-attention badge - can jump straight there and Back
 * returns exactly to the scene.
 *
 * Core only BUILDS and VALIDATES route strings; routing is the shell's UI
 * (its route registry, packages/core/routes.registry.json, is generated from
 * the ROUTES table below by `npm run routes:generate`). The builders are the
 * spec's own shapes, so the remote API, the input map and the shell's router
 * speak the same strings the registry lists.
 *
 * Two layers in one module:
 *   1. builders + validation (`routes.*`, `isPrismRoute`, `routeForAction`) -
 *      what the runtime, remote API and input map use;
 *   2. the registry (`ROUTES`, `matchRoute`, `buildRoute`, the context-sheet
 *      model, the §6a reach table the walk-test checks, `RouteStack`) - what
 *      the shell's router and scripts/walk-test-6a.mjs consume.
 *
 * Counting convention (ledger B-32, pinned by scripts/fixtures/walk-6a.json):
 * opening the context sheet on an item - long-press / right-click /
 * remote-hold - is SELECTION and counts 0; every choice after it counts 1; a
 * direct tap, badge-tap or corner affordance counts 1.
 *
 * Back vs Done (the two ways out of a screen):
 *   - Back / Esc always lands on the scene, whatever was stacked (§6a).
 *   - Done / Save is completion: it returns to the screen that opened this
 *     one (a wizard resumes at the next role), or to the scene when nothing did.
 */

import type { TapAction } from "./types.js";

export const ROUTE_SCHEME = "prism://";

export function isPrismRoute(route: unknown): route is string {
  return typeof route === "string" && route.startsWith(ROUTE_SCHEME) && route.length > ROUTE_SCHEME.length && !/\s/.test(route);
}

const seg = (s: string): string => encodeURIComponent(s);

export const routes = {
  scene: (sceneId: string): string => `${ROUTE_SCHEME}scene/${seg(sceneId)}`,
  sceneEdit: (sceneId: string): string => `${ROUTE_SCHEME}scene/${seg(sceneId)}/edit`,
  appSetup: (appId: string): string => `${ROUTE_SCHEME}app/${seg(appId)}/setup`,
  appSettings: (appId: string): string => `${ROUTE_SCHEME}app/${seg(appId)}/settings`,
  facetEdit: (facetId: string): string => `${ROUTE_SCHEME}facet/${seg(facetId)}/edit`,
  /** The compact context sheet for an on-scene item (slot / floating / visualization id). */
  itemSheet: (itemId: string): string => `${ROUTE_SCHEME}item/${seg(itemId)}/sheet`,
  /** "Swap facet in this slot": the slot's compatible-facet picker. */
  slotSwap: (itemId: string): string => `${ROUTE_SCHEME}item/${seg(itemId)}/swap`,
  /** Mute / unmute the item (a tile command reached as a deep link, so the sheet is uniform). */
  itemMute: (itemId: string): string => `${ROUTE_SCHEME}item/${seg(itemId)}/mute`,
  /** Single tap on a video facet: promote to the full-page presentation (transient; Back collapses). */
  facetFull: (facetId: string): string => `${ROUTE_SCHEME}facet/${seg(facetId)}/full`,
  /** Single tap on a music item: reveal the hidden facet's native player (§32, transient). */
  facetReveal: (facetId: string): string => `${ROUTE_SCHEME}facet/${seg(facetId)}/reveal`,
} as const;

/** The §6a context-sheet actions a phone or a held remote key may invoke. */
export type ContextSheetAction = "open-setup" | "edit-facet" | "app-settings" | "swap-facet" | "mute";
export const CONTEXT_SHEET_ACTIONS: readonly ContextSheetAction[] = ["open-setup", "edit-facet", "app-settings", "swap-facet", "mute"];

/** What an on-scene item resolves to in the scene model (the runtime supplies it; core never guesses). */
export interface ItemContext {
  item: string;
  facet?: string | null;
  app?: string | null;
}

/**
 * The route a context-sheet action deep-links to for an item, or null when the
 * action is not a route (mute is a tile command) or the item lacks the entity
 * (no app behind a visualization, say).
 */
export function routeForAction(action: ContextSheetAction, ctx: ItemContext): string | null {
  switch (action) {
    case "open-setup": return ctx.app ? routes.appSetup(ctx.app) : null;
    case "app-settings": return ctx.app ? routes.appSettings(ctx.app) : null;
    case "edit-facet": return ctx.facet ? routes.facetEdit(ctx.facet) : null;
    case "swap-facet": return routes.slotSwap(ctx.item);
    case "mute": return null;
  }
}

/* ------------------------------------------------------------ registry ---- */

export type RouteKind = "list" | "view" | "editor" | "settings" | "picker" | "action";
export type RouteEntity = "scene" | "layout" | "facet" | "app" | "item" | "device" | "template" | "visualization" | "news";

export interface RouteDef {
  /** Stable id ("facet.edit") - what code refers to; the pattern is the wire form. */
  id: string;
  /** Pattern with :params ("prism://facet/:id/edit"). Optional inputs travel as ?query. */
  route: string;
  kind: RouteKind;
  entity: RouteEntity;
  /** Where Back lands. Every route returns to the scene (§6a). */
  back: "scene";
  /** Human title of the screen (the rail / header shows it). */
  title: string;
  /** Optional query keys the screen understands. */
  query?: string[];
  /** A transient state (promotion, reveal): Back collapses it, no editor state is kept. */
  transient?: boolean;
}

/**
 * Every entity screen. Literal segments never collide with parameterised
 * ones ("scenes" vs "scene/:id", "layouts/new" vs "layout/:id/edit"), so
 * matching is first-wins over this list.
 */
export const ROUTES: readonly RouteDef[] = [
  // scenes
  { id: "scenes", route: "prism://scenes", kind: "list", entity: "scene", back: "scene", title: "Scenes" },
  { id: "scene.view", route: "prism://scene/:id", kind: "view", entity: "scene", back: "scene", title: "Scene" },
  // the two players (players.ts): the shell switches through its own path (core switchPlayer), as its menu and corner toggle do;
  // a phone asks for one by this route (2026-10-04, "the top right menu lets me choose from the music lounge or the streaming video side")
  { id: "player.view", route: "prism://player/:kind", kind: "view", entity: "scene", back: "scene", title: "Player" },
  { id: "scene.edit", route: "prism://scene/:id/edit", kind: "editor", entity: "scene", back: "scene", title: "Scene builder", query: ["slot"] },
  { id: "scene.visualization.edit", route: "prism://scene/:id/visualization/:viz/edit", kind: "editor", entity: "visualization", back: "scene", title: "Visualization" },
  // on-scene items (a slot id, a floating / hidden placement id, a visualization id - the tile id on the wall)
  { id: "item.sheet", route: "prism://item/:item/sheet", kind: "action", entity: "item", back: "scene", title: "Context sheet" },
  { id: "item.swap", route: "prism://item/:item/swap", kind: "picker", entity: "item", back: "scene", title: "Swap facet in this slot" },
  { id: "item.mute", route: "prism://item/:item/mute", kind: "action", entity: "item", back: "scene", title: "Mute" },
  // a music visualization's sheet is about music, not facets (decision 2026-09-06): the next pack, and the pack / artwork sheet
  { id: "item.visualNext", route: "prism://item/:item/visual/next", kind: "action", entity: "item", back: "scene", title: "Next visual" },
  { id: "item.visualStyle", route: "prism://item/:item/visual/style", kind: "editor", entity: "item", back: "scene", title: "Visual style" },
  // "just give me a quick modal right there" (2026-09-06): the service picker for a music stage, no wizard screen
  { id: "item.musicService", route: "prism://item/:item/music/service", kind: "picker", entity: "item", back: "scene", title: "Music service" },
  { id: "item.musicAdd", route: "prism://item/:item/music/add", kind: "picker", entity: "item", back: "scene", title: "Add a music service" },
  { id: "item.musicAds", route: "prism://item/:item/music/ads", kind: "picker", entity: "item", back: "scene", title: "Intermission" },
  { id: "item.musicRemove", route: "prism://item/:item/music/remove", kind: "picker", entity: "item", back: "scene", title: "Remove a music service" },   // B-195 (2026-09-09)
  // templates (the "New Scene" wizard)
  { id: "templates", route: "prism://templates", kind: "list", entity: "template", back: "scene", title: "New scene", query: ["layout"] },   // ?layout=<id>: the custom-scene wizard on that layout
  { id: "template.wizard", route: "prism://template/:id", kind: "editor", entity: "template", back: "scene", title: "Scene template", query: ["role", "scene"] },
  // layouts
  { id: "layouts", route: "prism://layouts", kind: "list", entity: "layout", back: "scene", title: "Layouts" },
  { id: "layout.new", route: "prism://layouts/new", kind: "editor", entity: "layout", back: "scene", title: "New layout" },
  { id: "layout.edit", route: "prism://layout/:id/edit", kind: "editor", entity: "layout", back: "scene", title: "Layout editor" },
  // facets
  { id: "facets", route: "prism://facets", kind: "list", entity: "facet", back: "scene", title: "Facets" },
  { id: "facet.new", route: "prism://facets/new", kind: "editor", entity: "facet", back: "scene", title: "New facet", query: ["app", "class", "preset"] },
  { id: "facet.edit", route: "prism://facet/:id/edit", kind: "editor", entity: "facet", back: "scene", title: "Facet editor" },
  { id: "facet.full", route: "prism://facet/:id/full", kind: "action", entity: "facet", back: "scene", title: "Full page", transient: true },
  { id: "facet.reveal", route: "prism://facet/:id/reveal", kind: "action", entity: "facet", back: "scene", title: "Reveal the player", transient: true, query: ["mode", "signin"] },   // signin=1: the window opens on the service's sign-in page (2026-09-09)
  // apps
  { id: "apps", route: "prism://apps", kind: "list", entity: "app", back: "scene", title: "Apps" },
  { id: "app.new", route: "prism://apps/new", kind: "picker", entity: "app", back: "scene", title: "Add App", query: ["url", "role", "class"] },
  { id: "app.setup", route: "prism://app/:id/setup", kind: "settings", entity: "app", back: "scene", title: "App setup", query: ["url", "return", "signin"] },
  { id: "app.settings", route: "prism://app/:id/settings", kind: "settings", entity: "app", back: "scene", title: "App settings" },
  // news picker (§31 derived shelf) and the device page
  { id: "news.pick", route: "prism://news/pick", kind: "picker", entity: "news", back: "scene", title: "News", query: ["class", "role"] },
  { id: "device", route: "prism://device", kind: "view", entity: "device", back: "scene", title: "Device" },
];

const BY_ID = new Map(ROUTES.map((r) => [r.id, r]));

export function routeDef(id: string): RouteDef | undefined {
  return BY_ID.get(id);
}

export interface RouteMatch {
  def: RouteDef;
  params: Record<string, string>;
  query: Record<string, string>;
  /** The url as matched (scheme + path, query kept). */
  url: string;
}

/** Path segments; a single trailing slash is tolerated, an empty interior segment is not a route. */
function splitPath(s: string): string[] | null {
  const parts = s.endsWith("/") ? s.slice(0, -1).split("/") : s.split("/");
  return parts.some((p) => p.length === 0) ? null : parts;
}

/** Parse a `prism://` url against the registry; null when nothing matches. */
export function matchRoute(url: string): RouteMatch | null {
  if (!isPrismRoute(url)) return null;
  const rest = url.slice(ROUTE_SCHEME.length);
  const q = rest.indexOf("?");
  const path = q >= 0 ? rest.slice(0, q) : rest;
  const query: Record<string, string> = {};
  if (q >= 0) {
    for (const pair of rest.slice(q + 1).split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const k = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
      const v = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1)) : "";
      if (k) query[k] = v;
    }
  }
  const segs = splitPath(path);
  if (!segs) return null;
  for (const def of ROUTES) {
    const pat = splitPath(def.route.slice(ROUTE_SCHEME.length))!;
    if (pat.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      const p = pat[i]!, s = segs[i]!;
      if (p.startsWith(":")) {
        const v = decodeURIComponent(s);
        if (!v) { ok = false; break; }
        params[p.slice(1)] = v;
      } else if (p !== s) { ok = false; break; }
    }
    if (ok) return { def, params, query, url };
  }
  return null;
}

/** Build a url for a route id; every :param must be given, query keys are optional. */
export function buildRoute(id: string, params: Record<string, string> = {}, query: Record<string, string | undefined> = {}): string {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`unknown route id "${id}"`);
  const path = def.route.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
    const v = params[k];
    if (!v) throw new Error(`route ${id}: missing :${k}`);
    return seg(v);
  });
  const qs = Object.entries(query)
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0)
    .map(([k, v]) => `${seg(k)}=${seg(v)}`)
    .join("&");
  return qs ? `${path}?${qs}` : path;
}

/* ------------------------------------------------------ on-scene items ---- */

/** What a user can see on a scene (the walk-test's state ids are these kinds plus the sheet / full-page states). */
export type SceneItemKind = "video-facet" | "utility-facet" | "music-visualization" | "floating-facet" | "hidden-facet" | "placeholder-slot";

export interface SceneItemRef extends ItemContext {
  kind: SceneItemKind;
  scene: string;
  visualization?: string;
  /** The facet's current page, for "Open full page (setup mode)". */
  url?: string;
  muted?: boolean;
  /** The placement's standing tap instruction (concept-scenes §5); absent === "promote". */
  tapAction?: TapAction;
  /** The template this scene came from (its layout's provenance), when it did: the "Choose an app…" path re-opens that wizard on the scene. */
  template?: string;
  /** The template role this item answers (a slot id, or `hidden:N` for the N-th hidden role a visualization draws from). */
  role?: string;
  /** Multi-service lounge (2026-09-07): every music service in the scene, so a stage's sheet can open each one's player - not only the source's. */
  services?: Array<{ app: string; name: string; session?: string | null }>;
}

/** The five sheet labels, verbatim from §6a - the fixture vocabulary spells them "sheet:<label>". */
export const SHEET_LABELS: Readonly<Record<ContextSheetAction, string>> = {
  "open-setup": "Open full page (setup mode)",
  "edit-facet": "Edit facet",
  "app-settings": "App settings / sign in",
  "swap-facet": "Swap facet in this slot",
  mute: "Mute",
};

export interface SheetAction {
  action: ContextSheetAction | "sign-in" | "open-app" | "assign" | "edit-scene" | "choose-app" | "choose-music" | "add-music" | "remove-music" | "ads-sound" | "next-visual" | "visual-style";
  label: string;
  /** The deep link; null when the action does not apply to this item (rendered disabled, never hidden). */
  route: string | null;
  /** Why it is disabled, when it is. */
  note?: string;
}

/**
 * The compact context sheet for an item (§6a): each entry a deep link; the
 * sheet closes on action; Back returns to the scene. Actions that do not
 * apply render disabled with a note - never hidden, so the sheet reads the
 * same everywhere. "Open full page (setup mode)" carries the facet's page as
 * ?url= (setup mode AT that page); "App settings / sign in" is the App's
 * setup itself (sign-in lives there), so both resolve under app/:id/setup.
 */
export function contextSheetActions(item: SceneItemRef): SheetAction[] {
  // A template scene answers an empty slot the way it was built: the wizard, at that role (2026-09-05 audit -
  // the builder's picker was the only path, and it needs a facet to exist first).
  const wizard = item.template ? buildRoute("template.wizard", { id: item.template }, { scene: item.scene, role: item.role ?? item.item }) : null;
  if (item.kind === "placeholder-slot") {
    return [
      { action: "choose-app", label: "Choose an app…", route: wizard, ...(wizard ? {} : { note: "not a template scene, so use Assign a facet" }) },
      { action: "assign", label: "Assign a facet", route: routes.slotSwap(item.item) },
      { action: "edit-scene", label: "Edit scene", route: buildRoute("scene.edit", { id: item.scene }, { slot: item.item }) },
    ];
  }
  const ctx: ItemContext = { item: item.item, facet: item.facet ?? null, app: item.app ?? null };
  const inSlot = item.kind === "video-facet" || item.kind === "utility-facet" || item.kind === "music-visualization";
  const setup = routeForAction("open-setup", ctx);
  if (item.kind === "music-visualization") {
    // A stage is about music, not facets (decision 2026-09-06): its hidden page is never looked at as a
    // facet, so "Edit facet" and "Swap facet" only invited someone to crop a page they do not see.
    return [
      // B-146 (2026-09-08): the source's own group first - sign in, and its page as an inline window with Prism's menu bar
      ...(item.app && item.facet ? [
        { action: "sign-in" as const, label: "Sign in…", route: buildRoute("app.setup", { id: item.app }, { return: "scene", signin: "1" }) },
        { action: "open-app" as const, label: "Open the full app", route: routes.facetReveal(item.facet) + "?mode=window" },
      ] : []),
      { action: "choose-music", label: item.app ? "Change the music service…" : "Choose the music service…", route: buildRoute("item.musicService", { item: item.item }) },
      // multi-service lounge (2026-09-07): a second service joins this wall's music; its playlists and stations
      // appear under their own heading in Quick play, and the visual follows whichever one is picked
      { action: "add-music", label: "Add a music service…", route: buildRoute("item.musicAdd", { item: item.item }) },
      // B-195 (2026-09-09): "I see no workflow to remove an app" - a service leaves this wall's music the way it joined
      { action: "remove-music", label: "Remove a music service…", route: buildRoute("item.musicRemove", { item: item.item }) },
      // §26 ambient audio (opt-in): what plays instead of silence while a service runs its ads
      { action: "ads-sound", label: "Intermission…", route: buildRoute("item.musicAds", { item: item.item }) },
      { action: "next-visual", label: "Next visual", route: buildRoute("item.visualNext", { item: item.item }) },
      { action: "visual-style", label: "Visual style…", route: buildRoute("item.visualStyle", { item: item.item }) },
      { action: "open-setup", label: "Open the player (sign in)…", route: setup ? buildRoute("app.setup", { id: item.app! }, { url: item.url, return: "scene" }) : null, ...(setup ? {} : { note: "no music service yet" }) },
      // the other services on this wall: each one's player, straight to sign-in ("App settings" went to the source's - 2026-09-07)
      ...(item.services ?? []).filter((s) => s.app !== item.app).map((s) => ({ action: "open-setup" as const, label: `Open ${s.name} (sign in)…`, route: buildRoute("app.setup", { id: s.app }, { return: "scene", signin: "1" }) })),
      { action: "app-settings", label: SHEET_LABELS["app-settings"], route: setup ? buildRoute("app.setup", { id: item.app! }, { return: "scene" }) : null, ...(setup ? {} : { note: "no music service yet" }) },
      { action: "mute", label: item.muted ? "Unmute" : SHEET_LABELS.mute, route: routes.itemMute(item.item) },
    ];
  }
  return [
    { action: "open-setup", label: SHEET_LABELS["open-setup"], route: setup ? buildRoute("app.setup", { id: item.app! }, { url: item.url, return: "scene" }) : null, ...(setup ? {} : { note: "no App for this item" }) },
    { action: "edit-facet", label: SHEET_LABELS["edit-facet"], route: routeForAction("edit-facet", ctx), ...(item.facet ? {} : { note: "no facet for this item" }) },
    { action: "app-settings", label: SHEET_LABELS["app-settings"], route: setup ? buildRoute("app.setup", { id: item.app! }, { return: "scene" }) : null, ...(setup ? {} : { note: "no App for this item" }) },
    { action: "swap-facet", label: SHEET_LABELS["swap-facet"], route: inSlot ? routeForAction("swap-facet", ctx) : null, ...(inSlot ? {} : { note: "not in a slot" }) },
    { action: "mute", label: item.muted ? "Unmute" : SHEET_LABELS.mute, route: routes.itemMute(item.item) },
  ];
}

/**
 * Single tap on a video or music item (§6a): promote / reveal. Null for items
 * a tap does nothing special on — and for a placement whose standing
 * instruction is `tapAction: "audio"` (concept-scenes §5): that tap moves the
 * sound and nothing else, so there is no screen to route to. "both" still
 * promotes, so it keeps the full-page route.
 */
export function tapRoute(item: SceneItemRef): string | null {
  if (item.tapAction === "audio") return null;
  if (item.kind === "video-facet" && item.facet) return routes.facetFull(item.facet);
  // B-145 (2026-09-08): a tap on a stage does nothing - it took people straight into the service's page with no way
  // to tell Back from App settings; the page opens from the sheet (Open the full app) on purpose
  if (item.kind === "placeholder-slot") return routes.slotSwap(item.item);
  return null;
}

/** The needs-attention badge IS the shortcut: straight to the App's setup, returning to the scene with the facet reloading. */
export function needsAttentionRoute(appId: string): string {
  // signin=1: the sign-in wizard (straight to the sign-in page, the session probe decides), not the browsing setup
  return buildRoute("app.setup", { id: appId }, { return: "scene", signin: "1" });
}

/** During full-page / reveal: the corner affordance's two links. */
export function cornerAffordance(facetId: string, appId: string): { editFacet: string; appSettings: string } {
  return { editFacet: routes.facetEdit(facetId), appSettings: buildRoute("app.setup", { id: appId }, { return: "scene" }) };
}

/* -------------------------------------------------------- reach table ---- */

export interface ReachEntry {
  /** A visible-on-scene state id (the walk-test fixture's `states[].id`). */
  from: string;
  /** The route pattern reached. */
  to: string;
  /** The human gestures, in order. Selection gestures count 0 (B-32). */
  actions: string[];
}

export const SELECTION_GESTURES: readonly string[] = ["long-press", "right-click", "remote-hold"];

const sheet = (a: ContextSheetAction) => `sheet:${SHEET_LABELS[a]}`;

/**
 * How each visible state reaches each destination - the shell implements
 * exactly these gestures. Editor ≤ 1 action, App settings ≤ 2 (§6a).
 * The fixture (SM-5 @8680bec) files a tap under item/:item/sheet because
 * promote and reveal are host calls, not screens; the shell's tap still
 * promotes / reveals (facet/:id/full · facet/:id/reveal are the deep links).
 */
export const REACH: readonly ReachEntry[] = [
  // a video facet in a slot
  { from: "video-facet", to: "prism://facet/:id/edit", actions: ["long-press", sheet("edit-facet")] },
  { from: "video-facet", to: "prism://app/:id/setup", actions: ["long-press", sheet("app-settings")] },
  { from: "video-facet", to: "prism://item/:item/sheet", actions: ["tap"] },
  { from: "video-facet", to: "prism://facet/:id/full", actions: ["tap"] },
  { from: "video-facet", to: "prism://item/:item/swap", actions: ["long-press", sheet("swap-facet")] },
  // a visualization whose source is a hidden music facet
  { from: "music-visualization", to: "prism://item/:item/visual/style", actions: ["long-press", "sheet:Visual style…"] },
  { from: "music-visualization", to: "prism://item/:item/visual/next", actions: ["long-press", "sheet:Next visual"] },
  { from: "music-visualization", to: "prism://item/:item/music/add", actions: ["long-press", "sheet:Add a music service…"] },
  { from: "music-visualization", to: "prism://item/:item/music/remove", actions: ["long-press", "sheet:Remove a music service…"] },
  { from: "music-visualization", to: "prism://item/:item/music/ads", actions: ["long-press", "sheet:Intermission…"] },
  { from: "music-visualization", to: "prism://app/:id/setup", actions: ["long-press", sheet("app-settings")] },
  { from: "music-visualization", to: "prism://item/:item/sheet", actions: ["tap"] },
  { from: "music-visualization", to: "prism://facet/:id/reveal", actions: ["long-press", "sheet:Open the full app"] },
  { from: "music-visualization", to: "prism://app/:id/setup", actions: ["long-press", "sheet:Sign in…"] },
  // the needs-attention badge is itself the shortcut
  { from: "needs-attention-badge", to: "prism://app/:id/setup", actions: ["badge-tap"] },
  { from: "needs-attention-badge", to: "prism://facet/:id/edit", actions: ["long-press", sheet("edit-facet")] },
  // floating facets: same interactions as slot facets
  { from: "floating-facet", to: "prism://facet/:id/edit", actions: ["long-press", sheet("edit-facet")] },
  { from: "floating-facet", to: "prism://app/:id/setup", actions: ["long-press", sheet("app-settings")] },
  // a hidden facet is reached through its now-playing card / pill row
  { from: "hidden-facet", to: "prism://facet/:id/edit", actions: ["long-press", sheet("edit-facet")] },
  { from: "hidden-facet", to: "prism://app/:id/setup", actions: ["long-press", sheet("app-settings")] },
  // an unassigned slot (App-poster placeholder): tap assigns; the sheet's "Edit facet" opens the slot picker (no facet yet) - fixture keys it under facet/:id/edit
  { from: "placeholder-slot", to: "prism://item/:item/swap", actions: ["tap"] },
  { from: "placeholder-slot", to: "prism://facet/:id/edit", actions: ["long-press", sheet("edit-facet")] },
  { from: "placeholder-slot", to: "prism://scene/:id/edit", actions: ["long-press", sheet("edit-facet")] },
  // during full-page / reveal: the corner affordance and Back
  { from: "full-page-reveal", to: "prism://facet/:id/edit", actions: ["corner:Edit this facet"] },
  { from: "full-page-reveal", to: "prism://app/:id/setup", actions: ["corner:App settings"] },
  { from: "full-page-reveal", to: "prism://scene/:id", actions: ["key:Back"] },
  // the sheet itself, open over any item
  { from: "context-sheet", to: "prism://facet/:id/edit", actions: [sheet("edit-facet")] },
  { from: "context-sheet", to: "prism://app/:id/setup", actions: [sheet("app-settings")] },
  { from: "context-sheet", to: "prism://app/:id/setup", actions: [sheet("open-setup")] },
  { from: "context-sheet", to: "prism://app/:id/settings", actions: [sheet("app-settings")] },
  { from: "context-sheet", to: "prism://item/:item/swap", actions: [sheet("swap-facet")] },
  { from: "context-sheet", to: "prism://item/:item/mute", actions: [sheet("mute")] },
];

/** Actions that count under B-32: everything but the selection gestures. */
export function actionCount(actions: readonly string[]): number {
  return actions.filter((a) => !SELECTION_GESTURES.includes(a)).length;
}

/* ----------------------------------------------------------- registry ---- */

export interface RouteRegistry {
  version: 1;
  generatedFrom: string;
  counting: string;
  selectionGestures: string[];
  routes: Array<{ id: string; route: string; kind: RouteKind; entity: RouteEntity; back: "scene"; title: string; query?: string[]; transient?: boolean }>;
  reach: Array<{ from: string; to: string; actions: string[] }>;
  sheet: string[];
  sheetActions: ContextSheetAction[];
}

/** The JSON the walk-test consumes (packages/core/routes.registry.json is this, committed; a test keeps it equal). */
export function routeRegistry(): RouteRegistry {
  return {
    version: 1,
    generatedFrom: "packages/core/src/routes.ts",
    counting: "selection gestures (long-press / right-click / remote-hold) count 0; every choice, tap, badge-tap or corner affordance counts 1 (ledger B-32)",
    selectionGestures: [...SELECTION_GESTURES],
    routes: ROUTES.map((r) => ({ id: r.id, route: r.route, kind: r.kind, entity: r.entity, back: r.back, title: r.title, ...(r.query ? { query: [...r.query] } : {}), ...(r.transient ? { transient: true } : {}) })),
    reach: REACH.map((r) => ({ from: r.from, to: r.to, actions: [...r.actions] })),
    sheet: CONTEXT_SHEET_ACTIONS.map((a) => SHEET_LABELS[a]),
    sheetActions: [...CONTEXT_SHEET_ACTIONS],
  };
}

/* --------------------------------------------------------- back stack ---- */

/**
 * The shell's navigation stack, decided here: `push` opens a screen over the
 * current one; `back` lands on the scene whatever is stacked (§6a); `done`
 * completes the top screen and returns the one that opened it (a wizard
 * resumes), or the scene when nothing did.
 */
export class RouteStack {
  private stack: RouteMatch[] = [];

  constructor(private sceneRoute: () => string | null) {}

  depth(): number { return this.stack.length; }
  top(): RouteMatch | null { return this.stack[this.stack.length - 1] ?? null; }
  entries(): readonly RouteMatch[] { return this.stack; }

  push(url: string): RouteMatch | null {
    const m = matchRoute(url);
    if (!m) return null;
    // a transient state replaces another transient state (tap a second video: the first collapses)
    if (m.def.transient && this.top()?.def.transient) this.stack.pop();
    this.stack.push(m);
    return m;
  }

  /** Back / Esc: everything closes; the scene is what remains. Returns the scene url (or null with no scene). */
  back(): string | null {
    this.stack = [];
    return this.sceneRoute();
  }

  /** Done / Save on the top screen: pop it, resume the opener (or the scene). */
  done(): { resume: RouteMatch | null; scene: string | null } {
    this.stack.pop();
    return { resume: this.top(), scene: this.top() ? null : this.sceneRoute() };
  }

  clear(): void { this.stack = []; }
}
