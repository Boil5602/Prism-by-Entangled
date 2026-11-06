// The ad SDKs the Veil hooks, watched for a new build (roadmap item 6, built 2026-11-04 on being asked whether the check against the ad
// developers was set up). Google's IMA SDK (client-side ads: CNN and most web players) and its DAI SDK (server-stitched with a client
// event stream: Paramount+) are public files; the Veil's ima-hook.js wraps named members of them. Each run fetches both, keeps a hash
// and a copy, and when a file changes says so and checks that every name the hook relies on is still in the new build. A change is a
// line on the attention page; a missing name is "look now". No model is asked: the names are the whole question, and the harness's
// play on a hooked site (docs/veil-release-checklist.md) is the proof.
//
//   node scripts/doctor/sdk-watch.mjs            fetch, compare, record
//   node scripts/doctor/sdk-watch.mjs --dry      fetch and compare, record nothing
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const OUT = join("scripts", "doctor", "out", "sdk");
const DRY = process.argv.includes("--dry");
const UA = "Prism doctor (+https://entangled.world/prism; a nightly check of the ad SDKs a browser extension hooks)";
const SDKS = [
  { name: "ima3", url: "https://imasdk.googleapis.com/js/sdkloader/ima3.js", hooks: ["AdEvent", "AdsManagerLoadedEvent", "AdsLoader", "ADS_MANAGER_LOADED", "getAdsManager", "CONTENT_PAUSE_REQUESTED", "CONTENT_RESUME_REQUESTED", "ALL_ADS_COMPLETED", "AD_PROGRESS", "addEventListener"] },
  { name: "ima3_dai", url: "https://imasdk.googleapis.com/js/sdkloader/ima3_dai.js", hooks: ["StreamManager", "AD_BREAK_STARTED", "AD_BREAK_ENDED", "requestStream", "addEventListener"] },
];
const KEEP = 6;

mkdirSync(OUT, { recursive: true });
const statePath = join(OUT, "state.json"), changesPath = join(OUT, "changes.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const changes = existsSync(changesPath) ? JSON.parse(readFileSync(changesPath, "utf8")) : [];
const now = new Date().toISOString();
const versionOf = (text) => (/\b(3\.\d{2,4}\.\d{1,3})\b/.exec(text) ?? [])[1] ?? null;   // the SDK names its build inside ("3.713.0")

for (const sdk of SDKS) {
  let text;
  try {
    const res = await fetch(sdk.url, { headers: { "user-agent": UA } });
    if (!res.ok) { console.log(`${sdk.name}: ${res.status} from ${sdk.url}`); continue; }
    text = await res.text();
  } catch (e) { console.log(`${sdk.name}: fetch failed: ${e?.message ?? e}`); continue; }
  const sha = createHash("sha256").update(text).digest("hex");
  const version = versionOf(text);
  const missing = sdk.hooks.filter((h) => !text.includes(h));
  const prev = state[sdk.name];
  const line = `${sdk.name}: ${version ?? "version unknown"}, ${text.length} bytes, sha ${sha.slice(0, 12)}` + (missing.length ? `, MISSING ${missing.join(", ")}` : ", every hooked name present");
  if (!prev) {
    console.log(line + " (first seen)");
    if (!DRY) { state[sdk.name] = { sha, size: text.length, version, at: now, missing }; writeFileSync(join(OUT, `${sdk.name}-${now.slice(0, 10)}.js`), text); }
    continue;
  }
  if (prev.sha === sha) { console.log(line + " (unchanged since " + prev.at.slice(0, 10) + ")"); continue; }
  // the same build number, a few bytes apart, every hooked name present (2026-11-04: 6 bytes the first evening): the file is served with a
  // per-fetch detail, not rebuilt. Noted, not a change; the stored copy moves on so the next comparison is against today's bytes.
  if (version && version === prev.version && !missing.length && Math.abs(text.length - prev.size) <= 64) {
    console.log(line + ` (same build ${version}, ${text.length - prev.size} bytes apart: not a new build)`);
    if (!DRY) state[sdk.name] = { ...prev, sha, size: text.length, missing };
    continue;
  }
  console.log(line + ` (CHANGED from ${prev.version ?? "?"}, ${prev.size} bytes, seen ${prev.at.slice(0, 10)})`);
  if (DRY) continue;
  changes.push({ at: now, name: sdk.name, from: { version: prev.version, size: prev.size, sha: prev.sha, at: prev.at }, to: { version, size: text.length, sha }, missing });
  state[sdk.name] = { sha, size: text.length, version, at: now, missing };
  writeFileSync(join(OUT, `${sdk.name}-${now.slice(0, 10)}.js`), text);
  const copies = readdirSync(OUT).filter((f) => f.startsWith(sdk.name + "-") && f.endsWith(".js")).sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - KEEP))) unlinkSync(join(OUT, old));
}
if (!DRY) { writeFileSync(statePath, JSON.stringify(state, null, 2)); writeFileSync(changesPath, JSON.stringify(changes, null, 2)); }
