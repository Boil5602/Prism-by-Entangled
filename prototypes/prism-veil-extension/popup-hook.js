/*
  Prism - popup interception (spec section 30), MAIN world, document_start.

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
  function noteGesture(e) {
    var t = e.target, href = "";
    try {
      var a = t && t.closest ? t.closest("a[href]") : null;
      if (a) href = a.href;
    } catch (x) {}
    gesture = { url: href, at: Date.now(), windows: 0 };
  }
  ["pointerdown", "mousedown", "keydown", "touchstart"].forEach(function (ev) {
    addEventListener(ev, noteGesture, true);
  });
  function currentGesture() {
    // a gesture is "current" for a second; after that an open has no click behind it
    if (Date.now() - gesture.at > 1000) return null;
    gesture.windows += 1;
    return { url: gesture.url, windowsThisGesture: gesture.windows };
  }

  // (Input isolation for the Prism button lives in src/popups-guard.js - the
  // isolated world owns the closed shadow root, so only it can route an event
  // to the element inside; from here composedPath() ends at the host.)

  // ---- policy snapshot from the isolated world (the store of record)
  document.addEventListener("prism-popup-policy", function (e) {
    try { if (e.detail && e.detail.state) policy.replace(JSON.parse(e.detail.state)); } catch (x) {}
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
  /** Replace `win.open` with the policy-checked version (top window, or a same-origin frame's). */
  function wrapOpen(win) {
    var native = win.open;
    var wrapped = function (url, name, features) {
      var d = decide(url);
      if (d.decision.action === "allow") return native.call(win, url, name, features);
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
