import { describe, it, expect, vi, afterEach } from "vitest";
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

// The glowing ring around a hole (2026-10-25, "put a glowing box around the
// cutout"): on the cover, just outside the hole, never taking a click, and gone
// with the hole.
describe("hole ring", () => {
  it("rings each hole a little outside its edge, follows it, and clears", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    const cover = document.createElement("div"); document.body.appendChild(cover);
    PV.ringHoles(cover, [{ x: 100, y: 50, w: 120, h: 40, r: 20 }, { x: 10, y: 10, w: 20, h: 20, r: 0 }]);
    const rings = cover.querySelectorAll("[data-prism-veil]");
    expect(rings.length).toBe(2);
    expect(rings[0].style.left).toBe("97px"); expect(rings[0].style.top).toBe("47px");
    expect(rings[0].style.width).toBe("126px"); expect(rings[0].style.height).toBe("46px");
    expect(rings[0].style.borderRadius).toBe("23px"); expect(rings[1].style.borderRadius).toBe("4px");
    expect(rings[0].style.pointerEvents).toBe("none");
    PV.ringHoles(cover, [{ x: 200, y: 50, w: 120, h: 40, r: 20 }]);
    expect(cover.querySelectorAll("[data-prism-veil]").length).toBe(1);
    expect(cover.querySelector("[data-prism-veil]")).toBe(rings[0]);
    expect(rings[0].style.left).toBe("197px");
    PV.ringHoles(cover, []);
    expect(cover.querySelectorAll("[data-prism-veil]").length).toBe(0);
  });
});

// The 0.8.0 walk, YT-5 (2026-10-26, "it just has a resume or full screen
// button ... I didnt see watch anyway anywhere"): with the corner chip, the
// popover's button was built as "Resume" and never relabelled for an AI
// veil. Card and popover say the same thing in every mode.
describe("AI veil: the corner chip's popover says Watch anyway", () => {
  function veilFor(mode, cover) {
    const v = document.createElement("video"); document.body.appendChild(v);
    return { cover, video: v, box: v, mode, ai: { label: "Made with AI", source: "YouTube" }, pauseAfter: false, pauseAt: 0, reclaimAt: 0 };
  }
  it("AI mode labels both buttons Watch anyway", () => {
    const PV = loadVeil({ host: "www.youtube.com" }); PV.pickArt = () => "";
    PV.uiPrefs = { hud: "minimal", aiVeil: true };
    const cover = PV.__buildCover(true);
    PV.__paintCardFor(veilFor("ai", cover));
    expect(cover.__resume.textContent).toBe("▶ Watch anyway");
    expect(cover.__popResume.textContent).toBe("▶ Watch anyway");
    expect(cover.__popResume.style.display).toBe("inline-block");
    cover.remove();
  });
  it("a paused show says Resume on both", () => {
    const PV = loadVeil({ host: "www.youtube.com" }); PV.pickArt = () => "";
    PV.uiPrefs = { hud: "minimal" };
    const cover = PV.__buildCover(false);
    PV.__paintCardFor(veilFor("ai", cover));
    PV.__paintCardFor(veilFor("pause", cover));
    expect(cover.__resume.textContent).toBe("▶ Resume");
    expect(cover.__popResume.textContent).toBe("▶ Resume");
    cover.remove();
  });
});

// A short content clip is not an ad clip when YouTube's own clock says it is
// the content (report 2026-10-27: a trailer under 3 minutes, reached from the
// feed so the page's meta was stale, was veiled the moment its preroll ended).
describe("YouTube isAdClip", () => {
  function setup(label) {
    const PV = loadVeil({ host: "www.youtube.com" });
    try { window.happyDOM.setURL("https://www.youtube.com/watch?v=BeOSI5bGjIo"); } catch (e) {}
    document.head.innerHTML = `<meta itemprop="identifier" content="OLDVIDEO111"><meta itemprop="duration" content="PT8M10S">`;   // the previous video's
    document.body.innerHTML = `<div id="movie_player"><video></video><div class="ytp-time-display"><span class="ytp-time-current">0:03</span><span class="ytp-time-duration">${label}</span></div></div>`;
    const row = PV.SSAI_AD_SOURCES.find((r) => r.source === "YouTube player");
    return { row, v: document.querySelector("video") };
  }
  function withDuration(v, d) { Object.defineProperty(v, "duration", { value: d, configurable: true }); return v; }
  it("a 2:30 clip under a 2:30 clock is the content", () => {
    const { row, v } = setup("2:30");
    expect(row.isAdClip(withDuration(v, 150.2))).toBe(false);
  });
  it("a 0:15 clip under a 2:30 clock is an ad", () => {
    const { row, v } = setup("2:30");
    expect(row.isAdClip(withDuration(v, 15))).toBe(true);
  });
  it("an hour-long clock parses too", () => {
    const { row, v } = setup("1:02:30");
    expect(row.isAdClip(withDuration(v, 3750))).toBe(false);
  });
  it("no clock: an ad-length clip still counts (unchanged)", () => {
    const { row, v } = setup("");
    expect(row.isAdClip(withDuration(v, 150))).toBe(true);
  });
});

// The player left the view with its ad veil up (report 2026-10-29, YouTube, 0.7.192:
// "I had a video starting, but changed my mind and clicked youtube to go back
// to the main screen ... it kept the video veil up for about 15 seconds"): the
// watch page hides, its <video> collapses to 0x0 with the marker off, and the
// end-grace plus the pod-gap hold kept the cover over the home feed for 14 s.
describe("ad veil with the player gone", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("drops within a second once the main video is collapsed with no ad marker; the marker on keeps it", () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const PV = loadVeil({ host: "www.youtube.com" }); PV.pickArt = () => "";
    window.chrome.runtime.sendMessage = () => {};
    document.body.innerHTML = `<div id="movie_player" class="ad-showing" data-rect="0,0,1200,675"><div class="video-ads ytp-ad-module"><div class="ytp-ad-text">Ad</div></div><video data-rect="0,0,1200,675"></video></div>`;
    const player = document.getElementById("movie_player"), v = document.querySelector("video");
    expect(PV.videoAdBreak()).toBe(true);
    expect(PV.vidVeil() && PV.vidVeil().mode).toBe("ad");
    // a re-layout as the ad clip loads: the player collapses for a beat (its marker unreadable meanwhile) and comes back: the veil stays
    vi.advanceTimersByTime(2000);
    for (const el of [player, v]) el.setAttribute("data-rect", "0,0,0,0");
    expect(PV.videoAdBreak()).toBe(true);
    vi.advanceTimersByTime(300);
    for (const el of [player, v]) el.setAttribute("data-rect", "0,0,1200,675");
    expect(PV.videoAdBreak()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(PV.videoAdBreak()).toBe(true);
    // the person leaves for the home page: the watch page hides, the marker goes, the home feed is under the cover now
    player.classList.remove("ad-showing");
    document.querySelector(".ytp-ad-module").innerHTML = "";
    for (const el of [player, v]) el.setAttribute("data-rect", "0,0,0,0");
    PV.videoAdBreak();
    vi.advanceTimersByTime(300);
    expect(PV.videoAdBreak()).toBe(true);     // a beat: not yet
    vi.advanceTimersByTime(600);
    expect(PV.videoAdBreak()).toBe(false);    // 900 ms collapsed with no marker: down, not 14 s later
    expect(PV.vidVeil()).toBe(null);
  });
});
