import { describe, it, expect } from "vitest";
import { loadVeil, detect } from "./harness.mjs";

// Rects are the measured sizes from the live sites (see the rule comments).
const R = (x, y, w, h) => `data-rect="${x},${y},${w},${h}"`;

// four reports from CBS News on an iPhone (0.9.69): a Taboola column taller than the screen stood bare, and a strip fixed to the foot
describe("a recommendation widget taller than the screen", () => {
  const cube = (id, y, h, paid) => `<div class="videoCube trc_spotlight_item" id="${id}" ${R(20, y, 400, h)}><a class="item-thumbnail-href" href="https://ads.example/x" ${R(20, y, 400, 225)}></a>` +
    (paid ? `<a class="trc_mobile_disclosure_link trc_attribution_position_after_branding" ${R(300, y + 280, 40, 16)}><span>PAID</span></a>` : "") + `</div>`;
  const widget = (h, items) => `<div class="trc_related_container" id="w" ${R(20, 100, 400, h)}><div class="trc_rbox thumbnails-h" id="w2" ${R(20, 100, 400, h)}>` +
    `<div class="trc_rbox_div" id="w3" ${R(20, 100, 400, h)}><div id="internal_trc_1" ${R(20, 100, 400, 0)}>${items}</div></div></div></div>`;
  it("on a phone covers each paid item, never the column and never an item with no paid label", () => {
    const PV = loadVeil({ host: "www.cbsnews.com", width: 440, height: 796 });
    const out = detect(PV, widget(1233, cube("a", 100, 308, true) + cube("own", 410, 308, false) + cube("b", 720, 296, true)));
    expect(out.map((o) => [o.id, o.why])).toEqual([["a", "taboola-item: Taboola's paid label on the item"], ["b", "taboola-item: Taboola's paid label on the item"]]);
  });
  it("leaves the items of a widget small enough to be covered whole to that cover", () => {
    const PV = loadVeil({ host: "www.cbsnews.com", width: 1600, height: 900 });
    const out = detect(PV, widget(320, cube("a", 100, 308, true)));
    expect(out.map((o) => o.id)).not.toContain("a");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => /^slot-selector/.test(o.why))).toBe(true);
  });
  it("covers an Infolinks unit", () => {
    const PV = loadVeil({ host: "www.cbsnews.com", width: 440, height: 796 });
    const out = detect(PV, `<div id="IL_INSEARCH" class="IL_BASE IL_SW" ${R(0, 717, 441, 79)}><div id="IL_SR_AD_CONTAINER" ${R(0, 717, 440, 79)}></div></div>`);
    expect(out).toEqual([{ tag: "div", id: "IL_INSEARCH", why: "slot-selector: div.IL_BASE" }]);
  });
});

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
  // report 2026-09-24: Hulu's home hero tile promoting its own show carries
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

describe("an ad server's own frame on a phone", () => {
  // Fox News on an iPhone, two reports 2026-11-22: frames of 440x618 and 398x796 on a 440x760 screen read as page-sized
  const slot = (w, h, pos = "") => `<div class="ad-container mobile" ${R(0, 60, 440, h)}><div class="ad gam" style="${pos}" ${R(0, 60, w, h)}>` +
    `<iframe id="google_ads_iframe_/1/x_0" ${R(0, 60, w, h)}></iframe></div></div>`;
  it("is covered though it takes most of the screen, and a wrapper of that size is not", () => {
    const PV = loadVeil({ host: "news.example", width: 440, height: 760 });
    expect(detect(PV, slot(440, 618)).map((o) => o.tag)).toEqual(["iframe"]);
    expect(detect(PV, slot(398, 796)).map((o) => o.tag)).toEqual(["iframe"]);
    expect(detect(PV, `<div class="ad-banner-wrapper" id="w" ${R(0, 0, 440, 700)}></div>`)).toEqual([]);
  });
  it("is left to the page-size rule in a fixed layer, and when it runs three screens tall", () => {
    const PV = loadVeil({ host: "news.example", width: 440, height: 760 });
    expect(detect(PV, slot(440, 700, "position:fixed"))).toEqual([]);
    expect(detect(PV, slot(440, 2400))).toEqual([]);
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
  // a suggested post: Facebook's own Follow button on the line of the page's name (opt-in, 2026-11-11)
  const sug = (follow, at = 2) => `<div ${R(0, 0, 680, 60)}><h3 ${R(0, 0, 200, 20)}><strong>Some League</strong></h3><span ${R(210, at, 50, 18)}>${follow}</span><div ${R(0, 30, 200, 20)}><span>13h</span></div></div><div data-ad-rendering-role="story_message" ${R(0, 60, 680, 600)}></div>`;
  it("covers a post with a Follow button beside the name, only when the switch is on", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    expect(detect(PV, post("s", sug("Follow")))).toEqual([]);
    PV.uiPrefs = { suggestedVeil: true };
    const out = detect(PV, post("s", sug("Follow")));
    expect(out.map((o) => o.id)).toEqual(["s"]);
    expect(out[0].why).toMatch(/^facebook-suggested: /);
    expect(detect(PV, post("g", sug("Join"))).map((o) => o.why)).toEqual(["facebook-suggested: Join button in the header"]);
  });
  // the layout Facebook serves a phone (2026-11-22, six reports from Safari on an iPhone): #screen-root, data-mcomponent blocks,
  // no aria-posinset, posts the width of the screen
  const mPost = (id, y, head, body = "") => `<div class="m displayed" id="${id}" ${R(0, y, 440, 755)}><div class="m" ${R(0, y, 440, 65)}></div>` +
    `<div class="m" data-mcomponent="MContainer" ${R(0, y + 65, 440, 48)}>${head(y + 70)}</div><div class="m" ${R(0, y + 120, 440, 550)}>${body}</div></div>`;
  const mFeed = (posts) => `<div id="screen-root" ${R(0, 0, 440, 18000)}><div class="m bg-s17" ${R(0, 0, 440, 18000)}><div class="m" ${R(0, 0, 440, 18000)}>` +
    posts + `<div ${R(0, 9000, 440, 10)}></div>`.repeat(4) + `</div></div></div>`;
  const adHead = (y) => `<span class="f2" ${R(60, y, 80, 18)}>OpenAI</span><span class="f5" ${R(145, y, 20, 18)}>Ad</span>`;
  const sugHead = (y) => `<span class="f2" ${R(60, y, 90, 18)}>ESPN FC</span><span class="f2" ${R(155, y, 8, 18)}>•</span><span class="f2" ${R(166, y, 46, 18)}>Follow</span>`;
  const orgHead = (y) => `<span class="f2" ${R(60, y, 90, 18)}>A friend</span><span class="f5" ${R(155, y, 30, 18)}>8h</span>`;
  it("covers an Ad-labelled post in Facebook's mobile layout, the whole post and nothing more", () => {
    const PV = loadVeil({ host: "www.facebook.com", width: 440, height: 830 });
    const out = detect(PV, mFeed(mPost("ad", 0, adHead) + mPost("org", 800, orgHead, `<span ${R(10, 1000, 30, 18)}>Ad</span>`)));
    expect(out.map((o) => o.id)).toEqual(["ad"]);
    expect(out[0].why).toBe("facebook-sponsored: Ad label in the header (mobile layout)");
  });
  it("covers a suggested post in the mobile layout only when the switch is on", () => {
    const PV = loadVeil({ host: "www.facebook.com", width: 440, height: 830 });
    const html = mFeed(mPost("s", 0, sugHead) + mPost("org", 800, orgHead));
    expect(detect(PV, html)).toEqual([]);
    PV.uiPrefs = { suggestedVeil: true };
    expect(detect(PV, html).map((o) => [o.id, o.why])).toEqual([["s", "facebook-suggested: Follow button in the header (mobile layout)"]]);
  });
  it("leaves a Follow button lower in a post (a friend's share of a page) and a page without the mobile layout", () => {
    const PV = loadVeil({ host: "www.facebook.com", width: 440, height: 830 });
    PV.uiPrefs = { suggestedVeil: true };
    expect(detect(PV, mFeed(mPost("share", 0, orgHead, `<span ${R(60, 400, 46, 18)}>Follow</span>`)))).toEqual([]);
    expect(detect(PV, `<div ${R(0, 0, 440, 18000)}>` + mPost("x", 0, adHead) + `</div>`)).toEqual([]);
  });
  it("mobile layout: covers a post Facebook labels AI content, only with the AI switch on", () => {
    const PV = loadVeil({ host: "www.facebook.com", width: 440, height: 830 });
    const ai = (y) => `<span class="f2 a" data-action-id="1" ${R(60, y, 90, 18)}>Some Gym</span><span class="f6 a" ${R(60, y + 22, 70, 16)}>\u200EAI content\u200E</span>`;
    const html = mFeed(mPost("ai", 0, ai) + mPost("org", 800, orgHead));
    expect(detect(PV, html)).toEqual([]);
    PV.uiPrefs = { aiVeil: true };
    expect(detect(PV, html).map((o) => [o.id, o.why])).toEqual([["ai", "ai-label: AI content"]]);
  });
  // a report on 0.9.68: a link post from a page the person follows carried the tracking element and was covered as an ad
  it("mobile layout: the tracking element proves no ad; a post with the Interested pair is covered under the switch", () => {
    const PV = loadVeil({ host: "www.facebook.com", width: 440, height: 830 });
    const track = `<div class="m intersection-observer" data-tracking-image-id="1" ${R(0, 0, 440, 2)}></div>`;
    const pair = (both) => `<div aria-label="Interested" ${R(20, 1500, 150, 36)}></div>` + (both ? `<div aria-label="Not interested" ${R(200, 1500, 150, 36)}></div>` : "");
    const html = mFeed(mPost("ad", 0, orgHead, track) + mPost("grp", 800, orgHead, pair(true)) + mPost("one", 1600, orgHead, pair(false)));
    expect(detect(PV, html)).toEqual([]);
    PV.uiPrefs = { suggestedVeil: true };
    expect(detect(PV, html).map((o) => o.id).sort()).toEqual(["grp"]);
  });
  // a report on 0.9.64: a news page the person opened was covered, its header (the cover and profile photos carry the tracking
  // element) and its posts. Only the home feed is Facebook's choice; an Ad label is an ad anywhere.
  it("mobile layout: on a page the person opened, covers nothing but a post labelled Ad", () => {
    const PV = loadVeil({ host: "www.facebook.com", width: 440, height: 830 });
    PV.uiPrefs = { suggestedVeil: true };
    const track = `<div class="m intersection-observer" data-tracking-image-id="1" ${R(0, 0, 440, 2)}></div>`;
    const html = mFeed(mPost("head", 0, orgHead, track) + mPost("fol", 800, sugHead) + mPost("ad", 1600, adHead));
    window.happyDOM.setURL("https://www.facebook.com/SomeNewsPage/");
    expect(detect(PV, html).map((o) => o.id)).toEqual(["ad"]);
    window.happyDOM.setURL("https://www.facebook.com/");
    expect(detect(PV, html).map((o) => o.id).sort()).toEqual(["ad", "fol"]);
  });
  it("desktop layout: a suggested post is covered in the home feed alone", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    PV.uiPrefs = { suggestedVeil: true };
    expect(detect(PV, post("g", sug("Join"))).length).toBe(1);
    window.happyDOM.setURL("https://www.facebook.com/groups/123/");
    expect(detect(PV, post("g", sug("Join")))).toEqual([]);
    window.happyDOM.setURL("https://www.facebook.com/");
  });
  // three reports on 0.9.61 from the Reels pages: an ad among the reels, and a reel labelled AI content, stood bare
  const reels = (items) => `<div id="screen-root" ${R(0, 0, 440, 796)}><div class="m bg-s43" ${R(0, 0, 440, 796)}>` +
    `<div class="m vscroller vscroller-snap vscroller-snap-start" ${R(0, 0, 440, 746)}>` + items + `</div></div></div>`;
  const reel = (id, y, inner) => `<div class="m bg-s32 vertically-snappable displayed" id="${id}" ${R(0, y, 440, 746)}><div class="m" ${R(0, y, 440, 746)}>` +
    `<div class="inline-video-container" ${R(0, y, 440, 746)}></div><span class="f2" ${R(12, y + 640, 90, 18)}>Someone</span>${inner}</div></div>`;
  it("mobile layout, Reels: covers the one reel labelled Ad, and no other", () => {
    const PV = loadVeil({ host: "m.facebook.com", width: 440, height: 796 });
    PV.uiPrefs = { suggestedVeil: true };
    const out = detect(PV, reels(reel("r1", -746, `<span ${R(110, -106, 46, 18)}>Follow</span>`) + reel("r2", 0, `<span class="f5" ${R(12, 664, 20, 16)}>‎Ad‎</span>`) +
      reel("r3", 746, "") + reel("r4", 1492, `<span class="f5" ${R(12, 2156, 60, 16)}>Sponsored</span>`))).map((o) => o.id).sort();
    expect(out).toEqual(["r2", "r4"]);
  });
  it("mobile layout, Reels: covers a reel labelled AI content when that switch is on", () => {
    const PV = loadVeil({ host: "m.facebook.com", width: 440, height: 796 });
    const page = reels(reel("r1", 0, `<span class="f5" ${R(12, 664, 70, 16)}>‎AI content‎</span>`) + reel("r2", 746, "") + reel("r3", 1492, ""));
    expect(detect(PV, page)).toEqual([]);
    PV.uiPrefs = { aiVeil: true };
    expect(detect(PV, page).map((o) => [o.id, o.why])).toEqual([["r1", "ai-label: AI content"]]);
  });
  // a report on 0.9.61: one story carried the ad's tracking element and the whole story bar was covered
  it("mobile layout: in the story bar covers the one story labelled Sponsored, never the bar", () => {
    const PV = loadVeil({ host: "www.facebook.com", width: 440, height: 830 });
    PV.uiPrefs = { suggestedVeil: true };
    const story = (id, x, inner) => `<div class="m bg-s3" id="${id}" ${R(x, 2, 128, 230)}><div class="m" ${R(x, 2, 122, 216)}><div role="button" ${R(x, 2, 122, 216)}>${inner}</div></div></div>`;
    const bar = `<div class="m displayed" id="bar" ${R(0, 0, 440, 233)}><div class="m hscroller" data-is-h-scrollable="true" ${R(0, 0, 440, 230)}>` +
      story("mine", 0, `<span class="f6" ${R(4, 190, 80, 16)}>Create story</span>`) +
      story("friend", 128, `<span class="f6" data-action-id="1" ${R(132, 190, 80, 16)}>A friend</span><span ${R(132, 170, 40, 16)}>Follow</span>`) +
      story("paid", 256, `<div data-tracking-image-id="9" ${R(256, 2, 2, 2)}></div><span class="f6" ${R(260, 190, 80, 16)}>Some Brand</span>`) +
      story("paid2", 384, `<span class="f6" ${R(388, 170, 60, 16)}>Sponsored</span>`) + `</div></div>`;
    const out = detect(PV, mFeed(bar + mPost("org", 800, orgHead))).map((o) => [o.id, o.why]).sort();
    expect(out.map((o) => o[0])).toEqual(["paid2"]);                         // the labelled story, not the bar, not the one with the tracking element
    expect(out[0][1]).toMatch(/Sponsored/);                                  // the label, by this rule or the general badge rule
  });
  // three reports 2026-11-22: a page's posts with a bare header, Facebook's Follow button on another post of that page
  const mName = (name, follow) => (y) => `<span class="f2 a" data-action-id="1" ${R(60, y, 90, 18)}>${name}</span>` +
    (follow ? `<span class="f2" ${R(166, y, 46, 18)}>Follow</span>` : `<span class="f5" ${R(60, y + 22, 30, 18)}>1h</span>`);
  it("mobile layout: a friend's share of a page's post is not suggested, and the friend's other posts stay (2026-11-23)", () => {
    const PV = loadVeil({ host: "www.facebook.com", width: 440, height: 830 });
    PV.uiPrefs = { suggestedVeil: true };
    const share = (y) => `<span class="f2 a" data-action-id="1" ${R(60, y, 90, 18)}>A friend</span><span class="f5" ${R(60, y + 22, 30, 18)}>1h</span>` +
      `<span class="f2 a" data-action-id="2" ${R(60, y + 60, 90, 18)}>Gizmodo</span><span class="f2" ${R(166, y + 60, 46, 18)}>Follow</span>`;
    const html = mFeed(mPost("share", 0, share) + mPost("own", 800, mName("A friend", false)));
    expect(detect(PV, html)).toEqual([]);
  });
  it("mobile layout: a post with no button is left, whatever another post of the same name carries (2026-11-23)", () => {
    const PV = loadVeil({ host: "www.facebook.com", width: 440, height: 830 });
    PV.uiPrefs = { suggestedVeil: true };
    const html = mFeed(mPost("a", 0, mName("Gizmodo", false)) + mPost("b", 800, mName("Gizmodo", true)) + mPost("c", 1600, mName("A friend", false)));
    expect(detect(PV, html).map((o) => [o.id, o.why])).toEqual([["b", "facebook-suggested: Follow button in the header (mobile layout)"]]);
    expect(detect(PV, html).map((o) => o.id)).toEqual(["b"]);   // and nothing is kept for a later pass
  });
  it("covers a LinkedIn feed item with a Follow button at its top, and leaves a repost and a followed account", () => {
    const PV = loadVeil({ host: "www.linkedin.com" }); window.history.pushState({}, "", "/feed/");
    const item = (id, y, btnAt, label = "Follow Some Person") => `<div role="listitem" id="${id}" ${R(0, y, 552, 300)}><p ${R(0, y, 200, 20)}>Some Person</p>` +
      (btnAt === null ? "" : `<button aria-label="${label}" ${R(450, y + btnAt, 78, 32)}>Follow</button>`) + `<p ${R(0, y + 150, 500, 100)}>words</p></div>`;
    const feed = `<div role="list">${item("sug", 0, 38)}${item("repost", 320, 121)}${item("mine", 640, null)}${item("other", 960, 20, "Unfollow Some Person")}</div>`;
    expect(detect(PV, feed)).toEqual([]);
    PV.uiPrefs = { suggestedVeil: true };
    const out = detect(PV, feed);
    expect(out.map((o) => o.id)).toEqual(["sug"]);
    expect(out[0].why).toBe("linkedin-suggested: Follow button at the top of the item");
  });
  it("leaves a followed page's post and a share with Follow lower down", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    PV.uiPrefs = { suggestedVeil: true };
    expect(detect(PV, post("org", sug("Following")))).toEqual([]);
    expect(detect(PV, post("share", sug("Follow", 140)))).toEqual([]);
  });
  it("leaves a post with no Follow button when Facebook put the button on another post of the same page (2026-11-23)", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    PV.uiPrefs = { suggestedVeil: true };
    const by = (path, follow) => `<div ${R(0, 0, 680, 60)}><h3 ${R(0, 0, 200, 20)}><a href="https://www.facebook.com${path}?__cft__[0]=x"><strong>Paper Boats</strong></a></h3>${follow ? `<span ${R(210, 2, 50, 18)}>Follow</span>` : ""}<div ${R(0, 30, 200, 20)}><span>13h</span></div></div><div data-ad-rendering-role="story_message" ${R(0, 60, 680, 600)}></div>`;
    // the page's post with no button, alone: nothing says the person does not follow it
    expect(detect(PV, post("a", by("/paperboats", false)))).toEqual([]);
    // the same feed holds a post of the page with the button: that one alone is covered, in this pass and the next
    const feed = post("a", by("/paperboats", false)) + post("b", by("/paperboats", true)) + post("c", by("/tallgrass", false));
    expect(detect(PV, feed).map((o) => o.id)).toEqual(["b"]);
    expect(detect(PV, feed).map((o) => o.id)).toEqual(["b"]);
    expect(detect(PV, post("a", by("/paperboats/", false)))).toEqual([]);
  });
  it("covers a suggested group by its Interested and Not interested buttons, never by one word alone", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    const grp = (a, b, by = 700) => `<div ${R(0, 0, 680, 60)}><h3 ${R(0, 0, 200, 20)}><strong>Some Group</strong></h3></div><div data-ad-rendering-role="story_message" ${R(0, 60, 680, 600)}></div><div ${R(0, 690, 680, 40)}><span ${R(20, 700, 90, 18)}>${a}</span><span ${R(350, by, 110, 18)}>${b}</span></div>`;
    expect(detect(PV, post("g", grp("Interested", "Not interested")))).toEqual([]);
    PV.uiPrefs = { suggestedVeil: true };
    expect(detect(PV, post("g", grp("Interested", "Not interested"))).map((o) => o.why)).toEqual(["facebook-suggested: Interested and Not interested buttons"]);
    expect(detect(PV, post("one", grp("Interested", "Share")))).toEqual([]);
    expect(detect(PV, post("apart", grp("Interested", "Not interested", 300)))).toEqual([]);
  });
  it("covers the rail's Sponsored block up to the next heading, not the Birthdays block under it", () => {
    const PV = loadVeil({ host: "www.facebook.com" });
    const out = detect(PV, `<div role="complementary" ${R(1500, 56, 360, 1200)}><div id="both" ${R(1500, 56, 360, 566)}>
      <div id="spons" ${R(1500, 56, 360, 450)}><div ${R(1516, 56, 328, 21)}><h3 ${R(1516, 56, 320, 21)}><span ${R(1516, 56, 320, 21)}>Sponsored</span></h3></div><a href="#" ${R(1500, 90, 360, 400)}><img ${R(1516, 90, 130, 130)}></a></div>
      <div id="bday" ${R(1500, 506, 360, 108)}><div ${R(1516, 506, 328, 21)}><h3 ${R(1516, 506, 320, 21)}><span ${R(1516, 506, 320, 21)}>Birthdays</span></h3></div><a href="#" ${R(1500, 540, 344, 55)}><span>Someone and 3 others</span></a></div>
    </div></div>`);
    expect(out.map((o) => o.id)).toEqual(["spons"]);
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
  it("the phone site: an ad Short is covered whole by its item of the carousel, and an empty slot names nothing (2026-11-23)", () => {
    const PV = loadVeil({ host: "m.youtube.com", width: 440, height: 747 });
    const item = (id, y, slot) => `<div id="${id}" class="carousel-item" ${R(0, y, 440, 747)}><shorts-video ${R(0, y, 440, 747)}><div class="video-wrapper" ${R(0, y, 440, 747)}><div class="layer touch-controls" ${R(0, y, 440, 747)}>${slot}</div></div></shorts-video></div>`;
    const out = detect(PV, `<div id="carousel-items" ${R(0, 0, 440, 2241)}>
      ${item("c0", 0, `<ad-slot-renderer ${R(0, 0, 0, 0)}></ad-slot-renderer>`)}
      ${item("c1", 747, `<ad-slot-renderer ${R(0, 747, 440, 747)}><reels-player-overlay-layout-view-model ${R(0, 747, 440, 747)}><div ${R(0, 1334, 376, 160)}><span ${R(60, 1340, 90, 20)}>Paramount+</span><badge-shape ${R(60, 1364, 70, 16)}><div ${R(60, 1364, 70, 16)}>Sponsored</div></badge-shape></div></reels-player-overlay-layout-view-model></ad-slot-renderer>`)}
      ${item("c2", 1494, "")}
    </div>`);
    expect(out).toEqual([{ tag: "div", id: "c1", why: "youtube-shorts-ad-reel" }]);
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

describe("no-ads hosts", () => {
  // report 2026-11-09: the Azure portal's own service tiles (fxs-home-ad-container)
  const AZ = `<div class="fxs-home-ad-container" id="row" role="row" ${R(0, 0, 1052, 127)}><div class="fxs-home-ad-tile" ${R(0, 0, 253, 110)}><a class="fxs-home-ad-link fxs-home-blade-tile" id="tile" aria-label="Microsoft Defender for Cloud" ${R(1, 1, 251, 108)}></a></div></div>`;
  it("the Azure portal's tool tiles are never covered", () => {
    expect(detect(loadVeil({ host: "portal.azure.com" }), AZ)).toEqual([]);
    expect(detect(loadVeil({ host: "ms.portal.azure.com" }), AZ)).toEqual([]);
  });
  it("the same markup elsewhere still matches the slot", () => {
    expect(detect(loadVeil({ host: "example.com" }), AZ).length).toBeGreaterThan(0);
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
  it("the glyph moves to the cover's visible corner when an ancestor clips it (Yahoo's Taboola unit, 2026-11-04)", () => {
    const PV = loadVeil();
    if (!PV.glyphInset) return;   // covers.js not loaded under this harness
    const r = (left, top, width, height) => ({ left, top, width, height });
    expect(PV.glyphInset(r(148, 300, 954, 146), [r(167, 300, 935, 146)])).toEqual({ dx: 19, dy: 0 });
    expect(PV.glyphInset(r(148, 300, 954, 146), [])).toEqual({ dx: 0, dy: 0 });
    expect(PV.glyphInset(r(0, 0, 60, 40), [r(50, 30, 400, 400)])).toEqual({ dx: 20, dy: 10 });   // never past the far edge
  });
  it("a Magnite Apex creative rendered above the google_ads_iframe in the same GAM container is covered too (Fox right rail, 2026-11-04)", () => {
    const PV = loadVeil();
    const out = detect(PV, `<div id="desktop_desk-hp-ban1" class="ad gam" ${R(1196, 61, 300, 500)}><div id="google_ads_iframe_/4145/fnc/desk/hp/ban1_0__container__" ${R(1196, 61, 300, 500)}><div id="MagniteApex-wrapper-0.96" ${R(1196, 61, 300, 250)}><iframe id="MagniteApex-iframe-0.96" srcdoc="<p>ad</p>" ${R(1196, 61, 300, 250)}></iframe></div><iframe id="google_ads_iframe_/4145/fnc/desk/hp/ban1_0" ${R(1196, 311, 300, 250)}></iframe></div></div>`);
    expect(out.map((o) => o.id).sort()).toEqual(["MagniteApex-iframe-0.96", "google_ads_iframe_/4145/fnc/desk/hp/ban1_0"]);
  });
  it("a GAM container overflowing a collapsed (0px) slot is a spacer even without 'oop' in its path", () => {
    const PV = loadVeil();
    expect(detect(PV, `<div id="div-gpt-ad-anchor" ${R(0, 0, 1897, 0)}><div id="google_ads_iframe_/123/top_0__container__" ${R(0, 0, 1897, 212)}><iframe id="google_ads_iframe_/123/top_0" ${R(0, 0, 1897, 212)}></iframe></div></div>`)).toEqual([]);
  });
});

// The ad's own X stays reachable through a display cover (0.7.150): a hole is
// cut only over a control that plainly says close, is small, and that a
// hit-test actually reaches once PRISM's own layers are skipped.
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
  it("strips held one under another are one bar (B-538, CBS News on a phone: the live strip under the nav)", () => {
    const PV = loadCovers(loadVeil());
    const bar = (id, y, h, more = "") => `<div id="${id}" style="position:sticky;background-color:rgb(255,255,255);${more}" ${R(0, y, innerWidth, h)}></div>`;
    document.body.innerHTML = bar("nav", 0, 48) + bar("live", 48, 89);
    PV.findTopBar();
    expect(PV.topBar.top).toBe(137);
    expect(PV.topBar.el.id).toBe("live");
    document.body.innerHTML = bar("nav", 0, 48) + bar("live", 93, 125);   // the live strip not yet held: it is page content still
    PV.findTopBar();
    expect(PV.topBar.top).toBe(48);
    const h3 = Math.round(innerHeight * 0.3);
    document.body.innerHTML = bar("nav", 0, 48) + bar("mid", 48, h3) + bar("low", 48 + h3, h3);   // a third strip would carry the bar past half the window: it is left out
    PV.findTopBar();
    expect(PV.topBar.top).toBe(48 + h3);
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

// Pandora's video advertisement (2026-11-18): a display rule put a second cover over the video cover and took every press.
describe("what the video cover holds gets no display cover", () => {
  it("an ad element inside the video cover is left to it, and is covered again when the video cover is gone", () => {
    const PV = loadVeil({ host: "www.pandora.com", width: 1600, height: 900 });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    document.body.innerHTML = `<div class="ad-unit" id="in" ${R(300, 100, 800, 450)}></div><div class="ad-unit" id="out" ${R(1250, 100, 300, 250)}></div>`;
    const vc = document.createElement("div"); vc.setAttribute("data-prism-veil", "1"); vc.setAttribute("data-rect", "300,100,800,450"); document.documentElement.appendChild(vc);
    let veil = { cover: vc, mode: "ad" };
    PV.videoAdBreak = () => {}; PV.vidVeil = () => veil; PV.pickArt = () => "data:,"; PV.artOnto = undefined;
    const whys = () => document.querySelectorAll("[data-prism-why]").length;
    PV.sweep(); expect(whys()).toBe(1);
    veil = null; PV.sweep(); expect(whys()).toBe(2);
    veil = { cover: vc, mode: "ad" }; PV.sweep(); expect(whys()).toBe(1);
    vc.remove();
  });
});

// Facebook's mobile layout on an iPhone (2026-11-22): the page drew a post again and the cover in it was gone until the next pass
describe("a cover inside its element", () => {
  it("is put back at once when the page takes it out, and not when PRISM took it away", async () => {
    const PV = loadVeil({ host: "www.example.com", width: 1600, height: 900 });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    document.body.innerHTML = `<div class="ad-unit" id="u" ${R(300, 100, 300, 250)}><p id="k">x</p></div>`;
    PV.videoAdBreak = () => {}; PV.vidVeil = () => null; PV.pickArt = () => "data:,"; PV.artOnto = undefined;
    const u = document.getElementById("u");
    // the cover takes its element's box (the harness lays nothing out)
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { return this.hasAttribute && this.hasAttribute("data-prism-why") || (this.parentNode === u && !this.id) ? real.call(u) : real.call(this); };
    try {
      PV.sweep();
      const cover = u.querySelector("[data-prism-veil]");
      expect(cover && cover.parentNode).toBe(u);
      u.innerHTML = "<p>drawn again</p>";                    // the page's redraw
      await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
      expect(cover.parentNode).toBe(u);
      u.setAttribute("style", "height:250px"); await Promise.resolve();   // the page writes the style over await new Promise((r) => setTimeout(r, 0));
      expect(u.style.position).toBe("relative");
      u.className = ""; PV.sweep();                          // no longer an ad: PRISM takes the cover away
      await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
      expect(u.querySelector("[data-prism-veil]")).toBe(null);
    } finally { Element.prototype.getBoundingClientRect = real; }
  });
});

// Facebook's mobile layout on an iPhone (2026-11-22): a video ad that began to play showed through its cover for a moment
describe("a video under a display cover", () => {
  it("is drawn as a speck while covered, at once when one starts to play, and back when the cover goes; opacity untouched", () => {
    const PV = loadVeil({ host: "www.example.com", width: 1600, height: 900 });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    document.body.innerHTML = `<div class="ad-unit" id="u" ${R(300, 100, 300, 250)}><video id="v" style="opacity:0.8;transform:rotate(1deg)"></video></div><video id="free"></video>`;
    PV.videoAdBreak = () => {}; PV.vidVeil = () => null; PV.pickArt = () => "data:,"; PV.artOnto = undefined;
    const u = document.getElementById("u"), v = document.getElementById("v"), free = document.getElementById("free");
    Object.defineProperty(v, "offsetWidth", { value: 300 }); Object.defineProperty(v, "offsetHeight", { value: 250 });
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { return this.hasAttribute && this.hasAttribute("data-prism-why") ? real.call(u) : real.call(this); };
    const speck = (x) => /^scale\(0\.\d+\)$/.test(x.style.getPropertyValue("transform")) && x.style.getPropertyPriority("transform") === "important";
    try {
      PV.sweep();
      expect(v.style.getPropertyValue("transform")).toBe("scale(0.02000)");   // 6 px of 300
      expect(v.style.getPropertyPriority("transform")).toBe("important");
      expect(v.style.getPropertyValue("opacity")).toBe("0.8");                // never the opacity
      const late = document.createElement("video"); u.appendChild(late);      // the page puts another in and plays it
      late.dispatchEvent(new Event("playing"));
      expect(speck(late)).toBe(true);
      free.dispatchEvent(new Event("playing"));
      expect(free.style.cssText).toBe("");                                    // not under a cover
      // the page moves a covered video into an element with no cover (Facebook's feed has one video for every post): it is put
      // right at the video's first event there, and its sound setting with it
      const other = document.createElement("div"); document.body.appendChild(other);
      expect(late.muted).toBe(true);
      other.appendChild(late); late.dispatchEvent(new Event("emptied"));
      expect(late.style.cssText).not.toMatch(/transform/);
      expect(late.muted).toBe(false);
      // and at the next pass when the page fires nothing
      const third = document.createElement("video"); u.appendChild(third); third.dispatchEvent(new Event("loadstart"));
      expect(speck(third)).toBe(true);                                        // a speck before it has a frame
      other.appendChild(third); PV.sweep();
      expect(third.style.cssText).not.toMatch(/transform/);
      expect(speck(v)).toBe(true);                                            // the one still under the cover stays a speck
      u.className = ""; PV.sweep();
      expect(v.style.getPropertyValue("transform")).toBe("rotate(1deg)");
    } finally { Element.prototype.getBoundingClientRect = real; }
  });
});

// Facebook's mobile layout on an iPhone (2026-11-22): a video ad showed for a couple of frames, its cover back with another picture
describe("a covered element the page swaps for a new copy", () => {
  it("is known as lost at once, covered again in the same pass with the same picture, and the report gets the history", () => {
    const PV = loadVeil({ host: "www.example.com", width: 1600, height: 900 });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    const unit = (id) => `<div class="ad-unit" id="${id}" ${R(300, 100, 300, 250)}></div>`;
    document.body.innerHTML = unit("one");
    let n = 0;
    PV.videoAdBreak = () => {}; PV.vidVeil = () => null; PV.pickArt = () => "data:,pic" + (++n); PV.artOnto = undefined;
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { const u = this.hasAttribute && this.hasAttribute("data-prism-veil") && this.parentNode; return u && u.getAttribute ? real.call(u) : real.call(this); };
    try {
      PV.sweep();
      const first = document.querySelector("#one [data-prism-why]");
      expect(first.__artUrl).toBe("data:,pic1");
      expect(first.__again).toBe(false);                      // a new cover fades in (the harness runs the fade's frame at once)
      expect(PV.coverLost()).toBe(false);
      PV.sweep();                                             // a pass notes where the cover is
      document.body.innerHTML = unit("two");                  // the page's new copy of the post, in the same place
      expect(PV.coverLost()).toBe(true);
      PV.sweep();
      const second = document.querySelector("#two [data-prism-why]");
      expect(second).not.toBeNull();
      expect(second.__artUrl).toBe("data:,pic1");             // the same picture, not a new one
      expect(second.__again).toBe(true); expect(second.style.opacity).toBe("1");   // and whole at once: nothing shows through a fade (measured on the iPhone)
      const log = PV.coverLog().join(" | ");
      expect(log).toMatch(/gone element-out \d+ms slot-selector|gone element-out \d+ms /);
      expect(log).toMatch(/made inside \d+ms /);
      // elsewhere on the page a new cover takes a new picture
      document.body.insertAdjacentHTML("beforeend", `<div class="ad-unit" id="far" ${R(300, 900, 300, 250)}></div>`);
      PV.sweep();
      expect(document.querySelector("#far [data-prism-why]").__artUrl).toBe("data:,pic2");
      expect(document.querySelector("#far [data-prism-why]").__again).toBe(false);
    } finally { Element.prototype.getBoundingClientRect = real; }
  });
});

// asked 2026-11-22: a symbol of its own for a suggested post, as the AI-labelled cover has
describe("the symbol on a cover", () => {
  it("is the half moon for an ad, the star for labelled AI content and the arrow for a suggested post", () => {
    const PV = loadVeil({ host: "www.example.com", width: 1600, height: 900 });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    const S = PV.coverSymbols;
    expect([S.ad.codePointAt(0), S.ai.codePointAt(0), S.suggested.codePointAt(0)]).toEqual([0x25D0, 0x2726, 0x279C]);
    expect(PV.coverSymbol("slot-selector: .ad-unit")).toBe(S.ad);
    expect(PV.coverSymbol("facebook-sponsored: Ad label in the header (mobile layout)")).toBe(S.ad);
    expect(PV.coverSymbol("ai-label: AI content")).toBe(S.ai);
    expect(PV.coverSymbol("facebook-suggested: Follow button in the header")).toBe(S.suggested);
    expect(PV.coverSymbol("linkedin-suggested: Follow button at the top of the item")).toBe(S.suggested);
    // the settings show the same three
    const html = require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "popup.html"), "utf8");
    ["&#x25D0;", "&#x2726;", "&#x279C;"].forEach((e) => expect(html).toContain(`<span class="sym" aria-hidden="true">${e}</span>`));
  });
});

// Two copies of the extension on one page (2026-11-21, Facebook's right column): each took the other's cover away as a stray.
describe("a cover made by another copy of the extension", () => {
  it("is left alone, while a stray of this copy's own is taken away", () => {
    const PV = loadVeil({ host: "www.example.com", width: 1600, height: 900 });
    window.chrome.runtime.id = "thiscopy";
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    document.body.innerHTML = `<div class="ad-unit" id="ad" ${R(100, 100, 300, 250)}></div>`;
    PV.videoAdBreak = () => {}; PV.vidVeil = () => null; PV.pickArt = () => "data:,"; PV.artOnto = undefined;
    const other = document.createElement("div"); other.setAttribute("data-prism-why", "badge-label: Sponsored"); other.setAttribute("data-prism-own", "othercopy");
    document.getElementById("ad").appendChild(other);
    const mine = document.createElement("div"); mine.setAttribute("data-prism-why", "badge-label: Sponsored"); mine.setAttribute("data-prism-own", "thiscopy");
    document.body.appendChild(mine);
    PV.sweep();
    expect(other.isConnected).toBe(true);
    expect(mine.isConnected).toBe(false);
    expect(document.querySelectorAll('[data-prism-own="thiscopy"]').length).toBe(1);
    PV.sweep();
    expect(other.isConnected).toBe(true);
    delete window.chrome.runtime.id;
  });
});

// Fox's collapsed Jetpack strip, as reported 2026-09-12 with the pick ON the
// close button: a 42x42 `*_ButtonModule_*` whose class is "closeleavebehind",
// top of the stack over the full-width "clickcollapsed" click-layer.
// MSN's digest / infopane cards (reports 2026-10-09, 2026-10-15): a slider
// mixing ads and articles inside a shadow host, its Previous / Next buttons
// and slide dots under the cover. They are holes, found through the host's
// shadow tree and hit-tested through it.
describe("carousel controls through the cover", () => {
  function withCovers(PV) {
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    return PV;
  }
  function card() {
    document.body.innerHTML = `<div id="card" ${R(0, 0, 688, 368)}></div>`;
    const host = document.getElementById("card");
    const sr = host.attachShadow({ mode: "open" });
    sr.innerHTML = `<div id="slide" ${R(2, 2, 684, 366)}></div><cs-sequence-dots id="dots" class="navigation" ${R(185, 340, 318, 8)}></cs-sequence-dots>` +
      `<button id="prev" aria-label="Previous" class="nav-button" ${R(580, 326, 36, 36)}></button><button id="next" aria-label="Next" class="nav-button" ${R(624, 326, 36, 36)}></button>` +
      `<button id="more" aria-label="More options" ${R(20, 326, 36, 36)}></button>`;
    return { host, sr, $: (id) => sr.getElementById(id) };
  }
  it("Previous, Next and the dots are holes; an unrelated button is not", () => {
    const PV = withCovers(loadVeil({ host: "www.msn.com" }));
    const { host, sr, $ } = card();
    document.elementsFromPoint = () => [host];
    sr.elementsFromPoint = (x) => [x > 620 ? $("next") : x > 570 ? $("prev") : x < 100 ? $("more") : $("dots")];
    expect(PV.closeControls($("slide"))).toEqual([$("dots"), $("prev"), $("next")]);
  });
  it("a control the ad's own layer sits over is not a hole", () => {
    const PV = withCovers(loadVeil({ host: "www.msn.com" }));
    const { host, sr, $ } = card();
    document.elementsFromPoint = () => [host];
    sr.elementsFromPoint = () => [$("slide")];
    expect(PV.closeControls($("slide"))).toEqual([]);
  });
  it("a bottom bar insets the cover from below", () => {
    const PV = withCovers(loadVeil());
    const c = document.createElement("div");
    c.__under = 0; c.__over = 30; c.__holeBoxes = [];
    PV.paintClip(c);
    expect(c.style.clipPath).toBe("inset(0.0px 0 30.0px 0)");
  });
});

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

// X / Twitter (report 2026-09-12): a promoted event hero
// and promoted posts sit in X's own <div data-testid="placementTracking">;
// classes are hashed, so nothing else names them.
describe("X promoted content", () => {
  // Second report: the hero's caption is
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
  it("on a phone a promoted post as wide as the window and a screen tall is covered whole (2026-11-23)", () => {
    const PV = loadVeil({ host: "www.linkedin.com", width: 440, height: 747 });
    const out = detect(PV, `<div role="list" ${R(0, 0, 440, 7070)}>
      ${post("p1", 0, 500, `<div ${R(0, 0, 440, 66)}><span ${R(68, 10, 80, 20)}>Someone</span></div><div ${R(0, 66, 440, 434)}>text</div>`).replace(/552/g, "440")}
      ${post("promo", 520, 765, `<div ${R(0, 520, 440, 66)}><div ${R(68, 528, 328, 50)}><span ${R(68, 528, 90, 20)}>Acme</span><span ${R(68, 548, 120, 14)}>5,532,973 followers</span><span ${R(68, 562, 60, 14)}>Promoted</span></div></div><div ${R(0, 682, 440, 550)}><img></div>`).replace(/552/g, "440")}
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
describe("Dianomi on a phone (2026-11-23, CNN)", () => {
  it("covers a unit that is most of the screen when Dianomi's frame fills it, and not on a wide screen", () => {
    const html = `<div class="bizdev-dianomi" id="u" ${R(16, 60, 408, 630)}><div class="dianomi_context" id="c" ${R(16, 60, 408, 630)}><iframe class="dianomi-parent-iframe" ${R(16, 60, 408, 624)}></iframe></div></div>` +
      `<div class="dianomi_context" id="bare" ${R(16, 900, 408, 630)}></div>`;
    const PV = loadVeil({ host: "www.cnn.com", width: 440, height: 747 });
    expect(detect(PV, html).map((o) => o.id).some((i) => i === "u" || i === "c")).toBe(true);
    expect(detect(PV, html).map((o) => o.id)).not.toContain("bare");
    const W = loadVeil({ host: "www.cnn.com", width: 720, height: 700 });
    expect(detect(W, html)).toEqual([]);
  });
});
describe("PRISM clear layers", () => {
  it("a finger's drag on a clear layer closes its panel, a tap does not (2026-11-23)", () => {
    const PV = loadVeil({ host: "www.linkedin.com" });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    const el = document.createElement("div"); let closed = 0;
    PV.dragCloses(el, () => { closed++; });
    const touch = (type, y) => { const e = new Event(type); e.touches = [{ clientX: 100, clientY: y }]; el.dispatchEvent(e); };
    touch("touchstart", 300); touch("touchmove", 304);
    expect(closed).toBe(0);
    touch("touchmove", 320); touch("touchmove", 360);
    expect(closed).toBe(1);
  });
});
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

// The photo credit on the cover's symbol (2026-10-15): read on hover from
// the photo on screen, bundled or hosted alike (same file name).
describe("the look under a display cover", () => {
  const load = () => {
    const PV = loadVeil();
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    return PV;
  };
  it("says what was covered and by which signal", () => {
    const PV = load();
    expect(PV.coverWhy("badge-label: Sponsored", false)).toEqual({ kind: "An ad", source: "The page's own label: Sponsored" });
    expect(PV.coverWhy("facebook-suggested: Join button in the header", false).kind).toBe("A suggested post");
    expect(PV.coverWhy("facebook-suggested: Join button in the header", false).source).toContain("Join");
    expect(PV.coverWhy("facebook-suggested: Interested and Not interested buttons", false).source).toContain("Interested");
    expect(PV.coverWhy("ai-label: AI info", true).kind).toBe("Labeled AI content");
    expect(PV.coverWhy("slot-selector: .ad-slot", false).source).toBe("An ad slot in the page");
    expect(PV.coverWhy("taboola-item: Taboola's paid label on the item", false).source).toMatch(/Taboola/);
  });
  it("keeps the panel on the screen and the view inside the element, in a frame of one size, or says there is no such place", () => {
    const PV = load();
    // a 340 px panel, its 320 px frame 10 px in, a 160 px view, an element from 1640 to 2000 on a screen 2550 wide: the panel where
    // it was wanted, the view in the middle of the frame
    expect(PV.lookPlace(1650, 10, 340, 320, 160, 1640, 2000, 2550)).toEqual({ p: 1650, a: 80 });
    // the same element at the right edge of a 2000 px screen: the panel moves left to stay on the screen
    expect(PV.lookPlace(1830, 10, 340, 320, 160, 1640, 2000, 2000)).toEqual({ p: 1654, a: 80 });
    // an element 110 px wide at the right edge: the view goes to the frame's right side, the panel stays on the screen
    expect(PV.lookPlace(1910, 10, 340, 320, 86, 1890, 2000, 2000)).toEqual({ p: 1654, a: 226 });
    // a screen narrower than the panel: no place
    expect(PV.lookPlace(10, 10, 340, 320, 160, 0, 300, 300)).toBeNull();
    // an element at the bottom edge with the frame at the panel's top: no place (the panel then turns its frame to its foot)
    expect(PV.lookPlace(570, 10, 360, 200, 100, 543, 674, 674)).toBeNull();
    expect(PV.lookPlace(175, 150, 360, 200, 100, 543, 674, 674)).toEqual({ p: 308, a: 85 });
    // a view a hair longer than its frame (a rounding of the fit) still has a place (2026-11-16, from the reports of 2026-11-12)
    expect(PV.lookPlace(352, 10, 330, 108, 108.00000000000001, 312, 1145, 1266)).toEqual({ p: 352, a: 0 });
    for (let h = 300; h < 1400; h += 0.5) { const hole = PV.lookHole({ width: 680, height: h }, { left: 928, top: 100, right: 1608, bottom: 1200 }, 192, 108, 10, 40); expect(hole.h <= 108 && hole.w <= 192).toBe(true); }
  });
  it("sets a picture's credit out in rows", () => {
    const PV = load();
    expect(PV.creditParts("A doe in the forest\nPhoto: NPS · Public domain · Wikimedia Commons")).toEqual([["Picture", "A doe in the forest"], ["Photo", "NPS"], ["License", "Public domain"], ["Source", "Wikimedia Commons"]]);
    expect(PV.creditParts("Houses at Murnau (Vasily Kandinsky, 1909)\nArt Institute of Chicago, Public Domain · Public domain (CC0 1.0)")).toEqual([["Picture", "Houses at Murnau (Vasily Kandinsky, 1909)"], ["Source", "Art Institute of Chicago, Public Domain"], ["License", "Public domain (CC0 1.0)"]]);
  });
  it("places the small view inside the part of the element that is on the screen", () => {
    const PV = load();
    const h = PV.lookHole({ left: 100, top: -200, width: 680, height: 920 }, { left: 100, top: 0, right: 780, bottom: 720 }, 318, 230, 10, 62);
    expect(h.k).toBeCloseTo(0.25, 2);
    expect([Math.round(h.x), Math.round(h.y), Math.round(h.w), Math.round(h.h)]).toEqual([110, 62, 170, 230]);
    const b = PV.lookHole({ left: 0, top: 300, width: 728, height: 90 }, { left: 0, top: 300, right: 728, bottom: 390 }, 318, 230, 10, 62);
    expect(b.y + b.h).toBeLessThanOrEqual(390);   // a banner: the view stays inside its 90 px
    expect(b.y).toBeGreaterThanOrEqual(300);
  });
  it("scales the page's own element into a hole in the cover, and puts everything back", () => {
    const PV = load();
    document.body.innerHTML = `<div id="unit" ${R(0, 0, 680, 400)}><a id="ad" href="#" style="transform: rotate(1deg)" ${R(0, 0, 680, 400)}><span>Sponsored</span></a><div id="wrap" style="display: contents"><p id="in" ${R(0, 0, 680, 400)}>x</p></div></div>`;
    const unit = document.getElementById("unit"), ad = document.getElementById("ad");
    const c = document.createElement("div"); unit.appendChild(c);
    PV.__styleCover(c, "https://prism.entangled.world/veil/art/commons_coral_reef_84.jpg", null);
    c.__target = unit; c.__mode = "inside"; c.setAttribute("data-prism-why", "badge-label: Sponsored");
    PV.lookOpen(c, c.lastElementChild, false); PV.lookOpen(c, c.lastElementChild, false);
    const cards = document.querySelectorAll("[data-prism-look]");
    expect(cards.length).toBe(1);
    expect(cards[0].getAttribute("data-prism-ui")).toBe("1");
    expect(cards[0].children.length).toBe(0);                    // nothing of the page is copied into the card
    expect(ad.style.getPropertyValue("transform")).toMatch(/scale\(0\.4500\)/);
    expect(c.__lookOn).toBe(true);
    expect(document.getElementById("wrap").style.getPropertyValue("transform")).toBe("");            // no box of its own: left alone
    expect(document.getElementById("in").style.getPropertyValue("transform")).toMatch(/scale\(0\.4500\)/);   // its child is scaled in its place
    expect(c.style.clipPath).toMatch(/^polygon\(/);             // the hole
    expect(c.style.getPropertyValue("transform")).toBe("none");  // the cover itself is never scaled
    PV.lookClose();
    expect(document.querySelectorAll("[data-prism-look]").length).toBe(0);
    expect(ad.style.getPropertyValue("transform")).toBe("rotate(1deg)");
    expect(c.__lookOn).toBe(false);
    expect(c.style.clipPath).toBe("");
    PV.lookReveal(c, 15000);                                     // Reveal 15 s: the cover hidden, to come back by itself
    expect(c.style.getPropertyValue("visibility")).toBe("hidden");
    clearTimeout(c.__revealT);
  });
  it("moves nothing on the page when the small view is switched off; the panel still opens", () => {
    const PV = load();
    PV.uiPrefs = { smallView: false };
    document.body.innerHTML = `<div id="unit" ${R(0, 0, 680, 400)}><a id="ad" href="#" ${R(0, 0, 680, 400)}>x</a></div>`;
    const unit = document.getElementById("unit");
    const c = document.createElement("div"); unit.appendChild(c);
    PV.__styleCover(c, "", null); c.__target = unit; c.__mode = "inside";
    PV.lookOpen(c, c.lastElementChild, false);
    expect(document.querySelectorAll("[data-prism-look]").length).toBe(1);
    expect(document.getElementById("ad").style.getPropertyValue("transform")).toBe("");
    expect(c.__lookOn).toBeFalsy();
    PV.lookClose();
  });
  // iOS Safari (a report 2026-11-22): after the panel closed by itself, the symbol kept the made-up hover and the next tap opened
  // nothing. A finger's tap on the symbol now opens the panel on its own; closing is the clear layer's (0.9.49, the Mac session):
  // a tap off the panel lands on it and closes the panel on the click, so the click never reaches the page.
  it("opens on a tap, also when the symbol still counts as hovered, and closes by the clear layer", () => {
    const PV = load();
    document.body.innerHTML = `<div id="unit" ${R(0, 0, 680, 400)}><a id="ad" href="#" ${R(0, 0, 680, 400)}>x</a></div>`;
    const unit = document.getElementById("unit");
    const c = document.createElement("div"); unit.appendChild(c);
    PV.__styleCover(c, "", null); c.__target = unit; c.__mode = "inside";
    const sym = c.lastElementChild;
    const touch = (type, el) => {
      const ev = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch" });
      if (ev.pointerType !== "touch") Object.defineProperty(ev, "pointerType", { value: "touch" });
      el.dispatchEvent(ev);
    };
    const tap = (el) => { touch("pointerdown", el); touch("pointerup", el); el.dispatchEvent(new MouseEvent("mouseenter")); };
    const panel = () => document.querySelector("[data-prism-look]");
    const realNow = Date.now; let now = realNow();
    Date.now = () => now;
    try {
      tap(sym); expect(panel()).not.toBeNull();
      const scrim = panel().previousElementSibling;
      expect(scrim && scrim.getAttribute("data-prism-ui")).toBe("1");
      scrim.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(panel()).not.toBeNull();                    // the opening tap's own click: the panel stays
      now += 500;
      scrim.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(panel()).toBeNull();                        // a later tap off the panel closes it
      expect(scrim.isConnected).toBe(false);
      now += 2000;
      tap(sym); expect(panel()).not.toBeNull();
      PV.lookClose(); expect(panel()).toBeNull();        // closed another way (a scroll, the twenty seconds)
      now += 2000;
      sym.dispatchEvent(new MouseEvent("mouseenter")); PV.lookClose();
      touch("pointerdown", sym); touch("pointerup", sym); // still "hovered": no mouseenter comes with this tap
      expect(panel()).not.toBeNull();                    // it opens all the same
      PV.lookClose();
    } finally { Date.now = realNow; }
  });
  it("is larger under a finger, and a tap just beside the symbol opens the panel", () => {
    const realMM = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /pointer:\s*coarse/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      const PV = load();
      document.body.innerHTML = `<div id="unit" ${R(0, 0, 390, 400)}><a id="ad" href="#" ${R(0, 0, 390, 400)}>x</a></div>`;
      const unit = document.getElementById("unit");
      const c = document.createElement("div"); unit.appendChild(c);
      PV.__styleCover(c, "", null); c.__target = unit; c.__mode = "inside";
      const sym = c.lastElementChild;
      expect(sym.style.cssText).toContain("padding: 0.5em 0.65em");
      sym.getBoundingClientRect = () => ({ left: 6, top: 6, right: 56, bottom: 50, width: 50, height: 44 });
      const touchAt = (type, x, y) => {
        const ev = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", clientX: x, clientY: y });
        if (ev.pointerType !== "touch") Object.defineProperty(ev, "pointerType", { value: "touch" });
        c.dispatchEvent(ev);
      };
      const panel = () => document.querySelector("[data-prism-look]");
      touchAt("pointerdown", 120, 200); touchAt("pointerup", 120, 200);
      expect(panel()).toBeNull();                        // a tap elsewhere on the cover opens nothing
      touchAt("pointerdown", 64, 58); touchAt("pointerup", 64, 58);
      expect(panel()).not.toBeNull();                    // 8 px off the symbol's corner: taken as a tap on it
      PV.lookClose();
    } finally { window.matchMedia = realMM; }
  });
  it("is not cut at the top edge of the viewport when the page has no bar", () => {
    const PV = load();
    document.body.innerHTML = `<div id="unit" ${R(0, -120, 390, 400)}>x</div>`;
    const unit = document.getElementById("unit");
    const c = document.createElement("div"); unit.appendChild(c);
    PV.__styleCover(c, "", null); c.__target = unit; c.__mode = "inside";
    c.getBoundingClientRect = () => ({ left: 0, top: -120, right: 390, bottom: 280, width: 390, height: 400 });
    PV.veils.set(unit, c);
    try {
      PV.__clipOverlays();
      expect(c.__under).toBe(0);                         // iOS Safari draws the page above the edge, under the status bar
      expect(c.style.clipPath || "").toBe("");
    } finally { PV.veils.delete(unit); }
  });
  it("keeps the small symbol for a mouse", () => {
    const PV = load();
    const c = document.createElement("div"); document.body.appendChild(c);
    PV.__styleCover(c, "", null);
    expect(c.lastElementChild.style.cssText).toContain("padding: 0.3em 0.45em");   // happy-dom keeps no font shorthand: the padding tells the two apart
  });
  it("gives a line of text and scales nothing for an element with a shadow tree of its own", () => {
    const PV = load();
    document.body.innerHTML = `<div id="unit" ${R(0, 0, 680, 400)}><b id="k">x</b></div>`;
    const unit = document.getElementById("unit"); unit.attachShadow({ mode: "open" });
    const c = document.createElement("div"); unit.appendChild(c);
    PV.__styleCover(c, "", null); c.__target = unit; c.__mode = "inside";
    PV.lookOpen(c, c.lastElementChild, false);
    expect(document.getElementById("k").style.getPropertyValue("transform")).toBe("");
    expect(c.__lookOn).toBeFalsy();
    PV.lookClose();
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

// YouTube Shorts, the AI veil on (report 2026-10-26): the
// search history suggested "ai generated" under the box, the AI walker read
// it as the platform's disclosure and grew it to the search box. A label
// inside a search control, its suggestion list or any typed field is a
// query, never a disclosure, for the AI walker and the ad badge walker alike.
describe("labels inside a search control are not disclosures", () => {
  function setup() {
    const PV = loadVeil({ host: "www.youtube.com" });
    try { window.happyDOM.setURL("https://www.youtube.com/shorts/9ST0vf0qn8M"); } catch (e) {}
    PV.uiPrefs = { aiVeil: true };
    return PV;
  }
  it("a suggestion reading 'ai generated' under the search box covers nothing", () => {
    const PV = setup();
    const out = detect(PV, `<ytd-masthead><yt-searchbox role="search" ${R(640, 4, 640, 48)}>
      <textarea role="combobox" aria-expanded="true" aria-autocomplete="list" ${R(650, 16, 566, 24)}></textarea>
      <div role="listbox" ${R(640, 52, 640, 240)}><div ${R(640, 52, 640, 40)}><span ${R(660, 62, 90, 20)}>ai generated</span></div></div>
    </yt-searchbox></ytd-masthead>`);
    expect(out).toEqual([]);
  });
  it("the same label on a card still grows to the card", () => {
    const PV = setup();
    const out = detect(PV, `<div id="card" ${R(0, 100, 500, 400)}><span ${R(10, 110, 90, 20)}>AI-generated</span><img ${R(0, 140, 500, 300)}></div>`);
    expect(out).toEqual([{ tag: "div", id: "card", why: "ai-label: AI-generated" }]);
  });
  it("a 'Sponsored' suggestion in a search list is not an ad badge", () => {
    const PV = loadVeil({ host: "www.example.com" });
    const out = detect(PV, `<div role="search" ${R(0, 0, 600, 48)}><input role="combobox" ${R(0, 0, 500, 40)}><ul role="listbox" ${R(0, 48, 600, 200)}><li ${R(0, 48, 600, 40)}><span class="ad-label" ${R(10, 58, 70, 20)}>Sponsored</span></li></ul></div>`);
    expect(out).toEqual([]);
  });
});

// YouTube TV's "Sponsored" tray (2026-11-06): the video's ad chrome, outside the player; the video veil covers its slot, not a second cover.
describe("YouTube TV Sponsored tray", () => {
  it("is never covered by the label pass", () => {
    const PV = loadVeil({ host: "tv.youtube.com" });
    const out = detect(PV, `<div id="top" ${R(0, 0, 180, 134)}><ytu-ads-title-tray ${R(0, 0, 180, 134)}><div ${R(10, 10, 160, 40)}><span ${R(10, 10, 104, 23)}>Sponsored</span></div></ytu-ads-title-tray></div>`);
    expect(out).toEqual([]);
  });
});

// A slot drawn in a frame of the site's own (Pandora's display unit, reports 2026-09-12 and 2026-11-18): the slot and its frame
// stay on the page between ads, and a cover over an empty one covers nothing. The frame's document is a made-up one here
// (happy-dom loads no frame); its elements take their boxes from data-rect like the page's.
describe("a slot whose ad is in the site's own frame", () => {
  const SLOT = (src) => `<div class="DisplayAdController" ${R(0, 0, 1200, 0)}><div id="slot" class="region-adBanner region-adBanner--active" data-qa="display_ad_container_2" ${R(900, 100, 300, 250)}><iframe id="frame" src="${src}" ${R(900, 100, 300, 250)}></iframe></div></div>`;
  const mount = (PV, src, inner, ready = "complete") => {
    document.body.innerHTML = SLOT(src);
    const d = document.implementation.createHTMLDocument("frame");
    d.body.innerHTML = inner;
    Object.defineProperty(d, "readyState", { value: ready, configurable: true });
    Object.defineProperty(document.getElementById("frame"), "contentDocument", { value: d, configurable: true });
    const { targets } = PV.collectTargets();
    return Array.from(targets).map((t) => t.id);
  };
  const OWN = "https://music.example/ads/frame.html";
  const EMPTY = `<div id="adContainer" ${R(0, 0, 300, 250)}><div id="gpt-container" ${R(0, 0, 300, 250)}></div></div><iframe ${R(0, 0, 0, 0)}></iframe>`;
  const FILLED = `<div id="adContainer" ${R(0, 0, 300, 250)}><div id="gpt-container" ${R(0, 0, 300, 250)}><iframe id="google_ads_iframe_/1/x_0" ${R(0, 0, 300, 250)}></iframe></div></div><iframe ${R(0, 0, 0, 0)}></iframe>`;

  it("is covered while the frame holds a creative", () => {
    const PV = loadVeil({ host: "music.example" });
    expect(mount(PV, OWN, FILLED)).toEqual(["slot"]);
  });
  it("is left alone while the frame holds nothing", () => {
    const PV = loadVeil({ host: "music.example" });
    expect(mount(PV, OWN, EMPTY)).toEqual([]);
  });
  it("is covered again on the next look once the frame fills", () => {
    const PV = loadVeil({ host: "music.example" });
    expect(mount(PV, OWN, EMPTY)).toEqual([]);
    document.getElementById("frame").contentDocument.getElementById("gpt-container").innerHTML = `<img ${R(0, 0, 300, 250)}>`;
    expect(Array.from(PV.collectTargets().targets).map((t) => t.id)).toEqual(["slot"]);
  });
  it("is covered as before while the frame is still loading, or is another site's, or has no address", () => {
    const PV = loadVeil({ host: "music.example" });
    expect(mount(PV, OWN, EMPTY, "loading")).toEqual(["slot"]);
    expect(mount(PV, "https://ads.example.net/frame.html", EMPTY)).toEqual(["slot"]);
    expect(mount(PV, "about:blank", EMPTY)).toEqual(["slot"]);
  });
  it("is covered when the frame holds only words", () => {
    const PV = loadVeil({ host: "music.example" });
    expect(mount(PV, OWN, `<div id="adContainer" ${R(0, 0, 300, 250)}>Advertisement: try the new plan</div>`)).toEqual(["slot"]);
  });
});

// Fox News on an iPhone (three reports 2026-11-22): GumGum's in-screen banner at the foot of the page, and a frame over the whole
// screen whose document a script wrote (no address), both bare. Twitch's pushdown banner (a report 2026-11-21) beside them.
describe("ads drawn in frames with no address", () => {
  const PHONE = { host: "www.foxnews.com", width: 440, height: 796 };
  const mountFrame = (PV, html, frameId, inner) => {
    document.body.innerHTML = html;
    const d = document.implementation.createHTMLDocument("frame");
    d.body.innerHTML = inner;
    Object.defineProperty(document.getElementById(frameId), "contentDocument", { value: d, configurable: true });
    const { targets, why } = PV.collectTargets();
    return Array.from(targets).map((t) => ({ id: t.id || t.className, why: why.get(t) }));
  };
  const OVERLAY = `<div id="layer" class="notranslate" style="position:fixed" ${R(0, 0, 440, 796)}><iframe id="f" ${R(0, 0, 440, 796)}></iframe></div>`;
  it("GumGum's creative frame is covered by its own attribute", () => {
    const PV = loadVeil(PHONE);
    const out = detect(PV, `<div id="k1" ${R(0, 0, 0, 0)}><div id="ad_is_1" ${R(0, 676, 440, 120)}><iframe id="ad_is_1_ifr" data-gg-moat-ifr="" ${R(0, 676, 440, 120)}></iframe></div></div>`);
    expect(out).toEqual([{ tag: "iframe", id: "ad_is_1_ifr", why: "slot-selector: iframe[data-gg-moat-ifr]" }]);
  });
  it("a full-screen fixed layer whose written frame holds an ad server's picture is covered whole", () => {
    const PV = loadVeil(PHONE);
    expect(mountFrame(PV, OVERLAY, "f", `<a href="https://adclick.g.doubleclick.net/x"><img src="https://tpc.googlesyndication.com/a.jpg" ${R(0, 0, 440, 700)}></a>`))
      .toEqual([{ id: "layer", why: "written-ad-frame: img from tpc.googlesyndication.com" }]);
  });
  it("an AdChoices link in the frame is enough", () => {
    const PV = loadVeil(PHONE);
    expect(mountFrame(PV, OVERLAY, "f", `<div ${R(0, 0, 440, 700)}>Big offer</div><a href="https://youradchoices.com/"><img ${R(420, 0, 15, 15)}></a>`))
      .toEqual([{ id: "layer", why: "written-ad-frame: AdChoices link" }]);
  });
  it("a tracking pixel alone, or a frame of the page's own, is no ad", () => {
    const PV = loadVeil(PHONE);
    expect(mountFrame(PV, OVERLAY, "f", `<img src="https://ad.doubleclick.net/p.gif" ${R(0, 0, 1, 1)}><div ${R(0, 0, 440, 700)}>Sign up for our newsletter</div>`)).toEqual([]);
    expect(mountFrame(PV, OVERLAY, "f", `<img src="https://static.foxnews.com/a.jpg" ${R(0, 0, 440, 700)}>`)).toEqual([]);
  });
  it("a screen-sized written frame that is not in a fixed layer is left alone", () => {
    const PV = loadVeil(PHONE);
    expect(mountFrame(PV, `<div id="layer" ${R(0, 0, 440, 796)}><iframe id="f" ${R(0, 0, 440, 796)}></iframe></div>`, "f",
      `<img src="https://tpc.googlesyndication.com/a.jpg" ${R(0, 0, 440, 700)}>`)).toEqual([]);
  });
  it("a written frame inside an ad slot is left to the slot pass", () => {
    const PV = loadVeil(PHONE);
    const out = mountFrame(PV, `<div id="slot" data-google-query-id="q" ${R(0, 100, 300, 250)}><iframe id="f" ${R(0, 100, 300, 250)}></iframe></div>`, "f",
      `<img src="https://tpc.googlesyndication.com/a.jpg" ${R(0, 0, 300, 250)}>`);
    expect(out).toEqual([{ id: "slot", why: "slot-selector: [data-google-query-id]" }]);
  });
  it("Twitch: the visible pushdown banner is covered, the hidden one is not", () => {
    const PV = loadVeil({ host: "www.twitch.tv" });
    const out = detect(PV, `<section ${R(0, 0, 1523, 196)}><iframe id="hid" class="stream-display-ad__iframe_pushdown" ${R(0, 0, 728, 90)}></iframe><iframe id="vis" class="stream-display-ad__iframe_pushdown stream-display-ad__iframe_pushdown--visible" src="https://d3qpnbd0lnus53.cloudfront.net/x" ${R(0, 0, 728, 90)}></iframe></section>`);
    expect(out).toEqual([{ tag: "iframe", id: "vis", why: "twitch-pushdown" }]);
  });
});

// In-page pops (src/inpage-pops.js, spec section 30, 2026-11-22): a unit held clear is not covered (its cover goes), a unit held by a
// cover (over a page that stopped scrolling) is covered whole, and the display rules' signal is what names an ad in a unit.
describe("in-page pops and the covers", () => {
  it("covers nothing inside a unit held clear", () => {
    const PV = loadVeil();
    expect(detect(PV, `<div data-prism-held="clear" ${R(0, 0, 390, 800)}><ins class="adsbygoogle" id="s1" ${R(0, 0, 300, 250)}></ins></div>`)).toEqual([]);
  });
  it("covers a unit held by a cover whole, with its reason", () => {
    const PV = loadVeil();
    document.body.innerHTML = `<div id="u" data-prism-held="cover" ${R(0, 0, 390, 800)}><a href="https://ads.example/x" ${R(0, 0, 390, 800)}>x</a></div>`;
    const u = document.getElementById("u");
    PV.inpageCovers = new Map([[u, { reason: "at the top of the stack" }]]);
    const { targets, why } = PV.collectTargets();
    expect(Array.from(targets).map((t) => [t.id, why.get(t)])).toEqual([["u", "in-page pop: at the top of the stack"]]);
    expect(u.__prismForceOverlay).toBe(true);
  });
  it("names an ad server's element, an AdChoices link or a slot selector in a unit, and nothing in a plain box", () => {
    const PV = loadVeil();
    document.body.innerHTML = `
      <div id="a" ${R(0, 0, 300, 300)}><img src="https://tpc.googlesyndication.com/x.jpg" ${R(0, 0, 300, 250)}></div>
      <div id="b" ${R(0, 0, 300, 300)}><a href="https://youradchoices.com/"><img ${R(0, 0, 15, 15)}></a></div>
      <div id="c" ${R(0, 0, 300, 300)}><ins class="adsbygoogle" ${R(0, 0, 300, 250)}></ins></div>
      <div id="d" ${R(0, 0, 300, 300)}><a href="https://userway.org/"><img src="https://cdn.userway.org/i.png" ${R(0, 0, 50, 50)}></a></div>`;
    const sig = (id) => PV.adSignalIn(document.getElementById(id));
    expect(sig("a")).toBe("img from tpc.googlesyndication.com");
    expect(sig("b")).toBe("AdChoices link");
    expect(sig("c")).toBe("slot ins.adsbygoogle");
    expect(sig("d")).toBe("");
  });
});

// 2026-11-22, Fox News on an iPhone: the page changed a large ad for a small one in a covered slot and the page under it jumped.
describe("a covered slot that gets smaller", () => {
  it("is held at the tallest it has been while covered, and put back as it was when the cover goes", () => {
    const PV = loadVeil({ host: "news.example", width: 440, height: 800 });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    const el = document.createElement("div"); el.style.minHeight = "50px"; document.body.appendChild(el);
    const H = PV.__slotHeight, r = (h) => ({ height: h });
    H.hold(el, r(250)); H.hold(el, r(600));
    expect(el.style.minHeight).toBe("50px");                     // growing is the page's own; nothing is set
    H.hold(el, r(250));
    expect(el.style.getPropertyValue("min-height")).toBe("600px");
    H.free(el);
    expect(el.style.minHeight).toBe("50px");
    H.hold(el, r(600)); H.hold(el, r(0));                        // closed to nothing: the ad is gone, the slot is let go
    expect(el.style.minHeight).toBe("50px");
    H.free(el); H.hold(el, r(1200)); H.hold(el, r(300));         // taller than the screen: never held
    expect(el.style.minHeight).toBe("50px");
  });
});

// 2026-11-22, a report from Fox News on an iPhone (0.9.66): the sponsored stories' left edge showed beside their cover. The
// section is 408 px wide and the unit inside it 441.
describe("a cover whose element holds wider content", () => {
  it("reaches the content's edges, never past the screen's, and stays its element's size where nothing sticks out", () => {
    const PV = loadVeil({ host: "news.example", width: 440, height: 800 });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    PV.pickArt = () => ""; PV.videoAdBreak = () => {}; PV.vidVeil = () => null;
    document.body.innerHTML = `<div class="ad-unit" id="wide" data-rect="16,100,408,300"><div data-rect="4,110,441,115"></div></div>` +
      `<div class="ad-unit" id="snug" data-rect="16,500,408,250"><div data-rect="16,500,408,250"></div></div>`;
    const real = Element.prototype.getBoundingClientRect;   // the test DOM lays nothing out: a cover takes its element's box
    Element.prototype.getBoundingClientRect = function () { const u = this.hasAttribute && this.hasAttribute("data-prism-veil") && this.parentNode; return u && u.getAttribute ? real.call(u) : real.call(this); };
    try {
      PV.sweep();
      const c = (id) => document.querySelector("#" + id + " > [data-prism-why]");
      expect([c("wide").style.left, c("wide").style.right]).toEqual(["-12px", "-16px"]);   // 441 wide from 4 ends at 445: cut at the screen's 440
      expect([c("snug").style.left, c("snug").style.right]).toEqual(["0px", "0px"]);
    } finally { Element.prototype.getBoundingClientRect = real; }
  });
});

// 2026-11-22, an iPhone: the source reliability card stayed on the screen with no way to take it away. A touch brings the card
// as a pointer resting would, and nothing follows to take it off.
describe("a card shown by the pointer resting on something", () => {
  const withMarks = (hover) => {
    const PV = loadVeil({ host: "news.example", width: 440, height: 800 });
    window.matchMedia = (q) => ({ matches: /hover: none/.test(q) ? !hover : false, addEventListener() {}, addListener() {} });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "marks.js"), "utf8"));
    return PV;
  };
  const cards = () => Array.from(document.documentElement.querySelectorAll("[data-prism-ui]")).filter((e) => /Source reliability/.test(e.textContent)).length;
  const ms = [{ src: { short: "Iffy Index" }, loaded: true, tier: "", label: "" }];
  // 2026-11-22, an iPhone: the tap that cleared a card also opened a link of the page under it
  it("on a touch screen has a clear layer under it that takes the one press, so nothing of the page is pressed", async () => {
    const PV = withMarks(false);
    const a = document.createElement("div"); document.body.appendChild(a);
    const tips = () => Array.from(document.documentElement.querySelectorAll("[data-prism-ui]")).filter((e) => e.textContent === "A line of help").length;
    const layer = () => Array.from(document.documentElement.querySelectorAll("[data-prism-ui]")).find((e) => e.style.zIndex === "2147483646" && !e.textContent);
    PV.showTextTip(a, "A line of help");
    expect(tips()).toBe(1);
    expect(layer()).toBeTruthy();
    const first = new Event("click", { bubbles: true, cancelable: true }); layer().dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(tips()).toBe(1);                                   // the click of the press that brought the card
    await new Promise((r) => setTimeout(r, 400));
    window.dispatchEvent(new Event("touchstart"));           // the press itself takes nothing away: the layer's click does
    expect(tips()).toBe(1);
    const tap = new Event("click", { bubbles: true, cancelable: true }); layer().dispatchEvent(tap);
    expect(tap.defaultPrevented).toBe(true);
    expect(tips()).toBe(0);
    expect(layer()).toBeFalsy();
    PV.showTextTip(a, "A line of help");
    window.dispatchEvent(new Event("scroll"));
    expect(tips()).toBe(0);
    expect(layer()).toBeFalsy();
  });
  it("is not shown on a touch screen, and elsewhere goes at the next press", () => {
    let PV = withMarks(false);
    const a = document.createElement("div"); document.body.appendChild(a);
    PV.showCredTip(a, ms, "");
    expect(cards()).toBe(0);
    PV = withMarks(true);
    PV.showCredTip(a, ms, "");
    expect(cards()).toBe(1);
    window.dispatchEvent(new Event("pointerdown"));
    expect(cards()).toBe(0);
  });
});

// 2026-11-22, a report from Facebook's Reels on an iPhone (0.9.66): the cover's symbol sat behind the page's fixed header and
// under a clear layer over the player, and a tap on it did nothing.
describe("a cover's symbol under something of the page's", () => {
  it("is moved clear of a fixed bar and given a box of PRISM's own on top that opens the panel; none when the symbol is free", () => {
    const PV = loadVeil({ host: "news.example", width: 440, height: 800 });
    (0, eval)(require("node:fs").readFileSync(require("node:path").join(require("node:path").dirname(require("node:url").fileURLToPath(import.meta.url)), "..", "src", "covers.js"), "utf8"));
    PV.pickArt = () => ""; PV.videoAdBreak = () => {}; PV.vidVeil = () => null;
    document.body.innerHTML = `<div id="bar" style="position:fixed" data-rect="0,0,428,60"><h2 id="h">Reels</h2></div><div class="ad-unit" id="u" data-rect="0,0,300,250"></div>`;
    const real = Element.prototype.getBoundingClientRect, realHit = document.elementFromPoint;
    Element.prototype.getBoundingClientRect = function () {
      if (this.parentNode && this.parentNode.hasAttribute && this.parentNode.hasAttribute("data-prism-veil") && this === this.parentNode.firstElementChild) { const y = parseInt(this.style.top, 10) || 6; return { left: 6, top: y, width: 28, height: 28, right: 34, bottom: y + 28 }; }
      const u = this.hasAttribute && this.hasAttribute("data-prism-veil") && this.parentNode; return u && u.getAttribute ? real.call(u) : real.call(this);
    };
    let over = "h";
    document.elementFromPoint = (x, y) => (over === "h" && y < 60 ? document.getElementById("h") : over ? document.getElementById("u").querySelector("[data-prism-why]") : null);
    try {
      PV.sweep();
      const cover = document.querySelector("#u [data-prism-why]"), lbl = cover.firstElementChild, box = PV.__raised();
      expect(lbl.style.top).toBe("66px");                       // below the bar's 60
      expect(box && box.cover).toBe(cover);
      expect([box.el.style.left, box.el.style.top, box.el.style.display]).toEqual(["0px", "58px", "block"]);   // 44 px, centred on the symbol
      over = "free";
      PV.sweep();
      expect(PV.__raised()).toBe(null);
    } finally { Element.prototype.getBoundingClientRect = real; document.elementFromPoint = realHit; }
  });
});
