/*
  Prism - input guard for the Prism button (spec section 30). Isolated world,
  document_start, so its window-capture listeners are registered BEFORE any
  page script's - a popunder's document-level mousedown catcher included.

  Any pointer/mouse/click/key event whose path crosses the button's host is
  stopped dead here, then handed to the real element inside the (closed)
  shadow root via ShadowRoot.elementFromPoint - which only this world, the
  root's owner, can do. Native defaults still run (a checkbox still toggles),
  and no page listener ever sees the event. Form controls are stop-only: a
  synthetic click on them would activate a second time.

  Also the dev reload hook: a page on 127.0.0.1 / localhost may dispatch
  "prism-dev-reload" to have the extension reload itself (nothing else can).
*/
(function () {
  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});
  var UI_TAG = "PRISM-POPUP-BUTTON";

  ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "auxclick", "dblclick", "touchstart", "touchend", "keydown", "keyup", "keypress"].forEach(function (type) {
    addEventListener(type, function (e) {
      if (e.__prismInner) return;
      if (e.key === "Escape") return;   // Escape always reaches the UI's own closers
      var path = e.composedPath ? e.composedPath() : [];
      var direct = false;
      for (var i = 0; i < path.length; i++) { if (path[i] && path[i].tagName === UI_TAG) { direct = true; break; } }
      // Not in the path? The site may have painted an invisible layer over the
      // button. Claim by coordinates instead (the UI knows its own boxes).
      var ours = direct;
      if (!ours) { try { ours = !!(PV.uiHit && PV.uiHit(e)); } catch (x) {} }
      if (!ours) return;
      e.stopImmediatePropagation();
      var inner = null;
      try { inner = PV.uiPick ? PV.uiPick(e) : null; } catch (x) {}
      if (!inner) return;
      // A form control that REALLY received the event keeps its native
      // activation (the checkbox already toggled) - a synthetic click would
      // toggle it back. Claimed-by-coordinates events never reached it, so
      // those are re-dispatched (a synthetic click toggles exactly once).
      try { if (direct && inner.closest && inner.closest("input,label,select,textarea")) return; } catch (x) {}
      // Rebuild the event from THIS realm's constructors with an explicit field
      // list. Firefox hands content scripts Xray-wrapped events: e.constructor
      // and a for-in copy do not survive the wrapper there, so the pill never
      // got its click and the panel could not be closed (2026-08-29).
      try {
        var init = { bubbles: true, cancelable: true, composed: false, view: window,
          clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
          button: e.button, buttons: e.buttons, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, detail: e.detail };
        var re;
        if (/^key/.test(type)) re = new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: false, key: e.key, code: e.code, keyCode: e.keyCode, which: e.which, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, repeat: e.repeat });
        else if (/^pointer/.test(type) && typeof PointerEvent === "function") { init.pointerId = e.pointerId; init.pointerType = e.pointerType; init.isPrimary = e.isPrimary; re = new PointerEvent(type, init); }
        else if (/^touch/.test(type)) return;   // touch: the pointer/mouse events that follow carry the intent
        else re = new MouseEvent(type, init);
        re.__prismInner = true;
        inner.dispatchEvent(re);
      } catch (x) {
        // last resort: a plain click still toggles the pill / presses a button
        try { if (type === "click") { var re2 = new MouseEvent("click", { bubbles: true, cancelable: true, composed: false }); re2.__prismInner = true; inner.dispatchEvent(re2); } } catch (y) {}
      }
    }, true);
  });

  // dev: self-reload on request from a local page
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
    document.addEventListener("prism-dev-reload", function () {
      try { chrome.runtime.sendMessage({ type: "prism-dev-reload" }); } catch (e) {}
    });
  }
})();
