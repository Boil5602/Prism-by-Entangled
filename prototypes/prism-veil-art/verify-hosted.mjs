#!/usr/bin/env node
// Dev check: do exactly what the extension's start page does against the live
// host - verify list.sig over list.json with the public key from ntp.js, then
// hash-check N random images. Exit 1 on any failure.
//   node verify-hosted.mjs [base] [sampleN]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] || "https://prism.entangled.world/veil/art/";
const sampleN = +(process.argv[3] || 5);
const NAME = process.argv[4] || "list";   // e.g. iffy / sb under credibility/
const ntp = readFileSync(join(HERE, "..", "prism-veil-extension", "ntp.js"), "utf8");
const jwk = JSON.parse(/ART_PUBKEY = (\{.*?\});/.exec(ntp)[1]);
const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
const listBuf = await (await fetch(base + NAME + ".json", { cache: "no-store" })).arrayBuffer();
const sigB64 = await (await fetch(base + NAME + ".sig", { cache: "no-store" })).text();
const sig = Uint8Array.from(Buffer.from(sigB64.trim(), "base64"));
const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, listBuf);
if (!ok) { console.error("SIGNATURE INVALID"); process.exit(1); }
const idx = JSON.parse(Buffer.from(listBuf).toString("utf8"));
if (idx.entries) { console.log("signature OK; credibility list", NAME, idx.source.revid || idx.source.fetched || "", "entries", idx.entries.length); process.exit(0); }
console.log("signature OK; v", idx.v, "files", idx.files.length);
const pick = [...idx.files].sort(() => Math.random() - 0.5).slice(0, sampleN);
let bad = 0;
for (const e of pick) {
  const buf = await (await fetch(base + e.f)).arrayBuffer();
  const h = Buffer.from(await crypto.subtle.digest("SHA-256", buf)).toString("hex");
  const good = h === e.sha256; if (!good) bad++;
  console.log(good ? "ok  " : "BAD ", e.f, (buf.byteLength / 1e6).toFixed(2) + " MB");
}
process.exit(bad ? 1 : 0);
