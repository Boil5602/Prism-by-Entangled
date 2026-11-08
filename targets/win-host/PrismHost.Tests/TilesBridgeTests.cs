using System.Text.Json;
using PrismHost.Storage;
using PrismHost.Tiles;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// The host's whole share of the first-party micro-facets
/// (docs/concept-scenes.md §6): parse the page's message, refuse anything that
/// is not one of the two documents or does not come from a page this shell
/// itself serves, and build the brain call. Core owns everything else — these
/// tests exist so the host cannot quietly grow an opinion about chores.
///
/// The store round-trip below is the §10 half: what a micro-facet writes is in
/// store.json with every other key, survives a restart, and is never wiped.
/// </summary>
public sealed class TilesBridgeTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "prism-tiles-test-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch { }
    }

    // ---------------------------------------------------------------- origin

    [Theory]
    [InlineData("https://tiles.prism/chores/", true)]
    [InlineData("https://tiles.prism/timer/", true)]
    [InlineData("https://TILES.PRISM/timer/", true)]
    [InlineData("https://tiles.prism.evil.example/chores/", false)]
    [InlineData("http://tiles.prism/chores/", false)]     // the mapping is https; plain http is not ours
    [InlineData("https://news.example/", false)]
    [InlineData("about:blank", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void OnlyOurOwnPagesMayUseTheChannel(string? url, bool expected)
        => Assert.Equal(expected, TilesBridge.IsTilesOrigin(url));

    // ----------------------------------------------------------------- parse

    [Fact]
    public void ParsesAGetForEitherDocument()
    {
        foreach (var key in TilesBridge.Keys)
        {
            var req = TilesBridge.TryParse("{\"prism-tiles\":\"get\",\"key\":\"" + key + "\"}");
            Assert.NotNull(req);
            Assert.Equal(TilesBridge.RequestKind.Get, req!.Kind);
            Assert.Equal(key, req.Key);
        }
    }

    [Fact]
    public void ParsesAnApplyAndCarriesTheIntentThroughVerbatim()
    {
        var intent = "{\"op\":\"chores.add\",\"text\":\"milk\"}";
        var json = JsonSerializer.Serialize(new Dictionary<string, string>
        {
            ["prism-tiles"] = "apply", ["key"] = TilesBridge.ChoresKey, ["intent"] = intent,
        });
        var req = TilesBridge.TryParse(json);
        Assert.NotNull(req);
        Assert.Equal(TilesBridge.RequestKind.Apply, req!.Kind);
        Assert.Equal(intent, req.IntentJson);        // the host does not read it, let alone rewrite it
    }

    [Theory]
    [InlineData("{\"prism-tiles\":\"get\",\"key\":\"dashboard\"}")]              // not a micro-facet document
    [InlineData("{\"prism-tiles\":\"get\",\"key\":\"scene-model:apps\"}")]
    [InlineData("{\"prism-tiles\":\"apply\",\"key\":\"tiles:chores\"}")]          // no intent
    [InlineData("{\"prism-tiles\":\"apply\",\"key\":\"tiles:chores\",\"intent\":\"\"}")]
    [InlineData("{\"prism-tiles\":\"wipe\",\"key\":\"tiles:chores\"}")]           // not a verb this channel has
    [InlineData("{\"type\":\"prism-ready\"}")]                                     // an engine event: falls through untouched
    [InlineData("{\"prism-tiles\":\"get\"}")]
    [InlineData("not json at all")]
    [InlineData("")]
    [InlineData(null)]
    public void RefusesAnythingElse(string? json) => Assert.Null(TilesBridge.TryParse(json));

    [Fact]
    public void RefusesAnOversizedIntentRatherThanForwardingIt()
    {
        var json = JsonSerializer.Serialize(new Dictionary<string, string>
        {
            ["prism-tiles"] = "apply", ["key"] = TilesBridge.TimerKey, ["intent"] = new string('x', 9000),
        });
        Assert.Null(TilesBridge.TryParse(json));
    }

    [Fact]
    public void KeysAreExactlyTheThreeDocuments()
    {
        // three since CS-10.3 added the agenda; the list is an allowlist, so it
        // is asserted exactly rather than by "contains".
        Assert.Equal(new[] { "tiles:chores", "tiles:timer", "tiles:agenda" }, TilesBridge.Keys);
        Assert.True(TilesBridge.KeyAllowed("tiles:chores"));
        Assert.False(TilesBridge.KeyAllowed("tiles:"));
        Assert.False(TilesBridge.KeyAllowed("remote:tokens"));
        Assert.False(TilesBridge.KeyAllowed(null));
    }

    // ------------------------------------------------------------ brain call

    [Fact]
    public void BuildsTheBrainCallForEachKind()
    {
        var get = TilesBridge.RuntimeExpression(new TilesBridge.Request(TilesBridge.RequestKind.Get, TilesBridge.ChoresKey, ""));
        Assert.Equal("PrismRuntime.tilesGet(\"tiles:chores\")", get);

        var intent = "{\"op\":\"timer.start\"}";
        var apply = TilesBridge.RuntimeExpression(
            new TilesBridge.Request(TilesBridge.RequestKind.Apply, TilesBridge.TimerKey, intent));
        var prefix = "PrismRuntime.tilesApply(\"tiles:timer\",";
        Assert.StartsWith(prefix, apply);
        Assert.EndsWith(")", apply);
        // the intent travels as ONE JSON string argument (the serializer's escaping
        // is its own business — what matters is that it decodes back unchanged)
        Assert.Equal(intent, JsonSerializer.Deserialize<string>(apply[prefix.Length..^1]));
    }

    [Fact]
    public void QuotesAreEscapedSoAnIntentCannotBreakOutOfTheCall()
    {
        var nasty = "{\"op\":\"chores.add\",\"text\":\"\\\");alert(1);(\\\"\"}";
        var expr = TilesBridge.RuntimeExpression(new TilesBridge.Request(TilesBridge.RequestKind.Apply, TilesBridge.ChoresKey, nasty));
        Assert.StartsWith("PrismRuntime.tilesApply(\"tiles:chores\",", expr);
        // whatever the page sent is one JSON string argument, not code
        var arg = expr["PrismRuntime.tilesApply(\"tiles:chores\",".Length..^1];
        Assert.Equal(nasty, JsonSerializer.Deserialize<string>(arg));
    }

    // -------------------------------------------------------- page messages

    [Fact]
    public void DocMessageCarriesTheDocumentAsJsonNotAsAString()
    {
        var msg = TilesBridge.DocMessage(TilesBridge.ChoresKey, "{\"v\":1,\"items\":[],\"notes\":\"\"}");
        using var doc = JsonDocument.Parse(msg);
        Assert.Equal("doc", doc.RootElement.GetProperty("prism-tiles").GetString());
        Assert.Equal("tiles:chores", doc.RootElement.GetProperty("key").GetString());
        Assert.Equal(JsonValueKind.Object, doc.RootElement.GetProperty("doc").ValueKind);
    }

    [Fact]
    public void AnEmptyAnswerBecomesANullDocument_NeverBrokenJson()
    {
        foreach (var raw in new[] { "", "   ", "null" })
        {
            using var doc = JsonDocument.Parse(TilesBridge.DocMessage(TilesBridge.TimerKey, raw));
            Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("doc").ValueKind);
        }
    }

    [Fact]
    public void ErrorMessageRepeatsCoresWordsToThePage()
    {
        using var doc = JsonDocument.Parse(TilesBridge.ErrorMessage(TilesBridge.ChoresKey, "no item 'c9'"));
        Assert.Equal("error", doc.RootElement.GetProperty("prism-tiles").GetString());
        Assert.Equal("no item 'c9'", doc.RootElement.GetProperty("message").GetString());
    }

    [Fact]
    public void ReadsCoresApplyAnswer()
    {
        var (ok, err) = TilesBridge.ReadApplyResult("{\"ok\":true,\"changed\":true,\"doc\":{\"v\":1,\"items\":[]}}");
        Assert.Null(err);
        Assert.Equal("{\"v\":1,\"items\":[]}", ok);

        var (none, refusal) = TilesBridge.ReadApplyResult("{\"ok\":false,\"error\":\"no item 'c9'\"}");
        Assert.Null(none);
        Assert.Equal("no item 'c9'", refusal);

        foreach (var bad in new[] { null, "", "null", "not json", "[1,2]" })
        {
            var (d, e) = TilesBridge.ReadApplyResult(bad);
            Assert.Null(d);
            Assert.False(string.IsNullOrEmpty(e));
        }
    }

    // -------------------------------------------------------- §10 round-trip

    [Fact]
    public void MicroFacetDocumentsRoundTripThroughTheStoreAcrossARestart()
    {
        var list = "{\"v\":1,\"items\":[{\"id\":\"c1\",\"text\":\"milk\",\"done\":false,\"added\":\"2026-09-02\"}],\"notes\":\"back Tuesday\",\"updated\":\"2026-09-02\"}";
        var timer = "{\"v\":1,\"mode\":\"interval\",\"durationMs\":600000,\"endsAt\":1788000000000,\"remainingMs\":600000,\"running\":true,\"laps\":2,\"chime\":true,\"volume\":0.6,\"presets\":[5,10],\"label\":\"\",\"savedAt\":1787999400000}";

        var a = new StoreService(_root);
        a.Set(TilesBridge.ChoresKey, list);
        a.Set(TilesBridge.TimerKey, timer);

        var b = new StoreService(_root);                       // the panel restarted
        Assert.Equal(list, b.Get(TilesBridge.ChoresKey));
        Assert.Equal(timer, b.Get(TilesBridge.TimerKey));      // the deadline survives, so the run picks back up
    }

    [Fact]
    public void MicroFacetWritesLeaveEveryOtherKeyAlone()
    {
        var a = new StoreService(_root);
        a.Set("dashboard", "{\"version\":1}");
        a.Set("remote:tokens", "[]");
        a.Set(TilesBridge.ChoresKey, "{\"v\":1,\"items\":[],\"notes\":\"\",\"updated\":\"2026-09-02\"}");
        a.Set(TilesBridge.TimerKey, "{\"v\":1}");

        var b = new StoreService(_root);
        Assert.Equal("{\"version\":1}", b.Get("dashboard"));
        Assert.Equal("[]", b.Get("remote:tokens"));
        Assert.Equal(4, b.All().Count);
    }

    [Fact]
    public void AMicroFacetKeyIsJustAKey_NothingClearsIt()
    {
        var a = new StoreService(_root);
        a.Set(TilesBridge.ChoresKey, "{\"v\":1,\"items\":[{\"id\":\"c1\",\"text\":\"milk\",\"done\":true,\"added\":\"2026-09-02\"}],\"notes\":\"\",\"updated\":\"2026-09-02\"}");
        // a scene change, a new dashboard, an unrelated write — the list stays
        a.Set("dashboard", "{\"tiles\":[]}");
        a.Set("host.boot", "[]");
        var b = new StoreService(_root);
        Assert.Contains("milk", b.Get(TilesBridge.ChoresKey));
    }

    // ------------------------------------------------- the pages themselves

    /// <summary>
    /// The zero-network promise, checked from the host's own test run as well
    /// as from the gate (scripts/verify-tile-assets.mjs): no asset the shell
    /// serves at tiles.prism may name an origin that is not tiles.prism.
    /// </summary>
    [Fact]
    public void ShippedTileAssetsNameNoExternalOrigin()
    {
        var dir = FindTilesAssets();
        if (dir is null) return;                              // not a source checkout: the gate's script covers it
        var textExt = new[] { ".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md" };
        var offenders = new List<string>();
        foreach (var file in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
        {
            if (!textExt.Contains(Path.GetExtension(file).ToLowerInvariant())) continue;
            foreach (System.Text.RegularExpressions.Match m in
                     System.Text.RegularExpressions.Regex.Matches(File.ReadAllText(file), @"https?://[A-Za-z0-9._~:\-\[\]@]+"))
            {
                if (!m.Value.StartsWith("https://" + TilesBridge.HostName, StringComparison.OrdinalIgnoreCase))
                    offenders.Add(Path.GetFileName(file) + ": " + m.Value);
            }
        }
        Assert.Empty(offenders);
    }

    [Fact]
    public void TheChimeIsBundledBesideThePages()
    {
        var dir = FindTilesAssets();
        if (dir is null) return;
        var chime = Path.Combine(dir, "shared", "chime.wav");
        Assert.True(File.Exists(chime), "the §24 chime must ship with the pages — run `node scripts/make-chime.mjs`");
        var head = File.ReadAllBytes(chime).Take(12).ToArray();
        Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(head, 0, 4));
        Assert.Equal("WAVE", System.Text.Encoding.ASCII.GetString(head, 8, 4));
    }

    /// <summary>Walk up from the test binary to the repo's Assets/tiles; null when the sources are not beside us.</summary>
    private static string? FindTilesAssets()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 10 && dir is not null; i++, dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "targets", "win-host", "PrismHost", "Assets", "tiles");
            if (Directory.Exists(candidate)) return candidate;
        }
        return null;
    }

    [Fact]
    public void TheAgendaKeyIsAllowed_AndAnythingElseIsStillRefused()
    {
        // CS-10.3: prism-agenda reads and writes tiles:agenda through this same
        // channel. Without it on the allowlist the page loads and silently
        // reads nothing - a failure no gate step can see.
        Assert.True(TilesBridge.KeyAllowed(TilesBridge.AgendaKey));
        Assert.Equal("tiles:agenda", TilesBridge.AgendaKey);
        Assert.Equal(3, TilesBridge.Keys.Length);

        // the guard still refuses everything it is not
        Assert.False(TilesBridge.KeyAllowed("tiles:anything"));
        Assert.False(TilesBridge.KeyAllowed("scene-model:apps"));
        Assert.False(TilesBridge.KeyAllowed(null));
    }

    [Fact]
    public void TheAgendaFacetsDirectoryUrlLoadsItsIndex()
    {
        Assert.Equal("https://tiles.prism/agenda/index.html", TilesBridge.DocumentUrl("https://tiles.prism/agenda/"));
    }
}
