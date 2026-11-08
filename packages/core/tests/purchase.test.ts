import { describe, expect, it } from "vitest";
import { purchaseOffer, storeProvidersOf } from "../src/purchase.js";
import type { AdapterSpec } from "../src/adapters.js";

// A Rent or Buy offer becomes an address for the person's phone: the service's own search page for the title, nothing else's.
describe("a title's Rent or Buy offer as an address for the phone (purchase.ts)", () => {
  const fandango = { videoSearchUrl: "https://athome.fandango.com/content/browse/search?searchString={q}", tmdbProviders: [7] } as unknown as AdapterSpec;
  const prime = { videoSearchUrl: "https://www.primevideo.com/search/ref=atv_nb_sr?phrase={q}", tmdbProviders: [9, 119], purchaseProviders: [10] } as unknown as AdapterSpec;
  const apple = { videoSearchUrl: "https://tv.apple.com/search?term={q}", tmdbProviders: [350, 2], purchase: { where: "app", note: "The Apple TV app sells titles itself.", source: "https://support.apple.com/" } } as unknown as AdapterSpec;
  const noSearch = { tmdbProviders: [192] } as unknown as AdapterSpec;
  const all = [fandango, prime, apple, noSearch, undefined];

  it("is the service's own search page for the title, the title encoded", () => {
    expect(purchaseOffer(all, 7, "Juniper & Rye: Part 2")).toEqual({ url: "https://athome.fandango.com/content/browse/search?searchString=Juniper%20%26%20Rye%3A%20Part%202" });
  });

  it("a store's own provider id finds its service without making the service's subscription carry the title", () => {
    expect(purchaseOffer(all, 10, "The Lantern Coast")?.url).toBe("https://www.primevideo.com/search/ref=atv_nb_sr?phrase=The%20Lantern%20Coast");
    expect((prime as unknown as { tmdbProviders: number[] }).tmdbProviders).not.toContain(10);
    expect(storeProvidersOf(prime)).toEqual([10]);
    expect(storeProvidersOf(fandango)).toEqual([]);
  });

  it("says where the service sells only when its adapter records it", () => {
    expect(purchaseOffer(all, 2, "Northbound")).toEqual({ url: "https://tv.apple.com/search?term=Northbound", where: "app", note: "The Apple TV app sells titles itself." });
    expect(purchaseOffer(all, 7, "Northbound")).not.toHaveProperty("where");
  });

  it("gives nothing for a provider no adapter claims, a service with no search address, or no title", () => {
    expect(purchaseOffer(all, 68, "Northbound")).toBeNull();
    expect(purchaseOffer(all, 192, "Northbound")).toBeNull();
    expect(purchaseOffer(all, 7, "  ")).toBeNull();
    expect(purchaseOffer([{ videoSearchUrl: "http://plain.example/?q={q}", tmdbProviders: [5] } as unknown as AdapterSpec], 5, "X")).toBeNull();   // https only
  });
});
