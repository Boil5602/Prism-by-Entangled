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
    private Border ServiceMark(string app, string name, double size = 26)
    {
        var mono = new TextBlock { Text = Monogram(name), FontSize = Math.Round(size * 0.42), FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var box = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(size * 0.22), Background = HubChip, BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0xC0, 0x0F, 0x12, 0x16)), BorderThickness = new Thickness(1.5), Child = mono };
        ToolTipService.SetToolTip(box, name);
        var entry = _catalog.FirstOrDefault(c => c.Id == (_model.App(app)?.CatalogRef ?? app)) ?? _catalog.FirstOrDefault(c => c.Adapter == app);
        if (entry is not null) _ = LoadMarkAsync(entry, box, mono);
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
    private async Task LoadMarkAsync(HostCatalogEntry entry, Border box, TextBlock mono)
    {
        try
        {
            var info = await _posters.GetMarkAsync(entry.Id, entry.Name, entry.Url);
            RootGrid.DispatcherQueue.TryEnqueue(() =>
            {
                if (info.BackgroundColor is { Length: 7 } bg && bg[0] == '#')
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
                    bmp.ImageOpened += (_, _) => { if (bmp.PixelWidth <= bmp.PixelHeight * 1.2) { img.Opacity = 1; mono.Visibility = Visibility.Collapsed; } };
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

    private static string KindWord(string kind) => kind switch { "movie" => "Movie", "series" => "Series", "episode" => "Episode", "live" => "Live", _ => "" };
    private static string FromWord(string from) => from switch { "continue" => "Continue Watching", "list" => "My List", "owned" => "Owned", _ => "" };

    /// <summary>The body of the search results under the filter chips: the household's own titles, the top result, one card per work, the people.</summary>
    private void DrawSearchBody(JsonObject state, StackPanel results, string q, Grid overlay, bool done, bool catalog, int searching, int all)
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
        var person = state["person"] as JsonObject;

        // the words are a person's name: their face first, their work one press away
        var personFirst = person is null && people.Count > 0 && string.Equals(Norm(S(people[0], "name")), Norm(q), StringComparison.Ordinal)
            && !(works.Count > 0 && works[0]["exact"]?.GetValue<bool>() == true);   // a title that IS the words stays first ("Firefly" the show, not a person of that name)
        static string Norm(string x) => new string(x.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
        if (personFirst) DrawPeople();

        // 1. the household's own titles, as they type - no service asked
        if (library.Count > 0)
        {
            results.Children.Add(new TextBlock { Text = "In your lists", FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
            foreach (var h in library.Take(16)) if (LibraryCard(h) is { } b) row.Children.Add(b);
            results.Children.Add(Carousel(row));
        }

        if (works.Count == 0)
        {
            if ((_lookupGenre is not null || _lookupApp is not null) && all > 0) { results.Children.Add(new TextBlock { Text = "None of the " + all + " results match the filter.", FontSize = 13, Foreground = HubDim, TextWrapping = TextWrapping.Wrap }); return; }
            if (done && searching == 0 && library.Count == 0)
            {
                var elsewhere = (state["elsewhere"] as JsonArray)?.OfType<JsonValue>().Select(v => v.GetValue<string>()).Where(x => x.Length > 0).ToList() ?? new List<string>();
                results.Children.Add(new TextBlock { Text = person is not null ? "TMDB lists none of " + S(person, "name") + "'s work on your services." : catalog ? (elsewhere.Count > 0 ? "Not on any of your services  ·  elsewhere on " + string.Join(", ", elsewhere) : "TMDB knows no title by that name on any of your services.") : "No service had it.", FontSize = 13, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
            }
        }
        else
        {
            // 2. the top result, when the words name it (or a person's best-known work)
            var top = works[0];
            var strong = person is not null || top["exact"]?.GetValue<bool>() == true || (top["score"] is JsonValue sv && sv.TryGetValue<double>(out var sc) && sc >= 90);
            if (strong) results.Children.Add(TopResult(top));
            var rest = strong ? works.Skip(1).ToList() : works;
            if (rest.Count > 0)
            {
                results.Children.Add(new TextBlock { Text = person is not null ? S(person, "name") + " on your services" : strong ? "More on your services" : "On your services", FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
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
        cell.Children.Add(new TextBlock { Text = FromWord(S(first, "from")) + " on " + S(first, "name") + (svcs.Count > 1 ? "  ·  +" + (svcs.Count - 1) + " more" : ""), FontSize = 11, Foreground = HubDim, TextTrimming = TextTrimming.CharacterEllipsis });
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
            foreach (var s in svcs) { var s2 = s; var it = new MenuFlyoutItem { Text = "Play on " + S(s, "name") + "  ·  " + FromWord(S(s, "from")) }; it.Click += (_, __) => PlayOn(s2); pick.Items.Add(it); }
            btn.Click += (_, __) => pick.ShowAt(btn);
            ToolTipService.SetToolTip(btn, title + " is on " + string.Join(", ", svcs.Select(s => S(s, "name"))) + ". Press to choose.");
        }
        else { btn.Click += (_, __) => PlayOn(first); ToolTipService.SetToolTip(btn, "Plays " + title + " on " + S(first, "name") + "."); }
        btn.ContextFlyout = RatingFlyout(title, S(h, "kind"), app: S(first, "app"));
        return btn;
    }

    private static string OfferLine(JsonObject s) { var o = S(s, "offer"); return o.Length == 0 ? "" : o.StartsWith("Sub", StringComparison.Ordinal) ? "Included" : o; }

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
        if (S(w, "rating") is { Length: > 0 } wr) cell.Children.Add(new TextBlock { Text = wr, FontSize = 11, Foreground = HubDim, TextTrimming = TextTrimming.CharacterEllipsis });   // TMDB's rating on every title (2026-09-24)
        var owned = w["owned"]?.GetValue<bool>() == true;
        var offer = owned ? "Owned" : svcs.Select(OfferLine).FirstOrDefault(o => o == "Included" || o.StartsWith("Free", StringComparison.Ordinal)) ?? OfferLine(svcs[0]);
        var via = S(w, "via");
        cell.Children.Add(new TextBlock { Text = string.Join("  ·  ", new[] { offer, year, KindWord(kind), via.Length > 0 ? "with " + via : "" }.Where(x => x.Length > 0)), FontSize = 11, Foreground = owned || offer == "Included" || offer.StartsWith("Free", StringComparison.Ordinal) ? HubDim : HubAmber, TextTrimming = TextTrimming.CharacterEllipsis });
        var btn = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(4) };
        var overview = S(w, "overview");
        var lines = string.Join("\n", svcs.Select(s => S(s, "name") + (OfferLine(s).Length > 0 ? ": " + OfferLine(s) : "")));
        ToolTipService.SetToolTip(btn, title + (year.Length > 0 ? " (" + year + ")" : "") + "\n" + lines + (overview.Length > 0 ? "\n\n" + Shorten(overview, 320) + "\n· TMDB" : "") + "\n\nPress for its details and where to watch.");
        // a press opens the title's Details (2026-09-23): the facts, the cast, and "Where to watch" - each of the household's services there plays it
        var app0 = S(svcs[0], "app");
        btn.Click += (_, __) => ShowTitleDetails(title, kind, app0, "Search results");
        var s0 = svcs[0]; var c0 = s0["candidate"] as JsonObject;
        var (lsApp, lsSvc, lsId, lsUrl) = (S(s0, "app"), S(s0, "name"), c0 is null ? "" : S(c0, "id"), c0?["url"]?.GetValue<string>());
        btn.ContextFlyout = lsId.Length > 0 ? RatingFlyout(title, kind, fly => AddListAddItemAsync(fly, lsApp, lsSvc, lsId, title, lsUrl, kind.Length > 0 ? kind : "title", "auto"), lsApp) : RatingFlyout(title, kind, app: lsApp);
        return btn;
    }

    /// <summary>The top result: TMDB's backdrop large, the facts, the overview, every service with its offer as a button, and Details.</summary>
    private FrameworkElement TopResult(JsonObject w)
    {
        var svcs = (w["services"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        var title = S(w, "title"); var kind = S(w, "kind");
        var year = w["year"] is JsonValue yv && yv.TryGetValue<double>(out var yd) ? ((int)yd).ToString() : "";
        var genres = (w["genres"] as JsonArray)?.OfType<JsonValue>().Select(v => v.GetValue<string>()).Take(3).ToList() ?? new();
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
        side.Children.Add(new TextBlock { Text = string.Join("  ·  ", new[] { year, KindWord(kind) }.Concat(genres).Where(x => x.Length > 0)), FontSize = 13, Foreground = HubDim });
        if (S(w, "rating") is { Length: > 0 } tr) side.Children.Add(new TextBlock { Text = tr, FontSize = 13, Foreground = HubDim });
        var overview = S(w, "overview");
        if (overview.Length > 0) side.Children.Add(new TextBlock { Text = overview, FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxLines = 3, TextTrimming = TextTrimming.WordEllipsis });
        // the first service as a labeled Play, the rest as their square symbols, Details always in view at the end (2026-09-23, "I searched for
        // Community, it has >4 pills ... they've pushed the details button off the page. Use the smaller square logos")
        var acts = new Grid { ColumnSpacing = 10, Margin = new Thickness(0, 6, 0, 0) };
        acts.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        acts.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        acts.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        string OfferOf(JsonObject s) => w["owned"]?.GetValue<bool>() == true && S(s, "offer") == "Owned" ? "Owned" : OfferLine(s);
        if (svcs.Count > 0)
        {
            var s0 = svcs[0];
            var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            line.Children.Add(ServiceMark(S(s0, "app"), S(s0, "name"), 22));
            line.Children.Add(new TextBlock { Text = "Play on " + S(s0, "name") + (OfferOf(s0).Length > 0 ? "  ·  " + OfferOf(s0) : ""), FontSize = 13, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center });
            var b0 = Chip(line, true);
            b0.Click += (_, __) => PlayWorkOn(w, s0);
            acts.Children.Add(b0);
        }
        var others = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        foreach (var s in svcs.Skip(1))
        {
            var mark = ServiceMark(S(s, "app"), S(s, "name"), 32);
            var mb = new Button { Content = mark, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(0) };
            ToolTipService.SetToolTip(mb, "Play on " + S(s, "name") + (OfferOf(s).Length > 0 ? "  ·  " + OfferOf(s) : ""));
            var s2 = s; mb.Click += (_, __) => PlayWorkOn(w, s2);
            others.Children.Add(mb);
        }
        var sc = new ScrollViewer { Content = others, HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled };
        Grid.SetColumn(sc, 1);
        acts.Children.Add(sc);
        var det = Chip(new TextBlock { Text = "Details", FontSize = 13, Foreground = HubInk }, false);
        var app0 = svcs.Count > 0 ? S(svcs[0], "app") : null;
        det.Click += (_, __) => ShowTitleDetails(title, kind, app0, "Search results");
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
