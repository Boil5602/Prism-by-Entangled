using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// The Episodes menu (2026-09-22, "a menu for episode selection ... ALL episodes and ALL seasons ... text plenty big so it would be readable
/// on a TV from a distance ... a star next to each currently active season and episode"): from the stage bar, a panel over the wall -
/// every season of the series on the screen as an accordion (the playing one open, starred), each episode a large row (the playing one
/// starred); choosing an episode opens it in place with its still, its synopsis and Play, which plays that episode on the service through
/// the pick's own path. The list is the service's own when its adapter can read it (Netflix: every season, every episode, its own ids),
/// else TMDB's, shown without Play.
/// </summary>
public sealed partial class MainWindow
{
    private Popup? _episodesPanel;
    private int _episodesRun;
    private const string Star = "\u2605";

    public void CloseEpisodes()
    {
        if (_episodesPanel is null) return;
        _episodesRun++;
        _episodesPanel.IsOpen = false;
        _episodesPanel = null;
        _ = FocusScreenAsync();   // the stage keys ride the page again
        RestartStageBarTimer();
    }

    /// <summary>The menu opens as a pop-up over the stage bar's Episodes button - the volume slider's way (2026-09-22, "I was hoping this would all be
    /// attached to a pop up menu. It looks a little too big"): the picture stays in view beside it; the bar stays up while it is open.</summary>
    public async Task ShowEpisodesAsync(Button anchor)
    {
        CloseEpisodes();
        var run = ++_episodesRun;
        var outer = new Grid();
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        outer.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var titles = new StackPanel { Spacing = 2 };
        var seriesTb = new TextBlock { Text = "Episodes", FontSize = 26, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        var sourceTb = new TextBlock { Text = "", FontSize = 15, Foreground = HubDim, TextWrapping = TextWrapping.Wrap };
        titles.Children.Add(seriesTb); titles.Children.Add(sourceTb);
        head.Children.Add(titles);
        var close = Chip(new TextBlock { Text = "Close", FontSize = 16, Foreground = HubInk }, false);
        ToolTipService.SetToolTip(close, "Close (Esc / Back)");
        close.Click += (_, __) => CloseEpisodes();
        close.VerticalAlignment = VerticalAlignment.Top;
        Grid.SetColumn(close, 1);
        head.Children.Add(close);
        outer.Children.Add(head);
        var body = new StackPanel { Spacing = 4, Margin = new Thickness(0, 14, 0, 0), XYFocusKeyboardNavigation = XYFocusKeyboardNavigationMode.Enabled };
        var scroll = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(0, 0, 12, 0) };
        Grid.SetRow(scroll, 1);
        outer.Children.Add(scroll);
        const double w = 760;
        var h = Math.Max(360, Math.Min(720, RootGrid.ActualHeight * 0.7));
        var card = new Border
        {
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF2, 0x12, 0x14, 0x1A)), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xFF, 0xFF, 0xFF)),
            BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(24, 18, 16, 18), Width = w, Height = h, Child = outer,
        };
        card.PreviewKeyDown += (_, e) => { if (e.Key is Windows.System.VirtualKey.Escape or Windows.System.VirtualKey.GoBack) { e.Handled = true; CloseEpisodes(); } };
        var at = anchor.TransformToVisual(RootGrid).TransformPoint(new Windows.Foundation.Point(0, 0));
        var x = Math.Max(8, Math.Min(RootGrid.ActualWidth - w - 8, at.X + anchor.ActualWidth / 2 - w / 2));
        var y = Math.Max(8, at.Y - h - 8);
        var popup = new Popup { XamlRoot = RootGrid.XamlRoot, HorizontalOffset = x, VerticalOffset = y, IsLightDismissEnabled = false, Child = card };
        _episodesPanel = popup;
        popup.IsOpen = true;
        RestartStageBarTimer();
        try { close.Focus(FocusState.Keyboard); } catch { }
        var status = new TextBlock { Text = "Reading the episodes\u2026", FontSize = 20, Foreground = HubInk };
        body.Children.Add(status);

        // the seasons as they arrive (2026-09-23, "load each season starting with #1 onto the screen as they become available"): each read
        // appends the seasons not yet drawn; what a person opened stays open; a list that changed under them is drawn again
        JsonObject? v = null;
        var st = new EpisodesDraw();
        var t0 = DateTime.UtcNow;
        while (run == _episodesRun && (DateTime.UtcNow - t0).TotalSeconds < 260)
        {
            try { v = JsonNode.Parse(await ModelCallAsync("videoEpisodes") ?? "null") as JsonObject; } catch { v = null; }
            if (run != _episodesRun) return;
            string S0(string k) => v?[k]?.GetValue<string>() ?? "";
            if (S0("series").Length > 0) seriesTb.Text = S0("series");
            if (S0("service").Length > 0) status.Text = "Reading every season from " + S0("service") + "\u2026";
            var ready = v?["ready"]?.GetValue<bool>() == true;
            var counts = (v?["seasons"] as JsonArray)?.OfType<JsonObject>().Select(x => (x["episodes"] as JsonArray)?.Count ?? 0).ToList() ?? new List<int>();
            if (counts.Count > 0 || ready)
            {
                var sig = string.Join(",", counts);
                if (st.Sig.Length > 0 && !(sig + ",").StartsWith(st.Sig + ",")) { body.Children.Clear(); st = new EpisodesDraw(); }   // not the same seasons: drawn again
                if (st.Drawn == 0) body.Children.Clear();
                st.Sig = sig;
                DrawEpisodes(body, sourceTb, v, st, ready);
            }
            if (ready) break;
            await Task.Delay(800);
        }
    }

    private sealed class EpisodesDraw
    {
        public int Drawn;
        public string Sig = "";
        public StackPanel? OpenSeason;
        public Border? OpenEpisode;
        /// <summary>A person opened or closed something: the list no longer opens the playing season for them.</summary>
        public bool Touched;
        public bool Focused;
        public TextBlock? More;
    }

    private void DrawEpisodes(StackPanel body, TextBlock sourceTb, JsonObject? v, EpisodesDraw st, bool ready)
    {
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        int I(JsonNode? n, string k) => (n as JsonObject)?[k] is JsonValue x && x.TryGetValue<int>(out var i) ? i : -1;
        var seasons = (v?["seasons"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var service = S(v, "service");
        var canPlay = v?["canPlay"]?.GetValue<bool>() == true;
        var cur = v?["current"] as JsonObject;
        int curSeason = I(cur, "season"), curEpisode = I(cur, "episode");
        if (st.More is not null) { body.Children.Remove(st.More); st.More = null; }
        if (seasons.Count == 0)
        {
            body.Children.Add(new TextBlock { Text = "No episodes to show.", FontSize = 20, Foreground = HubInk });
            var err = S(v, "error");
            if (err.Length > 0) body.Children.Add(new TextBlock { Text = char.ToUpper(err[0]) + err[1..] + ".", FontSize = 16, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
            return;
        }
        var total = seasons.Sum(s => (s["episodes"] as JsonArray)?.Count ?? 0);
        sourceTb.Text = seasons.Count + (seasons.Count == 1 ? " season" : " seasons") + "  \u00B7  " + total + " episodes  \u00B7  " + (S(v, "source") == "service" ? "as " + service + " lists them" : "as TMDB lists them") + (ready ? "" : "  \u00B7  reading more\u2026");
        if (!canPlay)
        {
            sourceTb.Foreground = HubAmber;
            sourceTb.Text += "  \u00B7  " + service + "'s adapter cannot play a chosen episode yet";
        }
        Button? focusFirst = null;
        foreach (var sn in seasons.Skip(st.Drawn))
        {
            var num = I(sn, "season");
            var eps = (sn["episodes"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
            var isCur = num == curSeason;
            var headRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };
            headRow.Children.Add(new TextBlock { Text = S(sn, "label"), FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = isCur ? HubAmber : HubInk, VerticalAlignment = VerticalAlignment.Center });
            if (isCur) headRow.Children.Add(new TextBlock { Text = Star, FontSize = 22, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center });
            headRow.Children.Add(new TextBlock { Text = eps.Count + (eps.Count == 1 ? " episode" : " episodes"), FontSize = 16, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center });
            var seasonBtn = new Button { Content = headRow, Background = HubCard, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(8), Padding = new Thickness(16, 10, 16, 10), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 8, 0, 0) };
            OwnHover(seasonBtn);   // its own hover, never the system's (memory: hover-loss-tooltips)
            var list = new StackPanel { Spacing = 4, Margin = new Thickness(18, 6, 0, 6), Visibility = Visibility.Collapsed };
            var built = false;
            void Build()
            {
                if (built) return; built = true;
                foreach (var ep in eps)
                {
                    var n = I(ep, "episode"); var isCurEp = isCur && n == curEpisode;
                    var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
                    row.Children.Add(new TextBlock { Text = n > 0 ? n.ToString() : "\u00B7", FontSize = 20, Foreground = HubDim, Width = 40, TextAlignment = TextAlignment.Right, VerticalAlignment = VerticalAlignment.Center });
                    row.Children.Add(new TextBlock { Text = S(ep, "title"), FontSize = 20, Foreground = isCurEp ? HubAmber : HubInk, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 470 });
                    if (isCurEp) row.Children.Add(new TextBlock { Text = Star + " playing", FontSize = 17, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center });
                    if (S(ep, "duration").Length > 0) row.Children.Add(new TextBlock { Text = S(ep, "duration"), FontSize = 16, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center });
                    var epBtn = new Button { Content = row, Background = HubClear, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(6), Padding = new Thickness(6, 7, 6, 7), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left };
                    var detail = EpisodeDetail(ep, service, canPlay, S(v, "series"), S(v, "playBy") == "number");
                    detail.Visibility = Visibility.Collapsed;
                    epBtn.Click += (_, __) =>
                    {
                        var opening = detail.Visibility != Visibility.Visible;
                        st.Touched = true;
                        if (st.OpenEpisode is not null && !ReferenceEquals(st.OpenEpisode, detail)) st.OpenEpisode.Visibility = Visibility.Collapsed;   // one open at a time
                        detail.Visibility = opening ? Visibility.Visible : Visibility.Collapsed;
                        st.OpenEpisode = opening ? detail : null;
                        if (opening) detail.StartBringIntoView(new BringIntoViewOptions { VerticalAlignmentRatio = 0.3, AnimationDesired = true });
                    };
                    list.Children.Add(epBtn);
                    list.Children.Add(detail);
                    if (isCurEp) focusFirst = epBtn;
                }
            }
            seasonBtn.Click += (_, __) =>
            {
                var opening = list.Visibility != Visibility.Visible;
                st.Touched = true;
                if (st.OpenSeason is not null && !ReferenceEquals(st.OpenSeason, list)) st.OpenSeason.Visibility = Visibility.Collapsed;   // the accordion: one season open
                if (opening) Build();
                list.Visibility = opening ? Visibility.Visible : Visibility.Collapsed;
                st.OpenSeason = opening ? list : null;
                if (opening) seasonBtn.StartBringIntoView(new BringIntoViewOptions { VerticalAlignmentRatio = 0.05, AnimationDesired = true });
            };
            body.Children.Add(seasonBtn);
            body.Children.Add(list);
            // the playing season opens by itself - when it arrives, unless the person has already opened something
            if (!st.Touched && (isCur || (curSeason < 0 && st.OpenSeason is null && ReferenceEquals(sn, seasons[0]))))
            {
                if (st.OpenSeason is not null && !ReferenceEquals(st.OpenSeason, list)) st.OpenSeason.Visibility = Visibility.Collapsed;
                Build(); list.Visibility = Visibility.Visible; st.OpenSeason = list; focusFirst ??= seasonBtn;
            }
        }
        st.Drawn = seasons.Count;
        if (!ready)
        {
            st.More = new TextBlock { Text = "Reading the next season from " + service + "\u2026", FontSize = 18, Foreground = HubDim, Margin = new Thickness(0, 12, 0, 0) };
            body.Children.Add(st.More);
        }
        var target = st.Focused || st.Touched ? null : focusFirst;
        if (target is not null) st.Focused = true;
        if (target is not null)
            DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () =>
            {
                try { target.Focus(FocusState.Keyboard); target.StartBringIntoView(new BringIntoViewOptions { VerticalAlignmentRatio = 0.35 }); } catch { }
            });
    }

    /// <summary>An episode opened in place: its still, its synopsis and Play (off, with the reason, when the list is TMDB's).</summary>
    private Border EpisodeDetail(JsonObject ep, string service, bool canPlay, string series, bool byNumber = false)
    {
        string S(string k) => ep[k]?.GetValue<string>() ?? "";
        var grid = new Grid { ColumnSpacing = 18 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var art = new Grid { Width = 256, Height = 144 };
        art.Children.Add(new Border { Background = HubCard, CornerRadius = new CornerRadius(8) });
        var still = S("still");
        if (still.Length > 0) { try { art.Children.Add(new Border { CornerRadius = new CornerRadius(8), Child = new Image { Source = new BitmapImage(Services.ArtCache.UriFor(still)), Stretch = Stretch.UniformToFill } }); } catch { } }
        grid.Children.Add(art);
        var col = new StackPanel { Spacing = 16, VerticalAlignment = VerticalAlignment.Top };
        var syn = S("synopsis");
        col.Children.Add(new TextBlock { Text = syn.Length > 0 ? syn : "No synopsis listed.", FontSize = 18, Foreground = syn.Length > 0 ? HubInk : HubDim, TextWrapping = TextWrapping.Wrap, LineHeight = 25 });
        var play = Chip(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Children = { new FontIcon { Glyph = "\uE768", FontSize = 18, Foreground = HubAmber }, new TextBlock { Text = "Play episode", FontSize = 18, Foreground = HubAmber } } }, true);
        play.Padding = new Thickness(18, 9, 18, 9);
        play.HorizontalAlignment = HorizontalAlignment.Left;
        var id = S("id");
        // by number (2026-09-23, Peacock): the list is TMDB's, without the service's ids - the service's own episode control is pressed instead
        var epSeason = ep["season"] is JsonValue sv2 && sv2.TryGetValue<int>(out var sn) ? sn : -1;
        var epNumber = ep["episode"] is JsonValue ev2 && ev2.TryGetValue<int>(out var en) ? en : -1;
        var numbered = byNumber && epSeason >= 0 && epNumber > 0;
        play.IsEnabled = canPlay && (id.Length > 0 || numbered);
        ToolTipService.SetToolTip(play, play.IsEnabled ? "Plays this episode on " + service + "." : ep["fromTmdb"]?.GetValue<bool>() == true ? service + "'s page didn't list this episode, so TMDB's listing fills in. It can't be played from here." : service + "'s adapter can't play a chosen episode yet. The list is TMDB's, without " + service + "'s own ids.");
        var title = S("title");
        play.Click += async (_, __) =>
        {
            CloseEpisodes();
            ShowStageCurtain(title, service, still.Length > 0 ? still : null);
            string? raw = null;
            try { raw = id.Length > 0 ? await ModelCallAsync("videoPlayEpisode", id) : await ModelCallAsync("videoPlayEpisodeNumber", epSeason.ToString(), epNumber.ToString()); } catch { }
            JsonObject? r = null;
            try { r = raw is null ? null : JsonNode.Parse(raw) as JsonObject; } catch { }
            if (r?["ok"]?.GetValue<bool>() == true) { SetPill("Prism \u00B7 " + Shorten(series.Length > 0 ? series + " \u00B7 " + title : title, 60) + " on " + service); return; }
            HideStageCurtain();
            SetPill("Prism \u00B7 could not play " + Shorten(title, 40) + ": " + (r?["error"]?.GetValue<string>() ?? "no answer"));
        };
        col.Children.Add(play);
        Grid.SetColumn(col, 1);
        grid.Children.Add(col);
        return new Border { Child = grid, Padding = new Thickness(46, 6, 6, 14) };
    }
}
