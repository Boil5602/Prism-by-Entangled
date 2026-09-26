/**
 * First-party micro-facet documents (docs/concept-scenes.md §6).
 *
 * Two tiny Prism-owned pages — Chores & notes (`prism-chores`) and Timer
 * (`prism-timer`) — are served locally by the shell and keep their state in
 * the Store driver (§10: written, never wiped). Core owns the documents so
 * there is exactly one brain: the page edits through the shell's bridge
 * (`PrismRuntime.tilesGet` / `tilesApply`) and a phone edits through the §6
 * remote API, and both land on the functions below.
 *
 * Everything here is pure: parse a stored string into a normalized document,
 * apply one intent, hand back the new document. Unknown fields in a stored
 * document are dropped on write but a document from a NEWER version is read
 * as far as it parses — the store itself is never cleared.
 *
 * Nothing in this module has a clock of its own beyond the `now` a caller
 * passes, and nothing checks a chore off: `chores.check` is only ever the
 * result of a human tapping the page or the phone.
 */

/** Store key: the household list + the notes beneath it. */
export const CHORES_KEY = "tiles:chores";
/** Store key: the timer's mode, duration and deadline. */
export const TIMER_KEY = "tiles:timer";
/** Store key: the week the agenda facet shows (CS-10.3). */
export const AGENDA_KEY = "tiles:agenda";
/** Every key the micro-facets may read or write — the shell's bridge refuses anything else. */
export const TILES_KEYS = [CHORES_KEY, TIMER_KEY, AGENDA_KEY] as const;

export type TilesKey = (typeof TILES_KEYS)[number];

export function isTilesKey(key: string): key is TilesKey {
  return (TILES_KEYS as readonly string[]).includes(key);
}

/* ------------------------------------------------------------- chores ---- */

export interface ChoreItem {
  id: string;
  text: string;
  done: boolean;
  /** Who it belongs to, when a household says so — a name typed on this device, never an account. */
  who?: string;
  /** ISO day the item was added (a day, not a timestamp: §22 keeps it coarse). */
  added: string;
  /** ISO day it was checked off, while it stays checked. */
  doneAt?: string;
}

export interface ChoresDoc {
  v: 1;
  items: ChoreItem[];
  notes: string;
  /** ISO day of the last change — what the page shows as "updated". */
  updated: string;
}

export const MAX_CHORES = 200;
export const MAX_CHORE_TEXT = 200;
export const MAX_NOTES = 4000;

const day = (now: number): string => new Date(now).toISOString().slice(0, 10);

function clean(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  // control characters out, whitespace collapsed at the ends; the text is a
  // label on a wall, not markup — the page renders it as text either way.
  let out = "";
  for (const ch of text) { const c = ch.codePointAt(0)!; out += c < 0x20 || c === 0x7f ? " " : ch; }
  return out.replace(/ +/g, " ").trim().slice(0, max);
}

function choreId(seed: number, taken: Set<string>): string {
  let n = seed;
  let id = "c" + n.toString(36);
  while (taken.has(id)) id = "c" + (++n).toString(36);
  return id;
}

export function emptyChores(now: number): ChoresDoc {
  return { v: 1, items: [], notes: "", updated: day(now) };
}

/** A stored string → a document that is safe to render. Anything unreadable becomes an empty list; the raw value stays in the store. */
export function normalizeChores(raw: string | null | undefined, now: number = Date.now()): ChoresDoc {
  const doc = emptyChores(now);
  if (!raw) return doc;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return doc; }
  if (!parsed || typeof parsed !== "object") return doc;
  const o = parsed as Record<string, unknown>;
  const taken = new Set<string>();
  const items: ChoreItem[] = [];
  for (const entry of Array.isArray(o["items"]) ? (o["items"] as unknown[]) : []) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const text = clean(e["text"], MAX_CHORE_TEXT);
    if (!text) continue;
    let id = clean(e["id"], 40).replace(/[^A-Za-z0-9_-]/g, "");
    if (!id || taken.has(id)) id = choreId(items.length + 1, taken);
    taken.add(id);
    const who = clean(e["who"], 40);
    const item: ChoreItem = {
      id,
      text,
      done: e["done"] === true,
      added: clean(e["added"], 10) || doc.updated,
    };
    if (who) item.who = who;
    const doneAt = clean(e["doneAt"], 10);
    if (item.done && doneAt) item.doneAt = doneAt;
    items.push(item);
    if (items.length >= MAX_CHORES) break;
  }
  doc.items = items;
  doc.notes = typeof o["notes"] === "string" ? o["notes"].slice(0, MAX_NOTES) : "";
  doc.updated = clean(o["updated"], 10) || day(now);
  return doc;
}

/** Add one item to the end of the list. Empty text (or a full list) is refused, not silently dropped. */
export function addChore(doc: ChoresDoc, text: string, opts: { who?: string; now?: number } = {}): ChoresDoc | null {
  const now = opts.now ?? Date.now();
  const body = clean(text, MAX_CHORE_TEXT);
  if (!body || doc.items.length >= MAX_CHORES) return null;
  const taken = new Set(doc.items.map((i) => i.id));
  const who = clean(opts.who, 40);
  const item: ChoreItem = { id: choreId(doc.items.length + 1, taken), text: body, done: false, added: day(now) };
  if (who) item.who = who;
  return { ...doc, items: [...doc.items, item], updated: day(now) };
}

/**
 * Check an item off, or un-check it. Always a human's action (the page's
 * checkbox, the phone's row) — no schedule, no adapter and no timer reaches
 * this function.
 */
export function setChoreDone(doc: ChoresDoc, id: string, done: boolean, now: number = Date.now()): ChoresDoc | null {
  if (!doc.items.some((i) => i.id === id)) return null;
  const items = doc.items.map((i) => {
    if (i.id !== id) return i;
    const next: ChoreItem = { ...i, done };
    if (done) next.doneAt = day(now);
    else delete next.doneAt;
    return next;
  });
  return { ...doc, items, updated: day(now) };
}

export function removeChore(doc: ChoresDoc, id: string, now: number = Date.now()): ChoresDoc | null {
  if (!doc.items.some((i) => i.id === id)) return null;
  return { ...doc, items: doc.items.filter((i) => i.id !== id), updated: day(now) };
}

/** Drop every checked item. The list is the household's; nothing else clears it. */
export function clearDoneChores(doc: ChoresDoc, now: number = Date.now()): ChoresDoc {
  return { ...doc, items: doc.items.filter((i) => !i.done), updated: day(now) };
}

/** Move an item to a new position (0-based). Out-of-range positions clamp. */
export function reorderChore(doc: ChoresDoc, id: string, to: number, now: number = Date.now()): ChoresDoc | null {
  const from = doc.items.findIndex((i) => i.id === id);
  if (from < 0) return null;
  const target = Math.max(0, Math.min(doc.items.length - 1, Math.trunc(to)));
  if (target === from) return doc;
  const items = [...doc.items];
  const [moved] = items.splice(from, 1);
  items.splice(target, 0, moved!);
  return { ...doc, items, updated: day(now) };
}

export function setChoreNotes(doc: ChoresDoc, notes: string, now: number = Date.now()): ChoresDoc {
  return { ...doc, notes: typeof notes === "string" ? notes.slice(0, MAX_NOTES) : "", updated: day(now) };
}

/* -------------------------------------------------------------- timer ---- */

export type TimerMode = "countdown" | "interval";

export interface TimerDoc {
  v: 1;
  mode: TimerMode;
  /** What one run lasts, in ms. */
  durationMs: number;
  /** Epoch ms the current run ends at; null when it is not running. */
  endsAt: number | null;
  /** What is left on a paused run, in ms. */
  remainingMs: number;
  running: boolean;
  /** How many times an interval run has come round (0 for a countdown). */
  laps: number;
  /** §24: the chime at zero. Off means silent, not quieter. */
  chime: boolean;
  /** 0–1, the level the household set. Never raised by anything but a person. */
  volume: number;
  /** Minute presets the page offers. */
  presets: number[];
  label: string;
  /** Epoch ms the document was last written — the page says when a run was restored. */
  savedAt: number;
}

export const TIMER_PRESETS = [1, 3, 5, 10, 20, 45];
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
/** The level a timer starts at before anyone touches the slider — audible across a kitchen, not a shock. */
export const DEFAULT_TIMER_VOLUME = 0.6;

export function emptyTimer(now: number = Date.now()): TimerDoc {
  return {
    v: 1, mode: "countdown", durationMs: 5 * 60_000, endsAt: null, remainingMs: 5 * 60_000,
    running: false, laps: 0, chime: true, volume: DEFAULT_TIMER_VOLUME, presets: [...TIMER_PRESETS],
    label: "", savedAt: now,
  };
}

const ms = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;
  return Math.max(0, Math.min(MAX_TIMER_MS, n));
};

export function normalizeTimer(raw: string | null | undefined, now: number = Date.now()): TimerDoc {
  const doc = emptyTimer(now);
  if (!raw) return doc;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return doc; }
  if (!parsed || typeof parsed !== "object") return doc;
  const o = parsed as Record<string, unknown>;
  doc.mode = o["mode"] === "interval" ? "interval" : "countdown";
  doc.durationMs = Math.max(1000, ms(o["durationMs"], doc.durationMs));
  doc.remainingMs = ms(o["remainingMs"], doc.durationMs);
  doc.running = o["running"] === true;
  doc.endsAt = typeof o["endsAt"] === "number" && Number.isFinite(o["endsAt"]) ? Math.trunc(o["endsAt"] as number) : null;
  if (!doc.running) doc.endsAt = null;
  doc.laps = typeof o["laps"] === "number" && Number.isFinite(o["laps"]) ? Math.max(0, Math.trunc(o["laps"] as number)) : 0;
  doc.chime = o["chime"] !== false;
  doc.volume = typeof o["volume"] === "number" && Number.isFinite(o["volume"])
    ? Math.max(0, Math.min(1, o["volume"] as number)) : DEFAULT_TIMER_VOLUME;
  const presets = Array.isArray(o["presets"])
    ? (o["presets"] as unknown[]).filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0 && p <= 24 * 60).map((p) => Math.trunc(p)).slice(0, 8)
    : [];
  doc.presets = presets.length ? presets : [...TIMER_PRESETS];
  doc.label = clean(o["label"], 60);
  doc.savedAt = typeof o["savedAt"] === "number" && Number.isFinite(o["savedAt"]) ? Math.trunc(o["savedAt"] as number) : now;
  return doc;
}

/**
 * What is left on a run, from device time alone (§24: local and offline-proof).
 * A run whose deadline has passed reports 0 and `elapsedPastEnd`, so the page
 * can say plainly that it finished while the panel was away.
 */
export function timerRemaining(doc: TimerDoc, now: number = Date.now()): { remainingMs: number; overdueMs: number } {
  if (!doc.running || doc.endsAt === null) return { remainingMs: doc.remainingMs, overdueMs: 0 };
  const left = doc.endsAt - now;
  return left >= 0 ? { remainingMs: left, overdueMs: 0 } : { remainingMs: 0, overdueMs: -left };
}

/**
 * An interval run that has rolled over one or more times catches up without
 * drifting: the deadline advances by whole durations until it is in the
 * future. Returns the caught-up document and how many laps were crossed
 * (the page chimes once, however long the panel slept — a chime per missed
 * lap would be a siren).
 */
export function advanceTimer(doc: TimerDoc, now: number = Date.now()): { doc: TimerDoc; finished: boolean; lapsCrossed: number } {
  if (!doc.running || doc.endsAt === null || now < doc.endsAt) return { doc, finished: false, lapsCrossed: 0 };
  if (doc.mode === "countdown") {
    return { doc: { ...doc, running: false, endsAt: null, remainingMs: 0, savedAt: now }, finished: true, lapsCrossed: 1 };
  }
  const span = Math.max(1000, doc.durationMs);
  const crossed = Math.floor((now - doc.endsAt) / span) + 1;
  return {
    doc: { ...doc, endsAt: doc.endsAt + crossed * span, laps: doc.laps + crossed, remainingMs: span, savedAt: now },
    finished: true,
    lapsCrossed: crossed,
  };
}

/* ------------------------------------------------------------ intents ---- */

/** One edit, from the page's bridge or the §6 remote. Anything else is refused. */
/* ------------------------------------------------------------- agenda ---- */

/**
 * One entry on the week (CS-10.3). `who` is a NAME the household typed, never
 * an account: the agenda facet is local data, exactly like the chore list, and
 * nothing here reaches a calendar service. Personal calendars still connect
 * through Merge (charter §2.1); this is the first-party page that renders a
 * week the box already holds.
 *
 * `start` / `end` are local wall-clock ISO strings with no timezone — the same
 * shape the demo seed has written under `demo:calendar` since CS-5, so the
 * Parkers' week renders here without a conversion step.
 */
export interface AgendaEvent {
  id: string;
  title: string;
  /** A person's NAME, or "everyone" — never an account id. */
  who?: string;
  /** Local wall-clock ISO, e.g. "2026-09-07T07:40:00". No timezone by design. */
  start: string;
  end?: string;
  allDay?: boolean;
}

export interface AgendaDoc {
  v: 1;
  /** ISO date (YYYY-MM-DD) of the Monday the week starts on, when the source declares one. */
  weekOf?: string;
  events: AgendaEvent[];
  updated: number;
}

export const MAX_AGENDA_EVENTS = 200;
export const MAX_AGENDA_TITLE = 200;

export function emptyAgenda(now: number): AgendaDoc {
  return { v: 1, events: [], updated: now };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Local wall-clock ISO: a date, then "T" and at least hh:mm. No timezone suffix is accepted. */
const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function agendaEvent(raw: unknown): AgendaEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const title = typeof r.title === "string" ? r.title.trim().slice(0, MAX_AGENDA_TITLE) : "";
  const start = typeof r.start === "string" ? r.start.trim() : "";
  if (!id || !title || !ISO_LOCAL.test(start)) return null;      // an entry we cannot place is dropped, not guessed at
  const end = typeof r.end === "string" && ISO_LOCAL.test(r.end.trim()) ? r.end.trim() : undefined;
  const who = typeof r.who === "string" && r.who.trim() !== "" ? r.who.trim().slice(0, MAX_AGENDA_TITLE) : undefined;
  return { id, title, start, ...(end ? { end } : {}), ...(who ? { who } : {}), ...(r.allDay === true ? { allDay: true } : {}) };
}

/**
 * Parse a stored agenda. Accepts BOTH shapes so one renderer serves both: the
 * `tiles:agenda` document written here, and the seed's `demo:calendar`
 * payload (`{ schema, household, weekOf, events[] }`), whose events are
 * already this shape. Garbage entries are dropped rather than thrown on, the
 * way every other normalizer in this file behaves.
 */
export function normalizeAgenda(raw: string | null | undefined, now: number = Date.now()): AgendaDoc {
  if (typeof raw !== "string" || raw.trim() === "") return emptyAgenda(now);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return emptyAgenda(now); }
  if (!parsed || typeof parsed !== "object") return emptyAgenda(now);
  const r = parsed as Record<string, unknown>;
  const events: AgendaEvent[] = [];
  for (const e of Array.isArray(r.events) ? r.events : []) {
    if (events.length >= MAX_AGENDA_EVENTS) break;
    const ev = agendaEvent(e);
    if (ev) events.push(ev);
  }
  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
  const weekOf = typeof r.weekOf === "string" && ISO_DATE.test(r.weekOf.trim()) ? r.weekOf.trim() : undefined;
  const updated = typeof r.updated === "number" && Number.isFinite(r.updated) ? r.updated : now;
  return { v: 1, ...(weekOf ? { weekOf } : {}), events, updated };
}

/** Replace the week wholesale — how the seed and a phone both write it. */
export function setAgenda(doc: AgendaDoc, events: readonly unknown[], opts: { weekOf?: string; now?: number } = {}): AgendaDoc {
  const now = opts.now ?? Date.now();
  const next: AgendaEvent[] = [];
  for (const e of events) {
    if (next.length >= MAX_AGENDA_EVENTS) break;
    const ev = agendaEvent(e);
    if (ev) next.push(ev);
  }
  next.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1));
  const weekOf = opts.weekOf && ISO_DATE.test(opts.weekOf) ? opts.weekOf : doc.weekOf;
  return { v: 1, ...(weekOf ? { weekOf } : {}), events: next, updated: now };
}

/** The events falling on one local date (YYYY-MM-DD), in start order. */
export function agendaOnDay(doc: AgendaDoc, day: string): AgendaEvent[] {
  return doc.events.filter((e) => e.start.slice(0, 10) === day);
}

export type TilesIntent =
  | { op: "chores.add"; text: string; who?: string }
  | { op: "chores.check"; id: string; done: boolean }
  | { op: "chores.remove"; id: string }
  | { op: "chores.clear-done" }
  | { op: "chores.reorder"; id: string; to: number }
  | { op: "chores.notes"; notes: string }
  | { op: "timer.set"; mode?: TimerMode; durationMs?: number; label?: string }
  | { op: "timer.start" }
  | { op: "timer.pause" }
  | { op: "timer.reset" }
  | { op: "timer.tick" }
  | { op: "timer.sound"; chime?: boolean; volume?: number }
  | { op: "agenda.set"; events: unknown[]; weekOf?: string };

export interface TilesApplyResult {
  ok: boolean;
  /** The document as it now stands (unchanged when `ok` is false). */
  doc: ChoresDoc | TimerDoc | AgendaDoc;
  /** True when the document actually changed and must be persisted. */
  changed: boolean;
  error?: string;
}

function applyChores(doc: ChoresDoc, intent: TilesIntent, now: number): TilesApplyResult {
  const done = (next: ChoresDoc | null, why: string): TilesApplyResult =>
    next ? { ok: true, doc: next, changed: JSON.stringify(next) !== JSON.stringify(doc) } : { ok: false, doc, changed: false, error: why };
  switch (intent.op) {
    case "chores.add": return done(addChore(doc, intent.text, { ...(intent.who ? { who: intent.who } : {}), now }), "an item needs some text (and the list holds " + MAX_CHORES + ")");
    case "chores.check": return done(setChoreDone(doc, intent.id, intent.done === true, now), "no item '" + intent.id + "'");
    case "chores.remove": return done(removeChore(doc, intent.id, now), "no item '" + intent.id + "'");
    case "chores.clear-done": return done(clearDoneChores(doc, now), "");
    case "chores.reorder": return done(reorderChore(doc, intent.id, intent.to, now), "no item '" + intent.id + "'");
    case "chores.notes": return done(setChoreNotes(doc, intent.notes, now), "");
    default: return { ok: false, doc, changed: false, error: "'" + intent.op + "' is not a chores edit" };
  }
}

function applyTimer(doc: TimerDoc, intent: TilesIntent, now: number): TilesApplyResult {
  const settled = advanceTimer(doc, now).doc;
  switch (intent.op) {
    case "timer.tick":
      return { ok: true, doc: settled, changed: settled !== doc };
    case "timer.set": {
      const mode = intent.mode === "interval" || intent.mode === "countdown" ? intent.mode : settled.mode;
      const durationMs = typeof intent.durationMs === "number" ? Math.max(1000, ms(intent.durationMs, settled.durationMs)) : settled.durationMs;
      const label = typeof intent.label === "string" ? clean(intent.label, 60) : settled.label;
      return { ok: true, doc: { ...settled, mode, durationMs, label, running: false, endsAt: null, remainingMs: durationMs, laps: 0, savedAt: now }, changed: true };
    }
    case "timer.start": {
      const left = settled.running ? timerRemaining(settled, now).remainingMs : (settled.remainingMs > 0 ? settled.remainingMs : settled.durationMs);
      return { ok: true, doc: { ...settled, running: true, endsAt: now + Math.max(0, left), remainingMs: Math.max(0, left), savedAt: now }, changed: true };
    }
    case "timer.pause": {
      const left = timerRemaining(settled, now).remainingMs;
      return { ok: true, doc: { ...settled, running: false, endsAt: null, remainingMs: left, savedAt: now }, changed: true };
    }
    case "timer.reset":
      return { ok: true, doc: { ...settled, running: false, endsAt: null, remainingMs: settled.durationMs, laps: 0, savedAt: now }, changed: true };
    case "timer.sound": {
      const chime = typeof intent.chime === "boolean" ? intent.chime : settled.chime;
      const volume = typeof intent.volume === "number" && Number.isFinite(intent.volume)
        ? Math.max(0, Math.min(1, intent.volume)) : settled.volume;
      return { ok: true, doc: { ...settled, chime, volume, savedAt: now }, changed: true };
    }
    default:
      return { ok: false, doc, changed: false, error: "'" + intent.op + "' is not a timer edit" };
  }
}

/** Parse an intent off the wire. Returns null for anything not in the union above. */
export function parseTilesIntent(raw: string | null | undefined): TilesIntent | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const op = typeof o["op"] === "string" ? o["op"] : "";
  switch (op) {
    case "chores.add": return { op, text: typeof o["text"] === "string" ? o["text"] : "", ...(typeof o["who"] === "string" ? { who: o["who"] } : {}) };
    case "chores.check": return { op, id: String(o["id"] ?? ""), done: o["done"] === true };
    case "chores.remove": return { op, id: String(o["id"] ?? "") };
    case "chores.clear-done": return { op };
    case "chores.reorder": return { op, id: String(o["id"] ?? ""), to: typeof o["to"] === "number" ? o["to"] : 0 };
    case "chores.notes": return { op, notes: typeof o["notes"] === "string" ? o["notes"] : "" };
    case "timer.set": return {
      op,
      ...(o["mode"] === "interval" || o["mode"] === "countdown" ? { mode: o["mode"] } : {}),
      ...(typeof o["durationMs"] === "number" ? { durationMs: o["durationMs"] } : {}),
      ...(typeof o["label"] === "string" ? { label: o["label"] } : {}),
    };
    case "timer.start": case "timer.pause": case "timer.reset": case "timer.tick": return { op } as TilesIntent;
    case "timer.sound": return {
      op,
      ...(typeof o["chime"] === "boolean" ? { chime: o["chime"] } : {}),
      ...(typeof o["volume"] === "number" ? { volume: o["volume"] } : {}),
    };
    default: return null;
  }
}

/** The stored document for a key, normalized. */
export function readTilesDoc(key: string, raw: string | null | undefined, now: number = Date.now()): ChoresDoc | TimerDoc | AgendaDoc | null {
  if (key === CHORES_KEY) return normalizeChores(raw, now);
  if (key === TIMER_KEY) return normalizeTimer(raw, now);
  if (key === AGENDA_KEY) return normalizeAgenda(raw, now);
  return null;
}

/** Apply one intent to the document stored under `key`. The single edit path for both the page and the phone. */
function applyAgenda(doc: AgendaDoc, intent: TilesIntent, now: number): TilesApplyResult {
  if (intent.op !== "agenda.set") return { ok: false, doc, changed: false, error: "the agenda takes agenda.set" };
  const next = setAgenda(doc, Array.isArray(intent.events) ? intent.events : [], { ...(intent.weekOf ? { weekOf: intent.weekOf } : {}), now });
  return { ok: true, doc: next, changed: JSON.stringify(next) !== JSON.stringify(doc) };
}

export function applyTilesIntent(key: string, raw: string | null | undefined, intent: TilesIntent, now: number = Date.now()): TilesApplyResult | null {
  if (key === CHORES_KEY) return applyChores(normalizeChores(raw, now), intent, now);
  if (key === TIMER_KEY) return applyTimer(normalizeTimer(raw, now), intent, now);
  if (key === AGENDA_KEY) return applyAgenda(normalizeAgenda(raw, now), intent, now);
  return null;
}
