using PrismHost.Launching;
using PrismHost.Storage;
using Xunit;

namespace PrismHost.Tests;

/// <summary>The phone launcher's decisions (2026-10-23): a phone is paired by core's own record as it is on disk, read without
/// writing anything, and a Prism that keeps stopping is started again only so often.</summary>
public sealed class PhoneLauncherRulesTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "prism-launcher-test-" + Guid.NewGuid().ToString("N"));
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private const string Tokens = "[{\"token\":\"abc123\",\"name\":\"Phone 1\",\"created\":\"2026-10-01\",\"lastSeen\":\"2026-10-23\"}]";

    [Fact]
    public void PairedOnlyForAStoredToken()
    {
        Assert.True(PhoneLauncherRules.Paired(Tokens, "abc123"));
        Assert.False(PhoneLauncherRules.Paired(Tokens, "abc12"));
        Assert.False(PhoneLauncherRules.Paired(Tokens, ""));
        Assert.False(PhoneLauncherRules.Paired(Tokens, null));
        Assert.False(PhoneLauncherRules.Paired(null, "abc123"));
        Assert.False(PhoneLauncherRules.Paired("not json", "abc123"));
        Assert.False(PhoneLauncherRules.Paired("{\"token\":\"abc123\"}", "abc123"));
    }

    [Fact]
    public void ReadsTheKeyAsTheStoreWroteIt()
    {
        var store = new StoreService(_root);
        store.Set(PhoneLauncherRules.TokensKey, Tokens);   // no save delay: the key file and the snapshot are both on disk
        Assert.Equal(Tokens, StoreService.ReadKeyOnly(_root, PhoneLauncherRules.TokensKey));
        Assert.True(PhoneLauncherRules.PairedOnDisk(_root, "abc123"));
        Assert.False(PhoneLauncherRules.PairedOnDisk(_root, "nope"));
        Assert.Null(StoreService.ReadKeyOnly(_root, "missing:key"));
    }

    [Fact]
    public void ANewerKeyFileWinsOverTheSnapshot()
    {
        var store = new StoreService(_root, saveDelayMs: 50);
        store.Set(PhoneLauncherRules.TokensKey, "[]");
        store.Flush();   // the snapshot holds [] and the key file written on the way is folded in and gone (B-406), so the newer key file is written here
        Directory.CreateDirectory(Path.Combine(_root, "store"));
        var keyFile = Path.Combine(_root, "store", StoreService.KeyFileName(PhoneLauncherRules.TokensKey));
        File.WriteAllText(keyFile, "{\"key\":\"remote:tokens\",\"value\":" + System.Text.Json.JsonSerializer.Serialize(Tokens) + "}");
        File.SetLastWriteTimeUtc(keyFile, DateTime.UtcNow.AddMinutes(1));
        Assert.True(PhoneLauncherRules.PairedOnDisk(_root, "abc123"));
        File.SetLastWriteTimeUtc(keyFile, DateTime.UtcNow.AddHours(-1));   // older than the snapshot: the snapshot's value
        Assert.False(PhoneLauncherRules.PairedOnDisk(_root, "abc123"));
    }

    [Fact]
    public void ABrokenFileIsReadPastAndLeftWhereItIs()
    {
        Directory.CreateDirectory(Path.Combine(_root, "store"));
        File.WriteAllText(Path.Combine(_root, "store.json"), "{ broken");
        Assert.Null(StoreService.ReadKeyOnly(_root, PhoneLauncherRules.TokensKey));
        Assert.True(File.Exists(Path.Combine(_root, "store.json")));
        Assert.Empty(Directory.GetFiles(_root, "store.json.corrupt-*"));
    }

    [Fact]
    public void RestartsAreBounded()
    {
        var b = new RestartBudget(3, TimeSpan.FromHours(1));
        var t = new DateTime(2026, 10, 23, 18, 0, 0);
        Assert.True(b.TryTake(t));
        Assert.True(b.TryTake(t.AddMinutes(5)));
        Assert.True(b.TryTake(t.AddMinutes(10)));
        Assert.False(b.TryTake(t.AddMinutes(20)));
        Assert.True(b.TryTake(t.AddMinutes(61)));   // the first has left the hour
    }
}
