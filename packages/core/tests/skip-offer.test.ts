// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { vi, afterEach } from "vitest";
import { SKIP_OFFER_JS, SKIP_PRESS_JS, SKIP_AD_OFFER_JS, SKIP_AD_PRESS_JS, SKIP_OFFER_MS, VideoController } from "../src/video.js";
import type { NowPlaying } from "../src/types.js";

/** jsdom lays nothing out: every element gets a size unless it says data-none. */
const sized = () => {
  for (const e of Array.from(document.querySelectorAll("*")) as HTMLElement[]) {
    const none = e.hasAttribute("data-none");
    Object.defineProperty(e, "offsetWidth", { configurable: true, get: () => (none ? 0 : 100) });
    Object.defineProperty(e, "offsetHeight", { configurable: true, get: () => (none ? 0 : 40) });
  }
};
const ask = (js: string): string => (0, eval)(js) as string;

describe("the page's skip offer (2026-09-29)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  it("named offers are read by name", () => {
    document.body.innerHTML = `<button data-uia="player-skip-intro">Skip Intro</button>`;
    sized();
    expect(ask(SKIP_OFFER_JS)).toBe("Skip Intro");
  });
  it("Paramount+'s bare Skip is an offer; switched off, it is not; seek buttons never are", () => {
    document.body.innerHTML = `<div class="skip-button-wrapper"><button class="skip-button" aria-label="Skip"><span>SKIP</span></button></div>
      <button aria-label="Skip back 10 seconds"></button><button aria-label="Skip forward 10 seconds"></button>`;
    sized();
    expect(ask(SKIP_OFFER_JS)).toBe("Skip");
    document.querySelector(".skip-button")!.className = "skip-button button_disabled";
    expect(ask(SKIP_OFFER_JS)).toBe("");
  });
  it("an ad's skip is never taken", () => {
    document.body.innerHTML = `<div class="ad-container"><button aria-label="Skip">Skip</button></div><button>Skip Ad</button><button class="ytp-ad-skip-button">Skip</button>`;
    sized();
    expect(ask(SKIP_OFFER_JS)).toBe("");
  });
  it("the press clicks the button the offer named", () => {
    document.body.innerHTML = `<button class="skip-button" aria-label="Skip">SKIP</button>`;
    sized();
    let clicks = 0;
    document.querySelector("button")!.addEventListener("click", () => { clicks++; });
    expect(ask(SKIP_OFFER_JS)).toBe("Skip");
    expect(clicks).toBe(0);
    expect(ask(SKIP_PRESS_JS)).toBe("Skip");
    expect(clicks).toBe(1);
  });
});

describe("an ad's own Skip, for every service (2026-09-29, section 26 pass-through)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  it("in a break the ad's Skip is the offer: Skip, Skip Ad, Skip Ads; a count-down or a button switched off is not", () => {
    for (const html of [`<div class="ad-container"><button aria-label="Skip">Skip</button></div>`, `<button class="ytp-skip-ad-button"><div>Skip</div></button>`, `<button>Skip Ad</button>`, `<button aria-label="Skip Ads"></button>`, `<div role="button" data-testid="skip-ad-button">Skip this ad</div>`]) {
      document.body.innerHTML = html; sized();
      expect(ask(SKIP_AD_OFFER_JS), html).toBe("Skip Ad");
    }
    for (const html of [`<button>Skip ad in 5</button>`, `<button disabled>Skip Ad</button>`, `<button class="skip button_disabled">Skip</button>`, `<button aria-label="Skip forward 10 seconds"></button>`, `<button>Learn more</button>`]) {
      document.body.innerHTML = html; sized();
      expect(ask(SKIP_AD_OFFER_JS), html).toBe("");
    }
  });
  it("looking never presses and never changes the ad's button; the press clicks it", () => {
    document.body.innerHTML = `<div class="ad-ui"><button id="s">Skip Ad</button></div>`; sized();
    let clicks = 0; const b = document.getElementById("s")!; b.addEventListener("click", () => { clicks++; });
    expect(ask(SKIP_AD_OFFER_JS)).toBe("Skip Ad");
    expect(clicks).toBe(0);
    expect(b.getAttribute("style")).toBeNull();
    expect(ask(SKIP_AD_PRESS_JS)).toBe("Skip Ad");
    expect(clicks).toBe(1);
  });
});

describe("core's skip state (video.ts)", () => {
  beforeEach(() => { vi.useFakeTimers({ now: 1_800_000_000_000 }); });
  afterEach(() => { vi.useRealTimers(); });
  const rig = (adapter: Record<string, unknown> = {}) => {
    let page = ""; const asked: string[] = []; const adSkip: boolean[] = [];
    const v = new VideoController({
      adapterOf: () => ({ match: ["www.hulu.com"], videoContext: "/*c*/", ...adapter }) as never, adapterIdOf: () => "hulu", tileExists: () => true,
      inject: async () => {}, navigate: async () => {}, dashId: () => "d", store: () => undefined,
      arm: () => {}, claimAudio: async () => {}, urlOf: () => "https://www.hulu.com/watch/1", onStage: () => false, enterStage: () => {},
      evaluate: async (_id, js) => { asked.push(js === SKIP_AD_OFFER_JS ? "ad" : js === SKIP_OFFER_JS ? "title" : "other"); return js === SKIP_AD_OFFER_JS || js === SKIP_OFFER_JS ? JSON.stringify(page) : JSON.stringify(""); },
      personActedSince: () => false, adSkip: (_id, on) => void adSkip.push(on),
    });
    const report = async (ad: boolean) => { v.onObservation("screen", { playing: true, title: "", artist: "", album: "", artwork: null, video: { kind: "episode", series: "Show", title: "E1", url: "https://www.hulu.com/watch/1", playing: true, position: 100, duration: 1300, ad } } as unknown as NowPlaying); await vi.advanceTimersByTimeAsync(SKIP_OFFER_MS + 50); };
    return { v, asked, adSkip, report, say: (x: string) => { page = x; } };
  };
  it("in a break the page is asked for the ad's Skip; the state names it and the break's cover is told; gone with the button", async () => {
    const r = rig();
    r.say("Skip Ad");
    await r.report(true);
    expect(r.asked.filter((a) => a !== "other").at(-1)).toBe("ad");
    expect(r.v.state(["screen"])[0]!.skip).toBe("Skip Ad");
    expect(r.adSkip).toEqual([true]);
    r.say("");
    await r.report(true);
    expect(r.v.state(["screen"])[0]!.skip ?? null).toBeNull();
    expect(r.adSkip).toEqual([true, false]);
    r.say("Skip Intro");
    await r.report(false);
    expect(r.asked.filter((a) => a !== "other").at(-1)).toBe("title");
    expect(r.v.state(["screen"])[0]!.skip).toBe("Skip Intro");
    expect(r.adSkip).toEqual([true, false]);   // a title's skip is not the break's
  });
  it("an adapter that declares its own skip control is left to report its ad's skip itself", async () => {
    const r = rig({ controls: { skip: ".ytp-skip-ad-button" } });
    r.say("Skip Ad");
    await r.report(true);
    expect(r.asked.filter((a) => a === "ad")).toEqual([]);
    expect(r.adSkip).toEqual([]);
  });
});
