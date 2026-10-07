import { describe, it, expect } from "vitest";
import { accountKey, addSignIn, hideSignIn, showSignIn, emptySignIns, noteStatus, parseSignIns, renameSignIn, signInById, signInByProfile, withProfile, FIRST_SIGN_IN_NAME, isSharedProfile, sharedPlan } from "../src/sign-ins.js";

describe("sign-ins: one login kept on the device, by name (2026-09-29)", () => {
  it("services of one account share its sign-ins; a service with none of its own account has its own", () => {
    expect(accountKey("appletv", "apple")).toBe("account:apple");
    expect(accountKey("apple-music", " Apple ")).toBe("account:apple");
    expect(accountKey("netflix", null)).toBe("app:netflix");
    expect(accountKey("netflix", "  ")).toBe("app:netflix");
  });

  it("the profile a device began with is its first sign-in; one already named is left alone", () => {
    const a = withProfile(emptySignIns(), "account:apple", "apple-music", "Apple Music");
    expect(a.accounts["account:apple"]).toEqual([{ id: "household", name: FIRST_SIGN_IN_NAME, profile: "apple-music" }]);
    expect(withProfile(a, "account:apple", "apple-music", "Apple Music")).toBe(a);
    // a wall from before accounts were shared: Apple TV has a profile of its own, signed in too - a second sign-in, named after the service
    const b = withProfile(a, "account:apple", "appletv", "Apple TV");
    expect(b.accounts["account:apple"]!.map((s) => s.name)).toEqual([FIRST_SIGN_IN_NAME, "Household (Apple TV)"]);
  });

  it("a person adds theirs: a new, empty profile under their name; the same name is the same sign-in", () => {
    const base = withProfile(emptySignIns(), "account:apple", "shared", "Apple TV");
    const r = addSignIn(base, "account:apple", "  Maya ", new Set(["shared"]));
    if ("error" in r) throw new Error(r.error);
    expect(r.made).toBe(true);
    expect(r.signIn).toEqual({ id: "maya", name: "Maya", profile: "shared-2", by: "person" });   // the account's second slot: one browser, many sign-ins (2026-10-03)
    const again = addSignIn(r.state, "account:apple", "maya", new Set());
    if ("error" in again) throw new Error(again.error);
    expect(again.made).toBe(false);
    expect(again.signIn.id).toBe("maya");
    expect(again.state).toBe(r.state);
    // no name given: one to begin with, until its account page names it or a person does
    const unnamed = addSignIn(base, "account:apple", "   ", new Set());
    if ("error" in unnamed) throw new Error(unnamed.error);
    expect(unnamed.signIn).toEqual({ id: "new-sign-in", name: "New sign-in", profile: "shared-2" });   // from the base, which holds the first slot alone
    // another account's first other sign-in takes the same second slot: one browser holds both (2026-10-03)
    const taken = addSignIn(withProfile(base, "app:netflix", "shared", "Netflix"), "app:netflix", "Maya", new Set(["shared-2"]));
    if ("error" in taken) throw new Error(taken.error);
    expect(taken.signIn.profile).toBe("shared-2");
  });

  it("what a service knew of its session under a sign-in is kept for its return", () => {
    let s = withProfile(emptySignIns(), "account:apple", "account-apple", "Apple TV");
    s = noteStatus(s, "account:apple", "account-apple", "appletv", "signed-in");
    s = noteStatus(s, "account:apple", "account-apple", "apple-music", "needs-attention");
    expect(signInByProfile(s, "account:apple", "account-apple")!.status).toEqual({ appletv: "signed-in", "apple-music": "needs-attention" });
    expect(noteStatus(s, "account:apple", "account-apple", "appletv", "signed-in")).toBe(s);
    expect(noteStatus(s, "account:apple", "nothing", "appletv", "signed-in")).toBe(s);
  });

  it("renamed by a person; two of an account never share a name", () => {
    let s = withProfile(emptySignIns(), "app:netflix", "netflix", "Netflix");
    const r = addSignIn(s, "app:netflix", "Maya", new Set());
    if ("error" in r) throw new Error(r.error);
    s = r.state;
    const n = renameSignIn(s, "app:netflix", "household", "Alex");
    if ("error" in n) throw new Error(n.error);
    expect(signInById(n, "app:netflix", "household")!.name).toBe("Alex");
    expect(renameSignIn(s, "app:netflix", "household", "maya")).toEqual({ error: "another sign-in has that name" });
    expect(renameSignIn(s, "app:netflix", "nobody", "X")).toEqual({ error: "no such sign-in" });
  });

  it("taken off the list and brought back (2026-09-30, 'hide it as long as it's recoverable'): the login kept; never the one in use, nor the last; the same name added again is it", () => {
    let s = withProfile(emptySignIns(), "app:netflix", "netflix", "Netflix");
    const r = addSignIn(s, "app:netflix", "Maya", new Set());
    if ("error" in r) throw new Error(r.error);
    s = r.state;
    const inUse = new Set(["netflix"]);   // the household's profile is what Netflix is on
    expect(hideSignIn(s, "app:netflix", "household", inUse)).toEqual({ error: "Household is in use. Choose another sign-in for the service first" });
    const h = hideSignIn(s, "app:netflix", "maya", inUse);
    if ("error" in h) throw new Error(h.error);
    expect(signInById(h, "app:netflix", "maya")).toMatchObject({ hidden: true, profile: r.signIn.profile });   // kept, its profile untouched
    expect(hideSignIn(h, "app:netflix", "household", new Set())).toEqual({ error: "Household is the only sign-in left" });
    expect(hideSignIn(h, "app:netflix", "nobody", inUse)).toEqual({ error: "no such sign-in" });
    const p = parseSignIns(JSON.stringify(h));
    expect(signInById(p, "app:netflix", "maya")?.hidden).toBe(true);   // the record keeps it
    // added again by name: the hidden one comes back, no twin
    const again = addSignIn(h, "app:netflix", "maya", new Set());
    if ("error" in again) throw new Error(again.error);
    expect(again.made).toBe(false);
    expect(again.signIn.id).toBe("maya");
    expect(signInById(again.state, "app:netflix", "maya")?.hidden).toBeUndefined();
    // or shown again
    const back = showSignIn(h, "app:netflix", "maya");
    if ("error" in back) throw new Error(back.error);
    expect(signInById(back, "app:netflix", "maya")?.hidden).toBeUndefined();
    expect(showSignIn(h, "app:netflix", "nobody")).toEqual({ error: "no such sign-in" });
  });

  it("the kept record reads safely", () => {
    expect(parseSignIns(null)).toEqual(emptySignIns());
    expect(parseSignIns("{broken")).toEqual(emptySignIns());
    const kept = parseSignIns(JSON.stringify({ accounts: { "account:apple": [{ id: "a", name: "A", profile: "p" }, { id: "a", name: "dup", profile: "q" }, { id: "", name: "x", profile: "y" }, 7], bad: "x" }, accountOf: { appletv: "account:apple", n: 3 } }));
    expect(kept).toEqual({ accounts: { "account:apple": [{ id: "a", name: "A", profile: "p" }] }, accountOf: { appletv: "account:apple" } });
  });

  // one browser, many sign-ins (2026-10-03, "Why do we need so many profiles?"): the move of legacy profiles onto shared slots
  it("sharedPlan: every account's sign-ins take slots in order, the legacy profile remembered; shared ones stay; nothing when all are shared", () => {
    let s = withProfile(emptySignIns(), "account:apple", "apple-music", "Apple Music");
    s = withProfile(s, "account:apple", "appletv", "Apple TV");   // a wall from before accounts were shared: the household's login on two folders
    s = { ...s, accounts: { ...s.accounts, "account:apple": s.accounts["account:apple"]!.map((x, n) => (n === 0 ? { ...x, name: "Alex", by: "page" as const } : x)) } };   // the first labelled from its account page: still the household's
    s = withProfile(s, "app:netflix", "netflix", "Netflix");
    s = { ...s, accounts: { ...s.accounts, "account:apple": [...s.accounts["account:apple"]!, { id: "maya", name: "Maya", profile: "account-apple-maya", by: "person" }] } };
    const plan = sharedPlan(s);
    expect(plan.moves).toEqual([{ from: "apple-music", to: "shared" }, { from: "appletv", to: "shared" }, { from: "account-apple-maya", to: "shared-2" }, { from: "netflix", to: "shared" }]);
    expect(plan.state.accounts["account:apple"]!.map((x) => [x.profile, x.wasProfile, x.hidden ?? false])).toEqual([["shared", "apple-music", false], ["shared", "appletv", true], ["shared-2", "account-apple-maya", false]]);
    expect(plan.state.accounts["app:netflix"]![0]).toMatchObject({ profile: "shared", wasProfile: "netflix" });
    expect(sharedPlan(plan.state).moves).toEqual([]);
    expect(isSharedProfile("shared-3")).toBe(true);
    expect(isSharedProfile("netflix")).toBe(false);
    // the kept state parses with its memory of the old folder
    expect(parseSignIns(JSON.stringify(plan.state)).accounts["app:netflix"]![0]!.wasProfile).toBe("netflix");
  });
});
