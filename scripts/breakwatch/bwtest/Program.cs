using PrismHost.Services;
// What a browser extension can see (2026-11-06): NOTEXT=1 drops on-screen text and QR codes (it has no text recognition), NOCC=1 the
// captions (it does not switch them on), NOSOUND=1 the sound's level, silences and fingerprint (it does not reroute a page's audio)
static bool NoTextEvt(string e) =>
    (Environment.GetEnvironmentVariable("NOTEXT") == "1" && (e.StartsWith("text ") || e == "qr")) ||
    (Environment.GetEnvironmentVariable("NOCC") == "1" && e.StartsWith("cc ")) ||
    (Environment.GetEnvironmentVariable("NOSOUND") == "1" && (e.StartsWith("level ") || e.StartsWith("silence ") || e.StartsWith("afp ")));
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
                if (string.CompareOrdinal(sp[0], from) >= 0 && string.CompareOrdinal(sp[0], to) < 0 && !NoTextEvt(sp[2])) all.Add((Sec2(sp[0]), win, null, sp[2]));
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
    // the hindsight labeller (2026-10-07):
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
                if (sp[2].StartsWith("edge ") && string.CompareOrdinal(sp[0], to) < 0 && !NoTextEvt(sp[2])) { var p = sp[2].Split(' ', 3); if (p.Length > 2) name = p[2]; }
                if (string.CompareOrdinal(sp[0], from) >= 0 && string.CompareOrdinal(sp[0], to) < 0 && !NoTextEvt(sp[2])) items.Add((S3(sp[0]), null, sp[2]));
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
    // INSETANY=1: the window read as ANY channel (B-476: the inset rule armed by the lit band, no ticker by name); INSETANY=0: the
    // named-ticker reading of 2026-10-08 alone; unset: the named reading, as this mode always ran
    var insetAny = Environment.GetEnvironmentVariable("INSETANY");
    BreakModel.InsetAnywhere = insetAny == "1";
    im.TickerChannel = insetAny != "1";
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
    if (Environment.GetEnvironmentVariable("INSETANY") == "0") BreakModel.InsetAnywhere = false;
    // BANDLOGO / BANDSTRICT = 1 | 0 name the state outright (the model defaults are off since 10:50; a switch that could only turn the rule off
    // left the first training pass without it, 2026-11-04: the new model scored the control's numbers to the second)
    if (Environment.GetEnvironmentVariable("BANDLOGO") is "0" or "1") BreakModel.BandLogo = Environment.GetEnvironmentVariable("BANDLOGO") == "1";
    if (Environment.GetEnvironmentVariable("BANDSTRICT") is "0" or "1") BreakModel.BandStrict = Environment.GetEnvironmentVariable("BANDSTRICT") == "1";
    if (double.TryParse(Environment.GetEnvironmentVariable("CUTWAIT"), out var cw0)) BreakModel.CutSureSeconds = cw0;
    // the test bench (2026-10-07): replay the recorded frames and readings of every window between two wall times through today's model,
    // writing its calls as host.log lines for rates2.py. Known ads from the library as it stands (an optimistic read for breaks it learned from).
    var bench = (Environment.GetEnvironmentVariable("BENCHROOT") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "diagnostics", "bench"));
    var lib = new AdPrints(Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), "prints.bin"), Environment.GetEnvironmentVariable("CATALOG"));   // CATALOG: the shipped catalog, as Prism reads it
    var snd = new AdSounds(Path.Combine(Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch"), "sounds.bin"));
    string from = args[1], to = args[2];
    static double Sec(string hms) => int.Parse(hms[..2]) * 3600 + int.Parse(hms[2..4]) * 60 + int.Parse(hms[4..6]) + (hms.Length >= 9 ? int.Parse(hms[6..9]) / 1000.0 : 0);
    using var outw = new StreamWriter(args[3]);
    // the learned detector's training rows (2026-10-07): one a frame, every window, the model's readings after the frame
    using var feat = Environment.GetEnvironmentVariable("FEATCSV") is { Length: > 0 } fpath ? new StreamWriter(fpath) : null;
    // the learned detector run as Prism runs it (LMODEL=model.json): every row's chance (LPARITY=...csv) and its covers as calls (LCALLS=...log)
    var learned = Environment.GetEnvironmentVariable("LMODEL") is { Length: > 0 } lm ? LearnedBreak.Load(lm) : null;
    // PICNET=<picture-net.json> PICW=<weight> (2026-11-06, the feature review's item 3): the picture network's chance added in logit to
    // the learned chance, as the app and the extension would; each window's frame before, if within three seconds, is its second input
    var picNet = Environment.GetEnvironmentVariable("PICNET") is { Length: > 0 } pn ? PictureNet.Load(pn) : null;
    var picW = double.TryParse(Environment.GetEnvironmentVariable("PICW"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var pw) ? pw : 0.75;
    var picPrev = new Dictionary<string, (double T, byte[] G)>();
    var agree = Environment.GetEnvironmentVariable("AGREE") == "1";
    var treeMin = double.TryParse(Environment.GetEnvironmentVariable("TREEMIN"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var tm) ? tm : 0.5;
    var netMin = double.TryParse(Environment.GetEnvironmentVariable("NETMIN"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var nm) ? nm : 0.5;
    if (Environment.GetEnvironmentVariable("PICNET") is { Length: > 0 } && picNet is null) throw new Exception("PICNET: not a picture network");
    using var lpar = learned is not null && Environment.GetEnvironmentVariable("LPARITY") is { Length: > 0 } lp ? new StreamWriter(lp) : null;
    using var lcalls = learned is not null && Environment.GetEnvironmentVariable("LCALLS") is { Length: > 0 } lc ? new StreamWriter(lc) : null;
    // LCALLS0: the same pass's covers without the standing ad line's hold, so the rule is read against its own run (two runs of one
    // day differ by themselves when the library they read is the live one, still learning)
    using var lcalls0 = learned is not null && Environment.GetEnvironmentVariable("LCALLS0") is { Length: > 0 } lc0 ? new StreamWriter(lc0) : null;
    var lpSure = Environment.GetEnvironmentVariable("LPSURE") == "1";
    lpar?.WriteLine(lpSure ? "win,t,p,trees,sure_ad,sure_show" : "win,t,p");
    feat?.WriteLine("win,t," + string.Join(",", BreakModel.FeatureNames) + ",print_seen" + (Environment.GetEnvironmentVariable("COVERSIGHT") is { Length: > 0 } ? ",cover_up" : ""));
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
                if (string.CompareOrdinal(sp[0], from) >= 0 && string.CompareOrdinal(sp[0], to) < 0 && !NoTextEvt(sp[2])) items.Add((sp[0], null, sp[2]));
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
        // HEARD=<folder>: the seconds at which this window's sound was a learned ad's (repeats.py --heard: a Prism that learns an ad's
        // sound from its repeats, played forward), one a line in <folder>/<window>.heard - counted as AdSounds hearing it
        var heardAt = new HashSet<int>();
        if (Environment.GetEnvironmentVariable("HEARD") is { Length: > 0 } hd && File.Exists(Path.Combine(hd, win + ".heard")))
            foreach (var hl in File.ReadLines(Path.Combine(hd, win + ".heard"))) if (int.TryParse(hl, out var hs)) heardAt.Add(hs);
        // HEARDRULE=1|2 (a trial, 2026-10-10): those seconds are not given to the model as sound heard; they act as a rule beside it -
        // 1: a cover that is up, or was within twenty seconds, stays while a learned ad's sound plays; 2: that, and the sound starts a
        // cover by itself at its second second running
        var heardRule = int.TryParse(Environment.GetEnvironmentVariable("HEARDRULE"), out var hr_) ? hr_ : 0; var heardRun = 0;
        var lst = learned?.NewState();
        var lshown = false; var lshownAt = -999.0; var lshown0 = false;
        var plainRun = 0; var plainLift = int.TryParse(Environment.GetEnvironmentVariable("PLAINLIFT"), out var pl_) ? pl_ : 0;
        double paidSeen = -9999, paidUntil = -1, paidOpenSeen = -9999, paidCloseSeen = -9999, paidLogoSince = -1;
        var ccBlind = int.TryParse(Environment.GetEnvironmentVariable("CCBLIND"), out var cb_) ? cb_ : 0; var ccLineAt = Array.IndexOf(BreakModel.FeatureNames, "since_cc_line");
        var half = Environment.GetEnvironmentVariable("HALF") == "1"; var skips = 0;
        // COVERSIGHT (2026-11-06, the extension's spotted veil): what the model sees while a cover is up, when the cover is in the picture
        // it reads (a browser tab's own stream records Veil's cover; Prism's own capture never holds its cover): art = an opaque cover, its picture still; corner = the cover leaves
        // the learned logo's corner (80x45) open and the rest is the cover's art; see:<opacity>[:<noise>] = a see-through cover whose art
        // Veil subtracts again, in whole grey steps with the stream's noise. COVERART = the art as raw 320x180 grey. Unset: Prism's sight.
        var coverSight = Environment.GetEnvironmentVariable("COVERSIGHT") is { Length: > 0 } csv ? csv : null;
        var coverArt = coverSight is not null && Environment.GetEnvironmentVariable("COVERART") is { Length: > 0 } cap && File.Exists(cap) ? File.ReadAllBytes(cap) : new byte[BreakModel.W * BreakModel.H];
        var coverRng = new Random(1);
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
                else if (evt.StartsWith("level "))   // the page's meter, the trees' sound input (2026-11-04): "level <db> <peak>"
                {
                    var lv = evt.Split(' ');
                    if (lv.Length >= 2 && double.TryParse(lv[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var ldb))
                        m.Level(ldb, lv.Length >= 3 && double.TryParse(lv[2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var lpk) ? lpk : ldb, t);
                }
                else if (evt.StartsWith("silence "))   // a silence "ago" seconds before the look, as Prism reads it
                {
                    if (double.TryParse(evt.AsSpan(8), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var sago)) m.Silence(t - sago);
                }
                else if (evt.StartsWith("afp "))
                {
                    var hex = evt[4..].Trim();
                    for (var k = 0; k + 8 <= hex.Length; k += 8) if (uint.TryParse(hex.AsSpan(k, 8), System.Globalization.NumberStyles.HexNumber, null, out var w)) sound.Add(w);
                    if (sound.Count > 400) sound.RemoveRange(0, sound.Count - 400);
                    if (snd.Heard(sound) || (heardRule == 0 && heardAt.Contains((int)t))) m.SoundSeen(t);
                }
                continue;
            }
            if (m is null || frame is null) continue;
            // HALF=1: a quiet small window as every household without Ad debug has it - looked at every other second while the rules read
            // under 20%, the learned score is low and no cover is up (MainWindow.BreakWatch's skip). The recordings are a look a second.
            if (half && !m.Active && m.Chance < 0.2 && !lshown && (lst is null || lst.LastP < 0.3) && (skips++ % 2 == 1)) continue;
            if (Environment.GetEnvironmentVariable("BWTITLE") is { Length: > 0 } bt && win.EndsWith(Environment.GetEnvironmentVariable("BWTITLEWIN") ?? "~")) m.ShowTitle = bt;
            var g = File.ReadAllBytes(frame); if (g.Length != BreakModel.W * BreakModel.H) continue;
            var coveredNow = coverSight is not null && lshown;   // this look is taken through the cover (and says so: cover_up)
            if (coveredNow) g = UnderCover(g, m, coverSight, coverArt, coverRng);
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
                var lp2 = learned!.Score(lst, f2, seenNow ? 1 : 0, t, coveredNow ? 1 : 0, t);
                var lpTrees = lp2;
                if (picNet is not null)
                {
                    var prevG = picPrev.TryGetValue(win, out var pp) && t - pp.T < 3 ? pp.G : null;
                    var q = Math.Clamp(picNet.Chance(g, prevG), 0.001, 0.999); var l0 = Math.Clamp(lp2, 0.001, 0.999);
                    var blended = 1 / (1 + Math.Exp(-(Math.Log(l0 / (1 - l0)) + picW * Math.Log(q / (1 - q)))));
                    // AGREE=1 (2026-11-07, the pop-ups): a cover may BEGIN only when both detectors lean to a break - the trees' own
                    // chance at least TREEMIN (0.5) and the network's at least NETMIN (0.5) - the blend then crossing the policy's
                    // threshold as ever; once up, the blend alone holds it (either detector keeps it). A look where one of them says show
                    // counts as a miss for the start, so the policy's run begins again.
                    if (agree && !lst.Up && (lp2 < treeMin || q < netMin)) blended = 0;
                    lp2 = blended;
                    picPrev[win] = (t, g);
                }
                // LPSURE=1 (2026-11-07, the per-channel calibration study): beside the chance, the trees' own chance before the network, and
                // whether the look was a sure ad (a marked slot playing, a known ad, an infomercial) or a sure show (every rule says show):
                // the labelled seconds a channel gives for free, which a calibration could learn its threshold from
                lpar?.WriteLine(win + "," + t.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + "," + lp2.ToString("0.000000", System.Globalization.CultureInfo.InvariantCulture)
                    + (lpSure ? "," + lpTrees.ToString("0.000000", System.Globalization.CultureInfo.InvariantCulture) + "," + ((m.CueOnAt(t) || seenNow || m.InfomercialAt(t)) ? 1 : 0) + "," + (m.PlainShow(t) ? 1 : 0) : ""));
                var was2 = lst.Up; var up2 = learned.Decide(lst, lp2, t, m.LogoInBand);
                if (Environment.GetEnvironmentVariable("LVETO") == "1" && up2 && !was2 && m.PlainShow(t)) { up2 = false; lst.Up = false; }
                // PLAINLIFT=n (a trial, 2026-10-09): a cover the learned detector holds lifts once every rule has said
                // (the logo plainly up, no ad's words, no known ad, no marked slot) at n looks running, without waiting for its score
                plainRun = up2 && m.PlainShow(t) ? plainRun + 1 : 0;
                if (plainLift > 0 && up2 && plainRun >= plainLift) { up2 = false; lst.Up = false; plainRun = 0; }
                var shown2 = up2 || m.CueOnAt(t) || (Environment.GetEnvironmentVariable("LINFO") == "1" && m.InfomercialAt(t)) || (Environment.GetEnvironmentVariable("ADLINE") != "0" && t - lshownAt <= 20 && m.AdLineAt(t)) || (Environment.GetEnvironmentVariable("CUECOMING") != "0" && t - lshownAt <= 20 && m.CueComingAt(t));
                var heardNow = heardRule > 0 && (heardAt.Contains((int)t) || heardAt.Contains((int)t - 1));
                heardRun = heardNow ? heardRun + 1 : 0;
                if (heardNow && (t - lshownAt <= 20 || (heardRule == 2 && heardRun >= 2))) shown2 = true;
                // a paid programme's own card covers to the end of its half hour (BreakModel.PaidCard; PAIDCARD=0 replays without it)
                var tod = int.Parse(at[..2]) * 3600 + int.Parse(at[2..4]) * 60 + int.Parse(at[4..6]);
                if (m.PaidCardAt > paidSeen) { paidSeen = m.PaidCardAt; var day0 = new DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero); paidUntil = (BreakModel.PaidSlotEnd(day0.AddSeconds(tod), m.PaidCardFollowing) - day0).TotalSeconds; }
                // ... and its opening and closing in other words, shown or spoken, as the shell takes them (PAIDOPEN=0 replays without)
                if (Environment.GetEnvironmentVariable("PAIDOPEN") != "0")
                {
                    var day00 = new DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero);
                    if (m.PaidOpenAt > paidOpenSeen) { paidOpenSeen = m.PaidOpenAt; var into = tod % 1800; if (into <= 300 || into >= 1500) paidUntil = (BreakModel.PaidSlotEnd(day00.AddSeconds(tod), true) - day00).TotalSeconds; }
                    if (m.PaidCloseAt > paidCloseSeen) { paidCloseSeen = m.PaidCloseAt; if (tod < paidUntil) paidUntil = 0; }
                    if (tod < paidUntil && m.LogoUpNow) { if (paidLogoSince < 0) paidLogoSince = t; else if (t - paidLogoSince >= 60) { paidUntil = 0; paidLogoSince = -1; } } else paidLogoSince = -1;
                }
                if (Environment.GetEnvironmentVariable("PAIDCARD") != "0" && tod < paidUntil) shown2 = true;
                if (shown2) lshownAt = t;
                var shown0 = up2 || m.CueOnAt(t) || (Environment.GetEnvironmentVariable("LINFO") == "1" && m.InfomercialAt(t));
                if (shown0 != lshown0) { lshown0 = shown0; lcalls0?.WriteLine($"{at[..2]}:{at[2..4]}:{at[4..6]}.000 break watch {win}: {(shown0 ? "break" : "show")} (learned {lp2:0.00})"); }
                if (shown2 != lshown) { lshown = shown2; lcalls?.WriteLine($"{at[..2]}:{at[2..4]}:{at[4..6]}.000 break watch {win}: {(shown2 ? "break" : "show")} (learned {lp2:0.00})"); }
            }
            if (feat is not null) feat.WriteLine(win + "," + t.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + "," + string.Join(",", m.Features(t).Select(x => x.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture))) + "," + (seenNow ? 1 : 0) + (coverSight is not null ? "," + (coveredNow ? 1 : 0) : ""));
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
if (args.Length == 3 && args[0] == "seedlabels")
{
    // the known-ads library fed from a labelled day (2026-11-04, the known-ads step): every marked ad span of every window, its pictures as
    // prints with the span as their clip and their place in it (so a run of the same ad lines up), and its sound words as one stretch the
    // sound library keeps. bwtest seedlabels <day folder> <labels.json>, with BWDIR the library folder to add to.
    var bwdir = Environment.GetEnvironmentVariable("BWDIR") ?? Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA")!, "Prism", "breakwatch");
    var lib = new AdPrints(Path.Combine(bwdir, "prints.bin"));
    var snd = new AdSounds(Path.Combine(bwdir, "sounds.bin"));
    int p0 = lib.Count, s0 = snd.Count, frames = 0, spans = 0, words = 0, guarded = 0, soundGuarded = 0;
    using var lj = System.Text.Json.JsonDocument.Parse(File.ReadAllText(args[2]));
    static string Hms9(string hms) { var q = hms.Split(':'); return q[0].PadLeft(2, '0') + q[1] + q[2] + "000"; }
    static double Sec9(string n) => int.Parse(n[..2]) * 3600 + int.Parse(n[2..4]) * 60 + int.Parse(n[4..6]) + int.Parse(n[6..9]) / 1000.0;
    foreach (var wp in lj.RootElement.GetProperty("windows").EnumerateObject())
    {
        var dir = Path.Combine(args[1], wp.Name);
        if (!Directory.Exists(dir) || !wp.Value.TryGetProperty("ads", out var ads)) continue;
        var grays = Directory.GetFiles(dir, "*.gray").Select(Path.GetFileNameWithoutExtension).Where(x => x!.Length == 9).OrderBy(x => x, StringComparer.Ordinal).ToArray();
        // the show-time guard (2026-11-04: seeded from the day before, the library covered 1.3 points more ad time and 44 s more show, the
        // shows' own scenes matching prints taken from the networks' promos for them): this window's show seconds - reviewed, and neither
        // ad nor neutral - one frame in four, and any ad print within the match distance of one is not kept
        static int Sec9i(string n) => int.Parse(n[..2]) * 3600 + int.Parse(n[2..4]) * 60 + int.Parse(n[4..6]);
        static int HmsI(string s) { var q = s.Split(':'); return int.Parse(q[0]) * 3600 + int.Parse(q[1]) * 60 + int.Parse(q[2]); }
        bool In(System.Text.Json.JsonElement w, string k, int s) { if (!w.TryGetProperty(k, out var arr)) return false; foreach (var x in arr.EnumerateArray()) if (s >= HmsI(x[0].GetString()!) && s < HmsI(x[1].GetString()!)) return true; return false; }
        var showPrints = new List<ulong[]>();
        if (Environment.GetEnvironmentVariable("SHOWGUARD") != "0")
            for (var gi = 0; gi < grays.Length; gi += 4)
            {
                var sn = Sec9i(grays[gi]!);
                if (!In(wp.Value, "reviewed", sn) || In(wp.Value, "ads", sn) || In(wp.Value, "neutral", sn)) continue;
                var g0 = File.ReadAllBytes(Path.Combine(dir, grays[gi] + ".gray")); if (g0.Length != BreakModel.W * BreakModel.H) continue;
                if (AdPrints.Of(g0, BreakModel.W, BreakModel.H) is { } sp) showPrints.Add(sp);
            }
        var stride = int.TryParse(Environment.GetEnvironmentVariable("SEEDSTRIDE"), out var sst) && sst > 0 ? sst : 2;
        var trimSpec = (Environment.GetEnvironmentVariable("SOUNDTRIM") ?? "3,5").Split(','); var trimHead = double.Parse(trimSpec[0], System.Globalization.CultureInfo.InvariantCulture); var trimTail = double.Parse(trimSpec.Length > 1 ? trimSpec[1] : trimSpec[0], System.Globalization.CultureInfo.InvariantCulture);   // one frame in two by default: neighbours are twins
        var afp = new List<(string At, string Hex)>();
        var ev = Path.Combine(dir, "events.log");
        if (File.Exists(ev)) foreach (var line in File.ReadLines(ev)) { var q = line.Split(' ', 4); if (q.Length == 4 && q[2] == "afp") afp.Add((q[0], q[3])); }
        // the sound's show-time guard (2026-11-05): this window's show sound - reviewed seconds, neither ad nor neutral - is indexed as the sound
        // library indexes a break, and a block of a break's sound heard there too is not kept. Sound seeded from breaks had made covers linger
        // (wrongly covered 1.18% against 1.09%): a network's promo for a show carries that show's own sound, so a seeded promo matched the show.
        // SOUNDGUARD=0 seeds as before.
        var showSounds = new List<AdSounds>();
        if (Environment.GetEnvironmentVariable("SOUNDGUARD") != "0")
        {
            var run = new List<uint>(); AdSounds? box = null;
            void Flush()
            {
                for (var k = 0; k + 64 <= run.Count; k += 1600)
                {
                    if (box is null || box.Count >= 590) { box = new AdSounds(Path.Combine(Path.GetTempPath(), "prism-showguard-" + Guid.NewGuid().ToString("N") + ".bin")); showSounds.Add(box); }
                    box.Learn(run.Skip(k).Take(1600).ToList());
                }
                run.Clear();
            }
            foreach (var (at, hex) in afp)
            {
                var sn = (int)Sec9(at);
                if (!In(wp.Value, "reviewed", sn) || In(wp.Value, "ads", sn) || In(wp.Value, "neutral", sn)) { Flush(); continue; }
                for (var k = 0; k + 8 <= hex.Length; k += 8)
                    if (uint.TryParse(hex.AsSpan(k, 8), System.Globalization.NumberStyles.HexNumber, null, out var w)) run.Add(w);
            }
            Flush();
        }
        // PROMOS=show (2026-11-04): the network promos promos.mjs found are cut out of the marked breaks, so no promo print or sound is kept
        var spansHere = new List<(string A, string Z)>();
        foreach (var span in ads.EnumerateArray()) spansHere.Add((Hms9(span[0].GetString()!), Hms9(span[1].GetString()!)));
        if (Environment.GetEnvironmentVariable("PROMOS") == "show")
        {
            var pf = Path.Combine(args[1], "labels.promos.json");
            if (File.Exists(pf))
            {
                using var pj = System.Text.Json.JsonDocument.Parse(File.ReadAllText(pf));
                if (pj.RootElement.GetProperty("windows").TryGetProperty(wp.Name, out var pw) && pw.TryGetProperty("promos", out var pl))
                    foreach (var pr in pl.EnumerateArray())
                    {
                        var pa = Hms9(pr[0].GetString()!); var pz = Hms9(pr[1].GetString()!); var next = new List<(string A, string Z)>();
                        foreach (var (x, y) in spansHere)
                        {
                            if (string.CompareOrdinal(pz, x) <= 0 || string.CompareOrdinal(pa, y) >= 0) { next.Add((x, y)); continue; }
                            if (string.CompareOrdinal(x, pa) < 0) next.Add((x, pa));
                            if (string.CompareOrdinal(pz, y) < 0) next.Add((pz, y));
                        }
                        spansHere = next;
                    }
            }
        }
        foreach (var (a, z) in spansHere)
        {
            if (string.CompareOrdinal(z, a) <= 0) continue;
            spans++;
            var clip = lib.NextClip(); var t0 = Sec9(a);
            var nth = 0;
            foreach (var n in grays)
            {
                if (string.CompareOrdinal(n, a) < 0 || string.CompareOrdinal(n, z) >= 0) continue;
                if (nth++ % stride != 0) continue;
                var g = File.ReadAllBytes(Path.Combine(dir, n + ".gray")); if (g.Length != BreakModel.W * BreakModel.H) continue;
                if (AdPrints.Of(g, BreakModel.W, BreakModel.H) is not { } fp) continue;
                if (showPrints.Any(sp => AdPrints.Distance(sp, fp) <= AdPrints.MatchBits)) { guarded++; continue; }
                if (Environment.GetEnvironmentVariable("SEEDPRINTS") == "0") continue;
                lib.Learn(fp, clip, (float)(Sec9(n!) - t0)); frames++;
            }
            var ws = new List<uint>();
            foreach (var (at, hex) in afp)
            {
                // the sound trimmed at the edges (2026-11-04: sound seeded from whole spans made covers linger, wrongly covered 1.18% against
                // 1.09%; a look's words reach back a second or more, and a span's last seconds run into the show): SOUNDTRIM="head,tail" seconds
                var at9 = Sec9(at); if (at9 < Sec9(a) + trimHead || at9 > Sec9(z) - trimTail) continue;
                if (string.CompareOrdinal(at, a) < 0 || string.CompareOrdinal(at, z) >= 0) continue;
                for (var k = 0; k + 8 <= hex.Length; k += 8)
                    if (uint.TryParse(hex.AsSpan(k, 8), System.Globalization.NumberStyles.HexNumber, null, out var w)) ws.Add(w);
            }
            // the show-time guard: every block (64 words, a step of 16) heard in this window's show is taken out, and the runs between are kept
            var heardInShow = new bool[ws.Count];
            if (showSounds.Count > 0)
                for (var i = 0; i + 64 <= ws.Count; i += 16)
                {
                    var block = ws.GetRange(i, 64);
                    if (showSounds.Any(b => b.Heard(block))) for (var k = i; k < i + 64; k++) heardInShow[k] = true;
                }
            var kept = new List<List<uint>>(); var cur = new List<uint>();
            for (var i = 0; i < ws.Count; i++) { if (heardInShow[i]) { soundGuarded++; if (cur.Count > 0) { kept.Add(cur); cur = new List<uint>(); } } else cur.Add(ws[i]); }
            if (cur.Count > 0) kept.Add(cur);
            // a stretch at a time, as the host keeps them: 1,600 words at most each
            foreach (var good in kept)
                for (var k = 0; k < good.Count; k += 1600) { var part = good.Skip(k).Take(1600).ToList(); if (part.Count >= 64 && Environment.GetEnvironmentVariable("SEEDSOUND") != "0") { snd.Learn(part); words += part.Count; } }
        }
    }
    lib.Save(); snd.Save();
    Console.WriteLine($"{spans} ad spans: {frames} frames -> prints {p0} -> {lib.Count} ({guarded} kept out by the show-time guard); {words} sound words -> stretches {s0} -> {snd.Count} ({soundGuarded} words kept out by the sound's show-time guard)");
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
// What the model reads under Veil's own cover (COVERSIGHT, 2026-11-06): the logo's corner left open, or a see-through cover subtracted.
static byte[] UnderCover(byte[] g, BreakModel m, string sight, byte[] art, Random rng)
{
    var o = new byte[g.Length];
    // art (2026-11-06): an opaque veil, its picture held still; the model reads only that, the captions and the time
    if (sight == "art") { Array.Copy(art, o, o.Length); return o; }
    if (sight == "corner")
    {
        Array.Copy(art, o, o.Length);
        var f = typeof(BreakModel).GetField("_corner", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        var c = m.HasLogo && f is not null ? (int)f.GetValue(m)! : -1;
        if (c >= 0)
        {
            int y0 = c >= 2 ? 135 : 0, x0 = c % 2 == 1 ? 240 : 0;
            for (var y = y0; y < y0 + 45; y++) Array.Copy(g, y * BreakModel.W + x0, o, y * BreakModel.W + x0, 80);
        }
        return o;
    }
    var p = sight.Split(':');
    var a = double.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture);
    var noise = p.Length > 2 ? double.Parse(p[2], System.Globalization.CultureInfo.InvariantCulture) : 0;
    for (var i = 0; i < g.Length; i++)
    {
        var n = 0.0;
        if (noise > 0) { var u1 = 1.0 - rng.NextDouble(); var u2 = rng.NextDouble(); n = Math.Sqrt(-2 * Math.Log(u1)) * Math.Cos(2 * Math.PI * u2) * noise; }
        var obs = Math.Clamp(Math.Round(a * art[i] + (1 - a) * g[i] + n), 0, 255);
        o[i] = (byte)Math.Clamp(Math.Round((obs - a * art[i]) / (1 - a)), 0, 255);
    }
    return o;
}
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
