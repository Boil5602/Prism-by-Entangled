// The extension's PictureNet against the bench's own numbers (2026-11-06): the network's chance on 400 frames of 10-08 as cnn.py export
// wrote them, run again by src/breakwatch/picture-net.js on the same frames.
//   node scripts/breakwatch/picture-net-parity.mjs <export folder>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ext = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../prototypes/prism-veil-extension/src/breakwatch');
require(path.join(ext, 'cs.js'));
const NS = require(path.join(ext, 'picture-net.js'));
const dir = process.argv[2];
const net = new NS.PictureNet(JSON.parse(fs.readFileSync(path.join(dir, 'picture-net.json'), 'utf8')));
const rows = JSON.parse(fs.readFileSync(path.join(dir, 'picture-net-parity.json'), 'utf8'));
let worst = 0, n = 0, flips = 0;
const t0 = Date.now();
for (const r of rows) {
  const g = fs.readFileSync(r.frame), p = r.prev ? fs.readFileSync(r.prev) : null;
  const q = net.inChannels() === 4 ? net.ChanceTemporal(g, p, r.back.map((b) => (b ? fs.readFileSync(b) : null))) : net.Chance(g, p);
  worst = Math.max(worst, Math.abs(q - r.p)); n++;
  if ((q > 0.5) !== (r.p > 0.5)) flips++;
}
const ms = (Date.now() - t0) / n;
console.log(`${n} frames: largest difference ${worst.toExponential(2)}, ${flips} on the other side of 0.5, ${ms.toFixed(1)} ms a frame`);
process.exit(worst < (net.inChannels() === 4 ? 1e-3 : 1e-4) ? 0 : 1);   // the temporal channels' means round a little further in half precision
