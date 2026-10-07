// Prism Veil ad-report receiver. One job: accept a user-initiated "Report ad"
// JSON from the extension and drop it into a PRIVATE Tigris bucket for us to
// pick up (prism-veil-art/pull-reports.py). Nothing else.
//
// Privacy (spec section 19/22): no access log, no IP stored, no cookies, no
// identifiers requested. The report body is whatever the user chose to send
// (site + element structure; see prism-veil-extension/src/report.js). The
// only per-request state is an in-memory rate limiter keyed by a salted hash
// of the IP that is discarded when the machine stops.
import { createServer } from "node:http";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { timingSafeEqual } from "node:crypto";

const PORT = +(process.env.PORT || 8080);
const MAX_BYTES = 48 * 1024;             // a report is a few KB; this is generous
const RATE = { perMin: 6, burst: 20 };   // per client, in memory only
const s3 = new S3Client({
  endpoint: process.env.AWS_ENDPOINT_URL_S3, region: process.env.AWS_REGION || "auto",
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.BUCKET_NAME;
const SALT = randomBytes(16);            // new each boot: hashes are not linkable across restarts

const buckets = new Map();               // saltedHash -> { tokens, at }
function allow(ip) {
  const k = createHash("sha256").update(SALT).update(ip || "").digest("base64");
  const now = Date.now(), b = buckets.get(k) || { tokens: RATE.burst, at: now };
  b.tokens = Math.min(RATE.burst, b.tokens + ((now - b.at) / 60000) * RATE.perMin); b.at = now;
  if (b.tokens < 1) { buckets.set(k, b); return false; }
  b.tokens -= 1; buckets.set(k, b);
  if (buckets.size > 5000) buckets.clear();
  return true;
}

// Whitelist the report shape: unknown keys are dropped, strings truncated.
const STR = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);
const NUM = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v) : undefined);
function cleanNode(n) {
  if (!n || typeof n !== "object") return undefined;
  return {
    tag: STR(n.tag, 32), id: STR(n.id, 48), cls: STR(n.cls, 120), text: STR(n.text, 40),
    w: NUM(n.w), h: NUM(n.h), kids: NUM(n.kids), shadow: !!n.shadow, iframeHost: STR(n.iframeHost, 80),
    attrs: Array.isArray(n.attrs) ? n.attrs.slice(0, 12).map((a) => STR(a, 64)).filter(Boolean) : undefined,
  };
}
function cleanReport(r) {
  if (!r || typeof r !== "object") return null;
  const site = STR(r.site, 120);
  if (!site || !/^[a-z0-9.-]+$/i.test(site)) return null;
  return {
    v: 1, site, url: STR(r.url, 200), coveredByPrism: !!r.coveredByPrism,
    nearbyAdLabel: STR(r.nearbyAdLabel, 28), rule: STR(r.rule, 120),
    target: cleanNode(r.target), chain: Array.isArray(r.chain) ? r.chain.slice(0, 30).map(cleanNode).filter(Boolean) : [],
    ua: STR(r.ua, 24),            // "chromium" | "firefox" + major version, nothing finer
    veil: STR(r.veil, 16),        // extension version
    note: STR(r.note, 280),       // optional free text the user typed
    kind: ["video", "display", "sponsored", "popup", "other", "not-an-ad", "is-an-ad"].includes(r.kind) ? r.kind : undefined,   // the kind of ad the person chose (2026-09-26); not-an-ad: the break watch covered a show (2026-10-06)
    fb: (r.fb && typeof r.fb === "object" && JSON.stringify(r.fb).length <= 8000) ? r.fb : undefined,   // site diagnostics block (see report.js), capped
    fbErr: STR(r.fbErr, 120),
    diag: (r.diag && typeof r.diag === "object" && JSON.stringify(r.diag).length <= 8000) ? r.diag : undefined,
    // card: the enclosing card's label-grade interior; stack: the elements
    // under the click point (top to bottom); frames/framesDirect: embed and
    // IMA frames' trace rings (diagnostic lines only). All shape-capped.
    card: (r.card && typeof r.card === "object" && JSON.stringify(r.card).length <= 6000) ? r.card : undefined,
    stack: Array.isArray(r.stack) ? r.stack.slice(0, 10).map((n) => { const c = cleanNode(n); if (c && n) c.srcHost = STR(n.srcHost, 80); return c; }).filter(Boolean) : undefined,
    frames: (r.frames && typeof r.frames === "object" && JSON.stringify(r.frames).length <= 8000) ? r.frames : undefined,
    framesDirect: (r.framesDirect && typeof r.framesDirect === "object" && JSON.stringify(r.framesDirect).length <= 8000) ? r.framesDirect : undefined,
    diagErr: STR(r.diagErr, 120),
    receivedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- app reports
// The Windows app's report flag (2026-10-06, "add a bug report mechanism to the app ... People need to be able to report if ads are on their
// screen, or if a bug is found ... by a specific adapter, and whether on the music or video screen"; "we need to catch those reports in a
// queue online"). Same privacy as the ad reports: no IP stored, no identifier asked for; the body is only what the person saw in the form's
// "What is sent" before pressing Send. Each lands OPEN in the private bucket's queue, app-reports/open/<date>/<kind>/<service>/<uuid>.json;
// scripts/reports/app-reports.py lists, reads and closes them (closing moves a report to app-reports/done/).
// idea: an improvement asked for (2026-10-06, "make this window flexible enough to accept enhancement requests")
const APP_KINDS = ["ad", "bug", "idea", "other"], APP_PLAYERS = ["music", "video", "other"];
function cleanAppReport(r) {
  if (!r || typeof r !== "object") return null;
  const kind = APP_KINDS.includes(r.kind) ? r.kind : null;
  const note = STR(r.note, 2000);
  if (!kind || !note || !note.trim()) return null;
  const service = typeof r.service === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(r.service) ? r.service : "prism";
  // a page address is kept as origin and path only: anything after ? or # is dropped here too, whatever the app sent
  let page; try { if (typeof r.page === "string") { const u = new URL(r.page); if (/^https?:$/.test(u.protocol)) page = (u.origin + u.pathname).slice(0, 200); } } catch { page = undefined; }
  return {
    v: 1, kind, player: APP_PLAYERS.includes(r.player) ? r.player : "other", service,
    adapter: STR(r.adapter, 40), adapterVersion: STR(r.adapterVersion, 16), page,
    app: STR(r.app, 32), track: STR(r.track, 8), os: STR(r.os, 32), webview: STR(r.webview, 24),
    note, log: STR(r.log, 30000),
    receivedAt: new Date().toISOString(),
  };
}
async function appReport(req, res) {
  const ip = (req.headers["fly-client-ip"] || req.socket.remoteAddress || "").toString();
  if (!allow(ip)) return reply(res, 429, "slow down");
  let report; try { report = cleanAppReport(JSON.parse(await readBody(req, MAX_BYTES))); } catch (e) { return reply(res, /too large/.test(String(e && e.message)) ? 413 : 400, "bad report"); }
  if (!report) return reply(res, 400, "bad report");
  const d = report.receivedAt.slice(0, 10).replace(/-/g, "/");
  const key = `app-reports/open/${d}/${report.kind}/${report.service}/${randomUUID()}.json`;
  try { await bucketPut(key, report); } catch (e) { console.error("app report put failed:", e.name); return reply(res, 503, "try later"); }
  reply(res, 204);
}

// Cross-origin (2026-09-26): the extension posts from its own background page (a chrome-extension:// or moz-extension:// origin), a report
// form may come later on https://entangled.world, and the Windows app sends no Origin at all (not a browser). Any other web page gets no
// CORS answer, so a browser won't let it post here. (CORS is not authentication: the abuse limits below apply to every request.)
const WEB_ORIGINS = new Set(["https://entangled.world", "https://www.entangled.world"]);
function corsFor(origin) {
  const ok = typeof origin === "string" && (WEB_ORIGINS.has(origin) || /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin));
  return ok ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "86400" } : { "Vary": "Origin" };
}
let CORS = {};   // set per request from its Origin
function reply(res, code, body) { res.writeHead(code, { ...CORS, "Content-Type": "text/plain", "Cache-Control": "no-store" }); res.end(body || ""); }

// ---------------------------------------------------------------- curation
// /curate/: the art-pool curation gallery (one curator, a shared secret in
// the CURATE_KEY fly secret, sent as the x-curate-key header). Candidates
// (from prism-veil-art/fetch-candidates.py --upload) and decisions live in
// the same private bucket under curate/. Nothing here is public: every
// route but the page itself requires the key; the page holds no data.
const CURATE_KEY = process.env.CURATE_KEY || "";
// Off unless switched on for a curation session (2026-09-26: the page loaded for anyone, though its data needed the key):
// `fly secrets set CURATE_ENABLED=1 -a prism-reports` to use it, `fly secrets unset CURATE_ENABLED -a prism-reports` after.
const CURATE_ON = process.env.CURATE_ENABLED === "1";
function keyOk(req) {
  const k = (req.headers["x-curate-key"] || "").toString();
  if (!CURATE_KEY || k.length !== CURATE_KEY.length) return false;
  return timingSafeEqual(Buffer.from(k), Buffer.from(CURATE_KEY));
}
async function bucketJson(key, dflt) {
  try { const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key })); return JSON.parse(await r.Body.transformToString("utf8")); }
  catch (e) { if (e.name === "NoSuchKey") return dflt; throw e; }
}
async function bucketPut(key, obj) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(obj), ContentType: "application/json" }));
}
async function readBody(req, max) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw new Error("too large"); chunks.push(c); }
  return Buffer.concat(chunks).toString("utf8");
}
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }
let decisionsLock = Promise.resolve();
async function curate(req, res, url) {
  if (req.method === "GET" && (url.pathname === "/curate" || url.pathname === "/curate/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    return res.end(CURATE_HTML);
  }
  if (!keyOk(req)) return json(res, 401, { error: "key" });
  if (req.method === "GET" && url.pathname === "/curate/api/candidates") return json(res, 200, await bucketJson("curate/candidates.json", []));
  if (req.method === "GET" && url.pathname === "/curate/api/decisions") return json(res, 200, await bucketJson("curate/decisions.json", {}));
  if (req.method === "POST" && url.pathname === "/curate/api/candidates") {
    const body = JSON.parse(await readBody(req, 40 * 1024 * 1024));
    if (!Array.isArray(body)) return json(res, 400, { error: "array" });
    await bucketPut("curate/candidates.json", body); return json(res, 200, { ok: true, n: body.length });
  }
  if (req.method === "POST" && url.pathname === "/curate/api/decisions") {
    // merge {id: "a"|"r"|""} into the stored map, serialised so two quick
    // keypresses cannot lose each other
    const patch = JSON.parse(await readBody(req, 1024 * 1024));
    if (!patch || typeof patch !== "object") return json(res, 400, { error: "object" });
    const done = decisionsLock.then(async () => {
      const cur = await bucketJson("curate/decisions.json", {});
      const at = new Date().toISOString();
      for (const [id, d] of Object.entries(patch)) {
        if (typeof id !== "string" || id.length > 300) continue;
        if (d === "a" || d === "r") cur[id] = { d, at }; else delete cur[id];
      }
      await bucketPut("curate/decisions.json", cur);
      return Object.keys(cur).length;
    });
    decisionsLock = done.catch(() => {});
    return json(res, 200, { ok: true, n: await done });
  }
  return json(res, 404, { error: "not found" });
}
const CURATE_HTML = String.raw`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prism art curation</title>
<style>
body{margin:0;background:#14171C;color:#F2F4F7;font:13px/1.4 system-ui,sans-serif}
header{position:sticky;top:0;z-index:2;background:#0F1216;border-bottom:1px solid #3A4250;padding:8px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header b{color:#fff} select,input,button{background:#2A2F38;color:#F2F4F7;border:1px solid #3A4250;border-radius:8px;padding:6px 10px;font:600 12px system-ui}
button{cursor:pointer} .hint{color:#C0C8D2}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;padding:12px}
figure{margin:0;background:#1E232B;border:3px solid transparent;border-radius:10px;overflow:hidden;cursor:pointer;position:relative}
figure.cur{outline:3px solid #F2F4F7;outline-offset:-3px} figure.a{border-color:#3fb950} figure.r{border-color:#f85149;opacity:.45}
figure img{display:block;width:100%;aspect-ratio:3/2;object-fit:cover;background:#000}
figcaption{padding:7px 10px} figcaption small{display:block;color:#C0C8D2;margin-top:2px} a{color:#C0C8D2}
.tag{position:absolute;top:8px;left:8px;font:700 11px system-ui;padding:2px 7px;border-radius:6px;background:#0F1216cc}
figure.a .tag{color:#3fb950} figure.r .tag{color:#f85149}
#big{position:fixed;inset:0;background:#000e;display:none;align-items:center;justify-content:center;z-index:3} #big img{max-width:96vw;max-height:92vh}
#login{padding:40px 14px;max-width:420px}
</style>
<div id="login"><b>Prism art curation</b><p class="hint">Paste the curation key. It stays in this browser only.</p><input id="key" type="password" style="width:100%"><p><button id="go">Open</button></p><p id="err" style="color:#f85149"></p></div>
<header hidden id="bar"><b id="count"></b>
<select id="src"><option value="">all sources</option><option value="__space">all space</option><option value="__land">all landscape</option></select>
<select id="state"><option value="u">unreviewed</option><option value="">everything</option><option value="a">approved</option><option value="r">rejected</option></select>
<span class="hint"><b>A</b> approve &middot; <b>X</b> reject &middot; <b>U</b> undo &middot; <b>arrows / J K</b> move &middot; <b>Enter</b> view large &middot; click = approve</span>
<span id="saved" class="hint"></span></header>
<main id="grid" hidden></main><div id="big"><img></div>
<script>
const $=s=>document.querySelector(s); let KEY=localStorage.getItem('curateKey')||'', C=[], D={}, view=[], cur=0, pending={}, saveT=0;
const H=()=>({'x-curate-key':KEY,'content-type':'application/json'});
async function load(){ const r=await fetch('/curate/api/candidates',{headers:H()}); if(r.status===401){$('#err').textContent='Wrong key';return false;}
  C=await r.json(); D=await (await fetch('/curate/api/decisions',{headers:H()})).json(); localStorage.setItem('curateKey',KEY);
  $('#login').hidden=true; $('#bar').hidden=false; $('#grid').hidden=false;
  const srcs=[...new Set(C.map(c=>c.source))].sort(); for(const s of srcs){const o=document.createElement('option');o.value=s;o.textContent=s+' ('+C.filter(c=>c.source===s).length+')';$('#src').appendChild(o);} render(); return true; }
function esc(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function render(){ const src=$('#src').value, st=$('#state').value; view=C.filter(c=>(!src||(src==='__space'?c.source.startsWith('Space ('):src==='__land'?!c.source.startsWith('Space ('):c.source===src))&&(st===''||(st==='u'?!D[c.id]:D[c.id]&&D[c.id].d===st)));
  cur=Math.min(cur,Math.max(0,view.length-1)); const a=Object.values(D).filter(d=>d.d==='a').length, r=Object.values(D).filter(d=>d.d==='r').length;
  $('#count').textContent=view.length+' shown · '+a+' approved · '+r+' rejected · '+(C.length-a-r)+' to go';
  $('#grid').innerHTML=view.slice(0,400).map((c,i)=>'<figure data-i="'+i+'" class="'+(D[c.id]?D[c.id].d:'')+(i===cur?' cur':'')+'"><span class="tag">'+(D[c.id]?(D[c.id].d==='a'?'APPROVED':'REJECTED'):'')+'</span><img loading="lazy" src="'+esc(c.thumb)+'"><figcaption>'+esc(c.title.slice(0,70))+'<small>'+esc(c.source)+' · '+esc(c.author)+' · '+c.width+'×'+c.height+' · <a target="_blank" href="'+esc(c.page)+'">source</a></small></figcaption></figure>').join('');
  const f=$('#grid').querySelector('.cur'); if(f) f.scrollIntoView({block:'nearest'}); }
function decide(d){ const c=view[cur]; if(!c) return; if(d) D[c.id]={d,at:new Date().toISOString()}; else delete D[c.id]; pending[c.id]=d||''; save();
  if($('#state').value==='u'&&d){ render(); } else { cur=Math.min(cur+1,view.length-1); render(); } }
function save(){ clearTimeout(saveT); $('#saved').textContent='saving…'; saveT=setTimeout(async()=>{ const p=pending; pending={}; let ok=false; try{ const r=await fetch('/curate/api/decisions',{method:'POST',headers:H(),body:JSON.stringify(p)}); ok=r.ok; }catch(e){} $('#saved').textContent=ok?'saved':'SAVE FAILED - retrying'; if(!ok){Object.assign(pending,p);setTimeout(save,3000);} },600); }
document.addEventListener('keydown',e=>{ if(!$('#login').hidden) return; if($('#big').style.display==='flex'){ if(e.key==='Escape'||e.key==='Enter') $('#big').style.display='none'; else if(e.key==='a'||e.key==='A'){decide('a');$('#big').style.display='none';} else if(e.key==='x'||e.key==='X'){decide('r');$('#big').style.display='none';} return; }
  const k=e.key.toLowerCase(); if(k==='a') decide('a'); else if(k==='x') decide('r'); else if(k==='u') decide(''); else if(k==='arrowright'||k==='j'){cur=Math.min(cur+1,view.length-1);render();} else if(k==='arrowleft'||k==='k'){cur=Math.max(cur-1,0);render();}
  else if(k==='arrowdown'){cur=Math.min(cur+cols(),view.length-1);render();} else if(k==='arrowup'){cur=Math.max(cur-cols(),0);render();} else if(k==='enter'){ const c=view[cur]; if(c){$('#big img').src=c.thumb.replace(/\/(\d+)px-/,'/1600px-');$('#big').style.display='flex';} } else return; e.preventDefault(); });
function cols(){ const g=$('#grid'); const f=g.firstElementChild; return f?Math.max(1,Math.floor(g.clientWidth/(f.offsetWidth+12))):1; }
$('#grid').addEventListener('click',e=>{ if(e.target.tagName==='A') return; const f=e.target.closest('figure'); if(!f) return; cur=+f.dataset.i; decide(D[view[cur].id]&&D[view[cur].id].d==='a'?'':'a'); });
$('#big').addEventListener('click',()=>$('#big').style.display='none');
$('#src').onchange=$('#state').onchange=()=>{cur=0;render();};
$('#go').onclick=()=>{KEY=$('#key').value.trim();load();}; $('#key').addEventListener('keydown',e=>{if(e.key==='Enter')$('#go').click();});
if(KEY) load();
</script>`;

// The download counter (2026-10-05, "when someone runs the install off the website, I want to capture an install counter that everyone can
// see on the website"): the website's Download button comes here; one is added to the count and the browser is sent on to the current zip,
// read from the signed manifest in the public bucket. Nothing about the person is kept - no address, no browser string, no time - only the
// number, in this private bucket (counters/downloads.json), flushed shortly after it changes and read back at boot. Prism itself never
// reports an install: that would be telemetry, which it promises not to do; this counts download clicks, and the site should say so.
const MANIFEST_URL = "https://prism.entangled.world/windows/manifest.json";
const COUNTS_KEY = "counters/downloads.json";
let counts = null, countsDirty = false, manifestCache = { at: 0, data: null };
async function countsNow() { if (!counts) counts = await bucketJson(COUNTS_KEY, { windows: 0 }); return counts; }
async function flushCounts() { if (!countsDirty || !counts) return; countsDirty = false; try { await bucketPut(COUNTS_KEY, counts); } catch (e) { countsDirty = true; console.error("counts:", e.message); } }
setInterval(flushCounts, 15000).unref();
async function currentZip(channel) {
  if (Date.now() - manifestCache.at > 60000) {
    try { const r = await fetch(MANIFEST_URL, { headers: { "cache-control": "no-cache" } }); if (r.ok) { manifestCache = { at: Date.now(), data: await r.json() }; } }
    catch (e) { console.error("manifest:", e.message); }
  }
  const e = manifestCache.data && manifestCache.data[channel];
  return e && typeof e.url === "string" && e.url.startsWith("https://prism.entangled.world/") ? e : null;
}
/** The newest release on any track (alpha, beta, stable), by version number: what the plain download address sends. */
async function newestZip() {
  const tracks = ["alpha", "beta", "stable"];
  const vnum = (v) => String(v || "0").split(".").map((x) => parseInt(x, 10) || 0);
  const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  let best = null;
  for (const t of tracks) { const e = await currentZip(t); if (e && (!best || newer(e.version, best.version))) best = e; }
  return best;
}
async function downloads(req, res, url) {
  if (url.pathname === "/v1/downloads") {
    const c = await countsNow();
    res.writeHead(200, { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=30" }); return res.end(JSON.stringify({ windows: c.windows || 0 }));
  }
  // the tracks are alpha | beta | stable (docs/features/updates.md); the plain address is the newest version the manifest lists on any
  // track - the one the website's Download button advertises (2026-10-05 review: it knew stable and beta alone and sent an alpha release's
  // visitors the older stable zip, and counted the click against it)
  const m = /^\/v1\/download\/windows(?:\/(stable|beta|alpha))?$/.exec(url.pathname);
  if (!m) return reply(res, 404, "not found");
  const e = m[1] ? await currentZip(m[1]) : await newestZip();
  if (!e) return reply(res, 503, "the release manifest could not be read; try https://prism.entangled.world/windows/manifest.json");
  if (req.method === "GET") { const c = await countsNow(); c.windows = (c.windows || 0) + 1; countsDirty = true; }
  res.writeHead(302, { Location: e.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }); return res.end();
}

createServer(async (req, res) => {
  CORS = corsFor(req.headers.origin);
  if (req.method === "GET" && req.url === "/healthz") return reply(res, 200, "ok");
  if (req.method === "OPTIONS") return reply(res, 204);
  if ((req.method === "GET" || req.method === "HEAD") && (req.url.startsWith("/v1/download/") || req.url === "/v1/downloads")) { try { return await downloads(req, res, new URL(req.url, "http://x")); } catch (e) { console.error("downloads:", e.message); return reply(res, 500, "server"); } }
  if (req.url.startsWith("/curate") && !CURATE_ON) return reply(res, 404, "not found");
  if (req.url.startsWith("/curate")) { try { return await curate(req, res, new URL(req.url, "http://x")); } catch (e) { console.error("curate:", e.message); return json(res, 500, { error: "server" }); } }
  if (req.method === "POST" && req.url === "/v1/app-report") return appReport(req, res);
  if (req.method !== "POST" || req.url !== "/v1/report") return reply(res, 404, "not found");
  const ip = (req.headers["fly-client-ip"] || req.socket.remoteAddress || "").toString();
  if (!allow(ip)) return reply(res, 429, "slow down");
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BYTES) return reply(res, 413, "too large"); chunks.push(c); }
  let report; try { report = cleanReport(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { report = null; }
  if (!report) return reply(res, 400, "bad report");
  const d = report.receivedAt.slice(0, 10).replace(/-/g, "/");
  const key = `reports/${d}/${report.site}/${randomUUID()}.json`;
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: JSON.stringify(report), ContentType: "application/json" }));
  } catch (e) { console.error("put failed:", e.name); return reply(res, 503, "try later"); }
  reply(res, 204);
}).listen(PORT, () => console.log("prism-reports listening on", PORT));
