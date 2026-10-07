# Animated wordmark ("disperse and refocus")

The PRISM wordmark is built from six colored copies of the word stacked
with a screen blend. At rest they add up to white. When it plays, the
copies slide apart along the dispersion angle, red one way and violet
the other, hold for a beat, then slide back and the word is white
again. Color always runs in spectral order; nothing is random.

## Where it appears
- App (WebView2 host): the splash/launch screen, the watch screen
  header (where the logo is today), and About/Settings.
- Companion app: the header and the pairing/connect screen.
- Same component in both, from prism-core.

## When it plays
- Once, on launch, after the first frame has painted (the word is white
  before the run; no blank or colored first frame).
- On pointer hover or tap/click of the mark. On the remote, when the
  mark has focus and Select is pressed.
- Once on profile switch, and once when the companion app connects.
- Never loops on its own. Never plays more than once per 2 seconds.
- Honors prefers-reduced-motion: the mark is static white and never
  moves. The app's own "reduce motion" setting, if one exists, does the
  same.

## Construction
- Markup: one wrapper per letter; inside it six absolutely positioned
  copies of the letter, one per band, in spectral order. The wrapper's
  own text is transparent and carries the accessible label; copies are
  aria-hidden.
- Each copy: `mix-blend-mode: screen`, color = its PRISM_BANDS entry,
  and an offset factor k of -2.5, -1.5, -0.5, 0.5, 1.5, 2.5 (red to
  violet).
- Offset per copy: translate(d·k px, d·k·-0.55 px). The angle (-0.55)
  is the dispersion angle and is one constant.
- d is one animated custom property (`@property --d`, number, inherits,
  initial 0) on the wordmark. All copies read it, so one keyframe drives
  all thirty.
- Keyframes, 1.5 s, easing cubic-bezier(.3,0,.2,1):
  0% d=0 · 38% d=9 · 52% d=9 · 100% d=0.
  d scales with font size: 9 at 88 px; use em-based values so the
  spread looks the same at any size.
- Font: the wordmark's existing typeface. If none is set, use the
  app's display face. Wide letter-spacing (~0.16 em) so the copies have
  room to separate without touching neighbors.

## Surfaces
- Screen blend needs a dark ground. The animated mark is for dark
  surfaces only. On light surfaces, show the existing static logo.
- At rest the stacked copies must land on pure white. If PRISM_BANDS
  does not contain a full-red, a full-green, and a full-blue channel
  across its entries, add a seventh white copy at k=0 so the rest state
  is white; it never moves.

## Fallbacks
- If `@property` is unsupported (very old WebViews), the mark is static
  white. No JS polyfill.
- No layout shift: the wrapper reserves its size; the copies are
  absolutely positioned inside it.

## Non-goals
Favicon, app icon, print logo, and any change to the existing static
assets. Those stay as they are.

---

## Decisions (2026-10-04, "let's do it your way and make it fit better")

The spec above is kept as written. What the build does where the project differs from it:

- **Bands.** PRISM_BANDS has four entries (amber, teal, violet, pink; `packages/core/src/visualization.ts`), fixed by the
  concept-scenes charter and not reordered or extended here. Four copies at k = -1.5, -0.5, 0.5, 1.5 in the charter's order,
  plus the white copy at k = 0 (none of the four is a full red, green or blue channel). The factors come from
  `wordmarkFactors(n)`, so six bands would give the spec's -2.5 .. 2.5.
- **Where it appears.** The phone's page header (`Services/RemotePage.cs`, the `__WORDMARK__` slot the host fills from
  `Assets/brain/prism-wordmark.html`). The PC's sites (splash, menu grip, Watch header triangle, About, Credits) are native
  XAML, not web, so the component cannot be swapped in there; they keep the static icon until a WebView2 per site or a native
  copy is chosen. There is no light surface and no separate pairing screen on the phone.
- **Triggers.** Launch (after the first paint) and hover, tap, Enter or Space on the mark. "Companion connects" is the same
  moment as launch on the phone and is not played a second time. Profile switch happens on the PC, in XAML, and has no web
  mark to play yet.
- **Reduced motion.** The page honours prefers-reduced-motion; the script also refuses to play then. The PC's own
  "Full motion" rule (MainWindow.Rail.cs) is about the visualizations and does not reach the phone.
- **Typeface.** None is defined for a wordmark. The mark uses the page's display face (system-ui on the phone).
- **Build.** `npm run build` then `npm run wordmark:generate` in packages/core; the host's csproj links the file when it exists
  and the page keeps its plain name when it does not.

## Built: the Windows splash (2026-10-05)
"When prism is loading it says loading prism on a splash screen. We need that to instead read PRISM with the fading
effect ... I want that in the splash screen every time." Core's generator (`packages/core/scripts/generate-wordmark.mjs`)
emits `dist/prism-splash.html` beside the header snippet: one document, the boot cover's own dark background, the wordmark
centred at a tenth of the window's width (48 to 180 px), playing once after the first paint. The host (`MainWindow.BootCover.cs`)
shows it in a WebView2 over the cover from the moment the page has painted; the Prism mark stands alone until then, and alone
when the page is missing. The "Loading Prism" line is gone: the word is the splash. The view closes with the cover. One run per
launch, never a loop, as this page says.
