// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { signInPage, signInPressJs } from "../src/adapters-facets.js";

const sized = () => { for (const e of Array.from(document.querySelectorAll("*")) as HTMLElement[]) { const none = e.hasAttribute("data-none"); Object.defineProperty(e, "offsetWidth", { configurable: true, get: () => (none ? 0 : 100) }); Object.defineProperty(e, "offsetHeight", { configurable: true, get: () => (none ? 0 : 40) }); } };
const run = (js: string): string => (0, eval)(js) as string;

describe("where Sign in goes (2026-09-29)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  it("a login address is a page to open only when it names one", () => {
    expect(signInPage("https://tubitv.com/login")).toBe("https://tubitv.com/login");
    expect(signInPage("https://www.primevideo.com/auth-redirect?signin=1")).toBe("https://www.primevideo.com/auth-redirect?signin=1");
    expect(signInPage("https://idmsa.apple.com/")).toBeNull();      // Apple's sign-in host: an error page when opened
    expect(signInPage("https://music.amazon.com/")).toBeNull();     // Amazon Music's own home
    expect(signInPage("http://example.com/login")).toBeNull();
    expect(signInPage(null)).toBeNull();
    expect(signInPage("https://music.amazon.com/", "https://music.amazon.com/forceSignIn?useHorizonte=true")).toBe("https://music.amazon.com/forceSignIn?useHorizonte=true");   // the adapter names the page
  });
  it("the press goes to the control that says sign in, never the one that says sign up", () => {
    document.body.innerHTML = `<a id="up" href="/signup">Sign up free</a><a id="in" href="/login">Log in</a>`;
    sized();
    const hits: string[] = [];
    for (const e of Array.from(document.querySelectorAll("a"))) e.addEventListener("click", (ev) => { ev.preventDefault(); hits.push(e.id); });
    expect(run(signInPressJs("a[href='/login'], a[href='/signup']"))).toBe("pressed");
    expect(hits).toEqual(["in"]);
  });
  it("a control with no words of its own is pressed (Apple TV's button by its test id); a hidden one is not; nothing there, nothing pressed", () => {
    document.body.innerHTML = `<button data-testid="sign-in-button" id="b"></button>`;
    sized();
    let n = 0; document.getElementById("b")!.addEventListener("click", () => { n++; });
    expect(run(signInPressJs("button[data-testid=sign-in-button]"))).toBe("pressed");
    expect(n).toBe(1);
    document.body.innerHTML = `<button data-testid="sign-in-button" data-none></button><a href="/register">Register</a>`;
    sized();
    expect(run(signInPressJs("button[data-testid=sign-in-button], a[href*='/register']"))).toBe("");
    expect(run(signInPressJs(null))).toBe("");
  });
  it("a selector cannot break out of the script", () => {
    expect(() => run(signInPressJs("a');alert(1);('"))).not.toThrow();
  });
});
