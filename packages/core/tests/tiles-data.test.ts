import { describe, expect, it } from "vitest";
import {
  AGENDA_KEY, CHORES_KEY, DEFAULT_TIMER_VOLUME, MAX_AGENDA_EVENTS, MAX_AGENDA_TITLE, MAX_CHORES, TILES_KEYS, TIMER_KEY,
  addChore, advanceTimer, agendaOnDay, applyTilesIntent, clearDoneChores, emptyTimer, isTilesKey,
  normalizeAgenda, normalizeChores, normalizeTimer, parseTilesIntent, readTilesDoc, removeChore, reorderChore,
  setChoreDone, setChoreNotes, timerRemaining, type AgendaDoc, type ChoresDoc, type TimerDoc,
} from "../src/tiles-data.js";

const NOW = Date.UTC(2026, 8, 2, 14, 0, 0);   // 2026-09-02
const DAY = "2026-09-02";

const chores = (...texts: string[]): ChoresDoc => {
  let doc = normalizeChores(null, NOW);
  for (const t of texts) doc = addChore(doc, t, { now: NOW })!;
  return doc;
};

describe("micro-facet documents — the chore list", () => {
  it("starts empty and round-trips through JSON unchanged", () => {
    const doc = chores("milk", "bins");
    const back = normalizeChores(JSON.stringify(doc), NOW);
    expect(back).toEqual(doc);
    expect(back.items.map((i) => i.text)).toEqual(["milk", "bins"]);
    expect(back.updated).toBe(DAY);
  });

  it("refuses an empty item rather than adding a blank row", () => {
    expect(addChore(chores(), "   ", { now: NOW })).toBeNull();
    expect(addChore(chores(), "", { now: NOW })).toBeNull();
  });

  it("keeps hyphens and punctuation, drops control characters, collapses runs of space", () => {
    const doc = addChore(chores(), "  re-order   the\tlight-bulbs ", { now: NOW })!;
    expect(doc.items[0]!.text).toBe("re-order the light-bulbs");
  });

  it("gives every item a distinct id, even when the stored file repeats one", () => {
    const stored = JSON.stringify({ v: 1, items: [{ id: "x", text: "a" }, { id: "x", text: "b" }], notes: "", updated: DAY });
    const ids = normalizeChores(stored, NOW).items.map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("checks off only what a person named, and un-checking clears the day", () => {
    const doc = chores("milk", "bins");
    const id = doc.items[1]!.id;
    const checked = setChoreDone(doc, id, true, NOW)!;
    expect(checked.items[0]!.done).toBe(false);
    expect(checked.items[1]).toMatchObject({ done: true, doneAt: DAY });
    const cleared = setChoreDone(checked, id, false, NOW)!;
    expect(cleared.items[1]!.done).toBe(false);
    expect(cleared.items[1]!.doneAt).toBeUndefined();
  });

  it("nothing checks itself: no read, no reorder and no notes edit changes done-ness", () => {
    const doc = setChoreDone(chores("milk", "bins"), chores("milk", "bins").items[0]!.id, false, NOW) ?? chores("milk", "bins");
    const before = doc.items.map((i) => i.done);
    expect(normalizeChores(JSON.stringify(doc), NOW).items.map((i) => i.done)).toEqual(before);
    expect(reorderChore(doc, doc.items[0]!.id, 1, NOW)!.items.map((i) => i.done).sort()).toEqual([...before].sort());
    expect(setChoreNotes(doc, "anything", NOW).items.map((i) => i.done)).toEqual(before);
  });

  it("refuses an edit to an item that is not there", () => {
    const doc = chores("milk");
    expect(setChoreDone(doc, "nope", true, NOW)).toBeNull();
    expect(removeChore(doc, "nope", NOW)).toBeNull();
    expect(reorderChore(doc, "nope", 0, NOW)).toBeNull();
  });

  it("reorders by position and clamps a position past the ends", () => {
    const doc = chores("a", "b", "c");
    const last = doc.items[2]!.id;
    expect(reorderChore(doc, last, 0, NOW)!.items.map((i) => i.text)).toEqual(["c", "a", "b"]);
    expect(reorderChore(doc, last, 99, NOW)!.items.map((i) => i.text)).toEqual(["a", "b", "c"]);
    expect(reorderChore(doc, doc.items[0]!.id, -5, NOW)!.items.map((i) => i.text)).toEqual(["a", "b", "c"]);
  });

  it("clear-done removes checked items and leaves the rest in order", () => {
    let doc = chores("a", "b", "c");
    doc = setChoreDone(doc, doc.items[1]!.id, true, NOW)!;
    expect(clearDoneChores(doc, NOW).items.map((i) => i.text)).toEqual(["a", "c"]);
  });

  it("caps the list and the text rather than growing without bound", () => {
    let doc = normalizeChores(null, NOW);
    for (let i = 0; i < MAX_CHORES; i++) doc = addChore(doc, "item " + i, { now: NOW })!;
    expect(addChore(doc, "one more", { now: NOW })).toBeNull();
    expect(addChore(chores(), "x".repeat(500), { now: NOW })!.items[0]!.text).toHaveLength(200);
  });

  it("reads an unreadable or absent value as an empty list — never throws at the wall", () => {
    for (const raw of [null, "", "{", "[]", '"hello"', "12"]) {
      expect(normalizeChores(raw, NOW).items).toEqual([]);
    }
  });
});

describe("micro-facet documents — the timer", () => {
  it("starts at five minutes, chime on, at the level nobody has changed yet", () => {
    const t = emptyTimer(NOW);
    expect(t).toMatchObject({ mode: "countdown", durationMs: 300_000, running: false, endsAt: null, chime: true, volume: DEFAULT_TIMER_VOLUME });
  });

  it("runs on device time: a start sets a deadline, and remaining is read from it", () => {
    const started = applyTilesIntent(TIMER_KEY, null, { op: "timer.start" }, NOW)!.doc as TimerDoc;
    expect(started.running).toBe(true);
    expect(started.endsAt).toBe(NOW + 300_000);
    expect(timerRemaining(started, NOW + 60_000).remainingMs).toBe(240_000);
  });

  it("survives a reload: the stored deadline alone says what is left", () => {
    const started = applyTilesIntent(TIMER_KEY, null, { op: "timer.start" }, NOW)!.doc as TimerDoc;
    const reloaded = normalizeTimer(JSON.stringify(started), NOW + 90_000);
    expect(timerRemaining(reloaded, NOW + 90_000).remainingMs).toBe(210_000);
  });

  it("a countdown that ran out while the panel was away reports zero and how late it is", () => {
    const started = applyTilesIntent(TIMER_KEY, null, { op: "timer.start" }, NOW)!.doc as TimerDoc;
    const late = NOW + 400_000;
    expect(timerRemaining(started, late)).toEqual({ remainingMs: 0, overdueMs: 100_000 });
    const settled = advanceTimer(started, late);
    expect(settled.finished).toBe(true);
    expect(settled.doc.running).toBe(false);
    expect(settled.doc.remainingMs).toBe(0);
  });

  it("an interval repeats until stopped, catching up without drifting", () => {
    const base = applyTilesIntent(TIMER_KEY, null, { op: "timer.set", mode: "interval", durationMs: 60_000 }, NOW)!.doc as TimerDoc;
    const started = applyTilesIntent(TIMER_KEY, JSON.stringify(base), { op: "timer.start" }, NOW)!.doc as TimerDoc;
    expect(started.endsAt).toBe(NOW + 60_000);
    // gone for three and a half minutes: three laps crossed, the next deadline still on the minute
    const settled = advanceTimer(started, NOW + 210_000);
    expect(settled.lapsCrossed).toBe(3);
    expect(settled.doc.laps).toBe(3);
    expect(settled.doc.running).toBe(true);
    expect(settled.doc.endsAt).toBe(NOW + 240_000);
  });

  it("pause keeps what is left; resume starts from there, not from the top", () => {
    const started = applyTilesIntent(TIMER_KEY, null, { op: "timer.start" }, NOW)!.doc as TimerDoc;
    const paused = applyTilesIntent(TIMER_KEY, JSON.stringify(started), { op: "timer.pause" }, NOW + 120_000)!.doc as TimerDoc;
    expect(paused).toMatchObject({ running: false, endsAt: null, remainingMs: 180_000 });
    const resumed = applyTilesIntent(TIMER_KEY, JSON.stringify(paused), { op: "timer.start" }, NOW + 500_000)!.doc as TimerDoc;
    expect(resumed.endsAt).toBe(NOW + 500_000 + 180_000);
  });

  it("volume stays inside 0–1 and is only ever what a person set", () => {
    const loud = applyTilesIntent(TIMER_KEY, null, { op: "timer.sound", volume: 9 }, NOW)!.doc as TimerDoc;
    expect(loud.volume).toBe(1);
    const silent = applyTilesIntent(TIMER_KEY, JSON.stringify(loud), { op: "timer.sound", chime: false }, NOW)!.doc as TimerDoc;
    expect(silent.chime).toBe(false);
    expect(silent.volume).toBe(1);   // off is off; it does not quietly turn the level down as well
  });
});

describe("micro-facet documents — the one edit path", () => {
  it("only the two documents exist", () => {
    expect(isTilesKey(CHORES_KEY) && isTilesKey(TIMER_KEY)).toBe(true);
    expect(isTilesKey("scene-model:apps")).toBe(false);
    expect(readTilesDoc("scene-model:apps", "{}")).toBeNull();
    expect(applyTilesIntent("scene-model:apps", "{}", { op: "chores.clear-done" })).toBeNull();
  });

  it("parses the intents the page and the phone send, and nothing else", () => {
    expect(parseTilesIntent('{"op":"chores.add","text":"milk"}')).toEqual({ op: "chores.add", text: "milk" });
    expect(parseTilesIntent('{"op":"chores.check","id":"c1","done":true}')).toEqual({ op: "chores.check", id: "c1", done: true });
    expect(parseTilesIntent('{"op":"store.set","key":"x"}')).toBeNull();
    expect(parseTilesIntent("not json")).toBeNull();
    expect(parseTilesIntent(null)).toBeNull();
  });

  it("a chores edit on a timer document is refused, and vice versa", () => {
    expect(applyTilesIntent(TIMER_KEY, null, { op: "chores.clear-done" }, NOW)!.ok).toBe(false);
    expect(applyTilesIntent(CHORES_KEY, null, { op: "timer.start" }, NOW)!.ok).toBe(false);
  });

  it("reports whether the document actually changed, so nothing is written for nothing", () => {
    const doc = chores("milk");
    const noop = applyTilesIntent(CHORES_KEY, JSON.stringify(doc), { op: "chores.notes", notes: "" }, NOW)!;
    expect(noop.ok).toBe(true);
    expect(noop.changed).toBe(false);
    const real = applyTilesIntent(CHORES_KEY, JSON.stringify(doc), { op: "chores.notes", notes: "back Tuesday" }, NOW)!;
    expect(real.changed).toBe(true);
    expect((real.doc as ChoresDoc).notes).toBe("back Tuesday");
  });
});

/* ------------------------------------------------ the agenda (CS-10.3) ---- */

describe("the agenda document", () => {
  const week = {
    v: 1, weekOf: "2026-09-07", updated: 5,
    events: [
      { id: "b", title: "Soccer practice", who: "Maya", start: "2026-09-08T16:00:00", end: "2026-09-08T17:15:00" },
      { id: "a", title: "School run", who: "Sam", start: "2026-09-07T07:40:00", end: "2026-09-07T08:10:00" },
    ],
  };

  it("parses a stored week and sorts it by start", () => {
    const doc = normalizeAgenda(JSON.stringify(week));
    expect(doc.v).toBe(1);
    expect(doc.weekOf).toBe("2026-09-07");
    expect(doc.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(doc.events[0]!.who).toBe("Sam");
  });

  it("parses the seed's demo:calendar payload too - one renderer serves both", () => {
    const seeded = { schema: "prism.demo-calendar/v0.1", household: "parkers", weekOf: "2026-09-07", events: week.events };
    const doc = normalizeAgenda(JSON.stringify(seeded));
    expect(doc.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(doc.weekOf).toBe("2026-09-07");
  });

  it("drops an entry it cannot place rather than guessing at it", () => {
    const junk = { events: [
      { id: "ok", title: "Dentist", start: "2026-09-10T15:30:00" },
      { id: "no-start", title: "Nope" },
      { id: "bad-start", title: "Nope", start: "next tuesday" },
      { id: "zoned", title: "Nope", start: "2026-09-10T15:30:00Z" },   // a timezone is not stored, so it is not accepted
      { title: "no id", start: "2026-09-10T15:30:00" },
      { id: "no-title", start: "2026-09-10T15:30:00" },
      "not an object", null, 42,
    ] };
    const doc = normalizeAgenda(JSON.stringify(junk));
    expect(doc.events.map((e) => e.id)).toEqual(["ok"]);
  });

  it("survives garbage and an empty store without throwing (§10: the store is never cleared)", () => {
    for (const raw of [null, undefined, "", "   ", "not json", "[]", "42", '{"events":"nope"}']) {
      const doc = normalizeAgenda(raw as string | null);
      expect(doc.v).toBe(1);
      expect(doc.events).toEqual([]);
    }
  });

  it("agenda.set replaces the week, and agendaOnDay picks one local day out of it", () => {
    const applied = applyTilesIntent(AGENDA_KEY, null, { op: "agenda.set", events: week.events, weekOf: "2026-09-07" }, 9);
    expect(applied?.ok).toBe(true);
    const doc = applied!.doc as AgendaDoc;
    expect(doc.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(doc.updated).toBe(9);
    expect(agendaOnDay(doc, "2026-09-08").map((e) => e.id)).toEqual(["b"]);
    expect(agendaOnDay(doc, "2026-09-09")).toEqual([]);
  });

  it("holds the line on size, and refuses an intent that is not its own", () => {
    const many = Array.from({ length: MAX_AGENDA_EVENTS + 40 }, (_, i) => ({
      id: "e" + i, title: "x", start: "2026-09-07T0" + (i % 9) + ":00:00",
    }));
    expect(normalizeAgenda(JSON.stringify({ events: many })).events.length).toBe(MAX_AGENDA_EVENTS);
    const long = normalizeAgenda(JSON.stringify({ events: [{ id: "a", title: "t".repeat(MAX_AGENDA_TITLE + 50), start: "2026-09-07T08:00:00" }] }));
    expect(long.events[0]!.title.length).toBe(MAX_AGENDA_TITLE);
    const wrong = applyTilesIntent(AGENDA_KEY, null, { op: "chores.clear-done" }, 1);
    expect(wrong?.ok).toBe(false);
  });

  it("is a key the bridge accepts, beside chores and the timer", () => {
    expect(isTilesKey(AGENDA_KEY)).toBe(true);
    expect(TILES_KEYS).toContain(AGENDA_KEY);
  });
});
