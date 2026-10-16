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
        if (tab is not null) _settingsTab = tab == "hidden" ? "binge" : tab;   // the hidden titles sit under The Binge (2026-10-14)
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
        // the window, laid out again (2026-10-15, "The tabs are all laid out poorly, light gray text on dark gray, Hard to read, poorly organized.
        // Give it some thought", "Categories runs off the screen at the bottom"): sized to the screen, the sections in a list on the left, one
        // topic a card, information in full ink at 14 px and up, and Cancel / Save & exit fixed at the foot outside the scrolling part
        var winW = RootGrid.ActualWidth > 0 ? RootGrid.ActualWidth : 1600;
        var winH = RootGrid.ActualHeight > 0 ? RootGrid.ActualHeight : 1000;
        var body = new StackPanel { Spacing = 16, Margin = new Thickness(26, 4, 30, 26) };
        var frame = new Grid();
        frame.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        frame.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        frame.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        frame.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(250) });
        frame.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var card = new Border
        {
            Background = HubCard, CornerRadius = new CornerRadius(14), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x55, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(1),
            Width = Math.Min(1280, winW - 80), Height = Math.Max(520, winH - 80), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            Child = frame,
        };
        card.PointerPressed += (_, e) => e.Handled = true;
        scrim.Children.Add(card);

        // the sections, each with the line that says what it holds
        var sections = new[]
        {
            ("simple", "Simple Watch", "A calmer Watch page that makes choosing easy."),
            ("general", "TMDB", "Your TMDB key and account: ratings, the catalog rows, search, My Watchlist."),
            ("ads", "Ads & breaks", "How a window looks while an ad plays, and the covering of YouTube TV's breaks."),
            ("updates", "Updates", "This Prism's own updates and changelog, and when your services' lists are read again."),
            ("services", "Services", "Each service, when its lists were last read, and a Refresh for it."),
            ("binge", "The Binge", "The Binge's limits, animation, Kids mode, and the titles you hid from it."),
            ("categories", "Categories", "Rows of titles from your services, chosen by hashtags or words."),
            ("perf", "Performance", "What Prism is using on this PC."),
        };
        var curLine = sections.FirstOrDefault(x => x.Item1 == _settingsTab).Item3 ?? "";

        var head = new Grid { Margin = new Thickness(26, 20, 20, 14) };
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var heads = new StackPanel { Spacing = 2 };
        heads.Children.Add(new TextBlock { Text = "Watch settings", FontSize = 26, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
        heads.Children.Add(new TextBlock { Text = curLine, FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        head.Children.Add(heads);
        var close = Chip(new FontIcon { Glyph = "\uE711", FontSize = 14 }, false);
        ToolTipService.SetToolTip(close, "Close without changing anything (Esc)");
        close.Click += (_, __) => CloseWatchSettings();
        close.VerticalAlignment = VerticalAlignment.Top;
        Grid.SetColumn(close, 1);
        head.Children.Add(close);
        Grid.SetColumnSpan(head, 2);
        frame.Children.Add(head);

        // the list of sections on the left
        var nav = new StackPanel { Spacing = 4, Padding = new Thickness(14, 6, 12, 14) };
        foreach (var (id, label, line) in sections)
        {
            var on = _settingsTab == id;
            var t = Chip(new TextBlock { Text = label, FontSize = 16, Foreground = on ? HubAmber : HubInk, FontWeight = on ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal }, on);
            t.HorizontalAlignment = HorizontalAlignment.Stretch; t.HorizontalContentAlignment = HorizontalAlignment.Left; t.Padding = new Thickness(16, 11, 16, 11);
            ToolTipService.SetToolTip(t, line);
            var id2 = id;
            t.Click += (_, __) => { if (_settingsTab != id2) { _settingsTab = id2; _ = ShowWatchSettingsAsync(); } };
            nav.Children.Add(t);
        }
        var navHost = new Border { Child = nav, BorderThickness = new Thickness(0, 0, 1, 0), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x30, 0xFF, 0xFF, 0xFF)) };
        Grid.SetRow(navHost, 1);
        frame.Children.Add(navHost);

        var scroller = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        Grid.SetRow(scroller, 1); Grid.SetColumn(scroller, 1);
        frame.Children.Add(scroller);

        // the Save & exit of each tab gathers its own changes
        Func<Task<List<string>>> saveTab;
        // one subject a section: TMDB, Ads & breaks, Updates (This Prism first), Services, The Binge with its hidden titles, Categories, Performance
        if (_settingsTab == "ads") saveTab = BuildAdsTab(body, v);
        else if (_settingsTab == "updates") { BuildSoftwareSection(body, run); saveTab = BuildUpdatesTab(body, v, run); }
        else if (_settingsTab == "services") saveTab = BuildServicesTab(body, run);
        else if (_settingsTab == "binge")
        {
            body.Children.Add(new TextBlock { Text = "What's in The Binge", FontSize = 17, Foreground = HubInk });
            var limits = BuildBingeTab(body);
            body.Children.Add(new TextBlock { Text = "Hidden titles", FontSize = 17, Foreground = HubInk });
            var hidden = BuildHiddenTab(body);
            saveTab = async () => { var said = await limits(); said.AddRange(await hidden()); return said; };
        }
        else if (_settingsTab == "categories") saveTab = BuildCategoriesTab(body);   // categories by hashtags, with a clear rule (2026-10-11)
        else if (_settingsTab == "perf") saveTab = BuildPerformanceTab(body);   // the stats (2026-10-03)
        else if (_settingsTab == "simple") saveTab = BuildSimpleWatchTab(body);   // MainWindow.SimpleWatch.cs (2026-10-16)
        else saveTab = BuildGeneralTab(body, v);
        if (_settingsTab is "general" or "ads" or "updates" or "services" or "binge" or "simple") GroupIntoCards(body);
        if (_settingsTab != "perf") ReadableText(body);

        var foot = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Right };
        var footHost = new Border { Child = foot, Padding = new Thickness(26, 12, 22, 16), BorderThickness = new Thickness(0, 1, 0, 0), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x30, 0xFF, 0xFF, 0xFF)) };
        Grid.SetRow(footHost, 2); Grid.SetColumnSpan(footHost, 2);
        frame.Children.Add(footHost);
        var cancel = Chip(new TextBlock { Text = "Cancel", FontSize = 15, Foreground = HubInk }, false);
        cancel.Click += (_, __) => CloseWatchSettings();
        var save = Chip(new TextBlock { Text = "Save & exit", FontSize = 15, Foreground = HubAmber }, true);
        save.Click += async (_, __) =>
        {
            var said = await saveTab();
            CloseWatchSettings();
            if (said.Count > 0) SetPill("Prism" + Dot + string.Join(Dot, said));
        };
        foot.Children.Add(cancel); foot.Children.Add(save);

        RootGrid.Children.Add(scrim);
        _settingsWin = scrim;
        scrim.Loaded += (_, __) => scrim.Focus(FocusState.Programmatic);
    }

    private static readonly SolidColorBrush SettingsCardBg = new(Windows.UI.Color.FromArgb(255, 0x2A, 0x30, 0x3A));
    private static readonly SolidColorBrush SettingsCardEdge = new(Windows.UI.Color.FromArgb(0x26, 0xFF, 0xFF, 0xFF));
    /// <summary>A section's children as cards (2026-10-15): each heading (a 17 px line the builders write) starts a card of its own, in a larger,
    /// heavier type, and what follows it sits on the card; anything before the first heading gets a card without one.</summary>
    private static void GroupIntoCards(StackPanel body)
    {
        var items = body.Children.ToList();
        body.Children.Clear();
        StackPanel? cur = null;
        StackPanel NewCard(TextBlock? heading)
        {
            var c = new StackPanel { Spacing = 12 };
            body.Children.Add(new Border { Child = c, Background = SettingsCardBg, CornerRadius = new CornerRadius(12), BorderThickness = new Thickness(1), BorderBrush = SettingsCardEdge, Padding = new Thickness(22, 18, 22, 20) });
            if (heading is not null) c.Children.Add(heading);
            return c;
        }
        foreach (var el in items)
        {
            if (el is TextBlock tb && tb.FontSize == 17)   // the builders' headings are 17 px exactly (a 18 px line is a lead line, not a heading)
            {
                tb.FontSize = 19; tb.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; tb.Margin = new Thickness(0);
                cur = NewCard(tb); continue;
            }
            cur ??= NewCard(null);
            cur.Children.Add(el);
        }
    }
    /// <summary>Text the host draws is read from across a room (CLAUDE.md, win-host-spec 5): every line at 14 px or more, and the grey reserved
    /// for a secondary line becomes ink here, where nothing is secondary (2026-10-15, "light gray text on dark gray, Hard to read").</summary>
    private static void ReadableText(UIElement root)
    {
        switch (root)
        {
            case TextBlock tb:
                if (tb.FontSize < 14) tb.FontSize = 14;
                if (ReferenceEquals(tb.Foreground, HubDim)) tb.Foreground = HubInk;
                break;
            case Panel p: foreach (var c in p.Children) ReadableText(c); break;
            case Border b when b.Child is not null: ReadableText(b.Child); break;
            case ScrollViewer sv when sv.Content is UIElement sc: ReadableText(sc); break;
            case ContentControl cc when cc.Content is UIElement ce: ReadableText(ce); break;
        }
    }

    /// <summary>TMDB: the key and the account (the Video ads moved to Ads & breaks, 2026-10-14).</summary>
    private Func<Task<List<string>>> BuildGeneralTab(StackPanel body, JsonObject v)
    {
        var hasKey = v["tmdbKey"]?.GetValue<bool>() == true;
        var tmdbHead = new TextBlock { Text = "TMDB key", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 6, 0, 0) };
        ToolTipService.SetToolTip(tmdbHead, "Optional: your own free TMDB account's API key (personal use), kept on this device and sent to TMDB alone. It turns on ratings on cards (TMDB members' mean vote with the vote count), the catalog rows, Browse, the catalog search and the Episodes list for services that cannot list their own.");
        body.Children.Add(tmdbHead);
        body.Children.Add(new TextBlock { Text = hasKey ? "Set. Ratings, the catalog rows and search are on." : "Not set. Prism works without one. Press Get a free key and your phone does the rest.", FontSize = 13, Foreground = hasKey ? HubAmber : HubInk });
        var keyRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var keyBox = new PasswordBox { PlaceholderText = hasKey ? "Replace the key (optional)" : "TMDB API key or read access token", Width = 380, FontSize = 13 };
        keyRow.Children.Add(keyBox);
        if (!hasKey)
        {
            // from no account to a working key by phone, a code a step (MainWindow.TmdbGuide.cs, 2026-10-10)
            var guide = Chip(new TextBlock { Text = "Get a free key", FontSize = 13, Foreground = HubInk }, true);
            ToolTipService.SetToolTip(guide, "A short guide: your phone opens TMDB's sign-up and API pages from codes on this screen, then sends the key to Prism. About three minutes.");
            guide.Click += (_, __) => _ = ShowTmdbGuideAsync();
            keyRow.Children.Add(guide);
        }
        if (hasKey)
        {
            var clear = Chip(new TextBlock { Text = "Clear the key", FontSize = 13, Foreground = HubDim }, false);
            clear.Click += async (_, __) => { await ModelCallAsync("lensSetTmdbKey", (string?)null); SetPill("Prism" + Dot + "TMDB key cleared"); await ShowWatchSettingsAsync(); if (VideoHubOpen) _ = ShowVideoHubAsync(); };
            keyRow.Children.Add(clear);
        }
        body.Children.Add(keyRow);
        var acct = new StackPanel();   // the account under the key, filled as core answers (MainWindow.TmdbAccount.cs, 2026-10-03)
        body.Children.Add(acct);
        _ = BuildTmdbAccountAsync(acct, hasKey);
        return async () =>
        {
            var said = new List<string>();
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

    /// <summary>Updates: the schedule and its pause, Refresh now, Hide offline (the services grid and the catalog rows are the Services tab's since 2026-10-14).</summary>
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
        _ = FollowUpdatesAsync(run, new Grid(), new Grid(), schedLine);   // the schedule line alone here; the services grid and the catalog rows are the Services tab's (2026-10-14)

        return async () =>
        {
            var r = JsonNode.Parse(await ModelCallAsync("videoSetPause", pauseBox.IsChecked == true, fromBox.Text?.Trim() ?? "", toBox.Text?.Trim() ?? "") ?? "null") as JsonObject;
            var p = r?["pause"] as JsonObject;
            return new List<string> { p?["on"]?.GetValue<bool>() == true ? "scheduled updates pause " + p["from"] + "-" + p["to"] : "scheduled updates run at all hours" };
        };
    }

    /// <summary>Ads & breaks (2026-10-14): how a window shows an ad, and the covering of YouTube TV's channel breaks with its lists.</summary>
    private Func<Task<List<string>>> BuildAdsTab(StackPanel body, JsonObject v)
    {
        // Video ads (2026-10-07, "In watch settings, lets add 3 options for Video Ads: Show, Muted (Picture visible) and Veiled and Muted.
        // Default to Veiled."): how the Video player's breaks look, from the next break on
        var adsHead = new TextBlock { Text = "Video ads", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 6, 0, 0) };
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
            Look("Veiled and muted", "veil", "The ad is covered with a picture and its sound is off. Show ad lets you see it for the rest of the break, and Hide ad covers it again."),
            Look("Muted, picture visible", "mute", "You see the ad with its sound off. An Unmute button on the window brings the sound back for that ad."),
            Look("Show", "show", "The ad plays as it comes, picture and sound."),
        };
        body.Children.Add(adsRow);
        // the pictures on the cover (2026-10-15, "Prism app on the desktop is still using the old images", "lets fix the video player veil images"):
        // the hand-picked photos by default, or one of the packs the app carries
        body.Children.Add(new TextBlock { Text = "Cover pictures", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 14, 0, 0) });
        // one or more sets at once (2026-10-15, "checkboxes next to the options, with only nature on by default, but allow them to enable cosmos pack
        // and museum pics. Require at least one selection"): each cover takes its picture from one of the sets switched on
        var coverNow = v["coverSource"]?.GetValue<string>() ?? "photos";
        var coverOn = coverNow.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();
        if (coverOn.Count == 0) coverOn.Add("photos");
        var coverRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
        var coverNote = new TextBlock { FontSize = 13, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center };
        var pics = new List<CheckBox>();
        CheckBox Pics(string label, string value, string tip)
        {
            var r = new CheckBox { Content = new TextBlock { Text = label, FontSize = 14, Foreground = HubInk }, IsChecked = coverOn.Contains(value), Tag = value, MinWidth = 0 };
            ToolTipService.SetToolTip(r, tip);
            // the last set on stays on: covers always have pictures to show
            r.Unchecked += (_, __) => { if (!pics.Any(x => x.IsChecked == true)) { r.IsChecked = true; coverNote.Text = "Keep at least one set of pictures on."; } };
            r.Checked += (_, __) => coverNote.Text = "";
            coverRow.Children.Add(r);
            pics.Add(r);
            return r;
        }
        Pics("Nature photos", "photos", "Prism's hand-picked nature photos, all public domain. Hover the corner symbol on a cover for each one's credit.");
        Pics("Cosmos", "cosmos", "NASA's pictures of space, public domain.");
        Pics("Museum art", "gallery", "Paintings and prints from the Art Institute of Chicago and the Met, public domain.");
        coverRow.Children.Add(coverNote);
        body.Children.Add(coverRow);
        body.Children.Add(new TextBlock { Text = "YouTube TV breaks", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 14, 0, 0) });
        // three choices for every channel (2026-10-15, "YouTube tv breaks is supposed to have 3 options, the all ads, only guaranteed ads, or none")
        var bwRow = new StackPanel { Spacing = 2 };
        void BwChoice(string mode, string label, string tip)
        {
            var rb = new RadioButton { Content = new TextBlock { Text = label, FontSize = 14, Foreground = HubInk }, GroupName = "breakWatchMode", IsChecked = BreakWatchMode == mode, MinWidth = 0 };
            ToolTipService.SetToolTip(rb, tip);
            rb.Checked += (_, __) => SetBreakWatchMode(mode, "");
            bwRow.Children.Add(rb);
        }
        BwChoice("all", "All breaks", "YouTube TV doesn't say when most of a channel's commercials play. Prism watches the picture instead: the channel's logo, cuts to black and web addresses or phone numbers on screen, and covers each break it finds. Everything is read on this PC.");
        BwChoice("sure", "Sure breaks only", "Only the breaks that need no guess: the ad slots YouTube TV marks itself, and paid programmes the guide or the screen names. It never covers the show by mistake, and it misses the breaks YouTube TV doesn't mark.");
        BwChoice("off", "Off", "YouTube TV's channels are never covered.");
        body.Children.Add(bwRow);
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
        // ... and the ones set to sure breaks only (the channel's menu in Live, or three Not an ad presses in a week): each one here to cover in full again
        var sureRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(28, 0, 0, 0) };
        void DrawSure()
        {
            sureRow.Children.Clear();
            var sure = ChannelsSure();
            if (sure.Count == 0) { sureRow.Visibility = Visibility.Collapsed; return; }
            sureRow.Visibility = Visibility.Visible;
            sureRow.Children.Add(new TextBlock { Text = "Sure breaks only:", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
            foreach (var ch in sure)
            {
                var chip = Chip(new TextBlock { Text = ch + "  \u00D7", FontSize = 12, Foreground = HubInk }, false);
                ToolTipService.SetToolTip(chip, "Cover every break Prism finds on " + ch + " again");
                chip.Click += (_, __) => { SetChannelMode(ch, ChannelCovers.On); DrawSure(); };
                sureRow.Children.Add(chip);
            }
        }
        DrawSure();
        body.Children.Add(sureRow);
        // how many Not an ad presses in a week put a channel on sure breaks only (BreakWatch.NotAdCounted)
        var autoRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(28, 2, 0, 0) };
        autoRow.Children.Add(new TextBlock { Text = "When you keep pressing Not an ad on a channel:", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
        var autoBox = new ComboBox { FontSize = 13, MinWidth = 300 };
        var autoNow = (int)HostPrefs.GetDouble("video.breakWatchAutoSure", 3);
        foreach (var (label, n) in new[] { ("Sure breaks only after 2 presses in a week", 2), ("Sure breaks only after 3 presses in a week", 3), ("Sure breaks only after 5 presses in a week", 5), ("Keep covering every break", 0) })
        {
            var item = new ComboBoxItem { Content = label, Tag = n };
            autoBox.Items.Add(item);
            if (n == autoNow) autoBox.SelectedItem = item;
        }
        if (autoBox.SelectedItem is null) autoBox.SelectedIndex = 1;
        autoBox.SelectionChanged += (_, __) => { if (autoBox.SelectedItem is ComboBoxItem { Tag: int n }) { HostPrefs.Set("video.breakWatchAutoSure", (double)n); LogLine("break watch: sure breaks only after " + n + " Not an ad presses in a week (0 never)"); } };
        ToolTipService.SetToolTip(autoBox, "Prism only knows a cover was wrong when you press Not an ad. After this many presses on one channel in a week, it covers that channel only where YouTube TV marks the break.");
        autoRow.Children.Add(autoBox);
        body.Children.Add(autoRow);
        return async () =>
        {
            var said = new List<string>();
            var pickedSets = pics.Where(r => r.IsChecked == true).Select(r => (string)r.Tag).ToList();
            var picked = string.Join(",", pickedSets);
            if (pickedSets.Count > 0 && !pickedSets.ToHashSet().SetEquals(coverOn))
            {
                await ModelCallAsync("videoSetCoverSource", picked);
                LogLine("video cover pictures: " + picked);
                said.Add("covers show " + string.Join(" and ", pickedSets.Select(x => x == "photos" ? "nature photos" : x == "gallery" ? "museum art" : "Cosmos pictures")));
            }
            var chosen = looks.FirstOrDefault(r => r.IsChecked == true)?.Tag as string ?? look;
            if (chosen != look)
            {
                await ModelCallAsync("videoSetAdsLook", chosen);
                LogLine("video ads: " + chosen);
                said.Add(chosen == "veil" ? "ads are veiled and muted" : chosen == "mute" ? "ads are muted with the picture visible" : "ads are shown");
            }
            return said;
        };
    }

    /// <summary>Services (2026-10-14): the live grid of every service's parts and when each was read, and the catalog rows and ratings.</summary>
    private Func<Task<List<string>>> BuildServicesTab(StackPanel body, int run)
    {
        var schedLine = new TextBlock();   // drawn with the grids, shown on the Updates tab
        // the grid: one row per service
        body.Children.Add(new TextBlock { Text = "Your services", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 6, 0, 0) });
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 8 };
        foreach (var w in new[] { 190.0, 190, 170, 170, 100 }) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(w) });
        body.Children.Add(grid);
        body.Children.Add(new TextBlock { Text = "Catalog rows and ratings", FontSize = 17, Foreground = HubInk, Margin = new Thickness(0, 12, 0, 0) });
        var feeds = new Grid { ColumnSpacing = 16, RowSpacing = 8 };
        foreach (var w in new[] { 260.0, 170, 190, 200 }) feeds.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(w) });
        body.Children.Add(feeds);
        _ = FollowUpdatesAsync(run, grid, feeds, schedLine);
        return () => Task.FromResult(new List<string>());
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
        TextBlock Cell(string text, SolidColorBrush ink, double size = 14) => new() { Text = text, FontSize = size, Foreground = ink, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
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
        for (var c = 0; c < heads.Length; c++) Put(grid, Cell(heads[c], HubAmber, 14), 0, c);
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
        for (var c = 0; c < fheads.Length; c++) Put(feeds, Cell(fheads[c], HubAmber, 14), 0, c);
        r = 1;
        foreach (var f in (st["feeds"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            feeds.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var done = f["done"]?.GetValue<bool>() != false;
            Put(feeds, Cell(f["name"]?.GetValue<string>() ?? "", HubInk, 14), r, 0);
            Put(feeds, Cell((f["source"]?.GetValue<string>() ?? "") + Dot + "every " + (f["every"]?.GetValue<string>() ?? ""), HubInk), r, 1);
            Put(feeds, Cell(done ? Ago(f["at"]) : "reading now" + (char)0x2026, done ? HubInk : HubAmber), r, 2);
            Put(feeds, Cell((f["count"]?.GetValue<int>() ?? 0) + " titles", HubInk), r, 3);
            r++;
        }
        var ratings = st["ratings"] as JsonObject;
        feeds.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Put(feeds, Cell("Ratings on cards", HubInk, 14), r, 0);
        Put(feeds, Cell("TMDB" + Dot + "a day per title", HubInk), r, 1);
        var pending = ratings?["pending"]?.GetValue<int>() ?? 0;
        Put(feeds, Cell(ratings?["key"]?.GetValue<bool>() != true ? "no TMDB key" : pending > 0 ? "reading " + pending + " titles" + (char)0x2026 : "up to date", pending > 0 ? HubAmber : HubInk), r, 2);
    }
}
