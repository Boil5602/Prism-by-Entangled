#!/usr/bin/env node
/**
 * The brand is written PRISM (2026-11-10). Everywhere a person reads the name - the app, the extension, the phone and listen pages,
 * the docs, the notes of a release - the word is in capitals. This fails on the word in mixed case anywhere in the tracked text files,
 * with these named exceptions, which are identifiers and not labels:
 *
 *   a path part            %LOCALAPPDATA%\Prism, Programs\Prism, Programs\Prism.next, C:\Prism, oem/Prism/ (storage is never moved, spec 10)
 *   a file or repo name    Prism-by-Entangled, Prism-<version>-<commit>.zip, Prism-backup-<stamp>, Prism.png
 *   the User-Agent         Prism/<version> (docs/network.md)
 *   the playlist mark      "Prism:" at the head of a TMDB list comment, with the comments written in docs and tests (docs/features/playlists.md)
 *   names Windows keeps    the Run value, the scheduled tasks' names
 *   the parked shells      shells/android, and the answer file of the daemon's Windows media
 *
 * Compound identifiers (PrismHost, PrismRuntime, PrismOS) and the lower-case word are never looked at.
 *
 *   node scripts/audit-brand.mjs            exit 0 pass, 1 fail (each offender as file:line)
 *   node scripts/audit-brand.mjs --fix      rewrite the offenders in place, byte for byte (the encodings and line ends of a file stay)
 *   node scripts/audit-brand.mjs --kept     list what the exceptions keep
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const FIX = process.argv.includes("--fix"), KEPT = process.argv.includes("--kept");
const BS = String.fromCharCode(92);
const OLD = "Pr" + "ism", NEW = "PRISM";

const binary = /\.(png|jpe?g|webp|gif|ico|icns|bmp|mp3|ogg|wav|mp4|webm|onnx|bin|woff2?|ttf|otf|zip|pdf|xpi|pb|npz|pkl|jar|keystore|dll|exe|pri|xbf|logo)$/i;
const skipped = (f) => f.startsWith("shells/android/") || f === "shells/daemon/windows/autounattend.xml" || f === "scripts/audit-brand.mjs"
  || f === "scripts/release/quotes-ok.txt" || /(^|\/)(vendor|node_modules)\//.test(f) || /(^|\/)package-lock\.json$/.test(f);

const proseAfterHyphen = /^-(ordered|made|wide|owned|named|decided|invented|rendered|written|only|side|drawn|built|run|hosted|level|specific)\b/;
const pathMarker = /(LOCALAPPDATA|LocalApplicationData|SpecialFolder\.\w+\)?|"Programs"|join\(local|PRISM_DATA_DIR"\) or os\.path\.join\(os\.environ\["LOCALAPPDATA"\])[^\n]{0,12}$/;
const windowsName = /^ (break-watch (evening labels|sampler|idle sampler)|doctor nightly|keep the console)\b/;

/** Why this occurrence keeps its mixed case, or "" when it is a label. `s` is the file as latin1, `i` the index of the word. */
function kept(s, i) {
  const pre = s[i - 1] ?? "", post = s[i + OLD.length] ?? "", after = s.slice(i + OLD.length, i + OLD.length + 40), before = s.slice(Math.max(0, i - 64), i);
  if (pre === BS) return "path";
  if (pre === "/" && !/^ identities/.test(after)) return "path";
  if (post === "/") return "user-agent or path";
  if (post === BS && !/^.(u[0-9A-Fa-f]{4}|['"]s|r\\n)/.test(after)) return "path";
  if (post === "-" && !proseAfterHyphen.test(after)) return "file name";
  if (post === "." && /^\.[a-z]/.test(after)) return "file name";
  if (post === ":" && /^:( (episodes|watched|\d{4}-\d\d)|";)/.test(after)) return "playlist mark";
  if (/["'`]/.test(pre) && /["'`]/.test(post) && pathMarker.test(before.slice(0, -1))) return "path";
  if (/["'`]/.test(pre) && /["'`]/.test(post) && /(RunValueName = |"User-Agent": )$/.test(before.slice(0, -1))) return "name Windows or a server keeps";
  if (windowsName.test(after)) return "scheduled task";
  return "";
}

const files = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter((f) => f && !binary.test(f) && !skipped(f));
const word = new RegExp("(?<![A-Za-z0-9_])" + OLD + "(?![A-Za-z0-9_])", "g");
const offenders = [], keeps = []; let changed = 0, filesChanged = 0;
for (const f of files) {
  let buf; try { buf = readFileSync(join(root, f)); } catch { continue; }
  if (buf.subarray(0, 4000).includes(0)) continue;
  const s = buf.toString("latin1");
  if (!s.includes(OLD)) continue;
  let out = "", last = 0, n = 0, m;
  word.lastIndex = 0;
  while ((m = word.exec(s))) {
    const why = kept(s, m.index);
    const line = s.slice(0, m.index).split("\n").length;
    if (why) { keeps.push(`${f}:${line}: (${why}) ${s.slice(Math.max(0, m.index - 40), m.index + 45).replace(/[\r\n]+/g, " ")}`); continue; }
    offenders.push(`${f}:${line}: ${s.slice(Math.max(0, m.index - 40), m.index + 45).replace(/[\r\n]+/g, " ")}`);
    out += s.slice(last, m.index) + NEW; last = m.index + OLD.length; n++;
  }
  if (FIX && n) { writeFileSync(join(root, f), Buffer.from(out + s.slice(last), "latin1")); changed += n; filesChanged++; }
}
if (KEPT) { for (const k of keeps) console.log(k); console.log(keeps.length + " kept by a named exception"); process.exit(0); }
if (FIX) { console.log(`brand: ${changed} rewritten in ${filesChanged} files; ${keeps.length} kept by a named exception`); process.exit(0); }
if (offenders.length) {
  for (const o of offenders.slice(0, 60)) console.log(o);
  console.log(`brand audit: ${offenders.length} place${offenders.length === 1 ? "" : "s"} write the brand in mixed case. Write ${NEW}, or run node scripts/audit-brand.mjs --fix`);
  process.exit(1);
}
console.log(`brand audit: pass (${keeps.length} kept by a named exception)`);
