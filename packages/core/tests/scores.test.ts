import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseScoreboard, gamesOfTheDay, scoreLine, sportOf, SCORE_URL } from "../src/scores.js";

/** ESPN's scoreboard header as read 2026-09-30 23:07 (tests/fixtures/espn/header.json): the day's games across the leagues in season. */
const page = readFileSync(new URL("./fixtures/espn/header.json", import.meta.url), "utf8");

describe("scores from ESPN's scoreboard header (2026-09-30)", () => {
  it("reads into games with the source's own state, detail, scores and broadcaster, television and streaming only", () => {
    const all = parseScoreboard(page);
    expect(all.length).toBeGreaterThanOrEqual(10);
    const mlb = all.filter((g) => g.league === "MLB");
    expect(mlb.length).toBe(4);
    expect(mlb[0]).toMatchObject({ leagueName: "Major League Baseball", state: "post", detail: "Final/10", home: { abbr: "ATL", score: "3" }, away: { abbr: "PHI", score: "4", winner: true }, tv: ["NBC"], short: "PHI @ ATL" });
    expect(all.find((g) => g.league === "MLS")).toMatchObject({ state: "post", detail: "FT", home: { abbr: "RBNY", score: "0" }, away: { abbr: "STL", score: "3" }, tv: ["Apple TV"] });
    const wnba = all.find((g) => g.league === "WNBA" && g.state === "in");
    expect(wnba).toMatchObject({ detail: "3:32 - 4th", home: { abbr: "DAL", score: "84" }, away: { abbr: "GS", score: "87" } });
    const pre = all.find((g) => g.state === "pre");
    expect(pre?.home.score).toBeNull();
    expect(SCORE_URL).not.toMatch(/[?#]/);   // a bare address (section 19/22)
    expect(parseScoreboard("not json")).toEqual([]);
    expect(parseScoreboard(JSON.stringify({ sports: [{ leagues: [{ abbreviation: "X", events: [{ id: "1" }, null, "junk"] }] }] }))).toEqual([]);
  });
  it("the day's games: in play first, then over, then to come; another day's left out", () => {
    const all = parseScoreboard(page);
    const dayStart = Date.parse("2026-09-30T04:00Z"), dayEnd = Date.parse("2026-10-01T04:00Z");   // an Eastern day
    const day = gamesOfTheDay(all, dayStart, dayEnd);
    expect(day.every((g) => g.state === "in" || (g.start >= dayStart && g.start < dayEnd))).toBe(true);
    const order = ["in", "post", "pre"];
    expect(day.map((g) => g.state)).toEqual([...day.map((g) => g.state)].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(day[0]!.state).toBe("in");
    const tomorrow = { ...all[0]!, id: "t", start: dayEnd + 3_600_000, state: "pre" as const };
    expect(gamesOfTheDay([tomorrow, ...all], dayStart, dayEnd).some((g) => g.id === "t")).toBe(false);
  });
  it("a line as a person says it; a set score stays as written", () => {
    const all = parseScoreboard(page);
    expect(scoreLine(all.find((g) => g.short === "PHI @ ATL")!, () => "x")).toBe("Phillies 4, Braves 3, Final/10");
    const pre = all.find((g) => g.state === "pre")!;
    expect(scoreLine(pre, () => "11:05 PM")).toBe(pre.away.name + " at " + pre.home.name + ", 11:05 PM");
    const sets = all.find((g) => g.league === "ATP")!;
    expect(scoreLine(sets, () => "x")).toBe("Jaume Munar 6-5, Taylor Fritz 5-6, 1st");
  });
  it("the sport from the words: soccer's before a bare football, nothing when nothing says", () => {
    expect(sportOf("Chiefs vs. Ravens", "NFL RedZone")).toBe("football");
    expect(sportOf("Seattle vs. Kansas City", "MLS")).toBe("soccer");
    expect(sportOf("Bahrain: Practice 1", "Formula 1")).toBe("racing");
    expect(sportOf("SportsCenter")).toBeNull();
    expect(sportOf("Yankees at Red Sox", "MLB Network")).toBe("baseball");
    expect(sportOf(null, undefined)).toBeNull();
  });
});

describe("the sport's words (2026-09-30, the wall's first Sports mode)", () => {
  it("the English leagues are soccer, not American football", () => {
    expect(sportOf("Upcoming: Reading vs. Bradford City", "English Football League")).toBe("soccer");
    expect(sportOf("Carabao Cup")).toBe("soccer");
    expect(sportOf("CBS Sports Golazo Network")).toBe("soccer");
    expect(sportOf("Monday Night Football", "ESPN")).toBe("football");
  });
});

describe("the marks (2026-10-01, 'Team logos, emblems, states, etc.')", () => {
  it("each team's mark and colour and the sport's mark come through as the source gives them", () => {
    const g = parseScoreboard(page).find((x) => x.short === "PHI @ ATL")!;
    expect(g.away).toMatchObject({ logo: "https://a.espncdn.com/i/teamlogos/mlb/500-dark/scoreboard/phi.png", color: "e81828" });
    expect(g.sportLogo).toMatch(/^https:\/\/a\.espncdn\.com\/.*dark/);
    const t = parseScoreboard(page).find((x) => x.league === "ATP")!;
    expect(t.home.color).toBeNull();
    expect(t.home.logo).toMatch(/countries/);
  });
});

describe("the sports day (2026-10-01, 'It's September 30 ... why would it say 10/1')", () => {
  it("rolls at 4 AM: a game that began in the evening is that evening's past midnight", () => {
    const all = parseScoreboard(page);
    // the wall at 12:16 AM Eastern on Oct 1: the day is still Sep 30, from 4 AM to 4 AM
    const dayStart = Date.parse("2026-09-30T08:00Z"), dayEnd = Date.parse("2026-10-01T08:00Z");
    const day = gamesOfTheDay(all, dayStart, dayEnd);
    expect(day.some((g) => g.short === "PHI @ ATL")).toBe(true);   // the afternoon's final
    expect(day.some((g) => g.state === "in")).toBe(true);           // the night's games on
  });
});

describe("the last day, and the way in (2026-10-01)", () => {
  it("every read merges into what is kept; the last day's games are in play first, then finals newest first, then to come", async () => {
    const { mergeKept, gamesOfLastDay } = await import("../src/scores.js");
    const all = parseScoreboard(page);
    const now = Date.parse("2026-10-01T04:16Z");
    const kept = mergeKept([], all, now);
    expect(kept.length).toBe(all.length);
    // the next read lists only the current slate, one game now final
    const later = all.filter((g) => g.state === "in").map((g) => ({ ...g, state: "post" as const, detail: "Final" }));
    const merged = mergeKept(kept, later, now + 3_600_000);
    expect(merged.length).toBe(all.length);                                            // yesterday's finals kept
    expect(merged.filter((g) => g.state === "in").length).toBe(0);
    const day = gamesOfLastDay(merged, now + 3_600_000);
    expect(day.length).toBeGreaterThan(5);
    const finals = day.filter((g) => g.state === "post");
    expect(finals.map((g) => g.start)).toEqual([...finals.map((g) => g.start)].sort((a, b) => b - a));   // newest first
    // a day on, the afternoon's games are gone
    expect(mergeKept(merged, [], now + 25 * 3_600_000).some((g) => g.short === "PHI @ ATL")).toBe(false);
  });
  it("who carries a game maps to the wall's services; a stream's words name a game by both teams", async () => {
    const { appsCarrying, namesGame } = await import("../src/scores.js");
    // the adapters say which networks they carry (2026-10-02): a name as ESPN writes it, or the start of one as a word
    const carriers = [{ app: "appletv", broadcasters: ["Apple TV"] }, { app: "peacock", broadcasters: ["Peacock", "NBC"] }, { app: "paramountplus", broadcasters: ["Paramount+", "CBS"] }, { app: "netflix" }];
    expect(appsCarrying(["Apple TV"], carriers)).toEqual(["appletv"]);
    expect(appsCarrying(["Peacock", "NBC Sports Network"], carriers)).toEqual(["peacock"]);
    expect(appsCarrying(["NBCSN"], carriers)).toEqual([]);
    expect(appsCarrying(["CBS", "Paramount+"], carriers)).toEqual(["paramountplus"]);
    expect(appsCarrying(["ESPN", "truTV"], carriers)).toEqual([]);
    const mls = parseScoreboard(page).find((g) => g.league === "MLS")!;
    expect(namesGame("New York Red Bulls vs. Saint Louis City SC", mls)).toBe(true);
    expect(namesGame("Seattle vs. Kansas City", mls)).toBe(false);
    const mlb = parseScoreboard(page).find((g) => g.short === "PHI @ ATL")!;
    expect(namesGame("Phillies at Braves", mlb)).toBe(true);
    expect(namesGame("Braves Live Postgame", mlb)).toBe(false);
  });
});

describe("the per-league day pages (2026-10-01, read in a hidden page of Prism's own browser)", () => {
  it("read into the same games as the header's; the address names the day", async () => {
    const { parseLeagueScoreboard, scoreDayUrl } = await import("../src/scores.js");
    const games = parseLeagueScoreboard("MLB", "Major League Baseball", readFileSync(new URL("./fixtures/espn/mlb-day.json", import.meta.url), "utf8"));
    expect(games.length).toBe(4);
    expect(games[0]).toMatchObject({ league: "MLB", state: "post", detail: "Final/10", home: { abbr: "ATL", score: "3" }, away: { abbr: "PHI", score: "4" }, tv: ["NBC"] });
    expect(games[0]!.away.logo).toMatch(/^https:\/\/a\.espncdn\.com\//);
    expect(scoreDayUrl("baseball/mlb", new Date(2026, 8, 30))).toBe("https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20260930");
    expect(parseLeagueScoreboard("X", "X", "nope")).toEqual([]);
  });
});
