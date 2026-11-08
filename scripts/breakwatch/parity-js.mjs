// The break watch's browser port checked against the host's own model (2026-11-06): the same recorded day replayed through the
// JavaScript port (prototypes/prism-veil-extension/src/breakwatch) exactly as bwtest's bench mode replays it through the C# model
// (scripts/breakwatch/bwtest/Program.cs), then the two compared: every model input per frame (FEATCSV), the learned detector's chance
// per frame (LPARITY), its covers (LCALLS) and the hand rules' covers (the rules log).
//
//   node scripts/breakwatch/parity-js.mjs --day 2026-10-08 --from 150000000 --to 152000000 --lib 145739 [--bench] [--out <dir>]
//        [--full] [--no-js] [--model <learned.json>] [--root <golden folder>]
//
// --bench runs bwtest.exe first (at Idle priority, one at a time) into <out>/cs_*; without it the C# outputs already in <out> are
// compared. --full also builds scripts/breakwatch/bwparity (outside the tree, in the temp folder) and compares every input and the
// chance as round-trip numbers, to the last bit. --no-js compares what is in <out> without replaying the port. The switches NOTEXT / NOCC / NOSOUND (environment, as the bench reads them) drop the same events on both sides; this
// script passes them on to the bench, with BANDLOGO=1 BANDSTRICT=0 as scripts/doctor/out/replay-day.sh runs it. Golden data is read
// only. Node runs at the lowest priority (a live sampler may be recording on this PC).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);
const PB = require(path.join(repo, 'prototypes/prism-veil-extension/src/breakwatch/cs.js'));
require(path.join(repo, 'prototypes/prism-veil-extension/src/breakwatch/break-model.js'));
require(path.join(repo, 'prototypes/prism-veil-extension/src/breakwatch/learned-break.js'));
require(path.join(repo, 'prototypes/prism-veil-extension/src/breakwatch/ad-prints.js'));
const { BreakModel, LearnedBreak, AdPrints, AdSounds, cs } = PB;

try { os.setPriority(0, os.constants.priority.PRIORITY_LOWEST); } catch { /* not allowed: run as is */ }

const args = process.argv.slice(2);
function opt(name, dflt) { const i = args.indexOf('--' + name); return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt; }
const flag = (name) => args.includes('--' + name);
const day = opt('day', '2026-10-08');
const from = opt('from', '150000000'), to = opt('to', '152000000');
const goldenRoot = opt('root', path.join(process.env.LOCALAPPDATA, 'Prism', 'diagnostics', 'golden'));
const benchRoot = path.join(goldenRoot, day);
const lib = opt('lib', fs.readdirSync(path.join(benchRoot, 'library')).sort()[0]);
const bwdir = path.join(benchRoot, 'library', lib);
const modelPath = opt('model', path.join(repo, 'targets/win-host/PrismHost/Assets/breakwatch/learned.json'));
const out = opt('out', path.join(os.tmpdir(), `prism-parity-${day}-${from}-${to}`));
fs.mkdirSync(out, { recursive: true });

// the switches, as the bench reads them
const env = (k) => process.env[k];
function noTextEvt(e) {
  return (env('NOTEXT') === '1' && (e.startsWith('text ') || e === 'qr')) ||
    (env('NOCC') === '1' && e.startsWith('cc ')) ||
    (env('NOSOUND') === '1' && (e.startsWith('level ') || e.startsWith('silence ') || e.startsWith('afp ')));
}
BreakModel.BandLogo = true; BreakModel.BandStrict = false; BreakModel.InsetAnywhere = false;

// ---- .NET's string helpers the bench uses ----
function splitN(s, n) {   // string.Split(' ', n)
  const parts = []; let i = 0;
  while (parts.length < n - 1) { const k = s.indexOf(' ', i); if (k < 0) break; parts.push(s.substring(i, k)); i = k + 1; }
  parts.push(s.substring(i));
  return parts;
}
function readLines(p) {   // File.ReadAllLines: UTF-8, \r\n, \n or \r; no empty line after a final newline
  let s = new TextDecoder('utf-8').decode(fs.readFileSync(p));
  if (s.charCodeAt(0) === 0xFEFF) s = s.substring(1);
  const lines = s.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
const floatRe = /^[\t\n\v\f\r ]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[\t\n\v\f\r ]*$/;
function tryFloat(s) { return floatRe.test(s) ? Number(s.trim()) : null; }   // double.TryParse(Float, Invariant) for the numbers recorded
function sec(hms) { return parseInt(hms.substring(0, 2), 10) * 3600 + parseInt(hms.substring(2, 4), 10) * 60 + parseInt(hms.substring(4, 6), 10) + (hms.length >= 9 ? parseInt(hms.substring(6, 9), 10) / 1000.0 : 0); }
const hhmmss = (at) => `${at.substring(0, 2)}:${at.substring(2, 4)}:${at.substring(4, 6)}`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // ordinal
const adFree = cs.netRegex('^(C-SPAN\\d?|PBS( Kids)?|PBS .*)$', 'i');
function loadModel(chan) {
  const p = path.join(bwdir, chan + '.logo');
  return BreakModel.load(fs.existsSync(p) ? fs.readFileSync(p) : null);
}

// ---- the JavaScript side: bench mode, line for line ----
function runJs() {
  const t0 = Date.now();
  const prints = new AdPrints(fs.existsSync(path.join(bwdir, 'prints.bin')) ? fs.readFileSync(path.join(bwdir, 'prints.bin')) : null,
    env('CATALOG') ? new AdPrints(fs.readFileSync(env('CATALOG'))) : null);
  const snd = new AdSounds(fs.existsSync(path.join(bwdir, 'sounds.bin')) ? fs.readFileSync(path.join(bwdir, 'sounds.bin')) : null);
  const learned = LearnedBreak.fromJson(fs.readFileSync(modelPath, 'utf8'));
  const outw = [], feat = ['win,t,' + BreakModel.FeatureNames.join(',') + ',print_seen'], lpar = ['win,t,p'], lcalls = [];
  const featR = [feat[0]], lparR = ['win,t,p'];
  let frames = 0;
  const dirs = fs.readdirSync(benchRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const win of dirs) {
    const dir = path.join(benchRoot, win);
    const items = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.gray')) continue;
      const n = f.substring(0, f.length - 5);
      if (cmp(n, from) >= 0 && cmp(n, to) < 0) items.push({ at: n, frame: path.join(dir, f), evt: null });
    }
    const ev = path.join(dir, 'events.log');
    let chan = null, firstAt = null;
    const lines = fs.existsSync(ev) ? readLines(ev) : [];
    for (const line of lines) { const sp = splitN(line, 3); if (sp.length === 3 && sp[2].startsWith('cueat ')) { firstAt = sp[0]; break; } }
    const cueLead = tryFloat(env('CUELEAD') ?? '') ?? 0;
    for (const line of lines) {
      const sp = splitN(line, 3); if (sp.length < 3) continue;
      if (sp[2].startsWith('channel ')) { if (cmp(sp[0], from) < 0) chan = cs.trim(sp[2].substring(8)); }
      if (cmp(sp[0], from) >= 0 && cmp(sp[0], to) < 0 && !noTextEvt(sp[2])) items.push({ at: sp[0], frame: null, evt: sp[2] });
      if (sp[2].startsWith('cue ') && (firstAt === null || cmp(sp[0], firstAt) < 0)) {
        const ms = Math.min(Math.trunc((sec(sp[0]) + cueLead) * 1000), 86399999);
        const key = String(Math.floor(ms / 3600000)).padStart(2, '0') + String(Math.floor(ms / 60000) % 60).padStart(2, '0') + String(Math.floor(ms / 1000) % 60).padStart(2, '0') + String(ms % 1000).padStart(3, '0');
        if (cmp(key, from) >= 0 && cmp(key, to) < 0) items.push({ at: key, frame: null, evt: 'cueat ' + sp[2].substring(4) });
      }
    }
    items.sort((a, b) => cmp(a.at, b.at) || ((a.frame === null ? 0 : 1) - (b.frame === null ? 0 : 1)));   // stable
    let m = chan === null ? null : loadModel(chan);
    let last = 0, name = '', sound = [];
    const lst = learned.NewState();
    let lshown = false, lshownAt = -999.0, plainRun = 0;
    let paidSeen = -9999, paidUntil = -1, paidOpenSeen = -9999, paidCloseSeen = -9999, paidLogoSince = -1;
    for (const { at, frame, evt } of items) {
      const t = sec(at);
      if (evt !== null) {
        if (evt.startsWith('channel ')) { if (m && m.Active) outw.push(`${hhmmss(at)}.000 break watch ${win}: show (bench, channel changed)`); chan = cs.trim(evt.substring(8)); m = loadModel(chan); last = 0; continue; }
        if (m === null) continue;
        if (evt.startsWith('text ')) m.Text(evt.substring(5), t);
        else if (evt.startsWith('cc ')) { learned.Caption(lst, evt.substring(3), t); m.Captions(evt.substring(3), 0, t); m.Text(evt.substring(3), t, true); }
        else if (evt === 'qr') m.QrSeen(t);
        else if (evt.startsWith('edge ')) { const p = splitN(evt, 3); m.NearEdge = p[1] === '1'; m.EdgeKnown = true; name = p.length > 2 ? p[2] : ''; m.ChannelName = name; adFree.lastIndex = 0; m.AdFreeChannel = adFree.test(name); }
        else if (evt === 'notanad') m.Dismiss(t);
        else if (evt.startsWith('cueat ')) { const c = evt.split(' '); if (c.length >= 4) m.CueSeen(c[1], Number(c[2]), Number(c[3]), t); }
        else if (evt.startsWith('cue ')) { const c = evt.split(' '); if (c.length >= 4) m.CueRead(c[1], Number(c[2]), Number(c[3]), t); }
        else if (evt.startsWith('level ')) {
          const lv = evt.split(' ');
          const ldb = lv.length >= 2 ? tryFloat(lv[1]) : null;
          if (ldb !== null) { const lpk = lv.length >= 3 ? tryFloat(lv[2]) : null; m.Level(ldb, lpk !== null ? lpk : ldb, t); }
        }
        else if (evt.startsWith('silence ')) { const sago = tryFloat(evt.substring(8)); if (sago !== null) m.Silence(t - sago); }
        else if (evt.startsWith('afp ')) {
          const hex = cs.trim(evt.substring(4));
          for (let k = 0; k + 8 <= hex.length; k += 8) { const h8 = hex.substring(k, k + 8); if (/^[0-9a-fA-F]{8}$/.test(h8)) sound.push(parseInt(h8, 16) >>> 0); }
          if (sound.length > 400) sound = sound.slice(sound.length - 400);
          if (snd.Heard(sound)) m.SoundSeen(t);
        }
        continue;
      }
      if (m === null || frame === null) continue;
      const g = fs.readFileSync(frame); if (g.length !== BreakModel.W * BreakModel.H) continue;
      frames++;
      const fp = AdPrints.Of(g, BreakModel.W, BreakModel.H);
      const seenNow = fp !== null && prints.Seen(fp);
      if (seenNow) m.PrintSeen(t);
      const stepped = m.Step(g, t, last > 0 ? cs.clamp(t - last, 0.5, 6) : 1);
      {
        const f2 = m.Features(t);
        const lp2 = learned.Score(lst, f2, seenNow ? 1 : 0, t, 0, t);
        lpar.push(win + ',' + cs.format(t, 3, false) + ',' + cs.format(lp2, 6, false));
        const up2 = learned.Decide(lst, lp2, t, m.LogoInBand);
        plainRun = up2 && m.PlainShow(t) ? plainRun + 1 : 0;
        let shown2 = up2 || m.CueOnAt(t) || (env('LINFO') === '1' && m.InfomercialAt(t)) || (env('ADLINE') !== '0' && t - lshownAt <= 20 && m.AdLineAt(t)) || (env('CUECOMING') !== '0' && t - lshownAt <= 20 && m.CueComingAt(t));
        const tod = parseInt(at.substring(0, 2), 10) * 3600 + parseInt(at.substring(2, 4), 10) * 60 + parseInt(at.substring(4, 6), 10);
        if (m.PaidCardAt > paidSeen) { paidSeen = m.PaidCardAt; paidUntil = BreakModel.PaidSlotEndSeconds(tod, m.PaidCardFollowing); }
        if (env('PAIDOPEN') !== '0') {
          if (m.PaidOpenAt > paidOpenSeen) { paidOpenSeen = m.PaidOpenAt; const into = tod % 1800; if (into <= 300 || into >= 1500) paidUntil = BreakModel.PaidSlotEndSeconds(tod, true); }
          if (m.PaidCloseAt > paidCloseSeen) { paidCloseSeen = m.PaidCloseAt; if (tod < paidUntil) paidUntil = 0; }
          if (tod < paidUntil && m.LogoUpNow) { if (paidLogoSince < 0) paidLogoSince = t; else if (t - paidLogoSince >= 60) { paidUntil = 0; paidLogoSince = -1; } } else paidLogoSince = -1;
        }
        if (env('PAIDCARD') !== '0' && tod < paidUntil) shown2 = true;
        if (shown2) lshownAt = t;
        if (shown2 !== lshown) { lshown = shown2; lcalls.push(`${hhmmss(at)}.000 break watch ${win}: ${shown2 ? 'break' : 'show'} (learned ${cs.format(lp2, 2, false)})`); }
      }
      const fz = m.Features(t);
      feat.push(win + ',' + cs.format(t, 3, false) + ',' + fz.map((x) => cs.format(x, 3, true)).join(',') + ',' + (seenNow ? 1 : 0));
      featR.push(win + ',' + String(t) + ',' + fz.map((x) => String(x)).join(',') + ',' + (seenNow ? 1 : 0));
      lparR.push(win + ',' + String(t) + ',' + String(lst.lastP));
      if (stepped) outw.push(`${hhmmss(at)}.000 break watch ${win}: ${m.Active ? 'break' : 'show'} (bench)`);
      last = t;
    }
  }
  fs.writeFileSync(path.join(out, 'js_feat.csv'), feat.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'js_lpar.csv'), lpar.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'js_lcalls.log'), lcalls.join('\n') + (lcalls.length ? '\n' : ''));
  fs.writeFileSync(path.join(out, 'js_rules.log'), outw.join('\n') + (outw.length ? '\n' : ''));
  fs.writeFileSync(path.join(out, 'js_featR.csv'), featR.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'js_lparR.csv'), lparR.join('\n') + '\n');
  console.log(`js: ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s (prints ${prints.Count}, sounds ${snd.Count})`);
}

// ---- the C# side: bwtest's bench mode at Idle priority ----
function runBench() {
  const exe = path.join(repo, 'scripts/breakwatch/bwtest/bin/Release/net8.0/bwtest.exe');
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const envs = { BENCHROOT: benchRoot, BWDIR: bwdir, FEATCSV: path.join(out, 'cs_feat.csv'), LMODEL: modelPath, LPARITY: path.join(out, 'cs_lpar.csv'),
    LCALLS: path.join(out, 'cs_lcalls.log'), BANDLOGO: '1', BANDSTRICT: '0' };
  for (const k of ['NOTEXT', 'NOCC', 'NOSOUND', 'CATALOG', 'CUELEAD', 'LINFO', 'ADLINE', 'CUECOMING', 'PAIDOPEN', 'PAIDCARD']) envs[k] = env(k) ?? '';
  const sets = Object.entries(envs).map(([k, v]) => `$env:${k}=${q(v)};`).join(' ');
  const cmd = `${sets} $p = Start-Process -FilePath ${q(exe)} -ArgumentList 'bench',${q(from)},${q(to)},${q(path.join(out, 'cs_rules.log'))} -PassThru -NoNewWindow -RedirectStandardOutput ${q(path.join(out, 'cs_bench.txt'))}; $p.PriorityClass = 'Idle'; $p.WaitForExit(); exit $p.ExitCode`;
  const t0 = Date.now();
  const r = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { stdio: 'inherit' });
  console.log(`bench: exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (r.status !== 0) process.exit(1);
}

// ---- the C# side to the last bit: scripts/breakwatch/bwparity (bench mode, round-trip numbers), built outside the tree ----
function runFull() {
  const art = path.join(os.tmpdir(), 'prism-bwparity-build');
  const proj = path.join(repo, 'scripts/breakwatch/bwparity/bwparity.csproj');
  const exe = path.join(art, 'bin', 'bwparity', 'release', 'bwparity.exe');
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const idle = (file, argList, extra) => `${extra || ''} $p = Start-Process -FilePath ${q(file)} -ArgumentList ${argList.map(q).join(',')} -PassThru -NoNewWindow -Wait:$false; $p.PriorityClass = 'Idle'; $p.WaitForExit(); exit $p.ExitCode`;
  const srcNewest = Math.max(...['scripts/breakwatch/bwparity/Program.cs', 'scripts/breakwatch/bwparity/bwparity.csproj', 'targets/win-host/PrismHost/Services/BreakModel.cs',
    'targets/win-host/PrismHost/Services/AdPrints.cs', 'targets/win-host/PrismHost/Services/AdSounds.cs', 'targets/win-host/PrismHost/Services/LearnedBreak.cs'].map((f) => fs.statSync(path.join(repo, f)).mtimeMs));
  if (!fs.existsSync(exe) || fs.statSync(exe).mtimeMs < srcNewest) {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', idle('dotnet', ['build', proj, '-c', 'Release', '--artifacts-path', art, '-nologo', '-v', 'q', '--disable-build-servers'])], { stdio: 'inherit' });
    if (r.status !== 0 || !fs.existsSync(exe)) { console.log('bwparity: build failed'); process.exit(1); }
  }
  const envs = { BENCHROOT: benchRoot, BWDIR: bwdir, LMODEL: modelPath, BANDLOGO: '1', BANDSTRICT: '0' };
  for (const k of ['NOTEXT', 'NOCC', 'NOSOUND', 'CATALOG']) envs[k] = env(k) ?? '';
  const sets = Object.entries(envs).map(([k, v]) => `$env:${k}=${q(v)};`).join(' ');
  const t0 = Date.now();
  const r = spawnSync('powershell', ['-NoProfile', '-Command', idle(exe, [from, to, path.join(out, 'cs_featR.csv'), path.join(out, 'cs_lparR.csv')], sets)], { stdio: 'inherit' });
  console.log(`bwparity: exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (r.status !== 0) process.exit(1);
}

// ---- the comparison ----
function readCsv(p) {
  const lines = readLines(p); const head = lines[0].split(','); const rows = new Map(); const order = [];
  for (let i = 1; i < lines.length; i++) { const c = lines[i].split(','); const k = c[0] + ',' + c[1]; if (!rows.has(k)) order.push(k); rows.set(k, c); }
  return { head, rows, order };
}
function compareCsv(label, a, b, numeric) {
  const A = readCsv(a), B = readCsv(b);
  const onlyA = A.order.filter((k) => !B.rows.has(k)), onlyB = B.order.filter((k) => !A.rows.has(k));
  console.log(`\n${label}: ${A.order.length} rows C#, ${B.order.length} rows JS, ${onlyA.length} only in C#, ${onlyB.length} only in JS`);
  if (onlyA.length) console.log('  first only in C#: ' + onlyA[0]);
  if (onlyB.length) console.log('  first only in JS: ' + onlyB[0]);
  let allSame = true;
  for (let c = 2; c < A.head.length; c++) {
    let diff = 0, maxAbs = 0, first = null, firstVals = null;
    for (const k of A.order) {
      const rb = B.rows.get(k); if (!rb) continue;
      const va = A.rows.get(k)[c], vb = rb[c];
      if (numeric ? !(Number(va) === Number(vb) || (va === 'NaN' && vb === 'NaN')) : va !== vb) {
        diff++; const d = Math.abs(Number(va) - Number(vb)); if (d > maxAbs || d !== d) maxAbs = d;
        if (first === null) { first = k; firstVals = `${va} vs ${vb}`; }
      }
    }
    if (diff) allSame = false;
    console.log(`  ${A.head[c].padEnd(18)} ${diff === 0 ? 'identical' : `${diff} rows differ, max |d| ${maxAbs}, first ${first} (C# ${firstVals.replace(' vs ', ', JS ')})`}`);
  }
  return allSame && onlyA.length === 0 && onlyB.length === 0;
}
function compareLog(label, a, b) {
  const A = fs.existsSync(a) ? readLines(a) : [], B = fs.existsSync(b) ? readLines(b) : [];
  const sa = [...A].sort(), sb = [...B].sort();
  let firstDiff = -1; for (let i = 0; i < Math.max(sa.length, sb.length); i++) if (sa[i] !== sb[i]) { firstDiff = i; break; }
  console.log(`\n${label}: ${A.length} lines C#, ${B.length} lines JS: ${firstDiff < 0 ? 'identical' : `differ from sorted line ${firstDiff}: C# ${sa[firstDiff]} | JS ${sb[firstDiff]}`}`);
  return firstDiff < 0;
}

console.log(`parity ${day} ${from}-${to}, library ${lib}, model ${path.basename(modelPath)}, NOTEXT=${env('NOTEXT') ?? ''} NOCC=${env('NOCC') ?? ''} NOSOUND=${env('NOSOUND') ?? ''}, out ${out}`);
if (!flag('no-js')) runJs();
if (flag('bench')) runBench();
let ok = compareCsv('model inputs (FEATCSV)', path.join(out, 'cs_feat.csv'), path.join(out, 'js_feat.csv'));
ok = compareCsv("learned detector's chance (LPARITY)", path.join(out, 'cs_lpar.csv'), path.join(out, 'js_lpar.csv')) && ok;
ok = compareLog('learned covers (LCALLS)', path.join(out, 'cs_lcalls.log'), path.join(out, 'js_lcalls.log')) && ok;
ok = compareLog('rules covers (rules log)', path.join(out, 'cs_rules.log'), path.join(out, 'js_rules.log')) && ok;
if (flag('full')) {
  runFull();
  ok = compareCsv('model inputs to the last bit (bwparity, round-trip)', path.join(out, 'cs_featR.csv'), path.join(out, 'js_featR.csv'), true) && ok;
  ok = compareCsv("learned detector's chance to the last bit", path.join(out, 'cs_lparR.csv'), path.join(out, 'js_lparR.csv'), true) && ok;
}
console.log(ok ? '\nPARITY: identical' : '\nPARITY: differences above');
process.exit(ok ? 0 : 2);
