using PrismHost.Services;
using System.Globalization;
// bwtest's bench mode (scripts/breakwatch/bwtest/Program.cs), its readings written round-trip: bwparity <from> <to> <feat.csv> <lpar.csv>,
// with BENCHROOT, BWDIR, LMODEL, BANDLOGO, BANDSTRICT, NOTEXT, NOCC, NOSOUND, CATALOG as the bench reads them. Only the replay and the
// two outputs; the bench's trials (HALF, HEARD, CCBLIND, BWTITLE, ...) are left out. Read-only on the recordings.
static bool NoTextEvt(string e) =>
    (Environment.GetEnvironmentVariable("NOTEXT") == "1" && (e.StartsWith("text ") || e == "qr")) ||
    (Environment.GetEnvironmentVariable("NOCC") == "1" && e.StartsWith("cc ")) ||
    (Environment.GetEnvironmentVariable("NOSOUND") == "1" && (e.StartsWith("level ") || e.StartsWith("silence ") || e.StartsWith("afp ")));
// bwparity exp <in> <out>: Math.Exp of each line's number, round-trip (how .NET's exp rounds, against the port's)
if (args.Length == 3 && args[0] == "exp")
{
    File.WriteAllLines(args[2], File.ReadAllLines(args[1]).Select(l => Math.Exp(double.Parse(l, CultureInfo.InvariantCulture)).ToString("R", CultureInfo.InvariantCulture)));
    return;
}
if (args.Length < 4) { Console.WriteLine("bwparity <from> <to> <feat.csv> <lpar.csv>"); return; }
if (Environment.GetEnvironmentVariable("BANDLOGO") is "0" or "1") BreakModel.BandLogo = Environment.GetEnvironmentVariable("BANDLOGO") == "1";
if (Environment.GetEnvironmentVariable("BANDSTRICT") is "0" or "1") BreakModel.BandStrict = Environment.GetEnvironmentVariable("BANDSTRICT") == "1";
var inv = CultureInfo.InvariantCulture;
var bench = Environment.GetEnvironmentVariable("BENCHROOT")!;
var bwdir = Environment.GetEnvironmentVariable("BWDIR")!;
var lib = new AdPrints(Path.Combine(bwdir, "prints.bin"), Environment.GetEnvironmentVariable("CATALOG"));
var snd = new AdSounds(Path.Combine(bwdir, "sounds.bin"));
string from = args[0], to = args[1];
static double Sec(string hms) => int.Parse(hms[..2]) * 3600 + int.Parse(hms[2..4]) * 60 + int.Parse(hms[4..6]) + (hms.Length >= 9 ? int.Parse(hms[6..9]) / 1000.0 : 0);
using var feat = new StreamWriter(args[2]);
using var lpar = new StreamWriter(args[3]);
var learned = LearnedBreak.Load(Environment.GetEnvironmentVariable("LMODEL")!)!;
feat.WriteLine("win,t," + string.Join(",", BreakModel.FeatureNames) + ",print_seen");
lpar.WriteLine("win,t,p");
foreach (var dir in Directory.GetDirectories(bench))
{
    var win = Path.GetFileName(dir);
    var items = new List<(string at, string? frame, string? evt)>();
    foreach (var f in Directory.GetFiles(dir, "*.gray")) { var n = Path.GetFileNameWithoutExtension(f); if (string.CompareOrdinal(n, from) >= 0 && string.CompareOrdinal(n, to) < 0) items.Add((n, f, null)); }
    var ev = Path.Combine(dir, "events.log");
    string? chan = null, firstAt = null;
    if (File.Exists(ev))
        foreach (var line in File.ReadLines(ev)) { var sp = line.Split(' ', 3); if (sp.Length == 3 && sp[2].StartsWith("cueat ")) { firstAt = sp[0]; break; } }
    if (File.Exists(ev))
        foreach (var line in File.ReadAllLines(ev))
        {
            var sp = line.Split(' ', 3); if (sp.Length < 3) continue;
            if (sp[2].StartsWith("channel ")) { if (string.CompareOrdinal(sp[0], from) < 0) chan = sp[2][8..].Trim(); }
            if (string.CompareOrdinal(sp[0], from) >= 0 && string.CompareOrdinal(sp[0], to) < 0 && !NoTextEvt(sp[2])) items.Add((sp[0], null, sp[2]));
            if (sp[2].StartsWith("cue ") && (firstAt is null || string.CompareOrdinal(sp[0], firstAt) < 0))
            {
                var ms = Math.Min((long)(Sec(sp[0]) * 1000), 86399999L);
                var key = (ms / 3600000).ToString("00") + (ms / 60000 % 60).ToString("00") + (ms / 1000 % 60).ToString("00") + (ms % 1000).ToString("000");
                if (string.CompareOrdinal(key, from) >= 0 && string.CompareOrdinal(key, to) < 0) items.Add((key, null, "cueat " + sp[2][4..]));
            }
        }
    items = items.OrderBy(x => x.at, StringComparer.Ordinal).ThenBy(x => x.frame is null ? 0 : 1).ToList();
    BreakModel? m = chan is null ? null : BreakModel.Load(Path.Combine(bwdir, chan + ".logo"));
    double last = 0; var name = ""; var sound = new List<uint>();
    var lst = learned.NewState();
    foreach (var (at, frame, evt) in items)
    {
        var t = Sec(at);
        if (evt is not null)
        {
            if (evt.StartsWith("channel ")) { chan = evt[8..].Trim(); m = BreakModel.Load(Path.Combine(bwdir, chan + ".logo")); last = 0; continue; }
            if (m is null) continue;
            if (evt.StartsWith("text ")) m.Text(evt[5..], t);
            else if (evt.StartsWith("cc ")) { learned.Caption(lst, evt[3..], t); m.Captions(evt[3..], 0, t); m.Text(evt[3..], t, spoken: true); }
            else if (evt == "qr") m.QrSeen(t);
            else if (evt.StartsWith("edge ")) { var p = evt.Split(' ', 3); m.NearEdge = p[1] == "1"; m.EdgeKnown = true; name = p.Length > 2 ? p[2] : ""; m.ChannelName = name; m.AdFreeChannel = System.Text.RegularExpressions.Regex.IsMatch(name, @"^(C-SPAN\d?|PBS( Kids)?|PBS .*)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase); }
            else if (evt == "notanad") m.Dismiss(t);
            else if (evt.StartsWith("cueat ")) { var c = evt.Split(' '); if (c.Length >= 4) m.CueSeen(c[1], double.Parse(c[2], inv), double.Parse(c[3], inv), t); }
            else if (evt.StartsWith("cue ")) { var c = evt.Split(' '); if (c.Length >= 4) m.CueRead(c[1], double.Parse(c[2], inv), double.Parse(c[3], inv), t); }
            else if (evt.StartsWith("level "))
            {
                var lv = evt.Split(' ');
                if (lv.Length >= 2 && double.TryParse(lv[1], NumberStyles.Float, inv, out var ldb))
                    m.Level(ldb, lv.Length >= 3 && double.TryParse(lv[2], NumberStyles.Float, inv, out var lpk) ? lpk : ldb, t);
            }
            else if (evt.StartsWith("silence ")) { if (double.TryParse(evt.AsSpan(8), NumberStyles.Float, inv, out var sago)) m.Silence(t - sago); }
            else if (evt.StartsWith("afp "))
            {
                var hex = evt[4..].Trim();
                for (var k = 0; k + 8 <= hex.Length; k += 8) if (uint.TryParse(hex.AsSpan(k, 8), NumberStyles.HexNumber, null, out var w)) sound.Add(w);
                if (sound.Count > 400) sound.RemoveRange(0, sound.Count - 400);
                if (snd.Heard(sound)) m.SoundSeen(t);
            }
            continue;
        }
        if (m is null || frame is null) continue;
        var g = File.ReadAllBytes(frame); if (g.Length != BreakModel.W * BreakModel.H) continue;
        var seenNow = AdPrints.Of(g, BreakModel.W, BreakModel.H) is { } fp && lib.Seen(fp);
        if (seenNow) m.PrintSeen(t);
        m.Step(g, t, last > 0 ? Math.Clamp(t - last, 0.5, 6) : 1);
        var lp = learned.Score(lst, m.Features(t), seenNow ? 1 : 0, t);
        learned.Decide(lst, lp, t, m.LogoInBand);
        lpar.WriteLine(win + "," + t.ToString("R", inv) + "," + lp.ToString("R", inv));
        feat.WriteLine(win + "," + t.ToString("R", inv) + "," + string.Join(",", m.Features(t).Select(x => x.ToString("R", inv))) + "," + (seenNow ? 1 : 0));
        last = t;
    }
}
