import { describe, expect, it } from "vitest";
import { PRISM_BANDS } from "../src/visualization.js";
import { WORDMARK_ANGLE, WORDMARK_GUARD_MS, WORDMARK_RUN, bandsReachWhite, wordmarkCss, wordmarkFactors, wordmarkHtml, wordmarkScript, wordmarkSnippet } from "../src/wordmark.js";

describe("animated wordmark (docs/features/animated-wordmark.md)", () => {
  it("colours come from PRISM_BANDS, in the charter's order, one copy per band per letter", () => {
    const html = wordmarkHtml();
    const colours = [...html.matchAll(/color:(#[0-9A-Fa-f]{6})/g)].map((m) => m[1]);
    expect(colours.slice(0, PRISM_BANDS.length)).toEqual([...PRISM_BANDS]);
    expect(colours.length).toBe(PRISM_BANDS.length * "PRISM".length);
    // no hex but the bands'
    for (const c of colours) expect(PRISM_BANDS).toContain(c);
  });

  it("changing a band changes the copy", () => {
    const bands = [...PRISM_BANDS]; bands[1] = "#123456";
    expect(wordmarkHtml({ bands })).toContain("color:#123456");
    expect(wordmarkHtml()).not.toContain("color:#123456");
  });

  it("the bands do not reach white on their own, so a white copy at k=0 is added and never moves", () => {
    expect(bandsReachWhite(PRISM_BANDS)).toBe(false);
    expect(bandsReachWhite(["#FF0000", "#00FF00", "#0000FF"])).toBe(true);
    const html = wordmarkHtml();
    expect((html.match(/pw-w/g) ?? []).length).toBe("PRISM".length);
    expect(html).toContain('class="pw-c pw-w" aria-hidden="true" style="--k:0"');
    expect(wordmarkHtml({ bands: ["#FF0000", "#00FF00", "#0000FF"] })).not.toContain("pw-w");
  });

  it("offset factors are symmetric about the white copy, one apart, never zero", () => {
    expect(wordmarkFactors(4)).toEqual([-1.5, -0.5, 0.5, 1.5]);
    expect(wordmarkFactors(6)).toEqual([-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]);
    expect(wordmarkFactors(3)).toEqual([-1, 0.5, 1]);
  });

  it("markup: a wrapper per letter with its own transparent text and the label; copies aria-hidden; size reserved by the wrapper text", () => {
    const html = wordmarkHtml({ size: "22px", label: "Prism" });
    expect(html.startsWith('<span class="pw" role="img" aria-label="Prism" tabindex="0" style="font-size:22px">')).toBe(true);
    expect((html.match(/<span class="pw-l">/g) ?? []).length).toBe(5);
    expect((html.match(/aria-hidden="true"/g) ?? []).length).toBe(5 * (PRISM_BANDS.length + 1));
    expect(wordmarkCss()).toContain("color:transparent");
    expect(wordmarkCss()).toContain(".pw-l>.pw-c{position:absolute");
    expect(wordmarkHtml({ autoplay: true })).toContain('class="pw pw-auto"');
  });

  it("CSS: one registered property drives every copy; 1.5 s run with the four stops and the easing; the angle is one constant; em-scaled", () => {
    const css = wordmarkCss();
    expect(css).toContain("@property --d{syntax:'<number>';inherits:true;initial-value:0}");
    expect(css).toContain(`animation:pw-run ${WORDMARK_RUN.ms}ms ${WORDMARK_RUN.easing} 1`);
    expect(WORDMARK_RUN.ms).toBe(1500);
    expect(css).toContain("@keyframes pw-run{0%{--d:0}38%{--d:9}52%{--d:9}100%{--d:0}}");
    expect(css).toContain(`* ${WORDMARK_ANGLE} *`);
    expect(WORDMARK_ANGLE).toBe(-0.55);
    expect(css).toContain("1em / 88");
    expect((css.match(/translate\(/g) ?? []).length).toBe(1);
  });

  it("reduced motion: the CSS rule is there and the script refuses to play", () => {
    expect(wordmarkCss()).toContain("@media (prefers-reduced-motion: reduce){.pw.pw-play{animation:none}}");
    expect(wordmarkScript()).toContain("prefers-reduced-motion: reduce");
    expect(wordmarkScript()).toContain("'registerProperty' in CSS");   // no @property: static white, no polyfill
  });

  it("the script's guard: no second run within two seconds; the class comes off after the run", () => {
    const js = wordmarkScript();
    expect(WORDMARK_GUARD_MS).toBe(2000);
    expect(js).toContain(`if(now-last<${WORDMARK_GUARD_MS})return false`);
    expect(js).toContain(`},${WORDMARK_RUN.ms + 100})`);
    expect(js).toContain("pointerenter"); expect(js).toContain("'click'"); expect(js).toContain("e.key==='Enter'");
    expect(js).toContain("requestAnimationFrame(function(){requestAnimationFrame");   // launch: after the first paint
  });

  it("the snippet is style, markup, script, in that order", () => {
    const s = wordmarkSnippet({ size: "22px" });
    expect(s.indexOf("<style>")).toBe(0);
    expect(s.indexOf('<span class="pw"')).toBeGreaterThan(s.indexOf("</style>"));
    expect(s.indexOf("<script>")).toBeGreaterThan(s.indexOf('<span class="pw"'));
  });
});
