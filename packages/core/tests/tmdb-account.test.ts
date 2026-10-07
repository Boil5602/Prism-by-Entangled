import { describe, expect, it } from "vitest";
import { LensResolver } from "../src/lenses.js";
import { accessTokenFrom, accountFrom, approveUrl, approveUrlV4, isReadToken, ratedFrom, ratingValue, requestTokenFrom, sessionIdFrom, writeOk } from "../src/tmdb-account.js";

// the person's TMDB account, linked once, so a star pressed on the wall is a rating on TMDB under their name (2026-10-03, "Let's build
// ratings writes to TMDB for individual accounts, if linked")
describe("the person's TMDB account (tmdb-account)", () => {
  it("reads TMDB's answers: a request token, its approval page, a session, the account, a title's own rating, a write's word", () => {
    expect(requestTokenFrom({ success: true, request_token: "abc123" })).toBe("abc123");
    expect(requestTokenFrom({ success: false, status_message: "Invalid API key" })).toBeNull();
    expect(approveUrl("abc 123")).toBe("https://www.themoviedb.org/authenticate/abc%20123");
    expect(sessionIdFrom({ success: true, session_id: "s1" })).toBe("s1");
    expect(sessionIdFrom({ success: false, status_code: 17 })).toBeNull();   // not approved yet
    expect(accountFrom({ id: 42, username: "alex", name: "" })).toEqual({ id: 42, username: "alex" });
    expect(accountFrom({ id: 42 })).toEqual({ id: 42, username: "TMDB account" });
    expect(ratedFrom({ rated: { value: 8.5 } })).toBe(8.5);
    expect(ratedFrom({ rated: false })).toBeNull();
    expect(ratingValue(8.3)).toBe(8.5);
    expect(ratingValue(0)).toBeNull();
    expect(ratingValue(11)).toBeNull();
    expect(writeOk({ success: true, status_code: 1 })).toBe(true);
    expect(writeOk({ success: false, status_code: 3 })).toBe(false);
  });

  function rig() {
    const store = new Map<string, string>();
    const calls: Array<{ method: string; path: string; body?: string }> = [];
    let approved = false;
    const hooks = {
      fetchStatic: async () => { throw new Error("no open source here"); },
      fetchKeyed: async (url: string, _h: Record<string, string>, method?: string, body?: string) => {
        const u = new URL(url); calls.push({ method: method ?? "GET", path: u.pathname, ...(body !== undefined ? { body } : {}) });
        expect(u.searchParams.get("api_key")).toBe("0123456789abcdef0123456789abcdef");   // the person's key, every call
        if (u.pathname.endsWith("/authentication/token/new")) return JSON.stringify({ success: true, request_token: "tok" });
        if (u.pathname.endsWith("/authentication/session/new")) return JSON.stringify(approved ? { success: true, session_id: "sess" } : { success: false, status_code: 17 });
        if (u.pathname.endsWith("/account")) { expect(u.searchParams.get("session_id")).toBe("sess"); return JSON.stringify({ id: 7, username: "alex" }); }
        if (u.pathname.endsWith("/account_states")) { expect(u.searchParams.get("session_id")).toBe("sess"); return JSON.stringify({ rated: { value: 7 } }); }
        if (u.pathname.endsWith("/rating")) { expect(u.searchParams.get("session_id")).toBe("sess"); return JSON.stringify({ success: true, status_code: method === "DELETE" ? 13 : 1 }); }
        if (u.pathname.endsWith("/authentication/session")) return JSON.stringify({ success: true });
        if (u.pathname.endsWith("/account/7/watchlist/movies")) return JSON.stringify({ page: 1, total_pages: 1, results: [{ id: 1359, title: "American Psycho", release_date: "2000-04-13", vote_average: 7.4, vote_count: 12000 }] });
        if (u.pathname.endsWith("/account/7/watchlist/tv")) return JSON.stringify({ page: Number(u.searchParams.get("page")), total_pages: 2, results: u.searchParams.get("page") === "1" ? [{ id: 1399, name: "Game of Thrones", first_air_date: "2011-04-17" }] : [{ id: 66732, name: "Stranger Things", first_air_date: "2016-07-15" }] });
        if (u.pathname.endsWith("/account/7/watchlist")) return JSON.stringify({ success: true, status_code: 1 });
        throw new Error("unexpected " + u.pathname);
      },
      store: () => ({ get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) }),
      dashId: () => "wall", now: () => Date.parse("2026-10-03T03:00:00Z"), paceMs: 0,
    };
    const r = new LensResolver(hooks); r.setKey("0123456789abcdef0123456789abcdef");
    return { r, store, calls, approve: () => { approved = true; } };
  }

  it("links in two steps - the approval page, then the session once TMDB has seen the approval - and keeps the session beside the key", async () => {
    const { r, store, calls, approve } = rig();
    expect(await r.linkState()).toMatchObject({ linked: false, hasKey: true, pending: false });
    const start = await r.linkStart();
    expect(start).toEqual({ url: "https://www.themoviedb.org/authenticate/tok" });
    expect((await r.linkState()).pending).toBe(true);
    expect(await r.linkFinish()).toEqual({ ok: false, error: "TMDB has not seen the approval yet" });   // pressed Done too soon: the token stands
    approve();
    expect(await r.linkFinish()).toEqual({ ok: true, username: "alex" });
    expect(await r.linkState()).toMatchObject({ linked: true, username: "alex", pending: false });
    expect(JSON.parse(store.get("lens:tmdb:session:wall")!)).toMatchObject({ sessionId: "sess", accountId: 7, username: "alex" });
    expect(calls.find((c) => c.path.endsWith("/session/new"))).toMatchObject({ method: "POST", body: JSON.stringify({ request_token: "tok" }) });
  });

  it("writes a rating as a POST under the session, reads the account's own rating back once, takes a rating back as a DELETE; unlinked, it refuses", async () => {
    const { r, calls, approve, store } = rig();
    expect(await r.rate("movie", 1359, 8)).toEqual({ ok: false, error: "no TMDB account is linked" });
    await r.linkStart(); approve(); await r.linkFinish();
    expect(await r.rated("movie", 1359)).toBe(7);
    expect(await r.rated("movie", 1359)).toBe(7);   // kept: one read
    expect(calls.filter((c) => c.path.endsWith("/account_states")).length).toBe(1);
    expect(await r.rate("movie", 1359, 8.3)).toEqual({ ok: true, value: 8.5 });   // a half step
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/3/movie/1359/rating", body: JSON.stringify({ value: 8.5 }) });
    expect(await r.rated("movie", 1359)).toBe(8.5);
    expect(await r.rate("movie", 1359, 11)).toEqual({ ok: false, error: "a rating is a half step from 0.5 to 10" });
    expect(await r.rate("tv", 1399, null)).toEqual({ ok: true, value: null });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/3/tv/1399/rating" });
    expect(JSON.parse(store.get("lens:tmdb:ratings:wall")!)).toEqual({ "movie:1359": 8.5, "tv:1399": 0 });
    await r.unlink();
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/3/authentication/session" });
    expect(await r.linkState()).toMatchObject({ linked: false });
    expect(store.get("lens:tmdb:session:wall")).toBe("");
  });

  it("the watchlist: read both kinds page by page, newest first, kept; a title put on and taken off by its TMDB work; nothing while unlinked (2026-10-03)", async () => {
    const { r, calls, approve, store } = rig();
    expect(r.watchlist().titles).toEqual([]);
    expect(r.watchlistHas("movie", 1359)).toBeNull();
    await r.linkStart(); approve(); await r.linkFinish();
    r.watchlist(true);
    await new Promise((res) => setTimeout(res, 20));
    expect(r.watchlist().titles.map((t) => t.title)).toEqual(["American Psycho", "Game of Thrones", "Stranger Things"]);
    expect(calls.filter((c) => c.path.includes("/watchlist/")).every((c) => c.method === "GET")).toBe(true);
    expect(r.watchlistHas("tv", 66732)).toBe(true);
    expect(await r.watchlistSet("tv", 66732, false)).toEqual({ ok: true });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/3/account/7/watchlist", body: JSON.stringify({ media_type: "tv", media_id: 66732, watchlist: false }) });
    expect(r.watchlistHas("tv", 66732)).toBe(false);
    expect(JSON.parse(store.get("lens:tmdb:watchlist:wall")!).titles.length).toBe(2);
    await r.unlink();
    expect(r.watchlist().titles).toEqual([]);   // unlinked: the services' own lists take the row back
  });

  // TMDB's v4 sign-in when the key is a read access token (a JWT): the user's access token for their lists (public or private), and a v3
  // session converted from it for the ratings and the watchlist - one approval for all of them (2026-10-03, "move our playlist capability there")
  it("a read access token links through v4: the approval page, the access token, a v3 session made from it; lists are made, filled, read and deleted under the user's token", async () => {
    expect(isReadToken("0123456789abcdef0123456789abcdef")).toBe(false);
    expect(isReadToken("aaa.bbb.ccc")).toBe(true);
    expect(approveUrlV4("t k")).toBe("https://www.themoviedb.org/auth/access?request_token=t%20k");
    expect(accessTokenFrom({ success: true, access_token: "ua", account_id: "acc1" })).toEqual({ token: "ua", accountObjectId: "acc1" });
    expect(accessTokenFrom({ success: false, status_code: 422 })).toBeNull();
    const store = new Map<string, string>();
    const calls: Array<{ method: string; path: string; auth: string; body?: string }> = [];
    let approved = false;
    const hooks = {
      fetchStatic: async () => { throw new Error("no open source here"); },
      fetchKeyed: async (url: string, h: Record<string, string>, method?: string, body?: string) => {
        const u = new URL(url); calls.push({ method: method ?? "GET", path: u.pathname, auth: h.Authorization ?? "", ...(body !== undefined ? { body } : {}) });
        if (u.pathname === "/4/auth/request_token") { expect(h.Authorization).toBe("Bearer r.e.ad"); return JSON.stringify({ success: true, request_token: "req" }); }
        if (u.pathname === "/4/auth/access_token") { expect(h.Authorization).toBe("Bearer r.e.ad"); return JSON.stringify(approved ? { success: true, access_token: "user-token", account_id: "acc1" } : { success: false, status_code: 422 }); }
        if (u.pathname === "/3/authentication/session/convert/4") { expect(body).toBe(JSON.stringify({ access_token: "user-token" })); return JSON.stringify({ success: true, session_id: "sess" }); }
        if (u.pathname === "/3/account") return JSON.stringify({ id: 7, username: "alex" });
        if (u.pathname === "/4/list" && method === "POST") { expect(h.Authorization).toBe("Bearer user-token"); expect(JSON.parse(body!)).toEqual({ name: "Trek", iso_639_1: "en", description: "", public: false }); return JSON.stringify({ success: true, status_code: 1, id: 99 }); }
        if (u.pathname === "/4/list/99/items") return JSON.stringify({ success: true, status_code: 1, results: [{ media_id: 253, media_type: "tv", success: true }] });
        if (u.pathname === "/4/list/99" && method === "GET") return JSON.stringify({ id: 99, name: "Trek", results: [{ id: 253, media_type: "tv", name: "Star Trek" }], comments: { "tv:253": null }, sort_by: "original_order.asc", total_pages: 1 });
        if (u.pathname === "/4/list/99" && method === "PUT") return JSON.stringify({ success: true, status_code: 12 });
        if (u.pathname === "/4/list/99" && method === "DELETE") return JSON.stringify({ success: true, status_code: 13 });
        if (u.pathname === "/4/account/acc1/lists") return JSON.stringify({ page: 1, results: [{ id: 99, name: "Trek" }], total_pages: 1 });
        if (u.pathname === "/4/auth/access_token" && method === "DELETE") return JSON.stringify({ success: true });
        if (u.pathname === "/3/authentication/session") return JSON.stringify({ success: true });
        throw new Error("unexpected " + method + " " + u.pathname);
      },
      store: () => ({ get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) }),
      dashId: () => "wall", now: () => Date.parse("2026-10-03T03:00:00Z"), paceMs: 0,
    };
    const r = new LensResolver(hooks); r.setKey("r.e.ad");
    expect(await r.linkState()).toMatchObject({ linked: false, lists: false, listsPossible: true });
    expect(await r.linkStart()).toEqual({ url: "https://www.themoviedb.org/auth/access?request_token=req" });
    expect(await r.linkFinish()).toEqual({ ok: false, error: "TMDB has not seen the approval yet" });
    approved = true;
    expect(await r.linkFinish()).toEqual({ ok: true, username: "alex" });
    expect(await r.linkState()).toMatchObject({ linked: true, username: "alex", lists: true });
    expect(JSON.parse(store.get("lens:tmdb:session:wall")!)).toMatchObject({ sessionId: "sess", accountId: 7, v4Token: "user-token", accountObjectId: "acc1" });
    expect(await r.listCreate("Trek", false)).toBe(99);
    expect(await r.listItems(99, "POST", [{ media_type: "tv", media_id: 253 }])).toMatchObject({ success: true });
    expect((await r.listGet(99))?.sort_by).toBe("original_order.asc");
    expect(await r.listUpdate(99, { public: true })).toBe(true);
    expect((await r.listsOfAccount())?.results).toEqual([{ id: 99, name: "Trek" }]);
    expect(await r.listDelete(99)).toBe(true);
    expect(calls.filter((c) => c.path.startsWith("/4/list")).every((c) => c.auth === "Bearer user-token")).toBe(true);   // the user's token, never the key, on their lists
    await r.unlink();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/4/list/99", "/4/auth/access_token", "/3/authentication/session"]);
  });
});
