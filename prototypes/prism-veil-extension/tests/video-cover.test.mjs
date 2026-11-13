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

// B-408 (2026-10-26): a channel page's header plays a video with no watch URL and no "How this was made" section; its id comes from the
// header renderer's title link, and YouTube's per-video verdict (looked up as a tile's is) decides.
describe("a channel header's video is judged by its own video id", () => {
  const HEADER = `<ytd-channel-video-player-renderer><div id="player"><video></video></div><h3><a href="/watch?v=HeAdErViD01">Trailer</a></h3></ytd-channel-video-player-renderer>`;
  function setup() {
    const PV = loadVeil({ host: "www.youtube.com" });
    try { window.happyDOM.setURL("https://www.youtube.com/@somechannel"); } catch (e) {}
    PV.uiPrefs = { aiVeil: true };
    document.body.innerHTML = HEADER;
    return PV;
  }
  it("an unjudged header video is looked up and left alone until the verdict is in", () => {
    const PV = setup(); const looked = [];
    PV.aiVerdict = () => undefined; PV.aiLookup = (id) => looked.push(id);
    expect(PV.__aiLabeled(document.querySelector("video"))).toBe(null);
    expect(looked).toEqual(["HeAdErViD01"]);
  });
  it("a header video YouTube labels is covered; one it does not label is not", () => {
    const PV = setup();
    PV.aiVerdict = (id) => (id === "HeAdErViD01" ? 1 : undefined);
    expect(PV.__aiLabeled(document.querySelector("video"))).toEqual({ label: "Made with AI", source: "YouTube" });
    PV.aiVerdict = () => 0;
    expect(PV.__aiLabeled(document.querySelector("video"))).toBe(null);
  });
  it("a video outside the header on the same page is not judged by the header's id", () => {
    const PV = setup();
    document.body.insertAdjacentHTML("beforeend", `<div id="other"><video></video></div>`);
    PV.aiVerdict = () => 1;
    expect(PV.__aiLabeled(document.querySelector("#other video"))).toBe(null);
  });
});

// Full card = centred card + the glyph alone top-left as an inert mark;
// corner chip = chip with label/clock that opens the popover, card hidden
// (
// 2026-09-12).
describe("video veil HUD layouts", () => {
  it("full card keeps the centred card and shows only the corner glyph; the glyph takes the pointer for the peep, its click opens no popover", () => {
    const PV = loadVeil({ host: "www.youtube.com" }); PV.pickArt = () => "";
    PV.uiPrefs = { hud: "interactive" };
    const cover = PV.__buildCover(true);
    expect(cover.__card.style.display).toBe("block");
    expect(cover.__chip.style.display).toBe("flex");
    expect(cover.__chip.style.pointerEvents).toBe("auto");   // the peep (2026-11-07) opens from the glyph in both HUD modes
    cover.__chip.dispatchEvent(new window.Event("click", { bubbles: true }));
    expect(cover.__pop.style.display).toBe("none");
    expect(cover.__peep.style.display).toBe("none");   // the peep opens on rest, not on a click, and only with a veil up
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

// The glowing ring around a hole (2026-10-25): on the cover, just outside the hole, never taking a click, and gone
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

// The 0.8.0 walk, YT-5 (2026-10-26): with the corner chip, the
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

// The player left the view with its ad veil up (report 2026-10-29, YouTube, 0.7.192): the
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

// YouTube TV is covered only at the live edge (2026-11-06): the video's clock against the real clock, the smallest gap is live.
describe("YouTube TV: behind the live edge is not covered", () => {
  function setup() {
    const PV = loadVeil({ host: "tv.youtube.com" });
    let now = 1000000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const v = document.createElement("video");
    let ct = 46800;
    Object.defineProperty(v, "currentTime", { get: () => ct, configurable: true });
    Object.defineProperty(v, "readyState", { get: () => 4, configurable: true });
    Object.defineProperty(v, "duration", { get: () => 50390, configurable: true });
    return { PV, v, tick: (s, play = true) => { now += s * 1000; if (play) ct += s; }, seek: (d) => { ct += d; } };
  }
  afterEach(() => vi.restoreAllMocks());
  it("playing live stays live; scanning back 79 s is behind; forward to live is live again", () => {
    const { PV, v, tick, seek } = setup();
    expect(PV.ytvBehindLive(v)).toBe(false);
    tick(30); expect(PV.ytvBehindLive(v)).toBe(false);
    seek(-79); tick(1); expect(PV.ytvBehindLive(v)).toBe(true);
    seek(79); tick(1); expect(PV.ytvBehindLive(v)).toBe(false);
  });
  it("a long pause leaves the viewer behind live", () => {
    const { PV, v, tick } = setup();
    PV.ytvBehindLive(v);
    tick(60, false); expect(PV.ytvBehindLive(v)).toBe(true);
  });
  it("a recording (shorter than six hours) is never live", () => {
    const { PV, v } = setup();
    Object.defineProperty(v, "duration", { get: () => 1800, configurable: true });
    expect(PV.ytvBehindLive(v)).toBe(true);
  });
  it("off YouTube TV the rule does nothing", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    const v = document.createElement("video");
    Object.defineProperty(v, "duration", { get: () => 1800, configurable: true });
    expect(PV.ytvBehindLive(v)).toBe(false);
  });
});

// YouTube TV's own ad slot shows a "Sponsored" tray outside the player (2026-11-06; PRISM's adapter reads it too): shown, it is an ad slot.
describe("YouTube TV: the Sponsored tray is an ad mark", () => {
  afterEach(() => { vi.useRealTimers(); });
  it("a shown tray saying Sponsored puts the video veil up; hidden, it does not", () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const PV = loadVeil({ host: "tv.youtube.com" }); PV.pickArt = () => "";
    window.chrome.runtime.sendMessage = () => {};
    document.body.innerHTML = `<ytu-ads-title-tray hidden data-rect="0,0,180,134"><span>Sponsored</span></ytu-ads-title-tray>` +
      `<div id="movie_player" class="html5-video-player" data-rect="150,0,2251,1266"><div class="video-ads ytp-ad-module"></div><video data-rect="150,0,2251,1266"></video></div>`;
    expect(PV.videoAdBreak()).toBe(false);
    document.querySelector("ytu-ads-title-tray").removeAttribute("hidden");
    expect(PV.videoAdBreak()).toBe(true);
    expect(PV.vidVeil() && PV.vidVeil().mode).toBe("ad");
  });
  it("off YouTube TV the tray means nothing", () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const PV = loadVeil({ host: "www.youtube.com" }); PV.pickArt = () => "";
    window.chrome.runtime.sendMessage = () => {};
    document.body.innerHTML = `<ytu-ads-title-tray data-rect="0,0,180,134"><span>Sponsored</span></ytu-ads-title-tray>` +
      `<div id="movie_player" class="html5-video-player" data-rect="0,0,1200,675"><div class="video-ads ytp-ad-module"></div><video data-rect="0,0,1200,675"></video></div>`;
    expect(PV.videoAdBreak()).toBe(false);
  });
});

// A spotted break (2026-11-06): the break watch's word puts the same opaque veil up, its art still, with a card that names the source
// and a "Not a break" button; the service's own mark wins and makes it a marked veil.
describe("spotted video veil", () => {
  afterEach(() => { vi.useRealTimers(); });
  function setup() {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const PV = loadVeil({ host: "tv.youtube.com" }); PV.pickArt = () => "art/a.jpg"; PV.pickBundledArt = () => "chrome-extension://x/art/b.jpg";
    window.chrome.runtime.sendMessage = () => {};
    document.body.innerHTML = `<div id="movie_player" class="html5-video-player" data-rect="0,0,1600,900"><div class="video-ads ytp-ad-module"></div><video data-rect="0,0,1600,900"></video></div>`;
    let on = false, dismissed = 0;
    PV.spottedNow = () => on; PV.spottedDismiss = () => { dismissed++; on = false; };
    return { PV, v: document.querySelector("video"), set: (x) => { on = x; }, dismissed: () => dismissed };
  }
  it("goes up opaque and still, says who decided, and lifts on Not a break", () => {
    const { PV, v, set, dismissed } = setup();
    expect(PV.videoAdBreak()).toBe(false);
    set(true);
    expect(PV.videoAdBreak()).toBe(true);
    const vv = PV.vidVeil();
    expect(vv.source).toBe("spotted");
    expect(v.hasAttribute("data-prism-hidden")).toBe(true);
    expect(vv.cover.__art.style.opacity || "1").toBe("1");
    expect(vv.cover.__art.style.transform).toBe("none");
    expect(vv.cover.__sub.textContent).toBe("Looks like a commercial break");
    expect(vv.cover.__notBreak.style.display).toBe("inline-block");
    vv.cover.__notBreak.click();
    expect(dismissed()).toBe(1);
    expect(PV.vidVeil()).toBe(null);
  });
  it("the service's own mark takes the veil over as a marked one", () => {
    const { PV, v, set } = setup();
    set(true); PV.videoAdBreak();
    document.getElementById("movie_player").classList.add("ad-showing");
    PV.videoAdBreak();
    const vv = PV.vidVeil();
    expect(vv.source).toBe("marked");
    expect(v.hasAttribute("data-prism-hidden")).toBe(true);
    expect(vv.cover.__notBreak.style.display).toBe("none");
  });
});

// How an ad break looks (2026-11-06, the PRISM app's three looks): veil, mute only (the ad in view, its sound off, Unmute), show (nothing done).
describe("ad break looks", () => {
  afterEach(() => { vi.useRealTimers(); });
  function setup(look) {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const PV = loadVeil({ host: "www.youtube.com" }); PV.pickArt = () => "";
    window.chrome.runtime.sendMessage = () => {};
    PV.uiPrefs = Object.assign(PV.uiPrefs || {}, { breakLook: look });
    document.body.innerHTML = `<div id="movie_player" class="ad-showing" data-rect="0,0,1200,675"><div class="video-ads ytp-ad-module"><div class="ytp-ad-text">Ad</div></div><video data-rect="0,0,1200,675"></video></div>`;
    return { PV, v: document.querySelector("video") };
  }
  it("mute only: no picture over the ad, its video left showing, an Unmute that lifts it", () => {
    const { PV, v } = setup("mute");
    expect(PV.videoAdBreak()).toBe(true);
    const c = PV.vidVeil().cover;
    expect(c.__look).toBe("mute");
    expect(c.style.background).toBe("transparent");
    expect(c.__art.style.display).toBe("none");
    expect(c.__muteBox.style.display).toBe("flex");
    expect(v.hasAttribute("data-prism-hidden")).toBe(false);
    c.__muteBox.querySelector("button").click();
    expect(PV.vidVeil()).toBe(null);
  });
  it("show: the break goes by with nothing done", () => {
    const { PV } = setup("show");
    expect(PV.videoAdBreak()).toBe(false);
    expect(PV.vidVeil()).toBe(null);
  });
});
