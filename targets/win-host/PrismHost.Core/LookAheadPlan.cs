using System;
using System.Collections.Generic;

namespace PrismHost;

/// <summary>
/// The look-ahead's covers (docs/features/look-ahead.md, 2026-11-17). The break watch reads a page at the live edge that nobody sees;
/// the big screen shows the same channel some seconds later. Every look at the live page is noted here with its time, its chance of a
/// break and whether the watch had a cover up, and the big screen asks: is the moment I am showing now inside a cover?
///
/// With the seconds in hand a cover is placed better than the watch could place it live (the rule the bench measured,
/// scripts/breakwatch/lookahead.py):
///  - its start moves back to where the chance first stood above <see cref="Rise"/> without a break before the watch called it;
///  - its end moves back to the first black frame in the <see cref="EndSearch"/> seconds before the watch lifted it, plus
///    <see cref="EndPad"/>: breaks end on one about half the time, and the watch lifts a few seconds after it (2026-11-17, the seven
///    exams: 96 s of show uncovered for 3 s of advertisements). With no black frame the end stays where the watch lifted it; moving
///    it to where the chance fell, to a silence or to a cut was measured and dropped. A sure cover keeps its end;
///  - with no black frame, the end moves back to the earliest look from which every look up to the lift says the show was back
///    (<see cref="EndFinder"/>, the reading that looks both ways; <see cref="EndMin"/>), plus <see cref="EndPad"/>;
///  - a cover the watch lifted again inside <see cref="MinCover"/> seconds is not shown once that is known (no commercial break is
///    that short), unless something sure called it (the service's own marked slot, a paid programme).
/// Each of the three uses whatever seconds are in hand: three seconds move a start back three, thirty move it back as far as it goes.
/// Nothing here guesses ahead: each answer uses only looks already made. Times are seconds on one clock, the caller's.
/// </summary>
public sealed class LookAheadPlan
{
    public const double Rise = 0.5, MinCover = 15, Keep = 240, EndSearch = 10, EndPad = 1;

    private readonly List<double> _blacks = new();   // when the live page showed a black frame
    private readonly List<(double T, double Q)> _back = new();   // a look's chance that the show was back at it (EndFinder), known a few looks late

    /// <summary>The chance over which a look says the show is back (the end finder's own setting); not a number = the end finder is not used.</summary>
    public double EndMin { get; set; } = double.NaN;

    /// <summary>The end finder's answer for an earlier look.</summary>
    public void Back(double t, double q)
    {
        if (_back.Count > 0 && t <= _back[^1].T) return;
        _back.Add((t, q));
        while (_back.Count > 0 && t - _back[0].T > Keep) _back.RemoveAt(0);
    }

    private readonly List<(double T, double P, bool Covered, bool Sure)> _looks = new();

    /// <summary>When the live page was last looked at, or a time long ago.</summary>
    public double LastLook => _looks.Count > 0 ? _looks[^1].T : -1e9;
    public int Count => _looks.Count;

    /// <summary>A look at the live page: when, the chance of a break (1 for a sure call), whether the watch has a cover up, whether
    /// what holds it is sure, and when the page last showed a black frame.</summary>
    public void Look(double t, double p, bool covered, bool sure = false, double blackAt = double.NaN)
    {
        if (_looks.Count > 0 && t <= _looks[^1].T) return;
        if (!double.IsNaN(blackAt) && t - blackAt < 30 && (_blacks.Count == 0 || blackAt - _blacks[^1] > 0.6)) _blacks.Add(blackAt);
        while (_blacks.Count > 0 && t - _blacks[0] > Keep) _blacks.RemoveAt(0);
        _looks.Add((t, sure && covered ? 1 : p, covered, sure && covered));
        var cut = 0;
        while (cut < _looks.Count && t - _looks[cut].T > Keep) cut++;
        // a cover that began before the cut keeps its first look, so its start is still known
        while (cut > 0 && _looks[cut].Covered && _looks[cut - 1].Covered) cut--;
        if (cut > 0) _looks.RemoveRange(0, cut);
    }

    /// <summary>Everything forgotten (the channel changed, or the person said a cover was no advertisement).</summary>
    public void Reset() { _looks.Clear(); _blacks.Clear(); _back.Clear(); }

    /// <summary>Is the moment <paramref name="tau"/> inside a cover, by what is known at <paramref name="now"/>? The seconds in hand are
    /// now - tau; with none in hand this is the watch's own cover at that moment.</summary>
    public bool CoverAt(double tau, double now)
    {
        foreach (var c in Placed(Math.Max(0, now - tau), now))
            if (tau >= c.From && tau < c.To) return true;
        return false;
    }

    /// <summary>One cover as the plan places it: where the watch called and lifted it, where the plan puts it, and what moved its end
    /// ("black" = a black frame, "finder" = the end finder, "" = nothing; "open" = not lifted yet).</summary>
    public readonly record struct Cover(double Called, double Lifted, double From, double To, string End);

    /// <summary>The last cover the watch has lifted, as the plan places it with <paramref name="inHand"/> seconds in hand; null when
    /// there is none (or the plan does not show it: lifted again at once).</summary>
    public Cover? LastLifted(double inHand, double now)
    {
        Cover? last = null;
        foreach (var c in Placed(Math.Max(0, inHand), now)) if (c.End != "open") last = c;
        return last;
    }

    private IEnumerable<Cover> Placed(double inHand, double now)
    {
        var startBack = inHand;
        var i = 0;
        while (i < _looks.Count)
        {
            if (!_looks[i].Covered) { i++; continue; }
            // one cover: looks [a, b), closed when a look after it exists
            int a = i, b = i;
            var sure = false;
            while (b < _looks.Count && _looks[b].Covered) { sure |= _looks[b].Sure; b++; }
            var closed = b < _looks.Count;
            double s = _looks[a].T, e = closed ? _looks[b].T : double.PositiveInfinity;
            i = b;
            if (s > now) yield break;
            if (closed && e > now) { closed = false; e = double.PositiveInfinity; }
            // lifted again at once: not shown from the moment that is known. With fifteen seconds or more in hand it is known before the
            // cover reaches the big screen, so it is never shown; with fewer, its first seconds show and it then comes down early
            if (closed && !sure && e - s < MinCover) continue;
            var s2 = s;
            for (var k = a - 1; k >= 0 && _looks[k].T >= s - startBack && _looks[k].P > Rise; k--) s2 = _looks[k].T;
            var e2 = e; var rule = closed ? "" : "open";
            if (closed && !sure)
            {
                var back = Math.Min(EndSearch, inHand);
                foreach (var bk in _blacks)
                    if (bk >= e - back && bk < e && bk > s + MinCover) { if (bk + EndPad < e) { e2 = bk + EndPad; rule = "black"; } break; }
                // no black frame: the earliest look from which every look up to the lift says the show was back. Used only once the
                // last look before the lift has its answer, so the end never moves after it has been shown
                if (e2 == e && !double.IsNaN(EndMin) && _back.Count > 0 && _back[^1].T >= _looks[b - 1].T)
                {
                    var c = double.NaN;
                    for (var k = _back.Count - 1; k >= 0; k--)
                    {
                        var (qt, qq) = _back[k];
                        if (qt >= e) continue;
                        if (qt < e - back || qt <= s + MinCover || qq < EndMin) break;
                        c = qt;
                    }
                    if (!double.IsNaN(c) && c + EndPad < e) { e2 = c + EndPad; rule = "finder"; }
                }
            }
            yield return new Cover(s, e, s2, e2, rule);
        }
    }
}
