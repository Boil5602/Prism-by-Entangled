#!/usr/bin/env node
/**
 * The §24 chime, generated rather than sourced.
 *
 * dashboard-schema §24 wants the alarm/timer tone to be **local and
 * offline-proof**: bundled with the shell, playable with the network down,
 * and at the volume the household set. Sourcing a sound file drags a licence
 * question behind it forever; synthesising one makes the asset public domain
 * by construction, so this script IS the provenance — no attribution file to
 * keep in step, nothing to re-clear if the tone is ever retuned.
 *
 * What it writes: a soft two-note bell (A5 → D6, a rising major fourth), each
 * strike a fundamental plus two quieter partials under an exponential decay,
 * with a short raised-cosine attack so nothing clicks. Deliberately NOT a
 * square-wave beep: a kitchen panel that beeps gets muted, and a muted timer
 * is not a timer.
 *
 *   node scripts/make-chime.mjs            write the WAV
 *   node scripts/make-chime.mjs --check    regenerate in memory and fail if
 *                                          the committed file differs
 *
 * Output: targets/win-host/PrismHost/Assets/tiles/shared/chime.wav
 * (16-bit mono PCM, 22.05 kHz, ~1.9 s, ~82 KB). Deterministic: same script,
 * same bytes.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outPath = join(root, "targets", "win-host", "PrismHost", "Assets", "tiles", "shared", "chime.wav");

const RATE = 22050;
const SECONDS = 1.9;
const PEAK = 0.55;              // headroom: the page's own volume control is the loudness knob, not this file

/** One bell strike: fundamental + two partials, each with its own decay. */
const STRIKES = [
  { at: 0.00, hz: 880.0 },      // A5
  { at: 0.42, hz: 1174.66 },    // D6
];
/** Partial ratios, relative amplitude, and decay constant (seconds). Higher partials fade first — that is what reads as "bell". */
const PARTIALS = [
  { ratio: 1.0, amp: 1.0, tau: 0.62 },
  { ratio: 2.0, amp: 0.30, tau: 0.28 },
  { ratio: 3.01, amp: 0.10, tau: 0.14 },
];
const ATTACK = 0.006;           // raised-cosine rise; without it the strike clicks

function render() {
  const n = Math.round(RATE * SECONDS);
  const buf = new Float64Array(n);
  for (const strike of STRIKES) {
    const start = Math.round(strike.at * RATE);
    for (let i = start; i < n; i++) {
      const t = (i - start) / RATE;
      const attack = t < ATTACK ? 0.5 - 0.5 * Math.cos((Math.PI * t) / ATTACK) : 1;
      let v = 0;
      for (const p of PARTIALS) v += p.amp * Math.exp(-t / p.tau) * Math.sin(2 * Math.PI * strike.hz * p.ratio * t);
      buf[i] += attack * v;
    }
  }
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const gain = max > 0 ? PEAK / max : 0;

  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    // round-half-away-from-zero, clamped: the same integer on every platform
    const s = buf[i] * gain;
    const q = Math.max(-32768, Math.min(32767, Math.sign(s) * Math.round(Math.abs(s) * 32767)));
    data.writeInt16LE(q, i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);          // PCM chunk size
  header.writeUInt16LE(1, 20);           // format = PCM
  header.writeUInt16LE(1, 22);           // channels = mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);    // byte rate
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const wav = render();
if (process.argv.includes("--check")) {
  if (!existsSync(outPath)) {
    console.error("chime: " + outPath + " is missing — run `node scripts/make-chime.mjs`");
    process.exit(1);
  }
  const on = readFileSync(outPath);
  if (!on.equals(wav)) {
    console.error("chime: the committed WAV differs from what this script produces — regenerate and commit it");
    process.exit(1);
  }
  console.log(`chime ok: ${outPath} reproduces byte-for-byte (${wav.length} bytes)`);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, wav);
  console.log(`chime written: ${outPath} (${wav.length} bytes, ${RATE} Hz mono 16-bit, ${SECONDS}s)`);
}
