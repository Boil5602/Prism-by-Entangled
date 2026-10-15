using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// Search, one card per work (2026-09-23, "all the streaming services searches suck. Time to give them a powerful upgrade"; "Instead of showing
/// 'netflix' and 'hulu' on every title, can we show a symbol for that streaming service, and show a stack of cards for multiple"). Core shapes
/// the view (search-view.ts): the household's own titles the words match, TMDB's top result, one card per work with every service that carries
/// it, the people. This draws it: each service as its own symbol, a work on several services as a small stack of cards.
/// </summary>
public sealed partial class MainWindow
{
    private static string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";

    /// <summary>A service's symbol: its own app icon (the one its site gives, kept by the poster cache), else its initials on its colour. The name is the tooltip.</summary>
    private Border ServiceMark(string app, string name, double size = 26, bool grey = false)
    {
        var mono = new TextBlock { Text = Monogram(name), FontSize = Math.Round(size * 0.42), FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var box = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(size * 0.22), Background = HubChip, BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0xC0, 0x0F, 0x12, 0x16)), BorderThickness = new Thickness(1.5), Child = mono };
        ToolTipService.SetToolTip(box, name);
        var entry = _catalog.FirstOrDefault(c => c.Id == (_model.App(app)?.CatalogRef ?? app)) ?? _catalog.FirstOrDefault(c => c.Adapter == app);
        if (grey) box.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x3A, 0x3E, 0x44));
        if (entry is not null) _ = LoadMarkAsync(entry, box, mono, grey);
        return box;
    }
    private static string Monogram(string name)
    {
        var words = name.Replace("+", " +").Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => !string.Equals(w, "at", StringComparison.OrdinalIgnoreCase) && !string.Equals(w, "home", StringComparison.OrdinalIgnoreCase)).ToList();
        if (words.Count == 0) return "?";
        var plus = words.Contains("+");
        var letters = string.Concat(words.Where(w => w != "+").Take(2).Select(w => char.ToUpperInvariant(w[0])));
        return letters + (plus ? "+" : "");
    }
    private async Task LoadMarkAsync(HostCatalogEntry entry, Border box, TextBlock mono, bool grey = false)
    {
        try
        {
            var info = await _posters.GetMarkAsync(entry.Id, entry.Name, entry.Url);
            RootGrid.DispatcherQueue.TryEnqueue(() =>
            {
                if (!grey && info.BackgroundColor is { Length: 7 } bg && bg[0] == '#')
                    box.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, Convert.ToByte(bg.Substring(1, 2), 16), Convert.ToByte(bg.Substring(3, 2), 16), Convert.ToByte(bg.Substring(5, 2), 16)));
                if (info.ImagePath is not { } path) return;
                try
                {
                    // the icon sits behind the initials, unseen, until it opens: an app icon is square and shows; a wide social picture
                    // (Peacock's) is no symbol at that size - the initials stay
                    var bmp = new BitmapImage(Services.ArtCache.UriFor(path));
                    var img = new Image { Source = bmp, Stretch = Stretch.UniformToFill, Opacity = 0 };
                    var g = new Grid();
                    box.Child = null;
                    g.Children.Add(img); g.Children.Add(mono);
                    box.Child = g;
                    // the icons as the services draw them, on the dark tile (a light tile behind Disney's D, Netflix's N and Paramount's mark was
                    // tried and taken back, 2026-09-23: "I liked the dark icons for disney, netflix, paramount")
                    // the whole card in greyscale when its service is not signed in (2026-10-03, "Fully grayscale for the whole card"): the icon
                    // itself made grey from the kept file, the way the Now-on posters are
                    bmp.ImageOpened += (_, _) => { if (bmp.PixelWidth <= bmp.PixelHeight * 1.2) { if (grey) _ = GreyPosterAsync(path, Services.ArtCache.UriFor(path), img); img.Opacity = 1; mono.Visibility = Visibility.Collapsed; } };
                }
                catch { }
            });
        }
        catch { }
    }

    /// <summary>The symbols of every service a title is on, overlapped a little, most four then "+n".</summary>
    private StackPanel MarkStack(IEnumerable<(string app, string name)> services, double size = 26)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = -size * 0.25 };
        var list = services.ToList();
        foreach (var (app, name) in list.Take(4)) row.Children.Add(ServiceMark(app, name, size));
        if (list.Count > 4) row.Children.Add(new Border { Height = size, Padding = new Thickness(8, 0, 6, 0), CornerRadius = new CornerRadius(size / 2), Background = HubChip, Margin = new Thickness(size * 0.35, 0, 0, 0), Child = new TextBlock { Text = "+" + (list.Count - 4), FontSize = 12, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center } });
        return row;
    }

    /// <summary>A card's picture; on more than one service it stands on a small stack of cards (one edge per extra service, at most two).</summary>
    private Grid StackedArt(string title, string? backdrop, string? poster, int services, double w = CardArtW, double h = CardArtH)
    {
        var extra = 0;   // no stack behind a title on several services: its service icons say so (2026-09-25, see StackBehind)
        var step = 5.0;
        var outer = new Grid { Width = w + extra * step, Height = h + extra * step };
        for (var i = extra; i >= 1; i--)
            outer.Children.Add(new Border { Width = w, Height = h, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(i * step, 0, 0, 0), CornerRadius = new CornerRadius(6), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, (byte)(0x2E + i * 10), (byte)(0x34 + i * 10), (byte)(0x3E + i * 10))), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x0F, 0x12, 0x16)), BorderThickness = new Thickness(1) });
        var art = new Grid { Width = w, Height = h, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, extra * step, 0, 0) };
        var hasArt = backdrop is { Length: > 0 } || poster is { Length: > 0 };   // a tall poster shows whole: the name behind it would show at its sides
        art.Children.Add(new Border { Background = HubCard, CornerRadius = new CornerRadius(6), Child = hasArt ? null : new TextBlock { Text = Shorten(title, 28), FontSize = 14, Foreground = HubDim, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, Margin = new Thickness(8) } });
        CardArt(art, backdrop, poster);
        outer.Children.Add(art);
        outer.Tag = art;
        return outer;
    }

    /// <summary>A card already built, stood on a small stack when its title is on more than one service (the Watch rows' own cards).</summary>
    private static FrameworkElement StackBehind(FrameworkElement card, int services)
    {
        // no stack any more (2026-09-25, "if the item is on more than 1 service, it puts a gray card behind the poster and makes it look like a
        // stack of movies ... we now have the icons for each service showing on the movie card so let's get rid of that stack visual effect")
        return card;
    }

    /// <summary>The first element of a type under a root, depth first (a row's own scroller, to keep its spot across a rebuild).</summary>
    private static T? FindChild<T>(DependencyObject root) where T : DependencyObject
    {
        var n = VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < n; i++)
        {
            var c = VisualTreeHelper.GetChild(root, i);
            if (c is T t) return t;
            if (FindChild<T>(c) is { } deeper) return deeper;
        }
        return null;
    }

    /// <summary>
    /// The body of the search results under the filter chips: the household's own titles, the top result, one card per work, the people.
    /// The layout and every word come from core (search-view.ts searchLayout, workCard, libraryLine; 2026-10-14, "tied ... so as changes
    /// are made they come to both"): the phone draws the same view, so a rule changed there is changed here.
    /// </summary>
    private void DrawSearchBody(JsonObject state, StackPanel results, string q, Grid overlay)
    {
        // the services unticked in the logo row are left out: a work or title on none of the ticked services goes, the rest keep only the ticked ones
        List<JsonObject> Keep(List<JsonObject> items) => _searchOff.Count == 0 ? items : items.Select(it =>
        {
            var sv = (it["services"] as JsonArray)?.OfType<JsonObject>().Where(x => !_searchOff.Contains(S(x, "app"))).Select(x => x.DeepClone()).ToList() ?? new();
            if (sv.Count == 0) return null;
            var c = (JsonObject)it.DeepClone(); c["services"] = new JsonArray(sv.ToArray()); return c;
        }).Where(x => x is not null).Select(x => x!).ToList();
        var library = Keep((state["library"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new());
        var works = Keep((state["works"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new());
        var people = (state["people"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        var layout = state["layout"] as JsonObject;

        // the words are a person's name: their face first, their work one press away (core's call)
        var personFirst = layout?["personFirst"]?.GetValue<bool>() == true;
        if (personFirst) DrawPeople();

        // the top result first (2026-10-14, "let's put the top result at the actual top of the results"): core names it by key (a service unticked in the logo
        // row may have taken it out of the works kept here, so the rest then stands alone); then the household's own titles, then the rest
        var topKey = S(layout, "top");
        var top = topKey.Length > 0 ? works.FirstOrDefault(w => S(w, "key") == topKey) : null;
        if (top is not null) results.Children.Add(TopResult(top));

        // the household's own titles, as they type - no service asked
        if (library.Count > 0)
        {
            results.Children.Add(new TextBlock { Text = S(layout, "libraryHeading").Length > 0 ? S(layout, "libraryHeading") : "In your lists", FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
            foreach (var h in library.Take(16)) if (LibraryCard(h) is { } b) row.Children.Add(b);
            results.Children.Add(Carousel(row));
        }

        if (works.Count == 0)
        {
            // why there is nothing: the filter's miss, nothing found, or no word yet while the services still look (core's words)
            if (S(layout, "empty").Length > 0) results.Children.Add(new TextBlock { Text = S(layout, "empty"), FontSize = 13, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
        }
        else
        {
            // one card per work, the top result (drawn above) left out
            var rest = top is null ? works : works.Where(w => !ReferenceEquals(w, top)).ToList();
            if (rest.Count > 0)
            {
                results.Children.Add(new TextBlock { Text = S(layout, "restHeading").Length > 0 ? S(layout, "restHeading") : "On your services", FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
                foreach (var w in rest.Take(40)) if (WorkCard(w) is { } b) row.Children.Add(b);
                results.Children.Add(Carousel(row));
            }
        }

        if (!personFirst) DrawPeople();
        void DrawPeople()
        {
        // 3. the people the words named: their work on the household's services is one press away
            if (people.Count > 0)
            {
                results.Children.Add(new TextBlock { Text = "People", FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
                foreach (var p in people)
                {
                    var name = S(p, "name"); var photo = p["photo"]?.GetValue<string>(); var known = S(p, "known");
                    var kf = (p["knownFor"] as JsonArray)?.OfType<JsonValue>().Select(v => v.GetValue<string>()).ToList() ?? new();
                    var pic = new Border { Width = 96, Height = 96, CornerRadius = new CornerRadius(48), Background = HubCard, HorizontalAlignment = HorizontalAlignment.Center, Child = new TextBlock { Text = Monogram(name), FontSize = 28, Foreground = HubDim, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } };
                    if (photo is { Length: > 0 }) { try { pic.Child = new Image { Source = new BitmapImage(Services.ArtCache.UriFor(photo)), Stretch = Stretch.UniformToFill }; } catch { } }
                    var cell = new StackPanel { Spacing = 4, Width = 128 };
                    cell.Children.Add(pic);
                    cell.Children.Add(new TextBlock { Text = name, FontSize = 13, Foreground = HubInk, TextAlignment = TextAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis });
                    if (known.Length > 0) cell.Children.Add(new TextBlock { Text = known, FontSize = 11, Foreground = HubDim, TextAlignment = TextAlignment.Center });
                    var b = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(4) };
                    ToolTipService.SetToolTip(b, name + (kf.Count > 0 ? ", known for " + string.Join(", ", kf) : "") + ".\nPress for their work on your services (TMDB).");
                    var (pid, pname) = (p["id"]?.GetValue<double>() ?? 0, name);
                    b.Click += (_, __) => { _hubPersonSearch?.Invoke(pid, pname); };
                    row.Children.Add(b);
                }
                results.Children.Add(Carousel(row));
            }
        }
    }

    /// <summary>Set by the search box: a person's work, searched in place of the words.</summary>
    private Action<double, string>? _hubPersonSearch;

    private Button? LibraryCard(JsonObject h)
    {
        var svcs = (h["services"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        if (svcs.Count == 0) return null;
        var title = S(h, "title"); var art = h["artwork"]?.GetValue<string>();
        var stack = StackedArt(title, null, art, svcs.Count);
        if (stack.Tag is Grid a) a.Children.Add(new Border { HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(6), Child = MarkStack(svcs.Select(s => (S(s, "app"), S(s, "name")))) });
        var cell = new StackPanel { Spacing = 4, Width = CardCellW };
        cell.Children.Add(stack);
        cell.Children.Add(MarqueeTitle(Shorten(title, 36), title, CardTitleSize, HubInk));
        var first = svcs[0];
        // the line and each service's Play words come from core (search-view.ts libraryLine): the phone's card says the same
        var plays = (h["plays"] as JsonArray)?.OfType<JsonValue>().Select(v => v.GetValue<string>()).ToList() ?? new List<string>();
        cell.Children.Add(new TextBlock { Text = S(h, "line"), FontSize = 11, Foreground = HubDim, TextTrimming = TextTrimming.CharacterEllipsis });
        var btn = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(4) };
        void PlayOn(JsonObject s)
        {
            var it = s["item"] as JsonObject; if (it is null) return;
            var (f, k, id, u, n) = (S(s, "facet"), S(it, "kind").Length > 0 ? S(it, "kind") : "title", S(it, "id").Length > 0 ? S(it, "id") : it["url"]?.GetValue<string>() ?? title, it["url"]?.GetValue<string>(), S(s, "name"));
            if (PickLeavesWatch(title)) { CloseVideoHub(); ShowStageCurtain(title, n, art); }
            _ = PlayOnAsync(f, k, id, u, title);
        }
        if (svcs.Count > 1)
        {
            var pick = new MenuFlyout { Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Bottom };
            for (var i = 0; i < svcs.Count; i++) { var s2 = svcs[i]; var it = new MenuFlyoutItem { Text = i < plays.Count ? plays[i] : "Play on " + S(s2, "name") }; it.Click += (_, __) => PlayOn(s2); pick.Items.Add(it); }
            btn.Click += (_, __) => pick.ShowAt(btn);
            ToolTipService.SetToolTip(btn, title + " is on " + string.Join(", ", svcs.Select(s => S(s, "name"))) + ". Press to choose.");
        }
        else { btn.Click += (_, __) => PlayOn(first); ToolTipService.SetToolTip(btn, "Plays " + title + " on " + S(first, "name") + "."); }
        btn.ContextFlyout = RatingFlyout(title, S(h, "kind"), app: S(first, "app"));
        return btn;
    }

    /// <summary>Core's words for a work's card (search-view.ts workCard): the line under the name, its colour, and "Play on X  ·  offer" per service.</summary>
    private static (string line, bool amber, List<string> services, List<string> plays) CardWords(JsonObject w)
    {
        var c = w["card"] as JsonObject;
        List<string> L(string k) => (c?[k] as JsonArray)?.OfType<JsonValue>().Select(v => v.GetValue<string>()).ToList() ?? new List<string>();
        return (S(c, "line"), c?["amber"]?.GetValue<bool>() == true, L("services"), L("plays"));
    }

    private void PlayWorkOn(JsonObject w, JsonObject s)
    {
        var c = s["candidate"] as JsonObject; if (c is null) return;
        var title = S(w, "title"); var service = S(s, "name");
        if (PickLeavesWatch(title)) { CloseVideoHub(); ShowStageCurtain(title, service, w["poster"]?.GetValue<string>()); }
        _ = PlayResultAsync(S(s, "app"), c.ToJsonString(), title, service);
    }

    private Button? WorkCard(JsonObject w)
    {
        var svcs = (w["services"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        if (svcs.Count == 0) return null;
        var title = S(w, "title"); var kind = S(w, "kind");
        var year = w["year"] is JsonValue yv && yv.TryGetValue<double>(out var yd) ? ((int)yd).ToString() : "";
        var stack = StackedArt(title, w["backdrop"]?.GetValue<string>(), w["poster"]?.GetValue<string>(), svcs.Count);
        if (stack.Tag is Grid a) a.Children.Add(new Border { HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(6), Child = MarkStack(svcs.Select(s => (S(s, "app"), S(s, "name")))) });
        var cell = new StackPanel { Spacing = 4, Width = CardCellW };
        cell.Children.Add(stack);
        cell.Children.Add(MarqueeTitle(Shorten(title, 36), title, CardTitleSize, HubInk));
        if (S(w, "rating") is { Length: > 0 } wr) cell.Children.Add(MakeRatingLine(wr, w["mine"] is JsonValue smv && smv.TryGetValue<double>(out var smd) ? smd : null, 11, HubDim).Root);   // TMDB's rating on every title (2026-09-24); the person's own as the star's share (2026-10-03)
        var (line, amber, svcWords, _) = CardWords(w);
        cell.Children.Add(new TextBlock { Text = line, FontSize = 11, Foreground = amber ? HubAmber : HubDim, TextTrimming = TextTrimming.CharacterEllipsis });
        var btn = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(4) };
        var overview = S(w, "overview");
        var lines = string.Join("\n", svcWords);
        ToolTipService.SetToolTip(btn, title + (year.Length > 0 ? " (" + year + ")" : "") + "\n" + lines + (overview.Length > 0 ? "\n\n" + Shorten(overview, 320) + "\n· TMDB" : "") + "\n\nPress for its details and where to watch.");
        // a press opens the title's Details (2026-09-23): the facts, the cast, and "Where to watch" - each of the household's services there plays it
        var app0 = S(svcs[0], "app");
        btn.Click += (_, __) => ShowTitleDetails(title, kind, app0, "Search results");
        var s0 = svcs[0]; var c0 = s0["candidate"] as JsonObject;
        var (lsApp, lsSvc, lsId, lsUrl) = (S(s0, "app"), S(s0, "name"), c0 is null ? "" : S(c0, "id"), c0?["url"]?.GetValue<string>());
        var wTmdb = svcs.Select(x => S(x["candidate"], "id")).FirstOrDefault(x => x.StartsWith("tmdb:", StringComparison.Ordinal)) is { Length: > 5 } wt ? wt.Substring(5) : null;   // same-named shows told apart (2026-09-27)
        int? wYear = int.TryParse(year, out var wy) ? wy : null;
        btn.ContextFlyout = lsId.Length > 0 ? RatingFlyout(title, kind, fly => AddListAddItemAsync(fly, lsApp, lsSvc, lsId, title, lsUrl, kind.Length > 0 ? kind : "title", "auto"), lsApp, wTmdb, wYear) : RatingFlyout(title, kind, app: lsApp);
        return btn;
    }

    /// <summary>The top result: TMDB's backdrop large, the facts, the overview, every service with its offer as a button, and Details.</summary>
    private FrameworkElement TopResult(JsonObject w)
    {
        var svcs = (w["services"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        var title = S(w, "title"); var kind = S(w, "kind");
        var grid = new Grid { Height = 250, MaxWidth = 1180, HorizontalAlignment = HorizontalAlignment.Left, CornerRadius = new CornerRadius(8), Background = HubCard };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(444) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var art = new Grid();
        CardArt(art, w["backdrop"]?.GetValue<string>(), w["poster"]?.GetValue<string>());
        grid.Children.Add(art);
        var side = new StackPanel { Spacing = 8, Margin = new Thickness(22, 18, 22, 18) };
        Grid.SetColumn(side, 1);
        side.Children.Add(new TextBlock { Text = "Top result", FontSize = 11, Foreground = HubAmber });
        side.Children.Add(new TextBlock { Text = title, FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, TextTrimming = TextTrimming.CharacterEllipsis });
        side.Children.Add(new TextBlock { Text = S(w["card"], "facts"), FontSize = 13, Foreground = HubDim });   // the year, the kind, three genres: core's words (workCard)
        if (S(w, "rating") is { Length: > 0 } tr) side.Children.Add(MakeRatingLine(tr, w["mine"] is JsonValue tmv && tmv.TryGetValue<double>(out var tmd) ? tmd : null, 13, HubDim).Root);
        var overview = S(w, "overview");
        if (overview.Length > 0) side.Children.Add(new TextBlock { Text = overview, FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxLines = 3, TextTrimming = TextTrimming.WordEllipsis });
        // the first service as a labeled Play, the rest as their square symbols, Details always in view at the end (2026-09-23, "I searched for
        // Community, it has >4 pills ... they've pushed the details button off the page. Use the smaller square logos")
        var acts = new Grid { ColumnSpacing = 10, Margin = new Thickness(0, 6, 0, 0) };
        acts.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        acts.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        acts.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var (_, _, _, plays) = CardWords(w);   // "Play on X  ·  offer" per service, core's words
        string PlayWords(int i) => i < plays.Count ? plays[i] : "Play on " + S(svcs[i], "name");
        if (svcs.Count > 0)
        {
            var s0 = svcs[0];
            var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            line.Children.Add(ServiceMark(S(s0, "app"), S(s0, "name"), 22));
            line.Children.Add(new TextBlock { Text = PlayWords(0), FontSize = 13, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center });
            var b0 = Chip(line, true);
            b0.Click += (_, __) => PlayWorkOn(w, s0);
            acts.Children.Add(b0);
        }
        var others = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        for (var i = 1; i < svcs.Count; i++)
        {
            var s = svcs[i];
            var mark = ServiceMark(S(s, "app"), S(s, "name"), 32);
            var mb = new Button { Content = mark, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(0) };
            ToolTipService.SetToolTip(mb, PlayWords(i));
            var s2 = s; mb.Click += (_, __) => PlayWorkOn(w, s2);
            others.Children.Add(mb);
        }
        var sc = new ScrollViewer { Content = others, HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled };
        Grid.SetColumn(sc, 1);
        acts.Children.Add(sc);
        var det = Chip(new TextBlock { Text = "Details", FontSize = 13, Foreground = HubInk }, false);
        var app0 = svcs.Count > 0 ? S(svcs[0], "app") : null;
        det.Click += (_, __) => ShowTitleDetails(title, kind, app0, "Search results");
        ShowOnlyWithTmdb(det);
        // My List on the services themselves (2026-09-23, "that box should have the option(s) to add to the list of the streaming service")
        var mine = Chip(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { new FontIcon { Glyph = "\uE710", FontSize = 12 }, new TextBlock { Text = "My List", FontSize = 13, Foreground = HubInk } } }, false);
        var mfly = new MenuFlyout();
        mfly.Opening += async (_, __) =>
        {
            mfly.Items.Clear();
            foreach (var sv in svcs) { var c = sv["candidate"] as JsonObject; await AddListAddItemAsync(mfly, S(sv, "app"), S(sv, "name"), c is null ? "" : S(c, "id"), title, c?["url"]?.GetValue<string>(), kind.Length > 0 ? kind : "title", "auto"); }
            if (mfly.Items.Count == 0) mfly.Items.Add(new MenuFlyoutItem { Text = "None of these services has a list Prism can add to", IsEnabled = false });
        };
        mine.Click += (_, __) => mfly.ShowAt(mine);
        ToolTipService.SetToolTip(mine, "Add " + title + " to a service's own list.");
        var ends = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        ends.Children.Add(mine); ends.Children.Add(det);
        Grid.SetColumn(ends, 2);
        acts.Children.Add(ends);
        side.Children.Add(acts);
        grid.Children.Add(side);
        return grid;
    }
}
