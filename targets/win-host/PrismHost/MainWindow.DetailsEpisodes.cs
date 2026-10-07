using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Episodes on a series' Details page (2026-09-24, "We need access to the episode selection from the details page as well. Show the current
/// episode on the details screen, with a play button, but also the episode selector lets them choose something else if needed"). The service
/// is the one the page was opened from, else the first of the household's services TMDB lists it on. The current episode comes from that
/// service's Continue watching entry; the list is core's (titleEpisodes, the same read as the player's Episodes menu), shown season by season as
/// it is read; a pick plays through core (titleEpisodePlay).
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>The service the Details page was opened from (a card's), or null.</summary>
    private string? _detailsApp;
    /// <summary>The Details page's services and TMDB id, for its Send to playlist menus (2026-09-27).</summary>
    private List<string> _detailsSendApps = new();
    private string? _detailsSendTmdb;
    private int? _detailsSendYear;
    private JsonObject EpisodesSource(string series, string app, string scope, int? season, int? episode, string poster)
    {
        var apps = new JsonArray(); foreach (var a in _detailsSendApps.Prepend(app).Distinct()) apps.Add(a);
        return new JsonObject { ["type"] = "series", ["show"] = series, ["app"] = app, ["services"] = apps, ["scope"] = scope, ["season"] = season, ["episode"] = episode, ["tmdb"] = _detailsSendTmdb, ["year"] = _detailsSendYear, ["poster"] = poster };
    }

    private FrameworkElement DetailsEpisodesSection(JsonObject d)
    {
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        var series = S(d, "title");
        var box = new StackPanel { Spacing = 10, Visibility = Visibility.Collapsed };
        if (series.Length == 0) return box;
        // the household services TMDB lists it on (a Where to watch logo with a play), the page's own service first
        var mine = new List<(string app, string name)>();
        if (d["providers"] is JsonObject prov)
            foreach (var key in new[] { "stream", "free", "rent", "buy" })
                if (prov[key] is JsonArray offers)
                    foreach (var o in offers.OfType<JsonObject>())
                        if (o["play"] is JsonObject pl && S(pl, "app") is { Length: > 0 } pa && mine.All(m => m.app != pa)) mine.Add((pa, S(pl, "name")));
        var app = _detailsApp is { Length: > 0 } da ? da : mine.FirstOrDefault().app;
        if (app is null or "") return box;
        var name = mine.FirstOrDefault(m => m.app == app).name;
        if (string.IsNullOrEmpty(name)) name = app;
        _detailsSendApps = mine.Select(m => m.app).ToList();
        _detailsSendTmdb = "tv:" + ((long)(d["id"]?.GetValue<double>() ?? 0)).ToString();
        _detailsSendYear = d["year"] is JsonValue dyv && dyv.TryGetValue<double>(out var dyd) ? (int)dyd : null;
        _ = FillDetailsEpisodesAsync(_detailsRun, box, app, name, series, S(d, "poster"));
        return box;
    }

    private async Task FillDetailsEpisodesAsync(int run, StackPanel box, string app, string service, string series, string poster)
    {
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        static string Norm(string t) => Regex.Replace(t.ToLowerInvariant(), "[^a-z0-9]+", " ").Trim();
        // the service's Continue watching entry for this series (Disney+ names the episode in the title: "Star Wars: Maul - Shadow Lord - Chapter 7")
        JsonObject? cw = null; string facet = "";
        try
        {
            var menu = JsonNode.Parse(await ModelCallAsync("videoMenu") ?? "null") as JsonObject;
            facet = (menu?["services"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(x => S(x, "app") == app) is { } sv ? S(sv, "facet") : "";
            var key = Norm(series);
            cw = (menu?["continue"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(c => S(c, "app") == app && (c["item"] is JsonObject it) && (Norm(S(it, "title")) == key || Norm(S(it, "title")).StartsWith(key + " ")));
        }
        catch { }
        if (run != _detailsRun) return;
        var item = cw?["item"] as JsonObject;
        int? season = null, episode = null;
        if (item is not null && Regex.Match(S(item, "subtitle"), @"\bS(\d+)\s*E(\d+)") is { Success: true } m) { season = int.Parse(m.Groups[1].Value); episode = int.Parse(m.Groups[2].Value); }

        box.Visibility = Visibility.Visible;
        box.Children.Add(SectionHead("Episodes on " + service));
        var current = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        box.Children.Add(current);
        var status = new TextBlock { Text = "Reading the episodes from " + service + (char)0x2026, FontSize = 14, Foreground = DetDim, VerticalAlignment = VerticalAlignment.Center };
        box.Children.Add(status);
        // the seasons as an accordion (2026-09-25, "Episode guide should collapse accordion style, defaulting to showing the first season unless the
        // user is actively watching then show current season"): a header per season, one open at a time
        var accordion = new StackPanel { Spacing = 6 };
        box.Children.Add(accordion);

        void Play(Func<Task> go, string what)
        {
            CloseTitleDetails();
            if (PickLeavesWatch(series)) { CloseVideoHub(); ShowStageCurtain(series, service, poster.Length > 0 ? poster : null); }
            _ = go();
            SetPill("Prism " + (char)0xB7 + " " + Shorten(what, 60) + " on " + service);
        }
        Button PlayChip(string label, string tip, Action click)
        {
            var b = new Button { Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { new FontIcon { Glyph = "\uE768", FontSize = 13, Foreground = DetInk }, new TextBlock { Text = label, FontSize = 14, Foreground = DetInk } } }, Background = DetChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(14), Padding = new Thickness(12, 6, 12, 6) };
            OwnHover(b);   // its own hover, never the system's (memory: hover-loss-tooltips)
            ToolTipService.SetToolTip(b, tip);
            b.Click += (_, __) => click();
            return b;
        }
        async Task PlayEpisode(int sn, int en, string title)
        {
            var raw = await ModelCallAsync("titleEpisodePlay", app, series, sn, en);
            if (raw is not null && JsonNode.Parse(raw) is JsonObject r && r["resolving"]?.GetValue<bool>() == true) _ = AfterResolveAsync(app);
        }
        void DrawCurrent(JsonObject? view)
        {
            current.Children.Clear();
            // what Continue watching knows: the episode, its title from the list when it is read, the time left
            var cur = view?["current"] as JsonObject;
            var cs = cur?["season"]?.GetValue<int>() ?? season; var ce = cur?["episode"]?.GetValue<int>() ?? episode;
            string? epTitle = null;
            if (cs is int s1 && ce is int e1 && view?["seasons"] is JsonArray ss)
                epTitle = ss.OfType<JsonObject>().FirstOrDefault(x => x["season"]?.GetValue<int>() == s1)?["episodes"] is JsonArray eps
                    ? S(eps.OfType<JsonObject>().FirstOrDefault(x => x["episode"]?.GetValue<int>() == e1), "title") : null;
            if (item is not null)
            {
                var sub = S(item, "subtitle");
                var what = (cs is int a && ce is int b ? "S" + a + " E" + b + (string.IsNullOrEmpty(epTitle) ? "" : " " + (char)0xB7 + " " + epTitle) : "Where you left off") + (Regex.Match(sub, @"\d+\s*(m|min|minutes?|hr)[^" + (char)0xB7 + @"]*left", RegexOptions.IgnoreCase) is { Success: true } left ? " " + (char)0xB7 + " " + left.Value.Trim() : "");
                current.Children.Add(new TextBlock { Text = "Continue watching", FontSize = 14, Foreground = DetAmber, VerticalAlignment = VerticalAlignment.Center });
                current.Children.Add(new TextBlock { Text = what, FontSize = 16, Foreground = DetInk, VerticalAlignment = VerticalAlignment.Center });
                var kind = S(item, "kind"); var id = S(item, "id"); var url = item["url"]?.GetValue<string>();
                current.Children.Add(PlayChip("Play", "Carry on where you left off, on " + service + ".", () => Play(() => PlayOnAsync(facet, kind.Length > 0 ? kind : "title", id, url, series), series)));
            }
            else if (view?["seasons"] is JsonArray ss2 && ss2.OfType<JsonObject>().FirstOrDefault()?["episodes"] is JsonArray firstEps && firstEps.OfType<JsonObject>().FirstOrDefault() is { } ep1)
            {
                var sn = ep1["season"]?.GetValue<int>() ?? 1; var en = ep1["episode"]?.GetValue<int>() ?? 1;
                current.Children.Add(new TextBlock { Text = "Start from the beginning", FontSize = 14, Foreground = DetAmber, VerticalAlignment = VerticalAlignment.Center });
                current.Children.Add(new TextBlock { Text = "S" + sn + " E" + en + " " + (char)0xB7 + " " + S(ep1, "title"), FontSize = 16, Foreground = DetInk, VerticalAlignment = VerticalAlignment.Center });
                current.Children.Add(PlayChip("Play", "Play the first episode on " + service + ".", () => Play(() => PlayEpisode(sn, en, S(ep1, "title")), series + " S" + sn + " E" + en)));
            }
        }
        var openSeason = -1;       // the season shown open, -1 none
        var userPicked = false;    // a person opened or closed one: the list's own choice no longer moves it
        JsonObject? lastView = null;
        void FillSeason(StackPanel into, int sn)
        {
            if (lastView?["seasons"] is not JsonArray ss) return;
            var seasonObj = ss.OfType<JsonObject>().FirstOrDefault(x => x["season"]?.GetValue<int>() == sn);
            if (seasonObj?["episodes"] is not JsonArray eps) return;
            var cur = lastView["current"] as JsonObject;
            var canPlay = lastView["canPlay"]?.GetValue<bool>() == true;
            foreach (var ep in eps.OfType<JsonObject>())
            {
                var en = ep["episode"]?.GetValue<int>() ?? 0; var title = S(ep, "title");
                var isCur = (cur?["season"]?.GetValue<int>() ?? season) == sn && (cur?["episode"]?.GetValue<int>() ?? episode) == en;
                var row = new Grid { ColumnSpacing = 14 };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(54) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.Children.Add(new TextBlock { Text = "E" + en, FontSize = 15, Foreground = isCur ? DetAmber : DetDim, VerticalAlignment = VerticalAlignment.Center });
                var text = new StackPanel { Spacing = 1 };
                text.Children.Add(new TextBlock { Text = title.Length > 0 ? title : "Episode " + en, FontSize = 15, Foreground = isCur ? DetAmber : DetInk, TextTrimming = TextTrimming.CharacterEllipsis });
                var facts = string.Join("  " + (char)0xB7 + "  ", new[] { isCur ? "where you left off" : "", S(ep, "duration"), S(ep, "airDate") }.Where(x => x.Length > 0));
                if (facts.Length > 0) text.Children.Add(new TextBlock { Text = facts, FontSize = 12, Foreground = DetDim });
                Grid.SetColumn(text, 1); row.Children.Add(text);
                var epTitle = title; var epNo = en;
                var fromTmdb = ep["fromTmdb"]?.GetValue<bool>() == true;   // listed by TMDB where the service's own list came back short (2026-09-25)
                var play = PlayChip("Play", canPlay && !fromTmdb ? "Play S" + sn + " E" + en + " on " + service + "." : fromTmdb ? service + "'s page didn't list this episode, so TMDB's listing fills in. Play opens " + series + " on " + service + "; pick it there." : "Opens " + series + " on " + service + ". Pick the episode there.", () => Play(() => PlayEpisode(sn, epNo, epTitle), series + " S" + sn + " E" + epNo));
                Grid.SetColumn(play, 2); row.Children.Add(play);
                // Send to playlist from the row (right click, or the remote's context key): the episode, or it and the rest of its season (2026-09-27)
                var (rsn, ren) = (sn, en);
                row.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
                if (_playlistsActive) row.ContextFlyout = SendToFlyout(("Send episode to", () => EpisodesSource(series, app, "episode", rsn, ren, poster)), ("Send this and the rest of the season to", () => EpisodesSource(series, app, "rest", rsn, ren, poster)));
                into.Children.Add(row);
            }
        }
        void DrawSeasons()
        {
            accordion.Children.Clear();
            if (lastView?["seasons"] is not JsonArray ss) return;
            var curSeason = (lastView["current"] as JsonObject)?["season"]?.GetValue<int>() ?? season;
            foreach (var so in ss.OfType<JsonObject>())
            {
                var sn = so["season"]?.GetValue<int>() ?? 0;
                var label = S(so, "label").Length > 0 ? S(so, "label") : "Season " + sn;
                var count = (so["episodes"] as JsonArray)?.Count ?? 0;
                var isOpen = sn == openSeason;
                var headRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
                headRow.Children.Add(new FontIcon { Glyph = isOpen ? "\uE70D" : "\uE76C", FontSize = 12, Foreground = DetInk, VerticalAlignment = VerticalAlignment.Center });
                headRow.Children.Add(new TextBlock { Text = label, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = DetInk, VerticalAlignment = VerticalAlignment.Center });
                headRow.Children.Add(new TextBlock { Text = count + (count == 1 ? " episode" : " episodes"), FontSize = 13, Foreground = DetDim, VerticalAlignment = VerticalAlignment.Center });
                if (item is not null && curSeason == sn) headRow.Children.Add(new TextBlock { Text = "where you left off", FontSize = 13, Foreground = DetAmber, VerticalAlignment = VerticalAlignment.Center });
                var head = new Button { Content = headRow, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Background = DetChip, BorderThickness = new Thickness(0), Padding = new Thickness(14, 10, 14, 10), CornerRadius = new CornerRadius(8) };
                OwnHover(head);   // its own hover, never the system's (memory: hover-loss-tooltips)
                ToolTipService.SetToolTip(head, isOpen ? "Close " + label : "Show the episodes of " + label);
                var n = sn;
                head.Click += (_, __) => { userPicked = true; openSeason = openSeason == n ? -1 : n; DrawSeasons(); };
                if (_playlistsActive) head.ContextFlyout = SendToFlyout(("Send season to", () => EpisodesSource(series, app, "season", n, null, poster)));   // 2026-09-27
                accordion.Children.Add(head);
                if (isOpen) { var body = new StackPanel { Spacing = 6, Margin = new Thickness(10, 4, 0, 10) }; FillSeason(body, sn); accordion.Children.Add(body); }
            }
        }
        // actively watching: the season you are in; otherwise the first
        int DefaultSeason(JsonObject v, List<JsonObject> seasons)
        {
            var cur = (v["current"] as JsonObject)?["season"]?.GetValue<int>() ?? (item is not null ? season : null);
            if (cur is int c && seasons.Any(x => x["season"]?.GetValue<int>() == c)) return c;
            return seasons.FirstOrDefault()?["season"]?.GetValue<int>() ?? -1;
        }

        DrawCurrent(null);
        var seasonsShown = 0;
        for (var i = 0; i < 200 && run == _detailsRun; i++)
        {
            JsonObject? v = null;
            try { v = JsonNode.Parse(await ModelCallAsync("titleEpisodes", app, series, item is null ? null : S(item, "id"), season, episode) ?? "null") as JsonObject; } catch { }
            if (run != _detailsRun) return;
            if (v is not null)
            {
                lastView = v;
                var seasons = (v["seasons"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
                if (seasons.Count != seasonsShown)
                {
                    seasonsShown = seasons.Count;
                    if (!userPicked) openSeason = DefaultSeason(v, seasons);
                    DrawSeasons();
                    DrawCurrent(v);
                }
                var ready = v["ready"]?.GetValue<bool>() != false;
                var err = S(v, "error");
                status.Text = !ready ? "Reading the episodes from " + service + (char)0x2026 + (seasons.Count > 0 ? " " + seasons.Count + " season" + (seasons.Count == 1 ? "" : "s") + " so far" : "")
                    : seasons.Count == 0 ? (err.Length > 0 ? "No episode list: " + err + "." : "No episode list.")
                    : S(v, "source") == "tmdb" ? "Episode list from TMDB. Play opens the series on " + service + "." : "";
                status.Visibility = status.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
                if (!userPicked && DefaultSeason(v, seasons) is var ds && ds != openSeason) { openSeason = ds; DrawSeasons(); }
                if (ready) { DrawCurrent(v); DrawSeasons(); return; }
            }
            await Task.Delay(1200);
        }
    }
}
