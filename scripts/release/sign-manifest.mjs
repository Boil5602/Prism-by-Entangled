#!/usr/bin/env node
// The Windows release manifest's signature (docs/features/updates.md, 2026-10-05): ECDSA P-256 / SHA-256, WebCrypto-compatible
// (raw r||s), the private key kept OUTSIDE the repo - the same scheme as the Veil art index (prototypes/prism-veil-art/sign-list.mjs).
// A fork makes its own key once and pastes the public JWK into its Prism's update settings (Device screen) or its build.
//
//   node scripts/release/sign-manifest.mjs --keygen          make the key (once) and print the public JWK
//   node scripts/release/sign-manifest.mjs <manifest.json>   write <manifest>.sig beside it and print the public JWK
//
// Key file: %USERPROFILE%/.prism/prism-updates-signing.pem (override with PRISM_UPDATES_KEY).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from "node:crypto";

const KEY = process.env.PRISM_UPDATES_KEY || join(homedir(), ".prism", "prism-updates-signing.pem");
const args = process.argv.slice(2);

if (args.includes("--keygen")) {
  if (existsSync(KEY)) { console.error("key exists:", KEY); process.exit(1); }
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  mkdirSync(dirname(KEY), { recursive: true });
  writeFileSync(KEY, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  console.log("private key written:", KEY);
  console.log("public JWK (the update key a Prism verifies the manifest with):");
  console.log(JSON.stringify(publicKey.export({ format: "jwk" })));
  process.exit(0);
}

const file = args.find((a) => !a.startsWith("-"));
if (!file) { console.error("usage: sign-manifest.mjs <manifest.json> | --keygen"); process.exit(2); }
const priv = createPrivateKey(readFileSync(KEY));
const data = readFileSync(file);
JSON.parse(data.toString("utf8"));   // a manifest that does not parse is not signed
const sig = sign("sha256", data, { key: priv, dsaEncoding: "ieee-p1363" });
const out = file.replace(/\.json$/i, "") + ".sig";
writeFileSync(out, sig.toString("base64"));
console.log("signed:", out);
console.log("public JWK:", JSON.stringify(createPublicKey(priv).export({ format: "jwk" })));
