import { describe, expect, it } from "vitest";
import { INFERRED_RECENT_MS, agoLabel, noteLog, noteSeen, orderMerged, type FirstSeen, type MenuLogEntry, type MenuServiceRow, orderAlphabetical, sortTitle } from "../src/menu-order.js";

// docs/video-menu-spec.md §4 + the transparency rule (Phase 2, 2026-09-19): the menu's ordering is a PURE function of the
// four §4 inputs - the services' rows, the local watch log, the first-seen record, now - and nothing else. No ranking or
// recommendation logic beyond the recency rule; a time is shown only when it is real; never synthesized from a position.

const item = (id: string, title: string, url?: string) => ({ id, title, kind: "title", url: url ?? "https://x/" + id, artwork: null, subtitle: null, progress: null });
const DAY = 24 * 3600_000;
const NOW = 1_800_000_000_000;
const rows: MenuServiceRow[] = [
  { app: "netflix", name: "Netflix", facet: "nf", items: [item("n1", "Dark"), item("n2", "Heat"), item("n3", "Tires")] },
  { app: "hulu", name: "Hulu", facet: "hu", items: [item("h1", "The Bear"), item("h2", "Shrill")] },
];

describe("menu-order §4 - the merge is a pure function of the four inputs", () => {
  it("log beats inferred beats within-service rank; log entries newest first; ties keep the services' own order", () => {
    const log: MenuLogEntry[] = [
      { app: "hulu", id: "h2", title: "Shrill", at: NOW - 3 * DAY },
      { app: "netflix", id: "n3", title: "Tires", at: NOW - 1 * DAY },
    ];
    const seen: FirstSeen = { netflix: { n2: { at: NOW - 2 * DAY, rank: 1 } }, hulu: { h1: { at: NOW - 30 * DAY, rank: 0 } } };
    const out = orderMerged(rows, log, seen, NOW);
    expect(out.map((c) => c.item.id)).toEqual(["n3", "h2", "n2", "n1", "h1"]);
    expect(out.map((c) => c.recency.kind)).toEqual(["log", "log", "inferred", "rank", "rank"]);
    expect(out[0]!.lastWatched).toBe(NOW - 1 * DAY);
    expect(out[1]!.lastWatched).toBe(NOW - 3 * DAY);
    // a service badge on every card, the facet to play through
    expect(out.map((c) => c.service)).toEqual(["Netflix", "Hulu", "Netflix", "Netflix", "Hulu"]);
    expect(out.every((c) => c.facet.length > 0)).toBe(true);
  });

  it("is deterministic and depends on nothing but its inputs: the same inputs give the same order, in any call order", () => {
    const log: MenuLogEntry[] = [{ app: "netflix", id: "n2", title: "Heat", at: NOW - DAY }];
    const a = orderMerged(rows, log, {}, NOW);
    const b = orderMerged(rows, log, {}, NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // the input arrays are not touched
    expect(rows[0]!.items.map((x) => x.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("lastWatched is NEVER synthesized: no log entry, no time - a title at position 1, first seen, moved up, or ranked, carries none", () => {
    const seen: FirstSeen = { netflix: { n1: { at: NOW - DAY, rank: 0, movedUpAt: NOW - 1000 } } };
    const out = orderMerged(rows, [], seen, NOW);
    expect(out.every((c) => c.lastWatched === undefined)).toBe(true);
    expect(out.find((c) => c.item.id === "n1")!.recency).toEqual({ kind: "inferred" });   // recent, no date
    expect(out.filter((c) => c.recency.kind === "log")).toEqual([]);
  });

  it("inference is bounded: a first sight or a move to the top older than the window is only the service's rank again", () => {
    const seen: FirstSeen = { netflix: { n2: { at: NOW - INFERRED_RECENT_MS - 1, rank: 1 }, n3: { at: NOW - 40 * DAY, rank: 2, movedUpAt: NOW - INFERRED_RECENT_MS - 1 } } };
    const out = orderMerged(rows, [], seen, NOW);
    expect(out.map((c) => [c.item.id, c.recency.kind])).toEqual([["n1", "rank"], ["h1", "rank"], ["n2", "rank"], ["h2", "rank"], ["n3", "rank"]]);   // rank interleaves the services fairly, in their own order
  });

  it("a log entry matches by id, else by address, else by title - and only within the same service", () => {
    const log: MenuLogEntry[] = [
      { app: "hulu", url: "https://x/n1", title: "Dark", at: NOW },          // Hulu's log never names Netflix's Dark
      { app: "netflix", url: "https://x/n2", title: "Heat", at: NOW - DAY },   // by address
      { app: "hulu", title: "Shrill", at: NOW - 2 * DAY },                   // by title alone
    ];
    const out = orderMerged(rows, log, {}, NOW);
    expect(out.slice(0, 2).map((c) => c.item.id)).toEqual(["n2", "h2"]);
    expect(out.find((c) => c.item.id === "n1")!.recency.kind).toBe("rank");
  });

  it("noteSeen records first sight with its rank, stamps a move to the top, and never drops a record; noteLog keeps one entry per title, newest first, bounded", () => {
    let seen: FirstSeen = {};
    seen = noteSeen(seen, "netflix", [item("a", "A"), item("b", "B")], NOW - DAY);
    expect(seen.netflix).toEqual({ a: { at: NOW - DAY, rank: 0 }, b: { at: NOW - DAY, rank: 1 } });
    seen = noteSeen(seen, "netflix", [item("b", "B"), item("c", "C")], NOW);
    expect(seen.netflix!.b).toEqual({ at: NOW - DAY, rank: 0, movedUpAt: NOW });
    expect(seen.netflix!.a).toEqual({ at: NOW - DAY, rank: 0 });   // gone from the row, the record stays
    expect(seen.netflix!.c).toEqual({ at: NOW, rank: 1 });
    let log: MenuLogEntry[] = [];
    log = noteLog(log, { app: "netflix", id: "a", title: "A", at: 1 });
    log = noteLog(log, { app: "netflix", id: "b", title: "B", at: 2 });
    log = noteLog(log, { app: "netflix", id: "a", title: "A", at: 3 });
    expect(log.map((e) => [e.id, e.at])).toEqual([["a", 3], ["b", 2]]);
    expect(noteLog(Array.from({ length: 200 }, (_, i) => ({ app: "x", id: "i" + i, title: "t", at: i })), { app: "x", id: "new", title: "t", at: 999 }).length).toBe(200);
  });

  it("agoLabel speaks only in real units", () => {
    expect(agoLabel(NOW - 30_000, NOW)).toBe("just now");
    expect(agoLabel(NOW - 20 * 60_000, NOW)).toBe("20 min ago");
    expect(agoLabel(NOW - 5 * 3600_000, NOW)).toBe("5 hours ago");
    expect(agoLabel(NOW - 3 * DAY, NOW)).toBe("3 days ago");
    expect(agoLabel(NOW - 21 * DAY, NOW)).toBe("3 weeks ago");
    expect(agoLabel(NOW - 100 * DAY, NOW)).toBe("3 months ago");
  });
});

describe("the My list row is alphabetical (2026-09-20)", () => {
  const row = (app: string, titles: string[]) => ({ app, name: app, facet: app, items: titles.map((title, i) => ({ id: app + i, title, kind: "title", url: null })) });
  it("sorts by title across services, a leading article set aside, ties in the services' order; recency plays no part", () => {
    const rows = [row("hulu", ["The Rookie", "Paradise", "Only Murders in the Building"]), row("paramountplus", ["Star Trek: Picard", "A Quiet Place", "South Park"]), row("peacock", ["Killing It", "Paradise"])];
    const log = [{ app: "hulu", id: "hulu0", url: null, title: "The Rookie", at: 1_000 }];   // watched: still files under R
    const out = orderAlphabetical(rows, log, {}, 2_000);
    expect(out.map((c) => c.app + ":" + c.item.title)).toEqual([
      "peacock:Killing It", "hulu:Only Murders in the Building", "hulu:Paradise", "peacock:Paradise", "paramountplus:A Quiet Place", "hulu:The Rookie", "paramountplus:South Park", "paramountplus:Star Trek: Picard",
    ]);
    expect(orderAlphabetical(rows, log, {}, 2_000)).toEqual(out);   // pure
    expect(sortTitle("The Rookie")).toBe("rookie");
    expect(sortTitle("Élite")).toBe("elite");
    expect(sortTitle("A Quiet Place")).toBe("quiet place");
  });
  it("a title with the service's own banner comes first, A to Z among those (2026-09-23)", () => {
    const rows = [row("hulu", ["The Rookie", "Paradise", "Abbott Elementary"]), row("netflix", ["Wednesday", "Beef"])];
    rows[0].items[1] = { ...rows[0].items[1], badge: "New Season" } as (typeof rows)[0]["items"][0];
    rows[1].items[0] = { ...rows[1].items[0], badge: "Leaving Soon" } as (typeof rows)[1]["items"][0];
    const out = orderAlphabetical(rows, [], {}, 2_000);
    expect(out.map((c) => c.item.title)).toEqual(["Paradise", "Wednesday", "Abbott Elementary", "Beef", "The Rookie"]);
  });
});
