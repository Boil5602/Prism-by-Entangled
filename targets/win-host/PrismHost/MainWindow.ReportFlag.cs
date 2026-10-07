using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The report flag (docs/features/report-flag.md, 2026-10-06, "Can we add a bug report mechanism to the app? Preferably under a little flag
/// icon that appears in the same spot consistently. People need to be able to report if ads are on their screen, or if a bug is found ...
/// by a specific adapter, and whether on the music or video screen"; "we need to catch those reports in a queue online"). The flag sits at
/// the top-right corner on both players, always the same spot, fading with the other grips. Its form: what happened (ads on the screen,
/// something not working, something else), where (the Music player, the Video player, elsewhere), which service (or Prism itself), the
/// person's words, and two choices - the page's address, Prism's recent log. "What is sent" shows the exact report before Send. Reports go
/// to Entangled's report inbox (reports.entangled.world/v1/app-report), which keeps no IP and asks no identifier, into the open queue in its
/// private bucket (scripts/reports/app-reports.py). One that cannot be sent waits in the data folder's outbox and goes when it can.
/// </summary>
public sealed partial class MainWindow
{
    private const string ReportUrl = "https://reports.entangled.world/v1/app-report";
    private Border? _reportGrip;
    private static readonly HttpClient AppReportHttp = new() { Timeout = TimeSpan.FromSeconds(20) };
    private static string ReportOutbox => System.IO.Path.Combine(HostPaths.DataDir, "outbox");

    private void InitReportFlag()
    {
        var icon = new FontIcon { Glyph = ((char)0xE7C1).ToString(), FontSize = 14, Foreground = HubInk };
        var flag = Chip(icon, false);
        flag.Padding = new Thickness(8, 4, 8, 4);
        ToolTipService.SetToolTip(flag, "Report a problem or suggest something, or turn on Ad debug");
        flag.Click += (_, __) => ShowFlagMenu(flag);   // the report form and Ad debug (MainWindow.AdDebug.cs)
        var grip = new Border
        {
            VerticalAlignment = VerticalAlignment.Top, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 0, 18, 0),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xCC, 0x12, 0x13, 0x1A)), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x3A, 0xF0, 0xA8, 0x3C)),
            BorderThickness = new Thickness(1, 0, 1, 1), CornerRadius = new CornerRadius(0, 0, 10, 10), Padding = new Thickness(2, 0, 2, 2),
            Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, Children = { BuildUpdateButton(), flag } },   // the update, when there is one, beside the flag
        };
        Canvas.SetZIndex(grip, 1000);
        RootGrid.Children.Add(grip);
        _reportGrip = grip;
        // the Music|Video grip moves one place left, so the flag keeps the corner whatever the grip holds
        grip.SizeChanged += (_, __) => PlayerGrip.Margin = new Thickness(0, 0, 18 + grip.ActualWidth + 6, 0);
        // the outbox: a report that could not go is sent a minute after the start and every half hour
        var t = new DispatcherTimer { Interval = TimeSpan.FromMinutes(30) };
        t.Tick += (_, __) => _ = FlushReportOutboxAsync();
        t.Start();
        _ = Task.Delay(TimeSpan.FromMinutes(1)).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = FlushReportOutboxAsync()));
    }

    private async Task ShowReportFormAsync()
    {
        JsonObject? ctx = null;
        try { ctx = JsonNode.Parse(await ModelCallAsync("reportContext") ?? "null") as JsonObject; } catch (Exception e) { LogLine("report: " + e.Message); }
        var services = (ctx?["services"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var active = ctx?["active"]?.GetValue<string>();
        var selected = ctx?["selected"]?.GetValue<string>();

        TextBlock Label(string t) => new() { Text = t, Foreground = HubInk, FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Margin = new Thickness(0, 10, 0, 2) };
        RadioButton Radio(string text, string group, bool on) => new() { Content = new TextBlock { Text = text, Foreground = HubInk, FontSize = 14 }, GroupName = group, IsChecked = on, Margin = new Thickness(0, -4, 0, -4) };

        var body = new StackPanel { Spacing = 2, MaxWidth = 560 };
        // an idea too (2026-10-06, "Can we also make this window flexible enough to accept enhancement requests?")
        body.Children.Add(Label("What is it?"));
        var kAd = Radio("Ads are on my screen", "rk", false);
        var kBug = Radio("Something isn't working", "rk", true);
        var kIdea = Radio("An idea or an improvement", "rk", false);
        var kOther = Radio("Something else", "rk", false);
        body.Children.Add(kAd); body.Children.Add(kBug); body.Children.Add(kIdea); body.Children.Add(kOther);
        // an ad on a page: Veil's own report lets the person point at it and sends what it is made of, so Veil can learn to cover it
        var pointAt = new HyperlinkButton { Content = "Point at the ad on the wall instead (helps Veil learn to cover it)", Padding = new Thickness(28, 0, 0, 4), Visibility = Visibility.Collapsed };
        body.Children.Add(pointAt);
        kAd.Checked += (_, __) => pointAt.Visibility = Visibility.Visible;
        kBug.Checked += (_, __) => pointAt.Visibility = Visibility.Collapsed;
        kIdea.Checked += (_, __) => pointAt.Visibility = Visibility.Collapsed;
        kOther.Checked += (_, __) => pointAt.Visibility = Visibility.Collapsed;

        body.Children.Add(Label("Where?"));
        var pMusic = Radio("The Music player", "rp", active == "music");
        var pVideo = Radio("The Video player", "rp", active == "video");
        var pOther = Radio("Somewhere else in Prism", "rp", active is not ("music" or "video"));
        body.Children.Add(pMusic); body.Children.Add(pVideo); body.Children.Add(pOther);

        body.Children.Add(Label("Which service?"));
        var svc = new ComboBox { MinWidth = 320 };
        // the services of the player chosen above (2026-10-06, "can you filter the service list depending on if it is a music or video player
        // item?"): the Music player's for music, the Video player's for video, every one for elsewhere; Prism itself always first
        var wantApp = selected;
        void FillServices()
        {
            var keep = ((svc.SelectedItem as ComboBoxItem)?.Tag as JsonObject)?["app"]?.GetValue<string>() ?? wantApp;
            wantApp = null;
            var only = pMusic.IsChecked == true ? "music" : pVideo.IsChecked == true ? "video" : null;
            svc.Items.Clear();
            svc.Items.Add(new ComboBoxItem { Content = "Prism itself", Tag = null });
            foreach (var s in services.Where(x => only is null || (x["kind"]?.GetValue<string>() == "video" ? "video" : "music") == only).OrderBy(x => x["name"]?.GetValue<string>()))
            {
                var name = s["name"]?.GetValue<string>() ?? s["app"]?.GetValue<string>() ?? "";
                var item = new ComboBoxItem { Content = only is null ? name + "  " + (char)0x00B7 + "  " + (s["kind"]?.GetValue<string>() == "video" ? "video" : "music") : name, Tag = s };
                svc.Items.Add(item);
                if (s["app"]?.GetValue<string>() == keep) svc.SelectedItem = item;
            }
            if (svc.SelectedItem is null) svc.SelectedIndex = 0;
        }
        FillServices();
        foreach (var rb in new[] { pMusic, pVideo, pOther }) rb.Checked += (_, __) => FillServices();
        body.Children.Add(svc);

        var noteHead = Label("What did you see? What were you doing?");
        body.Children.Add(noteHead);
        var note = new TextBox { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, Height = 110, PlaceholderText = "For example: an ad played before the episode and Prism didn't cover it" };
        body.Children.Add(note);
        void Wording()
        {
            var idea = kIdea.IsChecked == true;
            noteHead.Text = idea ? "What would you like Prism to do?" : "What did you see? What were you doing?";
            note.PlaceholderText = idea ? "For example: let me pick the order of the services on the Watch screen" : kAd.IsChecked == true ? "For example: an ad played before the episode and Prism didn't cover it" : "For example: the song changed but the picture stayed on the last one";
        }
        foreach (var rb in new[] { kAd, kBug, kIdea, kOther }) rb.Checked += (_, __) => Wording();

        var withPage = new CheckBox { IsChecked = true, Margin = new Thickness(0, 6, 0, 0) };
        var withLog = new CheckBox { IsChecked = false, Content = new TextBlock { Text = "Include Prism's recent log", Foreground = HubInk, FontSize = 14 } };
        ToolTipService.SetToolTip(withLog, "What Prism did in the last few minutes: pages opened, what played, errors. Passwords, tokens and keys are never written to it.");
        body.Children.Add(withPage); body.Children.Add(withLog);

        var previewText = new TextBlock { Foreground = HubInk, FontSize = 12, FontFamily = new FontFamily("Consolas"), TextWrapping = TextWrapping.Wrap, Visibility = Visibility.Collapsed };
        var previewToggle = new HyperlinkButton { Content = "What is sent", Padding = new Thickness(0, 6, 0, 0) };
        previewToggle.Click += (_, __) => previewText.Visibility = previewText.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        body.Children.Add(previewToggle); body.Children.Add(previewText);
        body.Children.Add(new TextBlock { Text = "Sent to Entangled's report inbox (reports.entangled.world). It keeps no name, account, IP address or device id.", Foreground = HubInk, FontSize = 13, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 0) });

        JsonObject? Chosen() => (svc.SelectedItem as ComboBoxItem)?.Tag as JsonObject;
        string KindOf() => kAd.IsChecked == true ? "ad" : kIdea.IsChecked == true ? "idea" : kOther.IsChecked == true ? "other" : "bug";
        string PlayerOf() => pMusic.IsChecked == true ? "music" : pVideo.IsChecked == true ? "video" : "other";
        string? logTail = null;
        JsonObject Build(bool forPreview)
        {
            var s = Chosen();
            var page = s?["page"]?.GetValue<string>();
            var r = new JsonObject
            {
                ["kind"] = KindOf(), ["player"] = PlayerOf(),
                ["service"] = s?["app"]?.GetValue<string>() ?? "prism",
                ["adapter"] = s?["adapter"]?.GetValue<string>(), ["adapterVersion"] = s?["version"]?.GetValue<string>(),
                ["app"] = AppVersion.Text, ["track"] = Services.Updates.Channel,
                // Windows 11 reports itself as 10.0; its builds start at 22000
                ["os"] = (Environment.OSVersion.Version.Build >= 22000 ? "Windows 11" : "Windows 10") + " build " + Environment.OSVersion.Version.Build,
                ["webview"] = WebViewVersion(),
                ["note"] = note.Text.Trim(),
            };
            if (withPage.IsChecked == true && page is { Length: > 0 }) r["page"] = page;
            if (withLog.IsChecked == true) { logTail ??= ReadLogTail(); r["log"] = forPreview ? "(" + logTail.Split('\n').Length + " lines of host.log)" : logTail; }
            return r;
        }
        void Refresh()
        {
            var page = Chosen()?["page"]?.GetValue<string>();
            withPage.Visibility = page is { Length: > 0 } ? Visibility.Visible : Visibility.Collapsed;
            withPage.Content = new TextBlock { Text = "Include the page's address: " + page, Foreground = HubInk, FontSize = 14, TextWrapping = TextWrapping.Wrap };
            previewText.Text = Build(true).ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        }
        foreach (var rb in new[] { kAd, kBug, kIdea, kOther, pMusic, pVideo, pOther }) rb.Checked += (_, __) => Refresh();
        svc.SelectionChanged += (_, __) => Refresh();
        withPage.Checked += (_, __) => Refresh(); withPage.Unchecked += (_, __) => Refresh();
        withLog.Checked += (_, __) => Refresh(); withLog.Unchecked += (_, __) => Refresh();
        Refresh();

        var dlg = new ContentDialog
        {
            Title = "Report a problem or suggest something",
            Content = new ScrollViewer { Content = body, MaxHeight = 620, VerticalScrollBarVisibility = ScrollBarVisibility.Auto },
            PrimaryButtonText = "Send",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            IsPrimaryButtonEnabled = false,
            XamlRoot = RootGrid.XamlRoot,
            RequestedTheme = ElementTheme.Dark,
        };
        note.TextChanged += (_, __) => { dlg.IsPrimaryButtonEnabled = note.Text.Trim().Length > 0; Refresh(); };
        var pointed = false;
        pointAt.Click += (_, __) => { pointed = true; dlg.Hide(); };
        try { if (await dlg.ShowAsync() != ContentDialogResult.Primary) { if (pointed) StartReportPick(); return; } } catch { return; }

        var report = Build(false).ToJsonString();
        LogLine("report: " + KindOf() + " on the " + PlayerOf() + " player for " + (Chosen()?["app"]?.GetValue<string>() ?? "prism"));
        SetPill("Prism" + Mid + "sending your report" + (char)0x2026, hold: true);
        if (await SendReportAsync(report)) { ReleasePill("Prism" + Mid + "thanks, your report is in"); _ = FlushReportOutboxAsync(); return; }
        try
        {
            System.IO.Directory.CreateDirectory(ReportOutbox);
            System.IO.File.WriteAllText(System.IO.Path.Combine(ReportOutbox, "report-" + DateTime.UtcNow.ToString("yyyyMMddHHmmssfff") + ".json"), report, new UTF8Encoding(false));
            ReleasePill("Prism" + Mid + "your report is saved, and Prism sends it when it can reach the inbox");
        }
        catch (Exception e) { LogLine("report: outbox " + e.Message); ReleasePill("Prism" + Mid + "the report could not be sent or saved"); }
    }

    private static async Task<bool> SendReportAsync(string json)
    {
        try
        {
            using var r = await AppReportHttp.PostAsync(ReportUrl, new StringContent(json, Encoding.UTF8, "application/json"));
            return (int)r.StatusCode is 204 or 200;
        }
        catch { return false; }
    }

    /// <summary>The outbox: each saved report sent once more; one the inbox refuses as malformed (400) is set aside, never retried forever.</summary>
    private async Task FlushReportOutboxAsync()
    {
        try
        {
            if (!System.IO.Directory.Exists(ReportOutbox)) return;
            foreach (var f in System.IO.Directory.GetFiles(ReportOutbox, "report-*.json"))
            {
                var json = await System.IO.File.ReadAllTextAsync(f);
                if (await SendReportAsync(json)) { System.IO.File.Delete(f); LogLine("report: a saved report went to the inbox"); }
                else break;   // the inbox still out of reach: the rest wait too
            }
        }
        catch (Exception e) { LogLine("report: outbox " + e.Message); }
    }

    /// <summary>The last part of host.log, whole lines, about 24 KB; each line passed through the redactor again (B-91).</summary>
    private static string ReadLogTail()
    {
        try
        {
            var path = System.IO.Path.Combine(HostPaths.DataDir, "diagnostics", "host.log");
            using var fs = new System.IO.FileStream(path, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.ReadWrite | System.IO.FileShare.Delete);
            var take = (int)Math.Min(fs.Length, 24_000);
            fs.Seek(-take, System.IO.SeekOrigin.End);
            var buf = new byte[take];
            var n = fs.Read(buf, 0, take);
            var text = Encoding.UTF8.GetString(buf, 0, n);
            var nl = text.IndexOf('\n');
            if (nl >= 0 && take < fs.Length) text = text[(nl + 1)..];
            return string.Join("\n", text.Split('\n').Select(l => PrismHost.Diagnostics.Redact.Line(l)));
        }
        catch { return ""; }
    }

    private static string WebViewVersion()
    {
        try { return Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString(null) ?? ""; } catch { return ""; }
    }
}
