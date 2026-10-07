import { describe, expect, it } from "vitest";
import { isUpcomingLine, liveGuide, programOnNow } from "../src/live-guide.js";

// 2026-10-06, "we're showing a lot of channels that have Upcoming shows but nothing on right now": an event channel before its match says
// "Upcoming: Arsenal vs. Birmingham City" - nothing is on it, and it is left out of the guide unless a search names it.

const now = Date.UTC(2026, 9, 6, 17, 0);
const ch = (id: string, name: string, line: string) => ({ id, name, url: "https://www.paramountplus.com/live-tv/stream/" + id + "/", now: line, readAt: now - 60_000, category: "Sports" });
const svc = { app: "paramountplus", name: "Paramount+", facet: "paramountplus-home", channels: [ch("golazo", "CBS Sports Golazo Network", "Morning Footy"), ch("barclays-womens-super-league", "Barclays Women's Super League", "Upcoming: Arsenal vs. Birmingham City")] };

describe("a channel that only says what is coming", () => {
  it("is told apart from one with something on", () => {
    expect(isUpcomingLine("Upcoming: Bradford City vs. Peterborough United")).toBe(true);
    expect(isUpcomingLine("Morning Footy")).toBe(false);
    expect(isUpcomingLine("Upcoming Stars Showcase")).toBe(true);   // the word alone at the start: an event channel's own wording
    expect(programOnNow(svc.channels[1]!, now)).toBeNull();
    expect(programOnNow(svc.channels[0]!, now)?.title).toBe("Morning Footy");
  });
  it("is left out of the guide, unless a search names the channel", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = liveGuide([svc as any], now);
    expect(g.rows.map((r) => r.id)).toEqual(["golazo"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = liveGuide([svc as any], now, { q: "super league" });
    expect(s.rows.map((r) => r.id)).toEqual(["barclays-womens-super-league"]);
  });
});
