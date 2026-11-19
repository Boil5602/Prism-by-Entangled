using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;
using PrismHost.Visualizations;

namespace PrismHost;

/// <summary>
/// The music panel (2026-11-16, asked for one drill-in panel in place of Quick play's menus within menus). One panel, 400 wide,
/// a fixed height with the list scrolling inside it; a row replaces the panel's content and Back or Escape returns one level. No
/// flyout opens from it and nothing opens on hover. Where the panel is, and every list it shows, is core's (music-panel.ts:
/// musicPanelNav, musicPanelHome, musicPanelLibrary); this file draws them and sends the same plays, searches and lookups the old
/// menu sent. It is Quick play since 2026-11-16: the old menu was taken out on the owner's approval, and its setting with it.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>The open panel's own navigation, for the dev command "musicpanel go".</summary>
    private Func<string, string?, string?, Task>? _mpGo;
    /// <summary>The open panel's text box (Home's search, a library's filter), for the dev command "musicpanel type": a test types without keys.</summary>
    private TextBox? _mpBox;

    private static string MpGlyph(int code) => ((char)code).ToString();
    private static string MpQuote(string s) => (char)0x201C + s + (char)0x201D;

    private static void MpFocus(Control c)
    {
        c.UseSystemFocusVisuals = true;
        c.FocusVisualPrimaryBrush = Tokens.Amber; c.FocusVisualPrimaryThickness = new Thickness(2);
        c.FocusVisualSecondaryBrush = Tokens.Clear; c.FocusVisualSecondaryThickness = new Thickness(0);
    }

    /// <summary>A row of the panel: a real button, see-through at rest, at least 48 tall.</summary>
    private static Button MpRow(UIElement content, double minHeight = 48)
    {
        var b = new Button { Content = content, Background = HubClear, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(8), Padding = new Thickness(8, 6, 8, 6), MinHeight = minHeight, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch };
        MpFocus(b);
        return b;
    }

    /// <summary>An icon-only button, 44 square, with its label for a screen reader and on a hover.</summary>
    private static Button MpIconButton(int glyph, string label)
    {
        var b = new Button { Content = new FontIcon { Glyph = MpGlyph(glyph), FontSize = 16, Foreground = Tokens.Ink }, Background = HubClear, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(8), Width = 44, Height = 44, Padding = new Thickness(0) };
        AutomationProperties.SetName(b, label); ToolTipService.SetToolTip(b, label);
        MpFocus(b);
        return b;
    }

    /// <summary>A bordered action under a row or on the card, at least 44 tall.</summary>
    private static Button MpAction(string text, int? glyph = null)
    {
        var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        if (glyph is int g) line.Children.Add(new FontIcon { Glyph = MpGlyph(g), FontSize = 14, Foreground = Tokens.Ink });
        line.Children.Add(new TextBlock { Text = text, FontSize = 13, Foreground = Tokens.Ink, VerticalAlignment = VerticalAlignment.Center });
        var b = new Button { Content = line, Background = HubClear, BorderBrush = Tokens.Edge, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), MinHeight = 44, Padding = new Thickness(12, 0, 12, 0), HorizontalAlignment = HorizontalAlignment.Stretch };
        MpFocus(b);
        return b;
    }

    /// <summary>Artwork: the picture when the service gives one, else a tinted tile with a music note. Square with a 6 radius; round for a station.</summary>
    private static Border MpArt(string name, bool round, double size = 40, string? url = null)
    {
        var art = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(round ? size / 2 : size >= 60 ? 8 : 6), Background = Tokens.ArtTint(name), VerticalAlignment = VerticalAlignment.Center };
        if (url is { Length: > 0 } && (url.StartsWith("http", StringComparison.OrdinalIgnoreCase) || (s_standIn && url.StartsWith("standin:", StringComparison.Ordinal))))
        {
            // under stand-ins (dev, MainWindow.StandIn.cs) every cover comes from the stand-in folder, a real address too
            try { art.Child = new Image { Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(s_standIn ? Services.ArtCache.UriFor(url) : new Uri(url)), Stretch = Stretch.UniformToFill }; return art; } catch { }
        }
        art.Child = new FontIcon { Glyph = MpGlyph(0xEC4F), FontSize = size * 0.42, Foreground = Tokens.Ink, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        return art;
    }

    private static TextBlock MpLabel(string text) => new() { Text = text.ToUpperInvariant(), FontSize = 11, CharacterSpacing = 80, Foreground = Tokens.Soft, Margin = new Thickness(8, 10, 8, 4) };

    /// <summary>Art, a name and a line under it, and what stands at the row's right end.</summary>
    private static Grid MpLine(UIElement? art, string name, string? meta, Brush? metaBrush = null, UIElement? end = null)
    {
        var g = new Grid { ColumnSpacing = 12 };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        if (art is FrameworkElement a) { Grid.SetColumn(a, 0); g.Children.Add(a); }
        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(new TextBlock { Text = name, FontSize = 14, Foreground = Tokens.Ink, TextTrimming = TextTrimming.CharacterEllipsis });
        if (meta is { Length: > 0 }) text.Children.Add(new TextBlock { Text = meta, FontSize = 12, Foreground = metaBrush ?? Tokens.Soft, TextTrimming = TextTrimming.CharacterEllipsis });
        Grid.SetColumn(text, 1); g.Children.Add(text);
        if (end is FrameworkElement e) { e.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(e, 2); g.Children.Add(e); }
        return g;
    }

    private static FontIcon MpChevron() => new() { Glyph = MpGlyph(0xE76C), FontSize = 12, Foreground = Tokens.Soft };

    private static Border MpBadge(string text, bool lit) => new()
    {
        Background = lit ? Tokens.Amber : Tokens.Band, CornerRadius = new CornerRadius(10), Padding = new Thickness(8, 3, 8, 3), Margin = new Thickness(0, 0, 8, 0),
        Child = new TextBlock { Text = text, FontSize = 12, Foreground = lit ? Tokens.AmberInk : Tokens.Ink },
    };

    private static Style MusicPanelPresenterStyle()
    {
        var st = new Style(typeof(FlyoutPresenter));
        st.Setters.Add(new Setter(Control.RequestedThemeProperty, ElementTheme.Dark));
        st.Setters.Add(new Setter(Control.BackgroundProperty, Tokens.Panel));
        st.Setters.Add(new Setter(Control.BorderBrushProperty, Tokens.Rule));
        st.Setters.Add(new Setter(Control.BorderThicknessProperty, new Thickness(1)));
        st.Setters.Add(new Setter(Control.CornerRadiusProperty, new CornerRadius(12)));
        st.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(0)));
        st.Setters.Add(new Setter(FrameworkElement.MinWidthProperty, 0.0));
        st.Setters.Add(new Setter(FrameworkElement.MaxWidthProperty, 860.0));   // Scenes is the wide screen
        st.Setters.Add(new Setter(FrameworkElement.MaxHeightProperty, 2000.0));
        st.Setters.Add(new Setter(ScrollViewer.VerticalScrollModeProperty, ScrollMode.Disabled));
        st.Setters.Add(new Setter(ScrollViewer.VerticalScrollBarVisibilityProperty, ScrollBarVisibility.Disabled));
        return st;
    }

    /// <summary>The panel over its button, or at a point on the anchor (a right press on the stage). False when core gave no state: the old menu opens.</summary>
    /// <paramref name="host"/> is the element of another window to show on (the mini player's): the panel may then leave that window's edges.
    private async Task<bool> ShowMusicPanelAsync(FrameworkElement anchor, string source, Windows.Foundation.Point? at, FrameworkElement? host = null)
    {
        await RefreshMusicSourcesAsync();
        var height = Math.Max(420, Math.Min(780, RootGrid.ActualHeight - 140));
        var body = new Grid();
        var stripText = new TextBlock { FontSize = 13, Foreground = Tokens.Ink, TextTrimming = TextTrimming.CharacterEllipsis };
        var strip = new Border { Background = Tokens.AmberAt(0x1F), BorderBrush = Tokens.Rule, BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(16, 10, 16, 10), Child = stripText, Visibility = Visibility.Collapsed };
        AutomationProperties.SetLiveSetting(strip, AutomationLiveSetting.Polite);
        var root = new Grid { Width = 400, Height = height, CornerRadius = new CornerRadius(12) };
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(body, 0); Grid.SetRow(strip, 1); root.Children.Add(body); root.Children.Add(strip);
        var flyout = new Flyout { Content = root, Placement = FlyoutPlacementMode.Top, FlyoutPresenterStyle = MusicPanelPresenterStyle() };

        // the old menu's shield (B-215): while the panel is open an unseen grid covers the screen, so the pointer never touches a web page
        var shield = new Grid { Background = HubClear };
        Canvas.SetZIndex(shield, 999);
        var closing = false; var canBack = false; long escapeAt = 0; var gen = 0;
        string? nowTile = null;   // the service whose song the now playing card shows: the later screens act on it
        var cardTimer = DispatcherQueue.CreateTimer(); cardTimer.Interval = TimeSpan.FromMilliseconds(1500);
        Action? cardTick = null;
        cardTimer.Tick += (_, __) => cardTick?.Invoke();
        void Close() { closing = true; try { flyout.Hide(); } catch { } }
        shield.PointerPressed += (_, e) => { e.Handled = true; Close(); };

        void Say(string text) { stripText.Text = text; strip.Visibility = text.Length > 0 ? Visibility.Visible : Visibility.Collapsed; if (text.Length > 0) LogLine("music panel: " + text); }
        string NameOf(string tile) => _musicSources.Where(x => x.tile == tile).Select(x => x.name).FirstOrDefault() ?? tile;

        async Task Go(string op, string? screen = null, string? arg = null)
        {
            JsonObject? st = null;
            try { st = JsonNode.Parse(await ModelCallAsync("musicPanelNav", op, screen, arg) ?? "null") as JsonObject; } catch { }
            if (st is null || st["open"]?.GetValue<bool>() != true) { Close(); return; }
            await Render(st);
        }

        Grid Header(string title, UIElement? end = null)
        {
            var back = MpIconButton(0xE72B, "Back");
            back.Click += (_, __) => _ = Go("back");
            var g = new Grid { ColumnSpacing = 4, Margin = new Thickness(8, 8, 8, 0) };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var t = new TextBlock { Text = title, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Tokens.Ink, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
            Grid.SetColumn(back, 0); Grid.SetColumn(t, 1); g.Children.Add(back); g.Children.Add(t);
            if (end is FrameworkElement e) { Grid.SetColumn(e, 2); g.Children.Add(e); }
            return g;
        }

        // ------------------------------------------------------------------ Home
        async Task<UIElement> HomeAsync(int my)
        {
            List<TransportState> rows;
            try { rows = await ReadTransportAsync(); } catch { rows = new(); }
            // a pick that is loading comes first (2026-11-16): the card says what was just asked for, as the music player's block does
            static bool Loading(TransportState x) => (x.Pending is { Length: > 0 } && x.PendingFailed is null && !x.Playing) || (x.Work is { Length: > 0 } w && !w.StartsWith('!'));
            TransportState? Now(List<TransportState> rs) => rs.FirstOrDefault(Loading) ?? rs.FirstOrDefault(x => x.Playing) ?? rs.FirstOrDefault(x => _musicSources.Any(s => s.active && (s.tile == x.TileId || s.tile == x.Facet))) ?? rs.FirstOrDefault();
            string TileOf(TransportState t) => _musicSources.Where(s => s.tile == t.TileId || s.tile == t.Facet).Select(s => s.tile).FirstOrDefault() ?? t.TileId;

            var page = new Grid();
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // the now playing card
            var card = new StackPanel { Spacing = 10, Padding = new Thickness(16, 16, 16, 10), BorderBrush = Tokens.Rule, BorderThickness = new Thickness(0, 0, 0, 1) };
            var artHost = new Border { Width = 64, Height = 64 };
            var over = new TextBlock { FontSize = 11, CharacterSpacing = 80, Foreground = Tokens.Amber, TextTrimming = TextTrimming.CharacterEllipsis };
            var title = new TextBlock { FontSize = 17, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Tokens.Ink, TextTrimming = TextTrimming.CharacterEllipsis };
            var artist = new TextBlock { FontSize = 13, Foreground = Tokens.Soft, TextTrimming = TextTrimming.CharacterEllipsis };
            var playIcon = new FontIcon { FontSize = 18, Foreground = Tokens.AmberInk };
            var playBtn = new Button { Content = playIcon, Width = 48, Height = 48, CornerRadius = new CornerRadius(24), Padding = new Thickness(0), Background = Tokens.Ink, BorderThickness = new Thickness(0), VerticalAlignment = VerticalAlignment.Center };
            OwnHover(playBtn); MpFocus(playBtn);
            var upValue = new TextBlock { FontSize = 13, Foreground = Tokens.Ink, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
            var fullValue = new TextBlock { FontSize = 13, Foreground = Tokens.Ink, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
            string? shownArt = "?"; var nowPlaying = false;
            // 2026-11-16, asked that the wait after a press on Play says what happens: from the press until the player answers (or 20
            // seconds pass) the card says Starting or Pausing and the button turns into a ring; a start that never came says so.
            // The rule is PlayWait's, shared with the music bar's Play.
            var playWait = new PlayWait();
            var ring = new ProgressRing { IsActive = true, Width = 22, Height = 22, Foreground = Tokens.AmberInk };
            void PaintCard(List<TransportState> rs)
            {
                var t = Now(rs);
                nowTile = t is null ? null : TileOf(t); nowPlaying = t?.Playing == true;
                var service = nowTile is null ? "" : NameOf(nowTile);
                var name = t?.Title ?? t?.ResumeTitle;
                playWait.Read(nowPlaying, t is not null, Environment.TickCount64, t is not null && Loading(t));
                // loading (2026-11-16, asked that the card says it as the music player's block does): the pick's name, and the work in hand under it
                var loading = t is not null && Loading(t);
                var failed = t is { Playing: false, Pending: { Length: > 0 }, PendingFailed: not null };
                var state = loading ? "Loading" : failed ? "Did not start" : playWait.Words ?? (name is null ? "Nothing playing" : nowPlaying ? "Now playing" : "Paused");
                over.Text = (state + (service.Length > 0 ? Mid + service : "")).ToUpperInvariant();
                title.Text = loading && t!.Pending is { Length: > 0 } pn ? pn : failed ? "Could not start " + t!.Pending : name ?? (loading ? "Getting it ready" : service.Length > 0 ? "Pick something below" : "Add a music service to begin");
                artist.Text = loading ? (t!.Work is { Length: > 0 } wk ? wk : t.Pending is { Length: > 0 } && name is not null ? "" : "") : t?.Title is not null ? t.Artist ?? "" : t?.ResumeArtist ?? "";
                artist.Visibility = artist.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
                var art = t?.Title is not null ? t.Artwork : t?.ResumeArtwork;   // the song Play would resume shows its own cover too
                if (art != shownArt) { shownArt = art; artHost.Child = MpArt(name ?? service, false, 64, art); }
                playIcon.Glyph = nowPlaying ? GlyphPause : GlyphPlay;
                var label = nowPlaying ? "Pause" : "Play";
                AutomationProperties.SetName(playBtn, label); ToolTipService.SetToolTip(playBtn, label);
                playBtn.Content = playWait.Waiting || loading ? ring : playIcon;
                if (playWait.Label is { } wl) { AutomationProperties.SetName(playBtn, wl); ToolTipService.SetToolTip(playBtn, wl); }
                else if (loading) { AutomationProperties.SetName(playBtn, "Loading"); ToolTipService.SetToolTip(playBtn, "Loading"); }
                playBtn.IsEnabled = t is not null && !playWait.Waiting && !loading;
                var order = t?.Order is { Length: > 0 } o ? Cap(o) : "In order";
                upValue.Text = order + (t?.Repeat == true ? Mid + "Repeat" : "");
                fullValue.Text = service;
            }
            PaintCard(rows);
            playBtn.Click += (_, __) =>
            {
                if (nowTile is null) return;
                _brain.Call(HostCalls.TileCommand, nowTile, nowPlaying ? "pause" : "play");
                LogLine("music panel: " + (nowPlaying ? "pause " : "play ") + nowTile);
                playWait.Press(nowPlaying, Environment.TickCount64);
                var svc = NameOf(nowTile);
                over.Text = (playWait.Words + (svc.Length > 0 ? Mid + svc : "")).ToUpperInvariant();
                playBtn.Content = ring; playBtn.IsEnabled = false;
                _ = Task.Delay(500).ContinueWith(done => RootGrid.DispatcherQueue.TryEnqueue(() => cardTick?.Invoke()));
            };
            var busy = false;
            cardTick = async () =>
            {
                if (busy || my != gen || !flyout.IsOpen) return;
                busy = true;
                try { var rs = await ReadTransportAsync(); if (my == gen) PaintCard(rs); } catch { } finally { busy = false; }
            };
            var top = new Grid { ColumnSpacing = 12 };
            top.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            top.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            top.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var words = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center, Children = { over, title, artist } };
            Grid.SetColumn(artHost, 0); Grid.SetColumn(words, 1); Grid.SetColumn(playBtn, 2);
            top.Children.Add(artHost); top.Children.Add(words); top.Children.Add(playBtn);
            card.Children.Add(top);
            var verbs = new Grid { ColumnSpacing = 8 };
            verbs.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            verbs.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var addBtn = MpAction("Add to playlist", 0xE710); addBtn.Click += (_, __) => _ = Go("go", "add");
            var stationBtn = MpAction("Start a station", 0xEC05); stationBtn.Click += (_, __) => _ = Go("go", "station");
            Grid.SetColumn(addBtn, 0); Grid.SetColumn(stationBtn, 1); verbs.Children.Add(addBtn); verbs.Children.Add(stationBtn);
            card.Children.Add(verbs);
            Button Link(string label, TextBlock value, string? screen, string tip)
            {
                var g = new Grid { ColumnSpacing = 8 };
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var l = new TextBlock { Text = label, FontSize = 13, Foreground = Tokens.Soft, VerticalAlignment = VerticalAlignment.Center };
                var ch = MpChevron(); ch.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(l, 0); Grid.SetColumn(value, 1); Grid.SetColumn(ch, 2); g.Children.Add(l); g.Children.Add(value); g.Children.Add(ch);
                var b = MpRow(g, 44); b.Margin = new Thickness(-8, 0, -8, 0);
                ToolTipService.SetToolTip(b, tip);
                if (screen is not null) b.Click += (_, __) => _ = Go("go", screen);
                return b;
            }
            card.Children.Add(Link("Up next", upValue, "upnext", "What plays next, the play order and Repeat"));
            var sceneValue = new TextBlock { FontSize = 13, Foreground = Tokens.Ink, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Text = await MusicPanelSceneNameAsync(source) };
            var sceneRow = Link("Scene", sceneValue, "scenes", "The picture drawn from the music"); sceneRow.Margin = new Thickness(-8, -8, -8, 0);
            card.Children.Add(sceneRow);
            // Full Player (2026-11-16, moved here from the panel's foot and named so): the service in the card above, named on the row, opens
            // in its own window. On the card because it acts on the service that is playing, as the rows above it do
            var fullRow = Link("Full Player", fullValue, null, "Opens the service named here in its own window, with all of its own controls. The music keeps playing.");
            fullRow.Margin = new Thickness(-8, -8, -8, 0);
            fullRow.Click += (_, __) =>
            {
                var tile = nowTile ?? source;
                var signedOut = _musicSources.FirstOrDefault(s => s.tile == tile).session == "signed-out";
                Close(); OpenRoute("prism://facet/" + Uri.EscapeDataString(tile) + "/reveal?mode=window" + (signedOut ? "&signin=1" : ""));
            };
            card.Children.Add(fullRow);
            Grid.SetRow(card, 0); page.Children.Add(card);

            // the search field
            var searchBox = new TextBox { PlaceholderText = "Search songs, artists, playlists", FontSize = 14, MinHeight = 44, Padding = new Thickness(12, 11, 12, 11), Margin = new Thickness(16, 12, 16, 4), CornerRadius = new CornerRadius(8) };
            AutomationProperties.SetName(searchBox, "Search songs, artists, albums, playlists");
            MpFocus(searchBox);
            Grid.SetRow(searchBox, 1); page.Children.Add(searchBox);
            _mpBox = searchBox;

            // the lists
            var lists = new StackPanel { Spacing = 0, Padding = new Thickness(8, 0, 8, 8) };
            var scroll = new ScrollViewer { Content = lists, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
            Grid.SetRow(scroll, 2); page.Children.Add(scroll);
            var listGen = 0; string? homeRaw = null;

            async void PlayRow(JsonObject r)
            {
                var tile = r["tile"]?.GetValue<string>() ?? ""; var name = r["name"]?.GetValue<string>() ?? ""; var kind = r["kind"]?.GetValue<string>() ?? "";
                if (r["signedOut"]?.GetValue<bool>() == true) { _ = Go("go", "service", tile); return; }
                // a playlist asks how to play it wherever it is pressed (2026-11-16: a playlist found by the search started in order with
                // no question): its play choices, when the service's library lists it; one it does not list plays as before
                if (kind == "playlist" && r["id"]?.GetValue<string>() is { Length: > 0 } pid)
                {
                    string? known = null;
                    try { known = await ModelCallAsync("musicPanelPlay", tile, pid); } catch { }
                    if (known is { Length: > 4 }) { _ = Go("go", "play", tile + "|" + pid); return; }
                }
                if (r["url"]?.GetValue<string>() is { Length: > 0 } url) { LogLine("music panel recent: " + tile + " -> " + url); _brain.Call(HostCalls.PlayRecent, tile, url); }
                else if (r["id"]?.GetValue<string>() is { Length: > 0 } id) { LogLine("music panel play: " + tile + " " + kind + " " + id); _brain.Call(HostCalls.PlayCollection, tile, kind, id); }
                else return;
                Say("Playing " + name);
            }
            Button ItemRow(JsonObject r)
            {
                var name = r["name"]?.GetValue<string>() ?? ""; var kind = r["kind"]?.GetValue<string>() ?? "";
                var b = MpRow(MpLine(MpArt(name, kind == "station", 40, r["artwork"]?.GetValue<string>()), name, r["meta"]?.GetValue<string>()));
                b.Click += (_, __) => PlayRow(r);
                return b;
            }

            async Task FillAsync()
            {
                var mine = ++listGen;
                var q = searchBox.Text.Trim();
                JsonObject? home = null;
                try { var raw = await ModelCallAsync("musicPanelHome", q.Length > 0 ? q : null); if (q.Length == 0) homeRaw = raw; home = JsonNode.Parse(raw ?? "null") as JsonObject; } catch { }
                if (mine != listGen || my != gen) return;
                lists.Children.Clear();
                if (q.Length > 0)
                {
                    lists.Children.Add(MpLabel("In your library"));
                    var matches = (home?["matches"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
                    foreach (var r in matches) lists.Children.Add(ItemRow(r));
                    if (matches.Count == 0) lists.Children.Add(new TextBlock { Text = "Nothing in your playlists or stations matches.", FontSize = 13, Foreground = Tokens.Soft, Margin = new Thickness(8), TextWrapping = TextWrapping.Wrap });
                    var every = MpRow(MpLine(new FontIcon { Glyph = MpGlyph(0xE721), FontSize = 16, Foreground = Tokens.Ink, Width = 40 }, "Search every service for " + MpQuote(q), null));
                    every.Margin = new Thickness(0, 4, 0, 0);
                    every.Click += (_, __) => _ = SearchAllAsync(q);
                    lists.Children.Add(every);
                    return;
                }
                lists.Children.Add(MpLabel("Jump back in"));
                foreach (var r in (home?["recents"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>()) lists.Children.Add(ItemRow(r));
                var hist = MpRow(MpLine(new Border { Width = 40, Height = 40, CornerRadius = new CornerRadius(6), Background = Tokens.Band, Child = new FontIcon { Glyph = MpGlyph(0xE81C), FontSize = 16, Foreground = Tokens.Ink } }, "Song history", null, null, MpChevron()));
                hist.Click += (_, __) => _ = Go("go", "history");
                lists.Children.Add(hist);
                lists.Children.Add(MpLabel("Your services"));
                foreach (var s in (home?["services"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                {
                    var tile = s["tile"]?.GetValue<string>() ?? ""; var badge = s["badge"]?.GetValue<string>();
                    var end = new StackPanel { Orientation = Orientation.Horizontal };
                    if (badge is { Length: > 0 }) end.Children.Add(MpBadge(badge, badge == "Playing"));
                    var ch = MpChevron(); ch.VerticalAlignment = VerticalAlignment.Center; end.Children.Add(ch);
                    var b = MpRow(MpLine(null, s["name"]?.GetValue<string>() ?? tile, s["status"]?.GetValue<string>(), null, end), 52);
                    b.Click += (_, __) => _ = Go("go", "service", tile);
                    lists.Children.Add(b);
                }
            }

            // "Search every service": the old menu's search (core musicSearch, the services' hidden pages), one row a song; a press plays it
            // on the service playing now when that one has it, else on the first that has it; the row's "more" lists every service that has it
            async Task SearchAllAsync(string q)
            {
                var mine = ++listGen;
                lists.Children.Clear();
                lists.Children.Add(MpLabel("On your services"));
                var status = new TextBlock { Text = "Searching your services" + (char)0x2026, FontSize = 13, Foreground = Tokens.Soft, Margin = new Thickness(8, 2, 8, 6), TextWrapping = TextWrapping.Wrap };
                lists.Children.Add(status);
                var found = new StackPanel(); lists.Children.Add(found);
                LogLine("music panel search: " + q);
                await ModelCallAsync("musicSearch", q, null);
                var shown = new HashSet<string>();
                for (var i = 0; i < 50 && mine == listGen && my == gen && flyout.IsOpen; i++)
                {
                    await Task.Delay(350);
                    JsonObject? st = null;
                    try { st = JsonNode.Parse(await ModelCallAsync("musicSearchState") ?? "null") as JsonObject; } catch { }
                    if (st is null || st["q"]?.GetValue<string>() != q || mine != listGen) continue;
                    var working = st["working"]?.GetValue<bool>() == true;
                    var parts = new List<string>();
                    foreach (var sv in (st["services"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                    {
                        var state = sv["status"]?.GetValue<string>() ?? ""; var n = (sv["candidates"] as JsonArray)?.Count ?? 0;
                        parts.Add(NameOf(sv["tile"]?.GetValue<string>() ?? "") + ": " + (state == "searching" ? "searching" : state == "done" ? n.ToString() : "no answer"));
                    }
                    status.Text = string.Join(Mid, parts);
                    foreach (var item in (st["items"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                    {
                        var t = item["title"]?.GetValue<string>() ?? ""; var a = item["artist"]?.GetValue<string>() ?? "";
                        var ons = (item["on"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
                        var key = (t + "|" + a).ToLowerInvariant();
                        if (ons.Count == 0 || shown.Count >= 30 || !shown.Add(key)) continue;
                        void PlayOn(JsonObject on)
                        {
                            var tile = on["tile"]?.GetValue<string>() ?? "";
                            var cand = new JsonObject { ["id"] = on["id"]?.GetValue<string>() ?? "", ["title"] = t, ["artist"] = a };
                            if (on["url"]?.GetValue<string>() is { Length: > 0 } u) cand["url"] = u;
                            LogLine("music panel search: play " + tile + " " + t);
                            _brain.Call(HostCalls.MusicSearchPlay, tile, cand.ToJsonString());
                            Say(tile.StartsWith("pandora", StringComparison.OrdinalIgnoreCase) ? "Starting a " + NameOf(tile) + " station from " + t : "Playing " + t + " on " + NameOf(tile));
                        }
                        var pref = ons.FirstOrDefault(o => o["tile"]?.GetValue<string>() == nowTile) ?? ons[0];
                        var album = item["album"]?.GetValue<string>();
                        var where = string.Join(", ", ons.Select(o => NameOf(o["tile"]?.GetValue<string>() ?? "")));
                        var main = MpRow(MpLine(MpArt(t, false, 40, item["artwork"]?.GetValue<string>()), t, a + (album is { Length: > 0 } ? Mid + album : "") + Mid + where));
                        main.Click += (_, __) => PlayOn(pref);
                        var box = new StackPanel();
                        if (ons.Count > 1)
                        {
                            var more = MpIconButton(0xE712, "Choose the service for " + t);
                            var acts = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(60, 2, 8, 10), Visibility = Visibility.Collapsed };
                            foreach (var on in ons) { var on2 = on; var pb = MpAction("Play on " + NameOf(on["tile"]?.GetValue<string>() ?? "")); pb.HorizontalAlignment = HorizontalAlignment.Left; pb.Click += (_, __) => PlayOn(on2); acts.Children.Add(pb); }
                            more.Click += (_, __) => acts.Visibility = acts.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible;
                            var line = new Grid();
                            line.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                            line.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                            Grid.SetColumn(main, 0); Grid.SetColumn(more, 1); line.Children.Add(main); line.Children.Add(more);
                            box.Children.Add(line); box.Children.Add(acts);
                        }
                        else box.Children.Add(main);
                        found.Children.Add(box);
                    }
                    if (!working)
                    {
                        if (shown.Count == 0) status.Text = "Nothing found for " + MpQuote(q) + " on your services.";
                        break;
                    }
                }
            }

            var typeTimer = DispatcherQueue.CreateTimer(); typeTimer.Interval = TimeSpan.FromMilliseconds(200); typeTimer.IsRepeating = false;
            typeTimer.Tick += (tm, ev) => { if (my == gen) _ = FillAsync(); };
            searchBox.TextChanged += (_, __) => { typeTimer.Stop(); typeTimer.Start(); };
            searchBox.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) { e.Handled = true; typeTimer.Stop(); var q = searchBox.Text.Trim(); if (q.Length > 0) _ = SearchAllAsync(q); } };
            await FillAsync();
            // core answers from what it holds and starts a read of what it lacks (a service's recents after a start): asked once more, and the
            // lists are drawn again only when the answer changed and nothing is typed
            foreach (var wait in new[] { 900, 2500, 6000, 12000, 20000 }) _ = Task.Delay(wait).ContinueWith(done => RootGrid.DispatcherQueue.TryEnqueue(async () =>
            {
                try
                {
                    if (my != gen || !flyout.IsOpen || searchBox.Text.Trim().Length > 0) return;
                    var again = await ModelCallAsync("musicPanelHome", (string?)null);
                    if (again is not null && again != homeRaw && my == gen && searchBox.Text.Trim().Length == 0) await FillAsync();
                }
                catch { }
            }));

            // the foot
            var foot = new Grid { BorderBrush = Tokens.Rule, BorderThickness = new Thickness(0, 1, 0, 0) };
            foot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Button Foot(string text, string tip)
            {
                var b = MpRow(new TextBlock { Text = text, FontSize = 13, Foreground = Tokens.Ink, HorizontalAlignment = HorizontalAlignment.Center });
                b.CornerRadius = new CornerRadius(0); ToolTipService.SetToolTip(b, tip);
                return b;
            }
            var addSvc = Foot("Add a music service", "Set up another music service");
            addSvc.Click += (_, __) => { Close(); _ = ShowWelcomeAsync(); };
            Grid.SetColumn(addSvc, 0); foot.Children.Add(addSvc);
            Grid.SetRow(foot, 3); page.Children.Add(foot);
            cardTimer.Start();
            return page;
        }

        // ------------------------------------------------------------------ a service's library
        async Task<UIElement> ServiceAsync(int my, string tile)
        {
            JsonObject? lib = null;
            try { lib = JsonNode.Parse(await ModelCallAsync("musicPanelLibrary", tile) ?? "null") as JsonObject; } catch { }
            var name = lib?["name"]?.GetValue<string>() ?? NameOf(tile);
            var signedOut = lib?["signedOut"]?.GetValue<bool>() == true;
            var page = new Grid();
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            Button? globe = null;   // the service's Full Player, by name: a labelled button, not an icon alone
            if (!signedOut)
            {
                globe = MpAction("Full Player", 0xE774); globe.HorizontalAlignment = HorizontalAlignment.Right; globe.VerticalAlignment = VerticalAlignment.Center;
                ToolTipService.SetToolTip(globe, "Opens " + name + " in its own window, with all of its own controls");
                globe.Click += (_, __) => { Close(); OpenRoute("prism://facet/" + Uri.EscapeDataString(tile) + "/reveal?mode=window"); };
            }
            var head = Header(name, globe);
            Grid.SetRow(head, 0); page.Children.Add(head);
            if (signedOut)
            {
                var col = new StackPanel { Spacing = 12, Padding = new Thickness(16, 24, 16, 24) };
                col.Children.Add(new TextBlock { Text = "Sign in to see your " + name + " stations and playlists here.", FontSize = 14, Foreground = Tokens.Ink, TextWrapping = TextWrapping.Wrap });
                var signIn = new Button { Content = new TextBlock { Text = "Sign in to " + name, FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Tokens.AmberInk }, Background = Tokens.Ink, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(8), MinHeight = 44, HorizontalAlignment = HorizontalAlignment.Stretch };
                OwnHover(signIn); MpFocus(signIn);
                signIn.Click += (_, __) => { Close(); OpenRoute("prism://facet/" + Uri.EscapeDataString(tile) + "/reveal?mode=window&signin=1"); };
                col.Children.Add(signIn);
                Grid.SetRow(col, 1); page.Children.Add(col);
                return page;
            }
            var lists = new Dictionary<string, List<JsonObject>>
            {
                ["Playlists"] = (lib?["playlists"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new(),
                ["Stations"] = (lib?["stations"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new(),
            };
            var tab = lists["Playlists"].Count == 0 && lists["Stations"].Count > 0 ? "Stations" : "Playlists";
            var tabs = new Grid { ColumnSpacing = 4, Padding = new Thickness(4), CornerRadius = new CornerRadius(10), Background = Tokens.Band };
            tabs.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            tabs.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var filter = new TextBox { FontSize = 14, MinHeight = 44, Padding = new Thickness(12, 11, 12, 11), CornerRadius = new CornerRadius(8) };
            AutomationProperties.SetName(filter, "Filter this list");
            MpFocus(filter);
            _mpBox = filter;
            var controls = new StackPanel { Spacing = 8, Padding = new Thickness(16, 8, 16, 0), Children = { tabs, filter } };
            Grid.SetRow(controls, 1); page.Children.Add(controls);
            var rowsPanel = new StackPanel { Padding = new Thickness(8) };
            var scroll = new ScrollViewer { Content = rowsPanel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
            Grid.SetRow(scroll, 2); page.Children.Add(scroll);

            void PaintRows()
            {
                rowsPanel.Children.Clear();
                var needle = filter.Text.Trim();
                var shown = lists[tab].Where(r => needle.Length == 0 || (r["name"]?.GetValue<string>() ?? "").Contains(needle, StringComparison.OrdinalIgnoreCase)).ToList();
                StackPanel? open = null;
                foreach (var r in shown)
                {
                    var id = r["id"]?.GetValue<string>() ?? ""; var rname = r["name"]?.GetValue<string>() ?? ""; var kind = r["kind"]?.GetValue<string>() ?? (tab == "Stations" ? "station" : "playlist");
                    var sub = r["sub"]?.GetValue<string>(); var edit = r["edit"]?.GetValue<bool>() != false;
                    var main = MpRow(MpLine(MpArt(rname, kind == "station", 40, r["artwork"]?.GetValue<string>()), rname, sub, Tokens.Amber));
                    ToolTipService.SetToolTip(main, kind == "playlist" ? "Choose how to play " + rname : "Play " + rname);
                    main.Click += (_, __) =>
                    {
                        // a playlist asks how to play it first (2026-11-16): Resume, or Start over in an order
                        if (kind == "playlist") { _ = Go("go", "play", tile + "|" + id); return; }
                        // a saved place is picked up (the old Carry on); with none, the collection plays from its start
                        LogLine("music panel play: " + tile + " " + kind + " " + id + (sub is null ? "" : " (pick up)"));
                        _brain.Call(HostCalls.PlayCollection, tile, kind, id);
                        Say((sub is null ? "Playing " : "Picking up ") + rname);
                    };
                    var more = MpIconButton(0xE712, "More options for " + rname);
                    var acts = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(36, 2, 8, 10), Visibility = Visibility.Collapsed };
                    var next = MpAction("Play next");
                    ToolTipService.SetToolTip(next, rname + " starts when the track playing now ends. With nothing playing, it starts now.");
                    next.Click += async (_, __) =>
                    {
                        acts.Visibility = Visibility.Collapsed;
                        LogLine("music panel play next: " + tile + " " + kind + " " + id);
                        JsonObject? jr = null;
                        try { jr = JsonNode.Parse(await ModelCallAsync("musicPlayNext", tile, kind, id) ?? "null") as JsonObject; } catch { }
                        if (jr?["ok"]?.GetValue<bool>() == true) Say(jr["started"]?.GetValue<bool>() == true ? "Nothing was playing, so " + rname + " starts now" : rname + " will play next");
                        else Say("Could not queue " + rname + (jr?["error"]?.GetValue<string>() is { Length: > 0 } er ? ": " + er : ""));
                    };
                    acts.Children.Add(next);
                    if (sub is not null && kind != "playlist")   // a playlist's Start over is on its play choices
                    {
                        var over = MpAction("Start over");
                        ToolTipService.SetToolTip(over, "From the first track, in the order the service lists it");
                        over.Click += (_, __) => { acts.Visibility = Visibility.Collapsed; LogLine("music panel start over: " + tile + " " + kind + " " + id); _brain.Call(HostCalls.PlayCollection, tile, kind, id, "normal"); Say("Playing " + rname + " from the start"); };
                        acts.Children.Add(over);
                    }
                    if (kind == "playlist" && edit)
                    {
                        var addHere = MpAction("Add current song");
                        addHere.Click += (_, __) => { acts.Visibility = Visibility.Collapsed; _ = AddCurrentAsync(tile, name, id, rname); };
                        acts.Children.Add(addHere);
                    }
                    var line = new Grid();
                    line.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                    line.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                    Grid.SetColumn(main, 0); Grid.SetColumn(more, 1); line.Children.Add(main); line.Children.Add(more);
                    var box = new StackPanel { CornerRadius = new CornerRadius(8), Children = { line, acts } };
                    more.Click += (_, __) =>
                    {
                        var show = acts.Visibility != Visibility.Visible;
                        if (open is not null && !ReferenceEquals(open, acts)) { open.Visibility = Visibility.Collapsed; if (open.Parent is StackPanel ob) ob.Background = null; }
                        acts.Visibility = show ? Visibility.Visible : Visibility.Collapsed; box.Background = show ? Tokens.Band : null; open = show ? acts : null;
                    };
                    rowsPanel.Children.Add(box);
                }
                if (shown.Count == 0)
                    rowsPanel.Children.Add(new TextBlock { Text = needle.Length > 0 ? "Nothing matches that filter." : "No " + name + " " + tab.ToLowerInvariant() + " yet.", FontSize = 13, Foreground = Tokens.Soft, Margin = new Thickness(8, 12, 8, 12), TextWrapping = TextWrapping.Wrap });
            }
            void PaintTabs()
            {
                tabs.Children.Clear();
                var col = 0;
                foreach (var t in new[] { "Playlists", "Stations" })
                {
                    var t2 = t; var n = lists[t].Count;
                    var b = Chip(new TextBlock { Text = t + (n > 0 ? " (" + n + ")" : ""), FontSize = 13, Foreground = Tokens.Ink, HorizontalAlignment = HorizontalAlignment.Center }, t == tab);
                    b.MinHeight = 40; b.HorizontalAlignment = HorizontalAlignment.Stretch; b.CornerRadius = new CornerRadius(7);
                    MpFocus(b);
                    b.Click += (_, __) => { if (tab == t2) return; tab = t2; filter.Text = ""; PaintTabs(); PaintRows(); };
                    Grid.SetColumn(b, col++); tabs.Children.Add(b);
                }
                filter.PlaceholderText = "Filter " + tab.ToLowerInvariant();
            }
            filter.TextChanged += (_, __) => PaintRows();
            PaintTabs(); PaintRows();
            return page;
        }

        // "Add current song" on a playlist's row: the old menu's lookup of the song playing now on this service, then its add. Step 1
        // adds when the service has the song for certain; a choice among near matches is the match step of step 2.
        async Task AddCurrentAsync(string tile, string service, string playlistId, string playlistName)
        {
            Say("Looking for the song on " + service + (char)0x2026);
            try
            {
                await RuntimeEvalAsync("PrismRuntime.musicLookup(" + Q(tile) + ")");
                JsonObject? st = null; var status = "searching";
                var deadline = DateTime.UtcNow.AddSeconds(12);
                while (DateTime.UtcNow < deadline && flyout.IsOpen)
                {
                    await Task.Delay(350);
                    var raw = await RuntimeEvalAsync("PrismRuntime.musicLookupState(" + Q(tile) + ")");
                    st = raw is null ? null : JsonNode.Parse(raw) as JsonObject;
                    status = st?["status"]?.GetValue<string>() ?? "idle";
                    if (status is not ("searching" or "idle")) break;
                }
                var song = (st?["song"] as JsonObject)?["title"]?.GetValue<string>() ?? "the song";
                var match = st?["match"] as JsonObject; var matchId = match?["id"]?.GetValue<string>();
                var cannot = (st?["cannot"] as JsonObject)?["add"]?.GetValue<string>();
                if (cannot is { Length: > 0 }) { Say(Cap(cannot)); return; }
                if (status == "found" && matchId is { Length: > 0 })
                {
                    var mt = match?["title"]?.GetValue<string>() ?? song;
                    LogLine("music panel add: " + tile + " " + matchId + " -> " + playlistId);
                    _ = RuntimeEvalAsync("PrismRuntime.musicAddToPlaylist(" + Q(tile) + ", " + Q(playlistId) + ", " + Q(matchId) + ")");
                    Say("Adding " + mt + " to " + playlistName + (char)0x2026);
                    var end = DateTime.UtcNow.AddSeconds(12);
                    while (DateTime.UtcNow < end)
                    {
                        await Task.Delay(500);
                        var raw = await RuntimeEvalAsync("PrismRuntime.musicLookupState(" + Q(tile) + ")");
                        if (raw is null || JsonNode.Parse(raw) is not JsonObject s2 || s2["action"] is not JsonObject a) continue;
                        var done = a["status"]?.GetValue<string>(); if (done == "pending") continue;
                        Say(done == "ok" ? "Added to " + playlistName : service + " would not add " + mt + " to " + playlistName + (a["error"]?.GetValue<string>() is { Length: > 0 } er ? ": " + er : ""));
                        return;
                    }
                    return;
                }
                var n = (st?["candidates"] as JsonArray)?.Count ?? 0;
                Say(status switch
                {
                    "ambiguous" => service + " has " + n + " songs that look like " + song + ". Choosing the match comes in step 2.",
                    "not-found" => song + " is not on " + service + ".",
                    "unavailable" when st?["why"]?.GetValue<string>() == "no-song" => "Nothing is playing to add.",
                    "unavailable" => Cap(st?["reason"]?.GetValue<string>() ?? service + " cannot be searched from PRISM") + ".",
                    _ => "Could not search " + service + ".",
                });
            }
            catch (Exception ex) { LogLine("music panel add failed: " + ex.Message); Say("Could not add the song."); }
        }

        // ------------------------------------------------------------------ a playlist's play choices (2026-11-16)
        // One of four is picked and Play starts it: Resume (shown where PRISM holds a place, with the place and its order to read), or
        // Start over in an order. Resume is picked at the start where there is one, else In order. The countdown (2026-11-16, asked for):
        // with the box at the foot checked (the setting music.playCountdown, on at first) the picked choice starts after ten seconds, the
        // seconds left on the Play button. A press on a choice changes what will start and the count goes on; clearing the box stops the count; leaving the screen or the panel ends it.
        async Task<UIElement> PlayAsync(int my, string arg)
        {
            var cut = arg.IndexOf('|'); var tile = cut > 0 ? arg.Substring(0, cut) : arg; var id = cut > 0 ? arg.Substring(cut + 1) : "";
            JsonObject? pc = null;
            try { pc = JsonNode.Parse(await ModelCallAsync("musicPanelPlay", tile, id) ?? "null") as JsonObject; } catch { }
            var page = new StackPanel();
            if (pc is null) { page.Children.Add(Header("Play")); page.Children.Add(new TextBlock { Text = "This playlist is not in the service's list now.", FontSize = 14, Foreground = Tokens.Ink, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(16) }); return page; }
            var pname = pc["name"]?.GetValue<string>() ?? "Playlist"; var service = pc["service"]?.GetValue<string>() ?? NameOf(tile); var kind = pc["kind"]?.GetValue<string>() ?? "playlist";
            page.Children.Add(Header("Play"));
            page.Children.Add(new Border { Padding = new Thickness(16, 4, 16, 8), Child = MpLine(MpArt(pname, false, 56, pc["artwork"]?.GetValue<string>()), pname, "Playlist" + Mid + service) });
            var picked = pc["picked"]?.GetValue<string>() ?? "normal";
            var resumeHow = (pc["resume"] as JsonObject)?["how"]?.GetValue<string>() ?? "order";
            var list = new StackPanel { Padding = new Thickness(8, 0, 8, 0) };
            var marks = new List<(string key, FontIcon mark, Button row)>();
            Action? stopCount = null;
            void Paint() { foreach (var (key, mark, row) in marks) { var on = key == picked; mark.Glyph = MpGlyph(on ? 0xECCB : 0xECCA); mark.Foreground = on ? Tokens.Amber : Tokens.Soft; row.Background = on ? Tokens.Band : HubClear; AutomationProperties.SetItemStatus(row, on ? "Selected" : ""); } }
            Button Choice(string key, string label, string? line, bool can, string? why)
            {
                var mark = new FontIcon { FontSize = 18, VerticalAlignment = VerticalAlignment.Center, Width = 40 };
                var row = MpRow(MpLine(mark, label, line, can ? Tokens.Amber : Tokens.Soft));
                if (!can) { row.IsEnabled = false; ToolTipService.SetToolTip(row, why ?? "Not offered for this service"); }
                else row.Click += (_, __) => { picked = key; Paint(); };   // the count goes on: one choice is always picked, so there is always one to start
                marks.Add((key, mark, row));
                return row;
            }
            if (pc["resume"] is JsonObject res)
            {
                list.Children.Add(MpLabel("Resume"));
                list.Children.Add(Choice("resume", "Resume", res["line"]?.GetValue<string>(), true, null));
            }
            list.Children.Add(MpLabel(pc["resume"] is JsonObject ? "Start over" : "Play order"));
            foreach (var o in (pc["orders"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
            {
                var can = o["can"]?.GetValue<bool>() == true; var why = o["why"]?.GetValue<string>();
                list.Children.Add(Choice(o["order"]?.GetValue<string>() ?? "normal", o["label"]?.GetValue<string>() ?? "In order", can ? null : "Not on " + service + " yet", can, why));
            }
            page.Children.Add(list);
            var goText = new TextBlock { Text = "Play", FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Tokens.AmberInk };
            var go = new Button { Content = goText, Background = Tokens.Ink, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(8), MinHeight = 44, HorizontalAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(16, 14, 16, 16) };
            OwnHover(go); MpFocus(go);
            var done = false;
            async Task Start(string how)
            {
                if (done) return;
                done = true; stopCount?.Invoke();
                LogLine("music panel play: " + tile + " " + kind + " " + id + " (" + picked + ", " + how + ")");
                // Resume: PRISM's own place by the collection's plain play; the player's own place (a play in order) by Play on the service
                if (picked == "resume" && resumeHow == "player") _brain.Call(HostCalls.TileCommand, tile, "play");
                else if (picked == "resume") _brain.Call(HostCalls.PlayCollection, tile, kind, id);
                else _brain.Call(HostCalls.PlayCollection, tile, kind, id, picked);
                var said = picked == "resume" ? "Resuming " + pname : "Playing " + pname + ", " + (picked == "reverse" ? "in reverse" : picked == "true-shuffle" ? "true shuffle" : "in order");
                await Go("back"); Say(said);
            }
            go.Click += (_, __) => _ = Start("pressed");
            page.Children.Add(go);
            // the countdown
            var auto = new CheckBox { IsChecked = HostPrefs.GetBool("music.playCountdown", true), Margin = new Thickness(16, 0, 16, 12), MinHeight = 44, Content = new TextBlock { Text = "Start on its own after 10 seconds", FontSize = 13, Foreground = Tokens.Ink, TextWrapping = TextWrapping.Wrap } };
            MpFocus(auto);
            ToolTipService.SetToolTip(auto, "With this checked, the selected choice starts after 10 seconds. Clear it to choose without a count.");
            var left = 10;
            var count = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            stopCount = () => { count.Stop(); goText.Text = "Play"; };
            count.Tick += (_, __) =>
            {
                if (my != gen || closing || done) { count.Stop(); return; }
                left--;
                if (left <= 0) { count.Stop(); _ = Start("countdown"); return; }
                goText.Text = "Play (" + left + ")";
            };
            void Begin() { left = 10; goText.Text = "Play (10)"; count.Start(); }
            auto.Checked += (_, __) => { HostPrefs.Set("music.playCountdown", true); Begin(); };
            auto.Unchecked += (_, __) => { HostPrefs.Set("music.playCountdown", false); stopCount(); };
            page.Children.Add(auto);
            if (auto.IsChecked == true) Begin();
            Paint();
            return page;
        }

        // ------------------------------------------------------------------ Up next (step 2, 2026-11-16)
        // The songs that play next, as the player's own queue has them, with Remove on a track still to play.
        TextBlock Note(string text) => new() { Text = text, FontSize = 13, Foreground = Tokens.Ink, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(16, 6, 16, 6) };
        async Task<JsonObject?> EvalJson(string js) { try { var raw = await RuntimeEvalAsync(js); var jo = raw is null ? null : JsonNode.Parse(raw) as JsonObject; if (s_standIn) StandInMusicWalk(jo); return jo; } catch { return null; } }
        async Task<UIElement> UpNextAsync(int my)
        {
            var tile = nowTile ?? source;
            var info = await EvalJson("PrismRuntime.musicPanelUpNext(" + Q(tile) + ")");
            var service = info?["name"]?.GetValue<string>() ?? NameOf(tile);
            var page = new Grid();
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var head = Header("Up next"); Grid.SetRow(head, 0); page.Children.Add(head);
            var top = new StackPanel { Padding = new Thickness(8, 0, 8, 0) };
            Grid.SetRow(top, 1); page.Children.Add(top);
            var order = info?["order"]?.GetValue<string>() ?? "normal";
            var coll = info?["collection"] as JsonObject;
            // 2026-11-16: this screen is the list of the songs that play next and nothing else; the play order is chosen where a playlist is
            // started (its play choices) and on the music bar. The line above the list names the order when it is PRISM's own.
            if (order != "normal") top.Children.Add(Note((order == "true-shuffle" ? "True shuffle" : "Reverse") + (coll?["name"]?.GetValue<string>() is { Length: > 0 } cn0 ? Mid + cn0 : "")));
            var rows = new StackPanel { Padding = new Thickness(8, 0, 8, 8) };
            var scroll = new ScrollViewer { Content = rows, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
            Grid.SetRow(scroll, 2); page.Children.Add(scroll);
            var canRemove = info?["remove"]?.GetValue<bool>() == true; var canSkip = info?["skip"]?.GetValue<bool>() == true;
            async Task ReadQueue()
            {
                rows.Children.Clear();
                if (info?["view"]?.GetValue<bool>() != true) { rows.Children.Add(Note(service + " does not show its queue to PRISM yet. Its Full Player has it.")); return; }
                rows.Children.Add(Note("Reading what plays next" + (char)0x2026));
                await ModelCallAsync("musicUpNext", tile);
                for (var i = 0; i < 25 && my == gen && flyout.IsOpen; i++)
                {
                    await Task.Delay(400);
                    JsonObject? st = null;
                    try { st = JsonNode.Parse(await ModelCallAsync("musicUpNextState", tile) ?? "null") as JsonObject; } catch { }
                    var status = st?["status"]?.GetValue<string>() ?? "working";
                    if (status == "working") continue;
                    if (my != gen) return;
                    rows.Children.Clear();
                    if (status != "ready") { rows.Children.Add(Note(Cap(st?["reason"]?.GetValue<string>() ?? "The queue could not be read") + ".")); return; }
                    var items = (st?["items"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
                    if (items.Count(x => x["current"]?.GetValue<bool>() != true) == 0) { rows.Children.Add(Note("Nothing plays after this song.")); return; }
                    foreach (var it in items)
                    {
                        var title = it["title"]?.GetValue<string>() ?? ""; var artist = it["artist"]?.GetValue<string>();
                        var cur = it["current"]?.GetValue<bool>() == true;
                        var idx = it["index"]?.GetValue<int>(); var iid = it["id"]?.GetValue<string>();
                        var mark = MpArt(title, false, 40, it["artwork"]?.GetValue<string>());   // the song's own cover
                        Button? x = null;
                        if (!cur && canRemove && idx is int ix && iid is { Length: > 0 })
                        {
                            x = MpIconButton(0xE711, "Remove " + title + " from the queue");
                            x.Click += async (_, __) =>
                            {
                                x!.IsEnabled = false;
                                LogLine("music panel queue remove: " + tile + " " + ix + " " + iid);
                                await RuntimeEvalAsync("PrismRuntime.musicQueueRemove(" + Q(tile) + ", " + ix + ", " + Q(iid) + ")");
                                for (var w = 0; w < 20 && my == gen; w++)
                                {
                                    await Task.Delay(300);
                                    var rs = await EvalJson("PrismRuntime.musicQueueRemoveState(" + Q(tile) + ")");
                                    var s2 = rs?["status"]?.GetValue<string>();
                                    if (s2 == "working") continue;
                                    if (s2 == "ok") { Say("Removed " + title); await ReadQueue(); }
                                    else { Say("Could not remove " + title + (rs?["error"]?.GetValue<string>() is { Length: > 0 } er ? ": " + er : "")); x.IsEnabled = true; }
                                    return;
                                }
                            };
                        }
                        var face = MpLine(mark, title, cur ? "Playing now" + (artist is { Length: > 0 } ? Mid + artist : "") : artist, cur ? Tokens.Amber : null, x);
                        // 2026-11-16, asked for a way to go to a song in the list: a press on a row that is still to play makes the player skip to it
                        if (!cur && canSkip && idx is int sx && iid is { Length: > 0 })
                        {
                            var row = MpRow(face);
                            AutomationProperties.SetName(row, "Skip to " + title); ToolTipService.SetToolTip(row, "Skip to " + title);
                            row.Click += async (_, __) =>
                            {
                                row.IsEnabled = false;
                                Say("Skipping to " + title + (char)0x2026);
                                LogLine("music panel queue skip: " + tile + " " + sx + " " + iid);
                                await RuntimeEvalAsync("PrismRuntime.musicQueueSkip(" + Q(tile) + ", " + sx + ", " + Q(iid) + ")");
                                for (var w = 0; w < 30 && my == gen; w++)
                                {
                                    await Task.Delay(300);
                                    var rs = await EvalJson("PrismRuntime.musicQueueRemoveState(" + Q(tile) + ")");
                                    var s2 = rs?["status"]?.GetValue<string>();
                                    if (s2 == "working") continue;
                                    if (s2 == "ok") { Say("Playing " + title); await ReadQueue(); }
                                    else { Say("Could not skip to " + title + (rs?["error"]?.GetValue<string>() is { Length: > 0 } er ? ": " + er : "")); row.IsEnabled = true; }
                                    return;
                                }
                            };
                            rows.Children.Add(row);
                        }
                        else rows.Children.Add(new Border { Padding = new Thickness(8, 4, 0, 4), MinHeight = 48, Child = face });
                    }
                    // the list has a limit: say it when more songs are still to play than it shows
                    var shown = items.Count(x => x["current"]?.GetValue<bool>() != true);
                    if (st?["left"]?.GetValue<int>() is int left && left > shown)
                        rows.Children.Add(Note("Limit " + shown + Mid + left.ToString("N0") + " songs still to play"));
                    return;
                }
            }
            _ = ReadQueue();
            return page;
        }

        // ------------------------------------------------------------------ Add to playlist / Start a station (step 2, 2026-11-16)
        // "On which service?" as a switch of the signed-in services; the song playing now is looked up on the one picked (the old menu's
        // lookup). Found: its playlists to add to, or the station starts at once. Near matches: the candidates to pick from, and None of
        // these. Not there: one sentence.
        async Task<UIElement> AddAsync(int my, bool station)
        {
            var page = new Grid();
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var head = Header(station ? "Start a station" : "Add to playlist"); Grid.SetRow(head, 0); page.Children.Add(head);
            await RefreshMusicSourcesAsync();
            var services = _musicSources.Where(x => x.session != "signed-out").ToList();
            var top = new StackPanel { Padding = new Thickness(8, 0, 8, 0) };
            Grid.SetRow(top, 1); page.Children.Add(top);
            var rows = new StackPanel { Padding = new Thickness(8, 0, 8, 8) };
            var scroll = new ScrollViewer { Content = rows, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
            Grid.SetRow(scroll, 2); page.Children.Add(scroll);
            if (services.Count == 0) { rows.Children.Add(Note("No music service is signed in.")); return page; }
            var tile = services.Any(x => x.tile == (nowTile ?? source)) ? (nowTile ?? source) : services[0].tile;
            top.Children.Add(MpLabel("On which service?"));
            var switchGrid = new Grid { ColumnSpacing = 4, RowSpacing = 4, Padding = new Thickness(4), Margin = new Thickness(8, 0, 8, 4), CornerRadius = new CornerRadius(10), Background = Tokens.Band };
            switchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            switchGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            for (var i = 0; i < (services.Count + 1) / 2; i++) switchGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            top.Children.Add(switchGrid);
            var look = 0;
            var added = new HashSet<string>();
            var stationStarted = new HashSet<string>();
            async Task Look(bool ask)
            {
                var mine = ++look;
                var service = NameOf(tile);
                rows.Children.Clear();
                rows.Children.Add(Note("Looking for the song on " + service + (char)0x2026));
                if (ask) await RuntimeEvalAsync("PrismRuntime.musicLookup(" + Q(tile) + ")");
                JsonObject? st = null; var status = "searching";
                for (var i = 0; i < 40 && mine == look && my == gen && flyout.IsOpen; i++)
                {
                    await Task.Delay(350);
                    st = await EvalJson("PrismRuntime.musicLookupState(" + Q(tile) + ")");
                    status = st?["status"]?.GetValue<string>() ?? "idle";
                    if (status is not ("searching" or "idle")) break;
                }
                if (mine != look || my != gen) return;
                rows.Children.Clear();
                var song = st?["song"] as JsonObject;
                var title = song?["title"]?.GetValue<string>() is { Length: > 0 } t0 ? t0 : "the song playing now";
                var match = st?["match"] as JsonObject; var matchId = match?["id"]?.GetValue<string>();
                var matchTitle = match?["title"]?.GetValue<string>() ?? title; var matchArtist = match?["artist"]?.GetValue<string>() ?? song?["artist"]?.GetValue<string>();
                var cands = (st?["candidates"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
                var cannot = (st?["cannot"] as JsonObject)?[station ? "station" : "add"]?.GetValue<string>();
                if (status == "ambiguous" && cands.Count > 0)
                {
                    rows.Children.Add(Note(service + " has " + cands.Count + " songs that look like " + title + "."));
                    foreach (var c in cands)
                    {
                        var cid = c["id"]?.GetValue<string>(); if (cid is null) continue;
                        var ct = c["title"]?.GetValue<string>() ?? cid; var ca = c["artist"]?.GetValue<string>(); var cal = c["album"]?.GetValue<string>();
                        var pct = (c["confidence"] as JsonObject)?["percent"]?.GetValue<int>();
                        var meta = string.Join(Mid, new[] { ca, cal }.Where(x => x is { Length: > 0 }));
                        var end = pct is int p0 ? new TextBlock { Text = p0 + "% alike", FontSize = 12, Foreground = Tokens.Soft, VerticalAlignment = VerticalAlignment.Center } : null;
                        var row = MpRow(MpLine(MpArt(ct, false, 40, c["artwork"]?.GetValue<string>()), ct, meta.Length > 0 ? meta : null, null, end));
                        row.Click += async (_, __) =>
                        {
                            LogLine("music panel match: " + tile + " " + cid);
                            await RuntimeEvalAsync("PrismRuntime.musicLookupPick(" + Q(tile) + ", " + Q(cid) + ")");
                            await Look(false);
                        };
                        rows.Children.Add(row);
                    }
                    var none = MpAction("None of these"); none.Margin = new Thickness(8, 8, 8, 0); none.HorizontalAlignment = HorizontalAlignment.Stretch;
                    none.Click += (_, __) => { rows.Children.Clear(); rows.Children.Add(Note(title + " is not on " + service + ".")); };
                    rows.Children.Add(none);
                    return;
                }
                if (status != "found" || matchId is not { Length: > 0 })
                {
                    rows.Children.Add(Note(status switch
                    {
                        "not-found" => title + " is not on " + service + ".",
                        "unavailable" when st?["why"]?.GetValue<string>() == "no-song" => "Nothing is playing on PRISM. Play a song first.",
                        "unavailable" => Cap(st?["reason"]?.GetValue<string>() ?? service + " cannot be searched from PRISM") + ".",
                        "searching" or "idle" => service + " did not answer. Try again.",
                        _ => "Could not search " + service + ".",
                    }));
                    return;
                }
                rows.Children.Add(new Border { Padding = new Thickness(8, 4, 8, 8), Child = MpLine(MpArt(matchTitle, false, 48, match?["artwork"]?.GetValue<string>() ?? song?["artwork"]?.GetValue<string>()), matchTitle, (matchArtist is { Length: > 0 } ? matchArtist + Mid : "") + "on " + service) });
                if (cannot is { Length: > 0 }) { rows.Children.Add(Note(Cap(cannot) + ".")); return; }
                if (station)
                {
                    // no match step was needed: the station starts at once (once a screen for a service)
                    if (stationStarted.Add(tile))
                    {
                        LogLine("music panel station: " + tile + " " + matchId);
                        _ = RuntimeEvalAsync("PrismRuntime.musicStationFromSong(" + Q(tile) + ", " + Q(matchId) + ")");
                    }
                    rows.Children.Add(Note("Starting a station from " + matchTitle + " on " + service + "."));
                    _ = Report(tile, service, "The station is playing on " + service, service + " would not start the station");
                    return;
                }
                rows.Children.Add(MpLabel("Your playlists"));
                // the lookup lists the playlists without their pictures: the service's library, already read, has them (2026-11-16: the rows drew placeholders)
                var pics = new Dictionary<string, string>();
                try { if (JsonNode.Parse(await ModelCallAsync("musicPanelLibrary", tile) ?? "null") is JsonObject lib0) foreach (var lp in (lib0["playlists"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>()) if (lp["id"]?.GetValue<string>() is { } li && lp["artwork"]?.GetValue<string>() is { Length: > 0 } la) pics[li] = la; } catch { }
                if (mine != look || my != gen) return;
                var n = 0;
                foreach (var pl in (st?["playlists"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                {
                    var pid = pl["id"]?.GetValue<string>(); var pname = pl["name"]?.GetValue<string>(); if (pid is null || pname is null) continue;
                    if (pl["edit"]?.GetValue<bool>() == false) continue;   // the service's own playlist cannot be added to
                    n++;
                    var state = new TextBlock { FontSize = 12, Foreground = Tokens.Amber, VerticalAlignment = VerticalAlignment.Center };
                    var key = tile + "|" + pid;
                    void PaintState() { state.Text = added.Contains(key) ? "Added" : ""; }
                    PaintState();
                    var row = MpRow(MpLine(MpArt(pname, false, 40, pl["artwork"]?.GetValue<string>() ?? (pics.TryGetValue(pid, out var pic) ? pic : null)), pname, null, null, state));
                    ToolTipService.SetToolTip(row, "Add " + matchTitle + " to " + pname + ". A second press takes it out again.");
                    row.Click += async (_, __) =>
                    {
                        if (added.Contains(key))
                        {
                            // a second press takes it out again: the old menu's remove of the playing song, on the service that is playing it
                            if (tile != nowTile) { Say("To take it out again, use " + service + "'s Full Player"); return; }
                            LogLine("music panel unadd: " + tile + " " + pid);
                            await RuntimeEvalAsync("PrismRuntime.musicRemovePlaying(" + Q(tile) + ", " + Q(pid) + ", false)");
                            Say("Taking " + matchTitle + " out of " + pname + (char)0x2026);
                            for (var w = 0; w < 30 && my == gen; w++)
                            {
                                await Task.Delay(400);
                                var rs = await EvalJson("PrismRuntime.musicRemoveState(" + Q(tile) + ")");
                                var s3 = rs?["status"]?.GetValue<string>();
                                if (s3 is null or "working" or "pending" or "idle") continue;
                                if (s3 is "ok" or "removed" or "done") { added.Remove(key); PaintState(); Say("Taken out of " + pname); }
                                else Say(service + " would not take it out" + (rs?["error"]?.GetValue<string>() is { Length: > 0 } er ? ": " + er : ""));
                                return;
                            }
                            return;
                        }
                        LogLine("music panel add: " + tile + " " + matchId + " -> " + pid);
                        _ = RuntimeEvalAsync("PrismRuntime.musicAddToPlaylist(" + Q(tile) + ", " + Q(pid) + ", " + Q(matchId) + ")");
                        Say("Adding " + matchTitle + " to " + pname + (char)0x2026);
                        if (await Report(tile, service, "Added to " + pname, service + " would not add " + matchTitle + " to " + pname)) { added.Add(key); PaintState(); }
                    };
                    rows.Children.Add(row);
                }
                if (n == 0) rows.Children.Add(Note(service + " lists no playlist you can add to."));
            }
            // the add's or the station's outcome, from the lookup state's action
            async Task<bool> Report(string t, string service, string ok, string failed)
            {
                var end = DateTime.UtcNow.AddSeconds(14);
                while (DateTime.UtcNow < end && my == gen)
                {
                    await Task.Delay(500);
                    var s2 = await EvalJson("PrismRuntime.musicLookupState(" + Q(t) + ")");
                    if (s2?["action"] is not JsonObject a) continue;
                    var done = a["status"]?.GetValue<string>(); if (done == "pending") continue;
                    Say(done == "ok" ? ok : failed + (a["error"]?.GetValue<string>() is { Length: > 0 } er ? ": " + er : ""));
                    return done == "ok";
                }
                return false;
            }
            void PaintSwitch()
            {
                switchGrid.Children.Clear();
                var i = 0;
                foreach (var sv in services)
                {
                    var svTile = sv.tile;
                    var b = Chip(new TextBlock { Text = sv.name, FontSize = 13, Foreground = Tokens.Ink, HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis }, sv.tile == tile);
                    b.MinHeight = 44; b.HorizontalAlignment = HorizontalAlignment.Stretch; b.CornerRadius = new CornerRadius(7);
                    MpFocus(b);
                    b.Click += (_, __) => { if (svTile == tile) return; tile = svTile; PaintSwitch(); _ = Look(true); };
                    Grid.SetColumn(b, i % 2); Grid.SetRow(b, i / 2); switchGrid.Children.Add(b); i++;
                }
            }
            PaintSwitch();
            _ = Look(true);
            return page;
        }

        // The Scenes screen's size for this window (2026-11-16, asked for no scroll unless the window is too small): four columns where
        // the window has the width, else three, else two; the height the rows need, up to the window's.
        (double width, double height, int cols) ScenesFit()
        {
            var roomW = RootGrid.ActualWidth - 80; var roomH = Math.Max(420, RootGrid.ActualHeight - 140);
            var cols = roomW >= 820 ? 4 : roomW >= 620 ? 3 : 2;
            return (cols == 4 ? 820 : cols == 3 ? 620 : 400, Math.Min(900, roomH), cols);
        }

        // ------------------------------------------------------------------ Scenes (step 3, 2026-11-16)
        // Every scene the music can draw, two to a row: its picture and its name. The one on the screen is
        // outlined and says so. A press puts it on the screen; the music keeps playing.
        async Task<UIElement> ScenesAsync(int my)
        {
            var page = new Grid();
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var head = Header("Scenes"); Grid.SetRow(head, 0); page.Children.Add(head);
            var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8, Padding = new Thickness(16, 8, 16, 16) };
            var (_, panelH, cols) = ScenesFit();
            for (var c0 = 0; c0 < cols; c0++) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var scroll = new ScrollViewer { Content = grid, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
            Grid.SetRow(scroll, 1); page.Children.Add(scroll);
            await ReadModelAsync();
            string? sid = _model.ActiveScene; var scene = sid is null ? null : _model.Scene(sid);
            var viz = scene?.Visualizations.FirstOrDefault(v => v["source"]?.GetValue<string>() == (nowTile ?? source)) ?? scene?.Visualizations.FirstOrDefault();
            if (sid is null || viz is null) { grid.Children.Add(Note("Nothing is drawn from the music on this screen.")); return page; }
            var vizId = viz["id"]?.GetValue<string>() ?? "";
            var current = viz["style"]?.GetValue<string>() ?? "prism-beams"; var artwork = viz["artwork"]?.GetValue<string>() ?? "off";
            var packs = StylePacks.All().OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase).ToList();   // by name, A to Z (2026-11-16)
            // the picture's height is what lets every row show: the room under the header shared by the rows, less a tile's own name and
            // padding; never under 44 (then the list scrolls) and never over 96
            var rowCount = Math.Max(1, (int)Math.Ceiling(packs.Count / (double)cols));
            var pictureH = Math.Max(44, Math.Min(96, Math.Floor((panelH - 56 - 24 - (rowCount - 1) * 8) / rowCount) - 38));
            var tiles = new List<(string id, Button b, Border on)>();
            void Paint()
            {
                foreach (var (id, b, on) in tiles)
                {
                    var active = id == current;
                    b.BorderBrush = active ? Tokens.Amber : Tokens.Rule; b.BorderThickness = new Thickness(active ? 2 : 1);
                    on.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
                    AutomationProperties.SetItemStatus(b, active ? "On screen now" : "");
                }
            }
            for (var i = 0; i < packs.Count; i++)
            {
                var pack = packs[i]; var pid = pack.Id;
                // the preview: the scene's own colours (no pictures of the scenes are shipped)
                var brush = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(1, 1) };
                var pal = pack.Palette.Length > 0 ? pack.Palette : StylePacks.PrismBands;
                for (var c = 0; c < pal.Length; c++) brush.GradientStops.Add(new GradientStop { Color = pal[c], Offset = pal.Length == 1 ? 0 : (double)c / (pal.Length - 1) });
                var preview = new Border { Height = pictureH, CornerRadius = new CornerRadius(6), Background = brush, Opacity = 0.9 };
                // the scene's own picture where one ships (Assets/scene-previews/<id>.jpg); its colours stand in where none does
                try
                {
                    var shot = Path.Combine(AppContext.BaseDirectory, "Assets", "scene-previews", pack.Id + ".jpg");
                    if (File.Exists(shot)) { preview.Opacity = 1; preview.Background = new ImageBrush { ImageSource = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(shot)) { DecodePixelWidth = 360 }, Stretch = Stretch.UniformToFill }; }
                }
                catch { }
                var name = new TextBlock { Text = pack.Name, FontSize = 13, Foreground = Tokens.Ink, TextTrimming = TextTrimming.CharacterEllipsis };
                // "On screen now" sits on the picture, so six rows fit the panel's height
                var on = new TextBlock { Text = "On screen now", FontSize = 11, Foreground = Tokens.Amber };
                var onBadge = new Border { Background = Tokens.Panel, CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 2, 6, 2), Margin = new Thickness(4), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Bottom, Child = on };
                var pictureHost = new Grid { Children = { preview, onBadge } };
                var b = new Button { Content = new StackPanel { Spacing = 4, Children = { pictureHost, name } }, Background = HubClear, CornerRadius = new CornerRadius(8), Padding = new Thickness(6), MinHeight = 44, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Top };
                OwnHover(b); MpFocus(b);
                AutomationProperties.SetName(b, pack.Name);
                ToolTipService.SetToolTip(b, pack.Blurb);
                b.Click += async (_, __) =>
                {
                    if (pid == current) return;
                    current = pid; Paint();
                    try
                    {
                        await ReadModelAsync();
                        if (_model.Scene(sid) is not { } sc) return;
                        var copy = sc.Clone();
                        var v = copy.Visualizations.FirstOrDefault(x => x["id"]?.GetValue<string>() == vizId);
                        if (v is null) return;
                        v["style"] = pid;
                        await ModelCallAsync("modelSaveScene", copy.ToJson());
                        LogLine("music panel scene: " + vizId + " style=" + pid);
                        // core restyles by the slot the visual sits in, not by the visual's own id
                        var slot = sc.Assign.Where(kv => kv.Value == vizId).Select(kv => kv.Key).FirstOrDefault() ?? vizId;
                        _brain.Call(HostCalls.RestyleVisualization, slot, pid, artwork);
                        Say(pack.Name + " is on the screen");
                    }
                    catch (Exception ex) { LogLine("music panel scene failed: " + ex.Message); Say("Could not change the scene."); }
                };
                if (i / cols >= grid.RowDefinitions.Count) grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                Grid.SetColumn(b, i % cols); Grid.SetRow(b, i / cols); grid.Children.Add(b);
                tiles.Add((pid, b, onBadge));
            }
            Paint();
            return page;
        }

        // ------------------------------------------------------------------ Song history (step 4, 2026-11-16)
        // The songs PRISM played, newest first, kept on this PC by core (song-history.ts). A press plays the song again on the service
        // it played on; a service that is signed out shows its sign-in screen. Clear history empties the list.
        async Task<UIElement> HistoryAsync(int my)
        {
            var page = new Grid();
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            page.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var clear = MpAction("Clear history"); clear.HorizontalAlignment = HorizontalAlignment.Right; clear.VerticalAlignment = VerticalAlignment.Center;
            var head = Header("Song history", clear); Grid.SetRow(head, 0); page.Children.Add(head);
            var line = Note("Songs played through PRISM. Kept on this device and never sent anywhere."); Grid.SetRow(line, 1); page.Children.Add(line);
            var rows = new StackPanel { Padding = new Thickness(8, 0, 8, 8) };
            var scroll = new ScrollViewer { Content = rows, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled };
            Grid.SetRow(scroll, 2); page.Children.Add(scroll);
            async Task<List<JsonObject>> Read()
            {
                JsonArray? list = null;
                for (var i = 0; i < 2; i++)   // the first ask reads the store
                {
                    try { var raw = await RuntimeEvalAsync("PrismRuntime.musicHistory()"); list = raw is null ? null : JsonNode.Parse(raw) as JsonArray; if (s_standIn) StandInMusicWalk(list); } catch { }
                    if (list is { Count: > 0 }) break;
                    await Task.Delay(300);
                }
                return list?.OfType<JsonObject>().ToList() ?? new();
            }
            string When(long at)
            {
                var t = DateTimeOffset.FromUnixTimeMilliseconds(at).LocalDateTime; var today = DateTime.Now.Date;
                return t.Date == today ? t.ToString("h:mm tt") : t.Date == today.AddDays(-1) ? "Yesterday" : t.ToString("MMM d");
            }
            void Paint(List<JsonObject> songs)
            {
                rows.Children.Clear();
                clear.Visibility = songs.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
                if (songs.Count == 0) { rows.Children.Add(Note("No songs yet. A song is added after it has played for 30 seconds.")); return; }
                foreach (var e in songs)
                {
                    var title = e["title"]?.GetValue<string>() ?? ""; var artist = e["artist"]?.GetValue<string>(); var service = e["service"]?.GetValue<string>() ?? "";
                    var at = e["at"]?.GetValue<long>() ?? 0; var tile = e["tile"]?.GetValue<string>() ?? "";
                    var signedOut = e["signedOut"]?.GetValue<bool>() == true; var gone = e["gone"]?.GetValue<bool>() == true;
                    var meta = string.Join(Mid, new[] { artist, service + (signedOut ? ", sign in first" : gone ? ", not on this screen" : "") }.Where(x => x is { Length: > 0 }));
                    var end = new TextBlock { Text = When(at), FontSize = 12, Foreground = Tokens.Soft, VerticalAlignment = VerticalAlignment.Center };
                    var row = MpRow(MpLine(MpArt(title, false, 40, e["artwork"]?.GetValue<string>()), title, meta, null, end));
                    ToolTipService.SetToolTip(row, gone ? service + " is not on this screen" : "Play " + title + " again on " + service);
                    row.Click += async (_, __) =>
                    {
                        if (gone) { Say(service + " is not on this screen"); return; }
                        var r = await RuntimeEvalAsync("PrismRuntime.musicHistoryPlay(" + at + ")") ?? "";
                        LogLine("music panel history play: " + tile + " " + at + " -> " + r);
                        if (r.Contains("signed-out")) { await Go("go", "service", tile); return; }
                        Say(r.Contains("ok") ? "Playing " + title + " on " + service : "Could not play " + title);
                    };
                    rows.Children.Add(row);
                }
            }
            clear.Click += async (_, __) =>
            {
                LogLine("music panel history: cleared");
                await RuntimeEvalAsync("PrismRuntime.musicHistoryClear()");
                await Task.Delay(200);
                Paint(new()); Say("History cleared");
            };
            Paint(await Read());
            return page;
        }

        // ------------------------------------------------------------------ a screen that could not be drawn
        UIElement Later(string title, string step, string body)
        {
            var page = new StackPanel();
            page.Children.Add(Header(title));
            page.Children.Add(new TextBlock { Text = body, FontSize = 14, Foreground = Tokens.Ink, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(16, 16, 16, 6) });
            page.Children.Add(new TextBlock { Text = "This screen is built in step " + step + " of four. The old menu has it until then.", FontSize = 13, Foreground = Tokens.Soft, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(16, 0, 16, 16) });
            return page;
        }

        async Task Render(JsonObject st)
        {
            var my = ++gen;
            cardTimer.Stop(); cardTick = null; _mpBox = null;
            var screen = st["screen"]?.GetValue<string>() ?? "home"; var arg = st["arg"]?.GetValue<string>();
            canBack = st["canBack"]?.GetValue<bool>() == true;
            Say("");
            UIElement page;
            try
            {
                page = screen switch
                {
                    "service" when arg is { Length: > 0 } => await ServiceAsync(my, arg),
                    "play" when arg is { Length: > 0 } => await PlayAsync(my, arg),
                    "upnext" => await UpNextAsync(my),
                    "add" => await AddAsync(my, false),
                    "station" => await AddAsync(my, true),
                    "scenes" => await ScenesAsync(my),
                    "history" => await HistoryAsync(my),
                    _ => await HomeAsync(my),
                };
            }
            catch (Exception ex) { LogLine("music panel: " + screen + " failed: " + ex.Message); page = Later("Music", "1", "This screen could not be drawn."); }
            if (my != gen) return;
            // Scenes is wide (2026-11-16, asked for four columns, six rows in view); every other screen is 400
            // and takes the height it needs up to the window's, so its rows show without a scroll
            var (sw, sh, _) = ScenesFit();
            root.Width = screen == "scenes" ? sw : 400;
            root.Height = screen == "scenes" ? sh : height;
            body.Children.Clear(); body.Children.Add(page);
            LogLine("music panel: " + screen + (arg is null ? "" : " " + arg));
            // the keyboard starts in the panel: Back on a screen, the play button at Home
            try { if (FocusManager.FindFirstFocusableElement(page) is Control first) first.Focus(FocusState.Programmatic); } catch { }
        }

        // Escape returns one level; at Home it closes the panel, as a press outside does at any level
        root.PreviewKeyDown += (_, e) =>
        {
            if (e.Key != Windows.System.VirtualKey.Escape) return;
            escapeAt = Environment.TickCount64;
            if (canBack) { e.Handled = true; _ = Go("back"); }
        };
        flyout.Closing += (_, e) =>
        {
            if (closing || !canBack || Environment.TickCount64 - escapeAt > 400) return;
            e.Cancel = true;   // Escape reached the flyout itself: one level back, the panel stays
        };
        flyout.Opened += (_, __) => { if (!RootGrid.Children.Contains(shield)) RootGrid.Children.Add(shield); };
        flyout.Closed += (_, __) =>
        {
            RootGrid.Children.Remove(shield); cardTimer.Stop(); gen++; _mpGo = null; _mpBox = null;
            if (!closing) LogLine("music panel: closed from outside the panel (a press off it, Escape at Home, or its anchor gone)");
            _ = ModelCallAsync("musicPanelNav", "close", null, null);
            LogLine("music panel: closed");
        };
        _mpGo = (op, screen, arg) => Go(op, screen, arg);

        JsonObject? first = null;
        try { first = JsonNode.Parse(await ModelCallAsync("musicPanelNav", "open", null, null) ?? "null") as JsonObject; } catch { }
        if (first is null) { LogLine("music panel: core gave no state, nothing opens"); _mpGo = null; return false; }
        await Render(first);
        _vizFlyout = flyout;
        // shown on the window at the button's place, not on the button: a play on another service draws the stage and its buttons again, and a
        // flyout whose anchor has left the tree closes (seen 2026-11-16: the panel closed a second after a play on another service)
        Windows.Foundation.Point where;
        var showOn = host ?? RootGrid;
        try { where = anchor.TransformToVisual(showOn).TransformPoint(at ?? new Windows.Foundation.Point(0, anchor.ActualHeight + 6)); }
        catch { where = new Windows.Foundation.Point(8, host is null ? 140 : 8); }
        if (host is not null) flyout.ShouldConstrainToRootBounds = false;   // the mini player is smaller than the panel
        flyout.ShowAt(showOn, new FlyoutShowOptions { Position = where, Placement = FlyoutPlacementMode.BottomEdgeAlignedLeft });
        return true;
    }

    /// <summary>The name of the scene the music draws now (the visual's style pack), for Home's Scene row.</summary>
    private async Task<string> MusicPanelSceneNameAsync(string source)
    {
        try
        {
            await ReadModelAsync();
            if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } scene) return "";
            var viz = scene.Visualizations.FirstOrDefault(v => v["source"]?.GetValue<string>() == source) ?? scene.Visualizations.FirstOrDefault();
            var style = viz?["style"]?.GetValue<string>() ?? "prism-beams";
            return StylePacks.All().FirstOrDefault(p => p.Id == style)?.Name ?? style;
        }
        catch { return ""; }
    }
}
