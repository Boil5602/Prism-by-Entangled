using PrismHost.Core;
using Xunit;
using static PrismHost.Core.WindowPlacement;

namespace PrismHost.Tests;

/// <summary>
/// The host restores its last window rect only where a person can reach it.
/// The case that motivated this (2026-09-02): the rect had been saved on a
/// monitor above the primary, that monitor was unplugged, and the window
/// came back at y = −1432 - running, answering the remote, unreachable.
/// </summary>
public sealed class WindowPlacementTests
{
    private static readonly Rect[] OnePrimary = { new(0, 0, 1920, 1080) };
    private static readonly Rect[] TwoStacked = { new(0, 0, 1920, 1080), new(1276, -1440, 1940, 1440) };

    [Fact]
    public void the_rect_that_hid_the_window_is_refused_on_the_single_display()
    {
        Assert.False(IsReachable(new Rect(1276, -1432, 1940, 1100), OnePrimary));
    }

    [Fact]
    public void the_same_rect_is_fine_while_that_monitor_is_connected()
    {
        Assert.True(IsReachable(new Rect(1276, -1432, 1940, 1100), TwoStacked));
    }

    [Fact]
    public void a_rect_on_the_primary_is_reachable()
    {
        Assert.True(IsReachable(new Rect(100, 50, 1600, 900), OnePrimary));
        Assert.True(IsReachable(new Rect(0, 0, 1920, 1040), OnePrimary));
    }

    [Fact]
    public void mostly_off_screen_needs_a_real_corner_on_screen()
    {
        // 150 px visible in x: not enough to grab
        Assert.False(IsReachable(new Rect(1770, 100, 1200, 800), OnePrimary));
        // 200 px visible in both axes: enough
        Assert.True(IsReachable(new Rect(1720, 880, 1200, 800), OnePrimary));
        // wide enough but only a sliver tall
        Assert.False(IsReachable(new Rect(100, 1000, 1200, 800), OnePrimary));
    }

    [Fact]
    public void the_minimized_sentinel_and_degenerate_rects_are_never_placements()
    {
        Assert.False(IsReachable(new Rect(-32000, -32000, 600, 400), OnePrimary));
        Assert.False(IsReachable(new Rect(100, 100, 0, 400), OnePrimary));
        Assert.True(IsMinimizedSentinel(-32000, -32000));
        Assert.False(IsMinimizedSentinel(-1432, 0));   // a disconnected monitor is not the sentinel - that was the gap
    }

    [Fact]
    public void no_displays_means_nothing_is_reachable()
    {
        Assert.False(IsReachable(new Rect(0, 0, 800, 600), Array.Empty<Rect>()));
    }
}
