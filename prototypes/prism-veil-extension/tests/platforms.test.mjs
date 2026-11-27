import { describe, it, expect } from "vitest";
import { loadVeil, detect } from "./harness.mjs";

// The ad platform survey of 2026-11-27: one case for each platform's unit, built from the structure and the sizes read on the
// named site in headless Firefox. A phone is 440x836, a computer 1366x860.
const R = (x, y, w, h) => `data-rect="${x},${y},${w},${h}"`;
const PHONE = { width: 440, height: 836 }, DESK = { width: 1366, height: 860 };
const ZW = (w, h, iw) => `<div id="zw" class="widget-loaded" ${R(16, 100, w, h)}><div class="zerghead" ${R(16, 100, w, 66)}><span class="zergheader">Sponsored Content</span></div>` +
  `<div id="z1" class="zergentity" ${R(16, 170, iw, 259)}><a class="zergimg" href="https://www.zergnet.com/i/8749571/61969/0/0/225327/1" ${R(16, 170, iw, 196)}><img ${R(16, 170, iw, 196)}></a></div>` +
  `<div id="z2" class="zergentity" ${R(16 + iw + 16, 170, iw, 259)}><a class="zergimg" href="https://www.zergnet.com/i/8808688/61969/0/0/225327/2" ${R(16 + iw + 16, 170, iw, 196)}><img ${R(16 + iw + 16, 170, iw, 196)}></a></div></div>`;
const CASES = [
  { name: "Taboola's display frame, the one item of its widget with no paid label (nbcnews.com)", host: "www.nbcnews.com", win: PHONE,
    html: `<div id="trc_wrapper_1" class="trc_rbox thumbs-feed-01-b_new trc-content-sponsored" ${R(18, 100, 404, 613)}><div id="rbox-t2v" class="trc_rbox_div" ${R(14, 100, 412, 610)}>` +
      `<div id="cube" class="videoCube trc_spotlight_item" ${R(18, 100, 404, 600)}><iframe id="tb" class="taboola-connect-iframe" src="https://cdn.taboola-display.com/ext/dynamic-content-loader-v2.html" ${R(18, 100, 404, 600)}></iframe></div></div></div>`,
    want: [["cube", "taboola-item: Taboola's paid label on the item"]] },
  { name: "Taboola's display frame with no widget around it", host: "www.nbcnews.com", win: PHONE,
    html: `<div id="box" ${R(18, 100, 404, 600)}><iframe id="tb" class="taboola-connect-iframe" src="https://cdn.taboola-display.com/ext/dynamic-content-loader-v2.html" ${R(18, 100, 404, 600)}></iframe></div>`,
    want: [["tb", /^slot-selector: iframe/]] },
  { name: "Media.net's frame, which has no address (forbes.com)", host: "www.forbes.com", win: PHONE,
    html: `<div id="mobile-medianet" ${R(16, 100, 408, 252)}><iframe id="_mN_main_1795755601946246324" title="MediaNetIframe" ${R(16, 100, 408, 250)}></iframe></div>`,
    want: [["_mN_main_1795755601946246324", "slot-selector: iframe[id^='_mN_']"]] },
  { name: "Polar's paid post in a river of stories (cnbc.com)", host: "www.cnbc.com", win: PHONE,
    html: `<div id="river" ${R(21, 0, 398, 2790)}><div id="story" ${R(21, 0, 398, 134)}><a href="/2026/11/26/a-story.html" ${R(21, 0, 263, 59)}>A story</a></div>` +
      `<div id="paid" class="mediavoice-native-ad" data-mediavoice-render-injection-id="55f14bca" ${R(21, 140, 398, 134)}><a href="https://www.cnbc.com/advertorial/2026/08/10/x" rel="nofollow" ${R(21, 140, 263, 59)}>Act like a GM</a>` +
      `<a class="Card-eyebrow plr_eyebrow" href="https://www.cnbc.com/advertorial/2026/08/10/x" ${R(21, 243, 165, 14)}><div class="plr-disclosure" ${R(21, 243, 165, 14)}>Paid Post For Comcast Business</div></a></div></div>`,
    want: [["paid", "ad-stack: Polar (MediaVoice)"]] },
  { name: "Revcontent's paid items in a feed taller than the screen, and not an item that links elsewhere (tasteofhome.com)", host: "www.tasteofhome.com", win: PHONE,
    html: `<div id="rc-widget-dd9011" data-rc-widget="" data-widget-id="286741" ${R(21, 100, 398, 3605)}><div id="rc_cont_286741" class="rc-wc rc-uid-286741" ${R(21, 100, 398, 3605)}>` +
      `<div class="rc-feed-row" ${R(21, 146, 398, 355)}><div id="rc1" class="rc-item rc-sponsored" ${R(21, 146, 398, 335)}><a class="rc-cta" href="https://smeagol.revcontent.com/v3/HPkPZ4" rel="nofollow sponsored" ${R(21, 146, 398, 330)}><img ${R(21, 146, 398, 224)}>A headline</a></div></div>` +
      `<div class="rc-feed-row" ${R(21, 501, 398, 355)}><div id="own" class="rc-item" ${R(21, 501, 398, 335)}><a class="rc-cta" href="https://www.tasteofhome.com/a-story/" ${R(21, 501, 398, 330)}>The site's story</a></div></div>` +
      `<div class="rc-feed-row" ${R(21, 856, 398, 355)}><div id="rc2" class="rc-item rc-sponsored" ${R(21, 856, 398, 335)}><a class="rc-cta" href="https://trends.revcontent.com/click.php?d=1" ${R(21, 856, 398, 330)}>Another</a></div></div></div></div>`,
    want: [["rc1", "revcontent-item: Revcontent's own click address on the item"], ["rc2", "revcontent-item: Revcontent's own click address on the item"]] },
  { name: "Big Happy's strip (independent.co.uk)", host: "www.independent.co.uk", win: PHONE,
    html: `<div id="bh-wrapper-iframe" class="bh-div-wrapper" ${R(32, 300, 375, 150)}><iframe id="bh-div" src="https://cdn.bighappy.co/creatives/cr261125001/index.html?sid=1" ${R(32, 300, 375, 150)}></iframe></div>`,
    want: [["bh-div", "slot-selector: iframe[src*='bighappy.co']"]] },
  { name: "Taboola's paid card taller than the screen, its label outside the item (cbssports.com)", host: "www.cbssports.com", win: PHONE,
    html: `<div id="taboola-below-homepage-feed-pl7" class="tbl-feed-card trc_related_container trc_elastic_sponsored" ${R(12, 100, 416, 1001)}><div id="trc_wrapper_1" class="trc_rbox sponsored-premium-card-1x1-delta trc-content-sponsored" ${R(13, 101, 414, 999)}>` +
      `<div class="trc_rbox_outer" ${R(13, 101, 414, 999)}><div id="tall" class="videoCube trc_spotlight_item origin-undefined" ${R(13, 101, 414, 999)}><a class="item-thumbnail-href" href="https://ads.example/x" ${R(13, 101, 414, 828)}></a></div></div>` +
      `<div class="logoDiv link-disclosure attribution-disclosure-link-sponsored" ${R(13, 1100, 0, 0)}><a class="trc_mobile_disclosure_link" href="https://popup.taboola.com/en/" ${R(13, 1100, 0, 0)}><span>Sponsored Links</span></a></div></div></div>`,
    want: [["tall", "taboola-item: Taboola's paid label on the item"]] },
  { name: "Taboola's mixed card, where the site's own story has no paid label, names no item (cbssports.com)", host: "www.cbssports.com", win: PHONE,
    html: `<div id="taboola-below-homepage-feed" class="trc_related_container tbl-feed-container" ${R(0, 100, 440, 6748)}><div id="taboola-below-homepage-feed-pl5" class="tbl-feed-card trc_related_container" ${R(12, 100, 416, 313)}><div id="trc_wrapper_2" class="trc_rbox alternating-premium-card-1x2-delta trc-content-hybrid" ${R(12, 100, 416, 313)}>` +
      `<div id="h1" class="videoCube trc_spotlight_item origin-default" ${R(12, 100, 204, 313)}><a href="https://ads.example/y" ${R(12, 100, 204, 150)}></a></div><div id="h2" class="videoCube trc_spotlight_item origin-default" ${R(224, 100, 204, 313)}><a href="/a-story" ${R(224, 100, 204, 150)}></a></div></div></div></div>`,
    not: ["h1", "h2"] },
  { name: "Future's sponsored card, a Google ad drawn into the page, and not an empty slot (pcgamer.com)", host: "www.pcgamer.com", win: PHONE,
    html: `<div class="sponsored-card" data-ad-slot-path="feed-sponsored-post" ${R(8, 100, 424, 307)}><div class="sponsored-post" ${R(8, 100, 424, 297)}><div id="bx" class="bordeaux-slot bordeaux-filled-slot" ${R(8, 100, 424, 297)}>` +
      `<div id="bordeaux-ad-4" ${R(8, 100, 424, 297)}><div ${R(8, 100, 424, 297)}><a href="https://adclick.g.doubleclick.net/pcs/click?xai=1" ${R(8, 100, 424, 297)}><img ${R(8, 100, 424, 239)}>A headline</a></div></div></div></div></div>` +
      `<div class="sponsored-card" ${R(8, 500, 424, 308)}><div id="empty" class="bordeaux-slot bordeaux-filled-slot" ${R(8, 500, 424, 1)}><div ${R(8, 500, 1, 1)}></div></div></div>`,
    want: [["bx", "ad-stack: Future (Bordeaux)"]] },
  { name: "ZergNet's box of paid links, most of a phone's screen: each item (tmz.com)", host: "www.tmz.com", win: PHONE,
    html: ZW(408, 604, 196).replace('id="zw"', 'id="zergnet-widget-61969"'),
    want: [["z1", "zergnet-item: ZergNet's own click address on the item"], ["z2", "zergnet-item: ZergNet's own click address on the item"]] },
  { name: "ZergNet's box on a computer: the box, as one unit", host: "www.tmz.com", win: DESK,
    html: ZW(640, 340, 300).replace('id="zw"', 'id="zergnet-widget-61969"'),
    want: [["zergnet-widget-61969", "ad-stack: ZergNet"]] },
  { name: "a list item the site marks as paid, and not the one beside it (dailymail.com)", host: "www.dailymail.com", win: PHONE,
    html: `<ul id="p-21" ${R(2, 100, 436, 3450)}><li id="own" ${R(2, 100, 436, 115)}><a href="/news/article-1/x.html" ${R(2, 100, 436, 114)}>A story</a></li>` +
      `<li id="paid" data-is-sponsored="true" ${R(2, 215, 436, 115)}><a href="/lifestyle/article-2/y.html" ${R(2, 215, 436, 114)}><img ${R(2, 215, 154, 116)}><span class="sponsored" ${R(160, 300, 245, 24)}>Ad Feature</span></a></li></ul>`,
    want: [["paid", "slot-selector: li[data-is-sponsored='true']"]] },
  { name: "OpenWeb's ad unit, and not its comment box (nypost.com)", host: "nypost.com", win: PHONE,
    html: `<div id="ow" data-openweb-ad="" data-row="1" data-column="1" ow-ad-unit-rendered="true" ${R(10, 100, 420, 300)}><div data-mini-ad-unit="true" ow-ad-unit-root="true" ${R(10, 100, 420, 300)}><div class="spotim-light" ${R(10, 100, 420, 300)}>` +
      `<div ow-ad-unit-wrapper="true" ${R(10, 100, 420, 300)}><iframe ${R(70, 100, 300, 250)}></iframe></div></div></div></div><div id="nypost-openweb-conversation" ${R(10, 500, 420, 450)}><a href="/x" ${R(10, 500, 100, 20)}>Comments</a></div>`,
    want: [["ow", "ad-stack: OpenWeb"]] },
  { name: "Nativo's paid unit in a story (thehill.com)", host: "thehill.com", win: PHONE,
    html: `<div id="ntv1162786-688092-78148" class="ntv-rr noskim" data-ntv-id="1162786" ${R(20, 300, 400, 139)}><span ${R(20, 300, 150, 14)}>SPONSORED CONTENT</span><a href="https://jadserve.postrelease.com/trk?ntv_at=1" ${R(20, 320, 400, 110)}><img ${R(20, 320, 120, 90)}>Small Business Insurance</a></div>`,
    want: [["ntv1162786-688092-78148", "ad-stack: Nativo"]] },
  { name: "Nativo's paid unit in the side column, its links opened by Nativo's script (chicagotribune.com)", host: "www.chicagotribune.com", win: DESK,
    html: `<aside ${R(1000, 100, 305, 2095)}><article id="ntv1265096-695308-99884" class="ntv-rail noskim" data-ntv-id="1265096-695308" ${R(1000, 300, 300, 355)}><h3 ${R(1000, 300, 300, 28)}><a href="javascript:ntv.Stories._instances['x'].open()" ${R(1000, 300, 206, 19)}>Sponsored Content</a></h3>` +
      `<figure ${R(1000, 330, 300, 169)}><a href="javascript:ntv.Stories._instances['x'].open()" ${R(1000, 330, 300, 169)}><img src="https://ntvcld-a.akamaihd.net/image/upload/x.jpg" ${R(1000, 330, 300, 169)}></a></figure></article></aside>`,
    want: [["ntv1265096-695308-99884", "ad-stack: Nativo"]] },
  ...[["flashtalking", "https://cdn.flashtalking.com/249769/6594028/index.html", "iframe[src*='flashtalking.com']"], ["sizmek", "https://secure-ds.serving-sys.com/BurstingRes/x.html", "iframe[src*='serving-sys.com']"],
    ["celtra", "https://ads.celtra.com/abc/web.html", "iframe[src*='celtra.com']"], ["adform", "https://s1.adform.net/banners/x.html", "iframe[src*='adform.net']"], ["gumgum", "https://g2.gumgum.com/render", "iframe[src*='gumgum.com']"],
    ["jivox", "https://as.jivox.com/unit/x.html", "iframe[src*='jivox.com']"], ["sharethrough", "https://native.sharethrough.com/x", "iframe[src*='sharethrough.com']"], ["undertone", "https://cdn.undertone.com/x.html", "iframe[src*='undertone.com']"],
    ["kargo", "https://storage.cloud.kargo.com/ad/x.html", "iframe[src*='kargo.com']"], ["seedtag", "https://s.seedtag.com/c/x.html", "iframe[src*='seedtag.com']"], ["medianet", "https://contextual.media.net/x.html", "iframe[src*='contextual.media.net']"],
    ["nativo", "https://jadserve.postrelease.com/x", "iframe[src*='postrelease.com']"], ["adfox", "https://ads.adfox.ru/1/x", "iframe[src*='adfox.ru']"], ["yandex", "https://an.yandex.ru/x", "iframe[src*='an.yandex.ru']"],
  ].map(([id, src, sel]) => ({ name: "a frame from the platform's own serving host: " + id, host: "example.com", win: PHONE,
    html: `<div ${R(70, 300, 300, 250)}><iframe id="${id}" src="${src}" ${R(70, 300, 300, 250)}></iframe></div>`, want: [[id, "slot-selector: " + sel]] })),
  { name: "Google's search ads frame on a site (snopes.com)", host: "www.snopes.com", win: PHONE,
    html: `<div id="cdm-container" ${R(15, 300, 410, 688)}><iframe id="master-1" src="https://syndicatedsearch.goog/afs/ads?sjk=1" ${R(15, 300, 410, 688)}></iframe></div>`,
    want: [["master-1", "slot-selector: iframe[src*='syndicatedsearch.goog']"]] },
  { name: "Seznam's ad slot (seznam.cz)", host: "www.seznam.cz", win: PHONE,
    html: `<div id="ssp" class="ad-content text-center ssp-advert" ${R(0, 300, 440, 440)}><a href="https://ssp.seznam.cz/click?x=1" ${R(0, 300, 440, 440)}><img ${R(0, 300, 440, 440)}></a></div>`,
    want: [["ssp", "ad-stack: Seznam SSP"]] },
  { name: "VDO.AI's floating ad player (news18.com)", host: "www.news18.com", win: PHONE,
    html: `<vdo id="_vdo_ads_player_ai_38497" class="vdo_video_unit vdo_floating" ${R(180, 60, 256, 192)}><iframe ${R(180, 60, 256, 144)}></iframe></vdo>`,
    want: [["_vdo_ads_player_ai_38497", "ad-stack: VDO.AI"]] },
  { name: "Naver's ad frame, most of a phone's screen (m.naver.com)", host: "m.naver.com", win: PHONE,
    html: `<div id="gfp_ad_m_naver_home_feed_1" ${R(0, 300, 440, 713)}><iframe id="gfp_ad_m_naver_home_feed_1_tgt" ${R(0, 300, 440, 713)}></iframe></div>`,
    want: [["gfp_ad_m_naver_home_feed_1_tgt", "slot-selector: iframe[id^='gfp_ad_']"]] },
  // pass 3
  { name: "Naver's ad frame on a computer, with no address (naver.com)", host: "www.naver.com", win: DESK,
    html: `<div id="right-ad-1" ${R(900, 200, 420, 240)}><iframe id="right-ad-1_tgtLREC" title="AD" ${R(900, 200, 420, 240)}></iframe></div>`,
    want: [["right-ad-1_tgtLREC", "slot-selector: iframe[id$='_tgtLREC']"]] },
  { name: "Sina's own ad tag, a banner and a line of text (sina.com.cn)", host: "www.sina.com.cn", win: DESK,
    html: `<div id="adx_45825" ${R(180, 100, 1000, 97)}><ins id="s1" class="sinaads sinaads-done" data-ad-pdps="PDPS000000045825" ${R(180, 100, 1000, 97)}><ins ${R(180, 100, 1000, 97)}><iframe ${R(180, 100, 1000, 97)}></iframe></ins></ins></div>` +
      `<ul><li ${R(180, 400, 360, 26)}><ins id="s2" class="sinaads sinaads-done" data-ad-type="embed" ${R(180, 400, 340, 26)}><ins ${R(180, 400, 360, 26)}><a href="https://sax.sina.com.cn/click?x=1" ${R(180, 400, 300, 26)}>A paid line</a></ins></ins></li></ul>` +
      `<ins id="s3" class="sinaads" ${R(180, 600, 300, 250)}></ins>`,
    want: [["s1", "ad-stack: Sina"]] },
  ...[["revive", `<ins id="revive" data-revive-zoneid="12" data-revive-id="abc" ${R(70, 300, 300, 250)}><a href="https://ads.example.org/ck.php?n=1" ${R(70, 300, 300, 250)}><img ${R(70, 300, 300, 250)}></a></ins>`, "slot-selector: ins[data-revive-zoneid]"],
    ["aads", `<iframe id="aads" data-aa="123456" src="https://ad.a-ads.com/123456?size=300x250" ${R(70, 300, 300, 250)}></iframe>`, "slot-selector: iframe[data-aa]"],
    ["kakao", `<ins id="kakao" class="kakao_ad_area" data-ad-unit="DAN-x" ${R(70, 300, 300, 250)}><iframe ${R(70, 300, 300, 250)}></iframe></ins>`, /^slot-selector: /],
    ["mrg", `<ins id="mrg" class="mrg-tag" data-ad-slot="1" ${R(70, 300, 300, 250)}><iframe ${R(70, 300, 300, 250)}></iframe></ins>`, /^slot-selector: /],
    ["yandex_rtb_R-A-1234-1", `<div id="yandex_rtb_R-A-1234-1" ${R(70, 300, 300, 250)}><a href="https://an.yandex.ru/count/x" ${R(70, 300, 300, 250)}><img ${R(70, 300, 300, 250)}></a></div>`, "ad-stack: Yandex"],
    ["azk91234", `<div id="azk91234" ${R(70, 300, 300, 250)}><a href="https://e-1.adzerk.net/r?e=1" ${R(70, 300, 300, 250)}><img ${R(70, 300, 300, 250)}></a></div>`, "ad-stack: Kevel"],
    ["vm", `<div id="vm" class="vm-placement" data-id="5f0" ${R(70, 300, 300, 250)}><iframe ${R(70, 300, 300, 250)}></iframe></div>`, "ad-stack: Venatus"],
    ["apx", `<div id="apx" class="_ap_apex_ad" ${R(70, 300, 300, 250)}><iframe ${R(70, 300, 300, 250)}></iframe></div>`, "ad-stack: AdPushup"],
    ["mmt-1b2c", `<div id="mmt-1b2c" ${R(70, 300, 300, 250)}><iframe ${R(70, 300, 300, 250)}></iframe></div>`, "ad-stack: Monumetric"],
  ].map(([id, html, why]) => ({ name: "a network's own tag, from its published form: " + id, host: "example.com", win: PHONE, html: `<div ${R(70, 300, 300, 250)}>${html}</div>`, want: [[id, why]] })),
  ...[["butler", "https://servedbyadbutler.com/adserve/;ID=1", "iframe[src*='servedbyadbutler.com']"], ["veta", "https://siape.veta.naver.com/fxshow?su=1", "iframe[src*='veta.naver.com']"], ["baidu", "https://pos.baidu.com/s?x=1", "iframe[src*='pos.baidu.com']"],
  ].map(([id, src, sel]) => ({ name: "a frame from the platform's own serving host: " + id, host: "example.com", win: PHONE,
    html: `<div ${R(70, 300, 300, 250)}><iframe id="${id}" src="${src}" ${R(70, 300, 300, 250)}></iframe></div>`, want: [[id, "slot-selector: " + sel]] })),
  { name: "an empty div with a network's id, and a div whose id only starts like one, are left alone", host: "example.com", win: PHONE,
    html: `<div id="azk5" ${R(70, 300, 300, 250)}></div><div id="mmtx" ${R(70, 600, 300, 250)}><img ${R(70, 600, 300, 250)}></div>`, want: [] },
  // pass 4
  { name: "Rambler's ad block (rambler.ru)", host: "www.rambler.ru", win: DESK,
    html: `<div id="capirs-579505418" ${R(198, 300, 970, 240)}><div id="begun_block_579505418" ${R(198, 300, 970, 240)}><iframe class="x4s9" src="https://imgredirect.rambler.ru/file.jsp?url=x" ${R(198, 300, 970, 240)}></iframe></div></div>`,
    want: [["begun_block_579505418", "ad-stack: Begun"]] },
  { name: "AdFox's container with a picture drawn into the page (ria.ru)", host: "ria.ru", win: DESK,
    html: `<aside ${R(1000, 100, 300, 600)}><div id="adfox_154384888888824709" ${R(1000, 100, 300, 600)}><a href="https://yandex.ru/adfox/249922/clickURL?x=1" ${R(1000, 100, 300, 600)}><img ${R(1000, 100, 300, 600)}></a></div></aside>`,
    want: [["adfox_154384888888824709", "ad-stack: AdFox"]] },
  { name: "NetEase's ad module, and Tencent's ad container inside one (163.com)", host: "www.163.com", win: DESK,
    html: `<div id="ne1" class="ad_1200 index_top_ad mod_js_ad" data-adid="c_first" ${R(83, 100, 1200, 125)}><div class="at_item" ${R(83, 100, 1200, 125)}><iframe id="ariajm" ${R(83, 100, 1200, 125)}></iframe></div><span>AD</span></div>` +
      `<div id="ne2" class="ad_300 mod_js_ad" ${R(983, 400, 300, 250)}><div class="at_item" ${R(983, 400, 300, 250)}><div id="gdt" class="gdt-ad-container" data-placementid="92" ${R(983, 400, 300, 250)}><a href="https://c.gdt.qq.com/x" ${R(983, 400, 300, 250)}><img ${R(983, 400, 300, 250)}></a></div></div></div>`,
    want: [["gdt", "ad-stack: Tencent"], ["ne1", "ad-stack: NetEase"]] },
  { name: "Tencent's paid cells (qq.com)", host: "www.qq.com", win: DESK,
    html: `<div id="q1" class="banner_ad-item" ${R(68, 100, 1229, 79)}><img class="ad-cell-info-image" ${R(68, 100, 1229, 77)}><div class="ad-cell-info-item" data-ad-feedback="true">AD</div></div>` +
      `<div class="module_ad-item" ${R(68, 300, 389, 60)}><div id="q2" class="ad-cell-common" ${R(68, 300, 389, 60)}><img class="source-img" ${R(68, 300, 105, 60)}><div class="title">A title</div></div></div>`,
    want: [["q1", "ad-stack: Tencent"], ["q2", "ad-stack: Tencent"]] },
  { name: "Stroeer's slot container once filled, and not while empty (t-online.de)", host: "www.t-online.de", win: DESK,
    html: `<div id="sdg1" class="sdgSlotContainer sdgSlotName-banner" ${R(180, 100, 997, 250)}><iframe ${R(180, 100, 997, 250)}></iframe></div><div id="sdg2" class="sdgSlotContainer" ${R(180, 500, 997, 250)}><div></div></div>`,
    want: [["sdg1", "ad-stack: Stroeer"]] },
  ...[["mradx", "https://r.mradx.net/h5/00/x.html", "iframe[src*='mradx.net']"], ["polong", "https://newpolong.detik.com/core/html/x", "iframe[src*='newpolong.detik.com']"],
  ].map(([id, src, sel]) => ({ name: "a frame from the platform's own serving host: " + id, host: "example.com", win: DESK,
    html: `<div ${R(70, 300, 728, 90)}><iframe id="${id}" src="${src}" ${R(70, 300, 728, 90)}></iframe></div>`, want: [[id, "slot-selector: " + sel]] })),
  // pass 5
  ...[["exosrv", "https://x.exosrv.com/a?b=1", "iframe[src*='exosrv.com']"], ["exoclick", "https://x.exoclick.com/a?b=1", "iframe[src*='exoclick.com']"], ["juicyads", "https://x.juicyads.com/a?b=1", "iframe[src*='juicyads.com']"], ["trafficjunky", "https://x.trafficjunky.net/a?b=1", "iframe[src*='trafficjunky.net']"], ["highperformanceformat", "https://x.highperformanceformat.com/a?b=1", "iframe[src*='highperformanceformat.com']"], ["coinzilla", "https://x.coinzilla.io/a?b=1", "iframe[src*='coinzilla.io']"], ["bitmedia", "https://x.bitmedia.io/a?b=1", "iframe[src*='bitmedia.io']"], ["i-mobile", "https://x.i-mobile.co.jp/a?b=1", "iframe[src*='i-mobile.co.jp']"], ["microad", "https://x.microad.jp/a?b=1", "iframe[src*='microad.jp']"], ["lijit", "https://x.lijit.com/a?b=1", "iframe[src*='lijit.com']"], ["creativecdn", "https://x.creativecdn.com/a?b=1", "iframe[src*='creativecdn.com']"], ["omnitagjs", "https://x.omnitagjs.com/a?b=1", "iframe[src*='omnitagjs.com']"], ["sonobi", "https://x.sonobi.com/a?b=1", "iframe[src*='sonobi.com']"], ["33across", "https://x.33across.com/a?b=1", "iframe[src*='33across.com']"],
  ].map(([id, src, sel]) => ({ name: "a frame from the platform's own serving host: " + sel, host: "example.com", win: DESK,
    html: `<div ${R(70, 300, 300, 250)}><iframe id="f_${id}" src="${src}" ${R(70, 300, 300, 250)}></iframe></div>`, want: [["f_" + id, "slot-selector: " + sel]] })),
  ...[["exo", `<ins id="exo" class="eas6a97888e2" data-zoneid="1" ${R(70, 300, 300, 250)}><iframe ${R(70, 300, 300, 250)}></iframe></ins>`, "slot-selector: ins[class^='eas6a97888e']"],
    ["cz", `<div id="cz" class="coinzilla" data-zone="C-1" ${R(70, 300, 300, 250)}><iframe ${R(70, 300, 300, 250)}></iframe></div>`, "slot-selector: div.coinzilla"],
    ["dablewidget_x7yQ", `<div id="dablewidget_x7yQ" data-widget_id="x7yQ" ${R(70, 300, 300, 250)}><iframe ${R(70, 300, 300, 250)}></iframe></div>`, "ad-stack: Dable"],
    ["pop", `<div id="pop" class="_popIn_recommend" data-url="x" ${R(70, 300, 300, 250)}><a href="https://example.org/x" ${R(70, 300, 300, 250)}><img ${R(70, 300, 300, 250)}></a></div>`, "ad-stack: popIn"],
    ["ENGAGEYA_WIDGET_1", `<div id="ENGAGEYA_WIDGET_1" ${R(70, 300, 300, 250)}><a href="https://example.org/x" ${R(70, 300, 300, 250)}><img ${R(70, 300, 300, 250)}></a></div>`, "ad-stack: Engageya"],
  ].map(([id, html, why]) => ({ name: "a network's own tag, from its published form: " + id, host: "example.com", win: PHONE, html: `<div ${R(70, 300, 300, 250)}>${html}</div>`, want: [[id, why]] })),
  { name: "a recommendation widget taller than the screen is not covered whole", host: "example.com", win: PHONE,
    html: `<div id="dablewidget_big" ${R(0, 100, 440, 2400)}><a href="https://example.org/x" ${R(0, 100, 440, 300)}><img ${R(0, 100, 440, 200)}></a></div>`, want: [] },
  { name: "a frame from a host that only looks like one of them is left alone", host: "example.com", win: PHONE,
    html: `<div ${R(70, 300, 300, 250)}><iframe id="x" src="https://www.socialmedia.net/embed" ${R(70, 300, 300, 250)}></iframe></div>`, want: [] },
];
describe("ad platforms (the survey of 2026-11-27)", () => {
  for (const c of CASES) {
    it(c.name, () => {
      const PV = loadVeil({ host: c.host, width: c.win.width, height: c.win.height });
      const out = detect(PV, c.html);
      if (c.not) { c.not.forEach((id) => expect(out.map((o) => o.id)).not.toContain(id)); return; }
      expect(out.map((o) => o.id)).toEqual(c.want.map((w) => w[0]));
      c.want.forEach((w, i) => { if (w[1] instanceof RegExp) expect(out[i].why).toMatch(w[1]); else expect(out[i].why).toBe(w[1]); });
    });
  }
});
