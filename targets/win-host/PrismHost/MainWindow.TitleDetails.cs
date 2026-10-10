using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// A title's details window (2026-09-23, "Let's not show the IMDb link at all. We should be able to avoid using it. Let's instead just show info from
/// TMDB in a structured formatted intuitive useful modal"; "Let's just start by making the window"). Core fetches and shapes TMDB's facts
/// (title-details.ts, polled through titleDetails); the host only lays them out: the backdrop, the poster, the facts line, the overview, TMDB's
/// rating with its disclosure, who made it, where to watch (JustWatch's data, credited), the cast, the trailer, and TMDB's required notice.
/// Esc, the close corner or a press outside the card closes it.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _detailsWin;
    private int _detailsRun;
    private static readonly string DetDot = "  " + (char)0x00B7 + "  ";
    private static readonly string DetStar = ((char)0x2605).ToString();
    private static readonly SolidColorBrush DetChipHover = new(Windows.UI.Color.FromArgb(0xFF, 0x33, 0x38, 0x45));
    /// <summary>
    /// A press-able control's reaction (2026-09-24, "there is no focus change when mousing over a service to watch ... Can we add a focus reaction?
    /// Like onmouseover and click"): the pointer over it lifts it a little and lights it (a lighter chip, an amber edge - or a brighter ring on a
    /// ringed logo); a press sinks it; leaving settles it. Keyboard focus lights it the same way.
    /// </summary>
    /// <summary>The card on a service's own list (Watch's My List row) for this title, or null - the item a remove sends back to the service.</summary>
    private async Task<JsonObject?> ServiceListCardAsync(string app, string title)
    {
        try
        {
            var m = JsonNode.Parse(await ModelCallAsync("videoMenu") ?? "null") as JsonObject;
            static string Norm(string t) => new string(t.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
            var want = Norm(title);
            foreach (var c in (m?["list"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
            {
                if (c["app"]?.GetValue<string>() == app && Norm((c["item"] as JsonObject)?["title"]?.GetValue<string>() ?? "") == want) return c;
                foreach (var o in (c["also"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())   // the same title on another service, folded into this card
                    if (o["app"]?.GetValue<string>() == app && Norm((o["item"] as JsonObject)?["title"]?.GetValue<string>() ?? "") == want) return o;
            }
        }
        catch { }
        return null;
    }
    private static void HoverReact(Button b, Border? ring = null)
    {
        var scale = new ScaleTransform { ScaleX = 1, ScaleY = 1 };
        b.RenderTransform = scale;
        b.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
        var rest = b.Background;
        var restRing = ring?.BorderThickness ?? new Thickness(0);
        var clear = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0));
        if (ring is null)
        {
            b.BorderBrush = clear; b.BorderThickness = new Thickness(1.5);   // the edge is always there, amber only when lit (no size jump)
            b.Resources["ButtonBackgroundPointerOver"] = DetChipHover; b.Resources["ButtonBackgroundPressed"] = DetChipHover;
            b.Resources["ButtonBorderBrushPointerOver"] = DetAmber; b.Resources["ButtonBorderBrushPressed"] = DetAmber;
        }
        else
        {
            b.Resources["ButtonBackgroundPointerOver"] = clear; b.Resources["ButtonBackgroundPressed"] = clear;
            b.Resources["ButtonBorderBrushPointerOver"] = clear; b.Resources["ButtonBorderBrushPressed"] = clear;
        }
        b.Resources["ButtonForegroundPointerOver"] = DetInk; b.Resources["ButtonForegroundPressed"] = DetInk;
        var over = false;
        void To(double v)
        {
            var sb = new Microsoft.UI.Xaml.Media.Animation.Storyboard();
            foreach (var prop in new[] { "ScaleX", "ScaleY" })
            {
                var a = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { To = v, Duration = new Duration(TimeSpan.FromMilliseconds(120)), EnableDependentAnimation = true };
                Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(a, scale);
                Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(a, prop);
                sb.Children.Add(a);
            }
            sb.Begin();
        }
        void Lit(bool on)
        {
            if (ring is not null) { ring.BorderThickness = on ? new Thickness(3) : restRing; ring.BorderBrush = on ? DetInk : DetAmber; }
            else { b.Background = on ? DetChipHover : rest; b.BorderBrush = on ? DetAmber : clear; }
        }
        b.PointerEntered += (_, __) => { over = true; Lit(true); To(1.06); };
        b.PointerExited += (_, __) => { over = false; Lit(b.FocusState == FocusState.Keyboard); To(1.0); };
        b.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, __) => To(0.95)), true);
        b.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler((_, __) => { To(over ? 1.06 : 1.0); Lit(over); }), true);
        b.AddHandler(UIElement.PointerCaptureLostEvent, new PointerEventHandler((_, __) => { To(over ? 1.06 : 1.0); Lit(over); }), true);
        b.GotFocus += (_, __) => { if (b.FocusState == FocusState.Keyboard) { Lit(true); To(1.06); } };
        b.LostFocus += (_, __) => { if (!over) { Lit(false); To(1.0); } };
    }
    private static readonly SolidColorBrush DetInk = new(Windows.UI.Color.FromArgb(0xFF, 0xE8, 0xEC, 0xF2));
    private static readonly SolidColorBrush DetDim = new(Windows.UI.Color.FromArgb(0xFF, 0x8A, 0x93, 0xA2));
    private static readonly SolidColorBrush DetAmber = new(Windows.UI.Color.FromArgb(0xFF, 0xF2, 0xB1, 0x4C));
    private static readonly SolidColorBrush DetCard = new(Windows.UI.Color.FromArgb(0xFF, 0x12, 0x13, 0x1A));
    private static readonly SolidColorBrush DetChip = new(Windows.UI.Color.FromArgb(0xFF, 0x22, 0x25, 0x2E));

    /// <summary>The open Details page's dim and card, fitted again to where the corner is now.</summary>
    private Action? _detailsReshape;
    // The actor who led here (2026-10-09, "Is it possible to have the actor that led us down this trail be the first one listed with a
    // gold background behind them in this by-actor drill down? If they click a different actor in a show, by all means replace the
    // active set actor with that one. And if no such selection has been made, just open the details and actor lists normally"): set by
    // a press on a face in a cast row, or on a title of a person's page; a title's cast then begins with them, in gold. A title reached
    // from their page lists them even when TMDB's first sixteen do not (the role is the one their page gave). The trail ends with the window.
    private (double Id, string Name, string Photo)? _trailActor;
    private readonly Dictionary<string, string> _trailRoles = new();
    /// <summary>Open the details window for a title (the card's own words; the service's App when the card has one, which tells a same-name pair apart).</summary>
    public void ShowTitleDetails(string title, string? kind, string? app) => ShowTitleDetails(title, kind, app, null);
    /// <summary>The details window on a title; <paramref name="backTo"/> names what its first Back returns to ("Search results"), null for none.</summary>
    public void ShowTitleDetails(string title, string? kind, string? app, string? backTo)
    {
        CloseTitleDetails();
        _detailsHistory.Clear();
        _trailActor = null; _trailRoles.Clear();   // a title opened afresh: no actor led here
        _detailsFirstBack = backTo;
        _detailsApp = app;   // the service a card opened it from: its episodes and where you left off (DetailsEpisodes)
        var run = ++_detailsRun;
        var scrim = new Grid();
        Canvas.SetZIndex(scrim, 960);   // over the Watch page (930) and the curtain (925)
        // the dim, with the corner's screens left out (2026-09-25, "When you dim the screen for the details page, do you think it's necessary to hide
        // the big screen video? Seems like we could still be showing it this whole time"): the card never covers the corner, so the screens and their
        // control bar stay bright and within reach through a hole in the dim; everywhere else the dim is as before, and a press on it closes
        var dimBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0xD8, 0x05, 0x06, 0x09));
        var dim = new Microsoft.UI.Xaml.Shapes.Path { Fill = dimBrush };
        scrim.Children.Add(dim);
        Border? cardOf = null;
        void ShapeDim()
        {
            var w = scrim.ActualWidth; var h = scrim.ActualHeight;
            if (w <= 0 || h <= 0) return;
            var geo = new GeometryGroup { FillRule = FillRule.EvenOdd };
            geo.Children.Add(new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, w, h) });
            if (StackBounds(scrim) is { } hole)
            {
                hole = new Windows.Foundation.Rect(hole.X - 6, hole.Y - 6, hole.Width + 12, hole.Height + 12);
                geo.Children.Add(new RectangleGeometry { Rect = hole });
            }
            // the card stays left of the corner, centred in the room beside it (2026-09-26, "Can we move details over to the left enough not to
            // cover a portion of the video preview on the watch screen?"): centred on the page it ran over the big screen's left edge
            if (cardOf is { } cd) cd.Margin = new Thickness(60, 40, StackBounds(scrim) is { } sb && sb.X > 0 ? Math.Max(60, w - sb.X + 24) : 60, 40);
            dim.Data = geo;
        }
        scrim.SizeChanged += (_, __) => ShapeDim();
        _detailsReshape = ShapeDim;   // and again as the corner moves or fills
        scrim.Loaded += (_, __) => ShapeDim();
        var body = new StackPanel { Spacing = 18 };
        var card = new Border
        {
            Background = DetCard, CornerRadius = new CornerRadius(14), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x55, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(1),
            MaxWidth = 1240, Margin = new Thickness(60, 40, 60, 40), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
        };
        // the Back / Close bar floats over the page, reachable however far it is scrolled (2026-09-23, "make the X and Return to search results
        // options float so they can be clicked even if you're scrolled down the window")
        _detailsBarHost = new Border { VerticalAlignment = VerticalAlignment.Top, IsHitTestVisible = true };
        card.Child = new Grid { Children = { new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled }, _detailsBarHost } };
        // a press inside the card is the card's; a press on the dim around it closes
        card.PointerPressed += (_, e) => e.Handled = true;
        dim.PointerPressed += (_, __) => CloseTitleDetails();   // the dim, not the hole: the screens there take their own presses
        scrim.Children.Add(card);
        cardOf = card;
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; CloseTitleDetails(); };
        scrim.KeyboardAccelerators.Add(esc);
        var bk = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Back };
        bk.Invoked += (_, e) => { e.Handled = true; DetailsBack(); };
        scrim.KeyboardAccelerators.Add(bk);
        body.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal, Spacing = 14, Margin = new Thickness(36, 60, 36, 60), HorizontalAlignment = HorizontalAlignment.Center,
            Children = { new ProgressRing { IsActive = true, Width = 26, Height = 26, Foreground = DetAmber }, new TextBlock { Text = "Reading " + title + " from TMDB" + (char)0x2026, FontSize = 18, Foreground = DetDim, VerticalAlignment = VerticalAlignment.Center } },
        });
        RootGrid.Children.Add(scrim);
        _detailsWin = scrim;
        scrim.Loaded += (_, __) => scrim.Focus(FocusState.Programmatic);
        _detailsBody = body;
        _detailsCurrent = (title, () => RenderDetailsPage(title, () => ModelCallAsync("titleDetails", title, kind ?? "", app ?? "")));
        _ = FillTitleDetailsAsync(run, body, title, () => ModelCallAsync("titleDetails", title, kind ?? "", app ?? ""));
        LogLine("details: " + title + (kind is null ? "" : " (" + kind + ")"));
    }

    // ---- one window, many pages (2026-09-23, "Preferably all these modals aren't layered though. Preferably there is clear flow from Search to
    // Details to Actor to Details"): a page replaces the last in the same window; Back walks the history, the first Back to where it was opened from
    private StackPanel? _detailsBody;
    private Border? _detailsBarHost;
    private readonly List<(string label, Action render)> _detailsHistory = new();
    private (string label, Action render)? _detailsCurrent;
    private string? _detailsFirstBack;
    private void NavigateDetails(string label, Action render)
    {
        if (_detailsCurrent is { } cur) _detailsHistory.Add(cur);
        _detailsCurrent = (label, render);
        render();
    }
    private void DetailsBack()
    {
        if (_detailsHistory.Count == 0) { CloseTitleDetails(); return; }
        var prev = _detailsHistory[^1];
        _detailsHistory.RemoveAt(_detailsHistory.Count - 1);
        _detailsCurrent = prev;
        prev.render();
    }
    /// <summary>A details page drawn into the window's body: the loading line, then TMDB's answer.</summary>
    private void RenderDetailsPage(string title, Func<Task<string?>> fetch)
    {
        if (_detailsBody is not { } body) return;
        var run = ++_detailsRun;
        body.Children.Clear();
        body.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal, Spacing = 14, Margin = new Thickness(36, 60, 36, 60), HorizontalAlignment = HorizontalAlignment.Center,
            Children = { new ProgressRing { IsActive = true, Width = 26, Height = 26, Foreground = DetAmber }, new TextBlock { Text = "Reading " + title + " from TMDB" + (char)0x2026, FontSize = 18, Foreground = DetDim, VerticalAlignment = VerticalAlignment.Center } },
        });
        _ = FillTitleDetailsAsync(run, body, title, fetch);
    }
    /// <summary>The Back / Close bar at the top of every page.</summary>
    private Grid DetailsTopBar()
    {
        var g = new Grid { Margin = new Thickness(0, 14, 14, 0) };
        Canvas.SetZIndex(g, 5);
        var backLabel = _detailsHistory.Count > 0 ? _detailsHistory[^1].label : _detailsFirstBack;
        if (backLabel is { Length: > 0 })
        {
            var back = new Button { Background = DetChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(18), Height = 40, Padding = new Thickness(14, 0, 16, 0), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(14, 0, 0, 0),
                Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { new FontIcon { Glyph = "\uE72B", FontSize = 14 }, new TextBlock { Text = "Back to " + (backLabel.Length > 40 ? backLabel[..40] + (char)0x2026 : backLabel), FontSize = 14 } } } };
            OwnHover(back);   // its own hover, never the system's (memory: hover-loss-tooltips)
            ToolTipService.SetToolTip(back, "Back (Backspace)");
            back.Click += (_, __) => DetailsBack();
            g.Children.Add(back);
        }
        var x = new Button { Content = new FontIcon { Glyph = "\uE711", FontSize = 16 }, Background = DetChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(18), Width = 40, Height = 40, Padding = new Thickness(0), HorizontalAlignment = HorizontalAlignment.Right };
        OwnHover(x);   // its own hover, never the system's (memory: hover-loss-tooltips)
        ToolTipService.SetToolTip(x, "Close (Esc)");
        x.Click += (_, __) => CloseTitleDetails();
        g.Children.Add(x);
        return g;
    }

    /// <summary>A person's page: who they are, then their films and series as cards - newest first, or by name - each opening its details here.</summary>
    private void RenderPersonPage(double id, string name, string sort = "date")
    {
        if (_detailsBody is not { } body) return;
        var run = ++_detailsRun;
        body.Children.Clear();
        body.Children.Add(new StackPanel
        {
            Orientation = Orientation.Horizontal, Spacing = 14, Margin = new Thickness(36, 60, 36, 60), HorizontalAlignment = HorizontalAlignment.Center,
            Children = { new ProgressRing { IsActive = true, Width = 26, Height = 26, Foreground = DetAmber }, new TextBlock { Text = "Reading " + name + "'s films and series from TMDB" + (char)0x2026, FontSize = 18, Foreground = DetDim, VerticalAlignment = VerticalAlignment.Center } },
        });
        _ = FillPersonAsync(run, body, id, name, sort);
    }
    private async Task FillPersonAsync(int run, StackPanel body, double id, string name, string sort)
    {
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        JsonObject? r = null;
        for (var i = 0; i < 60 && run == _detailsRun; i++)
        {
            try { r = JsonNode.Parse(await ModelCallAsync("personPage", id) ?? "null") as JsonObject; } catch { r = null; }
            if (r?["status"]?.GetValue<string>() != "working") break;
            await Task.Delay(350);
        }
        if (run != _detailsRun) return;
        body.Children.Clear();
        if (_detailsBarHost is not null) _detailsBarHost.Child = DetailsTopBar();
        if (r?["person"] is not JsonObject pd)
        {
            body.Children.Add(new TextBlock { Text = name, FontSize = 30, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = DetInk, Margin = new Thickness(36, 60, 36, 0) });
            body.Children.Add(new TextBlock { Text = "No details: " + (r?["why"]?.GetValue<string>() ?? "TMDB did not answer in time") + ".", FontSize = 17, Foreground = DetDim, Margin = new Thickness(36, 0, 36, 36), TextWrapping = TextWrapping.Wrap });
            return;
        }
        var main = new StackPanel { Spacing = 18, Margin = new Thickness(36, 70, 36, 24) };
        // who they are
        var head = new Grid { ColumnSpacing = 28 };
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var face = new Border { Width = 160, Height = 160, CornerRadius = new CornerRadius(80), Background = DetChip, VerticalAlignment = VerticalAlignment.Top };
        if (S(pd, "photo") is { Length: > 0 } ph) face.Child = MakeImage(ph);
        else face.Child = new TextBlock { Text = name.Length > 0 ? name[..1] : "?", FontSize = 52, Foreground = DetDim, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        head.Children.Add(face);
        var who = new StackPanel { Spacing = 8 };
        Grid.SetColumn(who, 1);
        who.Children.Add(new TextBlock { Text = S(pd, "name").Length > 0 ? S(pd, "name") : name, FontSize = 32, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = DetInk, TextWrapping = TextWrapping.Wrap });
        var facts = string.Join("  \u00B7  ", new[] { S(pd, "known"), S(pd, "born").Length > 0 ? "born " + S(pd, "born") : "" }.Where(x => x.Length > 0));
        if (facts.Length > 0) who.Children.Add(new TextBlock { Text = facts, FontSize = 15, Foreground = DetDim });
        if (S(pd, "bio") is { Length: > 0 } bio) who.Children.Add(new TextBlock { Text = bio, FontSize = 15, Foreground = DetInk, TextWrapping = TextWrapping.Wrap, MaxLines = 6, TextTrimming = TextTrimming.WordEllipsis });
        head.Children.Add(who);
        main.Children.Add(head);
        // their films and series
        var credits = (pd["credits"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        credits = sort == "name"
            ? credits.OrderBy(c => S(c, "title"), StringComparer.CurrentCultureIgnoreCase).ToList()
            : credits.OrderByDescending(c => S(c, "date").Length > 0 ? S(c, "date") : "0000").ThenBy(c => S(c, "title")).ToList();
        var bar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        bar.Children.Add(SectionHead("Films and series  \u00B7  " + credits.Count));
        bar.Children.Add(new TextBlock { Text = "Sort", FontSize = 13, Foreground = DetDim, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(18, 6, 2, 0) });
        foreach (var (sid, slabel) in new[] { ("date", "Release date"), ("name", "Name") })
        {
            var on = sid == sort;
            var chip = new Button { Content = new TextBlock { Text = slabel, FontSize = 13, Foreground = on ? DetAmber : DetInk }, Background = DetChip, BorderThickness = new Thickness(on ? 1 : 0), BorderBrush = DetAmber, CornerRadius = new CornerRadius(14), Padding = new Thickness(12, 4, 12, 4), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 6, 0, 0) };
            OwnHover(chip);   // its own hover, never the system's (memory: hover-loss-tooltips)
            var sid2 = sid;
            chip.Click += (_, __) => { if (sid2 != sort) { _detailsCurrent = (name, () => RenderPersonPage(id, name, sid2)); RenderPersonPage(id, name, sid2); } };
            bar.Children.Add(chip);
        }
        main.Children.Add(bar);
        var grid = new VariableSizedWrapGrid { Orientation = Orientation.Horizontal, ItemWidth = 214, ItemHeight = 176 };
        foreach (var c in credits.Take(300))
        {
            var title = S(c, "title"); var kind = S(c, "kind"); var cid = c["id"]?.GetValue<double>() ?? 0;
            var art = new Grid { Width = 200, Height = 112 };
            art.Children.Add(new Border { Background = DetChip, CornerRadius = new CornerRadius(6), Child = S(c, "backdrop").Length > 0 || S(c, "poster").Length > 0 ? null : new TextBlock { Text = title, FontSize = 13, Foreground = DetDim, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8) } });
            var src = S(c, "backdrop").Length > 0 ? S(c, "backdrop") : S(c, "poster");
            if (src.Length > 0) { try { art.Children.Add(FitArt(src)); } catch { } }
            var year = c["year"] is JsonValue yv && yv.TryGetValue<double>(out var yd) ? ((int)yd).ToString() : "";
            var line = string.Join("  \u00B7  ", new[] { year, kind == "tv" ? "Series" : "Film", S(c, "role") }.Where(x => x.Length > 0));
            var cell = new StackPanel { Spacing = 3, Width = 200 };
            cell.Children.Add(art);
            cell.Children.Add(new TextBlock { Text = title, FontSize = 14, Foreground = DetInk, TextTrimming = TextTrimming.CharacterEllipsis });
            cell.Children.Add(new TextBlock { Text = line, FontSize = 12, Foreground = DetDim, TextTrimming = TextTrimming.CharacterEllipsis });
            var btn = new Button { Content = cell, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), Padding = new Thickness(4) };
            ToolTipService.SetToolTip(btn, title + (year.Length > 0 ? " (" + year + ")" : "") + ". Press for its details.");
            var (k2, id2, t2) = (kind == "tv" ? "tv" : "movie", cid, title);
            var role2 = S(c, "role"); var photo2 = S(pd, "photo"); var name2 = S(pd, "name").Length > 0 ? S(pd, "name") : name;
            btn.Click += (_, __) =>
            {
                if (_trailActor?.Id != id) _trailRoles.Clear();
                _trailActor = (id, name2, photo2);
                _trailRoles[k2 + ":" + id2.ToString("0", System.Globalization.CultureInfo.InvariantCulture)] = role2;
                _detailsApp = null; NavigateDetails(t2, () => RenderDetailsPage(t2, () => ModelCallAsync("titleDetailsById", k2, id2)));
            };
            grid.Children.Add(btn);
        }
        main.Children.Add(grid);
        if (credits.Count > 300) main.Children.Add(new TextBlock { Text = "The first 300 of " + credits.Count + ".", FontSize = 12, Foreground = DetDim });
        main.Children.Add(new TextBlock { Text = "Films and series from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.", FontSize = 12, Foreground = DetDim, TextWrapping = TextWrapping.Wrap });
        body.Children.Add(main);
    }

    public void CloseTitleDetails()
    {
        if (_detailsWin is null) return;
        RootGrid.Children.Remove(_detailsWin);
        _detailsWin = null;
        _detailsReshape = null;
        _detailsRun++;
    }

    private async Task FillTitleDetailsAsync(int run, StackPanel body, string title, Func<Task<string?>> fetch)
    {
        JsonObject? r = null;
        for (var i = 0; i < 60 && run == _detailsRun; i++)
        {
            try { r = JsonNode.Parse(await fetch() ?? "null") as JsonObject; } catch { r = null; }
            if (r?["status"]?.GetValue<string>() != "working") break;
            await Task.Delay(350);
        }
        if (run != _detailsRun) return;
        body.Children.Clear();
        if (_detailsBarHost is not null) _detailsBarHost.Child = DetailsTopBar();
        if (r?["details"] is not JsonObject d)
        {
            var why = r?["why"]?.GetValue<string>() ?? "TMDB did not answer in time";
            body.Children.Add(new TextBlock { Text = title, FontSize = 30, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = DetInk, Margin = new Thickness(36, 0, 36, 0) });
            body.Children.Add(new TextBlock { Text = "No details: " + why + ".", FontSize = 17, Foreground = DetDim, Margin = new Thickness(36, 0, 36, 36), TextWrapping = TextWrapping.Wrap });
            return;
        }
        LayOutDetails(body, d);
    }

    /// <summary>The page's Watch on row, and where its service buttons end (a service found later is added there).</summary>
    private StackPanel? _detailsWatch;
    private int _detailsWatchAt;
    /// <summary>Core's plan for a title's Stream row (2026-09-28): each service worth asking about it - Disney+ for a title Hulu lists - gets a
    /// "Checking ..." line, shown only while that service is really being asked, and its answer followed.</summary>
    private async Task StartAlsoOnAsync(int run, JsonObject d, StackPanel streamRow, Panel where, List<string> playApps)
    {
        JsonArray? plan = null;
        try { plan = JsonNode.Parse(await ModelCallAsync("titleAlsoOnPlan", new JsonArray(playApps.Select(a => (JsonNode?)JsonValue.Create(a)).ToArray()).ToJsonString()) ?? "[]") as JsonArray; } catch { }
        if (run != _detailsRun) return;
        foreach (var step in plan?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var via = step["via"]?.GetValue<string>() ?? ""; var viaName = step["viaName"]?.GetValue<string>() ?? via; var alsoName = step["name"]?.GetValue<string>() ?? "";
            if (via.Length == 0) continue;
            // a household with Hulu and no Disney+ never sees it (2026-09-25, "Hulu could be configured without Disney, keep that in mind")
            var alsoNote = new TextBlock { Text = "Checking " + alsoName + (char)0x2026, FontSize = 12, Foreground = DetDim, Visibility = Visibility.Collapsed };
            where.Children.Add(alsoNote);
            _ = FollowAlsoOnAsync(run, d, streamRow, alsoNote, via, viaName);
        }
    }
    /// <summary>Whether a service carries a title another service lists (Disney+ for a Hulu title - core's plan, asked in the background): its ringed
    /// button joins the Stream row when it does.</summary>
    private async Task FollowAlsoOnAsync(int run, JsonObject d, StackPanel streamRow, TextBlock note, string via, string viaName)
    {
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        var tkind = S(d, "kind"); var tid = d["id"]?.GetValue<double>() ?? 0; var ttitle = S(d, "title"); var tposter = d["poster"]?.GetValue<string>();
        for (var i = 0; i < 80 && run == _detailsRun; i++)
        {
            JsonObject? r = null;
            try { r = JsonNode.Parse(await ModelCallAsync("titleAlsoOn", tkind, (long)tid, ttitle, via) ?? "null") as JsonObject; } catch { }
            if (run != _detailsRun) return;
            var state = S(r, "state");
            if (state == "checking") { note.Visibility = Visibility.Visible; await Task.Delay(1500); continue; }
            if (state != "yes") { note.Visibility = Visibility.Collapsed; return; }
            var app = S(r, "app"); var name = S(r, "name");
            var cand = new JsonObject { ["id"] = "tmdb:" + tkind + ":" + ((long)tid).ToString(), ["title"] = ttitle, ["kind"] = tkind == "tv" ? "series" : "movie" };
            if (d["year"] is JsonValue yv && yv.TryGetValue<double>(out var yd)) cand["year"] = (int)yd;
            var chip = new Border { Background = DetChip, CornerRadius = new CornerRadius(8), Padding = new Thickness(10, 6, 10, 6), Child = new TextBlock { Text = name, FontSize = 13, Foreground = DetInk } };
            var ring = new Border { BorderBrush = DetAmber, BorderThickness = new Thickness(2), CornerRadius = new CornerRadius(10), Padding = new Thickness(2), Child = chip };
            var pb = new Button { Content = ring, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), Padding = new Thickness(0) };
            ToolTipService.SetToolTip(pb, "Play " + ttitle + " on " + name + ". It's there through the " + viaName + " bundle.");
            pb.Click += (_, __) =>
            {
                CloseTitleDetails();
                if (PickLeavesWatch(ttitle)) { CloseVideoHub(); ShowStageCurtain(ttitle, name, tposter); }
                _ = PlayResultAsync(app, cand.ToJsonString(), ttitle, name);
            };
            HoverReact(pb, ring);
            streamRow.Children.Add(pb);
            note.Text = name + " has it too, through the " + viaName + " bundle.";
            note.Visibility = Visibility.Visible;
            // and in Watch on, beside the other services
            if (_detailsWatch is { } wr && _detailsWatchAt <= wr.Children.Count)
            {
                var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { ServiceMark(app, name, 24), new TextBlock { Text = name, FontSize = 14, Foreground = DetInk, VerticalAlignment = VerticalAlignment.Center } } };
                var wb = new Button { Content = line, Background = DetChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(18), Padding = new Thickness(10, 6, 14, 6) };
                OwnHover(wb);   // its own hover, never the system's (memory: hover-loss-tooltips)
                ToolTipService.SetToolTip(wb, "Play " + ttitle + " on " + name + " in the big window. It's there through the " + viaName + " bundle.");
                HoverReact(wb);
                wb.Click += (_, __) => { CloseTitleDetails(); if (PickLeavesWatch(ttitle)) { CloseVideoHub(); ShowStageCurtain(ttitle, name, tposter); } _ = PlayResultAsync(app, cand.ToJsonString(), ttitle, name); };
                wr.Children.Insert(_detailsWatchAt, wb);
            }
            return;
        }
        note.Visibility = Visibility.Collapsed;
    }

    private Grid CloseCorner()
    {
        var x = new Button { Content = new FontIcon { Glyph = "\uE711", FontSize = 16 }, Background = DetChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(18), Width = 40, Height = 40, Padding = new Thickness(0), HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 14, 14, -54) };
        OwnHover(x);   // its own hover, never the system's (memory: hover-loss-tooltips)
        ToolTipService.SetToolTip(x, "Close (Esc)");
        x.Click += (_, __) => CloseTitleDetails();
        Canvas.SetZIndex(x, 5);
        return new Grid { Children = { x } };
    }

    private void LayOutDetails(StackPanel body, JsonObject d)
    {
        _detailsWatch = null;   // this page's own Watch on row, set when it is drawn
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        int? I(JsonNode? n, string k) => (n as JsonObject)?[k] is JsonValue v && v.TryGetValue<double>(out var x) ? (int)x : null;
        IEnumerable<string> L(JsonNode? n) => (n as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0) ?? Enumerable.Empty<string>();

        // the backdrop, fading into the card
        var backdrop = S(d, "backdrop");
        if (backdrop.Length > 0)
        {
            var hero = new Grid { Height = 300 };
            try { hero.Children.Add(new Image { Source = new BitmapImage(Services.ArtCache.UriFor(backdrop)), Stretch = Stretch.UniformToFill, VerticalAlignment = VerticalAlignment.Top }); } catch { }
            hero.Children.Add(new Border { Background = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(0, 1), GradientStops = { new GradientStop { Color = Windows.UI.Color.FromArgb(0x10, 0x12, 0x13, 0x1A), Offset = 0 }, new GradientStop { Color = Windows.UI.Color.FromArgb(0xFF, 0x12, 0x13, 0x1A), Offset = 1 } } } });
            body.Children.Add(hero);
        }

        // the poster and the head: title, the facts line, genres, tagline
        var top = new Grid { ColumnSpacing = 28, Margin = new Thickness(36, backdrop.Length > 0 ? -150 : 8, 36, 0) };
        top.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        top.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var poster = S(d, "poster");
        var posterBox = new Border { Width = 220, Height = 330, CornerRadius = new CornerRadius(10), Background = DetChip, VerticalAlignment = VerticalAlignment.Top };
        if (poster.Length > 0) { try { posterBox.Child = new Image { Source = new BitmapImage(Services.ArtCache.UriFor(poster)), Stretch = Stretch.UniformToFill }; } catch { } }
        top.Children.Add(posterBox);
        var head = new StackPanel { Spacing = 10, VerticalAlignment = VerticalAlignment.Bottom };
        Grid.SetColumn(head, 1);
        var year = I(d, "year");
        head.Children.Add(new TextBlock { Text = S(d, "title") + (year is { } y ? "  (" + y + ")" : ""), FontSize = 36, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = DetInk, TextWrapping = TextWrapping.Wrap });
        var facts = new List<string>();
        if (S(d, "certification") is { Length: > 0 } cert) facts.Add(cert);
        var tv = S(d, "kind") == "tv";
        if (tv)
        {
            if (I(d, "seasons") is { } sn) facts.Add(sn + (sn == 1 ? " season" : " seasons") + (I(d, "episodes") is { } en ? ", " + en + " episodes" : ""));
            if (I(d, "runtime") is { } rt) facts.Add(rt + " min episodes");
        }
        else if (I(d, "runtime") is { } rt2) facts.Add(rt2 >= 60 ? rt2 / 60 + " h " + rt2 % 60 + " min" : rt2 + " min");
        if (S(d, "status") is { Length: > 0 } st) facts.Add(st);
        if (facts.Count > 0) head.Children.Add(new TextBlock { Text = string.Join(DetDot, facts), FontSize = 16, Foreground = DetDim, TextWrapping = TextWrapping.Wrap });
        var genres = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        foreach (var g in L(d["genres"])) genres.Children.Add(new Border { Background = DetChip, CornerRadius = new CornerRadius(12), Padding = new Thickness(12, 4, 12, 4), Child = new TextBlock { Text = g, FontSize = 13, Foreground = DetInk } });
        if (genres.Children.Count > 0) head.Children.Add(genres);
        if (S(d, "tagline") is { Length: > 0 } tag) head.Children.Add(new TextBlock { Text = tag, FontSize = 17, FontStyle = Windows.UI.Text.FontStyle.Italic, Foreground = DetAmber, TextWrapping = TextWrapping.Wrap });
        if (d["trailer"] is JsonObject tr && S(tr, "youtube") is { Length: > 0 } yt)
        {
            var play = new Button
            {
                Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { new FontIcon { Glyph = "\uE768", FontSize = 16, Foreground = DetAmber }, new TextBlock { Text = "Trailer", FontSize = 16, Foreground = DetInk } } },
                Background = DetChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(18), Padding = new Thickness(18, 8, 18, 8), Margin = new Thickness(0, 4, 0, 0),
            };
            ToolTipService.SetToolTip(play, S(tr, "name") + " (YouTube)");
            var url = "https://www.youtube.com/watch?v=" + Uri.EscapeDataString(yt);
            play.Click += (_, __) => { CloseTitleDetails(); CloseVideoHub(); _ = OpenLinkAsync(url, "YouTube"); };
            head.Children.Add(play);
        }
        // Watch on - the household's own services that carry it, each playing it in the big window and closing this and the search (2026-09-23,
        // "I should also be able to click the streaming service (if installed, so show a list for specifically installed ones) and it should take me
        // directly to that item to begin playing in the main video player"); My List beside them
        var mineSvcs = new List<(string app, string name)>();
        if (d["providers"] is JsonObject pv0)
            foreach (var key in new[] { "stream", "free", "rent", "buy" })
                foreach (var o in (pv0[key] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                    if (o["play"] is JsonObject pl && S(pl, "app") is { Length: > 0 } a && !mineSvcs.Any(x => x.app == a)) mineSvcs.Add((a, S(pl, "name")));
        if (mineSvcs.Count > 0)
        {
            var tkind = S(d, "kind"); var tid = d["id"]?.GetValue<double>() ?? 0; var ttitle = S(d, "title");
            var cand = new JsonObject { ["id"] = "tmdb:" + tkind + ":" + ((long)tid).ToString(), ["title"] = ttitle, ["kind"] = tkind == "tv" ? "series" : "movie" };
            if (d["year"] is JsonValue yv0 && yv0.TryGetValue<double>(out var yd0)) cand["year"] = (int)yd0;
            var poster0 = d["poster"]?.GetValue<string>();
            var watch = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 6, 0, 0) };
            watch.Children.Add(new TextBlock { Text = "Watch on", FontSize = 15, Foreground = DetDim, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 4, 0) });
            foreach (var (a, n) in mineSvcs)
            {
                var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { ServiceMark(a, n, 24), new TextBlock { Text = n, FontSize = 14, Foreground = DetInk, VerticalAlignment = VerticalAlignment.Center } } };
                var wb = new Button { Content = line, Background = DetChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(18), Padding = new Thickness(10, 6, 14, 6) };
                OwnHover(wb);   // its own hover, never the system's (memory: hover-loss-tooltips)
                ToolTipService.SetToolTip(wb, "Play " + ttitle + " on " + n + " in the big window");
                var (a2, n2) = (a, n);
                HoverReact(wb);
                wb.Click += (_, __) => { CloseTitleDetails(); if (PickLeavesWatch(ttitle)) { CloseVideoHub(); ShowStageCurtain(ttitle, n2, poster0); } _ = PlayResultAsync(a2, cand.ToJsonString(), ttitle, n2); };
                watch.Children.Add(wb);
            }
            _detailsWatch = watch; _detailsWatchAt = watch.Children.Count;   // a service found later (Disney+ for a Hulu title) joins here
            var mine = new Button { Background = DetChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(18), Padding = new Thickness(12, 6, 14, 6),
                Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { new FontIcon { Glyph = "\uE710", FontSize = 13 }, new TextBlock { Text = "My List", FontSize = 14, Foreground = DetInk } } } };
            OwnHover(mine);   // its own hover, never the system's (memory: hover-loss-tooltips)
            var mfly = new MenuFlyout();
            var mineOn = new List<string>();
            void MarkMine(string service, bool on)
            {
                if (on && !mineOn.Contains(service)) mineOn.Add(service);
                if (!on) mineOn.Remove(service);
                if (mineSvcs.Count == 1 || ((StackPanel)mine.Content).Children is not { Count: >= 2 } parts) return;   // one service: its own button logic
                ((FontIcon)parts[0]).Glyph = mineOn.Count > 0 ? "\uE73E" : "\uE710";
                ((TextBlock)parts[1]).Text = mineOn.Count > 0 ? "On " + string.Join(" and ", mineOn) + "'s My List" : "My List";
            }
            mfly.Opening += async (_, __) =>
            {
                mfly.Items.Clear();
                foreach (var (a, n) in mineSvcs) { var nn = n; await AddListAddItemAsync(mfly, a, n, cand["id"]!.GetValue<string>(), ttitle, null, tkind == "tv" ? "series" : "movie", "1", on => MarkMine(nn, on)); }
                if (mfly.Items.Count == 0) mfly.Items.Add(new MenuFlyoutItem { Text = "None of these services has a list Prism can add to", IsEnabled = false });
            };
            HoverReact(mine);
            if (mineSvcs.Count == 1)
            {
                // one service: the button IS the action - add, or remove when it is already on that service's list (2026-09-24, "Just run off the
                // one option. In fact, if I already have it in my list, that should instead be an option to remove it from my list")
                var (a1, n1) = mineSvcs[0];
                var mineText = (TextBlock)((StackPanel)mine.Content).Children[1];
                var mineIcon = (FontIcon)((StackPanel)mine.Content).Children[0];
                JsonObject? onList = null; string listName = "My List"; var can = false;
                var isOn = false;   // on the list as far as this window knows - an add just made counts before the service's own item is read
                mine.IsEnabled = false;
                async Task ReadAsync()
                {
                    (can, listName) = await ListInfoAsync(a1);
                    onList = await ServiceListCardAsync(a1, ttitle);
                    mine.IsEnabled = can;
                    isOn = onList is not null || isOn;
                    mineText.Text = !can ? n1 + " has no list Prism can change" : onList is not null ? "On " + n1 + "'s " + listName : "Add to " + n1 + "'s " + listName;
                    mineIcon.Glyph = onList is not null ? "\uE73E" : "\uE710";
                    ToolTipService.SetToolTip(mine, onList is not null ? ttitle + " is on " + n1 + "'s " + listName + ": press to remove it." : "Puts " + ttitle + " on " + listName + " on " + n1 + " itself.");
                }
                _ = ReadAsync();
                mine.Click += (_, __) =>
                {
                    if (!can) return;
                    var item = onList?["item"] as JsonObject;
                    if (isOn)
                    {
                        SetPill("Prism \u00B7 removing " + Shorten(ttitle, 40) + " from " + n1 + "'s " + listName + "\u2026", hold: true);
                        // the service's own item when read; else (an add just made) the catalog id the add used, resolved to the service's copy again
                        if (item is not null) _ = FollowListAsync(a1, n1, listName, false, item["id"]?.GetValue<string>() ?? "", ttitle, item["url"]?.GetValue<string>(), item["kind"]?.GetValue<string>() ?? "title", null, null);
                        else _ = FollowListAsync(a1, n1, listName, false, cand["id"]!.GetValue<string>(), ttitle, null, tkind == "tv" ? "series" : "movie", "1", null);
                        onList = null; isOn = false; mineText.Text = "Add to " + n1 + "'s " + listName; mineIcon.Glyph = "\uE710";
                        ToolTipService.SetToolTip(mine, "Puts " + ttitle + " on " + listName + " on " + n1 + " itself.");
                    }
                    else
                    {
                        isOn = true;
                        ToolTipService.SetToolTip(mine, ttitle + " is on " + n1 + "'s " + listName + ": press to remove it.");
                        SetPill("Prism \u00B7 adding " + Shorten(ttitle, 40) + " to " + n1 + "'s " + listName + "\u2026", hold: true);
                        _ = FollowListAsync(a1, n1, listName, true, cand["id"]!.GetValue<string>(), ttitle, null, tkind == "tv" ? "series" : "movie", "1", null);
                        mineText.Text = "On " + n1 + "'s " + listName; mineIcon.Glyph = "\uE73E";
                        _ = Task.Delay(TimeSpan.FromSeconds(45)).ContinueWith(_ => DispatcherQueue.TryEnqueue(() => _ = ReadAsync()));   // the service's own item, for a remove later
                    }
                };
            }
            else
            {
                mine.Click += (_, __) => mfly.ShowAt(mine);
                ToolTipService.SetToolTip(mine, "Add " + ttitle + " to a service's own list");
                // several services: the button says where the title is (2026-09-25, "I tried to + My List for Tubi, but nothing changes on the screen. It
                // goes back to + My List. Can it change to the checkmark so I know it has taken effect?") - a check and the services' names once a pick is
                // made, or when the page opens on a title already on a list; the menu offers Remove there
                async Task ReadMineAsync()   // on the window's own thread: core is asked from there only
                {
                    foreach (var (a, n) in mineSvcs)
                        if (await ServiceListCardAsync(a, ttitle) is not null) MarkMine(n, true);
                }
                _ = ReadMineAsync();
            }
            // the TMDB watchlist in place of the services' My List while an account is linked (2026-10-03)
            if (_watchActive) watch.Children.Add(WatchlistToggle(tkind == "tv" ? "tv" : "movie", (long)tid, ttitle)); else watch.Children.Add(mine);
            // Send to playlist (docs/features/playlists.md, 2026-09-27): a series sends every episode (specials left out), a movie itself
            var sendApps = mineSvcs.Select(x => x.app).ToList();
            var sendTmdb = tkind + ":" + ((long)tid).ToString();
            int? sendYear = d["year"] is JsonValue syv && syv.TryGetValue<double>(out var syd) ? (int)syd : null;
            JsonObject SendSrc() => CardSource(ttitle, tkind == "tv" ? "series" : "movie", _detailsApp is { Length: > 0 } dap && sendApps.Contains(dap) ? dap : sendApps.FirstOrDefault(), sendApps, sendTmdb, poster0, sendYear);
            var sendBtn = new Button { Background = DetChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(18), Padding = new Thickness(12, 6, 14, 6),
                Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { new FontIcon { Glyph = ((char)0xE8FD).ToString(), FontSize = 13 }, new TextBlock { Text = "Send to playlist", FontSize = 14, Foreground = DetInk } } } };
            OwnHover(sendBtn);
            ToolTipService.SetToolTip(sendBtn, tkind == "tv" ? "Send every episode of " + ttitle + " to a playlist (specials left out)" : "Send " + ttitle + " to a playlist");
            var sendFly = SendToFlyout((tkind == "tv" ? "Send all episodes to" : "Send to", SendSrc));
            sendBtn.Flyout = sendFly;
            if (_playlistsActive) watch.Children.Add(sendBtn);   // playlists are the TMDB account's lists: offered once one is linked (2026-10-06)
            head.Children.Add(new ScrollViewer { Content = watch, HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled });
        }
        top.Children.Add(head);
        body.Children.Add(top);

        // the overview, then the facts in two columns: TMDB's rating (with its disclosure) and who made it
        var main = new StackPanel { Spacing = 22, Margin = new Thickness(36, 8, 36, 12) };
        if (S(d, "overview") is { Length: > 0 } ov) main.Children.Add(new TextBlock { Text = ov, FontSize = 18, Foreground = DetInk, TextWrapping = TextWrapping.Wrap, LineHeight = 27, MaxWidth = 1100, HorizontalAlignment = HorizontalAlignment.Left });
        var cols = new Grid { ColumnSpacing = 40 };
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        cols.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var left = new StackPanel { Spacing = 14 };
        var right = new StackPanel { Spacing = 14 };
        Grid.SetColumn(right, 1);
        RatingLineUi? detailsRating = null;
        if (d["rating"] is JsonObject rating && rating["mean"] is JsonValue mv && mv.TryGetValue<double>(out var mean))
        {
            var votes = rating["votes"] is JsonValue vv && vv.TryGetValue<double>(out var vn) ? (int)vn : 0;
            // the star carries the person's own rating as its amber share (MainWindow.RatingLine.cs, 2026-10-03); the number is TMDB's
            var ratingUi = MakeRatingLine(DetStar + " " + mean.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " / 10", null, 17, DetInk);
            var ratingFact = new StackPanel { Spacing = 2 };
            ratingFact.Children.Add(new TextBlock { Text = "TMDB rating", FontSize = 13, Foreground = DetDim });
            ratingFact.Children.Add(ratingUi.Root);
            ratingFact.Children.Add(new TextBlock { Text = votes.ToString("N0", System.Globalization.CultureInfo.InvariantCulture) + " votes by TMDB members who chose to rate it; each vote counts equally", FontSize = 12, Foreground = DetDim, TextWrapping = TextWrapping.Wrap });
            left.Children.Add(ratingFact);
            detailsRating = ratingUi;
        }
        // the person's own rating, written to TMDB under their linked account (MainWindow.TmdbAccount.cs, 2026-10-03)
        if (d["id"]?.GetValue<double>() is { } ownId && ownId > 0) _ = AddOwnRatingAsync(left, tv ? "tv" : "movie", (int)ownId, detailsRating);
        if (d["by"] is JsonObject by && L(by["names"]).ToList() is { Count: > 0 } byNames) left.Children.Add(Fact(S(by, "label"), string.Join(", ", byNames), null));
        if (L(d["writers"]).ToList() is { Count: > 0 } wr) left.Children.Add(Fact("Written by", string.Join(", ", wr), null));
        if (L(d["makers"]).ToList() is { Count: > 0 } mk) right.Children.Add(Fact(tv ? "Network" : "Studios", string.Join(", ", mk), null));
        var first = S(d, "first"); var last = S(d, "last");
        if (first.Length > 0) right.Children.Add(Fact(tv ? "Aired" : "Released", tv && last.Length > 0 && last != first ? first + "  to  " + last : first, null));
        if (d["next"] is JsonObject nx && I(nx, "season") is { } ns && I(nx, "episode") is { } ne)
            right.Children.Add(Fact("Next episode", "S" + ns + " E" + ne + (S(nx, "name") is { Length: > 0 } nn ? DetDot + nn : "") + (S(nx, "date") is { Length: > 0 } nd ? DetDot + nd : ""), null));
        cols.Children.Add(left); cols.Children.Add(right);
        main.Children.Add(cols);

        // where to watch: TMDB's JustWatch data by kind of offer
        if (d["providers"] is JsonObject prov)
        {
            var where = new StackPanel { Spacing = 10 };
            StackPanel? streamRow = null;
            foreach (var (key, label) in new[] { ("stream", "Stream"), ("free", "Free"), ("rent", "Rent"), ("buy", "Buy") })
            {
                if (prov[key] is not JsonArray offers || offers.Count == 0) continue;
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
                if (key == "stream") streamRow = row;
                row.Children.Add(new TextBlock { Text = label, Width = 70, FontSize = 15, Foreground = DetDim, VerticalAlignment = VerticalAlignment.Center });
                foreach (var o in offers.OfType<JsonObject>().Take(10))
                {
                    var name = S(o, "name"); var logo = S(o, "logo");
                    FrameworkElement chip = logo.Length > 0
                        ? new Border { Width = 40, Height = 40, CornerRadius = new CornerRadius(8), Child = MakeImage(logo) }
                        : new Border { Background = DetChip, CornerRadius = new CornerRadius(8), Padding = new Thickness(10, 6, 10, 6), Child = new TextBlock { Text = name, FontSize = 13, Foreground = DetInk } };
                    ToolTipService.SetToolTip(chip, name);
                    // a household service's logo plays the title there, in the big window (2026-09-23, "the ability any 'Where to watch' icons to take me
                    // to watch that video in the big screen main window") - through the same resolve as a search card's press
                    if (o["play"] is JsonObject pl && S(pl, "app") is { Length: > 0 } papp)
                    {
                        var pname = S(pl, "name");
                        var ring = new Border { BorderBrush = DetAmber, BorderThickness = new Thickness(2), CornerRadius = new CornerRadius(10), Padding = new Thickness(2), Child = chip };
                        var pb = new Button { Content = ring, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), Padding = new Thickness(0) };
                        ToolTipService.SetToolTip(pb, "Play " + S(d, "title") + " on " + pname + (key == "rent" || key == "buy" ? " (" + label.ToLowerInvariant() + " on " + pname + "'s own page)" : ""));
                        var tkind = S(d, "kind"); var tid = d["id"]?.GetValue<double>() ?? 0; var ttitle = S(d, "title");
                        var cand = new JsonObject { ["id"] = "tmdb:" + tkind + ":" + ((long)tid).ToString(), ["title"] = ttitle, ["kind"] = tkind == "tv" ? "series" : "movie" };
                        if (d["year"] is JsonValue yv && yv.TryGetValue<double>(out var yd)) cand["year"] = (int)yd;
                        var tposter = d["poster"]?.GetValue<string>();
                        pb.Click += (_, __) =>
                        {
                            CloseTitleDetails();
                            if (PickLeavesWatch(ttitle)) { CloseVideoHub(); ShowStageCurtain(ttitle, pname, tposter); }
                            _ = PlayResultAsync(papp, cand.ToJsonString(), ttitle, pname);
                        };
                        HoverReact(pb, ring);
                        chip = pb;
                    }
                    row.Children.Add(chip);
                }
                where.Children.Add(row);
            }
            // Hulu's shows in the Disney+ app (2026-09-25): JustWatch lists them under Hulu alone and not every one is there, so Disney+ is asked
            // (core's titleAlsoOn, on its own search, kept a week) and its button joins Stream when it has it
            var playApps = new[] { "stream", "free" }.SelectMany(k => (prov[k] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>()).Select(o => (o["play"] as JsonObject)?["app"]?.GetValue<string>() ?? "").ToList();
            // which services to ask is core's call (2026-09-28): the host names none of them
            if (streamRow is not null) _ = StartAlsoOnAsync(_detailsRun, d, streamRow, where, playApps);
            if (where.Children.Count > 0)
            {
                main.Children.Add(SectionHead("Where to watch"));
                main.Children.Add(where);
                main.Children.Add(new TextBlock { Text = "Data by JustWatch, through TMDB (United States). A ringed logo is one of your services: press it to play the title in the big window.", FontSize = 12, Foreground = DetDim });
            }
        }

        // episodes (2026-09-24): where you left off with Play, and every season's episodes to pick from - under where to watch (2026-09-25, "lets
        // move where to watch above the episode guide")
        if (S(d, "kind") == "tv") main.Children.Add(DetailsEpisodesSection(d));

        // the cast, a row of faces
        if (d["cast"] is JsonArray cast && cast.Count > 0)
        {
            main.Children.Add(SectionHead("Cast"));
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
            var castList = cast.OfType<JsonObject>().ToList();
            double leadId = -1;
            if (_trailActor is { } lead)
            {
                var at = castList.FindIndex(x => x["id"] is JsonValue xv && xv.TryGetValue<double>(out var xid) && xid == lead.Id);
                var titleKey = S(d, "kind") + ":" + (d["id"] is JsonValue dv && dv.TryGetValue<double>(out var did) ? did.ToString("0", System.Globalization.CultureInfo.InvariantCulture) : "");
                if (at >= 0) { var mine = castList[at]; castList.RemoveAt(at); castList.Insert(0, mine); leadId = lead.Id; }
                else if (_trailRoles.TryGetValue(titleKey, out var role))
                {
                    // in this title by their own page's word, past TMDB's first sixteen
                    castList.Insert(0, new JsonObject { ["id"] = lead.Id, ["name"] = lead.Name, ["character"] = role, ["photo"] = lead.Photo });
                    leadId = lead.Id;
                }
            }
            foreach (var c in castList)
            {
                var isLead = leadId >= 0 && c["id"] is JsonValue lv && lv.TryGetValue<double>(out var lid) && lid == leadId;
                var face = new Border { Width = 110, Height = 110, CornerRadius = new CornerRadius(55), Background = DetChip };
                if (S(c, "photo") is { Length: > 0 } ph) face.Child = MakeImage(ph);
                else face.Child = new TextBlock { Text = S(c, "name").Length > 0 ? S(c, "name")[..1] : "?", FontSize = 36, Foreground = DetDim, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
                var who = new StackPanel
                {
                    Width = 120, Spacing = 6,
                    Children =
                    {
                        face,
                        new TextBlock { Text = S(c, "name"), FontSize = 14, Foreground = DetInk, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center },
                        new TextBlock { Text = S(c, "character"), FontSize = 12, Foreground = DetDim, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center },
                    },
                };
                // the actor who led here stands on gold (the plate is the row's own, not the button's: a button's hover is its own affair)
                FrameworkElement shown = who;
                if (isLead)
                {
                    who.Margin = new Thickness(8, 10, 8, 10);
                    shown = new Border { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x4D, 0xF2, 0xB1, 0x4C)), BorderBrush = DetAmber, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(14), Child = who };
                }
                // the face opens their films and series, here (2026-09-23)
                if (c["id"] is JsonValue pv && pv.TryGetValue<double>(out var pid) && pid > 0)
                {
                    var pb = new Button { Content = shown, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0), Padding = new Thickness(0) };
                    var pname = S(c, "name"); var ptitle = S(d, "title"); var pphoto = S(c, "photo");
                    ToolTipService.SetToolTip(pb, pname + "'s films and series" + (isLead ? " (the actor you came here by)" : ""));
                    pb.Click += (_, __) =>
                    {
                        // another face pressed: that actor leads from here on
                        if (_trailActor?.Id != pid) _trailRoles.Clear();
                        _trailActor = (pid, pname, pphoto);
                        NavigateDetails(pname, () => RenderPersonPage(pid, pname));
                    };
                    row.Children.Add(pb);
                }
                else row.Children.Add(shown);
            }
            main.Children.Add(new ScrollViewer { Content = row, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled, VerticalScrollMode = ScrollMode.Disabled, Padding = new Thickness(0, 0, 0, 10) });
        }

        // TMDB's required notice
        main.Children.Add(new TextBlock { Text = "Details from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.", FontSize = 12, Foreground = DetDim, Margin = new Thickness(0, 6, 0, 18), TextWrapping = TextWrapping.Wrap });
        body.Children.Add(main);
    }

    private static Image MakeImage(string url)
    {
        var img = new Image { Stretch = Stretch.UniformToFill };
        try { img.Source = new BitmapImage(Services.ArtCache.UriFor(url)); } catch { }
        return img;
    }
    private static TextBlock SectionHead(string text) => new() { Text = text, FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = DetInk, Margin = new Thickness(0, 6, 0, 0) };
    private static StackPanel Fact(string label, string value, string? note)
    {
        var p = new StackPanel { Spacing = 2 };
        p.Children.Add(new TextBlock { Text = label, FontSize = 13, Foreground = DetDim });
        p.Children.Add(new TextBlock { Text = value, FontSize = 17, Foreground = DetInk, TextWrapping = TextWrapping.Wrap });
        if (note is not null) p.Children.Add(new TextBlock { Text = note, FontSize = 12, Foreground = DetDim, TextWrapping = TextWrapping.Wrap });
        return p;
    }
}
