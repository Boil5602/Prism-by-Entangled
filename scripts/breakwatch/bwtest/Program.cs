using PrismHost.Services;
if (args.Length >= 4 && args[0] == "known")
{
    // per frame of one window: the nearest known print (distance, clip), against the live library or BWDIR's
    var bench = Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "diagnostics", "bench", args[1]);
    var bwdir = Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch");
    var lib = new AdPrints(Path.Combine(bwdir, "prints.bin"));
    Console.WriteLine($"library {lib.Count} prints");
    foreach (var f in Directory.GetFiles(bench, "*.gray").OrderBy(x => x, StringComparer.Ordinal))
    {
        var n = Path.GetFileNameWithoutExtension(f);
        if (string.CompareOrdinal(n, args[2]) < 0 || string.CompareOrdinal(n, args[3]) >= 0) continue;
        var g = File.ReadAllBytes(f);
        var fp = AdPrints.Of(g, BreakModel.W, BreakModel.H);
        if (fp is null) { Console.WriteLine(n + " flat"); continue; }
        var pl = lib.Places(fp, 140);
        var best = pl.OrderBy(x => x.Dist).FirstOrDefault();
        Console.WriteLine(n + (pl.Count == 0 ? " none<140" : $" d={best.Dist} clip={best.Clip} off={best.Offset:0.0} seen={lib.Seen(fp)} n={pl.Count}"));
    }
    return;
}
var root = (Environment.GetEnvironmentVariable("BENCHROOT") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "diagnostics", "bench"));
if (args.Length == 2 && args[0] == "setaside")
{
    var path = Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), args[1] + ".logo");
    var mdl = BreakModel.Load(path); mdl.SetAside(); mdl.Save(path); Console.WriteLine(args[1] + " set aside: " + mdl.Suspended); return;
}
if (args.Length >= 4 && args[0] == "trace")
{
    // one window from a time to a time: each frame's logo match, chance, state, and the picture's change from the frame before
    var mdl = BreakModel.Load(Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), args[4] + ".logo")); double lt = 0; byte[]? prev = null;
    foreach (var f in Directory.GetFiles(Path.Combine(root, args[1]), "*.gray").OrderBy(x => x))
    {
        var t = Path.GetFileNameWithoutExtension(f); if (t.CompareTo(args[2]) < 0 || t.CompareTo(args[3]) > 0) continue;
        var g = File.ReadAllBytes(f); if (g.Length != BreakModel.W * BreakModel.H) continue;
        var s0 = int.Parse(t[..2]) * 3600 + int.Parse(t[2..4]) * 60 + int.Parse(t[4..6]);
        mdl.Step(g, s0, lt > 0 ? Math.Clamp(s0 - lt, 0.5, 6) : 2); lt = s0;
        double d = 0; if (prev is not null) { for (var i = 0; i < g.Length; i += 2) d += Math.Abs(g[i] - prev[i]); d /= g.Length / 2; } prev = g;
        Console.WriteLine($"{t[2..4]}:{t[4..6]} logo {(mdl.LogoScore ?? double.NaN),5:0.00} diff {d,5:0.0} p {mdl.Chance:0.00} {(mdl.Active ? "COVER" : "")} {mdl.Why}");
    }
    return;
}
if (args.Length >= 3 && args[0] == "seq")
{
    // sequence matching measured (2026-10-07): every window's recorded frames in time order through one model each and ONE library that
    // starts empty and learns as the host does (a confirmed break's pictures with their clip and place, its opening back-filled). Counted:
    // break frames each kind of match knows, how soon in a break it first knows, and show frames (logo plainly up) it matches wrongly.
    var loose = int.TryParse(Environment.GetEnvironmentVariable("LOOSE"), out var lz) ? lz : PrintRuns.Loose;
    var useRun = Environment.GetEnvironmentVariable("NORUN") != "1";
    var bench = (Environment.GetEnvironmentVariable("BENCHROOT") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "diagnostics", "bench"));
    string from = args[1], to = args[2];
    static double Sec2(string hms) => int.Parse(hms[..2]) * 3600 + int.Parse(hms[2..4]) * 60 + int.Parse(hms[4..6]) + (hms.Length >= 9 ? int.Parse(hms[6..9]) / 1000.0 : 0);
    var tmp = Path.Combine(Path.GetTempPath(), "seq-" + Guid.NewGuid().ToString("N") + ".bin"); if (Environment.GetEnvironmentVariable("SEED") is { Length: > 0 } seed) File.Copy(seed, tmp);
    var lib = new AdPrints(tmp);
    var all = new List<(double T, string Win, string? Frame, string? Evt)>();
    var chanAt = new Dictionary<string, string>();
    foreach (var dir in Directory.GetDirectories(bench))
    {
        var win = Path.GetFileName(dir);
        foreach (var f in Directory.GetFiles(dir, "*.gray")) { var n = Path.GetFileNameWithoutExtension(f); if (string.CompareOrdinal(n, from) >= 0 && string.CompareOrdinal(n, to) < 0) all.Add((Sec2(n), win, f, null)); }
        var ev = Path.Combine(dir, "events.log");
        if (File.Exists(ev))
            foreach (var line in File.ReadAllLines(ev))
            {
                var sp = line.Split(' ', 3); if (sp.Length < 3 || sp[0].Length < 9) continue;
                if (sp[2].StartsWith("channel ") && string.CompareOrdinal(sp[0], from) < 0) chanAt[win] = sp[2][8..].Trim();
                if (string.CompareOrdinal(sp[0], from) >= 0 && string.CompareOrdinal(sp[0], to) < 0) all.Add((Sec2(sp[0]), win, null, sp[2]));
            }
    }
    all = all.OrderBy(x => x.T).ThenBy(x => x.Frame is null ? 0 : 1).ToList();
    var bwdir = Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch");
    var models = new Dictionary<string, BreakModel>(); var last = new Dictionary<string, double>();
    var runs = new Dictionary<string, PrintRuns>(); var strictHits = new Dictionary<string, Queue<double>>();
    var pending = new Dictionary<string, Queue<(double T, ulong[] Fp)>>(); var recent = new Dictionary<string, Queue<(double T, ulong[] Fp, bool Away)>>();
    var clip = new Dictionary<string, (int Clip, double Start)>(); var activeSince = new Dictionary<string, double>();
    var firstS = new Dictionary<string, double>(); var firstR = new Dictionary<string, double>();
    long breakFrames = 0, bStrict = 0, bRun = 0, bEither = 0, showFrames = 0, sStrict = 0, sRun = 0, sSingle = 0;
    var delaysS = new List<double>(); var delaysR = new List<double>(); var delaysE = new List<double>(); int breaks = 0;
    foreach (var (t, win, frame, evt) in all)
    {
        if (evt is not null)
        {
            if (evt.StartsWith("channel ")) { chanAt[win] = evt[8..].Trim(); models.Remove(win); }
            else if (models.TryGetValue(win, out var me))
            {
                if (evt.StartsWith("text ")) me.Text(evt[5..], t);
                else if (evt.StartsWith("cc ")) { me.Captions(evt[3..], 0, t); me.Text(evt[3..], t, spoken: true); }
                else if (evt == "qr") me.QrSeen(t);
                else if (evt.StartsWith("edge ")) { var p = evt.Split(' ', 3); me.NearEdge = p[1] == "1"; me.EdgeKnown = true; }
            }
            continue;
        }
        if (!chanAt.TryGetValue(win, out var ch)) continue;
        if (!models.TryGetValue(win, out var m)) { m = BreakModel.Load(Path.Combine(bwdir, ch + ".logo")); models[win] = m; last.Remove(win); }
        var g = File.ReadAllBytes(frame!); if (g.Length != BreakModel.W * BreakModel.H) continue;
        var fp = AdPrints.Of(g, BreakModel.W, BreakModel.H);
        if (!runs.ContainsKey(win)) { runs[win] = new PrintRuns(); strictHits[win] = new Queue<double>(); pending[win] = new(); recent[win] = new(); }
        var strictNow = false; var runNow = false; var single = false;
        if (fp is not null)
        {
            if (lib.Seen(fp)) { strictHits[win].Enqueue(t); single = true; }
            while (strictHits[win].Count > 0 && t - strictHits[win].Peek() > 8) strictHits[win].Dequeue();
            strictNow = strictHits[win].Count >= 2;
            runNow = runs[win].Look(t, lib.Places(fp, loose));
            if (single) m.PrintSeen(t);
            if (useRun && runNow) { m.PrintSeen(t); m.PrintSeen(t); }   // a run is a known ad at once
        }
        m.Step(g, t, last.TryGetValue(win, out var lt) ? Math.Clamp(t - lt, 0.5, 6) : 1); last[win] = t;
        if (fp is not null) recent[win].Enqueue((t, fp, m.LogoAwayNow));
        while (recent[win].Count > 0 && t - recent[win].Peek().T > 120) recent[win].Dequeue();
        if (m.Active)
        {
            if (!activeSince.ContainsKey(win)) { activeSince[win] = t; breaks++; }
            breakFrames++; if (strictNow) bStrict++; if (runNow) bRun++; if (strictNow || runNow) bEither++;
            if (strictNow && !firstS.ContainsKey(win)) firstS[win] = t - activeSince[win];
            if (runNow && !firstR.ContainsKey(win)) firstR[win] = t - activeSince[win];
        }
        else
        {
            if (activeSince.Remove(win))
            {
                double? s0 = firstS.Remove(win, out var a) ? a : null, r0 = firstR.Remove(win, out var b) ? b : null;
                if (s0 is { } sv) delaysS.Add(sv); if (r0 is { } rv) delaysR.Add(rv);
                if (s0 is not null || r0 is not null) delaysE.Add(Math.Min(s0 ?? double.MaxValue, r0 ?? double.MaxValue));
            }
            if (m.LogoUpNow) { showFrames++; if (strictNow) sStrict++; if (runNow) sRun++; if (single) sSingle++; }
        }
        // learning, as the host does it
        if (fp is not null && m.LearnableAt(t) && !lib.Seen(fp)) pending[win].Enqueue((t, fp));
        if (m.LearnableAt(t) && !clip.ContainsKey(win))
        {
            var pics = recent[win].ToArray(); var i = pics.Length - 1; while (i >= 0 && pics[i].Away) i--;
            var start = i + 1 < pics.Length ? pics[i + 1].T : t;
            var c = lib.NextClip(); clip[win] = (c, start);
            foreach (var pic in pics) if (pic.Away && pic.T >= start + 3 && pic.T < t - 1 && !lib.Seen(pic.Fp)) lib.Learn(pic.Fp, c, (float)(pic.T - start));
        }
        if (!m.Active) { pending[win].Clear(); clip.Remove(win); }
        else if (clip.TryGetValue(win, out var cl)) while (pending[win].Count > 0 && t - pending[win].Peek().T >= 20) { var q = pending[win].Dequeue(); lib.Learn(q.Fp, cl.Clip, (float)(q.T - cl.Start)); }
    }
    string Med(List<double> l) => l.Count == 0 ? "-" : l.OrderBy(x => x).ElementAt(l.Count / 2).ToString("0");
    Console.WriteLine($"loose {loose}{(useRun ? "" : " (runs not used)")}: {breaks} breaks, {breakFrames} break frames, {showFrames} show frames (logo up), library {lib.Count}");
    Console.WriteLine($"  break frames known: strict {bStrict} ({100.0 * bStrict / Math.Max(1, breakFrames):0.0}%), run {bRun} ({100.0 * bRun / Math.Max(1, breakFrames):0.0}%), either {bEither} ({100.0 * bEither / Math.Max(1, breakFrames):0.0}%)");
    Console.WriteLine($"  breaks known: strict {delaysS.Count}, run {delaysR.Count}, either {delaysE.Count} of {breaks}; median s in: strict {Med(delaysS)}, run {Med(delaysR)}, either {Med(delaysE)}");
    Console.WriteLine($"  show frames matched: strict pair {sStrict}, run {sRun}, single strict look {sSingle}");
    try { File.Delete(tmp); } catch { }
    return;
}
if (args.Length >= 4 && args[0] == "label")
{
    // the hindsight labeller (2026-10-07, "you're supposed to monitor every 1 second and tell me the stats. Not based on my own reports"):
    // every window's recording read with both ends of each stretch in view, which the live watch never has. Per second: the logo up, away or
    // unreadable; what the screen says (an ad's words, the show's); a QR code; a known ad's picture. A stretch without the logo of 15 s or more
    // is a break when an ad spoke in it (words, a QR code, two known pictures) and the show's own words do not outnumber the ad's; a stretch
    // with the logo of under 45 s between two breaks is the channel's promo inside the break. Writes the labels in the pass format (rates.py).
    var bench = (Environment.GetEnvironmentVariable("BENCHROOT") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "diagnostics", "bench"));
    string from = args[1], to = args[2];
    static double S3(string hms) => int.Parse(hms[..2]) * 3600 + int.Parse(hms[2..4]) * 60 + int.Parse(hms[4..6]) + (hms.Length >= 9 ? int.Parse(hms[6..9]) / 1000.0 : 0);
    static string Hms(double t) { var s = (int)Math.Round(t); return $"{s / 3600:00}:{s / 60 % 60:00}:{s % 60:00}"; }
    var bwdir = Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch");
    var lib = new AdPrints(Path.Combine(bwdir, "prints.bin"));
    var winsOut = new List<string>();
    foreach (var dir in Directory.GetDirectories(bench))
    {
        var win = Path.GetFileName(dir);
        var items = new List<(double T, string? Frame, string? Evt)>();
        string? chan = null, name = "";
        foreach (var f in Directory.GetFiles(dir, "*.gray")) { var n = Path.GetFileNameWithoutExtension(f); if (string.CompareOrdinal(n, from) >= 0 && string.CompareOrdinal(n, to) < 0) items.Add((S3(n), f, null)); }
        var ev = Path.Combine(dir, "events.log");
        if (File.Exists(ev))
            foreach (var line in File.ReadAllLines(ev))
            {
                var sp = line.Split(' ', 3); if (sp.Length < 3 || sp[0].Length < 9) continue;
                if (sp[2].StartsWith("channel ") && string.CompareOrdinal(sp[0], from) < 0) chan = sp[2][8..].Trim();
                if (sp[2].StartsWith("edge ") && string.CompareOrdinal(sp[0], to) < 0) { var p = sp[2].Split(' ', 3); if (p.Length > 2) name = p[2]; }
                if (string.CompareOrdinal(sp[0], from) >= 0 && string.CompareOrdinal(sp[0], to) < 0) items.Add((S3(sp[0]), null, sp[2]));
            }
        if (items.Count == 0) continue;
        items = items.OrderBy(x => x.T).ThenBy(x => x.Frame is null ? 0 : 1).ToList();
        BreakModel? m = chan is null ? null : BreakModel.Load(Path.Combine(bwdir, chan + ".logo"));
        // per second: 'U' logo up, 'A' away, 'F' can't be seen; and the evidence seen in that second
        var sec = new SortedDictionary<int, (char Logo, int Ad, int Show, int Known)>();
        double last = 0; var hits = new Queue<double>();
        foreach (var (t, frame, evt) in items)
        {
            var k = (int)Math.Floor(t);
            if (evt is not null)
            {
                if (evt.StartsWith("channel ")) { chan = evt[8..].Trim(); m = BreakModel.Load(Path.Combine(bwdir, chan + ".logo")); last = 0; continue; }
                if (evt.StartsWith("edge ")) { var p = evt.Split(' ', 3); if (p.Length > 2) name = p[2]; continue; }
                if (m is null) continue;
                string? said = evt.StartsWith("text ") ? m.Text(evt[5..], t) : evt.StartsWith("cc ") ? m.Text(evt[3..], t, spoken: true) : null;
                var cur = sec.TryGetValue(k, out var c0) ? c0 : ('?', 0, 0, 0);
                if (evt == "qr") cur.Item2 += 2;
                else if (said is not null && said.StartsWith("ad:") && evt.StartsWith("text ")) cur.Item2 += 1;
                else if (said is not null && said.StartsWith("show")) cur.Item3 += 1;
                sec[k] = cur;
                continue;
            }
            if (m is null) continue;
            var g = File.ReadAllBytes(frame!); if (g.Length != BreakModel.W * BreakModel.H) continue;
            m.Step(g, t, last > 0 ? Math.Clamp(t - last, 0.5, 6) : 1); last = t;
            var logo = m.LogoUpNow ? 'U' : m.LogoAwayNow ? 'A' : 'F';
            var known = 0;
            if (AdPrints.Of(g, BreakModel.W, BreakModel.H) is { } fp && lib.Seen(fp)) { hits.Enqueue(t); }
            while (hits.Count > 0 && t - hits.Peek() > 8) hits.Dequeue();
            if (hits.Count >= 2) known = 1;
            var c = sec.TryGetValue(k, out var c1) ? c1 : ('?', 0, 0, 0);
            sec[k] = (logo, c.Item2, c.Item3, c.Item4 + known);
        }
        if (sec.Count == 0) continue;
        // fill seconds with no frame from the one before (looks come about once a second)
        var keys = sec.Keys.ToList(); var t0 = keys.First(); var t1 = keys.Last();
        var logoAt = new char[t1 - t0 + 1]; var ad = new int[logoAt.Length]; var show = new int[logoAt.Length]; var kn = new int[logoAt.Length];
        char prev = '?';
        for (var s = t0; s <= t1; s++)
        {
            var i = s - t0;
            if (sec.TryGetValue(s, out var v)) { if (v.Logo != '?') prev = v.Logo; ad[i] = v.Ad; show[i] = v.Show; kn[i] = v.Known; }
            logoAt[i] = prev;
        }
        // gaps: maximal runs without the logo up (a run of up-seconds under 3 is a flicker inside the gap)
        var gaps = new List<(int A, int B)>();
        int? start = null; int upRun = 0;
        for (var i = 0; i < logoAt.Length; i++)
        {
            if (logoAt[i] == 'U') { upRun++; if (start is not null && upRun >= 3) { gaps.Add((start.Value, i - upRun + 1)); start = null; } }
            else { if (start is null) start = i; upRun = 0; }
        }
        if (start is not null) gaps.Add((start.Value, logoAt.Length));
        var breaks = new List<(int A, int B)>();
        foreach (var (a, b) in gaps)
        {
            if (b - a < 15) continue;
            int adN = 0, showN = 0, knownN = 0;
            for (var i = a; i < b; i++) { adN += ad[i]; showN += show[i]; knownN += kn[i]; }
            var spoke = adN >= 1 || knownN >= 2;
            if (spoke && adN + (knownN >= 2 ? 1 : 0) >= showN) breaks.Add((a, b));
        }
        // the channel's promo inside a break carries its logo: an up stretch under 45 s between two breaks is the break's
        var merged = new List<(int A, int B)>();
        foreach (var br in breaks)
        {
            if (merged.Count > 0 && br.A - merged[^1].B < 45) merged[^1] = (merged[^1].A, br.B);
            else merged.Add(br);
        }
        var ads = string.Join(",", merged.Select(x => $"[\"{Hms(t0 + x.A)}\",\"{Hms(t0 + x.B)}\"]"));
        winsOut.Add($"\"{win}\":{{\"name\":\"{(name ?? "").Replace("\"", "")}\",\"ads\":[{ads}]}}");
        Console.WriteLine($"{win} ({name}): {merged.Count} breaks, {merged.Sum(x => x.B - x.A)} s of {logoAt.Length} s");
    }
    var f0 = $"{from[..2]}:{from[2..4]}:{from[4..6]}"; var f1 = $"{to[..2]}:{to[2..4]}:{to[4..6]}";
    File.WriteAllText(args[3], "{\"from\":\"" + f0 + "\",\"to\":\"" + f1 + "\",\"since\":\"" + (Environment.GetEnvironmentVariable("SINCE") ?? f0) + "\",\"windows\":{" + string.Join(",", winsOut) + "}}");
    return;
}
if (args.Length >= 4 && args[0] == "inset")
{
    // the inset rule alone over a window's kept frames (2026-10-08): inset <window folder> <from> <to>
    // ... with a fifth argument, the channel's learned logo (<id>.logo): the full-screen ads beside an inset break are counted too
    var im = args.Length >= 5 ? BreakModel.Load(args[4]) : new BreakModel();
    im.TickerChannel = true;
    var ion = false; var iprog = false; double ilast = 0, iup = 0, itot = 0; var inum = 0; var icovers = 0; var itail = 0;
    foreach (var f in Directory.GetFiles(args[1], "*.gray").OrderBy(x => x, StringComparer.Ordinal))
    {
        var nme = Path.GetFileNameWithoutExtension(f);
        if (string.CompareOrdinal(nme, args[2]) < 0 || string.CompareOrdinal(nme, args[3]) >= 0) continue;
        var t = int.Parse(nme[..2]) * 3600 + int.Parse(nme[2..4]) * 60 + int.Parse(nme[4..6]) + int.Parse(nme[6..9]) / 1000.0;
        im.Step(File.ReadAllBytes(f), t, ilast > 0 ? Math.Clamp(t - ilast, 0.5, 6) : 1); ilast = t; inum++;
        var inow = im.InsetBreakAt(t) || im.InsetTailAt(t);
        if (im.InsetTailAt(t) && !im.InsetBreakAt(t)) itail++;
        if (im.InsetProgramme != iprog) { iprog = im.InsetProgramme; Console.WriteLine($"{nme[..2]}:{nme[2..4]}:{nme[4..6]} {(iprog ? "the programme itself is inset: the rule stands down" : "full for a minute: the rule is back")}"); }
        if (inow != ion) { ion = inow; if (ion) { iup = t; icovers++; } else itot += t - iup; Console.WriteLine($"{nme[..2]}:{nme[2..4]}:{nme[4..6]} {(ion ? (im.InsetBreakAt(t) ? "inset" : "tail") : "edges")}"); }
    }
    Console.WriteLine($"{inum} frames, {icovers} covers, covered {itot:0} s, of it {itail} looks full screen after an inset break");
    return;
}
if (args.Length >= 4 && args[0] == "bench")
{
    if (double.TryParse(Environment.GetEnvironmentVariable("SURE"), out var su0)) BreakModel.SureSeconds = su0;
    if (double.TryParse(Environment.GetEnvironmentVariable("CUTWAIT"), out var cw0)) BreakModel.CutSureSeconds = cw0;
    // the test bench (2026-10-07): replay the recorded frames and readings of every window between two wall times through today's model,
    // writing its calls as host.log lines for rates2.py. Known ads from the library as it stands (an optimistic read for breaks it learned from).
    var bench = (Environment.GetEnvironmentVariable("BENCHROOT") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "diagnostics", "bench"));
    var lib = new AdPrints(Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), "prints.bin"));
    var snd = new AdSounds(Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), "sounds.bin"));
    string from = args[1], to = args[2];
    static double Sec(string hms) => int.Parse(hms[..2]) * 3600 + int.Parse(hms[2..4]) * 60 + int.Parse(hms[4..6]) + (hms.Length >= 9 ? int.Parse(hms[6..9]) / 1000.0 : 0);
    using var outw = new StreamWriter(args[3]);
    // the learned detector's training rows (2026-10-07): one a frame, every window, the model's readings after the frame
    using var feat = Environment.GetEnvironmentVariable("FEATCSV") is { Length: > 0 } fpath ? new StreamWriter(fpath) : null;
    // the learned detector run as Prism runs it (LMODEL=model.json): every row's chance (LPARITY=...csv) and its covers as calls (LCALLS=...log)
    var learned = Environment.GetEnvironmentVariable("LMODEL") is { Length: > 0 } lm ? LearnedBreak.Load(lm) : null;
    using var lpar = learned is not null && Environment.GetEnvironmentVariable("LPARITY") is { Length: > 0 } lp ? new StreamWriter(lp) : null;
    using var lcalls = learned is not null && Environment.GetEnvironmentVariable("LCALLS") is { Length: > 0 } lc ? new StreamWriter(lc) : null;
    // LCALLS0: the same pass's covers without the standing ad line's hold, so the rule is read against its own run (two runs of one
    // day differ by themselves when the library they read is the live one, still learning)
    using var lcalls0 = learned is not null && Environment.GetEnvironmentVariable("LCALLS0") is { Length: > 0 } lc0 ? new StreamWriter(lc0) : null;
    lpar?.WriteLine("win,t,p");
    feat?.WriteLine("win,t," + string.Join(",", BreakModel.FeatureNames) + ",print_seen");
    foreach (var dir in Directory.GetDirectories(bench))
    {
        var win = Path.GetFileName(dir);
        var items = new List<(string at, string? frame, string? evt)>();
        foreach (var f in Directory.GetFiles(dir, "*.gray")) { var n = Path.GetFileNameWithoutExtension(f); if (string.CompareOrdinal(n, from) >= 0 && string.CompareOrdinal(n, to) < 0) items.Add((n, f, null)); }
        var ev = Path.Combine(dir, "events.log");
        var cueLead = double.TryParse(Environment.GetEnvironmentVariable("CUELEAD"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var cl) ? cl : 0;
        string? chan = null;
        string? firstAt = null;
        if (File.Exists(ev))
            foreach (var line in File.ReadLines(ev)) { var sp = line.Split(' ', 3); if (sp.Length == 3 && sp[2].StartsWith("cueat ")) { firstAt = sp[0]; break; } }
        if (File.Exists(ev))
            foreach (var line in File.ReadAllLines(ev))
            {
                var sp = line.Split(' ', 3); if (sp.Length < 3) continue;
                if (sp[2].StartsWith("channel ")) { if (string.CompareOrdinal(sp[0], from) < 0) chan = sp[2][8..].Trim(); }
                if (string.CompareOrdinal(sp[0], from) >= 0 && string.CompareOrdinal(sp[0], to) < 0) items.Add((sp[0], null, sp[2]));
                // "cue" is the cue as the page read it from its buffer, 14 to 31 s before the picture: the learned detector's input. "cueat"
                // is the cue as it played: the sure rule's (the adapter's verified.cue, 2026-10-08). A recording from before the page sent
                // both has no "cueat": each "cue" older than the file's first "cueat" stands in for one, CUELEAD seconds later (0 = as it
                // ran then, the sure rule on the early clock).
                if (sp[2].StartsWith("cue ") && (firstAt is null || string.CompareOrdinal(sp[0], firstAt) < 0))
                {
                    var ms = Math.Min((long)((Sec(sp[0]) + cueLead) * 1000), 86399999L);
                    var key = (ms / 3600000).ToString("00") + (ms / 60000 % 60).ToString("00") + (ms / 1000 % 60).ToString("00") + (ms % 1000).ToString("000");
                    if (string.CompareOrdinal(key, from) >= 0 && string.CompareOrdinal(key, to) < 0) items.Add((key, null, "cueat " + sp[2][4..]));
                }
            }
        items = items.OrderBy(x => x.at, StringComparer.Ordinal).ThenBy(x => x.frame is null ? 0 : 1).ToList();   // stable: equal times keep their order
        BreakModel? m = chan is null ? null : BreakModel.Load(Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), chan + ".logo"));
        double last = 0; var name = ""; var sound = new List<uint>();
        var lst = learned?.NewState();
        var lshown = false; var lshownAt = -999.0; var lshown0 = false;
        var plainRun = 0; var plainLift = int.TryParse(Environment.GetEnvironmentVariable("PLAINLIFT"), out var pl_) ? pl_ : 0;
        double paidSeen = -9999, paidUntil = -1;
        var ccBlind = int.TryParse(Environment.GetEnvironmentVariable("CCBLIND"), out var cb_) ? cb_ : 0; var ccLineAt = Array.IndexOf(BreakModel.FeatureNames, "since_cc_line");
        var half = Environment.GetEnvironmentVariable("HALF") == "1"; var skips = 0;
        foreach (var (at, frame, evt) in items)
        {
            var t = Sec(at);
            if (evt is not null)
            {
                if (evt.StartsWith("channel ")) { if (m is { Active: true }) outw.WriteLine($"{at[..2]}:{at[2..4]}:{at[4..6]}.000 break watch {win}: show (bench, channel changed)"); chan = evt[8..].Trim(); m = BreakModel.Load(Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), chan + ".logo")); last = 0; continue; }
                if (m is null) continue;
                if (evt.StartsWith("text ")) m.Text(evt[5..], t);
                else if (evt.StartsWith("cc ")) { if (lst is not null) learned!.Caption(lst, evt[3..], t); m.Captions(evt[3..], 0, t); var cw = m.Text(evt[3..], t, spoken: true); if (Environment.GetEnvironmentVariable("BWCC") == "1") outw.WriteLine($"{at[..2]}:{at[2..4]}:{at[4..6]}.000 break watch {win}: cc {cw} logo={m.LogoScore:0.00} active={m.Active}"); }
                else if (evt == "qr") m.QrSeen(t);
                else if (evt.StartsWith("edge ")) { var p = evt.Split(' ', 3); m.NearEdge = p[1] == "1"; m.EdgeKnown = true; name = p.Length > 2 ? p[2] : ""; m.ChannelName = name; m.AdFreeChannel = System.Text.RegularExpressions.Regex.IsMatch(name, @"^(C-SPAN\d?|PBS( Kids)?|PBS .*)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase); }
                else if (evt == "notanad") m.Dismiss(t);
                else if (evt.StartsWith("cueat ")) { var c = evt.Split(' '); if (c.Length >= 4) m.CueSeen(c[1], double.Parse(c[2], System.Globalization.CultureInfo.InvariantCulture), double.Parse(c[3], System.Globalization.CultureInfo.InvariantCulture), t); }
                else if (evt.StartsWith("cue ")) { var c = evt.Split(' '); if (c.Length >= 4) m.CueRead(c[1], double.Parse(c[2], System.Globalization.CultureInfo.InvariantCulture), double.Parse(c[3], System.Globalization.CultureInfo.InvariantCulture), t); }
                else if (evt.StartsWith("afp "))
                {
                    var hex = evt[4..].Trim();
                    for (var k = 0; k + 8 <= hex.Length; k += 8) if (uint.TryParse(hex.AsSpan(k, 8), System.Globalization.NumberStyles.HexNumber, null, out var w)) sound.Add(w);
                    if (sound.Count > 400) sound.RemoveRange(0, sound.Count - 400);
                    if (snd.Heard(sound)) m.SoundSeen(t);
                }
                continue;
            }
            if (m is null || frame is null) continue;
            // HALF=1: a quiet small window as every household without Ad debug has it - looked at every other second while the rules read
            // under 20%, the learned score is low and no cover is up (MainWindow.BreakWatch's skip). The recordings are a look a second.
            if (half && !m.Active && m.Chance < 0.2 && !lshown && (lst is null || lst.LastP < 0.3) && (skips++ % 2 == 1)) continue;
            if (Environment.GetEnvironmentVariable("BWTITLE") is { Length: > 0 } bt && win.EndsWith(Environment.GetEnvironmentVariable("BWTITLEWIN") ?? "~")) m.ShowTitle = bt;
            var g = File.ReadAllBytes(frame); if (g.Length != BreakModel.W * BreakModel.H) continue;
            var seenNow = AdPrints.Of(g, BreakModel.W, BreakModel.H) is { } fp && lib.Seen(fp);
            if (seenNow) m.PrintSeen(t);
            var stepped = m.Step(g, t, last > 0 ? Math.Clamp(t - last, 0.5, 6) : 1);
            if (lst is not null)
            {
                var f2 = m.Features(t);
                // CCBLIND=1 (a trial, 2026-10-09): while a cover is up and the channel's logo is away, a caption line is not read as the
                // show (Comedy Central 11:26:42 and 12:20:26: a captioned ad after uncaptioned ones lifted the cover at 0.49 and 0.54,
                // with the rules at 99% and the ad's own words on screen three seconds before)
                if (lst.Up && (ccBlind == 1 ? m.HasLogo && !m.LogoUpNow : ccBlind == 2 ? !m.LogoUpNow : ccBlind == 3 && !m.HasLogo)) f2[ccLineAt] = 120;
                var lp2 = learned!.Score(lst, f2, seenNow ? 1 : 0, t);
                lpar?.WriteLine(win + "," + t.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + "," + lp2.ToString("0.000000", System.Globalization.CultureInfo.InvariantCulture));
                var was2 = lst.Up; var up2 = learned.Decide(lst, lp2, t);
                if (Environment.GetEnvironmentVariable("LVETO") == "1" && up2 && !was2 && m.PlainShow(t)) { up2 = false; lst.Up = false; }
                // PLAINLIFT=n (a trial, 2026-10-09): a cover the learned detector holds lifts once every rule has said "the show is on"
                // (the logo plainly up, no ad's words, no known ad, no marked slot) at n looks running, without waiting for its score
                plainRun = up2 && m.PlainShow(t) ? plainRun + 1 : 0;
                if (plainLift > 0 && up2 && plainRun >= plainLift) { up2 = false; lst.Up = false; plainRun = 0; }
                var shown2 = up2 || m.CueOnAt(t) || (Environment.GetEnvironmentVariable("LINFO") == "1" && m.InfomercialAt(t)) || (Environment.GetEnvironmentVariable("ADLINE") != "0" && t - lshownAt <= 20 && m.AdLineAt(t)) || (Environment.GetEnvironmentVariable("CUECOMING") != "0" && t - lshownAt <= 20 && m.CueComingAt(t));
                // a paid programme's own card covers to the end of its half hour (BreakModel.PaidCard; PAIDCARD=0 replays without it)
                var tod = int.Parse(at[..2]) * 3600 + int.Parse(at[2..4]) * 60 + int.Parse(at[4..6]);
                if (m.PaidCardAt > paidSeen) { paidSeen = m.PaidCardAt; var day0 = new DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero); paidUntil = (BreakModel.PaidSlotEnd(day0.AddSeconds(tod), m.PaidCardFollowing) - day0).TotalSeconds; }
                if (Environment.GetEnvironmentVariable("PAIDCARD") != "0" && tod < paidUntil) shown2 = true;
                if (shown2) lshownAt = t;
                var shown0 = up2 || m.CueOnAt(t) || (Environment.GetEnvironmentVariable("LINFO") == "1" && m.InfomercialAt(t));
                if (shown0 != lshown0) { lshown0 = shown0; lcalls0?.WriteLine($"{at[..2]}:{at[2..4]}:{at[4..6]}.000 break watch {win}: {(shown0 ? "break" : "show")} (learned {lp2:0.00})"); }
                if (shown2 != lshown) { lshown = shown2; lcalls?.WriteLine($"{at[..2]}:{at[2..4]}:{at[4..6]}.000 break watch {win}: {(shown2 ? "break" : "show")} (learned {lp2:0.00})"); }
            }
            if (feat is not null) feat.WriteLine(win + "," + t.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + "," + string.Join(",", m.Features(t).Select(x => x.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture))) + "," + (seenNow ? 1 : 0));
            if (stepped) outw.WriteLine($"{at[..2]}:{at[2..4]}:{at[4..6]}.000 break watch {win}: {(m.Active ? "break" : "show")} (bench)");
            if (Environment.GetEnvironmentVariable("BWWHY") is { Length: > 0 } ww && win.EndsWith(ww)) outw.WriteLine($"{at[..2]}:{at[2..4]}:{at[4..6]} why p={m.Chance:0.00} {(m.Active ? "COVER" : "")} {m.Why} | {m.Hold}");
            last = t;
        }
    }
    return;
}
if (args.Length >= 3 && args[0] == "sim")
{
    // replay recorded frames from a start time through each window's model (seeded from the saved logos), writing the calls as host.log lines
    if (double.TryParse(Environment.GetEnvironmentVariable("SURE"), out var su)) BreakModel.SureSeconds = su;
    if (double.TryParse(Environment.GetEnvironmentVariable("RECOVER"), out var rc)) BreakModel.RecoverSeconds = rc;
    if (double.TryParse(Environment.GetEnvironmentVariable("CUT"), out var cd)) BreakModel.CutDiff = cd;
    if (double.TryParse(Environment.GetEnvironmentVariable("CUTWAIT"), out var cw)) BreakModel.CutSureSeconds = cw;
    var chans = new Dictionary<string, string> { ["youtube-tv-home-16x9-XL"] = "exvvT89auH4", ["youtube-tv-home-16x9-XL-w2"] = "fvcHs7wIpnQ", ["youtube-tv-home-16x9-XL-w4"] = "HP7WCSCwPWc", ["youtube-tv-home-16x9-XL-w5"] = "Z6dXr-ocSks", ["screen"] = "tdwQxM1NlvA" };
    using var outw = new StreamWriter(args[2]);
    foreach (var (win, ch) in chans)
    {
        var mdl = BreakModel.Load(Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), ch + ".logo")); double lt = 0;
        foreach (var f in Directory.GetFiles(Path.Combine(root, win), "*.gray").OrderBy(x => x))
        {
            var t = Path.GetFileNameWithoutExtension(f); if (t.CompareTo(args[1]) < 0) continue;
            var g = File.ReadAllBytes(f); if (g.Length != BreakModel.W * BreakModel.H) continue;
            var s0 = int.Parse(t[..2]) * 3600 + int.Parse(t[2..4]) * 60 + int.Parse(t[4..6]);
            if (mdl.Step(g, s0, lt > 0 ? Math.Clamp(s0 - lt, 0.5, 6) : 2)) outw.WriteLine($"{t[..2]}:{t[2..4]}:{t[4..6]}.000 break watch {win}: {(mdl.Active ? "break" : "show")} (sim)");
            lt = s0;
        }
    }
    return;
}
if (args.Length == 2 && args[0] == "seedprints")
{
    // the labelled breaks' pictures into the fingerprint library the host reads
    var lib = new AdPrints(Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), "prints.bin"));
    var before = lib.Count; var n = 0;
    foreach (var line in File.ReadAllLines(args[1]))
    {
        var p = line.Split(' '); if (p.Length < 3) continue;
        foreach (var f in Directory.GetFiles(Path.Combine(root, p[0]), "*.gray").OrderBy(x => x))
        {
            var t = Path.GetFileNameWithoutExtension(f); if (t.CompareTo(p[1]) < 0 || t.CompareTo(p[2]) >= 0) continue;
            var g = File.ReadAllBytes(f); if (g.Length != BreakModel.W * BreakModel.H) continue;
            if (AdPrints.Of(g, BreakModel.W, BreakModel.H) is { } fp) { lib.Learn(fp); n++; }
        }
    }
    lib.Save(); Console.WriteLine($"seeded {n} ad frames: library {before} -> {lib.Count}"); return;
}
if (args.Length >= 1 && args[0] == "qr")
{
    // the QR finder on 960x540 grey test pictures, and its false hits on recorded frames upscaled
    foreach (var f in args.Skip(1)) { var g = File.ReadAllBytes(f); Console.WriteLine(Path.GetFileName(f) + ": " + new BreakModel().Qr(g, 960, 540, 0)); }
    int hits = 0, n = 0;
    foreach (var dir in Directory.GetDirectories(root))
        foreach (var f in Directory.GetFiles(dir, "*.gray").Where((_, i) => i % 5 == 0))
        {
            var g = File.ReadAllBytes(f); if (g.Length != 320 * 180) continue;
            var up = new byte[960 * 540];
            for (var y = 0; y < 540; y++) for (var x = 0; x < 960; x++) up[y * 960 + x] = g[(y / 3) * 320 + x / 3];
            n++; if (new BreakModel().Qr(up, 960, 540, 0)) { hits++; if (hits <= 12) Console.WriteLine("  hit " + Path.GetFileName(dir) + " " + Path.GetFileName(f)); }
        }
    Console.WriteLine($"recorded frames upscaled: {hits}/{n} hit"); return;
}
if (args.Length == 3)
{
    // seed: learn a channel's logo from a window's recorded frames since a time, saved where the host reads it
    var mdl = new BreakModel(); double lt = 0;
    foreach (var f in Directory.GetFiles(Path.Combine(root, args[0]), "*.gray").OrderBy(x => x))
    {
        var t = Path.GetFileNameWithoutExtension(f); if (t.CompareTo(args[1]) < 0) continue;
        var g = File.ReadAllBytes(f); if (g.Length != BreakModel.W * BreakModel.H) continue;
        var s0 = int.Parse(t[..2]) * 3600 + int.Parse(t[2..4]) * 60 + int.Parse(t[4..6]);
        mdl.Step(g, s0, lt > 0 ? Math.Clamp(s0 - lt, 0.5, 6) : 2); lt = s0;
    }
    var outp = Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), args[2] + ".logo");
    mdl.Save(outp); Console.WriteLine(args[2] + ": " + (mdl.HasLogo ? "saved " + outp : "no logo learned")); return;
}
var labels = new Dictionary<string, (string, string)[]> {
  ["youtube-tv-home-16x9-XL-w3"] = new[] { ("155045","155415"), ("160518","160905"), ("161557","161956"), ("162906","163300") },
  ["youtube-tv-home-16x9-XL"] = new[] { ("160040","160413"), ("161311","161718"), ("162851","163300") } };
static double Secs(string t) => int.Parse(t[..2]) * 3600 + int.Parse(t[2..4]) * 60 + int.Parse(t[4..6]);
foreach (var dir in Directory.GetDirectories(root).OrderBy(d => d))
{
    var win = Path.GetFileName(dir); var m = new BreakModel(); double last = 0; string? on = null; var runs = new List<string>();
    int tp = 0, P = 0, fp = 0, N = 0;
    foreach (var f in Directory.GetFiles(dir, "*.gray").OrderBy(x => x))
    {
        var t = Path.GetFileNameWithoutExtension(f); var g = File.ReadAllBytes(f); if (g.Length != BreakModel.W * BreakModel.H) continue;
        var s = Secs(t); m.Step(g, s, last > 0 ? Math.Clamp(s - last, 0.5, 6) : 2); last = s;
        if (Environment.GetEnvironmentVariable("DUMPW") == win && t.CompareTo(Environment.GetEnvironmentVariable("DUMPF")!) >= 0 && t.CompareTo(Environment.GetEnvironmentVariable("DUMPT")!) <= 0) Console.WriteLine($"   {t} p={m.Chance:0.00} {(m.Active ? "ON" : "  ")} {m.Why}");
        if (m.Active && on is null) on = t; if (!m.Active && on is not null) { runs.Add(on + "-" + t); on = null; }
        if (labels.TryGetValue(win, out var L) && t.CompareTo("163300") < 0) { var y = L.Any(b => t.CompareTo(b.Item1) >= 0 && t.CompareTo(b.Item2) <= 0); if (y) { P++; if (m.Active) tp++; } else { N++; if (m.Active) fp++; } }
    }
    if (on is not null) runs.Add(on + "-now");
    Console.WriteLine($"== {win} logo {(m.HasLogo ? "learned" : "none")}" + (P > 0 ? $"  break covered {tp}/{P} ({100.0 * tp / P:0}%)  show wrongly covered {fp}/{N} ({100.0 * fp / Math.Max(1, N):0.0}%)" : ""));
    Console.WriteLine("   covered: " + string.Join(", ", runs));
}
