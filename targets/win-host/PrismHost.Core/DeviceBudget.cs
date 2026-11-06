namespace PrismHost.Device;

/// <summary>
/// The device profile the host reports to core at init (win-host-spec §4,
/// dashboard-schema §18 / §25). The host measures; CORE decides what to do
/// with the numbers — nothing here schedules or demotes anything.
///
/// <list type="bullet">
/// <item><c>maxLiveTiles</c> — win-host-spec §4: N100/8GB → 4, 16GB → 7.
/// Beyond it §18 demotes least-recently-interacted tiles to warm (real pixels,
/// no renderer), which is also what makes a §25 peek possible: only a WARM
/// tile is ever peeked.</item>
/// <item><c>previewBudget</c> — §25 for the mini-PC class: at most 3
/// concurrently decoding video tiles, peek intervals floored at 30s.</item>
/// </list>
///
/// Pure so PrismHost.Tests can pin the mapping without a machine of each size.
/// </summary>
public static class DeviceBudget
{
    /// <summary>§25 mini-PC decode cap: concurrently *playing* video tiles.</summary>
    public const int MaxPlayingVideo = 3;

    /// <summary>§25 mini-PC peek floor, in seconds: a scene asking for less is raised to this.</summary>
    public const int MinPeekIntervalSec = 30;

    /// <summary>
    /// win-host-spec §4 live-tile budget for the installed RAM. Below the
    /// 8GB baseline we stay at the baseline's step down rather than inventing
    /// a number: an under-spec machine shows fewer live renderers, never a
    /// blank wall (§16 — warm tiles keep their pixels).
    /// </summary>
    public static int MaxLiveTiles(long physicalMemoryBytes)
    {
        var gb = physicalMemoryBytes / 1024d / 1024d / 1024d;
        // larger machines keep more pages live (2026-09-24: a 64GB wall with five multiview windows and the Music player's hidden sources
        // had its Apple Music page put to sleep at 7 - "Maybe raise that limit if not needed"): 32GB -> 12, 64GB -> 20
        if (gb >= 60.0) return 20;     // 64GB
        if (gb >= 30.0) return 12;     // 32GB
        if (gb >= 15.0) return 7;      // 16GB (reported slightly under by the OS)
        if (gb >= 7.0) return 4;       // 8GB — the N100 baseline
        return 3;                      // under-spec: still a working wall, fewer renderers
    }

    /// <summary>The init-options fragment core reads (runtime.ts init optionsJson).</summary>
    public static string OptionsFragmentJson(long physicalMemoryBytes) =>
        "{\"maxLiveTiles\":" + MaxLiveTiles(physicalMemoryBytes) +
        ",\"previewBudget\":{\"maxPlayingVideo\":" + MaxPlayingVideo +
        ",\"minPeekIntervalSec\":" + MinPeekIntervalSec + "}}";

    /// <summary>
    /// Installed physical memory as this process can see it. GC's view of the
    /// machine is the dependency-free reading; 0 (containers, odd hosts) falls
    /// back to the 8GB baseline rather than guessing high.
    /// </summary>
    public static long PhysicalMemoryBytes()
    {
        try
        {
            var total = GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;
            return total > 0 ? total : 8L * 1024 * 1024 * 1024;
        }
        catch { return 8L * 1024 * 1024 * 1024; }
    }
}
