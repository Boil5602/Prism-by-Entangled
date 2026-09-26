using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The Binge (docs/features/the-binge.md, 2026-09-24): the Watch row's head opens the full view - one row per TMDB genre, Kids mode with
/// its age, genre links on the cards, Back to Watch. Core decides everything (binge.ts: eligibility, kids mode's ratings, the order); the
/// host draws what videoBingeView answers and passes the person's choices back (videoBingeSet / videoBingeHide / videoBingePlay).
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>The Watch tab shows The Binge in full instead of its rows (left by Back or another tab).</summary>
    private bool _bingeOpen;

    /// <summary>The row head's tooltip: the carousel's label, then the eligibility table at the current thresholds (kids mode is not listed
    /// here, by the spec), the episodic note and the attribution.</summary>
    private static string BingeTip(JsonObject lr)
    {
        string S(string k) => lr[k]?.GetValue<string>() ?? "";
        var t = lr["thresholds"] as JsonObject;
        string N(string k, string d) => t?[k] is JsonValue v && v.TryGetValue<double>(out var x) ? (k == "minRating" ? x.ToString("0.0") : x.ToString("0")) : d;
        var reading = lr["reading"] is JsonValue rv && rv.TryGetValue<int>(out var rn) && rn > 0;
        var date = S("dataDate") is { Length: > 0 } d0 ? d0 : "not read yet";
        var noAnim = lr["animation"] is JsonValue av && av.TryGetValue<bool>(out var ab) && !ab;
        return S("label") + (noAnim ? "\nAnimation left out (Include animation, on The Binge's full view)." : "") + (reading ? "  \u00B7  reading TMDB\u2026" : "")
            + "\n\nA series is in The Binge when all of these hold:"
            + "\n\u2022  Episode length \u2264 " + N("maxRuntime", "30") + " min  (TMDB runtime)"
            + "\n\u2022  Total episodes \u2265 " + N("minEpisodes", "80") + "  (TMDB)"
            + "\n\u2022  Episodic: scripted or animated, not a miniseries, no \"serialized\" keyword  (TMDB type + keywords)"
            + "\n\u2022  TMDB rating \u2265 " + N("minRating", "7.0") + " with \u2265 " + N("minVotes", "500") + " votes  (TMDB)"
            + "\n\u2022  Streaming on a service signed in on this device  (TMDB watch providers, JustWatch data)"
            + "\n\nThere's no reliable data on whether a show is episodic, so that check is a best guess. You can hide any title by right-clicking it."
            + "\n\n" + S("formula") + "\nData as of " + date + ".  Source: " + S("source") + "  \u00B7  " + S("sourceUrl")
            + "\n" + S("attribution")
            + "\n\nYou can change these in Watch settings, on The Binge tab. Click the title to see it by genre.";
    }

    /// <summary>The Binge's head on Watch opens the full view: a press on the name, or its own chip for the keyboard and the remote.</summary>
    private void BingeHeadOpens(StackPanel head)
    {
        head.Tapped += (_, __) => OpenBinge();
        var open = Chip(new TextBlock { Text = "By genre  \u2192", FontSize = 13, Foreground = HubAmber }, false);
        ToolTipService.SetToolTip(open, "The Binge in full: a row per genre, and Kids mode.");
        open.Click += (_, __) => OpenBinge();
        head.Children.Insert(1, open);
    }
    private void OpenBinge() { _bingeOpen = true; _ = ShowVideoHubAsync(); }

    /// <summary>The full view, drawn into its own panel (the page is up first; a Kids mode change redraws this panel only).</summary>
    private async Task DrawBingeAsync(StackPanel panel, Grid overlay, int pass = 0)
    {
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        JsonObject? v = null;
        try { v = JsonNode.Parse(await ModelCallAsync("videoBingeView") ?? "null") as JsonObject; } catch (Exception e) { LogLine("binge view: " + e.Message); }
        if (!ReferenceEquals(_videoHub, overlay) || _hubTab != "watch" || !_bingeOpen) return;
        var head = v?["head"] as JsonObject ?? new JsonObject();
        var kids = v?["kids"] as JsonObject;
        var kidsOn = kids?["on"]?.GetValue<bool>() == true;
        var age = S(kids, "age");
        var reading = v?["reading"] is JsonValue rv && rv.TryGetValue<int>(out var rn) && rn > 0;
        var built = new StackPanel { Spacing = 14 };

        // the header: Back, the name (its tooltip the eligibility table), Kids mode and its age
        var top = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
        var back = Chip(new TextBlock { Text = "\u2190  Watch", FontSize = 13, Foreground = HubAmber }, false);
        ToolTipService.SetToolTip(back, "Back to the Watch rows.");
        back.Click += (_, __) => { _bingeOpen = false; _ = ShowVideoHubAsync(); };
        top.Children.Add(back);
        var name = RowHead("The Binge" + (reading ? "  \u00B7  reading TMDB\u2026" : ""), HubInk);
        name.FontSize = 22;
        name.VerticalAlignment = VerticalAlignment.Center;
        ToolTipService.SetToolTip(name, BingeTip(head));
        top.Children.Add(name);
        var kidsBox = new CheckBox { Content = new TextBlock { Text = "Kids mode", FontSize = 14, Foreground = HubInk }, IsChecked = kidsOn, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(18, 0, 0, 0) };
        ToolTipService.SetToolTip(kidsBox, "Only the ratings the age allows, on this row and on Watch's; kept on this device.");
        top.Children.Add(kidsBox);
        var ages = (v?["ages"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var ageBox = new ComboBox { MinWidth = 260, VerticalAlignment = VerticalAlignment.Center, Visibility = kidsOn ? Visibility.Visible : Visibility.Collapsed };
        foreach (var a in ages)
        {
            var ratings = string.Join(", ", (a["ratings"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "") ?? Enumerable.Empty<string>());
            ageBox.Items.Add(new ComboBoxItem { Content = S(a, "label") + "  \u00B7  " + ratings, Tag = S(a, "id") });
        }
        ageBox.SelectedIndex = Math.Max(0, ages.FindIndex(a => S(a, "id") == age));
        top.Children.Add(ageBox);
        // Include animation (2026-09-24, "The binge is almost all animations"): TMDB's genre, the household's choice, kept on the device
        var animOn = v?["animation"]?.GetValue<bool>() != false;
        var animBox = new CheckBox { Content = new TextBlock { Text = "Include animation", FontSize = 14, Foreground = HubInk }, IsChecked = animOn, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(18, 0, 0, 0) };
        ToolTipService.SetToolTip(animBox, "Shows TMDB lists as Animation. This applies here and to the row on Watch, and it's saved on this device.");
        animBox.Click += async (_, __) =>
        {
            await ModelCallAsync("videoBingeSet", null, null, animBox.IsChecked == true);
            if (ReferenceEquals(_videoHub, overlay) && _bingeOpen) await DrawBingeAsync(panel, overlay);
        };
        top.Children.Add(animBox);
        built.Children.Add(top);
        var caveat = new TextBlock { Text = S(v, "caveat"), FontSize = 12, Foreground = HubDim, TextWrapping = TextWrapping.Wrap, Visibility = kidsOn ? Visibility.Visible : Visibility.Collapsed };
        built.Children.Add(caveat);
        var label = new TextBlock { Text = S(head, "label"), FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        ToolTipService.SetToolTip(label, BingeTip(head));
        built.Children.Add(label);
        built.Children.Add(new TextBlock { Text = S(head, "attribution"), FontSize = 12, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });

        async Task SetKids(bool on, string ageId)
        {
            await ModelCallAsync("videoBingeSet", null, new JsonObject { ["on"] = on, ["age"] = ageId }.ToJsonString());
            if (ReferenceEquals(_videoHub, overlay) && _bingeOpen) await DrawBingeAsync(panel, overlay);
        }
        string AgeNow() => (ageBox.SelectedItem as ComboBoxItem)?.Tag as string ?? age;
        kidsBox.Click += (_, __) => _ = SetKids(kidsBox.IsChecked == true, AgeNow());
        ageBox.SelectionChanged += (_, __) => { if (kidsBox.IsChecked == true && AgeNow() != age) _ = SetKids(true, AgeNow()); };

        // one row per genre; each card carries links to its other genres' rows
        var genres = (v?["genres"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var heads = new Dictionary<string, FrameworkElement>();
        var links = new List<(HyperlinkButton link, string genre)>();
        Button? first = null;
        if (genres.Count == 0)
            built.Children.Add(new TextBlock { Text = v?["tmdbKey"]?.GetValue<bool>() != true ? "The Binge reads TMDB under your own key: set one in Watch settings." : reading ? "Reading TMDB\u2026" : kidsOn ? "Nothing eligible at this age on your services." : "Nothing eligible on your services at these thresholds.", FontSize = 13, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
        foreach (var g in genres)
        {
            var genre = S(g, "genre");
            var cards = (g["cards"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
            var gh = RowHead(genre + "  \u00B7  " + cards.Count, HubInk);
            heads[genre] = gh;
            built.Children.Add(gh);
            var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
            foreach (var c in cards)
            {
                var btn = BrowseCardButton(c, true);
                if (btn is null) continue;
                first ??= btn;
                var cell = new StackPanel { Spacing = 2 };
                cell.Children.Add(btn);
                var others = (c["genres"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0 && x != genre).ToList() ?? new List<string>();
                if (others.Count > 0)
                {
                    var gl = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, Margin = new Thickness(4, 0, 0, 0) };
                    foreach (var o in others.Take(3))
                    {
                        var hl = new HyperlinkButton { Content = new TextBlock { Text = o, FontSize = 11, Foreground = HubAmber }, Padding = new Thickness(4, 0, 4, 0) };
                        ToolTipService.SetToolTip(hl, "To the " + o + " row.");
                        links.Add((hl, o));
                        gl.Children.Add(hl);
                    }
                    cell.Children.Add(gl);
                }
                line.Children.Add(cell);
            }
            built.Children.Add(Carousel(line));
        }
        foreach (var (link, g) in links)
        {
            if (heads.TryGetValue(g, out var target)) link.Click += (_, __) => target.StartBringIntoView(new BringIntoViewOptions { VerticalAlignmentRatio = 0, AnimationDesired = true });
            else link.Visibility = Visibility.Collapsed;   // that genre's row is empty here (hidden)
        }

        if (!ReferenceEquals(_videoHub, overlay) || _hubTab != "watch" || !_bingeOpen) return;
        var wasEmpty = panel.Children.Count == 0;
        panel.Children.Clear();
        while (built.Children.Count > 0) { var child = built.Children[0]; built.Children.RemoveAt(0); panel.Children.Add(child); }
        if (first is not null && wasEmpty) { _hubCur = first; try { first.Focus(FocusState.Keyboard); } catch { } }
        // still reading: drawn again as the details come in, never under the person's focus
        if (reading && pass < 60)
        {
            await Task.Delay(2500);
            if (ReferenceEquals(_videoHub, overlay) && _bingeOpen && !FocusWithin(panel)) await DrawBingeAsync(panel, overlay, pass + 1);
            else if (ReferenceEquals(_videoHub, overlay) && _bingeOpen) { await Task.Delay(2500); await DrawBingeAsync(panel, overlay, pass + 1); }
        }
    }

    /// <summary>A Binge card's right-click menu carries Hide (the spec: any title can be hidden); kept on this device.</summary>
    private void BingeHideItem(MenuFlyout fly, string cardId, string title)
    {
        var hide = new MenuFlyoutItem { Text = "Hide from The Binge", Icon = new FontIcon { Glyph = "\uED1A" } };
        ToolTipService.SetToolTip(hide, "Not shown in The Binge on this device again.");
        hide.Click += async (_, __) =>
        {
            await ModelCallAsync("videoBingeHide", cardId, true, title);
            SetPill("Prism \u00B7 " + Shorten(title, 40) + " hidden from The Binge");
            _ = ShowVideoHubAsync();
        };
        fly.Items.Add(hide);
    }

    /// <summary>Watch settings, The Binge: its thresholds (the spec's defaults until changed), kept on this device; Kids mode lives on the
    /// full view's header.</summary>
    private Func<Task<List<string>>> BuildBingeTab(StackPanel body)
    {
        var intro = new TextBlock { Text = "A series is in The Binge when all of these hold. Series on none of your signed-in services are never shown.", FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) };
        body.Children.Add(intro);
        var boxes = new List<(string key, NumberBox box)>();
        void Field(string key, string label, string tip, double min, double max, double step, double def)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
            var nb = new NumberBox { Minimum = min, Maximum = max, SmallChange = step, Value = def, Width = 140, SpinButtonPlacementMode = NumberBoxSpinButtonPlacementMode.Inline };
            var tb = new TextBlock { Text = label, FontSize = 14, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center, Width = 260 };
            ToolTipService.SetToolTip(tb, tip);
            row.Children.Add(tb); row.Children.Add(nb);
            body.Children.Add(row);
            boxes.Add((key, nb));
        }
        Field("maxRuntime", "Longest episode (minutes)", "TMDB's episode runtime; default 30.", 5, 120, 5, 30);
        Field("minEpisodes", "Fewest episodes", "TMDB's episode count; default 80.", 1, 2000, 10, 80);
        Field("minRating", "Lowest TMDB rating", "TMDB members' mean vote, one to ten; default 7.0.", 0, 10, 0.1, 7.0);
        Field("minVotes", "Fewest TMDB votes", "How many TMDB members voted; default 500.", 0, 100000, 100, 500);
        body.Children.Add(new TextBlock { Text = "The episodic check (scripted or animated, not a miniseries, not tagged \"serialized\") is a best guess, since there's no reliable data on it. You can hide any title from its right-click menu.", FontSize = 12, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
        var loaded = new Dictionary<string, double>();
        _ = ((Func<Task>)(async () =>
        {
            JsonObject? t = null;
            try { t = (JsonNode.Parse(await ModelCallAsync("videoBingeView") ?? "null") as JsonObject)?["head"]?["thresholds"] as JsonObject; } catch { }
            foreach (var (key, box) in boxes)
                if (t?[key] is JsonValue jv && jv.TryGetValue<double>(out var d)) { box.Value = d; loaded[key] = d; }
        }))();
        return async () =>
        {
            var o = new JsonObject();
            foreach (var (key, box) in boxes)
                if (!double.IsNaN(box.Value) && (!loaded.TryGetValue(key, out var was) || Math.Abs(was - box.Value) > 1e-9)) o[key] = box.Value;
            if (o.Count == 0) return new List<string>();
            await ModelCallAsync("videoBingeSet", o.ToJsonString(), null);
            if (VideoHubOpen) _ = ShowVideoHubAsync();
            return new List<string> { "The Binge's thresholds saved" };
        };
    }

    /// <summary>Watch settings, Hidden titles (2026-09-24, "I wouldn't mind that info on a tab in settings, scrollable"): what The Binge
    /// leaves out on this device and why, newest first; Show again acts at once.</summary>
    private Func<Task<List<string>>> BuildHiddenTab(StackPanel body)
    {
        body.Children.Add(new TextBlock { Text = "Titles The Binge leaves out on this device. Show again puts a title back at once.", FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) });
        var list = new StackPanel { Spacing = 10 };
        var scroller = new ScrollViewer { Content = list, MaxHeight = 440, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Padding = new Thickness(0, 0, 14, 0) };
        body.Children.Add(scroller);
        var shown = new List<string>();
        string When(double ms) => DateTimeOffset.FromUnixTimeMilliseconds((long)ms).ToLocalTime().ToString("MMM d, h:mm tt");
        _ = ((Func<Task>)(async () =>
        {
            JsonObject? r = null;
            try { r = JsonNode.Parse(await ModelCallAsync("videoBingeHidden") ?? "null") as JsonObject; } catch { }
            var items = (r?["items"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
            if (items.Count == 0) { list.Children.Add(new TextBlock { Text = "Nothing is hidden. Right-click a card in The Binge to hide it.", FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap }); return; }
            foreach (var it in items)
            {
                string S(string k) => it[k]?.GetValue<string>() ?? "";
                double N(string k) => it[k] is JsonValue v && v.TryGetValue<double>(out var d) ? d : 0;
                var id = S("id"); var title = S("title");
                var row = new Grid { ColumnSpacing = 12 };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var text = new StackPanel { Spacing = 2 };
                text.Children.Add(new TextBlock { Text = title, FontSize = 14, Foreground = HubInk, TextTrimming = TextTrimming.CharacterEllipsis });
                var why = S("why") == "missing"
                    ? (S("service") is { Length: > 0 } sv ? sv : "The service") + " couldn't find it when you pressed it on " + When(N("at")) + ". It comes back " + When(N("until")) + "."
                    : "You hid it on " + When(N("at"));
                text.Children.Add(new TextBlock { Text = why, FontSize = 12, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
                row.Children.Add(text);
                var again = Chip(new TextBlock { Text = "Show again", FontSize = 13, Foreground = HubAmber }, false);
                ToolTipService.SetToolTip(again, "Back in The Binge on this device.");
                again.Click += async (_, __) =>
                {
                    await ModelCallAsync("videoBingeHide", id, false);
                    list.Children.Remove(row);
                    shown.Add(title);
                    if (list.Children.Count == 0) list.Children.Add(new TextBlock { Text = "Nothing is hidden.", FontSize = 13, Foreground = HubInk });
                    if (VideoHubOpen) _ = ShowVideoHubAsync();
                };
                Grid.SetColumn(again, 1);
                row.Children.Add(again);
                list.Children.Add(row);
            }
        }))();
        return () => Task.FromResult(shown.Count > 0 ? new List<string> { shown.Count + " shown again in The Binge" } : new List<string>());
    }
}
