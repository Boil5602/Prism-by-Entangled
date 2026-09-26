import { describe, expect, it } from "vitest";
import { artistsMatch, lookupTerm, matchConfidence, matchTrack, normalizeTrackText, splitArtists, type TrackCandidate } from "../src/music-lookup.js";

/**
 * Quick play's cross-service lookup (2026-09-16): the song playing on one service, found (or not) on
 * another. The rule is strict on purpose - a wrong "found" adds the wrong track to a playlist.
 */
const apple: TrackCandidate[] = [
  { id: "1769021548", title: "Shame", artist: "Lauren Mayberry", album: "Vicious Creature" },
  { id: "1708516453", title: "Shame", artist: "Lauren Mayberry", album: "Shame - Single" },
  { id: "1750554620", title: "ASHAMED (feat. Lauren Mayberry)", artist: "HEALTH", album: "ASHAMED (feat. Lauren Mayberry) - Single" },
];

/** Apple Music's answer to "gunna flow 2 veniso" (2026-09-17), the three that mattered of eight. */
const gunna: TrackCandidate[] = [
  { id: "1653670702", title: "Gunna Flow", artist: "C2", album: "I Chose Music (prod.by BM)", durationMs: 195291 },
  { id: "1702536301", title: "Gunna Flow 2 (feat. Bgunna)", artist: "Recklezz Dely", album: "Gunna Flow 2 (feat. Bgunna) - Single", durationMs: 192980 },
  { id: "1567581570", title: "Ocean Wisdom: Fire in the Booth, Pt. 2", artist: "Ocean Wisdom & Charlie Sloth", durationMs: 469000 },
];

describe("normalizeTrackText / splitArtists", () => {
  it("folds case, diacritics, feat. tails and edition suffixes", () => {
    expect(normalizeTrackText("Shame - Single")).toBe("shame");
    expect(normalizeTrackText("BbY WOW (feat. Judeline)")).toBe("bby wow");
    expect(normalizeTrackText("Debüt [Remastered 2019]")).toBe("debut");
    expect(normalizeTrackText("Rock & Roll")).toBe("rock and roll");
    expect(normalizeTrackText(null)).toBe("");
  });
  it("names every artist on a credit line", () => {
    expect(splitArtists("KAROL G, Judeline & rusowsky")).toEqual(["karol g", "judeline", "rusowsky"]);
    expect(splitArtists("HEALTH feat. Lauren Mayberry")).toEqual(["health", "lauren mayberry"]);
    expect(artistsMatch("Lauren Mayberry", "Lauren Mayberry")).toBe(true);
    expect(artistsMatch("KAROL G", "KAROL G, Judeline & rusowsky")).toBe(true);
    expect(artistsMatch("HEALTH", "Lauren Mayberry")).toBe(false);
    expect(artistsMatch("", "Lauren Mayberry")).toBe(false);
  });
});

describe("matchTrack", () => {
  it("finds the song when title and artist both match, preferring the album cut the query names", () => {
    const v = matchTrack({ title: "Shame", artist: "Lauren Mayberry", album: "Vicious Creature" }, apple);
    expect(v.status).toBe("found");
    if (v.status === "found") expect(v.match.id).toBe("1769021548");
    const single = matchTrack({ title: "Shame", artist: "Lauren Mayberry", album: "Shame - Single" }, apple);
    if (single.status === "found") expect(single.match.id).toBe("1708516453");
    const noAlbum = matchTrack({ title: "Shame", artist: "Lauren Mayberry" }, apple);
    if (noAlbum.status === "found") expect(noAlbum.match.id).toBe("1769021548");   // the service's own first
  });
  it("offers a choice, never a guess, when only the title or only the artist agrees on several candidates", () => {
    const v = matchTrack({ title: "Shame", artist: "Some Other Band" }, apple);
    expect(v.status).toBe("ambiguous");
    if (v.status === "ambiguous") expect(v.candidates.map((c) => c.id)).toEqual(["1769021548", "1708516453"]);
    if (v.status === "ambiguous") expect(v.candidates.map((c) => c.confidence?.percent)).toEqual([55, 55]);   // each row says its own percent (2026-09-18)
    const byArtist = matchTrack({ title: "Something Else", artist: "Lauren Mayberry" }, apple);
    expect(byArtist.status).toBe("ambiguous");
  });
  it("takes a lone partial hit as the answer, with its confidence and the reasons (Gunna - flow 2 on Apple, 2026-09-17)", () => {
    // Spotify played "Gunna - flow 2" by Veniso (117 s); Apple's search answered eight songs, one with that title under another name
    const found = matchTrack({ title: "Gunna - flow 2", artist: "Veniso", album: "Gunna - flow 2", durationMs: 117000 }, gunna);
    expect(found.status).toBe("found");
    if (found.status === "found") {
      expect(found.match.id).toBe("1702536301");
      expect(found.candidates.length).toBe(1);
      expect(found.confidence).toEqual({ percent: 35, because: ["title matches", "artist differs", "length differs"] });
    }
    // no length known on either side: the title alone
    const noLength = matchTrack({ title: "Gunna - flow 2", artist: "Veniso" }, gunna);
    if (noLength.status === "found") expect(noLength.confidence.percent).toBe(55);
    // a lone hit on the artist only: the title differs, so it is barely likely
    const byArtist = matchTrack({ title: "Something Else", artist: "C2" }, gunna);
    expect(byArtist.status).toBe("found");
    if (byArtist.status === "found") expect(byArtist.confidence).toEqual({ percent: 25, because: ["title differs", "artist matches"] });
  });
  it("says how sure a full match is, the album and the length raising it", () => {
    const full = matchTrack({ title: "Shame", artist: "Lauren Mayberry", album: "Vicious Creature" }, apple);
    if (full.status === "found") expect(full.confidence).toEqual({ percent: 98, because: ["title matches", "artist matches", "album matches"] });
    const noAlbum = matchTrack({ title: "Shame", artist: "Lauren Mayberry" }, apple);
    if (noAlbum.status === "found") expect(noAlbum.confidence.percent).toBe(90);
    expect(matchConfidence({ title: "Shame", artist: "Lauren Mayberry", album: "Vicious Creature", durationMs: 200000 }, { id: "x", title: "Shame", artist: "Lauren Mayberry", album: "Vicious Creature", durationMs: 201500 })).toEqual({ percent: 99, because: ["title matches", "artist matches", "album matches", "length matches"] });
    expect(matchConfidence({ title: "Shame", artist: "Lauren Mayberry", durationMs: 200000 }, { id: "x", title: "Shame", artist: "Lauren Mayberry", durationMs: 260000 }).percent).toBe(70);
  });
  it("says not found when nothing agrees, keeping the top of the service's list for the menu", () => {
    const v = matchTrack({ title: "Blue Monday", artist: "New Order" }, apple);
    expect(v.status).toBe("not-found");
    expect(v.candidates.length).toBe(3);
    expect(matchTrack({ title: "" }, apple).status).toBe("not-found");
    expect(matchTrack({ title: "Shame", artist: "Lauren Mayberry" }, []).status).toBe("not-found");
  });
  it("asks the service with the title and the primary artist only", () => {
    expect(lookupTerm({ title: "BbY WOW", artist: "KAROL G, Judeline & rusowsky" })).toBe("bby wow karol g");
    expect(lookupTerm({ title: "Shame - Single" })).toBe("shame");
  });
});
