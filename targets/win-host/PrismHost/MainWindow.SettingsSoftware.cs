using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// This Prism on Watch settings' Updates tab (2026-10-15, "The updates tab lost the ability to run updates and no longer shows the change
/// log"): Prism's own version, what the update server offers, Check now, Install now, Restart into the new version and What's changed, as
/// the phone's Updates panel has them, and below it the track, the schedule and the update server (UpdateChoiceParts, shared with the
/// Updates window in MainWindow.Updates.cs).
/// </summary>
public sealed partial class MainWindow
{
    private void BuildSoftwareSection(StackPanel body, int run)
    {
        var ell = ((char)0x2026).ToString();
        body.Children.Add(new TextBlock { Text = "This Prism", FontSize = 17, Foreground = HubInk });
        var running = new TextBlock { FontSize = 18, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        var line = new TextBlock { FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        var verbs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        var check = Chip(new TextBlock { Text = "Check now", FontSize = 15, Foreground = HubInk }, false);
        var install = Chip(new TextBlock { Text = "Install now", FontSize = 15, Foreground = HubAmber }, true);
        var restart = Chip(new TextBlock { Text = "Restart into the new version", FontSize = 15, Foreground = HubAmber }, true);
        var logText = new TextBlock { Text = "What's changed", FontSize = 15, Foreground = HubInk };
        var showLog = Chip(logText, false);
        verbs.Children.Add(check); verbs.Children.Add(install); verbs.Children.Add(restart); verbs.Children.Add(showLog);
        var log = new StackPanel { Spacing = 14, Visibility = Visibility.Collapsed, Margin = new Thickness(0, 6, 0, 0) };
        body.Children.Add(running); body.Children.Add(line); body.Children.Add(verbs); body.Children.Add(log);
        // the track, the schedule and the update server here, not behind a button to another window (2026-10-15, "Plenty of room in the
        // watch settings screen"): each a card of its own
        var (checking, fork) = UpdateChoiceParts(t => line.Text = t, () => { if (run == _settingsRun) Draw(); });
        body.Children.Add(new TextBlock { Text = "Checking for updates", FontSize = 17, Foreground = HubInk });
        body.Children.Add(checking);
        body.Children.Add(fork);

        void DrawLog()
        {
            log.Children.Clear();
            var st = _updateStatus;
            var src = (st?["available"] as JsonObject) ?? (st?["latest"] as JsonObject);
            var current = st?["currentVersion"]?.GetValue<string>() ?? AppVersion.Text;
            var list = new List<(string v, string d, string n)>();
            if (src?["history"] is JsonArray hs)
                foreach (var h in hs.OfType<JsonObject>())
                    if (h["version"]?.GetValue<string>() is { } hv && h["notes"]?.GetValue<string>() is { } hn) list.Add((hv, h["date"]?.GetValue<string>() ?? "", hn));
            if (list.Count == 0 && src?["version"]?.GetValue<string>() is { } sv && src["notes"]?.GetValue<string>() is { Length: > 0 } sn) list.Add((sv, src["date"]?.GetValue<string>() ?? "", sn));
            if (list.Count == 0) { log.Children.Add(new TextBlock { Text = "The update server hasn't sent a changelog yet. Check now asks it.", FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap }); return; }
            foreach (var (v, d, n) in list)
            {
                var cmp = CompareVersions(v, current);
                var head = "Prism " + v + (DateTime.TryParse(d, out var dd) ? Mid + dd.ToString("MMM d") : "") + (cmp > 0 ? Mid + "New" : cmp == 0 ? Mid + "Running now" : "");
                var item = new StackPanel { Spacing = 4, Padding = new Thickness(0, 0, 0, 14), BorderThickness = new Thickness(0, 0, 0, 1), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x30, 0xFF, 0xFF, 0xFF)) };
                item.Children.Add(new TextBlock { Text = head, FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = cmp > 0 ? HubAmber : HubInk });
                item.Children.Add(new TextBlock { Text = n, FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
                log.Children.Add(item);
            }
        }
        void Draw()
        {
            var st = _updateStatus;
            var av = st?["available"] as JsonObject;
            var staged = Services.Updates.Staged();
            var last = st?["lastCheck"]?.GetValue<string>();
            var res = st?["lastResult"]?.GetValue<string>();
            var when = last is { Length: > 0 } && DateTime.TryParse(last, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt) ? dt.ToLocalTime().ToString("ddd HH:mm") : "never";
            running.Text = "Prism " + AppVersion.Text + " on the " + Services.Updates.TrackLabel(Services.Updates.Channel) + " track";
            line.Text = staged is { } s2 ? "Prism " + s2.version + " is installed and runs at the next start."
                : av is not null ? "Prism " + (av["version"]?.GetValue<string>() ?? "?") + " is ready to install. Last check " + when + "."
                : res is "unreachable" ? "The update server could not be reached. Last tried " + when + "."
                : res is "invalid" ? "The update server's answer did not verify, so nothing was taken from it. Last tried " + when + "."
                : last is { Length: > 0 } ? "This is the newest version on the " + Services.Updates.TrackLabel(Services.Updates.Channel) + " track. Last check " + when + "."
                : "Not checked yet. Prism checks on its schedule, and Check now asks right away.";
            install.Visibility = av is not null && staged is null ? Visibility.Visible : Visibility.Collapsed;
            restart.Visibility = staged is not null ? Visibility.Visible : Visibility.Collapsed;
            DrawLog();
        }
        check.Click += async (_, __) => { line.Text = "Checking" + ell; try { _updateStatus = JsonNode.Parse(await ModelCallAwaitAsync("updateCheck", 30_000) ?? "null") as JsonObject; } catch { } if (run == _settingsRun) Draw(); };
        install.Click += async (_, __) =>
        {
            line.Text = "Downloading and checking" + ell + " The status line says how far."; install.IsEnabled = false;
            try { _updateStatus = JsonNode.Parse(await ModelCallAwaitAsync("updateInstallNow", 15 * 60_000) ?? "null") as JsonObject; } catch { }
            install.IsEnabled = true; if (run == _settingsRun) Draw();
        };
        restart.Click += (_, __) => RestartIntoStaged();
        showLog.Click += (_, __) => { var on = log.Visibility != Visibility.Visible; log.Visibility = on ? Visibility.Visible : Visibility.Collapsed; logText.Text = on ? "Hide what's changed" : "What's changed"; };
        Draw();
        _ = ((Func<Task>)(async () => { await PollUpdateStatusAsync(); if (run == _settingsRun) Draw(); }))();
    }
}
