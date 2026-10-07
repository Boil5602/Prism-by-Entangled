using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The first-run page (2026-09-29, "When I go to a new computer and install Prism ... both indicate neither scene is setup ... I'd love to be able to
/// just start opening and logging into services on a new computer. Ideally they just get a wizard that has them choose from all (and can select all
/// or some) of the adapters and start doing logins and seeing things populate"). Two steps: choose the services, then sign in to each. Core makes
/// the Music player and the Video player from the choice (playerSetup, player-setup.ts); the host draws the page and opens each service's own
/// sign-in page in the sign-in window the rest of the wall uses. Open again any time from the Prism menu, Set up services.
/// This file is ASCII only.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _welcome;
    private bool _welcomeBusy;
    /// <summary>The part of the page that is open (an accordion, 2026-10-06): music, video, tmdb, pc, more; "" none; null not chosen yet.</summary>
    private string? _welcomeOpen;
    private readonly Dictionary<string, int> _welcomePage = new();   // the page shown under each player (cards, 2026-10-03)

    private sealed record WelcomeService(string Id, string Name, string Kind, bool Added, string Status, bool Removed = false, string Shares = "");

    private string WelcomeEntriesJson(Func<HostCatalogEntry, bool>? only = null)
    {
        var arr = new JsonArray();
        foreach (var e in _catalog)
        {
            if (only is not null && !only(e)) continue;
            string? audio = null, account = null;
            try
            {
                using var doc = JsonDocument.Parse(e.Json);
                if (doc.RootElement.TryGetProperty("audio", out var au) && au.ValueKind == JsonValueKind.String) audio = au.GetString();
                // the account a service signs in with, when it shares one (Apple Music and Apple TV; Amazon Music and Prime Video)
                if (doc.RootElement.TryGetProperty("signInWith", out var sw) && sw.ValueKind == JsonValueKind.String) account = sw.GetString();
            }
            catch { }
            arr.Add(new JsonObject { ["id"] = e.Id, ["name"] = e.Name, ["url"] = e.Url, ["adapter"] = e.Adapter.Length > 0 ? e.Adapter : null, ["audio"] = audio, ["signInWith"] = account });
        }
        return arr.ToJsonString();
    }

    private async Task<List<WelcomeService>> WelcomeServicesAsync()
    {
        var list = new List<WelcomeService>();
        try
        {
            var raw = await ModelCallAsync("playerSetupServices", WelcomeEntriesJson());
            if (raw is not null && JsonNode.Parse(raw) is JsonArray arr)
                foreach (var n in arr.OfType<JsonObject>())
                    list.Add(new WelcomeService(n["id"]?.GetValue<string>() ?? "", n["name"]?.GetValue<string>() ?? "", n["kind"]?.GetValue<string>() ?? "video", n["added"]?.GetValue<bool>() == true, n["status"]?.GetValue<string>() ?? "unknown", n["removed"]?.GetValue<bool>() == true,
                        string.Join(" and ", (n["sharesWith"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0) ?? Array.Empty<string>())));
        }
        catch (Exception e) { LogLine("welcome services: " + e.Message); }
        return list;
    }

    /// <summary>Open the page: on the sign-in step when services are already set up here, else on the choice.</summary>
    private async Task ShowWelcomeAsync(int? step = null)
    {
        CloseVideoHub();
        var services = await WelcomeServicesAsync();
        _ = step;   // one page since 2026-10-03
        LogLine("welcome: " + services.Count + " services, " + services.Count(s => s.Added) + " set up");
        RenderWelcome(services);
    }

    private void CloseWelcome()
    {
        if (_welcome is null) return;
        // a close is a close (2026-10-05 review): Escape, the close route and App setup's own finish left welcome.open true, so the page came
        // back over the wall at every later start with players present, until Done was found and pressed
        HostPrefs.Set("welcome.open", false);
        RootGrid.Children.Remove(_welcome);
        _welcome = null;
        SyncEmptyStage();
        SyncEmptyWallNote();
    }

    /// <summary>Dev (hub.request): "welcome" opens the page, "welcome 1|2" on a step, "welcome all", "welcome clear", "welcome pick a,b" choose,
    /// "welcome continue" presses Continue, "welcome signin app" a row's Sign in, "welcome close".</summary>
    private void DevWelcome(string text)
    {
        var arg = text.Length > 7 ? text.Substring(7).Trim() : "";
        if (arg == "") { _ = ShowWelcomeAsync(); return; }
        if (arg == "1" || arg == "2") { _ = ShowWelcomeAsync(int.Parse(arg)); return; }
        if (arg == "close") { CloseWelcome(); return; }
        // "welcome add a,b,c": those services onto their players without a sign-in (the one page's Sign in does both; dev walks want the add alone)
        if (arg.StartsWith("add ", StringComparison.Ordinal)) { _ = WelcomeAddAsync(arg.Substring(4).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet()).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = ShowWelcomeAsync())); return; }
        if (arg.StartsWith("signin ", StringComparison.Ordinal)) { WelcomeSignIn(arg.Substring(7).Trim()); return; }
        if (arg.StartsWith("remove ", StringComparison.Ordinal)) { var id = arg.Substring(7).Trim(); if (_welcomeServices.FirstOrDefault(s => s.Id == id) is { } ws) _ = WelcomeRemoveAsync(ws); return; }
    }

    private List<WelcomeService> _welcomeServices = new();
    private void RenderWelcome(List<WelcomeService> services)
    {
        _welcomeServices = services;
        CloseWelcome();
        var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x0B, 0x0E, 0x12)) };
        Canvas.SetZIndex(overlay, 940);
        var col = new StackPanel { Spacing = 14, MaxWidth = 1700, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(32, 72, 32, 32) };   // from the top: an accordion opening never moves what is above it
        TextBlock Line(string text, double size, SolidColorBrush ink, bool bold = false) => new() { Text = text, FontSize = size, Foreground = ink, TextWrapping = TextWrapping.Wrap, FontWeight = bold ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal };
        Button Pill(string text, bool on, string tip, Action click)
        {
            var b = Chip(new TextBlock { Text = text, FontSize = 16, Foreground = HubInk }, on);
            ToolTipService.SetToolTip(b, tip);
            b.Click += (_, __) => click();
            return b;
        }

        // one page (2026-10-03, "Why not let people sign in as they choose their services? Less screens"): every service a card - a press adds
        // the service to its player and opens its sign-in page at once; back here the card says Signed in. Done when at least one is set up.
        // As accordions since 2026-10-06 ("Lets clean up this your services screen. Let's collapse Music Player, Video Player, TMDB into accordion
        // style menus with each collapsing when another is expanded ... not make it a ton of unstructured words"): each part a bar with its
        // state on the right, one open at a time; the intro one sentence.
        var mine = services.Where(s => s.Added).ToList();
        var inNow = mine.Count(s => s.Status == "signed-in");
        col.Children.Add(Line(mine.Count == 0 ? "Welcome to Prism" : "Your services", 40, HubInk, bold: true));
        col.Children.Add(Line("Press a service to sign in on its own page. Prism never sees your password, and the sign-in stays on this PC.", 19, HubInk));
        // which part is open: the person's last choice, else the first player with a service to sign in to
        if (_welcomeOpen is null)
        {
            bool Todo(string k) => !services.Any(s => s.Kind == k && s.Added) || services.Any(s => s.Kind == k && s.Added && s.Status != "signed-in");
            _welcomeOpen = Todo("music") ? "music" : Todo("video") ? "video" : "music";
        }
        var parts = new List<(string id, FrameworkElement body, FontIcon chev)>();
        var accordion = new StackPanel { Spacing = 8, Margin = new Thickness(0, 10, 0, 0) };
        TextBlock Summary() => new() { FontSize = 15, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
        void Part(string id, string title, TextBlock summary, FrameworkElement content)
        {
            var open = _welcomeOpen == id;
            var chev = new FontIcon { Glyph = ((char)(open ? 0xE70D : 0xE76C)).ToString(), FontSize = 14, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
            var bar = new Grid { ColumnSpacing = 14 };
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var name = new TextBlock { Text = title, FontSize = 20, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(name, 1); Grid.SetColumn(summary, 2);
            bar.Children.Add(chev); bar.Children.Add(name); bar.Children.Add(summary);
            var head = new Button { Content = bar, Background = HubCard, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(10), Padding = new Thickness(18, 12, 18, 12), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch };
            OwnHover(head);
            ToolTipService.SetToolTip(head, open ? "Close " + title : "Open " + title);
            var body = new Border { Child = content, Padding = new Thickness(18, 8, 18, 10), Visibility = open ? Visibility.Visible : Visibility.Collapsed };
            parts.Add((id, body, chev));
            head.Click += (_, __) =>
            {
                _welcomeOpen = _welcomeOpen == id ? "" : id;   // pressed open: it closes; any other: it opens and the rest close
                foreach (var (pid, pbody, pchev) in parts)
                {
                    var on = pid == _welcomeOpen;
                    pbody.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
                    pchev.Glyph = ((char)(on ? 0xE70D : 0xE76C)).ToString();
                }
            };
            var holder = new StackPanel();
            holder.Children.Add(head); holder.Children.Add(body);
            accordion.Children.Add(holder);
        }

        // the services as cards (2026-10-03, "I would like to see the service cards on the service selection screen, I don't like the pill
        // buttons" / "Alphabetical and paged, grouped on music v video"): the Watch page's own service tiles, A to Z under each player, a
        // page at a time when a player has more than fit; a press on a card adds the service and opens its sign-in (Open once signed in);
        // a right-click on one that is set up takes it off the player, its sign-in kept
        // as many cards a row as the window holds (seven on a 1080p wall, so every service today is one page), two rows a page
        var perRow = Math.Clamp((int)((Math.Min(RootGrid.ActualWidth, 1760) - 120) / 222), 3, 7);
        var perPage = perRow * 2;
        col.Width = Math.Min(Math.Max(480, RootGrid.ActualWidth - 64), perRow * 222 + 44);   // as wide as a row of cards, whichever part is open
        foreach (var (kind, title) in new[] { ("music", "Music player"), ("video", "Video player") })
        {
            var these = services.Where(s => s.Kind == kind).OrderBy(s => s.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
            if (these.Count == 0) continue;
            var added = these.Count(s => s.Added);
            var signed = these.Count(s => s.Added && s.Status == "signed-in");
            var sum = Summary();
            sum.Text = added == 0 ? "None added yet" : signed + " of " + added + " signed in";
            if (added == 0 || signed < added) sum.Foreground = HubAmber;
            var content = new StackPanel { Spacing = 6 };
            var pages = Math.Max(1, (these.Count + perPage - 1) / perPage);
            var page = Math.Clamp(_welcomePage.TryGetValue(kind, out var pg) ? pg : 0, 0, pages - 1);
            _welcomePage[kind] = page;
            if (pages > 1)
            {
                var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
                var k2 = kind;
                var back = Pill(((char)0x2039).ToString(), false, "The page before", () => { _welcomePage[k2] = Math.Max(0, page - 1); RenderWelcome(services); });
                var next = Pill(((char)0x203A).ToString(), false, "The next page", () => { _welcomePage[k2] = Math.Min(pages - 1, page + 1); RenderWelcome(services); });
                back.IsEnabled = page > 0; next.IsEnabled = page < pages - 1;
                foreach (var b in new[] { back, next }) { b.Padding = new Thickness(10, 0, 10, 2); b.MinHeight = 0; }
                head.Children.Add(back);
                head.Children.Add(new TextBlock { Text = (page + 1) + " of " + pages, FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
                head.Children.Add(next);
                content.Children.Add(head);
            }
            var wrap = new VariableSizedWrapGrid { Orientation = Orientation.Horizontal, ItemHeight = 150, ItemWidth = 222, MaximumRowsOrColumns = perRow };
            content.Children.Add(wrap);
            foreach (var s in these.Skip(page * perPage).Take(perPage))
            {
                var sv = s;
                var signedIn = s.Added && s.Status == "signed-in";
                var tile = ServiceTile(s.Id, s.Name, signedIn, grey: !signedIn);   // colour means signed in; grey, press to sign in
                var cell = new StackPanel { Spacing = 5, Width = 210 };
                cell.Children.Add(tile);
                var caption = signedIn ? (char)0x2713 + "  Signed in" : s.Added ? (s.Status == "needs-attention" ? "Signed out" : "Not signed in") : "";
                cell.Children.Add(new TextBlock { Text = caption.Length > 0 ? caption : " ", FontSize = 12, Foreground = signedIn ? HubInk : HubAmber, TextTrimming = TextTrimming.CharacterEllipsis });
                var b = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(4), VerticalAlignment = VerticalAlignment.Top };
                OwnHover(b);
                ToolTipService.SetPlacement(b, Microsoft.UI.Xaml.Controls.Primitives.PlacementMode.Bottom);
                ToolTipService.SetToolTip(b, signedIn ? s.Name + " is signed in. Press to open it and check the account or pick a profile." + (s.Shares.Length > 0 ? " One sign-in with " + s.Shares + "." : "")
                    : s.Added ? "Press to open " + s.Name + "'s sign-in page." + (s.Shares.Length > 0 ? " One sign-in with " + s.Shares + "." : "")
                    : "Press to add " + s.Name + " to your " + (s.Kind == "music" ? "Music" : "Video") + " player and open its sign-in page." + (s.Shares.Length > 0 ? " One sign-in with " + s.Shares + "." : ""));
                b.IsEnabled = !_welcomeBusy;
                b.Click += (_, __) => { ExpandFrom(tile); _ = WelcomeAddAndSignInAsync(sv); };   // the window grows out of the card
                if (s.Added)
                {
                    var menu = new MenuFlyout();
                    var rm = new MenuFlyoutItem { Text = "Take " + s.Name + " off your player" };
                    ToolTipService.SetToolTip(rm, "Off your player and Watch. Its sign-in is kept; pressing the card brings it back.");
                    rm.Click += (_, __) => _ = WelcomeRemoveAsync(sv);
                    menu.Items.Add(rm);
                    b.ContextFlyout = menu;
                }
                wrap.Children.Add(b);
            }
            content.Children.Add(new TextBlock { Text = "New to a service? Create the account in your browser first, then press its card here. Right-click a card to take it off your player.", FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
            Part(kind, title, sum, content);
        }
        // TMDB (2026-10-05, "Lets add the TMDB config to the Set up services screen as well"): the key and the account, as Watch settings has
        // them, filled once core answers
        var tmdb = new StackPanel { Spacing = 6 };
        var tmdbSum = Summary(); tmdbSum.Text = "Optional";
        Part("tmdb", "TMDB", tmdbSum, tmdb);
        // this PC's one administrator step (2026-10-06, "We should add the remote desktop support option at the same setup time right? So they
        // dont get a late UAC prompt"): the phone's firewall rule and Remote Desktop Support asked for together, now, while someone is here
        var thisPc = new StackPanel { Spacing = 6 };
        var pcSum = Summary();
        FillWelcomeThisPc(thisPc, pcSum);
        Part("pc", "This PC", pcSum, thisPc);
        // more services arrive as files (2026-09-29, "I'll come out with more"): an adapter and its catalog entry in the data folder
        var more = new StackPanel { Spacing = 8 };
        more.Children.Add(new TextBlock { Text = "Have files for another service? Put them in Prism's adapters and catalog folders, then start Prism again.", FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxWidth = 760, HorizontalAlignment = HorizontalAlignment.Left });
        var openFolder = Pill("Open the folder", false, "Opens " + HostPaths.DataDir + " with its adapters and catalog folders", () => OpenAdaptersFolder());
        openFolder.HorizontalAlignment = HorizontalAlignment.Left;
        more.Children.Add(openFolder);
        var moreSum = Summary(); moreSum.Text = "From files";
        Part("more", "Add another service", moreSum, more);
        col.Children.Add(accordion);
        var foot = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14, Margin = new Thickness(0, 12, 0, 0) };
        if (mine.Count > 0) foot.Children.Add(Pill("Done", true, "Close this page and go to the wall", () => { HostPrefs.Set("welcome.open", false); CloseWelcome(); if (WatchGrip.Visibility == Visibility.Visible) _ = ShowVideoHubAsync(); }));
        else foot.Children.Add(Pill("Not now", false, "Close this page. It is in the Prism menu under Set up services", () => { HostPrefs.Set("welcome.dismissed", true); HostPrefs.Set("welcome.open", false); CloseWelcome(); }));
        if (mine.Count > 0 && inNow < mine.Count) foot.Children.Add(new TextBlock { Text = "You can finish later. A service you have not signed in to fills in once you do.", FontSize = 15, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap });
        col.Children.Add(foot);
        overlay.Children.Add(new ScrollViewer { Content = col, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        RootGrid.Children.Add(overlay);
        _welcome = overlay;
        _ = FillWelcomeTmdbAsync(tmdb, overlay, tmdbSum);
        SyncEmptyStage();
        SyncEmptyWallNote();
    }

    /// <summary>Sign in on a row: a service not set up yet joins its player first (playerSetup with that one entry; the players are made when
    /// there are none), then its sign-in page opens; back here the row reads the page's verdict.</summary>
    private async Task WelcomeAddAndSignInAsync(WelcomeService s)
    {
        if (!s.Added) { var ok = await WelcomeAddAsync(new HashSet<string> { s.Id }); if (!ok) return; }
        WelcomeSignIn(s.Id);
    }
    private async Task<bool> WelcomeAddAsync(HashSet<string> picks)
    {
        if (_welcomeBusy) return false;
        _welcomeBusy = true;
        try
        {
            var raw = await ModelCallAsync("playerSetup", WelcomeEntriesJson(e => picks.Contains(e.Id)), WelcomeEntriesJson());
            LogLine("welcome: playerSetup -> " + Shorten(raw ?? "null", 400));
            JsonObject? r = null;
            try { r = raw is null ? null : JsonNode.Parse(raw) as JsonObject; } catch { }
            if (r?["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Mid + "Could not set up the players" + (r?["error"]?.GetValue<string>() is { Length: > 0 } why ? ": " + why : "")); return false; }
            await ReadModelAsync();
            HostPrefs.Set("welcome.dismissed", false);   // players made: the page has done its work
            // the wall becomes a player at once, so the services' pages are up when their sign-in opens: the Video player when there is one
            var kind = r["video"]?.GetValue<string>() is { Length: > 0 } ? "video" : "music";
            var made = (r["made"] as JsonObject)?["scenes"] as JsonArray;
            if (made is { Count: > 0 } || _model.ActiveScene is null) await SwitchPlayerAsync(kind);
            // services added to players that stand: the wall is applied again, so their pages come up now and not at the next switch
            else if ((r["made"] as JsonObject)?["facets"] is JsonArray { Count: > 0 } && _model.ActiveScene is { } on) await ApplySceneAsync(on);
            CloseVideoHub();
            return true;
        }
        catch (Exception e) { LogLine("welcome add: " + e.Message); SetPill("Prism" + Mid + "Could not set up the players"); return false; }
        finally { _welcomeBusy = false; }
    }

    /// <summary>A service leaves the players and Watch (core playerRemove). Its App and its sign-in stay on the device; choosing it again on
    /// the first page brings it back.</summary>
    private async Task WelcomeRemoveAsync(WelcomeService s)
    {
        try
        {
            var raw = await ModelCallAsync("playerRemove", s.Id);
            LogLine("welcome: playerRemove " + s.Id + " -> " + Shorten(raw ?? "null", 300));
            if (raw is null || JsonNode.Parse(raw) is not JsonObject r || r["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Mid + "Could not remove " + s.Name); return; }
            await ReadModelAsync();
            SetPill("Prism" + Mid + s.Name + " is off your players. Its sign-in is kept, and Add more services brings it back");
            _ = UpdateWatchGripAsync();
        }
        catch (Exception e) { LogLine("welcome remove: " + e.Message); }
        await ShowWelcomeAsync();
    }

    /// <summary>The data folder in Explorer, its adapters and catalog folders made if they are not there.</summary>
    private void OpenAdaptersFolder()
    {
        try
        {
            Directory.CreateDirectory(Sources.AddedAdaptersDir);
            Directory.CreateDirectory(Sources.AddedCatalogDir);
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = HostPaths.DataDir, UseShellExecute = true });
        }
        catch (Exception e) { LogLine("open adapters folder: " + e.Message); SetPill("Prism" + Mid + "Could not open " + HostPaths.DataDir); }
    }

    /// <summary>A wall with nothing on it says where to begin (a new device after "Not now"): shown while the device has no scene and the
    /// welcome page is down.</summary>
    private Grid? _emptyWallNote;
    private void SyncEmptyWallNote()
    {
        // never over a sign-in, and never over a wall that has anything on it (2026-09-29 review: a scene made from the rail or a template
        // came up under the note until the welcome page was opened and closed)
        var show = _welcome is null && _model.Scenes.Count == 0 && !_asSession && !_surfaces.LiveTileIds().Any();
        if (!show) { if (_emptyWallNote is not null) _emptyWallNote.Visibility = Visibility.Collapsed; return; }
        if (_emptyWallNote is null)
        {
            var col = new StackPanel { Spacing = 14, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            col.Children.Add(new TextBlock { Text = "Nothing is set up yet", FontSize = 34, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center });
            col.Children.Add(new TextBlock { Text = "Choose your services and Prism sets up your Music player and your Video player.", FontSize = 18, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center, TextWrapping = TextWrapping.Wrap });
            var go = Chip(new TextBlock { Text = "Set up services", FontSize = 18, Foreground = HubInk }, true);
            go.HorizontalAlignment = HorizontalAlignment.Center;
            ToolTipService.SetToolTip(go, "Choose your music and video services and sign in to each");
            go.Click += (_, __) => _ = ShowWelcomeAsync(1);
            col.Children.Add(go);
            _emptyWallNote = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x0B, 0x0E, 0x12)) };
            _emptyWallNote.Children.Add(col);
            Canvas.SetZIndex(_emptyWallNote, 1);   // on the bare wall, under every page and menu
            RootGrid.Children.Add(_emptyWallNote);
        }
        _emptyWallNote.Visibility = Visibility.Visible;
    }

    /// <summary>One service's sign-in: the page steps aside for the sign-in window and comes back, its list read again, when that closes.</summary>
    private void WelcomeSignIn(string appId)
    {
        if (_welcome is not null) _welcome.Visibility = Visibility.Collapsed;
        _editorContinuations["app-setup"] = (id, saved) => RootGrid.DispatcherQueue.TryEnqueue(() => _ = ShowWelcomeAsync());
        // a service signed in already opens as itself (Open): the sign-in wizard is for one that is not (2026-09-29 review)
        var signedIn = _welcomeServices.FirstOrDefault(s => s.Id == appId)?.Status == "signed-in";
        OpenRoute("prism://app/" + Uri.EscapeDataString(appId) + "/setup?return=scene" + (signedIn ? "" : "&signin=1"));
    }

    /// <summary>This PC on the Set up services page (2026-10-06, Services/DeviceSetup): what needs Windows' permission, asked for once here so a
    /// TV with a remote never meets a prompt later. Each line says whether it is in place; one press asks Windows once for what is ticked.</summary>
    private void FillWelcomeThisPc(StackPanel block, TextBlock? summary = null)
    {
        block.Children.Clear();
        block.Children.Add(new TextBlock { Text = "Two things need Windows' permission. Doing them now means nobody meets a Windows prompt later on a TV with a remote.", FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxWidth = 760, HorizontalAlignment = HorizontalAlignment.Left });
        var fwIn = Services.DeviceSetup.FirewallRuleInPlace();
        var rdIn = Services.MediaHub.On;
        TextBlock Ink(string t) => new() { Text = t, FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        if (summary is not null) { summary.Text = fwIn && rdIn ? "Ready" : "Windows asks once"; summary.Foreground = fwIn && rdIn ? HubInk : HubAmber; }
        // what is in place said as a line, never as a disabled checkbox (the host's contrast rule: no information in a control's disabled grey)
        var fw = new CheckBox { IsChecked = true, Content = Ink("Let phones on your home network reach Prism (Windows Firewall)") };
        ToolTipService.SetToolTip(fw, "Prism's phone remote listens on port " + Services.DeviceSetup.RemotePort + ". This adds a Windows Firewall rule for Prism alone, from your home network alone, so Windows never stops to ask.");
        var rd = new CheckBox { IsChecked = false, Content = Ink(Services.MediaHub.MenuLabel + " (keep the sound and the screen when a remote desktop leaves)") };
        ToolTipService.SetToolTip(rd, Services.MediaHub.Explain);
        block.Children.Add(fwIn ? Ink((char)0x2713 + "  Phones on your home network can reach Prism (Windows Firewall)") : fw);
        block.Children.Add(rdIn ? Ink((char)0x2713 + "  " + Services.MediaHub.MenuLabel + " is on") : rd);
        if (fwIn && rdIn) return;
        var note = new TextBlock { FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        var go = Chip(new TextBlock { Text = "Set up (Windows asks once)", FontSize = 16, Foreground = HubInk }, true);
        ToolTipService.SetToolTip(go, "One Windows prompt for what is ticked");
        go.Click += async (_, __) =>
        {
            var wantFw = fw.IsChecked == true && !fwIn; var wantRd = rd.IsChecked == true && !rdIn;
            if (!wantFw && !wantRd) { note.Text = "Nothing is ticked."; return; }
            note.Text = "Windows is asking" + (char)0x2026;
            var ok = await Services.DeviceSetup.SetUpAsync(wantFw, wantRd, LogLine);
            SetPill("Prism" + Mid + (ok ? "this PC is set up" : "Windows did not allow it. Nothing changed."));
            FillWelcomeThisPc(block, summary);
        };
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        row.Children.Add(go); row.Children.Add(note);
        block.Children.Add(row);
    }

    /// <summary>The TMDB block on the Set up services page (2026-10-05): the key's state, a box to set or replace it, and the account under it
    /// (MainWindow.TmdbAccount.cs). Saving asks TMDB's approval right away, as Watch settings does.</summary>
    private async Task FillWelcomeTmdbAsync(StackPanel block, Grid page, TextBlock? summary = null)
    {
        JsonObject? v = null;
        try { v = JsonNode.Parse(await ModelCallAsync("videoSettings") ?? "null") as JsonObject; } catch (Exception e) { LogLine("welcome tmdb: " + e.Message); }
        // still this page (2026-10-06, "I'm on the your services screen and there is still no reference to TMDB setup"): the check walked the
        // drawn tree, which does not exist yet when core answers within the first frame, so the block gave up every time; the page itself is compared
        if (!ReferenceEquals(_welcome, page)) return;
        var hasKey = v?["tmdbKey"]?.GetValue<bool>() == true;
        if (summary is not null) summary.Text = "Optional  " + (char)0x00B7 + "  " + (hasKey ? "key set" : "not set");   // the accordion bar's state
        // what TMDB adds and how its data practices differ from Prism's (2026-10-06, "it was supposed to have the details on adding TMDB as a
        // resource with a tooltip informing what benefits it adds to the app. Also note about any data practices that are in conflict with our
        // own"): a line always shown, the benefits on a chip's tooltip and on its press (a wall has no hover from across the room), and the
        // differences said in amber with their own Details. Sourced from TMDB's privacy policy (effective 2026-08-24) and API terms
        // (2023-10-20); docs/features/tmdb-account.md "On the Set up services page".
        block.Children.Add(new TextBlock { Text = "TMDB is the free film and TV database Prism reads for ratings, the catalog and search across your services. Prism works without it.", FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxWidth = 760, HorizontalAlignment = HorizontalAlignment.Left });
        var bullet = " " + (char)0x2022 + " ";
        var benefits = "With your own free TMDB key, Prism adds:\n"
            + bullet + "Ratings on every card, with TMDB's vote count beside them\n"
            + bullet + "The catalog rows and Browse, by genre, rating, date and votes\n"
            + bullet + "Search everywhere: one search across your services, and which of them carries each title\n"
            + bullet + "The Episodes list for services that cannot list their own\n"
            + "With your TMDB account linked as well:\n"
            + bullet + "Rating titles from the wall, under your name\n"
            + bullet + "Your TMDB watchlist as My List\n"
            + bullet + "Playlists that follow your account to any device\n"
            + "Without a key, everything else in Prism works the same.";
        var practices = "Prism shows no ads, tracks no one and sells nothing. TMDB's own privacy policy (effective 24 August 2026) says this about TMDB:\n"
            + bullet + "It keeps API usage data, your IP address and device identifiers.\n"
            + bullet + "Its website and apps use Google Analytics and advertising partners for interest-based ads, and it shares personal data with them in a way it says \"may be considered a sale\". The opt-out is Your Privacy Choices on themoviedb.org.\n"
            + "What Prism sends TMDB, and only with your key:\n"
            + bullet + "The titles on your rows and the words you search, to find ratings and matches. Your key ties these to your TMDB account. It is the one kind of request Prism makes that carries an identifier.\n"
            + bullet + "With your account linked: the ratings you give, your watchlist and your playlists. They live on your TMDB account. A list can be public or private, and TMDB may show public content to others.\n"
            + "Nothing else from your services, the wall or this PC goes to TMDB, and nothing passes through Entangled. Clear the key to stop all of it.\n"
            + "This product uses the TMDB API but is not endorsed or certified by TMDB.";
        var infoRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var benefitsText = new TextBlock { Text = benefits, FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxWidth = 760, Visibility = Visibility.Collapsed, HorizontalAlignment = HorizontalAlignment.Left };
        var practicesText = new TextBlock { Text = practices, FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxWidth = 760, Visibility = Visibility.Collapsed, HorizontalAlignment = HorizontalAlignment.Left };
        var adds = Chip(new TextBlock { Text = "What TMDB adds", FontSize = 13, Foreground = HubInk }, false);
        ToolTipService.SetToolTip(adds, benefits);
        adds.Click += (_, __) => benefitsText.Visibility = benefitsText.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        var differs = Chip(new TextBlock { Text = "How TMDB's data practices differ from Prism's", FontSize = 13, Foreground = HubAmber }, false);
        ToolTipService.SetToolTip(differs, "TMDB keeps usage data and works with advertising partners, unlike Prism. Press for what Prism sends TMDB and what TMDB does with data.");
        differs.Click += (_, __) => practicesText.Visibility = practicesText.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
        infoRow.Children.Add(adds); infoRow.Children.Add(differs);
        block.Children.Add(infoRow);
        block.Children.Add(benefitsText);
        block.Children.Add(practicesText);
        block.Children.Add(new TextBlock { Text = hasKey ? (char)0x2713 + "  Key set. Ratings, the catalog rows and search are on." : "Not set. Get a free personal key at themoviedb.org " + (char)0x2192 + " Settings " + (char)0x2192 + " API, and paste it here.", FontSize = 15, Foreground = hasKey ? HubInk : HubAmber, TextWrapping = TextWrapping.Wrap });
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var keyBox = new PasswordBox { PlaceholderText = hasKey ? "Replace the key (optional)" : "TMDB API key or read access token", Width = 420, FontSize = 14 };
        var save = Chip(new TextBlock { Text = "Save", FontSize = 14, Foreground = HubAmber }, true);
        var note = new TextBlock { FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
        save.Click += async (_, __) =>
        {
            var key = keyBox.Password?.Trim() ?? "";
            if (key.Length == 0) { note.Text = "Paste the key first."; note.Foreground = HubAmber; return; }
            save.IsEnabled = false;
            await ModelCallAsync("lensSetTmdbKey", key);
            keyBox.Password = "";
            note.Text = "Saved."; note.Foreground = HubInk;
            SetPill("Prism" + Mid + "TMDB key saved");
            if (VideoHubOpen) _ = ShowVideoHubAsync();
            // the account's approval asked for right away, as Watch settings does (2026-10-03), unless it is linked already
            await Task.Delay(300);
            var st = await TmdbLinkStateAsync();
            if (st?["linked"]?.GetValue<bool>() != true) { await ModelCallAsync("tmdbLinkStart"); await ShowTmdbApprovalAsync(); }
            if (_welcome is not null) _ = ShowWelcomeAsync();   // the block redrawn with the key's state and the account
        };
        row.Children.Add(keyBox); row.Children.Add(save); row.Children.Add(note);
        if (hasKey)
        {
            var clear = Chip(new TextBlock { Text = "Clear the key", FontSize = 13, Foreground = HubInk }, false);
            clear.Click += async (_, __) => { await ModelCallAsync("lensSetTmdbKey", (string?)null); SetPill("Prism" + Mid + "TMDB key cleared"); if (VideoHubOpen) _ = ShowVideoHubAsync(); _ = ShowWelcomeAsync(); };
            row.Children.Add(clear);
        }
        block.Children.Add(row);
        var acct = new StackPanel();
        block.Children.Add(acct);
        _ = BuildTmdbAccountAsync(acct, hasKey);
    }

}
