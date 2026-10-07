/**
 * Writes packages/core/dist/prism-wordmark.html - the animated wordmark snippet (style + markup + script, src/wordmark.ts)
 * a web surface inlines where its logo goes. The phone's page (targets/win-host/PrismHost/Services/RemotePage.cs) takes it
 * through the host's Assets/brain folder at run time, as it does prism-runtime.js. Run after `npm run build`:
 *   node scripts/generate-wordmark.mjs
 * The snippet is the header's size (22 px); a surface may wrap it in its own font-size instead.
 *
 * Also writes packages/core/dist/prism-splash.html - the splash page the Windows host shows on its boot cover (2026-10-05, "When
 * prism is loading it says loading prism on a splash screen. We need that to instead read PRISM with the fading effect"): one
 * whole document, the cover's own dark background, the wordmark centred at a size that scales with the window, playing once
 * after the first paint (docs/features/animated-wordmark.md: the splash plays once on launch and never loops).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist", "wordmark.js");
const outPath = join(here, "..", "dist", "prism-wordmark.html");
const splashPath = join(here, "..", "dist", "prism-splash.html");

const { wordmarkSnippet } = await import(pathToFileURL(dist).href);
const html = wordmarkSnippet({ size: "22px", label: "Prism", autoplay: true, className: "pw-header" });
writeFileSync(outPath, html + "\n");
console.log(`wrote the wordmark snippet (${html.length} chars) to ${outPath}`);

// the splash: the boot cover's colour (#0B0D11, MainWindow.BootCover.cs), the word a tenth of the window's width (clamped so a small
// window still reads it and a wall does not shout), nothing else on the page
const splash = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Prism</title>
<style>html,body{margin:0;height:100%;background:#0B0D11;overflow:hidden}body{display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}</style>
</head><body>${wordmarkSnippet({ size: "clamp(48px, 10vw, 180px)", label: "Prism", autoplay: true, className: "pw-splash" })}</body></html>`;
writeFileSync(splashPath, splash + "\n");
console.log(`wrote the splash page (${splash.length} chars) to ${splashPath}`);
