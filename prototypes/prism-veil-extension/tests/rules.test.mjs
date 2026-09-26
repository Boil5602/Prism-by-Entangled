import { describe, it, expect } from "vitest";
import { loadVeil, detect } from "./harness.mjs";

// Rects are the measured sizes from the live sites (see the rule comments).
const R = (x, y, w, h) => `data-rect="${x},${y},${w},${h}"`;

describe("slot selectors (ad-tech markup)", () => {
  it("covers a Google ad slot and names the selector", () => {
    const PV = loadVeil();
    const out = detect(PV, `<ins class="adsbygoogle" id="s1" ${R(0, 0, 300, 250)}></ins>`);
    expect(out).toEqual([{ tag: "ins", id: "s1", why: "slot-selector: ins.adsbygoogle" }]);
  });
  it("ignores a slot with no rendered box", () => {
    const PV = loadVeil();
    expect(detect(PV, `<ins class="adsbygoogle"></ins>`)).toEqual([]);
  });
  it("FileZilla: covers the 738px leaderboard box, not the page-wide band", () => {
    const PV = loadVeil({ host: "filezilla-project.org" });
    const out = detect(PV, `<div class="TopAd" ${R(0, 0, 1690, 117)}><div id="lb" ${R(476, 0, 738, 117)}><a><img ${R(481, 5, 728, 90)}></a></div></div>`);
    expect(out.map((o) => o.id)).toEqual(["lb"]);
  });
});

describe("generic Ad / Sponsored labels", () => {
  // report 2026-09-24: Hulu's home hero tile promoting its own show carries "ADVERTISEMENT"
  const huluTile = (href) => `
      <div id="tile" data-testid="high-emphasis-tile" ${R(0, 0, 400, 390)}>
        <div data-testid="high-emphasis-tile-prompt" ${R(0, 0, 391, 20)}><span data-testid="high-emphasis-tile-prompt-text" ${R(0, 0, 120, 18)}>ADVERTISEMENT</span></div>
        <div ${R(0, 20, 391, 155)}><img ${R(0, 20, 391, 155)}></div>
        <a data-testid="playback-action" ${href ? `href="${href}"` : ""} ${R(0, 300, 120, 40)}>Play</a>
      </div>`;
  it("Hulu: its own title's hero tile labelled ADVERTISEMENT is house promotion, not covered", () => {
    const PV = loadVeil({ host: "www.hulu.com" });
    expect(detect(PV, huluTile("/watch/c34c6047"))).toEqual([]);
    expect(detect(PV, huluTile("https://www.hulu.com/series/abc"))).toEqual([]);
    expect(detect(PV, huluTile(null))).toEqual([]);
  });
  it("Hulu: a hero tile whose action leaves Hulu is still an ad", () => {
    const PV = loadVeil({ host: "www.hulu.com" });
    expect(detect(PV, huluTile("https://www.example-sponsor.com/offer")).length).toBe(1);
  });
  it("grows a Sponsored label to its card (CBS News MoneyWatch grid)", () => {
    const PV = loadVeil({ host: "www.cbsnews.com" });
    const out = detect(PV, `
      <section ${R(0, 0, 1320, 653)}>
        <div ${R(0, 0, 1320, 497)}>
          <article id="a1" class="item" ${R(0, 0, 413, 497)}><a ${R(0, 0, 413, 422)}><div ${R(0, 0, 413, 190)}><span ${R(0, 0, 104, 23)}>Sponsored</span></div></a></article>
          <article id="a2" class="item" ${R(453, 0, 413, 497)}><a ${R(453, 0, 413, 422)}>Real story</a></article>
        </div>
      </section>`);
    expect(out).toEqual([{ tag: "article", id: "a1", why: "badge-label: Sponsored" }]);
  });
  it("does NOT trust a bare 'Ad' without an ad-labelish class (MSN tile subtitles)", () => {
    const PV = loadVeil();
    const out = detect(PV, `<div id="tile" ${R(0, 0, 300, 200)}><span ${R(0, 0, 20, 14)}>Ad</span></div>`);
    expect(out).toEqual([]);
  });
  it("trusts a bare 'Ad' inside an ad-slug element", () => {
    const PV = loadVeil();
    const out = detect(PV, `<div id="unit" ${R(0, 0, 300, 250)}><span class="ad-slug" ${R(0, 0, 20, 14)}>Ad</span></div>`);
    expect(out.map((o) => o.id)).toEqual(["unit"]);
  });
  it("covers a whole 'Paid Partner Content' section and drops the slot nested in it", () => {
    const PV = loadVeil();
    const out = detect(PV, `
      <section id="ppc" ${R(0, 0, 1000, 1500)}>
        <h3 ${R(0, 0, 300, 30)}>Paid Partner Content</h3>
        <div class="dianomi_context" id="inner" ${R(0, 40, 1000, 1400)}></div>
      </section>`);
    expect(out).toEqual([{ tag: "section", id: "ppc", why: "section-label: Paid Partner Content" }]);
  });
});

describe("Reddit", () => {
  it("covers shreddit-ad-post and leaves organic posts alone", () => {
    const PV = loadVeil({ host: "www.reddit.com" });
    const out = detect(PV, `
      <shreddit-post id="p1" ${R(540, 0, 732, 400)}>organic</shreddit-post>
      <shreddit-ad-post id="ad1" promoted class="promotedlink" ${R(540, 420, 732, 725)}><video></video></shreddit-ad-post>
      <shreddit-sidebar-ad id="side" ${R(1300, 0, 300, 250)}></shreddit-sidebar-ad>`);
    expect(out.map((o) => o.id).sort()).toEqual(["ad1", "side"]);
    expect(out.find((o) => o.id === "ad1").why).toBe("reddit:shreddit-ad-post");
  });
});

describe("page-sized slot wrappers", () => {
  it("does not cover an ad-banner wrapper that spans the viewport (MSN load flash)", () => {
    const PV = loadVeil();
    const out = detect(PV, `<div class="ad-banner-wrapper" id="wrap" ${R(0, 0, 1897, 917)}></div><div class="ad-banner" id="real" ${R(0, 100, 970, 250)}></div>`);
    expect(out.map((o) => o.id)).toEqual(["real"]);
    // and a wrapper is not a slot even at banner size (it is the wrapper that balloons later)
    const out2 = detect(PV, `<div class="ad-banner-wrapper" role="banner" id="wrap2" ${R(0, 0, 1548, 270)}></div><div class="ad-banner" id="real2" ${R(0, 400, 970, 250)}></div>`);
    expect(out2.map((o) => o.id)).toEqual(["real2"]);
  });
});

describe("CNN fave player", () => {
  it("covers an in-feed player in the fave-ad-playing state with its Ad badge off screen", () => {
    const PV = loadVeil({ host: "www.cnn.com" });
    // badge sits far below the viewport (scrolled half off): the class must carry the signal
    const out = detect(PV, `<div class="fave-player-container fave-bolt-player fave-ad-playing" id="pl" ${R(100, -100, 324, 182)}><video></video><span ${R(110, 2000, 20, 14)}>Ad</span></div>`);
    expect(out.map((o) => o.id)).toEqual(["pl"]);
  });
});

describe("substring ad selectors", () => {
  it("does not treat Hulu's Masthead__container as an ad__container (ad must start a word)", () => {
    const PV = loadVeil({ host: "www.hulu.com" });
    const out = detect(PV, `<div class="Masthead__container" id="hero" ${R(0, 0, 1536, 322)}><img></div>
      <div class="top ad__container" id="real" ${R(0, 400, 728, 90)}></div>
      <div class="Download-ad-unit thread" id="dl" ${R(0, 600, 300, 250)}></div>`);
    expect(out.map((o) => o.id).sort()).toEqual(["dl", "real"]);
  });
});

describe("Facebook", () => {
  const post = (id, inner, rect = R(0, 0, 680, 740)) =>
    `<div aria-posinset="1" id="${id}" ${rect}><div data-virtualized="false">${inner}</div></div>`;
  // data-ad-* attributes sit on EVERY post (0.6.18): only the header's own
  // "Sponsored" / "Ad" label is a signal. The header is the name heading's
  // row; the body carries the data-ad-* markers like any organic post.
  const hdr = (label) => `<div ${R(0, 0, 680, 60)}><h3 ${R(0, 0, 200, 20)}><strong>Some Page</strong></h3><div ${R(0, 30, 200, 20)}><span>${label}</span><span> · 13h</span></div></div>`;
  it("covers a post whose header says Sponsored (data-ad-* markers are on every post)", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    const out = detect(PV, post("ad", hdr("Sponsored") + `<div data-ad-rendering-role="story_message" ${R(0, 60, 680, 600)}></div><div data-ad-preview="message"></div>`));
    expect(out.map((o) => o.id)).toEqual(["ad"]);
    expect(out[0].why).toMatch(/^facebook-sponsored: /);
  });
  it("covers a post whose Ad label is hyphen-and-joiner scrambled (Verizon, 2026-08-29)", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    const lbl = "⁠-͏-͏-͏A͏-͏d͏-͏";
    const out = detect(PV, post("ad", `<div ${R(0, 0, 680, 60)}><h4 ${R(0, 0, 200, 20)}><strong>Verizon</strong></h4><div ${R(0, 30, 200, 20)}><a href="?__cft__[0]=x" ${R(60, 32, 17, 17)}><span><span>${lbl}</span></span></a></div></div><div ${R(0, 60, 680, 600)}><video></video></div>`));
    expect(out.map((o) => o.id)).toEqual(["ad"]);
  });
  it("data-ad-* markers alone never count", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    expect(detect(PV, post("org", hdr("13h") + `<div data-ad-rendering-role="story_message" ${R(0, 60, 680, 600)}></div><div data-ad-preview="message"></div>`))).toEqual([]);
  });
  it("never covers an organic post", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    expect(detect(PV, post("org", `<div>Hello from a friend</div><video></video>`))).toEqual([]);
  });
  it("never grows to a feed-level data-virtualized container", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    const out = detect(PV, `<div data-virtualized="true" id="feed" ${R(0, 0, 680, 14000)}><div data-ad-rendering-role="image"></div></div>`);
    expect(out).toEqual([]);
  });
  it("is host-gated: the same markup elsewhere is ignored", () => {
    const PV = loadVeil({ host: "example.org" });
    expect(detect(PV, post("ad", `<div data-ad-rendering-role="story_message"></div>`))).toEqual([]);
  });
});

describe("YouTube ad renderers", () => {
  it("covers a masthead ad unit (innermost renderer) and leaves a video renderer alone", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    const out = detect(PV, `<ytd-page-top-ad-layout-renderer id="top" ${R(0, 0, 1280, 243)}><ytd-video-masthead-ad-v3-renderer id="mast" ${R(0, 0, 1280, 243)}><div ${R(0, 0, 424, 243)}><video></video></div></ytd-video-masthead-ad-v3-renderer></ytd-page-top-ad-layout-renderer>
      <ytd-video-renderer id="vid" ${R(0, 300, 855, 235)}><video></video></ytd-video-renderer>`);
    expect(out.map((o) => o.id)).toEqual(["mast"]);
  });
  it("on Shorts, a pane-spanning ad layout renderer yields to the reel rule (one cover, not two)", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    const out = detect(PV, `<ytd-in-feed-ad-layout-renderer id="lay" ${R(0, 0, 1584, 851)}><ytd-ad-slot-renderer ${R(0, 0, 1584, 851)}><ytd-reel-video-renderer is-ads-overlay id="reel" ${R(793, 0, 479, 851)}><div id="short-video-container" ${R(793, 0, 479, 851)}><video></video></div></ytd-reel-video-renderer></ytd-ad-slot-renderer></ytd-in-feed-ad-layout-renderer>`);
    expect(out.map((o) => o.id)).toEqual(["short-video-container"]);
  });
  it("covers the sized lockup inside a box-less in-feed ad layout renderer", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    const out = detect(PV, `<ytd-in-feed-ad-layout-renderer id="lay" ${R(264, 136, 0, 358)}><yt-lockup-view-model id="lock" ${R(264, 136, 533, 358)}><img></yt-lockup-view-model></ytd-in-feed-ad-layout-renderer>`);
    expect(out.map((o) => o.id)).toEqual(["lock"]);
  });
});

describe("YouTube Shorts", () => {
  it("covers the ad reel's own video container, not the shared player", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    const out = detect(PV, `
      <ytd-reel-video-renderer id="r1" ${R(0, 64, 1560, 763)}><div id="short-video-container" ${R(668, 64, 429, 763)}></div></ytd-reel-video-renderer>
      <ytd-reel-video-renderer id="r2" is-ads-overlay ${R(0, 843, 1560, 763)}><div id="short-video-container" ${R(668, 843, 429, 763)}><ytd-ad-slot-renderer></ytd-ad-slot-renderer></div></ytd-reel-video-renderer>`);
    expect(out.length).toBe(1);
    expect(out[0].why).toBe("youtube-shorts-ad-reel");
  });
});

describe("Instagram", () => {
  it("feed: an 'Ad' header label grows to the post's media box", () => {
    const PV = loadVeil({ host: "www.instagram.com" });
    const out = detect(PV, `
      <article id="post" ${R(705, 0, 470, 692)}>
        <div ${R(705, 0, 470, 60)}><span ${R(760, 18, 14, 16)}>Ad</span></div>
        <div ${R(705, 60, 470, 470)}><img ${R(705, 60, 470, 470)}></div>
      </article>`);
    expect(out).toEqual([{ tag: "article", id: "post", why: "instagram-label: Ad" }]);
  });
  it("reels: covers the reel box even before its video mounts (avatar img must not count)", () => {
    const PV = loadVeil({ host: "www.instagram.com" });
    const out = detect(PV, `
      <div id="reel" ${R(707, 0, 465, 827)}>
        <div ${R(373, 0, 321, 827)}><img ${R(380, 700, 32, 32)}><div ${R(380, 740, 273, 24)}><span ${R(402, 744, 14, 16)}>Ad</span></div></div>
      </div>`);
    expect(out.map((o) => o.id)).toEqual(["reel"]);
  });
});

describe("MSN", () => {
  it("stripe tile with an 'Ad' subtitle is covered; a tile without one is not", () => {
    const PV = loadVeil({ host: "www.msn.com" });
    const out = detect(PV, `
      <a class="me-stripe-tile-button" id="t1" ${R(0, 0, 120, 100)}><div class="me-stripe-title-subtitle" ${R(0, 80, 60, 14)}>Ad</div></a>
      <a class="me-stripe-tile-button" id="t2" ${R(130, 0, 120, 100)}><div class="me-stripe-title-subtitle" ${R(130, 80, 60, 14)}>Adventure</div></a>
      <a class="me-stripe-tile-button" id="t3" ${R(260, 0, 120, 100)}></a>`);
    expect(out.map((o) => o.id)).toEqual(["t1"]);
  });
});

describe("dedupe", () => {
  it("innermost wins for nested plain slots", () => {
    const PV = loadVeil();
    const out = detect(PV, `<div class="ad-container" id="outer" ${R(0, 0, 400, 400)}><ins class="adsbygoogle" id="inner" ${R(50, 50, 300, 250)}></ins></div>`);
    expect(out.map((o) => o.id)).toEqual(["inner"]);
  });
  it("a whole-cover (Facebook post) wins over a slot nested in it", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    const out = detect(PV, `<div aria-posinset="3" id="post" ${R(0, 0, 680, 740)}><div ${R(0, 0, 680, 60)}><h3 ${R(0, 0, 200, 20)}><strong>Some Page</strong></h3><div ${R(0, 30, 200, 20)}><span>Sponsored</span></div></div><div data-ad-preview="message" ${R(0, 60, 680, 600)}></div><ins class="adsbygoogle" id="slot" ${R(0, 100, 300, 250)}></ins></div>`);
    expect(out.map((o) => o.id)).toEqual(["post"]);
  });
});

// Ad stacks (0.7.140): publisher ad-management wrappers' slots are covered
// by the vendor's marker and named after the stack; an EMPTY placeholder
// (the wrapper's slot before it is filled) is left alone.
describe("ad stacks (publisher wrappers)", () => {
  it("covers a filled Mediavine slot and names the stack", () => {
    const PV = loadVeil({ host: "recipes.example" });
    const out = detect(PV, `<div class="mv-ad-box" id="mv1" ${R(0, 0, 300, 250)}><iframe ${R(0, 0, 300, 250)}></iframe></div>`);
    expect(out).toEqual([{ tag: "div", id: "mv1", why: "ad-stack: Mediavine" }]);
    expect(PV.adStackHere()).toBe("Mediavine");
  });
  it("leaves an empty Raptive placeholder alone", () => {
    const PV = loadVeil({ host: "blog.example" });
    expect(detect(PV, `<div class="adthrive-ad" id="a1" ${R(0, 0, 300, 250)}></div>`)).toEqual([]);
  });
  it("Ezoic placeholder with a rendered creative", () => {
    const PV = loadVeil({ host: "howto.example" });
    const out = detect(PV, `<div id="ezoic-pub-ad-placeholder-101" ${R(0, 0, 728, 90)}><div ${R(0, 0, 728, 90)}><iframe ${R(0, 0, 728, 90)}></iframe></div></div>`);
    expect(out.map((o) => o.why)).toEqual(["ad-stack: Ezoic"]);
  });
});


// Fox News home (three reports 2026-09-11): Jetpack's masthead is a body-level
// #jpmasthead drawn OUTSIDE the GAM out-of-page slot that loads it; that slot's
// container is a 1897x212 spacer overflowing a 0px-tall `.gam-inst` slot. The
// cover belongs on the masthead (expanded, and collapsed to its fixed strip),
// never on the spacer - which put art over page content once the ad was closed.
describe("GAM out-of-page slots / Jetpack masthead", () => {
  const FOX_SLOT = `<div id="desktop_desk-peak-interstitial-1x1" class="ad gam-inst" ${R(0, 0, 1897, 0)}><div id="google_ads_iframe_/4145/fnc/desk/hp/oop_0__container__" ${R(0, 0, 1897, 212)}><iframe id="google_ads_iframe_/4145/fnc/desk/hp/oop_0" aria-label="Advertisement" ${R(0, 0, 1897, 212)}></iframe></div></div>`;
  it("never covers the out-of-page spacer container or its iframe", () => {
    const PV = loadVeil({ host: "www.foxnews.com" });
    expect(detect(PV, FOX_SLOT)).toEqual([]);
  });
  it("covers the Jetpack masthead whole (expanded) by its ads.jetpackdigital.com media", () => {
    const PV = loadVeil({ host: "www.foxnews.com" });
    const out = detect(PV, FOX_SLOT + `<div id="jpmasthead" ${R(0, 0, 1897, 478)}><div class="jpstage bp-default background1" ${R(0, 0, 1912, 478)}><div class="Image_ImageModule_6_841367588_default bg jp_default jp_all jp_normal" ${R(0, 0, 1912, 478)}><img src="https://ads.jetpackdigital.com/creative/bg.jpg" ${R(0, 0, 1912, 478)}></div><div class="Button_ButtonModule_20_456526775_default clicklayer jp_default jp_all jp_normal" ${R(0, 0, 1912, 478)}></div></div></div>`);
    expect(out).toEqual([{ tag: "div", id: "jpmasthead", why: "jetpack-masthead" }]);
    expect(document.getElementById("jpmasthead").__prismForceOverlay).toBe(true);
  });
  it("covers the collapsed fixed strip too (jpfixed, 212px)", () => {
    const PV = loadVeil({ host: "www.foxnews.com" });
    const out = detect(PV, `<div id="jpmasthead" class="jpfixed" ${R(0, 0, 1897, 212)}><div class="jpstage background2 bp-default" ${R(0, 0, 1912, 212)}><img src="https://ads.jetpackdigital.com/creative/collapsed.jpg" ${R(0, 0, 1912, 212)}></div></div>`);
    expect(out.map((o) => o.id)).toEqual(["jpmasthead"]);
  });
  it("a masthead whose media is first-party is not Jetpack's", () => {
    const PV = loadVeil({ host: "www.foxnews.com" });
    expect(detect(PV, `<div id="jpmasthead" ${R(0, 0, 1897, 212)}><img src="https://static.foxnews.com/logo.png" ${R(0, 0, 200, 60)}></div>`)).toEqual([]);
  });
  it("an ordinary GAM slot (sized, in-page) is still covered", () => {
    const PV = loadVeil();
    const out = detect(PV, `<div id="div-gpt-ad-123" ${R(0, 0, 300, 250)}><div id="google_ads_iframe_/123/box_0__container__" ${R(0, 0, 300, 250)}><iframe id="google_ads_iframe_/123/box_0" ${R(0, 0, 300, 250)}></iframe></div></div>`);
    expect(out.map((o) => o.id)).toEqual(["google_ads_iframe_/123/box_0"]);
  });
  it("a GAM container overflowing a collapsed (0px) slot is a spacer even without 'oop' in its path", () => {
    const PV = loadVeil();
    expect(detect(PV, `<div id="div-gpt-ad-anchor" ${R(0, 0, 1897, 0)}><div id="google_ads_iframe_/123/top_0__container__" ${R(0, 0, 1897, 212)}><iframe id="google_ads_iframe_/123/top_0" ${R(0, 0, 1897, 212)}></iframe></div></div>`)).toEqual([]);
  });
});

// The ad's own X stays reachable through a display cover (0.7.150): a hole is
// cut only over a control that plainly says close, is small, and that a
// hit-test actually reaches once Prism's own layers are skipped.
describe("close control through the cover", () => {
  function loadCovers(PV) {
    const { readFileSync } = require("node:fs");
    const { join, dirname } = require("node:path");
    const { fileURLToPath } = require("node:url");
    (0, eval)(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    return PV;
  }
  function mount(html) { document.body.innerHTML = html; return document.getElementById("unit"); }
  it("finds a small aria-labelled close button the hit-test reaches", () => {
    const PV = loadCovers(loadVeil());
    const unit = mount(`<div id="unit" ${R(0, 0, 300, 250)}><a ${R(0, 0, 300, 250)}></a><button id="x" aria-label="Close ad" ${R(270, 6, 24, 24)}></button></div>`);
    const x = document.getElementById("x");
    document.elementsFromPoint = () => [x];
    expect(PV.closeControl(unit)).toBe(x);
  });
  it("accepts a worded 'Collapse' button up to 160px wide, not other words (IMDb, 2026-09-23)", () => {
    const PV = loadCovers(loadVeil());
    const unit = mount(`<div id="unit" ${R(0, 0, 970, 250)}><button id="c" ${R(850, 8, 110, 28)}>Collapse</button><button id="m" ${R(10, 8, 110, 28)}>Learn more</button></div>`);
    const c = document.getElementById("c"), m = document.getElementById("m");
    document.elementsFromPoint = (x) => [x > 500 ? c : m];
    expect(PV.closeControls(unit)).toEqual([c]);
  });
  it("accepts a lone x glyph, refuses a control a click-layer sits over, refuses a big 'close' box", () => {
    const PV = loadCovers(loadVeil());
    const unit = mount(`<div id="unit" ${R(0, 0, 300, 250)}><div id="layer" class="clicklayer" ${R(0, 0, 300, 250)}></div><span id="g" ${R(270, 6, 20, 20)}>×</span><div id="big" class="close-panel" ${R(0, 0, 300, 120)}></div></div>`);
    const g = document.getElementById("g"), layer = document.getElementById("layer");
    document.elementsFromPoint = () => [g];
    expect(PV.closeControl(unit)).toBe(g);
    document.elementsFromPoint = () => [layer, g];
    expect(PV.closeControl(unit)).toBe(null);
  });
  it("Jetpack: every small ButtonModule is a hole (collapse + close), the full-size click-layer is not", () => {
    const PV = loadCovers(loadVeil({ host: "www.foxnews.com" }));
    const unit = mount(`<div id="unit" ${R(0, 0, 1897, 478)}><div class="jpstage bp-default" ${R(0, 0, 1912, 478)}><div id="layer" class="Button_ButtonModule_20_1_default clicklayer jp_default jp_all jp_normal" ${R(0, 0, 1912, 478)}></div><div id="col" class="Button_ButtonModule_31_2_default jp_default jp_all jp_normal" ${R(1840, 8, 30, 30)}></div><div id="cls" class="Button_ButtonModule_32_3_default jp_default jp_all jp_normal" ${R(1876, 8, 30, 30)}></div><div id="img" class="Image_ImageModule_6_4_default bg jp_default" ${R(0, 0, 1912, 478)}></div></div></div>`);
    const col = document.getElementById("col"), cls = document.getElementById("cls");
    document.elementsFromPoint = (x) => [x < 1870 ? col : cls];
    expect(PV.closeControls(unit)).toEqual([col, cls]);
  });
  it("a nameless pointer control at a top corner is NOT a hole (YouTube's hover buttons, 2026-09-12)", () => {
    const PV = loadCovers(loadVeil());
    const unit = mount(`<div id="unit" ${R(0, 0, 728, 90)}><button id="c" aria-label="Watch later" style="cursor:pointer" ${R(700, 4, 22, 22)}></button><div id="m" style="cursor:pointer" ${R(350, 30, 22, 22)}></div></div>`);
    const c = document.getElementById("c"), m = document.getElementById("m");
    document.elementsFromPoint = (x) => [x > 600 ? c : m];
    expect(PV.closeControls(unit)).toEqual([]);
  });
  it("composes the sticky-bar inset and the holes into one clip-path", () => {
    const PV = loadCovers(loadVeil());
    const c = document.createElement("div");
    c.__under = 40; c.__holeBoxes = [{ x0: 270, y0: 50, x1: 296, y1: 76 }];
    PV.paintClip(c);
    expect(c.style.clipPath).toBe("polygon(0 40px, 270px 40px, 270px 76px, 296px 76px, 296px 50px, 270px 50px, 270px 40px, 100% 40px, 100% 100%, 0 100%)");
    c.__holeBoxes = [{ x0: 270, y0: 50, x1: 296, y1: 76 }, { x0: 10, y0: 30, x1: 40, y1: 60 }];   // two holes, the second half under the bar and left of the first
    PV.paintClip(c);
    expect(c.style.clipPath).toBe("polygon(0 40px, 10px 40px, 10px 60px, 40px 60px, 40px 40px, 10px 40px, 10px 40px, 270px 40px, 270px 76px, 296px 76px, 296px 50px, 270px 50px, 270px 40px, 100% 40px, 100% 100%, 0 100%)");
    c.__holeBoxes = [{ x0: 270, y0: 10, x1: 296, y1: 36 }];   // a hole hidden under the bar: inset only
    PV.paintClip(c);
    expect(c.style.clipPath).toBe("inset(40.0px 0 0 0)");
    c.__under = 0; c.__holeBoxes = [];
    PV.paintClip(c);
    expect(c.style.clipPath).toBe("");
  });
});

// CNN's Wunderkind (bx-*) header ad holding a Celtra banner, 1897x475 on a
// ~900px-tall window (report 2026-09-12): a full-width banner is wide, not
// page-sized - the old "area >= half the viewport" guard threw it out.
describe("page-sized guard is about height, not area", () => {
  const CNN = `<div class="ad-slot-header" ${R(0, 40, 1897, 508)}><div id="bx-campaign-1" class="bxc bx-base bx-custom bx-campaign-1 bx-has-close-x-" ${R(0, 40, 1897, 508)}><div class="bx-align" ${R(0, 40, 1897, 508)}><a id="x" class="bx-close bx-close-link bx-close-inside" data-click="close" ${R(1860, 48, 28, 28)}></a><div id="bx-creative-1" class="bx-creative bx-creative-1" ${R(0, 40, 1897, 508)}><div class="celtra-ad-inline-host" ${R(0, 73, 1897, 475)}><div id="banner" class="notranslate celtra-banner" ${R(0, 73, 1897, 475)}><iframe ${R(0, 73, 1897, 475)}></iframe></div></div></div></div></div>`;
  it("covers the 1897x475 Celtra banner on a 1897x900 viewport", () => {
    const PV = loadVeil({ host: "www.cnn.com", width: 1897, height: 900 });
    const out = detect(PV, CNN);
    expect(out.map((o) => o.id)).toEqual(["banner"]);
  });
  it("still refuses a wrapper that spans the viewport", () => {
    const PV = loadVeil({ width: 1897, height: 900 });
    expect(detect(PV, `<div class="ad-banner-wrapper" ${R(0, 0, 1897, 900)}></div>`)).toEqual([]);
    expect(PV.pageSized({ width: 1897, height: 475 })).toBe(false);
    expect(PV.pageSized({ width: 1897, height: 700 })).toBe(true);
  });
  it("the X in the same-size wrapper above the covered banner is a hole", () => {
    const PV = loadVeil({ host: "www.cnn.com", width: 1897, height: 900 });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    document.body.innerHTML = CNN;
    const x = document.getElementById("x");
    document.elementsFromPoint = () => [x];
    expect(PV.closeControls(document.getElementById("banner"))).toEqual([x]);
  });
});

// Fox's collapsed Jetpack strip, as reported 2026-09-12 with the pick ON the
// close button: a 42x42 `*_ButtonModule_*` whose class is "closeleavebehind",
// top of the stack over the full-width "clickcollapsed" click-layer.
describe("Fox collapsed strip: the X is a hole", () => {
  const STRIP = `<div id="jpmasthead" class="jpfixed" ${R(0, 0, 1897, 212)}><div class="jpstage background2 bp-default" ${R(0, 0, 1912, 212)}><div class="Image_ImageModule_8_1_default collapsed_bg jp_default jp_all jp_collapsed" ${R(0, 0, 1912, 212)}><img src="https://ads.jetpackdigital.com/c.jpg" ${R(0, 0, 1912, 212)}></div><div id="layer" class="Button_ButtonModule_22_2_default clickcollapsed jp_default jp_all jp_collapsed jpleft50 jpcenterhorizontally" ${R(0, 0, 1912, 212)}></div><div id="x" class="Button_ButtonModule_30_3_default closeleavebehind jp_default jp_all jp_collapsed" ${R(1840, 10, 42, 42)}></div></div></div>`;
  function withCovers(PV) {
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    return PV;
  }
  it("is found on the masthead target (jetpack module + close token), the click-layer is not", () => {
    const PV = withCovers(loadVeil({ host: "www.foxnews.com" }));
    document.body.innerHTML = STRIP;
    const x = document.getElementById("x");
    document.elementsFromPoint = () => [x, document.getElementById("layer")];
    expect(PV.closeControls(document.getElementById("jpmasthead"))).toEqual([x]);
  });
  it("'closeleavebehind' counts by its token alone, 'closed' does not", () => {
    const PV = withCovers(loadVeil());
    document.body.innerHTML = `<div id="unit" ${R(0, 0, 728, 90)}><div id="a" class="closeleavebehind" ${R(690, 30, 30, 30)}></div><div id="b" class="jp_closed" ${R(300, 30, 30, 30)}></div></div>`;
    const a = document.getElementById("a"), b = document.getElementById("b");
    document.elementsFromPoint = (x) => [x > 600 ? a : b];
    expect(PV.closeControls(document.getElementById("unit"))).toEqual([a]);
  });
});

// YouTube's inline hover preview is one page-level box moved over the tile
// under the mouse; over a veiled ad tile it is the ad again, above the cover.
describe("YouTube hover preview over a veiled ad", () => {
  const PAGE = (px) => `<ytd-in-feed-ad-layout-renderer ${R(264, 136, 0, 358)}><yt-lockup-view-model id="ad" ${R(264, 136, 533, 358)}><img></yt-lockup-view-model></ytd-in-feed-ad-layout-renderer>
    <ytd-rich-item-renderer id="vid" ${R(820, 136, 533, 358)}><img></ytd-rich-item-renderer>
    <ytd-video-preview id="video-preview" ${R(px, 130, 545, 370)}><video></video></ytd-video-preview>`;
  it("is covered while it sits on the ad, not while it sits on a plain video", () => {
    const PV = loadVeil({ host: "www.youtube.com" });
    document.body.innerHTML = PAGE(258);
    PV.veils = new Map([[document.getElementById("ad"), document.createElement("div")]]);
    let out = Array.from(PV.collectTargets().targets).map((t) => t.id);
    expect(out.sort()).toEqual(["ad", "video-preview"]);
    document.body.innerHTML = PAGE(814);
    PV.veils = new Map([[document.getElementById("ad"), document.createElement("div")]]);
    out = Array.from(PV.collectTargets().targets).map((t) => t.id);
    expect(out).toEqual(["ad"]);
  });
});

// X / Twitter (report 2026-09-12, "Timeline: Explore"): a promoted event hero
// and promoted posts sit in X's own <div data-testid="placementTracking">;
// classes are hashed, so nothing else names them.
describe("X promoted content", () => {
  // Second report: the hero's caption ("Spend $5 & Get $200 in Bonuses!") is
  // an absolute-fill SIBLING of the tracked video box, painted above it - so
  // the cover goes on the outermost same-size box, which holds them both.
  const HERO = `<section role="region" ${R(0, 0, 598, 3879)}><div id="outer" ${R(0, 0, 598, 336)}><div ${R(0, 0, 598, 336)}><div ${R(0, 0, 598, 336)}><div data-testid="eventHero" role="link" ${R(0, 0, 598, 336)}><div id="pt" data-testid="placementTracking" ${R(0, 0, 598, 336)}><div data-testid="videoPlayer" ${R(0, 0, 598, 336)}><div data-testid="videoComponent" ${R(0, 0, 598, 336)}><video aria-label="Embedded video" ${R(0, 0, 601, 338)}></video></div></div></div><div id="caption" ${R(0, 0, 598, 336)}><div ${R(16, 240, 566, 80)}><div ${R(16, 300, 566, 20)}><span>Spend $5 &amp; Get $200 in Bonuses!</span></div></div></div></div></div></div></div></section>`;
  it("covers the Explore event hero at its outermost same-size box (caption overlay included)", () => {
    const PV = loadVeil({ host: "x.com" });
    expect(detect(PV, HERO)).toEqual([{ tag: "div", id: "outer", why: "x-promoted: event hero" }]);
  });
  // Four reports 2026-09-12: ORGANIC video posts were veiled - X wraps every
  // embedded video player in placementTracking. Not an ad.
  it("an organic video post (placementTracking around the video player only) is left alone", () => {
    const PV = loadVeil({ host: "x.com" });
    const out = detect(PV, `<article id="org" data-testid="tweet" ${R(0, 0, 598, 620)}><div ${R(0, 0, 598, 40)}><span>Friend</span><span>@friend</span></div><div data-testid="tweetText" ${R(0, 40, 598, 50)}><span>look at this</span></div><div ${R(0, 100, 516, 290)}><div data-testid="placementTracking" ${R(0, 100, 516, 290)}><div data-testid="videoPlayer" ${R(0, 100, 516, 290)}><div data-testid="videoComponent" ${R(0, 100, 516, 290)}><video aria-label="Embedded video" ${R(0, 100, 519, 291)}></video></div><span ${R(10, 370, 30, 16)}>3:03</span></div></div></div></article>`);
    expect(out).toEqual([]);
  });
  it("a promoted post: placementTracking around the whole article", () => {
    const PV = loadVeil({ host: "x.com" });
    const out = detect(PV, `<div data-testid="cellInnerDiv" ${R(0, 400, 598, 520)}><div data-testid="placementTracking" ${R(0, 400, 598, 520)}><article id="promo" data-testid="tweet" ${R(0, 400, 598, 520)}><div ${R(0, 400, 598, 40)}><span>Acme</span></div><div ${R(0, 440, 598, 480)}><img></div></article></div></div>
      <article id="org" data-testid="tweet" ${R(0, 940, 598, 300)}><div ${R(0, 940, 598, 40)}><span>Friend</span></div><div data-testid="tweetText" ${R(0, 980, 598, 260)}>Hello</div></article>`);
    expect(out.map((o) => o.id)).toEqual(["promo"]);
  });
  it("a promoted post by X's own 'Ad' label in the header; 'Ad' as the post's text does not count", () => {
    const PV = loadVeil({ host: "x.com" });
    const out = detect(PV, `<article id="promo" data-testid="tweet" ${R(0, 0, 598, 400)}><div ${R(0, 0, 598, 40)}><span ${R(8, 8, 60, 20)}>Acme</span><span ${R(560, 8, 20, 20)}>Ad</span></div><div data-testid="tweetText" ${R(0, 40, 598, 60)}><span>Buy the thing</span></div><div ${R(0, 100, 598, 300)}><img></div></article>
      <article id="org" data-testid="tweet" ${R(0, 420, 598, 200)}><div ${R(0, 420, 598, 40)}><span ${R(8, 428, 60, 20)}>Friend</span></div><div data-testid="tweetText" ${R(0, 460, 598, 30)}><span ${R(8, 462, 20, 20)}>Ad</span></div></article>`);
    expect(out).toEqual([{ tag: "article", id: "promo", why: "x-promoted: Ad label" }]);
  });
  it("a promoted trend cell", () => {
    const PV = loadVeil({ host: "x.com" });
    const out = detect(PV, `<div data-testid="trend" id="t1" ${R(0, 0, 350, 90)}><div ${R(0, 0, 350, 20)}><span>Trending</span></div><div ${R(0, 20, 350, 30)}><span>#Thing</span></div><div ${R(0, 50, 350, 20)}><span>Promoted by Acme</span></div></div>
      <div data-testid="trend" id="t2" ${R(0, 100, 350, 90)}><div ${R(0, 100, 350, 20)}><span>Trending in Sports</span></div><div ${R(0, 120, 350, 30)}><span>#Other</span></div><div ${R(0, 150, 350, 20)}><span>12.3K posts</span></div></div>`);
    expect(out.map((o) => o.id)).toEqual(["t1"]);
  });
  it("is host-gated", () => {
    const PV = loadVeil({ host: "example.org" });
    expect(detect(PV, HERO)).toEqual([]);
  });
});

// LinkedIn feed (report 2026-09-12): a promoted post's header reads "Promoted";
// posts are div[role=listitem] in a div[role=list], hashed classes, and the
// post is taller than the window - the generic walker must grow the label to
// the list item, no site rule.
describe("generic 'Promoted' label grows to a role=listitem feed card", () => {
  // LinkedIn's real nesting (report 2026-09-12): role=list > 0x0 display-
  // contents wrappers > single-child wrappers > div[role=listitem]. The
  // listitem's parent has ONE child, so a sibling test never fires; the
  // listitem is a card by its role. The post is taller than the window.
  const post = (id, y, h, inner) => `<div ${R(0, 0, 0, 0)}><div ${R(0, 0, 0, 0)}><div ${R(0, y, 552, h)}><div ${R(0, y, 552, h)}><div id="${id}" role="listitem" ${R(0, y, 552, h)}><div ${R(0, y, 552, h)}>${inner}</div></div></div></div></div>`;
  it("LinkedIn promoted post (video, 918px)", () => {
    const PV = loadVeil({ host: "www.linkedin.com", width: 1912, height: 867 });
    const out = detect(PV, `<div role="list" ${R(0, 0, 552, 5896)}>
      ${post("p1", 0, 700, `<div ${R(0, 0, 552, 60)}><span ${R(60, 10, 80, 20)}>Someone</span><span ${R(60, 34, 120, 16)}>2,000 followers</span></div><div ${R(0, 60, 552, 640)}><img></div>`)}
      ${post("promo", 720, 918, `<div ${R(0, 720, 552, 60)}><span ${R(60, 730, 40, 20)}>Meta</span><span ${R(60, 754, 120, 16)}>12,223,634 followers</span><span ${R(190, 754, 60, 16)}>Promoted</span></div><div ${R(0, 780, 550, 688)}><div class="video-js" role="region" aria-label="Video Player" ${R(0, 780, 550, 688)}><video class="vjs-tech" ${R(0, 780, 550, 688)}></video></div></div>`)}
      ${post("p3", 1660, 500, `<div ${R(0, 1660, 552, 60)}><span ${R(60, 1670, 80, 20)}>Else</span></div><div ${R(0, 1720, 552, 440)}>text</div>`)}
    </div>`);
    expect(out).toEqual([{ tag: "div", id: "promo", why: "badge-label: Promoted" }]);
  });
  it("LinkedIn promoted document post (1025px): the whole listitem, not the document viewer", () => {
    const PV = loadVeil({ host: "www.linkedin.com", width: 1912, height: 867 });
    const out = detect(PV, `<div role="list" ${R(0, 0, 552, 5896)}>
      ${post("promo", 0, 1025, `<div ${R(0, 0, 552, 60)}><span ${R(60, 10, 40, 20)}>Acme</span><span ${R(60, 34, 120, 16)}>10 followers</span><span ${R(190, 34, 60, 16)}>Promoted</span></div><div ${R(0, 60, 550, 830)}><div ${R(0, 60, 550, 781)}><div ${R(0, 60, 550, 688)}><ul ${R(0, 60, 550, 688)}><li data-page-card="true" ${R(0, 60, 550, 688)}><figure ${R(0, 60, 550, 688)}><img ${R(0, 60, 550, 688)}></figure></li><li data-page-card="true" ${R(550, 60, 550, 688)}></li></ul></div></div><a ${R(0, 850, 550, 40)}><span>Unlock full document</span></a></div>`)}
      ${post("p2", 1040, 500, `<div ${R(0, 1040, 552, 60)}><span ${R(60, 1050, 80, 20)}>Else</span></div><div ${R(0, 1100, 552, 440)}>text</div>`)}
    </div>`);
    expect(out).toEqual([{ tag: "div", id: "promo", why: "badge-label: Promoted" }]);
  });
});

// LinkedIn's right-rail 300x250 (report 2026-09-12): a src-less iframe in
// hashed classes; only the unit's own "Ad Options" dialog ("Report this ad",
// hidden until opened) says what it is. The unit is the iframe's same-size
// wrapper, not the block that also holds the footer links.
describe("platform ad menu grows to the media box beside it", () => {
  it("LinkedIn right-rail unit by its hidden Ad Options dialog", () => {
    const PV = loadVeil({ host: "www.linkedin.com", width: 1912, height: 867 });
    const out = detect(PV, `<aside aria-label="Aside" ${R(1200, 0, 312, 3810)}><div ${R(1200, 3448, 312, 362)}><div ${R(1200, 3448, 312, 362)}>
      <div id="ad" ${R(1200, 3448, 312, 252)}><div ${R(1205, 3448, 302, 252)}><iframe ${R(1206, 3449, 300, 250)}></iframe></div></div>
      <div role="dialog" ${R(0, 0, 0, 0)}><button aria-label="Dismiss" ${R(0, 0, 0, 0)}></button><h2 ${R(0, 0, 0, 0)}>Ad Options</h2><div data-testid="dialog-content" ${R(0, 0, 0, 0)}><span>Report this ad</span><span>Submit</span></div></div>
      <div ${R(1200, 3700, 312, 110)}><a><p>About</p></a><a><p>Accessibility</p></a><a><p>Ad Choices</p></a><a><p>Advertising</p></a></div>
    </div></div></aside>`);
    expect(out).toEqual([{ tag: "div", id: "ad", why: "ad-menu: Ad Options" }]);
  });
  it("an 'Ad Options' heading with no media near it is nothing (a settings page)", () => {
    const PV = loadVeil();
    expect(detect(PV, `<main ${R(0, 0, 900, 600)}><section ${R(0, 0, 900, 300)}><h2 ${R(0, 0, 200, 30)}>Ad Options</h2><p ${R(0, 40, 600, 100)}>Choose how ads are shown.</p></section></main>`)).toEqual([]);
  });
});

// Pandora (report 2026-09-12): a 300x600 display unit in Pandora's own
// container - camel-case "region-adBanner" (not "ad-banner") with
// data-qa=display_ad_container_1 - holding a first-party displayAdFrame
// iframe; the container is the unit (an inside cover), not the iframe.
describe("Pandora display unit", () => {
  it("covers the region-adBanner container", () => {
    const PV = loadVeil({ host: "www.pandora.com", width: 1897, height: 914 });
    const out = detect(PV, `<div class="DisplayAdController" ${R(0, 0, 1897, 0)}><div id="DisplayAdController__adContainerOne" class="region-adBanner region-adBanner--double_wide region-adBanner--active" data-qa="display_ad_container_1" ${R(1500, 100, 300, 600)}><iframe id="ad1789243608477" ${R(1500, 100, 300, 600)}></iframe></div></div>`);
    expect(out.map((o) => o.id)).toEqual(["DisplayAdController__adContainerOne"]);
    expect(out[0].why).toMatch(/^slot-selector: /);
  });
});

// AP News (report 2026-09-13): a Primis outstream player, 340x191, with a
// Google IMA ad iframe and a Flashtalking creative. Below the video veil's
// 400px floor, and the slot pass used to skip every IMA iframe: covered by
// neither. Now the small player's box is covered whole; a player-sized IMA
// iframe is still the video veil's.
describe("small outstream player with an IMA ad", () => {
  const AP = (w, h) => `<div class="prms-player" ${R(0, 0, w, h + 1)}><div id="primis_player1" ${R(0, 0, w, h)}><div id="Player-Div-1" ${R(0, 0, w, h)}><div id="Video-Div-1" ${R(0, 0, w, h)}><div id="Video-iFrame-1" ${R(0, 0, w, h)}><div id="adContainerDiv" ${R(0, 0, w, h)}><div id="adIma" ${R(0, 0, w, h)}><div id="imaSlotContainer" ${R(0, 0, w, h)}><div ${R(0, 0, w, h)}><iframe id="goog_1" src="https://imasdk.googleapis.com/js/core/bridge3.789.0_en.html" ${R(0, 0, w, h)}></iframe></div></div></div></div></div></div></div></div></div>`;
  it("covers the 340x191 player box", () => {
    const PV = loadVeil({ host: "apnews.com", width: 1360, height: 900 });
    const out = detect(PV, AP(340, 191));
    expect(out.length).toBe(1);
    expect(["outstream-ima", "primis-outstream"]).toContain(out[0].why);   // both name the same box; the site rule runs last
    expect(["primis_player1", "Player-Div-1"]).toContain(out[0].id);
  });
  it("leaves a player-sized IMA iframe to the video veil", () => {
    const PV = loadVeil({ host: "apnews.com", width: 1360, height: 900 });
    expect(detect(PV, AP(960, 540))).toEqual([]);
  });
  it("a video served from cdn.flashtalking.com is an ad video", () => {
    const PV = loadVeil({ host: "apnews.com", width: 1360, height: 900 });
    const out = detect(PV, `<div id="box" ${R(0, 0, 340, 191)}><video src="https://cdn.flashtalking.com/1234/creative.mp4" ${R(0, 0, 340, 191)}></video></div>`);
    expect(out.map((o) => o.why)).toEqual(["ad-video: cdn.flashtalking.com/1234/creative.mp4"]);
  });
});

// AP News again (2026-09-13): the same Primis player, this time a VPAID ad
// (video#adVideoElement from cdn1.extremereach.io) with no IMA iframe on the
// page. Primis's own ad markup names it; editorial playback does not.
describe("Primis outstream player", () => {
  const PRIMIS = (adInner, mainInner) => `<div id="prms" class="prms-player" ${R(0, 0, 340, 192)}><div id="primis_playerSekindo1" ${R(0, 0, 340, 191)}><div id="Player-Div-1" ${R(0, 0, 340, 191)}><div id="videoContainerDiv" ${R(0, 0, 340, 191)}>${mainInner}</div><div id="adContainerDiv" ${R(0, 0, 340, 191)}><div id="adVpaid" ${R(0, 0, 340, 191)}><div id="slotContainer" ${R(0, 0, 340, 191)}>${adInner}</div></div></div></div></div></div>`;
  it("covers the player while its ad container holds a video with a source", () => {
    const PV = loadVeil({ host: "apnews.com", width: 1881, height: 900 });
    const out = detect(PV, PRIMIS(`<video id="adVideoElement" src="https://cdn1.extremereach.io/x/creative.mp4" ${R(0, 0, 340, 191)}></video>`, ``));
    // the ad-video rule (extremereach) climbs to the same-height .prms-player wrapper, which then wins the whole-cover dedupe over the Primis rule's player box: one cover either way
    expect(out.length).toBe(1);
    expect(["primis_playerSekindo1", "prms"]).toContain(out[0].id);
  });
  it("covers it on its own 'Skip Ad' control too", () => {
    const PV = loadVeil({ host: "apnews.com", width: 1881, height: 900 });
    const out = detect(PV, PRIMIS(``, `<div ${R(300, 160, 40, 20)}>Skip Ad</div>`));
    expect(out.map((o) => o.why)).toEqual(["primis-outstream"]);
  });
  it("leaves editorial playback alone", () => {
    const PV = loadVeil({ host: "apnews.com", width: 1881, height: 900 });
    expect(detect(PV, PRIMIS(``, `<video src="https://video.apnews.com/story.mp4" ${R(0, 0, 340, 191)}></video>`))).toEqual([]);
  });
});

// AP News wraps a 13042px column in .dianomi_context: a widget class on a
// wrapper. Never a column-long cover.
describe("Dianomi wrapper the height of a column", () => {
  it("is not covered; a widget-sized one is", () => {
    const PV = loadVeil({ host: "apnews.com", width: 1881, height: 900 });
    expect(detect(PV, `<div class="dianomi_context" id="col" ${R(0, 0, 980, 13042)}></div>`)).toEqual([]);
    expect(detect(PV, `<div class="dianomi_context" id="w" ${R(0, 0, 980, 600)}></div>`).map((o) => o.id)).toEqual(["w"]);
  });
});

// PCMag's top-anchored Pogo unit (Ziff Davis; its script appends
// <span class="pgCloseBtn"><span class="pgClose"></span></span> when the
// unit allows closing, 2026-09-13): a short prefix plus "close" is a close
// control; "disclosure" is not.
describe("Pogo close button through the cover", () => {
  function withCovers(PV) {
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    return PV;
  }
  it("finds pgCloseBtn, once, not its inner span", () => {
    const PV = withCovers(loadVeil({ host: "www.pcmag.com" }));
    document.body.innerHTML = `<div id="pogoQSWPR" role="group" aria-label="Advertisement" ${R(0, 0, 1897, 346)}><div id="pogoQS" ${R(0, 0, 1897, 346)}><div id="ad" class="pgT" ${R(0, 0, 1897, 346)}></div><a class="pgA" ${R(0, 0, 1897, 346)}></a></div><span id="x" class="pgCloseBtn" ${R(1860, 8, 28, 28)}><span class="pgClose" ${R(1866, 14, 16, 16)}></span></span><span class="disclosure" ${R(10, 320, 60, 16)}></span></div>`;
    const x = document.getElementById("x");
    document.elementsFromPoint = () => [x];
    expect(PV.closeControls(document.getElementById("pogoQSWPR"))).toEqual([x]);
  });
});

// PCMag (five reports 2026-09-13): the article column styles its children to
// max-width 48rem, and a 970px ad's cover came out 768px wide. A cover pins
// the box properties a page could size it with, inline and !important.
describe("cover box is immune to page sizing rules", () => {
  it("pins max-width / margin / padding / transform !important and leaves the offsets alone", () => {
    const PV = loadVeil({ host: "www.pcmag.com" });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    const c = document.createElement("div");
    c.style.left = "302px"; c.style.width = "970px";
    PV.__styleCover(c, "", "◐");
    expect(c.style.getPropertyValue("max-width")).toBe("none");
    expect(c.style.getPropertyPriority("max-width")).toBe("important");
    expect(c.style.getPropertyPriority("margin")).toBe("important");
    expect(c.style.getPropertyPriority("transform")).toBe("important");
    expect(c.style.left).toBe("302px");
    expect(c.style.width).toBe("970px");
    c.remove();
  });
});
