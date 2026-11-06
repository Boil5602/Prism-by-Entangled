/*
  Fixture harness for the Veil's DETECTION rules (src/rules.js) under
  happy-dom. Loads the modules the way the browser does (classic scripts
  sharing one namespace), then lets a test mount an HTML fixture and ask
  collectTargets() what it would cover.

  Layout is faked deliberately and explicitly: happy-dom has no layout, so
  any element that matters carries data-rect="x,y,w,h". Elements without it
  measure 0x0 (and are therefore never "visible" to the rules) - exactly the
  discipline the rules rely on: nothing is an ad unless it has a real box.
*/
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, "..", "src", f), "utf8");

export function loadVeil({ host = "example.com", width = 1881, height = 859 } = {}) {
  // fresh namespace per load
  window.__prismVeilNS = undefined;
  window.__prismVeil = undefined;
  window.chrome = { runtime: { getURL: (p) => "chrome-extension://test/" + p, getManifest: () => ({ version: "test" }) } };
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
  setHost(host);

  // Faked layout from data-rect, inherited by nothing: explicit only.
  Element.prototype.getBoundingClientRect = function () {
    const a = this.getAttribute && this.getAttribute("data-rect");
    if (!a) return { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    const [x, y, w, h] = a.split(",").map(Number);
    return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h };
  };
  // A text node's Range measures like its parent element (labels).
  if (typeof Range !== "undefined") {
    Range.prototype.getBoundingClientRect = function () {
      const n = this.startContainer;
      const el = n.nodeType === 3 ? n.parentElement : n;
      return el ? el.getBoundingClientRect() : { width: 0, height: 0, top: 0, left: 0 };
    };
  }
  for (const f of ["art.js", "dom.js", "rules.js", "video.js"]) (0, eval)(src(f));
  return window.__prismVeilNS;
}

export function setHost(host) {
  try { window.happyDOM.setURL("https://" + host + "/"); } catch (e) { /* older happy-dom */ }
}

/** Mount fixture HTML and return what the rules would cover, as [{tag,id,why}]. */
export function detect(PV, html) {
  document.body.innerHTML = html;
  const { targets, why } = PV.collectTargets();
  return Array.from(targets).map((t) => ({ tag: t.tagName.toLowerCase(), id: t.id || "", why: why.get(t) || "" }));
}
