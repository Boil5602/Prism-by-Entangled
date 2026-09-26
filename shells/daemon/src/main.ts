#!/usr/bin/env node
/**
 * prism-daemon — build-order step 4's brain-on-a-PC (spec §23).
 *
 * Runs prism-core directly in Node (no bridge) and drives Chromium windows
 * over the DevTools Protocol pipe (--remote-debugging-pipe — modern builds
 * no longer honor the debugging port). On Linux under a Wayland compositor
 * this is PrismOS; on Windows with Chrome/Edge it is the Build 5 recipe.
 *
 *   prism-daemon --dashboard <bundle.json> [--port 8471] [--width 1280]
 *                [--height 800] [--origin-x 60] [--origin-y 60]
 *                [--browser <chrome.exe>] [--max-live <n>]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  Orchestrator,
  RemoteApi,
  type AdapterSpec,
  type DashboardBundle,
  type DashboardDocument,
  type Drivers,
} from "prism-core";
import { AudioCapture, defaultAudioSource } from "./audio.js";
import { BrowserPool } from "./browsers.js";
import { WebRtcSender } from "./webrtc.js";
import { BlockList } from "./blocklist.js";
import { CdpSurfaceDriver } from "./surface.js";
import { startServer } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoDefault = (rel: string) => join(here, "..", "..", rel);

const DAEMON_VERSION = "0.1.0";
/** §28: static, unparameterized — core refuses anything else. */
const UPDATE_MANIFEST_URL = "https://entangled.world/prism/updates/manifest.json";

/** Bundled adapter set (§5) from a directory of <name>.json, like the Android shell. */
function loadAdapters(dir: string): Record<string, AdapterSpec> {
  const out: Record<string, AdapterSpec> = {};
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      out[file.slice(0, -5)] = JSON.parse(readFileSync(join(dir, file), "utf8")) as AdapterSpec;
    } catch (e) {
      console.warn(`[prism-daemon] adapter ${file} unreadable: ${String(e)}`);
    }
  }
  return out;
}

const { values } = parseArgs({
  options: {
    dashboard: { type: "string", default: repoDefault("android/app/src/main/assets/dashboard.json") },
    port: { type: "string", default: "8471" },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "800" },
    "origin-x": { type: "string", default: "60" },
    "origin-y": { type: "string", default: "60" },
    browser: { type: "string" },
    "max-live": { type: "string" },
    "data-dir": { type: "string" },
    /** §14 capture source: pulse:<monitor> (PrismOS default), alsa:, dshow:<device> (Windows), lavfi:, test: */
    "audio-source": { type: "string" },
  },
});

function findBrowser(): string {
  if (values.browser && existsSync(values.browser)) return values.browser;
  const candidates = [
    join(process.env["ProgramFiles"] ?? "", "Google/Chrome/Application/chrome.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "", "Google/Chrome/Application/chrome.exe"),
    join(process.env["ProgramFiles"] ?? "", "Microsoft/Edge/Application/msedge.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft/Edge/Application/msedge.exe"),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error("no Chromium-class browser found; pass --browser <path>");
  return found;
}

const apiPort = Number(values.port);
const viewport = { w: Number(values.width), h: Number(values.height) };
const origin = { x: Number(values["origin-x"]), y: Number(values["origin-y"]) };
const dataDir = values["data-dir"] ?? join(tmpdir(), "prism-daemon-profile");
mkdirSync(dataDir, { recursive: true });

const parsed = JSON.parse(readFileSync(values.dashboard!, "utf8")) as
  | DashboardDocument
  | DashboardBundle;
const bundle: DashboardBundle = "dashboards" in parsed ? parsed : { dashboards: [parsed] };

const browserExe = findBrowser();
console.log(`[prism-daemon] browser: ${browserExe}`);
// §10: one persistent browser per storage profile (see browsers.ts). A
// browser dying takes its tiles down; core's quiet retry brings them back
// when the pool respawns it on the next create/resume.
const pool = new BrowserPool(browserExe, dataDir, (profile, code) => {
  console.error(`[prism-daemon] browser for profile '${profile}' exited (${code})`);
});

let orchestrator: Orchestrator;

// §10 store: write-through JSON in the data dir — pairing tokens, hero
// overrides, and synced lists survive restarts. Tile storage persists per
// profile in the browser pool's user-data-dirs.
const storePath = join(dataDir, "prism-store.json");
const store = new Map<string, string>(
  existsSync(storePath)
    ? Object.entries(JSON.parse(readFileSync(storePath, "utf8")) as Record<string, string>)
    : [],
);
const persistStore = () =>
  writeFileSync(storePath, JSON.stringify(Object.fromEntries(store), null, 2));

const storeDriver = {
  get: (key: string) => store.get(key) ?? null,
  set: (key: string, value: string) => {
    store.set(key, value);
    persistStore();
  },
};

// Shared assets with the Android shell: one attributed blocklist set, one
// adapter set, one imagery directory (§5, §26/§27).
const assetsDir = repoDefault("android/app/src/main/assets");
const packsDir = join(assetsDir, "packs");
const blockList = new BlockList(join(assetsDir, "blocklists"), storeDriver);
const packImages = (source: string): string[] => {
  if (!source.startsWith("pack:")) return [];
  const dir = join(packsDir, source.slice("pack:".length));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => `http://localhost:${apiPort}/packs/${encodeURIComponent(source.slice(5))}/${encodeURIComponent(f)}`);
};

// §14: the one capture mix. PipeWire monitor on Linux by default; the
// Windows recipe must name a loopback device; `test:` exercises the plumbing.
const audioSource = values["audio-source"] ?? defaultAudioSource();
const RTP_PORT = apiPort + 1000; // local-only Opus RTP intake for the WebRTC sender
const capture = new AudioCapture(audioSource, RTP_PORT);
const webrtc = new WebRtcSender(RTP_PORT);
const lost = (listener: string) => {
  void orchestrator.onSurfaceEvent({ type: "listener-lost", id: "", listener });
};
capture.onLost = lost;
webrtc.onLost = lost;

const drivers: Drivers = {
  surface: new CdpSurfaceDriver(
    pool,
    origin,
    (event) => {
      void orchestrator.onSurfaceEvent(event);
    },
    {
      blockedBy: (host) => blockList.blockedBy(host),
      packImages,
      ...(audioSource
        ? {
            capture: (enable: boolean) => {
              if (enable) {
                webrtc.start(); // RTP intake must be listening before ffmpeg targets it
                capture.start();
              } else {
                capture.stop();
                webrtc.stop();
              }
            },
          }
        : {}),
    },
  ),
  media: {
    launch: (pkg) => console.log(`[prism-daemon] launch ${pkg}: no native apps on this shell`),
    audioTransports: () => capture.transports(),
    serveAudio: () => {}, // both transports are served per listener on demand
    audioStreamPath: () => "/audio/stream",
    webrtcOffer: (listener, sdp) => webrtc.offer(listener, sdp),
    webrtcIce: (listener, candidate) => webrtc.ice(listener, candidate),
    webrtcClose: (listener) => webrtc.close(listener),
  },
  store: storeDriver,
  net: {
    // §5 list sync: exactly the URL core hands over; core parses and decides.
    fetchStatic: async (url) => {
      const res = await fetch(url, { headers: { "User-Agent": "Prism" }, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
    applyBlockHosts: (sourceId, name, hosts) => blockList.applySynced(sourceId, name, hosts),
  },
  update: {
    // §28: exactly the URL core hands over — no query, no identifying headers.
    fetchManifest: async (url) => {
      const res = await fetch(url, { headers: { "User-Agent": "Prism", Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
    // PrismOS applies A/B image updates through its installer, not this
    // process; the Windows recipe updates by hand. Honest answer: not here.
    apply: (release) => {
      console.log(`[prism-daemon] release ${release.version} available; apply is the image installer's job`);
      return "failed";
    },
  },
};
orchestrator = new Orchestrator(drivers);
if (values["max-live"]) orchestrator.setMaxLiveTiles(Number(values["max-live"]));
orchestrator.setPreviewBudget({ maxPlayingVideo: 3, minPeekIntervalSec: 30 }); // §25 mini-PC class
// §5: core owns sync/enable/attribution; the daemon just fetches and applies.
void orchestrator
  .startBlocking(blockList.specs())
  .catch((e) => console.warn(`[prism-daemon] blocking lists: ${String(e)}`));
orchestrator.setAdapters(loadAdapters(join(assetsDir, "adapters")));
for (const [name, why] of Object.entries(orchestrator.rejectedAdapters())) {
  console.warn(`[prism-daemon] adapter '${name}' rejected (§26 synthetic interaction): ${why.join(", ")}`);
}
void orchestrator
  .startUpdates({ currentVersion: DAEMON_VERSION, manifestUrl: UPDATE_MANIFEST_URL, channel: "stable" })
  .catch((e) => console.warn(`[prism-daemon] updates disabled: ${String(e)}`));

const remote = new RemoteApi(orchestrator, drivers.store);
const remoteHtml = repoDefault("android/app/src/main/assets/remote.html");
startServer(remote, apiPort, remoteHtml, packsDir, capture);
if (audioSource) console.log(`[prism-daemon] private listening: http transport from ${audioSource}`);
else console.log("[prism-daemon] private listening: no capture source (pass --audio-source)");
console.log(`[prism-daemon] remote API on :${apiPort}`);

const pairing = await remote.mintPairing(`http://localhost:${apiPort}`);
console.log(`[prism-daemon] pairing URL: ${pairing.url}`);

await orchestrator.loadBundle(bundle, viewport);
console.log(
  `[prism-daemon] dashboard '${orchestrator.getState()?.dashboard}' at ${viewport.w}×${viewport.h}, origin (${origin.x},${origin.y})`,
);

const shutdown = () => {
  void pool.killAll().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
