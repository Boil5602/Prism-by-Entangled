#!/usr/bin/env node
// Sign hosted/list.json so the extension can verify the hosted index came from
// us, not from whoever controls the host. ECDSA P-256 / SHA-256, WebCrypto
// compatible (raw r||s signature), private key kept OUTSIDE the repo.
//
//   node sign-list.mjs --keygen   create the key (once) and print the public JWK
//   node sign-list.mjs [dir]      write <dir>/list.sig for <dir>/list.json (default hosted)
//
// Key file: %USERPROFILE%/.prism/veil-art-signing.pem (override with
// PRISM_ART_KEY). Public JWK is pasted into ART_PUBKEY in the extension's ntp.js.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.PRISM_ART_KEY || join(homedir(), ".prism", "veil-art-signing.pem");
const POS = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const DIR = POS[0] || "hosted";
const NAME = POS[1] || "list";   // e.g. `node sign-list.mjs hosted-cred iffy` -> iffy.json / iffy.sig
const LIST = join(HERE, DIR, NAME + ".json");
const SIG = join(HERE, DIR, NAME + ".sig");

if (process.argv.includes("--keygen")) {
  if (existsSync(KEY)) { console.error("key exists:", KEY); process.exit(1); }
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  mkdirSync(dirname(KEY), { recursive: true });
  writeFileSync(KEY, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  console.log("private key written:", KEY);
  console.log("public JWK (paste into ntp.js ART_PUBKEY):");
  console.log(JSON.stringify(publicKey.export({ format: "jwk" })));
  process.exit(0);
}

const priv = createPrivateKey(readFileSync(KEY));
const data = readFileSync(LIST);
const sig = sign("sha256", data, { key: priv, dsaEncoding: "ieee-p1363" });
writeFileSync(SIG, sig.toString("base64"));
const pub = createPublicKey(priv).export({ format: "jwk" });
console.log("signed", LIST, "->", SIG, `(${data.length} bytes) pub.x=${pub.x.slice(0, 12)}…`);
