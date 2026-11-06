/*
  The doctor's dump function (scripts/doctor, 2026-11-03), shared by dump.mjs (a page in headless Firefox) and dump-tile.mjs (a page of
  the running host, through the dev eval hook). One function, one filter: see docs/doctor.md, "Structure only, never content".
  strict = 1 for a household's page (a hidden page of the host): an id or marker value with a space in it, or longer than 48
  characters, is kept as its length alone, so a title or a name never comes along as a marker.
*/
// Runs in the page. Plain ES5-ish so any page's Firefox takes it; returns a JSON string (BiDi serialises a string in one piece).
export const DUMP_FN = `function (budget, strict) {
  var LABEL = /^(ad|ads|advert\\w*|advertisement|sponsored|sponsored\\b.*|promoted|promoted\\b.*|paid\\b.*|partner\\b.*|skip|skip ad|skip ads|learn more|shop now|install|open|visit\\b.*|why this ad|ad choices|adchoices|hide ad|report ad|close|dismiss|intermission|ad \\d+ of \\d+|\\d+ ?s|your video will (resume|play).*|video will play after ad|recommended by|from around the web|paid partner content|promoted stories|sponsored stories)$/i;
  var HINT = /\\b(ad|ads|advert\\w*|sponsor\\w*|promot\\w*|paid|skip)\\b/i;   // whole words: "Adventure", "Arcade" and "Headline" are not ad labels (MSN, 2026-11-03)
  // a player's own control words, kept so an adapter's selector on them can be counted (Spotify's [aria-label="Play"], 2026-11-04);
  // anchored whole, so "Play <a song's name>" is not one of them
  var UI = /^(play|pause|stop|next|previous|prev|skip|skip (back|ahead|forward|backward)|back|forward|rewind|fast forward|mute|unmute|volume|shuffle|repeat|repeat one|like|unlike|dislike|thumbs? (up|down)|add to (liked songs|library|your library|playlist|queue|favorites|favourites|my list|watchlist)|remove from (liked songs|library|your library|playlist|queue|favorites|favourites|my list|watchlist)|save|saved|sign in|log in|sign out|log out|close|dismiss|search|home|library|queue|lyrics|fullscreen|full screen|exit fullscreen|minimi[sz]e|maximi[sz]e|settings|more|more options|menu|now playing|account|profile|cast|connect to a device|captions|subtitles|audio)$/i;
  var scrubUrls = function (s) { return s.replace(/https?:\\/\\/[^\\s"<>]+/g, function (u) { return "host:" + hostOf(u); }); };
  var nodes = [], covers = [], frames = [], videos = [], shadows = 0, counted = 0, pruned = 0;
  var hostOf = function (u) { try { return u ? new URL(u, location.href).hostname : ""; } catch (e) { return ""; } };
  var ownText = function (el) {
    var s = "", n = el.firstChild;
    while (n) { if (n.nodeType === 3) s += n.nodeValue; n = n.nextSibling; }
    return s.replace(/\\s+/g, " ").trim();
  };
  var SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, TITLE: 1, BASE: 1 };
  var walk = function (el, parent, depth, inShadow) {
    if (nodes.length >= budget) { pruned++; return; }
    var tag = el.tagName; if (!tag || SKIP[tag]) return;
    if (el.hasAttribute("data-prism-veil") || el.hasAttribute("data-prism-ui")) return;   // the covers are collected whole below, outside the budget
    if (tag === "svg" || tag === "SVG") { tag = "svg"; }
    var r = el.getBoundingClientRect();
    var rec = { t: tag.toLowerCase(), p: parent, d: depth };
    if (el.id) { var idv = String(el.id); rec.i = (strict && (idv.length > 48 || idv.indexOf(" ") >= 0)) ? "~" + idv.length : idv.slice(0, 60); }
    var cls = (typeof el.className === "string" ? el.className : (el.getAttribute("class") || "")).trim();
    if (cls) rec.c = cls.split(/\\s+/).slice(0, 10).map(function (c) { return c.slice(0, 48); });
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i], n = a.name;
      if (n === "id" || n === "class" || n === "style") continue;
      if (n === "href" || n === "src" || n === "data-src" || n === "poster" || n === "action") { var h = hostOf(a.value); if (h) attrs[n] = "host:" + h; continue; }
      if (n === "aria-label" || n === "alt" || n === "title" || n === "placeholder") { var tv = (a.value || "").trim(); if (tv.length <= 28 && (LABEL.test(tv) || HINT.test(tv) || UI.test(tv))) attrs[n] = tv; else if (tv) attrs[n] = "~" + tv.length; continue; }
      if (n.indexOf("data-") === 0 || n === "role" || n === "aria-selected" || n === "aria-controls" || n === "aria-current" || n === "aria-expanded" || n === "tabindex" || n === "part" || n === "aria-posinset" || n === "aria-hidden" || n === "type" || n === "name" || n === "slot" || n === "hidden" || n === "controls" || n === "autoplay" || n === "muted" || n === "loading" || n === "sandbox" || n === "allow") {
        var v = scrubUrls(a.value == null ? "" : String(a.value));   // an address inside a marker's value is kept as its host alone
        attrs[n] = (strict && (v.length > 48 || v.indexOf(" ") >= 0)) ? "~" + v.length : v.length > 48 ? v.slice(0, 45) + "..." : v;   // strict (a household page): a value that reads like a title is its length alone
        continue;
      }
      // any other attribute: an adapter's selector may name it (Apple Music's direction="next"), so a short one-word value is kept and
      // anything else is its length; in strict mode a name that could hold a person's details is its length whatever it holds
      if (n === "value" || n === "content" || n === "srcset" || n === "d" || n === "points" || n === "viewbox" || n === "xmlns" || n.indexOf("on") === 0) continue;
      var ov = a.value == null ? "" : String(a.value);
      attrs[n] = (ov.length <= 24 && ov.indexOf(" ") < 0 && !(strict && /user|name|email|account|profile|owner|member|avatar|phone|address/i.test(n))) ? ov : "~" + ov.length;
    }
    if (Object.keys(attrs).length) rec.a = attrs;
    rec.r = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    var cs = null; try { cs = getComputedStyle(el); } catch (e) {}
    if (cs) {
      if (cs.display === "none") rec.hid = 1;
      if (cs.visibility === "hidden") rec.hid = 1;
      if (cs.position === "fixed" || cs.position === "sticky") rec.pos = cs.position;
      var z = parseInt(cs.zIndex, 10); if (z > 0) rec.z = z;
    }
    var tx = ownText(el);
    if (tx) { rec.n = tx.length < 40 ? "s" : tx.length < 200 ? "m" : "l"; if (tx.length <= 28 && (LABEL.test(tx) || HINT.test(tx))) rec.x = tx; }
    if (tag === "IFRAME") frames.push({ idx: nodes.length, host: hostOf(el.src), r: rec.r });
    if (tag === "VIDEO") videos.push({ idx: nodes.length, host: hostOf(el.currentSrc || el.src), r: rec.r, paused: el.paused, muted: el.muted, dur: Math.round(el.duration || 0) });
    if (inShadow) rec.sh = 1;
    var me = nodes.length; nodes.push(rec);
    if (el.shadowRoot) { rec.host = 1; shadows++; var sc = el.shadowRoot.children; for (var s = 0; s < sc.length; s++) walk(sc[s], me, depth + 1, true); }
    var kids = el.children, N = kids.length;
    // a long run of same-tag siblings (a feed, a grid) is sampled: the first 12 and the last 2, with the count kept
    if (N > 16) {
      var same = true; for (var q = 1; q < N; q++) if (kids[q].tagName !== kids[0].tagName) { same = false; break; }
      if (same) { rec.kids = N; for (var k = 0; k < N; k++) { if (k < 12 || k >= N - 2) walk(kids[k], me, depth + 1, false); else pruned++; } return; }
    }
    for (var j = 0; j < N; j++) walk(kids[j], me, depth + 1, false);
  };
  // every cover on the page, through every open shadow root, BEFORE the budgeted walk: a page past the budget (MSN, Reddit) lost the
  // covers the walk never reached, and the gate's judge saw covers on the screenshot that the list did not have (2026-11-04)
  var roots = [document], ri = 0;
  while (ri < roots.length) {
    var rt = roots[ri++];
    var cvs = rt.querySelectorAll("[data-prism-veil],[data-prism-ui]");
    for (var ci = 0; ci < cvs.length; ci++) {
      var ce = cvs[ci]; if (ce.parentNode && ce.parentNode.nodeType === 1 && (ce.parentNode.hasAttribute("data-prism-veil") || ce.parentNode.hasAttribute("data-prism-ui"))) continue;   // the glyph inside a cover
      var cr = ce.getBoundingClientRect();
      covers.push({ r: [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)], ui: ce.hasAttribute("data-prism-ui") ? 1 : 0, why: ce.getAttribute("data-prism-why") || ce.getAttribute("title") || "" });
    }
    var everything = rt.querySelectorAll("*");
    for (var ei = 0; ei < everything.length; ei++) if (everything[ei].shadowRoot) roots.push(everything[ei].shadowRoot);
  }
  walk(document.documentElement, -1, 0, false);
  var html = document.documentElement;
  var marks = {};
  for (var m = 0; m < html.attributes.length; m++) if (html.attributes[m].name.indexOf("data-prism-") === 0) marks[html.attributes[m].name] = String(html.attributes[m].value).slice(0, 2000);
  return JSON.stringify({ host: location.hostname, nodes: nodes, covers: covers, frames: frames, videos: videos, shadows: shadows, pruned: pruned, marks: marks,
    viewport: [innerWidth, innerHeight], scrollY: Math.round(scrollY), docHeight: Math.round(document.documentElement.scrollHeight) });
}`;
