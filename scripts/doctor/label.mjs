#!/usr/bin/env node
/*
  Labelling for the break detector (scripts/doctor, 2026-11-04, roadmap item 5): a kept recording of YouTube TV (diagnostics/golden/<day>/
  <window>/HHMMSSmmm.gray, 320x180 frames about one a second) marked ad or show by a vision pass, written in the format the marking page
  writes and rates.py reads (labels.json: windows.<win>.ads = [[from, to]...], .neutral = [[from, to]...]), so hours the person has not
  marked by hand can feed train.py. A batch job run when there is time to retrain, never a tool kept running (the roadmap's line), and
  never on the wall: it reads frames the person already chose to keep. What leaves the machine: the frames of the stretch asked for, as
  contact sheets of twenty, and nothing else of the household's.

    node scripts/doctor/label.mjs <golden day> <window> --from=HH:MM:SS --to=HH:MM:SS [--step=3] [--per=20] [--model=..] [--dry]
    e.g.  node scripts/doctor/label.mjs 2026-10-07 screen --from=18:00:00 --to=19:05:00

  Output in scripts/doctor/out/label-<day>-<window>-<from>/: the sheets (PNG), labels.model.json (the marks, same shape as labels.json,
  never written over the person's file), report.md (the breaks found, and when the person's labels.json covers the stretch, the
  agreement: ad seconds the person marked that the model also marked, show seconds the model called ad, and each break's edges side by
  side), usage.json. The measured agreement decides whether a model-marked hour is good enough to train on.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { loadKey } from "./model.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };
const pos = args.filter((a) => !a.startsWith("--"));
const log = (s) => console.log("[label] " + s);
if (pos.length < 2 || !opt("--from", null) || !opt("--to", null)) { console.log("usage: node scripts/doctor/label.mjs <golden day> <window> --from=HH:MM:SS --to=HH:MM:SS [--step=3] [--per=20] [--model=claude-opus-5-5] [--concurrency=3] [--dry]"); process.exit(2); }

const [day, win] = pos;
const golden = existsSync(day) ? resolve(day) : join(process.env.LOCALAPPDATA || "", "Prism", "diagnostics", "golden", day);
const frameDir = join(golden, win);
if (!existsSync(frameDir)) { log("no frames at " + frameDir); process.exit(1); }
const W = 320, H = 180, COLS = 5, GAP = 4;
const step = Number(opt("--step", "3")), per = Number(opt("--per", "20")), model = opt("--model", "claude-opus-5-5"), concurrency = Number(opt("--concurrency", "3"));
const secOf = (hms) => { const [h, m, s] = hms.split(":").map(Number); return h * 3600 + m * 60 + s; };
const hmsOf = (sec) => [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((n) => String(n).padStart(2, "0")).join(":");
const fromS = secOf(opt("--from")), toS = secOf(opt("--to"));

// ---- the frames of the stretch, one every `step` seconds (the first frame of each bucket)
const all = readdirSync(frameDir).filter((f) => /^\d{9}\.gray$/.test(f)).sort();
const picked = []; let nextAt = fromS;
for (const f of all) {
  const s = Number(f.slice(0, 2)) * 3600 + Number(f.slice(2, 4)) * 60 + Number(f.slice(4, 6));
  if (s < fromS || s > toS) continue;
  if (s >= nextAt) { picked.push({ f, s }); nextAt = s + step; }
}
if (!picked.length) { log("no frames between " + opt("--from") + " and " + opt("--to")); process.exit(1); }

// ---- a contact sheet: COLS across, rows down, 4 px white gutters, cells in time order, read left to right then down
function png(w, h, gray) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; gray.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w); }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function sheetOf(frames) {
  const rows = Math.ceil(frames.length / COLS);
  const sw = COLS * W + (COLS - 1) * GAP, sh = rows * H + (rows - 1) * GAP;
  const buf = Buffer.alloc(sw * sh, 255);
  frames.forEach((fr, k) => {
    const a = readFileSync(join(frameDir, fr.f)); if (a.length !== W * H) return;
    const cx = (k % COLS) * (W + GAP), cy = Math.floor(k / COLS) * (H + GAP);
    for (let y = 0; y < H; y++) a.copy(buf, (cy + y) * sw + cx, y * W, (y + 1) * W);
  });
  return png(sw, sh, buf);
}
const sheets = [];
for (let i = 0; i < picked.length; i += per) sheets.push(picked.slice(i, i + per));
const outDir = resolve(root, opt("--out", join("scripts", "doctor", "out", `label-${day}-${win}-${opt("--from").replace(/:/g, "")}`)));
mkdirSync(outDir, { recursive: true });
log(`${picked.length} frames of ${win} ${opt("--from")}..${opt("--to")} every ${step} s, ${sheets.length} sheets of ${per}; model ${model}`);

const SYSTEM = `You label frames of live television for a household's TV wall, which covers ad breaks with art and must never cover the
show. Each image is a contact sheet of grayscale frames from one channel on YouTube TV, in time order, read left to right and then
down: five columns, four rows, cells numbered 1 to 20 (a last sheet may be shorter). The frames are a few seconds apart, and the
times of the cells are given in the text. You answer with a kind for EVERY cell:
  "ad"    a commercial; also the network's own promo for other shows, a sponsor card, a station ident with no programme content.
          A break is marked whole, promos with the ads; scripts/doctor/promos.mjs then tells the promos apart (since 2026-11-04 they
          are not covered: PROMOS=show).
  "show"  the programme itself in any form: its scenes, its opening, its credits, its rating card (TV-14 and the like), a banner or
          a snipe over the show, a sports broadcast's studio, replays and score graphics, a news programme's desk and field pieces,
          the channel's logo bug in a corner over programme content.
  "unsure" when you cannot tell from the frame and its neighbours.
Clues: the channel's logo bug in a corner is on the show and almost never on an ad; ads carry brand names, prices, phone numbers,
legal small print, "paid for by", a product on a plain background; a break usually runs two to five minutes and holds several
different ads back to back; a promo looks like a show but carries the network's name, a premiere date or "all new" text. Use the
neighbours: an ad break does not flicker to the show for one frame and back. When a cell is the first ad after show, or the first
show after ads, say so in the note with its number; those edges are what the labels are for.`;
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["cells", "note"],
  properties: {
    cells: { type: "array", items: { type: "object", additionalProperties: false, required: ["i", "kind"], properties: { i: { type: "integer" }, kind: { type: "string", enum: ["ad", "show", "unsure"] } } } },
    note: { type: "string", description: "the edges seen (cell numbers), the channel if its bug is readable, anything odd; one or two lines" },
  },
};

// ---- the calls, a few at a time, each sheet with its cell times and the kind the previous sheet ended on
if (flag("--dry")) { sheets.forEach((s, i) => writeFileSync(join(outDir, `sheet-${String(i + 1).padStart(3, "0")}.png`), sheetOf(s))); log("dry run: " + sheets.length + " sheets written to " + outDir + ", nothing sent"); process.exit(0); }
if (!loadKey()) { log("no key: set ANTHROPIC_API_KEY or write ~/.prism/claude.env"); process.exit(1); }
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const client = new Anthropic();
const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, calls: 0 };
const results = new Array(sheets.length);
async function labelSheet(i) {
  const frames = sheets[i];
  const pngBuf = sheetOf(frames);
  writeFileSync(join(outDir, `sheet-${String(i + 1).padStart(3, "0")}.png`), pngBuf);
  const prev = i > 0 && results[i - 1] ? results[i - 1].cells.at(-1)?.kind : null;
  const text = `Sheet ${i + 1} of ${sheets.length}, window ${win}, ${day}. Cells and their times: ` + frames.map((fr, k) => `${k + 1}=${hmsOf(fr.s)}`).join(" ") +
    (prev ? `. The frame before cell 1 (the last cell of the previous sheet) was labelled "${prev}".` : ". This is the first sheet.") + ` Label every cell 1..${frames.length}.`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const msg = await client.messages.create({
        model, max_tokens: 2000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: pngBuf.toString("base64") } }, { type: "text", text }] }],
      });
      const u = msg.usage; usage.input_tokens += u.input_tokens; usage.output_tokens += u.output_tokens; usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0; usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0; usage.calls++;
      if (msg.stop_reason !== "end_turn") throw new Error("stop " + msg.stop_reason);
      const ans = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
      const cells = frames.map((fr, k) => ({ s: fr.s, kind: ans.cells.find((c) => c.i === k + 1)?.kind ?? "unsure" }));
      results[i] = { cells, note: ans.note };
      process.stdout.write(cells.map((c) => c.kind === "ad" ? "A" : c.kind === "show" ? "." : "?").join("") + " ");
      return;
    } catch (e) {
      const wait = e?.status === 429 || e?.status >= 500 ? 15000 * attempt : 0;
      if (attempt === 3 || !wait) { log(`sheet ${i + 1} failed: ${e?.message ?? e}`); results[i] = { cells: frames.map((fr) => ({ s: fr.s, kind: "unsure" })), note: "failed: " + (e?.message ?? e) }; return; }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
// sequential within a lane so each sheet can see the previous one's last kind; `concurrency` lanes over interleaved sheets would lose
// that, so the lanes take consecutive blocks instead
const lanes = Math.max(1, Math.min(concurrency, sheets.length));
const blocks = []; const size = Math.ceil(sheets.length / lanes);
for (let l = 0; l < lanes; l++) blocks.push([l * size, Math.min(sheets.length, (l + 1) * size)]);
await Promise.all(blocks.map(async ([a, b]) => { for (let i = a; i < b; i++) await labelSheet(i); }));
process.stdout.write("\n");
log(`${usage.calls} calls: ${usage.input_tokens} in (${usage.cache_read_input_tokens} from cache, ${usage.cache_creation_input_tokens} written), ${usage.output_tokens} out`);
writeFileSync(join(outDir, "usage.json"), JSON.stringify({ model, at: new Date().toISOString(), usage }, null, 2));

// ---- the marks: runs of ad become breaks; a one-sample show inside ads is bridged; a one-sample ad inside the show is dropped; unsure runs are neutral
const cells = results.flatMap((r) => r.cells);
for (let i = 1; i < cells.length - 1; i++) if (cells[i].kind !== cells[i - 1].kind && cells[i - 1].kind === cells[i + 1].kind && cells[i].kind !== "unsure") cells[i].kind = cells[i - 1].kind;
let runs = [];
for (const c of cells) { const last = runs.at(-1); if (last && last.kind === c.kind) last.to = c.s; else runs.push({ kind: c.kind, from: c.s, to: c.s }); }
// a break does not end for a few seconds and resume: a show run of three samples or fewer between two ad runs is part of the break
// (the FX hour of 2026-10-07: one break came back split by a six-second "show" at 18:30:07, which the person had marked through)
for (let i = 1; i < runs.length - 1; i++) if (runs[i].kind === "show" && runs[i - 1].kind === "ad" && runs[i + 1].kind === "ad" && runs[i].to - runs[i].from <= step * 2) { runs[i - 1].to = runs[i + 1].to; runs.splice(i, 2); i--; }
const ads = runs.filter((r) => r.kind === "ad").map((r) => [hmsOf(r.from), hmsOf(Math.min(toS, r.to + step - 1))]);
const neutral = runs.filter((r) => r.kind === "unsure").map((r) => [hmsOf(r.from), hmsOf(Math.min(toS, r.to + step - 1))]);
const labels = { windows: { [win]: { name: win, ads, neutral } }, from: opt("--from"), to: opt("--to"), since: opt("--from"), by: "label.mjs " + model, at: new Date().toISOString() };
writeFileSync(join(outDir, "labels.model.json"), JSON.stringify(labels, null, 1));

// ---- the report, with the agreement when the person marked this stretch
const md = [`# Labels by model: ${day} ${win} ${opt("--from")}..${opt("--to")}`, "", `${picked.length} frames every ${step} s on ${sheets.length} sheets; ${ads.length} breaks found, ${neutral.length} unsure stretches; model ${model}.`, "", "## Breaks", ""];
for (const [a, b] of ads) md.push(`- ${a} to ${b} (${secOf(b) - secOf(a) + 1} s)`);
if (neutral.length) { md.push("", "## Unsure", ""); for (const [a, b] of neutral) md.push(`- ${a} to ${b}`); }
const personFile = join(golden, "labels.json");
if (existsSync(personFile)) {
  const pj = JSON.parse(readFileSync(personFile, "utf8"));
  const pw = pj.windows?.[win];
  if (pw) {
    const inStretch = (span) => secOf(span[1]) >= fromS && secOf(span[0]) <= toS;
    const P = new Set(), N = new Set(), M = new Set();
    const mark = (set, spans) => { for (const [a, b] of spans) for (let s = Math.max(fromS, secOf(a)); s <= Math.min(toS, secOf(b)); s++) set.add(s); };
    mark(P, pw.ads.filter(inStretch)); mark(N, (pw.neutral || []).filter(inStretch)); mark(M, ads);
    let hit = 0, miss = 0, wrong = 0, showSec = 0;
    for (let s = fromS; s <= toS; s++) { if (N.has(s)) continue; if (P.has(s)) { if (M.has(s)) hit++; else miss++; } else { showSec++; if (M.has(s)) wrong++; } }
    md.push("", "## Agreement with the person's marks", "", `- ad time the person marked: ${hit + miss} s; the model marked ${hit} s of it (${((100 * hit) / Math.max(1, hit + miss)).toFixed(1)}%), missed ${miss} s`,
      `- show time: ${showSec} s; the model called ${wrong} s of it ad (${((100 * wrong) / Math.max(1, showSec)).toFixed(2)}%)`, `- neutral (left out of the score): ${N.size} s`, "", "| person's break | model's nearest | start delta | end delta |", "|---|---|---|---|");
    for (const [a, b] of pw.ads.filter(inStretch)) {
      const pa = secOf(a), pb = secOf(b);
      const near = ads.map(([x, y]) => [secOf(x), secOf(y)]).filter(([x, y]) => y >= pa - 60 && x <= pb + 60).sort((u, v) => Math.abs(u[0] - pa) - Math.abs(v[0] - pa))[0];
      md.push(`| ${a} to ${b} | ${near ? hmsOf(near[0]) + " to " + hmsOf(near[1]) : "(none)"} | ${near ? (near[0] - pa >= 0 ? "+" : "") + (near[0] - pa) + " s" : ""} | ${near ? (near[1] - pb >= 0 ? "+" : "") + (near[1] - pb) + " s" : ""} |`);
    }
    for (const [x, y] of ads) if (!pw.ads.filter(inStretch).some(([a, b]) => secOf(b) >= secOf(x) - 60 && secOf(a) <= secOf(y) + 60)) md.push(`| (none) | ${x} to ${y} | | |`);
  } else md.push("", `(the person's labels.json has no window "${win}"; windows: ${Object.keys(pj.windows || {}).join(", ")})`);
} else md.push("", "(no labels.json beside the recording: nothing to compare with)");
md.push("", "## Notes from the sheets", "", ...results.map((r, i) => `- sheet ${i + 1}: ${r.note}`));
writeFileSync(join(outDir, "report.md"), md.join("\n") + "\n");
log("written " + join(outDir, "report.md"));
console.log("\n" + md.slice(0, md.findIndex((l) => l === "## Notes from the sheets")).join("\n"));
