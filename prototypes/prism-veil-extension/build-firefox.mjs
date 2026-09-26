/*
  Build the shippable packages of the Prism Veil extension from the ONE source
  in this folder. Run: `node build-firefox.mjs` -> ./dist/<browser>/ and
  ./dist/prism-veil-<browser>-<version>.zip for `firefox` and `chromium`
  (chromium == this folder loaded unpacked).

  One package per browser. The start page ships inside it but is OFF until the
  person flips "Use Prism as my new-tab page" in the extension popup. There is
  deliberately no chrome_url_overrides in the manifest (it cannot be toggled at
  runtime in any browser); bg.js routes new tabs to ntp.html only while the
  switch is on. Weather hosts are optional permissions requested when a
  location is first set.

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
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync, readdirSync } from "node:fs";
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
  "report-ad-snippet.js",
  "src",
  "art",
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
];
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const wanted = only.length ? VARIANTS.filter((v) => only.includes(v.name)) : VARIANTS;
const zip = !process.argv.includes("--no-zip");

function log(...a) { console.log("[build]", ...a); }

const base = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

function deriveManifest(v) {
  const m = JSON.parse(JSON.stringify(base));
  if (v.browser === "firefox") {
    const swFile = (m.background && m.background.service_worker) || "bg.js";
    m.background = { scripts: [swFile] };
    m.browser_specific_settings = Object.assign({}, m.browser_specific_settings,
      { gecko: { id: GECKO_ID, strict_min_version: MIN_FIREFOX,
        // Firefox built-in data consent (https://mzl.la/firefox-builtin-data-consent).
        // Veil collects nothing by default. The one opt-in flow - Report ad ->
        // "Send to Prism" - transmits the site hostname + the ad element's
        // structure, and only on that click; that is "websiteContent".
        data_collection_permissions: { required: ["none"], optional: ["websiteContent"] } },
        gecko_android: { strict_min_version: MIN_FIREFOX_ANDROID } });
  }
  return m;
}

// Reset dist/ but KEEP signed .xpi files: AMO signing is rate-limited and a
// later build must not throw a signed artifact away (it did, 2026-08-29).
if (existsSync(DIST)) {
  for (const f of readdirSync(DIST)) { if (!/\.xpi$/i.test(f)) rmSync(join(DIST, f), { recursive: true, force: true }); }
}
mkdirSync(DIST, { recursive: true });

for (const v of wanted) {
  const out = join(DIST, v.name);
  mkdirSync(out, { recursive: true });
  const manifest = deriveManifest(v);
  let copied = 0;
  for (const rel of SHIP) {
    const from = join(ROOT, rel);
    if (!existsSync(from)) { log("skip (missing):", rel); continue; }
    cpSync(from, join(out, rel), { recursive: true });
    copied++;
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  let zipped = "";
  if (zip && process.platform === "win32") {
    const zipPath = join(DIST, `prism-veil-${v.name}-${manifest.version}.zip`);
    const r = spawnSync("powershell", ["-NoProfile", "-Command",
      `Compress-Archive -Path '${join(out, "*")}' -DestinationPath '${zipPath}' -Force`], { stdio: "inherit" });
    zipped = r.status === 0 ? ` + ${zipPath}` : " (zip failed)";
  }
  log(`v${manifest.version} ${v.name}: ${copied} items, bg=${JSON.stringify(manifest.background)}${zipped}`);
}
