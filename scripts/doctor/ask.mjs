#!/usr/bin/env node
/*
  The doctor's ask (scripts/doctor, 2026-11-03): a page's structure dump and a question go to Claude from the developer's own
  machine with the developer's own key, and a proposal comes back as files to read, prove and accept by hand. Dev tooling only:
  nothing in a shipped build of Prism or the Veil calls a model (docs/doctor.md, docs/roadmap.md "A model on the dev side").

    node scripts/doctor/ask.mjs <dump.json> --ask="the promoted posts in the feed are not covered" [--report=<inbox json>...]
         [--format=veil|adapter] [--model=claude-opus-5-5] [--effort=high] [--out=<dir>] [--dry]

  What leaves the machine: the dump (structure only, see dump.mjs), the question, the shipped rules source for context, and any
  report file named (an inbox report carries the site, the element's tags, classes and sizes and the short labels in it, as
  the Veil's own panel says). Never a page's text, never anything of the household's, never a key or a cookie.

  The key: ANTHROPIC_API_KEY in the environment, else ~/.prism/claude.env with a line ANTHROPIC_API_KEY=... (the folder the
  other publishing keys live in). --dry writes the prompt and sends nothing.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel, CHARS_PER_TOKEN } from "./model.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };
const opts = (n) => args.filter((x) => x.startsWith(n + "=")).map((x) => x.slice(n.length + 1));
const dumpPath = args.find((a) => !a.startsWith("--"));
const ask = opt("--ask", "");
if (!dumpPath || !ask) { console.log('usage: node scripts/doctor/ask.mjs <dump.json> --ask="..." [--report=file]... [--format=veil|adapter] [--model=..] [--effort=..] [--out=dir] [--dry]'); process.exit(2); }
const format = opt("--format", "veil");
const model = opt("--model", "claude-opus-5-5");
const effort = opt("--effort", "high");
const outDir = resolve(root, opt("--out", dirname(resolve(dumpPath))));
const log = (s) => console.log("[ask] " + s);

// ---- the key and the call live in model.mjs (shared with triage.mjs)

const dump = JSON.parse(readFileSync(resolve(dumpPath), "utf8"));
const reports = opts("--report").map((p) => ({ name: basename(p), body: readFileSync(resolve(p), "utf8").slice(0, 60000) }));
const veilDir = join(root, "prototypes", "prism-veil-extension");

// ---- what the model is told: the contract of a rule, the disciplines the shipped rules follow, the shape of the answer
const VEIL_SYSTEM = `You are the structure doctor for Prism Veil, a browser extension (prototypes/prism-veil-extension) that covers ads on web pages
with imagery. You read a page's STRUCTURE dump (tags, ids, classes, data-* attributes, roles, boxes, short ad labels, frame and video
hostnames) and the extension's shipped detection rules, and you propose ONE new or changed per-site rule as code, with a fixture that
proves it. A developer reads your proposal, runs it against the dump, and accepts or rejects it by hand. Nothing you write ships
untested.

The contract (src/rules.js): SITE_RULES is an array of { id, host?, run(root, ctx) }. host is a RegExp on location.hostname (use the
(^|\\.)example\\.com$ shape). run is called for the document and for every open shadow root, so query with root.querySelectorAll,
never document.querySelectorAll. ctx.add(el, why, whole) names an element to cover; why is a short string naming the rule (and the
signal, e.g. "reddit:shreddit-ad-post" or "facebook-sponsored: ads/about link"); whole = true means this element wins over anything
nested inside it. Helpers: PV.pageSized(rect) (never cover a page-sized box), PV.unitAround(el, levels) (the outermost ancestor still
the element's own size), PV.deepContains(a, b), PV.classStr(el). Wrap anything that can throw in try/catch; a rule that throws covers
nothing, which is the right failure.

The disciplines (spec section 5 and 26; every shipped rule follows them):
1. Every rule traces to a NAMED SOURCE the site itself provides: its own ad markup (an ad element name, a data attribute, an ad
   SDK's frame, a disclosure label like Sponsored/Promoted/Ad). Never a guess from layout or position alone, never a text heuristic
   that could match an article. Name the source in the rule's comment.
2. Cover the UNIT, not the inner piece: the whole ad card or player box, found from the signal by walking up to the stable
   container (the card with the label, the wrapper the size of the creative), never a volatile inner container whose id changes.
3. A cover needs a real box: check getBoundingClientRect, skip width or height of 0, skip page-sized boxes, skip anything taller
   than about 1.6 viewports (a wrapper holding several posts). Never cover inside a main video player (.html5-video-player).
4. Nothing is clicked, fetched or changed: observe only. Degrade to nothing.
5. Say what you are NOT sure of in doubts. If the dump does not show a traceable signal, say so and return rule: null rather than
   invent one.

The dump format: nodes[] in document order; each node has t (tag), p (parent index, -1 for html), d (depth), i (id), c (classes),
a (attributes: data-*, role, aria-posinset ...; href/src reduced to "host:<hostname>"; aria-label/alt/title kept only when a short
ad label, else "~<length>"), r [x, y, w, h] on the page at the time, hid (display none or hidden), pos (fixed/sticky), z (z-index),
n (own text length bucket s/m/l), x (own text, only when a short ad label), sh (a direct child of its parent's shadow root), host
(has a shadow root), kids (a long same-tag run, sampled: first 12 and last 2 kept). covers[] are the Veil's own cover elements
with their boxes (what the shipped rules cover on this page today). frames[] and videos[] list those elements with hostnames.
marks is what the Veil wrote on <html data-prism-*> (its trace).

The fixture format (tests/rules.test.mjs under happy-dom): layout is faked, so every element that matters carries
data-rect="x,y,w,h" (an element without one measures 0x0 and is never covered); give ids to the elements you expect covered and to
the controls that must NOT be covered; keep the markup minimal and taken from the dump's tags, classes and attributes. expectIds
is exactly the set of ids the rules should cover on the fixture (the shipped rules run too), notCoveredIds the ids that must stay
clear.

Answer in the JSON shape required. The rule's code is the full SITE_RULES entry as JavaScript, starting with "{" and ending with "}",
with a comment at the top in the style of the shipped rules: the source, the measured sizes from the dump, the date 2026-11-03.`;

const ADAPTER_SYSTEM = `You are the adapter doctor for Prism, a dashboard shell whose per-service behaviour lives in data files
(prism-adapters/adapters/<service>.json): named CSS selectors, control pass-throughs, and page-side scripts (strings of JavaScript run
in the service's page) that read what plays, list a library, play an item. You read a page's STRUCTURE dump and the current adapter
file and propose the smallest change that fixes what was asked, as a list of JSON-path edits with the reason for each, plus what to
check live. Disciplines: every selector names the site's own stable markup (data-testid, aria roles, ids), never a position; a
selector with an attribute value quotes it; page actions only (clicks and keys on the site's own controls), never internal functions
or private endpoints, never credentials; a change to a script keeps its shape and comments. Say what you are not sure of in doubts.
The dump format is the one in the Veil doctor: nodes[] with t, p, d, i, c, a, r, hid, pos, z, n, x, sh, host, kids.`;

const VEIL_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["summary", "source", "confidence", "rule", "fixture", "checks", "doubts"],
  properties: {
    summary: { type: "string", description: "two or three sentences: what the dump shows and what the rule does" },
    source: { type: "string", description: "the named, traceable source the rule follows (the site's own markup, label or SDK)" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    rule: {
      anyOf: [{ type: "null" }, {
        type: "object", additionalProperties: false, required: ["id", "host", "code"],
        properties: {
          id: { type: "string" },
          host: { anyOf: [{ type: "null" }, { type: "string" }], description: "the host RegExp source, e.g. (^|\\\\.)example\\\\.com$, or null for every site" },
          code: { type: "string", description: "the full SITE_RULES entry as JavaScript: { id, host, run: function (root, ctx) { ... } }" },
        },
      }],
    },
    fixture: {
      anyOf: [{ type: "null" }, {
        type: "object", additionalProperties: false, required: ["html", "expectIds", "notCoveredIds"],
        properties: { html: { type: "string" }, expectIds: { type: "array", items: { type: "string" } }, notCoveredIds: { type: "array", items: { type: "string" } } },
      }],
    },
    checks: { type: "array", items: { type: "string" }, description: "what to verify on the live site before accepting" },
    doubts: { type: "array", items: { type: "string" } },
  },
};

const ADAPTER_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["summary", "source", "confidence", "changes", "checks", "doubts"],
  properties: {
    summary: { type: "string" },
    source: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    changes: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "value", "why"], properties: { path: { type: "string", description: "the JSON path in the adapter file, e.g. selectors.player or videoContext" }, value: { type: "string" }, why: { type: "string" } } } },
    checks: { type: "array", items: { type: "string" } },
    doubts: { type: "array", items: { type: "string" } },
  },
};

// ---- the stable context (cached across asks) and the ask itself
let system, schema, context;
if (format === "veil") {
  system = VEIL_SYSTEM; schema = VEIL_SCHEMA;
  const rules = readFileSync(join(veilDir, "src", "rules.js"), "utf8");
  const tests = readFileSync(join(veilDir, "tests", "rules.test.mjs"), "utf8").slice(0, 12000);
  context = "=== src/rules.js (the shipped detection rules) ===\n" + rules + "\n\n=== tests/rules.test.mjs (the first fixtures, for the shape) ===\n" + tests;
} else if (format === "adapter") {
  system = ADAPTER_SYSTEM; schema = ADAPTER_SCHEMA;
  const adapterName = opt("--adapter", (dump.host || "").replace(/^www\./, "").split(".")[0]);
  const ap = join(root, "prism-adapters", "adapters", adapterName + ".json");
  const readme = readFileSync(join(root, "prism-adapters", "README.md"), "utf8");
  context = "=== prism-adapters/README.md ===\n" + readme + (existsSync(ap) ? "\n\n=== " + basename(ap) + " (the current adapter) ===\n" + readFileSync(ap, "utf8") : "\n\n(no adapter file yet for " + adapterName + ")");
} else { console.log("--format must be veil or adapter"); process.exit(2); }

const dumpText = JSON.stringify(dump);
const userParts = [
  { type: "text", text: "=== the page's structure dump (" + (dump.page || dump.host) + ", " + dump.at + ", Veil " + (dump.veil ?? "not installed") + ") ===\n" + dumpText },
  ...reports.map((r) => ({ type: "text", text: "=== report from the inbox: " + r.name + " ===\n" + r.body })),
  { type: "text", text: "=== the ask ===\n" + ask },
];
const approxTokens = Math.round((system.length + context.length + dumpText.length + reports.reduce((n, r) => n + r.body.length, 0) + ask.length) / CHARS_PER_TOKEN);
log(`${format} ask for ${dump.page || dump.host}: dump ${(dumpText.length / 1024).toFixed(0)} KB, context ${(context.length / 1024).toFixed(0)} KB, about ${approxTokens} input tokens, model ${model}, effort ${effort}`);

const proposal = await callModel({ system, context, userParts, schema, model, effort, outDir, log, dry: flag("--dry"), label: format + " ask" });
proposal.dump = resolve(dumpPath); proposal.ask = ask; proposal.format = format; proposal.model = model; proposal.at = new Date().toISOString();
writeFileSync(join(outDir, "proposal.json"), JSON.stringify(proposal, null, 2));

// ---- the readable copy, the rule as a file, the fixture as a test
const md = [`# Doctor proposal: ${dump.page || dump.host}`, "", `Asked: ${ask}`, "", `**Summary.** ${proposal.summary}`, "", `**Source.** ${proposal.source} (confidence ${proposal.confidence})`, ""];
if (format === "veil") {
  if (proposal.rule) {
    md.push("## Rule", "", "```js", proposal.rule.code, "```", "");
    writeFileSync(join(outDir, "rule.js"), proposal.rule.code.trim() + "\n");
  } else md.push("## Rule", "", "None proposed: the dump shows no traceable signal.", "");
  if (proposal.fixture) {
    md.push("## Fixture", "", "```html", proposal.fixture.html, "```", "", `Expect covered: ${proposal.fixture.expectIds.join(", ") || "(none)"}; must stay clear: ${proposal.fixture.notCoveredIds.join(", ") || "(none)"}`, "");
    const hostLit = JSON.stringify(dump.host || "example.com");
    writeFileSync(join(outDir, "fixture.test.mjs"), [
      `// Proposed by the doctor on ${proposal.at.slice(0, 10)} for ${dump.page || dump.host}; move into tests/rules.test.mjs once the rule is accepted.`,
      `import { describe, it, expect } from "vitest";`,
      `import { loadVeil, detect } from "./harness.mjs";`,
      ``,
      `describe(${JSON.stringify(proposal.rule?.id ?? "doctor proposal")}, () => {`,
      `  it(${JSON.stringify(proposal.summary.split(". ")[0])}, () => {`,
      `    const PV = loadVeil({ host: ${hostLit} });`,
      `    const out = detect(PV, ${JSON.stringify(proposal.fixture.html)});`,
      `    expect(out.map((o) => o.id).sort()).toEqual(${JSON.stringify([...proposal.fixture.expectIds].sort())});`,
      ...proposal.fixture.notCoveredIds.map((id) => `    expect(out.map((o) => o.id)).not.toContain(${JSON.stringify(id)});`),
      `  });`,
      `});`,
      ``,
    ].join("\n"));
  }
} else {
  md.push("## Changes", "");
  for (const c of proposal.changes) md.push(`- \`${c.path}\`: ${c.why}`, "", "  ```", "  " + c.value.replace(/\n/g, "\n  "), "  ```", "");
  writeFileSync(join(outDir, "changes.json"), JSON.stringify(proposal.changes, null, 2));
}
md.push("## Check live", "", ...proposal.checks.map((c) => "- " + c), "", "## Doubts", "", ...(proposal.doubts.length ? proposal.doubts.map((d) => "- " + d) : ["- none stated"]), "");
md.push("## Next", "", format === "veil" ? `\`node scripts/doctor/prove.mjs ${outDir}\` runs the rule against the dump and the fixture; accept by moving the rule into src/rules.js SITE_RULES and the fixture into tests/rules.test.mjs.` : "Apply the changes to the adapter file by hand, run `node scripts/audit-adapter-selectors.mjs`, then the live checks on a hidden page.", "");
writeFileSync(join(outDir, "proposal.md"), md.join("\n"));
log("written " + join(outDir, "proposal.md") + (format === "veil" && proposal.rule ? ", rule.js" : "") + (proposal.fixture ? ", fixture.test.mjs" : "") + (format === "adapter" ? ", changes.json" : ""));
log(proposal.summary);
