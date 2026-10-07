using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The ad report's panel (2026-09-26, "Fix the report payload in the extension and the Windows app so it matches what the user is told. By default
/// send only the site's domain, the element details, the kind of ad, the note, and the version. Send the full page address only if the user ticks
/// 'Include the full page address,' and drop the embedded video addresses unless that box is ticked. Update the toast to list exactly what's sent"):
/// picking a window no longer sends at once. The panel says what will be sent, and that is all that is sent.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _reportPanel;
    private static readonly (string id, string label)[] AdKinds =
        { ("video", "Video ad"), ("display", "Banner or display ad"), ("sponsored", "Sponsored post or result"), ("popup", "Pop-up"), ("other", "Something else") };

    private void CloseReportPanel()
    {
        if (_reportPanel is null) return;
        RootGrid.Children.Remove(_reportPanel);
        _reportPanel = null;
    }

    private static string ReportWhatSent(string site, bool full) =>
        "Sends the site (" + (site.Length > 0 ? site : "this window's site") + "), the ad's details in the window (which known ad signs show, and the player's type and size), " +
        "the kind of ad, your note if you write one, and Prism's version" +
        (full ? ", plus the full page address and the addresses of the video players embedded in the page" : "") + ". No page text, no account, no cookies.";

    /// <summary>After the window is picked: probe it, then show what will be sent, with the kind, a note and the full-address box.</summary>
    private async void ShowReportPanel(string tileId)
    {
        CloseReportPanel();
        var url = _surfaces.SourceOf(tileId) ?? "";
        var site = "";
        try { site = new Uri(url).Host; } catch { }
        JsonElement? probe = null;
        string? probeNote = null;
        try
        {
            var raw = await _surfaces.EvalOnTileAsync(tileId, ReportProbeJs);
            if (raw is not null && raw.StartsWith("__prism_eval_error")) probeNote = raw;
            else if (raw == "null") probeNote = "script evaluated to null (in-page exception?)";
            else if (raw is not null)
            {
                using var outer = JsonDocument.Parse(raw);
                var inner = outer.RootElement.ValueKind == JsonValueKind.String ? outer.RootElement.GetString()! : raw;
                probe = JsonSerializer.Deserialize<JsonElement>(inner);
            }
        }
        catch (Exception ex) { probeNote = "probe failed: " + ex.GetType().Name; }

        // the kind, guessed from the signs the probe found: a player's ad signs are a video ad, a display slot a banner
        var kind = "video";
        if (probe is { } pj && pj.TryGetProperty("signals", out var sg) && sg.ValueKind == JsonValueKind.Object)
        {
            var names = sg.EnumerateObject().Select(o => o.Name).ToList();
            if (names.Count > 0 && names.All(n => n is "gpt-slot" or "yt-feed-ad" or "prism-veil-cover")) kind = names.Contains("yt-feed-ad") ? "sponsored" : "display";
        }

        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xC8, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 970);
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; CloseReportPanel(); SetPill("Prism \u00b7 report discarded"); };
        scrim.KeyboardAccelerators.Add(esc);
        scrim.PointerPressed += (_, __) => { CloseReportPanel(); SetPill("Prism \u00b7 report discarded"); };
        var body = new StackPanel { Spacing = 12, Margin = new Thickness(26, 22, 26, 22) };
        var card = new Border
        {
            Background = HubCard, CornerRadius = new CornerRadius(14), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x55, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(1),
            Width = 620, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Child = body,
        };
        card.PointerPressed += (_, e) => e.Handled = true;
        scrim.Children.Add(card);

        body.Children.Add(new TextBlock { Text = "Report the ad" + (site.Length > 0 ? " on " + site : ""), FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });

        body.Children.Add(new TextBlock { Text = "Kind of ad", FontSize = 13, Foreground = HubInk });
        var kindRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        for (var i = 0; i < AdKinds.Length; i++)
        {
            var (id, label) = AdKinds[i];
            var b = Chip(new TextBlock { Text = label, FontSize = 12, Foreground = HubInk }, id == kind);
            b.Tag = id;
            b.Click += (s, __) => { kind = (string)((Button)s).Tag; foreach (var o in kindRow.Children.OfType<Button>()) o.Background = (string)o.Tag == kind ? HubChipOn : HubChip; };
            kindRow.Children.Add(b);
        }
        body.Children.Add(new ScrollViewer { Content = kindRow, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled });

        var note = new TextBox { PlaceholderText = "A note (optional)", MaxLength = 280, FontSize = 13 };
        body.Children.Add(note);
        var full = new CheckBox { Content = new TextBlock { Text = "Include the full page address", FontSize = 13, Foreground = HubInk } };
        body.Children.Add(full);
        var what = new TextBlock { FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, Text = ReportWhatSent(site, false) };
        full.Checked += (_, __) => what.Text = ReportWhatSent(site, true);
        full.Unchecked += (_, __) => what.Text = ReportWhatSent(site, false);
        body.Children.Add(what);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var send = Chip(new TextBlock { Text = "Send to Prism", FontSize = 13, Foreground = HubAmber }, true);
        var cancel = Chip(new TextBlock { Text = "Cancel", FontSize = 13, Foreground = HubInk }, false);
        send.Click += (_, __) => { var n = (note.Text ?? "").Trim(); var f = full.IsChecked == true; CloseReportPanel(); _ = SendReportAsync(tileId, site, url, probe, probeNote, kind, n, f); };
        cancel.Click += (_, __) => { CloseReportPanel(); SetPill("Prism \u00b7 report discarded"); };
        row.Children.Add(send); row.Children.Add(cancel);
        body.Children.Add(row);

        RootGrid.Children.Add(scrim);
        _reportPanel = scrim;
        scrim.Loaded += (_, __) => note.Focus(FocusState.Programmatic);
    }

    /// <summary>
    /// After Not an ad (2026-10-06, "Can they have the option of reporting it? If not, how does it help"): the correction already tunes this PC;
    /// a report lets Prism's makers see the mistake and fix it for everyone. The panel says exactly what goes: the channel, Prism's readings of the
    /// last forty seconds (its chance of a break and why), a note, and the version. No picture, no account, no page address.
    /// </summary>
    private void ShowNotAdReport(string tileId, string channel, List<string> readings)
    {
        CloseReportPanel();
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xC8, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 970);
        scrim.PointerPressed += (_, __) => CloseReportPanel();
        var body = new StackPanel { Spacing = 12, Margin = new Thickness(26, 22, 26, 22) };
        var card = new Border
        {
            Background = HubCard, CornerRadius = new CornerRadius(14), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x55, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(1),
            Width = 620, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Child = body,
        };
        card.PointerPressed += (_, e) => e.Handled = true;
        scrim.Children.Add(card);
        body.Children.Add(new TextBlock { Text = "Covered by mistake", FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
        body.Children.Add(new TextBlock { Text = "The cover is off, and Prism won't cover " + (channel.Length > 0 ? channel : "this channel") + " again for five minutes. You can also tell us, so we can fix it for everyone.", FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        var note = new TextBox { PlaceholderText = "What was on (optional)", MaxLength = 280, FontSize = 13 };
        body.Children.Add(note);
        if (channel.Length > 0)
        {
            var never = new CheckBox { Content = new TextBlock { Text = "Never cover " + channel, FontSize = 13, Foreground = HubInk }, MinWidth = 0 };
            never.Checked += (_, __) => SetChannelOff(channel, true);
            never.Unchecked += (_, __) => SetChannelOff(channel, false);
            body.Children.Add(never);
        }
        body.Children.Add(new TextBlock { Text = "Sends the channel" + (channel.Length > 0 ? " (" + channel + ")" : "") + ", what Prism read over the last forty seconds (how sure it was of a break and why), your note if you write one, and Prism's version. No picture, no account, no page address.", FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var send = Chip(new TextBlock { Text = "Send report", FontSize = 13, Foreground = HubAmber }, true);
        var skip = Chip(new TextBlock { Text = "Not now", FontSize = 13, Foreground = HubInk }, false);
        send.Click += (_, __) =>
        {
            var n = (note.Text ?? "").Trim();
            CloseReportPanel();
            var probe = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(new { signals = new { channel, readings } }));
            _ = SendReportAsync(tileId, "tv.youtube.com", "", probe, null, "not-an-ad", n, false);
        };
        skip.Click += (_, __) => CloseReportPanel();
        row.Children.Add(send); row.Children.Add(skip);
        body.Children.Add(row);
        RootGrid.Children.Add(scrim);
        _reportPanel = scrim;
    }
}
