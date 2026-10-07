using System;
using System.IO;
using Microsoft.UI.Xaml;

namespace PrismHost;

/// <summary>
/// Dev only (PRISM_FRAME_SAMPLER=1): every two seconds a 320x180 grey frame of each YouTube TV window is written to diagnostics\frames\<window>\
/// as raw bytes (2026-10-06, "Really need to dig into youtubetv and figure out ad locations in videos ... My human eyes can see it"): the
/// frames a channel-logo watch is tuned on, read offline against the times the person saw a break. Kept to the last two hours a window.
/// </summary>
public sealed partial class MainWindow
{
    private DispatcherTimer? _frameSampler;
    private bool _sampling;
    private void InitFrameSampler()
    {
        if (Environment.GetEnvironmentVariable("PRISM_FRAME_SAMPLER") != "old") return;   // the break watch's own bench recording replaces it (2026-10-07)
        var root = Path.Combine(HostPaths.DataDir, "diagnostics", "frames");   // the store is not up yet here
        Directory.CreateDirectory(root);
        _frameSampler = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
        _frameSampler.Tick += async (_, __) =>
        {
            if (_sampling) return;
            _sampling = true;
            try
            {
                if (_surfaces is null) return;
                foreach (var id in _surfaces.TilesAt("tv.youtube.com/watch"))
                {
                    var g = await _surfaces.CaptureGrayAsync(id, 320, 180);
                    if (g is null) continue;
                    var dir = Path.Combine(root, id);
                    Directory.CreateDirectory(dir);
                    File.WriteAllBytes(Path.Combine(dir, DateTime.Now.ToString("HHmmss") + ".gray"), g);
                    var files = Directory.GetFiles(dir, "*.gray");
                    if (files.Length > 4000) { Array.Sort(files); for (var i = 0; i < files.Length - 4000; i++) try { File.Delete(files[i]); } catch { } }
                }
            }
            catch (Exception e) { LogLine("frame sampler: " + e.Message); }
            finally { _sampling = false; }
        };
        _frameSampler.Start();
        LogLine("frame sampler: on (" + root + ")");
    }
}
