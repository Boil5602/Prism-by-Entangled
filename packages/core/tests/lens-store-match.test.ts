import { describe, expect, it } from "vitest";
import { LensResolver, factsFor } from "../src/lenses.js";

// A title read from a store is a work that store sells (2026-10-15, "I see some things like Redemption (2022) in my library, but I really dont
// think I own that series. I do see a movie called Redemption from 2013"). TMDB files Jason Statham's 2013 film under its UK name,
// Hummingbird; its search for "Redemption" returns only other works, the most popular a 2022 series no US service offers. Wikidata knows the
// film by its US title, and Fandango at Home (TMDB provider 7) sells only that one.

const SEARCH = { results: [
  { id: 215709, media_type: "tv", name: "Redemption", first_air_date: "2022-11-21", poster_path: "/series.jpg" },
  { id: 194929, media_type: "tv", name: "Redemption", first_air_date: "2022-03-01" },
] };
const PROVIDERS: Record<string, unknown> = {
  "/tv/215709/watch/providers": { results: {} },
  "/tv/194929/watch/providers": { results: { US: { flatrate: [{ provider_id: 151 }] } } },
  "/movie/136418/watch/providers": { results: { US: { buy: [{ provider_id: 7 }], rent: [{ provider_id: 7 }] } } },
  "/movie/158394/watch/providers": { results: {} },
};

function rig(opts: { secondOffered?: boolean; noWikidata?: boolean } = {}) {
  const keyed: string[] = []; const statics: string[] = []; const store = new Map<string, string>();
  const hooks = {
    fetchStatic: async (url: string) => {
      statics.push(url);
      if (opts.noWikidata) return "<ul class=\"mw-search-results\"></ul>";
      const head = (q: string, label: string) => `<li><div class="mw-search-result-heading"><a href="/wiki/${q}" title="${label} | a work" data-serp-pos="0">${label} (${q})</a></div></li>`;
      if (url.startsWith("https://www.wikidata.org/wiki/Special:Search/")) return `<ul class="mw-search-results">${head("Q27438121", "Red Dead Redemption 2")}${head("Q8990291", "Redemption")}${head("Q7305741", "Redemption")}${head("Q112090938", "Redemption")}</ul>`;
      throw new Error("no such page");
    },
    fetchKeyed: async (url: string) => {
      keyed.push(url);
      const path = url.replace("https://api.themoviedb.org/3", "").replace(/\?.*$/, "");
      if (path === "/search/multi") return JSON.stringify(SEARCH);
      if (path.startsWith("/find/")) { const q = path.slice(6); const m: Record<string, object> = { Q8990291: { movie_results: [{ id: 136418 }] }, Q7305741: { movie_results: [{ id: 158394 }] }, Q112090938: { tv_results: [{ id: 194929 }] }, Q27438121: { movie_results: [{ id: 999 }] } }; return JSON.stringify(m[q] ?? {}); }
      if (path === "/movie/158394/watch/providers" && opts.secondOffered) return JSON.stringify({ results: { US: { buy: [{ provider_id: 7 }] } } });
      if (PROVIDERS[path]) return JSON.stringify(PROVIDERS[path]);
      if (path === "/movie/136418") return JSON.stringify({ id: 136418, title: "Hummingbird", release_date: "2013-05-07", poster_path: "/hummingbird.jpg", backdrop_path: "/hb.jpg" });
      if (path.endsWith("/external_ids")) return JSON.stringify({ wikidata_id: path.includes("136418") ? "Q8990291" : "Q116250374" });
      return JSON.stringify({});
    },
    store: () => ({ get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) }),
    dashId: () => "wall", now: () => Date.parse("2026-10-15T12:00:00Z"), paceMs: 0,
  };
  const r = new LensResolver(hooks); r.setKey("eyJhbGciOi.readtoken");
  return { r, keyed, statics };
}
const settle = async (r: LensResolver) => { for (let i = 0; i < 100 && r.pending > 0; i++) await new Promise((res) => setTimeout(res, 10)); };

describe("a store's title is a work the store sells", () => {
  it("Redemption on Fandango at Home is the 2013 film TMDB calls Hummingbird, not the 2022 series", async () => {
    const { r } = rig();
    r.ensure([{ title: "Redemption", kind: null, providers: [7, 332] }], ["poster"], false);
    await settle(r);
    const f = factsFor(r.factsOf(), "Redemption", null)!;
    expect(f.tmdb).toEqual({ kind: "movie", id: 136418 });
    expect(f.year).toBe(2013);
    expect(f.poster).toBe("https://image.tmdb.org/t/p/w342/hummingbird.jpg");
  });
  it("two namesakes the store sells: no guess, the pick stands", async () => {
    const { r } = rig({ secondOffered: true });
    r.ensure([{ title: "Redemption", kind: null, providers: [7, 332] }], ["poster"], false);
    await settle(r);
    expect(factsFor(r.factsOf(), "Redemption", null)!.tmdb).toEqual({ kind: "tv", id: 215709 });
  });
  it("Wikidata knows no other: the pick stands", async () => {
    const { r } = rig({ noWikidata: true });
    r.ensure([{ title: "Redemption", kind: null, providers: [7, 332] }], ["poster"], false);
    await settle(r);
    expect(factsFor(r.factsOf(), "Redemption", null)!.tmdb).toEqual({ kind: "tv", id: 215709 });
  });
  it("Wikidata is asked by path only: no query string reaches the static route (§19/§22)", async () => {
    const { r, statics } = rig();
    r.ensure([{ title: "Redemption", kind: null, providers: [7, 332] }], ["poster"], false);
    await settle(r);
    expect(statics.length).toBe(2);   // films, then series
    expect(statics.every((u) => !u.includes("?") && !u.includes("#"))).toBe(true);
  });
  it("no store named (a title with no providers): Wikidata is not asked", async () => {
    const { r, statics } = rig();
    r.ensure([{ title: "Redemption", kind: null }], ["poster"], false);
    await settle(r);
    expect(statics).toEqual([]);
  });
});
