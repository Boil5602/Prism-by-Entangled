using System;
using System.Collections.Generic;
using System.Numerics;

namespace PrismHost;

/// <summary>
/// How far one page plays behind another on the same channel, from their sound (the look-ahead, docs/features/look-ahead.md,
/// 2026-11-17). Two pages of one service count time from different starts, so their clocks cannot be compared; what they play can.
/// Each page's meter already makes a 32-bit word of its sound every 50 ms (the break watch's sound fingerprint). The words of the
/// page that is ahead are kept for a while; the words of the page that is behind are laid over them at every lag in turn, and the
/// lag where the fewest bits differ is how far behind it is. An answer is given only when one lag stands clear of the rest: silence,
/// or two pages playing different advertisements, give none.
/// Times are seconds on the caller's one clock; a batch of words ends at the time it was read.
/// </summary>
public sealed class LagFinder
{
    public const double Hop = 0.05;
    private const int AheadKept = 2400;    // two minutes of the page that is ahead
    private const int BehindKept = 400;    // twenty seconds of the page that is behind

    private readonly Dictionary<long, uint> _ahead = new();
    private readonly Queue<long> _aheadOrder = new();
    private readonly List<(double T, uint W)> _behind = new();

    private static long Slot(double t) => (long)Math.Round(t / Hop);

    /// <summary>Words read from the page at the live edge, the last of them made at <paramref name="t"/>.</summary>
    public void Ahead(double t, IReadOnlyList<uint> words)
    {
        for (var i = 0; i < words.Count; i++)
        {
            var slot = Slot(t - (words.Count - 1 - i) * Hop);
            if (_ahead.TryAdd(slot, words[i])) _aheadOrder.Enqueue(slot); else _ahead[slot] = words[i];
        }
        while (_aheadOrder.Count > AheadKept) _ahead.Remove(_aheadOrder.Dequeue());
    }

    /// <summary>Words read from the page that plays behind, the last of them made at <paramref name="t"/>.</summary>
    public void Behind(double t, IReadOnlyList<uint> words)
    {
        for (var i = 0; i < words.Count; i++) _behind.Add((t - (words.Count - 1 - i) * Hop, words[i]));
        if (_behind.Count > BehindKept) _behind.RemoveRange(0, _behind.Count - BehindKept);
    }

    public void Reset() { ResetAhead(); ResetBehind(); }
    /// <summary>The page at the live edge moved in its programme (a stall, a press): its words so far no longer line up with what follows.</summary>
    public void ResetAhead() { _ahead.Clear(); _aheadOrder.Clear(); }
    /// <summary>The page that plays behind moved in its programme: its words so far belong to another lag.</summary>
    public void ResetBehind() => _behind.Clear();

    /// <summary>The lag in seconds (positive: the second page is that far behind the first) with the share of bits that differ there,
    /// or null when no lag between <paramref name="min"/> and <paramref name="max"/> stands clear.</summary>
    public (double Lag, double Differ)? Find(double min, double max)
    {
        if (_behind.Count < 200) return null;
        // a page playing silence makes the same word over and over: nothing to line up
        var distinct = new HashSet<uint>(); foreach (var b in _behind) distinct.Add(b.W);
        if (distinct.Count < _behind.Count / 4) return null;
        int lo = (int)Math.Floor(min / Hop), hi = (int)Math.Ceiling(max / Hop);
        var differ = new double[hi - lo + 1];
        var best = -1;
        for (var l = lo; l <= hi; l++)
        {
            long bits = 0; var n = 0;
            foreach (var (t, w) in _behind)
                if (_ahead.TryGetValue(Slot(t) - l, out var a)) { bits += BitOperations.PopCount(a ^ w); n++; }
            differ[l - lo] = n >= 150 ? bits / (32.0 * n) : 1;
            if (differ[l - lo] < 1 && (best < 0 || differ[l - lo] < differ[best])) best = l - lo;
        }
        // two pages of one channel differ in about three bits of ten (read on YouTube TV, 2026-11-17); unrelated sound differs in five
        if (best < 0 || differ[best] > 0.42) return null;
        // the next best lag more than half a second away must be clearly worse
        var other = 1.0;
        for (var k = 0; k < differ.Length; k++) if (Math.Abs(k - best) > 10 && differ[k] < other) other = differ[k];
        if (other - differ[best] < 0.06) return null;
        // between the two neighbours, by their weights (the words are 50 ms apart; the truth lies between two of them)
        double lag = (best + lo) * Hop;
        if (best > 0 && best < differ.Length - 1)
        {
            double dl = differ[best - 1] - differ[best], dr = differ[best + 1] - differ[best];
            if (dl > 0 && dr > 0) lag += Hop * 0.5 * (dl - dr) / (dl + dr);
        }
        return (lag, differ[best]);
    }
}

/// <summary>
/// A measure by sound that jumps away from what the two pages' clocks say is not taken at once (2026-11-18). The same advertisement
/// can play on the two pages at different moments, and for its length the sound then lines up at a false lag (seen live: 48.0 s and
/// 29.9 s against a true 17.8 s, for 20 s and 45 s). A jump is taken only after it has stood for <see cref="Hold"/> seconds, longer
/// than one advertisement; a measure near the clocks drops the claim. Values are the lag with the clocks' movement taken out, so a
/// true lag stays one number while the pages play.
/// </summary>
public sealed class LagClaim
{
    public const double Hold = 60, Near = 0.5;
    private double _value = double.NaN, _since;

    /// <summary>A measure that jumped: true once the same value has stood for <see cref="Hold"/> seconds.</summary>
    public bool Jump(double value, double now)
    {
        if (double.IsNaN(_value) || Math.Abs(value - _value) > Near) { _value = value; _since = now; return false; }
        return now - _since >= Hold;
    }

    /// <summary>A measure near the clocks, or a new start: no claim stands.</summary>
    public void Drop() => _value = double.NaN;
}
