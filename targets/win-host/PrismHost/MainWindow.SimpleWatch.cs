using System.Runtime.CompilerServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using System.Text.Json.Nodes;

namespace PrismHost;

/// <summary>
/// Simple Watch (2026-10-16, "I've had some comments that this interface is overwhelming for someone with ADHD ... implement this behind a simple
/// watch toggle in the watch settings"): a quieter Watch tab, off by default, kept on this PC (host-prefs video.simpleWatch).
/// - Continue watching leads, then My list, then The Binge as the one pick; every other row waits behind More to watch, in its usual order.
/// - A card shows its picture, its name, its service's mark and how far in it is; its rating, ribbons and lines show while it is pointed at or focused.
/// - A row's pencil, (i) and order chips show while its name is pointed at or focused.
/// - The corner's screens dim while the person browses Watch's pages, and come back when the pointer goes to them, a card is pressed, or nothing
///   has moved for a while. The dim is a layer over the window (SurfaceManager.SetDim), never the page; the sound plays on.
/// </summary>
public sealed partial class MainWindow
{
    private static bool SimpleWatch => HostPrefs.GetBool("video.simpleWatch", false);
    /// <summary>Watch is being drawn the quiet way: set at the start of each Watch draw, read by the card and head builders.</summary>
    private static bool s_quiet;
    /// <summary>Simple Watch on, for every page of Watch (set as each draw begins, 2026-10-16, "Is there anything we left out that would be a good
    /// idea for the simple watch view?"): nothing on the page moves by itself - a long title is cut at two lines, never scrolled, and the cards do
    /// not slide - Browse and Playlists wait under More beside the tabs, the playlist panel shows only while a playlist is chosen or running, and
    /// the corner's control strip rests faint until it is pointed at.</summary>
    private static bool s_calm;
    /// <summary>The card Watch focused itself when it opened (for the remote's highlight): its details stay quiet for that focus.</summary>
    private static object? s_autoFocused;
    /// <summary>More to watch opened: kept across the page's redraws.</summary>
    private bool _simpleMoreOpen;
    /// <summary>Each quiet part with its rest opacity: 0 for a card's parts, 0.35 for a row head's controls (2026-10-17, the designer's pass, finding 6:
    /// hidden entirely, nothing said the order chips existed).</summary>
    private static readonly ConditionalWeakTable<UIElement, object> QuietParts = new();

    /// <summary>A part that waits for the pointer: drawn at its rest opacity (its place kept, so nothing moves when it shows) while Watch is quiet.</summary>
    private static T QuietPart<T>(T e, double rest = 0)
    {
        if (s_quiet && e is UIElement u) { QuietParts.AddOrUpdate(u, rest); u.Opacity = rest; }
        return e;
    }

    private static void CollectQuiet(DependencyObject d, List<(UIElement part, double rest)> into)
    {
        if (d is UIElement u && QuietParts.TryGetValue(u, out var r)) into.Add((u, r is double rd ? rd : 0));
        switch (d)
        {
            case Panel p: foreach (var c in p.Children) CollectQuiet(c, into); break;
            case Border b when b.Child is not null: CollectQuiet(b.Child, into); break;
            case ContentControl cc when cc.Content is DependencyObject co: CollectQuiet(co, into); break;
        }
    }

    /// <summary>The quiet parts under this element show while the pointer is on it or the focus is in it.</summary>
    private static void RevealOnHover(FrameworkElement owner)
    {
        if (!s_quiet) return;
        var parts = new List<(UIElement part, double rest)>();
        CollectQuiet(owner, parts);
        if (parts.Count == 0) return;
        if (owner is Panel p && p.Background is null) p.Background = HubClear;   // the gaps between its children take the pointer too
        bool over = false, focus = false;
        void Paint() { var on = over || focus; foreach (var (x, rest) in parts) x.Opacity = on ? 1.0 : rest; }
        owner.PointerEntered += (_, __) => { over = true; Paint(); };
        owner.PointerExited += (_, __) => { over = false; Paint(); };
        // a card reached by keys or a remote; the focus Watch puts on its first card when it opens shows nothing
        owner.GotFocus += (_, e) =>
        {
            if (ReferenceEquals(e.OriginalSource, s_autoFocused)) { s_autoFocused = null; return; }
            focus = e.OriginalSource is Control { FocusState: FocusState.Keyboard }; Paint();
        };
        owner.LostFocus += (_, __) => { focus = false; Paint(); };
    }

    /// <summary>A row's head: its name and any line of words stay; its controls (order chips, pencil, (i)) wait for the pointer.</summary>
    private static void QuietHead(Panel head, UIElement name)
    {
        if (!s_quiet) return;
        foreach (var c in head.Children) if (!ReferenceEquals(c, name) && c is not TextBlock) QuietPart(c, 0.35);
        RevealOnHover(head);
    }

    /// <summary>Under Continue watching and My list: the pick's place (The Binge), then More to watch and the panel every other row is drawn into.</summary>
    private (StackPanel pick, StackPanel more, Button toggle) SimpleWatchMore(StackPanel main)
    {
        var pick = new StackPanel { Spacing = 18 };
        var more = new StackPanel { Spacing = 18, Visibility = _simpleMoreOpen ? Visibility.Visible : Visibility.Collapsed };
        // a row head, not a chip (2026-10-17, the designer's pass, finding 3: the one door to six rows was the least visible thing on the page): the
        // rows' own size with a hairline above it and a chevron, the whole width taking the press
        var label = new TextBlock { FontSize = Tokens.TextRow, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk };
        var chevron = new FontIcon { FontSize = 16, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 4, 0, 0) };
        var toggle = new Button
        {
            Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14, Children = { label, chevron } },
            Background = HubClear, BorderBrush = Tokens.Rule, BorderThickness = new Thickness(0, 1, 0, 0), CornerRadius = new CornerRadius(0),
            Padding = new Thickness(0, 18, 0, 6), Margin = new Thickness(0, 10, 0, 0), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left,
        };
        toggle.Resources["ButtonBorderBrushPointerOver"] = Tokens.Rule;
        toggle.Resources["ButtonBorderBrushPressed"] = Tokens.Rule;
        OwnHover(toggle);
        ToolTipService.SetToolTip(toggle, "Every other row: new in your library, channels you follow, your categories, live and your services.");
        void Paint() { label.Text = _simpleMoreOpen ? "Fewer rows" : "More to watch"; chevron.Glyph = ((char)(_simpleMoreOpen ? 0xE70E : 0xE70D)).ToString(); }
        Paint();
        toggle.Click += (_, __) => { _simpleMoreOpen = !_simpleMoreOpen; more.Visibility = _simpleMoreOpen ? Visibility.Visible : Visibility.Collapsed; Paint(); };
        main.Children.Add(pick);
        main.Children.Add(toggle);
        main.Children.Add(more);
        return (pick, more, toggle);
    }

    /// <summary>Browse and Playlists behind one tab (Simple Watch): it names the page while one of them is open.</summary>
    private Button SimpleMoreTab()
    {
        var on = _hubTab is "browse" or "playlists";
        var name = _hubTab == "browse" ? "Browse" : _hubTab == "playlists" ? "Playlists" : "More";
        var tab = new Button
        {
            Content = new TextBlock { Text = name + "  " + (char)0x25BE, FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = on ? HubAmber : HubInk, Opacity = on ? 1 : 0.72 },
            Background = on ? HubCard : HubClear, BorderBrush = on ? HubTabRule : HubClear, BorderThickness = new Thickness(1, 1, 1, 0), CornerRadius = new CornerRadius(10, 10, 0, 0),
            Padding = new Thickness(18, 8, 18, 10), VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, on ? -1 : 0),
        };
        OwnHover(tab);
        Canvas.SetZIndex(tab, on ? 2 : 1);
        tab.Resources["ButtonBorderBrushPointerOver"] = on ? HubTabRule : HubClear;
        tab.Resources["ButtonBorderBrushPressed"] = on ? HubTabRule : HubClear;
        ToolTipService.SetPlacement(tab, Microsoft.UI.Xaml.Controls.Primitives.PlacementMode.Bottom);
        ToolTipService.SetToolTip(tab, "Browse every genre, and your playlists.");
        var fly = new MenuFlyout { Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.BottomEdgeAlignedLeft };
        foreach (var (id, label) in new[] { ("browse", "Browse"), ("playlists", "Playlists") })
        {
            if (id == "playlists" && !_playlistsTab) continue;
            var item = new MenuFlyoutItem { Text = label, FontSize = 18, Foreground = _hubTab == id ? HubAmber : HubInk };
            var id2 = id;
            item.Click += (_, __) => { if (_hubTab != id2 || _bingeOpen) { _hubTab = id2; _browseRow = null; _bingeOpen = false; _ = ShowVideoHubAsync(); } };
            fly.Items.Add(item);
        }
        tab.Click += (_, __) => fly.ShowAt(tab);
        return tab;
    }

    /// <summary>
    /// Resume (2026-10-16, "Yeah build only resume"; 2026-10-17, the designer's pass, finding 1: "the Resume bar repeats the first Continue card"): the title
    /// most recently watched - the first card of Continue watching, in that row's own order - IS the Resume. The row's head holds one wide hero: the card
    /// itself (its menu, its drag, its focus, its removal all as any card's), the words beside it (Resume, the name, the episode and the service, how far
    /// in) and an amber play; the other cards follow at their size. One plain rule, said in its tooltip; no pick, no ranking of anyone's making (the
    /// suggested "Pick for me" was turned down: "this seems like an opaque algorithm"). Drawn inside the row's scaled group, so its sizes are the
    /// row's divided by the scale.
    /// </summary>
    private Grid ResumeRow(List<JsonObject> list, bool badge, double now, ref Button? first)
    {
        var grid = new Grid { ColumnSpacing = 12, Tag = HubRowTag };   // one row for the remote: the hero's buttons, then the cards
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var hero = new Border { CornerRadius = new CornerRadius(Tokens.RadiusPanel / SimpleLeadScale), Background = Tokens.Chip, Padding = new Thickness(6, 6, 12, 6), VerticalAlignment = VerticalAlignment.Top };
        _resumeHero = hero; _resumeKey = null;
        ResumeHeroFill(hero, list[0], badge, now, ref first);
        grid.Children.Add(hero);
        var strip = CardRow(list.Skip(1), badge, now, ref first);
        Grid.SetColumn(strip, 1);
        grid.Children.Add(strip);
        return grid;
    }
    private Border? _resumeHero;
    private string? _resumeKey;

    /// <summary>The hero drawn (again) for this card: the live refill calls it with the row's first card, and only a changed card redraws it.</summary>
    private void ResumeHeroFill(Border hero, JsonObject card, bool badge, double now, ref Button? first)
    {
        var key = LiveKey(card);
        if (_resumeKey == key && hero.Child is not null) return;
        _resumeKey = key;
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        card["__hero"] = true;
        var btn = MenuCardButton(card, badge, now);
        if (btn is null || card["item"] is not JsonObject item) { hero.Child = null; return; }
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(btn, "row:" + key);
        first ??= btn;
        var series = S(item, "series");
        var name = series.Length > 0 ? series : S(item, "title");
        var service = S(card, "service");
        var k = 1 / SimpleLeadScale;   // the row is drawn 1.5 times its size: these come out at 16, 28, 16 and 30
        var words = new StackPanel { Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        words.Children.Add(new TextBlock { Text = "Resume", FontSize = 16 * k, Foreground = HubAmber, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        words.Children.Add(new TextBlock { Text = name, FontSize = 28 * k, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 300 });
        var sub = series.Length > 0 && S(item, "title") is { Length: > 0 } ep && ep != series ? ep + "  " + (char)0x00B7 + "  " + service : service;
        if (sub.Length > 0) words.Children.Add(new TextBlock { Text = sub, FontSize = 16 * k, Foreground = HubInk, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 300 });
        if (item["progress"] is JsonValue pv && pv.TryGetValue<double>(out var pd) && pd > 0 && pd < 1)
        {
            var track = new Grid { Width = 190, Height = 3, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 4, 0, 0), Background = Tokens.TabRule, CornerRadius = new CornerRadius(1.5) };
            track.Children.Add(new Border { Width = 190 * pd, HorizontalAlignment = HorizontalAlignment.Left, Background = HubAmber, CornerRadius = new CornerRadius(1.5) });
            words.Children.Add(track);
        }
        var play = new FontIcon { Glyph = ((char)0xE768).ToString(), FontSize = 30 * k, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(14, 0, 4, 0) };
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
        row.Children.Add(words); row.Children.Add(play);
        var press = new Button { Content = row, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(10, 4, 10, 4), CornerRadius = new CornerRadius(8 * k), VerticalAlignment = VerticalAlignment.Stretch };
        OwnHover(press);
        ToolTipService.SetToolTip(press, "Plays " + name + " where you left off" + (service.Length > 0 ? " on " + service : "") + ". It is the first title in Continue watching.");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(press, "Resume " + name);
        // the card's own press: the same pick, curtain and window as pressing the card itself
        press.Click += (_, __) => { if (Microsoft.UI.Xaml.Automation.Peers.FrameworkElementAutomationPeer.CreatePeerForElement(btn) is Microsoft.UI.Xaml.Automation.Peers.ButtonAutomationPeer peer) peer.Invoke(); };
        var inner = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        inner.Children.Add(btn); inner.Children.Add(press);
        hero.Child = inner;
    }

    // ---- Simple Watch's three rows drawn larger ----

    /// <summary>Continue watching leads, largest (2026-10-16, "With simple mode, should we make those 3 rows posters larger and use more of the
    /// available space?" - decided: the lead row about 1.5 times, My list and The Binge about 1.25): fewer cards in view at once, one clear place to
    /// start, pictures known at a glance from across the room, and the three rows reaching down the page.</summary>
    private const double SimpleLeadScale = 1.5, SimpleRowScale = 1.25;

    /// <summary>A row (its head and its cards) drawn <paramref name="scale"/> times its size, everything in it in proportion: the row is laid out at
    /// its place's width divided by the scale and drawn larger to fill it, so it still scrolls, refills in place and takes the corner's clearance.</summary>
    private FrameworkElement ScaledRow(StackPanel group, double scale)
    {
        group.Width = Math.Max(200, (TileCanvas.ActualWidth - 120) / scale);
        var holder = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
        holder.Children.Add(new Viewbox { Stretch = Stretch.Uniform, StretchDirection = StretchDirection.Both, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Child = group });
        holder.SizeChanged += (_, e) => { var w = e.NewSize.Width / scale; if (w > 50 && Math.Abs(group.Width - w) > 0.5) group.Width = w; };
        return holder;
    }

    // ---- the corner's screens dimmed while the rows are browsed ----

    private readonly HashSet<string> _dimmed = new();
    private long _browseAt, _browseHoldUntil;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _browseTimer;
    /// <summary>Nothing moved over the rows for this long: the person has stopped browsing, the screens come back.</summary>
    private const int BrowseIdleMs = 12_000;
    /// <summary>After a card is pressed the screens stay lit this long, so the title starting there is seen.</summary>
    private const int PressHoldMs = 4_000;

    /// <summary>The dim follows the person through every page of Watch (Live, Library, Browse, The Binge), not the Watch tab's rows alone.</summary>
    private static bool BrowseDimOn => SimpleWatch;

    private void WireBrowseDim(ScrollViewer scroller)
    {
        if (!BrowseDimOn) { UndimScreens(); return; }
        scroller.PointerMoved += (_, __) => Browsing();
        scroller.AddHandler(UIElement.PointerWheelChangedEvent, new PointerEventHandler((_, __) => Browsing()), true);
        // the pointer leaving the rows for the corner's screens brings them back; leaving for the tabs or the page's head goes on browsing (2026-10-16,
        // "it often gets bright instead of staying dimmed while I'm navigating")
        scroller.PointerExited += (_, e) =>
        {
            if (_videoHub is not { } hub) return;
            var at = e.GetCurrentPoint(hub).Position;
            if (StackBounds(hub) is { } corner && at.X >= corner.X - 24 && at.Y <= corner.Bottom + 24) UndimScreens();
        };
        scroller.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, e) =>
        {
            if (!PressOnCard(e.OriginalSource as DependencyObject)) return;
            _browseHoldUntil = Environment.TickCount64 + PressHoldMs;
            UndimScreens();
        }), true);
        // keys or a remote moving through the cards browse too; the focus Watch puts on its first card when it opens does not
        scroller.GotFocus += (_, e) => { if (e.OriginalSource is Control { FocusState: FocusState.Keyboard }) Browsing(); };
    }

    private static bool PressOnCard(DependencyObject? d)
    {
        for (var i = 0; d is not null && i < 30; i++, d = Microsoft.UI.Xaml.Media.VisualTreeHelper.GetParent(d))
            if (d is Button { Tag: CardPick }) return true;
        return false;
    }

    private void Browsing()
    {
        if (!BrowseDimOn || _videoHub is null) return;
        var now = Environment.TickCount64;
        if (now < _browseHoldUntil) return;
        _browseAt = now;
        foreach (var id in _pipSlots) if (_dimmed.Add(id)) _surfaces.SetDim(id, true);
        if (_dimmed.Count == 0) return;
        if (_browseTimer is null)
        {
            _browseTimer = DispatcherQueue.CreateTimer();
            _browseTimer.Interval = TimeSpan.FromMilliseconds(1000);
            _browseTimer.Tick += (_, __) => BrowseTick();
        }
        if (!_browseTimer.IsRunning) _browseTimer.Start();
    }

    private void BrowseTick()
    {
        // a window that left the corner is never left dimmed
        foreach (var id in _dimmed.ToList()) if (!_pipSlots.Contains(id)) { _surfaces.SetDim(id, false); _dimmed.Remove(id); }
        if (_videoHub is null || !BrowseDimOn || Environment.TickCount64 - _browseAt > BrowseIdleMs) UndimScreens();
    }

    private void UndimScreens()
    {
        foreach (var id in _dimmed) _surfaces.SetDim(id, false);
        _dimmed.Clear();
        _browseTimer?.Stop();
    }

    // ---- Watch settings: the Simple Watch section ----

    /// <summary>The section sells the switch before it explains it (2026-10-16, "Can we explain with a little more charisma what simple watch is
    /// for in that menu? The benefit, maybe a graphic"): one line on what it does for the person, a picture of Watch both ways, the switch, and
    /// the particulars behind What changes.</summary>
    private Func<Task<List<string>>> BuildSimpleWatchTab(StackPanel body)
    {
        body.Children.Add(new TextBlock { Text = "Simple Watch", FontSize = 17, Foreground = HubInk });
        body.Children.Add(new TextBlock { Text = "A calmer Watch page that makes choosing easy.", FontSize = 18, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        body.Children.Add(new TextBlock
        {
            Text = "Fewer things compete for your eyes. What you're in the middle of comes first, and the rest waits until you ask for it.",
            FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap,
        });
        body.Children.Add(SimpleWatchPicture());
        var was = SimpleWatch;
        var box = new CheckBox { Content = new TextBlock { Text = "Use Simple Watch", FontSize = 16, Foreground = HubInk }, IsChecked = was, MinWidth = 0 };
        body.Children.Add(box);
        var details = new StackPanel { Spacing = 8, Visibility = Visibility.Collapsed };
        foreach (var line in new[]
        {
            "Continue watching comes first, then My list and The Binge. Every other row waits behind More to watch.",
            "Cards show the picture, the name and the service. Ratings and ribbons appear when you point at a card.",
            "A row's order chips, pencil and (i) appear when you point at its name.",
            "The screens dim while you browse the rows and come back when you stop.",
        })
            details.Children.Add(new TextBlock { Text = line, FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        var moreLabel = new TextBlock { Text = "What changes  " + (char)0x25BE, FontSize = 14, Foreground = HubInk };
        var more = Chip(moreLabel, false);
        more.HorizontalAlignment = HorizontalAlignment.Left;
        more.Click += (_, __) =>
        {
            var open = details.Visibility != Visibility.Visible;
            details.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
            moreLabel.Text = "What changes  " + (char)(open ? 0x25B4 : 0x25BE);
        };
        body.Children.Add(more);
        body.Children.Add(details);
        return () =>
        {
            var said = new List<string>();
            var on = box.IsChecked == true;
            if (on == was) return Task.FromResult(said);
            HostPrefs.Set("video.simpleWatch", on);
            HostPrefs.Set("video.simpleWatchChosen", true);   // the welcome page's busy-or-calm is answered
            LogLine("watch: Simple Watch " + (on ? "on" : "off"));
            said.Add(on ? "Simple Watch on" : "Simple Watch off");
            if (!on) UndimScreens();
            _ = ModelCallAsync("videoSetSimpleWatch", on);   // the phone's Watch follows it
            if (VideoHubOpen) _ = ShowVideoHubAsync();
            return Task.FromResult(said);
        };
    }

    /// <summary>
    /// Watch calming down, once, as the section opens (2026-10-16, "Yes please animate busy to calm. Less sensory onslaught for the user's brain.
    /// Animations and graphics welcome"): the busy page (six rows of small cards, badges, lines of small words, an amber row, a bright screen) settles
    /// into Simple Watch's three rows of larger plain cards, the screen dimmed and More to watch at the end, in about three seconds, then holds still.
    /// Nothing loops: the calm picture is where it rests. Play again runs it once more; with Windows' animation effects off it is drawn calm at once.
    /// </summary>
    private FrameworkElement SimpleWatchPicture()
    {
        // Play again draws the picture afresh and runs it from the start: a storyboard stopped and begun again left its transforms where the
        // compositor held them
        var holder = new Border { HorizontalAlignment = HorizontalAlignment.Left };
        holder.Child = CalmPicture(holder, 600);
        return holder;
    }

    private FrameworkElement CalmPicture(Border holder, int delayMs)
    {
        var hues = new uint[] { 0x5B6B8C, 0x8C5B5B, 0x5B8C7A, 0x8C7A5B, 0x6E5B8C, 0x4F7A8C, 0x7A8C5B };
        SolidColorBrush B(uint rgb, byte a = 255) => new(Windows.UI.Color.FromArgb(a, (byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb));
        const double W = 420, H = 252;
        var c = new Canvas { Width = W, Height = H };
        var sb = new Microsoft.UI.Xaml.Media.Animation.Storyboard();
        var ease = new Microsoft.UI.Xaml.Media.Animation.CubicEase { EasingMode = Microsoft.UI.Xaml.Media.Animation.EasingMode.EaseInOut };
        void Anim(DependencyObject target, string prop, double to, double begin, double dur)
        {
            var a = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { To = to, BeginTime = TimeSpan.FromSeconds(begin), Duration = new Duration(TimeSpan.FromSeconds(dur)), EasingFunction = ease };
            Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(a, target);
            Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(a, prop);
            sb.Children.Add(a);
        }
        Border Rect(double x, double y, double w, double h, Brush fill, double r = 2, double opacity = 1)
        {
            var e = new Border { Width = w, Height = h, Background = fill, CornerRadius = new CornerRadius(r), Opacity = opacity };
            Canvas.SetLeft(e, x); Canvas.SetTop(e, y); c.Children.Add(e);
            return e;
        }
        void FadeOut(UIElement e, double begin, double dur = 0.6) => Anim(e, "Opacity", 0, begin, dur);
        void FadeIn(UIElement e, double begin, double dur = 0.7) => Anim(e, "Opacity", 1, begin, dur);

        // the tabs stay as they are
        for (var i = 0; i < 5; i++) Rect(18 + i * 30, 14, 22, 5, i == 0 ? HubAmber : B(0xE8ECF2, 0x70), 2.5);

        // the corner's screen: bright and busy, then dimmed while browsing
        Rect(310, 34, 96, 56, B(0x4F7A8C), 4);
        var glow = Rect(310, 34, 96, 56, new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(1, 1),
            GradientStops = { new GradientStop { Color = Windows.UI.Color.FromArgb(0xA0, 0xF2, 0xB1, 0x4C), Offset = 0 }, new GradientStop { Color = Windows.UI.Color.FromArgb(0, 0, 0, 0), Offset = 1 } },
        }, 4);
        var dim = Rect(310, 34, 96, 56, B(0x0B0D12, 0xD8), 4, 0);
        FadeOut(glow, 1.0, 0.9);
        FadeIn(dim, 1.3, 1.0);

        // the busy page: six rows, the first three's leading cards are the ones that stay and grow
        var k = 0;
        for (var row = 0; row < 6; row++)
        {
            var y = 34 + row * 35;
            var label = Rect(18, y, row == 1 ? 60 : 38, 4, row == 1 ? HubAmber : B(0xE8ECF2, 0x90), 2);
            FadeOut(label, 0.5 + row * 0.05, 0.5);
            var cols = row < 2 ? 6 : 8;
            for (var i = 0; i < cols; i++)
            {
                var x = 18 + i * 36;
                var card = Rect(x, y + 9, 31, 20, B(hues[k++ % hues.Length]), 2);
                var stays = row < 3 && i < (row == 0 ? 4 : 6);
                if (stays)
                {
                    // into Simple Watch's place: three rows, larger, more room between
                    var cy = 38 + row * 60 + 12;
                    var cx = 18 + i * 66;
                    var t = new CompositeTransform();
                    card.RenderTransform = t;
                    var begin = 1.15 + row * 0.12 + i * 0.03;
                    Anim(t, "TranslateX", cx - x, begin, 1.1);
                    Anim(t, "TranslateY", cy - (y + 9), begin, 1.1);
                    Anim(t, "ScaleX", 57.0 / 31, begin, 1.1);
                    Anim(t, "ScaleY", 36.0 / 20, begin, 1.1);
                    card.CornerRadius = new CornerRadius(1.7);
                }
                else
                {
                    // the rest of the page steps back
                    var t = new CompositeTransform();
                    card.RenderTransform = t;
                    var begin = 0.7 + (row >= 3 ? (row - 3) * 0.08 : 0) + i * 0.02;
                    FadeOut(card, begin, 0.7);
                    Anim(t, "TranslateY", 10, begin, 0.7);
                }
                if ((i + row) % 3 == 0) FadeOut(Rect(x + 22, y + 10, 7, 7, HubAmber, 3.5), 0.35 + i * 0.03, 0.45);   // a badge
                if ((i * 7 + row) % 4 == 1) FadeOut(Rect(x + 3, y + 24, 18, 3, B(0xE8ECF2, 0xB0), 1.5), 0.4 + i * 0.03, 0.45);   // a line of small words
            }
        }
        // Simple Watch's own row names and More to watch, arriving last
        for (var row = 0; row < 3; row++) FadeIn(Rect(18, 38 + row * 60, 50, 4, B(0xE8ECF2, 0x90), 2, 0), 2.0 + row * 0.1);
        var pill = Rect(18, 224, 86, 16, HubChipHover, 8, 0);
        FadeIn(pill, 2.5, 0.6);

        var frame = new Border
        {
            Width = W, Height = H, Child = c, Background = B(0x0F1216), CornerRadius = new CornerRadius(12),
            BorderThickness = new Thickness(1), BorderBrush = B(0xE8ECF2, 0x30), HorizontalAlignment = HorizontalAlignment.Left,
        };

        // the caption follows the picture: Everything at once, then Simple Watch in amber
        var busyCap = new TextBlock { Text = "Everything at once", FontSize = 15, Foreground = HubInk };
        var calmCap = new TextBlock { Text = "Simple Watch", FontSize = 15, Foreground = HubAmber, Opacity = 0 };
        FadeOut(busyCap, 1.4, 0.6);
        FadeIn(calmCap, 2.0, 0.7);
        var again = new TextBlock { Text = (char)0x21BB + "  Play again", FontSize = 14, Foreground = HubInk };
        var replay = Chip(again, false);
        replay.Opacity = 0; replay.Padding = new Thickness(12, 5, 12, 6);
        replay.HorizontalAlignment = HorizontalAlignment.Right; replay.VerticalAlignment = VerticalAlignment.Center;
        ToolTipService.SetToolTip(replay, "Shows Watch calming down again.");
        FadeIn(replay, 3.2, 0.5);
        var under = new Grid { Width = W, Children = { busyCap, calmCap, replay } };

        // once, a moment after the section shows; drawn calm at once when Windows' animation effects are off
        var motion = true;
        try { motion = new Windows.UI.ViewManagement.UISettings().AnimationsEnabled; } catch { }
        // it starts once it is seen: a picture laid out inside a closed part (the welcome page's) waits until the part opens and gives it a size
        var started = false;
        async void Kick()
        {
            if (started || frame.ActualWidth <= 0) return;
            started = true;
            if (motion) await Task.Delay(delayMs);
            sb.Begin();
            if (!motion) sb.SkipToFill();
        }
        frame.Loaded += (_, __) => Kick();
        frame.SizeChanged += (_, __) => Kick();
        replay.Click += (_, __) => holder.Child = CalmPicture(holder, 150);
        return new StackPanel { Spacing = 8, Margin = new Thickness(0, 6, 0, 4), HorizontalAlignment = HorizontalAlignment.Left, Children = { frame, under } };
    }
}
