#!/usr/bin/env node
/*
  Nightly log triage (scripts/doctor, 2026-11-04, roadmap item 3): the day's host.log condensed to its shape and its oddities, sent to
  a model, back as a few lines of anomalies. Dev tooling only, the developer's key (docs/doctor.md).

    node scripts/doctor/triage.mjs [--log=<path>] [--prev] [--since=HH:MM] [--budget-kb=300] [--model=..] [--effort=high] [--dry]
    node scripts/doctor/triage.mjs --self-test          the redactor against the host's own cases (a verify step)

  What leaves the machine, and what never does. The host redacts secrets at write time (PrismHost.Core/Redact.cs, B-91); the same
  rules are ported below and run again on every line sent, in case a line was written by an older build. On top of that, the
  household's content is kept out: a JSON field that names a title, an artist, an album, a channel, a person, a device or a query is
  its length alone; an address is its host alone; the chatter that carries content (now-playing reports, the visualizer's bands, the
  phone's HTTP traffic, the store's writes) is sent as COUNTS per hour, never as lines. What goes is the per-hour count of every kind
  of line, the gaps where nothing was written, and the rare and the anomalous lines grouped by template with their count, first and
  last time and two examples. A day of 280K lines (63 MB) comes to about 300 KB.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel, CHARS_PER_TOKEN } from "./model.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };
const log = (s) => console.log("[triage] " + s);

// ---- the host's redactor, ported (PrismHost.Core/Redact.cs: the same five shapes, the same mask; RedactTests' cases in --self-test)
const MASK = "[redacted]";
const JSON_FIELD = /((?:"|\\u0022)(?:token|bearer|authorization|auth|secret|password|passwd|apikey|api_key|ticket)(?:"|\\u0022)\s*:\s*)(?:"|\\u0022)[^"\\]*(?:"|\\u0022)/gi;
const HEADER_VALUE = /((?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer|basic|token)?\s*[A-Za-z0-9._~+/=-]+/gi;
const QUERY_PARAM = /([?&](?:token|ticket|auth|key)=)[^&\s"']+/gi;
const BARE_HEX = /\b[0-9a-f]{32,}\b/gi;
const JWT = /eyJ[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]+){0,2}/g;
export function redactLine(text) {
  if (!text) return "";
  try {
    let s = text.replace(JSON_FIELD, "$1\"" + MASK + "\"");
    s = s.replace(HEADER_VALUE, "$1" + MASK);
    s = s.replace(QUERY_PARAM, "$1" + MASK);
    s = s.replace(BARE_HEX, MASK);
    s = s.replace(JWT, MASK);
    return s;
  } catch { return MASK; }
}

// ---- the household's content, kept out of what is sent (the triage's own rule; the log on disk is the host's business)
const CONTENT_FIELD = /("(?:title|artist|album|channel|program|episode|show|name|label|query|q|text|caption|description|user|email|device|station|playlist|poster|artwork|image|url|href|src)"\s*:\s*)"((?:[^"\\]|\\.)*)"/gi;
// the whole address to the next space or double quote (2026-11-05: a title's apostrophe ended the match and the rest of the path, the
// title, was left in the reduced line)
const URL = /https?:\/\/([^/\s"']+)[^\s"]*/g;
const TITLE_LIKE = /"([^"\\]*\s[^"\\]*)"/g;
const USER_PATH = /([A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\\\/\s"']+/g;
export function scrubContent(line) {
  return line.replace(CONTENT_FIELD, (m, k, v) => k + "\"~" + v.length + "\"")
    .replace(TITLE_LIKE, (m, v) => /[A-Z]/.test(v) || /\u00b7|\bago\b/.test(v) ? "\"~" + v.length + "\"" : m)   // a Capitalised multi-word string is a title (a show, a category); a lowercase sentence is a diagnostic
    .replace(URL, (m, h) => "host:" + h)
    .replace(USER_PATH, "$1~");
}

// ---- the line's kind: the first word or two after the stamp, digits folded
const CHATTER = /^(viz bands|-> \{"type":"now-playing"|<- surface\.setNowPlaying|<- surface\.setVisualizationFeed|call \{"fn":"videoState"|call \{"fn":"http"|<- http\.response|<- store\.set|<- surface\.inject|call \{"fn":"modelState"|<- surface\.evaluate|<- net\.fetchKeyed|-> \{"type":"playback"|<- surface\.setRect|<- ui\.roomStep)/;
const ANOMALY = /fail|error|exception|retry|retried|timeout|timed out|silent|stuck|slow|unhandled|warn|could not|cannot|can.t|refused|denied|lost|no audio|0\.000|not ready|crash|hang|dead|gave up|missing|again|reopen|fallback|zeros|unexpected|ignored|dropped|stale|late by|behind by/i;
function kindOf(rest) {
  const m = /^(-> \{"type":"[a-z-]+"|<- [a-z.]+[A-Za-z]*|call \{"fn":"[A-Za-z]+"|[a-z][a-z -]{0,22}[a-z]:?)/.exec(rest);
  return (m ? m[1] : rest.slice(0, 20)).replace(/[0-9]+/g, "#");
}
function template(rest) {
  return rest.replace(/"(?:[^"\\]|\\.)*"/g, "\"…\"").replace(/\b[0-9a-f]{8,}\b/gi, "#").replace(/[0-9]+(?:\.[0-9]+)?/g, "#").slice(0, 160);
}

/** The condensed day: per-hour counts by kind, gaps, and the rare / anomalous lines grouped by template. */
export function condense(text, { budgetKb = 300, since = null } = {}) {
  const lines = text.split(/\r?\n/);
  const hours = {}; const kinds = {}; const groups = new Map();
  let prevSec = null, prevT = null; const gaps = []; let first = null, last = null; let n = 0;
  for (const raw of lines) {
    const m = /^(\d\d):(\d\d):(\d\d)\.\d{3} (.*)$/.exec(raw);
    if (!m) continue;
    const t = m[1] + ":" + m[2] + ":" + m[3];
    if (since && t < since) continue;
    n++; first ??= t; last = t;
    const sec = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    if (prevSec != null && sec - prevSec >= 300) gaps.push({ from: prevT, to: t, minutes: Math.round((sec - prevSec) / 60) });
    prevSec = sec; prevT = t;
    const rest = m[4];
    const kind = kindOf(rest);
    kinds[kind] = (kinds[kind] || 0) + 1;
    (hours[m[1]] ??= {})[kind] = (hours[m[1]][kind] || 0) + 1;
    if (CHATTER.test(rest)) continue;
    const clean = scrubContent(redactLine(rest));   // the template and the examples both come from the cleaned line (a user's folder reached a template, 2026-11-04)
    const tpl = template(clean);
    let g = groups.get(tpl);
    if (!g) { g = { count: 0, first: t, last: t, kind, anomaly: ANOMALY.test(rest), examples: [] }; groups.set(tpl, g); }
    g.count++; g.last = t;
    if (g.examples.length < 2 || (g.examples.length < 3 && g.count > 50)) g.examples.push(t + " " + clean.slice(0, 300));
  }
  const topKinds = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k]) => k);
  const hourList = Object.keys(hours).sort();
  const out = [];
  out.push(`LINES ${n} from ${first} to ${last}; ${Object.keys(kinds).length} kinds of line; ${groups.size} templates outside the chatter`);
  out.push("", "GAPS (five minutes or more with nothing written):", ...(gaps.length ? gaps.map((g) => `  ${g.from} -> ${g.to} (${g.minutes} min)`) : ["  none"]));
  out.push("", "COUNTS PER HOUR, by kind of line (hour:count ...). Chatter kinds are counted here and never sent as lines.");
  for (const k of topKinds) out.push(`  ${k.padEnd(32)} ${hourList.map((h) => h + ":" + (hours[h][k] || 0)).join(" ")}`);
  // the templates: anomalous first, then rare, each with count, span and examples; the common and quiet last, counts only
  const entries = [...groups.entries()].map(([tpl, g]) => ({ tpl, ...g }));
  const anomalous = entries.filter((e) => e.anomaly).sort((a, b) => b.count - a.count);
  const rare = entries.filter((e) => !e.anomaly && e.count <= 20).sort((a, b) => a.first < b.first ? -1 : 1);
  const common = entries.filter((e) => !e.anomaly && e.count > 20).sort((a, b) => b.count - a.count);
  const block = (title, list, withExamples) => { out.push("", title); for (const e of list) { out.push(`  [${e.count}x ${e.first}..${e.last}] ${e.tpl}`); if (withExamples) for (const x of e.examples) out.push("      " + x); } };
  block(`ANOMALOUS TEMPLATES (${anomalous.length}; a word like fail, error, silent, retry, lost, 0.000 in the line):`, anomalous, true);
  block(`RARE TEMPLATES (${rare.length}; twenty lines or fewer in the day, in order of first appearance):`, rare, true);
  block(`COMMON QUIET TEMPLATES (${common.length}; counts only):`, common, false);
  let s = out.join("\n");
  if (s.length > budgetKb * 1024) {
    const cut = s.indexOf("\nCOMMON QUIET TEMPLATES");
    s = s.slice(0, Math.min(budgetKb * 1024, cut > 0 ? cut : s.length)) + "\n... (cut at the budget; raise --budget-kb for the rest)";
  }
  return { text: s, lines: n, first, last, gaps: gaps.length, templates: groups.size, anomalous: anomalous.length, rare: rare.length };
}

const SYSTEM = `You are the night reader of Prism's host log. Prism is a dashboard for a household's TV wall: a Windows host (C#) runs
web pages of streaming services in WebView2 tiles, a core (TypeScript, "the brain") decides everything, and the two talk over a
channel the host logs. One day of host.log is 200K-300K lines, so you are given its SHAPE, not its lines: counts per hour by kind
of line, gaps where nothing was written, and every line outside the chatter grouped by template with its count, its first and last
time and two examples. Secrets were redacted at write time and content (titles, names, addresses) is reduced to lengths before you
see it; a "~12" in a field is a 12-character value you were not shown.

The line grammar: HH:MM:SS.mmm then one of
  -> {json}            an event from core to the host (type: now-playing, playback, navigated, load-finished, session, buffering ...)
  <- driver.call ...   a driver call from core into the host (surface.navigate, surface.setMuted, surface.create, store.set ...)
  call {"fn":...}      a call from the host into core (videoState, modelState, http: the phone's requests)
  free text            a subsystem's own line: "process loopback:", "audio session", "listen:", "room step:", "break watch:",
                       "phone diag:", "renderer eased:", "reader dozing:", "viz sleep:", "page eme", "page console", "focus ->".

What to report: anomalies. Something that failed, retried, went silent or quiet when it should not have, repeated far more than its
neighbours, appeared for the first time, stopped appearing, took too long, or contradicts another line (a capture reporting 0.000 while
a session reports sound; a listen stream sent with no listener; a restart in the middle of playing). Read the per-hour counts as a
pulse: a kind that vanishes for an hour, or spikes, is worth a line. Gaps are the host asleep, closed or hung: say which it looks like.
Do not report chatter as such, do not restate the day, do not guess at causes the lines do not support; say what you would look at
next and which line to grep for. Severity: "look-now" means a person should read it tomorrow morning; "worth-a-look" when convenient;
"noted" is a record, not a call to act. Three to ten anomalies is the usual night; zero is a fine answer when the day was clean.

Shapes that are by design (2026-11-04, from the first night's reports), "noted" at most: "reader woke: <music page>" is the hourly
library read of a parked music page, and the page's own console errors on that load are the service's; a file that begins mid-day with
no tile creation is the log's size rotation (the earlier part is host.log.prev, read with it); a burst of open-source reads
(wikimedia, wikipedia, wikidata) right after a start is the lens warm-up, paced one a second with a rest after a 429.
Added 2026-11-05: "<- runtime.error" with nothing after it is the channel trace naming the op; the error's text is the "core error: ..."
line written beside it, so read that line, never report the error as empty. A "window: saved bounds" line followed by "seam op failed" lines
and silence is Prism being closed (the teardown's own errors), not a hang; a gap is worth a line only when it does not begin that way.`;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "anomalies", "normal", "questions"],
  properties: {
    summary: { type: "string", description: "two or three sentences on the day: what ran, what stood out" },
    anomalies: { type: "array", items: { type: "object", additionalProperties: false, required: ["when", "what", "evidence", "subsystem", "severity", "next"], properties: {
      when: { type: "string", description: "the time or span, HH:MM or HH:MM-HH:MM" },
      what: { type: "string", description: "one or two sentences, the observation" },
      evidence: { type: "array", items: { type: "string" }, description: "the templates or example lines this rests on, quoted as given" },
      subsystem: { type: "string", description: "capture, audio session, listen, room step, surfaces, phone, break watch, core channel, host ..." },
      severity: { type: "string", enum: ["look-now", "worth-a-look", "noted"] },
      next: { type: "string", description: "what to look at next: the line to grep, the file, the question to answer" },
    } } },
    normal: { type: "array", items: { type: "string" }, description: "things that looked wrong at a glance and were not, with why" },
    questions: { type: "array", items: { type: "string" }, description: "what the shape could not answer and a line of the raw log would" },
  },
};

// ---- self-test: the ported redactor against the host's own cases (PrismHost.Tests/RedactTests.cs)
if (flag("--self-test")) {
  const T = "0123456789abcdef0123456789abcdef";
  const J = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz0123456789";
  const cases = [`{"token":"${T}"}`, `{"token": "${T}"}`, `{"Authorization":"Bearer ${T}"}`, `{"bearer":"${T}"}`, `{"ticket":"${T}"}`, `{"secret":"${T}","path":"/state"}`,
    `Authorization: Bearer ${T}`, `authorization=${T}`, `GET /remote?token=${T}`, `https://10.0.0.4:8471/remote?token=${T}&x=1`, `GET /audio/stream?ticket=${T}`, `pairing minted ${T} for Phone 2`, `-> http #3 ${T}`,
    `call {"fn":"lensSetTmdbKey","args":["${J}"]}`, `tmdb: key ${J} rejected`, `body\\u0022:\\u0022${J}\\u0022`];
  let ok = true;
  for (const c of cases) { const r = redactLine(c); if (r.includes(T) || r.includes(J.slice(0, 30)) || !r.includes(MASK)) { ok = false; console.log("leaked: " + c + " -> " + r); } }
  const keep = redactLine(`call {"fn":"applyScene","args":["demo-kitchen-command"]}`);
  if (!keep.includes("demo-kitchen-command") || keep.includes(MASK)) { ok = false; console.log("over-redacted: " + keep); }
  const sc = scrubContent(`-> {"type":"now-playing","info":{"playing":true,"title":"A Song Name","artist":"Someone","url":"https://music.example.com/album/123?x=1"}}`);
  if (/Song Name|Someone|album\/123/.test(sc) || !sc.includes("\"title\":\"~11\"") || !sc.includes("\"url\":\"~39\"")) { ok = false; console.log("content kept: " + sc); }
  const bare = scrubContent("<- surface.navigate t1 https://music.example.com/album/123?x=1 done");
  const tl = scrubContent('probe "Bros in Hats · 11:48 · 1d ago" and "the show page has no episode list" at C:\\Users\\someone\\x');
  if (/Bros|someone/.test(tl) || !tl.includes("the show page has no episode list") || !tl.includes("Users\\~")) { ok = false; console.log("title kept: " + tl); }
  if (bare.includes("album/123") || !bare.includes("host:music.example.com")) { ok = false; console.log("address kept: " + bare); }
  const c = condense(["00:00:01.000 host start build 1", "00:00:02.000 viz bands 1 2 3", "00:00:03.000 process loopback: opened pid 5 raw 0.000000", "00:12:00.000 listen: sent peak 0.000 raw 0.000000 again"].join("\n"));
  if (c.lines !== 4 || c.anomalous < 1 || !c.text.includes("GAPS") || !/viz bands\s+00:1/.test(c.text) || c.text.includes("viz bands 1 2 3")) { ok = false; console.log("condense: " + JSON.stringify(c) + "\n" + c.text); }
  console.log(ok ? "triage self-test: pass" : "triage self-test: FAIL");
  process.exit(ok ? 0 : 1);
}

// ---- the day
const diag = join(process.env.LOCALAPPDATA || "", "Prism", "diagnostics");
const logPath = resolve(opt("--log", join(diag, flag("--prev") ? "host.log.prev" : "host.log")));
if (!existsSync(logPath)) { log("no log at " + logPath); process.exit(1); }
// The host rotates host.log by size, not by day, so a calendar day is spread across host.log.prev and host.log (2026-11-04: the
// older file ends at 01:07:53.531 and the newer begins at 01:07:53.771 with no restart between, and the first triage read the seam as a
// boot). Each file's lines are dated from its mtime backwards, a wrap of the time of day marking midnight (as keep.py dates them), and the
// day asked for (today, or yesterday with --prev) is taken from both files. --log=<path> reads that one file whole.
const ymd = (d) => `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;
const two = (n) => String(n).padStart(2, "0");
function datedLines(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const stamp = /^([0-9][0-9]):([0-9][0-9]):([0-9][0-9])/;
  let d = new Date(statSync(path).mtime); d.setHours(0, 0, 0, 0);
  const out = []; let later = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = stamp.exec(lines[i]); if (!m) continue;
    const sec = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    if (later !== null && sec > later + 60) d = new Date(d.getTime() - 86400000);   // the line before midnight, read backwards
    later = sec; out.push({ day: ymd(d), line: lines[i] });
  }
  return out.reverse();
}
let text;
if (opt("--log", null)) text = readFileSync(logPath, "utf8");
else {
  const target = new Date(); if (flag("--prev")) target.setDate(target.getDate() - 1); const want = ymd(target);
  const parts = [];
  for (const name of ["host.log.prev", "host.log"]) { const p = join(diag, name); if (existsSync(p)) for (const x of datedLines(p)) if (x.day === want) parts.push(x.line); }   // a loop: a spread of 300K lines overflows the stack
  text = parts.join("\n");
  log(`${want}: ${parts.length} lines of that day across host.log.prev and host.log`);
}
const c = condense(text, { budgetKb: Number(opt("--budget-kb", "300")), since: opt("--since", null) });
const now = new Date();
const day = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
const outDir = resolve(root, opt("--out", join("scripts", "doctor", "out", "triage-" + day + (flag("--prev") ? "-prev" : ""))));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "condensed.txt"), c.text);
log(`${logPath}: ${c.lines} lines ${c.first}..${c.last}, ${c.gaps} gaps, ${c.templates} templates (${c.anomalous} anomalous, ${c.rare} rare); condensed to ${(c.text.length / 1024).toFixed(0)} KB, about ${Math.round((SYSTEM.length + c.text.length) / CHARS_PER_TOKEN)} input tokens`);
const context = "(no cached context for the triage: the log's shape is the whole input)";
const answer = await callModel({ system: SYSTEM, context, userParts: [{ type: "text", text: "=== host.log, condensed (" + day + ") ===\n" + c.text }], schema: SCHEMA,
  model: opt("--model", "claude-opus-5-5"), effort: opt("--effort", "high"), maxTokens: 16000, outDir, log, dry: flag("--dry"), label: "triage" });
answer.day = day; answer.log = logPath; answer.at = new Date().toISOString();
writeFileSync(join(outDir, "triage.json"), JSON.stringify(answer, null, 2));
const sev = { "look-now": "LOOK NOW", "worth-a-look": "worth a look", "noted": "noted" };
const md = [`# Log triage ${day}`, "", answer.summary, "", `## Anomalies (${answer.anomalies.length})`, ""];
for (const a of answer.anomalies) { md.push(`- **${a.when}** ${sev[a.severity] || a.severity}, ${a.subsystem}: ${a.what}`); for (const e of a.evidence) md.push("  - `" + e.replace(/`/g, "'") + "`"); md.push(`  - next: ${a.next}`); }
if (answer.normal.length) md.push("", "## Looked wrong, was not", "", ...answer.normal.map((s) => "- " + s));
if (answer.questions.length) md.push("", "## Questions a line of the raw log would answer", "", ...answer.questions.map((s) => "- " + s));
writeFileSync(join(outDir, "triage.md"), md.join("\n") + "\n");
log("written " + join(outDir, "triage.md"));
console.log("\n" + md.join("\n"));
