#!/usr/bin/env node
/*
  A scripted listener on the house's stream (dev tooling, 2026-11-03, B-475): takes a stream ticket with this PC's own house code
  (read from the store, never printed), holds the PCM socket for a while, sends the listen page's lag report so the room step
  engages as it does for a phone, and prints the frames and the peak it hears. Run on the PC that runs Prism, with the listen
  page switched on:   node scripts/listen-probe.mjs [seconds]
  The proof it gave: with every listen since 16:54 reading raw 0.000000, the shared capture (afab4551) read raw 0.207668 in the
  first ten seconds at gain x1, and with the room step on 0.000021 by 0.210 sent at x10000 (host.log, 19:05 and 19:07).
*/
import { readFileSync } from "node:fs";
const store = JSON.parse(readFileSync(process.env.LOCALAPPDATA + "/Prism/store.json", "utf8")).data;
const key = JSON.parse(store["remote:house"]).key;
const hold = Number(process.argv[2] || 75);
const r = await fetch("http://localhost:8471/listen/ticket", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: "{}" });
if (!r.ok) { console.log("ticket:", r.status, await r.text()); process.exit(1); }
const { ticket } = await r.json();
const ws = new WebSocket("ws://localhost:8471/audio/stream?ticket=" + encodeURIComponent(ticket) + "&stamp=1");
ws.binaryType = "arraybuffer";
let frames = 0, peak = 0, bytes = 0, hello = null, firstStamp = null, lastStamp = null;
const t0 = Date.now();
ws.onopen = () => console.log("open", new Date().toTimeString().slice(0, 8));
ws.onmessage = (e) => {
  if (typeof e.data === "string") { hello = e.data; console.log("hello", e.data); return; }
  const b = new DataView(e.data); bytes += e.data.byteLength; frames++;
  const stamp = b.getFloat64(0, true); if (firstStamp === null) firstStamp = stamp; lastStamp = stamp;
  for (let i = 8; i + 1 < e.data.byteLength; i += 2 * 7) { const v = Math.abs(b.getInt16(i, true)) / 32768; if (v > peak) peak = v; }
};
// the lag report every five seconds, as the listen page sends it, so the room step engages and the browser is ducked (gain x10000)
const lagTimer = setInterval(() => { fetch("http://localhost:8471/listen/lag", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ lagMs: 3000, holdMs: 3000, id: "probe" + process.pid }) }).then((r) => r.json()).then((j) => { if (!lagTimer.said) { lagTimer.said = 1; console.log("lag answer", JSON.stringify(j)); } }).catch(() => {}); }, 5000);
ws.onclose = (e) => { console.log("closed", e.code, e.reason); process.exit(0); };
ws.onerror = () => console.log("socket error");
const tick = setInterval(() => {
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s: ${frames} frames, ${(bytes / 1024).toFixed(0)} KB, peak ${peak.toFixed(4)}, stamps ${firstStamp === null ? "-" : (firstStamp / 1000).toFixed(1) + " .. " + (lastStamp / 1000).toFixed(1)}`);
  peak = 0;
}, 15000);
setTimeout(() => { clearInterval(tick); ws.close(); console.log("done"); setTimeout(() => process.exit(0), 500); }, hold * 1000);
