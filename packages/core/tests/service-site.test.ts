import { describe, expect, it } from "vitest";
import { onServiceSite } from "../src/adapters.js";

// a list change's address (the phone's route carries one) is only opened on the service's own site (2026-10-14)
describe("onServiceSite", () => {
  const hosts = ["www.hulu.com", "https://www.netflix.com/browse"];
  it("takes the match host, its bare form and its subdomains", () => {
    expect(onServiceSite("https://www.hulu.com/series/x", hosts)).toBe(true);
    expect(onServiceSite("https://hulu.com/series/x", hosts)).toBe(true);
    expect(onServiceSite("https://play.hulu.com/watch/x", hosts)).toBe(true);
  });
  it("takes the home address's host", () => {
    expect(onServiceSite("https://www.netflix.com/title/1", hosts)).toBe(true);
  });
  it("refuses another site, a look-alike, http and junk", () => {
    expect(onServiceSite("https://example.com/", hosts)).toBe(false);
    expect(onServiceSite("https://www.hulu.com.evil.net/", hosts)).toBe(false);
    expect(onServiceSite("https://notnetflix.com/", hosts)).toBe(false);
    expect(onServiceSite("http://www.hulu.com/", hosts)).toBe(false);
    expect(onServiceSite("javascript:alert(1)", hosts)).toBe(false);
    expect(onServiceSite(null, hosts)).toBe(false);
    expect(onServiceSite("https://www.hulu.com/", [])).toBe(false);
  });
});
