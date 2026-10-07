import { describe, expect, it } from "vitest";
import { liveGuide, liveTypeOf, programsOf, LIVE_SLOT_MS } from "../src/live-guide.js";
import { cleanChannels } from "../src/video.js";
import type { VideoChannel } from "../src/types.js";

const NOW = Date.UTC(2026, 8, 29, 0, 10);   // 8:10 PM EDT
const HALF = Math.floor(NOW / LIVE_SLOT_MS) * LIVE_SLOT_MS;
const ch = (id: string, name: string, extra: Partial<VideoChannel> = {}): VideoChannel => ({ id, name, url: `https://www.paramountplus.com/live-tv/stream/${id}/`, ...extra });

describe("the Live tab's guide (docs/features/live.md)", () => {
  it("a channel's type is the service's own category when it gives one, else Prism's rule on the name - each labelled with its source", () => {
    expect(liveTypeOf(ch("cbsn", "CBS News 24/7", { category: "News" }))).toEqual({ type: "News", source: "service" });
    expect(liveTypeOf(ch("kf", "Nick Rewind", { category: "Kids & Family" }))).toEqual({ type: "Kids", source: "service" });
    expect(liveTypeOf(ch("x", "Some Channel", { category: "Westerns" }))).toEqual({ type: "Westerns", source: "service" });   // the service's word as written
    expect(liveTypeOf(ch("hq", "CBS Sports HQ"))).toEqual({ type: "Sports", source: "prism" });
    expect(liveTypeOf({ name: "CBS Pittsburgh", url: "https://www.paramountplus.com/live-tv/stream/local/kdka/" })).toEqual({ type: "Local", source: "prism" });
    expect(liveTypeOf(ch("y", "Pluto Classics"))).toEqual({ type: "Entertainment", source: "prism" });
    // a name that says its kind plainly files itself (2026-10-01)
    expect(liveTypeOf(ch("c1", "Black-Led Comedy"))).toEqual({ type: "Comedy", source: "prism" });
    expect(liveTypeOf(ch("c2", "Classic TV Comedy"))).toEqual({ type: "Comedy", source: "prism" });
    expect(liveTypeOf(ch("c3", "Comedy Movies"))).toEqual({ type: "Movies", source: "prism" });   // a movie channel first
    expect(liveTypeOf(ch("r1", "Below Deck"))).toEqual({ type: "Reality", source: "prism" });
    expect(liveTypeOf(ch("d1", "Crime & Justice"))).toEqual({ type: "Drama", source: "prism" });
  });

  it("programs across the window: the schedule, each ending where the next begins; with no schedule, what is on now up to its end", () => {
    const sched = ch("hq", "CBS Sports HQ", { schedule: [
      { title: "Scoreboard & Highlights", start: HALF - LIVE_SLOT_MS * 2 },
      { title: "Scoreboard Final", start: HALF + LIVE_SLOT_MS * 5 },
      { title: "Morning Buzz", start: HALF + LIVE_SLOT_MS * 26 },
    ] });
    const p = programsOf(sched, NOW, HALF, HALF + 3 * 3_600_000);
    expect(p.map((x) => [x.title, x.now])).toEqual([["Scoreboard & Highlights", true], ["Scoreboard Final", false]]);
    expect(p[0]!.end).toBe(HALF + LIVE_SLOT_MS * 5);
    const bare = programsOf(ch("cbsn", "CBS News 24/7", { now: "24/7 Primetime", nowEnds: NOW + 31 * 60_000 }), NOW, HALF, HALF + 3 * 3_600_000);
    expect(bare).toEqual([{ title: "24/7 Primetime", start: HALF, end: NOW + 31 * 60_000, now: true }]);
  });

  it("the live search looks through the guide - channel names, what is on, what is scheduled - and the type chips count what it keeps", () => {
    const services = [
      { app: "paramountplus", name: "Paramount+", facet: "pp", channels: [
        ch("cbsn", "CBS News 24/7", { category: "News", now: "24/7 Primetime" }),
        ch("hq", "CBS Sports HQ", { category: "Sports", now: "Scoreboard", schedule: [{ title: "Scoreboard", start: HALF }, { title: "Morning Buzz", start: HALF + LIVE_SLOT_MS * 2 }] }),
      ] },
      { app: "peacock", name: "Peacock", facet: "pk", channels: [ch("nbcnow", "NBC News NOW", { now: "Top Story" })] },
    ];
    const all = liveGuide(services, NOW);
    // the grid begins now: every channel's program on now starts at the same left edge (2026-09-28, "cut it all off evenly")
    expect(all.rows.every((r) => r.programs.filter((p) => p.now).every((p) => p.start === all.window.start))).toBe(true);
    expect(all.window.start).toBe(Math.floor(NOW / 60_000) * 60_000);
    expect(all.types).toEqual([{ type: "News", count: 2 }, { type: "Sports", count: 1 }]);
    expect(all.rows.map((r) => r.id)).toEqual(["cbsn", "nbcnow", "hq"]);
    expect(liveGuide(services, NOW, { type: "Sports" }).rows.map((r) => r.id)).toEqual(["hq"]);
    const buzz = liveGuide(services, NOW, { q: "morning buzz" });
    expect(buzz.rows.map((r) => [r.id, r.match])).toEqual([["hq", "program"]]);
    expect(buzz.rows[0]!.programs.filter((p) => p.match).map((p) => p.title)).toEqual(["Morning Buzz"]);
    expect(liveGuide(services, NOW, { q: "peacock" }).rows.map((r) => r.id)).toEqual(["nbcnow"]);   // the service's name finds its channels
  });

  it("a program with minutes left gives its place to the next, drawn from the left edge with its real start; the grid reaches to the last program listed, twelve hours at most (2026-09-29)", () => {
    const c = ch("x", "X", { schedule: [{ title: "Ending", start: HALF - LIVE_SLOT_MS, end: NOW + 3 * 60_000 }, { title: "Next", start: NOW + 3 * 60_000, end: NOW + 40 * 60_000 }] });
    const p = programsOf(c, NOW, NOW, NOW + 3 * 3_600_000);
    expect(p.map((x) => [x.title, x.start, x.startsAt])).toEqual([["Next", NOW, NOW + 3 * 60_000]]);
    const far = ch("y", "Y", { schedule: [{ title: "Late", start: NOW + 20 * 3_600_000, end: NOW + 21 * 3_600_000 }, { title: "Soon", start: NOW + 5 * 3_600_000, end: NOW + 6 * 3_600_000 }] });
    const g = liveGuide([{ app: "a", name: "A", facet: "f", channels: [far] }], NOW);
    expect(g.window.end - g.window.start).toBeLessThanOrEqual(12 * 3_600_000);
    expect(g.window.end - g.window.start).toBeGreaterThan(11 * 3_600_000);
    expect(liveGuide([{ app: "a", name: "A", facet: "f", channels: [ch("z", "Z", { now: "On" })] }], NOW).window).toMatchObject({ end: Math.ceil((Math.floor(NOW / 60_000) * 60_000 + 3 * 3_600_000) / LIVE_SLOT_MS) * LIVE_SLOT_MS });
  });

  it("a program never runs past the start of the next one (2026-09-29, Peacock's On Patrol: Live)", () => {
    const c = ch("op", "On Patrol", { schedule: [{ title: "E14", start: NOW - 3_600_000, end: NOW + 4_000_000 }, { title: "E15", start: NOW + 1_800_000, end: NOW + 9_000_000 }, { title: "E16", start: NOW + 5_400_000, end: NOW + 12_000_000 }] });
    const p = programsOf(c, NOW, NOW, NOW + 3 * 3_600_000);
    expect(p.map((x) => [x.title, x.end - NOW, x.now])).toEqual([["E14", 1_800_000, true], ["E15", 5_400_000, false], ["E16", 12_000_000, false]]);
  });

  it("what a channel said was on is not drawn once it has ended, or hours after it was read (2026-09-29 review)", () => {
    const w = [NOW, NOW, NOW + 3 * 3_600_000] as const;
    expect(programsOf(ch("a", "A", { now: "Old Show", nowEnds: NOW - 3_600_000 }), ...w)).toEqual([]);
    expect(programsOf(ch("b", "B", { now: "Old Show", readAt: NOW - 5 * 3_600_000 }), ...w)).toEqual([]);
    expect(programsOf(ch("c", "C", { now: "Show", readAt: NOW - 600_000 }), ...w).map((p) => p.title)).toEqual(["Show"]);
  });

  it("a page's channels keep the Live tab's fields when well formed and drop what is not", () => {
    const [c] = cleanChannels([{ id: "hq", name: "CBS Sports HQ", url: "u", category: " Sports ", nowEnds: NOW + 1000, nowDesc: "x", schedule: [{ title: "A", start: HALF }, { title: "", start: HALF }, { title: "B", start: "soon" }] }]);
    expect(c).toMatchObject({ category: "Sports", nowEnds: NOW + 1000, nowDesc: "x", schedule: [{ title: "A", start: HALF, end: null, desc: null }] });
  });
});

import { VideoController } from "../src/video.js";
describe("a guide read merged with the kept channels (video.keepLive)", () => {
  const rig = () => new VideoController({
    adapterOf: () => ({ match: ["www.paramountplus.com"] }), adapterIdOf: () => "paramountplus", tileExists: () => true,
    inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
    arm: () => {}, claimAudio: async () => {}, urlOf: () => "", onStage: () => false, enterStage: () => {},
    evaluate: async () => "null", personActedSince: () => false,
  } as unknown as ConstructorParameters<typeof VideoController>[0]);
  it("a channel the player reported by its slug is the same channel the guide lists by its uuid under that path: kept once (2026-10-01)", () => {
    const v = rig();
    v.keepLive("paramountplus", [{ id: "dana-white-contender-series", name: "Dana White's Contender Series", url: "https://www.paramountplus.com/live-tv/stream/dana-white-contender-series/", category: "Sports" }], true);
    v.keepLive("paramountplus", [
      { id: "e709e1a1", name: "Dana White's Contender Series", url: "https://www.paramountplus.com/live-tv/stream/dana-white-contender-series/e709e1a1/" },
      { id: "04ab2acc", name: "Dana White's Contender Series em Português", url: "https://www.paramountplus.com/live-tv/stream/dana-white-contender-series/04ab2acc/" },
      { id: "cbsn", name: "CBS News 24/7", url: "https://www.paramountplus.com/live-tv/stream/cbsn/" },
    ], true);
    const live = v.libraryOf("paramountplus").live;
    expect(live.map((c) => c.id).sort()).toEqual(["04ab2acc", "cbsn", "e709e1a1"]);
  });
  it("a kept channel at another address stays for the week", () => {
    const v = rig();
    v.keepLive("paramountplus", [{ id: "old", name: "Old Channel", url: "https://www.paramountplus.com/live-tv/stream/old/" }], true);
    v.keepLive("paramountplus", [{ id: "cbsn", name: "CBS News 24/7", url: "https://www.paramountplus.com/live-tv/stream/cbsn/" }], true);
    expect(v.libraryOf("paramountplus").live.map((c) => c.id).sort()).toEqual(["cbsn", "old"]);
  });
});

describe("Local is only a station that is the household's own (2026-10-02)", () => {
  it("another city's station files as News by its name; a service's own local page is Local", () => {
    const ch2 = (name: string) => ({ name, url: "https://www.peacocktv.com/watch/playback/live" });
    for (const n of ["NBC Boston News", "NBC Los Angeles News", "News 12 New York"]) expect(liveTypeOf(ch2(n)).type, n).toBe("News");
    expect(liveTypeOf({ name: "CBS Pittsburgh", url: "https://www.paramountplus.com/live-tv/stream/local/kdka/" }).type).toBe("Local");
  });
});
