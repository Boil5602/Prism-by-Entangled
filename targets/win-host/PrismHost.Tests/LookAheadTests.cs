using PrismHost;
using Xunit;

namespace PrismHost.Tests;

/// <summary>The look-ahead's covers and its measure of the delay (docs/features/look-ahead.md).</summary>
public class LookAheadTests
{
    /// <summary>A look a second from 0 to 199: the chance climbs from 60 s, the watch calls the break at 66 s; the chance falls at
    /// 120 s and the watch lifts the cover at 126 s.</summary>
    private static LookAheadPlan OneBreak()
    {
        var plan = new LookAheadPlan();
        for (var t = 0; t < 200; t++)
        {
            var p = t < 60 ? 0.05 : t < 120 ? 0.9 : 0.1;
            plan.Look(t, p, covered: t >= 66 && t < 126);
        }
        return plan;
    }

    [Fact]
    public void With_no_seconds_in_hand_the_cover_is_the_watchs_own()
    {
        var plan = OneBreak();
        Assert.False(plan.CoverAt(65, 65));
        Assert.True(plan.CoverAt(66, 66));
        Assert.True(plan.CoverAt(125, 125));
        Assert.False(plan.CoverAt(126, 126));
    }

    [Fact]
    public void With_thirty_seconds_in_hand_the_cover_begins_where_the_chance_rose()
    {
        var plan = OneBreak();
        Assert.False(plan.CoverAt(59, 89));
        Assert.True(plan.CoverAt(60, 90));     // six seconds before the watch called it
        Assert.True(plan.CoverAt(125, 155));
        Assert.False(plan.CoverAt(126, 156));  // the end stays where the watch lifted it
    }

    [Fact]
    public void The_start_moves_back_no_further_than_the_seconds_in_hand_allow()
    {
        // four in hand: the watch called the break at 66, so the cover may begin at 62
        var plan = OneBreak();
        Assert.False(plan.CoverAt(61, 65));
        Assert.True(plan.CoverAt(62, 66));
        // and the end stays where the watch lifted it
        Assert.True(plan.CoverAt(125, 129));
        Assert.False(plan.CoverAt(126, 130));
    }

    [Fact]
    public void With_few_seconds_in_hand_a_short_cover_shows_until_its_end_is_known()
    {
        var plan = new LookAheadPlan();
        for (var t = 0; t < 100; t++) plan.Look(t, t >= 40 && t < 48 ? 0.8 : 0.1, covered: t >= 40 && t < 48);
        Assert.True(plan.CoverAt(40, 45));    // five in hand: the watch still has it up
        Assert.True(plan.CoverAt(42, 47));
        Assert.False(plan.CoverAt(43, 48));   // the watch lifted it at 48: known short, down three seconds in
    }

    [Fact]
    public void A_cover_lifted_again_within_fifteen_seconds_is_never_shown()
    {
        var plan = new LookAheadPlan();
        for (var t = 0; t < 100; t++) plan.Look(t, t >= 40 && t < 48 ? 0.8 : 0.1, covered: t >= 40 && t < 48);
        for (var tau = 30; tau < 60; tau++) Assert.False(plan.CoverAt(tau, tau + 30));
        // live, the watch's own short cover stands as it did
        Assert.True(plan.CoverAt(42, 42));
    }

    [Fact]
    public void A_sure_cover_is_shown_however_short_and_keeps_its_end()
    {
        var plan = new LookAheadPlan();
        // the service's own marked slot, ten seconds: the chance stays low all through it
        for (var t = 0; t < 100; t++) plan.Look(t, 0.1, covered: t >= 40 && t < 50, sure: t >= 40 && t < 50);
        Assert.False(plan.CoverAt(39, 69));
        Assert.True(plan.CoverAt(40, 70));
        Assert.True(plan.CoverAt(49, 79));
        Assert.False(plan.CoverAt(50, 80));
    }

    [Fact]
    public void A_cover_still_up_is_shown_from_its_moved_start()
    {
        var plan = new LookAheadPlan();
        for (var t = 0; t <= 100; t++) plan.Look(t, t >= 60 ? 0.9 : 0.05, covered: t >= 66);
        Assert.False(plan.CoverAt(59, 89));
        Assert.True(plan.CoverAt(60, 90));
        Assert.True(plan.CoverAt(70, 100));
    }

    [Fact]
    public void A_black_frame_before_the_lift_is_where_the_cover_ends()
    {
        // the show came back on a black frame at 120; the watch lifted at 126
        var plan = new LookAheadPlan();
        for (var t = 0; t < 200; t++) plan.Look(t, t >= 60 && t < 126 ? 0.9 : 0.1, covered: t >= 66 && t < 126, blackAt: t >= 120 ? 120 : t >= 90 ? 90 : double.NaN);
        Assert.True(plan.CoverAt(120, 135));
        Assert.False(plan.CoverAt(121, 136));   // the black frame plus a second
        Assert.True(plan.CoverAt(95, 110));     // a black frame between two advertisements moves nothing
        // with three seconds in hand the black frame is out of reach: the end stays
        Assert.True(plan.CoverAt(125, 128));
        // a sure cover keeps its end
        var sure = new LookAheadPlan();
        for (var t = 0; t < 200; t++) sure.Look(t, 0.1, covered: t >= 66 && t < 126, sure: true, blackAt: t >= 120 ? 120 : double.NaN);
        Assert.True(sure.CoverAt(125, 140));
    }

    [Fact]
    public void With_no_black_frame_the_end_finder_says_where_the_cover_ends()
    {
        // the show came back at 120 with no black frame; the watch lifted at 126; the end finder's answers come five looks late
        LookAheadPlan Made(double min, int known)
        {
            var plan = new LookAheadPlan { EndMin = min };
            for (var t = 0; t < 200; t++)
            {
                plan.Look(t, t >= 60 && t < 126 ? 0.9 : 0.1, covered: t >= 66 && t < 126);
                if (t - 5 >= 0 && t - 5 <= known) plan.Back(t - 5, t - 5 >= 120 ? 0.9 : t - 5 == 110 ? 0.95 : 0.1);
            }
            return plan;
        }
        var plan = Made(0.7, 199);
        Assert.True(plan.CoverAt(120, 135));
        Assert.False(plan.CoverAt(121, 136));   // the first look that said so, plus a second
        Assert.True(plan.CoverAt(111, 126));    // one look in the break that said so moves nothing
        Assert.Equal(new LookAheadPlan.Cover(66, 126, 60, 121, "finder"), plan.LastLifted(15, 199));
        Assert.Equal("", Made(double.NaN, 199).LastLifted(15, 199)!.Value.End);
        // the answers for the looks just before the lift are not in yet: the end stays
        Assert.True(Made(0.7, 123).CoverAt(125, 140));
        // without the end finder the end stays
        Assert.True(Made(double.NaN, 199).CoverAt(125, 140));
    }

    [Fact]
    public void A_long_cover_keeps_its_start_when_old_looks_are_dropped()
    {
        var plan = new LookAheadPlan();
        for (var t = 0; t < 1000; t++) plan.Look(t, 0.9, covered: t >= 10, sure: t >= 10);
        Assert.True(plan.CoverAt(970, 999));
        Assert.True(plan.Count < 1000);
    }

    private static uint Word(Random r) => (uint)r.Next() ^ ((uint)r.Next() << 16);

    /// <summary>One stream of sound words, read by a page at the live edge and by a page <paramref name="lag"/> seconds behind it with
    /// some of its bits heard differently; a batch a second for <paramref name="seconds"/>.</summary>
    private static LagFinder Two(double lag, int seconds, double flip, Func<int, uint>? aheadWord = null, Func<int, uint>? behindWord = null)
    {
        var r = new Random(7);
        var stream = new uint[(seconds + 120) * 20];
        for (var i = 0; i < stream.Length; i++) stream[i] = Word(r);
        var f = new LagFinder();
        var back = (int)Math.Round(lag / LagFinder.Hop);
        for (var s = 100; s < 100 + seconds; s++)
        {
            var a = new List<uint>(); var b = new List<uint>();
            for (var k = 0; k < 20; k++)
            {
                var i = s * 20 + k;
                a.Add(aheadWord?.Invoke(i) ?? stream[i]);
                var w = behindWord?.Invoke(i) ?? stream[i - back];
                for (var bit = 0; bit < 32; bit++) if (r.NextDouble() < flip) w ^= 1u << bit;
                b.Add(w);
            }
            // each batch ends at the time of its last word
            f.Ahead(s + 19 * LagFinder.Hop, a);
            f.Behind(s + 19 * LagFinder.Hop, b);
        }
        return f;
    }

    [Theory]
    [InlineData(30.0)]
    [InlineData(27.35)]
    [InlineData(2.5)]
    [InlineData(-3.0)]
    public void The_lag_between_two_pages_is_found_from_their_sound(double lag)
    {
        var found = Two(lag, 90, 0.12).Find(-20, 75);
        Assert.NotNull(found);
        Assert.InRange(found!.Value.Lag, lag - 0.06, lag + 0.06);
        Assert.InRange(found.Value.Differ, 0.05, 0.3);
    }

    [Fact]
    public void Silence_gives_no_lag()
    {
        Assert.Null(Two(30, 90, 0, aheadWord: _ => 0x0F0F0F0F, behindWord: _ => 0x0F0F0F0F).Find(-20, 75));
    }

    [Fact]
    public void Two_pages_playing_different_things_give_no_lag()
    {
        var other = new Random(99);
        Assert.Null(Two(30, 90, 0, behindWord: _ => Word(other)).Find(-20, 75));
    }

    [Fact]
    public void Too_little_sound_gives_no_lag()
    {
        Assert.Null(Two(30, 5, 0.1).Find(-20, 75));
    }

    [Fact]
    public void A_jump_in_the_measure_waits_longer_than_one_advertisement()
    {
        var c = new LagClaim();
        Assert.False(c.Jump(48.0, 0));
        Assert.False(c.Jump(48.1, 20));     // the same advertisement on both pages: gone before the hold
        c.Drop();                           // a measure near the clocks again
        Assert.False(c.Jump(30.0, 100));
        Assert.False(c.Jump(30.2, 130));
        Assert.True(c.Jump(30.1, 161));     // stood a minute: taken
        Assert.False(c.Jump(12.0, 170));    // another value starts its own wait
    }
}
