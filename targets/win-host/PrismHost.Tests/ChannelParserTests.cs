using PrismHost.Channel;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// The channel boundary (win-host-spec §2): the host executes M1 ops,
/// degrades stubs honestly (request lane answers "unsupported" instead of
/// hanging core), and treats off-schema ops as drift, never guesses.
/// </summary>
public sealed class ChannelParserTests
{
    [Fact]
    public void ParsesAnM1Command()
    {
        var msg = ChannelParser.Parse("{\"op\":\"surface.navigate\",\"id\":\"netflix\",\"url\":\"https://www.netflix.com/\"}");
        Assert.NotNull(msg);
        Assert.Equal(Ops.SurfaceNavigate, msg!.Op);
        Assert.Equal("netflix", msg.GetString("id"));
        Assert.Equal(CommandRoute.Execute, ChannelParser.Route(msg));
    }

    [Fact]
    public void ParsesRects()
    {
        var msg = ChannelParser.Parse("{\"op\":\"surface.setRect\",\"id\":\"t\",\"rect\":{\"x\":10,\"y\":20,\"w\":300,\"h\":200}}");
        var r = msg!.GetRect("rect");
        Assert.Equal(new ChannelRect(10, 20, 300, 200), r);
    }

    [Fact]
    public void NonM1FireAndForgetIsIgnoredStub()
    {
        var msg = ChannelParser.Parse("{\"op\":\"display.setBrightness\",\"value\":0.5}");
        Assert.Equal(CommandRoute.StubIgnore, ChannelParser.Route(msg!));
    }

    [Fact]
    public void NonM1RequestLaneResolvesUnsupported()
    {
        var msg = ChannelParser.Parse("{\"op\":\"media.listApps\",\"requestId\":7}");
        Assert.Equal(CommandRoute.StubResolveUnsupported, ChannelParser.Route(msg!));
        var js = ChannelParser.ResolveUnsupportedJson(msg!.RequestId!.Value);
        Assert.Contains("\"resolve\"", js);
        Assert.Contains("unsupported", js);
    }

    [Fact]
    public void OffSchemaOpIsDriftNotAGuess()
    {
        var msg = ChannelParser.Parse("{\"op\":\"surface.doSomethingNew\",\"id\":\"t\"}");
        Assert.Equal(CommandRoute.Unknown, ChannelParser.Route(msg!));
    }

    [Fact]
    public void GarbageParsesToNull()
    {
        Assert.Null(ChannelParser.Parse("not json"));
        Assert.Null(ChannelParser.Parse("[1,2,3]"));
        Assert.Null(ChannelParser.Parse("{\"noOp\":true}"));
    }

    [Fact]
    public void HostCallJsonShape()
    {
        // exact escaping is the serializer's business — assert the parsed shape
        var js = ChannelParser.HostCallJson(HostCalls.Event, "{\"type\":\"first-paint\",\"id\":\"t\"}");
        using var doc = System.Text.Json.JsonDocument.Parse(js);
        Assert.Equal("event", doc.RootElement.GetProperty("fn").GetString());
        var arg0 = doc.RootElement.GetProperty("args")[0].GetString();
        using var inner = System.Text.Json.JsonDocument.Parse(arg0!);
        Assert.Equal("first-paint", inner.RootElement.GetProperty("type").GetString());
        Assert.Equal("t", inner.RootElement.GetProperty("id").GetString());
    }
}
