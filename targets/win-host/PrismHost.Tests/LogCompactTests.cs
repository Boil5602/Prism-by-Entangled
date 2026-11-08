using System.Text.Json.Nodes;
using PrismHost.Diagnostics;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// host.log stays a log (2026-09-30: two gigabytes in thirteen hours, a page's channel guide in every report). The scalars a reader
/// looks for stay; the bulk is counted.
/// </summary>
public sealed class LogCompactTests
{
    [Fact]
    public void ALongArrayBecomesItsCountAndTheScalarsStay()
    {
        var live = string.Join(",", Enumerable.Range(0, 60).Select(i => $"{{\"id\":\"c{i}\",\"name\":\"Channel {i}\",\"logo\":\"https://x/{i}.png\"}}"));
        var json = "{\"type\":\"now-playing\",\"info\":{\"playing\":true,\"video\":{\"kind\":\"live\",\"title\":\"Are We There Yet?: S2 E21\",\"channel\":\"Are We There Yet?\",\"position\":null,\"adBreaks\":[1,2]},\"videoLive\":[" + live + "]}}";
        var out_ = LogCompact.Event(json);
        var o = JsonNode.Parse(out_)!.AsObject();
        Assert.Equal("now-playing", (string)o["type"]!);
        var v = o["info"]!["video"]!;
        Assert.Equal("live", (string)v["kind"]!);
        Assert.Equal("Are We There Yet?", (string)v["channel"]!);
        Assert.True((bool)o["info"]!["playing"]!);
        Assert.Equal(2, v["adBreaks"]!.AsArray().Count);            // a short array stays
        Assert.Equal("[60 items]", (string)o["info"]!["videoLive"]!);   // a long one is counted
        Assert.True(out_.Length < 600, out_.Length.ToString());
    }

    [Fact]
    public void ALongStringIsCutWithWhatWasLeft()
    {
        var big = new string('x', 1000);
        var out_ = LogCompact.Event("{\"html\":\"" + big + "\",\"n\":3}");
        var o = JsonNode.Parse(out_)!.AsObject();
        Assert.Equal(3, (int)o["n"]!);
        Assert.EndsWith(" ...(+700 chars)", (string)o["html"]!);
        Assert.StartsWith(new string('x', LogCompact.MaxString), (string)o["html"]!);
    }

    [Fact]
    public void TextThatIsNotJsonIsOnlyCapped()
    {
        Assert.Equal("surface.inject peacock window.__prismVideoTune()", LogCompact.Event("surface.inject peacock window.__prismVideoTune()"));
        var long_ = new string('y', LogCompact.MaxLine + 50);
        var out_ = LogCompact.Event(long_);
        Assert.Equal(LogCompact.MaxLine, out_.IndexOf(" ...(+50 chars)", StringComparison.Ordinal));
        Assert.Equal("", LogCompact.Event(null));
        Assert.Equal("{not json", LogCompact.Event("{not json"));
    }

    [Fact]
    public void NonAsciiTextIsWrittenAsItself()
    {
        var out_ = LogCompact.Event("{\"title\":\"Am\u00e9lie \u00b7 caf\u00e9\"}");
        Assert.Contains("Am\u00e9lie \u00b7 caf\u00e9", out_);
    }
}
