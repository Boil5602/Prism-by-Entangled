import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { cleanLibrary, jpegArt } from "../src/video.js";
import type { Drivers } from "../src/drivers.js";
import type { VideoItem } from "../src/types.js";

// The Library tab's Group by (2026-09-23, "Add an option for None (so we can just sort the whole library)") and Apple's .webp art
// asked as .jpg (2026-09-23, Apple titles without images: the host's image decoder takes no WebP).

function drivers(): Drivers {
  const kv = new Map<string, string>();
  return {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {},
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {},
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
}
const card = (title: string, app = "fandango") => ({ app, service: app, facet: app, item: { id: title, title, kind: "movie", url: null, artwork: null, subtitle: null, progress: null } as VideoItem });

describe("the Library tab's Group by", () => {
  const cards = [card("Zodiac"), card("Dolphin Tale 2: Blooper Reel (featurette)"), card("Alien", "moviesanywhere"), card("Heat")];

  it("None: every title in one group in the sort chosen; the store's bonus material still apart, last", () => {
    const o = new Orchestrator(drivers());
    const r = o.videoLibraryRows(cards, "own", "none");
    expect(r.rows.map((x) => x.genre)).toEqual(["All titles", "Extras"]);
    expect(r.rows[0]!.cards.map((c) => (c.item as VideoItem).title)).toEqual(["Zodiac", "Alien", "Heat"]);
    expect(r.rows[1]!.cards.map((c) => (c.item as VideoItem).title)).toEqual(["Dolphin Tale 2: Blooper Reel (featurette)"]);
  });

  it("Genre (the default): titles TMDB has no genre for yet under Unsorted, the Extras last", () => {
    const o = new Orchestrator(drivers());
    expect(o.videoLibraryRows(cards, "own").rows.map((x) => x.genre)).toEqual(["Unsorted", "Extras"]);
  });

  it("nothing owned: no rows either way", () => {
    const o = new Orchestrator(drivers());
    expect(o.videoLibraryRows([], "own", "none").rows).toEqual([]);
    expect(o.videoLibraryRows([], "own", "genre").rows).toEqual([]);
  });
});

describe("Apple's art as .jpg", () => {
  it("an mzstatic .webp address is asked as .jpg, its query kept; anything else untouched", () => {
    expect(jpegArt("https://is1-ssl.mzstatic.com/image/thumb/Video/v4/ab/cd/1200x675.webp")).toBe("https://is1-ssl.mzstatic.com/image/thumb/Video/v4/ab/cd/1200x675.jpg");
    expect(jpegArt("https://is2-ssl.mzstatic.com/image/thumb/x/1200x675sr.webp?output=1")).toBe("https://is2-ssl.mzstatic.com/image/thumb/x/1200x675sr.jpg?output=1");
    expect(jpegArt("https://images.example.com/poster.webp")).toBe("https://images.example.com/poster.webp");
    expect(jpegArt("https://is1-ssl.mzstatic.com/image/thumb/x/1200x675.jpg")).toBe("https://is1-ssl.mzstatic.com/image/thumb/x/1200x675.jpg");
  });

  it("a service's report goes through it: the library's cards carry the .jpg", () => {
    const lib = cleanLibrary({ continue: [{ id: "1", title: "Hijack", artwork: "https://is1-ssl.mzstatic.com/image/thumb/a/400x225.webp" }], list: [] });
    expect(lib.continue[0]!.artwork).toBe("https://is1-ssl.mzstatic.com/image/thumb/a/400x225.jpg");
  });
});

describe("a store's own landscape picture (videoOwnedArtWide, 2026-09-24)", () => {
  it("the address with the card's id; none for a service without one, or an id that is not a plain token", () => {
    const o = new Orchestrator(drivers());
    o.setAdapters({ fandango: { id: "fandango", match: ["athome.fandango.com"], videoOwnedArtWide: "https://images2.vudu.com/background/{id}-1280" } as never, hulu: { id: "hulu", match: ["www.hulu.com"] } as never });
    expect(o.ownedWideArt("fandango", "13368")).toBe("https://images2.vudu.com/background/13368-1280");
    expect(o.ownedWideArt("hulu", "13368")).toBeNull();
    expect(o.ownedWideArt("fandango", "../x?y")).toBeNull();
  });
});
