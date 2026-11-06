namespace PrismHost.Services;

/// <summary>
/// The listen page (2026-10-31): one page the host serves at /listen?key=, behind the
/// Prism menu's switch and the household key core mints for it (remote.ts houseListen). Sunrise Meadow drawn from the PC's bands
/// (/viz/bands, the key), the song at the bottom left from GET /listen/now every two seconds, and the PC's sound as PCM over a
/// WebSocket (/audio/stream, a ticket from POST /listen/ticket), each frame stamped with its time on the PC's clock and played by the one
/// player (ListenPlayer.cs) three seconds after it, the hold every listener in the house keeps, so all of them play the same moment together. Nothing on it acts on Prism: no transport, no mute, no picks. The one button starts the page's own sound, because a
/// browser plays nothing until someone taps; a sound that stops is started again by the page itself, so a tablet on a shelf needs
/// nobody. Written for plain browsers, an Echo Show's Silk among them: no modules, no frameworks, sizes in viewport units so it reads
/// from across a kitchen. Pure ASCII; the scene is spliced in where __VIZ_SCENE__ stands (VizScene.cs).
/// </summary>
public static class ListenPage
{
    public const string Html = """
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0B0D12"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Prism">
<link rel="icon" href="/remote/icon.png"><link rel="apple-touch-icon" sizes="180x180" href="/remote/icon-180.png"><title>Prism</title>
<style>
:root{color-scheme:dark;--ink:#E8ECF2;--dim:#8A93A2;--amber:#F2B14C;--amber-ink:#14171C;--ground:#0B0D12;--panel:#1C2129}
html,body{margin:0;height:100%;background:var(--ground);color:var(--ink);font:16px system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden;-webkit-user-select:none;user-select:none;cursor:default}
#c{position:fixed;inset:0;width:100%;height:100%}
.info{position:fixed;left:calc(4vw + env(safe-area-inset-left));bottom:calc(5vh + env(safe-area-inset-bottom));max-width:62vw;display:flex;flex-direction:column;gap:.4vh;text-shadow:0 1px 8px rgba(0,0,0,.75)}
.info .svc{font-size:2.2vh;letter-spacing:.12em;text-transform:uppercase;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.info b{font-size:5.4vh;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.info span{font-size:3vh;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.info .clk{font-variant-numeric:tabular-nums;color:var(--amber)}
.state{position:fixed;top:calc(3vh + env(safe-area-inset-top));left:calc(4vw + env(safe-area-inset-left));right:calc(4vw + env(safe-area-inset-right));display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:2vw;transition:opacity .6s}
body.rest .state{opacity:0}
.state span{font-size:2.4vh;color:var(--ink);opacity:.8;text-shadow:0 1px 8px rgba(0,0,0,.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#note{justify-self:start;text-align:left}
.state button{background:rgba(28,33,41,.82);color:var(--ink);border:0;border-radius:2vh;padding:1.4vh 2.6vh;font:2.4vh system-ui;cursor:pointer;white-space:nowrap}
#toggle{justify-self:end;min-width:14vw}
.trim{display:flex;align-items:center;gap:1.2vh;justify-self:center}
.trim button{min-width:11vw}
.trim span{font-size:2.2vh;min-width:12ch;text-align:center}
#gate{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3vh;background:rgba(11,13,18,.74);text-align:center;padding:4vw;box-sizing:border-box}
#gate.off{display:none}
#gate h1{margin:0;font-size:6vh;font-weight:600;letter-spacing:.3em;color:var(--ink);padding-left:.3em}
#gate p{margin:0;font-size:3vh;color:var(--ink);opacity:.9;max-width:72vw;line-height:1.35}
#gate button{background:var(--amber);color:var(--amber-ink);border:0;border-radius:3vh;padding:3vh 9vh;font:600 4.2vh system-ui;cursor:pointer}
#gate button:active{opacity:.85}
#gate .err{color:var(--amber);font-size:2.6vh}
#code{display:none;flex-direction:column;align-items:center;gap:2vh}
#code.on{display:flex}
#code input{width:12ch;max-width:80vw;box-sizing:content-box;background:var(--panel);color:var(--ink);border:0;border-radius:2vh;padding:2vh 3vh;font:600 5vh ui-monospace,Menlo,Consolas,monospace;letter-spacing:.2em;text-align:center;text-transform:lowercase}
#code button{background:var(--amber);color:var(--amber-ink);border:0;border-radius:3vh;padding:2.4vh 7vh;font:600 3.6vh system-ui;cursor:pointer}
</style></head><body>
<canvas id="c"></canvas>
<div class="info"><span class="svc" id="svc">Prism</span><b id="title">Nothing playing</b><span id="line2"></span><span id="album"></span><span class="clk" id="clock"></span></div>
<div class="state"><span id="note"></span><span class="trim"><button id="earlier" type="button" aria-label="Sound earlier">Earlier</button><span id="trimSay"></span><button id="later" type="button" aria-label="Sound later">Later</button></span><button id="toggle" type="button">Listen</button></div>
<div id="gate"><h1>PRISM</h1><p id="gateWhat">The music playing on this PC, here, with its lounge scene. Nothing to press but this.</p><button id="go" type="button">Listen</button><form id="code"><input id="codeIn" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="text" maxlength="9" placeholder="abcd-efgh" aria-label="House code"><button type="submit">Open</button></form><p class="err" id="gateErr"></p></div>
<script>
'use strict';
// the house code: from the address when a QR brought it, else as this device remembers it, else asked for once (2026-10-31): eight characters in the page's own big field, kept on this device
let KEY = '';
try { KEY = (new URLSearchParams(location.search).get('key') || '').toLowerCase().replace(/[^a-z0-9]/g, ''); } catch (e) {}
try { if (!KEY) KEY = localStorage.getItem('prism.listen.code') || ''; else localStorage.setItem('prism.listen.code', KEY); } catch (e) {}
try { if (KEY && location.search) history.replaceState(null, '', location.pathname); } catch (e) {}   // the code out of the address bar once kept
const q = (s) => document.querySelector(s);
// the scene's one object (VizScene.cs): the PC's bands, the stage's palette, the picture, the clock
const viz = { bands: new Float32Array(48), smooth: new Float32Array(48), pal: null, reduced: false, t: 0, sun: null, art: null, artBlur: null, artUrl: '', lastAt: 0, raf: 0, ws: null, feed: null };
try { viz.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
__VIZ_SCENE__
// ---- the PC: the key goes with every ask; a 404 on the page's own routes means the switch went off
let isOff = false;
async function api(path, body) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  if (r.status === 404 && path.indexOf('/listen/') === 0) { off(); throw new Error('the listen page is off'); }
  if (isOff) { isOff = false; q('#gateWhat').textContent = 'The music playing on this PC, here, with its lounge scene. Nothing to press but this.'; q('#go').style.display = ''; }   // back on
  if (r.status === 401) { askCode('That is not this PC\'s house code. The PC shows it under Listen page in the Prism menu, and the companion app does too.'); throw new Error('not the house code'); }
  if (r.status === 429) { note('Too many wrong codes from this device. Waiting a minute.'); throw new Error('a minute\'s wait'); }   // the code kept: the wait passes
  if (!r.ok) throw new Error('the PC answered ' + r.status);
  return r.json();
}
// the code asked for: the gate with the field, the sound stopped, the code this device kept forgotten
let asking = false;
function askCode(why) {
  KEY = ''; try { localStorage.removeItem('prism.listen.code'); } catch (e) {}
  stopAudio('');
  if (!asking) { asking = true; q('#gate').classList.remove('off'); q('#go').style.display = 'none'; q('#code').classList.add('on'); q('#gateWhat').textContent = 'Type the house code the PC shows under Listen page.'; setTimeout(() => { try { q('#codeIn').focus(); } catch (e) {} }, 50); }
  q('#gateErr').textContent = why || '';
}
q('#code').onsubmit = (e) => {
  e.preventDefault();
  const v = (q('#codeIn').value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (v.length < 8) { q('#gateErr').textContent = 'The code is eight letters and numbers.'; return; }
  KEY = v; try { localStorage.setItem('prism.listen.code', v); } catch (e) {}
  asking = false; q('#code').classList.remove('on'); q('#gateErr').textContent = ''; q('#gate').classList.add('off');
  wake(); startAudio(); connect();   // the tap on Open is the tap a browser wants before sound
};
function off() {
  if (isOff) return; isOff = true;
  stopAudio('');
  q('#gate').classList.remove('off'); q('#go').style.display = 'none'; q('#gateErr').textContent = '';
  q('#gateWhat').textContent = 'The listen page is off on this PC. Turn it on from the Prism menu, under Listen page, to use it here.';
}
// ---- what plays, every two seconds: the card, the stage's art mode and palette for the scene
let now = null, pos = null, dur = null, playing = false, at = 0;
async function poll() {
  if (!KEY) { setTimeout(poll, 2000); return; }   // nothing asked without a code: a wrong one is counted on the PC, an empty one too
  try {
    const r = await api('/listen/now');
    now = r.now; const f = r.feed || null; viz.feed = f;
    viz.pal = f && Array.isArray(f.palette) && f.palette.length >= 3 ? f.palette.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]).filter((c) => c.every((v) => !isNaN(v))) : null;
    if (viz.pal && viz.pal.length < 3) viz.pal = null;
    // the stage's own art mode; with no stage feed, the song's picture over the scene, as a stereo would show the sleeve
    const mode = artMode(), url = mode !== 'off' ? ((f && f.artwork) || artUrl()) : '';
    if (url !== viz.artUrl) { viz.artUrl = url; viz.art = null; viz.artBlur = null; if (url) vizArtLoad(url); }
    pos = now && typeof now.position === 'number' ? now.position : null;
    dur = now && typeof now.duration === 'number' && now.duration > 0 ? now.duration : null;
    playing = !!(now && now.playbackState === 'playing'); at = Date.now();
    drawInfo();
    if (noteText === 'No answer from the PC') note(listening ? 'Listening' : '');
  } catch (e) { if (!isOff) note('No answer from the PC'); }
  setTimeout(poll, 2000);
}
function artMode() { return viz.feed ? (viz.feed.artworkMode || 'off') : 'focal'; }
function artUrl() { const md = now && now.metadata ? now.metadata : {}, aw = md.artwork; return typeof aw === 'string' ? aw : Array.isArray(aw) && aw.length ? (aw[aw.length - 1].src || '') : ''; }
function mmss(s) { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
function drawInfo() {
  const md = now && now.metadata ? now.metadata : {};
  const col = now && now.collection, kindWord = col && col.kind ? ({ station: 'station', playlist: 'playlist', album: 'album', artist: 'artist' })[col.kind] || col.kind : '';
  q('#svc').textContent = now ? [now.service, col && col.label ? col.label + (kindWord ? ' ' + kindWord : '') : ''].filter(Boolean).join(' \u00b7 ') : 'Prism';
  q('#title').textContent = now ? (md.title || (now.ad ? 'Ad break' : 'Playing')) : 'Nothing playing';
  const state = now ? (now.ad ? 'an ad is playing' : now.playbackState === 'paused' ? 'paused' : '') : '';
  q('#line2').textContent = [md.artist, state].filter(Boolean).join(' \u00b7 ');
  q('#album').textContent = md.album && md.album !== md.title ? md.album : '';
  tick();
}
function tick() { let p = pos; if (p !== null && playing) p += (Date.now() - at) / 1000; if (p !== null && dur) p = Math.min(p, dur); q('#clock').textContent = p !== null ? mmss(p) + (dur ? ' / ' + mmss(dur) : '') : ''; }
setInterval(tick, 1000);
// ---- the PC's bands: 48 bytes a frame, 30 a second, over the same socket the phone's visual uses; a dropped socket comes back by itself
async function connect() {
  if (!KEY || isOff) return;   // asked again when the code is typed
  let tk; try { tk = (await api('/listen/ticket', {})).ticket; } catch (e) { setTimeout(connect, 5000); return; }   // the bands by a ticket core minted for the code
  try {
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/viz/bands?ticket=' + encodeURIComponent(tk));
    ws.binaryType = 'arraybuffer'; viz.ws = ws;
    ws.onmessage = (e) => { if (!(e.data instanceof ArrayBuffer)) return; const b = new Uint8Array(e.data), n = Math.min(b.length, viz.bands.length); for (let i = 0; i < n; i++) viz.bands[i] = b[i] / 255; };
    ws.onclose = () => { if (viz.ws === ws) { viz.ws = null; setTimeout(connect, isOff ? 15000 : 2000); } };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  } catch (e) { setTimeout(connect, 3000); }
}
// ---- the scene, 30 frames a second at most (the PC's own rate; a shelf tablet has no more to give), still while the tab is hidden
function draw(ts) {
  viz.raf = requestAnimationFrame(draw);
  if (document.hidden || ts - viz.lastAt < 31) return;
  const c = q('#c'), dpr = Math.min(2, window.devicePixelRatio || 1), W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dt = Math.min(0.1, (ts - viz.lastAt) / 1000) || 0; viz.lastAt = ts; viz.t += dt;
  const mode = artMode(), backdrop = mode === 'backdrop' && vizArtBackdrop(g, W, H);
  sunDraw(g, W, H, dt, backdrop, mode === 'focal');
  if (mode === 'focal') vizArtFocal(g, W, H);
}
// ---- the sound: the one player (ListenPlayer.cs, 2026-11-03), the PC's sound as PCM frames over /audio/stream, each stamped with its time
// on the PC's clock and played three seconds after it (the house hold, the room's own distance), by the context's own output (no media
// element: an Echo Show's media path added most of a second over a phone's, 2026-10-31). A ticket from POST /listen/ticket each start;
// stopped sound starts again on its own. Before this the page held three seconds behind the arrival of its own first frame, and two pages
// could sit a quarter second apart for good (2026-11-03, 3.3 s against 3.0 s after one restarted).
let listening = false, noteText = '', retryT = 0, starting = false;
let ctx = null, gainNode = null;
const PAGE_ID = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);   // this page among the house's listeners, for its own report only
function ensureContext() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();   // made inside the tap, before any wait: a phone unlocks only sound made in a person's gesture
  gainNode = ctx.createGain(); gainNode.gain.value = 1; gainNode.connect(ctx.destination);
  const unlock = ctx.createBufferSource(); unlock.buffer = ctx.createBuffer(1, 1, 22050); unlock.connect(ctx.destination); unlock.start(0);
}
__LISTEN_PLAYER__
// this device's trim (2026-11-03, both reporting 3.0 s): the way from the browser to
// the speaker that the browser does not report, a few tens of milliseconds on an Echo Show; Earlier and Later move it 25 ms a press, kept here
let trim = 0;
try { trim = Math.max(-1000, Math.min(1000, parseInt(localStorage.getItem('prism.listen.trim'), 10) || 0)); } catch (e) {}
function sayTrim() { q('#trimSay').textContent = trim === 0 ? 'In time' : Math.abs(trim) + ' ms ' + (trim > 0 ? 'earlier' : 'later'); }
function setTrim(v) { trim = Math.max(-1000, Math.min(1000, v)); try { localStorage.setItem('prism.listen.trim', String(trim)); } catch (e) {} sayTrim(); rest(); }
q('#earlier').onclick = () => setTrim(trim + 25); q('#later').onclick = () => setTrim(trim - 25);
sayTrim();
const player = makeListenPlayer({
  ctx: () => ctx, sink: () => gainNode, ticket: async () => (await api('/listen/ticket', {})).ticket, policy: () => 'house', leadCap: () => 0.3, targetMs: 3000, trimMs: () => trim,
  onEnd: () => { if (!listening || isOff) return; note('The sound stopped. Trying again'); scheduleRetry(); },
});
async function startAudio() {
  if (isOff || starting || !KEY) return;
  starting = true; listening = true; q('#toggle').textContent = 'Stop'; note('Starting the sound');
  try {
    ensureContext(); ctx.resume().catch(() => {});   // never awaited: a context a phone leaves suspended would hang the wait
    await player.start();
    note('Listening');
  } catch (e) { note(isOff ? '' : 'The sound did not start: ' + e.message); scheduleRetry(); }
  starting = false;
}
function stopAudio(why) {
  listening = false; clearTimeout(retryT); player.stop();
  q('#toggle').textContent = 'Listen'; note(why || '');
}
function scheduleRetry() { if (!listening || isOff) return; clearTimeout(retryT); retryT = setTimeout(() => { if (listening && !isOff) startAudio(); }, 4000); }
// the lag said to the PC every five seconds (the room follows the slowest), measured against the PC's own clock; the house hold is answered
setInterval(() => {
  if (!listening || !KEY) return;
  const lag = player.lagMs(); if (lag === null) return;
  api('/listen/lag', { lagMs: lag, holdMs: player.holdMs(), id: PAGE_ID }).then((r) => { if (r && typeof r.targetMs === 'number') player.setTarget(r.targetMs); }).catch(() => {});
}, 5000);
// the page as the PC serves it (2026-10-31 evening): when it changes, this page loads itself again, so a tablet left on it is never on an old
// one; the code is kept, and the sound starts again on its own where the browser lets it (the Listen button otherwise)
let pageV = '';
setInterval(async () => { try { const r = await fetch('/remote/version', { cache: 'no-store' }); const v = (await r.json()).v; if (!v || v === 'closed') return; if (!pageV) pageV = v; else if (v !== pageV) location.reload(); } catch (e) {} }, 60000);
let restT = 0;
function note(t) { noteText = t; q('#note').textContent = t; rest(); }
function rest() { document.body.classList.remove('rest'); clearTimeout(restT); restT = setTimeout(() => document.body.classList.add('rest'), 6000); }
document.addEventListener('pointerdown', rest); document.addEventListener('keydown', rest);
// Silk kept open (2026-10-31): the Echo Show's browser leaves a page after some ten
// idle minutes; a second, silent sound loaded afresh every minute after the first tap reads to it as activity. Silk only, by its user agent;
// the method of DaGammla's keep-silk-open (MIT, gitlab.com/DaGammla/keep-silk-open). Silk's own policy, so it may stop working with an update.
let keep = null;
function keepSilk() {
  if (keep || !/silk/i.test(navigator.userAgent)) return;
  keep = document.createElement('audio'); keep.preload = 'auto'; document.body.appendChild(keep);
  const again = () => { try { keep.src = '/listen/silence.wav?q=' + Date.now(); keep.currentTime = 0; keep.play().catch(() => {}); } catch (e) {} };
  keep.onended = () => setTimeout(again, 55000);   // two seconds of nothing, then a fresh load a minute on
  again();
}
document.addEventListener('pointerdown', keepSilk); document.addEventListener('keydown', keepSilk); document.addEventListener('click', keepSilk);
// the screen awake where the browser allows it (a tablet on a shelf); asked again when the tab comes back
let lock = null;
function wake() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { lock = l; l.onrelease = () => { lock = null; }; }).catch(() => {}); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (!lock) wake(); viz.lastAt = performance.now(); } });
q('#go').onclick = () => { q('#gate').classList.add('off'); wake(); startAudio(); };
q('#toggle').onclick = () => { if (listening) stopAudio('Stopped'); else startAudio(); };
// a browser that lets a page it knows play without a tap (a second visit on some) starts at once; the others show the one button
async function tryAuto() {
  try {
    ensureContext(); ctx.resume().catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    if (ctx.state !== 'running') return;   // a browser that wants the tap: the one button stays
    q('#gate').classList.add('off'); wake(); startAudio();
  } catch (e) {}
}
connect(); poll(); viz.raf = requestAnimationFrame(draw); rest();
if (KEY) tryAuto(); else askCode('');
</script></body></html>
""";

    /// <summary>What the address answers while the switch is off or the key is not this PC's: a page that says so, nothing else.</summary>
    public const string OffHtml = """
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prism</title>
<style>:root{color-scheme:dark}html,body{margin:0;height:100%;background:#0B0D12;color:#E8ECF2;font:16px system-ui,-apple-system,Segoe UI,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3vh;text-align:center;padding:4vw;box-sizing:border-box}
h1{margin:0;font-size:6vh;font-weight:600;letter-spacing:.3em;padding-left:.3em}p{margin:0;font-size:3vh;opacity:.9;max-width:72vw;line-height:1.35}</style></head>
<body><main><h1>PRISM</h1><p>The listen page is off on this PC, or this is not its address any more. Turn it on from the Prism menu, under Listen page, and open the address it shows.</p></main></body></html>
""";
}
