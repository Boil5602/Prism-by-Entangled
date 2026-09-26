/**
 * Regenerate the derived news shelf (dashboard-schema §31 "News defaults").
 *
 *   node scripts/regen-news-shelf.mjs            rebuild src/news-shelf.data.ts from the
 *                                                committed snapshot + criterion (deterministic)
 *   node scripts/regen-news-shelf.mjs --fetch    ALSO take a fresh snapshot of Wikipedia's
 *                                                Perennial Sources list first (new data file,
 *                                                named by the list page's revision id)
 *
 * Requires `npx tsc -p packages/core` first: the builder is core's own
 * (packages/core/dist/news-shelf.js) — one implementation, shared with the
 * test that fails when the shipped shelf differs from what it produces. The
 * shipped file is generated; nothing in it is hand-edited (§31: Entangled
 * adds and removes nothing by hand).
 *
 * Snapshot format = the list's real columns (Source · Status · Last · Summary
 * · Use) per row, taken from the wikitext of the eight transcluded subpages.
 * The list is CC BY-SA 4.0; the shelf carries that attribution per entry.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, "packages/core/data");
const outFile = join(root, "packages/core/src/news-shelf.data.ts");
const { buildNewsShelf } = await import("file://" + join(root, "packages/core/dist/news-shelf.js"));

const LIST_TITLE = "Wikipedia:Reliable sources/Perennial sources";
const LIST_URL = "https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources";
const UA = "prism-news-shelf-regen/0.1 (open-source dashboard; no identifiers)";
const LEGEND = {
  gr: "Generally reliable",
  nc: "No consensus, unclear, or additional considerations apply",
  gu: "Generally unreliable",
  d: "Deprecated",
  m: "Mixed / evolving",
};

/* ------------------------------------------------------- wikitext → rows */

/** Plain text from a cell: strip links, templates, refs, markup. */
function plain(wiki) {
  let s = wiki;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
  s = s.replace(/\{\{efn\|[\s\S]*?\}\}/g, "");
  // nested templates: drop innermost repeatedly
  for (let i = 0; i < 6; i++) s = s.replace(/\{\{[^{}]*\}\}/g, (m) => templateText(m));
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2").replace(/\[\[([^\]]*)\]\]/g, "$1");
  s = s.replace(/\[https?:[^\s\]]*\s([^\]]*)\]/g, "$1").replace(/\[https?:[^\]]*\]/g, "");
  s = s.replace(/'''''|'''|''/g, "");
  s = s.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&amp;/g, "&");
  return s.replace(/\s+/g, " ").trim();
}

function templateText(t) {
  const inner = t.slice(2, -2);
  const [name, ...args] = inner.split("|");
  const n = name.trim().toLowerCase();
  if (n === "snd" || n === "spaced ndash") return " – ";
  if (n === "em") return args[0] ?? "";
  if (n === "small" || n === "nowrap") return args.join("|");
  if (n === "slink" || n === "section link") return args.join("§");
  if (n.startsWith("wp:rspshortcut")) return "";
  return "";
}

function parseRows(wikitext, page) {
  const rows = [];
  const lines = wikitext.split(/\r?\n/);
  let row = null;
  let cell = null;
  let depth = 0;
  const flush = () => { if (row && cell !== null) { row.cells.push(cell); cell = null; } };
  for (const line of lines) {
    if (depth === 0 && /^\|-/.test(line)) {
      flush();
      if (row) rows.push(row);
      const cls = /class="([^"]*)"/.exec(line)?.[1] ?? "";
      const id = /id="([^"]*)"/.exec(line)?.[1] ?? "";
      row = cls.startsWith("s-") ? { id, cls, cells: [], page } : null;
      continue;
    }
    if (depth === 0 && /^\|\}/.test(line)) { flush(); if (row) rows.push(row); row = null; continue; }
    if (!row) continue;
    if (depth === 0 && /^\|(?![-+}])/.test(line)) { flush(); cell = line.slice(1).replace(/^\s/, ""); }
    else if (cell !== null) cell += "\n" + line;
    else continue;
    depth += (line.match(/\{\{/g) ?? []).length - (line.match(/\}\}/g) ?? []).length;
    if (depth < 0) depth = 0;
  }
  flush();
  if (row) rows.push(row);
  return rows.filter((r) => r.cells.length >= 5).map(rowToRecord);
}

/** `| data-sort-value="x" | content` → content (cell attributes before the first bare pipe). */
function cellContent(cell) {
  const m = /^\s*((?:[a-z-]+="[^"]*"\s*)+)\|(?!\|)/i.exec(cell);
  return m ? cell.slice(m[0].length).replace(/^\s/, "") : cell;
}

function rowToRecord(r) {
  const cells = r.cells.map(cellContent);
  const [sourceCell, statusCell, , lastCell, summaryCell, usesCell] = cells.length >= 6 ? cells : [cells[0], cells[1], "", cells[2], cells[3], cells[4]];
  const status = [...statusCell.matchAll(/\{\{WP:RSPSTATUS\|([a-z]+)((?:\|[^}]*)?)\}\}/gi)];
  const codes = status.map((m) => m[1].toLowerCase());
  const blacklisted = status.some((m) => /\bb=y/.test(m[2] ?? "")) || r.cls === "s-b";
  const last = /\{\{WP:RSPLAST\|(\d{4})([^}]*)\}\}/i.exec(lastCell) ?? /^\s*(\d{4})()\s*$/.exec(lastCell);
  const uses = usesCell ? [...usesCell.matchAll(/\{\{WP:RSPUSES\|([^}]*)\}\}/gi)].flatMap((m) => m[1].split("|").map((s) => s.trim()).filter(Boolean)) : [];
  const article = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/.exec(sourceCell.replace(/\{\{WP:RSPSHORTCUT\|[^}]*\}\}/g, ""))?.[1];
  const shortcuts = [...sourceCell.matchAll(/\{\{WP:RSPSHORTCUT\|([^}]*)\}\}/g)].map((m) => m[1].trim());
  const rec = {
    id: r.id,
    source: plain(sourceCell),
    ...(article && !/^WP:|^Wikipedia:/i.test(article) ? { article: article.trim() } : {}),
    status: codes,
    ...(blacklisted ? { blacklisted: true } : {}),
    ...(last ? { last: Number(last[1]) } : {}),
    ...(last && !/stale=n/.test(last[2]) && /stale=y/.test(last[2]) ? { stale: true } : {}),
    summary: plain(summaryCell),
    uses,
    ...(shortcuts.length ? { shortcuts } : {}),
  };
  return rec;
}

/* ---------------------------------------------------------------- fetch */

async function fetchSnapshot() {
  const api = async (params) => {
    const url = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({ format: "json", formatversion: "2", ...params });
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  };
  const raw = async (title) => {
    const url = "https://en.wikipedia.org/w/index.php?" + new URLSearchParams({ title, action: "raw" });
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.text();
  };
  const main = await api({ action: "query", prop: "revisions", titles: LIST_TITLE, rvprop: "ids|timestamp" });
  const rev = main.query.pages[0].revisions[0];
  const rows = [];
  const subpages = [];
  for (let i = 1; i <= 8; i++) {
    const title = `${LIST_TITLE}/${i}`;
    const info = await api({ action: "query", prop: "revisions", titles: title, rvprop: "ids" });
    subpages.push({ title, revision: info.query.pages[0].revisions[0].revid });
    rows.push(...parseRows(await raw(title), i));
    console.log(`  ${title}: ${rows.length} rows so far`);
  }
  const snapshot = {
    dataset: {
      name: "Wikipedia: Reliable sources/Perennial sources",
      url: LIST_URL,
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      revision: rev.revid,
      retrieved: new Date().toISOString(),
      subpages,
    },
    legend: LEGEND,
    rows,
  };
  const file = join(dataDir, `perennial-sources.${rev.revid}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 1) + "\n");
  console.log(`snapshot: ${file} (${rows.length} rows, revision ${rev.revid})`);
  return file;
}

/* ---------------------------------------------------------------- build */

function latestSnapshotFile() {
  const files = readdirSync(dataDir).filter((f) => /^perennial-sources\.\d+\.json$/.test(f));
  if (!files.length) throw new Error("no perennial-sources.<revision>.json in " + dataDir);
  files.sort((a, b) => Number(/\.(\d+)\.json$/.exec(a)[1]) - Number(/\.(\d+)\.json$/.exec(b)[1]));
  return join(dataDir, files[files.length - 1]);
}

if (process.argv.includes("--fetch")) await fetchSnapshot();

const snapshotFile = latestSnapshotFile();
const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8"));
const criterion = JSON.parse(readFileSync(join(dataDir, "news-shelf-criterion.json"), "utf8"));
const shelf = buildNewsShelf(snapshot, criterion);
const header = [
  "// <auto-generated>",
  `// GENERATED by scripts/regen-news-shelf.mjs from ${snapshotFile.slice(root.length + 1).replace(/\\/g, "/")}`,
  "// + packages/core/data/news-shelf-criterion.json. Do not edit: tests/news-shelf.test.ts",
  "// fails when this file differs from the builder's output (dashboard-schema §31).",
  "// </auto-generated>",
  'import type { NewsShelf } from "./news-shelf.js";',
  "",
  `export const NEWS_SHELF_SNAPSHOT_FILE = ${JSON.stringify(snapshotFile.slice(dataDir.length + 1))};`,
  "",
  "export const NEWS_SHELF: NewsShelf = ",
].join("\n");
writeFileSync(outFile, header + JSON.stringify(shelf, null, 2) + ";\n");
console.log(`shelf: ${outFile} (${shelf.entries.length} entries from ${snapshot.rows.length} rows; criterion ${criterion.id})`);
