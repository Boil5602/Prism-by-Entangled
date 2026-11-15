#!/usr/bin/env node
/*
  A rule update file checked the way the extension checks it (docs/features/rule-updates.md), with the extension's own reader
  (prototypes/prism-veil-extension/src/rules-pack.js) and, with --sig, the public keys the extension carries (read out of bg.js).

    node scripts/release/rules-check.mjs <rules.json>                    size, schema, versions
    node scripts/release/rules-check.mjs <rules.json> --sig <rules.sig>  and the signature: what the background's accept() says

  Prints one JSON line. Exit 0 when the extension of the version in the tree would take the file.
*/
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXT = path.join(ROOT, "prototypes", "prism-veil-extension");
const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--sig");
const sigFile = args.includes("--sig") ? args[args.indexOf("--sig") + 1] : "";
if (!file) { console.error("usage: rules-check.mjs <rules.json> [--sig <rules.sig>]"); process.exit(2); }

vm.runInThisContext(fs.readFileSync(path.join(EXT, "src", "rules-pack.js"), "utf8"));
const RP = globalThis.PrismRulesPack;
const version = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")).version;
const bytes = fs.readFileSync(file);
const out = { file, bytes: bytes.length, version, base: RP.BASE_SERIAL, ok: false };
const done = (code) => { console.log(JSON.stringify(out)); process.exit(code); };

if (bytes.length > RP.LIMITS.bytes) { out.error = "the file is " + bytes.length + " bytes (" + RP.LIMITS.bytes + " at most)"; done(1); }
let obj;
try { obj = JSON.parse(bytes.toString("utf8")); } catch (e) { out.error = "not JSON"; done(1); }
const v = RP.validate(obj, version);
if (!v.ok) { out.error = v.error; done(1); }
out.serial = v.rules.serial;
const d = v.rules.display;
out.counts = { slotsAdd: d.slots.add.length, slotsOff: d.slots.off.length, stacksAdd: d.stacks.add.length, stacksOff: d.stacks.off.length, badge: d.labels.badge.length, section: d.labels.section.length, noAds: d.hosts.noAds.length, labelWalkerOff: d.hosts.labelWalkerOff.length, sites: d.sites.length, kill: d.kill.length };
if (!RP.newer(v.rules.serial, RP.BASE_SERIAL)) { out.error = "the serial is not newer than the rules in the package (" + RP.BASE_SERIAL + ")"; done(1); }
// every id on the kill list names a rule the package has
const rulesSrc = fs.readFileSync(path.join(EXT, "src", "rules.js"), "utf8");
const known = new Set(Array.from(rulesSrc.matchAll(/^\s*id: "([a-z0-9-]+)",/gm)).map((m) => m[1]));
const strangers = d.kill.filter((id) => !known.has(id));
if (strangers.length) { out.error = "the kill list names rules the package does not have: " + strangers.join(", "); done(1); }

if (sigFile) {
  const bg = fs.readFileSync(path.join(EXT, "bg.js"), "utf8");
  const key = (name) => { const m = new RegExp("var " + name + " = (\\{[^}]*\\});").exec(bg); if (!m) throw new Error("no " + name + " in bg.js"); return JSON.parse(m[1]); };
  const keys = [key("PACK_PUBKEY"), key("RULES_SPARE_PUBKEY")];
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const r = await RP.accept({ bytes: ab, sig: fs.readFileSync(sigFile, "utf8"), keys, ownVersion: version, heldSerial: "", subtle: webcrypto.subtle });
  out.signature = !!(r.ok && (r.rules || r.same));
  if (!r.ok) { out.error = r.error; done(1); }
  // which of the two keys it was, so a file signed with the spare is seen for what it is
  const one = await RP.accept({ bytes: ab, sig: fs.readFileSync(sigFile, "utf8"), keys: [keys[0]], ownVersion: version, heldSerial: "", subtle: webcrypto.subtle });
  out.key = one.ok ? "pack" : "spare";
}
out.ok = true;
done(0);
