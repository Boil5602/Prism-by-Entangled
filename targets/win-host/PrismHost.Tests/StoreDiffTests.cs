using PrismHost.Storage;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// The first-boot scene-model migration's §10 contract as the host checks it
/// (MainWindow.Migration.cs): a store snapshot before and after the migration
/// may differ ONLY by keys added under `scene-model:`. Core asserts the same
/// before writing (assertWritesOnlyNewKeys); this is the host's independent
/// read of the result.
/// </summary>
public sealed class StoreDiffTests
{
    private const string Prefix = "scene-model:";

    private static Dictionary<string, string> Source() => new()
    {
        ["dashboard"] = "{\"id\":\"wall\",\"tiles\":[]}",
        ["layout:wall"] = "{\"heroSize\":0.62}",
        ["tile:lasturl:wall:hulu"] = "https://www.hulu.com/hub/home",
        ["apps"] = "[]",
        ["host.boot"] = "[]",
    };

    [Fact]
    public void MigrationThatOnlyAddsSceneModelKeysIsClean()
    {
        var before = Source();
        var after = new Dictionary<string, string>(before)
        {
            ["scene-model:apps"] = "[]",
            ["scene-model:facets"] = "[]",
            ["scene-model:layouts"] = "[]",
            ["scene-model:scenes"] = "[]",
            ["scene-model:active-scene"] = "",
            ["scene-model:migration"] = "{\"schema\":\"prism.scene-model-migration/v0.1\"}",
        };

        var d = StoreDiff.Classify(before, after, Prefix);

        Assert.True(d.OnlyAddedUnderPrefix);
        Assert.False(d.ViolatesNeverRewrite);
        Assert.Equal(6, d.AddedUnderPrefix.Count);
        Assert.Empty(d.AddedElsewhere);
        Assert.Empty(d.Changed);
        Assert.Empty(d.Removed);
        // every source key survived byte-identical
        foreach (var (k, v) in before) Assert.Equal(v, after[k]);
    }

    [Fact]
    public void RewritingASourceKeyIsAViolation()
    {
        var before = Source();
        var after = new Dictionary<string, string>(before) { ["scene-model:migration"] = "{}" };
        after["dashboard"] = "{\"id\":\"wall\",\"tiles\":[],\"migrated\":true}";   // a migration must never do this

        var d = StoreDiff.Classify(before, after, Prefix);

        Assert.False(d.OnlyAddedUnderPrefix);
        Assert.True(d.ViolatesNeverRewrite);
        Assert.Equal(new[] { "dashboard" }, d.Changed);
        Assert.Contains("CHANGED: dashboard", d.Summary());
    }

    [Fact]
    public void RemovingASourceKeyIsAViolation()
    {
        var before = Source();
        var after = new Dictionary<string, string>(before) { ["scene-model:migration"] = "{}" };
        after.Remove("tile:lasturl:wall:hulu");

        var d = StoreDiff.Classify(before, after, Prefix);

        Assert.True(d.ViolatesNeverRewrite);
        Assert.Equal(new[] { "tile:lasturl:wall:hulu" }, d.Removed);
    }

    [Fact]
    public void AnUnrelatedKeyAddedInTheWindowIsReportedButNotAViolation()
    {
        // the wall keeps running while the migration runs: core or the host may add a key
        // (a new tile:lasturl, host.window) in the same window - reported, not a §10 breach
        var before = Source();
        var after = new Dictionary<string, string>(before) { ["scene-model:migration"] = "{}", ["host.window"] = "{\"x\":0}" };

        var d = StoreDiff.Classify(before, after, Prefix);

        Assert.False(d.OnlyAddedUnderPrefix);
        Assert.False(d.ViolatesNeverRewrite);
        Assert.Equal(new[] { "host.window" }, d.AddedElsewhere);
    }
}
