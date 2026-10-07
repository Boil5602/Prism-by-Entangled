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
    public void DelayedSaves_CoalesceAndFlush()
    {
        // the host's store (2026-09-28): a burst of sets is written once, later, off the caller's thread; Flush writes at once
        var s = new StoreService(_root, saveDelayMs: 60_000);
        for (var i = 0; i < 100; i++) s.Set("k" + i, "v" + i);
        Assert.Equal("v99", s.Get("k99"));   // read back from memory at once
        Assert.False(File.Exists(Path.Combine(_root, "store.json")));   // nothing written yet
        s.Flush();
        using (var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(_root, "store.json"))))
            Assert.Equal(100, doc.RootElement.GetProperty("data").EnumerateObject().Count());
        Assert.Equal("v42", new StoreService(_root).Get("k42"));   // survives a restart
        var t = new StoreService(_root, saveDelayMs: 50);
        t.Set("late", "1");
        for (var i = 0; i < 100 && new StoreService(_root).Get("late") is null; i++) Thread.Sleep(20);
        Assert.Equal("1", new StoreService(_root).Get("late"));   // and the timer writes it on its own
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

    // the hand-written save (2026-10-03, perf): every shape of string comes back as it went - quotes, backslashes, newlines, control
    // characters, non-ASCII, an emoji (a surrogate pair), a lone surrogate - and the file is JSON the serializer reads
    [Fact]
    public void Save_round_trips_every_string_shape()
    {
        var root = Path.Combine(Path.GetTempPath(), "prism-store-" + Guid.NewGuid().ToString("N"));
        try
        {
            var values = new Dictionary<string, string>
            {
                ["plain"] = "hello",
                ["quotes"] = "say \"hi\" and \\\\ back",
                ["lines"] = "a\nb\r\nc\td\be\ff",
                ["control"] = "x\u0001y\u001fz\u007f",
                ["accents"] = "caf\u00e9 na\u00efve \u4e2d\u6587",
                ["emoji"] = "ok \U0001F600 done",
                ["lone"] = "bad \ud83d end",
                ["json"] = "{\"a\":[1,2,{\"b\":\"c\"}]}",
                ["big"] = new string('q', 300_000) + "\"" + new string('\\', 10),
            };
            var s = new StoreService(root); foreach (var kv in values) s.Set(kv.Key, kv.Value); s.Flush();
            var text = File.ReadAllText(Path.Combine(root, "store.json"));
            using (var doc = System.Text.Json.JsonDocument.Parse(text)) Assert.Equal(1, doc.RootElement.GetProperty("version").GetInt32());
            var back = new StoreService(root);
            foreach (var kv in values) Assert.Equal(kv.Key == "lone" ? "bad \uFFFD end" : kv.Value, back.Get(kv.Key));   // a lone surrogate is not a character: U+FFFD, as before
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }

    // per-key files (2026-10-03): with a save delay, a change writes its own file and the whole store only at Flush; a restart takes the
    // per-key files over the snapshot when they are newer, and the snapshot alone when a later run wrote it without them
    [Fact]
    public void Delayed_saves_write_changed_keys_only_and_a_restart_reads_them_over_the_snapshot()
    {
        var root = Path.Combine(Path.GetTempPath(), "prism-store-" + Guid.NewGuid().ToString("N"));
        try
        {
            var a = new StoreService(root, saveDelayMs: 50);
            a.Set("alpha", "1"); a.Set("beta", "2");
            Thread.Sleep(400);
            Assert.True(Directory.Exists(a.KeysDir));
            Assert.Equal(2, Directory.GetFiles(a.KeysDir, "*.json").Length);
            Assert.False(File.Exists(a.StorePath));   // the snapshot waits for Flush (or half an hour)
            a.Set("alpha", "1b");
            Thread.Sleep(400);
            Assert.Equal(2, Directory.GetFiles(a.KeysDir, "*.json").Length);   // the same file, rewritten
            a.Flush();
            Assert.True(File.Exists(a.StorePath));
            // a restart: everything there
            var b = new StoreService(root, saveDelayMs: 50);
            Assert.Equal("1b", b.Get("alpha")); Assert.Equal("2", b.Get("beta"));
            // a change written only to its file (no Flush): the next start still has it
            b.Set("gamma", "3"); b.Set("alpha", "1c");
            Thread.Sleep(400);
            var c = new StoreService(root, saveDelayMs: 50);
            Assert.Equal("1c", c.Get("alpha")); Assert.Equal("3", c.Get("gamma"));
            // a later run that writes the snapshot alone (no delay: tests and tools) wins over older per-key files
            Thread.Sleep(50);
            var tool = new StoreService(root);
            tool.Set("alpha", "1d");
            var d = new StoreService(root, saveDelayMs: 50);
            Assert.Equal("1d", d.Get("alpha")); Assert.Equal("3", d.Get("gamma"));
            // two keys that sanitize alike are two files
            d.Set("a:b", "x"); d.Set("a_b", "y");
            Thread.Sleep(400);
            var e = new StoreService(root, saveDelayMs: 50);
            Assert.Equal("x", e.Get("a:b")); Assert.Equal("y", e.Get("a_b"));
        }
        finally { try { Directory.Delete(root, true); } catch { } }
    }
}
