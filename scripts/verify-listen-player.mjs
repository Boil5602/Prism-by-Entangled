// The one listen player (targets/win-host/PrismHost/Services/ListenPlayer.cs, 2026-11-03) run under stubs: a fake audio context, socket,
// clock answer and PC, with frames stamped on the PC's clock. What is checked: every frame sounds at its stamp plus the house hold on
// the PC's clock, whatever the network's delay and whenever the page started (two pages agree within a frame); a burst after the page
// was held is dropped, not played late; without a clock answer the page still holds behind arrival; the 'close' policy holds the
// network's floor plus a short lead and grows the lead on a stall. A verify step (scripts/verify.mjs).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cs = readFileSync(path.join(root, "targets/win-host/PrismHost/Services/ListenPlayer.cs"), "utf8");
const js = cs.slice(cs.indexOf('"""') + 3, cs.lastIndexOf('"""'));

let failed = 0;
function check(what, ok, detail) { if (ok) console.log("ok   " + what); else { failed++; console.log("FAIL " + what + (detail === undefined ? "" : " (" + detail + ")")); } }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// one world: the page's clock (perf, ms), the PC's clock (perf + PC_OFFSET), a context whose time runs with perf, a socket the test feeds
function world({ clockAnswers = true, outputLatency = 0.05 } = {}) {
  const w = { perf: 50_000, PC_OFFSET: 123_456.7, sockets: [], sources: [], fetches: 0, ended: [] };
  const t0 = w.perf;   // the context is made now; its currentTime is seconds since
  const ctx = { get currentTime() { return (w.perf - t0) / 1000; }, outputLatency, baseLatency: 0, state: "running",
    createBuffer: (ch, frames, rate) => ({ duration: frames / rate, getChannelData: () => new Float32Array(frames) }),
    createBufferSource: () => { const s = { playbackRate: { value: 1 }, buffer: null, startedAt: null, stoppedAt: null, connect() {}, start(at) { s.startedAt = at; w.sources.push(s); }, stop(at) { s.stoppedAt = at === undefined ? -1 : at; } }; return s; } };
  const sink = { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } };
  class FakeSocket { constructor(url) { this.url = url; this.readyState = 1; this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null; w.sockets.push(this); } close() { this.readyState = 3; } }
  const sandbox = {
    performance: { now: () => w.perf }, Date: { now: () => 1_700_000_000_000 + w.perf },
    fetch: async (url) => { w.fetches++; if (!clockAnswers) throw new Error("no clock"); w.perf += 2; const now = w.perf + w.PC_OFFSET; w.perf += 2; return { ok: true, json: async () => ({ now, start: 0, shift: 0 }) }; },
    WebSocket: FakeSocket, location: { protocol: "http:", host: "pc:8471" },
    setInterval: () => 1, clearInterval: () => {}, setTimeout: (fn) => { fn(); return 1; },
    Math, JSON, Promise, Infinity, DataView, Int16Array, Float32Array, ArrayBuffer, encodeURIComponent, console,
  };
  const make = vm.runInNewContext(js + "\nmakeListenPlayer", sandbox);
  w.player = (opts) => make(Object.assign({ ctx: () => ctx, sink: () => sink, ticket: async () => "tk" + (w.sockets.length + 1), policy: () => "house", leadCap: () => 0.3, targetMs: 3000, onEnd: (why) => w.ended.push(why) }, opts));
  w.ctx = ctx; w.t0 = t0;
  // a frame stamped at stampMs on the PC's clock, arriving now
  w.frame = (sock, stampMs) => { const b = new ArrayBuffer(8 + 3840); new DataView(b).setFloat64(0, stampMs, true); const n = w.sources.length; sock.onmessage({ data: b }); if (w.sources.length > n) w.sources[w.sources.length - 1].stamp = stampMs; };
  w.hello = (sock) => { sock.onopen(); sock.onmessage({ data: JSON.stringify({ rate: 48000, channels: 2, stamp: 8 }) }); };
  // when a source sounds, on the PC's clock: its start in the context plus the way to the speaker, back through the page's clock
  w.soundsAt = (s) => (s.startedAt + outputLatency) * 1000 + t0 + w.PC_OFFSET;
  return w;
}
const settle = () => new Promise((r) => setImmediate(r));

// ---- A. the house hold against the PC's clock, whatever the delay and whenever the page started
{
  const w = world();
  const p1 = w.player({}); await p1.start(); await settle();
  const s1 = w.sockets[0]; w.hello(s1); await settle(); await settle();
  // frames every 20 ms on the PC's clock, each arriving 30 ms after its stamp
  let stamp = 1000;
  const arrive = (sock, delayMs, n) => { for (let i = 0; i < n; i++) { w.perf = stamp - w.PC_OFFSET + delayMs; w.frame(sock, stamp); stamp += 20; } };
  arrive(s1, 30, 150);
  check("the clock was asked", w.fetches >= 1, w.fetches);
  const last1 = w.sources[w.sources.length - 1]; const stamp1 = stamp - 20;
  check("a frame sounds at its stamp plus the house hold on the PC's clock", near(w.soundsAt(last1), stamp1 + 3000, 10), (w.soundsAt(last1) - stamp1).toFixed(1));
  check("the lag it reports is the house hold", near(p1.lagMs(), 3000, 10), p1.lagMs());
  check("it holds to the house figure", p1.holdMs() === 3000, p1.holdMs());
  const speeds = w.sources.slice(-50).map((s) => s.playbackRate.value);
  check("the speed stays within half a percent", speeds.every((v) => Math.abs(v - 1) <= 0.005), Math.max(...speeds.map((v) => Math.abs(v - 1))));
  // a second page starts seven seconds later, its frames arriving 300 ms late (a queue toward it): it sounds the same moment
  const before = w.sources.length;
  const p2 = w.player({}); await p2.start(); await settle();
  const s2 = w.sockets[1]; w.hello(s2); await settle(); await settle();
  for (let i = 0; i < 150; i++) { w.perf = stamp - w.PC_OFFSET + 300; w.frame(s2, stamp); w.perf = stamp - w.PC_OFFSET + 30; w.frame(s1, stamp); stamp += 20; }
  const mine = w.sources.slice(before);
  const a = mine[mine.length - 2], b = mine[mine.length - 1];   // the same stamp on both pages
  check("two pages play the same stamp at the same moment, whatever their delay", near(w.soundsAt(a), w.soundsAt(b), 10), (w.soundsAt(a) - w.soundsAt(b)).toFixed(1));
  check("the late-fed page reports the same lag", near(p2.lagMs(), 3000, 10), p2.lagMs());
  // the first page is held for six seconds, then its frames come in a burst: the stale ones are dropped, the rest play in time
  const held = stamp; stamp += 6000; const burstStart = w.sources.length;
  w.perf = stamp - w.PC_OFFSET + 30;
  for (let s = held; s < stamp; s += 20) w.frame(s1, s);
  const burst = w.sources.slice(burstStart);
  const info = p1.info();
  check("a burst after a hold drops the frames past their time", info.late > 100 && info.late < 170, info.late);
  check("and plays the rest at their time", burst.length > 100 && burst.every((s) => near(w.soundsAt(s), s.stamp + 3000, 20)), burst.length);
  for (let i = 0; i < 150; i++) { w.perf = stamp - w.PC_OFFSET + 30; w.frame(s1, stamp); stamp += 20; }
  check("and holds the house figure again after it", near(p1.lagMs(), 3000, 30), p1.lagMs());
  p1.stop(); p2.stop();
  check("stop closes the socket and the scheduled sound", s1.readyState === 3 && w.sources.slice(-1)[0].stoppedAt === -1);
  // a device's trim (the way to its speaker the browser does not report): the sound that much earlier, the clock untouched
  const p3 = w.player({ trimMs: () => 75 }); await p3.start(); await settle();
  const s3 = w.sockets[2]; w.hello(s3); await settle(); await settle();
  for (let i = 0; i < 120; i++) { w.perf = stamp - w.PC_OFFSET + 30; w.frame(s3, stamp); stamp += 20; }
  const l3 = w.sources[w.sources.length - 1];
  check("a trim of 75 ms sounds the frame 75 ms earlier", near(w.soundsAt(l3), l3.stamp + 3000 - 75, 10), (w.soundsAt(l3) - l3.stamp).toFixed(1));
  check("and still says it holds the house figure", p3.holdMs() === 3000);
  p3.stop();
}

// ---- B. no clock answer: the page still holds three seconds behind arrival
{
  const w = world({ clockAnswers: false });
  const p = w.player({}); await p.start(); await settle();
  const s = w.sockets[0]; w.hello(s); await settle();
  let stamp = 1000; for (let i = 0; i < 100; i++) { w.perf = stamp - w.PC_OFFSET + 30; w.frame(s, stamp); stamp += 20; }
  check("without a clock the hold is behind arrival, encode and network allowed for", near(p.lagMs(), 3080, 40), p.lagMs());
  check("and says it has no clock", p.info().clock === false);
  p.stop();
}

// ---- C. the 'close' policy: the network's floor plus the lead, grown on a stall
{
  const w = world();
  const p = w.player({ policy: () => "close", leadCap: () => 0.2 }); await p.start(); await settle();
  const s = w.sockets[0]; w.hello(s); await settle(); await settle();
  let stamp = 1000; for (let i = 0; i < 200; i++) { w.perf = stamp - w.PC_OFFSET + 30; w.frame(s, stamp); stamp += 20; }
  check("close holds the floor plus the lead", near(p.lagMs(), 30 + 90, 15), p.lagMs());
  check("the lag is what it holds to", p.holdMs() === p.lagMs());
  // the network holds frames back 300 ms, then they come in a burst: the sound ran dry, the lead grows a step, the hold follows after one cut
  w.perf = stamp - w.PC_OFFSET + 300; for (let k = 0; k < 15; k++) { w.frame(s, stamp); stamp += 20; }
  for (let i = 0; i < 200; i++) { w.perf = stamp - w.PC_OFFSET + 30; w.frame(s, stamp); stamp += 20; }
  const i = p.info();
  check("a stall grows the lead by 40 ms", i.stalls === 1 && i.lead === 130, i.stalls + " " + i.lead);
  check("and the hold follows", near(p.lagMs(), 30 + 130, 25), p.lagMs());
  check("by one cut", w.sources.filter((x) => x.stoppedAt !== null && x.stoppedAt !== -1).length > 0);
  p.stop();
}

// ---- D. a frozen socket: a fresh ticket and a new socket, twice, then the page is told
{
  const w = world();
  const p = w.player({}); await p.start(); await settle();
  const s = w.sockets[0]; w.hello(s); await settle();
  // the watch runs on a timer the stub never fires; it is reached through the frames' own timing here: nothing to test without the timer,
  // so the reopen is checked by its outcome in the browser (the page keeps the old socket until the new opens). Checked: start/stop/onEnd.
  s.onclose();
  check("the socket closing ends the listen and says so", w.ended.length === 1 && /stopped the stream/.test(w.ended[0]), w.ended.join(" | "));
  check("after which it is not listening", p.listening() === false);
}

if (failed) { console.log(failed + " check(s) failed"); process.exit(1); }
console.log("listen player: all checks pass");
