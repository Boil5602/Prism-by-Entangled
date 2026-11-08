#!/usr/bin/env node
// The live break watch pack fetched into a folder and verified (docs/features/break-watch-packs.md, 2026-11-07): pack.json and
// pack.sig from the address, the signature checked against the pack key (ECDSA P-256 / SHA-256, raw r||s), every named file fetched
// and checked against its sha256. Exits 1 on any failure, so a release script can refuse to go on. The release carries the pack this
// writes into the app's Assets/breakwatch/pack/.
//
//   node scripts/release/fetch-pack.mjs [<folder>]      default targets/win-host/PrismHost/Assets/breakwatch/pack
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicKey, verify, createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOST = process.env.PRISM_PACK_URL || "https://prism.entangled.world/breakwatch/";
const KEY = JSON.parse(process.env.PRISM_PACK_KEY || '{"kty":"EC","x":"LrWgoxu5PyGer3kYoG6IbqfUUy9enje0FZFh5JaBaFA","y":"1OHpA5kQ0lZfWNgrtEeo1s-6rOGjSy-kqiSiEcf9T5Y","crv":"P-256"}');
const out = process.argv[2] || join(ROOT, "targets", "win-host", "PrismHost", "Assets", "breakwatch", "pack");

const res = await fetch(HOST + "pack.json", { cache: "no-store" });
if (!res.ok) { console.error("pack.json:", res.status); process.exit(1); }
const bytes = Buffer.from(await res.arrayBuffer());
const sig = (await (await fetch(HOST + "pack.sig", { cache: "no-store" })).text()).trim();
const ok = verify("sha256", bytes, { key: createPublicKey({ key: KEY, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64"));
if (!ok) { console.error("the pack's signature does not match the pack key"); process.exit(1); }
const pack = JSON.parse(bytes.toString("utf8"));
if (pack.format !== 1 || !pack.pack) { console.error("a pack format this script does not read"); process.exit(1); }
const parts = [];
for (const m of Object.values(pack.models || {})) parts.push(m);
if (pack.pictureNet) parts.push(pack.pictureNet);
if (pack.prints) parts.push(pack.prints);
if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "files"), { recursive: true });
let total = 0;
for (const p of parts) {
  if (!/^files\/[0-9a-f]{64}\.[a-z0-9]+$/.test(p.file || "")) { console.error("a file path outside the pack:", p.file); process.exit(1); }
  const r = await fetch(HOST + p.file, { cache: "no-store" });
  if (!r.ok) { console.error(p.file, r.status); process.exit(1); }
  const b = Buffer.from(await r.arrayBuffer());
  if (createHash("sha256").update(b).digest("hex") !== p.sha256) { console.error(p.file, "does not match its hash"); process.exit(1); }
  writeFileSync(join(out, p.file), b); total += b.length;
}
writeFileSync(join(out, "pack.json"), bytes);
writeFileSync(join(out, "pack.sig"), sig);
console.log(`pack ${pack.pack} (${pack.date || ""}): ${parts.length} files, ${(total / 1048576).toFixed(2)} MB, verified, written to ${out}`);
