using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The performance stats (2026-10-03, "Should we add resource charts under the options menu on watch gated behind a performance stats
/// checkbox? I'd like to see how busy the app is, downloads, cpu, gpu, memory"): perf.log's last hour as four small charts - CPU, GPU,
/// memory (every process, the host alone), IO - with the last minute's split by service and the costliest renderers under them. Drawn in
/// the Performance tab of Watch settings, and at the foot of the Watch page while host-prefs perf.panel is on; refilled as each minute's
/// line lands. Reads the log alone: nothing is measured twice.
/// </summary>
public sealed partial class MainWindow
{
    private sealed record PerfRow(string Time, double Cpu, double Gpu, double MemMb, double IoMbs, int Procs, int Surfaces, int Hidden, int Stalls, double HostWs, double Managed, double Alloc, string Rest);
    private static readonly Regex PerfHead = new(@"^(\d\d:\d\d:\d\d) cpu=([\d.]+)% gpu=([\d.]+)% mem=(\d+)M io=([\d.]+)M/s procs=(\d+) surfaces=(\d+)\(hidden (\d+)\) stalls=(\d+) host ws=(\d+)M managed=(\d+)M alloc=(\d+)M/min(.*)$", RegexOptions.Compiled);
    private StackPanel? _perfPanelHost;

    /// <summary>The last `max` lines of perf.log as rows, oldest first; a restart leaves a gap the chart shows as one.</summary>
    private static List<PerfRow> ReadPerfRows(int max)
    {
        var out2 = new List<PerfRow>();
        try
        {
            var path = System.IO.Path.Combine(HostPaths.Diagnostics, "perf.log");
            if (!File.Exists(path)) return out2;
            string[] lines;
            using (var fs = new System.IO.FileStream(path, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.ReadWrite | System.IO.FileShare.Delete))
            using (var r = new StreamReader(fs)) lines = r.ReadToEnd().Split('\n');
            foreach (var l in lines.Reverse())
            {
                if (out2.Count >= max) break;
                var m = PerfHead.Match(l.TrimEnd('\r'));
                if (!m.Success) continue;
                if (int.Parse(m.Groups[6].Value, CultureInfo.InvariantCulture) <= 1) continue;   // the first line after a start: the host alone, before any page
                double D(int i) => double.Parse(m.Groups[i].Value, CultureInfo.InvariantCulture);
                int I(int i) => int.Parse(m.Groups[i].Value, CultureInfo.InvariantCulture);
                out2.Add(new PerfRow(m.Groups[1].Value, D(2), D(3), D(4), D(5), I(6), I(7), I(8), I(9), D(10), D(11), D(12), m.Groups[13].Value));
            }
        }
        catch { }
        out2.Reverse();
        return out2;
    }

    /// <summary>One chart: the series over the rows, the latest value named; a second, dimmer series under the first when given.</summary>
    private static FrameworkElement Sparkline(string label, string unit, IReadOnlyList<double> a, IReadOnlyList<double>? b, double max, double w = 172, double h = 60)
    {
        var box = new StackPanel { Spacing = 3 };
        var last = a.Count > 0 ? a[^1] : 0;
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        head.Children.Add(new TextBlock { Text = label, FontSize = 12, Foreground = HubInk });
        head.Children.Add(new TextBlock { Text = (unit == "%" ? last.ToString("0.0") : unit == "GB" ? (last / 1024).ToString("0.00") : last.ToString("0.0")) + " " + unit, FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubAmber });
        if (b is { Count: > 0 }) head.Children.Add(new TextBlock { Text = "(host " + (unit == "GB" ? (b[^1] / 1024).ToString("0.00") : b[^1].ToString("0.0")) + ")", FontSize = 12, Foreground = HubInk, Opacity = 0.75 });
        box.Children.Add(head);
        var canvas = new Canvas { Width = w, Height = h, Background = HubChip };
        var top = Math.Max(max, Math.Max(a.DefaultIfEmpty(0).Max(), b?.DefaultIfEmpty(0).Max() ?? 0) * 1.1);
        if (top <= 0) top = 1;
        for (var g = 1; g <= 3; g++) canvas.Children.Add(new Microsoft.UI.Xaml.Shapes.Line { X1 = 0, X2 = w, Y1 = h * g / 4, Y2 = h * g / 4, Stroke = HubRule, StrokeThickness = 1 });
        PointCollection Points(IReadOnlyList<double> s)
        {
            var pts = new PointCollection();
            var n = Math.Max(1, s.Count - 1);
            for (var i = 0; i < s.Count; i++) pts.Add(new Windows.Foundation.Point(w * i / n, h - 2 - Math.Min(1, s[i] / top) * (h - 4)));
            return pts;
        }
        if (b is { Count: > 1 }) canvas.Children.Add(new Microsoft.UI.Xaml.Shapes.Polyline { Points = Points(b), Stroke = HubInk, StrokeThickness = 1.5, Opacity = 0.55 });
        if (a.Count > 1) canvas.Children.Add(new Microsoft.UI.Xaml.Shapes.Polyline { Points = Points(a), Stroke = HubAmber, StrokeThickness = 2 });
        box.Children.Add(canvas);
        return box;
    }

    /// <summary>The panel: the charts over the last hour and the last line's breakdown.</summary>
    private FrameworkElement BuildPerfPanel(bool compact)
    {
        var rows = ReadPerfRows(60);
        var panel = new StackPanel { Spacing = 10 };
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        var title = new TextBlock { Text = "Performance", FontSize = compact ? 17 : 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
        ToolTipService.SetToolTip(title, "The wall's cost, one reading a minute from diagnostics/perf.log: every process Prism runs (the host and each service's browser), CPU over all cores, GPU from Windows' per-process counters, working set, file and network IO together. Local only; nothing is sent anywhere.");
        head.Children.Add(title);
        if (rows.Count == 0) { head.Children.Add(new TextBlock { Text = "No readings yet. The first lands a minute after the wall starts.", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center }); panel.Children.Add(head); return panel; }
        var last = rows[^1];
        head.Children.Add(new TextBlock { Text = rows.Count + " min" + Mid + last.Procs + " processes" + Mid + last.Surfaces + " surfaces (" + last.Hidden + " hidden)" + (last.Stalls > 0 ? Mid + last.Stalls + " UI stall" + (last.Stalls == 1 ? "" : "s") + " last minute" : "") + Mid + "at " + last.Time, FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
        panel.Children.Add(head);
        var charts = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
        charts.Children.Add(Sparkline("CPU, all cores", "%", rows.Select(r => r.Cpu).ToList(), null, 25));
        charts.Children.Add(Sparkline("GPU", "%", rows.Select(r => r.Gpu).ToList(), null, 25));
        charts.Children.Add(Sparkline("Memory", "GB", rows.Select(r => r.MemMb).ToList(), rows.Select(r => r.HostWs).ToList(), 8192));
        charts.Children.Add(Sparkline("Downloads and disk", "MB/s", rows.Select(r => r.IoMbs).ToList(), null, 5));
        charts.Children.Add(Sparkline("Host allocation", "MB/min", rows.Select(r => r.Alloc).ToList(), rows.Select(r => r.Managed).ToList(), 200));
        panel.Children.Add(charts);
        // the last minute's split: each service's browser as a whole, then the costliest renderers with the surfaces they draw
        var parts = last.Rest.Split(" | ");
        if (parts.Length >= 2)
        {
            var by = new TextBlock { Text = "By service: " + parts[1].Replace("; ", Mid), FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
            ToolTipService.SetToolTip(by, "Each service's browser as a whole: its browser, GPU, utility and renderer processes. A service's video decoding lands in its GPU process, so the service is the honest unit.");
            panel.Children.Add(by);
        }
        if (parts.Length >= 3 && !compact)
            panel.Children.Add(new TextBlock { Text = "Busiest pages: " + parts[2].Replace("; ", Mid), FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        // the host's own line: what the brain answered, what the pages sent, what the host allocated
        var mTraffic = Regex.Match(last.Rest, @"calls=(\d+) (\d+)K \(([^)]*)\) events=(\d+) (\d+)K \(([^)]*)\)");
        var mTypes = Regex.Match(last.Rest, @"by type \(([^)]*)\)");
        if (mTraffic.Success && !compact)
            panel.Children.Add(new TextBlock { Text = "Host: " + last.HostWs.ToString("0") + " MB working set" + Mid + "brain answers " + mTraffic.Groups[1].Value + " a minute, " + (int.Parse(mTraffic.Groups[2].Value) / 1024.0).ToString("0.0") + " MB (" + mTraffic.Groups[3].Value + ")" + Mid + "page events " + mTraffic.Groups[4].Value + ", " + (int.Parse(mTraffic.Groups[5].Value) / 1024.0).ToString("0.0") + " MB" + (mTypes.Success ? Mid + "allocated by type: " + mTypes.Groups[1].Value : ""), FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        return panel;
    }

    /// <summary>The Watch page's panel, when the stats are on: at the foot of the rows, refilled each minute.</summary>
    private void AddPerfPanel(StackPanel rows)
    {
        if (!HostPrefs.GetBool("perf.panel", false)) { _perfPanelHost = null; return; }
        var host = new StackPanel { Margin = new Thickness(0, 18, 0, 8) };
        host.Children.Add(BuildPerfPanel(true));
        rows.Children.Add(host);
        _perfPanelHost = host;
    }
    private void RefreshPerfPanel()
    {
        if (_perfPanelHost is not { } host || !VideoHubOpen || _hubTab != "watch") return;
        try { host.Children.Clear(); host.Children.Add(BuildPerfPanel(true)); } catch { }
    }

    /// <summary>Watch settings' Performance tab: the stats switch, readers dark, and the panel itself.</summary>
    private Func<Task<List<string>>> BuildPerformanceTab(StackPanel body)
    {
        var statsBox = new CheckBox { Content = new TextBlock { Text = "Performance stats at the foot of the Watch page", FontSize = 14, Foreground = HubInk }, IsChecked = HostPrefs.GetBool("perf.panel", false), Margin = new Thickness(0, 8, 0, 0) };
        ToolTipService.SetToolTip(statsBox, "The charts below, kept at the foot of the Watch page and refilled each minute.");
        body.Children.Add(statsBox);
        var darkBox = new CheckBox { Content = new TextBlock { Text = "Readers dark: freeze idle hidden lookup pages", FontSize = 14, Foreground = HubInk }, IsChecked = HostPrefs.GetBool("perf.readersDark", false) };
        ToolTipService.SetToolTip(darkBox, "A hidden page Prism reads (a service's guide or catalog) that nothing has touched for ninety seconds is frozen - its scripts, timers and media stop - and woken before it is read again. Saves CPU and GPU for nobody; the music players are never frozen.");
        body.Children.Add(darkBox);
        body.Children.Add(new TextBlock { Text = "Every number here stays on this device. perf.log in the diagnostics folder holds the last hours as text.", FontSize = 12, Foreground = HubInk, Opacity = 0.8, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 6) });
        body.Children.Add(BuildPerfPanel(false));
        return () =>
        {
            var said = new List<string>();
            var stats = statsBox.IsChecked == true;
            if (stats != HostPrefs.GetBool("perf.panel", false)) { HostPrefs.Set("perf.panel", stats); said.Add("performance stats " + (stats ? "on" : "off")); if (VideoHubOpen) _ = ShowVideoHubAsync(); }
            var dark = darkBox.IsChecked == true;
            if (dark != HostPrefs.GetBool("perf.readersDark", false)) { SetReadersDark(dark); said.Add("readers " + (dark ? "dark" : "lit")); }
            return Task.FromResult(said);
        };
    }
}
