using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Watch settings (2026-09-24, "I think TMDB and the pause will both need to get moved into a settings screen"): the gear on the Watch header.
/// Tabs ("I'd recommend moving Background Updates to a tab on the settings modal. More will come"): General - the TMDB key; Content updates -
/// a live grid of what is read in the background and its status ("we're supposed to just assume it is all included"), Refresh now for all or one
/// service, and the pause of the scheduled updates (off by default; its tooltip says what it covers and what it does not).
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _settingsWin;
    private string _settingsTab = "general";
    private int _settingsRun;

    public void CloseWatchSettings()
    {
        _settingsRun++;
        if (_settingsWin is null) return;
        RootGrid.Children.Remove(_settingsWin);
        _settingsWin = null;
    }

    public async Task ShowWatchSettingsAsync(string? tab = null)
    {
        if (tab is not null) _settingsTab = tab;
        JsonObject? v = null;
        try { v = JsonNode.Parse(await ModelCallAsync("videoSettings") ?? "null") as JsonObject; } catch (Exception e) { LogLine("settings: " + e.Message); }
        if (v is null) { SetPill("Prism" + Dot + "settings could not be read"); return; }
        CloseWatchSettings();
        var run = ++_settingsRun;
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xD8, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 960);
        scrim.PointerPressed += (_, __) => CloseWatchSettings();
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; CloseWatchSettings(); };
        scrim.KeyboardAccelerators.Add(esc);
        var body = new StackPanel { Spacing = 14, Margin = new Thickness(32, 26, 32, 26) };
        var card = new Border
        {
            Background = HubCard, CornerRadius = new CornerRadius(14), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x55, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(1),
            Width = 980, MaxHeight = 900, Margin = new Thickness(60, 40, 60, 40), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            Child = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled },
        };
        card.PointerPressed += (_, e) => e.Handled = true;
        scrim.Children.Add(card);

        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(new TextBlock { Text = "Watch settings", FontSize = 26, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
        var close = Chip(new FontIcon { Glyph = "\uE711", FontSize = 13 }, false);
        ToolTipService.SetToolTip(close, "Close without changing anything (Esc)");
        close.Click += (_, __) => CloseWatchSettings();
        Grid.SetColumn(close, 1);
        head.Children.Add(close);
        body.Children.Add(head);

        // the tabs
        var tabs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 22 };
        foreach (var (id, label) in new[] { ("general", "General"), ("updates", "Content updates"), ("binge", "The Binge"), ("hidden", "Hidden titles"), ("perf", "Performance") })
        {
            var on = _settingsTab == id;
            var t = new Button { Content = new TextBlock { Text = label, FontSize = 17, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = on ? HubAmber : HubDim }, Background = HubClear, BorderThickness = new Thickness(0, 0, 0, on ? 2 : 0), BorderBrush = HubAmber, Padding = new Thickness(0, 0, 0, 4) };
            var id2 = id;
            t.Click += (_, __) => { if (_settingsTab != id2) { _settingsTab = id2; _ = ShowWatchSettingsAsync(); } };
            tabs.Children.Add(t);
        }
        body.Children.Add(tabs);

        // the Save & exit of each tab gathers its own changes
        Func<Task<List<string>>> saveTab;
        if (_settingsTab == "updates") saveTab = BuildUpdatesTab(body, v, run);
        else if (_settingsTab == "binge") saveTab = BuildBingeTab(body);
        else if (_settingsTab == "hidden") saveTab = BuildHiddenTab(body);
        else if (_settingsTab == "perf") saveTab = BuildPerformanceTab(body);   // the stats (2026-10-03)
        else saveTab = BuildGeneralTab(body, v);

        var foot = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 0, 0) };
        var cancel = Chip(new TextBlock { Text = "Cancel", FontSize = 14, Foreground = HubInk }, false);
        cancel.Click += (_, __) => CloseWatchSettings();
        var save = Chip(new TextBlock { Text = "Save & exit", FontSize = 14, Foreground = HubAmber }, true);
        save.Click += async (_, __) =>
        {
            var said = await saveTab();
            CloseWatchSettings();
            if (said.Count > 0) SetPill("Prism" + Dot + string.Join(Dot, said));
        };
        foot.Children.Add(cancel); foot.Children.Add(save);
        body.Children.Add(foot);

        RootGrid.Children.Add(scrim);
        _settingsWin = scrim;
        scrim.Loaded += (_, __) => scrim.Focus(FocusState.Programmatic);
    }

    /// <summary>General: the TMDB key.</summary>
    private Func<Task<List<string>>> BuildGeneralTab(StackPanel body, JsonObject v)
    {
        var hasKey = v["tmdbKey"]?.GetValue<bool>() == true;
        var tmdbHead = new TextBlock { Text = "TMDB key", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 6, 0, 0) };
        ToolTipService.SetToolTip(tmdbHead, "Optional: your own free TMDB account's API key (personal use), kept on this device and sent to TMDB alone. It turns on ratings on cards (TMDB members' mean vote with the vote count), the catalog rows, Browse, the catalog search and the Episodes list for services that cannot list their own.");
        body.Children.Add(tmdbHead);
        body.Children.Add(new TextBlock { Text = hasKey ? "Set. Ratings, the catalog rows and search are on." : "Not set. Get a free personal key at themoviedb.org " + (char)0x2192 + " Settings " + (char)0x2192 + " API.", FontSize = 13, Foreground = hasKey ? HubAmber : HubDim });
        var keyRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var keyBox = new PasswordBox { PlaceholderText = hasKey ? "Replace the key (optional)" : "TMDB API key or read access token", Width = 380, FontSize = 13 };
        keyRow.Children.Add(keyBox);
        if (hasKey)
        {
            var clear = Chip(new TextBlock { Text = "Clear the key", FontSize = 13, Foreground = HubDim }, false);
            clear.Click += async (_, __) => { await ModelCallAsync("lensSetTmdbKey", (string?)null); SetPill("Prism" + Dot + "TMDB key cleared"); await ShowWatchSettingsAsync(); if (VideoHubOpen) _ = ShowVideoHubAsync(); };
            keyRow.Children.Add(clear);
        }
        body.Children.Add(keyRow);
        // Video ads (2026-10-07, "In watch settings, lets add 3 options for Video Ads: Show, Muted (Picture visible) and Veiled and Muted.
        // Default to Veiled."): how the Video player's breaks look, from the next break on
        var adsHead = new TextBlock { Text = "Video ads", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 14, 0, 0) };
        ToolTipService.SetToolTip(adsHead, "What a window shows while an ad plays. Prism never blocks or skips an ad. Music services keep their own cover.");
        body.Children.Add(adsHead);
        var look = v["adsLook"]?.GetValue<string>() ?? "veil";
        var adsRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
        RadioButton Look(string label, string value, string tip)
        {
            var r = new RadioButton { Content = new TextBlock { Text = label, FontSize = 14, Foreground = HubInk }, GroupName = "videoAds", IsChecked = look == value, Tag = value, MinWidth = 0 };
            ToolTipService.SetToolTip(r, tip);
            adsRow.Children.Add(r);
            return r;
        }
        var looks = new[]
        {
            Look("Veiled and muted", "veil", "The ad is covered with a picture and its sound is off. Show ad 15s lets you see it."),
            Look("Muted, picture visible", "mute", "You see the ad with its sound off. An Unmute button on the window brings the sound back for that ad."),
            Look("Show", "show", "The ad plays as it comes, picture and sound."),
        };
        body.Children.Add(adsRow);
        var acct = new StackPanel();   // the account under the key, filled as core answers (MainWindow.TmdbAccount.cs, 2026-10-03)
        body.Children.Add(acct);
        _ = BuildTmdbAccountAsync(acct, hasKey);
        return async () =>
        {
            var said = new List<string>();
            var chosen = looks.FirstOrDefault(r => r.IsChecked == true)?.Tag as string ?? look;
            if (chosen != look)
            {
                await ModelCallAsync("videoSetAdsLook", chosen);
                LogLine("video ads: " + chosen);
                said.Add(chosen == "veil" ? "ads are veiled and muted" : chosen == "mute" ? "ads are muted with the picture visible" : "ads are shown");
            }
            var key = keyBox.Password?.Trim() ?? "";
            if (key.Length == 0) return said;
            await ModelCallAsync("lensSetTmdbKey", key);
            if (VideoHubOpen) _ = ShowVideoHubAsync();
            // the account's approval asked for right away (2026-10-03, "Can we ask for this approval right when they enter the account info? That
            // way it's possibly still logged in on whatever device they're going through, like their phone"): the card with the QR comes up
            // as the settings close, unless the account is linked already
            RootGrid.DispatcherQueue.TryEnqueue(async () =>
            {
                await Task.Delay(300);
                var st = await TmdbLinkStateAsync();
                if (st?["linked"]?.GetValue<bool>() == true) return;
                await ModelCallAsync("tmdbLinkStart"); await ShowTmdbApprovalAsync();
            });
            said.Add("TMDB key saved");
            return said;
        };
    }

    /// <summary>Content updates: the schedule and its pause, Refresh now, and a live grid of every service's parts and the catalog rows.</summary>
    private Func<Task<List<string>>> BuildUpdatesTab(StackPanel body, JsonObject v, int run)
    {
        var pause = v["pause"] as JsonObject;
        // the schedule and its pause
        var schedHead = new TextBlock { Text = "Scheduled updates", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 6, 0, 0) };
        ToolTipService.SetToolTip(schedHead, ScheduleScope);
        body.Children.Add(schedHead);
        var schedLine = new TextBlock { FontSize = 13, Foreground = HubDim, TextWrapping = TextWrapping.Wrap };
        body.Children.Add(schedLine);
        var pauseRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var pauseBox = new CheckBox { Content = new TextBlock { Text = "Pause scheduled content updates from", FontSize = 14, Foreground = HubInk }, IsChecked = pause?["on"]?.GetValue<bool>() == true, VerticalAlignment = VerticalAlignment.Center };
        ToolTipService.SetToolTip(pauseBox, ScheduleScope);
        var fromBox = new TextBox { Text = pause?["from"]?.GetValue<string>() ?? "23:00", Width = 80, FontSize = 14, VerticalAlignment = VerticalAlignment.Center };
        var toBox = new TextBox { Text = pause?["to"]?.GetValue<string>() ?? "07:00", Width = 80, FontSize = 14, VerticalAlignment = VerticalAlignment.Center };
        pauseRow.Children.Add(pauseBox); pauseRow.Children.Add(fromBox);
        pauseRow.Children.Add(new TextBlock { Text = "to", FontSize = 14, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
        pauseRow.Children.Add(toBox);
        pauseRow.Children.Add(new TextBlock { Text = "(24-hour, this device's time)", FontSize = 12, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center });
        body.Children.Add(pauseRow);
        var all = Chip(new TextBlock { Text = "Refresh everything now", FontSize = 13, Foreground = HubInk }, false);
        ToolTipService.SetToolTip(all, "Every service's lists, profiles page and Continue Watching read again now (not the owned libraries' long walks).");
        all.Click += async (_, __) => { await ModelCallAsync("videoRefreshLists", true); SetPill("Prism" + Dot + "reading every service's lists"); };
        body.Children.Add(all);
        body.Children.Add(HideOfflineBox(14));   // the Followed channels rows' setting, here too: with every channel offline the row and its box are hidden
        var watchBox = new CheckBox { Content = new TextBlock { Text = "Cover breaks on YouTube TV channels", FontSize = 14, Foreground = HubInk }, IsChecked = BreakWatchOn, MinWidth = 0 };
        ToolTipService.SetToolTip(watchBox, "YouTube TV doesn't say when a channel's commercials play. Prism watches the picture instead: the channel's logo, cuts to black and web addresses or phone numbers on screen. It covers a break it's sure of. Everything is read on this PC.");
        watchBox.Checked += (_, __) => { HostPrefs.Set("video.breakWatch", true); LogLine("break watch: on"); };
        watchBox.Unchecked += (_, __) => { HostPrefs.Set("video.breakWatch", false); LogLine("break watch: off"); };
        body.Children.Add(watchBox);
        // the channels the person turned off (the cover card's Never cover): each one here to cover again
        var offRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(28, 0, 0, 0) };
        void DrawOff()
        {
            offRow.Children.Clear();
            var off = ChannelsOff();
            if (off.Count == 0) { offRow.Visibility = Visibility.Collapsed; return; }
            offRow.Visibility = Visibility.Visible;
            offRow.Children.Add(new TextBlock { Text = "Never covered:", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
            foreach (var ch in off)
            {
                var chip = Chip(new TextBlock { Text = ch + "  \u00D7", FontSize = 12, Foreground = HubInk }, false);
                ToolTipService.SetToolTip(chip, "Cover " + ch + "'s breaks again");
                chip.Click += (_, __) => { SetChannelOff(ch, false); DrawOff(); };
                offRow.Children.Add(chip);
            }
        }
        DrawOff();
        body.Children.Add(offRow);

        // the grid: one row per service
        body.Children.Add(new TextBlock { Text = "Your services", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 12, 0, 0) });
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 8 };
        foreach (var w in new[] { 190.0, 190, 170, 170, 100 }) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(w) });
        body.Children.Add(grid);
        body.Children.Add(new TextBlock { Text = "Catalog rows and ratings", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 12, 0, 0) });
        var feeds = new Grid { ColumnSpacing = 16, RowSpacing = 8 };
        foreach (var w in new[] { 260.0, 170, 190, 200 }) feeds.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(w) });
        body.Children.Add(feeds);
        _ = FollowUpdatesAsync(run, grid, feeds, schedLine);

        return async () =>
        {
            var r = JsonNode.Parse(await ModelCallAsync("videoSetPause", pauseBox.IsChecked == true, fromBox.Text?.Trim() ?? "", toBox.Text?.Trim() ?? "") ?? "null") as JsonObject;
            var p = r?["pause"] as JsonObject;
            return new List<string> { p?["on"]?.GetValue<bool>() == true ? "scheduled updates pause " + p["from"] + "-" + p["to"] : "scheduled updates run at all hours" };
        };
    }

    private static readonly string ScheduleScope =
        "Scheduled content updates: every 20 minutes while the wall is quiet, each service's Continue Watching, My List and profiles page are read again on hidden pages, "
        + "and every 6 hours the owned libraries (Fandango at Home, Movies Anywhere) are walked. A pause holds only these.\n\n"
        + "These still run during a pause, because you or Watch start them: Refresh now; opening Watch (a service not read in 10 minutes); half a minute after a title stops; "
        + "a profile switch; a My List add or remove; opening Library (owned libraries more than 3 hours old). The catalog rows (Most read, New episodes, New movies) "
        + "and the ratings are read when Watch asks for them, on their own 6- to 24-hour cache.";

    /// <summary>The Content updates tab kept live while it is open: the grid drawn again every two seconds from core's status.</summary>
    private async Task FollowUpdatesAsync(int run, Grid grid, Grid feeds, TextBlock schedLine)
    {
        while (run == _settingsRun)   // (the window is attached a moment after the tab is built: the run alone says it is still open)
        {
            JsonObject? st = null;
            try { st = JsonNode.Parse(await ModelCallAsync("videoUpdatesStatus") ?? "null") as JsonObject; } catch { }
            if (run != _settingsRun) return;
            if (st is not null) DrawUpdatesGrid(st, grid, feeds, schedLine);
            await Task.Delay(2000);
        }
    }

    private void DrawUpdatesGrid(JsonObject st, Grid grid, Grid feeds, TextBlock schedLine)
    {
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        string Ago(JsonNode? at)
        {
            if (at is not JsonValue v || !v.TryGetValue<double>(out var ms) || ms <= 0) return "not read yet";
            var mins = (int)Math.Round((nowMs - ms) / 60000.0);
            return mins <= 0 ? "just now" : mins == 1 ? "1 min ago" : mins < 90 ? mins + " min ago" : (mins / 60) + " h ago";
        }
        TextBlock Cell(string text, SolidColorBrush ink, double size = 13) => new() { Text = text, FontSize = size, Foreground = ink, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
        void Put(Grid g, FrameworkElement el, int row, int col) { Grid.SetRow(el, row); Grid.SetColumn(el, col); g.Children.Add(el); }

        // the schedule line
        var sch = st["schedule"] as JsonObject;
        var paused = sch?["paused"]?.GetValue<bool>() == true;
        var listsAt = sch?["listsAt"];
        var every = sch?["everyMs"] is JsonValue ev && ev.TryGetValue<double>(out var em) ? (int)(em / 60000) : 20;
        schedLine.Text = (paused ? "Paused now (quiet hours). " : "") + "Last scheduled read: " + Ago(listsAt) + ", then every " + every + " min while the wall is quiet" + Dot + "owned libraries: " + Ago(sch?["ownedAt"]) + ", every 6 h" + ((sch?["last"]?.GetValue<string>() ?? "") is { Length: > 0 } last ? Dot + "last check: " + last : "");

        // services
        grid.Children.Clear(); grid.RowDefinitions.Clear();
        var heads = new[] { "Service", "Continue & My List", "Owned library", "Profiles", "" };
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (var c = 0; c < heads.Length; c++) Put(grid, Cell(heads[c], HubDim, 12), 0, c);
        var r = 1;
        foreach (var s in (st["services"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var app = s["app"]?.GetValue<string>() ?? ""; var name = s["name"]?.GetValue<string>() ?? app;
            var signedIn = s["status"]?.GetValue<string>() == "signed-in";
            var working = s["working"]?.GetValue<bool>() == true;
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { ServiceMark(app, name, 24), Cell(name, HubInk, 14) } };
            Put(grid, label, r, 0);
            string Part(JsonNode? part) => part is not JsonObject p ? "-" : !signedIn ? "not signed in" : Ago(p["at"]);
            var lists = s["lists"]; var owned = s["owned"]; var prof = s["profiles"];
            Put(grid, Cell(working && lists is JsonObject ? "reading now" + (char)0x2026 : Part(lists), working && lists is JsonObject ? HubAmber : HubInk), r, 1);
            Put(grid, Cell(Part(owned), HubInk), r, 2);
            var profText = prof is not JsonObject pj ? "-" : !signedIn ? "not signed in" : pj["page"]?.GetValue<bool>() == true ? Ago(pj["at"]) : "read with its lists";
            Put(grid, Cell(profText, HubInk), r, 3);
            if (signedIn && (lists is JsonObject || owned is JsonObject))
            {
                var b = Chip(new TextBlock { Text = "Refresh", FontSize = 12, Foreground = HubInk }, false);
                ToolTipService.SetToolTip(b, name + "'s pages read again now.");
                var a2 = app;
                b.Click += async (_, __) => { await ModelCallAsync("videoRefreshApp", a2); SetPill("Prism" + Dot + "reading " + name); };
                Put(grid, b, r, 4);
            }
            r++;
        }

        // the catalog rows and the ratings
        feeds.Children.Clear(); feeds.RowDefinitions.Clear();
        var fheads = new[] { "Row", "Source", "Last read", "Titles" };
        feeds.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (var c = 0; c < fheads.Length; c++) Put(feeds, Cell(fheads[c], HubDim, 12), 0, c);
        r = 1;
        foreach (var f in (st["feeds"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            feeds.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var done = f["done"]?.GetValue<bool>() != false;
            Put(feeds, Cell(f["name"]?.GetValue<string>() ?? "", HubInk, 14), r, 0);
            Put(feeds, Cell((f["source"]?.GetValue<string>() ?? "") + Dot + "every " + (f["every"]?.GetValue<string>() ?? ""), HubDim), r, 1);
            Put(feeds, Cell(done ? Ago(f["at"]) : "reading now" + (char)0x2026, done ? HubInk : HubAmber), r, 2);
            Put(feeds, Cell((f["count"]?.GetValue<int>() ?? 0) + " titles", HubInk), r, 3);
            r++;
        }
        var ratings = st["ratings"] as JsonObject;
        feeds.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Put(feeds, Cell("Ratings on cards", HubInk, 14), r, 0);
        Put(feeds, Cell("TMDB" + Dot + "a day per title", HubDim), r, 1);
        var pending = ratings?["pending"]?.GetValue<int>() ?? 0;
        Put(feeds, Cell(ratings?["key"]?.GetValue<bool>() != true ? "no TMDB key" : pending > 0 ? "reading " + pending + " titles" + (char)0x2026 : "up to date", pending > 0 ? HubAmber : HubInk), r, 2);
    }
}
