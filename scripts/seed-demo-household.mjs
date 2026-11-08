#!/usr/bin/env node
/**
 * The demo household — "the Parkers" (docs/concept-scenes.md §7, CS-5).
 *
 * One plausible family, seeded as local data, so screenshots, the golden path
 * (docs/bugs/GOLDEN-PATH.md) and CS-5's fixture all describe the same house:
 *
 *   - two adults, two kids. The names appear on the chore list and the
 *     calendar and NOWHERE else — no invented accounts, no logos we do not
 *     own, no third-party service presented as if signed in.
 *   - a fake week (school run, soccer at 4, dentist Thursday, pizza Friday) as
 *     LOCAL data. This script makes no network call of any kind (§19/§22).
 *   - a chore list: six items, three done, one assigned to each person.
 *   - the five concept Scene Templates instantiated through core's
 *     `instantiateTemplate`, with PLACEHOLDER heroes: every role that would
 *     need an account resolves to `demo:placeholder`, which is deliberately
 *     not a saved facet, so the slot renders the App-poster placeholder
 *     (scene-model spec §5) and the demo needs no sign-in. Family Hub is
 *     instantiated at a PORTRAIT canvas (9:16), the other four at 16:9.
 *   - Music Lounge (charter §2.5) among them, and IDLE: its hidden `source`
 *     role takes the same placeholder, so the wall shows the Prism Beams
 *     stage drifting on the ambient signal with an empty metadata line and
 *     the dark substrate behind it (§2.5.2 point 6). No service, no login,
 *     no third-party name presented as signed in. `DEMO_TRACK` below is
 *     FIXTURE data for that stage — the seed never plays it.
 *
 * §10 (never wipe) is the design constraint, not an afterthought:
 *
 *   - everything the seed creates is namespaced (`demo:*` keys, `demo-*`
 *     entity ids) and every created id is recorded in a receipt (`demo:seed`).
 *   - `--reset` removes exactly what that receipt says the seed created and
 *     refuses outright on a store it never touched. It never rewrites a value
 *     a human changed after the seed; it says so and leaves it alone.
 *   - an entity id that already existed is NOT overwritten and NOT recorded,
 *     so reset leaves it standing.
 *   - the seed is idempotent: a second run resets its own prior seed first,
 *     so the store holds one household, not two — byte for byte the same.
 *   - the real store (`%LOCALAPPDATA%\Prism\store.json`) is only touched
 *     behind the explicit `--live` flag, and store.json is copied to
 *     `%LOCALAPPDATA%\Prism-backup-<timestamp>\store.json` before any write.
 *     Profiles and snapshots are never read, moved or removed.
 *
 * Usage:
 *   node scripts/seed-demo-household.mjs                    seed the sandbox store
 *   node scripts/seed-demo-household.mjs --reset            remove the seed from it
 *   node scripts/seed-demo-household.mjs --store <path>     a store.json of your choosing
 *   node scripts/seed-demo-household.mjs --live             the real store (backs up first)
 *   node scripts/seed-demo-household.mjs --print            dry run: print the plan, write nothing
 *   node scripts/seed-demo-household.mjs --week-of 2026-09-07   anchor Monday of the fake week
 *   node scripts/seed-demo-household.mjs --no-activate      do not touch scene-model:active-scene
 *   node scripts/seed-demo-household.mjs --core <dir>       packages/core (for its dist/)
 *   --json  machine-readable result
 *
 * Exit: 0 done · 1 refused / failed · 2 core dist absent · 3 reset on a store
 *       this seed never touched (nothing was written)
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

/* ------------------------------------------------------------ constants ---- */

export const SEED_SCHEMA = "prism.demo-household/v0.1";
export const RECEIPT_KEY = "demo:seed";

/** The scene-model stores (mirrors core's SCENE_MODEL_KEYS; kept literal so this script needs no core import to reset). */
export const STORE_KEYS = {
  apps: "scene-model:apps",
  facets: "scene-model:facets",
  layouts: "scene-model:layouts",
  scenes: "scene-model:scenes",
  activeScene: "scene-model:active-scene",
};

/**
 * The ref every account-needing role resolves to. It is deliberately NOT a
 * saved facet, so `sceneDocument` renders the slot as the App-poster
 * placeholder (scene-model spec §5) and the demo shows nothing we have no
 * right to show. Tapping it is the household's "assign an app here".
 *
 * §7a hidden roles take it too (Music Lounge's `source`). A hidden placement
 * naming a facet that does not exist produces NO hidden tile — so the
 * visualization sourced to it has no music state at all, `visualizationFeed`
 * reports `active: false`, and the stage draws the ambient idle drift with an
 * empty metadata line over the dark substrate (charter §2.5.2 point 6). That
 * is exactly the honest idle the demo wants: the alternative — a seed-made App
 * and facet on `https://tiles.prism/…` marked `music: true` — would have to
 * name a first-party music page that does not exist, load a 404 into a hidden
 * surface and show it on reveal (§2.5.3). One placeholder ref, one gesture
 * ("assign an app here"), and `sceneDocument` reports it as a note rather than
 * swallowing it.
 */
export const PLACEHOLDER_REF = "demo:placeholder";

/**
 * The staged track for the Music Lounge shot — "Aurora Skies" by "The
 * Refractions", both fictional, like the Parkers themselves.
 *
 * This is FIXTURE data, not something the seed plays: the seed leaves the
 * lounge idle (there is no source to play it). It is defined here, once, so
 * the fixtures and the marketing shot answer to one text — drive it through
 * the REAL path (`MusicStateModel.onMediaSession` with `demoTrackEvents()`,
 * then `feed(...)`) rather than writing the strings out again.
 *
 * `artwork` is null on purpose: we own no album art, nothing is bundled and
 * nothing is fetched (§19/§22), so `backdrop` mode keeps the dark substrate
 * and the palette stays the style pack's own.
 *
 * The three `line` strings are assembled from CODE POINTS (em dash, middot,
 * eighth note) rather than typed, so this constant is plain ASCII on disk and
 * cannot drift with an encoding round-trip; they are the same glyphs
 * `PrismHost.Visualizations.VisualizationChrome` builds host-side, and the
 * fixtures compare against that one text.
 */
const EM_DASH = String.fromCharCode(0x2014);
const MIDDOT = String.fromCharCode(0x00b7);
const EIGHTH_NOTE = String.fromCharCode(0x266a);

export const DEMO_TRACK = {
  title: "Aurora Skies",
  artist: "The Refractions",
  artwork: null,
  /** What the staged page registered on `navigator.mediaSession` — what transport may offer (§32 layer 3). */
  actions: ["play", "pause", "previoustrack", "nexttrack"],
  /**
   * The bottom-left metadata BLOCK the shot shows (§2.5.2 point 3 as amended by
   * P4, adopted 2026-09-03): TWO lines, not one. Line 1 is the title in the
   * display face; line 2 is `artist ${MIDDOT} state`, the artist in dim sans and
   * the state alone in dim monospace. The renderer builds the block from the
   * FIELDS above (`title` / `artist`), never by parsing a joined string — these
   * strings are the fixture's expected output, not its input.
   *
   * `now` is kept as the pre-P4 joined form so nothing that still reads it
   * breaks; it is no longer what the wall draws.
   */
  line: {
    title: "Aurora Skies",
    artistAndOwner: `The Refractions ${MIDDOT} ${EIGHTH_NOTE} exclusive`,
    artistAndMuted: `The Refractions ${MIDDOT} muted`,
    now: `Aurora Skies ${EM_DASH} The Refractions`,
    owner: `${EIGHTH_NOTE} exclusive`,
    muted: `muted`,
  },
};

/**
 * `DEMO_TRACK` as the Media Session events the injected observer would post
 * (`MediaSessionEvent`, packages/core/src/music-state.ts) — metadata, then
 * playing, then the registered actions. A fixture replays exactly these into
 * `MusicStateModel`; nothing here reaches the store or the wall.
 */
export function demoTrackEvents(track = DEMO_TRACK) {
  return [
    { type: "metadata", metadata: { title: track.title, artist: track.artist, artwork: track.artwork } },
    { type: "playbackState", state: "playing" },
    { type: "actions", actions: [...track.actions] },
  ];
}

/** Monday of the fake week. Fixed so the seed is deterministic (a fixture, not a clock). */
export const DEFAULT_WEEK_OF = "2026-09-07";

/** The canvases the templates are instantiated at. Family Hub is portrait by design (charter §2.4). */
export const CANVAS_LANDSCAPE = { w: 1920, h: 1080 };
export const CANVAS_PORTRAIT = { w: 1080, h: 1920 };

/* ------------------------------------------------------------ the family ---- */

/**
 * The Parkers. Fictional. These names reach the chore list and the calendar
 * and nothing else — no App, no profile id, no facet label, no scene name.
 */
export const HOUSEHOLD = {
  schema: SEED_SCHEMA,
  id: "the-parkers",
  name: "The Parkers",
  members: [
    { id: "alex", name: "Alex", role: "adult" },
    { id: "sam", name: "Sam", role: "adult" },
    { id: "maya", name: "Maya", role: "child" },
    { id: "leo", name: "Leo", role: "child" },
  ],
  note: "Fictional demo data seeded by scripts/seed-demo-household.mjs. Nothing here is an account and nothing here leaves the device.",
};

/** Six items, three done, at least one for each of the four people (charter §7). */
export function choreList() {
  return [
    { id: "chore-1", order: 1, text: "Empty the dishwasher", who: "maya", done: true },
    { id: "chore-2", order: 2, text: "Take the bins out", who: "sam", done: true },
    { id: "chore-3", order: 3, text: "Feed Biscuit", who: "leo", done: true },
    { id: "chore-4", order: 4, text: "Soccer kit in the wash", who: "maya", done: false },
    { id: "chore-5", order: 5, text: "Pick up the dentist forms", who: "alex", done: false },
    { id: "chore-6", order: 6, text: "Water the front planters", who: "leo", done: false },
  ];
}

export const CHORE_NOTES = "Soccer kit goes in Thursday night - early game Saturday. Pizza Friday, nobody cooks.";

const DAY_MS = 86400000;
const dayOf = (weekOf, offset) => new Date(Date.parse(weekOf + "T00:00:00Z") + offset * DAY_MS).toISOString().slice(0, 10);

/**
 * A week the household actually has: the school run every weekday, soccer at
 * 4, the dentist on Thursday, pizza on Friday. Local data — this function is
 * the whole calendar and it fetches nothing (§19/§22).
 */
export function calendarWeek(weekOf = DEFAULT_WEEK_OF) {
  const d = (n) => dayOf(weekOf, n);
  const at = (n, from, to, title, who) => ({ id: `evt-${d(n)}-${from.replace(":", "")}`, title, who, start: `${d(n)}T${from}:00`, end: `${d(n)}T${to}:00`, allDay: false });
  return [
    at(0, "07:40", "08:10", "School run", "sam"),
    at(1, "07:40", "08:10", "School run", "alex"),
    at(1, "16:00", "17:15", "Soccer practice", "maya"),
    at(2, "07:40", "08:10", "School run", "sam"),
    at(2, "19:00", "20:30", "Book club", "alex"),
    at(3, "07:40", "08:10", "School run", "alex"),
    at(3, "15:30", "16:15", "Dentist", "leo"),
    at(4, "07:40", "08:10", "School run", "sam"),
    at(4, "18:00", "19:30", "Pizza night", "everyone"),
    at(5, "09:30", "11:00", "Soccer - home game", "maya"),
    at(6, "10:00", "11:00", "Farmers market", "everyone"),
  ];
}

/* ---------------------------------------------------- adapters (CS-3/CS-4) ---- */

/**
 * ================= CS-3 RECONCILE POINT — CHORES (reconciled) =============
 * Agent 3's first-party chores micro-facet landed (`prism-chores`, served at
 * https://tiles.prism/chores/, remote-editable through the §6 remote API),
 * so this writes the REAL document the page and the phone both read:
 *
 *   "tiles:chores"  ->  JSON ChoresDoc { v: 1, items[], notes, updated }
 *   items[] = { id, text, done, who (a NAME, never an account), added, doneAt? }
 *
 * Shape and key come from `packages/core/src/tiles-data.ts` (CHORES_KEY,
 * normalizeChores) — the seeded list is a list the household can immediately
 * check off, not demo-only data sitting beside the real one. `who` carries
 * the member's display name because that is what the page shows; the seed's
 * own member ids stay internal to `demo:household`.
 *
 * Everything this file assumes about chores is still in this one function.
 * `--reset` is unchanged: it removes the keys this function names only while
 * their value is still the one it wrote, and restores a prior value verbatim
 * when the store already had one.
 * =========================================================================
 */
export function choresStoreEntries(chores, household, weekOf = DEFAULT_WEEK_OF) {
  const nameOf = (id) => household.members.find((m) => m.id === id)?.name ?? id;
  return [{
    key: "tiles:chores",
    value: {
      v: 1,
      items: chores.map((c) => ({
        id: c.id,
        text: c.text,
        done: c.done,
        who: nameOf(c.who),
        added: weekOf,
        ...(c.done ? { doneAt: weekOf } : {}),
      })),
      notes: CHORE_NOTES,
      updated: weekOf,
    },
  }];
}

/**
 * ============= RECONCILE POINT — CALENDAR (reconciled, CS-10.3) ==========
 * The first-party agenda micro-facet landed (`prism-agenda`, served at
 * https://tiles.prism/agenda/, remote-editable through the §6 remote API), so
 * this now writes the REAL document the page and the phone both read, exactly
 * as the chores reconcile above does. Personal calendars still connect through
 * Merge and work calendars remain a Merge roadmap item (charter §2.1) — the
 * facet renders a week the box already holds, it is not a calendar client.
 *
 * It writes TWO keys, both seeded and neither fetched:
 *   "tiles:agenda"   ->  JSON AgendaDoc { v: 1, weekOf, events[], updated }
 *                        (packages/core/src/tiles-data.ts, AGENDA_KEY)
 *   "demo:calendar"  ->  JSON { schema, household, weekOf, events[] }
 *
 * `demo:calendar` is KEPT: §10 never deletes what a store already holds, the
 * receipt-precise reset still owns it, and the two carry the same events in the
 * same shape (`{ id, title, who, start, end, allDay }`, local wall-clock ISO,
 * no timezone). `normalizeAgenda` parses either, so one renderer serves both.
 * =========================================================================
 */
export function calendarStoreEntries(events, household, weekOf) {
  return [{
    key: "tiles:agenda",
    value: {
      v: 1,
      weekOf,
      events,
      updated: 0,                 // the seed has no clock of its own; core stamps on the first edit
    },
  }, {
    key: "demo:calendar",
    value: {
      schema: "prism.demo-calendar/v0.1",
      household: household.id,
      weekOf,
      source: "local demo data - seeded, never fetched (dashboard-schema §19/§22)",
      events,
    },
  }];
}

/* ------------------------------------------------------- the entities ---- */

/**
 * The three first-party Apps the templates pre-resolve to (charter §1/§6). They
 * are the ONLY apps the seed creates: both are ours, neither needs an account,
 * and their setup status is "unknown" — the seed never claims a sign-in.
 * An App that already exists in the store is left exactly as it is.
 */
export const DEMO_APPS = [
  { id: "prism-chores", name: "Chores & notes", baseUrl: "https://tiles.prism/chores/", profileId: "prism-chores", catalogRef: "prism-chores", setup: { status: "unknown" } },
  { id: "prism-timer", name: "Timer", baseUrl: "https://tiles.prism/timer/", profileId: "prism-timer", catalogRef: "prism-timer", setup: { status: "unknown" } },
  { id: "prism-agenda", name: "Agenda", baseUrl: "https://tiles.prism/agenda/", profileId: "prism-agenda", catalogRef: "prism-agenda", setup: { status: "unknown" } },
];

/** The facets those Apps need, one per slot class the four templates ask for. */
export const DEMO_FACETS = [
  { id: "demo-chores-4x3-M", app: "prism-chores", url: "https://tiles.prism/chores/", slotClass: "4:3·M", label: "Chores & notes", audio: "mute", touch: "full" },
  { id: "demo-chores-1x1-M", app: "prism-chores", url: "https://tiles.prism/chores/", slotClass: "1:1·M", label: "Chores & notes", audio: "mute", touch: "full" },
  { id: "demo-timer-16x9-M", app: "prism-timer", url: "https://tiles.prism/timer/", slotClass: "16:9·M", label: "Timer", audio: "mix", touch: "full" },
  { id: "demo-agenda-4x3-M", app: "prism-agenda", url: "https://tiles.prism/agenda/", slotClass: "4:3·M", label: "Agenda", audio: "mute", touch: "full" },
  { id: "demo-agenda-1x1-M", app: "prism-agenda", url: "https://tiles.prism/agenda/", slotClass: "1:1·M", label: "Agenda", audio: "mute", touch: "full" },
];

/**
 * Which role of which template gets a real facet. Everything absent here —
 * every video hero, the photos panel, weather, the tickers, and
 * Music Lounge's hidden music `source` — resolves to PLACEHOLDER_REF and
 * renders the App-poster placeholder (a visualization role is never in here:
 * §7a, the wizard never asks about it).
 */
export const ROLE_FACETS = {
  "kitchen-command": { chores: "demo-chores-4x3-M", agenda: "demo-agenda-4x3-M" },
  "sports-multiview": {},
  "movie-night": {},
  "family-hub": { chores: "demo-chores-1x1-M", timer: "demo-timer-16x9-M", agenda: "demo-agenda-1x1-M" },
  "music-lounge": {},
};

/**
 * The five templates the demo instantiates, each at the canvas its blueprint
 * was drawn for. Music Lounge is the plain 16:9 variant, not "Lounge + clock":
 * the clock role would resolve to the timer micro-facet's COUNTDOWN until the
 * page grows a clock face (charter §2.5.1, CS-7's note), and a countdown in the
 * corner of the music wall is not what the concept shows.
 */
export const DEMO_SCENES = [
  { template: "kitchen-command", canvas: CANVAS_LANDSCAPE },
  { template: "sports-multiview", canvas: CANVAS_LANDSCAPE },
  { template: "movie-night", canvas: CANVAS_LANDSCAPE },
  { template: "family-hub", canvas: CANVAS_PORTRAIT },
  { template: "music-lounge", canvas: CANVAS_LANDSCAPE },
];

/** The scene the seed makes active (unless `--no-activate`). */
export const DEMO_ACTIVE_SCENE = "demo-kitchen-command";

/**
 * Build every entity and data key the seed would write. Pure: `core` is the
 * scene-model module (src in tests, dist at the command line), so the script
 * never guesses at layout maths — `instantiateTemplate` does it.
 */
export function seedPlan(core, options = {}) {
  const weekOf = options.weekOf ?? DEFAULT_WEEK_OF;
  const notes = [];
  const layouts = [];
  const scenes = [];

  for (const { template, canvas } of DEMO_SCENES) {
    const t = core.SCENE_TEMPLATES.find((x) => x.id === template);
    if (!t) throw new Error(`seed: core has no template "${template}"`);
    const roleFacets = ROLE_FACETS[template] ?? {};
    const resolved = {};
    // §7a: a visualization role is never resolved (the wizard never asks - it
    // follows the hidden role it names); a HIDDEN role is, exactly like a slot
    // role, and Music Lounge's takes the placeholder so the stage stays idle.
    for (const role of t.roles) {
      if (role.kind === "visualization") continue;
      resolved[role.id] = roleFacets[role.id] ?? PLACEHOLDER_REF;
    }
    for (const role of t.hidden ?? []) resolved[role.id] = roleFacets[role.id] ?? PLACEHOLDER_REF;
    const r = core.instantiateTemplate(t, canvas, resolved, { layoutId: `demo-${template}-layout`, sceneId: `demo-${template}` });
    if ("error" in r) throw new Error(`seed: template ${template} refused to instantiate (${r.unresolved.join(", ")})`);
    for (const n of r.notes) notes.push(`${template}: ${n}`);
    layouts.push(r.layout);
    scenes.push(r.scene);
  }

  const chores = choreList();
  const events = calendarWeek(weekOf);
  const dataEntries = [
    { key: "demo:household", value: HOUSEHOLD },
    ...calendarStoreEntries(events, HOUSEHOLD, weekOf),
    ...choresStoreEntries(chores, HOUSEHOLD, weekOf),
  ];

  return {
    weekOf,
    apps: DEMO_APPS.map((a) => ({ ...a })),
    facets: DEMO_FACETS.map((f) => ({ ...f })),
    layouts,
    scenes,
    dataEntries,
    activeScene: options.activate === false ? null : DEMO_ACTIVE_SCENE,
    household: HOUSEHOLD,
    chores,
    events,
    notes,
  };
}

/* -------------------------------------------------------- store helpers ---- */

/** Above this, a list's prior value is remembered by hash only (the receipt stays a receipt, not a second copy of the store). */
const PRIOR_VERBATIM_LIMIT = 262144;

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 32);
const parseList = (raw) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };

/** `{ version, data }` (the host's shape) or a bare key→value map. Missing file = an empty store. */
export function readStore(path) {
  if (!existsSync(path)) return { version: 1, data: {} };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed && typeof parsed === "object" && parsed.data && typeof parsed.data === "object" ? { version: parsed.version ?? 1, data: parsed.data } : { version: 1, data: parsed ?? {} };
}

/**
 * Compact JSON, the shape the host reads. Note: the host's own writer escapes
 * a quote inside a value as the " form and this one as backslash-quote,
 * so a live store's FILE bytes change on first write even though every key,
 * every value and their order do not — seed → reset is byte-identical through
 * one writer, which is part of why --live backs store.json up first.
 */
export function writeStore(path, store) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store), "utf8");
}

/* ------------------------------------------------------------ the seed ---- */

/**
 * Apply the plan to a store's data map. Returns a NEW map (key order is
 * preserved: existing keys keep their position, the seed's new keys append in
 * a fixed order, so seed → reset restores the store byte for byte).
 *
 * A second run resets its own prior seed first and reuses the prior receipt's
 * timestamp, so running the seed twice leaves one household and an identical
 * store.
 */
export function applySeed(data, core, options = {}) {
  let base = { ...data };
  const prior = readReceipt(base);
  let seededAt = options.now ?? new Date().toISOString();
  let reseeded = false;
  if (prior) {
    const undo = resetSeed(base);
    if (!undo.ok) return { ok: false, error: undo.error };
    base = undo.data;
    seededAt = prior.seededAt ?? seededAt;
    reseeded = true;
  }

  const plan = seedPlan(core, options);
  const created = { apps: [], facets: [], layouts: [], scenes: [] };
  const lists = {};
  const skipped = [];

  const mergeList = (key, kind, additions) => {
    const priorRaw = base[key];
    const priorPresent = typeof priorRaw === "string";
    const existing = priorPresent ? parseList(priorRaw) : [];
    const seen = new Set(existing.map((e) => e && e.id));
    const out = [...existing];
    for (const item of additions) {
      if (seen.has(item.id)) { skipped.push(`${kind} "${item.id}" already exists - left exactly as it is (§10), and reset will not remove it`); continue; }
      out.push(item);
      seen.add(item.id);
      created[kind].push(item.id);
    }
    const wrote = JSON.stringify(out);
    base[key] = wrote;
    // The prior value is kept verbatim when it is small enough to be worth it, so an
    // untouched store is restored byte for byte rather than re-serialized. Above the
    // cap only its hash is kept and reset falls back to removing the seeded ids.
    const keepPrior = priorPresent && priorRaw.length <= PRIOR_VERBATIM_LIMIT;
    lists[key] = {
      kind, priorPresent,
      ...(priorPresent ? { priorSha: sha(priorRaw) } : {}),
      ...(keepPrior ? { prior: priorRaw } : {}),
      wroteSha: sha(wrote), ids: created[kind].slice(),
    };
  };

  mergeList(STORE_KEYS.apps, "apps", plan.apps);
  mergeList(STORE_KEYS.facets, "facets", plan.facets);
  mergeList(STORE_KEYS.layouts, "layouts", plan.layouts);
  mergeList(STORE_KEYS.scenes, "scenes", plan.scenes);

  const keys = {};
  for (const { key, value } of plan.dataEntries) {
    const priorRaw = base[key];
    const priorPresent = typeof priorRaw === "string";
    const wrote = JSON.stringify(value);
    keys[key] = { priorPresent, ...(priorPresent ? { prior: priorRaw } : {}), wroteSha: sha(wrote) };
    base[key] = wrote;
  }

  let activeScene = null;
  if (plan.activeScene) {
    const priorRaw = base[STORE_KEYS.activeScene];
    activeScene = { priorPresent: typeof priorRaw === "string", ...(typeof priorRaw === "string" ? { prior: priorRaw } : {}), set: plan.activeScene };
    base[STORE_KEYS.activeScene] = plan.activeScene;
  }

  const receipt = {
    schema: SEED_SCHEMA,
    household: plan.household.id,
    seededAt,
    weekOf: plan.weekOf,
    created,
    lists,
    keys,
    ...(activeScene ? { activeScene } : {}),
  };
  base[RECEIPT_KEY] = JSON.stringify(receipt);

  return { ok: true, data: base, receipt, plan, created, skipped, reseeded, notes: plan.notes };
}

export function readReceipt(data) {
  const raw = data[RECEIPT_KEY];
  if (typeof raw !== "string") return null;
  try {
    const r = JSON.parse(raw);
    return r && r.schema === SEED_SCHEMA ? r : null;
  } catch { return null; }
}

/**
 * Remove exactly what the receipt says the seed created, and nothing else.
 * Refuses on a store this seed never touched. A value a human changed after
 * the seed is never rewritten wholesale: the seeded entities are filtered out
 * by id and everything else is kept, and a data key whose value no longer
 * matches is left standing with a note (§10 — never wipe).
 */
export function resetSeed(data) {
  const receipt = readReceipt(data);
  if (!receipt) return { ok: false, error: `no ${RECEIPT_KEY} receipt: this store was not seeded by seed-demo-household.mjs. Nothing was changed.` };

  const out = { ...data };
  const notes = [];
  const removed = { apps: [], facets: [], layouts: [], scenes: [], keys: [] };

  for (const [key, rec] of Object.entries(receipt.lists ?? {})) {
    const curRaw = out[key];
    if (typeof curRaw !== "string") { notes.push(`${key}: gone from the store already - nothing to remove`); continue; }
    const ids = new Set(rec.ids ?? []);
    const kept = parseList(curRaw).filter((e) => { const hit = e && ids.has(e.id); if (hit) removed[rec.kind].push(e.id); return !hit; });
    const untouched = sha(curRaw) === rec.wroteSha;
    if (!untouched) notes.push(`${key}: changed since the seed - removed only the ${removed[rec.kind].length} seeded ${rec.kind}, kept the other ${kept.length}`);
    if (untouched && typeof rec.prior === "string") out[key] = rec.prior;          // exact restore
    else if (!kept.length && !rec.priorPresent) delete out[key];
    else out[key] = JSON.stringify(kept);
  }

  for (const [key, rec] of Object.entries(receipt.keys ?? {})) {
    const curRaw = out[key];
    if (typeof curRaw !== "string") continue;
    if (sha(curRaw) !== rec.wroteSha) { notes.push(`${key}: edited since the seed - left exactly as it is (§10)`); continue; }
    if (rec.priorPresent) out[key] = rec.prior;
    else delete out[key];
    removed.keys.push(key);
  }

  const a = receipt.activeScene;
  if (a) {
    if (out[STORE_KEYS.activeScene] !== a.set) notes.push(`${STORE_KEYS.activeScene}: no longer the demo scene - left exactly as it is`);
    else if (a.priorPresent) out[STORE_KEYS.activeScene] = a.prior;
    else delete out[STORE_KEYS.activeScene];
  }

  delete out[RECEIPT_KEY];
  return { ok: true, data: out, removed, notes, receipt };
}

/* ---------------------------------------------------------------- CLI ---- */

function parseArgs(argv) {
  const out = { flags: new Set(), opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) { out.opts[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const name = a.slice(2);
    const next = argv[i + 1];
    if (["store", "core", "week-of", "now"].includes(name) && next && !next.startsWith("--")) { out.opts[name] = next; i++; continue; }
    out.flags.add(name);
  }
  return out;
}

function liveStorePath() {
  const local = process.env.LOCALAPPDATA ?? "";
  return local ? resolve(join(local, "Prism", "store.json")) : "";
}

function sandboxStorePath() {
  const local = process.env.LOCALAPPDATA ?? "";
  return resolve(join(local || tmpdir(), "Prism-demo-household", "store.json"));
}

/** The project's practice: `Prism-backup-<timestamp>`. Only store.json is copied — profiles and snapshots are never touched (and are gigabytes). */
function backupLiveStore(path) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  const dir = resolve(join(dirname(dirname(path)), `Prism-backup-${stamp}`));
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "store.json");
  if (existsSync(path)) copyFileSync(path, dest);
  return dest;
}

async function loadCore(coreDir) {
  const modPath = join(coreDir, "dist", "scene-model.js");
  if (!existsSync(modPath)) return { error: `core dist absent: ${modPath.replace(ROOT, ".")}\n  build it first:  cd packages/core && npx tsc -p tsconfig.json` };
  return { core: await import(pathToFileURL(modPath).href) };
}

async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  const asJson = flags.has("json");
  const live = flags.has("live");
  const dry = flags.has("print");
  const doReset = flags.has("reset");
  const coreDir = resolve(opts.core ?? join(ROOT, "packages", "core"));
  const livePath = liveStorePath();
  const storePath = live ? livePath : resolve(opts.store ?? sandboxStorePath());

  const say = (s) => { if (!asJson) console.log(s); };

  if (live && !livePath) { console.log("seed: --live needs %LOCALAPPDATA%. Pass --store <path> instead."); process.exit(1); }
  if (!live && livePath && storePath.toLowerCase() === livePath.toLowerCase()) {
    console.log(`seed: REFUSED - ${storePath} is the real store. Pass --live to say so out loud (it backs store.json up first).`);
    process.exit(1);
  }

  say(`demo household "the Parkers"  ·  ${doReset ? "reset" : "seed"}${dry ? " (dry run)" : ""}`);
  say(`  store: ${storePath}${live ? "   [LIVE STORE]" : existsSync(storePath) ? "" : "   (new)"}`);

  const before = readStore(storePath);

  if (doReset) {
    const r = resetSeed(before.data);
    if (!r.ok) { console.log(`  REFUSED: ${r.error}`); process.exit(3); }
    const summary = { removed: r.removed, notes: r.notes };
    if (!dry) {
      if (live) say(`  backup: ${backupLiveStore(storePath)}`);
      writeStore(storePath, { version: before.version, data: r.data });
    }
    if (asJson) { console.log(JSON.stringify({ ok: true, action: "reset", store: storePath, dry, ...summary }, null, 2)); return; }
    say(`  removed: ${r.removed.apps.length} app(s), ${r.removed.facets.length} facet(s), ${r.removed.layouts.length} layout(s), ${r.removed.scenes.length} scene(s), ${r.removed.keys.length} demo key(s)`);
    for (const id of [...r.removed.layouts, ...r.removed.scenes]) say(`    - ${id}`);
    for (const n of r.notes) say(`    note  ${n}`);
    say(`  ${dry ? "would remove" : "removed"} the receipt ${RECEIPT_KEY}. Nothing else in the store was touched.`);
    return;
  }

  const loaded = await loadCore(coreDir);
  if (loaded.error) { console.log("  " + loaded.error); process.exit(2); }

  const r = applySeed(before.data, loaded.core, {
    ...(opts["week-of"] ? { weekOf: opts["week-of"] } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(flags.has("no-activate") ? { activate: false } : {}),
  });
  if (!r.ok) { console.log(`  FAILED: ${r.error}`); process.exit(1); }

  if (!dry) {
    if (live) say(`  backup: ${backupLiveStore(storePath)}`);
    writeStore(storePath, { version: before.version, data: r.data });
  }

  if (asJson) { console.log(JSON.stringify({ ok: true, action: "seed", store: storePath, dry, reseeded: r.reseeded, created: r.created, keys: Object.keys(r.receipt.keys), activeScene: r.receipt.activeScene?.set ?? null, skipped: r.skipped, notes: r.notes }, null, 2)); return; }

  if (r.reseeded) say("  (a previous seed was found: it was removed first, so the store holds ONE household)");
  say(`  household: ${r.plan.household.name} - ${r.plan.household.members.map((m) => m.name).join(", ")}`);
  say(`  calendar:  ${r.plan.events.length} events, week of ${r.plan.weekOf}`);
  say(`  chores:    ${r.plan.chores.length} items, ${r.plan.chores.filter((c) => c.done).length} done`);
  say(`  created:   ${r.created.apps.length} app(s), ${r.created.facets.length} facet(s), ${r.created.layouts.length} layout(s), ${r.created.scenes.length} scene(s)`);
  for (const s of r.plan.scenes) {
    const placeholders = Object.values(s.assign).filter((v) => v === PLACEHOLDER_REF).length;
    // §7a: a hidden role's placeholder is not in `assign` (the stage carries the
    // visualization id), so say it out loud - the lounge is seeded IDLE.
    const idleSources = (s.hidden ?? []).filter((h) => h.facet === PLACEHOLDER_REF).length;
    const viz = (s.visualizations ?? []).length;
    say(
      `    ${s.id.padEnd(24)} ${String(Object.keys(s.assign).length).padStart(2)} slot(s), ${placeholders} App-poster placeholder(s)` +
      (viz ? `, ${viz} visualization` : "") +
      (idleSources ? `, ${idleSources} idle music source (no service, no sign-in)` : "")
    );
  }
  say(`  data keys: ${Object.keys(r.receipt.keys).join(", ")}`);
  if (r.receipt.activeScene) say(`  active:    ${r.receipt.activeScene.set}`);
  for (const s of r.skipped) say(`    note  ${s}`);
  for (const n of r.notes) say(`    note  ${n}`);
  say(`  receipt:   ${RECEIPT_KEY} (what --reset will remove, and nothing else)`);
  if (dry) say("  dry run: nothing was written.");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.log("seed: " + (e?.stack ?? e)); process.exit(1); });
}
