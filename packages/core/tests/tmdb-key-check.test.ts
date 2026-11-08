import { describe, expect, it } from "vitest";
import { LensResolver } from "../src/lenses.js";

// The TMDB guide (2026-10-10) says a key works only after TMDB has taken it, and never calls a key bad because the network was down.
describe("whether TMDB takes the person's key (keyCheck)", () => {
  const SHORT = "0123456789abcdef0123456789abcdef";
  const LONG = "eyJhbGciOiJIUzI1NiJ9" + "." + "eyJhdWQiOiJmYWtlZmFrZWZha2VmYWtlIiwic3ViIjoiMCJ9" + "." + "c2lnbmF0dXJlLW5vdC1yZWFsLWp1c3QtYS10ZXN0";
  function rig(answer: (url: string, headers: Record<string, string>) => string) {
    const store = new Map<string, string>();
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const r = new LensResolver({
      fetchStatic: async () => { throw new Error("no open source here"); },
      fetchKeyed: async (url: string, headers: Record<string, string>) => { seen.push({ url, headers }); return answer(url, headers); },
      store: () => ({ get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) }),
      dashId: () => "wall", now: () => Date.parse("2026-10-10T03:00:00Z"), paceMs: 0,
    });
    return { r, seen };
  }

  it("asks TMDB's own key check, the short key in the address and the long one as a bearer", async () => {
    const a = rig(() => JSON.stringify({ success: true, status_code: 1 }));
    a.r.setKey(SHORT);
    expect(await a.r.keyCheck()).toBe("ok");
    expect(a.seen[0]!.url).toBe("https://api.themoviedb.org/3/authentication?api_key=" + SHORT);
    const b = rig(() => JSON.stringify({ success: true, status_code: 1 }));
    b.r.setKey(LONG);
    expect(await b.r.keyCheck()).toBe("ok");
    expect(b.seen[0]!.url).toBe("https://api.themoviedb.org/3/authentication");
    expect(b.seen[0]!.headers).toEqual({ Authorization: "Bearer " + LONG });
  });

  it("refused is TMDB's own no; a network that is down is unreachable, never a bad key", async () => {
    const no = rig(() => { throw new Error("fetchKeyed: HTTP 401"); });
    no.r.setKey(LONG);
    expect(await no.r.keyCheck()).toBe("refused");
    const body = rig(() => JSON.stringify({ success: false, status_code: 7, status_message: "Invalid API key: You must be granted a valid key." }));
    body.r.setKey(SHORT);
    expect(await body.r.keyCheck()).toBe("refused");
    for (const err of ["fetchKeyed: HTTP 503", "fetchKeyed: No such host is known", "fetchKeyed: HTTP 429"]) {
      const down = rig(() => { throw new Error(err); });
      down.r.setKey(LONG);
      expect(await down.r.keyCheck()).toBe("unreachable");
      expect(down.r.hasKey()).toBe(true);
    }
  });

  it("with no key there is nothing to ask, and every key set is a new count", async () => {
    const { r, seen } = rig(() => JSON.stringify({ success: true }));
    expect(await r.keyCheck()).toBe("none");
    expect(seen.length).toBe(0);
    expect(r.keyState()).toEqual({ hasKey: false, sets: 0 });
    r.setKey(SHORT);
    expect(r.keyState()).toEqual({ hasKey: true, sets: 1 });
    r.setKey(SHORT);
    expect(r.keyState()).toEqual({ hasKey: true, sets: 2 });
    r.setKey(null);
    expect(r.keyState()).toEqual({ hasKey: false, sets: 3 });
  });
});
