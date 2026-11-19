using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace PrismHost;

/// <summary>
/// The look-ahead's end finder (docs/features/look-ahead.md, 2026-11-17): the reading that looks both ways. One question, asked of a
/// look at the live page once the looks after it are in hand: is the show back at that look?
///
/// The live watch can only use what came before a moment. The look-ahead holds the big screen some seconds behind, so for a moment it
/// is about to show it also has what came after. The inputs are the break model's own readings (BreakModel.Features) at the look and
/// at the looks <c>offsets</c> before and after it, the time to each of those looks, and the change of a few readings from the five
/// looks before to the five after. Trained trees (scripts/breakwatch/endfinder.py --export) give the chance; this class reproduces
/// that script's inputs exactly (scripts/breakwatch/bwtest, ENDMODEL, is the parity check).
///
/// A look is scored once the latest look it needs has been made, so its answer comes a few looks late. That is the whole point.
/// </summary>
public sealed class EndFinder
{
    private sealed record Tree(int[] F, double[] Thr, int[] L, int[] R, bool[] Leaf, double[] V);

    private readonly int[] _use;          // which of the readings are inputs, by their place in the readings
    private readonly bool[] _since;       // which of those count seconds since something (clipped)
    private readonly int[] _offsets;
    private readonly int[] _delta;        // the readings whose change is an input, by their place in the readings
    private readonly double _clip, _base;
    private readonly Tree[] _trees;
    private readonly int _ahead, _behind;

    /// <summary>The chance over which a look says the show is back.</summary>
    public double Min { get; }
    public int Trained { get; }

    private EndFinder(JsonElement r, IReadOnlyList<string> readings)
    {
        int At(string n) { for (var i = 0; i < readings.Count; i++) if (readings[i] == n) return i; throw new InvalidDataException("the end finder names a reading the break model does not have: " + n); }
        var use = r.GetProperty("use").EnumerateArray().Select(x => x.GetString()!).ToArray();
        _use = use.Select(At).ToArray();
        _since = use.Select(n => n.StartsWith("since_", StringComparison.Ordinal)).ToArray();
        _offsets = r.GetProperty("offsets").EnumerateArray().Select(x => x.GetInt32()).ToArray();
        _delta = r.GetProperty("delta").EnumerateArray().Select(x => At(x.GetString()!)).ToArray();
        _clip = r.GetProperty("clip").GetDouble();
        _base = r.GetProperty("baseline").GetDouble();
        Min = r.GetProperty("min").GetDouble();
        Trained = r.TryGetProperty("trained", out var tr) ? tr.GetInt32() : 0;
        _trees = r.GetProperty("trees").EnumerateArray().Select(t => new Tree(
            t.GetProperty("f").EnumerateArray().Select(x => x.GetInt32()).ToArray(),
            t.GetProperty("thr").EnumerateArray().Select(x => x.GetDouble()).ToArray(),
            t.GetProperty("l").EnumerateArray().Select(x => x.GetInt32()).ToArray(),
            t.GetProperty("r").EnumerateArray().Select(x => x.GetInt32()).ToArray(),
            t.GetProperty("leaf").EnumerateArray().Select(x => x.GetInt32() != 0).ToArray(),
            t.GetProperty("v").EnumerateArray().Select(x => x.GetDouble()).ToArray())).ToArray();
        _ahead = Math.Max(5, _offsets.Max()); _behind = Math.Max(5, -_offsets.Min());
    }

    /// <summary>The model at <paramref name="path"/>, or null when it is not there or is not one this build can read.
    /// <paramref name="readings"/> are the names of the break model's readings, in their order.</summary>
    public static EndFinder? Load(string path, IReadOnlyList<string> readings)
    {
        try { using var doc = JsonDocument.Parse(File.ReadAllText(path)); return new EndFinder(doc.RootElement, readings); }
        catch { return null; }
    }

    /// <summary>One page's looks.</summary>
    public sealed class State
    {
        internal readonly List<(double T, double[] R)> Rows = new();
        internal int Next;        // the first look not yet scored
        internal bool First = true;
    }

    public State NewState() => new();

    /// <summary>A look at the page: its time and the break model's readings after it. Returns the looks that can now be scored, each
    /// with the chance that the show was back at it (none for the first looks, then one a look).</summary>
    public List<(double T, double Q)> Look(State s, double t, double[] readings)
    {
        // the readings as the training read them: three decimals, the time in milliseconds
        var row = new double[readings.Length];
        for (var i = 0; i < row.Length; i++) row[i] = Math.Round(readings[i], 3, MidpointRounding.AwayFromZero);
        s.Rows.Add((Math.Round(t, 3, MidpointRounding.AwayFromZero), row));
        var done = new List<(double, double)>();
        while (s.Next + _ahead < s.Rows.Count)
        {
            done.Add((s.Rows[s.Next].T, Score(s, s.Next)));
            s.Next++;
        }
        // only the looks a later score can reach are kept
        var drop = s.Next - _behind - 1;
        if (drop > 64) { s.Rows.RemoveRange(0, drop); s.Next -= drop; s.First = false; }
        return done;
    }

    private double Score(State s, int i)
    {
        var rows = s.Rows; var n = rows.Count;
        var x = new double[_offsets.Length * (_use.Length + 1) + _delta.Length];
        var c = 0;
        foreach (var k in _offsets)
        {
            var j = Math.Clamp(i + k, 0, n - 1);
            var r = rows[j].R;
            for (var u = 0; u < _use.Length; u++) x[c++] = _since[u] ? Math.Min(r[_use[u]], _clip) : r[_use[u]];
            x[c++] = rows[j].T - rows[i].T;
        }
        foreach (var d in _delta)
        {
            double after = 0, before = 0;
            for (var j = i + 1; j <= i + 5 && j < n; j++) after += rows[j].R[d];
            for (var j = Math.Max(0, i - 5); j < i; j++) before += rows[j].R[d];
            x[c++] = after / 5 - before / 5;
        }
        var z = _base;
        foreach (var tr in _trees)
        {
            var k = 0;
            while (!tr.Leaf[k]) k = x[tr.F[k]] <= tr.Thr[k] ? tr.L[k] : tr.R[k];
            z += tr.V[k];
        }
        return 1 / (1 + Math.Exp(-z));
    }
}
