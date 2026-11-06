using System.Text.Json;
using PrismHost.Channel;
using PrismHost.Device;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// CS-4: what the host and core say to each other about §25 living previews
/// and concept-scenes §5 audio-follows-tap. The schema is generated from
/// core (Channel.g.cs); these pin the round trip the host actually makes.
/// </summary>
public sealed class ConceptScenesChannelTests
{
    [Fact]
    public void SetPeekIsAnM1CommandTheHostExecutes()
    {
        var msg = ChannelParser.Parse("{\"op\":\"surface.setPeek\",\"id\":\"game2\",\"peeking\":true}");
        Assert.NotNull(msg);
        Assert.Equal(Ops.SurfaceSetPeek, msg!.Op);
        Assert.Equal("game2", msg.GetString("id"));
        Assert.True(msg.GetBool("peeking"));
        Assert.Equal(CommandRoute.Execute, ChannelParser.Route(msg));
    }

    [Fact]
    public void ClosingThePeekBracketParsesAsFalseNotAsMissing()
    {
        var msg = ChannelParser.Parse("{\"op\":\"surface.setPeek\",\"id\":\"game2\",\"peeking\":false}")!;
        Assert.False(msg.GetBool("peeking"));
        // and a malformed payload defaults to "not peeking" rather than trapping a surface mid-peek
        Assert.False(ChannelParser.Parse("{\"op\":\"surface.setPeek\",\"id\":\"game2\"}")!.GetBool("peeking"));
    }

    [Fact]
    public void TapResultCarriesTheWholeVerdict()
    {
        var msg = ChannelParser.Parse(
            "{\"op\":\"ui.tapResult\",\"id\":\"game3\",\"action\":\"audio\",\"did\":\"audio\",\"audio\":\"moved\",\"error\":null}")!;
        Assert.Equal(Ops.UiTapResult, msg.Op);
        Assert.Equal(CommandRoute.Execute, ChannelParser.Route(msg));
        Assert.Equal("game3", msg.GetString("id"));
        Assert.Equal("audio", msg.GetString("action"));
        Assert.Equal("audio", msg.GetString("did"));
        Assert.Equal("moved", msg.GetString("audio"));
        Assert.Null(msg.GetString("error"));          // JSON null is absent, not the string "null"
    }

    [Fact]
    public void TheHostAsksCoreWhatATapMeansAndNeverDecidesItself()
    {
        var json = ChannelParser.HostCallJson(HostCalls.TapItem, "game3");
        using var doc = JsonDocument.Parse(json);
        Assert.Equal("tapItem", doc.RootElement.GetProperty("fn").GetString());
        Assert.Equal("game3", doc.RootElement.GetProperty("args")[0].GetString());
    }
}

/// <summary>
/// win-host-spec §4 + dashboard-schema §18/§25: the device profile the host
/// reports at init. Only a MEASUREMENT crosses the seam - core decides what
/// to demote and when to peek.
/// </summary>
public sealed class DeviceBudgetTests
{
    const long GB = 1024L * 1024 * 1024;

    [Theory]
    [InlineData(64, 20)]    // 2026-09-24: the larger machines keep more pages live
    [InlineData(32, 12)]
    [InlineData(16, 7)]
    [InlineData(8, 4)]      // the N100 baseline
    [InlineData(4, 3)]
    public void MaxLiveTilesFollowsTheSpecTable(int gb, int expected) =>
        Assert.Equal(expected, DeviceBudget.MaxLiveTiles(gb * GB));

    [Fact]
    public void SlightlyUnderReportedRamStillCountsAsItsClass()
    {
        // Windows reports a little less than the installed sticks
        Assert.Equal(7, DeviceBudget.MaxLiveTiles((long)(15.7 * GB)));
        Assert.Equal(4, DeviceBudget.MaxLiveTiles((long)(7.8 * GB)));
    }

    [Fact]
    public void TheInitFragmentIsTheShapeCoreReads()
    {
        using var doc = JsonDocument.Parse(DeviceBudget.OptionsFragmentJson(16 * GB));
        Assert.Equal(7, doc.RootElement.GetProperty("maxLiveTiles").GetInt32());
        var budget = doc.RootElement.GetProperty("previewBudget");
        Assert.Equal(3, budget.GetProperty("maxPlayingVideo").GetInt32());     // §25 mini-PC decode cap
        Assert.Equal(30, budget.GetProperty("minPeekIntervalSec").GetInt32()); // §25 peek floor
    }

    [Fact]
    public void AnUnreadableMachineNeverGuessesHigh()
    {
        // the measurement itself never comes back as "no memory"
        Assert.True(DeviceBudget.PhysicalMemoryBytes() > 0);
        // and a nonsense reading lands on the smallest budget, never the largest
        Assert.Equal(3, DeviceBudget.MaxLiveTiles(0));
    }
}
