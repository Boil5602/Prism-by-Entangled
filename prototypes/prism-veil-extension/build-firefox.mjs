/*
  Build the shippable packages of the PRISM Veil extension from the ONE source
  in this folder. Run: `node build-firefox.mjs` -> ./dist/<browser>/ and
  ./dist/prism-veil-<browser>-<version>.zip for `firefox` and `chromium`
  (both are store builds since 2026-11-14: this folder with the start page cut
  out, see STORE below; chromium also takes the store's name and description;
  the folder itself loaded unpacked is the development build).

  One package per browser. The start page (ntp.*, and the lines between the
  @store-strip marks in bg.js, popup.js and popup.html) stays in this folder
  for a later package of its own and ships in neither store build. In the
  development build it is OFF until the person flips "Use PRISM as my new-tab
  page" in the extension popup; bg.js routes new tabs to ntp.html only while
  the switch is on.

  Nothing here is a fork: every behavior file (src/*, ima-hook.js, popup-hook.js,
  ntp.*, popup.*, art/*) is COPIED verbatim, and the Firefox manifest is DERIVED
  from the live manifest.json - version, permissions, content_scripts and
  web_accessible_resources stay in lockstep. Only the browser differences are
  transformed:

    - Firefox: background is an event page (background.scripts), not a service
      worker. browser_specific_settings.gecko adds a stable id and pins
      strict_min_version 128 because the MAIN-world content scripts
      (ima-hook.js / popup-hook.js) need world:"MAIN" (Firefox 128+, July 2024).

  Load in Firefox: about:debugging#/runtime/this-firefox -> "Load Temporary
  Add-on" -> pick dist/firefox/manifest.json. (Temporary until restart;
  permanent install needs AMO signing - out of scope here.)
*/
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");

// Files/dirs that make up the shipped extension (everything a browser loads).
// Dev-only things (tests/, build-firefox.mjs, dist/, node_modules, README) are
// intentionally excluded.
const SHIP = [
  "bg.js",
  "ima-hook.js",
  "popup-hook.js",
  "popup.html",
  "popup.js",
  "offscreen.html",
  "offscreen.js",
  "report-ad-snippet.js",
  "src",
  "art",
  "sounds",
  "vendor",
  "icons",
  "ntp.html",
  "ntp.css",
  "ntp.js",
];

const GECKO_ID = "prism-veil@entangled.world";
const MIN_FIREFOX = "140.0";   // world:"MAIN" content scripts need 128; data_collection_permissions needs 140 (desktop)
const MIN_FIREFOX_ANDROID = "142.0";   // same key on Android

const VARIANTS = [
  { name: "firefox", browser: "firefox" },
  { name: "chromium", browser: "chromium" },
  // Safari (2026-11-19, a first cut that no Safari has run yet; docs/roadmap.md): built only when named, `node build-firefox.mjs safari`,
  // so a release of the other two never makes or changes it. The zip is what App Store Connect's Safari Web Extension Packager takes.
  { name: "safari", browser: "safari", named: true },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const wanted = only.length ? VARIANTS.filter((v) => only.includes(v.name)) : VARIANTS.filter((v) => !v.named);
const zip = !process.argv.includes("--no-zip");

function log(...a) { console.log("[build]", ...a); }

const base = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

function deriveManifest(v) {
  const m = JSON.parse(JSON.stringify(base));
  if (v.browser === "firefox") {
    const swFile = (m.background && m.background.service_worker) || "bg.js";
    // ... and the live TV picture's reader with what it needs, which reads snapshots of the tab there (2026-11-18)
    m.background = { scripts: ["src/rules-pack.js", "src/ambient.js", "src/breakwatch/cs.js", "src/breakwatch/break-model.js", "src/breakwatch/learned-break.js",
      "src/breakwatch/picture-net.js", "src/breakwatch/ad-prints.js", "vendor/tesseract/tesseract.min.js", "src/live-picture.js", "offscreen.js", swFile] };   // and the soundscape, which the background page plays itself there (0.9.2)
      // the rule updates' reader first: a background page has no importScripts (0.9.0)
    // Firefox has no tab stream (chrome.tabCapture) and no offscreen pages
    m.permissions = (m.permissions || []).filter((p) => p !== "tabCapture" && p !== "offscreen");   // and no offscreen pages
    m.browser_specific_settings = Object.assign({}, m.browser_specific_settings,
      { gecko: { id: GECKO_ID, strict_min_version: MIN_FIREFOX,
        // Firefox built-in data consent (https://mzl.la/firefox-builtin-data-consent).
        // Veil collects nothing by default. The one opt-in flow - Report ad -> - transmits the site hostname + the ad element's
        // structure, and only on that click; that is "websiteContent".
        data_collection_permissions: { required: ["none"], optional: ["websiteContent"] } },
        gecko_android: { strict_min_version: MIN_FIREFOX_ANDROID } });
  }
  if (v.browser === "safari") {
    // Safari has no offscreen pages and no tab stream, and (as far as its documentation says) no snapshot of a tab's rectangle, so
    // the live TV picture is not read there: the option shows as not available, as in Firefox before 0.9.41. The background is a
    // page that sleeps (scripts, not persistent), so the soundscape can play from it as it does in Firefox, and it loads the rule
    // updates' reader itself.
    const swFile = (m.background && m.background.service_worker) || "bg.js";
    m.background = { scripts: ["src/rules-pack.js", "src/ambient.js", swFile], persistent: false };
    m.permissions = (m.permissions || []).filter((p) => p !== "tabCapture" && p !== "offscreen");
  }
  // Both packages are store builds (Chrome Web Store and Edge Add-ons from the Chromium one, addons.mozilla.org from the Firefox
  // one; 2026-11-14, docs/veil-release-checklist.md section 6a). The name is the trademark's, with the short one where space is
  // tight; the description fits the Chrome store's 132 characters and says what the extension does to popups; the start page is
  // cut (STORE below), so the optional `tabs` permission goes with it; optional_host_permissions repeated the required host
  // permissions and nothing asked for them.
  if (JSON.stringify(m.optional_permissions) !== '["tabs"]') throw new Error("optional_permissions is no longer only tabs: look at what the store builds must keep");
  const out = {};
  for (const k of Object.keys(m)) {
    if (k === "optional_permissions" || k === "optional_host_permissions") continue;
    out[k] = m[k];
    if (k === "name") { out.name = STORE.name; out.short_name = STORE.shortName; }
  }
  out.description = STORE.description;
  if (out.description.length > 132) throw new Error("the store description is " + out.description.length + " characters (132 at most)");
  return out;
}

// ---- the store builds (Chromium, and Firefox since the same day) ----------------------------------------------------------
// One source, as ever: a store build is this folder with the start page cut out by the build, never a fork. The lines between
// `@store-strip-begin` and `@store-strip-end` (whole lines, a // comment in a script, an HTML comment in a page) are left out,
// the phrases in `reword` that name the start page are taken out of the text that stays, and the build stops if a word of the
// start page, a CDN address or a remote host that only the start page used is still in the package.
const STORE = {
  name: "PRISM by Entangled",
  shortName: "PRISM",
  description: "Ads become art. PRISM covers the ads on a page with pictures you chose and closes popups you did not ask for. Ads still load.",
  drop: ["ntp.html", "ntp.css", "ntp.js"],
  strip: ["bg.js", "popup.js", "popup.html"],
  reword: [   // [file, find, replace, how many times it must be there]
    ["src/popups-ui.js", "photos, start page, time", "photos, time", 2],
    ["bg.js", "list = Wikipedia RSP (kept for the start page)", "list = Wikipedia RSP", 1],
  ],
  refuse: [/ntp\.(html|js|css)/i, /ntpEnabled|startEnabled/, /start page|new-tab page/i, /open-meteo/i, /chrome_url_overrides/, /cdn\.jsdelivr\.net/i, /@store-strip/],
};
function count(text, find) { let n = 0, i = 0; while ((i = text.indexOf(find, i)) >= 0) { n++; i += find.length; } return n; }
function stripMarked(text, rel) {
  const lines = text.split("\n"), kept = [];
  let cutting = false, cuts = 0;
  for (const line of lines) {
    if (line.includes("@store-strip-begin")) { if (cutting) throw new Error(rel + ": a second @store-strip-begin before the end"); cutting = true; cuts++; continue; }
    if (line.includes("@store-strip-end")) { if (!cutting) throw new Error(rel + ": @store-strip-end without a begin"); cutting = false; continue; }
    if (!cutting) kept.push(line);
  }
  if (cutting) throw new Error(rel + ": @store-strip-begin without an end");
  if (!cuts) throw new Error(rel + ": no @store-strip block (the list in STORE.strip names it)");
  return kept.join("\n");
}
function walk(dir, each) { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) walk(p, each); else each(p); } }
function storeBuild(out) {
  for (const rel of STORE.drop) rmSync(join(out, rel), { force: true });
  for (const rel of STORE.strip) { const p = join(out, rel); writeFileSync(p, stripMarked(readFileSync(p, "utf8"), rel)); }
  for (const [rel, find, put, times] of STORE.reword) {
    const p = join(out, rel), text = readFileSync(p, "utf8"), n = count(text, find);
    if (n !== times) throw new Error(rel + ": \"" + find + "\" is there " + n + " times, not " + times);
    writeFileSync(p, text.split(find).join(put));
  }
  // every script that was cut still parses
  for (const rel of STORE.strip.concat(STORE.reword.map((r) => r[0]))) {
    if (!/\.js$/.test(rel)) continue;
    const r = spawnSync(process.execPath, ["--check", join(out, rel)], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(rel + " does not parse after the cut:\n" + r.stderr);
  }
  // nothing of the start page is left, in any text file of the package
  const left = [];
  walk(out, (p) => {
    if (!/\.(js|html|css|json|md|txt)$/i.test(p)) return;
    const text = readFileSync(p, "utf8");
    for (const re of STORE.refuse) { const m = re.exec(text); if (m) left.push(p.slice(out.length + 1) + ": " + m[0]); }
  });
  if (left.length) throw new Error("the store build still carries:\n  " + left.join("\n  "));
}

// Reset dist/ but KEEP signed .xpi files: AMO signing is rate-limited and a
// later build must not throw a signed artifact away (it did, 2026-08-29).
if (existsSync(DIST)) {
  // only what this run builds again: `node build-firefox.mjs firefox` leaves the Chromium folder and zip as they are (2026-11-14,
  // a package already uploaded to a store must stay byte for byte while the other one is built again)
  const mine = (f) => wanted.some((v) => f === v.name || f === "prism-veil-" + v.name + "-" + base.version + ".zip");   // never another version's zip
  // a built folder is never removed: a browser that runs it unpacked drops the extension when its folder or manifest is gone for a
  // moment (2026-11-18, Edge lost the unpacked build during a rebuild). The folder is brought up to date in place, below.
  for (const f of readdirSync(DIST)) { if (!/\.xpi$/i.test(f) && mine(f) && /\.zip$/i.test(f)) rmSync(join(DIST, f), { recursive: true, force: true }); }
}
// Make `to` hold exactly what `from` holds: files written over, then what `from` does not have removed. The manifest is written last.
function syncDir(from, to) {
  mkdirSync(to, { recursive: true });
  const have = new Set(readdirSync(from));
  for (const f of readdirSync(to)) { if (!have.has(f)) rmSync(join(to, f), { recursive: true, force: true }); }
  for (const f of [...have].sort((a, b) => (a === "manifest.json") - (b === "manifest.json"))) {
    const a = join(from, f), b = join(to, f);
    if (statSync(a).isDirectory()) { if (existsSync(b) && !statSync(b).isDirectory()) rmSync(b, { force: true }); syncDir(a, b); }
    else { if (existsSync(b) && statSync(b).isDirectory()) rmSync(b, { recursive: true, force: true }); cpSync(a, b); }
  }
}
mkdirSync(DIST, { recursive: true });

for (const v of wanted) {
  const live = join(DIST, v.name), out = join(DIST, ".stage-" + v.name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const manifest = deriveManifest(v);
  let copied = 0;
  for (const rel of SHIP) {
    const from = join(ROOT, rel);
    if (!existsSync(from)) { log("skip (missing):", rel); continue; }
    cpSync(from, join(out, rel), { recursive: true });
    copied++;
  }
  // Firefox has no offscreen pages: the reader (offscreen.js) is a background script there (2026-11-18)
  if (v.browser === "firefox" || v.browser === "safari") rmSync(join(out, "offscreen.html"), { force: true });
  // Safari reads no picture: the reader and what only it uses stay out of that package
  if (v.browser === "safari") for (const rel of ["offscreen.js", "vendor/tesseract"]) rmSync(join(out, rel), { recursive: true, force: true });
  storeBuild(out);   // both packages
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  let zipped = "";
  if (zip && process.platform === "win32") {
    const zipPath = join(DIST, `prism-veil-${v.name}-${manifest.version}.zip`);
    const r = spawnSync("powershell", ["-NoProfile", "-Command",
      `Compress-Archive -Path '${join(out, "*")}' -DestinationPath '${zipPath}' -Force`], { stdio: "inherit" });
    zipped = r.status === 0 ? ` + ${zipPath}` : " (zip failed)";
  }
  syncDir(out, live);
  rmSync(out, { recursive: true, force: true });
  log(`v${manifest.version} ${v.name}: ${copied} items, bg=${JSON.stringify(manifest.background)}${zipped}`);
}
