import { describe, it, expect } from "vitest";
import { loadVeil } from "./harness.mjs";

// The intermission cover must construct in both HUD modes and with both
// "instant" flavours. 0.7.47 shipped a buildCover that threw on a removed
// checkbox, and no video veil mounted at all until a report came in.
describe("video veil cover", () => {
  it("builds (ad, instant) with the card, chip and After-the-break control", () => {
    const PV = loadVeil({ host: "www.youtube.com" }); PV.pickArt = () => "";   // main.js (art) is not part of the harness
    const cover = PV.__buildCover(true);
    expect(cover).toBeTruthy();
    expect(cover.__card).toBeTruthy();
    expect(cover.__chip).toBeTruthy();
    expect(cover.__afterCtl && cover.__afterCtl.__play && cover.__afterCtl.__pause).toBeTruthy();
    expect(cover.__popPause && cover.__popPause.__play).toBeTruthy();
    expect(cover.style.opacity).toBe("1");
    cover.remove();
  });
  it("builds (pause, fading)", () => {
    const PV = loadVeil(); PV.pickArt = () => "";
    const cover = PV.__buildCover(false);
    expect(cover.__resume).toBeTruthy();
    cover.remove();
  });
});

// The generic player row derives its container FROM the main video: nothing
// on the mainVideo -> rowContainer -> controlRoot path may call back into it
// (0.7.89 recursed at runtime on aether.ist: "Maximum call stack size exceeded").
describe("generic player row", () => {
  it("evaluates a page-sized unlisted player without recursing", () => {
    const PV = loadVeil({ host: "aether.ist" }); PV.pickArt = () => "";
    document.body.innerHTML = `<div class="h-screen"><video style="width:1881px;height:859px"></video></div>`;
    const v = document.querySelector("video");
    v.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1881, height: 859, right: 1881, bottom: 859 });
    expect(() => { PV.mainVideo(); PV.videoAdBreak(); PV.adInfoLine(); }).not.toThrow();
    expect(PV.mainVideo()).toBe(v);
    expect(PV.SSAI_AD_SOURCES[PV.SSAI_AD_SOURCES.length - 1].generic).toBe(true);
  });
});

// Player families (0.7.139): a framework's fingerprint on the page turns its
// row on for any host; the row's container is the player holding the main
// video; the family's own ad marker raises the break; the generic row stays
// out of a family-owned player; and the family name reaches reports.
describe("player families", () => {
  it("Video.js: vjs-ad-playing on the player root is the ad signal", () => {
    const PV = loadVeil({ host: "some-news-site.example" }); PV.pickArt = () => "";
    document.body.innerHTML = `<div class="video-js vjs-paused" style="width:900px;height:500px"><video style="width:900px;height:500px"></video></div>`;
    const root = document.querySelector(".video-js"), v = document.querySelector("video");
    for (const el of [root, v]) el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 500, right: 900, bottom: 500 });
    expect(PV.playerFamily()).toBe("Video.js");
    const row = PV.SSAI_AD_SOURCES.find((r) => r.family === "Video.js");
    expect(row && PV.__rowContainer(row)).toBe(root);
    expect(PV.__rowContainer(PV.SSAI_AD_SOURCES[PV.SSAI_AD_SOURCES.length - 1])).toBe(null);   // generic row backs off
    expect(PV.__adSourceNow()).toBe(null);
    root.classList.add("vjs-ad-playing");
    expect(PV.__adSourceNow()).toBe(row);
  });
  it("THEOplayer precedes Video.js (it is Video.js-skinned) and reads theo-ad-playing", () => {
    const PV = loadVeil({ host: "broadcaster.example" }); PV.pickArt = () => "";
    document.body.innerHTML = `<div class="theoplayer-container video-js theoplayer-skin theo-ad-playing"><video></video></div>`;
    const root = document.querySelector(".theoplayer-container"), v = document.querySelector("video");
    for (const el of [root, v]) el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 500, right: 900, bottom: 500 });
    expect(PV.playerFamily()).toBe("THEOplayer");
    expect(PV.__adSourceNow() && PV.__adSourceNow().family).toBe("THEOplayer");
  });
  it("no fingerprint: no family, generic row owns the player", () => {
    const PV = loadVeil({ host: "aether.ist" }); PV.pickArt = () => "";
    document.body.innerHTML = `<div><video style="width:1881px;height:859px"></video></div>`;
    document.querySelector("video").getBoundingClientRect = () => ({ left: 0, top: 0, width: 1881, height: 859, right: 1881, bottom: 859 });
    expect(PV.playerFamily()).toBe(null);
    expect(PV.__rowContainer(PV.SSAI_AD_SOURCES[PV.SSAI_AD_SOURCES.length - 1])).toBeTruthy();
  });
});

// The watch page's AI check must read THIS video's "How this was made"
// section: YouTube keeps the previous watch page's DOM through a navigation,
// and a document-wide query veiled an unlabelled video on arrival and cached
// it as AI for its tile (2026-09-12). YouTube's per-video verdict wins.
describe("watch page AI label is scoped to the current video", () => {
  function setup(url) {
    const PV = loadVeil({ host: "www.youtube.com" });
    try { window.happyDOM.setURL(url); } catch (e) {}
    PV.uiPrefs = { aiVeil: true };
    return PV;
  }
  const SECTION = `<how-this-was-made-section-view-model><span>Made with AI</span><span>Sounds or visuals were altered or fully generated</span></how-this-was-made-section-view-model>`;
  it("a stale section under the previous video's id is not this video's label", () => {
    const PV = setup("https://www.youtube.com/watch?v=5ll4kLpquOU");
    document.body.innerHTML = `<ytd-watch-flexy video-id="OLDVIDEO111">${SECTION}</ytd-watch-flexy>`;
    expect(PV.__aiLabeled()).toBe(null);
  });
  it("the current video's own section labels it", () => {
    const PV = setup("https://www.youtube.com/watch?v=5ll4kLpquOU");
    document.body.innerHTML = `<ytd-watch-flexy video-id="5ll4kLpquOU">${SECTION}</ytd-watch-flexy>`;
    const looked = []; PV.aiLookup = (id) => looked.push(id);
    expect(PV.__aiLabeled()).toEqual({ label: "Made with AI", source: "YouTube" });
    expect(looked).toEqual(["5ll4kLpquOU"]);
  });
  it("YouTube's per-video verdict overrides the DOM both ways", () => {
    const PV = setup("https://www.youtube.com/watch?v=5ll4kLpquOU");
    document.body.innerHTML = `<ytd-watch-flexy video-id="5ll4kLpquOU">${SECTION}</ytd-watch-flexy>`;
    PV.aiVerdict = () => 0;
    expect(PV.__aiLabeled()).toBe(null);
    document.body.innerHTML = `<ytd-watch-flexy video-id="5ll4kLpquOU"><div id="description"></div></ytd-watch-flexy>`;
    PV.aiVerdict = () => 1;
    expect(PV.__aiLabeled()).toEqual({ label: "Made with AI", source: "YouTube" });
  });
});

// Full card = centred card + the glyph alone top-left as an inert mark;
// corner chip = chip with label/clock that opens the popover, card hidden
// ("leave the symbol up there ... move everything else back to the center",
// 2026-09-12).
describe("video veil HUD layouts", () => {
  it("full card keeps the centred card and shows only the corner glyph, inert", () => {
    const PV = loadVeil({ host: "www.youtube.com" }); PV.pickArt = () => "";
    PV.uiPrefs = { hud: "interactive" };
    const cover = PV.__buildCover(true);
    expect(cover.__card.style.display).toBe("block");
    expect(cover.__chip.style.display).toBe("flex");
    expect(cover.__chip.style.pointerEvents).toBe("none");
    expect(cover.__chipLbl.style.display).toBe("none");
    expect(cover.__chipMoon.textContent).toBe("◐");
    // the card's own glyph + "Intermission" row is gone from the middle (2026-09-12)
    expect(cover.__moon.style.display).toBe("none");
    expect(cover.__title.style.display).toBe("none");
    expect(cover.__sub.textContent).toBe("Your show returns after the break");
    cover.remove();
  });
  it("corner chip hides the card and makes the chip live with its label", () => {
    const PV = loadVeil({ host: "www.youtube.com" }); PV.pickArt = () => "";
    PV.uiPrefs = { hud: "minimal" };
    const cover = PV.__buildCover(true);
    expect(cover.__card.style.display).toBe("none");
    expect(cover.__chip.style.display).toBe("flex");
    expect(cover.__chip.style.pointerEvents).toBe("auto");
    expect(cover.__chipLbl.style.display).toBe("");
    cover.remove();
  });
});

// "After the break" is a per-break choice: Pause chosen for one break must not
// carry into the next (it used to persist per site - Paramount+ paused every
// break after one press, 2026-09-12).
describe("after-the-break choice does not persist", () => {
  it("resets to Play when the veil comes down", () => {
    const PV = loadVeil({ host: "www.paramountplus.com" }); PV.pickArt = () => "";
    expect(PV.pauseAfterPref()).toBe(false);
    PV.__savePauseAfter(true);
    expect(PV.pauseAfterPref()).toBe(true);
    PV.uncoverVideo();
    expect(PV.pauseAfterPref()).toBe(false);
  });
});
