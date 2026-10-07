using System.Diagnostics;
using Microsoft.UI.Xaml;

namespace PrismHost;

/// <summary>
/// The big window first (2026-10-07, "Are we able to prioritize the big window's throughput over the others? For example, I'm playing 5
/// youtubetv stations, and I notice some slowdowns"): every ten seconds the page process that draws the big window runs above normal and a
/// process that draws only small windows below normal, so when the PC is busy the big window's video is served first. A process that draws
/// anything else (the shared browser and GPU processes, a hidden page) is left at normal, and one Prism lowered is put back when it no
/// longer draws only small windows. Only Prism's own WebView2 processes are touched.
/// </summary>
public sealed partial class MainWindow
{
    private readonly Dictionary<uint, ProcessPriorityClass> _setPriority = new();
    private string? _priorityBig;

    private void InitBigWindowFirst()
    {
        var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
        t.Tick += async (_, __) => { try { await BigWindowFirstAsync(); } catch (Exception ex) { LogLine("big window first: " + ex.Message); } };
        t.Start();
    }

    private async Task BigWindowFirstAsync()
    {
        if (_surfaces is null) return;
        var big = _surfaces.BigWindowId();
        var small = _surfaces.VeilStates().Select(v => v.Id).Where(id => id != big && _surfaces.KindOf(id) is { } k && k != Surfaces.SurfaceKind.Hidden && !id.StartsWith("app:", StringComparison.Ordinal)).ToHashSet();
        var procs = await _surfaces.ProcessMapAsync();
        var want = new Dictionary<uint, ProcessPriorityClass>();
        foreach (var p in procs)
        {
            if (p.Kind != "Renderer" || p.Surfaces.Length == 0) continue;
            if (big is not null && p.Surfaces.Contains(big)) want[p.Pid] = ProcessPriorityClass.AboveNormal;
            else if (p.Surfaces.All(small.Contains)) want[p.Pid] = ProcessPriorityClass.BelowNormal;
        }
        // set what changed; put back to normal what Prism set before and no longer wants
        foreach (var (pid, cls) in want)
            if (!_setPriority.TryGetValue(pid, out var had) || had != cls) { if (SetPriority(pid, cls)) _setPriority[pid] = cls; }
        foreach (var pid in _setPriority.Keys.Where(k => !want.ContainsKey(k)).ToList()) { SetPriority(pid, ProcessPriorityClass.Normal); _setPriority.Remove(pid); }
        if (big != _priorityBig)
        {
            _priorityBig = big;
            LogLine("big window first: " + (big ?? "none") + " above normal, " + want.Count(x => x.Value == ProcessPriorityClass.BelowNormal) + " small-window processes below normal");
        }
    }

    private static bool SetPriority(uint pid, ProcessPriorityClass cls)
    {
        try { using var p = Process.GetProcessById((int)pid); if (p.PriorityClass != cls) p.PriorityClass = cls; return true; }
        catch { return false; }   // gone, or not ours to change
    }
}
