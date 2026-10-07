using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// Playlists (docs/features/playlists.md, 2026-09-27): the host's part. Core keeps the playlists (per profile set), reads episodes through the
/// details window's own path, resolves the service and runs continuous play; the host draws the Send to playlist entries (the card menu, the
/// Details page's button and its season and episode menus), follows a send to its answer, asks before a large add, and draws the Playlists
/// screen - a Watch tab - where the order is managed. No drag (the user's decision: "a button or right click action to send-to the playlist and
/// we can manage order of playlists on a management screen"). Every control here is reachable by the remote; the context menu key opens the
/// same menus the right click does.
/// </summary>
public sealed partial class MainWindow
{
    private string _plQuery = "";
    private string _plSort = "updated";
    private string? _plOpenId;
    private readonly HashSet<string> _plSelected = new();
    private string? _plRunTag;
    private int _plRunFollow;
    private string? _plLastNote;

    private static string G(int code) => ((char)code).ToString();
    /// <summary>The playlist's progress as a bar that fills as it is watched (2026-09-27, "put a fill bar on the playlist on the watch screen and the
    /// playlist screen, so we can see a progress bar fill over time for total playlist completion"): completed of all not excluded.</summary>
    private static FrameworkElement FillBar(int done, int total, double height = 6)
    {
        var frac = total > 0 ? Math.Clamp((double)done / total, 0, 1) : 0;
        var g = new Grid { Height = height, CornerRadius = new CornerRadius(height / 2), Background = HubChip };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(frac, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - frac, GridUnitType.Star) });
        if (frac > 0) g.Children.Add(new Border { Background = HubAmber, CornerRadius = new CornerRadius(height / 2) });
        ToolTipService.SetToolTip(g, done + " of " + total + " watched (" + Math.Round(frac * 100) + "%)");
        return g;
    }
    /// <summary>A playlist's completion in words (2026-09-28, "for 704 items, 704 completed, I'd rather that show 704 items, 100% completed"): 100%
    /// only when every item is done (703 of 704 is 99%), "under 1%" for a start, 0% for none.</summary>
    private static string Pct(int done, int total)
    {
        if (total <= 0 || done <= 0) return "0%";
        if (done >= total) return "100%";
        var p = (int)Math.Floor(100.0 * done / total);
        return p < 1 ? "under 1%" : (p > 99 ? 99 : p) + "%";
    }
    private static (int done, int total) ProgressOf(JsonObject? summary) => (summary?["progress"]?["done"]?.GetValue<int>() ?? 0, summary?["progress"]?["total"]?.GetValue<int>() ?? 0);
    /// <summary>Which show and season heads are folded (true) or open (false), by playlist; unset = the default for the playlist's size.</summary>
    private readonly Dictionary<string, bool> _plFold = new();
    private int _plShown = 100;
    private Action? _plRedraw;
    private double _plNewsSeen;

    /// <summary>The search box let go of the keyboard (2026-09-27): Focus(FocusState.Unfocused) is refused by WinUI (ArgumentException) and it was
    /// unhandled - a press on Watch away from open search results closed Prism ("When I go to the playlists tab, it froze for a while and
    /// crashed"). The keyboard goes to the page itself.</summary>
    private void DropSearchFocus(Control box)
    {
        try { if (_videoHub is { } hub && FindChild<Control>(hub) is { } any && !ReferenceEquals(any, box)) any.Focus(FocusState.Programmatic); } catch { }
    }
    private static string Mid => " " + (char)0x00B7 + " ";

    // ---- Send to playlist

    /// <summary>Playlists can be used: a TMDB account with lists is linked (core's playlist gate). Send to playlist is offered only then (2026-10-06,
    /// "Playlists arent enabled without TMDB enabled, but I still see the send to playlist option on many videos"). Read fresh where a menu is
    /// built as it opens; the last answer is kept for the pages drawn at once (Details).</summary>
    private bool _playlistsActive;
    private async Task<bool> PlaylistsActiveAsync()
    {
        try { _playlistsActive = (JsonNode.Parse(await ModelCallAsync("playlistGate") ?? "null") as JsonObject)?["active"]?.GetValue<bool>() == true; } catch { }
        return _playlistsActive;
    }

    /// <summary>"Send to playlist" as a submenu: the open playlist first, then the recent ones, then New playlist... . The picker is read when
    /// the menu opens, so it names what is there now.</summary>
    private async Task<MenuFlyoutSubItem> SendToSubAsync(string text, Func<JsonObject> source)
    {
        var sub = new MenuFlyoutSubItem { Text = text, Icon = new FontIcon { Glyph = G(0xE8FD) } };
        JsonObject? pk = null;
        try { pk = JsonNode.Parse(await ModelCallAsync("playlistsPicker") ?? "null") as JsonObject; } catch { }
        foreach (var p in (pk?["items"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var id = S(p, "id"); var name = S(p, "name");
            var it = new MenuFlyoutItem { Text = name + (p["open"]?.GetValue<bool>() == true ? "  (open)" : "") };
            it.Click += (_, __) => _ = SendToPlaylistAsync(new JsonObject { ["id"] = id }, source());
            sub.Items.Add(it);
        }
        if (sub.Items.Count > 0) sub.Items.Add(new MenuFlyoutSeparator());
        var fresh = new MenuFlyoutItem { Text = "New playlist" + (char)0x2026, Icon = new FontIcon { Glyph = G(0xE710) } };
        fresh.Click += async (_, __) =>
        {
            var name = await PromptTextAsync("New playlist", "", "Its name", "Create");
            if (name is not null) await SendToPlaylistAsync(new JsonObject { ["newName"] = name }, source());
        };
        sub.Items.Add(fresh);
        return sub;
    }

    /// <summary>A MenuFlyout holding Send to entries, filled as it opens (the Details page's season headers and episode rows).</summary>
    private MenuFlyout SendToFlyout(params (string text, Func<JsonObject> source)[] entries)
    {
        var fly = new MenuFlyout();
        fly.Items.Add(new MenuFlyoutItem { Text = "Reading" + (char)0x2026, IsEnabled = false });
        fly.Opening += async (_, __) =>
        {
            var built = new List<MenuFlyoutItemBase>();
            foreach (var (text, source) in entries) built.Add(await SendToSubAsync(text, source));
            fly.Items.Clear();
            foreach (var b in built) fly.Items.Add(b);
        };
        return fly;
    }

    private async Task SendToPlaylistAsync(JsonObject target, JsonObject source)
    {
        JsonObject? r = null;
        try { r = JsonNode.Parse(await ModelCallAsync("playlistSend", target.ToJsonString(), source.ToJsonString()) ?? "null") as JsonObject; } catch { }
        var job = S(r, "job");
        if (job.Length == 0) { SetPill("Prism" + Mid + "that couldn't be sent to a playlist"); return; }
        await FollowPlaylistJobAsync(job);
    }

    /// <summary>A send or an import, followed to its answer: its words on the status line while episodes are read, the question before a large
    /// add, then what was added and what was already there.</summary>
    private async Task FollowPlaylistJobAsync(string job)
    {
        var last = "";
        for (var i = 0; i < 1200; i++)
        {
            JsonObject? j = null;
            try { j = JsonNode.Parse(await ModelCallAsync("playlistJob", job) ?? "null") as JsonObject; } catch { }
            var status = S(j, "status"); var msg = S(j, "message");
            if (status == "reading") { if (msg != last && msg.Length > 0) { SetPill("Prism" + Mid + msg + (char)0x2026); last = msg; } await Task.Delay(700); continue; }
            if (status == "confirm")
            {
                var n = j?["count"]?.GetValue<int>() ?? 0;
                ShowAskPanel("Add " + n + " episodes?", "That's a lot for one playlist. They'll go in as one block, and you can move or remove them later.", null, "Add all " + n, () => _ = ConfirmPlaylistJobAsync(job));
                return;
            }
            SetPill("Prism" + Mid + (msg.Length > 0 ? msg : status == "error" ? "that couldn't be added" : "done"));
            if (_hubTab == "playlists") _plRedraw?.Invoke();   // the Playlists panel alone, never the whole page (several sends at once each redrew it)
            return;
        }
    }
    private async Task ConfirmPlaylistJobAsync(string job)
    {
        try { await ModelCallAsync("playlistJobConfirm", job, "1"); } catch { }
        await FollowPlaylistJobAsync(job);
    }

    /// <summary>The source for a card or a title: a movie as itself; a show as all its episodes; a kind the service didn't say, a show if its
    /// service lists episodes and a movie if not.</summary>
    private static JsonObject CardSource(string title, string? kind, string? app, IEnumerable<string>? services = null, string? tmdb = null, string? poster = null, int? year = null)
    {
        var apps = new JsonArray();
        foreach (var a in (services ?? Enumerable.Empty<string>()).Prepend(app ?? "").Where(x => x.Length > 0).Distinct()) apps.Add(a);
        if (kind == "movie")
        {
            var svcs = new JsonArray();
            foreach (var a in apps) svcs.Add(new JsonObject { ["app"] = a!.GetValue<string>() });
            return new JsonObject { ["type"] = "movie", ["title"] = title, ["tmdb"] = tmdb, ["poster"] = poster, ["services"] = svcs, ["year"] = year };
        }
        return new JsonObject { ["type"] = "series", ["show"] = title, ["app"] = app, ["services"] = apps, ["scope"] = "all", ["tmdb"] = tmdb, ["poster"] = poster, ["year"] = year, ["orMovie"] = kind is not ("series" or "tv" or "episode" or "show") };
    }

    // ---- continuous play: the tag on the Playlists tab and the Next up note

    private async Task FollowPlaylistRunAsync()
    {
        var run = ++_plRunFollow;
        _plLastNote = null;
        while (run == _plRunFollow)
        {
            JsonObject? v = null;
            try { v = JsonNode.Parse(await ModelCallAsync("playlistsView", _plQuery, _plSort, _plOpenId ?? "") ?? "null") as JsonObject; } catch { }
            if (run != _plRunFollow) return;
            var r = v?["run"] as JsonObject;
            var tag = r is null ? null : "Playing from " + S(r, "name") + Mid + (r["index"]?.GetValue<int>() ?? 0) + " of " + (r["total"]?.GetValue<int>() ?? 0);
            if (v is not null) FillPlaylistDock(v);
            if (tag != _plRunTag) { _plRunTag = tag; if (_playlistsTabTag is not null) { _playlistsTabTag.Text = tag ?? ""; _playlistsTabTag.Visibility = tag is null ? Visibility.Collapsed : Visibility.Visible; } }
            var note = S(r, "note");
            if (note.Length > 0 && note != _plLastNote) { _plLastNote = note; SetPill("Prism" + Mid + note + ". Pick it in the service's player; the playlist carries on from there."); }
            if (r is null) return;
            await Task.Delay(2000);
        }
    }
    private TextBlock? _playlistsTabTag;

    // ---- the Playlists screen (a Watch tab)

    /// <summary>The gate (2026-10-03): playlists live on the person's TMDB account, so without one with lists there are none; the wording
    /// says which step is missing - the key, a read access token, or the approval.</summary>
    private async Task DrawPlaylistGateAsync(StackPanel panel)
    {
        JsonObject? g = null;
        try { g = JsonNode.Parse(await ModelCallAsync("playlistGate") ?? "null") as JsonObject; } catch { }
        var hasKey = g?["hasKey"]?.GetValue<bool>() == true;
        var linked = g?["linked"]?.GetValue<bool>() == true;
        var possible = g?["listsPossible"]?.GetValue<bool>() == true;
        var box = new StackPanel { Spacing = 10, MaxWidth = 760 };
        box.Children.Add(new TextBlock { Text = "Playlists live on your TMDB account", FontSize = 22, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
        box.Children.Add(new TextBlock { Text = "Each playlist is a list on TMDB, private unless you make it public, so it follows you to any device signed in to your account. Prism keeps your place in each show and episode in the list itself.", FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        var step = !hasKey ? "Put your TMDB API read access token in Watch settings, then link your account there."
            : !possible ? "Your TMDB key is the older v3 kind. Lists need the API read access token from the same TMDB page. Put it in Watch settings and link your account again."
            : !linked ? "Link your TMDB account in Watch settings: approve it once on TMDB's site."
            : "Your account was linked before lists were. Unlink it in Watch settings and link it again, once.";
        box.Children.Add(new TextBlock { Text = step, FontSize = 14, Foreground = HubAmber, TextWrapping = TextWrapping.Wrap });
        var go = Chip(new TextBlock { Text = "Open Watch settings", FontSize = 13, Foreground = HubInk }, true);
        ToolTipService.SetToolTip(go, "The TMDB key and account are under Watch settings.");
        go.Click += (_, __) => _ = ShowWatchSettingsAsync();
        box.Children.Add(go);
        panel.Children.Add(box);
    }

    private async Task DrawPlaylistsAsync(StackPanel panel, Grid overlay)
    {
        JsonObject? v = null;
        try { v = JsonNode.Parse(await ModelCallAsync("playlistsView", _plQuery, _plSort, _plOpenId ?? "") ?? "null") as JsonObject; } catch (Exception e) { LogLine("playlists: " + e.Message); }
        if (!ReferenceEquals(_videoHub, overlay) || _hubTab != "playlists") return;
        panel.Children.Clear();
        if (v is null) { panel.Children.Add(new TextBlock { Text = "Playlists couldn't be read.", FontSize = 16, Foreground = HubInk }); return; }
        // playlists are the person's TMDB lists (core playlist-tmdb.ts, 2026-10-03, "playlists are now gated behind that person account/key setup"):
        // without an account with lists, the gate says what to do and nothing else is drawn
        var tm = v["tmdb"] as JsonObject;
        if (tm?["active"]?.GetValue<bool>() != true) { await DrawPlaylistGateAsync(panel); return; }
        // new episodes a followed show brought (2026-09-27): said once on the status line
        foreach (var n in (v["news"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var at = n["at"]?.GetValue<double>() ?? 0;
            if (at <= _plNewsSeen) continue;
            _plNewsSeen = at;
            var c = n["count"]?.GetValue<int>() ?? 0;
            SetPill("Prism" + Mid + c + " new " + (c == 1 ? "episode" : "episodes") + " of " + S(n, "show") + " added to " + S(n, "list"));
        }
        void Redraw() => _ = DrawPlaylistsAsync(panel, overlay);
        _plRedraw = Redraw;
        async Task Call(string fn, params object?[] args) { try { await ModelCallAsync(fn, args); } catch { } Redraw(); }
        async Task Edit(string listId, JsonObject op)
        {
            JsonObject? r = null;
            try { r = JsonNode.Parse(await ModelCallAsync("playlistEdit", listId, op.ToJsonString()) ?? "null") as JsonObject; } catch { }
            if (r?["ok"]?.GetValue<bool>() == false && S(r, "error").Length > 0) SetPill("Prism" + Mid + S(r, "error"));
            Redraw();
        }
        Button SmallChip(string text, bool on, string tip, Action click)
        {
            var b = Chip(new TextBlock { Text = text, FontSize = 13, Foreground = HubInk }, on);
            b.Padding = new Thickness(12, 4, 12, 4);
            ToolTipService.SetToolTip(b, tip);
            b.Click += (_, __) => click();
            return b;
        }
        Button IconChip(int glyph, string tip, Action click)
        {
            var b = Chip(new FontIcon { Glyph = G(glyph), FontSize = 13, Foreground = HubInk }, false);
            b.Padding = new Thickness(8, 5, 8, 5);
            ToolTipService.SetToolTip(b, tip);
            b.Click += (_, __) => click();
            return b;
        }

        var grid = new Grid { ColumnSpacing = 28 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(320) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        panel.Children.Add(grid);

        // the playlists: filter (by name and by what's inside), sort, new, import
        var left = new StackPanel { Spacing = 10 };
        grid.Children.Add(left);
        var filter = new TextBox { PlaceholderText = "Find a playlist, a show or a title", Text = _plQuery, FontSize = 14 };
        filter.TextChanged += (_, __) => { var q = filter.Text; _ = Task.Delay(300).ContinueWith(_ => DispatcherQueue.TryEnqueue(() => { if (filter.Text == q && q != _plQuery) { _plQuery = q; Redraw(); } })); };
        left.Children.Add(filter);
        var sorts = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        sorts.Children.Add(SmallChip("Last updated", _plSort == "updated", "The playlist changed most recently first.", () => { _plSort = "updated"; Redraw(); }));
        sorts.Children.Add(SmallChip("Name", _plSort == "name", "Playlists A to Z.", () => { _plSort = "name"; Redraw(); }));
        left.Children.Add(sorts);
        var acts = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        acts.Children.Add(SmallChip("New playlist", false, "Make an empty playlist on your TMDB account, private or public there; send titles to it from a card's menu or a Details page.", async () =>
        {
            var (name, isPublic) = await PromptTextAsync("New playlist", "", "Its name", "Create", "Public on TMDB (anyone can see the list there)");
            if (name is null) return;
            try { var r = JsonNode.Parse(await ModelCallAsync("playlistCreate", name, isPublic) ?? "null") as JsonObject; _plOpenId = S(r, "id"); } catch { }
            Redraw();
        }));
        acts.Children.Add(SmallChip("Import My List", false, "Copy your My List into a playlist, once. It never stays in sync, and nothing changes on any service.", () => _ = ImportMyListAsync(v, Redraw)));
        left.Children.Add(acts);
        // the TMDB line: what the engine is doing, a read-now, the device's earlier playlists offered up once, titles TMDB could not place
        {
            var tline = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var note = S(tm, "note");
            var busy = tm["busy"]?.GetValue<bool>() == true;
            tline.Children.Add(IconChip(0xE72C, "Read your TMDB lists again now. They are read on their own every ten minutes.", () => _ = Call("playlistSync")));
            tline.Children.Add(new TextBlock { Text = note.Length > 0 ? note + (char)0x2026 : "On your TMDB account", FontSize = 12, Foreground = busy || note.Length > 0 ? HubAmber : HubInk, VerticalAlignment = VerticalAlignment.Center });
            left.Children.Add(tline);
            var localCount = tm["localCount"]?.GetValue<int>() ?? 0;
            if (localCount > 0)
            {
                var copy = SmallChip("Copy my " + localCount + " earlier " + (localCount == 1 ? "playlist" : "playlists") + " to TMDB", false, "The playlists made on this device before the account was linked, copied onto your TMDB account as private lists. The originals stay on the device.", () => _ = Call("playlistCopyLocal"));
                left.Children.Add(copy);
            }
            var um = (tm["unmatched"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0).ToList() ?? new List<string>();
            if (um.Count > 0)
            {
                var umt = new TextBlock { Text = "Kept on this device only, TMDB couldn't place " + (um.Count == 1 ? "it" : um.Count + " titles") + ": " + string.Join(", ", um.Take(3)) + (um.Count > 3 ? ", and more" : ""), FontSize = 12, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
                ToolTipService.SetToolTip(umt, string.Join(", ", um));
                left.Children.Add(umt);
            }
            if (busy) _ = Task.Delay(3000).ContinueWith(_ => DispatcherQueue.TryEnqueue(() => { if (ReferenceEquals(_videoHub, overlay) && _hubTab == "playlists" && _plRedraw == Redraw) Redraw(); }));
        }
        var openId = S(v["open"], "id");
        foreach (var l in (v["lists"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var id = S(l, "id"); var on = id == openId;
            var count = l["count"]?.GetValue<int>() ?? 0; var done = l["done"]?.GetValue<int>() ?? 0;
            var line = new StackPanel { Spacing = 1 };
            var nameRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            nameRow.Children.Add(new TextBlock { Text = S(l, "name"), FontSize = 15, Foreground = on ? HubAmber : HubInk, TextTrimming = TextTrimming.CharacterEllipsis });
            if (l["public"]?.GetValue<bool>() == true) { var pub = new FontIcon { Glyph = G(0xE774), FontSize = 12, Foreground = on ? HubAmber : HubInk, VerticalAlignment = VerticalAlignment.Center }; ToolTipService.SetToolTip(pub, "Public on TMDB: anyone can see this list there."); nameRow.Children.Add(pub); }
            line.Children.Add(nameRow);
            var (pd, pt) = ProgressOf(l);
            line.Children.Add(new TextBlock { Text = count + (count == 1 ? " item" : " items") + (pd > 0 ? Mid + Pct(pd, pt) + " completed" : ""), FontSize = 12, Foreground = HubDim });
            var lbar = FillBar(pd, pt, 4); lbar.Margin = new Thickness(0, 4, 0, 0); lbar.Width = 260; lbar.HorizontalAlignment = HorizontalAlignment.Left;
            line.Children.Add(lbar);
            var b = new Button { Content = line, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Background = on ? HubChipOn : HubChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(10), Padding = new Thickness(14, 8, 14, 8) };
            OwnHover(b);
            b.Click += (_, __) => { _plOpenId = id; _plSelected.Clear(); _ = Call("playlistOpen", id); };
            left.Children.Add(b);
        }
        if ((v["total"]?.GetValue<int>() ?? 0) == 0)
            left.Children.Add(new TextBlock { Text = "No playlists yet. Right-click a card, or open a title's Details, and choose Send to playlist.", FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });

        // the open playlist
        var right = new StackPanel { Spacing = 12 };
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);
        if (v["undo"] is JsonObject u)
            right.Children.Add(SmallChip("Undo: " + S(u, "label"), false, "Put it back the way it was.", () => _ = Call("playlistUndo")));
        if (v["open"] is not JsonObject o) { right.Children.Add(new TextBlock { Text = "Pick a playlist on the left.", FontSize = 16, Foreground = HubDim }); return; }
        var listId = S(o, "id");
        var manual = o["manual"]?.GetValue<bool>() == true;
        var run = v["run"] as JsonObject;
        var runHere = run is not null && S(run, "listId") == listId;
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        head.Children.Add(new TextBlock { Text = S(o, "name"), FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
        head.Children.Add(IconChip(0xE70F, "Rename this playlist", async () => { var n = await PromptTextAsync("Rename playlist", S(o, "name"), "Its name", "Rename"); if (n is not null) await Call("playlistRename", listId, n); }));
        {
            var isPub = (v["lists"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(x => S(x, "id") == listId)?["public"]?.GetValue<bool>() == true;
            head.Children.Add(IconChip(isPub ? 0xE774 : 0xE72E, isPub ? "Public on TMDB: anyone can see this list there. Press to make it private." : "Private on TMDB: only you see it. Press to make it public there.", () => _ = Call("playlistSetPublic", listId, !isPub)));
        }
        head.Children.Add(IconChip(0xE74D, "Delete this playlist (you can undo it for a moment)", () => ShowAskPanel("Delete " + S(o, "name") + "?", "The playlist and its order go. Undo brings it back for a moment after.", null, "Delete", () => { _plOpenId = null; _ = Call("playlistDelete", listId); })));
        right.Children.Add(head);
        {
            var (od, ot) = ProgressOf((v["lists"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(x => S(x, "id") == listId));
            var prog = new StackPanel { Spacing = 4, MaxWidth = 700, HorizontalAlignment = HorizontalAlignment.Left };
            prog.Children.Add(new TextBlock { Text = ot + (ot == 1 ? " item" : " items") + Mid + Pct(od, ot) + " completed", FontSize = 13, Foreground = HubInk });
            var obar = FillBar(od, ot, 8); obar.Width = 700;
            prog.Children.Add(obar);
            right.Children.Add(prog);
        }
        if (runHere) right.Children.Add(new TextBlock { Text = "Playing from this playlist" + Mid + (run!["index"]?.GetValue<int>() ?? 0) + " of " + (run["total"]?.GetValue<int>() ?? 0) + (run["stopAfter"]?.GetValue<bool>() == true ? Mid + "stops after this one" : ""), FontSize = 14, Foreground = HubAmber });

        var bar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        // sorting is done TO the playlist (2026-09-27, "The sort options on playlists need to be permanent, so when they go play the playlist, it is in
        // that order. So can we make these look more like actions against the playlist and less like slice & dice viewing"): the order becomes that
        // order, Play follows it, Undo puts the old one back
        var sortBtn = SmallChip("Sort playlist" + (char)0x2026, false, "Reorder the playlist itself. Play follows the new order, and Undo puts the old one back.", () => { });
        var sortFly = new MenuFlyout();
        foreach (var (by, label, tip) in new[] { ("show", "By show", "The shows A to Z, each season in air order, movies last"), ("released", "By release date", "Oldest first: an episode's air date, a movie's release date"), ("added", "By date added", "The order the titles were added") })
        {
            var b2 = by;
            var m = new MenuFlyoutItem { Text = label };
            ToolTipService.SetToolTip(m, tip);
            m.Click += (_, __) => _ = Edit(listId, new JsonObject { ["op"] = "sort", ["by"] = b2 });
            sortFly.Items.Add(m);
        }
        sortBtn.Flyout = sortFly;
        bar.Children.Add(sortBtn);
        bar.Children.Add(new Border { Width = 14 });
        bar.Children.Add(SmallChip("Services" + (char)0x2026, false, "The order of services to play from: the first one signed in here that has the title plays it.", () => ShowServiceOrder(o, listId, Edit)));
        // mark many at once (2026-09-27, "on the playlist editor, let's make sure there is a mass mark as watched action. by series, movie, season,
        // episode, or just all"): everything, all the movies, a whole series; a season from its heading's menu, an episode or a movie from its own
        {
            var everything = (o["groups"] as JsonArray)?.OfType<JsonObject>().SelectMany(g => (g["items"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>()).ToList() ?? new();
            JsonArray Keys(IEnumerable<JsonObject> xs) { var a = new JsonArray(); foreach (var x in xs) a.Add(S(x, "key")); return a; }
            var markBtn = SmallChip("Mark watched" + (char)0x2026, false, "Mark many at once: everything, all the movies, or a whole series", () => { });
            var mf = new MenuFlyout();
            void MarkItem(object parent, string text, IEnumerable<JsonObject> xs, bool done)
            {
                var list = xs.ToList();
                var m = new MenuFlyoutItem { Text = text + "  (" + list.Count + ")", IsEnabled = list.Count > 0 };
                m.Click += (_, __) => _ = Edit(listId, new JsonObject { ["op"] = "mark", ["keys"] = Keys(list), ["done"] = done, ["keep"] = true });
                if (parent is MenuFlyoutSubItem sub) sub.Items.Add(m); else mf.Items.Add(m);
            }
            MarkItem(mf, "Everything watched", everything.Where(i => i["completed"]?.GetValue<bool>() != true), true);
            var movies = everything.Where(i => S(i, "kind") == "movie").ToList();
            if (movies.Count > 0) MarkItem(mf, "All movies watched", movies.Where(i => i["completed"]?.GetValue<bool>() != true), true);
            var shows = everything.Where(i => S(i, "kind") == "episode").GroupBy(i => S(i, "show")).OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase).ToList();
            if (shows.Count > 0)
            {
                var series = new MenuFlyoutSubItem { Text = "A whole series watched" };
                foreach (var g in shows) MarkItem(series, g.Key, g.Where(i => i["completed"]?.GetValue<bool>() != true), true);
                mf.Items.Add(series);
            }
            mf.Items.Add(new MenuFlyoutSeparator());
            MarkItem(mf, "Everything not watched", everything.Where(i => i["completed"]?.GetValue<bool>() == true), false);
            markBtn.Flyout = mf;
            bar.Children.Add(markBtn);
        }
        bar.Children.Add(SmallChip("Clear completed", false, "Take the completed items out (undo brings them back for a moment).", () => _ = Edit(listId, new JsonObject { ["op"] = "clearCompleted" })));
        right.Children.Add(bar);
        var follows = (o["follows"] as JsonArray)?.Select(x => x?.GetValue<string>()).Where(x => !string.IsNullOrEmpty(x)).ToList() ?? new();
        if (follows.Count > 0)
            right.Children.Add(new TextBlock { Text = "New episodes are added as they come out: " + string.Join(", ", follows), FontSize = 13, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });

        // several items picked: they move and mark together
        if (_plSelected.Count > 0)
        {
            var keys = new JsonArray(); foreach (var k in _plSelected) keys.Add(k);
            var sel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            sel.Children.Add(new TextBlock { Text = _plSelected.Count + " picked", FontSize = 14, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center });
            if (manual)
            {
                sel.Children.Add(SmallChip("Move up", false, "One place up, together", () => _ = Edit(listId, new JsonObject { ["op"] = "moveBy", ["keys"] = keys.DeepClone(), ["how"] = "up" })));
                sel.Children.Add(SmallChip("Move down", false, "One place down, together", () => _ = Edit(listId, new JsonObject { ["op"] = "moveBy", ["keys"] = keys.DeepClone(), ["how"] = "down" })));
                sel.Children.Add(SmallChip("Move to top", false, "To the top, together", () => _ = Edit(listId, new JsonObject { ["op"] = "moveBy", ["keys"] = keys.DeepClone(), ["how"] = "top" })));
            }
            sel.Children.Add(SmallChip("Mark completed", false, "Fade them and move them to the end", () => _ = Edit(listId, new JsonObject { ["op"] = "mark", ["keys"] = keys.DeepClone(), ["done"] = true })));
            sel.Children.Add(SmallChip("Remove", false, "Take them out of the playlist", () => { _plSelected.Clear(); _ = Edit(listId, new JsonObject { ["op"] = "remove", ["keys"] = keys.DeepClone() }); }));
            sel.Children.Add(SmallChip("Clear picks", false, "Unpick them", () => { _plSelected.Clear(); Redraw(); }));
            right.Children.Add(sel);
        }

        var groups = (o["groups"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        if (groups.All(g => ((g["items"] as JsonArray)?.Count ?? 0) == 0))
            right.Children.Add(new TextBlock { Text = "This playlist is empty. Send titles to it from a card's menu or a Details page.", FontSize = 14, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
        // a big playlist draws only what is open (2026-09-27: 441 Star Trek items drawn at once froze the page): the show and season heads fold,
        // and open on the season holding the next item to play; a plain view draws a hundred rows at a time
        var total = groups.Sum(g => ((g["items"] as JsonArray)?.Count ?? 0));
        var nextKey = groups.SelectMany(g => (g["items"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>()).FirstOrDefault(i => i["completed"]?.GetValue<bool>() != true && i["excluded"]?.GetValue<bool>() != true) is { } nx ? S(nx, "key") : "";
        bool Folded(string key, bool holds) => _plFold.TryGetValue(key, out var f) ? f : total > 60 && !holds;
        Button Head(string text, string sub, bool folded, double size, Thickness margin, string tip, Action toggle)
        {
            var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
            line.Children.Add(new FontIcon { Glyph = G(folded ? 0xE76C : 0xE70D), FontSize = 12, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
            line.Children.Add(new TextBlock { Text = text, FontSize = size, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
            if (sub.Length > 0) line.Children.Add(new TextBlock { Text = sub, FontSize = 13, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center });
            var b = new Button { Content = line, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Background = HubChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(10), Padding = new Thickness(12, 6, 12, 6), Margin = margin };
            OwnHover(b);
            ToolTipService.SetToolTip(b, tip);
            b.Click += (_, __) => toggle();
            return b;
        }
        string Count(IEnumerable<JsonObject> items)
        {
            var list = items.ToList();
            var done = list.Count(i => i["completed"]?.GetValue<bool>() == true); var off = list.Count(i => i["excluded"]?.GetValue<bool>() == true);
            return list.Count + (list.Count == 1 ? " item" : " items") + (done > 0 ? Mid + Pct(done, list.Count - off) + " completed" : "") + (off > 0 ? Mid + off + " excluded" : "");
        }
        // the playlist's own order, with a head over each run of one show's season (three or more in a row) - a sorted playlist folds by show and
        // season, an interleaved one reads as it is; a long playlist draws a hundred open rows at a time
        var all = groups.SelectMany(g => (g["items"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>()).ToList();
        string RunKey(JsonObject i) => S(i, "kind") == "episode" ? S(i, "show") + "|" + i["season"] : "";
        var drawn = 0;
        for (var k = 0; k < all.Count && drawn < _plShown;)
        {
            var rk = RunKey(all[k]);
            var end = k + 1;
            if (rk.Length > 0) while (end < all.Count && RunKey(all[end]) == rk) end++;
            var runItems = all.GetRange(k, end - k);
            if (rk.Length > 0 && runItems.Count >= 3)
            {
                var sn = runItems[0]["season"]?.GetValue<int>() ?? 0;
                var foldKey = listId + "|" + rk + "|" + k;
                var folded = Folded(foldKey, runItems.Any(i => S(i, "key") == nextKey));
                var label = S(runItems[0], "show") + Mid + (sn == 0 ? "Specials" : "Season " + sn);
                var f2 = folded;
                var sh = Head(label, Count(runItems), folded, 15, new Thickness(0, 6, 0, 0), folded ? "Show " + label : "Fold " + label, () => { _plFold[foldKey] = !f2; Redraw(); });
                // the season's own mark menu: the right click, or the remote's context key
                var runKeys = new JsonArray(); foreach (var it2 in runItems) runKeys.Add(S(it2, "key"));
                var sfly = new MenuFlyout();
                var sw = new MenuFlyoutItem { Text = "Mark " + label + " watched" }; sw.Click += (_, __) => _ = Edit(listId, new JsonObject { ["op"] = "mark", ["keys"] = runKeys.DeepClone(), ["done"] = true, ["keep"] = true });
                var sn2 = new MenuFlyoutItem { Text = "Mark " + label + " not watched" }; sn2.Click += (_, __) => _ = Edit(listId, new JsonObject { ["op"] = "mark", ["keys"] = runKeys.DeepClone(), ["done"] = false, ["keep"] = true });
                sfly.Items.Add(sw); sfly.Items.Add(sn2);
                sh.ContextFlyout = sfly;
                ToolTipService.SetToolTip(sh, (folded ? "Show " : "Fold ") + label + ". Right-click to mark the whole season watched or not watched.");
                right.Children.Add(sh);
                if (!folded) foreach (var it in runItems) { right.Children.Add(PlaylistRow(it, listId, manual, runHere && S(run, "key") == S(it, "key"), o, Edit, Redraw)); drawn++; }
            }
            else foreach (var it in runItems) { right.Children.Add(PlaylistRow(it, listId, manual, runHere && S(run, "key") == S(it, "key"), o, Edit, Redraw)); drawn++; }
            k = end;
            if (drawn >= _plShown && k < all.Count)
            {
                right.Children.Add(SmallChip("Show more (" + (all.Count - k) + " left)", false, "Draw the next hundred", () => { _plShown += 100; Redraw(); }));
                break;
            }
        }
    }

    private FrameworkElement PlaylistRow(JsonObject it, string listId, bool manual, bool playing, JsonObject o, Func<string, JsonObject, Task> edit, Action redraw)
    {
        var key = S(it, "key");
        var completed = it["completed"]?.GetValue<bool>() == true;
        var keyArr = new JsonArray { key };
        var excluded = it["excluded"]?.GetValue<bool>() == true;
        var row = new Grid { ColumnSpacing = 12, Opacity = excluded ? 0.35 : completed ? 0.45 : 1 };
        foreach (var w in new[] { GridLength.Auto, new GridLength(34), new GridLength(96), new GridLength(1, GridUnitType.Star), GridLength.Auto })
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = w });
        var pick = new CheckBox { IsChecked = _plSelected.Contains(key), MinWidth = 0, VerticalAlignment = VerticalAlignment.Center };
        ToolTipService.SetToolTip(pick, "Pick it, to move or mark several together");
        pick.Checked += (_, __) => { _plSelected.Add(key); redraw(); };
        pick.Unchecked += (_, __) => { _plSelected.Remove(key); redraw(); };
        row.Children.Add(pick);
        var pos = new TextBlock { Text = (it["pos"]?.GetValue<int>() ?? 0).ToString(), FontSize = 14, Foreground = playing ? HubAmber : HubDim, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(pos, 1); row.Children.Add(pos);
        var art = new Border { Width = 96, Height = 54, CornerRadius = new CornerRadius(6), Background = HubChip };
        if (S(it, "poster") is { Length: > 0 } pu && Uri.TryCreate(pu, UriKind.Absolute, out var puri)) art.Child = new Image { Source = new BitmapImage(puri) { DecodePixelWidth = 192 }, Stretch = Stretch.UniformToFill };
        Grid.SetColumn(art, 2); row.Children.Add(art);
        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        var ep = S(it, "kind") == "episode";
        var titleLine = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (excluded) titleLine.Children.Add(new FontIcon { Glyph = G(0xED1A), FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });   // the closed eye
        titleLine.Children.Add(new TextBlock { Text = S(it, "title"), FontSize = 15, Foreground = playing ? HubAmber : HubInk, TextTrimming = TextTrimming.CharacterEllipsis });
        if (excluded) ToolTipService.SetToolTip(titleLine, "Excluded: the playlist skips it. Right-click to include it again.");
        if (S(o, "lastKey") == key)   // the last one watched: Play starts here, or after it once it is finished (2026-09-27)
        {
            titleLine.Children.Add(new Border { Background = HubChipOn, CornerRadius = new CornerRadius(8), Padding = new Thickness(8, 1, 8, 1), VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock { Text = "Last watched", FontSize = 11, Foreground = HubAmber } });
        }
        text.Children.Add(titleLine);
        var sub = ep ? S(it, "show") + Mid + "S" + it["season"] + " E" + it["episode"] + (S(it, "airDate").Length > 0 ? Mid + S(it, "airDate") : "") : "Movie" + (S(it, "airDate").Length > 0 ? Mid + S(it, "airDate") : "");
        text.Children.Add(new TextBlock { Text = sub, FontSize = 12, Foreground = HubDim, TextTrimming = TextTrimming.CharacterEllipsis });
        var on = it["playsOn"] as JsonObject;
        var mism = (it["mismatch"] as JsonArray)?.Select(x => x?.GetValue<string>()).Where(x => x is not null).ToList() ?? new();
        var where = on is null ? "Not available here" : "Plays on " + S(on, "name") + (S(it, "pin").Length > 0 ? " (pinned)" : "");
        if (mism.Count > 0) where += Mid + string.Join(", ", mism) + " numbers this show differently";
        text.Children.Add(new TextBlock { Text = where, FontSize = 12, Foreground = on is null || mism.Count > 0 ? HubAmber : HubDim, TextTrimming = TextTrimming.CharacterEllipsis });
        Grid.SetColumn(text, 3); row.Children.Add(text);

        var btns = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        Button Ic(int glyph, string tip, Action click)
        {
            var b = Chip(new FontIcon { Glyph = G(glyph), FontSize = 13, Foreground = HubInk }, false);
            b.Padding = new Thickness(8, 5, 8, 5);
            ToolTipService.SetToolTip(b, tip);
            b.Click += (_, __) => click();
            return b;
        }
        if (manual)
        {
            btns.Children.Add(Ic(0xE70E, "Move up", () => _ = edit(listId, new JsonObject { ["op"] = "moveBy", ["keys"] = keyArr.DeepClone(), ["how"] = "up" })));
            btns.Children.Add(Ic(0xE70D, "Move down", () => _ = edit(listId, new JsonObject { ["op"] = "moveBy", ["keys"] = keyArr.DeepClone(), ["how"] = "down" })));
        }
        var more = Ic(0xE712, "More: move, mark, pin to a service, remove", () => { });
        var fly = new MenuFlyout();
        void Add(string label, Action a, bool enabled = true) { var m = new MenuFlyoutItem { Text = label, IsEnabled = enabled }; m.Click += (_, __) => a(); fly.Items.Add(m); }
        if (manual)
        {
            Add("Move to top", () => _ = edit(listId, new JsonObject { ["op"] = "moveBy", ["keys"] = keyArr.DeepClone(), ["how"] = "top" }));
            Add("Move to position" + (char)0x2026, async () =>
            {
                var t = await PromptTextAsync("Move to position", (it["manualIndex"]?.GetValue<int>() + 1 ?? 1).ToString(), "A number, 1 is the top", "Move");
                if (int.TryParse(t, out var n)) await edit(listId, new JsonObject { ["op"] = "moveBy", ["keys"] = keyArr.DeepClone(), ["how"] = n });
            });
            fly.Items.Add(new MenuFlyoutSeparator());
        }
        Add(excluded ? "Include again" : "Exclude from this playlist", () => _ = edit(listId, new JsonObject { ["op"] = "exclude", ["keys"] = keyArr.DeepClone(), ["on"] = !excluded }));
        Add(completed ? "Mark not completed" : "Mark completed", () => _ = edit(listId, new JsonObject { ["op"] = "mark", ["keys"] = keyArr.DeepClone(), ["done"] = !completed }));
        if (ep)
        {
            // follow the show: its new episodes added as they come out (2026-09-27, "If I add an entire series, and more episodes/seasons come out, is
            // it possible for those to get auto-added to the playlist?")
            var showName = S(it, "show");
            var followed = (o["follows"] as JsonArray)?.Any(x => string.Equals(x?.GetValue<string>(), showName, StringComparison.OrdinalIgnoreCase)) == true;
            Add(followed ? "Stop adding new episodes of " + showName : "Add new episodes of " + showName + " as they come out", () => _ = edit(listId, new JsonObject { ["op"] = "follow", ["key"] = key, ["on"] = !followed }));
        }
        if (ep) Add("Mark all of this show completed", () => _ = edit(listId, new JsonObject { ["op"] = "markShow", ["key"] = key }));
        var pin = new MenuFlyoutSubItem { Text = "Play on" };
        foreach (var s in (it["services"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var app = S(s, "app");
            var m = new MenuFlyoutItem { Text = S(s, "name") + (S(it, "pin") == app ? "  (pinned)" : "") };
            m.Click += (_, __) => _ = edit(listId, new JsonObject { ["op"] = "pin", ["key"] = key, ["app"] = app });
            pin.Items.Add(m);
        }
        if (S(it, "pin").Length > 0) { var c = new MenuFlyoutItem { Text = "Clear the pin (use the playlist's order)" }; c.Click += (_, __) => _ = edit(listId, new JsonObject { ["op"] = "pin", ["key"] = key, ["app"] = "" }); pin.Items.Add(c); }
        fly.Items.Add(pin);
        fly.Items.Add(new MenuFlyoutSeparator());
        Add("Remove", () => { _plSelected.Remove(key); _ = edit(listId, new JsonObject { ["op"] = "remove", ["keys"] = keyArr.DeepClone() }); });
        if (ep) Add("Remove all of this show", () => _ = edit(listId, new JsonObject { ["op"] = "removeShow", ["key"] = key }));
        more.Flyout = fly;
        row.ContextFlyout = fly;   // the right click and the remote's context key open the same menu
        btns.Children.Add(more);
        Grid.SetColumn(btns, 4); row.Children.Add(btns);
        return row;
    }

    private async Task PlayPlaylistAsync(string listId, string? key)
    {
        JsonObject? r = null;
        try { r = JsonNode.Parse(await ModelCallAsync("playlistPlay", listId, key ?? "") ?? "null") as JsonObject; } catch { }
        if (r?["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Mid + (S(r, "error").Length > 0 ? S(r, "error") : "that couldn't start")); return; }
        _ = FollowPlaylistRunAsync();
        if (_hubTab == "playlists") _plRedraw?.Invoke();
        _ = FillPlaylistDockAsync();
    }

    /// <summary>The playlist's service order: each service with Move up; the first one signed in here that has a title plays it.</summary>
    private void ShowServiceOrder(JsonObject o, string listId, Func<string, JsonObject, Task> edit)
    {
        var order = (o["serviceOrder"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        var fly = new MenuFlyout();
        for (var i = 0; i < order.Count; i++)
        {
            var s = order[i];
            var label = (i + 1) + ". " + S(s, "name") + (s["signedIn"]?.GetValue<bool>() == true ? "" : " (not signed in here)");
            var m = new MenuFlyoutItem { Text = i == 0 ? label : label + "   move up" };
            var at = i;
            if (i > 0) m.Click += (_, __) =>
            {
                var apps = new JsonArray();
                var list = order.Select(x => S(x, "app")).ToList();
                (list[at - 1], list[at]) = (list[at], list[at - 1]);
                foreach (var a in list) apps.Add(a);
                _ = edit(listId, new JsonObject { ["op"] = "order", ["apps"] = apps });
            };
            else m.IsEnabled = true;
            fly.Items.Add(m);
        }
        if (_videoHub is not null) fly.ShowAt(_videoHub, new Microsoft.UI.Xaml.Controls.Primitives.FlyoutShowOptions { Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Auto });
    }

    /// <summary>Import My List: which services' lists, all episodes or season 1 only, into a new playlist or the open one - a one-time copy.</summary>
    private async Task ImportMyListAsync(JsonObject view, Action redraw)
    {
        var box = new StackPanel { Spacing = 10, MinWidth = 380 };
        box.Children.Add(new TextBlock { Text = "A one-time copy of My List. It never stays in sync, and nothing changes on any service.", TextWrapping = TextWrapping.Wrap });
        var checks = new List<(CheckBox cb, string app)>();
        foreach (var s in (view["services"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            if (s["signedIn"]?.GetValue<bool>() != true) continue;
            var cb = new CheckBox { Content = S(s, "name"), IsChecked = true };
            checks.Add((cb, S(s, "app")));
            box.Children.Add(cb);
        }
        var all = new RadioButton { Content = "Shows: all episodes", IsChecked = true, GroupName = "plimp" };
        var s1 = new RadioButton { Content = "Shows: season 1 only", GroupName = "plimp" };
        box.Children.Add(all); box.Children.Add(s1);
        var openName = S(view["open"], "name");
        var into = new RadioButton { Content = openName.Length > 0 ? "Into " + openName : "Into the open playlist", IsChecked = openName.Length > 0, IsEnabled = openName.Length > 0, GroupName = "plto" };
        var fresh = new RadioButton { Content = "Into a new playlist named My List", IsChecked = openName.Length == 0, GroupName = "plto" };
        box.Children.Add(into); box.Children.Add(fresh);
        var dlg = new ContentDialog { Title = "Import My List", Content = box, PrimaryButtonText = "Import", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary, XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        try { if (await dlg.ShowAsync() != ContentDialogResult.Primary) return; } catch { return; }
        var apps = new JsonArray(); foreach (var (cb, app) in checks) if (cb.IsChecked == true) apps.Add(app);
        var target = into.IsChecked == true ? new JsonObject { ["id"] = S(view["open"], "id") } : new JsonObject { ["newName"] = "My List" };
        JsonObject? r = null;
        try { r = JsonNode.Parse(await ModelCallAsync("playlistImport", target.ToJsonString(), apps.ToJsonString(), s1.IsChecked == true ? "s1" : "all") ?? "null") as JsonObject; } catch { }
        if (S(r, "job") is { Length: > 0 } job) await FollowPlaylistJobAsync(job);
        redraw();
    }
}
