// The extension's audio landmarks against fingerprint.py's dump (2026-11-08, E3):
//   node scripts/breakwatch/fp-parity.mjs <pcm.f32> <dump.csv of hash,frame>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const NS = require(path.resolve(here, '../../prototypes/prism-veil-extension/src/breakwatch/audio-landmarks.js'));
const [pcmPath, csvPath] = process.argv.slice(2);
const raw = fs.readFileSync(pcmPath); const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
const t0 = performance.now(); const lm = NS.AudioLandmarks.of(pcm); const ms = performance.now() - t0;
const want = new Set(fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));   // the dump may carry Windows line ends
let both = 0; const have = new Set(lm.map(([h, t]) => h + ',' + t));
for (const k of have) if (want.has(k)) both++;
const secs = pcm.length / 16000;
console.log(`JS: ${have.size} landmarks, python: ${want.size}, shared ${both} (${(100 * both / Math.max(1, want.size)).toFixed(1)}% of python's), ${secs.toFixed(1)} s of sound in ${ms.toFixed(0)} ms (${(ms / secs).toFixed(2)} ms a second)`);
process.exit(both >= 0.99 * want.size ? 0 : 1);
