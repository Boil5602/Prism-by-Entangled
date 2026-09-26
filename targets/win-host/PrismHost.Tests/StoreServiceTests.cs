using System.Text.Json;
using PrismHost.Storage;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// The §10 never-wipe guarantee as tests (win-host-spec §12, M1 scope):
/// restart, upgrade simulation, migration stub, corrupt-file handling —
/// none of them may lose a key, a profile file, or a snapshot.
/// </summary>
public sealed class StoreServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "prism-store-test-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch { }
    }

    [Fact]
    public void RestartKeepsEverything()
    {
        var a = new StoreService(_root);
        a.Set("dashboard", "{\"version\":1}");
        a.Set("tiles.known", "[\"netflix\"]");

        var b = new StoreService(_root);            // app restart
        Assert.Equal("{\"version\":1}", b.Get("dashboard"));
        Assert.Equal("[\"netflix\"]", b.Get("tiles.known"));
    }

    [Fact]
    public void ProfileDirsSurviveStoreActivityAndRestart()
    {
        var a = new StoreService(_root);
        var dir = a.ProfileDir("netflix");
        File.WriteAllText(Path.Combine(dir, "Cookies"), "session-bytes");

        a.Set("noise", "value");                     // store writes touch nothing else
        var b = new StoreService(_root);             // restart
        var again = b.ProfileDir("netflix");         // create-on-demand is idempotent

        Assert.Equal(dir, again);
        Assert.Equal("session-bytes", File.ReadAllText(Path.Combine(dir, "Cookies")));
    }

    [Fact]
    public void UpgradeSimulation_OlderVersionLoadsWithAllKeys()
    {
        Directory.CreateDirectory(_root);
        // a version-0 store written by a hypothetical older build
        File.WriteAllText(Path.Combine(_root, "store.json"),
            "{\"version\":0,\"data\":{\"dashboard\":\"old-doc\",\"unknown-future-key\":\"kept\"}}");

        var s = new StoreService(_root);
        Assert.Equal(0, s.LoadedVersion);
        Assert.Equal("old-doc", s.Get("dashboard"));
        Assert.Equal("kept", s.Get("unknown-future-key"));   // migration may never drop keys

        s.Set("touched", "1");                                // save rewrites at CurrentVersion
        var reloaded = new StoreService(_root);
        Assert.Equal(StoreService.CurrentVersion, reloaded.LoadedVersion);
        Assert.Equal("old-doc", reloaded.Get("dashboard"));
        Assert.Equal("kept", reloaded.Get("unknown-future-key"));
    }

    [Fact]
    public void NewerVersionLoadsAsIs_RollbackPath()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllText(Path.Combine(_root, "store.json"),
            $"{{\"version\":{StoreService.CurrentVersion + 5},\"data\":{{\"k\":\"from-the-future\"}}}}");
        var s = new StoreService(_root);
        Assert.Equal("from-the-future", s.Get("k"));
    }

    [Fact]
    public void CorruptStoreIsSetAsideNeverErased_ProfilesUntouched()
    {
        var a = new StoreService(_root);
        var profile = a.ProfileDir("hulu");
        File.WriteAllText(Path.Combine(profile, "LocalStorage"), "precious");
        File.WriteAllText(a.SnapshotPath("hulu"), "png-bytes");

        File.WriteAllText(Path.Combine(_root, "store.json"), "{ not json !!");
        var b = new StoreService(_root);

        Assert.Null(b.Get("anything"));
        Assert.True(Directory.GetFiles(_root, "store.json.corrupt-*").Length == 1,
            "corrupt store must be set aside, not deleted");
        Assert.Equal("precious", File.ReadAllText(Path.Combine(profile, "LocalStorage")));
        Assert.Equal("png-bytes", File.ReadAllText(b.SnapshotPath("hulu")));
    }

    [Fact]
    public void SaveIsAtomic_NoTempLeftBehind()
    {
        var s = new StoreService(_root);
        for (var i = 0; i < 50; i++) s.Set("k" + i, new string('x', 500));
        Assert.False(File.Exists(Path.Combine(_root, "store.json.tmp")));
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(_root, "store.json")));
        Assert.Equal(50, doc.RootElement.GetProperty("data").EnumerateObject().Count());
    }

    [Fact]
    public void StoreServiceHasNoProfileDeletionApi()
    {
        // §10 by construction: the type must not expose any member that could
        // delete or clear a profile. Guarded reflectively so a future "cleanup"
        // helper fails review here first.
        var offenders = typeof(StoreService).GetMethods()
            .Where(m => m.DeclaringType == typeof(StoreService))
            .Select(m => m.Name)
            .Where(n => n.Contains("Delete", StringComparison.OrdinalIgnoreCase)
                     || n.Contains("Clear", StringComparison.OrdinalIgnoreCase)
                     || n.Contains("Wipe", StringComparison.OrdinalIgnoreCase)
                     || n.Contains("Remove", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        Assert.Empty(offenders);
    }
}
