/**
 * Prism conformance checks (spec §23): a shell that passes is a Prism.
 *
 * Everything runs through the one documented remote API (§6) — no
 * privileged channel — so any shell on any platform can self-verify. The
 * kit needs the device's dashboard bundle (the tester knows what they
 * loaded) to compute reference layouts with the same prism-core the shells
 * embed; rects must match BIT-IDENTICALLY.
 */

import {
  layoutDashboard,
  type DashboardBundle,
  type DashboardDocument,
  type RemoteStateSnapshot,
  type SolvedRects,
  type Viewport,
} from "prism-core";

/** Transport: how the kit reaches the shell. `token: null` = unauthenticated. */
export type Transport = (
  method: string,
  path: string,
  body: string | null,
  token: string | null,
) => Promise<{ status: number; body: string }>;

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

interface Ctx {
  t: Transport;
  token: string;
  bundle: DashboardBundle;
  results: CheckResult[];
}

const ok = (ctx: Ctx, name: string, detail: string): void => {
  ctx.results.push({ name, pass: true, detail });
};
const fail = (ctx: Ctx, name: string, detail: string): void => {
  ctx.results.push({ name, pass: false, detail });
};

async function getJson<T>(ctx: Ctx, path: string): Promise<{ status: number; value: T | null }> {
  const res = await ctx.t("GET", path, null, ctx.token);
  // A non-200 body is an error envelope, never the requested shape.
  if (res.status !== 200) return { status: res.status, value: null };
  try {
    return { status: res.status, value: JSON.parse(res.body) as T };
  } catch {
    return { status: res.status, value: null };
  }
}

function activeDoc(ctx: Ctx, state: RemoteStateSnapshot): DashboardDocument | undefined {
  return ctx.bundle.dashboards.find((d) => d.id === state.dashboard);
}

function referenceRects(doc: DashboardDocument, viewport: Viewport, state: RemoteStateSnapshot): SolvedRects {
  const override: { hero?: string; heroSize?: number } = {};
  if (state.hero !== null) override.hero = state.hero;
  if (state.heroSize !== null) override.heroSize = state.heroSize;
  return layoutDashboard(doc, viewport, override);
}

function rectsIdentical(a: SolvedRects, b: SolvedRects): string | null {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.join(",") !== bKeys.join(",")) {
    return `tile sets differ: [${aKeys}] vs [${bKeys}]`;
  }
  for (const id of aKeys) {
    for (const k of ["x", "y", "w", "h"] as const) {
      if (a[id]![k] !== b[id]![k]) {
        return `${id}.${k}: device ${b[id]![k]} ≠ reference ${a[id]![k]}`;
      }
    }
  }
  return null;
}

async function fetchStateAndRects(ctx: Ctx): Promise<{
  state: RemoteStateSnapshot;
  viewport: Viewport;
  rects: SolvedRects;
} | null> {
  const state = await getJson<RemoteStateSnapshot>(ctx, "/state");
  const rects = await getJson<{ viewport: Viewport; rects: SolvedRects }>(ctx, "/rects");
  if (state.status !== 200 || !state.value || rects.status !== 200 || !rects.value) return null;
  return { state: state.value, viewport: rects.value.viewport, rects: rects.value.rects };
}

/* ------------------------------ checks ------------------------------ */

async function checkAuth(ctx: Ctx): Promise<void> {
  const res = await ctx.t("GET", "/state", null, null);
  if (res.status === 401) ok(ctx, "auth-required", "unauthenticated /state → 401");
  else fail(ctx, "auth-required", `unauthenticated /state → ${res.status}, expected 401`);
}

async function checkStateShape(ctx: Ctx): Promise<void> {
  const { status, value } = await getJson<RemoteStateSnapshot>(ctx, "/state");
  if (status !== 200 || !value) return fail(ctx, "state-shape", `/state → ${status}`);
  const missing = ["dashboard", "name", "layoutMode", "tiles", "dashboards"].filter(
    (k) => !(k in value),
  );
  if (missing.length) return fail(ctx, "state-shape", `missing fields: ${missing.join(", ")}`);
  if (!ctx.bundle.dashboards.some((d) => d.id === value.dashboard)) {
    return fail(ctx, "state-shape", `active dashboard '${value.dashboard}' not in supplied bundle`);
  }
  ok(ctx, "state-shape", `dashboard '${value.dashboard}', ${value.tiles.length} tiles`);
}

async function checkRects(ctx: Ctx): Promise<void> {
  const snap = await fetchStateAndRects(ctx);
  if (!snap) return fail(ctx, "rects-solver-identical", "/state or /rects unavailable");
  const doc = activeDoc(ctx, snap.state);
  if (!doc) return fail(ctx, "rects-solver-identical", "active dashboard not in bundle");
  const diff = rectsIdentical(referenceRects(doc, snap.viewport, snap.state), snap.rects);
  if (diff) fail(ctx, "rects-solver-identical", diff);
  else ok(ctx, "rects-solver-identical", `${Object.keys(snap.rects).length} rects bit-identical at ${snap.viewport.w}×${snap.viewport.h}`);
}

async function checkHeroPromotion(ctx: Ctx): Promise<void> {
  const before = await fetchStateAndRects(ctx);
  if (!before) return fail(ctx, "hero-promotion", "state unavailable");
  if (before.state.layoutMode !== "hero" || before.state.tiles.length < 2) {
    return ok(ctx, "hero-promotion", "skipped (not a multi-tile hero layout)");
  }
  const target = before.state.tiles.find((t) => t.id !== before.state.hero)!.id;
  const res = await ctx.t("POST", `/tiles/${target}/command`, JSON.stringify({ cmd: "hero" }), ctx.token);
  if (res.status !== 200) return fail(ctx, "hero-promotion", `hero cmd → ${res.status}`);

  const after = await fetchStateAndRects(ctx);
  if (!after || after.state.hero !== target) {
    return fail(ctx, "hero-promotion", `hero is '${after?.state.hero}', expected '${target}'`);
  }
  const doc = activeDoc(ctx, after.state)!;
  const diff = rectsIdentical(referenceRects(doc, after.viewport, after.state), after.rects);
  // restore
  if (before.state.hero) {
    await ctx.t("POST", `/tiles/${before.state.hero}/command`, JSON.stringify({ cmd: "hero" }), ctx.token);
  }
  if (diff) fail(ctx, "hero-promotion", `re-solve mismatch: ${diff}`);
  else ok(ctx, "hero-promotion", `promoted '${target}', re-solve bit-identical, restored`);
}

async function checkLayoutSwitch(ctx: Ctx): Promise<void> {
  const { value: state } = await getJson<RemoteStateSnapshot>(ctx, "/state");
  if (!state) return fail(ctx, "layout-switch", "state unavailable");
  if (state.dashboards.length < 2) return ok(ctx, "layout-switch", "skipped (single dashboard)");
  const home = state.dashboard;
  for (const id of state.dashboards) {
    const res = await ctx.t("PUT", `/layout/${id}`, null, ctx.token);
    if (res.status !== 200) return fail(ctx, "layout-switch", `PUT /layout/${id} → ${res.status}`);
    const now = await getJson<RemoteStateSnapshot>(ctx, "/state");
    if (now.value?.dashboard !== id) {
      return fail(ctx, "layout-switch", `after PUT /layout/${id}, active is '${now.value?.dashboard}'`);
    }
    const snap = await fetchStateAndRects(ctx);
    const doc = snap && activeDoc(ctx, snap.state);
    const diff = snap && doc ? rectsIdentical(referenceRects(doc, snap.viewport, snap.state), snap.rects) : "state unavailable";
    if (diff) return fail(ctx, "layout-switch", `rects on '${id}': ${diff}`);
  }
  await ctx.t("PUT", `/layout/${home}`, null, ctx.token);
  ok(ctx, "layout-switch", `${state.dashboards.length} dashboards switch + solve correctly`);
}

async function checkCarouselWrap(ctx: Ctx): Promise<void> {
  const { value: state } = await getJson<RemoteStateSnapshot>(ctx, "/state");
  if (!state) return fail(ctx, "carousel-wrap", "state unavailable");
  if (state.dashboards.length < 2) return ok(ctx, "carousel-wrap", "skipped (single dashboard)");
  const start = state.dashboard;
  for (let i = 0; i < state.dashboards.length; i++) {
    const res = await ctx.t("POST", "/carousel/next", null, ctx.token);
    if (res.status !== 200) return fail(ctx, "carousel-wrap", `carousel/next → ${res.status}`);
  }
  const { value: after } = await getJson<RemoteStateSnapshot>(ctx, "/state");
  if (after?.dashboard === start) ok(ctx, "carousel-wrap", `${state.dashboards.length} steps wrap home`);
  else fail(ctx, "carousel-wrap", `ended on '${after?.dashboard}', expected '${start}'`);
}

async function checkRejections(ctx: Ctx): Promise<void> {
  const { value: state } = await getJson<RemoteStateSnapshot>(ctx, "/state");
  const tile = state?.tiles[0]?.id ?? "x";
  const cases: Array<[string, string, string | null, number]> = [
    ["POST", `/tiles/${tile}/command`, JSON.stringify({ cmd: "warp" }), 400],
    ["POST", "/tiles/definitely-not-a-tile/command", JSON.stringify({ cmd: "hero" }), 404],
    ["GET", "/definitely-not-a-route", null, 404],
    ["PUT", "/layout/definitely-not-a-dashboard", null, 404],
  ];
  for (const [method, path, body, expected] of cases) {
    const res = await ctx.t(method, path, body, ctx.token);
    if (res.status !== expected) {
      return fail(ctx, "rejects-invalid", `${method} ${path} → ${res.status}, expected ${expected}`);
    }
  }
  ok(ctx, "rejects-invalid", "bad cmd 400 · bad tile 404 · bad route 404 · bad dashboard 404");
}

async function checkReload(ctx: Ctx): Promise<void> {
  const { value: state } = await getJson<RemoteStateSnapshot>(ctx, "/state");
  const tile = state?.tiles[0]?.id;
  if (!tile) return fail(ctx, "reload-accepted", "no tiles");
  const res = await ctx.t("POST", `/tiles/${tile}/command`, JSON.stringify({ cmd: "reload" }), ctx.token);
  if (res.status === 200) ok(ctx, "reload-accepted", `reload '${tile}' accepted (§16 path)`);
  else fail(ctx, "reload-accepted", `reload → ${res.status}`);
}

/** §5: every blocking category is attributed — no anonymous filtering, ever. */
async function checkBlockingAttribution(ctx: Ctx): Promise<void> {
  const { status, value } = await getJson<{ sources: Array<Record<string, unknown>> }>(ctx, "/blocking");
  if (status !== 200 || !value) return fail(ctx, "blocking-attributed", `/blocking → ${status}`);
  const required = ["name", "maintainer", "url", "license", "syncedAt", "entryCount", "enabled"];
  for (const src of value.sources) {
    const missing = required.filter((k) => !(k in src));
    if (missing.length) return fail(ctx, "blocking-attributed", `source '${String(src["id"])}' missing ${missing.join(", ")}`);
    if (typeof src["url"] !== "string" || !/^https?:\/\//.test(src["url"]) || (src["url"] as string).includes("?")) {
      return fail(ctx, "blocking-attributed", `source '${String(src["id"])}' has no plain upstream URL`);
    }
  }
  ok(ctx, "blocking-attributed", `${value.sources.length} categories, each with name/maintainer/url/license/sync/count`);
}

/** §14: capability and behavior agree, and the stream path never takes a pairing token. */
async function checkListeningHonesty(ctx: Ctx): Promise<void> {
  const { status, value } = await getJson<{ supported: boolean; transports: string[] }>(ctx, "/audio/listen");
  if (status !== 200 || !value) return fail(ctx, "listening-honest", `/audio/listen → ${status}`);
  const join = await ctx.t("POST", "/audio/listen", JSON.stringify({ enable: true }), ctx.token);
  if (value.supported) {
    if (value.transports.length === 0) return fail(ctx, "listening-honest", "supported but no transports");
    if (join.status !== 200) return fail(ctx, "listening-honest", `supported but join → ${join.status}`);
    await ctx.t("POST", "/audio/listen", JSON.stringify({ enable: false }), ctx.token); // leave cleanly
  } else {
    if (value.transports.length !== 0) return fail(ctx, "listening-honest", "unsupported but advertises transports");
    if (join.status !== 501) return fail(ctx, "listening-honest", `unsupported but join → ${join.status}, expected 501`);
  }
  // The stream is ticket-only: a pairing token in the URL must never stream.
  const leak = await ctx.t("GET", `/audio/stream?ticket=${ctx.token}`, null, null);
  if (leak.status === 200) return fail(ctx, "listening-honest", "pairing token accepted on /audio/stream");
  ok(ctx, "listening-honest", `${value.supported ? `serves ${value.transports.join("+")}` : "unsupported, says so"} · stream refuses pairing token (${leak.status})`);
}

/** §26: a skip command never forwards unless the player's affordance was observed. */
async function checkSkipNeverAutonomous(ctx: Ctx): Promise<void> {
  const { value: state } = await getJson<RemoteStateSnapshot>(ctx, "/state");
  const tiles = state?.tiles ?? [];
  if (!tiles.length) return fail(ctx, "skip-human-only", "no tiles");
  for (const t of tiles) {
    if (t.skipAvailable) continue; // an observed affordance may legitimately forward
    const res = await ctx.t("POST", `/tiles/${t.id}/command`, JSON.stringify({ cmd: "skip" }), ctx.token);
    if (res.status === 200) return fail(ctx, "skip-human-only", `'${t.id}' forwarded a skip with no observed affordance`);
  }
  ok(ctx, "skip-human-only", `skip refused (400/409) on ${tiles.filter((t) => !t.skipAvailable).length} tiles without an observed affordance`);
}

/* ------------------------------ runner ------------------------------ */

export async function runConformance(
  transport: Transport,
  token: string,
  bundle: DashboardBundle,
): Promise<CheckResult[]> {
  const ctx: Ctx = { t: transport, token, bundle, results: [] };
  await checkAuth(ctx);
  await checkStateShape(ctx);
  await checkRects(ctx);
  await checkHeroPromotion(ctx);
  await checkLayoutSwitch(ctx);
  await checkCarouselWrap(ctx);
  await checkRejections(ctx);
  await checkReload(ctx);
  await checkBlockingAttribution(ctx);
  await checkListeningHonesty(ctx);
  await checkSkipNeverAutonomous(ctx);
  return ctx.results;
}

export function formatReport(results: CheckResult[]): string {
  const width = Math.max(...results.map((r) => r.name.length));
  const lines = results.map(
    (r) => `${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`,
  );
  const failed = results.filter((r) => !r.pass).length;
  lines.push("");
  lines.push(
    failed === 0
      ? `All ${results.length} checks passed — this shell is a Prism.`
      : `${failed}/${results.length} checks FAILED — not conformant.`,
  );
  return lines.join("\n");
}
