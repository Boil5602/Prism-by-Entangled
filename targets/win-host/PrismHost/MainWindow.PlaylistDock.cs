using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// The Watch page's playlist panel, on top of the big screen (2026-09-27, "Show the playlst on top of the big screen, actually"; first under the windows, "Lets not play from the playlist screen. Instead lets add a little dropdown
/// to start a playlist on the Watch screen. It can go underneath the big screen and we can show the current details, position as well as items
/// completed and items remaining. If someone needs to make changes to the playlist, there can be a quick link to take you into it"). Idle: a
/// playlist picker and Play. Playing: what is on (title, show and episode, service), where the run is ("3 of 12"), how many are completed and
/// how many remain, Stop after this one and Stop, and Edit playlist, which opens it on the Playlists tab. Core runs the playlist; this draws it.
/// </summary>
public sealed partial class MainWindow
{
    private Border? _plDock;
    private double _plDockH;
    private Action? _stackShape;
    /// <summary>The room the panel takes above the big screen: its height and a gap, none while it is hidden.</summary>
    private double PlaylistDockRoom() => _plDock is { Visibility: Visibility.Visible } && _plDockH > 0 ? _plDockH + 10 : 0;
    /// <summary>The playlist selected, or null for None (2026-10-01, "Playlist should be a selection or none. None means something OTHER than
    /// the playlist is playing on the big window"): a run makes its list the selection; the selection goes to None when the big window takes
    /// a title of its own while no playlist runs, or when a run ends because another title took the window.</summary>
    private string? _plDockPick;
    private JsonObject? _plView;                 // the last playlists view, for the bar's control
    private Action<JsonObject>? _plBarFill;      // the big window's playlist control, filled from the view
    private bool _plRunWas;                      // a run was on at the last fill
    private DateTime _plBigChangedAt = DateTime.MinValue, _plPlayPressedAt = DateTime.MinValue;
    /// <summary>The big window took a new title (PlaceLabel): with no playlist running, the selection is None - unless Play was just pressed
    /// and this is the playlist's own title arriving.</summary>
    private string? _plBigTitle;
    private void NotePlaylistWindowChanged(string title)
    {
        if (title == _plBigTitle) return;   // the label redrawn (a resize, the page reopened), not a new title (review 2026-10-01)
        _plBigTitle = title;
        _plBigChangedAt = DateTime.UtcNow;
        if (title.Length == 0 || _plView?["run"] is JsonObject || (DateTime.UtcNow - _plPlayPressedAt).TotalSeconds < 90) return;
        if (_plDockPick is not null) { _plDockPick = null; if (_plView is { } v) { FillPlaylistDock(v); } }
    }
    /// <summary>The panel is in use (the pointer on it, its menu open): the timed refresh leaves it alone.</summary>
    private bool _plDockBusy => _plDockOver || _plDockMenu;
    private bool _plDockOver, _plDockMenu;

    /// <summary>Called as the Watch page's corner is built: the panel under the windows, filled from core.</summary>
    private void BuildPlaylistDock(Grid overlay)
    {
        _plDock = new Border { Background = HubCard, CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 10, 12, 10), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Visibility = Visibility.Collapsed };
        Canvas.SetZIndex(_plDock, 30);
        overlay.Children.Add(_plDock);
        _plDock.PointerEntered += (_, __) => _plDockOver = true;
        _plDock.PointerExited += (_, __) => _plDockOver = false;
        // the screens make room for it as it grows or shrinks (idle, playing), and give it back when it hides
        _plDock.SizeChanged += (_, e) => { if (Math.Abs(e.NewSize.Height - _plDockH) > 2) { _plDockH = e.NewSize.Height; _stackShape?.Invoke(); } };
        _ = FillPlaylistDockAsync();
    }

    /// <summary>The panel right above the big screen, as wide as it, moving with it.</summary>
    private void PlacePlaylistDock()
    {
        if (_plDock is null || _stackRects[0].Width <= 0) return;
        _plDock.Width = _stackRects[0].Width + 4;
        _plDock.Margin = new Thickness(_stackRects[0].X - 2, _stackRects[0].Y - 2 - (_plDockH > 0 ? _plDockH : 0) - 8, 0, 0);
    }

    private async Task FillPlaylistDockAsync()
    {
        JsonObject? v = null;
        try { v = JsonNode.Parse(await ModelCallAsync("playlistsView", "", "updated", "") ?? "null") as JsonObject; } catch { }
        if (v is not null) { _playlistsActive = (v["tmdb"] as JsonObject)?["active"]?.GetValue<bool>() == true; FillPlaylistDock(v); }
        if (v?["run"] is JsonObject) _ = FollowPlaylistRunAsync();
    }

    /// <summary>The panel drawn from core's playlists view: the picker and Play, or the run.</summary>
    private void FillPlaylistDock(JsonObject v)
    {
        if (_plDock is null || _stackOverlay is null) return;
        var lists = (v["lists"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        var run = v["run"] as JsonObject;
        _plView = v;
        if (run is not null) _plDockPick = S(run, "listId");
        else if (_plRunWas && (DateTime.UtcNow - _plBigChangedAt).TotalSeconds < 30) _plDockPick = null;   // the run ended as the window took another title: None
        if (_plDockPick is not null && (v["total"]?.GetValue<int>() ?? lists.Count) == lists.Count && !lists.Any(l => S(l, "id") == _plDockPick)) _plDockPick = null;   // a list deleted (a view the tab's search filtered says nothing)
        _plRunWas = run is not null;
        _plBarFill?.Invoke(v);
        var was = _plDock.Visibility;
        if (lists.Count == 0 && run is null) { _plDock.Visibility = Visibility.Collapsed; if (was != Visibility.Collapsed) _stackShape?.Invoke(); return; }   // no playlists: nothing to start
        _plDock.Visibility = Visibility.Visible;
        if (was != Visibility.Visible && _plDockH > 0) _stackShape?.Invoke();
        var body = new StackPanel { Spacing = 8 };
        Button Small(UIElement content, bool on, string tip, Action click) => PlSmall(content, on, tip, click);
        TextBlock T(string text, double size, SolidColorBrush ink) => PlT(text, size, ink);
        var head = PlHead();
        var editId = run is not null ? S(run, "listId") : _plDockPick ?? S(lists.FirstOrDefault(l => l["open"]?.GetValue<bool>() == true) ?? lists.FirstOrDefault(), "id");
        var edit = PlEdit(editId);

        if (run is null)
        {
            // idle: which playlist (or None), and Play
            var pick = lists.FirstOrDefault(l => S(l, "id") == _plDockPick);
            head.Children.Add(T("Playlist", 14, HubInk));
            head.Children.Add(edit);
            body.Children.Add(head);
            var row = new Grid { ColumnSpacing = 8 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var name = pick is null ? "None" : S(pick, "name"); var count = pick?["count"]?.GetValue<int>() ?? 0; var done = pick?["done"]?.GetValue<int>() ?? 0;
            var chooser = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            chooser.Children.Add(T(name, 14, HubInk));
            if (pick is not null) chooser.Children.Add(T((count - done) + " to go", 12, HubInk));
            chooser.Children.Add(new FontIcon { Glyph = G(0xE70D), FontSize = 11, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
            var drop = Small(chooser, false, "Pick a playlist, or None", () => { });
            drop.HorizontalAlignment = HorizontalAlignment.Stretch; drop.HorizontalContentAlignment = HorizontalAlignment.Left;
            var fly = new MenuFlyout();
            var noneItem = new ToggleMenuFlyoutItem { Text = "None", IsChecked = pick is null };
            noneItem.Click += (_, __) => { _plDockPick = null; FillPlaylistDock(v); };
            fly.Items.Add(noneItem);
            foreach (var l in lists)
            {
                var id = S(l, "id");
                var c = l["count"]?.GetValue<int>() ?? 0; var dn = l["done"]?.GetValue<int>() ?? 0;
                var m = new ToggleMenuFlyoutItem { Text = S(l, "name") + "  (" + (c - dn) + " to go)", IsChecked = id == _plDockPick };
                m.Click += (_, __) => { _plDockPick = id; FillPlaylistDock(v); };
                fly.Items.Add(m);
            }
            fly.Opened += (_, __) => _plDockMenu = true;
            fly.Closed += (_, __) => _plDockMenu = false;
            drop.Flyout = fly;
            row.Children.Add(drop);
            var play = Small(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { new FontIcon { Glyph = G(0xE768), FontSize = 12, Foreground = HubInk }, T("Play", 13, HubInk) } }, false,
                pick is null ? "Pick a playlist first." : "Play " + name + " where it left off, one item after another, in the big window", () => { if (_plDockPick is not null) _ = PlayPlaylistAsync(_plDockPick, null); });
            play.IsEnabled = pick is not null;
            Grid.SetColumn(play, 1);
            row.Children.Add(play);
            body.Children.Add(row);
            if (pick is null) { _plDock.Child = body; return; }
            var (pd, pt) = ProgressOf(pick);
            body.Children.Add(FillBar(pd, pt));
            // where Play starts: the last one watched, or the one after it once that is finished (2026-09-27)
            if (pick["resume"] is JsonObject rs)
            {
                var what = S(rs, "kind") == "episode" ? S(rs, "show") + Mid + "S" + rs["season"] + " E" + rs["episode"] + Mid + S(rs, "title") : S(rs, "title");
                body.Children.Add(T((rs["last"]?.GetValue<bool>() == true ? "Carries on with " : "Starts with ") + what, 12, HubDim));
            }
        }
        else DrawPlaylistRun(body, run, head, edit, FillPlaylistDockAsync);
        _plDock.Child = body;
    }
    private Button PlSmall(UIElement content, bool on, string tip, Action click)
    {
        var b = Chip(content, on);
        b.Padding = new Thickness(10, 4, 10, 4);
        ToolTipService.SetToolTip(b, tip);
        b.Click += (_, __) => click();
        return b;
    }
    private static TextBlock PlT(string text, double size, SolidColorBrush ink) => new() { Text = text, FontSize = size, Foreground = ink, TextTrimming = TextTrimming.CharacterEllipsis };
    private static Grid PlHead()
    {
        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        return head;
    }
    /// <summary>"Edit playlist": the list on the Playlists tab.</summary>
    private HyperlinkButton PlEdit(string? editId)
    {
        // a pencil, as on the big window's bar (2026-10-01, "Use a pencil icon to indicate it can be edited but same behavior")
        var edit = new HyperlinkButton { Content = new FontIcon { Glyph = G(0xE70F), FontSize = 13, Foreground = HubAmber }, Padding = new Thickness(6, 2, 6, 2), VerticalAlignment = VerticalAlignment.Center };
        ToolTipService.SetToolTip(edit, editId is null ? "Build a playlist on the Playlists tab." : "Change this playlist on the Playlists tab.");
        edit.Click += (_, __) => { _plOpenId = editId; _plSelected.Clear(); _ = ModelCallAsync("playlistOpen", editId ?? ""); _hubTab = "playlists"; _ = ShowVideoHubAsync(); };
        Grid.SetColumn(edit, 1);
        return edit;
    }
    /// <summary>The run as it stands: what's on, where the run is, and its controls. Drawn in the dock and in the big window's playlist menu.</summary>
    private void DrawPlaylistRun(StackPanel body, JsonObject run, Grid head, HyperlinkButton edit, Func<Task> refresh)
    {
        Button Small(UIElement content, bool on, string tip, Action click) => PlSmall(content, on, tip, click);
        TextBlock T(string text, double size, SolidColorBrush ink) => PlT(text, size, ink);

        // playing: what's on, where the run is, and its controls
        head.Children.Add(T("Playing from " + S(run, "name"), 14, HubAmber));
        head.Children.Add(edit);
        body.Children.Add(head);
        if (run["current"] is JsonObject cur)
        {
            var line = new Grid { ColumnSpacing = 10 };
            line.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(80) });
            line.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var art = new Border { Width = 80, Height = 45, CornerRadius = new CornerRadius(4), Background = HubChip };
            if (S(cur, "poster") is { Length: > 0 } pu && Uri.TryCreate(pu, UriKind.Absolute, out var puri)) art.Child = new Image { Source = new BitmapImage(puri) { DecodePixelWidth = 160 }, Stretch = Stretch.UniformToFill };
            line.Children.Add(art);
            var text = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
            text.Children.Add(T(S(cur, "title"), 14, HubInk));
            var sub = S(cur, "kind") == "episode" ? S(cur, "show") + Mid + "S" + cur["season"] + " E" + cur["episode"] : "Movie";
            if (S(cur, "service").Length > 0) sub += Mid + S(cur, "service");
            text.Children.Add(T(sub, 12, HubDim));
            Grid.SetColumn(text, 1);
            line.Children.Add(text);
            body.Children.Add(line);
        }
        var index = run["index"]?.GetValue<int>() ?? 0; var total = run["total"]?.GetValue<int>() ?? 0;
        var completed = run["completed"]?.GetValue<int>() ?? 0; var remaining = run["remaining"]?.GetValue<int>() ?? 0;
        body.Children.Add(T(index + " of " + total + Mid + Pct(completed, completed + remaining) + " completed" + Mid + remaining + " remaining", 13, HubInk));
        body.Children.Add(FillBar(completed, completed + remaining));
        if (S(run, "note").Length > 0) body.Children.Add(new TextBlock { Text = S(run, "note") + ". Pick it in the service's player.", FontSize = 12, Foreground = HubAmber, TextWrapping = TextWrapping.Wrap });
        var ctl = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var stopAfter = run["stopAfter"]?.GetValue<bool>() == true;
        var hasPrev = run["hasPrevious"]?.GetValue<bool>() == true; var hasNext = run["hasNext"]?.GetValue<bool>() == true;
        async Task MoveAsync(string dir)
        {
            try { if (JsonNode.Parse(await ModelCallAsync("playlistMove", dir) ?? "{}") is JsonObject r && r["ok"]?.GetValue<bool>() != true && r["error"]?.GetValue<string>() is { Length: > 0 } why) SetPill("Prism" + Mid + char.ToUpperInvariant(why[0]) + why[1..]); } catch { }
            await refresh();
        }
        var prev = Small(T("Previous", 12, HubInk), false, hasPrev ? "Play the one before this in the playlist" : "This is the first one in the playlist", () => MoveAsync("previous"));
        var next = Small(T("Next", 12, HubInk), false, hasNext ? "Play the next one in the playlist" : "This is the last one in the playlist", () => MoveAsync("next"));
        prev.IsEnabled = hasPrev; next.IsEnabled = hasNext;
        ctl.Children.Add(prev); ctl.Children.Add(next);
        ctl.Children.Add(Small(T(stopAfter ? "Stops after this one" : "Stop after this one", 12, HubInk), stopAfter, "End the playlist when what's playing now finishes",
            async () => { try { await ModelCallAsync("playlistStop", "after"); } catch { } await refresh(); }));
        ctl.Children.Add(Small(T("Stop", 12, HubInk), false, "Stop the playlist and pause what it is playing",
            async () => { _plRunWas = false; try { await ModelCallAsync("playlistStop", "now"); } catch { } await refresh(); }));   // a deliberate stop keeps the selection
        body.Children.Add(ctl);
    }

    /// <summary>
    /// The big window's playlist control, on its bar (2026-10-01, "Can we make it so the playlist is playable on that control bar too?" /
    /// "Playlist should be a selection or none ... drop down, select it, press play, it starts wherever it last left off" / "Use a pencil icon
    /// to indicate it can be edited"): the selection (None or a playlist, with a drop-down to change it; the run's place while one plays), Play
    /// - or Stop while the selected playlist runs - and a pencil that opens the playlist on the Playlists tab to build and edit it. The same
    /// core calls as the dock above the window; both are filled from the same view.
    /// </summary>
    private void PlaylistBar(StackPanel line, double size)
    {
        var selText = new TextBlock { Text = "None", FontSize = size + 1, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 220 };
        var selContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { new FontIcon { Glyph = G(0xE8FD), FontSize = size, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center }, selText, new FontIcon { Glyph = G(0xE70D), FontSize = size - 3, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center } } };
        var sel = Chip(selContent, false);
        sel.Padding = new Thickness(8, 3, 8, 3);
        var playIcon = new FontIcon { Glyph = G(0xE768), FontSize = size, Foreground = HubInk };
        var play = Chip(playIcon, false);
        var pencil = Chip(new FontIcon { Glyph = G(0xE70F), FontSize = size, Foreground = HubInk }, false);
        ToolTipService.SetToolTip(pencil, "Build or change playlists on the Playlists tab.");
        pencil.Click += (_, __) => { var id = _plDockPick; _plOpenId = id; _plSelected.Clear(); if (id is not null) _ = ModelCallAsync("playlistOpen", id); _hubTab = "playlists"; _ = ShowVideoHubAsync(); };
        line.Children.Add(sel); line.Children.Add(play); line.Children.Add(pencil);
        void Fill(JsonObject v)
        {
            var lists = (v["lists"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
            var run = v["run"] as JsonObject;
            var pick = lists.FirstOrDefault(l => S(l, "id") == _plDockPick);
            var running = run is not null && pick is not null && S(run, "listId") == S(pick, "id");
            if (pick is null) selText.Text = "None";
            else
            {
                var c = pick["count"]?.GetValue<int>() ?? 0; var dn = pick["done"]?.GetValue<int>() ?? 0;
                selText.Text = S(pick, "name") + (running ? Mid + run!["index"] + " of " + run["total"] : c - dn > 0 ? Mid + (c - dn) + " to go" : "");
            }
            ToolTipService.SetToolTip(sel, pick is null ? "No playlist selected. Pick one to play in the big window." : running ? "Playing from " + S(pick, "name") + ". Picking another, or None, stops it." : S(pick, "name") + " is selected. Play starts it where it left off.");
            var fly = new MenuFlyout { Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Top };
            // a pick while a playlist runs stops the run first (what's playing pauses), then stands for Play (review 2026-10-01: a pick
            // drawn from a view with a run on was written straight back to the run's list)
            async Task PickAsync(string? id)
            {
                if (run is not null) { _plRunWas = false; try { await ModelCallAsync("playlistStop", "now"); } catch { } }
                _plDockPick = id;
                if (run is not null) await FillPlaylistDockAsync(); else FillPlaylistDock(v);
            }
            var none = new ToggleMenuFlyoutItem { Text = "None", IsChecked = pick is null };
            none.Click += async (_, __) => await PickAsync(null);
            fly.Items.Add(none);
            foreach (var l in lists)
            {
                var id = S(l, "id"); var c = l["count"]?.GetValue<int>() ?? 0; var dn = l["done"]?.GetValue<int>() ?? 0;
                var m = new ToggleMenuFlyoutItem { Text = S(l, "name") + "  (" + (c - dn) + " to go)", IsChecked = id == _plDockPick };
                m.Click += async (_, __) => await PickAsync(id);
                fly.Items.Add(m);
            }
            if (run is not null)
            {
                fly.Items.Add(new MenuFlyoutSeparator());
                var after = new ToggleMenuFlyoutItem { Text = "Stop after this one", IsChecked = run["stopAfter"]?.GetValue<bool>() == true };
                after.Click += async (_, __) => { try { await ModelCallAsync("playlistStop", "after"); } catch { } await FillPlaylistDockAsync(); };
                fly.Items.Add(after);
            }
            fly.Opened += (_, __) => _plDockMenu = true;
            fly.Closed += (_, __) => _plDockMenu = false;
            sel.Flyout = fly;
            playIcon.Glyph = running ? G(0xE71A) : G(0xE768);
            play.Visibility = pick is null ? Visibility.Collapsed : Visibility.Visible;
            ToolTipService.SetToolTip(play, running ? "Stop the playlist. What's playing pauses where it is." : "Play " + (pick is null ? "" : S(pick, "name") + " ") + "where it left off, one item after another, in the big window.");
            ToolTipService.SetToolTip(pencil, pick is null ? "Build a playlist on the Playlists tab." : "Change " + S(pick, "name") + " on the Playlists tab.");
        }
        play.Click += async (_, __) =>
        {
            var run = _plView?["run"] as JsonObject;
            if (run is not null && S(run, "listId") == _plDockPick) { _plRunWas = false; try { await ModelCallAsync("playlistStop", "now"); } catch { } await FillPlaylistDockAsync(); return; }   // a deliberate stop keeps the selection
            if (_plDockPick is { } id) { _plPlayPressedAt = DateTime.UtcNow; await PlayPlaylistAsync(id, null); }
        };
        _plBarFill = Fill;
        if (_plView is { } v0) Fill(v0); else _ = FillPlaylistDockAsync();
    }
}
