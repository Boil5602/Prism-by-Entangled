using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PrismHost.Services;

/// <summary>
/// The learned break detector (2026-10-07, "Yes do it"): gradient-boosted trees trained on hand-marked hours of five channels
/// (scripts/breakwatch/export_model.py), scored on channels they never saw at 92% of ad time covered against the hand rules' 80%, with fewer
/// wrong covers. Each look, a window's <see cref="BreakModel"/> readings become the trees' inputs exactly as in training - each "seconds since"
/// as three recency kernels, the picture's and the logo's rolling means, and the caption classifier's view of the last 20 s - and the trees'
/// chance goes through the cover policy the training chose (up after two looks above 0.85, down below 0.55). The hand rules still run: they
/// produce the readings, and they decide alone when no model file is there.
/// </summary>
public sealed class LearnedBreak
{
    private sealed record Tree(int[] F, double[] Thr, int[] L, int[] R, bool[] Leaf, double[] V);

    private readonly string[] _inputs;
    private readonly HashSet<string> _skip;
    private readonly double[] _kernels;
    private readonly string[] _rollSignals;
    private readonly int[] _rollWindows;
    /// <summary>The rolling means are over the last w SECONDS, not the last w looks (models from 2026-10-08 on). The recordings a model is
    /// trained on are made a look a second; without Ad debug a quiet small window is looked at every two, and a mean over "the last five
    /// looks" spans ten seconds there - every household's small windows read differently from the training.</summary>
    private readonly bool _rollSeconds;
    private readonly double _base;
    private readonly Tree[] _trees;
    private readonly Dictionary<string, double> _capW;
    private readonly double _capB;
    private readonly double _on, _off;
    private readonly int _hold;
    /// <summary>Seconds the chance must stay below "off" before a cover lifts (0 = at once). Inside a break the chance dips for a few
    /// seconds on an ad that looks like a programme, and a cover that lifted at once came back moments later - the cover dropping in the
    /// middle of a break was 29% of the ad time missed on the first exams (2026-10-08).</summary>
    private readonly double _offHold;
    /// <summary>... but below this the cover lifts at once: a programme coming back sends the chance to almost nothing, where an ad that
    /// looks like a programme leaves it in between.</summary>
    private readonly double _offDeep;
    public int Trained { get; }

    private LearnedBreak(JsonElement r)
    {
        _inputs = r.GetProperty("inputs").EnumerateArray().Select(x => x.GetString()!).ToArray();
        _skip = r.GetProperty("skip").EnumerateArray().Select(x => x.GetString()!).ToHashSet();
        _kernels = r.GetProperty("kernels").EnumerateArray().Select(x => x.GetDouble()).ToArray();
        var rolls = r.GetProperty("rolls");
        _rollSignals = rolls.GetProperty("signals").EnumerateArray().Select(x => x.GetString()!).ToArray();
        _rollWindows = rolls.GetProperty("windows").EnumerateArray().Select(x => x.GetInt32()).ToArray();
        _rollSeconds = rolls.TryGetProperty("seconds", out var rs) && rs.ValueKind == JsonValueKind.True;
        _base = r.GetProperty("baseline").GetDouble();
        _trees = r.GetProperty("trees").EnumerateArray().Select(t => new Tree(
            t.GetProperty("f").EnumerateArray().Select(x => x.GetInt32()).ToArray(),
            t.GetProperty("thr").EnumerateArray().Select(x => x.GetDouble()).ToArray(),
            t.GetProperty("l").EnumerateArray().Select(x => x.GetInt32()).ToArray(),
            t.GetProperty("r").EnumerateArray().Select(x => x.GetInt32()).ToArray(),
            t.GetProperty("leaf").EnumerateArray().Select(x => x.GetInt32() != 0).ToArray(),
            t.GetProperty("v").EnumerateArray().Select(x => x.GetDouble()).ToArray())).ToArray();
        var cap = r.GetProperty("caption");
        _capB = cap.GetProperty("intercept").GetDouble();
        _capW = cap.GetProperty("weights").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetDouble(), StringComparer.Ordinal);
        var pol = r.GetProperty("policy");
        _on = pol.GetProperty("on").GetDouble(); _off = pol.GetProperty("off").GetDouble(); _hold = pol.GetProperty("hold").GetInt32();
        _offHold = pol.TryGetProperty("offHold", out var oh) && oh.ValueKind == JsonValueKind.Number ? oh.GetDouble() : 0;
        _offDeep = pol.TryGetProperty("offDeep", out var od) && od.ValueKind == JsonValueKind.Number ? od.GetDouble() : 0;
        Trained = r.TryGetProperty("trained", out var tr) ? tr.GetInt32() : 0;
    }

    public static LearnedBreak? Load(string path)
    {
        try { using var d = JsonDocument.Parse(File.ReadAllBytes(path)); return new LearnedBreak(d.RootElement); }
        catch { return null; }
    }

    /// <summary>One window's running state: the rolled signals' recent values, the caption lines of the last minute, the cover policy.</summary>
    public sealed class State
    {
        internal readonly Dictionary<string, List<double>> Hist = new();
        internal readonly Dictionary<string, List<(double T, double V)>> HistT = new();
        internal readonly List<(double T, double Score)> Caps = new();
        internal int Run;
        internal double BelowSince = -1;
        public bool Up { get; set; }
        public double LastP { get; internal set; }
    }

    public State NewState() => new();

    // ---- the caption classifier (bwfeatures.cap_tokens / CapModel) ----
    private static readonly Regex Word = new("[a-z0-9']+", RegexOptions.Compiled);
    private static readonly Regex UrlMark = new(@"[a-z0-9]\.(com|net|org)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex PhoneMark = new(@"\d{3}[-. ]\d{3}[-. ]\d{4}|1-8\d\d", RegexOptions.Compiled);
    private static readonly Regex TagMark = new(@"\[[^\]]+\]", RegexOptions.Compiled);

    public static HashSet<string> CapTokens(string x)
    {
        var words = Word.Matches(x.ToLowerInvariant()).Select(m => m.Value).Where(w => w.Length >= 2).ToList();
        var toks = new HashSet<string>(words, StringComparer.Ordinal);
        for (var i = 0; i + 1 < words.Count; i++) toks.Add(words[i] + " " + words[i + 1]);
        if (UrlMark.IsMatch(x)) toks.Add("_url");
        if (PhoneMark.IsMatch(x)) toks.Add("_phone");
        if (x.Contains(">>", StringComparison.Ordinal)) toks.Add("_speaker");
        if (x.Contains('?')) toks.Add("_question");
        if (TagMark.IsMatch(x)) toks.Add("_tag");
        return toks;
    }

    /// <summary>How much a caption line reads like an ad (0 to 1): the token weights over the line's known tokens, normalised as in training.</summary>
    public double CaptionScore(string line)
    {
        double sum = 0; var n = 0;
        foreach (var t in CapTokens(line))
        {
            if (_capW.TryGetValue(t, out var w)) { sum += w; n++; }
            else if (_vocabExtra.Contains(t)) n++;
        }
        var z = _capB + (n > 0 ? sum / Math.Sqrt(n) : 0);
        return 1 / (1 + Math.Exp(-z));
    }
    // tokens in the classifier's vocabulary whose weight rounded to nothing (they still count in a line's length); none at present
    private readonly HashSet<string> _vocabExtra = new(StringComparer.Ordinal);

    public void Caption(State s, string line, double t)
    {
        s.Caps.Add((t, CaptionScore(line)));
        while (s.Caps.Count > 0 && t - s.Caps[0].T > 60) s.Caps.RemoveAt(0);
    }

    /// <summary>The trees' chance of an ad at t, from the break model's readings (<see cref="BreakModel.FeatureNames"/> order, then print_seen).
    /// Readings are taken at three decimals, as training read them.</summary>
    public double Score(State s, double[] readings, double printSeen, double t)
    {
        var byName = new Dictionary<string, double>(StringComparer.Ordinal);
        for (var i = 0; i < BreakModel.FeatureNames.Length && i < readings.Length; i++) byName[BreakModel.FeatureNames[i]] = Math.Round(readings[i], 3, MidpointRounding.AwayFromZero);
        byName["print_seen"] = printSeen;
        var x = new List<double>(96);
        foreach (var n in _inputs)
        {
            if (_skip.Contains(n)) continue;
            var v = byName.TryGetValue(n, out var vv) ? vv : 0;
            if (n.StartsWith("since_", StringComparison.Ordinal)) foreach (var tau in _kernels) x.Add(Math.Exp(-v / tau));
            else x.Add(v);
        }
        var maxW = _rollWindows.Max();
        foreach (var sig in _rollSignals)
        {
            if (_rollSeconds)
            {
                // the mean of the readings later than t - w, this look's among them (bwfeatures.features, by_seconds)
                if (!s.HistT.TryGetValue(sig, out var ht)) s.HistT[sig] = ht = new List<(double T, double V)>();
                ht.Add((t, byName.TryGetValue(sig, out var tv) ? tv : 0));
                while (ht.Count > 0 && ht[0].T <= t - maxW) ht.RemoveAt(0);
                foreach (var w in _rollWindows)
                {
                    double sum = 0; var cnt = 0;
                    for (var k = ht.Count - 1; k >= 0 && ht[k].T > t - w; k--) { sum += ht[k].V; cnt++; }
                    x.Add(sum / Math.Max(1, cnt));
                }
                continue;
            }
            if (!s.Hist.TryGetValue(sig, out var h)) s.Hist[sig] = h = new List<double>();
            h.Add(byName.TryGetValue(sig, out var sv) ? sv : 0);
            if (h.Count > maxW) h.RemoveAt(0);
            foreach (var w in _rollWindows)
            {
                double sum = 0;
                for (var k = Math.Max(0, h.Count - w); k < h.Count; k++) sum += h[k];
                x.Add(sum / w);   // the first rows of a window count the missing as nothing, as np.convolve did
            }
        }
        // the captions' view: mean ad-ness over the last 8 and 20 s, lines in the last 20 s, seconds since the last line
        double M(double w) { var l = s.Caps.Where(c => c.T >= t - w && c.T <= t).ToList(); return l.Count > 0 ? l.Average(c => c.Score) : 0.5; }
        x.Add(M(8)); x.Add(M(20));
        x.Add(s.Caps.Count(c => c.T >= t - 20 && c.T <= t));
        var last = s.Caps.Where(c => c.T <= t).Select(c => c.T).DefaultIfEmpty(double.NaN).Max();
        x.Add(double.IsNaN(last) ? 60 : Math.Min(60, t - last));
        var z = _base;
        foreach (var tr in _trees)
        {
            var k = 0;
            while (!tr.Leaf[k]) k = x[tr.F[k]] <= tr.Thr[k] ? tr.L[k] : tr.R[k];
            z += tr.V[k];
        }
        var p = 1 / (1 + Math.Exp(-z));
        s.LastP = p;
        return p;
    }

    /// <summary>The cover policy: up once the chance has been above "on" for "hold" looks, down when it falls below "off".</summary>
    public bool Decide(State s, double p, double t = double.NaN)
    {
        s.Run = p > _on ? s.Run + 1 : 0;
        if (!s.Up) { s.BelowSince = -1; if (s.Run >= _hold) s.Up = true; }
        else if (p >= _off) s.BelowSince = -1;
        else if (_offHold <= 0 || double.IsNaN(t) || p < _offDeep) { s.Up = false; s.BelowSince = -1; }
        else
        {
            if (s.BelowSince < 0) s.BelowSince = t;
            if (t - s.BelowSince >= _offHold) { s.Up = false; s.BelowSince = -1; }
        }
        return s.Up;
    }
}
