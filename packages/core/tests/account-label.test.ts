// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { accountLabel, accountReadJs } from "../src/adapters-facets.js";
import { addSignIn, emptySignIns, labelFromPage, renameSignIn, signInByProfile, wantsLabel, withProfile, NEW_SIGN_IN_NAME } from "../src/sign-ins.js";

const sized = () => { for (const e of Array.from(document.querySelectorAll("*")) as HTMLElement[]) { const none = e.hasAttribute("data-none"); Object.defineProperty(e, "offsetWidth", { configurable: true, get: () => (none ? 0 : 100) }); Object.defineProperty(e, "offsetHeight", { configurable: true, get: () => (none ? 0 : 40) }); } };
const run = (js: string): string => (0, eval)(js) as string;

describe("a sign-in named from what the account page shows (2026-09-29)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("reads the email the page shows, and only what it shows: not a form field, not a script, not hidden text", () => {
    document.body.innerHTML = `<main><div class="row"><span>Email</span><div class="email-text">pat.doe@example.org</div></div>
      <form><input type="email" value="typed@example.org"><label>other@example.org</label></form>
      <script>var u = {"email":"script@example.org"}</script><p data-none>hidden@example.org</p></main>`;
    sized();
    const got = JSON.parse(run(accountReadJs({}))) as { emails: string[] };
    expect(got.emails).toEqual(["pat.doe@example.org"]);
    expect(accountLabel(run(accountReadJs({})))).toEqual({ label: "pat.doe", from: "email" });
  });

  it("the wall shows the part before the @; the service's own addresses are nobody's", () => {
    const page = (emails: string[], host: string, name = "") => JSON.stringify({ emails, name, host });
    expect(accountLabel(page(["help@netflix.com", "pat@example.org"], "www.netflix.com"))).toEqual({ label: "pat", from: "email" });
    expect(accountLabel(page(["support@example.org", "privacy@mail.netflix.com"], "www.netflix.com"))).toBeNull();
    expect(accountLabel(page([], "tv.apple.com", "Pat Doe"))).toEqual({ label: "Pat Doe", from: "name" });
    expect(accountLabel(page([], "tv.apple.com", "My Account"))).toBeNull();
    expect(accountLabel(page([], "x.example", "pat@example.org"))).toBeNull();   // a name is a name
    expect(accountLabel("{broken")).toBeNull();
    expect(accountLabel(null)).toBeNull();
  });

  it("looks only in the part of the page the adapter names, and takes the name it points to", () => {
    document.body.innerHTML = `<footer>Questions? ask@partner.example</footer><section id="me"><b class="who">Pat Doe</b><i>pat@example.org</i></section>`;
    sized();
    expect(JSON.parse(run(accountReadJs({ within: "#me", name: ".who" })))).toMatchObject({ emails: ["pat@example.org"], name: "Pat Doe" });
    expect(() => run(accountReadJs({ within: "a');alert(1);('" }))).not.toThrow();
  });

  it("the label is taken by a sign-in nobody named; a person's name stands; two of an account are told apart", () => {
    let s = withProfile(emptySignIns(), "app:netflix", "netflix", "Netflix");
    expect(wantsLabel(signInByProfile(s, "app:netflix", "netflix")!, 1000)).toBe(true);
    s = labelFromPage(s, "app:netflix", "netflix", "pat", 1000);
    expect(signInByProfile(s, "app:netflix", "netflix")).toMatchObject({ id: "household", name: "pat", by: "page", readAt: 1000 });
    expect(wantsLabel(signInByProfile(s, "app:netflix", "netflix")!, 2000)).toBe(false);
    expect(wantsLabel(signInByProfile(s, "app:netflix", "netflix")!, 1000 + 8 * 24 * 3_600_000)).toBe(true);
    // added with no name: one to begin with, then the page's
    const added = addSignIn(s, "app:netflix", "", new Set(["netflix"]));
    if ("error" in added) throw new Error(added.error);
    expect(added.signIn).toMatchObject({ name: NEW_SIGN_IN_NAME });
    expect(added.signIn.by).toBeUndefined();
    s = labelFromPage(added.state, "app:netflix", added.signIn.profile, "pat", 3000);   // the same address again: kept apart
    expect(signInByProfile(s, "app:netflix", added.signIn.profile)!.name).toBe("pat 2");
    // a person's name is never changed by a read
    const named = renameSignIn(s, "app:netflix", "household", "Mum");
    if ("error" in named) throw new Error(named.error);
    const after = labelFromPage(named, "app:netflix", "netflix", "pat", 4000);
    expect(signInByProfile(after, "app:netflix", "netflix")).toMatchObject({ name: "Mum", by: "person", readAt: 4000 });
    expect(wantsLabel(signInByProfile(after, "app:netflix", "netflix")!, 9e15)).toBe(false);
    // a page that showed nothing: the name stays, the read is noted
    const none = labelFromPage(withProfile(emptySignIns(), "app:tubi", "tubi", "Tubi"), "app:tubi", "tubi", null, 5000);
    expect(signInByProfile(none, "app:tubi", "tubi")).toMatchObject({ name: "Household", readAt: 5000 });
  });
});
