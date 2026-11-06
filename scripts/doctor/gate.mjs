#!/usr/bin/env node
/*
  The release gate walked by machine (scripts/doctor, 2026-11-04, roadmap item 4): the rows of docs/veil-release-checklist.md's site
  matrix that a fresh, signed-in-to-nothing browser can reach, walked by headless Firefox with the Veil installed, each row's
  screenshot and cover list judged against the row's own Expect text by a vision pass. The verdict is evidence for the person who
  walks the matrix, not a mark in the checklist: a USER mark stays a person's. Rows that need a sign-in (X, LinkedIn, Pandora,
  Paramount+, Facebook, Instagram) or a hand on the mouse (hover, Escape, the pill) are not here.

    node scripts/doctor/gate.mjs [--rows=YT-1,FX-1,...] [--model=..] [--show] [--dry]

  Output in scripts/doctor/out/gate-<stamp>/: <row>.png, <row>.dump.json (structure only, as dump.mjs writes), report.md, usage.json.
  Nothing of a household's: the profile is a temp folder, deleted after the run.
*/
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchFirefox } from "./bidi.mjs";
import { DUMP_FN } from "./dumpfn.mjs";
import { loadKey } from "./model.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };
const log = (s) => console.log("[gate] " + s);
const veilPath = resolve(root, "prototypes/prism-veil-extension/dist/firefox");
const version = JSON.parse(readFileSync(join(veilPath, "manifest.json"), "utf8")).version;

// the rows a stranger's browser can walk; Do and Expect copied from the checklist, with what the walk does in `steps`
const ROWS = [
  { id: "YT-1", person: "YouTube serves a signed-out headless browser an empty feed with no ad tiles", url: "https://www.youtube.com/", wait: 10, scroll: 2, do: "home feed with in-feed ads", expect: "each ad tile is art with the half-moon top-left; no caption over the art" },
  { id: "FX-1", person: "the expanded 478px masthead is one creative among several; a fresh visitor seldom gets it", url: "https://www.foxnews.com/", wait: 10, scroll: 0, do: "home page, masthead expanded (478px)", expect: "art over the whole masthead; the GAM spacer under it is not covered (no art on page content once the ad is gone)" },
  { id: "FX-2", person: "the collapsed strip follows the expanded masthead, which a fresh visitor seldom gets", url: "https://www.foxnews.com/", wait: 10, scroll: 2, stay: true, do: "scroll: masthead collapses to the 212px fixed strip", expect: "strip covered by a fixed veil that rides the viewport; not mistaken for the site header (covers below are not clipped under it)" },
  { id: "CN-1", url: "https://www.cnn.com/", wait: 10, scroll: 0, do: "home page header ad (Wunderkind / Celtra, 1897x475 on a ~900px window)", expect: "covered (was refused as page-sized before 0.7.152). CNN's small in-feed fave players autoplay muted and carry fave-ad-playing while an ad runs in them: one of those under a cover is right (a display-sized ad, covered like one), not a site video tile wrongly covered" },
  { id: "FP-1", url: "https://www.msn.com/", wait: 8, scroll: 2, until: "[role=tab][aria-label=Sponsored][aria-selected=true]", do: "MSN home: infopane native ad slide; stripe tile with an \"Ad\" subtitle", expect: "slide covered whole with the pager raised above the veil; tile covered; the search bar never painted over" },
  { id: "FP-4", url: "https://www.reddit.com/", wait: 10, scroll: 2, do: "Reddit: promoted post and sidebar unit", expect: "covered" },
  { id: "FP-6", url: "https://www.theguardian.com/us", wait: 10, scroll: 2, do: "any news site with Google Ad Manager / AdSense slots", expect: "slots covered; a slot that balloons to page size drops its cover in the same frame" },
  { id: "CC-4", person: "the sticky header shows only while scrolling; one still frame cannot show clipping or smear", url: "https://www.foxnews.com/", wait: 10, scroll: 3, stay: true, do: "a page with a sticky header and covers below it", expect: "covers clip under the header as you scroll, no smear" },
];
const wanted = opt("--rows", null) ? new Set(opt("--rows").split(",")) : null;
const rows = ROWS.filter((r) => !wanted || wanted.has(r.id));
const now = new Date(), two = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
const outDir = resolve(root, opt("--out", join("scripts", "doctor", "out", "gate-" + stamp)));
mkdirSync(outDir, { recursive: true });

const SYSTEM = `You judge one row of the release checklist of the Prism Veil, a browser extension that COVERS ads on web pages with
photographs (art), observe-only: the ad still loads underneath, the cover sits exactly on the ad's box, and a small half-moon glyph
sits at the cover's top-left corner. A cover must never sit on the page's own content: an article, a video the person chose, a
search bar, a site's header or navigation, a feed post that is not an ad. You are given the row's Do and Expect from the checklist,
a screenshot of a fresh browser (signed in to nothing, so some ads may not be served, and consent dialogs may be up), the list of
covers the Veil made on that page with the reason each rule gave and the box, the Veil's own trace, and the page's size.
Answer with a verdict: "pass" when the screenshot and the covers show the Expect holding; "fail" when a cover sits on content, an
obvious ad is bare, or the Expect is contradicted; "cannot-tell" when the page did not serve the thing the row is about (no ad in
the slot, a consent wall, an empty feed) or the row needs an action the walk did not take. Say what you saw in two or three
sentences, naming boxes and reasons from the list, and list concerns a person should look at by hand. Be strict about covers on
content and lenient about ads that were simply not served to a stranger.`;
const SCHEMA = { type: "object", additionalProperties: false, required: ["verdict", "seen", "concerns"], properties: {
  verdict: { type: "string", enum: ["pass", "fail", "cannot-tell"] }, seen: { type: "string" }, concerns: { type: "array", items: { type: "string" } } } };

const ff = await launchFirefox({ headless: !flag("--show"), log: (s) => {} });
const results = [];
let client = null; const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, calls: 0 };
try {
  log("Veil " + version + " installed: " + (await ff.install(veilPath)));
  for (const r of rows) {
    log(`${r.id}: ${r.url}`);
    const t0 = Date.now();
    let dump = null, shot = null, err = null;
    try {
      await ff.navigate(r.url);
      await new Promise((res) => setTimeout(res, r.wait * 1000));
      for (let i = 1; i <= (r.scroll || 0); i++) { await ff.run("function (y) { scrollTo(0, y); return 1; }", [i * 800]); await new Promise((res) => setTimeout(res, 1500)); }
      if (!r.stay && r.scroll) { await ff.run("function () { scrollTo(0, 0); return 1; }"); await new Promise((res) => setTimeout(res, 2500)); }
      if (r.until) {
        const UNTIL = `function (sel) { var roots = [document], i = 0; while (i < roots.length) { var rt = roots[i++]; try { if (rt.querySelector(sel)) return 1; } catch (e) { return -1; } var all = rt.querySelectorAll("*"); for (var k = 0; k < all.length; k++) if (all[k].shadowRoot) roots.push(all[k].shadowRoot); } return 0; }`;
        const u0 = Date.now(); let hit = 0; while (Date.now() - u0 < 90000) { hit = await ff.run(UNTIL, [r.until]); if (hit) break; await new Promise((res) => setTimeout(res, 400)); }
        if (hit === 1) await new Promise((res) => setTimeout(res, 1500));
      }
      dump = JSON.parse(await ff.run(DUMP_FN, [3000, 0]));
      shot = Buffer.from(await ff.screenshot(), "base64");
      writeFileSync(join(outDir, r.id + ".png"), shot);
      writeFileSync(join(outDir, r.id + ".dump.json"), JSON.stringify({ doctor: 1, kind: "veil-page", at: new Date().toISOString(), host: new URL(r.url).hostname, page: r.url, veil: version, row: r.id, ...dump }));
    } catch (e) { err = e?.message ?? String(e); log(`  ${r.id} walk failed: ${err}`); }
    const covers = dump ? dump.covers.filter((c) => !c.ui) : [];
    const coverText = covers.length ? covers.map((c) => `  ${c.why || "(no reason)"} at [${c.r.join(",")}]`).join("\n") : "  (none)";
    const trace = dump?.marks?.["data-prism-errors"] || "";
    const facts = `Row ${r.id}. Do: ${r.do}. Expect: ${r.expect}.\nPage ${r.url}, viewport ${dump ? dump.viewport.join("x") : "?"}, scrolled to ${dump ? dump.scrollY : "?"} px of ${dump ? dump.docHeight : "?"}.\nCovers the Veil made (${covers.length}; reason at [left,top,width,height] in viewport pixels):\n${coverText}\nVeil trace: ${trace.slice(0, 600) || "(empty)"}${err ? "\nThe walk itself failed: " + err : ""}`;
    writeFileSync(join(outDir, r.id + ".facts.txt"), facts);
    if (flag("--dry") || !shot) { results.push({ id: r.id, verdict: err ? (r.person ? "person" : "cannot-tell") : "(dry)", seen: err || "", concerns: [], covers: covers.length, ms: Date.now() - t0 }); continue; }
    if (!client) { if (!loadKey()) { log("no key"); process.exit(1); } const { default: Anthropic } = await import("@anthropic-ai/sdk"); client = new Anthropic(); }
    try {
      const msg = await client.messages.create({
        model: opt("--model", "claude-opus-5-5"), max_tokens: 2000, thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: shot.toString("base64") } }, { type: "text", text: facts }] }],
      });
      const u = msg.usage; usage.input_tokens += u.input_tokens; usage.output_tokens += u.output_tokens; usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0; usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0; usage.calls++;
      const ans = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
      // a row the headless walk cannot judge (r.person says why): cannot-tell there is a row for the person walking the matrix, not a failure
      if (r.person && ans.verdict === "cannot-tell") { ans.verdict = "person"; ans.seen = r.person + ". " + ans.seen; }
      results.push({ id: r.id, ...ans, covers: covers.length, ms: Date.now() - t0 });
      log(`  ${r.id}: ${ans.verdict} (${covers.length} covers) ${ans.seen.slice(0, 140)}`);
    } catch (e) { results.push({ id: r.id, verdict: "cannot-tell", seen: "the judge failed: " + (e?.message ?? e), concerns: [], covers: covers.length, ms: Date.now() - t0 }); log(`  ${r.id} judge failed: ${e?.message ?? e}`); }
  }
} finally { await ff.close(); }

const md = [`# Release gate walked by machine: Veil ${version}, ${now.toISOString().slice(0, 16).replace("T", " ")}`, "", "Headless Firefox, a fresh profile signed in to nothing; each row's screenshot and covers judged against the checklist's Expect. Evidence for the person walking the matrix, not a mark.", "", "| row | verdict | covers | seen |", "|---|---|---|---|"];
for (const x of results) md.push(`| ${x.id} | ${x.verdict} | ${x.covers} | ${(x.seen || "").replace(/\|/g, "/")} |`);
const concerns = results.flatMap((x) => (x.concerns || []).map((c) => `- ${x.id}: ${c}`));
if (concerns.length) md.push("", "## Concerns for a person", "", ...concerns);
md.push("", `${usage.calls} judge calls: ${usage.input_tokens} in (${usage.cache_read_input_tokens} from cache), ${usage.output_tokens} out.`);
writeFileSync(join(outDir, "report.md"), md.join("\n") + "\n");
writeFileSync(join(outDir, "usage.json"), JSON.stringify({ at: new Date().toISOString(), veil: version, usage, results }, null, 2));
log("written " + join(outDir, "report.md"));
console.log("\n" + md.join("\n"));
