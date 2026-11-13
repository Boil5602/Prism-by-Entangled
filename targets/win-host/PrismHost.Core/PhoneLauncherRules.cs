using System.Text.Json.Nodes;

namespace PrismHost.Launching;

/// <summary>
/// The phone launcher's decisions, apart from its sockets and processes so they run headless in the tests (2026-10-23). The launcher is PRISM's own exe started with
/// --launcher at sign-in: while PRISM is closed it answers the phone on PRISM's port, and a paired phone can open PRISM from it.
/// </summary>
public static class PhoneLauncherRules
{
    /// <summary>The store key core keeps the phones' pairings under (remote.ts persist): [{token, name, created, lastSeen?}].</summary>
    public const string TokensKey = "remote:tokens";

    /// <summary>Whether a token is one of the paired phones', read from the pairings as core stored them. An empty token, a missing
    /// record or one that does not parse is never paired.</summary>
    public static bool Paired(string? tokensJson, string? token)
    {
        if (token is not { Length: > 0 } || tokensJson is not { Length: > 0 }) return false;
        try
        {
            if (JsonNode.Parse(tokensJson) is not JsonArray list) return false;
            foreach (var d in list)
                if (d is JsonObject o && o["token"] is JsonValue v && v.TryGetValue<string>(out var t) && t == token) return true;
        }
        catch { }
        return false;
    }

    /// <summary>The paired check against the data folder as it is on disk (StoreService.ReadKeyOnly; nothing is written).</summary>
    public static bool PairedOnDisk(string dataDir, string? token) =>
        token is { Length: > 0 } && Paired(Storage.StoreService.ReadKeyOnly(dataDir, TokensKey), token);
}

/// <summary>
/// How often the launcher starts PRISM again after it stops without closing (a crash): at most Max times in Window. A PRISM that
/// keeps falling over is left closed, and the phone's Open PRISM button is still there.
/// </summary>
public sealed class RestartBudget
{
    public int Max { get; }
    public TimeSpan Window { get; }
    private readonly List<DateTime> _used = new();

    public RestartBudget(int max = 3, TimeSpan? window = null) { Max = max; Window = window ?? TimeSpan.FromHours(1); }

    public bool TryTake(DateTime now)
    {
        _used.RemoveAll(t => now - t >= Window);
        if (_used.Count >= Max) return false;
        _used.Add(now);
        return true;
    }
}
