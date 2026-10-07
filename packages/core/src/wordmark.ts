/**
 * The animated wordmark, "disperse and refocus" (docs/features/animated-wordmark.md, 2026-10-04).
 *
 * The word PRISM as stacked coloured copies under a screen blend: at rest they add up to white; on play the copies slide
 * apart along the dispersion angle in band order, hold a beat, and slide back. One component for every surface that is a
 * web page (the phone's page today): this module emits its markup, its CSS and a small script with the two-second guard.
 * The colours are PRISM_BANDS (the charter's four brand bands, in the charter's order - never reordered here) and, because
 * none of them is a full red, green or blue channel, a white copy at k = 0 that never moves makes the rest state white.
 * The copies spread with k = -1.5, -0.5, 0.5, 1.5 for four bands (the spec's six would be -2.5 .. 2.5): symmetric about the
 * white copy, one step apart. No hex value is written here but the bands'.
 *
 * Reduced motion: the CSS honours prefers-reduced-motion (the mark stays white and still). The PC's own full-motion rule
 * (MainWindow.Rail.cs) is about the visualizations and does not reach this page.
 */
import { PRISM_BANDS } from "./visualization.js";

/** The dispersion angle: y per x of a copy's offset. One constant. */
export const WORDMARK_ANGLE = -0.55;
/** The run: 1.5 s, easing and the four stops of d (0 → 9 → 9 → 0; 9 px at 88 px, em-scaled). */
export const WORDMARK_RUN = { ms: 1500, easing: "cubic-bezier(.3,0,.2,1)", peak: 9, atPx: 88, stops: [[0, 0], [38, 9], [52, 9], [100, 0]] as ReadonlyArray<readonly [number, number]> };
/** No second run within this many ms of the last. */
export const WORDMARK_GUARD_MS = 2000;
export const WORDMARK_WORD = "PRISM";

/** Offset factors for n bands: symmetric about 0, one apart, never 0 (0 is the white copy's). */
export function wordmarkFactors(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i - (n - 1) / 2);
  return out.map((k) => (k === 0 ? 0.5 : k));
}

/** Whether a band list reaches pure white on its own under screen: a full red, a full green and a full blue channel among the entries. */
export function bandsReachWhite(bands: readonly string[]): boolean {
  const ch = (hex: string, i: number) => parseInt(hex.replace("#", "").slice(i * 2, i * 2 + 2), 16);
  return [0, 1, 2].every((i) => bands.some((b) => /^#[0-9a-fA-F]{6}$/.test(b) && ch(b, i) === 255));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export interface WordmarkOptions {
  /** The word (PRISM). */
  word?: string;
  /** The accessible label. */
  label?: string;
  /** The font size as CSS (e.g. "22px", "2rem"); the spread scales with it. */
  size?: string;
  /** Extra class names on the wrapper. */
  className?: string;
  /** Play once on mount, after the first frame has painted (the page's script does the playing). */
  autoplay?: boolean;
  /** The bands; PRISM_BANDS unless a test passes its own. */
  bands?: readonly string[];
}

/** The markup: one wrapper per letter, inside it one copy per band in band order plus the white copy when the bands need it. */
export function wordmarkHtml(o: WordmarkOptions = {}): string {
  const word = o.word ?? WORDMARK_WORD;
  const bands = o.bands ?? PRISM_BANDS;
  const ks = wordmarkFactors(bands.length);
  const white = !bandsReachWhite(bands);
  const letters = Array.from(word).map((ch) => {
    const copies = bands.map((b, i) => `<span class="pw-c" aria-hidden="true" style="color:${esc(b)};--k:${ks[i]}">${esc(ch)}</span>`);
    if (white) copies.push(`<span class="pw-c pw-w" aria-hidden="true" style="--k:0">${esc(ch)}</span>`);
    return `<span class="pw-l">${esc(ch)}${copies.join("")}</span>`;
  });
  const cls = ["pw", o.autoplay ? "pw-auto" : "", o.className ?? ""].filter(Boolean).join(" ");
  const style = o.size ? ` style="font-size:${esc(o.size)}"` : "";
  return `<span class="${cls}" role="img" aria-label="${esc(o.label ?? "Prism")}" tabindex="0"${style}>${letters.join("")}</span>`;
}

/** The CSS: the registered custom property, the stack, the run, the reduced-motion rule. The font is the page's display face. */
export function wordmarkCss(): string {
  const r = WORDMARK_RUN;
  const stops = r.stops.map(([pct, d]) => `${pct}%{--d:${d}}`).join("");
  // d is in the spec's pixels at 88 px: 1em / 88 is one of those pixels at any font size
  const u = `1em / ${r.atPx}`;
  return [
    `@property --d{syntax:'<number>';inherits:true;initial-value:0}`,
    `.pw{display:inline-block;position:relative;font-weight:700;line-height:1;letter-spacing:.16em;color:transparent;white-space:nowrap;--d:0;cursor:default;user-select:none;-webkit-user-select:none;outline:none}`,
    `.pw-l{position:relative;display:inline-block}`,
    `.pw-l>.pw-c{position:absolute;left:0;top:0;mix-blend-mode:screen;pointer-events:none;transform:translate(calc(var(--d) * var(--k) * ${u}),calc(var(--d) * var(--k) * ${WORDMARK_ANGLE} * ${u}))}`,
    `.pw-w{color:white}`,
    `.pw.pw-play{animation:pw-run ${r.ms}ms ${r.easing} 1}`,
    `@keyframes pw-run{${stops}}`,
    `@media (prefers-reduced-motion: reduce){.pw.pw-play{animation:none}}`,
  ].join("\n");
}

/**
 * The script: window.PrismWordmark.play(el) runs the mark once (false when within the guard, when the page prefers reduced
 * motion, or when the browser has no registered custom properties - then the mark is static white); wire(el) adds hover,
 * tap and Enter/Space; marks with pw-auto play once after the first paint.
 */
export function wordmarkScript(): string {
  return `(function(){var last=0;
function can(){return typeof CSS!=='undefined'&&'registerProperty' in CSS&&!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);}
function play(el){if(!el||!can())return false;var now=Date.now();if(now-last<${WORDMARK_GUARD_MS})return false;last=now;el.classList.remove('pw-play');void el.offsetWidth;el.classList.add('pw-play');setTimeout(function(){el.classList.remove('pw-play');},${WORDMARK_RUN.ms + 100});return true;}
function wire(el){if(!el||el.__pw)return;el.__pw=true;el.addEventListener('pointerenter',function(){play(el);});el.addEventListener('click',function(){play(el);});el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();play(el);}});}
function mount(){var all=document.querySelectorAll('.pw');for(var i=0;i<all.length;i++){wire(all[i]);}var auto=document.querySelector('.pw-auto');if(auto){requestAnimationFrame(function(){requestAnimationFrame(function(){play(auto);});});}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
window.PrismWordmark={play:play,wire:wire,guardMs:${WORDMARK_GUARD_MS},runMs:${WORDMARK_RUN.ms}};})();`;
}

/** The whole snippet a page inlines: style, markup, script. */
export function wordmarkSnippet(o: WordmarkOptions = {}): string {
  return `<style>${wordmarkCss()}</style>${wordmarkHtml(o)}<script>${wordmarkScript()}</script>`;
}
