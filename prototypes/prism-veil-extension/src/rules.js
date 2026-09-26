/*
  Prism Veil - ad DETECTION. Every rule here traces to a named source (spec
  section 5) and answers one question: which elements on this page are ads?

  Two kinds of rule:
    - SLOT_SELECTORS: ad-tech markup (networks, slot containers) - one pass.
    - SITE_RULES: per-site structural rules, each { id, host?, run(root, ctx) }.
      `host` gates by hostname; `run` adds targets through ctx.add(el, why,
      whole) - `whole` = this element must WIN over anything nested inside it.
  Then a generic "Ad"/"Sponsored" label walker, then innermost-only dedupe.

  Nothing in here touches the page: detection only. covers.js paints.
*/
(function () {
  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});

  // "Page-sized": an element that is (about) the page, never an ad - MSN's
  // .ad-banner-wrapper spanning the viewport for a moment at load. It was
  // "area >= half the viewport", which also threw out a full-width 1897x475
  // header ad on a ~900px-tall window (CNN's Wunderkind/Celtra header, report
  // 2026-09-12: 11 veils, the big one not among them). A banner is wide, not
  // tall: page-sized needs the height too - at least 70% of the viewport's.
  PV.pageSized = function (r) {
    return r.width * r.height >= innerWidth * innerHeight * 0.5 && r.height >= innerHeight * 0.7;
  };
  // The outermost ancestor still (about) the element's own box - within 15%
  // (or 12px) in both dimensions, up to `levels` up, never <body>. An ad unit
  // is often a stack of same-size wrappers with the ad's overlays as SIBLINGS
  // of the covered element (X's event hero: the veiled placementTracking box
  // and a caption overlay side by side, the caption on top, 2026-09-12): the
  // cover must go on the box that holds them all. covers.js uses it to find
  // an ad's X in the wrappers above the covered element.
  PV.unitAround = function (el, levels) {
    var u = el, r0 = el.getBoundingClientRect(), n = levels || 6;
    for (var d = 0; d < n && u.parentElement && u.parentElement !== document.body && u.parentElement !== document.documentElement; d++) {
      var pr = u.parentElement.getBoundingClientRect();
      if (Math.abs(pr.height - r0.height) > Math.max(12, r0.height * 0.15) || Math.abs(pr.width - r0.width) > Math.max(12, r0.width * 0.15)) break;
      u = u.parentElement;
    }
    return u;
  };

  var SLOT_SELECTORS = [
    "ins.adsbygoogle",
    "iframe[id^='google_ads_iframe']",
    "div[id^='google_ads_iframe']",
    "div[id^='div-gpt-ad']",
    "iframe[src*='doubleclick.net']",
    "iframe[src*='googlesyndication.com']",
    "iframe[src*='adnxs.com']",
    "iframe[src*='amazon-adsystem.com']",
    "iframe[src*='criteo.com']",
    "iframe[src*='rubiconproject.com']",
    "iframe[src*='pubmatic.com']",
    "iframe[src*='openx.net']",
    "iframe[src*='taboola.com']",
    "iframe[src*='outbrain.com']",
    // native "Sponsored Stories" / recommendation widgets (cover the WHOLE
    // widget, not the nested header/text - so use the widget-level container).
    "[id^='outbrain_widget']",
    "[class*='outbrain-unit']",
    "[id^='taboola-']",
    "[class*='trc_rbox']",
    "[class*='trc_related']",
    "[data-widget-id*='taboola']",
    // more ad-serving iframe origins (incl. video/outstream networks)
    "iframe[src*='2mdn.net']",
    "iframe[src*='imasdk.googleapis']",
    "iframe[src*='moatads.com']",
    "iframe[src*='adsafeprotected']",
    "iframe[src*='innovid.com']",
    "iframe[src*='springserve.com']",
    "iframe[src*='spotx']",
    "iframe[src*='teads.tv']",
    "iframe[src*='indexww.com']",
    "iframe[src*='casalemedia.com']",
    "iframe[src*='3lift.com']",
    "iframe[src*='smartadserver']",
    "iframe[src*='yieldmo.com']",
    // slot containers / attributes (high-confidence, never bare "ad")
    "[data-ad-slot]",
    "[data-google-query-id]",
    "[data-ad-unit]",
    "[data-adunit]",
    "[data-ad-type]",
    "[aria-label='Advertisement']",
    "[class*='celtra-ad']",
    "[class*='celtra-banner']",
    "[class*='advertisement']",
    "[class*='ad-unit']",
    "[class*='ad-slot']",
    "[class*='ad_slot']",
    "[class*='ad-container']",
    "[class*='ad__container']",
    "[class*='adfuel']",
    "[class*='outstream']",
    "[class*='video-ad']",
    "[class*='videoAd']",
    "[class*='ad-video']",
    // MSN / Microsoft Start display ad containers (rendered inside web components)
    "[class*='displayAd']",
    "[class*='display-ads']",
    "[class*='ad-banner']",
    // Pandora's display units (traceable source: Pandora's own container -
    // div.region-adBanner.region-adBanner--active[data-qa=display_ad_container_N]
    // holding a first-party displayAdFrame iframe, 300x600 beside Now Playing;
    // report 2026-09-12). Camel-case "adBanner" is not "ad-banner".
    "[class*='adBanner']",
    "[data-qa^='display_ad_container']",
    "[id*='ad_bnr']",
    "[id*='ad_rect']",
    "[id*='ad-slot']",
    "[id^='div-gpt']",
    // filezilla-project.org house ad slots (traceable source: FileZilla site):
    // a 728x90 leaderboard in div.TopAd > div (the .TopAd itself is the
    // page-wide band around it), 130x100 tiles in #leftad / #rightad.
    ".TopAd > div",
    "#leftad",
    "#rightad",
    // Wunderkind / BounceX VPAID video ad (bx-*), seen in CNN ad-slot-header
    "[class*='bx-vpaid']",
    "[class*='bx-creative']",
  ];
  var SLOT_QUERY = SLOT_SELECTORS.join(",");

  // AD STACKS - the banner analogue of the video player families: mid-size
  // publishers don't call GPT themselves, they run an ad-management wrapper
  // that owns the slot elements, and each wrapper has stable markers. A
  // matched element is covered as "ad-stack: <name>" so a report names the
  // stack, not a bare class. Each entry's markers are the vendor's documented
  // tags (traceable source: the vendor). Wrapper slots are usually EMPTY
  // placeholders until filled - only a slot with rendered content (an
  // iframe/img/video/canvas/link inside, at a real size) is covered.
  var AD_STACKS = [
    { stack: "Mediavine", sel: ".mv-ad-box" },
    { stack: "Raptive (AdThrive)", sel: ".adthrive-ad, [id^='AdThrive_']" },
    { stack: "Ezoic", sel: "[id^='ezoic-pub-ad-placeholder-'], .ezoic-ad" },
    { stack: "Playwire", sel: "[data-pw-desk], [data-pw-mobi]" },
    { stack: "Freestar", sel: "[data-freestar-ad], [id^='freestar-']" },
    { stack: "Snigel (AdEngine)", sel: "[id^='adngin-'], [class*='adngin-']" },
    { stack: "Publift (Fuse)", sel: "[data-fuse]" },
    { stack: "Hashtag Labs", sel: ".htl-ad" },
    { stack: "Sharethrough", sel: "[data-str-native-key]" },
    { stack: "MGID", sel: "[id*='ScriptRootC']" },
    { stack: "Revcontent", sel: "[id^='rcjsload_'], [data-rc-widget]" },
    { stack: "Carbon", sel: "#carbonads" },
    { stack: "BuySellAds", sel: "[id^='bsa-zone_'], .bsa-cpc, .bsa_it_ad" },
    { stack: "EthicalAds", sel: "[data-ea-publisher]" },
  ];
  var STACK_QUERY = AD_STACKS.map(function (a) { return a.sel; }).join(",");
  function stackMatch(el) {
    for (var i = 0; i < AD_STACKS.length; i++) { try { if (el.matches(AD_STACKS[i].sel)) return AD_STACKS[i].stack; } catch (e) {} }
    return null;
  }
  // A wrapper's slot with something rendered in it (filled), at a real size.
  function stackFilled(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 40) return false;
    return !!el.querySelector("iframe,img,video,canvas,ins,a,svg");
  }
  // The stack whose markers are on the page (first in order) - for reports.
  var stackAt = 0, stackName = null;
  PV.adStackHere = function () {
    if (Date.now() - stackAt < 2000) return stackName;
    stackAt = Date.now(); stackName = null;
    for (var i = 0; i < AD_STACKS.length; i++) { try { if (document.querySelector(AD_STACKS[i].sel)) { stackName = AD_STACKS[i].stack; break; } } catch (e) {} }
    return stackName;
  };

  // Facebook "Sponsored" detector. Returns the signal name or "". Scoped to the
  // post's header region (everything above the story body) so a comment or
  // caption containing the word never counts.
  var FB_INVIS = /[\u034F\u200B-\u200D\u2060\uFEFF\u00AD]/g;
  function fbVisible(el) {
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.fontSize) === 0 || cs.opacity === "0") return false;
    if (cs.position === "absolute" && (parseFloat(cs.left) < -1000 || parseFloat(cs.top) < -1000 || cs.clipPath === "inset(50%)" || cs.width === "1px")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    return true;
  }
  // Primary detector: any small element in the post's top band (where the
  // name / time / label row lives) whose visible text, once Facebook's
  // invisible joiners are removed, is exactly "Ad" or "Sponsored". Independent
  // of headings, roles or class names. Returns the element or null.
  var FB_BLANK = /[͏​-‍⁠﻿­ \s·.]/g;   // joiners, nbsp, the " · " separator
  function fbLabelElement(post) {
    var top = post.getBoundingClientRect().top, n = 0, i, el, r;
    // (1) Measured 2026-08-28 (Verizon, Litter-Robot, Fios, NYT, Prked): the
    // ad label is NOT in the DOM text. The header's time/label slot is an <a>
    // whose only text is U+2060 (word joiner); the visible "Ad" is painted by
    // CSS/SVG. Organic posts put a real timestamp there ("1͏3͏h").
    // So: a header link with visible size but no visible characters = ad label.
    var links = post.querySelectorAll("a");
    // An ad's label link REPLACES the timestamp. If any header link outside
    // the name heading has a digit in its visible text ("13h", "August 20 at
    // 6:54 PM", "Yesterday at 9:12"), this is an organic post - stop here.
    // (Reported 2026-08-28: without this, 10+ organic posts in a row veiled.)
    for (i = 0; i < links.length && i < 60; i++) {
      el = links[i]; r = el.getBoundingClientRect();
      if (r.height <= 0 || r.top - top > 160 || r.top - top < -50) continue;
      if (el.closest("h2,h3,h4,strong")) continue;
      if (/\d/.test((el.textContent || "").replace(FB_INVIS, ""))) return null;
    }
    for (i = 0; i < links.length && n < 600; i++, n++) {
      el = links[i];
      r = el.getBoundingClientRect();
      // Measured (Hulu, Verizon): the label link is ~45x17, text = U+2060,
      // no aria-label, href = the post permalink query, and the "Ad" glyphs
      // are SVG INSIDE the link. Icon-only links (avatar 40x40, "Hide post"
      // 36x36) are square and carry an aria-label; the timestamp link has
      // real text. So: blank text + text-shaped box + no aria-label + no media.
      if (r.width < 16 || r.height < 8 || r.width > 160 || r.height > 30 || r.top - top > 160 || r.top - top < -50) continue;
      if (r.width / r.height < 1.5) continue;                          // square = icon
      var raw = el.textContent || "";
      if (raw.replace(FB_BLANK, "") !== "") continue;                  // has visible characters
      // Measured 2026-08-28 across 5 ads + 2 organic posts: timestamps are
      // ALSO svg glyphs now, with a truly EMPTY link text. The ad label link
      // is the one whose text is a U+2060 word joiner. Empty = timestamp.
      if (raw.indexOf("⁠") < 0) continue;
      if (el.getAttribute("aria-label")) continue;                     // icon buttons/links are labelled
      if (el.querySelector("img,video,canvas")) continue;              // avatar / thumbnail links
      if (!fbVisible(el)) continue;
      var pc = fbPseudoText(el);
      if (pc && !/^(ad|sponsored)$/i.test(pc)) continue;               // painted text says something else
      return el;
    }
    // (2) pseudo-element or SVG text that literally says Ad / Sponsored
    var cands = post.querySelectorAll("a,span,div,text");
    for (i = 0; i < cands.length && n < 1500; i++, n++) {
      el = cands[i];
      r = el.getBoundingClientRect();
      if (r.height <= 0 || r.top - top > 160 || r.top - top < -50) continue;
      var t = el.tagName === "text" ? (el.textContent || "").replace(FB_INVIS, "").trim() : fbPseudoText(el);
      if (t && /^(ad|sponsored)$/i.test(t) && fbVisible(el)) return el;
    }
    // (3) plain / joiner-scrambled text label. Reported 2026-08-29 (Verizon):
    // the label text is now "⁠-͏-͏-͏A͏-͏d͏-" -
    // HYPHENS interleaved with the joiners (drawn invisibly). Keep letters only.
    var els = post.querySelectorAll("span,div,a,b");
    for (var i = 0; i < els.length && n < 900; i++, n++) {
      var el = els[i];
      if (el.childElementCount > 24) continue;   // one span per glyph/filler is 2-20 children
      var t = (el.textContent || "").replace(FB_INVIS, "").replace(/[^a-z]/gi, "");
      if (t.length > 9 || !/^(ad|sponsored)$/i.test(t)) continue;
      var r = el.getBoundingClientRect();
      if (r.height <= 0 || r.width <= 0 || r.top - top > 160 || r.top - top < -50) continue;
      if (!fbVisible(el)) continue;
      return el;
    }
    return null;
  }
  function fbPseudoText(el) {
    try {
      var a = getComputedStyle(el, "::after").content, b = getComputedStyle(el, "::before").content;
      var pick = function (c) { return (c && c !== "none" && c !== "normal") ? c.replace(/^["']|["']$/g, "").replace(FB_INVIS, "").trim() : ""; };
      return pick(a) || pick(b);
    } catch (e) { return ""; }
  }
  PV.fbLabelElement = fbLabelElement;
  function fbSponsoredSignal(post) {
    try {
      var lab = fbLabelElement(post);
      if (lab) return { why: "label-" + lab.textContent.replace(FB_INVIS, "").trim().toLowerCase(), el: lab };
      var link = post.querySelector('a[href*="/ads/about"],a[href*="ads/about/"],a[href*="ad_preferences"]');
      if (link) return { why: "ads-about-link", el: link };
      var la = post.querySelectorAll("[aria-label]");
      for (var i = 0; i < la.length; i++) if (/^(sponsored|ad)$/i.test((la[i].getAttribute("aria-label") || "").trim())) return { why: "aria-label", el: la[i] };
      // header = the post's first h2/h3/h4 block's enclosing row(s); fall back
      // to the first 3 element rows of the post.
      // header row = climb from the name heading until the next ancestor is
      // the story body (tall, or contains the message) - measured: the
      // "13h ·" / "Sponsored" line joins the name 4 levels up, body at 8.
      var hdr = post.querySelector("h2,h3,h4"), scope = hdr || post;
      while (hdr && scope.parentElement && scope.parentElement !== post) {
        var pa = scope.parentElement;
        if (pa.getBoundingClientRect().height > 90 || pa.querySelector('[data-ad-rendering-role="story_message"],[data-ad-preview="message"]')) break;
        scope = pa;
      }
      var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT), n, buf = "", count = 0;
      while ((n = walker.nextNode()) && count++ < 400) {
        var el = n.parentElement; if (!el) continue;
        if (el.closest("h2,h3,h4,strong")) continue;   // the name itself
        var cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.fontSize) === 0 || cs.opacity === "0") continue;
        if (cs.position === "absolute" && (parseFloat(cs.left) < -1000 || parseFloat(cs.top) < -1000 || cs.clipPath === "inset(50%)" || cs.width === "1px")) continue;
        if (el.getAttribute("aria-hidden") === "true") continue;
        buf += n.nodeValue;
      }
      // Facebook interleaves invisible joiners (U+034F, zero-width chars)
      // between glyphs: "A͏d". Drop those first so they never split a word.
      buf = buf.replace(/[͏​-‍⁠﻿­]/g, "");
      var words = buf.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
      for (var w = 0; w < words.length; w++) {
        var word = words[w];
        if (word === "sponsored") return { why: "label", el: scope };
        // Video / Reels-style ads say "Ad" instead (reported: HBO video ad,
        // header "Ad", CTA "Subscribe"). Header scope only, so a post body
        // that mentions an ad never counts.
        if (word === "ad" && words.length <= 12) return { why: "label-ad", el: scope };
        if (word.length >= 9 && word.length <= 10 && word.split("").sort().join("") === "denoopsrss") return { why: "label-scrambled", el: scope };
      }
      // letters split across spans without spaces: check the run
      var run = buf.toLowerCase().replace(/[^a-z]/g, "");
      if (run.length <= 40 && run.indexOf("sponsored") >= 0) return { why: "label-split", el: scope };
      if (run.length <= 12 && /^ad/.test(run)) return { why: "label-ad-split", el: scope };
    } catch (e) {}
    return null;
  }
  // Smallest ancestor of `from` (within `post`) whose subtree holds exactly one
  // profile name and the story body; null if none. Keeps a cover to one post.
  function fbSinglePost(post, from) {
    var NAME = '[data-ad-rendering-role="profile_name"]', BODY = '[data-ad-rendering-role="story_message"],[data-ad-preview="message"],[data-ad-rendering-role="image"],[data-ad-rendering-role="title"]';
    var names = post.querySelectorAll(NAME).length;
    if (names <= 1) return post;
    var el = from, d = 0;
    while (el && el !== post && d++ < 24) {
      var n = el.querySelectorAll(NAME).length;
      if (n > 1) return null;
      if (n === 1 && el.querySelector(BODY) && el.getBoundingClientRect().height >= 120) return el;
      el = el.parentElement;
    }
    return null;
  }

  // "Promoted" joined 2026-09-12 (LinkedIn feed: a promoted post's header
  // reads "Promoted" beside the follower count; X's older layout and Reddit
  // say the same) - trusted on its own like "Sponsored": a lone leaf reading
  // exactly "Promoted" is the platform's disclosure, not content.
  var BADGE = /^(ad|ads|advertisement|sponsored|promoted|ad\s*\d+\s*of\s*\d+)$/i;
  // Bare "ad"/"ads" is ambiguous - real ad badges carry an ad-labelish class,
  // but content metadata (MSN tiles have a subtitle "ad") does not. Require the
  // class for bare matches; "Advertisement"/"Sponsored"/"Ad N of M" are trusted
  // on their own.
  var AD_LABEL_CLS = /ad-?label|ad-?slug|adchoic|ad-?badge|ad-?tag|sponsor|display-?ad/i;
  // Section headers of native "sponsored content" blocks (Taboola/Outbrain and
  // house equivalents). A definite ad signal: cover the whole widget.
  var SECTION_AD = /^(paid partner content|paid content|paid partner|promoted stories|sponsored stories|promoted content|recommended by|from around the web)$/i;
  // Hosts where the generic "Sponsored"/"Ad" label walker is OFF: the label
  // marks SHOPPING content (Amazon tags in-results sponsored PRODUCTS "Sponsored"),
  // not an ad unit, and covering it buries the products the user is browsing.
  // The true ad-network slot selectors (amazon-adsystem iframes, etc.) still run,
  // so real ad banners are still veiled - just not sponsored product tiles.
  var LABEL_WALKER_OFF = /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/i;

  function hostIs(re) { return re.test(location.hostname); }

  // Hulu labels its home page's high-emphasis tile "ADVERTISEMENT" when it
  // promotes one of HULU'S OWN titles (report 2026-09-24: a Hulu show's
  // hero tile, the play button plays it on Hulu). That is the service's own
  // shelf, not an ad unit. The label counts only when the tile's action
  // leaves Hulu (a real sponsor's placement); a tile with no action, or one
  // that plays on Hulu, is house promotion and is left alone.
  function huluHousePromo(host) {
    if (!/(^|\.)hulu\.com$/i.test(location.hostname)) return false;
    var tile = null, n = host, d = 0;
    while (n && d < 6 && !tile) {
      var tid = n.getAttribute && n.getAttribute("data-testid") || "";
      if (/^high-emphasis-tile/.test(tid) && n.querySelector && n.querySelector('[data-testid="playback-action"]')) tile = n;
      n = n.parentElement; d++;
    }
    if (!tile) {
      // the label's own box sits beside the action, one or two levels up
      n = host; d = 0;
      while (n && d < 4 && !tile) { if (n.querySelector && n.querySelector('[data-testid^="high-emphasis-tile"]') && n.querySelector('[data-testid="playback-action"]')) tile = n; n = n.parentElement; d++; }
    }
    if (!tile) return false;
    var act = tile.querySelector('[data-testid="playback-action"]');
    var href = act && act.getAttribute && act.getAttribute("href") || "";
    if (!href || href.charAt(0) === "/" || href.charAt(0) === "#") return true;
    try { return /(^|\.)hulu\.com$/i.test(new URL(href, location.href).hostname); } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- label -> unit
  // Walk up (across shadow boundaries) to the enclosing MSN feed card element.
  function enclosingCard(el) {
    var n = el, d = 0;
    while (n && d < 14) { if (n.tagName === "CS-RESPONSIVE-CARD") return n; n = PV.parentAcross(n); d++; }
    return null;
  }
  // The ad CARD is a shadow host: its offsetParent is often null, so a cover on
  // it falls back to OVERLAY mode, which drifts when the ad sits in an inner
  // scroller (MSN's article reader). Its light-DOM wrapper has a real
  // offsetParent, so covering THAT rides the page layout (parent mode) and stays
  // locked to the ad. Return the OUTERMOST such wrapper within a few hops.
  var MSN_AD_WRAP = /(^|\s)(responsive-views-ad-container|native-ad-container|views-linear-feed-native-ad-container|in-feed-native-card|linear-feed-ad-warpper|ad-slot-placeholder)(\s|$)/i;
  function msnAdWrap(el) {
    var n = el, d = 0, best = null;
    while (n && d < 10) { if (n.nodeType === 1 && n.parentElement && MSN_AD_WRAP.test(PV.classStr(n))) best = n; n = PV.parentAcross(n); d++; }
    return best;
  }
  // A component-feed ad CARD: a custom element (tag has a hyphen) that sits among
  // SAME-TAG sibling cards of comparable size - one item in a feed of many.
  // Siblings are read from the true parentNode (for MSN that is the parent
  // component's shadow root, where the peer cards actually live). Same tagName
  // means a card's own image+text are never mistaken for peers, and a lone row
  // wrapper is never mistaken for a card.
  function isFeedCard(el, r, cap) {
    // A card is a custom element (YouTube, MSN), an <article> / <li>, or a
    // role=listitem|article box (LinkedIn's feed: div[role=listitem] posts
    // in a div[role=list], 2026-09-12 - the promoted post is 918px tall on an
    // 867px window, past the size caps, so only the card path reaches it).
    if (!el.tagName) return false;
    var role = (el.getAttribute && el.getAttribute("role")) || "";
    var semantic = el.tagName === "ARTICLE" || role === "article" ||
      (el.tagName === "LI" && el.parentElement && /^(UL|OL)$/.test(el.parentElement.tagName)) ||
      (role === "listitem" && !!(el.closest && el.closest("[role='list']")));
    if (el.tagName.indexOf("-") <= 0 && !semantic) return false;
    if (r.width < 200 || r.height < 100 || r.width > innerWidth || (r.width * r.height) > cap) return false;
    // A semantic card IS a card; the sibling test below is for custom elements
    // only (a lone wrapper is not a card). LinkedIn nests each listitem in
    // its own single-child wrappers under display:contents boxes, so the
    // listitem's parent has one child and the siblings measure 0x0 - the
    // 1025px promoted document post fell back to the size caps and got a
    // partial cover (report 2026-09-12).
    if (semantic) return true;
    var parent = el.parentNode;
    if (!parent || !parent.children || parent.children.length < 2) return false;
    var ca = r.width * r.height; if (ca <= 0) return false;
    for (var i = 0; i < parent.children.length; i++) {
      var ce = parent.children[i];
      if (ce === el || ce.tagName !== el.tagName) continue;
      if (ce.hasAttribute && ce.hasAttribute("data-prism-veil")) continue;
      var s = ce.getBoundingClientRect(), sa = s.width * s.height;
      if (s.width >= 150 && s.height >= 80 && sa >= ca * 0.5 && sa <= ca * 2.2) return true;
    }
    return false;
  }
  // Grow a small "Ad"/"Sponsored" label into the ad UNIT it labels, then STOP at
  // that unit's boundary: structurally at the first feed card on the way up
  // (a row of sibling cards means the ad is the child we already have), and
  // by size caps as a backstop. `section` = a labeled sponsored-content block,
  // covered whole with larger caps (CNN's Dianomi zone runs ~1.6 screens).
  function badgeUnit(badge, strong, section) {
    var el = badge, depth = 0;
    var vpA = innerWidth * innerHeight;
    var maxW = (strong || section) ? innerWidth : Math.min(1100, innerWidth * 0.9);
    var maxH = section ? innerHeight * 2.6 : (strong ? innerHeight * 0.92 : Math.min(900, innerHeight * 0.9));
    var areaCap = (section ? 1.8 : (strong ? 0.6 : 0.35)) * vpA;
    var cardCap = 0.85 * vpA;
    var best = null, card = null;
    while (el && el !== document.body && el !== document.documentElement && depth < 18) {
      var r = el.getBoundingClientRect();
      if (r.width >= 100 && r.height >= 50 && r.width <= maxW && r.height <= maxH &&
          (r.width * r.height) <= areaCap) best = el;
      if (!section && isFeedCard(el, r, cardCap)) { card = el; break; }
      el = PV.parentAcross(el); depth++;
    }
    return (!section && card) ? card : best;
  }

  // A <video> whose source is an ad-network host is an ad video (e.g. Fox News's
  // masthead plays an ad straight from ads.jetpackdigital.com - no IMA flag, no
  // player ad-mode class, just an ad served as the video). Traceable source: the
  // video URL's own host. Covers only while that src is the ad; when the player
  // returns to real content (a first-party host) it stops matching and uncovers.
  function isAdVideoSrc(s) {
    var h; try { h = new URL(s, location.href).hostname.toLowerCase(); } catch (e) { return false; }
    if (/^ad[sx]?[0-9-]*\./.test(h)) return true;   // ads. / ad. / adx. / ads2. subdomain
    // flashtalking / sizmek / celtra: ad servers whose creatives play as the
    // video (AP News's outstream ad came from cdn.flashtalking.com, 2026-09-13)
    return /(^|\.)(jetpackdigital|doubleclick|googlesyndication|2mdn|adnxs|adsafeprotected|moatads|springserve|spotx|teads|innovid|yieldmo|adform|smartadserver|serverbid|adtelligent|adtng|flashtalking|sizmek|celtra|extremereach)\.[a-z]+$/.test(h);
  }
  // The small, corner-anchored, fixed/sticky player a video sits in - a
  // "floating video". Returns that player box, else null. The video itself is
  // fine (content); the caller decides whether it's an AD right now.
  function floatingPlayerBox(v) {
    var n = v, d = 0;
    while (n && d < 8) {
      try {
        var cs = getComputedStyle(n);
        if (cs.position === "fixed" || cs.position === "sticky") {
          var r = n.getBoundingClientRect();
          if (r.width > 120 && r.height > 80 && r.width < innerWidth * 0.6 && r.height < innerHeight * 0.6 &&
              r.bottom > innerHeight * 0.35 && (r.right > innerWidth * 0.55 || r.left < innerWidth * 0.2)) return n;
        }
      } catch (e) {}
      n = n.parentElement; d++;
    }
    return null;
  }

  // ---------------------------------------------------------------- site rules
  var SITE_RULES = [
    {
      // Ad served AS the video (not an ad break inside a player you chose).
      id: "ad-video-src",
      run: function (root, ctx) {
        root.querySelectorAll("video").forEach(function (v) {
          var s = v.currentSrc || v.src || "";
          if (!s || !isAdVideoSrc(s)) return;
          // Cover the player WRAPPER (a div), never the <video> itself: a cover
          // can't be a child of <video>, and covering the wrapper lets the sweep
          // mute the video under it. The immediate parent is the player box.
          var box = v.parentElement;
          if (!box || box === document.body || box === document.documentElement) return;
          // The ad may be a rich-media unit WIDER than its video - Fox's masthead
          // is a video beside more ad content, one click-layer over both. Climb
          // to the full ad unit: the widest ancestor still the SAME HEIGHT as the
          // video box (a taller ancestor is the page, not the ad).
          // Same HEIGHT is the guard (a taller ancestor is the page); width
          // climbs freely to the full-width unit - the ad stage can be a hair
          // wider than the viewport (overflow / scrollbar), so no width cap here.
          var h0 = box.getBoundingClientRect().height;
          for (var up = 0; up < 6 && box.parentElement && box.parentElement !== document.body && box.parentElement !== document.documentElement; up++) {
            var pr = box.parentElement.getBoundingClientRect();
            if (h0 > 0 && Math.abs(pr.height - h0) <= Math.max(12, h0 * 0.15)) box = box.parentElement;
            else break;
          }
          var r = box.getBoundingClientRect();
          if (r.width < 80 || r.height < 60 || r.height > innerHeight * 0.95) return;
          // These rich-media units stack their video + a click-layer ABOVE a
          // normal inside cover's low z-index, so force a top-level overlay.
          box.__prismForceOverlay = true;
          ctx.add(box, "ad-video: " + s.replace(/^https?:\/\//, "").slice(0, 40), true);
        });
        // A FLOATING video player (Daily Mail's corner sticky video) is content
        // sometimes, an ad other times. Cover it ONLY while it is actually an ad:
        // the IMA/DAI flag is active (ima-hook.js), or its own src is an ad host.
        // A first-party content video in the same float is left visible.
        var imaOn = document.documentElement.getAttribute("data-prism-ad") === "active";
        root.querySelectorAll("video").forEach(function (v) {
          var s = v.currentSrc || v.src || "";
          if (!imaOn && !(s && isAdVideoSrc(s))) return;
          var box = floatingPlayerBox(v);
          if (!box) return;
          box.__prismForceOverlay = true;
          ctx.add(box, "floating-video-ad", true);
        });
      }
    },
    {
      // MSN / Microsoft Start feed (traceable source: Microsoft Start feed). The
      // ad is a <cs-responsive-card role=article>: a NATIVE ad carries data-t
      // {"n":"NativeAd"} and no ad class; a DISPLAY ad holds a .displayAd*
      // container whose id (rectangle1_<hash>) CHANGES every rotation - so
      // cover the stable card above it, never the volatile inner container.
      id: "msn-card",
      run: function (root, ctx) {
        var addCard = function (card) { if (card) ctx.add(card, "msn-card", true); };
        root.querySelectorAll("[data-t*='NativeAd']").forEach(function (el) { addCard(msnAdWrap(el) || enclosingCard(el) || el); });
        root.querySelectorAll("display-ads,[class*='displayAdContainer'],[class*='displayAdWCContainer']").forEach(function (el) { addCard(enclosingCard(el)); });
        // Top "me-stripe" quick-link tiles mix ads with the user's own sites;
        // both carry meStripe.* markers. MSN's own disclosure - an "Ad" /
        // "Sponsored" SUBTITLE under the tile name - is the discriminator.
        root.querySelectorAll("[data-t*='LeadGen']").forEach(function (el) { ctx.add(el, "msn-leadgen"); });
        root.querySelectorAll(".me-stripe-title-subtitle").forEach(function (sub) {
          var tx = (sub.textContent || "").trim();
          // "Ad", "Ad ·", "Sponsored", "Advertisement" - but not "Adventure".
          if (!(/^(advertisement|sponsored)\b/i.test(tx) || /^ad([^a-z]|$)/i.test(tx))) return;
          ctx.add((sub.closest && sub.closest("a.me-stripe-tile-button")) || sub, "msn-stripe-subtitle");
        });
      },
    },
    {
      // Dianomi sponsored-content units (traceable source: Dianomi) - a
      // <iframe class="dianomi-parent-iframe"> in a .bizdev-dianomi wrapper.
      // Labeled ones are covered whole by the section walker; a bare one in
      // a content zone (CNN) is covered here.
      id: "dianomi",
      run: function (root, ctx) {
        // Never a page-sized or column-long box: AP News wraps a whole
        // 13042px column in .dianomi_context (trace 2026-09-13, "cover big
        // 980x13042 why=dianomi"). A widget is at most ~2.6 screens (the
        // section cap); past that the class is on a wrapper, not the unit.
        root.querySelectorAll(".bizdev-dianomi,.dianomi_context").forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (PV.pageSized(r) || r.height > innerHeight * 2.6) return;
          ctx.add(el, "dianomi");
        });
      },
    },
    {
      // SOOP / afreecatv (traceable source: SOOP's own #chat_ad.chat_banner -
      // the banner unit standing in the chat column, 252x448, reported
      // 2026-08-29). The element IS the unit.
      id: "soop-chat-ad",
      host: /(^|\.)(sooplive\.com|sooplive\.co\.kr|afreecatv\.com)$/i,
      run: function (root, ctx) {
        root.querySelectorAll("#chat_ad, .chat_banner, [id$='_ad'].chat_banner").forEach(function (el) { ctx.add(el, "soop-chat-ad"); });
      },
    },
    {
      // Reddit (traceable source: Reddit "Promoted" posts). Feed ads - video
      // included - are <shreddit-ad-post promoted>; sidebar units are
      // <shreddit-sidebar-ad>. The element IS the whole ad card.
      id: "reddit",
      run: function (root, ctx) {
        root.querySelectorAll("shreddit-ad-post,shreddit-sidebar-ad,shreddit-comments-page-ad,shreddit-dynamic-ad-link").forEach(function (el) {
          ctx.add(el, "reddit:" + el.tagName.toLowerCase());
        });
      },
    },
    {
      // Facebook (traceable source: Facebook's own "Sponsored" label + ad
      // markup). data-ad-preview / data-ad-comet-preview /
      // data-ad-rendering-role used to appear only on ads; as of Aug 2026
      // Facebook puts them on EVERY feed post (measured: organic page posts and
      // a family photo carried profile_name/story_message/meta/...), so they
      // are now only a pre-filter. A post is an ad only if it also carries a
      // real sponsored signal: the "/ads/about" link, an aria-label saying
      // Sponsored, or the header label reconstructed from its VISIBLE glyphs
      // (Facebook scrambles "Sponsored" with hidden / reordered spans, so we
      // compare the sorted letters). Cover the [aria-posinset] wrapper ONLY.
      id: "facebook",
      host: /(^|\.)facebook\.com$/i,
      run: function (root, ctx) {
        var seen = new Set();
        root.querySelectorAll("[aria-posinset]").forEach(function (post) {
          if (seen.has(post) || post.querySelector("[aria-posinset]")) return;   // innermost posts only
          seen.add(post);
          var why = fbSponsoredSignal(post);
          if (!why) return;
          // Bound the cover to ONE post: a post has exactly one profile-name
          // element; a wrapper that holds several posts (reported: the cover
          // spilled over the previous and following posts) has several. Walk
          // down to the smallest block around the signal with one name.
          var target = fbSinglePost(post, why.el);
          if (!target) return;
          var pr = target.getBoundingClientRect();
          if (pr.width > innerWidth * 0.7 || pr.height > innerHeight * 1.6 || pr.height < 120) return;
          ctx.add(target, "facebook-sponsored: " + why.why, true);
        });
      },
    },
    {
      // YouTube Shorts (traceable source: YouTube's own ad markup). An ad reel
      // is <ytd-reel-video-renderer is-ads-overlay> holding ytd-ad-slot-renderer
      // and an ad-badge "Sponsored". Shorts moves ONE <ytd-player> from reel to
      // reel, so cover the reel's own #short-video-container, never the player.
      id: "youtube-shorts",
      host: /(^|\.)youtube\.com$/i,
      run: function (root, ctx) {
        root.querySelectorAll("ytd-reel-video-renderer[is-ads-overlay]").forEach(function (reel) {
          var box = reel.querySelector("#short-video-container") || reel.querySelector("#player-container") || reel;
          ctx.add(box, "youtube-shorts-ad-reel", true);
        });
      },
    },
    {
      // YouTube DISPLAY ad units (traceable source: YouTube's own ad renderer
      // custom elements - the ad is in the TAG name, which class selectors
      // never see; Autotrader masthead on the home page, Firefox report
      // 2026-08-29). Whole units, like in-feed ads.
      id: "youtube-ad-renderers",
      host: /(^|\.)youtube\.com$/i,
      run: function (root, ctx) {
        var sel = "ytd-video-masthead-ad-v3-renderer, ytd-page-top-ad-layout-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, ytd-promoted-sparkles-text-search-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer, ytd-ad-slot-renderer, ytd-action-companion-ad-renderer, ytd-companion-slot-renderer";
        root.querySelectorAll(sel).forEach(function (el) {
          if (el.closest && el.closest(".html5-video-player")) return;   // the player's own ad chrome is the video veil's
          // innermost renderer wins (a page-top layout holds the masthead)
          if (el.querySelector(sel)) return;
          // The Shorts ad reel rule owns an ad inside a reel: stay out.
          if (el.querySelector("ytd-reel-video-renderer")) return;
          // A layout renderer can have NO box of its own (ytd-in-feed-ad-layout-
          // renderer: an inside cover came out 0px wide, Firefox 2026-08-29) -
          // or a box spanning the whole pane (Shorts: 1584x851, a second photo
          // over the first). Either way the renderer is a WRAPPER: cover its
          // sized content element instead, never the wrapper.
          var box = el, r = el.getBoundingClientRect();
          var huge = PV.pageSized(r);
          if (r.width < 120 || r.height < 60 || huge) {
            var kids = el.querySelectorAll("yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, #content, #contents, .ytd-in-feed-ad-layout-renderer"), best = null, bestA = 0;
            for (var i = 0; i < kids.length; i++) { var kr = kids[i].getBoundingClientRect(), a = kr.width * kr.height; if (kr.width >= 120 && kr.height >= 60 && a > bestA && a < innerWidth * innerHeight * 0.5) { bestA = a; best = kids[i]; } }
            if (!best) return;
            box = best;
          }
          ctx.add(box, "youtube-ad-renderer: " + el.tagName.toLowerCase(), true);
        });
      },
    },
    {
      // Instagram (traceable source: Instagram's own "Ad"/"Sponsored" label).
      // Classes are obfuscated, so from a leaf reading exactly "Ad"/"Sponsored"
      // walk up to the first ancestor that HOLDS THE MEDIA (video, or an image
      // >= 200px - not the avatar) and is post-sized. Feed: the <article>.
      // Reels: the ~465x827 reel box beside the caption column. A reel box is
      // remembered even before its media mounts (Instagram unmounts video for
      // reels more than a couple away) so an ad reel is covered before it
      // scrolls in and stays covered after.
      id: "instagram",
      host: /(^|\.)instagram\.com$/i,
      run: function (root, ctx) {
        var tw = document.createTreeWalker((root === document) ? document.body : root, NodeFilter.SHOW_TEXT), tn, seen = 0;
        while ((tn = tw.nextNode()) && seen++ < 40000) {
          var tt = tn.nodeValue && tn.nodeValue.trim();
          if (!tt || tt.length > 16 || !/^(ad|sponsored|paid partnership)$/i.test(tt)) continue;
          var rg = document.createRange(); rg.selectNodeContents(tn);
          var lr = rg.getBoundingClientRect();
          if (lr.width <= 0 || lr.width > 160 || lr.height > 40) continue;
          var an = tn.parentElement, unit = null, box = null;
          for (var ad = 0; an && ad < 14; ad++, an = an.parentElement) {
            var ar = an.getBoundingClientRect();
            if (ar.width < 300 || ar.height < 300) continue;
            if (ar.width > innerWidth * 0.8) break;
            if (!box && ar.width >= 400 && ar.height >= 500) box = an;
            if (an.querySelector("video,[aria-label='Video player']")) { unit = an; break; }
            var bigImg = Array.prototype.some.call(an.querySelectorAll("img"), function (im) { return im.getBoundingClientRect().width >= 200; });
            if (bigImg) { unit = an; break; }
          }
          if (!unit) unit = box;
          if (unit) ctx.add(unit, "instagram-label: " + tt);
        }
      },
    },
    {
      // Twitch front-page / shelf MINI players (traceable source: Twitch's own
      // "Ad (0:16)" badge, <span data-a-target="video-ad-countdown">, report
      // 2026-08-28: a 308x173 <video> in a .tw-tower card, no marker above it).
      // The main channel player (>= 400x200) is the video veil's (video.js);
      // this rule covers only the small ones, sized to the box that holds the
      // <video> - the .tw-aspect frame - like a display ad.
      id: "twitch-mini-player",
      host: /(^|\.)twitch\.tv$/i,
      run: function (root, ctx) {
        // Two shapes (both observed): the channel player's badge "Ad (0:16)"
        // in <span data-a-target="video-ad-countdown">; and the FRONT-PAGE
        // video-ad unit (2026-08-29, 314x177 in the shelf): a <p> reading
        // "Ad 0:00", buttons aria-labelled "Pause Ad" / "Unmute Ad" / "Leave
        // feedback for this Ad", a hidden "Video Advertisement" span.
        var marks = [].slice.call(root.querySelectorAll("[data-a-target='video-ad-countdown'], [aria-label='Pause Ad'], [aria-label='Unmute Ad'], [aria-label='Mute Ad'], [aria-label^='Leave feedback for this Ad']"));
        var tw = document.createTreeWalker((root === document) ? document.body : root, NodeFilter.SHOW_TEXT), tn, seen = 0;
        while ((tn = tw.nextNode()) && seen++ < 40000) {
          var tt = tn.nodeValue && tn.nodeValue.trim();
          if (tt && tt.length <= 24 && (/^ad\s*\(?\d{1,2}:\d{2}\)?$/i.test(tt) || /^video advertisement$/i.test(tt))) marks.push(tn.parentElement);
        }
        marks.forEach(function (m) {
          if (!m) return;
          var an = m.parentElement, box = null;
          for (var d = 0; an && d < 12; d++, an = an.parentElement) {
            var vid = an.querySelector("video"); if (!vid) continue;
            var r = an.getBoundingClientRect();
            if (r.width >= 400 && r.height >= 200) return;          // the main player: video.js owns it
            if (r.width < 120 || r.height < 60) continue;
            box = an.classList.contains("tw-aspect") ? an : (an.closest(".tw-aspect") || an);
            break;
          }
          if (box) ctx.add(box, "twitch-mini-ad", true);
        });
      },
    },
    {
      // AI-labelled content (OPT-IN, pv:ui.aiVeil, off by default). Traceable
      // source: the PLATFORM's own disclosure label - Meta "AI info" / "Made
      // with AI", TikTok/Threads "AI-generated", YouTube "Altered or synthetic
      // content". A short on-screen label grows to its post/card like a
      // "Sponsored" tag does; on a YouTube watch page the label sits in the
      // watch metadata, so the player itself is veiled. Nothing is inferred:
      // no label, no veil.
      id: "ai-label",
      run: function (root, ctx) {
        if (!(PV.uiPrefs && PV.uiPrefs.aiVeil)) return;
        var AI = /^(ai info|made with ai|ai[- ]generated|ai[- ]generated content|generated with ai|created with ai|altered or synthetic content|contains ai[- ]generated content|synthetic content)$/i;
        var base = (root === document) ? document.body : root;
        // YouTube watch page (observed 2026-08-29, /watch?v=IYKFXmQBLy0): the
        // disclosure is a "How this was made" section in the STRUCTURED
        // DESCRIPTION - <how-this-was-made-section-view-model> reading "Made
        // with AI" / "Sounds or visuals were altered or fully generated" - and
        // it is hidden until the description is expanded. Read it regardless
        // of visibility; the player is the unit.
        // YouTube tiles judged by src/ai-tiles.js (the watch page's own "How
        // this was made" disclosure, looked up per video id and cached): the
        // whole tile, like an in-feed ad - art over it, link not clickable.
        root.querySelectorAll("[data-prism-ai='1']").forEach(function (t) { ctx.add(t, "ai-lookup: YouTube How this was made", true); });
        // YouTube's watch page is video.js's (a full intermission with the
        // position readout and "Watch anyway"); the walker below still serves
        // Shorts reels and any other on-screen label.
        if (/(^|\.)youtube\.com$/i.test(location.hostname) && document.querySelector("#movie_player") && !location.pathname.startsWith("/shorts")) return;
        var tw = document.createTreeWalker(base, NodeFilter.SHOW_TEXT), tn, seen = 0;
        while ((tn = tw.nextNode()) && seen++ < 40000) {
          var tt = tn.nodeValue && tn.nodeValue.trim();
          if (!tt || tt.length > 34 || !AI.test(tt)) continue;
          var host = tn.parentElement; if (!host) continue;
          var hr = host.getBoundingClientRect();
          if (hr.width <= 0 || hr.height <= 0 || hr.width > 400) continue;
          if (host.closest && host.closest("[data-prism-ui],[data-prism-veil]")) continue;
          if (/(^|\.)youtube\.com$/i.test(location.hostname)) {
            var meta = host.closest("ytd-watch-metadata, #description, ytd-watch-info-text, #info-container, ytd-reel-video-renderer");
            if (meta) {
              var reel = host.closest("ytd-reel-video-renderer");
              var box = reel ? (reel.querySelector("#short-video-container") || reel) : document.querySelector("#movie_player");
              if (box) ctx.add(box, "ai-label: " + tt, true);
              continue;
            }
          }
          var unit = badgeUnit(host, false, false);
          if (unit) ctx.add(unit, "ai-label: " + tt);
        }
      },
    },
    {
      // Pause-screen ad (traceable source: the player's own "Advertisement"
      // label inside its pause panel; Paramount+ .pause-panel.show, report
      // 2026-08-29). Cover the AD UNIT only - the half-screen creative - not
      // the player: the show is merely paused. The panel's return button stays
      // usable. (With the pause veil on, video.js additionally veils the
      // player with that button cut out.)
      id: "pause-panel-ad",
      host: /(^|\.)(paramountplus\.com|cbs\.com|pluto\.tv)$/i,
      run: function (root, ctx) {
        root.querySelectorAll(".pause-panel.show, .pause-panel[class*='show']").forEach(function (panel) {
          var els = panel.querySelectorAll("span,div,p"), label = null;
          for (var i = 0; i < els.length && !label; i++) { var t = PV.ownText(els[i]); if (t && t.length < 20 && /^(advertisement|ad|sponsored)$/i.test(t) && PV.elVisible(els[i])) label = els[i]; }
          if (!label) return;
          // the unit: climb from the label to the largest block that is NOT
          // the panel itself and holds media (img/video/iframe)
          var an = label.parentElement, unit = null;
          for (var d = 0; an && an !== panel && d < 10; d++, an = an.parentElement) {
            var r = an.getBoundingClientRect();
            if (r.width < 200 || r.height < 120) continue;
            if (r.width > innerWidth * 0.95 && r.height > innerHeight * 0.9) break;
            if (an.querySelector("img,video,iframe,canvas")) unit = an;
          }
          if (unit) ctx.add(unit, "pause-panel-ad: " + PV.ownText(label));
        });
      },
    },
    {
      // Small in-feed video-ad players (CNN bolt players showing "Ad 1 of N"):
      // covered like a display ad; the MAIN player gets the full veil.
      id: "fave-player",
      run: function (root, ctx) {
        root.querySelectorAll(".fave-player-container").forEach(function (pl) {
          var r = pl.getBoundingClientRect();
          if (r.width < 120 || r.width > 520 || r.height < 80) return;
          // "fave-ad" (2026-08) and now "fave-ad-playing" (CNN home, 2026-08-29):
          // any fave-ad state class - the badge alone leaves with the scroll.
          var adInd = /(^| )fave-ad(-[a-z]+)?( |$)/.test(pl.className + "") ||
                      PV.hasAdBadge(pl, /^(ad|advertisement|ad\s*\d+\s*of\s*\d+)$/i, null);
          if (adInd) ctx.add(pl, "fave-player-ad");
        });
      },
    },
    {
      // Jetpack Digital rich-media masthead (traceable source: Jetpack's own
      // markup - a body-level #jpmasthead holding a .jpstage of jp_* modules
      // whose media loads from ads.jetpackdigital.com; Fox News home, three
      // reports 2026-09-11). Expanded (478px) it sits over the top of the
      // page; on scroll or its own X it collapses to a 212px position:fixed
      // strip (.jpfixed) - still the ad, which findTopBar had been taking for
      // the site's header. The GAM out-of-page slot that loads it is only a
      // spacer (skipped in the slot pass). Cover the masthead whole as a
      // top-level overlay: its click-layer stacks above an inside cover, and a
      // fixed target gets a fixed cover (covers.js). The earlier ad-video-src
      // rule still covers it while it plays video; the whole-cover dedupe
      // folds the two into one.
      id: "jetpack-masthead",
      run: function (root, ctx) {
        var seen = new Set();
        root.querySelectorAll("#jpmasthead, .jpstage").forEach(function (el) {
          var unit = (el.id === "jpmasthead") ? el : ((el.closest && el.closest("#jpmasthead")) || el);
          if (seen.has(unit)) return;
          seen.add(unit);
          var media = unit.querySelectorAll("img,video,iframe"), fromJp = false;
          for (var i = 0; i < media.length && !fromJp; i++) {
            try { fromJp = /(^|\.)jetpackdigital\.com$/i.test(new URL(media[i].currentSrc || media[i].getAttribute("src") || "", location.href).hostname); } catch (e) {}
          }
          if (!fromJp) return;
          var r = unit.getBoundingClientRect();
          if (r.width < 200 || r.height < 40 || r.height > innerHeight * 0.95) return;
          unit.__prismForceOverlay = true;
          ctx.add(unit, "jetpack-masthead", true);
        });
      },
    },
    {
      // Primis outstream player (traceable source: Primis's own ad markup -
      // the player [id^='primis_player'] holds #adContainerDiv with #adVpaid /
      // #adIma slots, and its ad video is video#adVideoElement; AP News
      // 2026-09-13, 340x191: a VPAID ad from cdn1.extremereach.io with no IMA
      // iframe on the page, so neither the IMA rule nor the host list had it).
      // An ad is playing when the ad container holds a video with a source
      // or a visible IMA iframe, or the player shows its own "Skip Ad"; cover
      // the player box whole. Editorial playback (the site's own video in
      // #videoContainerDiv) never lights this.
      id: "primis-outstream",
      run: function (root, ctx) {
        root.querySelectorAll("[id^='primis_player'], .prms-player").forEach(function (pl) {
          var box = (pl.id && pl.id.indexOf("primis_player") === 0) ? pl : (pl.querySelector("[id^='primis_player']") || pl);
          var r = box.getBoundingClientRect();
          if (r.width < 120 || r.height < 60 || PV.pageSized(r)) return;
          if (r.width >= 400 && r.height >= 200) return;   // player-sized: the video veil's (its 400px floor)
          var adc = box.querySelector("#adContainerDiv, [id^='adContainerDiv']");
          if (!adc) return;
          var on = false;
          try {
            adc.querySelectorAll("video").forEach(function (v) { if (on) return; var s = v.currentSrc || v.getAttribute("src") || ""; if (s && !v.ended && v.getBoundingClientRect().width >= 100) on = true; });
            if (!on) adc.querySelectorAll("iframe").forEach(function (f) { if (!on && /imasdk\.googleapis/.test(f.src || "") && f.getBoundingClientRect().width >= 100) on = true; });
            if (!on) { var els = box.querySelectorAll("div,span,button"); for (var i = 0; i < els.length && !on; i++) { var t = PV.ownText(els[i]); if (t && /^skip ad$/i.test(t) && PV.elVisible(els[i])) on = true; } }
          } catch (e) {}
          if (on) ctx.add(box, "primis-outstream", true);
        });
      },
    },
    {
      // The platform's own AD MENU (traceable source: the "Ad Options" /
      // "Report this ad" / "Why am I seeing this ad?" / "Hide this ad" controls
      // a platform hangs on an ad unit and nothing else). LinkedIn's right-rail
      // 300x250 (report 2026-09-12): a src-less iframe in hashed classes, no
      // "Ad" text - only its "Ad Options" dialog ("Report this ad") says what
      // it is, and that dialog is in the DOM hidden until opened. So: from the
      // menu text (visible or not) climb to the first modest ancestor holding
      // a piece of media at least 200px wide (iframe, img, video), then cover
      // that media's own wrapper (the same-size box around it) - not the
      // ancestor, which on LinkedIn also holds the footer links.
      id: "ad-menu",
      run: function (root, ctx) {
        var AD_MENU = /^(ad options|report (this )?ad|why (am i seeing )?this ad\??|hide (this )?ad|stop seeing this ad|about this ad|this ad is not relevant)$/i;
        var base = (root === document) ? document.body : root;
        var tw = document.createTreeWalker(base, NodeFilter.SHOW_TEXT), tn, seen = 0, done = new Set();
        while ((tn = tw.nextNode()) && seen++ < 40000) {
          var tt = tn.nodeValue && tn.nodeValue.trim();
          if (!tt || tt.length > 32 || !AD_MENU.test(tt)) continue;
          var host = tn.parentElement; if (!host) continue;
          if (host.closest && host.closest("[data-prism-ui],[data-prism-veil]")) continue;
          var an = host.parentElement, media = null;
          for (var d = 0; an && d < 10 && an !== document.body && an !== document.documentElement; d++, an = an.parentElement) {
            var ar = an.getBoundingClientRect();
            if (PV.pageSized(ar) || ar.width * ar.height > innerWidth * innerHeight * 0.35) break;
            var ms = an.querySelectorAll("iframe,img,video"), best = null, bestW = 0;
            for (var i = 0; i < ms.length; i++) { var mr = ms[i].getBoundingClientRect(); if (mr.width >= 200 && mr.height >= 100 && mr.width > bestW) { bestW = mr.width; best = ms[i]; } }
            if (best) { media = best; break; }
          }
          if (!media || done.has(media)) continue;
          done.add(media);
          ctx.add(PV.unitAround(media, 6), "ad-menu: " + tt);
        }
      },
    },
    {
      id: "x-promoted",
      // X / Twitter (traceable source: X's own ad markup). A promoted post,
      // and the Explore page's promoted event hero, sit in X's ad-placement
      // tracking wrapper <div data-testid="placementTracking"> (report
      // 2026-09-12: "Timeline: Explore", data-testid=eventHero >
      // placementTracking > videoPlayer, 598x336 - X's classes are hashed, so
      // no selector could name it and the bare "Ad" label has no ad-ish class
      // around it). The unit is the enclosing <article> (a promoted post) when
      // it is about the wrapper's size, else the wrapper itself (the hero).
      // Promoted trends carry X's own "Promoted by ..." line in a
      // [data-testid="trend"] cell.
      host: /(^|\.)(x\.com|twitter\.com)$/i,
      run: function (root, ctx) {
        // placementTracking is NOT ad-only: X wraps EVERY embedded video
        // player in one (four reports 2026-09-12, organic video posts veiled:
        // placementTracking > videoPlayer > videoComponent > video, 0:05 to
        // 3:03 long, no "Ad" anywhere). It marks an ad only when it wraps the
        // whole post - the <article> is inside it - or sits in the Explore
        // event hero, X's promoted spotlight.
        root.querySelectorAll("[data-testid='placementTracking']").forEach(function (pt) {
          var r = pt.getBoundingClientRect();
          if (r.width < 120 || r.height < 60) return;
          var artIn = pt.querySelector("article");
          if (artIn) {
            var ar = artIn.getBoundingClientRect();
            if (ar.height < innerHeight * 1.6) ctx.add(artIn, "x-promoted: placementTracking around the post", true);
            return;
          }
          var hero = pt.closest && pt.closest("[data-testid='eventHero']");
          if (!hero) return;   // a video player's own tracking box: not an ad
          // The hero: the wrapper is one absolute-fill child of the hero, its
          // caption overlay ("Spend $5 & Get $200 in Bonuses!") a SIBLING on
          // top of it (second report 2026-09-12: the link text clickable over
          // the veil). Cover the outermost same-size box, which holds both.
          ctx.add(PV.unitAround(hero, 8), "x-promoted: event hero", true);
        });
        // X's own disclosure on a promoted post: a short leaf reading "Ad"
        // (header, top right) or "Promoted" (older layout, bottom left) -
        // never inside the post's own text (data-testid=tweetText).
        root.querySelectorAll("article").forEach(function (art) {
          var ar = art.getBoundingClientRect();
          if (ar.width < 200 || ar.height < 80 || ar.height > innerHeight * 1.6) return;
          var spans = art.querySelectorAll("span,div"), hit = null;
          for (var i = 0; i < spans.length && !hit; i++) {
            var s = spans[i], t = PV.ownText(s);
            if (!t || t.length > 8 || !/^(ad|promoted)$/i.test(t)) continue;
            if (s.closest && s.closest("[data-testid='tweetText'],[data-testid='placementTracking']")) continue;
            var sr = s.getBoundingClientRect();
            if (sr.width <= 0 || sr.width > 90 || sr.height > 30) continue;
            hit = t;
          }
          if (hit) ctx.add(art, "x-promoted: " + hit + " label", true);
        });
        root.querySelectorAll("[data-testid='trend']").forEach(function (tr) {
          var els = tr.querySelectorAll("span,div"), hit = false;
          for (var i = 0; i < els.length && !hit; i++) { var t = PV.ownText(els[i]); if (t && t.length < 40 && /^(promoted( by\b.*)?|ad)$/i.test(t)) hit = true; }
          if (hit) ctx.add(tr, "x-promoted: trend");
        });
      },
    },
    {
      // YouTube's inline HOVER preview (traceable source: YouTube's own
      // ytd-video-preview / #video-preview, a page-level box that opens over
      // the tile under the mouse and plays it). Over a veiled ad tile it is
      // the ad again, above the cover ("put my mouse over ads and they show
      // up", 2026-09-12). Cover the preview while at least 60% of it lies on
      // a veiled target; over an ordinary tile it is left alone.
      id: "youtube-hover-preview",
      host: /(^|\.)youtube\.com$/i,
      run: function (root, ctx) {
        if (!PV.veils || !PV.veils.size) return;
        root.querySelectorAll("ytd-video-preview, #video-preview").forEach(function (pv) {
          var pr = pv.getBoundingClientRect();
          if (pr.width < 120 || pr.height < 60) return;
          var over = false;
          PV.veils.forEach(function (c, t) {
            if (over || t === pv || !t.isConnected) return;   // never itself: YouTube moves ONE preview box from tile to tile
            var tr = t.getBoundingClientRect();
            var w = Math.min(pr.right, tr.right) - Math.max(pr.left, tr.left), h = Math.min(pr.bottom, tr.bottom) - Math.max(pr.top, tr.top);
            if (w > 0 && h > 0 && w * h >= pr.width * pr.height * 0.6) over = true;
          });
          if (!over) return;
          // An INSIDE cover, never a forced overlay: YouTube animates the
          // preview box open (it grows past the tile's edges), and an overlay
          // placed at sweep time stayed where the box started - "the veil
          // moves to the left and overlaps the ad veil next to it", report
          // 2026-09-12. A child cover rides the box through the animation.
          ctx.add(pv, "youtube-hover-preview", true);
        });
      },
    },
  ];

  // ---------------------------------------------------------------- collect
  function slotMatch(el) {
    for (var i = 0; i < SLOT_SELECTORS.length; i++) { try { if (el.matches(SLOT_SELECTORS[i])) return SLOT_SELECTORS[i]; } catch (e) {} }
    return "?";
  }
  // A [class*='ad…'] substring selector also matches classes where "ad" is
  // merely the tail of a word: Hulu's hero banner is "Masthead__container"
  // (reported 2026-08-29), and Thread/Download/Broadcast/Head/Load/Read are
  // all waiting. The "ad" must start a word: the character before it in the
  // class token must not be a letter.
  // A GAM OUT-OF-PAGE unit paints its creative OUTSIDE the slot's own box
  // (traceable source: GPT's out-of-page slots - interstitials, anchors, and
  // Fox's Jetpack masthead at ".../hp/oop_0"). The slot's container is a
  // spacer: Fox's sat 1897x212 inside a 0px-tall `.gam-inst` slot while the
  // ad itself was a body-level #jpmasthead, so the art landed on page content
  // once the person closed the ad, and rode the scroll into where the ad had
  // been (reports 2026-09-11). Skip the container / iframe when its GPT unit
  // path says out-of-page, or when the publisher's slot element around it has
  // no height (the box overflows a collapsed slot: nothing is laid out there).
  function isOutOfPageSlot(el) {
    var id = el.id || "";
    if (!/^google_ads_iframe/.test(id)) return false;
    if (/\/oop([_\/]|$)|out-?of-?page|interstitial/i.test(id)) return true;
    var slot = el.parentElement;
    if (el.tagName === "IFRAME" && slot) slot = slot.parentElement;   // iframe -> __container__ -> the publisher's slot
    try {
      if (slot && slot !== document.body && slot !== document.documentElement &&
          slot.getBoundingClientRect().height === 0 && el.getBoundingClientRect().height > 0) return true;
    } catch (e) {}
    return false;
  }
  function isSlotWrapper(el, sel) {
    if ((el.getAttribute("role") || "") === "banner") return true;
    var m = /^\[class\*='([^']*)'\]$/i.exec(sel); if (!m) return false;
    var needle = m[1].toLowerCase(), toks = PV.classStr(el).split(/\s+/);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i].toLowerCase();
      if (t.indexOf(needle) >= 0 && /(^|[-_])(wrapper|outer|region|zone)$/.test(t)) return true;
    }
    return false;
  }
  function adWordFalse(el, sel) {
    var m = /^\[class\*='(ad[^']*)'\]$/i.exec(sel); if (!m) return false;
    var needle = m[1].toLowerCase(), toks = PV.classStr(el).split(/\s+/);
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i].toLowerCase(), at = t.indexOf(needle);
      while (at >= 0) {
        if (at === 0 || !/[a-z]/.test(t.charAt(at - 1))) return false;   // a real "ad…" token
        at = t.indexOf(needle, at + 1);
      }
    }
    return true;   // every occurrence was mid-word
  }

  /**
   * All ad elements on the page right now, deduped innermost-only (a container
   * holding another target is not the ad) except for `whole` targets, which
   * win over anything nested inside them. Returns { targets:Set, why:Map }.
   */
  function collectTargets() {
    var targets = new Set(), why = new Map(), wholeCovers = new Set();
    if (!document.body) return { targets: targets, why: why };
    var ctx = {
      add: function (el, reason, whole) {
        if (!el || !PV.isVisible(el)) return;
        if (el.__prismTooBigAt && Date.now() - el.__prismTooBigAt < 15000) return;   // a cover the sweep just dropped for growing to page/column size (any rule)
        targets.add(el); why.set(el, reason);
        if (whole) {
          wholeCovers.add(el);
          targets.forEach(function (t) { if (t !== el && PV.deepContains(el, t)) targets.delete(t); });
        }
      },
    };
    // 120000 text nodes (was 45000): a long LinkedIn feed is one document
    // that only grows as you scroll, and a promoted post far down was covered
    // "only sometimes" (2026-09-12) - the budget ran out above it.
    var roots = PV.collectRoots(), budget = 120000;
    var active = SITE_RULES.filter(function (r) { return !r.host || hostIs(r.host); });
    // The selector and site passes are cheap and run for EVERY root; only the
    // text walker below is budget-limited, else deep feed ads get no pass.
    for (var ri = 0; ri < roots.length; ri++) {
      var root = roots[ri];
      try {
        root.querySelectorAll(SLOT_QUERY).forEach(function (el) {
          // Inside a main video player (YouTube's #movie_player, any
          // .html5-video-player) the ad chrome is the VIDEO veil's business:
          // YouTube keeps an empty div.video-ads.ytp-ad-module there at all
          // times, and covering it veils the whole player at page load.
          if (el.closest && el.closest(".html5-video-player")) return;
          var sm = slotMatch(el);
          if (adWordFalse(el, sm)) return;
          // An ad SLOT is never the whole page: MSN's .ad-banner-wrapper spans
          // the viewport for a moment at load (reported 2026-08-29: full-screen
          // veil, then gone). Skip page-sized elements, and any element a
          // cover just had to abandon for growing that big (covers.js).
          // (an IMA ad iframe is player-sized by nature - it belongs to the video veil, not here)
          try {
            if (el.tagName === "IFRAME" && /imasdk\.googleapis/.test(el.src || "")) {
              // Player-sized: the video veil's. A SMALL player is below that
              // veil's 400px floor - an OUTSTREAM unit (AP News's Primis
              // player, 340x191, IMA iframe + a Flashtalking creative, report
              // 2026-09-13): cover its box like a display ad, whole. The IMA
              // iframe is the traceable signal (Google IMA SDK = an ad is
              // playing there); it goes when the ad does, and so does the cover.
              var ir = el.getBoundingClientRect();
              if (ir.width >= 120 && ir.height >= 60 && (ir.width < 400 || ir.height < 200)) {
                var ou = PV.unitAround(el, 8);
                if (!PV.pageSized(ou.getBoundingClientRect())) ctx.add(ou, "outstream-ima", true);
              }
              return;
            }
          } catch (eI) {}
          try { if (PV.pageSized(el.getBoundingClientRect())) return; } catch (eS) {}
          if (el.__prismTooBigAt && Date.now() - el.__prismTooBigAt < 15000) return;
          // A WRAPPER around a slot is not the slot (MSN .ad-banner-wrapper,
          // role=banner, holds display-ads which are covered on their own).
          if (isSlotWrapper(el, sm)) return;
          // An out-of-page GAM container is a spacer; its ad paints elsewhere.
          if (isOutOfPageSlot(el)) return;
          ctx.add(el, "slot-selector: " + sm);
        });
      } catch (e) {}
      // ad-stack slots (publisher ad-management wrappers), filled ones only
      try {
        root.querySelectorAll(STACK_QUERY).forEach(function (el) {
          if (el.closest && el.closest(".html5-video-player")) return;
          if (!stackFilled(el)) return;
          try { if (PV.pageSized(el.getBoundingClientRect())) return; } catch (eS2) {}
          if (el.__prismTooBigAt && Date.now() - el.__prismTooBigAt < 15000) return;
          ctx.add(el, "ad-stack: " + stackMatch(el));
        });
      } catch (e2) {}
      for (var si = 0; si < active.length; si++) {
        try { active[si].run(root, ctx); } catch (e) {}
      }
      // Generic "Ad"/"Sponsored" label walker within this root's light tree.
      // Skipped on LABEL_WALKER_OFF hosts (Amazon), where "Sponsored" tags
      // shopping results rather than ad units.
      var base = (root === document) ? document.body : root;
      var walker = LABEL_WALKER_OFF.test(location.hostname) ? null : document.createTreeWalker(base, NodeFilter.SHOW_TEXT), n;
      while (walker && (n = walker.nextNode()) && budget > 0) {
        budget--;
        var t = n.nodeValue && n.nodeValue.trim();
        if (!t || t.length > 28) continue;
        var isSection = SECTION_AD.test(t);
        if (!BADGE.test(t) && !isSection) continue;
        var host = n.parentElement;
        if (!host) continue;
        if (/^(ad|ads)$/i.test(t)) {
          var okBare = false, hn = host, hd = 0;
          while (hn && hd < 3) { if (AD_LABEL_CLS.test(PV.classStr(hn))) { okBare = true; break; } hn = hn.parentElement; hd++; }
          if (!okBare) continue;
        }
        var hr = host.getBoundingClientRect();
        if (hr.width <= 0 || hr.height <= 0) continue;
        if (huluHousePromo(host)) continue;
        var unit = badgeUnit(host, false, isSection);
        if (unit) ctx.add(unit, (isSection ? "section-label: " : "badge-label: ") + t, isSection);
      }
    }
    // Innermost-only dedupe, whole-covers winning.
    var arr = Array.from(targets);
    arr.forEach(function (a) {
      arr.forEach(function (b) {
        if (a === b || !targets.has(a) || !targets.has(b) || !PV.deepContains(a, b)) return;
        if (wholeCovers.has(a)) targets.delete(b); else targets.delete(a);
      });
    });
    why.forEach(function (v, k) { if (!targets.has(k)) why.delete(k); });
    return { targets: targets, why: why };
  }

  PV.SLOT_SELECTORS = SLOT_SELECTORS;
  PV.AD_STACKS = AD_STACKS;
  PV.SITE_RULES = SITE_RULES;
  PV.BADGE = BADGE;
  PV.SECTION_AD = SECTION_AD;
  PV.badgeUnit = badgeUnit;
  PV.collectTargets = collectTargets;
})();
