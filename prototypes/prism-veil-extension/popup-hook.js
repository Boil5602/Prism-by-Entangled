/*
  PRISM - popup interception (spec section 30), MAIN world, document_start.

  A popup is code, so it is intercepted UNEXECUTED: window.open returns a stub
  WindowProxy (focus(), closed, ...) so the launching page's scripts carry on
  without "disable your popup blocker" nagging - and no window exists, no
  navigation occurs, no impression is fabricated.

  Policy is prism-core's (src/core-popups.js, bundled from
  packages/core/src/popups.ts) evaluated here synchronously against a
  snapshot the isolated-world UI pushes in (its store is the authority). This
  file decides nothing itself: it observes the human's last click (for the
  click-consistency rule), counts windows per gesture (burst rule), asks
  core, and reports every interception to the UI over a DOM event.
*/
(function () {
  "use strict";
  if (window.__prismPopupHook) return;
  window.__prismPopupHook = true;
  var core = window.PrismPopups;
  if (!core) return;

  var policy = new core.PopupPolicy(null);
  var site = location.hostname;

  // ---- the human's last gesture: which URL did they visibly activate?
  var gesture = { url: "", at: 0, windows: 0 };
  // What the pressed link shows (2026-11-23): the text of the link a person can see, so a link card that shows the site it leads to
  // opens that site. Core reads it only to find the destination's name. The page writes this text, so it is kept to what the person
  // could read for themselves: a real link (a[href] or role=link), text pieces alone and never an attribute, each piece taken only
  // when it is drawn (not hidden, not clear, not too small to read), and a bound on the whole.
  var NAMES_MAX = 600, PIECES_MAX = 40;
  function seenText(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
      if (cs.opacity !== "" && parseFloat(cs.opacity) < 0.5) return false;
      var fs = parseFloat(cs.fontSize);
      if (fs === fs && fs < 8) return false;
      if (/rgba\([^)]*,\s*0(\.0+)?\s*\)|^transparent$/.test(cs.color || "")) return false;
      return true;
    } catch (x) { return false; }
  }
  function namesOf(t) {
    var out = "";
    try {
      var link = t && t.closest ? t.closest("a[href], [role=link]") : null;
      if (!link) return "";
      // each piece of text by itself: two pieces side by side read as one word otherwise, and a name at the end of one is lost
      var tw = document.createTreeWalker(link, 4, null), tn, seen = 0;
      while ((tn = tw.nextNode()) && seen++ < PIECES_MAX && out.length < NAMES_MAX) {
        if (!seenText(tn.parentElement)) continue;
        var v = String(tn.nodeValue || "").slice(0, 200);
        out += " " + v;
        // an address the page wrapped onto two lines inside one piece of text (Facebook's phone layout breaks it after a dot,
        // B-539 again 2026-11-23): read it once more with the line breaks and the unseen break marks taken out
        var joined = v.replace(/[\r\n\u200B\u00AD]+/g, "");
        if (joined !== v) out += " " + joined;
      }
    } catch (x) {}
    return out.replace(/\s+/g, " ").slice(0, NAMES_MAX);
  }
  function noteGesture(e) {
    var t = e.target, href = "";
    try {
      var a = t && t.closest ? t.closest("a[href]") : null;
      if (a) href = a.href;
    } catch (x) {}
    // was the press on a thing a person presses to go somewhere (a link, a button, a thing drawn with the hand pointer)? A press on
    // plain text, a text box or the page's ground is not, and a page that leaves its site on one has taken the press (below)
    var plain = false;
    try {
      plain = !(t && t.closest && t.closest("a[href], button, summary, [role=button], [role=link], [role=menuitem], [role=tab], [onclick], input[type=submit], input[type=button], input[type=image], input[type=reset]"));
      if (plain && t && t.nodeType === 1 && getComputedStyle(t).cursor === "pointer") plain = false;
    } catch (x) { plain = false; }
    gesture = { url: href, names: namesOf(t), at: Date.now(), windows: 0, plain: plain };
  }
  ["pointerdown", "mousedown", "keydown", "touchstart"].forEach(function (ev) {
    addEventListener(ev, noteGesture, true);
  });
  function currentGesture() {
    // a gesture is "current" for a second; after that an open has no click behind it. On a page that is busy (still loading) the
    // site's own handler can run later than that, and a new tab the person asked for was blocked (B-494, 2026-11-18): the press
    // also counts while the browser itself still holds it as active, which it does for about five seconds.
    var age = Date.now() - gesture.at, held = false;
    try { held = !!(navigator.userActivation && navigator.userActivation.isActive); } catch (x) {}
    if (age > 1000 && !(held && age <= 5500)) return null;
    gesture.windows += 1;
    return { url: gesture.url, names: gesture.names, windowsThisGesture: gesture.windows };
  }

  // (Input isolation for the PRISM button lives in src/popups-guard.js - the
  // isolated world owns the closed shadow root, so only it can route an event
  // to the element inside; from here composedPath() ends at the host.)

  // ---- policy snapshot from the isolated world (the store of record)
  document.addEventListener("prism-popup-policy", function (e) {
    try { if (e.detail && e.detail.state) policy.replace(JSON.parse(e.detail.state)); } catch (x) {}
    try { if (e.detail && e.detail.stoppedHere) stoppedHere = true; } catch (x) {}
  });
  // ask for the current snapshot (the UI may already be up)
  try { document.dispatchEvent(new CustomEvent("prism-popup-ready")); } catch (x) {}

  // ---- the stub WindowProxy: enough surface for launcher error handling
  function stubWindow(url) {
    var stub = {
      closed: false, name: "", opener: window, location: { href: url || "about:blank", assign: function () {}, replace: function () {} },
      document: { write: function () {}, writeln: function () {}, close: function () {}, body: null, title: "" },
      focus: function () {}, blur: function () {}, close: function () { stub.closed = true; },
      postMessage: function () {}, addEventListener: function () {}, removeEventListener: function () {},
      moveTo: function () {}, resizeTo: function () {}, alert: function () {}, print: function () {},
    };
    return stub;
  }

  function report(attempt, decision) {
    try { document.dispatchEvent(new CustomEvent("prism-popup", { detail: { attempt: attempt, decision: decision } })); } catch (x) {}
  }

  function resolveUrl(u) {
    if (!u) return "";
    try { return new URL(String(u), location.href).href; } catch (x) { return String(u); }
  }
  /** Decide one open() for this page (whichever frame's open() it is). */
  function decide(url) {
    var abs = resolveUrl(url);
    var g = currentGesture();
    var attempt = { site: site, url: abs };
    if (g) attempt.gesture = g;
    var decision;
    try { decision = policy.evaluate(attempt); } catch (x) { decision = { action: "intercept", reason: "policy error" }; }
    return { attempt: attempt, decision: decision, abs: abs };
  }
  // ---- the tab itself sent to another site (2026-11-25, aether.bar: a press anywhere on the page asked for a window and, with
  // or without it, sent the tab to an advertiser's address). A page's script cannot be kept from setting the address, but the
  // browser says so before it goes (the Navigation API's navigate event, where a browser has it) and the going can be refused.
  // Refused only when all of these hold: a script did it (not the person's own press on a link, not Back, not a reload, not a
  // form being sent); it leaves this site; core's policy would stop a window to the same address (so a destination allowed by
  // the person, a sign-in, a payment page, the link that was pressed and a link that names the site all go); and there is a sign
  // of the trick. The signs: the host is on a named list; a window was asked for within the last 3 s; a window or a redirect to
  // the same host was stopped on this page; another redirect was stopped within the last 5 s; the press before it was on no link
  // and no button (measured on aether.bar: a press on the heading, 555 ms, the tab sent away, and no window asked for); or the
  // press was on a button and PRISM has stopped a pop on this page in this visit (popups-ui.js says so). A redirect with no
  // press before it and none of the other signs goes as it always did (a page that moves to its new address, a sign-in that
  // sends the person on). A browser without the event: nothing is done.
  var lastOpenAt = 0, lastStopAt = 0, stoppedHosts = {}, stoppedHere = false;
  function hostOf(u) { try { return new URL(u, location.href).hostname; } catch (x) { return ""; } }
  try {
    if (window.navigation && typeof navigation.addEventListener === "function") navigation.addEventListener("navigate", function (e) {
      try {
        if (!e.cancelable || e.userInitiated || e.hashChange || e.downloadRequest != null || e.formData) return;
        if (e.navigationType === "traverse" || e.navigationType === "reload") return;
        var url = (e.destination && e.destination.url) || "";
        if (!/^https?:/i.test(url)) return;
        var h = hostOf(url);
        if (!h || h === location.hostname) return;
        var attempt = { site: site, url: url, redirect: true };
        var age = Date.now() - gesture.at, held = false;
        try { held = !!(navigator.userActivation && navigator.userActivation.isActive); } catch (x) {}
        // the press, as an open() would see it, but a redirect is not a window and is not counted as one
        var pressed = age <= 1000 || (held && age <= 5500);
        if (pressed) attempt.gesture = { url: gesture.url, names: gesture.names, windowsThisGesture: 1 };
        var decision = policy.evaluate(attempt);
        if (decision.action !== "intercept") return;
        var now = Date.now();
        var sign = decision.list ? "on a named list" : (now - lastOpenAt < 3000) ? "a window was asked for with it" : stoppedHosts[h] ? "it was stopped here before"
          : (now - lastStopAt < 5000) ? "another was stopped just before" : (pressed && gesture.plain) ? "your press was not on a link or a button"
          : (pressed && stoppedHere) ? "pops were stopped on this page" : "";
        if (!sign) return;
        e.preventDefault();
        stoppedHosts[h] = 1; lastStopAt = now;
        report(attempt, { action: "intercept", reason: "this tab was being sent there (" + sign + ")", list: decision.list });
      } catch (x) {}
    });
  } catch (x) {}

  /** Replace `win.open` with the policy-checked version (top window, or a same-origin frame's). */
  function wrapOpen(win) {
    var native = win.open;
    var wrapped = function (url, name, features) {
      var d = decide(url);
      lastOpenAt = Date.now();
      if (d.decision.action === "allow") return native.call(win, url, name, features);
      try { var sh = hostOf(d.abs); if (sh) stoppedHosts[sh] = 1; } catch (x) {}
      report(d.attempt, d.decision);
      return stubWindow(d.abs);
    };
    try { Object.defineProperty(wrapped, "toString", { value: function () { return "function open() { [native code] }"; } }); } catch (x) {}
    win.open = wrapped;
  }
  wrapOpen(window);

  // Popunder scripts (measured on aether.ist: createElement("iframe") ->
  // iframe.contentWindow.open(url) -> frame removed) call a FRAME's open(),
  // a different function from the page's. Wrap it the moment the frame's
  // window is handed out. Same-origin (about:blank) frames only; a
  // cross-origin frame throws here and is left to the tab backstop (bg.js).
  try {
    var cwDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    if (cwDesc && cwDesc.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        configurable: true, enumerable: cwDesc.enumerable,
        get: function () {
          var w = cwDesc.get.call(this);
          try { if (w && !w.__prismPopupHook) { w.__prismPopupHook = true; wrapOpen(w); } } catch (x) { /* cross-origin: backstop */ }
          return w;
        },
      });
    }
  } catch (x) {}
})();
