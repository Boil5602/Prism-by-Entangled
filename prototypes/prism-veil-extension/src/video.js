/*
  Prism Veil - VIDEO AD BREAKS (spec sections 26/27). One fixed cover over the
  main player while a break runs: art with a slow drift, an Intermission card
  with the player's own countdown, a hole over a reachable Skip, muted
  underneath, and the show back the instant the break ends.

  Two ad signals, both measured, never guessed:
    1. The IMA / DAI SDK's own events, published by ima-hook.js to
       <html data-prism-ad="active"> (+ data-prism-adpod / data-prism-adrem).
    2. SSAI_AD_SOURCES - a registry of players whose ads are server-stitched:
       each row names the source and the player's OWN ad-mode marker.

  The veil is a small state machine with ONE invariant, re-asserted every tick:
    mode "ad"    -> an ad is on: opaque cover over the whole player + muted.
    mode "pause" -> the show is deliberately paused: same cover, Paused card.
    (no veil)    -> nothing.
  Detection drives everything. We never poke the player except two deliberate,
  single (never looped) actions a human asked for: Resume, and the one pause at
  a break's end when "Pause after break" is set.
*/
(function () {
  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});

  var SKIP_UI = /^\s*skip(\s*(ad|ads|intro|recap))?\s*$/i;
  var MAX_VIDEO_BREAK_MS = 300000;  // 5 min: no break is trusted past this
  var AD_END_GRACE_MS = 2500;       // hold the ad veil this long after the marker drops
  var AD_MIN_HOLD_MS = 1500;        // a fresh ad veil never drops sooner (player re-layout at ad start)
  var AD_GAP_HOLD_MS = 10000;
  var holdTraceAt = 0, pauseWhyAt = 0;
  var skipAt = 0;   // the human clicked Skip through the hole: no end-grace, no gap hold - uncover as the marker drops
  // The clip-path hole lets a real click reach the control directly (0.7.98),
  // bypassing the cover's forwarder: notice it here.
  addEventListener("click", function (e) {
    try {
      if (!vidVeil || vidVeil.mode !== "ad" || !vidVeil.cover || !vidVeil.cover.__holeEl) return;
      var el = vidVeil.cover.__holeEl, t = e.target;
      if (t === el || (el.contains && el.contains(t))) { skipAt = Date.now(); trace("skip clicked (direct)"); }
    } catch (x) {}
  }, true);
  var SOFT_CONTENT_S = 4;           // a soft (selector-only) ad signal over content dies after this much content playback
  var softT0 = -1;                  // content time when the soft signal began        // between two ads in a pod the player loads (paused/buffering, marker off): hold, not uncover
  var PAUSE_SETTLE_MS = 1800;       // let a pause-after-break pause take effect
  var RESUME_GRACE_MS = 2500;       // after Resume, ignore lingering ad labels

  // ---------------------------------------------------------------- registry
  // Fields:
  //   host          - hostname gate (RegExp); required for generic containers
  //   container     - the player root (must be on screen and >400x200)
  //   adClass       - exact class the container gains during an ad
  //   adSelector    - OR: a selector inside the container present only during an ad
  //   adBadge       - OR: the player's own on-screen "Ad"/"Advertisement" label text
  //   pausePanel    - class regex: a label inside such a panel is a PAUSE AD,
  //                   never an ad break: the ad unit gets a display cover
  //                   (rules.js pause-panel-ad); the pause veil, if on, covers
  //                   the player with the panel's return button cut out
  //   authoritative - this signal REPLACES the SDK flag (which lingers on some players)
  //   displayWins   - the player's on-screen countdown beats the SDK clock
  //   breakTimer    - that countdown spans the whole break (no per-ad self-count)
  //   veilTarget    - element to size the veil to (default: the largest <video>)
  //   pauseVeil     - false: never show the pause intermission on this player
  //   endGraceMs    - per-player end-of-ad grace (default AD_END_GRACE_MS)
  //   resumeVia     - "control": Resume clicks the player's own play control
  //                   first (raw play() leaves its UI thinking it is paused);
  //                   default: raw play() first, control only if still paused
  //   adInfo(cont)  - { count: "N of M" | null, remaining: seconds | null }
  var SSAI_AD_SOURCES = [
    {
      // Hulu (traceable source: Hulu web player, also the Store PWA). Regular
      // breaks are server-stitched into the CONTENT stream
      // (#content-video-player) and the player shows an "Ad" badge; VPAID
      // units play in a separate <video id="ad-video-player"> inside
      // div.AdPlayer, which drops AdPlayer--hidden for the duration. Either
      // signal means an ad.
      // A regular break is server-stitched into #content-video-player and shows
      // an "Ad" badge; the .AdUnitView__adBar (with the M:SS countdown) fades
      // out with the controls, so the badge is the signal that persists for the
      // whole ad. The catch: Hulu also paints "Ad" break MARKERS on the seek bar
      // (shown on hover during CONTENT), so the badge is IGNORED when it sits in
      // a scrubber/seek/timeline container (badgeExclude) - that stops mere
      // mouse-over from raising the intermission.
      // A PAUSE ad (.PauseAd--expanded) only shows while paused, so it is left
      // to the pause veil (which covers the whole player and offers Resume).
      source: "Hulu web player",
      host: /(^|\.)hulu\.com$/i,
      container: ".Player__container",
      adSelector: ".AdUnitView__adBar, .AdPlayer:not(.AdPlayer--hidden)",
      adBadge: /^(ad|advertisement)$/i,
      // seek-bar break markers (hover, during content) and the pause-ad overlay
      // both carry "Ad" text but are not an ad BREAK - leave them to hover/pause.
      badgeExclude: /seek|scrub|timeline|progress|marker|cue|slider|rail|pausead/i,
      veilTarget: ".Player__container",
      authoritative: true,
      displayWins: true,
      breakTimer: true,   // the timer counts the WHOLE break, not one ad
      adInfo: function (cont) {
        var t = cont.querySelector(".AdUnitView__adBar__timer");
        var rem = parseClock(t && t.textContent);
        return { count: adCountText(cont), remaining: rem >= 0 ? rem : null };
      }
    },
    {
      // Peacock (traceable source: Peacock web player). Server-stitched, no
      // IMA. During a break the player overlay carries a hashed
      // "adBreakActive-<hash>" class and shows a seconds countdown in a
      // "numericDisplay-<hash>" span. Hashes rotate per build, so match prefix.
      source: "Peacock web player",
      host: /(^|\.)peacocktv\.com$/i,
      container: "#mainContainer",
      adSelector: "[class*='adBreakActive']",
      authoritative: true,
      displayWins: true,
      adInfo: function (cont) {
        var n = cont.querySelector("[class*='adBreakActive'] [class*='numericDisplay'], [class*='numericDisplay']");
        var rem = parseClock(n && n.textContent);
        // Reported 2026-08-29: no time for the first ~30s of a break; the real
        // countdown sits BOTTOM-LEFT of the player. Read it by position.
        if (rem < 0) rem = regionClock(cont, { top: 0.6, left: 0, width: 0.45, height: 0.4 });
        return { count: adCountText(cont), remaining: rem >= 0 ? rem : null };
      }
    },
    {
      // CNN / Warner Bros Discovery "bolt" player: the container gains fave-ad
      // during an ad; the badge shows ":SS" and "N of M".
      source: "CNN / Warner Bros Discovery bolt player",
      container: ".fave-player-container",
      adClass: "fave-ad",
      adClassRe: /(^|\s)fave-ad(-[a-z]+)?(\s|$)/,   // fave-ad-playing (2026-08-29)
      adBadge: /^(ad|advertisement|ad\s*\d+\s*of\s*\d+)$/i,
      authoritative: true,
      adInfo: function (cont) {
        var rem = null, els = cont.querySelectorAll("span,div,p");
        for (var i = 0; i < els.length; i++) {
          var t = PV.ownText(els[i]);
          if (/^:\d{1,2}$/.test(t)) { rem = parseClock(t); break; }
        }
        return { count: adCountText(cont), remaining: rem };
      }
    },
    {
      // YouTube (traceable source: YouTube's own player; report 2026-08-29 -
      // the display-ad pass had matched the EMPTY, always-present
      // div.video-ads.ytp-ad-module and veiled the whole player at page load).
      // No IMA here. During a break #movie_player carries "ad-showing" (and
      // "ad-interrupting"); the ad module fills with the badge/countdown and
      // the Skip button, which the veil's own Skip passthrough picks up.
      source: "YouTube player",
      host: /(^|\.)youtube\.com$/i,
      container: "#movie_player",
      adClass: "ad-showing",
      // The ad module is EMPTY between breaks (0 children, observed) and is
      // populated for the next ad before the class flips: a second, earlier
      // signal that also bridges the content beat between two ads.
      adSelector: ".video-ads.ytp-ad-module > *",
      // Trace 2026-08-29: ad 1 -> content for ~3s (marker off, content clip
      // playing) -> ad 2. 2.5s grace uncovered into that beat.
      endGraceMs: 4000,
      veilTarget: "#movie_player",
      // pauseVeil was off here (hover previews / scrolling flashed it, 0.7.10);
      // the main video is now pinned to #movie_player and a pause must follow
      // the human's input (0.7.93), so YouTube gets the pause veil like everyone.
      // Between two ads of a pod the marker is off while the <video> already
      // plays ad 2 (trace 2026-08-29: down @12.9s, up at once; the element was
      // playing with a duration). The page declares the CONTENT length
      // (<meta itemprop="duration" content="PT4M13S">); a clip whose duration
      // is anything else is an ad, whatever the marker says.
      isAdClip: function (v) {
        var d; try { d = v.duration; } catch (e) { return false; }
        if (!isFinite(d) || d <= 0) return false;
        // The page's declared length counts only if its metadata is for THIS
        // video (SPA navigation leaves the previous video's meta for a while:
        // an 8-minute video was judged an ad clip, 2026-08-29).
        var m = document.querySelector("meta[itemprop='duration']"), L = 0;
        var mv = document.querySelector("meta[itemprop='identifier'], meta[itemprop='videoId']");
        var cur = (/[?&]v=([\w-]{11})/.exec(location.search) || [])[1] || "";
        var metaOk = !!(mv && cur && (mv.getAttribute("content") || "") === cur);
        if (m && metaOk) { var mm = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(m.getAttribute("content") || ""); if (mm) L = (+mm[1] || 0) * 3600 + (+mm[2] || 0) * 60 + (+mm[3] || 0); }
        // Known content length: an ad is anything else that is ad-length.
        // Unknown: only a genuinely ad-length clip (<= 3 min) counts.
        return L > 0 ? (Math.abs(d - L) > 2 && d <= 180) : d <= 180;
      },
      authoritative: true,
      displayWins: true,
      adInfo: function (cont) {
        var rem = -1, t;
        var d = cont.querySelector(".ytp-ad-duration-remaining, [class*='ad-duration-remaining']");
        if (d) rem = parseClock((d.textContent || "").trim());
        if (rem < 0) {   // "Ad 1 of 2 · 0:15", "Ad · 0:15", or the preview countdown "5"
          var els = cont.querySelectorAll(".ytp-ad-text, [class*='ad-badge'], [class*='ad-info'] span, .ytp-ad-preview-text, [class*='ad-preview-text']");
          for (var i = 0; i < els.length && rem < 0; i++) {
            t = (els[i].textContent || "").trim(); var m = t.match(/(\d{1,2}:\d{2})/);
            if (m) rem = parseClock(m[1]); else if (/^\d{1,2}$/.test(t) && /preview/.test(els[i].className + "")) rem = parseInt(t, 10);
          }
        }
        if (rem < 0) {   // "clean player" chrome (2026): "Sponsored" badge, the time on hover -
          // read any M:SS in the ad module's text, aria-label or title, hidden or not
          var mod = cont.querySelector(".video-ads") || cont, nodes = mod.querySelectorAll("*");
          for (var k = 0; k < nodes.length && rem < 0; k++) {
            var n = nodes[k], cands = [PV.ownText(n), n.getAttribute("aria-label") || "", n.getAttribute("title") || ""];
            for (var c = 0; c < cands.length && rem < 0; c++) { var mc = cands[c] && cands[c].length < 80 && cands[c].match(/(\d{1,2}:\d{2})/); if (mc) rem = parseClock(mc[1]); }
          }
        }
        if (rem < 0) {
          // YouTube ads are NOT stitched: during ad-showing the <video> IS the
          // ad clip, so its own clock is exact. Short, finite = an ad unit.
          var v = cont.querySelector("video");
          try { if (v && isFinite(v.duration) && v.duration > 0 && v.duration < 600 && clockLive(v)) rem = Math.max(0, v.duration - v.currentTime); } catch (e0) {}
        }
        var count = adCountText(cont);
        if (!count) { var all = cont.querySelectorAll(".ytp-ad-text, [class*='ad-badge'], [class*='ad-info']"); for (var j = 0; j < all.length; j++) { var mm = (all[j].textContent || "").match(/(\d+)\s*of\s*(\d+)/i); if (mm) { count = mm[1] + " of " + mm[2]; break; } } }
        return { count: count, remaining: rem >= 0 ? rem : null };
      }
    },
    {
      // Kick (traceable source: Kick's own ad chrome, reported 2026-08-30 on
      // a VOD - data-testid="ad-learn-more" / "ad-fullscreen", a "26s left"
      // tabular-nums span, an "Ad 1 of 1" label, "Why this ad?"). Ads are
      // stitched into the stream; the chrome is the signal. Both the live
      // channel player and VOD pages use #injected-channel-player.
      source: "Kick player",
      host: /(^|\.)kick\.com$/i,
      container: "#injected-channel-player",
      adSelector: "[data-testid='ad-learn-more'], [data-testid='ad-fullscreen'], [data-testid^='ad-overlay'], button[aria-label^='Why this ad']",
      authoritative: true,
      displayWins: true,
      resumeVia: "control",
      adInfo: function (cont) {
        var rem = -1, count = null, els = cont.querySelectorAll("span,div,p");
        for (var i = 0; i < els.length && (rem < 0 || !count); i++) {
          var t = PV.ownText(els[i]); if (!t || t.length > 20) continue;
          var m1 = t.match(/^(?:(\d{1,2}):)?(\d{1,2})s?\s*left$/i);
          if (m1 && rem < 0 && adElVisible(els[i])) rem = m1[1] ? (+m1[1]) * 60 + (+m1[2]) : +m1[2];
          var m2 = t.match(/^ad\s*(\d+)\s*of\s*(\d+)$/i);
          if (m2 && !count) count = m2[1] + " of " + m2[2];
        }
        if (rem < 0) rem = regionClock(cont, { top: 0, left: 0, width: 1, height: 1 });
        return { count: count || adCountText(cont), remaining: rem >= 0 ? rem : null };
      }
    },
    {
      // SOOP (sooplive) web player (traceable source: SOOP's stitched-ad chrome
      // #player .da_area - display:none during content; during an ad it holds
      // #da_btn_click "View ad page - 00:00" (the ad's clock) and #da_btn_skip
      // "NN seconds until ad SKIP" that becomes the Skip control; measured
      // 2026-08-29. NOT #videoLayerCover: that click-cover also shows outside
      // ads (false veil reported 0.7.131). IMA units draw the imasdk iframe.
      source: "SOOP web player",
      host: /(^|\.)(sooplive\.com|sooplive\.co\.kr|afreecatv\.com)$/i,
      container: "#player",
      adSelector: ".da_area, iframe[src*='imasdk.googleapis.com']",
      authoritative: true,
      displayWins: false,
      resumeVia: "control",
      adInfo: function (cont) {
        var rem = -1, b = cont.querySelector("#da_btn_click");
        if (b && adElVisible(b)) { var mm = (b.textContent || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); if (mm) rem = mm[3] != null ? (+mm[1]) * 3600 + (+mm[2]) * 60 + (+mm[3]) : (+mm[1]) * 60 + (+mm[2]); }
        if (rem < 0) rem = regionClock(cont, { top: 0, left: 0, width: 1, height: 1 });
        return { count: adCountText(cont), remaining: rem >= 0 ? rem : null };
      }
    },
    {
      // Twitch (traceable source: Twitch web player, report 2026-08-28 from
      // /choc: a 1316x740 .video-player__overlay presentation layer with an
      // "Ad" label beside it, no cover). Breaks are server-stitched
      // (SureStream) into the one <video>; the overlay carries the player's
      // "Ad" / "Ad N of M" label and a countdown (data-a-target
      // video-ad-label / video-ad-countdown, ad-banner-* test selectors).
      // The squeezeback DISPLAY ad (.stream-display-ad__*, present in the DOM
      // during content) is a banner beside the stream, not a break: excluded.
      source: "Twitch web player",
      host: /(^|\.)twitch\.tv$/i,
      container: ".video-player",
      resumeVia: "control",   // a torn-down live stream ignores a raw play() (2026-08-29)
      adSelector: "[data-a-target='video-ad-label'], [data-a-target='video-ad-countdown'], [data-test-selector^='ad-banner']",
      // "Ad", "Ad 2 of 3", or the label with the clock riding in the same
      // element ("Ad · 0:14"): all count.
      adBadge: /^(ad|advertisement|ad\s*\d+\s*of\s*\d+)(\s*[·•|:\-]?\s*\d{1,2}:\d{2})?$/i,
      badgeExclude: /seek|scrub|timeline|progress|marker|slider|stream-display-ad|sda-/i,
      veilTarget: ".video-player",
      authoritative: true,
      displayWins: true,
      breakTimer: true,
      adInfo: function (cont) {
        // The countdown sits at the top of the player next to "Ad". Its
        // element/format are not pinned (Twitch rebuilds hashed classes), so:
        // any short text in the overlay that reads like a clock - "0:14",
        // ":14", "14", "14s", "14 sec" - nearest to the Ad badge wins.
        // Observed 2026-08-28 (DevTools, /kaicenat): <span data-a-target=
        // "video-ad-countdown">Ad (0:16)</span> next to a <p>Ad</p>. The clock
        // is embedded in the label text, so pull M:SS out of it.
        var c = cont.querySelector("[data-a-target='video-ad-countdown']");
        var cm = c && (c.textContent || "").match(/(\d{1,2}:\d{2})/);
        var rem = cm ? parseClock(cm[1]) : -1;
        if (rem < 0) {
          var overlay = cont.querySelector(".video-player__overlay") || cont;
          var els = overlay.querySelectorAll("*"), badge = null, cands = [];
          for (var i = 0; i < els.length; i++) {
            var t = PV.ownText(els[i]); if (!t || t.length > 24) continue;
            if (/^(ad|advertisement)(\s*\d+\s*of\s*\d+)?\b/i.test(t) && !badge) badge = els[i];
            var m = t.match(/(\d{1,2}:\d{2})/) || t.match(/^:?(\d{1,3})\s*(s|sec|seconds?)?\s*$/i) || t.match(/\b(\d{1,3})\s*(s|sec|seconds?)$/i);
            if (m) cands.push({ el: els[i], v: m[1].indexOf(":") >= 0 ? parseClock(m[1]) : parseInt(m[1], 10) });
          }
          var best = null;
          cands.forEach(function (k) {
            if (!(k.v >= 0 && k.v < 600)) return;
            var d = 99;
            if (badge) { var a = k.el, n = 0; while (a && n < 6) { if (a.contains(badge)) { d = n; break; } a = a.parentElement; n++; } }
            if (!best || d < best.d) best = { d: d, v: k.v };
          });
          if (best && (badge ? best.d < 99 : true)) rem = best.v;
        }
        var count = adCountText(cont);
        if (!count) { var l = cont.querySelector("[data-a-target='video-ad-label']"); var mm = l && (l.textContent || "").match(/(\d+)\s*of\s*(\d+)/i); if (mm) count = mm[1] + " of " + mm[2]; }
        return { count: count, remaining: rem >= 0 ? rem : null };
      }
    },
    {
      // Paramount+: DAI fires events for regular breaks; self-promo ads only
      // show an "Advertisement" label, so the badge SUPPLEMENTS the SDK flag.
      // The pause-ad label lingers after resume: count it only while paused.
      source: "Paramount+ player (self-promo / house ads labeled Advertisement)",
      container: ".aa-player-skin",
      resumeVia: "control",   // 2026-08-29: raw play() resumed the video but the skin stayed "paused"
      breakTimer: true,       // the top-left clock counts the WHOLE break
      adBadge: /^advertisement$/i,
      pausePanel: /pause-panel/i,
      authoritative: false,
      displayWins: true,
      // Paramount's ad panel (.ad-info-manager): seconds in the ring
      // (.ad-info-manager-circular-loader-copy), "Ad N of M" in the copy.
      // NEVER fall back to another clock when the ring is momentarily blank -
      // hold the last ring value and count it down locally for a few seconds.
      adInfo: function (cont) {
        // Whole-break clock first (top-left), the per-ad ring only as a
        // fallback: the ring counted "30 -> 0" for the first ad before the HUD
        // switched to the right figure (2026-08-29).
        var rem = -1;
        {
          // The break countdown sits TOP-LEFT of the player (reported
          // 2026-08-29: "total remaining at the top left"). Among all visible
          // clock-like texts in the skin, prefer one in the top-left region;
          // otherwise the largest value (a whole-break clock beats a per-ad one).
          var cr = cont.getBoundingClientRect(), all = cont.querySelectorAll("span,div,p,b,strong,time"), best = null;
          for (var ti = 0; ti < all.length; ti++) {
            var tt = PV.ownText(all[ti]); if (!tt || tt.length > 24) continue;
            var rr = all[ti].getBoundingClientRect(); if (rr.width <= 0 || rr.height <= 0) continue;
            if (all[ti].closest && all[ti].closest("[data-prism-veil],[data-prism-ui]")) continue;
            var topLeft = (rr.top - cr.top) < cr.height * 0.25 && (rr.left - cr.left) < cr.width * 0.35;
            // Reported 2026-08-29: the top-left break counter is a BARE number
            // ("90, 89, 88"); a colon clock elsewhere read a static "0:30".
            // Bare numbers count only in the top-left region; there they win.
            var pc = -1, bare = /^\d{1,3}$/.test(tt);
            if (bare) { if (!topLeft) continue; pc = parseInt(tt, 10); }
            else { var mm2 = tt.match(/(?:^|\s)(:?\d{1,2}:\d{2}|:\d{2})\s*$/); if (!mm2) continue; pc = parseClock(mm2[1]); }
            if (!(pc >= 0 && pc < 900)) continue;
            var score = (topLeft ? (bare ? 200000 : 100000) : 0) + pc;
            if (!best || score > best.score) best = { score: score, v: pc };
          }
          if (best) rem = best.v;
        }
        if (rem < 0) { var ring = cont.querySelector(".ad-info-manager-circular-loader-copy"); rem = parseClock(ring && ring.textContent); }
        var now = Date.now();
        if (rem >= 0) { this.__hold = { v: rem, t: now }; }
        else if (this.__hold && now - this.__hold.t < 6000) { rem = Math.max(0, this.__hold.v - (now - this.__hold.t) / 1000); }
        else { this.__hold = null; }
        var count = adCountText(cont);
        if (!count) { var cp = cont.querySelector(".ad-info-manager-copy"); var m = cp && (cp.textContent || "").match(/(\d+)\s*of\s*(\d+)/i); if (m) count = m[1] + " of " + m[2]; }
        return { count: count, remaining: rem >= 0 ? rem : null };
      }
    }
  ];

  // GENERIC PLAYER - the last row, for every video service not listed above.
  // Its container is the main video's player root (resolved on the fly). Ad
  // signal: the player's own on-screen "Ad" / "Advertisement" / "Ad N of M"
  // badge (same exclusions as Hulu's), plus the IMA/DAI SDK flag which the
  // hook raises on any site. Countdown: any clock-like text in the player,
  // else the SDK clock. Not authoritative: it never overrides a listed row.
  // Registry rows above exist ONLY for a service's non-standard quirks.
  var GENERIC_ROW = {
    source: "generic player",
    generic: true,
    container: "(main video's player)",
    adBadge: /^(ad|advertisement|ad\s*\d+\s*of\s*\d+|sponsored)$/i,
    badgeExclude: /seek|scrub|timeline|progress|marker|cue|slider|rail|pausead|pause-panel|stream-display-ad|sda-/i,
    // Google IMA renders its ad UI in an imasdk.googleapis.com iframe laid over
    // the player (SOOP live, 2026-08-29: 1257x707, no SDK flag reached us):
    // a visible one inside the player IS the break.
    adSelector: "iframe[src*='imasdk.googleapis.com']",
    authoritative: false,
    displayWins: false,
    adInfo: function (cont) {
      var rem = regionClock(cont, { top: 0, left: 0, width: 1, height: 1 });
      return { count: adCountText(cont), remaining: rem >= 0 ? rem : null };
    }
  };
  // PLAYER FAMILIES - one tier finer than the generic row, one coarser than a
  // site row. Most video sites don't roll their own player: they embed one of
  // a few frameworks, each with stable class fingerprints and its own ad-state
  // markers. A family row applies on ANY host whose page carries the
  // fingerprint (no host gate), sits above the generic row (so it owns the
  // player) and below site rows (registry order: a site row's container wins).
  // Each family's markers are the framework's documented UI classes
  // (traceable source: the framework); a site row exists only for what the
  // family default can't see.
  var PLAYER_FAMILIES = [
    {
      // THEOplayer (traceable source: cdn.theoplayer.com/dash/theoplayer/ui.css,
      // read 2026-08-29). The container is Video.js-skinned
      // (.theoplayer-container.video-js.theoplayer-skin) - this row precedes
      // the Video.js one so THEO's own markers win: theo-ad-playing /
      // theo-dai-ad-playing on the container, .theo-ad-remaining-container
      // for the clock, .theoplayer-ad-skip-button (+ -countdown) for Skip.
      family: "THEOplayer", fingerprint: ".theoplayer-container, .theoplayer-skin", container: ".theoplayer-container, .theoplayer-skin",
      adClassRe: /(^|\s)theo-(dai-)?ad-playing(\s|$)/,
      adSelector: ".theoplayer-ad-skip-button, .theo-ad-remaining-container",
      authoritative: false, displayWins: true, resumeVia: "control",
      adInfo: function (cont) {
        var rem = -1, r = cont.querySelector(".theo-ad-remaining-container");
        if (r && adElVisible(r)) { var mm = (r.textContent || "").match(/(\d{1,2}):(\d{2})/); if (mm) rem = (+mm[1]) * 60 + (+mm[2]); }
        if (rem < 0) rem = regionClock(cont, { top: 0, left: 0, width: 1, height: 1 });
        return { count: adCountText(cont), remaining: rem >= 0 ? rem : null };
      }
    },
    {
      // Video.js + videojs-contrib-ads (also videojs-ima, Brightcove Player -
      // Video.js underneath): the player root gains vjs-ad-playing for the
      // ad (vjs-ad-loading while it loads). videojs-ima paints
      // .ima-countdown-div "Ad: 0:15" / "Ad (1 of 2): 0:15"; IMA's own Skip
      // sits in the imasdk iframe (src/ima-frame.js).
      family: "Video.js", fingerprint: ".video-js", container: ".video-js",
      adClassRe: /(^|\s)vjs-ad-(playing|loading)(\s|$)/,
      authoritative: false, displayWins: true, resumeVia: "control",
      adInfo: function (cont) {
        var rem = -1, count = null, cd = cont.querySelector(".ima-countdown-div, .vjs-ad-countdown, [class*='ad-countdown']");
        if (cd && adElVisible(cd)) {
          var t = cd.textContent || "", mm = t.match(/(\d{1,2}):(\d{2})/), cc = t.match(/(\d+)\s*of\s*(\d+)/i);
          if (mm) rem = (+mm[1]) * 60 + (+mm[2]); if (cc) count = cc[1] + " of " + cc[2];
        }
        if (rem < 0) rem = regionClock(cont, { top: 0, left: 0, width: 1, height: 1 });
        return { count: count || adCountText(cont), remaining: rem >= 0 ? rem : null };
      }
    },
    {
      // JW Player 8: .jwplayer gains jw-flag-ads (jw-flag-ads-vpaid for VPAID)
      // for the whole break; its Skip is .jw-skip (jw-skippable when live),
      // the countdown text sits in the ad's control bar.
      family: "JW Player", fingerprint: ".jwplayer", container: ".jwplayer",
      adClassRe: /(^|\s)jw-flag-ads(-[a-z]+)?(\s|$)/,
      authoritative: false, displayWins: true, resumeVia: "control",
      adInfo: function (cont) {
        var rem = regionClock(cont, { top: 0, left: 0, width: 1, height: 1 });
        return { count: adCountText(cont), remaining: rem >= 0 ? rem : null };
      }
    },
    {
      // Bitmovin Player UI (traceable source: bitmovin-player-ui CSS on npm,
      // read 2026-08-29): the ads UI variant .bmpui-ui-ads is shown for the
      // break (bmpui-hidden otherwise) with .bmpui-ui-label-ad-counter
      // ("Ad 1 of 2"), .bmpui-ui-ad-message-label ("... ends in 10 seconds")
      // and .bmpui-ui-button-ad-skip.
      family: "Bitmovin", fingerprint: ".bitmovinplayer-container", container: ".bitmovinplayer-container",
      adSelector: ".bmpui-ui-ads, .bmpui-ui-ad-status-overlay, .bmpui-ui-button-ad-skip",
      authoritative: false, displayWins: true, resumeVia: "control",
      adInfo: function (cont) {
        var rem = -1, count = null, cnt = cont.querySelector(".bmpui-ui-label-ad-counter"), msg = cont.querySelector(".bmpui-ui-ad-message-label");
        if (cnt && adElVisible(cnt)) { var cc = (cnt.textContent || "").match(/(\d+)\s*(?:of|\/)\s*(\d+)/i); if (cc) count = cc[1] + " of " + cc[2]; }
        if (msg && adElVisible(msg)) { var t = msg.textContent || "", mm = t.match(/(\d{1,2}):(\d{2})/), ss = t.match(/(\d+)\s*s(ec)?/i); if (mm) rem = (+mm[1]) * 60 + (+mm[2]); else if (ss) rem = +ss[1]; }
        if (rem < 0) rem = regionClock(cont, { top: 0, left: 0, width: 1, height: 1 });
        return { count: count || adCountText(cont), remaining: rem >= 0 ? rem : null };
      }
    }
  ];
  for (var fi = 0; fi < PLAYER_FAMILIES.length; fi++) { PLAYER_FAMILIES[fi].source = PLAYER_FAMILIES[fi].family + " player"; SSAI_AD_SOURCES.push(PLAYER_FAMILIES[fi]); }
  SSAI_AD_SOURCES.push(GENERIC_ROW);
  // The family whose fingerprint is on the page (first in order), for reports
  // and the pill. Cached briefly: srcHere runs on every tick.
  var famAt = 0, famName = null;
  PV.playerFamily = function () {
    if (Date.now() - famAt < 1000) return famName;
    famAt = Date.now(); famName = null;
    for (var i = 0; i < PLAYER_FAMILIES.length; i++) { try { if (document.querySelector(PLAYER_FAMILIES[i].fingerprint)) { famName = PLAYER_FAMILIES[i].family; break; } } catch (e) {} }
    return famName;
  };
  // Resolve a row's container: a selector for listed rows; the main video's
  // player root for the generic row (only when that video is a real player).
  function rowContainer(s) {
    if (!s) return null;
    if (s.family) return familyContainer(s);
    if (!s.generic) return document.querySelector(s.container);
    var v = PV.mainVideo(); if (!v || !genericPlayer(v)) return null;
    // a listed row already owns this player? then the generic row stays out
    for (var i = 0; i < SSAI_AD_SOURCES.length; i++) { var r = SSAI_AD_SOURCES[i]; if (r.generic || !srcHere(r)) continue; var c = r.family ? familyContainer(r) : document.querySelector(r.container); if (c && (c === v || c.contains(v))) return null; }
    return controlRoot(v);
  }
  // A family's container: pages embed several players (a hero plus thumbnails)
  // - take the one holding the main video, else the largest on screen.
  function familyContainer(s) {
    var all; try { all = document.querySelectorAll(s.container); } catch (e) { return null; }
    if (!all.length) return null;
    var v = null; try { v = PV.mainVideo(); } catch (e2) {}
    if (v) for (var i = 0; i < all.length; i++) if (all[i].contains(v)) return all[i];
    var best = null, ba = 0;
    for (var j = 0; j < all.length; j++) { var r = all[j].getBoundingClientRect(); var a = r.width * r.height; if (a > ba && r.bottom > 0 && r.top < innerHeight) { ba = a; best = all[j]; } }
    return best;
  }
  function srcHere(s) {
    if (s.family) { try { return !!document.querySelector(s.fingerprint); } catch (e) { return false; } }
    return !s.host || s.host.test(location.hostname);
  }
  // The player's on-screen countdown, found by POSITION: among visible short
  // texts inside the container that read like a clock ("1:23", ":45") or, in
  // the preferred region only, a bare number ("90"), take the one in the
  // region (Paramount+: top-left, Peacock: bottom-left); else the largest
  // clock anywhere. region = { top, left, width, height } as fractions.
  function regionClock(cont, region) {
    var cr = cont.getBoundingClientRect(), all = cont.querySelectorAll("span,div,p,b,strong,time"), best = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i], tt = PV.ownText(el); if (!tt || tt.length > 24) continue;
      var rr = el.getBoundingClientRect(); if (rr.width <= 0 || rr.height <= 0) continue;
      if (el.closest && el.closest("[data-prism-veil],[data-prism-ui]")) continue;
      var fx = (rr.left - cr.left) / Math.max(1, cr.width), fy = (rr.top - cr.top) / Math.max(1, cr.height);
      var inRegion = fx >= region.left && fx < region.left + region.width && fy >= region.top && fy < region.top + region.height;
      var pc = -1, bare = /^\d{1,3}$/.test(tt);
      if (bare) { if (!inRegion) continue; pc = parseInt(tt, 10); }
      else { var m = tt.match(/(?:^|\s)(:?\d{1,2}:\d{2}|:\d{2})\s*$/); if (!m) continue; pc = parseClock(m[1]); }
      if (!(pc >= 0 && pc < 900)) continue;
      var score = (inRegion ? (bare ? 200000 : 100000) : 0) + pc;
      if (!best || score > best.score) best = { score: score, v: pc };
    }
    return best ? best.v : -1;
  }
  // The "main" video: when a registry player is on the page, the largest
  // <video> INSIDE it - never a hover preview or a feed autoplay that happens
  // to be bigger on screen while the player is scrolled away (YouTube).
  (function () {
    var domMain = PV.mainVideo;
    PV.mainVideo = function () {
      for (var i = 0; i < SSAI_AD_SOURCES.length; i++) {
        var s = SSAI_AD_SOURCES[i]; if (s.generic || !srcHere(s)) continue;   // listed rows only: the generic row derives FROM the main video
        var cont = document.querySelector(s.container); if (!cont) continue;
        var vs = cont.querySelectorAll("video"), best = null, bestA = -1;
        for (var j = 0; j < vs.length; j++) { var r = vs[j].getBoundingClientRect(), a = r.width * r.height; if (a > bestA) { bestA = a; best = vs[j]; } }
        if (best) return best;
      }
      return domMain();
    };
  })();
  function authoritativeSsaiPresent() {
    for (var i = 0; i < SSAI_AD_SOURCES.length; i++) {
      var s = SSAI_AD_SOURCES[i];
      if (s.authoritative && srcHere(s) && rowContainer(s)) return true;
    }
    return false;
  }
  function isPausedNow() { var v = PV.mainVideo(); try { return v ? !!v.paused : false; } catch (e) { return false; } }
  // A short, leaf-level, ON-SCREEN element inside the player whose whole text
  // is exactly the ad label. On-screen matters: Paramount parks its label at
  // y=-480 during content.
  function hasAdBadge(cont, re, pausePanelRe, excludeRe) {
    var els = cont.querySelectorAll("span,div,p,button");
    for (var i = 0; i < els.length; i++) {
      var e = els[i], own = PV.ownText(e);
      if (!own || own.length >= 20 || !re.test(own)) continue;
      var vis; try { vis = e.checkVisibility ? e.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }) : true; } catch (x) { vis = true; }
      if (!vis) continue;
      var r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth)) continue;
      // Ancestor-class gates. excludeRe: the label sits in a seek bar / scrubber
      // (Hulu paints "Ad" break MARKERS there, shown on hover during CONTENT) -
      // never a real ad. pausePanelRe: counts only while paused.
      if (excludeRe || pausePanelRe) {
        var pcls = "", a = e;
        for (var d = 0; d < 6 && a; d++) { pcls += " " + PV.classStr(a); a = a.parentElement; }
        if (excludeRe && excludeRe.test(pcls)) continue;
        // A pause-panel ad is not a break (Paramount+, 2026-08-29: the whole
        // player went fullscreen-veiled for what was just a paused show).
        if (pausePanelRe && pausePanelRe.test(pcls)) continue;
      }
      return true;
    }
    return false;
  }
  // Rendered and on-screen: a hidden (display:none / 0-box / off-screen)
  // element does not count as an active ad.
  function adElVisible(el) {
    try {
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.1) return false;
      var r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 20 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    } catch (e) { return true; }
  }
  // Provisional ad (YouTube, 2026-08-29): the <video> swaps to an ad clip
  // (durationchange to a short duration that is not the page's declared
  // content length) BEFORE the player flips ad-showing; four traces showed a
  // perfect cover from its first frame and the flash before it. Cover on the
  // swap at once, as a SOFT signal, and drop it unless the class confirms
  // within EARLY_AD_MS.
  var EARLY_AD_MS = 1500, earlyUntil = 0;
  function noteClipSwap(v) {
    for (var i = 0; i < SSAI_AD_SOURCES.length; i++) {
      var s = SSAI_AD_SOURCES[i];
      if (!s.isAdClip || !srcHere(s)) continue;
      var cont = rowContainer(s); if (!cont || !cont.contains(v)) continue;
      var ad = false; try { ad = s.isAdClip(v) && v.duration < 600; } catch (e) {}
      if (ad) { earlyUntil = Date.now() + EARLY_AD_MS; }
    }
  }
  /** The registry row whose ad signal is on right now, else null. */
  function ssaiActiveSource() {
    for (var i = 0; i < SSAI_AD_SOURCES.length; i++) {
      var s = SSAI_AD_SOURCES[i];
      if (!srcHere(s)) continue;
      var cont = rowContainer(s);
      if (!cont) continue;
      var r = cont.getBoundingClientRect();
      if (r.width <= 400 || r.height <= 200) continue;
      if ((s.adClass && cont.classList.contains(s.adClass)) || (s.adClassRe && s.adClassRe.test(cont.className + ""))) { s.__soft = false; s.__early = false; s.__via = "class"; return s; }
      // The ad-mode element must be VISIBLE, not merely present: players keep
      // hidden ad containers in the DOM during playback (Hulu's .PauseAd),
      // and matching a hidden one veils the show mid-play.
      // A selector/badge match while the row's adClass is OFF is a SOFT signal
      // (YouTube leaves ad chrome in .ytp-ad-module ~10s into content, trace
      // 2026-08-29): it bridges a pod gap but cannot hold over playing content.
      if (s.adSelector) { var m = cont.querySelector(s.adSelector); if (m && adElVisible(m)) { s.__soft = !!s.adClass; s.__early = false; s.__via = "selector:" + m.tagName + "." + PV.classStr(m).slice(0, 40); return s; } }
      if (s.adBadge && hasAdBadge(cont, s.adBadge, s.pausePanel, s.badgeExclude)) { s.__soft = !!s.adClass; s.__early = false; s.__via = "badge"; return s; }
      // provisional: the clip just swapped to an ad-length clip, class not yet on
      if (earlyUntil > Date.now() && s.isAdClip) {
        var ev = cont.querySelector("video"), isAd = false; try { isAd = !!(ev && s.isAdClip(ev) && ev.duration < 600); } catch (e) {}
        if (isAd) { s.__soft = true; s.__early = true; s.__via = "early-swap"; return s; }
      }
    }
    return null;
  }
  /** The registry row whose player is on the page (for progress readout). */
  function activeAdSource() {
    for (var i = 0; i < SSAI_AD_SOURCES.length; i++) {
      var s = SSAI_AD_SOURCES[i];
      if (s.adInfo && srcHere(s) && rowContainer(s)) return s;
    }
    return null;
  }
  /** The raw ad signal right now: authoritative SSAI, else the SDK flag or any SSAI. */
  function adSignalOn(ssai) {
    return authoritativeSsaiPresent()
      ? !!ssai
      : (document.documentElement.getAttribute("data-prism-ad") === "active" || !!ssai);
  }

  // ---------------------------------------------------------------- progress
  function parseClock(s) {
    if (!s) return -1; s = ("" + s).trim();
    var m = s.match(/^:?(\d{1,2})(?::(\d{2}))?$/);
    if (!m) return -1;
    return m[2] != null ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : parseInt(m[1], 10);
  }
  function fmtSecs(sec) {
    sec = Math.max(0, Math.round(sec));
    var hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    var m = (hh ? (mm < 10 ? "0" : "") : "") + mm;
    return (hh ? hh + ":" : "") + m + ":" + (ss < 10 ? "0" + ss : ss);
  }
  // Parse H:MM:SS / MM:SS / M:SS / SS to seconds (-1 if not a clock).
  function parseClockLong(s) {
    if (!s) return -1;
    var p = ("" + s).trim().split(":");
    for (var i = 0; i < p.length; i++) { if (!/^\d+$/.test(p[i])) return -1; }
    if (p.length === 3) return (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]);
    if (p.length === 2) return (+p[0]) * 60 + (+p[1]);
    if (p.length === 1) return +p[0];
    return -1;
  }
  // The CONTENT position from the player's own seek scrubber. On a stitched
  // (SSAI) stream the video element's currentTime counts ad time too, so it
  // overcounts vs the visible scrubber - but the scrubber is a standard
  // role="slider" whose aria-valuetext is a clock ("0:31 of 42:15"), which is
  // exactly the content time the viewer sees. Trust ONLY a slider whose
  // valuetext carries a clock (so a volume slider - "50%" - is never mistaken
  // for the timeline). { t, d } in seconds, or null.
  function scrubberPosition(box) {
    var root = (box && box.querySelectorAll) ? box : document;
    var sliders = root.querySelectorAll('[role="slider"]');
    for (var i = 0; i < sliders.length; i++) {
      var s = sliders[i];
      // (a) a clock in aria-valuetext ("0:31 of 42:15") - unambiguous, any player.
      var vtext = s.getAttribute("aria-valuetext") || "";
      var clocks = vtext.match(/\d{1,2}:\d{2}(?::\d{2})?/g);
      if (clocks && clocks.length) {
        var tc = parseClockLong(clocks[0]);
        if (tc >= 0) { var dc = clocks.length > 1 ? parseClockLong(clocks[1]) : NaN; return { t: tc, d: (isFinite(dc) && dc > 0) ? dc : NaN }; }
      }
      // (b) numeric aria-valuenow/max, but ONLY on a slider clearly labeled a
      // TIME line (Hulu's .Timeline__slider, aria-label "Timeline") so a volume
      // slider's 0-100 is never read as seconds. A media seek slider expresses
      // these in seconds and reflects the VISIBLE scrubber (content time), which
      // on a stitched stream is what we want - not the element's ad-inclusive clock.
      var label = ((s.getAttribute("aria-label") || "") + " " + PV.classStr(s)).toLowerCase();
      if (!/timeline|seek|scrub|progress|playhead|position/.test(label)) continue;
      var now = parseFloat(s.getAttribute("aria-valuenow"));
      var max = parseFloat(s.getAttribute("aria-valuemax"));
      var min = parseFloat(s.getAttribute("aria-valuemin"));
      if (!isFinite(min)) min = 0;
      if (isFinite(now) && isFinite(max) && max - min >= 30 && now >= min && now <= max) {
        return { t: now - min, d: max - min };
      }
    }
    return null;
  }
  // The player's own VISIBLE time text - the surest content clock, because it
  // is literally what the viewer sees on the scrubber. Players show elapsed as
  // a plain clock ("7:15") and remaining as a NEGATIVE one ("-11:49", Hulu's
  // .Timeline__remainingTimestamp). Scan leaf elements in the player box for
  // both. On a stitched stream this is content time (ads excluded), unlike the
  // element's currentTime. { t, r } in seconds (either may be NaN), or null.
  function timestampReadout(box) {
    var root = (box && box.querySelectorAll) ? box : document;
    var els = root.querySelectorAll("div,span,p,time");
    var elapsed = NaN, remaining = NaN;
    for (var i = 0; i < els.length && i < 5000; i++) {
      var e = els[i];
      if (e.childElementCount || (e.hasAttribute && e.hasAttribute("data-prism-veil"))) continue;
      var txt = PV.ownText(e); if (!txt || txt.length > 9) continue;
      var m = txt.match(/^(-)?(\d{1,2}:\d{2}(?::\d{2})?)$/);
      if (!m) continue;
      var secs = parseClockLong(m[2]); if (secs < 0) continue;
      if (!PV.elVisible(e)) continue;
      if (m[1]) { if (!isFinite(remaining)) remaining = secs; }   // "-11:49"
      else if (!isFinite(elapsed)) elapsed = secs;                // "7:15"
    }
    return (isFinite(elapsed) || isFinite(remaining)) ? { t: elapsed, r: remaining } : null;
  }
  // While paused, the show's position: elapsed and remaining. Prefer the
  // player's visible timestamps, then the scrubber ARIA (both content time,
  // matching what the viewer sees); fall back to the element clock only when
  // neither is available (which on a stitched stream includes ad time).
  // A LIVE stream's running time, when the page shows one: an HH:MM:SS clock
  // visible within the player's horizontal span and up to 320px below it
  // (SOOP: <span id="time">04:46:46</span> in the broadcast-info strip,
  // 2026-08-29; Twitch/Kick uptime displays are shaped the same). Prefer an
  // element whose id/class says time/uptime/duration.
  function liveUptime(box) {
    try {
      var b = (box || document.body).getBoundingClientRect();
      var els = document.querySelectorAll("span,div,p,time,b,strong,li"), best = null, bestScore = -1;
      for (var i = 0; i < els.length && i < 6000; i++) {
        var e = els[i]; if (e.childElementCount > 1) continue;
        var t = PV.ownText(e) || (e.textContent || "").trim(); if (!/^\d{1,2}:\d{2}:\d{2}$/.test(t)) continue;
        var r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;
        if (r.right < b.left - 20 || r.left > b.right + 20) continue;
        if (r.top < b.top || r.top > b.bottom + 320) continue;
        if (e.closest && e.closest("[data-prism-veil],[data-prism-ui]")) continue;
        var score = (/time|uptime|duration|elapsed|live/i.test((e.id || "") + " " + PV.classStr(e) + " " + PV.classStr(e.parentElement)) ? 10 : 0) + (r.top > b.bottom ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = t; }
      }
      return best;
    } catch (e) { return null; }
  }
  function positionLine(v, box) {
    // The player's own visible clock ("0:08 / 3:00") beats the element's
    // arithmetic (duration 174 vs Kick's displayed 3:00, 2026-08-29). Look for
    // it where the CONTROLS are, not inside the video element.
    var root = box; try { root = controlRoot(box || v) || box; } catch (eR) {}
    var ts = timestampReadout(root);
    if (ts) {
      if (isFinite(ts.t) && isFinite(ts.r)) return fmtSecs(ts.t) + " elapsed · " + fmtSecs(ts.r) + " remaining";
      if (isFinite(ts.t)) return fmtSecs(ts.t) + " elapsed";
      return fmtSecs(ts.r) + " remaining";
    }
    var sp = scrubberPosition(root);
    if (sp && sp.t >= 0) {
      return isFinite(sp.d) && sp.d > 0
        ? fmtSecs(sp.t) + " elapsed · " + fmtSecs(Math.max(0, sp.d - sp.t)) + " remaining"
        : fmtSecs(sp.t) + " elapsed";
    }
    try {
      var t = v.currentTime, d = v.duration;
      if (!isFinite(t)) return "";
      if (isFinite(d) && d > 0) return fmtSecs(t) + " elapsed · " + fmtSecs(Math.max(0, d - t)) + " remaining";
      return fmtSecs(t) + " elapsed";
    } catch (e) { return ""; }
  }
  function adCountText(cont) {
    var els = cont.querySelectorAll("span,div,p");
    for (var i = 0; i < els.length; i++) {
      var t = PV.ownText(els[i]);
      if (/^\d+\s*of\s*\d+$/i.test(t)) return t.replace(/\s+/g, " ");
    }
    return null;
  }
  function sdkRemaining() {
    var a = document.documentElement.getAttribute("data-prism-adrem");
    if (a == null || a === "") return null;
    var n = parseFloat(a); return isFinite(n) ? n : null;
  }
  var lastRead = { v: null, at: 0 };
  // Is the element's clock actually moving? (currentTime advanced within the
  // last 1.5 s). A number derived from a clock that is not moving is not a
  // countdown: the card showed "0:30 left" frozen (YouTube embed, Firefox,
  // 2026-08-29). No live clock -> no time on the card.
  var clockSeen = { v: null, t: -1, at: 0, live: false };
  function clockLive(v) {
    try {
      if (!v) return false;
      var t = v.currentTime, now = Date.now();
      if (clockSeen.v !== v) { clockSeen.v = v; clockSeen.t = t; clockSeen.at = now; clockSeen.live = false; return false; }
      if (Math.abs(t - clockSeen.t) > 0.05) { clockSeen.t = t; clockSeen.at = now; clockSeen.live = true; }
      else if (now - clockSeen.at > 1500) clockSeen.live = false;
      return clockSeen.live;
    } catch (e) { return false; }
  }
  PV.clockLive = clockLive;
  function adInfoLine() {
    var num = null, total = null, remaining = null;
    var pod = document.documentElement.getAttribute("data-prism-adpod");
    if (pod) { var pp = pod.split("/"); var pos = parseInt(pp[0], 10), tot = parseInt(pp[1], 10); if (pos > 0) { num = pos; total = (tot > 0) ? tot : null; } }
    var s = activeAdSource();
    var sdkRem = sdkRemaining();
    if (sdkRem != null && !(s && s.displayWins)) remaining = sdkRem;
    if (s) { var cont = rowContainer(s); if (cont) {
      var info; try { info = s.adInfo(cont); } catch (e) {}
      if (info) {
        if (info.remaining != null && (remaining == null || s.displayWins)) remaining = info.remaining;
        // displayWins means the display beats the SDK when BOTH exist - an
        // empty display readout still falls back to the SDK clock
        // (Paramount+ 2026-08-29: SDK-flagged ad, no ring on screen, no time).
        if (remaining == null && sdkRem != null) remaining = sdkRem;
        if (num == null && info.count) { var m = ("" + info.count).match(/(\d+)\s*of\s*(\d+)/i); if (m) { num = parseInt(m[1], 10); total = parseInt(m[2], 10); } }
      }
    } }
    // Only show a count line when the player or SDK actually reports one - a
    // self-count guessed from a timer jump is not trustworthy.
    var countStr = (num != null && total != null) ? ("Ad " + num + " of " + total) : null;
    // The TIME, however, keeps counting on its own between reads: a source
    // that reports the same value while the ad plays (YouTube embed in
    // Firefox stuck at 0:27, 2026-08-29) is interpolated from the last read
    // by wall clock; any fresh value from the source snaps it back.
    if (remaining != null) {
      var nowT = Date.now(), playing = false; try { var mv = vidVeil && vidVeil.video; playing = !!(mv && !mv.paused && clockLive(mv)); } catch (eP) {}
      if (lastRead.v !== remaining) { lastRead.v = remaining; lastRead.at = nowT; }
      else if (playing) remaining = Math.max(0, remaining - (nowT - lastRead.at) / 1000);
    } else { lastRead.v = null; }
    return { time: remaining != null ? fmtSecs(remaining) + " left" : "", count: countStr || "" };
  }

  // ---------------------------------------------------------------- the card
  function updateCard() {
    if (!vidVeil || !vidVeil.cover.__info) return;
    var c = vidVeil.cover;
    try { paintFullscreen(c); } catch (eF) {}
    if (vidVeil.mode === "pause") {
      // Paused intermission: the show's own position + a Resume button.
      if (c.__sub) c.__sub.textContent = "Paused";
      var pos = isLive(vidVeil.video) ? ("LIVE" + (function () { var u = liveUptime(vidVeil.box || vidVeil.video); return u ? " · " + u + " elapsed" : ""; })()) : positionLine(vidVeil.video, vidVeil.box);
      if (c.__time.textContent !== pos) c.__time.textContent = pos;
      c.__count.textContent = ""; c.__count.style.display = "none";
      c.__time.style.display = pos ? "block" : "none";
      c.__info.style.display = pos ? "block" : "none";
      if (c.__resume) c.__resume.style.display = "inline-block";
      if (c.__pauseAfter) c.__pauseAfter.style.display = "none";
      if (c.__chip) {
        c.__chipLbl.textContent = " Paused";
        c.__popPos.textContent = pos; c.__popPos.style.display = pos ? "block" : "none";
        c.__popPause.style.display = "none"; c.__popResume.style.display = "inline-block";
      }
      return;
    }
    if (vidVeil.mode === "hold") {
      if (c.__sub) c.__sub.textContent = "Break over · the live stream continues underneath";
      var held = "Held " + fmtSecs(Math.max(0, (Date.now() - (vidVeil.holdAt || Date.now())) / 1000)) + " · LIVE" + (function () { var u = liveUptime(vidVeil.box || vidVeil.video); return u ? " · " + u + " elapsed" : ""; })();
      if (c.__time.textContent !== held) c.__time.textContent = held;
      c.__count.textContent = ""; c.__count.style.display = "none";
      c.__time.style.display = "block"; c.__info.style.display = "block";
      if (c.__resume) { c.__resume.style.display = "inline-block"; c.__resume.textContent = "▶ Resume"; }
      if (c.__pauseAfter) c.__pauseAfter.style.display = "none";
      if (c.__chip) {
        c.__chipLbl.textContent = " " + held;
        c.__popPos.textContent = held; c.__popPos.style.display = "block";
        c.__popPause.style.display = "none"; c.__popResume.style.display = "inline-block";
      }
      return;
    }
    if (vidVeil.mode === "ai") {
      var ai = vidVeil.ai || { label: "AI-generated", source: "" };
      if (c.__sub) c.__sub.textContent = "Labelled \u201c" + ai.label + "\u201d by " + (ai.source || "the platform");
      var apos = positionLine(vidVeil.video, vidVeil.box);
      if (c.__time.textContent !== apos) c.__time.textContent = apos;
      c.__count.textContent = ""; c.__count.style.display = "none";
      c.__time.style.display = apos ? "block" : "none";
      c.__info.style.display = apos ? "block" : "none";
      if (c.__resume) { c.__resume.style.display = "inline-block"; c.__resume.textContent = "\u25B6 Watch anyway"; }
      if (c.__pauseAfter) c.__pauseAfter.style.display = "none";
      if (c.__chip) {
        c.__chipLbl.textContent = " AI \u00b7 " + (apos || "veiled");
        c.__popPos.textContent = apos; c.__popPos.style.display = apos ? "block" : "none";
        c.__popPause.style.display = "none"; c.__popResume.style.display = "inline-block";
      }
      return;
    }
    if (c.__resume) c.__resume.textContent = "\u25B6 Resume";
    // Ad break: the player's / SDK's own countdown, and "Pause after break".
    if (c.__sub) c.__sub.textContent = vidVeil.pauseAfter ? "Your show will be paused after the break" : "Your show returns after the break";
    if (c.__resume) c.__resume.style.display = "none";
    var info = adInfoLine();
    // A live stream with no usable countdown: say LIVE, never "0:00 left".
    if (isLive(vidVeil.video) && (!info.time || /^0:00/.test(info.time))) info.time = "LIVE";
    if (c.__time.textContent !== info.time) c.__time.textContent = info.time;
    if (c.__count.textContent !== info.count) c.__count.textContent = info.count;
    c.__time.style.display = info.time ? "block" : "none";
    c.__count.style.display = info.count ? "block" : "none";
    c.__info.style.display = (info.time || info.count) ? "block" : "none";
    // "Pause after break" only makes sense while a break with a countdown runs.
    if (c.__pauseAfter) { c.__pauseAfter.style.display = "flex"; paintPauseAfter(); }   // every ad veil, countdown or not (Peacock had none for 30s)
    // The glyph names WHAT is veiled (user ask 2026-08-31): ◐ = an ad
    // break, ✦ = platform-labelled AI content ("Watch anyway" applies).
    var aiMode = vidVeil.mode === "ai";
    var glyph = aiMode ? "✦" : "◐";
    var title = aiMode ? " AI content" : " Intermission";
    if (c.__moon && c.__moon.textContent !== glyph) c.__moon.textContent = glyph;
    if (c.__title && c.__title.textContent !== title) c.__title.textContent = title;
    if (c.__chipMoon && c.__chipMoon.textContent !== glyph) c.__chipMoon.textContent = glyph;
    if (c.__chip) {
      var chipText = " " + (info.time ? info.time : (aiMode ? "AI content" : "Intermission")) + (info.count ? " · " + info.count : "");
      if (c.__chipLbl.textContent !== chipText) c.__chipLbl.textContent = chipText;
      c.__popPos.style.display = "none"; c.__popResume.style.display = "none";
      c.__popPause.style.display = "flex";
    }
  }

  // ---------------------------------------------------------------- art
  function kenBurns(layer) {
    var s0 = 1 + Math.random() * 0.02, s1 = 1.09 + Math.random() * 0.04;
    var tx = (Math.random() * 2 - 1) * 2.2, ty = (Math.random() * 2 - 1) * 2.2;
    try {
      layer.animate(
        [{ transform: "scale(" + s0 + ") translate(0,0)" }, { transform: "scale(" + s1 + ") translate(" + tx + "%," + ty + "%)" }],
        { duration: 28000, easing: "ease-out", fill: "forwards" }
      );
    } catch (e) {}
  }
  function maybeCrossfadeArt() {
    if (!vidVeil || !vidVeil.artAt || (Date.now() - vidVeil.artAt) < 22000) return;
    vidVeil.artAt = Date.now();
    var cover = vidVeil.cover, prev = cover.__art;
    var nl = document.createElement("div");
    nl.setAttribute("data-prism-veil", "1");
    nl.style.cssText = "position:absolute;inset:0;background:#0A0C0F center/cover no-repeat;opacity:0;transition:opacity 1.6s ease;will-change:transform";
    if (PV.artOnto) PV.artOnto(nl, PV.pickArt()); else nl.style.backgroundImage = "url('" + PV.pickArt() + "')";
    cover.insertBefore(nl, cover.__card || null);
    kenBurns(nl);
    requestAnimationFrame(function () { nl.style.opacity = "1"; });
    cover.__art = nl;
    setTimeout(function () { if (prev && prev.parentNode) prev.remove(); }, 1800);
  }

  // ---------------------------------------------------------------- skip
  // IMA's Skip button lives inside the cross-origin imasdk iframe; the script
  // there (src/ima-frame.js) reports its rect. A proxy element is kept at
  // frame position + rect so the cutter and the click-through work unchanged.
  var imaSkip = { rect: null, at: 0, source: null }, imaProxy = null;
  addEventListener("message", function (ev) {
    try {
      var m = ev.data; if (!m || m.__prismSkipRect !== 1) return;
      if (!/^https:\/\/imasdk\.googleapis\.com$/.test(ev.origin)) return;
      imaSkip = { rect: m.rect || null, at: Date.now(), source: ev.source };
    } catch (e) {}
  });
  function imaSkipProxy() {
    if (!imaSkip.rect || Date.now() - imaSkip.at > 1500) { if (imaProxy) { imaProxy.remove(); imaProxy = null; } return null; }
    var frames = document.querySelectorAll("iframe[src*='imasdk.googleapis.com']"), fr = null;
    for (var i = 0; i < frames.length; i++) { try { if (frames[i].contentWindow === imaSkip.source) { fr = frames[i]; break; } } catch (e) {} }
    if (!fr) fr = frames[0]; if (!fr) return null;
    var fb = fr.getBoundingClientRect(), r = imaSkip.rect;
    if (!imaProxy) {
      imaProxy = document.createElement("div"); imaProxy.setAttribute("data-prism-ui", "1"); imaProxy.className = "prism-ima-skip-proxy";
      imaProxy.style.cssText = "position:fixed;pointer-events:none;opacity:0;z-index:0;font-size:0";
      imaProxy.textContent = "Skip";
      (document.fullscreenElement || document.documentElement).appendChild(imaProxy);
    }
    imaProxy.style.left = (fb.left + r.x) + "px"; imaProxy.style.top = (fb.top + r.y) + "px";
    imaProxy.style.width = r.w + "px"; imaProxy.style.height = r.h + "px"; imaProxy.style.borderRadius = (r.radius || 0) + "px";
    return imaProxy;
  }
  function findSkip() {
    var ip = imaSkipProxy(); if (ip) return ip;
    // SOOP: #da_btn_skip counts "NN seconds until ad SKIP", then reads SKIP
    var soop = document.querySelector("#player #da_btn_skip");
    if (soop && PV.elVisible(soop) && !/\d\s*sec/i.test(soop.textContent || "") && /skip/i.test(soop.textContent || "")) return soop;
    var s = document.querySelectorAll("[class*='skip-button'],[class*='skipButton'],[class*='skip_ad'],[class*='ad-skip'],.jw-skip,[class*='adskipbutton'],[class*='skip-ad']");
    var bestSkip = null, bestArea = Infinity;
    for (var i = 0; i < s.length; i++) {
      var se = s[i];
      if (se.hasAttribute("data-prism-veil") || !PV.elVisible(se)) continue;
      if (/(^|[\s_-])disabled([\s_-]|$)/i.test(PV.classStr(se)) || se.disabled || se.getAttribute("aria-disabled") === "true") continue;
      var sre = se.getBoundingClientRect();
      if (sre.width <= 0 || sre.width > 300 || sre.height <= 0 || sre.height > 160) continue;
      var sa = sre.width * sre.height;
      if (sa < bestArea) { bestArea = sa; bestSkip = se; }
    }
    if (bestSkip) return bestSkip;
    var all = document.body.querySelectorAll("button,[role=button],[aria-label]");
    for (var j = 0; j < all.length && j < 3000; j++) {
      var e = all[j];
      if (e.hasAttribute("data-prism-veil") || e.children.length > 2) continue;
      var t = (e.innerText || e.getAttribute("aria-label") || "").trim();
      if (SKIP_UI.test(t)) { var r = e.getBoundingClientRect(); if (r.width > 0 && r.width < 260 && PV.elVisible(e)) return e; }
    }
    return null;
  }
  // Cut a hole over Skip only if a click through it would REACH Skip
  // (Paramount+ lays a full-frame click overlay over the player during an ad;
  // a hole there exposed a box of the ad and a click opened the advertiser).
  function applySkipHole(c, vr, sk) {
    // No hole in the veil's first second: players mount the skip SLOT before
    // the button is real (YouTube), and a hole at that moment shows the ad's
    // corner through it (reported flash, 2026-08-29). Skip never appears
    // that early anyway. And the control must actually READ "Skip".
    if (sk && vidVeil && vidVeil.mode === "ad" && vidVeilStart && Date.now() - vidVeilStart < 1000) sk = null;
    if (sk) { var st = ((sk.innerText || sk.textContent || "") + " " + (sk.getAttribute("aria-label") || "")).trim(); if (!/skip/i.test(st) && !RETURN_UI.test(st) && !/pause-panel-return/.test(PV.classStr(sk))) sk = null; }
    if (!sk) { clearHole(c); return; }
    var sr = sk.getBoundingClientRect(), reachable = false;
    // A control that plainly IS the skip button (reads Skip, or YouTube's
    // .ytp-skip-ad-button) needs no hit-test: YouTube stacks ad chrome over
    // the player and the centre-pixel test flapped frame to frame - the hole
    // showed "sometimes, mostly not" (2026-08-29). The hit-test stays for
    // controls matched only by a vague class.
    var plainSkip = /skip/i.test(((sk.innerText || sk.textContent || "") + " " + (sk.getAttribute("aria-label") || "")).trim()) || /ytp-skip-ad-button|skip-ad-button/i.test(PV.classStr(sk));
    if (plainSkip && sr.width > 0 && sr.height > 0) reachable = true;
    else if (sr.width > 0 && sr.height > 0) {
      try {
        var stack = document.elementsFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
        for (var si = 0; si < stack.length; si++) {
          var se2 = stack[si];
          if (se2.hasAttribute && se2.hasAttribute("data-prism-veil")) continue;
          reachable = (se2 === sk || sk.contains(se2));
          break;
        }
      } catch (e) {}
    }
    if (!reachable || sr.width > 300 || sr.height > 160) { if (!c.__noHoleLogged) { c.__noHoleLogged = true; trace("hole refused " + sk.tagName + "." + PV.classStr(sk).slice(0, 40) + " " + Math.round(sr.width) + "x" + Math.round(sr.height) + (reachable ? "" : " unreachable")); } }
    if (reachable && sr.width <= 300 && sr.height <= 160) {
      // The hole follows the button's own shape: its rect plus a 5px margin,
      // corners fully rounded (radius = half the height: a true pill), and a
      // ~1px feathered edge so it sits in the art rather than looking punched
      // out. An SVG alpha mask (evenodd path) does what clip-path polygons
      // cannot: curves and soft edges.
      var pad = 4, hx = sr.left - vr.left - pad, hy = sr.top - vr.top - pad, hw = sr.width + 2 * pad, hh = sr.height + 2 * pad;
      if (hx > -1 && hy > -1) {
        // The hole takes the control's OWN corner radius (+ the margin), so a
        // pill (YouTube's Skip) stays a pill and a rectangle (Paramount+'s
        // "Click to return to the video") stays a rectangle; capped at a pill.
        var W = Math.max(1, Math.round(vr.width)), H = Math.max(1, Math.round(vr.height)), rr = hh / 2;
        try {
          var cs = getComputedStyle(sk), br = parseFloat(cs.borderTopLeftRadius);
          if (isFinite(br)) { if (/%$/.test(cs.borderTopLeftRadius)) br = br / 100 * Math.min(sr.width, sr.height); rr = Math.min(hh / 2, Math.max(2, br + pad)); }
        } catch (eR) {}
        c.__hole = { left: sr.left - pad, top: sr.top - pad, width: sr.width + 2 * pad, height: sr.height + 2 * pad }; c.__holeEl = sk;
        var key = [W, H, Math.round(hx), Math.round(hy), Math.round(hw), Math.round(hh), Math.round(rr)].join(",");
        if (c.__holeKey !== key) {
          if (c.__holeKey === undefined) trace("hole open " + sk.tagName + "." + PV.classStr(sk).slice(0, 40) + " " + Math.round(sr.width) + "x" + Math.round(sr.height));
          c.__holeKey = key;
          var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='" + W + "' height='" + H + "' viewBox='0 0 " + W + " " + H + "'>" +
            "<filter id='f' x='-2%' y='-2%' width='104%' height='104%'><feGaussianBlur stdDeviation='0.6'/></filter>" +
            "<path filter='url(#f)' fill='white' fill-rule='evenodd' d='M0 0H" + W + "V" + H + "H0Z " +
            "M" + (hx + rr) + " " + hy + "h" + (hw - 2 * rr) + "a" + rr + " " + rr + " 0 0 1 " + rr + " " + rr + "v" + (hh - 2 * rr) + "a" + rr + " " + rr + " 0 0 1 -" + rr + " " + rr + "h-" + (hw - 2 * rr) + "a" + rr + " " + rr + " 0 0 1 -" + rr + " -" + rr + "v-" + (hh - 2 * rr) + "a" + rr + " " + rr + " 0 0 1 " + rr + " -" + rr + "z'/></svg>";
          var url = "url(\"data:image/svg+xml," + encodeURIComponent(svg) + "\")";
          c.style.webkitMaskImage = url; c.style.maskImage = url;
          c.style.webkitMaskSize = "100% 100%"; c.style.maskSize = "100% 100%";
          c.style.webkitMaskRepeat = "no-repeat"; c.style.maskRepeat = "no-repeat";
          // Hit-testing: a mask paints a hole but does not hit-test, and a
          // forwarded synthetic click is untrusted (YouTube's Skip ignored it,
          // 2026-08-29). A clip-path hole DOES hit-test: cut one just inside
          // the rounded mask hole so the human's own click reaches the button.
          var ix = Math.min(rr * 0.3, 6) + 1, cx0 = hx + ix, cy0 = hy + ix, cx1 = hx + hw - ix, cy1 = hy + hh - ix;
          c.style.clipPath = "polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 " + cy0 + "px, " + cx0 + "px " + cy0 + "px, " + cx0 + "px " + cy1 + "px, " + cx1 + "px " + cy1 + "px, " + cx1 + "px " + cy0 + "px, 0 " + cy0 + "px)";
        }
        return;
      }
    }
    clearHole(c);
  }
  function clearHole(c) {
    if (c.__holeKey === undefined && !c.style.maskImage && !c.style.webkitMaskImage) return;
    if (c.__holeKey !== undefined) trace("hole close");
    c.__holeKey = undefined; c.__hole = null; c.__holeEl = null;
    c.style.webkitMaskImage = ""; c.style.maskImage = ""; c.style.clipPath = "";
  }

  // ---------------------------------------------------------------- state
  // vidVeil: null, or { cover, video, box, mode:"ad"|"pause", wasMuted,
  //   pauseAfter, pauseAt, reclaimAt, artAt }. Exactly one veil at a time.
  var vidVeil = null, vidVeilStart = 0, vidBreakExpired = false, vidLastAd = 0, resumedAt = 0;

  // "Pause after break" is remembered per site (chrome.storage.local
  // "pv:pauseAfter:<host>") so the next visit starts with the same choice.
  // "After the break" is a choice for THIS break only. It used to persist per
  // site (pv:pauseAfter:<host>), so one press of Pause on Paramount+ - at any
  // time, for any reason - made every later break there hold the show on a
  // Paused card: "it shouldn't have been paused" (2026-09-12). Now it resets
  // to Play when the veil comes down; the stored values are cleared once.
  var pauseAfterPref = false, PAUSE_KEY = "pv:pauseAfter:" + location.hostname;
  try { chrome.storage.local.remove(PAUSE_KEY); } catch (e) {}
  function savePauseAfter(on) { pauseAfterPref = !!on; }
  PV.pauseAfterPref = function () { return pauseAfterPref; };
  PV.__savePauseAfter = savePauseAfter;   // tests

  // instant: true = opaque from the first paint (ad breaks - spec section 16
  // "cover fast"; the fade-in from a late rAF showed the ad's first frame
  // through the cover, YouTube 2026-08-29). false = the pause veil's soft fade.
  // "After the break" control: a two-way Play / Pause button (was a checkbox),
  // sized for a glance across the room, with the explanation in its tooltip.
  var AFTER_TIP = "What happens when the break ends. Play: your show carries on by itself. Pause: Prism holds it on a Paused card until you press Resume - handy if you stepped away.";
  function buildAfterControl(scale) {
    var k = scale || 1, wrap = document.createElement("div");
    wrap.setAttribute("data-prism-veil", "1"); wrap.title = AFTER_TIP;
    wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:" + Math.round(6 * k) + "px;pointer-events:auto";
    var cap = document.createElement("div"); cap.textContent = "After the break";
    cap.style.cssText = "font:500 " + Math.round(13 * k) + "px -apple-system,Segoe UI,Roboto,sans-serif;color:#D7DCE3;letter-spacing:.02em";
    var seg = document.createElement("div");
    seg.style.cssText = "display:flex;border:1.5px solid #F0A83C;border-radius:" + Math.round(12 * k) + "px;overflow:hidden";
    function btn(txt, on) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = txt; b.title = AFTER_TIP;
      b.setAttribute("aria-pressed", "false");
      b.style.cssText = "cursor:pointer;border:0;margin:0;font:600 " + Math.round(16 * k) + "px -apple-system,Segoe UI,Roboto,sans-serif;padding:" + Math.round(11 * k) + "px " + Math.round(22 * k) + "px;min-width:" + Math.round(118 * k) + "px;background:transparent;color:#F0A83C;transition:background .15s,color .15s";
      b.addEventListener("click", function (ev) { ev.stopPropagation(); ev.preventDefault(); if (!vidVeil) return; vidVeil.pauseAfter = on; savePauseAfter(on); paintPauseAfter(); });
      return b;
    }
    var play = btn("\u25B6 Play", false), pause = btn("\u23F8 Pause", true);
    seg.appendChild(play); seg.appendChild(pause);
    wrap.appendChild(cap); wrap.appendChild(seg);
    wrap.__play = play; wrap.__pause = pause;
    return wrap;
  }
  function paintAfter(wrap, on) {
    if (!wrap) return;
    var A = "#F0A83C", D = "#0A0C0F";
    wrap.__pause.style.background = on ? A : "transparent"; wrap.__pause.style.color = on ? D : A; wrap.__pause.setAttribute("aria-pressed", on ? "true" : "false");
    wrap.__play.style.background = on ? "transparent" : A; wrap.__play.style.color = on ? A : D; wrap.__play.setAttribute("aria-pressed", on ? "false" : "true");
  }
  function buildCover(instant) {
    var cover = document.createElement("div");
    cover.setAttribute("data-prism-veil", "1");
    cover.style.cssText = "position:fixed;z-index:2147483000;overflow:hidden;background:#0A0C0F;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .45s ease;pointer-events:auto";
    var art = document.createElement("div");
    art.setAttribute("data-prism-veil", "1");
    art.style.cssText = "position:absolute;inset:0;background:#0A0C0F center/cover no-repeat;will-change:transform";
    if (PV.artOnto) PV.artOnto(art, PV.pickArt()); else art.style.backgroundImage = "url('" + PV.pickArt() + "')";
    cover.appendChild(art);
    cover.__art = art;
    kenBurns(art);
    var msg = document.createElement("div");
    msg.setAttribute("data-prism-veil", "1");
    msg.style.cssText = "position:relative;font:600 26px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#F0A83C;text-align:center;text-shadow:0 2px 12px #000;padding:18px 28px;background:rgba(10,12,15,.5);border-radius:16px;backdrop-filter:blur(3px);box-shadow:0 8px 40px rgba(0,0,0,.4)";
    // The card's own glyph + "Intermission" title row is HIDDEN (kept in the
    // DOM so the mode painter's text updates stay harmless): the corner glyph
    // already names the veil, and the card keeps the rest - "get rid of
    // Intermission and the symbol from the middle ... leave everything else
    // in the middle" (2026-09-12). The HUD switch lives in the popup.
    msg.innerHTML = "<span class=\"__prismmoon\" style=\"display:none\">&#x25D0;</span><span class=\"__prismtitle\" style=\"display:none\"> Intermission</span>"
      + "<div class=\"__prismsub\" style=\"font-size:15px;color:#D7DCE3;font-weight:400;margin-top:6px\">Your show returns after the break</div>"
      + "<div class=\"__prisminfo\" style=\"font-size:14px;color:#9AA4B2;font-weight:500;margin-top:10px;font-variant-numeric:tabular-nums;display:none\">"
      +   "<div class=\"__prismtime\" style=\"font-size:18px;color:#D7DCE3\"></div><div class=\"__prismcount\" style=\"margin-top:4px\"></div></div>"
      + "<button class=\"__prismresume\" style=\"pointer-events:auto;cursor:pointer;margin-top:14px;font:600 15px -apple-system,Segoe UI,Roboto,sans-serif;color:#0A0C0F;background:#F0A83C;border:0;border-radius:9px;padding:9px 20px;display:none\">&#x25B6; Resume</button>"
      + "<button class=\"__prismfs\" title=\"Uses the player\u2019s own full-screen control\" style=\"pointer-events:auto;cursor:pointer;margin:14px 0 0 10px;font:600 15px -apple-system,Segoe UI,Roboto,sans-serif;color:#F0A83C;background:transparent;border:1.5px solid #F0A83C;border-radius:9px;padding:8px 16px;display:none\">&#x26F6; Full screen</button>"
      + "<div class=\"__prismpauseafter\" style=\"pointer-events:auto;display:none;flex-direction:column;align-items:center;gap:7px;margin-top:16px\"></div>";
    cover.appendChild(msg);
    cover.__card = msg;
    cover.__moon = msg.querySelector(".__prismmoon");
    cover.__title = msg.querySelector(".__prismtitle");
    // Minimal HUD: a chip top-left over the art; click expands a small
    // popover holding only what is actionable right now.
    var chip = document.createElement("div");
    chip.setAttribute("data-prism-veil", "1");
    chip.style.cssText = "position:absolute;left:14px;top:14px;display:none;align-items:center;gap:6px;pointer-events:auto;cursor:pointer;font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;color:#F0A83C;text-shadow:0 1px 8px #000;background:rgba(10,12,15,.55);padding:7px 12px;border-radius:10px;backdrop-filter:blur(3px);font-variant-numeric:tabular-nums";
    // The ◐ glyph is itself a HUD-mode toggle (full card ↔ corner chip); the
    // rest of the chip opens the popover.
    var chipMoon = document.createElement("span"); chipMoon.textContent = "◐"; chipMoon.title = "Switch HUD: full card ↔ corner chip"; chipMoon.style.cursor = "pointer";
    var chipLbl = document.createElement("span"); chipLbl.textContent = " Intermission";
    chip.appendChild(chipMoon); chip.appendChild(chipLbl);
    cover.__chipMoon = chipMoon;
    var pop = document.createElement("div");
    pop.setAttribute("data-prism-veil", "1");
    pop.style.cssText = "position:absolute;left:14px;top:52px;display:none;flex-direction:column;gap:10px;pointer-events:auto;font:500 14px -apple-system,Segoe UI,Roboto,sans-serif;color:#D7DCE3;background:rgba(20,23,28,.92);padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);box-shadow:0 8px 30px rgba(0,0,0,.5);min-width:220px";
    var popPos = document.createElement("div"); popPos.setAttribute("data-prism-veil", "1"); popPos.style.cssText = "color:#9AA4B2;font-size:13px;display:none";
    var popPause = buildAfterControl(0.8); popPause.style.display = "none";
    var popBox = null;
    var popResume = document.createElement("button"); popResume.setAttribute("data-prism-veil", "1"); popResume.type = "button";
    popResume.style.cssText = "display:none;cursor:pointer;font:600 14px -apple-system,Segoe UI,Roboto,sans-serif;color:#0A0C0F;background:#F0A83C;border:0;border-radius:9px;padding:8px 16px";
    popResume.textContent = "▶ Resume";
    var popFs = document.createElement("button"); popFs.setAttribute("data-prism-veil", "1"); popFs.type = "button";
    popFs.style.cssText = "display:none;cursor:pointer;font:600 13px -apple-system,Segoe UI,Roboto,sans-serif;color:#F0A83C;background:transparent;border:1.5px solid #F0A83C;border-radius:9px;padding:7px 12px;margin-left:8px";
    popFs.textContent = "\u26F6 Full screen"; popFs.title = "Uses the player\u2019s own full-screen control";
    popFs.addEventListener("click", function (ev) { ev.stopPropagation(); toggleFullscreen(); });
    cover.__popFs = popFs;
    pop.appendChild(popPos); pop.appendChild(popPause); pop.appendChild(popResume); pop.appendChild(popFs);
    cover.appendChild(chip); cover.appendChild(pop);
    cover.__chip = chip; cover.__chipLbl = chipLbl; cover.__pop = pop; cover.__popPos = popPos; cover.__popPause = popPause; cover.__popBox = popBox; cover.__popResume = popResume;
    cover.__cardMoon = msg.querySelector(".__prismmoon");
    chipMoon.addEventListener("click", function (ev) { ev.stopPropagation(); toggleHud(); });
    if (cover.__cardMoon) cover.__cardMoon.addEventListener("click", function (ev) { ev.stopPropagation(); toggleHud(); });
    chip.addEventListener("click", function (ev) { ev.stopPropagation(); pop.style.display = (pop.style.display === "none") ? "flex" : "none"; });
    pop.addEventListener("click", function (ev) { ev.stopPropagation(); });
    popResume.addEventListener("click", function (ev) { ev.stopPropagation(); resumePlayback(); });
    applyHud(cover);
    cover.__sub = msg.querySelector(".__prismsub");
    cover.__info = msg.querySelector(".__prisminfo");
    cover.__time = msg.querySelector(".__prismtime");
    cover.__count = msg.querySelector(".__prismcount");
    cover.__resume = msg.querySelector(".__prismresume");
    cover.__fs = msg.querySelector(".__prismfs");
    cover.__fs.addEventListener("click", function (ev) { ev.stopPropagation(); toggleFullscreen(); });
    cover.__pauseAfter = msg.querySelector(".__prismpauseafter");
    cover.__afterCtl = buildAfterControl(1);
    cover.__pauseAfter.appendChild(cover.__afterCtl);
    cover.__pauseAfter.addEventListener("click", function (ev) { ev.stopPropagation(); });
    cover.__resume.addEventListener("click", function (ev) { ev.stopPropagation(); resumePlayback(); });
    // The cutout is a mask (paint only) - clicks in it still land on the cover.
    // Forward them to the control behind the hole (Skip, "Click to return to
    // the video"), and show a pointer over it.
    function inHole(ev) { var h = cover.__hole; return !!(h && cover.__holeEl && ev.clientX >= h.left && ev.clientX <= h.left + h.width && ev.clientY >= h.top && ev.clientY <= h.top + h.height); }
    cover.addEventListener("mousemove", function (ev) { cover.style.cursor = inHole(ev) ? "pointer" : ""; });
    cover.addEventListener("click", function (ev) {
      if (!inHole(ev)) return;
      ev.preventDefault(); ev.stopPropagation();
      var el = cover.__holeEl;
      if (vidVeil && vidVeil.mode === "ad" && /skip/i.test(((el.innerText || el.textContent || "") + " " + (el.getAttribute("aria-label") || "") + " " + PV.classStr(el)))) { skipAt = Date.now(); trace("skip clicked"); }
      try { el.focus && el.focus(); } catch (e) {}
      try { el.click(); } catch (e) {}
    }, true);
    veilHost().appendChild(cover);
    if (instant) { cover.style.transition = "none"; cover.style.opacity = "1"; }
    else requestAnimationFrame(function () { cover.style.opacity = "1"; });
    try { msg.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 520, easing: "cubic-bezier(.2,.7,.2,1)", fill: "backwards" }); } catch (e) {}
    return cover;
  }

  function paintPauseAfter() {
    if (!vidVeil) return;
    var on = !!vidVeil.pauseAfter, c = vidVeil.cover;
    paintAfter(c.__afterCtl, on);
    paintAfter(c.__popPause, on);
  }
  // HUD mode (Prism-wide pref "hud": "interactive" | "minimal"), live-switched.
  function hudMode() { return (PV.uiPrefs && PV.uiPrefs.hud === "minimal") ? "minimal" : "interactive"; }
  function toggleHud() {
    var next = (hudMode() === "minimal") ? "interactive" : "minimal";
    PV.uiPrefs = PV.uiPrefs || {};
    PV.uiPrefs.hud = next;
    applyHud();
    if (PV.setUiPref) PV.setUiPref("hud", next);
  }
  // Full card: the centred card (title, clock, controls) AND the glyph alone
  // in the top-left corner as a mark - inert, the same mark a display cover
  // wears ("leave the symbol up there, I like it, but move everything else
  // back to the center", 2026-09-12). Corner chip: the chip carries the
  // label and clock and opens the popover; the card is hidden.
  function applyHud(cover) {
    var c = cover || (vidVeil && vidVeil.cover); if (!c || !c.__chip) return;
    var min = hudMode() === "minimal";
    c.__card.style.display = min ? "none" : "block";
    c.__chip.style.display = "flex";
    c.__chip.style.pointerEvents = min ? "auto" : "none";
    c.__chip.style.cursor = min ? "pointer" : "default";
    if (c.__chipMoon) c.__chipMoon.style.cursor = min ? "pointer" : "default";
    if (c.__chipLbl) c.__chipLbl.style.display = min ? "" : "none";
    if (!min) c.__pop.style.display = "none";
  }
  PV.applyHud = function () { applyHud(); };

  // ---------------------------------------------------------------- controls
  // The player's own TRANSPORT play/pause control - and only that. A loose
  // match ("Play ...") also hits recommendation / up-next poster buttons, and
  // clicking one starts a DIFFERENT show. So the accessible name must be exactly
  // a transport verb, or the class must name a play-pause control; anything that
  // reads like a title or "next" is out.
  // The player's own full-screen control: offered on the card only when one
  // exists (no control = no offer). Clicking it keeps the player's state right
  // and the veil follows into the fullscreen element (0.7.75).
  // Where a player's CONTROLS live: the registry container when the box is
  // inside one (Pluto/Paramount: the control bar is a sibling of the video's
  // .player-wrapper, under .aa-player-skin - the nearest "player" ancestor
  // missed it, 2026-08-29); else the OUTERMOST player-classed ancestor.
  function controlRoot(box) {
    if (!box) return document.body;
    try {
      // listed rows only here - the generic row's container is derived FROM controlRoot (no recursion)
      var cont = null; for (var ri = 0; ri < SSAI_AD_SOURCES.length && !cont; ri++) { var rr = SSAI_AD_SOURCES[ri]; if (!rr.generic && srcHere(rr)) cont = document.querySelector(rr.container); }
      if (cont && (cont === box || cont.contains(box))) return cont;
    } catch (e) {}
    var n = box, best = null, d = 0;
    while (n && n !== document.body && d < 10) { if (/layer|player/i.test(PV.classStr(n))) best = n; n = n.parentElement; d++; }
    if (best) return best;
    // No "player" wrapper (aether.ist: a Tailwind div.h-screen, 2026-08-29):
    // the nearest ancestor that actually holds buttons is the player.
    n = box; d = 0;
    while (n && n !== document.body && d < 8) { if (n !== box && n.querySelector && n.querySelector("button,[role=button]")) return n; n = n.parentElement; d++; }
    return box;
  }
  function findFullscreenControl(box) {
    var root = controlRoot(box);
    var cands = root.querySelectorAll("button,[role=button]");
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c.hasAttribute("data-prism-veil") || c.hasAttribute("data-prism-ui")) continue;
      var name = (c.getAttribute("aria-label") || c.getAttribute("title") || "").trim();
      var cls = PV.classStr(c) + " " + (c.getAttribute("data-a-target") || "") + " " + (c.getAttribute("data-testid") || "");
      if (/full\s*-?screen|fullscreen/i.test(name) || /fullscreen|full-screen/i.test(cls)) return c;
      if (fullscreenIcon(c)) return c;
    }
    return null;
  }
  // Unlabelled icon buttons (aether.ist: Tailwind button, SVG only, 2026-08-29):
  // recognise the stock full-screen glyphs by their path data - Font Awesome
  // 5/6 expand / compress, Material fullscreen / fullscreen_exit - or a
  // <use href="#…fullscreen…">.
  var FS_ICON_PATHS = [
    "M32 32C14.3 32 0 46.3 0 64v96",                    // FA6 expand
    "M160 64c0-17.7-14.3-32-32-32s-32 14.3-32 32v64",   // FA6 compress
    "M0 180V56c0-13.3 10.7-24 24-24h124",               // FA5 expand
    "M436 192H312c-13.3 0-24-10.7-24-24V44",            // FA5 compress
    "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5z",           // Material fullscreen
    "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3z"              // Material fullscreen_exit
  ];
  function fullscreenIcon(btn) {
    try {
      var u = btn.querySelector("svg use"); if (u) { var h = u.getAttribute("href") || u.getAttribute("xlink:href") || ""; if (/fullscreen|full-screen|expand|compress/i.test(h)) return true; }
      var paths = btn.querySelectorAll("svg path");
      for (var i = 0; i < paths.length; i++) {
        var d = (paths[i].getAttribute("d") || "").replace(/\s+/g, " ").trim();
        for (var j = 0; j < FS_ICON_PATHS.length; j++) if (d.indexOf(FS_ICON_PATHS[j]) === 0) return true;
      }
    } catch (e) {}
    return false;
  }
  function inFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFullscreen() {
    if (!vidVeil) return;
    var was = inFullscreen();
    var ctl = findFullscreenControl(vidVeil.box || vidVeil.video);
    if (ctl) { try { ctl.click(); } catch (e) {} }
    // Exiting needs no user gesture - so if the player's control ignored the
    // synthetic click (YouTube on the way OUT, 2026-08-30: enter works, exit
    // only via Escape), leave fullscreen ourselves once the click has had
    // its chance. Entering has no such fallback (requestFullscreen needs the
    // gesture and would skip the player's own layout switch anyway).
    if (was) setTimeout(function () { if (inFullscreen()) { try { document.exitFullscreen(); } catch (e) {} } }, 400);
    else if (!ctl && inFullscreen()) { try { document.exitFullscreen(); } catch (e) {} }
  }
  function paintFullscreen(c) {
    var ctl = findFullscreenControl(vidVeil.box || vidVeil.video), on = inFullscreen();
    var label = on ? "\u26F6 Exit full screen" : "\u26F6 Full screen";
    [c.__fs, c.__popFs].forEach(function (b) {
      if (!b) return;
      b.style.display = ctl ? "inline-block" : "none";
      if (b.textContent !== label) b.textContent = label;
    });
  }
  function findPlayControl(box) {
    // A pause panel's own way back ("Click to return to the video") is the
    // player's canonical resume - prefer it while it is on screen.
    try { var rb = findReturn(); if (rb) return rb; } catch (e) {}
    var root = controlRoot(box);
    var cands = root.querySelectorAll("button,[role=button]");
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c.hasAttribute("data-prism-veil")) continue;
      var name = (c.getAttribute("aria-label") || c.getAttribute("title") || "").trim();
      var cls = (c.className && c.className.toString) ? c.className.toString() : "";
      var exact = /^(play|pause|play\/pause|play or pause|play\/pause toggle|resume|pause or play)(\s*\(.*\))?$/i.test(name);   // "Play (space/k)" - Twitch
      var classCtl = /play-?pause|playpause|(^|[-_ ])control-play|toggle-play/i.test(cls) || /player-play-pause-button/.test(c.getAttribute("data-a-target") || "");
      if (!exact && !classCtl) continue;
      if (/playlist|episode|next|up-?next|recommend|poster|title|trailer|preview|watch\s|autoplay/i.test(name + " " + cls)) continue;
      return c;
    }
    return null;
  }
  // Resume: unmute AND play together, then lift the veil. The transport is a
  // TOGGLE, so only click it when the show is actually paused; a raw play() is
  // the fallback (verified once, 450ms later). An explicit Resume also clears
  // "Pause after break" - the human wants to watch now.
  function resumePlayback() {
    if (!vidVeil) return;
    if (vidVeil.mode === "ai") { aiWatchAnyway = aiKey(); restoreMute(); uncover("ai-watch-anyway"); return; }
    if (vidVeil.mode === "hold") { restoreMute(); uncover("hold-resume"); return; }
    vidVeil.pauseAfter = false; paintPauseAfter();
    var v = vidVeil.video, box = vidVeil.box || v;
    resumedAt = Date.now();
    restoreMute();
    // Play the EXACT element the human paused FIRST. A control click can land on
    // the wrong button behind a pause-ad overlay (Hulu's PauseAd) and start a
    // DIFFERENT show in the background while the real player stays paused. Only
    // if the element is still paused a beat later - some players ignore a raw
    // play() in an ad state - forward to the transport control, then retry.
    var src = activeAdSource();
    if (src && src.resumeVia === "control") {
      // Control-first players: the skin's own state machine must see the
      // click, or the video runs while the controls still show "paused".
      var ctl0 = findPlayControl(box);
      if (ctl0) { try { ctl0.click(); } catch (e) {} }
      setTimeout(function () {
        var still0 = true; try { still0 = !!v.paused; } catch (e) {}
        if (!still0) return;
        try { var pr0 = v.play(); if (pr0 && pr0.catch) pr0.catch(function () {}); } catch (e) {}
      }, 350);
      uncover("resume-click");
      return;
    }
    try { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    setTimeout(function () {
      var still = true; try { still = !!v.paused; } catch (e) {}
      if (!still) return;
      var ctl = findPlayControl(box);
      if (ctl) { try { ctl.click(); } catch (e) {} }
      try { v.play(); } catch (e) {}
    }, 350);
    uncover("resume-click");
  }
  // Pause the show ONCE (mirror of resume). Control-first (Hulu ignores a raw
  // pause()), but never looped - a single click at the break's end, when the
  // transport is a real play/pause. If it does not take, the show just plays on.
  // Another sizeable <video> on the page that is playing right now (the show
  // handed to a second element after a break), else null.
  function playingElsewhere(v) {
    var vids = document.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) {
      var o = vids[i]; if (o === v) continue;
      try {
        if (o.paused || o.ended || o.readyState < 2) continue;
        var r = o.getBoundingClientRect(); if (r.width < 400 || r.height < 150) continue;
        return o;
      } catch (e) {}
    }
    return null;
  }
  function pauseShow(v, box) {
    var already = false; try { already = !!v.paused; } catch (e) {}
    if (already) return;                // already paused - a toggle-click would PLAY it
    var ctl = findPlayControl(box);
    if (ctl) { try { ctl.click(); } catch (e) {} }
    else { try { v.pause(); } catch (e) {} }
    setTimeout(function () {
      var playing = false; try { playing = !v.paused; } catch (e) {}
      if (playing) { try { v.pause(); } catch (e) {} }
    }, 400);
  }

  // ---------------------------------------------------------------- geometry
  /** The element the veil is sized to: a registry veilTarget, else the main video. */
  function veilBox(src, v) {
    // No ad signal right now (pause / AI veils) still means the registry
    // player's veilTarget: YouTube shifts its <video> far off-frame while the
    // player initialises, and a cover sized to that element showed only a
    // sliver at the top of the viewport (screenshot 2026-08-29).
    if (!src) src = activeAdSource();
    if (src && src.veilTarget) { var t = document.querySelector(src.veilTarget); if (t) return t; }
    return v;
  }
  // The rect to paint the cover at. The registry veilTarget (e.g. Hulu's
  // .Player__container) can COLLAPSE during a VPAID/house-ad unit that plays in
  // a different element - a zero/tiny rect would leave the ad visible with only
  // the corner chip showing. So fall back: box -> the main video -> the whole
  // viewport. An ad is ALWAYS fully covered; better too much veil than a
  // visible ad.
  function coverRect(box, video) {
    function ok(r) { return r && r.width > 200 && r.height > 150; }
    var r; try { r = box && box.getBoundingClientRect(); } catch (e) {}
    if (ok(r)) return r;
    try { r = video && video.getBoundingClientRect(); } catch (e) {}
    if (ok(r)) return r;
    // A listed player's CONTAINER before the whole viewport: SOOP's IMA ad
    // video is removed the moment the ad ends, and during the end-grace hold
    // the collapsed box sent the cover full-screen (reported 2026-08-30).
    // The container is where the player lives - the right size for the veil.
    try { var src = activeAdSource(), cont = src && rowContainer(src); if (cont) { r = cont.getBoundingClientRect(); if (ok(r)) return r; } } catch (e2) {}
    return { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }
  /** Size the cover to the player. withSkip cuts the Skip hole (ad mode only). */
  // The FULLSCREEN top layer paints only the fullscreen element's subtree
  // (Hulu fullscreen: veil missing, 2026-08-29). While an element is
  // fullscreen, the cover and chip live inside it; otherwise on <html>.
  function veilHost() { return document.fullscreenElement || document.webkitFullscreenElement || document.documentElement; }
  function rehost(el) { if (!el) return; var h = veilHost(); if (el.parentNode !== h) { try { h.appendChild(el); } catch (e) {} } }
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (t) {
    document.addEventListener(t, function () { if (vidVeil) { rehost(vidVeil.cover); positionCover(false); } rehost(restoreChip); }, true);
  });
  function positionCover(withSkip) {
    if (!vidVeil) return null;
    rehost(vidVeil.cover);
    var vr = coverRect(vidVeil.box, vidVeil.video), c = vidVeil.cover;
    // a big jump in the painted size is always worth a trace line (a report
    // 2026-08-30 showed a fullscreen SOOP veil with no sizing history at all)
    if (c.__pw && (Math.abs(vr.width - c.__pw) > c.__pw * 0.3 || Math.abs(vr.height - c.__ph) > c.__ph * 0.3)) trace("cover resize " + c.__pw + "x" + c.__ph + " -> " + Math.round(vr.width) + "x" + Math.round(vr.height));
    c.__pw = Math.round(vr.width); c.__ph = Math.round(vr.height);
    c.style.left = vr.left + "px"; c.style.top = vr.top + "px";
    c.style.width = vr.width + "px"; c.style.height = vr.height + "px";
    // Only ad veils get a cutout (Skip). The pause veil's own Resume is the
    // way back; a cut-out "Click to return to the video" did nothing when
    // clicked through the hole (Paramount+, 2026-08-29), so it is gone.
    if (vidVeil.mode === "ad") { if (withSkip) applySkipHole(c, vr, findSkip()); }
    else clearHole(c);
    return vr;
  }
  // The pause panel's own way back ("Click to return to the video" on
  // Paramount+): shown through the pause veil like a Skip button.
  var RETURN_UI = /return to (the )?video|back to (the )?video|resume video|continue watching/i;
  function findReturn() {
    var cands = document.querySelectorAll(".pause-panel-return-button, button, [role=button]");
    for (var i = 0; i < cands.length && i < 3000; i++) {
      var e = cands[i]; if (e.hasAttribute("data-prism-veil") || e.hasAttribute("data-prism-ui")) continue;
      var t = (e.innerText || e.textContent || e.getAttribute("aria-label") || "").trim();
      if (!RETURN_UI.test(t) && !/pause-panel-return/.test(PV.classStr(e))) continue;
      var r = e.getBoundingClientRect();
      if (r.width > 0 && r.width <= 400 && r.height <= 120 && PV.elVisible(e)) return e;
    }
    return null;
  }

  // ---------------------------------------------------------------- mute
  // Hide the VIDEO ELEMENT itself while it is veiled (2026-08-29, YouTube:
  // every trace showed a perfect cover from frame 1, yet a flash of the ad at
  // the start persisted). Chromium can hand a <video> to a hardware overlay
  // plane and, during a stream swap, composite that plane OVER the page for a
  // frame or more - nothing in DOM stacking can prevent it. A video at
  // opacity 0 paints nothing on any plane. Restored the moment the veil goes.
  // YouTube only: the overlay-plane flash was seen there alone, and a hidden
  // <video> is a state other players may not tolerate (Hulu load timeouts
  // reported 2026-08-29; YouTube itself answers it with a page reload).
  var HIDE_VIDEO_HOSTS = /(^|\.)youtube\.com$/i;
  function hideVideo(v) { try { if (v && v.tagName === "VIDEO" && HIDE_VIDEO_HOSTS.test(location.hostname)) v.setAttribute("data-prism-hidden", "1"); } catch (e) {} }
  function showVideos() { try { document.querySelectorAll("video[data-prism-hidden]").forEach(function (o) { o.removeAttribute("data-prism-hidden"); }); } catch (e) {} }
  (function () {
    try {
      var st = document.createElement("style"); st.setAttribute("data-prism-ui", "1");
      // opacity:0 (0.7.40) is the only thing that stopped the ad's first
      // frames showing; a tiny rotation (0.7.42) did not. KNOWN ISSUE: YouTube
      // occasionally treats the transparent ad video as hidden and recovers
      // with a full page reload mid-ad. Chosen over the flash (2026-08-29).
      st.textContent = "video[data-prism-hidden]{opacity:0 !important}";
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  })();
  // Every OTHER media element too, <audio> included: an audio platform plays
  // its ad through the same <audio> that plays the music - Pandora's video
  // ad ("Get My Skips") ran silent in its paused <video> while the ad's audio
  // came out of the station's element ("veil shows but audio plays during ad
  // breaks", 2026-09-12). Restored on uncover, like the videos.
  // ---- muting under the veil. TAB-level first (bg.js "prism-tab-mute",
  // 2026-09-12): the page cannot observe a tab mute - no `muted` flip, no
  // volumechange - so a player watching its own media state (Pandora paused
  // its rewarded ad at ~7s with "Resume your video" once its <audio> was
  // muted) sees nothing, and everything in the tab is silent, iframes
  // included ("since we're doing an overlay, it shouldn't know that we're
  // not watching the ad"). The element mutes are applied FIRST, synchronously,
  // so not a frame of ad sound gets out while the background answers, and
  // taken back the moment the tab mute is confirmed; they remain the
  // fallback when it is not (no background answer).
  var tabMuted = false, tabMuteSeq = 0;
  function tabMute(on, cb) {
    var seq = ++tabMuteSeq;
    try {
      chrome.runtime.sendMessage({ type: "prism-tab-mute", muted: !!on }, function (r) {
        var ok = !!(r && r.ok); try { if (chrome.runtime.lastError) ok = false; } catch (e0) {}
        if (cb && seq === tabMuteSeq) cb(ok);
      });
    } catch (e) { if (cb) cb(false); }
  }
  function tabMuteStart() {
    tabMuted = false;
    tabMute(true, function (ok) {
      if (!ok || !vidVeil) return;
      tabMuted = true;
      elementRestore();   // the tab is silent: the elements' own state goes back to the page
      trace("tab muted");
    });
  }
  function tabMuteEnd() {
    if (!tabMuteSeq) return;   // never asked
    tabMuted = false;
    tabMute(false, null);      // bumps the sequence: a mute still in flight cannot land after this
  }
  function muteOthers(v) {
    if (tabMuted) return;
    document.querySelectorAll("video,audio").forEach(function (o) { if (o !== v) { try { if (o.__prismWas === undefined) o.__prismWas = o.muted; o.muted = true; } catch (e) {} } });
  }
  function elementRestore() {
    if (vidVeil) { try { vidVeil.video.muted = vidVeil.wasMuted; } catch (e) {} }
    document.querySelectorAll("video,audio").forEach(function (o) { if (o.__prismWas !== undefined) { try { o.muted = o.__prismWas; } catch (e) {} delete o.__prismWas; } });
  }
  function restoreMute() {
    showVideos();
    if (!vidVeil) return;
    elementRestore();
    tabMuteEnd();
  }

  // Track real playback so a pause veil can tell a deliberate pause from the
  // paused states at launch / seeking / buffering.
  // Page-level too: Twitch tears the stream down on pause and hands over a
  // FRESH <video> with no play/pause history (pause veil never came,
  // 2026-08-29), so "was playing" and "paused when" are also remembered for
  // the page, not just the element.
  var lastPlayingAt = 0, lastPauseAt = 0, lastInputAt = 0, lastPauseByUser = false;
  // A DELIBERATE pause follows the human's input (click / tap / key) within a
  // moment. A preview or hero trailer that stops by itself has none behind it
  // (Paramount+ home page: 90s autoplay trailer paused -> full veil,
  // 2026-08-29). Media keys are the one blind spot, accepted.
  ["pointerdown", "mousedown", "keydown", "touchstart"].forEach(function (t) { addEventListener(t, function () { lastInputAt = Date.now(); }, true); });
  addEventListener("playing", function (e) { var t = e.target; if (t && t.tagName === "VIDEO") { t.__prismPlayed = true; t.__prismPausedAt = 0; lastPlayingAt = Date.now(); lastPauseAt = 0; } }, true);
  addEventListener("pause", function (e) { var t = e.target; if (t && t.tagName === "VIDEO") { var byUser = Date.now() - lastInputAt < 1500; t.__prismPausedByUser = byUser; if (t.__prismPlayed) t.__prismPausedAt = Date.now(); if (lastPlayingAt) { lastPauseAt = Date.now(); lastPauseByUser = byUser; } } }, true);
  // Seeking (clicking the scrubber to jump) makes players pause the element
  // while they buffer to the new spot - that transient pause is NOT deliberate.
  // Stamp the last seek activity so pausedDeliberately can wait it out.
  addEventListener("seeking", function (e) { var t = e.target; if (t && t.tagName === "VIDEO") t.__prismSeekAt = Date.now(); }, true);
  addEventListener("seeked", function (e) { var t = e.target; if (t && t.tagName === "VIDEO") t.__prismSeekAt = Date.now(); }, true);

  // A DELIBERATE pause of a playing show - not the paused states at launch,
  // buffering, or a SEEK. Requires the video to have played (__prismPlayed) and
  // then been paused for a beat (>600ms so scrubbing does not trigger it), and
  // not to be seeking or freshly sought, never merely paused === true.
  // Live: Chrome reports a live MSE stream's duration as Infinity; Firefox
  // reports a large finite number (Twitch pause veil never came there,
  // 2026-08-29: "seeking" rejected it with the live exemption unapplied).
  // So also: a Twitch channel page (not /videos/), YouTube's live badge, or a
  // duration beyond any real video.
  function isLive(v) {
    try {
      if (!v) return false;
      if (v.duration === Infinity || v.duration > 172800) return true;
      if (/(^|\.)twitch\.tv$/i.test(location.hostname) && !/^\/(videos|clip)\//.test(location.pathname) && document.querySelector(".video-player")) return true;
      if (/(^|\.)youtube\.com$/i.test(location.hostname)) {
        // .ytp-live-badge exists on EVERY watch page (hidden when not live) -
        // Firefox showed LIVE on a normal video (2026-08-29). Live = the badge
        // actually painted, or the time display carrying ytp-live.
        var lb = document.querySelector("#movie_player .ytp-live-badge"), ld = document.querySelector("#movie_player .ytp-time-display.ytp-live");
        if (ld) return true;
        if (lb && lb.getClientRects().length && getComputedStyle(lb).display !== "none" && getComputedStyle(lb).visibility !== "hidden") return true;
        return false;
      }
      return false;
    } catch (e) { return false; }
  }
  function pausedDeliberately(v) {
    try {
      if (!v || !v.paused || v.ended) return false;
      var now = Date.now();
      // Page-level memory is for LIVE streams only (they swap elements on
      // pause). A VOD element that never played is just loading - Hulu showed
      // the Paused card while the next episode loaded (2026-08-29).
      var live = isLive(v);
      var played = v.__prismPlayed || (lastPlayingAt && now - lastPlayingAt < (live ? 300000 : 5000));
      var pausedAt = v.__prismPausedAt || (live && !v.__prismPlayed && lastPauseAt) || v.__prismSeenPausedAt || 0;
      if (!played || !pausedAt) return false;
      var byUser = v.__prismPausedAt ? !!v.__prismPausedByUser : (v.__prismSeenPausedAt ? !!v.__prismSeenPausedByUser : lastPauseByUser);
      if (!byUser) return false;   // the player stopped itself (preview, trailer, end of loop)
      // A paused LIVE stream is torn down into a seeking state at t=0 (Twitch,
      // measured 2026-08-29: paused=true seeking=true rs=1) - that is the
      // pause, not a scrub. The seek guards apply to VOD only.
      if (!live) {
        if (v.seeking) return false;                                           // mid-seek
        if (v.__prismSeekAt && now - v.__prismSeekAt < 1500) return false;     // buffering to the new spot
      }
      return (now - pausedAt > 600) && v.getBoundingClientRect().width > 400;
    } catch (e) { return false; }
  }
  // Veil-while-paused is allowed only on a page with a registered streaming
  // player (so a clean pause shows the intermission, not an arbitrary paused
  // <video> elsewhere), and not right after a Resume.
  // Any page's MAIN player qualifies for the pause veil (aether.ist report,
  // 2026-08-29: "preferably all the same features work"), not only the
  // registry: a large video, mostly in view, that played and was paused on
  // purpose. Feed autoplays pause when scrolled OUT of view, so "mostly in
  // view" keeps them out; the size floor keeps previews and thumbnails out.
  function genericPlayer(v) {
    try {
      if (!v) return false;
      var r = v.getBoundingClientRect();
      if (r.width < 480 || r.height < 240) return false;
      if (r.width * r.height < innerWidth * innerHeight * 0.18) return false;
      var vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
      return vis >= r.width * r.height * 0.6;
    } catch (e) { return false; }
  }
  // The "Veil the screen while paused" pref. Until pv:ui has been read it is
  // OFF: the in-memory default ({}) read as on, so a pause in that window
  // veiled for someone who had switched it off (Firefox report, 2026-09-23).
  function pauseVeilPref() { return !!(PV.uiPrefsLoaded && PV.uiPrefs && PV.uiPrefs.veilPaused !== false); }
  function pauseVeilAllowed() {
    var src = activeAdSource();
    if (src && src.pauseVeil === false) return false;
    return pauseVeilPref()
      && (src || authoritativeSsaiPresent() || genericPlayer(PV.mainVideo()))
      && !(resumedAt && Date.now() - resumedAt < RESUME_GRACE_MS);
  }

  // Is a break / deliberate pause active right now? Used by the restore chip.
  function breakActiveNow() {
    var ssai = ssaiActiveSource();
    if (adSignalOn(ssai)) return true;
    if (pauseVeilAllowed() && pausedDeliberately(PV.mainVideo())) return true;
    return false;
  }

  // After the human clears a break, it STAYS cleared (no auto-return); a small
  // corner chip brings the intermission back on demand, and clears itself when
  // the break ends.
  var vidDismissed = false, restoreChip = null;
  // AI-labelled video (opt-in pv:ui.aiVeil; spec section 5 - the platform's
  // own disclosure is the source). YouTube: the "How this was made" section of
  // the structured description ("Made with AI" / "altered or fully
  // generated"), present even while the description is collapsed. The veil is
  // a full video intermission (position readout, "Watch anyway"), not a
  // display cover, so it reads like every other intermission.
  var aiWatchAnyway = "";   // location key the human chose to watch anyway
  function aiKey() { try { return location.pathname + location.search; } catch (e) { return ""; } }
  // The section must be THIS video's. YouTube keeps the previous watch page's
  // DOM through a navigation, so a document-wide query found the last video's
  // "Made with AI" section under the new video's URL - an unlabelled video
  // was veiled on arrival and, worse, cached as AI for its tile (VIATMOS,
  // 2026-09-12; YouTube's own next response for it has no such section). So:
  // the section is looked for inside <ytd-watch-flexy video-id=...> matching
  // the URL; YouTube's per-video verdict (ai-tiles.js, looked up once) wins
  // over the DOM either way and is the only thing that writes the cache.
  function aiLabeled() {
    if (!(PV.uiPrefs && PV.uiPrefs.aiVeil)) return null;
    if (!/(^|\.)youtube\.com$/i.test(location.hostname)) return null;
    var vid = ""; try { var vm = /[?&]v=([\w-]{11})/.exec(location.search); vid = vm ? vm[1] : ""; } catch (e) {}
    var verdict = (vid && PV.aiVerdict) ? PV.aiVerdict(vid) : undefined;
    if (verdict === 0) return null;
    var flexy = document.querySelector("ytd-watch-flexy");
    var scope = flexy || document;
    if (vid && flexy && (flexy.getAttribute("video-id") || "") !== vid) scope = null;   // the old video's page still on screen
    var hw = scope ? scope.querySelector("how-this-was-made-section-view-model, [class*='how-this-was-made']") : null;
    var t = hw ? (hw.textContent || "") : "";
    var m = t.match(/made with ai|ai[- ]generated|altered or synthetic content|altered or fully generated/i);
    if (verdict === 1) return { label: m ? (m[0].charAt(0).toUpperCase() + m[0].slice(1)) : "Made with AI", source: "YouTube" };
    if (!m) return null;
    if (vid && PV.aiLookup) { try { PV.aiLookup(vid); } catch (e2) {} }   // settle it by the video's own data; a stale match drops on the next tick
    return { label: m[0].charAt(0).toUpperCase() + m[0].slice(1), source: "YouTube" };
  }
  PV.__aiLabeled = aiLabeled;   // tests
  function enterAi(v, ssai, ai) {
    if (!vidVeil) {
      vidVeilStart = Date.now();
      var wasMuted = false; try { wasMuted = !!v.muted; v.muted = true; } catch (e) {}
      trace("up(ai) " + ai.label);
      vidVeil = { cover: buildCover(true), video: v, wasMuted: wasMuted, artAt: Date.now(), box: veilBox(ssai, v), mode: "ai", pauseAfter: false, pauseAt: 0, reclaimAt: 0 };
      muteOthers(v); tabMuteStart();
    } else if (vidVeil.mode !== "ai") {
      vidVeil.mode = "ai"; vidVeil.pauseAfter = false; vidVeil.pauseAt = 0;
      if (PV.reclaimVideoEnd && vidVeil.reclaimAt) { PV.reclaimVideoEnd(vidVeil.reclaimAt); vidVeil.reclaimAt = 0; }
      trace("mode ad->ai " + ai.label);
    }
    vidVeil.ai = ai;
    if (vidVeil.video !== v) { if (!tabMuted) { try { v.muted = true; } catch (e) {} } showVideos(); vidVeil.video = v; muteOthers(v); }
    hideVideo(v);
    vidVeil.box = veilBox(ssai, v);
    positionCover(false);
    updateCard();
  }
  function showRestoreChip() {
    if (restoreChip) return;
    restoreChip = document.createElement("div");
    restoreChip.setAttribute("data-prism-veil", "1");
    restoreChip.textContent = String.fromCharCode(0x25D0) + " Intermission";
    restoreChip.title = "Bring the Prism intermission back";
    restoreChip.style.cssText = "position:fixed;left:14px;top:14px;z-index:2147483000;pointer-events:auto;cursor:pointer;font:600 13px -apple-system,Segoe UI,Roboto,sans-serif;color:#F0A83C;background:rgba(10,12,15,.7);padding:7px 12px;border-radius:10px;border:1px solid rgba(240,168,60,.5);box-shadow:0 4px 18px rgba(0,0,0,.5);backdrop-filter:blur(3px)";
    restoreChip.addEventListener("click", function (e) { e.stopPropagation(); vidDismissed = false; hideRestoreChip(); videoAdBreak(); }, true);
    veilHost().appendChild(restoreChip);
  }
  function hideRestoreChip() { if (restoreChip) { try { restoreChip.remove(); } catch (e) {} restoreChip = null; } }
  // Called by main.js when the human dismisses (Escape / hold-to-reveal).
  // A TIMED reveal (Reveal 15 s, hold-to-reveal, Esc) re-veils by itself when
  // its time is up; before 2026-08-29 a dismissed break stayed cleared until
  // the restore chip was tapped ("I see ads even after the reveal").
  var reVeilAt = 0;
  PV.dismissVideo = function (ms) {
    var had = !!vidVeil;
    trace("reveal " + (ms || 0) + "ms had=" + had);
    if (vidVeil && vidVeil.mode === "ai") aiWatchAnyway = aiKey();   // Escape / hold-to-reveal on an AI veil = watch anyway
    PV.uncoverVideo();
    if (had && breakActiveNow()) { vidDismissed = true; reVeilAt = ms ? Date.now() + ms : 0; showRestoreChip(); }
    else { vidDismissed = false; reVeilAt = 0; hideRestoreChip(); }
  };

  // ---------------------------------------------------------------- machine
  function enterAd(v, ssai) {
    if (!vidVeil) {
      vidVeilStart = Date.now();
      var wasMuted = false; try { wasMuted = !!v.muted; v.muted = true; } catch (e) {}   // mute FIRST
      var vst = ""; try { vst = " t=" + v.currentTime.toFixed(2) + " dur=" + Math.round(v.duration) + (v.paused ? " paused" : "") + " rs=" + v.readyState; } catch (eU) {}
      trace("up(ad" + (ssai && ssai.__early ? "-early" : "") + ") src=" + (ssai ? ssai.source : "sdk") + " v=" + Math.round(v.getBoundingClientRect().width) + vst + " via=" + (lastTrigger || "poll") + (lastTriggerAt ? "+" + (Date.now() - lastTriggerAt) + "ms" : ""));
      vidVeil = { cover: buildCover(true), video: v, wasMuted: wasMuted, artAt: Date.now(), box: veilBox(ssai, v), mode: "ad", early: !!(ssai && ssai.__early), pauseAfter: pauseAfterPref, pauseAt: 0, reclaimAt: (PV.reclaimVideoStart ? PV.reclaimVideoStart() : 0) };
      muteOthers(v); tabMuteStart();
    } else if (vidVeil.mode !== "ad") {
      // a pause intermission overtaken by a real break: switch to ad, count reclaimed time
      vidVeil.mode = "ad"; vidVeil.pauseAfter = pauseAfterPref; vidVeil.pauseAt = 0;
      vidVeilStart = Date.now();
      if (!vidVeil.reclaimAt && PV.reclaimVideoStart) vidVeil.reclaimAt = PV.reclaimVideoStart();
    }
    if (vidVeil.video !== v) { if (!tabMuted) { try { v.muted = true; } catch (e) {} } showVideos(); vidVeil.video = v; muteOthers(v); }
    hideVideo(v);
    vidVeil.box = veilBox(ssai, v);
    positionCover(true);
    if (!vidVeil.__firstFrames) {
      // The first three painted frames of a new ad veil (the flash is "at the
      // beginning"): computed opacity, rect, clip, and whatever is on top.
      vidVeil.__firstFrames = true;
      var cv = vidVeil.cover, n = 0;
      (function ff() {
        if (!vidVeil || vidVeil.cover !== cv || n++ >= 3) return;
        try {
          var cs = getComputedStyle(cv), r = cv.getBoundingClientRect();
          var top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          trace("frame" + n + " op=" + cs.opacity + " " + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height) + " clip=" + (cs.clipPath === "none" ? "-" : "yes") + " top=" + (top ? top.tagName + (top === cv || cv.contains(top) ? "(cover)" : "#" + (top.id || "") + "." + PV.classStr(top).slice(0, 30)) : "none"));
        } catch (e) { trace("frame err " + e); }
        requestAnimationFrame(ff);
      })();
    }
    updateCard();
    hideRestoreChip();
  }
  function enterPause(v, ssai) {
    vidVeilStart = Date.now();
    trace("up(pause) v=" + Math.round(v.getBoundingClientRect().width) + " generic=" + !(ssai || activeAdSource() && !activeAdSource().generic));
    var wasMuted = false; try { wasMuted = !!v.muted; v.muted = true; } catch (e) {}
    vidVeil = { cover: buildCover(false), video: v, wasMuted: wasMuted, artAt: Date.now(), box: veilBox(ssai, v), mode: "pause", pauseAfter: false, pauseAt: 0, reclaimAt: 0 };
    muteOthers(v); tabMuteStart();
    positionCover(false);
    updateCard();
  }
  // Trace: every raise and drop of the video veil, with the reason and the
  // veil's age, into the report diagnostics (dom.js data-prism-errors ring).
  function trace(msg) { try { if (PV.recordError) PV.recordError("veil " + msg + (vidVeilStart ? " @" + (Date.now() - vidVeilStart) + "ms" : "")); } catch (e) {} }
  function uncover(why) {
    pauseAfterPref = false;   // the "After the break" choice was for the break that just ended
    if (!vidVeil) return;
    trace("down(" + (why || "?") + ") mode=" + vidVeil.mode);
    if (PV.reclaimVideoEnd && vidVeil.reclaimAt) { PV.reclaimVideoEnd(vidVeil.reclaimAt); vidVeil.reclaimAt = 0; }
    restoreMute();
    var dying = vidVeil.cover;
    dying.style.transition = "opacity .5s ease";
    dying.style.opacity = "0";
    setTimeout(function () { if (dying && dying.parentNode) dying.remove(); }, 520);
    vidVeil = null;
  }

  /** Evaluate the ad/pause signal and cover / transition / uncover. Returns true while covered. */
  function videoAdBreak() {
    if (lastTriggerAt && Date.now() - lastTriggerAt > 100) { lastTrigger = ""; lastTriggerAt = 0; }
    // Dismissed by the human: keep the intermission off, show the restore chip
    // while the break lasts, and clear both when it ends.
    if (vidDismissed) {
      if (reVeilAt && Date.now() >= reVeilAt) { vidDismissed = false; reVeilAt = 0; hideRestoreChip(); trace("re-veil after timed reveal"); }
      else if (breakActiveNow()) { showRestoreChip(); return false; }
      else { vidDismissed = false; reVeilAt = 0; hideRestoreChip(); }
    }

    var v = PV.mainVideo();
    var now = Date.now();
    // Some players stop a stream without a "pause" event (SOOP live: the
    // element is reset, 2026-08-29): note the moment a playing element is
    // first SEEN paused, and whether the human's input preceded it.
    try {
      if (v) {
        if (v.paused && !v.__prismSeenPausedAt && (v.__prismPlayed || (lastPlayingAt && now - lastPlayingAt < 5000))) { v.__prismSeenPausedAt = now; v.__prismSeenPausedByUser = (now - lastInputAt) < 3000; }
        if (!v.paused) { v.__prismSeenPausedAt = 0; v.__prismSeenPausedByUser = false; }
      }
    } catch (eS) {}
    var ssai = ssaiActiveSource();
    var adRaw = adSignalOn(ssai);
    // Soft signal (see ssaiActiveSource) over CONTENT: allow it only until the
    // content has played SOFT_CONTENT_S seconds; then it is stale ad chrome.
    if (adRaw && ssai && ssai.__soft && v) {
      var isAd = false; try { isAd = !!(ssai.isAdClip && ssai.isAdClip(v)); } catch (eS) {}
      if (isAd) { softT0 = -1; }
      // The person paused the SHOW: the content clock above stops with it, so
      // a soft signal (YouTube's ad module, never emptied or filled while
      // paused) held an AD veil over a paused video for good - with "Veil the
      // screen while paused" off (Firefox, 2026-09-23). A soft signal is not
      // an ad over a deliberate pause; the pause veil's own pref decides.
      else if (pausedDeliberately(v)) { adRaw = false; vidLastAd = 0; }
      else {
        var ct = 0; try { ct = v.currentTime || 0; } catch (eT) {}
        if (softT0 < 0 || ct < softT0) softT0 = ct;
        if (ct - softT0 >= SOFT_CONTENT_S) { adRaw = false; vidLastAd = 0; }
      }
    } else softT0 = -1;
    if (adRaw) vidLastAd = now;
    // Every 10s while an ad veil is up: what is holding it (a stuck veil on
    // Hulu during content, 2026-08-29 - which signal, and the player state).
    if (vidVeil && vidVeil.mode === "ad" && now - holdTraceAt > 10000) {
      holdTraceAt = now;
      var hs = ""; try { hs = v ? " t=" + Math.round(v.currentTime) + " dur=" + Math.round(v.duration) + (v.paused ? " paused" : "") + " rs=" + v.readyState : " v=none"; } catch (eH) {}
      trace("hold adRaw=" + adRaw + " via=" + (ssai ? (ssai.__via || "?") : (document.documentElement.getAttribute("data-prism-ad") === "active" ? "sdk" : "none")) + (ssai && ssai.__soft ? " soft" : "") + hs);
    }

    // Debounce the END of an ad. Between two ads in a pod, and at the
    // ad->content handoff, the player drops its ad marker for a beat; hold the
    // ad veil for a short grace after the LAST ad sighting so it does not
    // flicker off. A real end uncovers within AD_END_GRACE_MS. (The grace keys
    // only off a VISIBLE ad marker - a hidden/stale ad bar never extends it.)
    var srcNow = activeAdSource(), graceMs = (srcNow && srcNow.endGraceMs) || AD_END_GRACE_MS;
    // A provisional (clip-swap) veil confirmed by a hard signal becomes a
    // normal ad veil; one whose window closed unconfirmed drops NOW - never
    // into the end-grace or the gap hold (8s over a short content video).
    if (vidVeil && vidVeil.mode === "ad" && vidVeil.early && adRaw && ssai && !ssai.__early) vidVeil.early = false;
    if (vidVeil && vidVeil.mode === "ad" && vidVeil.early && !adRaw) { uncover("early-unconfirmed"); return false; }
    var skipped = !!(skipAt && now - skipAt < 6000);
    // After a human skip, leftover ad chrome (a SOFT signal) is not an ad; only
    // a hard signal (class / SDK) means a new ad of the pod - normal rules again.
    if (skipped && adRaw && ssai && ssai.__soft) adRaw = false;
    if (adRaw) skipAt = 0;
    // "Pause after break" chosen and the element is now verifiably CONTENT
    // (a long clip, not an ad unit): pause at once, not after the end-grace
    // (YouTube: the show ran ~4 s before pausing, 2026-08-29). In a pod gap
    // the element is still an ad-length clip, so the grace applies there.
    // ... and the same test ends a plain ad veil at once when the element is
    // verifiably content (a long clip playing): the 4 s end-grace is for pod
    // gaps, where the element is still an ad-length clip (extra ~5 s over the
    // show reported, Firefox 2026-08-29).
    var pauseNow = false, contentNow = false;
    if (!adRaw && vidVeil && vidVeil.mode === "ad" && v) {
      try { var isAdNow = !!(srcNow && srcNow.isAdClip && srcNow.isAdClip(v)); contentNow = !isAdNow && isFinite(v.duration) && v.duration > 180 && !v.paused && v.readyState >= 3; } catch (eN) {}
      if (vidVeil.pauseAfter) pauseNow = contentNow;
    }
    var inGrace = !skipped && !pauseNow && !contentNow && !!(vidVeil && vidVeil.mode === "ad" && vidLastAd && (now - vidLastAd < graceMs) && !(resumedAt && now - resumedAt < RESUME_GRACE_MS));
    // Pod gap (YouTube, 2026-08-29 trace: down at 12.4s, up again at once):
    // the marker drops between ad 1 and ad 2 while the player LOADS - paused,
    // buffering, no duration. Nothing is playing, so nothing is being hidden
    // from the viewer: hold the veil until either the video actually plays
    // (content resumed -> normal grace -> uncover) or AD_GAP_HOLD_MS passes.
    if (!skipped && !pauseNow && !contentNow && !inGrace && vidVeil && vidVeil.mode === "ad" && vidLastAd && (now - vidLastAd < AD_GAP_HOLD_MS) && !(resumedAt && now - resumedAt < RESUME_GRACE_MS)) {
      var loading = false, adClip = false;
      try { loading = !!v && (v.paused || v.seeking || v.readyState < 3 || !isFinite(v.duration) || v.duration <= 0); } catch (eL) {}
      try { var gs = activeAdSource(); adClip = !!(gs && gs.isAdClip && v && gs.isAdClip(v)); } catch (eA) {}
      if (loading || adClip) inGrace = true;
    }
    if (!adRaw && !inGrace) vidBreakExpired = false;
    if (adRaw && vidVeil && vidVeil.mode === "ad" && vidVeilStart && (now - vidVeilStart) > MAX_VIDEO_BREAK_MS) vidBreakExpired = true;
    var adActive = (adRaw || inGrace) && !vidBreakExpired;

    // Just resumed from a pause ad and the show is playing again: drop the veil
    // and ignore a lingering pause-ad label for a moment (the SDK flag is exact
    // and is NOT ignored).
    // Just resumed from a pause ad: a lingering BADGE-only label must not raise
    // a new veil for a moment. It must never tear one down: on Twitch a real
    // break began right after Resume and this guard uncovered it every tick -
    // five flashes (Chrome trace, 2026-08-29). Hard signals (class / SDK) and
    // an existing veil are left alone.
    if (adActive && !vidVeil && resumedAt && now - resumedAt < RESUME_GRACE_MS && ssai && ssai.__via === "badge") {
      var playingNow = false; try { playingNow = v && !v.paused; } catch (e) {}
      var sdkOn = document.documentElement.getAttribute("data-prism-ad") === "active" && !authoritativeSsaiPresent();
      if (playingNow && !sdkOn) adActive = false;
    }

    // 1) An ad is on: cover it - opaque and muted - whatever element it plays in.
    if (adActive && v && v.getBoundingClientRect().width > 400) {
      enterAd(v, ssai);
      return true;
    }
    // 1b) The signal is on but the element is momentarily gone / collapsed
    // (YouTube re-lays the player out as the ad clip loads): keep the veil we
    // have rather than fade out and back in. Same for a veil younger than
    // AD_MIN_HOLD_MS - one missed evaluation must not strobe the ad through.
    if (vidVeil && vidVeil.mode === "ad" && (adActive || (vidVeilStart && now - vidVeilStart < AD_MIN_HOLD_MS))) {
      positionCover(false); updateCard();
      return true;
    }

    // 2) An ad just ended.
    if (vidVeil && vidVeil.mode === "ad") {
      if (PV.reclaimVideoEnd && vidVeil.reclaimAt) { PV.reclaimVideoEnd(vidVeil.reclaimAt); vidVeil.reclaimAt = 0; }
      if (vidVeil.pauseAfter) {
        // "Pause after break": pause the show ONCE and hold the intermission as
        // a Paused card. Content is playing now, so the transport is a real
        // play/pause. If the pause does not take, the pause branch below lifts
        // the veil and the show simply plays on.
        if (isLive(v)) {
          // A LIVE stream is not paused (you would only fall behind, and Twitch
          // stops the stream): HOLD the veil, stream running muted underneath,
          // and show how long it has been held. Resume lifts it (2026-08-29).
          vidVeil.mode = "hold"; vidVeil.pauseAfter = false; vidVeil.holdAt = now; vidVeil.byPrism = true;
          trace("mode ad->hold (live)");
          positionCover(false); updateCard();
          return true;
        }
        vidVeil.mode = "pause"; vidVeil.pauseAfter = false; vidVeil.pauseAt = now; vidVeil.byPrism = true;
        trace("mode ad->pause (pause after break)");
        clearHole(vidVeil.cover);
        pauseShow(v, vidVeil.box);
        positionCover(false); updateCard();
        return true;
      }
      var aiAfter = aiLabeled();
      if (aiAfter && aiWatchAnyway !== aiKey()) { enterAi(v, ssai, aiAfter); return true; }
      var vs = ""; try { vs = v ? " paused=" + v.paused + " rs=" + v.readyState + " dur=" + Math.round(v.duration) + " t=" + Math.round(v.currentTime) : " v=none"; } catch (eV) {}
      uncover("ad-ended adRaw=" + adRaw + " grace=" + inGrace + " expired=" + vidBreakExpired + vs);
    }

    // 2b) Held over a live stream after a break: stays until Resume (or a new
    // break, which branch 1 turns back into an ad veil).
    if (vidVeil && vidVeil.mode === "hold") { positionCover(false); updateCard(); return true; }
    // 3) Deliberately paused: hold the Paused intermission; lift when it plays.
    if (vidVeil && vidVeil.mode === "pause") {
      var settling = vidVeil.pauseAt && (now - vidVeil.pauseAt < PAUSE_SETTLE_MS);   // pause taking effect
      // A pause PRISM asked for ("Pause after break") counts for as long as the
      // element stays paused: Twitch hands over a fresh <video> after a break
      // that never fired play/pause, so pausedDeliberately() said no and the
      // veil lifted onto the paused show (fullscreen report, 2026-08-29).
      var byPrism = false; try { byPrism = !!(vidVeil.byPrism && v && v.paused && !v.ended); } catch (eP) {}
      // Prism paused the element it had (the ad's) but the show plays on in
      // ANOTHER <video> - a player that hands content to a second element
      // after the break: the veil read "Paused" with Resume while the show ran
      // 43 seconds under it (Paramount+, 2026-09-12). Within 8s of our pause,
      // no input from the human, at most three tries: pause the element that
      // plays and follow it. Past that the pause did not take - lift.
      if (byPrism) {
        var other = playingElsewhere(v);
        if (other) {
          if ((vidVeil.repauseN || 0) < 3 && now - vidVeil.pauseAt < 8000 && now - lastInputAt > 2000) {
            vidVeil.repauseN = (vidVeil.repauseN || 0) + 1;
            trace("pause follows the playing element (" + vidVeil.repauseN + ")");
            vidVeil.video = other; muteOthers(other);
            pauseShow(other, vidVeil.box);
            positionCover(false); updateCard(); return true;
          }
          uncover("pause-ended: show playing elsewhere"); return false;
        }
      }
      // Switched off while the veil is up: a pause Prism made itself holds;
      // the person's own pause drops back to a normal pause at once.
      if (!byPrism && !vidVeil.byPrism && !pauseVeilPref()) { uncover("pause-ended: pref off"); return false; }
      if (pausedDeliberately(v) || settling || byPrism) { positionCover(false); updateCard(); return true; }
      uncover("pause-ended");
      return false;
    }
    // 3b) AI-labelled video (opt-in): a full intermission while it plays.
    var ai = aiLabeled();
    if (ai && v && v.getBoundingClientRect().width > 400 && aiWatchAnyway !== aiKey()) {
      enterAi(v, ssai, ai);
      return true;
    }
    if (vidVeil && vidVeil.mode === "ai") { uncover("ai-ended"); return false; }
    if (pauseVeilAllowed() && pausedDeliberately(v)) {
      enterPause(v, ssai);
      return true;
    }
    if (v && v.paused && !v.ended && now - pauseWhyAt > 3000 && v.getBoundingClientRect().width > 400) {
      pauseWhyAt = now;
      var why = [];
      try {
        if (!pauseVeilPref()) why.push("pref-off");
        if (!pauseVeilAllowed()) why.push("not-allowed(src=" + (activeAdSource() ? activeAdSource().source : "none") + " generic=" + genericPlayer(v) + ")");
        var live = isLive(v), played = v.__prismPlayed || (live && lastPlayingAt && now - lastPlayingAt < 300000), pausedAt = v.__prismPausedAt || (live && !v.__prismPlayed && lastPauseAt) || 0;
        if (!played) why.push("never-played"); if (!pausedAt) why.push("no-pause-event");
        var byUser = v.__prismPausedAt ? !!v.__prismPausedByUser : lastPauseByUser; if (!byUser) why.push("no-input-before-pause(" + Math.round(now - lastInputAt) + "ms ago)");
        if (!live && v.seeking) why.push("seeking"); if (pausedAt && now - pausedAt <= 600) why.push("settling");
      } catch (eW) { why.push("err " + eW); }
      if (why.length) trace("pause-veil not raised: " + why.join(" "));
    }

    // 4) Nothing to show.
    if (vidVeil) uncover("nothing adRaw=" + adRaw + " grace=" + inGrace);
    return false;
  }

  /** Per-frame glue: keep the cover on the player, refresh the card, crossfade on long breaks. */
  // Watchdog (2026-08-29, YouTube: a ~1s flash of the ad with NO veil drop in
  // the trace): once the veil is older than 500ms, verify every frame that the
  // cover is connected, opaque, unclipped, player-sized and the topmost thing
  // at its own centre; log what is there instead (rate-limited).
  var wdLastAt = 0;
  function watchdog() {
    if (!vidVeil || !vidVeilStart) return;
    var now = Date.now(); if (now - wdLastAt < 150) return;
    var c = vidVeil.cover, why = [];
    try {
      if (!c.isConnected) why.push("detached");
      var cs = getComputedStyle(c);
      if (parseFloat(cs.opacity) < 0.95) why.push("opacity=" + cs.opacity);
      if (cs.display === "none" || cs.visibility === "hidden") why.push("display=" + cs.display + "/" + cs.visibility);
      var r = c.getBoundingClientRect(), b = coverRect(vidVeil.box, vidVeil.video);
      if (Math.abs(r.width - b.width) > 4 || Math.abs(r.height - b.height) > 4 || Math.abs(r.left - b.left) > 4 || Math.abs(r.top - b.top) > 4)
        why.push("rect=" + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height) + " want " + Math.round(b.left) + "," + Math.round(b.top) + " " + Math.round(b.width) + "x" + Math.round(b.height));
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (r.width > 0 && cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
        var top = document.elementFromPoint(cx, cy);
        if (top && top !== c && !c.contains(top) && !(top.hasAttribute && (top.hasAttribute("data-prism-ui") || top.hasAttribute("data-prism-veil"))) && top !== document.documentElement && top !== document.body) why.push("over=" + top.tagName + "#" + (top.id || "") + "." + PV.classStr(top).slice(0, 50) + " z=" + getComputedStyle(top).zIndex);
      }
      var vv = vidVeil.video; if (vv) why.push("|v paused=" + vv.paused + " rs=" + vv.readyState + " dur=" + Math.round(vv.duration) + " t=" + Math.round(vv.currentTime));
    } catch (e) { why.push("err " + e); }
    if (why.length > 1 || (why.length === 1 && why[0].charAt(0) !== "|")) { wdLastAt = now; trace("watchdog " + why.join(" ")); }
  }
  var tickTraceAt = 0;
  function videoTick() {
    // HOLD the ad-veil mute, don't set it once: YouTube re-asserts its own
    // volume after player init (audible ad entering a watch page mid-ad) and
    // on the stream swap between pod ads (next ad audible under the veil) -
    // both reported 2026-08-31. While an ad/AI veil is up, muted IS the
    // configured state; re-assert whenever the player flips it back.
    if (vidVeil && (vidVeil.mode === "ad" || vidVeil.mode === "ai") && vidVeil.video && !vidVeil.video.muted) {
      if (!tabMuted) { try { vidVeil.video.muted = true; if (!vidVeil.__remuted) { vidVeil.__remuted = true; trace("re-mute: player unmuted under the veil"); } } catch (e) {} }
    }
    if (!vidVeil) return;
    positionCover(false);
    updateCard();
    // Heartbeat: proves the per-frame loop runs where the veil is (an embed
    // frame's HUD froze at its first value, Firefox 2026-08-29) and what the
    // HUD is being told.
    if (Date.now() - tickTraceAt > 5000) { tickTraceAt = Date.now(); try { var vv = vidVeil.video; trace("tick mode=" + vidVeil.mode + " hud=" + (vidVeil.cover.__time ? vidVeil.cover.__time.textContent : "-") + " t=" + (vv ? vv.currentTime.toFixed(1) : "?") + (vv && vv.paused ? " paused" : "") + " top=" + (window === window.top)); } catch (eT) {} }
    maybeCrossfadeArt();
    watchdog();
  }

  PV.SSAI_AD_SOURCES = SSAI_AD_SOURCES;
  PV.hasAdBadge = hasAdBadge;
  PV.parseClock = parseClock;
  PV.adInfoLine = adInfoLine;
  PV.videoAdBreak = videoAdBreak;
  PV.__rowContainer = rowContainer; PV.__adSourceNow = ssaiActiveSource;   // tests: player families
  PV.__buildCover = buildCover;   // tests: the cover must construct (0.7.47 shipped one that threw)

  // Event-driven detection (2026-08-29, YouTube: a ~300ms flash of the ad's
  // first frames BEFORE the veil - the poll is 350ms and nothing woke it).
  // The registry container's class flip (ad-showing, fave-ad...) and the
  // <video>'s source swap (durationchange / loadstart / emptied) each trigger
  // an immediate evaluation. Observed containers are re-attached as the SPA
  // swaps players.
  var evT = 0, lastTrigger = "", lastTriggerAt = 0;
  function evalNow(why) {
    lastTrigger = why || ""; lastTriggerAt = Date.now(); if (evT) return; evT = requestAnimationFrame(function () { evT = 0; try { if (!PV.suppressed || !PV.suppressed()) videoAdBreak(); } catch (e) {} }); }
  var contObs = new MutationObserver(function () { evalNow("class"); }), observed = null;
  function attachContainer() {
    var cont = null;
    for (var i = 0; i < SSAI_AD_SOURCES.length && !cont; i++) { var s = SSAI_AD_SOURCES[i]; if (!s.generic && srcHere(s)) cont = document.querySelector(s.container); }   // listed rows only: the generic row derives from THIS
    if (cont === observed) return;
    try { contObs.disconnect(); } catch (e) {}
    observed = cont;
    if (cont) { try { contObs.observe(cont, { attributes: true, attributeFilter: ["class"] }); } catch (e) {} }
  }
  ["durationchange", "loadedmetadata", "loadstart", "emptied", "playing"].forEach(function (t) {
    addEventListener(t, function (e) { if (e.target && e.target.tagName === "VIDEO") { if (t === "durationchange" || t === "loadedmetadata") noteClipSwap(e.target); evalNow(t); } }, true);
  });
  setInterval(attachContainer, 1000);
  attachContainer();
  PV.videoTick = videoTick;
  PV.uncoverVideo = function () {
    pauseAfterPref = false;
    if (!vidVeil) return;
    trace("removed(dismiss) mode=" + vidVeil.mode);
    var d = vidVeil; vidVeil = null;
    if (PV.reclaimVideoEnd && d.reclaimAt) { try { PV.reclaimVideoEnd(d.reclaimAt); } catch (e) {} }
    showVideos();
    try { d.video.muted = d.wasMuted; } catch (e) {}
    document.querySelectorAll("video,audio").forEach(function (o) { if (o.__prismWas !== undefined) { try { o.muted = o.__prismWas; } catch (e) {} delete o.__prismWas; } });
    tabMuteEnd();
    try { d.cover.remove(); } catch (e) {}
  };
  PV.vidVeil = function () { return vidVeil; };
})();
