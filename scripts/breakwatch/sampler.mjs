// The break watch's overnight sampler (2026-11-04: test every YouTube TV channel, five at a time; the owner's yes to the screen 1-6 AM and
// to five streams). PRISM's Movie Night scene on the screen, the PC muted, the big screen and four multiview windows each on a channel for
// half an hour, then the next five, through the whole lineup and round again (state.json remembers where it got to). The bench records every
// window a second at a time (PRISM_FRAME_SAMPLER=1, Keep recording on), and the keeper files the recordings by day for the recurrence miner
// and the doctor's labelling. Nothing is labelled here and nothing leaves the PC.
//
// It stops at once, leaving the screen as it is and the sound as it was, when a person acts: a press on PRISM's window, or a phone that does
// anything but read (a POST). At the end it closes the windows, puts back the scene that was up, and the PC's mute as it was.
//
// The idle runs (2026-11-05, the owner's yes to sampling beyond the night): with --idle=MIN it waits, and samples whenever nobody has used
// the PC or PRISM for MIN minutes, nothing of PRISM's is playing sound and the screen holds no title; a press stops the run as at night,
// and the wait starts again. These runs never touch the PC's mute (a call on the PC keeps its sound): PRISM alone goes silent in the room,
// the person's own mute (B-472), whose floor the page meters read through, so the sound inputs are recorded the same.
//
//   node scripts/breakwatch/sampler.mjs [--until=06:00] [--slot-min=30] [--windows=5] [--idle=60] [--mute=pc|prism] [--dry]
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, statSync, openSync, readSync, closeSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const opt = (n, d) => { const a = process.argv.find((x) => x.startsWith(n + "=")); return a ? a.slice(n.length + 1) : d; };
const DRY = process.argv.includes("--dry");
const UNTIL = opt("--until", "06:00");
const SLOT_MIN = Number(opt("--slot-min", "30"));
// five by default; three when PRISM's window is narrow (2026-11-04: on a 1,290 px wide window the fourth and fifth multiview windows sat
// low on the screen and YouTube TV ignored the press that tunes them; the big screen and two windows tuned every time)
const WINDOWS = Number(opt("--windows", "5"));
// the scene put back at the end; the scene that was up at the start otherwise (a run started over an earlier one finds the video scene up)
const RESTORE = opt("--restore", null);
// minutes nobody has used the PC or PRISM before an idle run; 0 = the night's run, at once
const IDLE = Number(opt("--idle", "0"));
// what goes silent: the PC's playback device (the nights) or PRISM alone in the room (the idle runs, always)
const MUTE = IDLE ? "prism" : opt("--mute", "pc");
const DIAG = join(process.env.LOCALAPPDATA, "Prism", "diagnostics");
const HOSTLOG = join(DIAG, "host.log");
const OUT = join("scripts", "doctor", "out", "sampler"); mkdirSync(OUT, { recursive: true });
const STATE = join(OUT, "state.json");
const LOG = join(OUT, new Date().toISOString().slice(0, 10) + ".log");
const LOCK = join(OUT, "running.lock");
const IDLELOCK = join(OUT, "idle.lock");
const FACET = "youtube-tv-home-16x9-XL";
// never a channel airing the household's own shows (memory: never play their shows), FOX among them; shopping and ambient channels are
// programmes with no breaks to learn from
const SKIP_NAME = /^(FOX\b|FOX \d|QVC|HSN|YouTube TV Zen|Jewelry|ShopHQ)/i;
const SKIP_SHOW = /ted lasso|\bdoc\b/i;

const log = (s) => { const l = new Date().toTimeString().slice(0, 8) + " " + s; console.log(l); appendFileSync(LOG, l + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalBrain(js, timeoutMs = 25000) {
  const done = join(DIAG, "eval.done"), req = join(DIAG, "eval.request");
  try { unlinkSync(done); } catch {}
  writeFileSync(req, "brain\n" + js);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { await sleep(250); if (existsSync(done)) { await sleep(60); return readFileSync(done, "utf8"); } }
  throw new Error("PRISM did not answer: " + js.slice(0, 60));
}
// the video verbs answer JSON strings, and eval.done holds the JSON of what the expression gave: unwrap both
async function call(js) {
  const raw = await evalBrain(js);
  let v = raw; try { v = JSON.parse(raw); } catch {}
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return v; } }
  return v;
}
const q = (s) => JSON.stringify(s);

function pcMute(arg) {
  try { return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join("scripts", "breakwatch", "pc-mute.ps1"), arg], { encoding: "utf8" }).trim(); }
  catch (e) { log("pc mute " + arg + " failed: " + e.message); return "?"; }
}
const muteWord = (r) => (r?.muted === true ? "muted" : r?.muted === false ? "unmuted" : "?");
async function muteGet() { return MUTE === "pc" ? pcMute("get") : muteWord(await call("PrismRuntime.wallMute()")); }
async function muteSet(on) { return MUTE === "pc" ? pcMute(on ? "on" : "off") : muteWord(await call("PrismRuntime.wallMute(" + (on ? "true" : "false") + ")")); }

// a person acting: host.log read from where it stood at the start
let logPos = 0;
// the player as a slot needs it (2026-11-04: two failed tunes closed their windows, multiview switched itself off and PRISM's Watch page
// came up over the screen; every tune after that answered ok and played nothing): the Watch page closed, multiview on
async function ensureUp(hard) {
  try { writeFileSync(join(DIAG, "hub.request"), "close"); } catch {}
  await sleep(1500);
  if (hard) {
    log("  setting the player up again");
    await call("PrismRuntime.modelApplyScene('movie-night-1')"); await sleep(6000);
    await call(`PrismRuntime.videoSwitch(${q(FACET)})`); await sleep(4000);
  }
  const mv = await call("PrismRuntime.videoMultiview('state')");
  if (!mv?.on) { await call("PrismRuntime.videoMultiview('on')"); await sleep(3000); log("  multiview was off: on again"); }
}
function startWatch() { try { logPos = statSync(HOSTLOG).size; } catch { logPos = 0; } }
function personActed() {
  let size; try { size = statSync(HOSTLOG).size; } catch { return null; }
  if (size < logPos) logPos = 0;   // the log rotated
  if (size === logPos) return null;
  const fd = openSync(HOSTLOG, "r"); const buf = Buffer.alloc(Math.min(size - logPos, 8_000_000)); readSync(fd, buf, 0, buf.length, logPos); closeSync(fd);
  logPos = size;
  for (const line of buf.toString("utf8").split("\n")) {
    if (/ press at \d/.test(line)) return line.slice(0, 120);
    if (phoneActed(line)) return "a phone acted: " + line.slice(0, 100);
  }
  return null;
}

// a phone's request that changes something (2026-11-05: the phone's Live section only READS the guides, by a POST, and at 18:49 that stopped a
// run nobody had touched): a POST, PUT or DELETE, less the ones that read and change nothing on the PC or the screen
const PHONE_READS = ["/video/live-read", "/video/search/view", "/video/details", "/video/listinfo", "/video/remove-info", "/updates/check"];
function phoneActed(line) {
  if (!/call \{"fn":"http"/.test(line) || !/\\u0022method\\u0022:\\u0022(POST|PUT|DELETE)/.test(line)) return false;
  const m = /\\u0022path\\u0022:\\u0022([^\\]+)\\u0022/.exec(line);
  return !(m && PHONE_READS.includes(m[1]));
}
// host.log read on from where it stood, for the idle runs: the last press (on PRISM's window, or a phone that does more than read), and
// each page's own audible state as WebView2 reports it on a change (the now-playing line can be a phantom; this cannot), until the page goes
class LogTail {
  constructor() { this.pos = 0; this.sounding = new Map(); this.muted = new Map(); this.lastPress = 0; }
  // the pages playing sound into the room: audible and not muted
  loud() { return [...this.sounding].filter(([id, on]) => on && !this.muted.get(id)).map(([id]) => id); }
  read() {
    let size; try { size = statSync(HOSTLOG).size; } catch { return; }
    if (size < this.pos) { this.pos = 0; this.sounding.clear(); this.muted.clear(); }   // a new log: PRISM started again
    if (size === this.pos) return;
    const fd = openSync(HOSTLOG, "r");
    try {
      while (this.pos < size) {
        const n = Math.min(size - this.pos, 16_000_000); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, this.pos);
        let end = buf.lastIndexOf(10); if (end < 0) end = n - 1;
        this.scan(buf.subarray(0, end + 1).toString("utf8")); this.pos += end + 1;
      }
    } finally { closeSync(fd); }
  }
  scan(text) {
    const now = new Date(); const nowS = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const midnight = now.getTime() - nowS * 1000 - now.getMilliseconds();
    for (const line of text.split(String.fromCharCode(10))) {
      if (/ press at \d/.test(line) || phoneActed(line)) {
        const m = /^(\d\d):(\d\d):(\d\d)/.exec(line);
        if (m) { let t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); if (t > nowS + 60) t -= 86400; this.lastPress = Math.max(this.lastPress, midnight + t * 1000); }
        continue;
      }
      let m = /audible (\S+): (True|False) muted=(True|False)/.exec(line);
      if (m) { this.sounding.set(m[1], m[2] === "True"); this.muted.set(m[1], m[3] === "True"); continue; }
      // PRISM's own mute of a page changes no audible line: it is read from the command
      m = /<- surface\.setMuted (\S+) muted=(True|False)/.exec(line); if (m) { this.muted.set(m[1], m[2] === "True"); continue; }
      m = /<- surface\.destroy (\S+)/.exec(line); if (m) { this.sounding.delete(m[1]); this.muted.delete(m[1]); }
    }
  }
}
// why an idle run should not start now ([kind, words]), or null
async function busyReason(tail) {
  // PRISM silent in the room (its own mute, B-472): the PC's own use does not hold the run - the person may browse, work or take a call on
  // the PC while PRISM records unheard (2026-11-05, the owner using the browser and asking that the capture not stop); only PRISM's own use does
  if (lockLive(join("scripts", "doctor", "out", "doctor.lock"))) return ["doctor", "the doctor's run is reading PRISM"];   // before any read of PRISM: one eval channel
  let roomMuted = false;
  try { roomMuted = (await call("PrismRuntime.wallMute()"))?.muted === true; } catch { return ["prism", "PRISM did not answer"]; }
  let idle = -1;
  try { idle = Number(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join("scripts", "breakwatch", "pc-idle.ps1")], { encoding: "utf8" }).trim()); } catch {}
  if (!roomMuted && !(idle >= 0)) return ["pc?", "the PC's idle time could not be read"];
  if (!roomMuted && idle < IDLE) return ["pc", "the PC was used " + idle + " min ago"];
  tail.read();
  const since = Math.round((Date.now() - tail.lastPress) / 60000);
  if (since < IDLE) return ["press", "PRISM was used " + since + " min ago"];
  if (lockLive(join("scripts", "doctor", "out", "doctor.lock"))) return ["doctor", "the doctor's run is reading PRISM"];
  // PRISM silent in the room (its own mute, B-472) and nobody at the PC or PRISM for IDLE minutes: nobody is watching or listening, so what the
  // pages play and what the screen holds do not hold the run (2026-11-05, the owner away and asking for more recording; the afternoon had
  // waited on three muted channels left on the screen). With the room's sound on, a page playing sound or a title on the screen still does.
  const loud = tail.loud();
  if (loud.length && !roomMuted) return ["sound", "PRISM is playing sound (" + loud.join(", ") + ")"];
  let p, mv;
  try { p = await call("PrismRuntime.players()"); mv = p?.active === "video" ? await call("PrismRuntime.videoMultiview('state')") : null; }
  catch { return ["prism", "PRISM did not answer"]; }
  if (mv?.big?.has && !roomMuted) return ["screen", "the screen has " + (mv.big.title || mv.big.name || "a title") + " on it"];
  if (lockLive(LOCK)) return ["lock", "another sampler is running"];
  return null;
}
function lockLive(path) { try { const l = JSON.parse(readFileSync(path, "utf8")); process.kill(l.pid, 0); return l.pid; } catch { return 0; } }
function dropLock(path) { try { if (JSON.parse(readFileSync(path, "utf8")).pid === process.pid) unlinkSync(path); } catch {} }

// the recordings filed by day (keep.py: the bench keeps only each window's last frames), after every slot and at the end, so a night's frames
// are kept whether or not anyone runs the keeper
function keep() {
  try { const o = execFileSync("python", ["scripts/breakwatch/keep.py"], { encoding: "utf8", timeout: 600000 }); log("keep: " + o.trim().split(String.fromCharCode(10)).pop()); }
  catch (e) { log("keep failed: " + (e?.message ?? e)); }
}
function untilMs() {
  const [h, m] = UNTIL.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function session(stopAt) {
  log(`sampler: until ${UNTIL} (${Math.round((stopAt - Date.now()) / 60000)} min), ${WINDOWS} windows, ${SLOT_MIN} min a slot${DRY ? ", dry" : ""}`);
  // nothing playing that a person chose, nobody at the controls in the last ten minutes
  const players = await call("PrismRuntime.players()");
  const before = { scene: RESTORE ?? (players?.active === "video" ? players.video?.id : players?.music?.id), player: RESTORE ? (RESTORE === players?.video?.id ? "video" : "music") : players?.active, mute: await muteGet() };
  log("before: " + JSON.stringify(before));
  if (before.mute === "?") { log((MUTE === "pc" ? "the PC's" : "PRISM's own") + " mute could not be read; not sampling"); return; }
  const menu = await call("PrismRuntime.videoMenu()");
  const ytv = (menu.live || []).find((l) => l.app === "youtube-tv");
  if (!ytv) { log("no YouTube TV in the live guide; stopping"); return; }
  const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { next: 0, rounds: 0, seen: {} };
  // the guide's list as PRISM holds it can be partial (2026-11-04: six channels where an hour before there were 126): the fullest list
  // seen is kept and used whenever the guide gives a shorter one
  let lineup = (ytv.channels || []).map((c) => ({ id: c.id, name: c.name, now: c.now?.title ?? c.now ?? "" }));
  if (lineup.length >= 50 && lineup.length >= (st.lineup?.length ?? 0)) st.lineup = lineup;
  else if (st.lineup?.length) { log(`the guide gave ${lineup.length} channels; the ${st.lineup.length} kept from before are used`); lineup = st.lineup; }
  const chans = lineup.filter((c) => c.id && !SKIP_NAME.test(c.name || "") && !SKIP_SHOW.test(JSON.stringify(c.now || "")));
  log(`${lineup.length} channels, ${chans.length} after the skips`);
  if (DRY) { log("first five: " + chans.slice(st.next % chans.length, st.next % chans.length + 5).map((c) => c.name).join(", ")); return; }

  // the doctor's night run reads PRISM through the same channel: it skips its health step while this lock stands (nightly.mjs)
  writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), until: UNTIL }));
  startWatch();
  log("silent: " + (MUTE === "pc" ? "the PC " : "PRISM ") + await muteSet(true));
  if (before.player !== "video") { log("Movie Night up: " + JSON.stringify(await call("PrismRuntime.modelApplyScene('movie-night-1')")).slice(0, 120)); await sleep(6000); }
  await call(`PrismRuntime.videoSwitch(${q(FACET)})`); await sleep(4000);
  await call("PrismRuntime.videoMultiview('on')"); await sleep(3000);

  let stopped = null;
  try {
    let lastSlotDead = false; let deadRun = 0;
    st.failed ??= {};
    while (Date.now() < stopAt) {
      await ensureUp(lastSlotDead);
      // a channel that failed twice tonight is passed over (the two WPSU listings never played)
      const pick = []; let k = 0;
      while (pick.length < WINDOWS && k < chans.length) { const c = chans[(st.next + k) % chans.length]; k++; if ((st.failed[c.id] ?? 0) >= 2) continue; pick.push(c); }
      const used = k;
      log("slot: " + pick.map((c) => c.name).join(", "));
      // the big screen, then each window: an existing one by its index, a missing one (closed as empty after a failed tune) opened anew
      const state = await call("PrismRuntime.videoMultiview('state')");
      const have = Array.isArray(state?.windows) ? state.windows.length : Array.isArray(state) ? state.length : 1;
      for (let i = 0; i < WINDOWS; i++) {
        const c = pick[i];
        if (i === 0) { await call("PrismRuntime.videoMultiview('target','0')"); }
        else if (i < have) { await call(`PrismRuntime.videoMultiview('target',${q(String(i))})`); }
        else { await call("PrismRuntime.videoMultiview('drop','new')"); }
        const r = await call(`PrismRuntime.videoTune(${q(FACET)}, ${q(c.id)}, null, ${q(c.name)})`);
        log(`  ${i}: ${c.name}: ${JSON.stringify(r).slice(0, 80)}`);
        st.seen[c.id] = { name: c.name, at: new Date().toISOString() };
        await sleep(9000);
        const a = personActed(); if (a) { stopped = a; break; }
      }
      try { await call("PrismRuntime.videoMultiview('target','0')"); } catch {}
      if (stopped) break;
      // each window checked a minute on (2026-11-04: two of the first five were closed as empty when their tunes timed out): one not
      // playing is tuned again, then to the next channel in the lineup, three tries in all
      let spare = WINDOWS;
      for (let attempt = 0; attempt < 3 && !stopped; attempt++) {
        await sleep(60000);
        const a0 = personActed(); if (a0) { stopped = a0; break; }
        const now = await call("PrismRuntime.videoMultiview('state')");
        const wins = Array.isArray(now?.windows) ? now.windows : [];
        const idle = []; for (let i = 0; i < WINDOWS; i++) { const w = wins.find((x) => x.index === i); if (!w || !w.playing) idle.push(i); }
        if (!idle.length) { log("  all " + WINDOWS + " playing"); lastSlotDead = false; break; }
        for (const i of idle) st.failed[pick[i].id] = (st.failed[pick[i].id] ?? 0) + 1;
        if (attempt === 2) { lastSlotDead = idle.length === WINDOWS; break; }
        for (const i of idle) {
          let c = attempt === 0 ? pick[i] : chans[(st.next + spare++) % chans.length];
          while (attempt > 0 && (st.failed[c.id] ?? 0) >= 2 && spare < chans.length) c = chans[(st.next + spare++) % chans.length];
          if (attempt > 0) pick[i] = c;
          const exists = wins.some((x) => x.index === i);
          if (exists) await call(`PrismRuntime.videoMultiview('target',${q(String(i))})`); else await call("PrismRuntime.videoMultiview('drop','new')");
          const r = await call(`PrismRuntime.videoTune(${q(FACET)}, ${q(c.id)}, null, ${q(c.name)})`);
          log(`  retry ${attempt + 1}, window ${i}: ${c.name}: ${JSON.stringify(r).slice(0, 60)}`);
          st.seen[c.id] = { name: c.name, at: new Date().toISOString() };
          await sleep(12000);
        }
        try { await call("PrismRuntime.videoMultiview('target','0')"); } catch {}
      }
      if (stopped) break;
      st.next = (st.next + used) % chans.length; if (st.next < used) st.rounds++;
      writeFileSync(STATE, JSON.stringify(st, null, 1));
      keep();
      // a slot where nothing played is not waited out (2026-11-05: half an hour of three empty windows after a restart): the player is set
      // up again and the next channels tuned at once
      deadRun = lastSlotDead ? deadRun + 1 : 0;
      if (lastSlotDead && deadRun < 3) { log("  nothing played: the next slot now"); continue; }   // three in a row: YouTube TV itself, so the slot is waited
      const slotEnd = Math.min(stopAt, Date.now() + SLOT_MIN * 60000);
      while (Date.now() < slotEnd) { await sleep(15000); const a = personActed(); if (a) { stopped = a; break; } }
      if (stopped) break;
    }
  } catch (e) { log("sampler error: " + (e?.message ?? e)); }
  writeFileSync(STATE, JSON.stringify(st, null, 1));
  keep();
  if (stopped) { log("a person acted, stopping and leaving the screen as it is: " + stopped); await muteSet(before.mute === "muted"); dropLock(LOCK); return; }
  // the end: the windows closed, the scene that was up put back, the mute as it was
  try { await call("PrismRuntime.videoMultiview('close')"); } catch {}
  if (before.player !== "video" && before.scene) { try { log("scene back: " + JSON.stringify(await call(`PrismRuntime.modelApplyScene(${q(before.scene)})`)).slice(0, 120)); } catch (e) { log("scene back failed: " + e.message); } }
  log((MUTE === "pc" ? "pc " : "PRISM ") + await muteSet(before.mute === "muted") + "; done, next channel index " + st.next);
  dropLock(LOCK);
}

async function main() {
  process.on("exit", () => { dropLock(LOCK); dropLock(IDLELOCK); });
  // one sampler at a time (2026-11-04: one started by hand ran past the scheduled 1 AM start): a live lock means another is driving PRISM
  const other = lockLive(LOCK);
  if (other) { log("another sampler is running (pid " + other + "); this one stops"); return; }
  const stopAt = untilMs();
  if (!IDLE) return session(stopAt);
  const waiting = lockLive(IDLELOCK);
  if (waiting) { log("another idle sampler is waiting (pid " + waiting + "); this one stops"); return; }
  writeFileSync(IDLELOCK, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), until: UNTIL }));
  log(`idle sampler: until ${UNTIL}, a run whenever nobody has used the PC or PRISM for ${IDLE} min, nothing of PRISM's plays sound and the screen holds no title`);
  const tail = new LogTail(); let said = "";
  while (Date.now() < stopAt) {
    const why = await busyReason(tail);
    if (!why) { log("idle: sampling"); said = ""; await session(stopAt); tail.read(); }
    else if (why[0] !== said) { log("waiting: " + why[1]); said = why[0]; }
    const wake = Math.min(stopAt, Date.now() + 5 * 60000);
    while (Date.now() < wake) await sleep(15000);
  }
  log("idle sampler: " + UNTIL + ", done");
}
main().catch((e) => { log("sampler failed: " + (e?.message ?? e)); process.exit(1); });
