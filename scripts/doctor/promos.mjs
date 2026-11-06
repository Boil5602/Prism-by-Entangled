#!/usr/bin/env node
/*
  Network promos told apart from commercials (scripts/doctor, 2026-11-04: the owner chose to stop covering the networks' own promos, which
  the break marks had included since 2026-10-08). Reads a golden day's marked breaks (labels.json ads) and nothing else, puts their
  frames on contact sheets of twenty, one every `step` seconds, and asks a vision pass to call each frame a commercial, a promo, the show,
  or unsure. Writes golden/<day>/labels.promos.json, beside the person's labels and never over them:
    windows.<win>.promos  = [[from, to] ...]   a promo inside a marked break (the network's or the service's own programming, no sponsor)
    windows.<win>.cells   = [[hh:mm:ss, kind] ...]   every frame's call, for the spot-check
  rates.py and train2.py read it with PROMOS=show: a promo second counts as show, not ad.

    node scripts/doctor/promos.mjs <golden day> [--windows=a,b] [--step=4] [--limit=N breaks a window] [--concurrency=4] [--dry]
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
const log = (s) => console.log("[promos] " + s);
if (pos.length < 1) { console.log("usage: node scripts/doctor/promos.mjs <golden day> [--windows=a,b] [--step=4] [--limit=N] [--dry]"); process.exit(1); }
const day = pos[0];
const golden = join(process.env.LOCALAPPDATA || "", "Prism", "diagnostics", "golden", day);
// --labels=<file in the day folder>: the spans to sort (labels.candidates.json from autobreaks.py for a sampled night); labels.json otherwise
const AUTO = !!opt("--labels", null);
// --recheck-promos (2026-11-05, the owner's choice to cover streaming services' advertising, a network's own sister service included): only
// the time already called promo (labels.promos.json and labels.auto.json) is sorted again, several promos packed on a sheet, and what is
// now streaming or commercial goes to golden/<day>/labels.promos-recheck.json (windows.<win>.ads), which promos.py takes off the promos
const RECHECK = flag("--recheck-promos");
function promoSpans() {
  const toS = (h) => h.split(":").reduce((t, x) => t * 60 + Number(x), 0), toH = (v) => [Math.floor(v / 3600), Math.floor(v / 60) % 60, v % 60].map((n) => String(n).padStart(2, "0")).join(":");
  const by = {};
  for (const f of ["labels.promos.json", "labels.auto.json"]) {
    const p = join(golden, f); if (!existsSync(p)) continue;
    for (const [win, v] of Object.entries(JSON.parse(readFileSync(p, "utf8")).windows || {})) for (const [a, b] of v.promos || []) (by[win] ??= []).push([toS(a), toS(b)]);
  }
  const windows = {};
  for (const [win, sp] of Object.entries(by)) {
    sp.sort((x, y) => x[0] - y[0]); const m = [];
    for (const [a, b] of sp) { if (m.length && a <= m[m.length - 1][1]) m[m.length - 1][1] = Math.max(m[m.length - 1][1], b); else m.push([a, b]); }
    windows[win] = { ads: m.map(([a, b]) => [toH(a), toH(b)]) };
  }
  return { windows };
}
const labels = RECHECK ? promoSpans() : JSON.parse(readFileSync(join(golden, opt("--labels", "labels.json")), "utf8"));
const maxSheets = Number(opt("--max-sheets", "0"));
const W = 320, H = 180, COLS = 5, GAP = 4, PER = 20;
const step = Number(opt("--step", "4")), model = opt("--model", "claude-opus-5-5"), concurrency = Number(opt("--concurrency", "4"));
const limit = Number(opt("--limit", "0"));
const want = opt("--windows", null)?.split(",");
const secOf = (hms) => { const [h, m, s] = hms.split(":").map(Number); return h * 3600 + m * 60 + s; };
const hmsOf = (sec) => [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((n) => String(n).padStart(2, "0")).join(":");
const outDir = resolve(root, "scripts", "doctor", "out", (RECHECK ? "promos-recheck-" : "promos-") + day); mkdirSync(outDir, { recursive: true });

function png(w, h, gray) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; gray.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w); }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function sheetOf(dir, frames) {
  const rows = Math.ceil(frames.length / COLS);
  const sw = COLS * W + (COLS - 1) * GAP, sh = rows * H + (rows - 1) * GAP;
  const buf = Buffer.alloc(sw * sh, 255);
  frames.forEach((fr, k) => {
    const a = readFileSync(join(dir, fr.f)); if (a.length !== W * H) return;
    const cx = (k % COLS) * (W + GAP), cy = Math.floor(k / COLS) * (H + GAP);
    for (let y = 0; y < H; y++) a.copy(buf, (cy + y) * sw + cx, y * W, (y + 1) * W);
  });
  return png(sw, sh, buf);
}

// every sheet: one window's frames inside its marked breaks, a break at a time, never two breaks on a sheet
const jobs = [];
for (const [win, v] of Object.entries(labels.windows)) {
  if (want && !want.includes(win)) continue;
  const dir = join(golden, win); if (!existsSync(dir)) continue;
  const all = readdirSync(dir).filter((f) => /^\d{9}\.gray$/.test(f)).sort().map((f) => ({ f, s: Number(f.slice(0, 2)) * 3600 + Number(f.slice(2, 4)) * 60 + Number(f.slice(4, 6)) }));
  let breaks = (v.ads || []).map(([a, b]) => [secOf(a), secOf(b)]).filter(([a, b]) => b > a);
  if (limit) breaks = breaks.slice(0, limit);
  if (RECHECK) {
    // the promos packed onto sheets: a promo is never split across two sheets unless it alone fills more than one
    let cur = null;
    breaks.forEach(([a, b], bi) => {
      const picked = []; let nextAt = a;
      for (const fr of all) { if (fr.s < a || fr.s > b) continue; if (fr.s >= nextAt) { picked.push(fr); nextAt = fr.s + step; } }
      for (let i = 0; i < picked.length; i += PER) {
        const part = picked.slice(i, i + PER);
        if (!cur || cur.frames.length + part.length > PER) { cur = { win, dir, brk: bi, of: breaks.length, span: [a, b], frames: [], part: 0, spans: [] }; jobs.push(cur); }
        cur.spans.push({ from: cur.frames.length, n: part.length, span: [i === 0 ? a : part[0].s, i + PER < picked.length ? picked[i + PER].s : b] });
        cur.frames.push(...part);
      }
    });
    continue;
  }
  breaks.forEach(([a, b], bi) => {
    const picked = []; let nextAt = a;
    for (const fr of all) { if (fr.s < a || fr.s > b) continue; if (fr.s >= nextAt) { picked.push(fr); nextAt = fr.s + step; } }
    for (let i = 0; i < picked.length; i += PER) jobs.push({ win, dir, brk: bi, of: breaks.length, span: [a, b], frames: picked.slice(i, i + PER), part: i / PER });
  });
}
if (maxSheets && jobs.length > maxSheets) { log(`${jobs.length} sheets; the first ${maxSheets} only (--max-sheets)`); jobs.length = maxSheets; }
log(`${day}: ${jobs.length} sheets over ${new Set(jobs.map((j) => j.win + j.brk)).size} breaks, a frame every ${step} s; model ${model}`);
if (flag("--dry")) { jobs.slice(0, 3).forEach((j, i) => writeFileSync(join(outDir, `dry-${i + 1}.png`), sheetOf(j.dir, j.frames))); log("dry: three sheets written, nothing sent"); process.exit(0); }

const SYSTEM = `You sort the frames of television ad breaks for a household's TV wall, which covers commercials with art and leaves
everything else alone. Each image is a contact sheet of grayscale frames from one channel on YouTube TV, all from inside one marked
break, in time order, read left to right and then down: five columns, up to four rows, cells numbered from 1. The frames are a few
seconds apart; their times are in the text. Call EVERY cell one of:
  "commercial"  advertising for a product, service, brand, business, political campaign or cause: brand names, prices, phone numbers,
                web addresses, legal small print, "paid for by", a product on a plain background. Also a promo that carries a sponsor
                ("presented by", "brought to you by", a brand's logo beside the show's): it is advertising, so it stays covered. Also the
                break's own filler, held where an ad would play: YouTube TV's name with "Enjoy the zen. We'll be right back." over still
                scenery, or any such slate that only says the programme will return - it is the break, not the channel's promotion.
  "promo"       the channel's or network's own promotion of its programming, with no sponsor: a trailer or teaser for one of its shows,
                "all new", "next", "tonight at 9", a premiere date, the network's name or logo card over show footage, a station or
                network ident or bumper, a news channel's promo for its anchors. It sends you to THIS channel.
  "streaming"   advertising for a streaming service or app, the channel's own sister service included: "streaming on Paramount+",
                "only on Netflix", "now streaming on Peacock", a streaming service's logo or end card, a trailer for a title that sends
                you to a streaming service rather than to this channel. It is covered like a commercial.
  "show"        the programme itself (the break's edge can catch a few seconds of it): its scenes, its titles or credits, its rating card.
  "unsure"      when the frame and its neighbours do not tell.
Use the neighbours: a commercial or a promo runs for 10 to 60 seconds, so a single cell rarely differs from both sides. A promo looks
like a show but is cut like a trailer, carries the network's branding and a time or date; a show's own scene in a promo is still
"promo". A promo ends on the channel (a day and time, "next", "all new" on the network); a spot that ends on a streaming service's
name or logo is "streaming", even when the channel and the service are one company's. When unsure between promo and commercial or
streaming, choose "commercial" or "streaming".`;
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["cells", "note"],
  properties: {
    cells: { type: "array", items: { type: "object", additionalProperties: false, required: ["i", "kind"], properties: { i: { type: "integer" }, kind: { type: "string", enum: ["commercial", "streaming", "promo", "show", "unsure"] } } } },
    note: { type: "string", description: "the promos seen (cell numbers and what they promote), anything odd; one or two lines" },
  },
};

if (!loadKey()) { log("no key: set ANTHROPIC_API_KEY or write ~/.prism/claude.env"); process.exit(1); }
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const client = new Anthropic();
const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, calls: 0 };
const results = new Array(jobs.length);
async function sortSheet(i) {
  const j = jobs[i];
  const pngBuf = sheetOf(j.dir, j.frames);
  const text = j.spans ? `Window ${j.win}, ${day}: every cell on this sheet was called a promo before, and is sorted again. The sheet holds ${j.spans.length} separate stretches, each from a different moment: ` +
    j.spans.map((sp, n) => `stretch ${n + 1} = cells ${sp.from + 1}-${sp.from + sp.n}`).join(", ") + `. Cells and their times: ` + j.frames.map((fr, k) => `${k + 1}=${hmsOf(fr.s)}`).join(" ") +
    `. Use neighbours only within a stretch. Call every cell 1..${j.frames.length}.` : `Window ${j.win}, ${day}: break ${j.brk + 1} of ${j.of}, marked ${hmsOf(j.span[0])} to ${hmsOf(j.span[1])}; sheet ${j.part + 1} of it. Cells and their times: ` +
    j.frames.map((fr, k) => `${k + 1}=${hmsOf(fr.s)}`).join(" ") + `. Call every cell 1..${j.frames.length}.`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const msg = await client.messages.create({
        model, max_tokens: 2000, thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: pngBuf.toString("base64") } }, { type: "text", text }] }],
      });
      const u = msg.usage; usage.input_tokens += u.input_tokens; usage.output_tokens += u.output_tokens; usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0; usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0; usage.calls++;
      if (msg.stop_reason !== "end_turn") throw new Error("stop " + msg.stop_reason);
      const ans = JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
      results[i] = { cells: j.frames.map((fr, k) => ({ s: fr.s, kind: ans.cells.find((c) => c.i === k + 1)?.kind ?? "unsure" })), note: ans.note };
      process.stdout.write(results[i].cells.map((c) => c.kind === "promo" ? "P" : c.kind === "streaming" ? "S" : c.kind === "commercial" ? "c" : c.kind === "show" ? "." : "?").join("") + " ");
      if (results[i].cells.some((c) => c.kind === "promo" || c.kind === "streaming")) writeFileSync(join(outDir, `${j.win}-${hmsOf(j.span[0]).replace(/:/g, "")}-${j.part + 1}.png`), pngBuf);   // the sheets with promos, for the spot-check
      return;
    } catch (e) {
      const wait = e?.status === 429 || e?.status >= 500 ? 15000 * attempt : 0;
      if (attempt === 3 || !wait) { log(`sheet ${i + 1} failed: ${e?.message ?? e}`); results[i] = { cells: j.frames.map((fr) => ({ s: fr.s, kind: "unsure" })), note: "failed" }; return; }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => { while (next < jobs.length) { const i = next++; await sortSheet(i); } }));
process.stdout.write("\n");
log(`${usage.calls} calls: ${usage.input_tokens} in (${usage.cache_read_input_tokens} from cache), ${usage.output_tokens} out`);
writeFileSync(join(outDir, "usage.json"), JSON.stringify({ model, at: new Date().toISOString(), usage }, null, 2));

if (RECHECK) {
  // each stretch's cells smoothed within it; a run called streaming or commercial is taken off the promos
  const rc = { day, by: "promos.mjs --recheck-promos " + model, at: new Date().toISOString(), step, windows: {} };
  const isAd = (kd) => kd === "streaming" || kd === "commercial";
  let gone = 0, total = 0; const tally = {};
  jobs.forEach((j, i) => {
    const cells = results[i]?.cells ?? j.frames.map((fr) => ({ s: fr.s, kind: "unsure" }));
    const w = (rc.windows[j.win] ??= { ads: [], cells: [] });
    for (const sp of j.spans) {
      const cs = cells.slice(sp.from, sp.from + sp.n); total += sp.span[1] - sp.span[0];
      for (let q = 1; q < cs.length - 1; q++) if (cs[q].kind !== cs[q - 1].kind && cs[q - 1].kind === cs[q + 1].kind) cs[q].kind = cs[q - 1].kind;
      cs.forEach((c) => { w.cells.push([hmsOf(c.s), c.kind]); tally[c.kind] = (tally[c.kind] || 0) + 1; });
      for (let q = 0; q < cs.length; q++) {
        if (!isAd(cs[q].kind)) continue;
        let k = q; while (k + 1 < cs.length && isAd(cs[k + 1].kind)) k++;
        const from = q === 0 ? sp.span[0] : cs[q].s, to = k + 1 < cs.length ? cs[k + 1].s : sp.span[1];
        w.ads.push([hmsOf(from), hmsOf(to)]); gone += to - from; q = k;
      }
    }
  });
  writeFileSync(join(golden, "labels.promos-recheck.json"), JSON.stringify(rc, null, 1));
  writeFileSync(join(outDir, "labels.promos-recheck.json"), JSON.stringify(rc, null, 1));
  log(`recheck: ${gone} s of ${total} s of promo time is now streaming or commercial (${(100 * gone / Math.max(1, total)).toFixed(1)}%); cells ${JSON.stringify(tally)}; written to ${join(golden, "labels.promos-recheck.json")}`);
  process.exit(0);
}

// ---- the promos: per break, runs of promo cells; a lone cell different from both neighbours takes theirs; a promo run is kept from its
// first cell to the next cell's time (or the break's end), so its seconds are whole
const out = { day, by: "promos.mjs " + model, at: new Date().toISOString(), step, windows: {} };
const byBreak = new Map();
jobs.forEach((j, i) => { const k = j.win + "|" + j.brk; if (!byBreak.has(k)) byBreak.set(k, { win: j.win, span: j.span, cells: [] }); byBreak.get(k).cells.push(...(results[i]?.cells ?? [])); });
let promoSec = 0, adSec = 0;
for (const { win, span, cells } of byBreak.values()) {
  for (let i = 1; i < cells.length - 1; i++) if (cells[i].kind !== cells[i - 1].kind && cells[i - 1].kind === cells[i + 1].kind) cells[i].kind = cells[i - 1].kind;
  const w = (out.windows[win] ??= { promos: [], cells: [] });
  cells.forEach((c) => w.cells.push([hmsOf(c.s), c.kind]));
  adSec += span[1] - span[0];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].kind !== "promo") continue;
    let k = i; while (k + 1 < cells.length && cells[k + 1].kind === "promo") k++;
    const from = cells[i].s, to = k + 1 < cells.length ? cells[k + 1].s : span[1];
    w.promos.push([hmsOf(from), hmsOf(to)]); promoSec += to - from; i = k;
  }
}
if (AUTO) {
  // a sampled night's own marks (2026-11-04), merged into labels.auto.json: each candidate span reviewed; commercial and promo runs as its
  // breaks (promos listed apart, as on the marked days, so PROMOS=show cuts them the same way); unsure runs neutral
  const autoPath = join(golden, "labels.auto.json");
  const auto = existsSync(autoPath) ? JSON.parse(readFileSync(autoPath, "utf8")) : { day, by: "promos.mjs --auto " + model, windows: {} };
  for (const { win, span, cells } of byBreak.values()) {
    const w = (auto.windows[win] ??= { name: win, reviewed: [], ads: [], neutral: [], promos: [] });
    w.reviewed.push([hmsOf(span[0]), hmsOf(span[1])]);
    for (let i = 0; i < cells.length; i++) {
      const adK = (kd) => (kd === "promo" || kd === "commercial" || kd === "streaming" ? "ad" : kd);
      const k0 = adK(cells[i].kind);
      let k = i; while (k + 1 < cells.length && adK(cells[k + 1].kind) === k0) k++;
      const from = cells[i].s, to = k + 1 < cells.length ? cells[k + 1].s : span[1];
      if (k0 === "ad") w.ads.push([hmsOf(from), hmsOf(to)]); else if (k0 === "unsure") w.neutral.push([hmsOf(from), hmsOf(to)]);
      i = k;
    }
  }
  for (const [win, w] of Object.entries(out.windows)) (auto.windows[win] ??= { name: win, reviewed: [], ads: [], neutral: [], promos: [] }).promos.push(...w.promos);
  auto.at = new Date().toISOString();
  writeFileSync(autoPath, JSON.stringify(auto, null, 1));
  log("merged into " + autoPath);
} else writeFileSync(join(golden, "labels.promos.json"), JSON.stringify(out, null, 1));
writeFileSync(join(outDir, "labels.promos.json"), JSON.stringify(out, null, 1));
log(`promos: ${promoSec} s of ${adSec} s of marked break time (${(100 * promoSec / Math.max(1, adSec)).toFixed(1)}%), written to ${join(golden, "labels.promos.json")}`);
