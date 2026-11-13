// The cover policy's two ports on one sequence of chances (2026-11-08, the soft refractory): the extension's learned-break.js against
// the bench's decideparity mode (LearnedBreak.cs). A synthetic stream of looks a second with two breaks, a mid-break dropout, a burst of
// show-time chance just after a break's end (the pop-up the refractory is for) and a late real break.
//   node scripts/breakwatch/decide-parity.mjs <model.json> <bwtest.exe> [softRefractory]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ext = path.resolve(here, '../../prototypes/prism-veil-extension/src/breakwatch');
const NS = require(path.join(ext, 'learned-break.js'));   // brings cs.js and break-model.js with it
const [modelPath, exe, softArg] = process.argv.slice(2);
const soft = softArg === undefined ? 90 : +softArg;
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
model.policy = Object.assign({}, model.policy, { softRefractory: soft });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decide-'));
const mp = path.join(tmp, 'model.json'); fs.writeFileSync(mp, JSON.stringify(model));
// the stream
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const rows = []; let t = 0;
const push = (n, base, jitter) => { for (let i = 0; i < n; i++) { rows.push([t, Math.min(0.999, Math.max(0.001, base + (rnd() - 0.5) * jitter))]); t += 1; } };
push(300, 0.1, 0.3); push(120, 0.92, 0.2); push(4, 0.3, 0.2); push(60, 0.9, 0.2);   // show, a break, a dropout, the break again
push(20, 0.1, 0.2); push(6, 0.88, 0.2); push(200, 0.1, 0.3);                        // the show back, a six-look burst, show
push(5, 0.85, 0.1); push(300, 0.05, 0.1); push(90, 0.95, 0.1); push(100, 0.1, 0.2);  // a short burst, show, a late real break, show
const csv = path.join(tmp, 'seq.csv'); fs.writeFileSync(csv, 't,p\n' + rows.map(([a, b]) => a + ',' + b.toFixed(6)).join('\n') + '\n');
// the JS port
const lb = NS.LearnedBreak.fromJson(model); const st = lb.NewState();
const js = rows.map(([a, b]) => (lb.Decide(st, b, a) ? '1' : '0')).join('');
// the C# port
const cs = execFileSync(exe, ['decideparity', mp, csv], { encoding: 'utf8' }).trim();
let diff = 0; for (let i = 0; i < js.length; i++) if (js[i] !== cs[i]) diff++;
const ups = (s) => { let n = 0; for (let i = 1; i < s.length; i++) if (s[i] === '1' && s[i - 1] === '0') n++; return n; };
console.log(`${rows.length} looks, soft refractory ${soft} s: JS covers ${ups(js)}, C# covers ${ups(cs)}, looks that differ ${diff}`);
process.exit(diff === 0 && js.length === cs.length ? 0 : 1);
