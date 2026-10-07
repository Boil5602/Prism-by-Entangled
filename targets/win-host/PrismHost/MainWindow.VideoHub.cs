using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Media.Animation;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// The universal video menu (docs/video-menu-spec.md, Phase 2, 2026-09-19), drawn over the video slot as the Video
/// player's own page. The five rows of §2, in order: Continue Watching and My List merged across services and ordered by
/// §4 in core (menu-order.ts - a pure function of the services' rows, the local watch log, the first-seen record and
/// now; the host draws, it never orders); Live Now for live-capable services; Services (the catalog posters - every
/// service, so nothing is unreachable); Search (chips that open a service's own search with the words in place). Each
/// service's own rows ("Netflix suggests…") are OFF by default (the transparency rule) and labeled by source when on.
///
/// Cards carry the title, the poster as the service served it, a service glyph, progress when the service gives one,
/// and the one time a card ever shows: the log's own ("3 days ago · Netflix"); an unknown recency shows nothing. A card
/// (Lenses and ratings, §4a, 2026-09-20: a Lens strip over the rows - no lens by default, "Your own order" - each lens laying its
/// own source's numbers over the rows and saying, on itself, what is counted, who is counted, who decides, its source, its
/// formula and its data date; TMDB ratings on cards only as "★ 7.8 · TMDB · 14k votes", a right-click opening the disclosure
/// and outbound IMDb / Letterboxd links; the person's own TMDB key entered here and kept on the device.)
/// (Search everywhere, 2026-09-19: the words go to every signed-in service at once on hidden surfaces - core's videoLookup -
/// and the answers fill ONE row here as they come, each card badged with its service; core orders the row by its pure
/// rule, the host draws it as given. A service that cannot answer says why on the status line.)
/// is one press through the EXISTING play path (videoPlayOn: the screen switches to that service when needed and plays
/// once its page is up). 10-foot first: every card and chip is a Button, and the page turns on XY focus navigation, so a
/// d-pad or the arrow keys walk the rows; Enter presses; Esc, Back or the close corner leaves.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _videoHub;
    /// <summary>The item the arrow walk stands on (the focused one, or the last it moved to when the window holds no focus).</summary>
    private Control? _hubCur;
    /// <summary>The lines under each card that the sources fill in as they answer (the lens's number, the rating), by card - updated in
    /// place while reads are pending; the page is never rebuilt under a person ("it refreshes and takes me back to the start of the
    /// my list line", 2026-09-21).</summary>
    private readonly Dictionary<string, List<(TextBlock lens, RatingLineUi rating)>> _hubLines = new();
    private TextBlock? _hubLensHead;
    /// <summary>Lens rows drawn while their sources were still reading: the head and the panel the cards go into once they arrive (filled in place, never rebuilt under a person).</summary>
    private readonly Dictionary<string, (TextBlock head, StackPanel host, string name, TextBlock disclosure)> _hubLensPending = new();
    /// <summary>A catalog lens row's head: its name, how many titles it holds, and while its lists are read, how many candidates are weighed.</summary>
    /// <summary>A catalog lens row's short name on Watch (2026-09-24, "let's just make a concise title for that grouping and add all the
    /// details under a tooltip"); the full name, the count, the reading and the disclosure are the head's tooltip (CatalogLensTip).</summary>
    private static string CatalogLensShort(JsonObject lr) => (lr["id"]?.GetValue<string>() ?? "") switch
    {
        "wiki-reads" => "Most read about this week",
        "fresh-episodes" => "New episodes, last 10 days",
        "fresh-movies" => "New movies, last 30 days",
        "the-binge" => "The Binge",
        var _ => lr["name"]?.GetValue<string>() ?? "",
    };
    private static string CatalogLensTip(JsonObject lr)
    {
        if ((lr["id"]?.GetValue<string>() ?? "") == "the-binge") return BingeTip(lr);   // the eligibility table (2026-09-24)
        string S(string k) => lr[k]?.GetValue<string>() ?? "";
        var date = S("dataDate") is { Length: > 0 } d ? d : "not read yet";
        return CatalogLensHead(lr) + "\n\n" + LensDisclosureLine(lr, date)
            + "\n\nWhat is counted: " + S("counted") + "\nWho is counted: " + S("who") + "\nWho decides: " + S("decides") + "\nSource: " + S("source") + "  \u00B7  " + S("sourceUrl");
    }
    private static string CatalogLensHead(JsonObject lr)
    {
        var name = lr["name"]?.GetValue<string>() ?? "";
        var total = lr["total"] is JsonValue tv && tv.TryGetValue<int>(out var tn) ? tn : 0;
        var weighed = lr["weighed"] is JsonValue wv && wv.TryGetValue<int>(out var wn) ? wn : 0;
        var reading = lr["reading"] is JsonValue rv && rv.TryGetValue<int>(out var rn) && rn > 0;
        var wiki = (lr["id"]?.GetValue<string>() ?? "") == "wiki-reads";
        return name + (total > 0 ? "  \u00B7  " + total + " on your services" : "") + (reading ? (wiki ? "  \u00B7  reading Wikipedia's lists, " + weighed + " weighed\u2026" : "  \u00B7  reading TMDB\u2026") : "");
    }
    /// <summary>"Oldest to Newest" beside a fresh row's head: each word jumps the row's carousel to that end (the row is found when
    /// pressed - the follow may have replaced it).</summary>
    private FrameworkElement FreshEnds(StackPanel rowHost)
    {
        var line = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        HyperlinkButton End(string word, bool right)
        {
            var b = new HyperlinkButton { Content = new TextBlock { Text = word, FontSize = 13, Foreground = HubAmber }, Padding = new Thickness(4, 0, 4, 0) };
            ToolTipService.SetToolTip(b, right ? "To the newest, at the right end of the row." : "To the oldest, at the left end of the row.");
            b.Click += (_, __) => { if (FindChild<ScrollViewer>(rowHost) is { } sv) sv.ChangeView(right ? sv.ScrollableWidth : 0, null, null, false); };
            return b;
        }
        line.Children.Add(End("Oldest", false));
        line.Children.Add(new TextBlock { Text = "to", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
        line.Children.Add(End("Newest", true));
        return line;
    }
    /// <summary>Keyboard focus is on something inside this element (a row is never rebuilt under a person).</summary>
    private bool FocusWithin(DependencyObject host)
    {
        try
        {
            if (RootGrid.XamlRoot is null) return false;
            for (var d = FocusManager.GetFocusedElement(RootGrid.XamlRoot) as DependencyObject; d is not null; d = VisualTreeHelper.GetParent(d)) if (ReferenceEquals(d, host)) return true;
        }
        catch { }
        return false;
    }
    private static string LensDisclosureLine(JsonObject lr, string date) { string S(string k) => lr[k]?.GetValue<string>() ?? ""; return S("formula").Replace("{date}", date) + "  ·  " + S("source") + "  ·  data date " + date; }
    /// <summary>Dev hook (hub.request "search <words>"): the open menu's Search everywhere with these words.</summary>
    private Action<string>? _hubSearch;
    /// <summary>§4a: the TMDB key entry row is open (a person pressed "TMDB key…"); not the key itself, which lives in core's store.</summary>
    private bool _hubKeyEntry;
    /// <summary>The Watch page's tab: "watch" (the rows as ever) or "library" (what the person owns, by genre - 2026-09-22).</summary>
    private string _hubTab = "watch";
    /// <summary>The Browse tab's genre (2026-09-22); null = the one core remembers.</summary>
    private string? _browseGenre;
    /// <summary>The Browse tab's offer filter (2026-09-22): included | any; null = the one core remembers (Included by default).</summary>
    private string? _browseOffer;
    /// <summary>A Browse row opened in full (2026-09-22): its id, and how many of its cards have been asked for; null = the rows themselves.</summary>
    private string? _browseRow;
    private int _browseWant = BrowseWantStep;
    private const int BrowseWantStep = 60;
    /// <summary>The Library tab's sort (2026-09-22): own (A to Z) | newest | oldest | rated - core keeps the choice on the device and orders; the host only asks.</summary>
    private string? _hubSort;
    /// <summary>The search's filter (2026-09-22): a genre as TMDB names it, a service's App id; null = all. Reset with each new search.</summary>
    private string? _lookupGenre, _lookupApp;
    /// <summary>The Library tab's grouping (2026-09-23): "genre" (a row per genre, the default) or "none" (every title in one list).</summary>
    private string _hubGroup = "genre";
    /// <summary>Bumped when the search is cleared (2026-09-23, "When I clear the search or click away from it, the search items remain at the top of
    /// the screen"): a search still arriving stops drawing.</summary>
    private int _hubSearchGen;
    /// <summary>The services unticked in the search's logo row (2026-09-23): left out of every section of the results; kept for the session.</summary>
    private readonly HashSet<string> _searchOff = new();
    /// <summary>Draws the last results again (a tick changed).</summary>
    private Action? _redrawSearch;
    // in the TILE CANVAS since 2026-09-21 (the corner): above every tile (900), beneath the surface shown in the corner (910) -
    // so the player there is truly on top and its own controls take a press. RootGrid's own overlays (the curtain 925, the
    // pill 950, the grips and the stage bar 1000) stay above the whole canvas as before.
    private const int VideoHubZ = 905;
    private SizeChangedEventHandler? _hubCanvasSize;
    private static readonly SolidColorBrush HubInk = new(Windows.UI.Color.FromArgb(255, 0xE8, 0xEC, 0xF2));
    private static readonly SolidColorBrush HubDim = new(Windows.UI.Color.FromArgb(255, 0x8A, 0x93, 0xA2));
    private static readonly SolidColorBrush HubAmber = new(Windows.UI.Color.FromArgb(255, 0xF2, 0xB1, 0x4C));
    private static readonly SolidColorBrush HubCard = new(Windows.UI.Color.FromArgb(255, 0x22, 0x27, 0x30));
    private static readonly SolidColorBrush HubChip = new(Windows.UI.Color.FromArgb(255, 0x1C, 0x21, 0x29));
    private static readonly SolidColorBrush HubChipOn = new(Windows.UI.Color.FromArgb(255, 0x3A, 0x2E, 0x14));
    private static readonly SolidColorBrush HubClear = new(Windows.UI.Color.FromArgb(0, 0, 0, 0));
    private static readonly SolidColorBrush HubTabRule = new(Windows.UI.Color.FromArgb(0x5A, 0xE8, 0xEC, 0xF2));   // the tab strip's rule and the open tab's edge (2026-10-03)
    private static readonly SolidColorBrush HubRule = new(Windows.UI.Color.FromArgb(28, 0xE8, 0xEC, 0xF2));   // a faint grid line on the dark surface
    /// <summary>A pill's hover and press: its own colour lit, never the system's grey (Chip).</summary>
    private static readonly SolidColorBrush HubChipHover = new(Windows.UI.Color.FromArgb(255, 0x2C, 0x34, 0x42));
    private static readonly SolidColorBrush HubChipPressed = new(Windows.UI.Color.FromArgb(255, 0x24, 0x2A, 0x35));
    private static readonly SolidColorBrush HubChipOnHover = new(Windows.UI.Color.FromArgb(255, 0x55, 0x43, 0x1C));
    private static readonly SolidColorBrush HubChipOnPressed = new(Windows.UI.Color.FromArgb(255, 0x47, 0x38, 0x17));
    /// <summary>The transparency rule: each service's own rows are shown only when the household turned them on.</summary>
    private const string SuggestionsPref = "video.menu.suggestions";

    public bool VideoHubOpen => _videoHub is not null;

    // ---------------------------------------------------------------- the stage curtain (2026-09-21)
    private int _curtainRun;
    /// <summary>The wall's own face over a pick: artwork, title, "Starting on …"; the service's pages load beneath, unseen. Lifted when the
    /// player is on the stage, or on the page's error (said here, with Retry), a timeout, Esc, or a tap.</summary>
    public void ShowStageCurtain(string title, string service, string? artwork)
    {
        var run = ++_curtainRun;
        CurtainBody.Children.Clear();
        CurtainArt.Source = null;
        if (artwork is { Length: > 0 }) { try { CurtainArt.Source = new BitmapImage(Services.ArtCache.UriFor(artwork)); } catch { } }
        CurtainBody.Children.Add(new TextBlock { Text = title, FontSize = 34, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center });
        var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center };
        line.Children.Add(new ProgressRing { IsActive = true, Width = 22, Height = 22, Foreground = HubAmber });
        var status = new TextBlock { Text = "Starting on " + service + "\u2026", FontSize = 16, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center };
        line.Children.Add(status);
        CurtainBody.Children.Add(line);
        var verbs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center, Visibility = Visibility.Collapsed };
        CurtainBody.Children.Add(verbs);
        // two ways out while it starts (2026-09-25, "Instead of Cancel and return to watch, while a video is starting, lets just make it a Cancel OR
        // return to watch, 2 buttons"): Cancel stops the start and leaves you on the screen; Return to Watch lets it go on starting behind Watch,
        // whose corner shows it as it comes up
        var outs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 18, 0, 0) };
        var cancel = Chip(new TextBlock { Text = "Cancel", FontSize = 15, Foreground = HubInk }, false);
        ToolTipService.SetToolTip(cancel, "Stops starting " + title + ". If the service had already begun, it is paused.");
        cancel.Click += (_, __) => { status.Text = "Cancelling\u2026"; cancel.IsEnabled = false; _ = CancelPickAsync(title, false); };
        var toWatch = Chip(new TextBlock { Text = "Return to Watch", FontSize = 15, Foreground = HubInk }, false);
        ToolTipService.SetToolTip(toWatch, title + " keeps starting; Watch opens, and its corner shows it as it comes up.");
        toWatch.Click += (_, __) => { toWatch.IsEnabled = false; _ = ReturnToWatchAsync(); };
        // and the title's own page (2026-09-26, "we have a cancel and return to watch button when starting and waiting for a video. Can we also add
        // one that takes them to the series/films details page?"): it keeps starting, as with Return to Watch, and Details opens over Watch
        var details = Chip(new TextBlock { Text = "Details", FontSize = 15, Foreground = HubInk }, false);
        ToolTipService.SetToolTip(details, title + " keeps starting; its Details page opens over Watch, with its seasons, episodes and where to watch.");
        details.Click += (_, __) => { details.IsEnabled = false; _ = DetailsFromCurtainAsync(title); };
        ShowOnlyWithTmdb(details);
        outs.Children.Add(cancel); outs.Children.Add(details); outs.Children.Add(toWatch);
        CurtainBody.Children.Add(outs);
        StageCurtain.Visibility = Visibility.Visible;
        StageCurtain.Opacity = 1;
        _curtainSteadyAt = DateTime.MinValue; _curtainUpAt = DateTime.UtcNow; LogLine("curtain: up for " + title + " on " + service);
        _ = FollowCurtainAsync(run, status, line, verbs, title, service);
    }
    private async Task FollowCurtainAsync(int run, TextBlock status, StackPanel line, StackPanel verbs, string title, string service)
    {
        var t0 = DateTime.UtcNow;
        while (run == _curtainRun && StageCurtain.Visibility == Visibility.Visible)
        {
            await Task.Delay(400);
            if (run != _curtainRun) return;
            JsonObject? tile = null;
            try
            {
                var sv = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject;
                var slot = (sv?["screen"] as JsonObject)?["slot"]?.GetValue<string>();
                var vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray;
                tile = vs?.OfType<JsonObject>().FirstOrDefault(t => t["id"]?.GetValue<string>() == slot);
            }
            catch { }
            if (run != _curtainRun) return;
            var err = tile?["error"]?.GetValue<string>();
            var failed = (tile?["pending"] as JsonObject)?["failed"]?.GetValue<string>();
            if (err is { Length: > 0 } || failed is { Length: > 0 })
            {
                // the page's own error, said here; Retry opens the title again, Close lifts the curtain onto the page as it is
                line.Children.OfType<ProgressRing>().ToList().ForEach(r => r.IsActive = false);
                status.Text = err is { Length: > 0 } ? err : "could not start " + title + " (" + failed + ")";
                status.Foreground = HubAmber;
                if (verbs.Children.Count == 0)
                {
                    var retry = Chip(new TextBlock { Text = "Retry", FontSize = 14, Foreground = HubAmber }, true);
                    retry.Click += (_, __) => { _ = RetryOnScreenAsync(); status.Text = "Starting on " + service + "\u2026"; status.Foreground = HubDim; verbs.Visibility = Visibility.Collapsed; line.Children.OfType<ProgressRing>().ToList().ForEach(r => r.IsActive = true); _ = FollowCurtainAsync(++_curtainRun, status, line, verbs, title, service); };
                    verbs.Children.Add(retry);
                    var close = Chip(new TextBlock { Text = "Close", FontSize = 14, Foreground = HubInk }, false);
                    close.Click += (_, __) => HideStageCurtain();
                    verbs.Children.Add(close);
                }
                verbs.Visibility = Visibility.Visible;
                return;
            }
            // down when the player is full-screen AND has been playing for a moment (2026-10-05: it dropped the instant the stage went up, while
            // Apple TV's stream still went play, stop, play - the player's own chrome showed through that half second), or after 30 s regardless
            var stageUp = tile?["stage"]?.GetValue<bool>() == true;
            var playingNow = tile?["playing"]?.GetValue<bool>() == true;
            if (stageUp && playingNow) { if (_curtainSteadyAt == DateTime.MinValue) _curtainSteadyAt = DateTime.UtcNow; }
            else _curtainSteadyAt = DateTime.MinValue;
            if ((stageUp && playingNow && (DateTime.UtcNow - _curtainSteadyAt).TotalMilliseconds >= 900) || (DateTime.UtcNow - t0).TotalSeconds > 30) { HideStageCurtain(); return; }
            if (playingNow) status.Text = "Playing on " + service + "\u2026";
        }
    }
    private async Task RetryOnScreenAsync()
    {
        try
        {
            var sv = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject;
            var slot = (sv?["screen"] as JsonObject)?["slot"]?.GetValue<string>();
            if (slot is not null) _brain.Call(HostCalls.TileCommand, slot, "retry");
        }
        catch { }
    }
    /// <summary>The curtain's Cancel: core calls the pick off (queued plays dropped, a screen that began paused), the curtain drops at once, Watch comes back.</summary>
    private async Task CancelPickAsync(string title, bool toWatch = true)
    {
        _curtainRun++;   // the curtain's follow stops; the curtain itself stays up until what comes next is drawn beneath it - the service's page never shows between ("shows netflix for a moment", 2026-09-22)
        LogLine("curtain: cancelled " + title);
        try { await ModelCallAsync("videoCancelPick"); } catch (Exception e) { LogLine("cancel pick: " + e.Message); }
        HideStageBar();
        try { if (toWatch) await ShowVideoHubAsync(); else { _stayOnVideo = true; await MvCallAsync("state"); } }   // left on the screen: the empty stage when nothing is on it
        finally { StageCurtain.Visibility = Visibility.Collapsed; StageCurtain.Opacity = 1; }
        SetPill("Prism \u00B7 cancelled " + Shorten(title, 40));
    }
    /// <summary>The curtain's Details: the start goes on, Watch opens, and the title's Details page over it - named as the service names the show (a
    /// series, not an episode's label), else the pick's name without its "S2 E3".</summary>
    private async Task DetailsFromCurtainAsync(string title)
    {
        string? app = null, kind = null, name = null;
        _curtainRun++;   // the curtain's own follow stops now, not after the reads below
        try
        {
            var sv = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject;
            var scr = sv?["screen"] as JsonObject;
            app = scr?["app"]?.GetValue<string>();
            var slot = scr?["slot"]?.GetValue<string>();
            var vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray;
            var t = vs?.OfType<JsonObject>().FirstOrDefault(x => x["id"]?.GetValue<string>() == slot);
            var v = t?["video"] as JsonObject;
            var pend = t?["pending"] as JsonObject;
            var pk = pend?["kind"]?.GetValue<string>();
            // a start still open is the title the curtain names: the screen's video can still be the LAST title (review 2026-09-26: Show A's
            // Details opened while Show B was starting); the curtain's name, without its "S2 E3", and the pick's kind
            if (pend is not null && pend["failed"] is null) v = null;
            var series = v?["series"]?.GetValue<string>();
            if (series is { Length: > 0 }) { name = series; kind = "series"; }
            else if (v?["title"]?.GetValue<string>() is { Length: > 0 } vt) { name = vt; kind = v["kind"]?.GetValue<string>() == "movie" ? "movie" : null; }
            if (kind is null && pk is "episode" or "series") kind = "series";
        }
        catch { }
        name ??= System.Text.RegularExpressions.Regex.Replace(title, @"\s+S\d+\s*E\d+.*$", "").Trim();
        await ReturnToWatchAsync();
        ShowTitleDetails(name, kind, app);
    }
    /// <summary>The curtain's Return to Watch: the start goes on; Watch opens over it and the curtain goes.</summary>
    private async Task ReturnToWatchAsync()
    {
        _curtainRun++;
        LogLine("curtain: back to Watch, the start goes on");
        HideStageBar();
        try { await ShowVideoHubAsync(); }
        finally { StageCurtain.Visibility = Visibility.Collapsed; StageCurtain.Opacity = 1; }
        // the start is followed into Watch's big window (2026-10-06, "If I click to start a show, and press return to watch while it's loading, it
        // doesn't finish loading. It should show on my big window even while I'm in watch"): nothing re-read the corner after Watch opened, so
        // a title that began playing behind it never moved in. The corner holds "Starting on ..." while the pick is open and takes the screen
        // in once it plays or fails, as it does for a title dropped on a window
    }
    private DateTime _curtainSteadyAt = DateTime.MinValue;
    /// <summary>When the curtain went up: a press within the next moment is the rest of the double-click that raised it, not a tap to lift it.</summary>
    private DateTime _curtainUpAt = DateTime.MinValue;
    public void HideStageCurtain()
    {
        if (StageCurtain.Visibility != Visibility.Visible) return;
        _curtainRun++;
        var anim = new DoubleAnimation { From = 1, To = 0, Duration = new Duration(TimeSpan.FromMilliseconds(320)) };
        var sb = new Storyboard(); Storyboard.SetTarget(anim, StageCurtain); Storyboard.SetTargetProperty(anim, "Opacity"); sb.Children.Add(anim);
        sb.Completed += (_, __) => { StageCurtain.Visibility = Visibility.Collapsed; StageCurtain.Opacity = 1; };
        sb.Begin();
        _ = MvCallAsync("state");   // what the screens hold now: a start that failed brings the empty stage back, not the service's page
        LogLine("curtain: down");
        _curtainDownAt = DateTime.UtcNow;
    }

    // ---------------------------------------------------------------- the stage bar (2026-09-20)
    private DispatcherTimer? _stageBarTimer;
    private DispatcherTimer? _stageTick;
    private bool _stageHasTime;
    private (Grid line, TextBlock times, TextBlock quality)? _stageProgress;
    /// <summary>The bar's title line and its service's name: the tick keeps the words current (2026-09-25, the previous episode's name came late).</summary>
    private (TextBlock text, string service)? _stageFace;
    private Microsoft.UI.Xaml.Shapes.Ellipse? _stageKnob;
    /// <summary>A drag on the slider, and the moment after a seek: the once-a-second follow leaves the line alone until then.</summary>
    private bool _seekDragging;
    private DateTime _seekHoldUntil;

    /// <summary>The slider's drag: the line and handle follow the pointer, the time heading to shows; release seeks there (the service's own
    /// seek, core refuses it during an ad) and holds the line there until the page's clock catches up.</summary>
    private void WireSeekSlider(Grid host, Grid line, Microsoft.UI.Xaml.Shapes.Ellipse knob, TextBlock times, string tileId, double dur, bool canPreview = false)
    {
        // the preview over the slider while dragging (2026-09-23): the service's own picture at the spot, when it offers one (adapter videoPreview)
        var previewImg = new Image { Width = 240, Height = 135, Stretch = Stretch.UniformToFill };
        var previewTime = new TextBlock { FontSize = 13, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center };
        var preview = new Border
        {
            Child = new StackPanel { Spacing = 4, Children = { new Border { CornerRadius = new CornerRadius(6), Child = previewImg, Background = HubCard }, previewTime } },
            Padding = new Thickness(6), CornerRadius = new CornerRadius(8), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF0, 0x12, 0x13, 0x1A)),
            BorderBrush = HubAmber, BorderThickness = new Thickness(1), IsHitTestVisible = false, Visibility = Visibility.Collapsed,
        };
        var pop = new Microsoft.UI.Xaml.Controls.Primitives.Popup { Child = preview, IsLightDismissEnabled = false };
        host.Loaded += (_, __) => pop.XamlRoot = host.XamlRoot;
        double wantAt = -1; bool fetching = false;
        async Task FetchPreviewAsync()
        {
            if (fetching || !canPreview || wantAt < 0) return;
            fetching = true;
            try
            {
                while (wantAt >= 0)
                {
                    var at = wantAt;
                    var r = (await _surfaces.EvalOnTileAsync(tileId, "window.__prismVideoPreview ? window.__prismVideoPreview(" + at.ToString(System.Globalization.CultureInfo.InvariantCulture) + ") : ''"))?.Trim().Trim('"') ?? "";
                    var url = "";
                    if (r.StartsWith("url:", StringComparison.Ordinal)) url = r.Substring(4);
                    else if (r.StartsWith("hover:", StringComparison.Ordinal))
                    {
                        var xy = r.Substring(6).Split(',');
                        if (xy.Length == 2 && double.TryParse(xy[0], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var hx) && double.TryParse(xy[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var hy))
                        {
                            await _surfaces.ScrubAsync(tileId, hx, hy, press: false);
                            await Task.Delay(180);
                            url = (await _surfaces.EvalOnTileAsync(tileId, "window.__prismVideoPreviewRead ? window.__prismVideoPreviewRead() : ''"))?.Trim().Trim('"') ?? "";
                        }
                    }
                    if (url.StartsWith("http", StringComparison.Ordinal) || url.StartsWith("data:image", StringComparison.Ordinal)) { try { previewImg.Source = new BitmapImage(Services.ArtCache.UriFor(url)); } catch { } }
                    if (Math.Abs(wantAt - at) < 0.5) break;   // the pointer has not moved on: this picture stands
                }
            }
            catch { }
            finally { fetching = false; }
        }
        void ShowPreview(double frac, PointerRoutedEventArgs e)
        {
            if (!canPreview) return;
            wantAt = frac * dur;
            previewTime.Text = Clock(wantAt);
            try
            {
                var p = host.TransformToVisual(null).TransformPoint(new Windows.Foundation.Point(frac * host.ActualWidth, 0));
                pop.HorizontalOffset = p.X - 126; pop.VerticalOffset = p.Y - 190;
                preview.Visibility = Visibility.Visible; pop.IsOpen = true;
            }
            catch { }
            _ = FetchPreviewAsync();
        }
        void HidePreview() { wantAt = -1; pop.IsOpen = false; preview.Visibility = Visibility.Collapsed; previewImg.Source = null; if (canPreview) _ = _surfaces.EvalOnTileAsync(tileId, "window.__prismVideoPreviewDone && window.__prismVideoPreviewDone()"); }
        double FracAt(PointerRoutedEventArgs e) => Math.Max(0, Math.Min(1, e.GetCurrentPoint(host).Position.X / Math.Max(1, host.ActualWidth)));
        void Show(double frac)
        {
            if (line.ColumnDefinitions.Count == 2) { line.ColumnDefinitions[0].Width = new GridLength(Math.Max(0.002, frac), GridUnitType.Star); line.ColumnDefinitions[1].Width = new GridLength(Math.Max(0.002, 1 - frac), GridUnitType.Star); }
            knob.Margin = new Thickness(Math.Max(0, frac * host.ActualWidth - knob.Width / 2), 0, 0, 0);
            times.Text = Clock(frac * dur) + "  /  " + Clock(dur);
        }
        host.PointerPressed += (_, e) =>
        {
            if (!e.GetCurrentPoint(host).Properties.IsLeftButtonPressed) return;
            _seekDragging = true; host.CapturePointer(e.Pointer); _stageBarTimer?.Stop();
            Show(FracAt(e)); ShowPreview(FracAt(e), e); e.Handled = true;
        };
        host.PointerMoved += (_, e) => { if (_seekDragging) { var f = FracAt(e); Show(f); ShowPreview(f, e); e.Handled = true; } };
        host.PointerReleased += async (_, e) =>
        {
            if (!_seekDragging) return;
            _seekDragging = false; host.ReleasePointerCaptures(); e.Handled = true;
            var frac = FracAt(e); Show(frac); HidePreview();
            _seekHoldUntil = DateTime.Now.AddSeconds(3);
            var r = (await ModelCallAsync("videoSeek", tileId, (frac * dur).ToString(System.Globalization.CultureInfo.InvariantCulture)))?.Trim().Trim('"');
            if (r == "ad") SetPill("Prism \u00B7 not during an ad. It's covered until it ends");
            else if (r is not null && r != "ok") SetPill("Prism \u00B7 could not seek (" + r + ")");
            RestartStageBarTimer();
        };
        host.PointerCaptureLost += (_, __) => { _seekDragging = false; HidePreview(); };
    }
    /// <summary>The feature's decoded size and dropped frames, read from the playing element itself ("I'd like to see how playback
    /// looks for each service", 2026-09-21): the element with the largest picture that is playing, its videoWidth x videoHeight,
    /// and getVideoPlaybackQuality's dropped / total frames. A read, never a change.</summary>
    private const string QualityJs = "(function(){try{var vs=document.querySelectorAll('video');var b=null;for(var i=0;i<vs.length;i++){var v=vs[i];if(v.videoWidth>0&&v.readyState>=2&&(!b||(v.videoWidth*v.videoHeight)>(b.videoWidth*b.videoHeight)))b=v;}if(!b)return null;var q=b.getVideoPlaybackQuality?b.getVideoPlaybackQuality():null;return JSON.stringify({w:b.videoWidth,h:b.videoHeight,drop:q?q.droppedVideoFrames:-1,total:q?q.totalVideoFrames:-1,paused:b.paused});}catch(e){return null;}})()";
    private async Task<string> ReadQualityAsync(string slot)
    {
        try
        {
            var raw = await _surfaces.EvalOnTileAsync(slot, QualityJs);
            if (raw is null || raw == "null" || raw.StartsWith("__prism_eval_error", StringComparison.Ordinal)) return "";
            var inner = JsonNode.Parse(raw)?.GetValue<string>();
            if (inner is null) return "";
            var q = JsonNode.Parse(inner) as JsonObject;
            var w = q?["w"]?.GetValue<int>() ?? 0; var h = q?["h"]?.GetValue<int>() ?? 0;
            var drop = q?["drop"]?.GetValue<int>() ?? -1; var total = q?["total"]?.GetValue<int>() ?? -1;
            if (w <= 0) return "";
            var tier = h >= 2100 ? "4K" : h >= 1400 ? "1440p" : h >= 1000 ? "1080p" : h >= 700 ? "720p" : h >= 460 ? "480p" : h + "p";
            var text = w + " \u00D7 " + h + "  (" + tier + ")";
            if (total > 0 && drop >= 0) text += "  \u00B7  " + drop + " dropped of " + (total >= 10000 ? (total / 1000) + "k" : total.ToString()) + " frames";
            return text;
        }
        catch { return ""; }
    }
    private bool _stageBarBuilding;
    private static string Clock(double s) { var t = TimeSpan.FromSeconds(Math.Max(0, s)); return t.TotalHours >= 1 ? t.ToString(@"h\:mm\:ss") : t.ToString(@"m\:ss"); }
    /// <summary>The episode's place in a face line: "S2 E21" when the page names the season (Disney+), "E21" when it names the episode alone (Netflix).</summary>
    private static string? EpisodeLabel(JsonObject video)
    {
        if (!(video["episode"] is JsonValue ev && ev.TryGetValue<int>(out var en))) return null;
        return video["season"] is JsonValue sv && sv.TryGetValue<int>(out var sn) ? "S" + sn + " E" + en : "E" + en;
    }
    /// <summary>While the bar is up: the progress line follows the face once a second.</summary>
    private async Task StageTickAsync()
    {
        if (StageBar.Visibility != Visibility.Visible || _stageProgress is null) return;
        try
        {
            var sv = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject;
            var slot = (sv?["screen"] as JsonObject)?["slot"]?.GetValue<string>();
            var vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray;
            var tileNow = vs?.OfType<JsonObject>().FirstOrDefault(t => t["id"]?.GetValue<string>() == slot);
            var video = tileNow?["video"] as JsonObject;
            if (tileNow?["playing"] is JsonValue plV && plV.TryGetValue<bool>(out var pl) && pl != _stagePlaying) SetStagePlaying(pl);
            // the title line follows the screen too (2026-09-25, "When I press the back button ... there is a long delay to update the episode title"
            // - on the control bar): core shows the episode it sent the screen to at once, and the line takes it within a second
            if (_stageFace is { } sf && video is not null)
            {
                string V(string k) => video[k]?.GetValue<string>() ?? "";
                if (V("title").Length > 0 || V("series").Length > 0)
                {
                    var faceNow = string.Join("  ·  ", new[] { V("series"), EpisodeLabel(video), V("title") }.Where(x => !string.IsNullOrEmpty(x)));
                    var want = (sf.service.Length > 0 ? sf.service + "  ·  " : "") + Shorten(faceNow, 56);
                    if (sf.text.Text != want) sf.text.Text = want;
                }
            }
            var pos = video?["position"] is JsonValue posV && posV.TryGetValue<double>(out var pd) ? pd : -1;
            var dur = video?["duration"] is JsonValue durV && durV.TryGetValue<double>(out var dd) ? dd : -1;
            // a bar drawn before the page knew its clock has no slider; the clock known now, the bar is drawn once more with it (2026-10-05,
            // "The time scan slider didn't appear with the rest of the controls when I brought the mouse up")
            if (!_stageHasTime && pos >= 0 && !_stageBarBuilding) { _ = ShowStageBarAsync(force: true); return; }
            if (pos < 0 || _stageProgress is null || _seekDragging || DateTime.Now < _seekHoldUntil) return;   // a drag, or a seek on its way: the line is the person's
            var (line, times, quality) = _stageProgress.Value;
            if (slot is not null) { var qt = await ReadQualityAsync(slot); if (qt.Length > 0) quality.Text = qt; }
            var frac = dur > 0 ? Math.Max(0.002, Math.Min(1, pos / dur)) : 0.002;
            if (line.ColumnDefinitions.Count == 2) { line.ColumnDefinitions[0].Width = new GridLength(frac, GridUnitType.Star); line.ColumnDefinitions[1].Width = new GridLength(Math.Max(0.002, 1 - frac), GridUnitType.Star); }
            if (_stageKnob is { } kn && kn.Visibility == Visibility.Visible) kn.Margin = new Thickness(Math.Max(0, frac * line.ActualWidth - kn.Width / 2), 0, 0, 0);
            times.Text = Clock(pos) + (dur > 0 ? "  /  " + Clock(dur) : "");
        }
        catch { }
    }
    /// <summary>Prism's transport over the service's player: the face and the verbs, from core's videoState for the screen slot. Hides after six seconds.</summary>
    public async Task ShowStageBarAsync(bool force = false)
    {
        if (WatchGrip.Visibility != Visibility.Visible || VideoHubOpen || _asSession || _stageBarBuilding) return;
        // the bar up already: a mouse moving over the picture keeps it up, it does not draw it again (2026-09-23, "The pause button is hard to
        // grab, i move the mouse over it and it loses focus several times" - every move rebuilt the bar under the pointer); a verb that
        // changes what the bar shows asks for the drawing (force)
        HookStageBarPointer();
        FadeGrips(false);   // the corner grips come back with the bar (2026-10-05)
        if (!force && StageBar.Visibility == Visibility.Visible) { RestartStageBarTimer(); return; }
        _stageBarBuilding = true;
        try
        {
            JsonObject? menu = null; JsonArray? vs = null;
            try { menu = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject; vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray; } catch { }
            var screenSlot = (menu?["screen"] as JsonObject)?["slot"]?.GetValue<string>();
            if (screenSlot is null) return;
            JsonObject? tile = null;
            if (vs is not null) foreach (var t in vs) if (t is JsonObject o && o["id"]?.GetValue<string>() == screenSlot) tile = o;
            string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
            var onName = "";
            if (menu?["services"] is JsonArray svcs) foreach (var s in svcs) if (s is JsonObject so && so["onScreen"]?.GetValue<bool>() == true) onName = S(so, "name");
            var video = tile?["video"] as JsonObject;
            var playing = tile?["playing"]?.GetValue<bool>() == true;
            var canCmd = (tile?["can"] as JsonObject)?["cmd"]?.GetValue<bool>() == true;
            // a live channel has no next or previous episode (2026-10-06, "If a live channel, the next & previous button controls should be disabled")
            var liveNow = (tile?["video"] as JsonObject)?["kind"]?.GetValue<string>() == "live";
            var pageError = tile?["error"]?.GetValue<string>();
            string face;
            if (pageError is { Length: > 0 }) face = pageError;
            else if (video is not null && (S(video, "title").Length > 0 || S(video, "series").Length > 0))
            {
                var ep = EpisodeLabel(video);
                face = string.Join("  ·  ", new[] { S(video, "series"), ep, S(video, "title") }.Where(x => !string.IsNullOrEmpty(x)));
            }
            else if (tile?["pending"] is JsonObject pend && pend["failed"] is null) face = "loading " + S(pend, "name") + "\u2026";
            else face = "nothing playing";
            StageBarBody.Children.Clear();
            var faceCol = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 12, 0), MinWidth = 320 };
            // nothing up: "Nothing playing" alone, and only the way to Watch - no service name, no transport with nothing to move (2026-09-25, "when I go
            // to Show Video, and nothing is playing. At the bottom in the controls it says Paramount+ Nothing is playing")
            // a video whose title has not come yet (Netflix names it a moment after it starts) is not nothing: the controls, under the service's name
            // (2026-09-25, "I started animal control ... instead of visible video controls it says Nothing playing and Watch ... after about ~30
            // seconds, that went away and the player controls came back")
            if (face == "nothing playing" && (video is not null || playing)) face = playing ? "playing" : "paused";
            if (face == "nothing playing")
            {
                faceCol.MinWidth = 0;
                faceCol.Children.Add(new TextBlock { Text = "Nothing playing", FontSize = 14, Foreground = HubInk });
                StageBarBody.Children.Add(faceCol);
                var watch0 = Chip(WatchLabel(), false);
                ToolTipService.SetToolTip(watch0, "The video player's page: continue watching, my list, live, services, search.");
                watch0.Click += (_, __) => { HideStageBar(); _ = ShowVideoHubAsync(); };
                StageBarBody.Children.Add(watch0);
                StageNext.Visibility = Visibility.Collapsed; StageNext.Children.Clear();
                PlaceStageBar();
                StageBar.Visibility = Visibility.Visible;
                SyncMvBars();
                RestartStageBarTimer();
                return;
            }
            var faceText = new TextBlock { Text = (onName.Length > 0 ? onName + "  ·  " : "") + Shorten(face, 56), FontSize = 14, Foreground = HubInk };
            faceCol.Children.Add(faceText);
            _stageFace = (faceText, onName);
            // the progress line: the page's own position and length, as the face reports them; refreshed while the bar is up
            var pos = video?["position"] is JsonValue posV && posV.TryGetValue<double>(out var pd) ? pd : -1;
            var dur = video?["duration"] is JsonValue durV && durV.TryGetValue<double>(out var dd) ? dd : -1;
            var line = new Grid { Height = 5, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x60, 0xE8, 0xEC, 0xF2)), Width = 360, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center, CornerRadius = new CornerRadius(2) };
            var frac = pos >= 0 && dur > 0 ? Math.Max(0.002, Math.Min(1, pos / dur)) : 0;
            line.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0.002, frac), GridUnitType.Star) });
            line.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0.002, 1 - frac), GridUnitType.Star) });
            var fill = new Border { Background = HubAmber }; line.Children.Add(fill);
            var times = new TextBlock { Text = pos >= 0 ? Clock(pos) + (dur > 0 ? "  /  " + Clock(dur) : "") : "", FontSize = 11, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center };
            var timeRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
            // the slider (2026-09-23, "I should be able to drag the slider on all of the video streams to find my spot and have the video immediately
            // changed"; "ours that the user interfaces with can all be uniform"): Prism's own, the same on every service - the grab area around the
            // line, a handle; the time heading to shows while it moves; let go and the service's own seek goes there (core videoSeek, the adapter's)
            var canSeek = ((tile?["can"] as JsonObject)?["seek"]?.GetValue<bool>() == true) && dur > 0;
            var canPreview = (tile?["can"] as JsonObject)?["preview"]?.GetValue<bool>() == true;
            var knob = new Microsoft.UI.Xaml.Shapes.Ellipse { Width = 13, Height = 13, Fill = HubAmber, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center, IsHitTestVisible = false, Visibility = canSeek ? Visibility.Visible : Visibility.Collapsed, Margin = new Thickness(Math.Max(0, frac * 360 - 6.5), 0, 0, 0) };
            var seekHost = new Grid { Width = 360, Height = 20, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), VerticalAlignment = VerticalAlignment.Center };
            seekHost.Children.Add(line);
            // the service's own ad breaks on the line (2026-09-23, "Can we show ad breaks in the scan bar?"): a mark per break - bright ahead,
            // dim once watched; the service says where (the reader's adBreaks), Prism only draws it
            if (dur > 0 && video?["adBreaks"] is JsonArray breaks)
                foreach (var br in breaks.OfType<JsonObject>())
                {
                    if (br["at"] is not JsonValue atV || !atV.TryGetValue<double>(out var brAt) || brAt <= 0 || brAt >= dur) continue;
                    var done = br["done"]?.GetValue<bool>() == true;
                    seekHost.Children.Add(new Border { Width = 3, Height = 11, CornerRadius = new CornerRadius(1), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center, IsHitTestVisible = false, Margin = new Thickness(Math.Max(0, brAt / dur * 360 - 1.5), 0, 0, 0), Background = done ? new SolidColorBrush(Windows.UI.Color.FromArgb(0x70, 0xE8, 0xEC, 0xF2)) : new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xF2, 0xE6, 0x4C)) });
                }
            seekHost.Children.Add(knob);
            ToolTipService.SetToolTip(seekHost, canSeek ? "Drag to find your spot. The video goes there when you let go." : "Seeking to a spot: this service's adapter cannot yet (Back / Forward 10 s still work).");
            if (canSeek) WireSeekSlider(seekHost, line, knob, times, screenSlot, dur, canPreview);
            timeRow.Children.Add(seekHost); timeRow.Children.Add(times);
            var quality = new TextBlock { Text = "", FontSize = 11, Foreground = HubDim, Margin = new Thickness(6, 0, 0, 0) };
            ToolTipService.SetToolTip(quality, "The picture as the service's player decodes it right now: its size, and how many of its decoded pictures were dropped since the title started. Read from the player itself.");
            timeRow.Children.Add(quality);
            if (pos >= 0) faceCol.Children.Add(timeRow);
            // a live channel has no clock to show, but its picture still has a size (2026-10-06, "Is there a reason YoutubeTV doesnt show the resolution
            // on the control bar like others?"): the size alone under the title
            else { timeRow.Children.Remove(quality); quality.Margin = new Thickness(0); faceCol.Children.Add(quality); }
            _stageHasTime = pos >= 0;
            StageBarBody.Children.Add(faceCol);
            _ = StageNextAsync(screenSlot, video);   // the next episode's card under the bar, for a series (2026-09-22)
            _stageProgress = (line, times, quality);
            _stageKnob = knob;
            _ = ReadQualityAsync(screenSlot).ContinueWith(t => RootGrid.DispatcherQueue.TryEnqueue(() => { if (ReferenceEquals(_stageProgress?.quality, quality)) quality.Text = t.Result; }));
            void Verb(string glyph, string tip, string cmd, bool enabled)
            {
                var b = Chip(VerbIcon(glyph, 15), false); b.IsEnabled = enabled;
                ToolTipService.SetToolTip(b, enabled ? tip + MvAllTip(cmd) : liveNow && cmd is "nextepisode" ? tip + ". A live channel has no next episode" : tip + ". This service's adapter has no control for it yet");
                b.Click += (_, __) => { if (!MvAllCommand(cmd)) _brain.Call(HostCalls.TileCommand, screenSlot, cmd); RestartStageBarTimer(); };
                StageBarBody.Children.Add(b);
            }
            // back to the start (2026-09-24, "a start over button to the video controls, go to the previous episode if in the first 5 seconds"): core
            // decides - past 5 s the title starts again, within them an episode plays the one before
            var startOver = Chip(new FontIcon { Glyph = "\uE892", FontSize = 15 }, false);
            ToolTipService.SetToolTip(startOver, "Back to the start. Press again in the first 5 seconds for the previous episode.");
            startOver.Click += async (_, __) =>
            {
                RestartStageBarTimer();
                JsonObject? so = null;
                try { so = JsonNode.Parse(await ModelCallAsync("videoStartOver") ?? "null") as JsonObject; } catch { }
                var did = so?["did"]?.GetValue<string>();
                SetPill("Prism \u00B7 " + (did == "previous" ? "previous episode, S" + so!["season"] + " E" + so["episode"] : did == "start" ? "back to the start" : "could not go back" + (so?["error"]?.GetValue<string>() is { Length: > 0 } er ? ": " + Shorten(er, 60) : "")));
            };
            if (liveNow) { startOver.IsEnabled = false; ToolTipService.SetToolTip(startOver, "Back to the start. A live channel has no start or previous episode to go back to"); }
            StageBarBody.Children.Add(startOver);
            Verb("\uEB9E", "Back 10 s", "seekbackward", true);
            // Play / Pause follows the page while the bar stays up: its glyph is changed in place (the tick), never by drawing the bar again
            _stagePlaying = playing;
            var ppIcon = new FontIcon { Glyph = playing ? "\uE769" : "\uE768", FontSize = 15 };
            var pp = Chip(ppIcon, false);
            ToolTipService.SetToolTip(pp, (playing ? "Pause" : "Play") + MvAllTip(playing ? "pause" : "play"));
            // a live channel that cannot pause (core's can.pause, the adapter's livePause): drawn dim, and a press says so and offers Mute (2026-10-06)
            if ((tile?["can"] as JsonObject)?["pause"]?.GetValue<bool>() == false) { ppIcon.Foreground = HubDim; ToolTipService.SetToolTip(pp, CannotPauseTip); }
            pp.Click += async (_, __) =>
            {
                var cmd = _stagePlaying ? "pause" : "play";
                RestartStageBarTimer();
                if (cmd == "pause" && !await CanPauseAsync(screenSlot)) { SayCannotPause(screenSlot); return; }
                if (!MvAllCommand(cmd)) _brain.Call(HostCalls.TileCommand, screenSlot, cmd);
                SetStagePlaying(!_stagePlaying);
            };
            _stagePlayBtn = (pp, ppIcon);
            StageBarBody.Children.Add(pp);
            Verb("\uEB9D", "Forward 10 s", "seekforward", true);
            Verb("\uE893", "Next episode", "nextepisode", canCmd && !liveNow);
            var canTracks = (tile?["can"] as JsonObject)?["tracks"]?.GetValue<bool>() == true;
            if (canTracks) TracksVerb(screenSlot, 15, b => StageBarBody.Children.Add(b), RestartStageBarTimer);   // the service's own tracks in Prism's chrome
            else Verb("\uED1E", "Captions", "captions", canCmd);
            // Re-sync (2026-09-25, "The netflix audio and video are a little bit out of sync ... Often on TVs I have to kill the app and reopen them"):
            // a press is the pause and play that brings sound and picture together; pressed again within 10 s, the title opens again at its place
            {
                var resync = Chip(new FontIcon { Glyph = "\uE895", FontSize = 15, Foreground = HubInk }, false);
                ToolTipService.SetToolTip(resync, "Sound and picture out of step? Press to pause and play, which usually brings them back together. Press again within 10 s to open the title again where it is.");
                resync.Click += async (_, __) =>
                {
                    RestartStageBarTimer();
                    JsonObject? rs = null;
                    try { rs = JsonNode.Parse(await ModelCallAsync("videoResync") ?? "null") as JsonObject; } catch { }
                    var did = rs?["did"]?.GetValue<string>();
                    SetPill("Prism \u00B7 " + (did == "nudged" ? "re-syncing: paused and playing. Press again within 10 s to open it again" : did == "reopened" ? "opening it again where it was" : "could not re-sync" + (rs?["error"]?.GetValue<string>() is { Length: > 0 } er ? ": " + er : "")));
                };
                StageBarBody.Children.Add(resync);
            }
            // Full screen is the WALL's (2026-09-23, "The Full Screen button on the player doesnt work. Should send the video area into full
            // screen mode. Should honor multiview"): the player already fills its window, so the page's own fullscreen changed nothing - the
            // whole Prism window goes borderless across the monitor (F11's toggle), every window of multiview in its place, Watch opening over it
            var fsIcon = new FontIcon { Glyph = _wallFs ? "\uE73F" : "\uE740", FontSize = 15 };
            var fs = Chip(fsIcon, _wallFs);
            ToolTipService.SetToolTip(fs, _wallFs ? "Leave full screen (F11)" : "Full screen: the video fills the monitor, multiview and all (F11)");
            fs.Click += (_, __) =>
            {
                ToggleWallFullscreen();
                fsIcon.Glyph = _wallFs ? "\uE73F" : "\uE740";
                fs.Background = _wallFs ? HubChipOn : HubChip;
                ToolTipService.SetToolTip(fs, _wallFs ? "Leave full screen (F11)" : "Full screen: the video fills the monitor, multiview and all (F11)");
                RestartStageBarTimer();
            };
            StageBarBody.Children.Add(fs);
            // the wall's mute and volume, as the music player has them ("need to add volume control/mute to the video player, make it
            // look and work just like the music player", 2026-09-21): the speaker flips the wall's one mute switch (B-150) and
            // answers at once; hover raises the wall's volume slider over it (B-176); the bar holds while the slider is up
            var muteIcon = new FontIcon { Glyph = _wallMuted ? "\uE74F" : "\uE767", FontSize = 15, Foreground = _wallMuted ? HubAmber : HubInk };
            var mute = Chip(muteIcon, _wallMuted);
            ToolTipService.SetToolTip(mute, _wallMuted ? "Muted. Press to unmute, or hover for the volume." : "Mute the wall. Hover for the volume.");
            mute.Click += (_, __) => { SetWallMutedFromWall(screenSlot, !_wallMuted); muteIcon.Glyph = _wallMuted ? "\uE74F" : "\uE767"; muteIcon.Foreground = _wallMuted ? HubAmber : HubInk; RestartStageBarTimer(); };
            mute.PointerEntered += (_, __) => { ShowVolumeSlider(mute, screenSlot); _stageBarTimer?.Stop(); };
            mute.PointerExited += (_, __) => { _volumeClose?.Start(); RestartStageBarTimer(); };
            StageBarBody.Children.Add(mute);
            if (pageError is { Length: > 0 })
            {
                var retry = Chip(new TextBlock { Text = "Retry", FontSize = 13, Foreground = HubAmber }, true);
                ToolTipService.SetToolTip(retry, "The service's page reported an error. Opens the title's own address again.");
                retry.Click += (_, __) => { _brain.Call(HostCalls.TileCommand, screenSlot, "retry"); RestartStageBarTimer(); };
                StageBarBody.Children.Add(retry);
            }
            // every season and episode of the series, to choose from (2026-09-22)
            if (S(video, "series").Length > 0)
            {
                var episodes = Chip(new TextBlock { Text = "Episodes", FontSize = 13, Foreground = HubInk }, false);
                ToolTipService.SetToolTip(episodes, "Every season and episode of " + S(video, "series") + ": choose one to read about it and play it.");
                episodes.Click += (_, __) => _ = ShowEpisodesAsync(episodes);
                StageBarBody.Children.Add(episodes);
            }
            await AddMvVerbsAsync(StageBarBody);   // multiview on/off and Swap (2026-09-23)
            var watch = Chip(WatchLabel(), false);
            ToolTipService.SetToolTip(watch, "The video player's page: continue watching, my list, live, services, search.");
            watch.Click += (_, __) => { HideStageBar(); _ = ShowVideoHubAsync(); };
            StageBarBody.Children.Add(watch);
            PlaceStageBar();   // on the big window's own bottom while multiview's small windows are up
            StageBar.Visibility = Visibility.Visible;
            SyncMvBars();   // multiview: the small windows' bars come with the controls
            RestartStageBarTimer();
            _stageTick ??= new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _stageTick.Tick -= StageTickHandler; _stageTick.Tick += StageTickHandler;
            _stageTick.Start();
        }
        finally { _stageBarBuilding = false; }
    }
    private void StageTickHandler(object? sender, object e) { PlaceStageBar(); _ = StageTickAsync(); }   // the bar follows a resize while it is up
    /// <summary>A transport key from the stage: the verb on the screen slot ("playpause" reads the face for which), and the bar shown.</summary>
    private async Task StageKeyAsync(string cmd)
    {
        if (WatchGrip.Visibility != Visibility.Visible || VideoHubOpen) return;
        try
        {
            var sv = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject;
            var slot = (sv?["screen"] as JsonObject)?["slot"]?.GetValue<string>();
            if (slot is null) return;
            if (cmd == "playpause")
            {
                var vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray;
                var playing = vs?.OfType<JsonObject>().FirstOrDefault(t => t["id"]?.GetValue<string>() == slot)?["playing"]?.GetValue<bool>() == true;
                cmd = playing ? "pause" : "play";
            }
            if (cmd == "pause" && !await CanPauseAsync(slot)) { SayCannotPause(slot); await ShowStageBarAsync(); return; }
            if (!MvAllCommand(cmd)) _brain.Call(HostCalls.TileCommand, slot, cmd);   // Shift+Space: every multiview window
            if (cmd is "play" or "pause") SetStagePlaying(cmd == "play");
            await ShowStageBarAsync();
        }
        catch (Exception e) { LogLine("stage key: " + e.Message); }
    }

    private bool _overStageBar, _stageBarHooked, _stagePlaying;
    private (Button btn, FontIcon icon)? _stagePlayBtn;
    private void HookStageBarPointer()
    {
        if (_stageBarHooked) return;
        _stageBarHooked = true;
        StageBar.PointerEntered += (_, __) => { _overStageBar = true; RestartStageBarTimer(); };
        StageBar.PointerExited += (_, __) => { _overStageBar = false; RestartStageBarTimer(); };
    }
    /// <summary>The stage bar's Play / Pause as the page stands: its glyph and its tooltip, in place.</summary>
    private void SetStagePlaying(bool playing)
    {
        _stagePlaying = playing;
        if (_stagePlayBtn is not { } pb) return;
        pb.icon.Glyph = playing ? "\uE769" : "\uE768";
        ToolTipService.SetToolTip(pb.btn, (playing ? "Pause" : "Play") + MvAllTip(playing ? "pause" : "play"));
    }
    private void RestartStageBarTimer()
    {
        _stageBarTimer ??= new DispatcherTimer { Interval = TimeSpan.FromSeconds(6) };
        _stageBarTimer.Stop();
        _stageBarTimer.Tick -= StageBarTick; _stageBarTimer.Tick += StageBarTick;
        _stageBarTimer.Start();
    }
    private void StageBarTick(object? sender, object e)
    {
        // over the bar only while the pointer really is (2026-10-06, the controls stuck after the mouse left the window: no PointerExited came)
        if (_overStageBar && !PointerIsOver(StageBar)) _overStageBar = false;
        // the volume slider opened by a hover the same way: closed when the pointer is on neither it nor the bar (not mid-drag)
        if (_volumePopup is { IsOpen: true } vp && !_volumeDragging && vp.Child is FrameworkElement vc && !PointerIsOver(vc) && !PointerIsOver(StageBar)) CloseVolumeSlider();
        if (_overStageBar || SwapChoosing || _volumePopup is { IsOpen: true } || _episodesPanel is { IsOpen: true }) { RestartStageBarTimer(); return; }   // and while a swap is being chosen
        HideStageBar(); FadeGrips(true);
    }   // the bar holds while the mouse is on it   // the bar holds while the volume slider or the Episodes pop-up is up   // the bar holds while the volume slider is up
    /// <summary>The corner grips (the Prism menu, the Music | Video toggle) fade with the bar when the pointer has been still over a playing
    /// video (2026-10-05, "When the controls fade ... can we also fade the music/video control at the top right corner"), and come back
    /// with it; a pointer over a faded grip brings it back alone (its own hover). Never while the menu is open.</summary>
    private bool _gripsFaded;
    private void FadeGrips(bool faded)
    {
        if (_gripsFaded == faded) return;
        if (faded && _menuOpen) return;
        _gripsFaded = faded;
        foreach (var g in new FrameworkElement?[] { PlayerGrip, MenuGrip, _reportGrip }.OfType<FrameworkElement>())
        {
            var anim = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { To = faded ? 0 : (ReferenceEquals(g, MenuGrip) ? GripRestOpacity : 1), Duration = new Duration(TimeSpan.FromMilliseconds(450)), EnableDependentAnimation = true };
            var sb = new Microsoft.UI.Xaml.Media.Animation.Storyboard();
            Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(anim, g);
            Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(anim, "Opacity");
            sb.Children.Add(anim); sb.Begin();
        }
    }
    public void HideStageBar() { _stageBarTimer?.Stop(); _stageTick?.Stop(); StageBar.Visibility = Visibility.Collapsed; CloseVolumeSlider(); CloseEpisodes(); SyncMvBars(); FadeGrips(false); }   // the grips back with any hide (2026-10-05 review: a switch to the Music player or a title's end left them at opacity 0)
    /// <summary>The next episode's card under the stage bar ("if a tv series, can we show below them a clickable link with image for the next episode on
    /// that service?", 2026-09-22): TMDB's word on the episode after the one playing (its still, name and air date; under the household's key,
    /// read in the background - asked again while it reads), and a press is the service's own Next episode, the verb the bar already has.</summary>
    private int _stageNextRun;
    private async Task StageNextAsync(string slot, JsonObject? video)
    {
        var run = ++_stageNextRun;
        StageNext.Visibility = Visibility.Collapsed; StageNext.Children.Clear();
        if (video is null || (video["kind"]?.GetValue<string>() ?? "") != "episode" || (video["series"]?.GetValue<string>() ?? "").Length == 0) return;
        JsonObject? r = null;
        for (var attempt = 0; attempt < 8 && run == _stageNextRun; attempt++)
        {
            if (attempt > 0) await Task.Delay(700);
            try { r = JsonNode.Parse(await ModelCallAsync("videoNextEpisode", slot) ?? "null") as JsonObject; } catch { r = null; }
            if (r?["ready"]?.GetValue<bool>() == true && (r["series"]?.GetValue<string>() ?? "").Length > 0) break;   // the face may name the season a moment after the bar opens (Netflix, on its paused overlay): asked again
        }
        if (run != _stageNextRun || StageBar.Visibility != Visibility.Visible) return;
        var next = r?["next"] as JsonObject;
        var card = new Button { Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(0), HorizontalAlignment = HorizontalAlignment.Left, HorizontalContentAlignment = HorizontalAlignment.Left };
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        var still = next?["still"]?.GetValue<string>();
        var art = new Grid { Width = 128, Height = 72 };
        art.Children.Add(new Border { Background = HubCard, CornerRadius = new CornerRadius(5) });
        if (still is { Length: > 0 }) { try { art.Children.Add(new Border { CornerRadius = new CornerRadius(5), Child = new Image { Source = new BitmapImage(Services.ArtCache.UriFor(still)), Stretch = Stretch.UniformToFill } }); } catch { } }
        art.Children.Add(new FontIcon { Glyph = "\uE893", FontSize = 18, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Opacity = still is { Length: > 0 } ? 0.85 : 1 });
        row.Children.Add(art);
        var col = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        col.Children.Add(new TextBlock { Text = "Next episode", FontSize = 11, Foreground = HubAmber });
        if (next is not null)
        {
            var s = next["season"] is JsonValue sv && sv.TryGetValue<int>(out var sn) ? sn : 0; var e = next["episode"] is JsonValue ev && ev.TryGetValue<int>(out var en) ? en : 0;
            col.Children.Add(new TextBlock { Text = "S" + s + " E" + e + "  ·  " + Shorten(next["name"]?.GetValue<string>() ?? "", 44), FontSize = 13, Foreground = HubInk });
            var air = next["airDate"]?.GetValue<string>() ?? "";
            // the service's own list when it had the episode (2026-09-25), else TMDB: the line names which
            var from = r?["from"]?.GetValue<string>() == "service" ? r?["service"]?.GetValue<string>() ?? "the service" : "TMDB";
            var ovText = next["overview"]?.GetValue<string>() ?? "";
            col.Children.Add(new TextBlock { Text = (air.Length > 0 ? "aired " + air + "  ·  " : "") + from, FontSize = 11, Foreground = HubDim });
            if (ovText.Length > 0) col.Children.Add(new TextBlock { Text = ovText, FontSize = 11, Foreground = HubDim, TextWrapping = TextWrapping.Wrap, MaxLines = 2, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 520 });
            if (ovText.Length > 0) ToolTipService.SetToolTip(card, Shorten(ovText, 300) + "\n" + "· " + from);
        }
        else col.Children.Add(new TextBlock { Text = "Play the next episode on this service", FontSize = 13, Foreground = HubInk });
        row.Children.Add(col);
        card.Content = row;
        card.Click += (_, __) => { _brain.Call(HostCalls.TileCommand, slot, "nextepisode"); RestartStageBarTimer(); };
        StageNext.Children.Add(card);
        StageNext.Visibility = Visibility.Visible;
    }

    /// <summary>The Watch tab beside the Prism pill: shown while the Video player is the wall (core's players), hidden otherwise.</summary>
    private async Task UpdateWatchGripAsync()
    {
        try
        {
            var t0 = DateTime.UtcNow;
            while (!_brain.Ready && (DateTime.UtcNow - t0).TotalSeconds < 60) await Task.Delay(500);
            if (!_brain.Ready) return;
            var raw = await ModelCallAsync("players");
            var active = raw is not null && JsonNode.Parse(raw) is JsonObject p ? p["active"]?.GetValue<string>() : null;
            WatchGrip.Visibility = active == "video" ? Visibility.Visible : Visibility.Collapsed;
            _ = UpdatePlayerGripAsync();   // the Music | Video toggle at the top-right (MainWindow.PlayerGrip, 2026-10-03)
            SyncEmptyStage();   // the empty stage is the Video player's: away with the Music player
            // the wall left the Video player (the Music player, another scene): its Watch page goes too - it sits above the tiles
            // and covered the Music player ("the Wall for the Video player stays up", 2026-09-21, B-262). The tab is collapsed
            // first, so the close hands no focus back to a screen that is leaving
            var was = _lastPlayer; _lastPlayer = active;
            RememberPlayer(active);
            if (active != "video") { HideStageBar(); CloseVideoHub(); _watchHomeRun++; RemoveBootCover("not the Video player"); }
            // Watch is the Video player's home, as the lounge is the Music player's ("Watch should be the default screen", 2026-09-22):
            // the wall arriving at the Video player (a switch, the boot) opens it - unless a pick is already starting under the curtain
            else if (was != "video")
            {
                await MvCallAsync("state");   // multiview kept across a restart: the small windows' bars follow the controls from the start
                if (!VideoHubOpen && StageCurtain.Visibility != Visibility.Visible && !_asSession && !await ScreenTitleUpAsync()) await ShowVideoHubAsync();   // a title already up (back from the Music player mid-film): the player stays on top
                RemoveBootCover(VideoHubOpen ? "Watch drawn" : "a title is up");
                _ = FollowWatchHomeAsync(++_watchHomeRun);
            }
        }
        catch (Exception e) { LogLine("watch grip: " + e.Message); }
    }

    private string? _lastPlayer;
    private async Task<bool> ScreenTitleUpAsync()
    {
        try
        {
            var sv = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject;
            var slot = (sv?["screen"] as JsonObject)?["slot"]?.GetValue<string>();
            var vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray;
            return TitleUp(vs?.OfType<JsonObject>().FirstOrDefault(t => t["id"]?.GetValue<string>() == slot));
        }
        catch { return false; }
    }
    /// <summary>A title is up on the screen: the player is on the stage, a pick is starting, or the page names what plays. A service's
    /// browse page playing its own billboard trailer (Netflix reports a nameless "movie" at /browse, 2026-09-22) is not a title.</summary>
    private static bool TitleUp(JsonObject? tile)
    {
        if (tile is null) return false;
        if (tile["atEnd"]?.GetValue<bool>() == true) return false;   // stuck at its end, on an end card that still names it - over (core, every service, 2026-09-28)
        if (tile["stage"]?.GetValue<bool>() == true) return true;
        if (tile["pending"] is JsonObject pd && pd["failed"] is null && pd["restored"]?.GetValue<bool>() != true) return true;   // a title being brought back after a restart is not up until it plays (2026-09-23)
        var v = tile["video"] as JsonObject;
        return v is not null && ((v["title"]?.GetValue<string>() ?? "").Length > 0 || (v["series"]?.GetValue<string>() ?? "").Length > 0);
    }
    private int _watchHomeRun;
    /// <summary>No title, no service page: back to Watch (2026-09-22, widened 2026-09-23 - "if a video is not playing, the video player should
    /// send me back to watch, not have me sitting on apple tv's home page inside the app. The point of the app is to rewrite the streaming
    /// interfaces so theyre all standardized"). While the Video player is the wall and Watch is down, the screen is watched; when its page
    /// names no title on two reads running - the player closed, a title ended onto its browse page, a start that never became a title -
    /// the Watch page comes back. Only a service that is not signed in is left on its own page (signing in happens there).</summary>
    /// <summary>The person pressed Show video: the wall stays on the screens, empty stage and all, until Watch is opened again - Watch's home rule
    /// (no title up: back to Watch) had brought it back three seconds later (2026-09-25, the curtains seen only for a moment).</summary>
    private bool _stayOnVideo;
    private DateTime _curtainDownAt = DateTime.MinValue;
    /// <summary>When each surface's page last moved to a new address (the next episode starting, a fresh load): no title for a moment then is not
    /// "nothing playing" (2026-09-28, "Watch doesnt need to come back if the next episode in a series is starting, right?").</summary>
    private readonly Dictionary<string, DateTime> _navAt = new();
    private void NoteNavigated(string eventJson)
    {
        if (!eventJson.Contains("\"navigated\"")) return;
        try { if (System.Text.Json.Nodes.JsonNode.Parse(eventJson)?["id"]?.GetValue<string>() is { } id) _navAt[id] = DateTime.UtcNow; } catch { }
    }
    private async Task FollowWatchHomeAsync(int run)
    {
        string? slot = null; var gone = 0;
        while (run == _watchHomeRun)
        {
            await Task.Delay(1500);
            if (run != _watchHomeRun) return;
            if (VideoHubOpen || StageCurtain.Visibility == Visibility.Visible || _asSession) { gone = 0; SyncSkipOffer(null, null); continue; }
            JsonObject? tile = null; string? s = null; var signedIn = true;
            try
            {
                var sv = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject;
                s = (sv?["screen"] as JsonObject)?["slot"]?.GetValue<string>();
                var app = (sv?["screen"] as JsonObject)?["app"]?.GetValue<string>();
                signedIn = (sv?["services"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(x => x["app"]?.GetValue<string>() == app)?["status"]?.GetValue<string>() is not { } st || st == "signed-in";
                var vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray;
                tile = vs?.OfType<JsonObject>().FirstOrDefault(t => t["id"]?.GetValue<string>() == s);
            }
            catch { continue; }
            if (run != _watchHomeRun) return;
            // a title is up: the "Nothing is playing" stage never stands over it (2026-09-29, "Playing an episode of Animal Control, I hear it, but it
            // says Nothing is playing": a pick from Details switched the screen from another service; the state asked half a second later, before
            // the new page was up, said the big screen was empty, and nothing asked again)
            if (!_mvOn && !_mvBigHas && TitleUp(tile)) { _mvBigHas = true; SyncEmptyStage(); _ = MvCallAsync("state"); }
            SyncSkipOffer(s, tile);   // the wall's own Skip button, while the page offers a skip
            if (s != slot) { slot = s; gone = 0; }
            // Show video holds the wall on the screens while nothing plays; a title that plays there ends that hold, so when it ends onto the
            // service's own page the wall goes back to Watch (2026-09-28, "Sullivan's Crossing is still taking up the entire window": Show video,
            // pressed earlier, had kept Netflix's end-of-series promo up)
            // the service autoplayed something unrelated after a title ended and core stopped it (2026-09-28): straight back to Watch
            if (tile?["stoppedAutoplay"]?.GetValue<bool>() == true)
            {
                gone = 0;
                if (VideoHubOpen || StageCurtain.Visibility == Visibility.Visible || _asSession) continue;
                LogLine("watch home: the service autoplayed something unrelated - stopped, back to Watch");
                _stayOnVideo = false;
                HideStageBar();
                await ShowVideoHubAsync();
                continue;
            }
            if (TitleUp(tile)) { _stayOnVideo = false; gone = 0; continue; }
            if (_stayOnVideo) { gone = 0; continue; }
            if (s is null || !signedIn) { gone = 0; continue; }
            // a title still starting is not "no title" (2026-09-28, "I just started animal control, and it went to nothing playing. And then I started it
            // again and it was fine": the screen had been made again for Netflix, the curtain came down with the page still loading, and two reads
            // 1.5 s apart sent the wall back to Watch half a second before the page finished and played the title under it): an open pick, or the
            // first 12 seconds after the curtain, never count
            if (tile?["pending"] is JsonObject pend && pend["failed"] is null) { gone = 0; continue; }
            if ((DateTime.UtcNow - _curtainDownAt).TotalSeconds < 12) { gone = 0; continue; }
            if (s is not null && _navAt.TryGetValue(s, out var navAt) && (DateTime.UtcNow - navAt).TotalSeconds < 15) { gone = 0; continue; }   // the next episode loading
            if (++gone < 2) continue;
            gone = 0;
            if (VideoHubOpen || StageCurtain.Visibility == Visibility.Visible || _asSession) continue;
            LogLine("watch home: no title on the screen - back to Watch");
            HideStageBar();
            await ShowVideoHubAsync();
        }
    }

    private string? _pipSlot;
    private async Task FocusScreenAsync()
    {
        try
        {
            var sv = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject;
            var slot = (sv?["screen"] as JsonObject)?["slot"]?.GetValue<string>();
            if (slot is not null) _surfaces.FocusTile(slot);
        }
        catch { }
    }
    public void CloseVideoHub()
    {
        if (_videoHub is null) return;
        var focusScreen = _pipSlot is null;
        var wasPip = EndWatchStack();   // the windows in Watch's places back to their own, never covered: not re-linked below (B-295)
        if (_hubCanvasSize is not null) { TileCanvas.SizeChanged -= _hubCanvasSize; _hubCanvasSize = null; }
        TileCanvas.Children.Remove(_videoHub);
        // keyboard focus back onto the screen's page (2026-09-21): the stage keys ride the page's own prelude, and the Watch page
        // had taken focus with it - after Esc out of it, Space did nothing until the picture was clicked
        if (focusScreen && WatchGrip.Visibility == Visibility.Visible) _ = FocusScreenAsync();
        _videoHub = null;
        _hubSearch = null;
        // B-295: the windows Watch covered come back as empty frames unless their views present afresh - and the windows that were in Watch's
        // places too (2026-09-28, "The video page wasn't covering, in fact it was Watch that was on the screen": after Show video the big window,
        // grown from Watch's corner to the whole window, came back see-through, a still of Watch showing through it while its page took the
        // clicks). They were left out because a re-link put Peacock's own controls back; those are hidden always now.
        _ = wasPip;
        _surfaces.NudgeSoon();
        _hubCur = null;
        SyncEmptyStage();   // nothing on the screens: the empty stage, not a service's home page
        LogLine("video hub: closed");
    }

    /// <summary>The services' rows shown or hidden in place on the Watch page now up (null where there are none).</summary>
    private Action? _suggToggle;
    /// <summary>The Watch page's now-playing line in its head: set in place when the screens are cleared (no page redraw).</summary>
    private StackPanel? _hubHeadLine;
    private bool SuggestionsOn
    {
        get { try { return HostPrefs.GetBool(SuggestionsPref, false); } catch { return false; } }
        set { try { HostPrefs.Set(SuggestionsPref, value); } catch { } }
    }

    /// <summary>Open (or rebuild) the menu from core's current word (videoMenu + videoState).</summary>
    public async Task ShowVideoHubAsync()
    {
        JsonObject? menu = null; JsonArray? vs = null;
        try
        {
            menu = JsonNode.Parse(await ModelCallAsync("videoMenu") ?? "null") as JsonObject;
            // at boot core is still reading the kept rows: wait for them (6 s at most) so the page opens once, full - not empty and then
            // replaced (2026-09-24, "Would like to not see this whole page refresh on relaunch")
            for (var w = 0; w < 40 && menu?["ready"]?.GetValue<bool>() == false; w++)
            {
                await Task.Delay(150);
                menu = JsonNode.Parse(await ModelCallAsync("videoMenu") ?? "null") as JsonObject;
            }
            vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray;
        }
        catch (Exception e) { LogLine("video hub: " + e.Message); }
        if (menu?["services"] is not JsonArray services || services.Count == 0) { SetPill("Prism · no video service yet. Add one from Apps"); return; }
        await MvCallAsync("state");
        CloseVideoHub();
        HideStageBar();
        _hubLines.Clear(); _hubLensHead = null; _hubLensPending.Clear(); _liveRows.Clear(); _svcDots.Clear();
        if (_asSession) { await FinishAppSetupAsync(save: false); }   // a setup page under the menu is a trap (the Watch tab pressed mid-sign-in ends the setup instead)
        CloseRail();   // the rail is a full-screen overlay one layer down (z 900): left open it shows through and eats the press beneath (seen 2026-09-19)
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        var active = menu["active"]?.GetValue<bool>() == true;
        var screenSlot = (menu["screen"] as JsonObject)?["slot"]?.GetValue<string>();
        var now = menu["now"] is JsonValue nv && nv.TryGetValue<double>(out var nd) ? nd : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        JsonObject? tile = null;
        if (vs is not null && screenSlot is not null) foreach (var t in vs) if (t is JsonObject o && o["id"]?.GetValue<string>() == screenSlot) tile = o;
        var onName = "";
        foreach (var s in services) if (s is JsonObject so && so["onScreen"]?.GetValue<bool>() == true) onName = S(so, "name");

        // opaque: the menu is a page of its own, nothing beneath it shows through (the boot welcome did, 2026-09-19). The arrow
        // keys are handled here, item by item (XY focus jumped spatially across scrolling rows - "it should be each focusable
        // item in order", 2026-09-20): Left / Right walk the row, Up / Down go to the nearest item in the row above / below.
        var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x0F, 0x12, 0x16)), XYFocusKeyboardNavigation = XYFocusKeyboardNavigationMode.Disabled };
        WireMvDrag(overlay);   // a held card onto a multiview window; a window out of the strip (2026-09-23)
        overlay.PreviewKeyDown += (_, e) => { if (HubArrow(overlay, e.Key)) e.Handled = true; };   // on the tunnelling pass: a row's ScrollViewer would otherwise take the arrow to scroll and mark it handled (the selection stayed while the row moved, 2026-09-21)
        Canvas.SetZIndex(overlay, VideoHubZ);
        // the picture-in-picture corner (2026-09-21): while a title is on the screen, the screen's own surface is moved into
        // the top right, small, still playing with its sound, and sits ABOVE this page (the page lives in the tile canvas at
        // z 905, the corner's surface at 910): a press there reaches the player itself and its own controls work ("I cant
        // reach the pause or any other controls that are there"); a press anywhere off the cards closes the menu and the
        // screen goes back to full size. Nothing is re-rendered or captured. The page draws a ring around the corner.
        var titleUp = active && TitleUp(tile);
        _hubHeadRule = null;   // this page's own rule, drawn below; never the last page's (2026-10-06: a reopen measured the old one and fell back)
        BuildWatchStack(overlay);   // the big screen and windows 2 to 5 in the corner (2026-09-25, MainWindow.WatchScreens)
        _ = FollowStartingAsync(quitIfIdle: true);   // a title still loading (a pick, or the one resumed after a restart) moves in once it plays (2026-10-06)
        // Watch is the Video player's home (2026-09-22): it closes only onto a title that is up ("why do you still X out of Watch to
        // get to the Netflix player"); with nothing playing there is nothing beneath it to close to
        // a press on the page's empty space no longer closes it (2026-09-25, "if I click in the blank area to the left of Service Suggestions, it goes
        // into the video"): Show video on the control bar is the way out, and Esc / Back
        // the wheel anywhere on the page scrolls it - the side margins too, which lie outside the rows' scroller (2026-09-22)
        overlay.PointerWheelChanged += (_, e) =>
        {
            if (_hubScroller is not { } hs) return;
            // only from outside the rows' own scroller: over a row the row moves alone, over the rows' area the scroller answers itself
            for (var d = e.OriginalSource as DependencyObject; d is not null; d = VisualTreeHelper.GetParent(d)) if (ReferenceEquals(d, hs) || (d is ScrollViewer c && Equals(c.Tag, CarouselTag))) return;
            hs.ChangeView(null, hs.VerticalOffset - e.GetCurrentPoint(hs).Properties.MouseWheelDelta * 1.2, null, false); e.Handled = true;
        };
        foreach (var key in new[] { Windows.System.VirtualKey.Escape, Windows.System.VirtualKey.GoBack })
        {
            var acc = new KeyboardAccelerator { Key = key };
            acc.Invoked += (_, e) => { e.Handled = true; if (titleUp) CloseVideoHub(); };
            overlay.KeyboardAccelerators.Add(acc);
        }
        var page = new Grid { Margin = new Thickness(48, 30, 48, 24) };
        page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        page.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        // ---- head: the title, the screen line with its verbs, the suggestions switch, the close corner
        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        // the tabs drawn as tabs (2026-10-03, "Watch live playlists etc tabs across the top, can we make them look like tabs?"): a rule runs under the
        // whole header, each tab a rounded-top panel standing on it, the open one filled with the card surface and let down over the rule so it
        // joins the page below; the others see-through, their names in ink
        var tabs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Stretch, Margin = new Thickness(0, 0, 28, 0) };
        var headRule = new Border { Height = 1, Background = HubTabRule, VerticalAlignment = VerticalAlignment.Bottom, IsHitTestVisible = false };
        Grid.SetColumnSpan(headRule, 4);
        head.Children.Add(headRule);
        _hubHeadRule = headRule;   // the big window's top sits on it (MainWindow.WatchScreens StackTargetDy)
        void HeadRuleSized(object sender, SizeChangedEventArgs e) { headRule.SizeChanged -= HeadRuleSized; SyncWatchStack(); }   // placed once the rule has its place
        headRule.SizeChanged += HeadRuleSized;
        foreach (var (tabId, tabName) in new[] { ("watch", "Watch"), ("live", "Live"), ("library", "Library"), ("browse", "Browse"), ("playlists", "Playlists") })
        {
            var on = _hubTab == tabId;
            var tab = new Button
            {
                Content = new TextBlock { Text = tabName, FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = on ? HubAmber : HubInk, Opacity = on ? 1 : 0.72 },
                Background = on ? HubCard : HubClear, BorderBrush = on ? HubTabRule : HubClear, BorderThickness = new Thickness(1, 1, 1, 0), CornerRadius = new CornerRadius(10, 10, 0, 0),
                Padding = new Thickness(18, 8, 18, 10), VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, on ? -1 : 0),
            };
            Canvas.SetZIndex(tab, on ? 2 : 1);
            tab.Resources["ButtonBorderBrushPointerOver"] = on ? HubTabRule : HubClear;   // the border stays as drawn through the hover (OwnHover keeps named borders)
            tab.Resources["ButtonBorderBrushPressed"] = on ? HubTabRule : HubClear;
            ToolTipService.SetPlacement(tab, Microsoft.UI.Xaml.Controls.Primitives.PlacementMode.Bottom);   // under the tab, never on the pointer (see Chip)
            if (tabId == "live") ToolTipService.SetToolTip(tab, "Every live channel your services carry, as a schedule. Filter by type, search channels and shows, and send a channel to the big window or a multiview window.");
            else ToolTipService.SetToolTip(tab, tabId == "playlists" ? "Your playlists: episodes and movies in your own order, played one after another. Send titles here from a card's menu or a Details page."
                : tabId == "library" ? "What you own across your services, one card per title, by genre."
                : tabId == "browse" ? "Every genre: your own titles in it, then what TMDB lists on your services - top rated, newest, most voted. Each row says how it is ordered."
                : "Continue watching, your lists, the lenses, live, search.");
            var id2 = tabId;
            tab.Click += (_, __) => { if (_hubTab != id2 || _bingeOpen) { _hubTab = id2; _browseRow = null; _bingeOpen = false; _ = ShowVideoHubAsync(); } };
            OwnHover(tab);
            tabs.Children.Add(tab);
            if (tabId == "playlists")   // the run's tag, on the tab and never over the video (docs/features/playlists.md, 2026-09-27)
            {
                _playlistsTabTag = new TextBlock { Text = _plRunTag ?? "", FontSize = 13, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0), Visibility = _plRunTag is null ? Visibility.Collapsed : Visibility.Visible };
                tabs.Children.Add(_playlistsTabTag);
            }
        }
        // the Prism triangle, large, first on the header: its drop-down is the profile presets (2026-09-24, "This needs to be a large triangle
        // button that lets you drop down and select a preset"); the preset on now named beside it
        tabs.Children.Insert(0, PresetTriangle());
        head.Children.Add(tabs);
        // the Watch page's tools beside the tabs (2026-09-23, "Lets collapse search under a magnifying glass, expand it out when mouse hovers over.
        // Lets replace Multiview with a multi window icon button as well and animate the popout to display the windows")
        var searchSlot = new ContentControl { VerticalAlignment = VerticalAlignment.Center };
        var searchPopSlot = new ContentControl { HorizontalContentAlignment = HorizontalAlignment.Left };   // the search box pops out here, below the header (2026-09-23)
        if (_hubTab is "watch" or "playlists")
        {
            var tools = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(4, 0, 0, 0) };
            if (_hubTab == "watch") tools.Children.Add(MvIconButton());
            // Clear screens moved under the corner's screens (2026-09-25, MainWindow.WatchScreens)
            tools.Children.Add(searchSlot);
            tabs.Children.Add(tools);
        }
        var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        _hubHeadLine = line;
        // the line lives in the header's stretching column, clipped to it: a horizontal StackPanel measures itself without limit and had
        // drawn on under the chips at the right when the window was narrow (2026-09-30, a 1424-wide fresh run: "N..." under Service suggestions)
        var lineHost = new Grid { VerticalAlignment = VerticalAlignment.Stretch, HorizontalAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(0, 0, 12, 0) };
        lineHost.SizeChanged += (sh, se) => lineHost.Clip = new Microsoft.UI.Xaml.Media.RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, Math.Max(0, se.NewSize.Width), Math.Max(0, se.NewSize.Height)) };
        lineHost.Children.Add(line);
        Grid.SetColumn(lineHost, 1);
        // the status line and the big screen's verbs are gone from the header (2026-10-01, "Get rid of the paramount South Park South Park at the
        // top of watch ... these controls should either be within the big window or removed"): the title is the big window's tooltip and the verbs
        // sit on its bar (WatchScreens.PlaceLabel, ScreenVerbs). The line panel is kept, unattached, for the code that still writes to it.
        var headRight = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 0 };
        var suggestions = Chip(new TextBlock { Text = SuggestionsOn ? "Service suggestions: on" : "Service suggestions: off", FontSize = 12, Foreground = SuggestionsOn ? HubAmber : HubDim }, SuggestionsOn);
        ToolTipService.SetToolTip(suggestions, "Each service's own rows (\"Netflix suggests…\"). Off by default: Prism ranks nothing and recommends nothing beyond your own lists and what you watched. On, every row is labeled with the service it came from.");
        // in place (2026-09-25, "why does the whole page have to refresh? Should be able to keep the top 7-8 rows without needing any refresh"): the
        // services' rows are one panel at the bottom, shown or hidden; the page is drawn again only where there is no such panel
        suggestions.Click += (_, __) =>
        {
            SuggestionsOn = !SuggestionsOn;
            if (_suggToggle is not { } toggle) { _ = ShowVideoHubAsync(); return; }
            toggle();
            if (suggestions.Content is TextBlock st) { st.Text = SuggestionsOn ? "Service suggestions: on" : "Service suggestions: off"; st.Foreground = SuggestionsOn ? HubAmber : HubDim; }
            suggestions.Background = SuggestionsOn ? HubChipOn : HubChip;
        };
        headRight.Children.Add(suggestions);
        var gear = Chip(new FontIcon { Glyph = "\uE713", FontSize = 14 }, false);
        ToolTipService.SetToolTip(gear, "Watch settings: the TMDB key, background updates.");
        gear.Margin = new Thickness(8, 0, 0, 0);
        gear.Click += (_, __) => _ = ShowWatchSettingsAsync();
        headRight.Children.Add(gear);
        // Credits (2026-09-24): the sources behind Watch's numbers, TMDB's and JustWatch's marks
        var credits = Chip(new FontIcon { Glyph = "\uE946", FontSize = 14 }, false);
        ToolTipService.SetToolTip(credits, "Credits: Prism by Entangled, plus TMDB, JustWatch and Wikipedia.");
        credits.Margin = new Thickness(8, 0, 0, 0);
        credits.Click += (_, __) => ShowCredits();
        headRight.Children.Add(credits);
        // Show video lives on the control bar under the screens (2026-09-25, "Move <> Show Video under the video window cards on Watch")
        Grid.SetColumn(headRight, 2);
        head.Children.Add(headRight);
        page.Children.Add(head);

        // ---- "Who's watching?" while the service on the screen asks
        var gateRow = new StackPanel { Spacing = 8, Margin = new Thickness(0, 14, 0, 0) };
        Grid.SetRow(gateRow, 1);
        if (_hubTab is "watch" or "playlists") gateRow.Children.Add(searchPopSlot);
        // no Play into row (2026-09-25, "we dont need the play into boxes once we get these new windows functioning"): the corner's places are the
        // windows - a card dragged onto one plays there, a place's title bar dragged trades places or takes it out. A pressed card plays on the big screen
        _mvStrip = null; _mvPop = null;
        if (_hubTab == "watch" && _mvTarget != 0) _ = MvCallAsync("target", "0");
        if (active && tile?["profiles"] is JsonObject prof && prof["gate"]?.GetValue<bool>() == true && prof["profiles"] is JsonArray plist && plist.Count > 0)
        {
            gateRow.Children.Add(RowHead("Who's watching?  ·  " + onName, HubAmber));
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
            foreach (var p in plist)
            {
                if (p is not JsonObject po) continue;
                var pid = S(po, "id"); var pname = S(po, "name"); var avatar = po["avatar"]?.GetValue<string>();
                var cell = new StackPanel { Spacing = 8, Width = 120 };
                var pic = new Border { Width = 96, Height = 96, CornerRadius = new CornerRadius(8), Background = HubCard, HorizontalAlignment = HorizontalAlignment.Center };
                if (avatar is { Length: > 0 }) { try { pic.Child = new Image { Source = new BitmapImage(Services.ArtCache.UriFor(avatar)), Stretch = Stretch.UniformToFill }; } catch { } }
                cell.Children.Add(pic);
                cell.Children.Add(new TextBlock { Text = pname, FontSize = 14, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis });
                var onApp = ""; foreach (var s in services) if (s is JsonObject so2 && so2["onScreen"]?.GetValue<bool>() == true) onApp = S(so2, "app");
                var btn = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(6) };
                ToolTipService.SetToolTip(btn, "Watch as " + pname + " on " + onName + " from now on. Change it any time under Services (right-click the poster, or its profile chip).");
                var (a2, p2, n2) = (onApp, pid, pname);
                btn.Click += (_, __) => { _ = ModelCallAsync("videoProfileChoose", a2, p2); CloseVideoHub(); SetPill("Prism · watching as " + n2 + " on " + onName); };
                row.Children.Add(btn);
            }
            gateRow.Children.Add(row);
        }
        page.Children.Add(gateRow);

        // ---- the five rows (§2), then the labeled suggestions when on
        var rows = new StackPanel { Spacing = 18, Margin = new Thickness(0, 14, 0, 0) };
        _suggToggle = null;
        Button? first = null;
        void Cards(string head, IEnumerable<JsonObject> cards, bool badge, SolidColorBrush ink, string? live = null)
        {
            var list = cards.ToList();
            if (live is null) { if (list.Count == 0) return; rows.Children.Add(RowHead(head, ink)); rows.Children.Add(CardRow(list, badge, now, ref first)); return; }
            // a row the live follow keeps current in place (2026-09-24): its head and its host always there, the head hidden while it is empty
            FrameworkElement headEl = LiveRowHead(head, ink, live, menu, list);   // its order switch, and Continue watching's service chips (2026-09-26)
            headEl.Visibility = list.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            rows.Children.Add(headEl);
            var host = new StackPanel { Background = HubClear, Tag = string.Join("|", list.Select(LiveKey)) };
            host.PointerEntered += (_, __) => _liveOver.Add(live);
            host.PointerExited += (_, __) => _liveOver.Remove(live);
            if (list.Count > 0) host.Children.Add(CardRow(list, badge, now, ref first));
            rows.Children.Add(host);
            _liveRows[live] = (headEl, host, badge);
        }
        // the Library tab's sort (2026-09-22, "sort options for the ... library"; the Watch tab keeps its rows' own order - a global sort there made
        // every lens row look the same): core's four sorts as chips, the chosen one amber; core orders each genre row and remembers the choice on
        // the device - the host never orders. Top rated needs the TMDB key.
        if (_hubTab == "library")
        {
            // the Library tab draws into a panel of its own (2026-09-22): the page goes up first and the rows land here - the read had held
            // the page off the canvas ("I clicked Library and the whole Watch Screen disappeared temporarily")
            var libPanel = new StackPanel { Spacing = 18 };
            rows.Children.Add(libPanel);
            _ = DrawLibraryAsync(libPanel, overlay, now);
        }
        else if (_hubTab == "browse")
        {
            // Browse draws into a panel of its own and redraws only that (2026-09-22): a chip press and the rows arriving had each rebuilt the
            // whole page - "several reloads where the whole watch page disappears and comes back"
            var browsePanel = new StackPanel { Spacing = 18 };
            rows.Children.Add(browsePanel);
            _ = DrawBrowseAsync(browsePanel, overlay, now);   // not awaited: the page is drawn and put up now, the rows land in this panel
        }
        else if (_hubTab == "live")
        {
            // the Live tab (docs/features/live.md, 2026-09-28): the guide as a schedule, in its own panel
            var livePanel = new StackPanel { Spacing = 12 };
            rows.Children.Add(livePanel);
            _ = DrawLiveAsync(livePanel, overlay);
        }
        else if (_hubTab == "playlists")
        {
            // the Playlists screen (docs/features/playlists.md, 2026-09-27): its own panel, where the order is managed
            var plPanel = new StackPanel { Spacing = 14 };
            rows.Children.Add(plPanel);
            _ = DrawPlaylistsAsync(plPanel, overlay);
        }
        else if (_bingeOpen)
        {
            // The Binge in full (2026-09-24): its own panel, the rows below are not drawn
            var bingePanel = new StackPanel { Spacing = 14 };
            rows.Children.Add(bingePanel);
            _ = DrawBingeAsync(bingePanel, overlay);
        }
        else
        {
        Cards("Continue watching", LiveCards(menu, "continue"), true, HubInk, "continue");   // its cards offer Remove on the service (2026-09-22)
        // My list is the TMDB watchlist while an account is linked (MainWindow.Watchlist.cs, 2026-10-03); the services' own lists otherwise
        _watchActive = menu["watchlist"] is JsonObject wl0 && wl0["active"]?.GetValue<bool>() == true;
        if (_watchActive) DrawWatchlistRow(rows, overlay, (JsonObject)menu["watchlist"]!);
        else Cards("My list", LiveCards(menu, "list"), true, HubInk, "list");   // its cards offer Remove on the service (2026-09-23)
        // a service's own rows (2026-10-05, "I would think we'd place followed content somewhere specific, subscribed content somewhere specific"):
        // what the account lists as the person's own - Twitch's Followed channels and their latest videos - a row each, named for the service,
        // always drawn (a suggestion row is the service's pick; these are the person's)
        if (menu["ownRows"] is JsonArray ownRows)
            foreach (var sv in ownRows.OfType<JsonObject>())
            {
                var name = S(sv, "name"); var facet = S(sv, "facet"); var app = S(sv, "app");
                if (sv["rows"] is not JsonArray svRows) continue;
                foreach (var r in svRows.OfType<JsonObject>())
                {
                    if (r["items"] is not JsonArray items || items.Count == 0) continue;
                    // Hide offline (2026-10-06, "Lets add a checkbox on Twitch Followed Channels that says Hide Offline. And if all are offline, then we
                    // might as well hide the whole row and save the space (if this is enabled)"): a row of channels carries the box; its setting is also
                    // in Watch settings, for when the whole row is hidden
                    var all = items.OfType<JsonObject>().ToList();
                    var channels = all.Any(i => S(i, "kind") == "channel");
                    var shown = channels && HideOfflineChannels ? all.Where(i => !ChannelOffline(i)).ToList() : all;
                    if (shown.Count == 0) continue;
                    var cards = shown.Take(48).Select(i => new JsonObject { ["app"] = app, ["service"] = name, ["facet"] = facet, ["item"] = i.DeepClone(), ["recency"] = new JsonObject { ["kind"] = "rank" } }).ToList();
                    var headText = name + "  " + Mid.Trim() + "  " + S(r, "title");
                    if (!channels) { Cards(headText, cards, false, HubInk); continue; }
                    var headRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };
                    headRow.Children.Add(RowHead(headText, HubInk));
                    headRow.Children.Add(HideOfflineBox(13));
                    rows.Children.Add(headRow);
                    rows.Children.Add(CardRow(cards, false, now, ref first));
                }
            }
        // what the person owns lives on the Library tab (2026-09-22): a line here says how much, and takes the person there
        if (menu["owned"] is JsonArray ownedCards && ownedCards.Count > 0)
        {
            var toLib = Chip(new TextBlock { Text = "Library  ·  " + ownedCards.Count + " titles you own, by genre  →", FontSize = 13, Foreground = HubAmber }, false);
            toLib.Click += (_, __) => { _hubTab = "library"; _ = ShowVideoHubAsync(); };
            rows.Children.Add(toLib);
        }
        // section 4a as rows (2026-09-21, "make those rows of carousels to look through below continue watching and my list"): the two
        // rows above keep the person's own order always; each lens is a row of its own here, the household's titles in the lens's
        // order, its three-layer disclosure, source, formula and data date on the row - never in a settings page
        var lensBlock = menu["lens"] as JsonObject;
        var hasKey = lensBlock?["tmdbKey"]?.GetValue<bool>() == true;
        var lensPending = lensBlock?["pending"] is JsonValue pv2 && pv2.TryGetValue<int>(out var pn) ? pn : 0;
        if (menu["lensRows"] is JsonArray lensRows)
            foreach (var lr in lensRows.OfType<JsonObject>())
            {
                var cards = (lr["cards"] as JsonArray)?.OfType<JsonObject>().Take(24).ToList() ?? new List<JsonObject>();
                // a lens that reads the catalog on the household's services (Most read on Wikipedia, 2026-09-22): Browse's cards, the row filled
                // in its own panel while its lists are read - the panel alone, never the page
                if (lr["catalog"]?.GetValue<bool>() == true)
                {
                    var catReading = lr["reading"] is JsonValue crv && crv.TryGetValue<int>(out var crn) && crn > 0;
                    var catCards = (lr["cards"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
                    if (catCards.Count == 0 && !catReading) continue;
                    var catHead = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
                    var catTb = RowHead(CatalogLensShort(lr), HubInk);
                    catHead.Children.Add(catTb);
                    if (S(lr, "id") == "the-binge") BingeHeadOpens(catHead);   // the head opens The Binge in full
                    // the details live in the head's tooltip; the disclosure line stays as the tooltip's text holder, never drawn
                    var catDisc = new TextBlock { Text = CatalogLensTip(lr), Visibility = Visibility.Collapsed };
                    catHead.Background = HubClear;
                    ToolTipService.SetToolTip(catHead, catDisc.Text);
                    catDisc.Tag = catHead;
                    catHead.Children.Add(catDisc);
                    rows.Children.Add(catHead);
                    var catHost = new StackPanel { Tag = string.Join("|", catCards.Select(c => S(c, "id"))), Background = HubClear };
                    // the pointer over the row holds it still while its titles are being placed
                    catHost.PointerEntered += (_, __) => { if (catHost.Tag is string t && !t.StartsWith("over|", StringComparison.Ordinal)) catHost.Tag = "over|" + t; };
                    catHost.PointerExited += (_, __) => { if (catHost.Tag is string t && t.StartsWith("over|", StringComparison.Ordinal)) catHost.Tag = t.Substring(5); };
                    if (catCards.Count > 0) catHost.Children.Add(BrowseRow(catCards, ref first, true));
                    rows.Children.Add(catHost);
                    // the fresh rows run oldest to newest (2026-09-24, "add 'Oldest to Newest' and make Oldest a link for jumping the row all the
                    // way to the left, and newest a link that jumps the carousel row all the way to the right")
                    if (S(lr, "id") is "fresh-episodes" or "fresh-movies") catHead.Children.Insert(1, FreshEnds(catHost));
                    if (catReading) _hubLensPending[S(lr, "id")] = (catTb, catHost, S(lr, "name"), catDisc);
                    continue;
                }
                if (cards.Count == 0 && lensPending == 0) continue;   // nothing the lens can count among these titles
                var date = S(lr, "dataDate") is { Length: > 0 } dd ? dd : "not read yet";
                var lensHead = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
                var headTb = RowHead(S(lr, "name") + (cards.Count == 0 ? "  ·  reading " + lensPending + " title" + (lensPending == 1 ? "" : "s") + "…" : ""), HubInk);
                lensHead.Children.Add(headTb);
                var disclosure = new TextBlock { Text = LensDisclosureLine(lr, date), FontSize = 12, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Bottom, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 1400 };
                ToolTipService.SetToolTip(disclosure, "What is counted: " + S(lr, "counted") + "\nWho is counted: " + S(lr, "who") + "\nWho decides: " + S(lr, "decides") + "\nSource: " + S(lr, "source") + "  ·  " + S(lr, "sourceUrl") + (S(lr, "attribution").Length > 0 ? "\n" + S(lr, "attribution") : ""));
                lensHead.Children.Add(disclosure);
                rows.Children.Add(lensHead);
                if (cards.Count > 0) rows.Children.Add(CardRow(cards, true, now, ref first));
                else { var hostPanel = new StackPanel(); rows.Children.Add(hostPanel); _hubLensPending[S(lr, "id")] = (headTb, hostPanel, S(lr, "name"), disclosure); }
            }
        if (lensBlock is not null && false)   // (2026-09-24: the TMDB key is in Watch settings now - the gear on the header)
        {
            var keyLine = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var keyChip = Chip(new TextBlock { Text = hasKey ? "TMDB key: set" : "TMDB key" + "…", FontSize = 12, Foreground = hasKey ? HubAmber : HubDim }, false);
            // the ratings' disclosure in the key's own tooltip, not a line on the page (2026-09-24, "Move the 'Ratings on cards: TMDB members'
            // mean...' tip as a tooltip under the TMDB key:set")
            var keyTip = "Optional: your own free TMDB account's API key (personal use), kept on this device and sent to TMDB alone. It turns on ratings on cards, the Most read row across your services, Browse's catalog rows, the catalog search and the Episodes menu's list for services that cannot list their own.";
            if (hasKey && lensBlock["attribution"]?.GetValue<string>() is { Length: > 0 } attrTip)
                keyTip = "Ratings on cards: TMDB members' mean vote with the vote count, read under your key. " + attrTip + (lensPending > 0 ? "\n\nReading " + lensPending + " title" + (lensPending == 1 ? "" : "s") + " now." : "") + "\n\n" + keyTip;
            ToolTipService.SetToolTip(keyChip, keyTip);
            keyChip.Click += (_, __) => { _hubKeyEntry = !_hubKeyEntry; _ = ShowVideoHubAsync(); };
            keyLine.Children.Add(keyChip);
            rows.Children.Add(keyLine);
            if (_hubKeyEntry)
            {
                var keyRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
                var keyBox = new PasswordBox { PlaceholderText = "TMDB API key or read access token", Width = 420, FontSize = 13 };
                var save = Chip(new TextBlock { Text = "Save", FontSize = 13, Foreground = HubInk }, false);
                save.Click += (_, __) => { var k = keyBox.Password?.Trim() ?? ""; if (k.Length == 0) return; _hubKeyEntry = false; _ = ModelCallAsync("lensSetTmdbKey", k).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => { SetPill("Prism · TMDB key saved on this device"); _ = ShowVideoHubAsync(); })); };
                var clear = Chip(new TextBlock { Text = "Clear", FontSize = 13, Foreground = HubDim }, false); clear.IsEnabled = hasKey;
                clear.Click += (_, __) => { _hubKeyEntry = false; _ = ModelCallAsync("lensSetTmdbKey", (string?)null).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => { SetPill("Prism · TMDB key cleared"); _ = ShowVideoHubAsync(); })); };
                keyRow.Children.Add(keyBox); keyRow.Children.Add(save); keyRow.Children.Add(clear);
                keyRow.Children.Add(new TextBlock { Text = "A free personal key from your own TMDB account: themoviedb.org → Settings → API. " + (lensBlock["attribution"]?.GetValue<string>() ?? ""), FontSize = 11, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap, MaxWidth = 700 });
                rows.Children.Add(keyRow);
            }
        }
        // the sources answer in the background: the lines under the cards follow them in place; nothing is rebuilt under a person
        if (lensBlock is not null && lensPending > 0) _ = FollowHubAsync(overlay);
        // live channels are the Live tab's (docs/features/live.md, 2026-09-28, "make sure any LIVE items on watch get moved into the Live tab"):
        // a line here says how many, and takes the person there
        if (menu["live"] is JsonArray live)
        {
            var nLive = live.OfType<JsonObject>().Sum(l => (l["channels"] as JsonArray)?.Count ?? 0);
            if (nLive > 0)
            {
                var toLive = Chip(new TextBlock { Text = "Live" + Mid + nLive + " channels, as a schedule  " + (char)0x2192, FontSize = 13, Foreground = HubAmber }, false);
                toLive.Click += (_, __) => { _hubTab = "live"; _ = ShowVideoHubAsync(); };
                rows.Children.Add(toLive);
            }
        }
        // Services: every service the household has, as posters - tap enters it natively (sign in where needed)
        rows.Children.Add(RowHead("Services", HubInk));
        var posters = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        foreach (var s in services)
        {
            if (s is not JsonObject so) continue;
            var facet = S(so, "facet"); var app = S(so, "app"); var name = S(so, "name"); var signedIn = S(so, "status") == "signed-in";
            var on = active && so["onScreen"]?.GetValue<bool>() == true;
            // drawn, every one the same shape (2026-09-25, "is there not a rectangular logo item for each service?"): its icon, its name, its colour
            var poster = ServiceTile(app, name, on, grey: !signedIn);   // a service not signed in in greyscale (2026-10-03)
            var dot = new Border { Width = 12, Height = 12, CornerRadius = new CornerRadius(6), Background = HubAmber, BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0xCC, 0x0F, 0x12, 0x16)), BorderThickness = new Thickness(2), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(8), Visibility = Visibility.Collapsed };
            poster.Children.Add(dot);
            var cell = new StackPanel { Spacing = 6, Width = 210 };
            cell.Children.Add(poster);
            cell.Children.Add(new TextBlock { Text = on ? "On the screen" : signedIn ? "" : "Sign in first", FontSize = 12, Foreground = on ? HubAmber : signedIn ? HubInk : HubDim, TextTrimming = TextTrimming.CharacterEllipsis });
            var b = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(4), VerticalAlignment = VerticalAlignment.Top };   // a cell with a profile chip is taller: the posters stay on one line
            var tipBase = on ? name + " is on the screen. Press for its profiles and its own page." : signedIn ? name + ": press for who watches, or its own page." : name + " is not signed in yet: opens its sign-in page.";
            ToolTipService.SetToolTip(b, tipBase);
            _svcDots[app] = (dot, b, tipBase);
            // a signed-in service's own pages are not a place to sit (2026-09-23, "the video player should send me back to watch, not have me
            // sitting on apple tv's home page"): the screen switches to it and Watch stays up to pick from; signing in still happens on its page
            // not signed in: its sign-in page straight away, the window growing out of the card (2026-10-03)
            // a press is a menu, not a switch (2026-10-05, "We really don't provide anything useful by doing that, just pop up the profile selection menu
            // but also include an item to visit the site in case they want to change their login"): the profiles the service has shown, and its own page;
            // a service not signed in still goes straight to its sign-in page, the window growing out of the card (2026-10-03)
            var svcMenu = new MenuFlyout { Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Top };
            b.Click += (_, __) => { if (!signedIn) { ExpandFrom(poster); CloseVideoHub(); OpenRoute("prism://app/" + Uri.EscapeDataString(app) + "/setup?return=scene&signin=1"); return; } svcMenu.ShowAt(b); };
            // the profile, a plain choice under the service (2026-09-19): the profiles the service has shown the wall, with
            // their pictures; a pick stands until another is made (core keeps it and answers the gate wherever it shows)
            if (so["profiles"] is JsonArray plist2 && plist2.Count > 0)
            {
                var choice = so["profile"] as JsonObject;
                var chosen = choice is null ? "" : S(choice, "name");
                var flyout = svcMenu;
                foreach (var p in plist2.OfType<JsonObject>())
                {
                    var pid = S(p, "id"); var pname = S(p, "name"); var avatar = p["avatar"]?.GetValue<string>();
                    var it = new ToggleMenuFlyoutItem { Text = "Watch as " + pname, IsChecked = choice is not null && S(choice, "id") == pid };
                    if (avatar is { Length: > 0 }) { try { it.Icon = new BitmapIcon { UriSource = new Uri(avatar), ShowAsMonochrome = false }; } catch { } }
                    var (a3, p3, n3) = (app, pid, pname);
                    it.Click += (_, __) => { _ = ModelCallAsync("videoProfileChoose", a3, p3).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => { SetPill("Prism · " + name + " watches as " + n3 + " from now on"); _ = ShowVideoHubAsync(); })); };
                    flyout.Items.Add(it);
                }
                flyout.Items.Add(new MenuFlyoutSeparator());
                var ask = new MenuFlyoutItem { Text = "Ask each time", IsEnabled = choice is not null, Icon = new FontIcon { Glyph = "\uE897" } };
                ToolTipService.SetToolTip(ask, "The choice is forgotten: " + name + " asks who is watching, and you answer on its page or here.");
                var a4 = app;
                ask.Click += (_, __) => { _ = ModelCallAsync("videoProfileAsk", a4).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => { SetPill("Prism · " + name + " will ask who is watching"); _ = ShowVideoHubAsync(); })); };
                flyout.Items.Add(ask);
                b.ContextFlyout = flyout;   // right-click / the remote's menu key on the poster
                var chip = Chip(new TextBlock { Text = chosen.Length > 0 ? "as " + chosen : "Who's watching?", FontSize = 11, Foreground = chosen.Length > 0 ? HubAmber : HubDim }, chosen.Length > 0);
                chip.HorizontalAlignment = HorizontalAlignment.Left; chip.Padding = new Thickness(10, 3, 10, 3);
                ToolTipService.SetToolTip(chip, chosen.Length > 0 ? name + " watches as " + chosen + ". Pick another, or Ask each time." : "Pick the profile " + name + " watches as; it stands until you pick another.");
                chip.Click += (_, __) => flyout.ShowAt(chip);
                cell.Children.Add(chip);
            }
            if (signedIn)
            {
                if (svcMenu.Items.Count > 0) svcMenu.Items.Add(new MenuFlyoutSeparator());
                var open = new MenuFlyoutItem { Text = "Open " + name + "'s own page" + Mid + "sign in as someone else", Icon = new FontIcon { Glyph = "\uE8A7" } };
                ToolTipService.SetToolTip(open, name + "'s own page in the setup window: change the sign-in, or look around. What is playing keeps playing.");
                var (ao, po) = (app, poster);
                open.Click += (_, __) => { ExpandFrom(po); CloseVideoHub(); OpenRoute("prism://app/" + Uri.EscapeDataString(ao) + "/setup?return=scene&signin=1"); };
                svcMenu.Items.Add(open);
                if (on) { var here = new MenuFlyoutItem { Text = name + " is on the screen", Foreground = HubInk, IsHitTestVisible = false }; svcMenu.Items.Insert(0, here); }   // a label in ink, never a disabled row (CLAUDE.md, host UI contrast)
            }
            posters.Children.Add(b);
            first ??= b;
        }
        rows.Children.Add(Carousel(posters));
        // the services' own rows, only when the household asked, each labeled by its source
        if (menu["suggestions"] is JsonArray sugg)
        {
            // their own panel, filled the first time they are shown
            var suggPanel = new StackPanel { Spacing = 18, Visibility = SuggestionsOn ? Visibility.Visible : Visibility.Collapsed };
            rows.Children.Add(suggPanel);
            void FillSuggestions()
            {
                if (suggPanel.Children.Count > 0) return;
                var at = rows.Children.Count;
                SuggestionRows(sugg);
                while (rows.Children.Count > at) { var el = rows.Children[at]; rows.Children.RemoveAt(at); suggPanel.Children.Add(el); }
            }
            if (SuggestionsOn) FillSuggestions();
            _suggToggle = () => { if (SuggestionsOn) FillSuggestions(); suggPanel.Visibility = SuggestionsOn ? Visibility.Visible : Visibility.Collapsed; };
        }
        void SuggestionRows(JsonArray sugg)
        {
            foreach (var sv in sugg.OfType<JsonObject>())
            {
                var name = S(sv, "name"); var facet = S(sv, "facet"); var app = S(sv, "app");
                if (sv["shelves"] is not JsonArray shelves) continue;
                foreach (var sh in shelves.OfType<JsonObject>())
                {
                    if (sh["items"] is not JsonArray items || items.Count == 0) continue;
                    var cards = items.OfType<JsonObject>().Take(24).Select(i => new JsonObject { ["app"] = app, ["service"] = name, ["facet"] = facet, ["item"] = i.DeepClone(), ["recency"] = new JsonObject { ["kind"] = "rank" } }).ToList();
                    Cards(name + " suggests  ·  " + S(sh, "title"), cards, false, HubDim);
                }
            }
        }
        }
        // search on the Playlists tab too (2026-09-27, "The search icon isnt available on the playlists screen but I see no reason for that")
        if (_hubTab is "watch" or "playlists")
        {
        // Search: the words, then a chip per service that has a search address - each opens that service's own search
        if (menu["search"] is JsonArray search && search.Count > 0)
        {
            var searchAt = rows.Children.Count;
            var srow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var box = new TextBox { PlaceholderText = "a title, a person, a word…", Width = 320, FontSize = 14, VerticalAlignment = VerticalAlignment.Center };
            srow.Children.Add(box);
            var svcRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Visibility = Visibility.Collapsed };
            var results = new StackPanel { Spacing = 8 };
            var everywhere = Chip(new TextBlock { Text = "Search everywhere", FontSize = 13, Foreground = HubAmber }, true);
            ToolTipService.SetToolTip(everywhere, "Every signed-in service searched at once, in the background; the results come back here as one row, each marked with its service.");
            Action lookup = () => { var q = box.Text?.Trim() ?? ""; if (q.Length == 0) { box.Focus(FocusState.Programmatic); return; } _ = LookupAsync(q, results, overlay); };
            everywhere.Click += (_, __) => lookup();
            // search as you type (2026-09-22, "make search work well"): with a TMDB key the catalog answers in about a second, so the
            // row follows the words after a pause in typing; without a key a search asks every service's page, so it waits for Enter
            var typeKey = (menu["lens"] as JsonObject)?["tmdbKey"]?.GetValue<bool>() == true;
            if (typeKey)
            {
                var typed = 0;
                box.TextChanged += async (_, __) =>
                {
                    var n = ++typed; var q = box.Text?.Trim() ?? "";
                    if (q.Length < 2) return;
                    await Task.Delay(450);
                    if (n != typed || !ReferenceEquals(_videoHub, overlay) || (box.Text?.Trim() ?? "") != q) return;
                    _ = LookupAsync(q, results, overlay);
                };
            }
            _hubSearch = q2 => { box.Text = q2; lookup(); };
            _hubPersonSearch = (pid, pname) => { box.Text = pname; _ = LookupAsync(pname, results, overlay, pid); };
            srow.Children.Add(everywhere);
            everywhere.VerticalAlignment = VerticalAlignment.Center;
            // a plain Clear beside it (2026-09-24, "Can you give me a clear search button next to search anywhere? Would just be more obvious
            // than the X inside the field"): shown while there are words; the words and results go, the box stays ready for new ones
            var clear = Chip(new TextBlock { Text = "Clear", FontSize = 13, Foreground = HubInk }, false);
            clear.VerticalAlignment = VerticalAlignment.Center;
            clear.Visibility = Visibility.Collapsed;
            ToolTipService.SetToolTip(clear, "Clear the words and the results (Esc does the same).");
            srow.Children.Add(clear);
            Action? firstSearch = lookup;
            // the services as their symbols, each ticked: untick the ones not wanted in the results (2026-09-23, "Just throw all of the logo images
            // up there with checkmarks next to each by default. That way they uncheck the services they dont want. Add a quick uncheck all option");
            // a right-click still opens that service's own search page
            svcRow.Children.Add(new TextBlock { Text = "Services", FontSize = 12, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 4, 0) });
            var ticks = new List<(string app, Border check)>();
            void Tick(Border check, bool on) { check.Background = on ? HubAmber : HubChip; check.BorderBrush = on ? HubAmber : HubDim; ((FontIcon)check.Child).Opacity = on ? 1 : 0; }
            foreach (var s in search.OfType<JsonObject>())
            {
                var name = S(s, "name"); var facet = S(s, "facet"); var app = S(s, "app");
                var check = new Border { Width = 16, Height = 16, CornerRadius = new CornerRadius(4), BorderThickness = new Thickness(1.5), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, -5, -5),
                    Child = new FontIcon { Glyph = "\uE73E", FontSize = 11, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x0F, 0x12, 0x16)) } };
                Tick(check, !_searchOff.Contains(app));
                var cell = new Grid { Width = 36, Height = 36 };
                cell.Children.Add(ServiceMark(app, name, 32));
                cell.Children.Add(check);
                var tb = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(4) };
                ToolTipService.SetToolTip(tb, name + ": " + (_searchOff.Contains(app) ? "left out" : "included") + " - press to " + (_searchOff.Contains(app) ? "include" : "leave out") + ". Right-click: " + name + "'s own search page.");
                var (a2, n2, f2) = (app, name, facet);
                tb.Click += (_, __) =>
                {
                    if (!_searchOff.Remove(a2)) _searchOff.Add(a2);
                    Tick(check, !_searchOff.Contains(a2));
                    ToolTipService.SetToolTip(tb, n2 + ": " + (_searchOff.Contains(a2) ? "left out" : "included") + " - press to " + (_searchOff.Contains(a2) ? "include" : "leave out") + ". Right-click: " + n2 + "'s own search page.");
                    _redrawSearch?.Invoke();
                };
                var own = new MenuFlyout();
                var oi = new MenuFlyoutItem { Text = "Search on " + name + "'s own page" };
                oi.Click += (_, __) => { var q = box.Text?.Trim() ?? ""; if (q.Length == 0) { box.Focus(FocusState.Programmatic); return; } CloseVideoHub(); _ = SearchOnAsync(f2, q, n2); };
                own.Items.Add(oi);
                tb.ContextFlyout = own;
                ticks.Add((app, check));
                svcRow.Children.Add(tb);
            }
            var all = Chip(new TextBlock { Text = _searchOff.Count == 0 ? "Uncheck all" : "Check all", FontSize = 12, Foreground = HubInk }, false);
            all.VerticalAlignment = VerticalAlignment.Center; all.Margin = new Thickness(8, 0, 0, 0);
            ToolTipService.SetToolTip(all, "Every service in, or every service out (then tick the few you want).");
            all.Click += (_, __) =>
            {
                var none = _searchOff.Count == 0;
                _searchOff.Clear();
                if (none) foreach (var (a, _) in ticks) _searchOff.Add(a);
                foreach (var (a, c) in ticks) Tick(c, !_searchOff.Contains(a));
                ((TextBlock)all.Content).Text = _searchOff.Count == 0 ? "Uncheck all" : "Check all";
                _redrawSearch?.Invoke();
            };
            svcRow.Children.Add(all);
            box.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter && firstSearch is not null) { e.Handled = true; firstSearch(); } };
            // the drawer: the magnifier alone until the pointer comes over it (or it is pressed); open while there are words or the box has focus
            var mag = Chip(new FontIcon { Glyph = "\uE721", FontSize = 17, Foreground = HubInk }, false);
            mag.Width = 40; mag.Height = 40; mag.Padding = new Thickness(0); mag.CornerRadius = new CornerRadius(20);
            ToolTipService.SetToolTip(mag, "Search for a title, a person or a word. Your lists come first, then every service you have.");
            // the box pops out BELOW the header, as multiview's windows do ("Lets have the search expand below just like multiview does. Right now it
            // opens to the side and collides with other buttons", 2026-09-23): it slides down and fades up, the box then its chips a beat apart
            srow.HorizontalAlignment = HorizontalAlignment.Left;
            var pop = new Border { Child = srow, Visibility = Visibility.Collapsed, Opacity = 0, RenderTransform = new TranslateTransform(), Margin = new Thickness(0, 2, 0, 4), Background = HubClear };
            searchPopSlot.Content = pop;
            var expander = mag;
            // the results in a modal over the page, under the header so the words stay in reach (2026-09-23, "the search results should expand into a
            // modal window with the full Details page available for any items you want to look at"); a card's press opens its Details, whose
            // "Where to watch" logos play it in the big window
            var modalPanel = new StackPanel { Spacing = 10 };
            var modalCard = new Border
            {
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x14, 0x17, 0x1D)), CornerRadius = new CornerRadius(14),
                BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x55, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(1), Margin = new Thickness(24, 8, 24, 24),
                Child = new ScrollViewer { Content = modalPanel, Padding = new Thickness(28, 20, 28, 24), VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled },
            };
            var modal = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xC8, 0x05, 0x06, 0x09)), Margin = new Thickness(0, 128, 0, 0), Visibility = Visibility.Collapsed };   // under the header and the search strip
            modal.Children.Add(modalCard);
            Canvas.SetZIndex(modal, 50);
            var open = false;
            void Slide(bool to)
            {
                if (open == to) return;
                open = to;
                var sb = new Microsoft.UI.Xaml.Media.Animation.Storyboard();
                void A(DependencyObject target, string prop, double from, double toV, int ms, int delay = 0)
                {
                    var a = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { From = from, To = toV, Duration = TimeSpan.FromMilliseconds(ms), BeginTime = TimeSpan.FromMilliseconds(delay), EasingFunction = new Microsoft.UI.Xaml.Media.Animation.CubicEase { EasingMode = Microsoft.UI.Xaml.Media.Animation.EasingMode.EaseOut } };
                    Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(a, target); Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(a, prop);
                    sb.Children.Add(a);
                }
                if (to)
                {
                    pop.Visibility = Visibility.Visible;
                    A(pop, "Opacity", 0, 1, 160);
                    A(pop.RenderTransform, "Y", -14, 0, 220);
                    var i = 0;
                    foreach (var child in srow.Children.OfType<FrameworkElement>())
                    {
                        child.RenderTransform = new TranslateTransform();
                        A(child, "Opacity", 0, 1, 180, 40 + i * 55);
                        A(child.RenderTransform, "X", -18, 0, 240, 40 + i * 55);
                        i++;
                    }
                }
                else
                {
                    A(pop, "Opacity", 1, 0, 120);
                    sb.Completed += (_, __) => { if (!open) pop.Visibility = Visibility.Collapsed; };
                }
                sb.Begin();
                mag.Background = to ? HubChipOn : HubChip;
                PlaceModal();
            }
            // the results start under the search strip, wherever it ends (2026-09-25, "When the search results come up, they're covering up the search
            // input box"): a fixed 128 px from the top had fallen above the box once the header grew and the service chips wrapped
            void PlaceModal()
            {
                double top = 92;
                try
                {
                    if (open && pop.ActualHeight > 0) top = pop.TransformToVisual(overlay).TransformPoint(new Windows.Foundation.Point(0, pop.ActualHeight)).Y + 6;
                    else if (head.ActualHeight > 0) top = head.TransformToVisual(overlay).TransformPoint(new Windows.Foundation.Point(0, head.ActualHeight)).Y + 6;
                }
                catch { }
                if (Math.Abs(modal.Margin.Top - top) > 0.5) modal.Margin = new Thickness(0, Math.Round(top), 0, 0);
            }
            pop.SizeChanged += (_, __) => PlaceModal();
            modal.RegisterPropertyChangedCallback(UIElement.VisibilityProperty, (_, __) => PlaceModal());
            bool Wanted() => (box.Text?.Trim() ?? "").Length > 0 || box.FocusState != FocusState.Unfocused;
            var over = false;
            async void Leave() { over = false; await Task.Delay(500); if (!Wanted() && !over) Slide(false); }
            mag.PointerEntered += (_, __) => { over = true; Slide(true); };
            mag.PointerExited += (_, __) => Leave();
            pop.PointerEntered += (_, __) => over = true;
            pop.PointerExited += (_, __) => Leave();
            mag.Click += (_, __) => { Slide(true); box.Focus(FocusState.Programmatic); };
            box.GotFocus += (_, __) => Slide(true);
            box.LostFocus += async (_, __) => { await Task.Delay(200); if (!Wanted()) Slide(false); };
            var svcCar = Carousel(svcRow); svcCar.Visibility = Visibility.Collapsed; svcRow.Visibility = Visibility.Visible;   // no gap while there are no words
            void ClearSearch()
            {
                _hubSearchGen++;
                results.Children.Clear();
                modal.Visibility = Visibility.Collapsed;
                svcCar.Visibility = Visibility.Collapsed;
                if ((box.Text ?? "").Length > 0) box.Text = "";
                if (box.FocusState == FocusState.Unfocused && !over) Slide(false);
            }
            box.TextChanged += (_, __) =>
            {
                var any = (box.Text?.Trim() ?? "").Length > 0;
                clear.Visibility = (box.Text ?? "").Length > 0 ? Visibility.Visible : Visibility.Collapsed;
                if (!any) { ClearSearch(); return; }
                svcCar.Visibility = Visibility.Visible; modal.Visibility = Visibility.Visible; Slide(true);
            };
            clear.Click += (_, __) => { ClearSearch(); box.Focus(FocusState.Programmatic); Slide(true); };
            box.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Escape && (box.Text ?? "").Length > 0) { e.Handled = true; ClearSearch(); } };
            // a press on the page away from the search (the drawer, its results, the service chips) ends it
            overlay.AddHandler(UIElement.PointerPressedEvent, new Microsoft.UI.Xaml.Input.PointerEventHandler((_, e) =>
            {
                if (results.Children.Count == 0 && (box.Text ?? "").Length == 0) return;
                for (var d = e.OriginalSource as DependencyObject; d is not null; d = VisualTreeHelper.GetParent(d))
                    if (ReferenceEquals(d, modalCard) || ReferenceEquals(d, expander) || ReferenceEquals(d, pop)) return;
                ClearSearch();
                DropSearchFocus(box);
                Slide(false);
            }), true);
            searchSlot.Content = expander;
            modalPanel.Children.Add(svcCar);
            if (!typeKey)
                modalPanel.Children.Add(new TextBlock { Text = "A free TMDB key makes search exact: titles matched to your services as you type, people's films and shows, ratings and two more rows · themoviedb.org → Settings → API, then 'TMDB key…' below the rows.", FontSize = 12, Foreground = HubDim, TextWrapping = TextWrapping.Wrap, MaxWidth = 1100 });
            modalPanel.Children.Add(results);
            // any search that starts shows the strip and the results (a dev search sets the words in code, and the box's TextChanged does not always follow)
            results.Tag = new Action(() => { modal.Visibility = Visibility.Visible; Slide(true); });
            var escM = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
            escM.Invoked += (_, e) => { e.Handled = true; ClearSearch(); DropSearchFocus(box); Slide(false); };
            modal.KeyboardAccelerators.Add(escM);
            overlay.Children.Add(modal);
        }
        }
        if (_hubTab == "watch" && rows.Children.Count <= 2) rows.Children.Add(new TextBlock { Text = "Watch something on a service once and it appears here. Nothing is ranked or recommended by Prism: rows are your own lists and what you watched, newest first.", FontSize = 13, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
        if (_hubTab == "watch") AddPerfPanel(rows);   // the performance stats at the foot, when on (MainWindow.PerfPanel, 2026-10-03)
        var scroller = new ScrollViewer { Content = rows, VerticalScrollBarVisibility = ScrollBarVisibility.Hidden, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        _hubScroller = scroller;   // no bars anywhere on the page: the rows are carousels the arrows (or a wheel, a swipe) move, the focused card brought to the centre (2026-09-21)
        Grid.SetRow(scroller, 2);
        page.Children.Add(scroller);
        {
            // the corner's clearance ("The pip miniplayer is behind some of the Watch menu/content items. Watch your
            // collisions", 2026-09-21): the page draws above the hole, so nothing of the page may be laid out in the corner's
            // band - the head, the lens strip, and every row whose vertical extent meets the corner end before it (a right
            // margin the corner's width); rows below it keep the full width. Walked again on a resize, a change of the
            // rows, and the page's vertical scroll, and only margins that differ are written (no layout loop).
            var origRight = new Dictionary<FrameworkElement, double>();
            var origTop = new Dictionary<FrameworkElement, double>();
            void Clearance()
            {
                // every row at the same spacing (2026-09-26, "I dont like the big gap between continue and my list. Cant you make it uniform and just shorten
                // the carousel like you do on the continue watching"): no row is pushed below the corner any more; the rows beside it end before it
                var pipW = StackWidth(overlay.ActualWidth);
                if (!ReferenceEquals(_videoHub, overlay) || pipW <= 0 || StackBottom <= 0) return;
                var holeTop = 24.0; var holeBottom = ShownStackBottom();   // the control bar, the big screen and the windows shown under it
                IEnumerable<FrameworkElement> Candidates()
                {
                    foreach (var c in page.Children.OfType<FrameworkElement>())
                    {
                        if (c is ScrollViewer) continue;
                        if (c is StackPanel sp) { foreach (var cc in sp.Children.OfType<FrameworkElement>()) yield return cc; }
                        else yield return c;
                    }
                    foreach (var r in rows.Children.OfType<FrameworkElement>()) yield return r;
                }
                foreach (var e in Candidates())
                {
                    if (e.ActualHeight <= 0 || e.ActualWidth <= 0) continue;
                    Windows.Foundation.Rect b;
                    try { b = e.TransformToVisual(overlay).TransformBounds(new Windows.Foundation.Rect(0, 0, e.ActualWidth, e.ActualHeight)); } catch { continue; }
                    var inBand = b.Top < holeBottom + 12 && b.Bottom > holeTop - 12;
                    if (!origRight.TryGetValue(e, out var orig)) { orig = e.Margin.Right; origRight[e] = orig; }
                    var want = inBand ? orig + pipW + 8 : orig;
                    if (Math.Abs(e.Margin.Right - want) > 0.5) { s_devLog?.Invoke("clearance margin " + e.GetType().Name + " -> " + want); e.Margin = new Thickness(e.Margin.Left, e.Margin.Top, want, e.Margin.Bottom); }
                }
            }
            // the row after the first starts below the corner (2026-09-25, "hoping the continue watching pushes my list down a little bit so it
            // (my list) is no longer cut short by the video previews on the right"): Continue watching stays beside the screens, My list begins under
            // them at its full width. Measured in the rows' own coordinates, so a scroll never moves it
            void PushBelowStack()
            {
                if (_hubTab != "watch" || StackBottom <= 0) return;
                FrameworkElement? target = null; var seenCards = false;
                foreach (var e in rows.Children.OfType<FrameworkElement>())
                {
                    if (e.Visibility != Visibility.Visible || e.ActualHeight <= 0) continue;
                    if (!seenCards) { if (e.ActualHeight > 100) seenCards = true; continue; }
                    target = e; break;
                }
                if (target is null) return;
                try
                {
                    if (!origTop.TryGetValue(target, out var o)) { o = target.Margin.Top; origTop[target] = o; }
                    var inRows = target.TransformToVisual(rows).TransformPoint(new Windows.Foundation.Point(0, 0)).Y - (target.Margin.Top - o);
                    var rowsAtTop = rows.TransformToVisual(overlay).TransformPoint(new Windows.Foundation.Point(0, 0)).Y + scroller.VerticalOffset;
                    var want = o + Math.Max(0, Math.Round(StackBottom + 16 - (rowsAtTop + inRows)));
                    if (Math.Abs(target.Margin.Top - want) > 0.5) { s_devLog?.Invoke("push margin -> " + want); target.Margin = new Thickness(target.Margin.Left, want, target.Margin.Right, target.Margin.Bottom); }
                }
                catch { }
            }
            overlay.SizeChanged += (_, __) => Clearance();
            rows.SizeChanged += (_, __) => Clearance();
            scroller.ViewChanged += (_, __) => Clearance();
            overlay.LayoutUpdated += (_, __) => Clearance();
        }
        overlay.Children.Add(page);
        // a canvas child: sized to the canvas by hand, and again when the canvas changes
        overlay.Width = Math.Max(1, TileCanvas.ActualWidth); overlay.Height = Math.Max(1, TileCanvas.ActualHeight);
        Canvas.SetLeft(overlay, 0); Canvas.SetTop(overlay, 0);
        _hubCanvasSize = (_, __) => { if (ReferenceEquals(_videoHub, overlay)) { overlay.Width = Math.Max(1, TileCanvas.ActualWidth); overlay.Height = Math.Max(1, TileCanvas.ActualHeight); } };
        TileCanvas.SizeChanged += _hubCanvasSize;
        TileCanvas.Children.Add(overlay);
        _videoHub = overlay;
        _stayOnVideo = false;   // Watch is open again: its home rule stands
        SyncEmptyStage();   // the stage stands above the canvas: down while Watch is up
        _hubCur = first;
        // the keyboard focus onto the first card once the page is in the tree - deferred, because the press that opened the
        // page (the Watch tab, a pointer on a Border) leaves focus in the service's page, and a focus asked for during that
        // press is refused ("the arrows wouldn't work until I clicked into blank space", 2026-09-21); Keyboard state, so the
        // selection is drawn
        RootGrid.DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () =>
        {
            if (!ReferenceEquals(_videoHub, overlay) || first is null) return;
            var ok = first.Focus(FocusState.Keyboard);
            if (!ok) { overlay.UpdateLayout(); ok = first.Focus(FocusState.Keyboard); }
            LogLine("video hub: focus on the first card " + (ok ? "taken" : "REFUSED"));
        });
        LogLine("video hub: open (" + services.Count + " services, log " + (menu["log"]?.GetValue<int>() ?? 0) + ", suggestions " + (SuggestionsOn ? "on" : "off") + ")");
        if (_hubTab == "watch")
        {
            // what is kept shows now; the services not read in ten minutes are read again, and the two rows follow them in place (2026-09-24)
            _ = ModelCallAsync("videoRefreshStale");
            _ = FollowLiveRowsAsync(overlay);
        }
        _ = WarmTabsAsync();
    }

    private static TextBlock RowHead(string text, SolidColorBrush ink) => new() { Text = text, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = ink };

    /// <summary>The 10-foot walk: every enabled control on the page, grouped into rows by where it sits, in order. Left / Right move
    /// within the row, Up / Down to the nearest item (by x) of the adjacent row; the focused item is brought into its row's view.
    /// A text box keeps Left / Right for its caret. Returns true when the key was taken.</summary>
    private bool HubArrow(Grid overlay, Windows.System.VirtualKey key)
    {
        if (key != Windows.System.VirtualKey.Left && key != Windows.System.VirtualKey.Right && key != Windows.System.VirtualKey.Up && key != Windows.System.VirtualKey.Down) return false;
        var focused = FocusManager.GetFocusedElement(overlay.XamlRoot) as Control;
        var cur = focused is not null && IsInTree(focused, overlay) ? focused : _hubCur;
        if (cur is null || !IsInTree(cur, overlay)) return false;
        if (cur is TextBox or PasswordBox && (key == Windows.System.VirtualKey.Left || key == Windows.System.VirtualKey.Right)) return false;
        // every stop with the ROW it belongs to: the nearest horizontal StackPanel above it (a card row, a strip, the chips, the
        // head line) - a short chip at the top of a tall row is still that row's (Guide beside the channels, 2026-09-20)
        var items = new List<(Control c, Panel row, double x)>();
        void Walk(DependencyObject d)
        {
            var n = VisualTreeHelper.GetChildrenCount(d);
            for (var i = 0; i < n; i++)
            {
                var ch = VisualTreeHelper.GetChild(d, i);
                if (ch is Control c && c.IsEnabled && c.IsTabStop && c.Visibility == Visibility.Visible && c.ActualWidth > 0 && c is Button or TextBox or PasswordBox)
                {
                    var row = RowOf(c, overlay);
                    if (row is not null) { try { var p = c.TransformToVisual(overlay).TransformPoint(new Windows.Foundation.Point(0, 0)); items.Add((c, row, p.X + c.ActualWidth / 2)); } catch { } }
                }
                Walk(ch);
            }
        }
        Walk(overlay);
        if (items.Count == 0) return false;
        LogLine("hub arrow " + key + ": " + items.Count + " stops");
        var me = items.FindIndex(i => ReferenceEquals(i.c, cur));
        if (me < 0) return false;
        var mine = items[me];
        var rowsInOrder = items.Select(i => i.row).Distinct().Select(r => { double y = 0; try { y = r.TransformToVisual(overlay).TransformPoint(new Windows.Foundation.Point(0, 0)).Y; } catch { } return (r, y); }).OrderBy(t => t.y).Select(t => t.r).ToList();
        var row = items.Where(i => ReferenceEquals(i.row, mine.row)).OrderBy(i => i.x).ToList();
        Control? target = null;
        if (key == Windows.System.VirtualKey.Left || key == Windows.System.VirtualKey.Right)
        {
            var at = row.FindIndex(i => ReferenceEquals(i.c, cur));
            var next = at + (key == Windows.System.VirtualKey.Right ? 1 : -1);
            if (next < 0 || next >= row.Count) return true;   // the row's end: stay (nothing wraps, nothing jumps rows)
            target = row[next].c;
        }
        else
        {
            var ri = rowsInOrder.IndexOf(mine.row);
            var ni = ri + (key == Windows.System.VirtualKey.Down ? 1 : -1);
            if (ni < 0 || ni >= rowsInOrder.Count) return true;
            var band = items.Where(i => ReferenceEquals(i.row, rowsInOrder[ni])).ToList();
            target = band.OrderBy(i => Math.Abs(i.x - mine.x)).First().c;
        }
        if (target is null) return true;
        _hubCur = target;
        target.Focus(FocusState.Keyboard);
        try { target.StartBringIntoView(new BringIntoViewOptions { AnimationDesired = true, HorizontalAlignmentRatio = 0.5, VerticalAlignmentRatio = 0.5 }); } catch { }
        return true;
    }
    /// <summary>What has focus, in words (dev): the control's text, or its tooltip.</summary>
    private string DescribeFocus()
    {
        try
        {
            if (_videoHub is null) return "no hub";
            if (FocusManager.GetFocusedElement(_videoHub.XamlRoot) is not FrameworkElement f) { if (_hubCur is null) return "nothing"; f = _hubCur; }
            string Text(DependencyObject d) { if (d is TextBlock tb) return tb.Text; var n = VisualTreeHelper.GetChildrenCount(d); for (var i = 0; i < n; i++) { var t = Text(VisualTreeHelper.GetChild(d, i)); if (t.Length > 0) return t; } return ""; }
            var tip = ToolTipService.GetToolTip(f) as string ?? "";
            return f.GetType().Name + " '" + Shorten(Text(f), 40) + "'" + (tip.Length > 0 ? " (" + Shorten(tip, 40) + ")" : "");
        }
        catch (Exception e) { return "? " + e.Message; }
    }
    /// <summary>The row a stop belongs to: the nearest horizontal StackPanel above it, short of the page; a stop with none is on its own.</summary>
    private static Panel? RowOf(DependencyObject c, DependencyObject root)
    {
        var d = VisualTreeHelper.GetParent(c);
        while (d is not null && !ReferenceEquals(d, root))
        {
            if (d is StackPanel sp && sp.Orientation == Orientation.Horizontal) return sp;
            d = VisualTreeHelper.GetParent(d);
        }
        return c is Panel p ? p : (VisualTreeHelper.GetParent(c) as Panel);
    }
    private static bool IsInTree(DependencyObject? d, DependencyObject root)
    {
        while (d is not null) { if (ReferenceEquals(d, root)) return true; d = VisualTreeHelper.GetParent(d); }
        return false;
    }

    /// <summary>A catalog card's picture (2026-09-22, "some movie posters fit their cards but some do not"): TMDB's landscape backdrop fills the
    /// 16:9 card; a portrait poster alone is shown whole on the card's own ground, never cropped to its middle; a service's own art fills as before.</summary>
    private static void CardArt(Grid art, string? backdrop, string? poster)
    {
        var src = backdrop is { Length: > 0 } ? backdrop : poster;
        if (src is not { Length: > 0 }) return;
        try { art.Children.Add(FitArt(src)); } catch { }
    }
    /// <summary>A card's picture by its own shape (2026-09-23, "several movie cards/posters seem off center and zoomed in ... paramount like South Park
    /// and Star Trek Discovery"): landscape art fills the 16:9 card; a portrait poster - Paramount+'s My List gives 2:3 posters - is shown whole on the
    /// card's own ground once its size is known, never cropped to its middle band.
    /// And (2026-09-25, "When I go from watch to library, I'm surprised by how slow it is to load the images. Any way to improve the
    /// efficiency of that process?"): decoded at twice the card's width, never at the picture's own size (TMDB's are 780 wide and more, and
    /// the Library holds thousands), and fetched only when its card comes within about a screen of the view - a row's far end and the rows
    /// below wait their turn instead of all asking at once. Kept on the device after the first sight (Services/ArtCache).
    /// </summary>
    private const int CardDecodeWidth = 512;
    private const double ArtLoadAheadPx = 1400;
    private static Border FitArt(string src)
    {
        var img = new Image { Stretch = Stretch.UniformToFill };
        var box = new Border { CornerRadius = new CornerRadius(6), Child = img };
        var loaded = false;
        void Load()
        {
            if (loaded) return;
            loaded = true;
            var bmp = new BitmapImage { DecodePixelWidth = CardDecodeWidth, DecodePixelType = DecodePixelType.Logical };
            bmp.ImageOpened += (_, _) => { if (bmp.PixelHeight > bmp.PixelWidth) img.Stretch = Stretch.Uniform; };
            try { bmp.UriSource = Services.ArtCache.UriFor(src); } catch { }
            img.Source = bmp;
        }
        box.EffectiveViewportChanged += (_, e) =>
        {
            if (loaded) return;
            if (e.BringIntoViewDistanceX < ArtLoadAheadPx && e.BringIntoViewDistanceY < ArtLoadAheadPx) Load();
        };
        return box;
    }
    /// <summary>A row that scrolls sideways (2026-09-22, "make it so I can click and drag all of the carousels ... if I'm using a mouse and not a remote
    /// control"): the arrows and the remote walk it as before (HubArrow); a mouse can also press anywhere on it and drag. Past a few pixels
    /// the drag takes the pointer from the card beneath, so the card does not play; let go, and the row glides on at the speed it was moving.</summary>
    private ScrollViewer? _hubScroller;
    private const string CarouselTag = "prism-carousel";
    // the cards a little larger (2026-09-25, "Can we increase the size of the video cards and title text just a little?"): 224 x 126 art and 13 px
    // titles before
    private const double CardArtW = 256, CardArtH = 144, CardCellW = 266, CardTitleSize = 14.5;
    private static ScrollViewer Carousel(UIElement content)
    {
        var sv = new ScrollViewer { Tag = CarouselTag, Content = content, HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled, VerticalScrollMode = ScrollMode.Disabled };
        double startX = 0, startY = 0, startOffset = 0, lastX = 0, velocity = 0; long lastT = 0, pressT = 0; bool down = false, dragging = false; uint id = 0;
        UIElement? pressed = null;   // the card the press landed on: it holds the pointer until the drag takes it
        sv.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, e) =>
        {
            if (e.Pointer.PointerDeviceType != Microsoft.UI.Input.PointerDeviceType.Mouse) return;   // touch pans natively; a remote never presses
            var pt = e.GetCurrentPoint(sv);
            if (!pt.Properties.IsLeftButtonPressed) return;
            down = true; dragging = false; id = e.Pointer.PointerId;
            pressed = null;
            for (var d = e.OriginalSource as DependencyObject; d is not null && !ReferenceEquals(d, sv); d = VisualTreeHelper.GetParent(d)) if (d is Microsoft.UI.Xaml.Controls.Primitives.ButtonBase b) { pressed = b; break; }
            startX = lastX = pt.Position.X; startY = pt.Position.Y; startOffset = sv.HorizontalOffset; velocity = 0; lastT = pressT = Environment.TickCount64;
        }), true);
        sv.AddHandler(UIElement.PointerMovedEvent, new PointerEventHandler((_, e) =>
        {
            if (!down || e.Pointer.PointerId != id) return;
            var cp = e.GetCurrentPoint(sv).Position; var x = cp.X;
            if (!dragging)
            {
                if (Math.Abs(x - startX) < 8 && Math.Abs(cp.Y - startY) < 8) return;   // a press that barely moves is still a press on the card
                var liftFar = Math.Abs(x - startX) >= 16 || Math.Abs(cp.Y - startY) >= 16;   // a lift wants a real pull (2026-09-25, a card lifted by a twitch)
                // a card HELD before it moves, or pulled downward/upward off its row, lifts - onto a multiview window (2026-09-23); a quick
                // sideways pull is the row's scroll, as before
                var lifting = pressed is Button { Tag: CardPick } && (Environment.TickCount64 - pressT >= 350 || Math.Abs(cp.Y - startY) > Math.Abs(x - startX) + 4);
                if (lifting && !liftFar) return;   // on its way to a lift: not a scroll yet
                if (lifting && pressed is Button pb)
                {
                    down = false;
                    pb.ReleasePointerCapture(e.Pointer);
                    if (s_cardLift?.Invoke(pb, e) == true) { e.Handled = true; return; }
                    return;
                }
                if (Math.Abs(x - startX) < 8) return;
                dragging = true;
                // the card took the pointer on the press and keeps it unless it lets go: asking for it over the card's head failed, and every drag
                // ended as a press on the card it was released over (2026-09-22) - so the card lets go first, then the row takes it
                pressed?.ReleasePointerCapture(e.Pointer);
                sv.CapturePointer(e.Pointer);
            }
            var now = Environment.TickCount64;
            if (now > lastT) velocity = 0.6 * velocity + 0.4 * ((x - lastX) / (now - lastT));
            lastX = x; lastT = now;
            sv.ChangeView(startOffset - (x - startX), null, null, true);
            e.Handled = true;
        }), true);
        void End(PointerRoutedEventArgs e)
        {
            if (!down || e.Pointer.PointerId != id) return;
            down = false;
            if (!dragging) return;
            dragging = false;
            sv.ReleasePointerCaptures();
            e.Handled = true;
            if (Environment.TickCount64 - lastT < 80 && Math.Abs(velocity) > 0.3) sv.ChangeView(sv.HorizontalOffset - velocity * 280, null, null, false);   // the glide
        }
        sv.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler((_, e) => End(e)), true);
        // the mouse wheel over a row moves the ROW alone - its own sideways scroll ("when I have my mouse over a carousel ... it should only affect
        // the carousel", 2026-09-22); the page scrolls from outside the rows (the margins, the heads)
        sv.AddHandler(UIElement.PointerCaptureLostEvent, new PointerEventHandler((_, e) => { if (ReferenceEquals(e.OriginalSource, sv) && dragging && e.Pointer.PointerId == id) { down = false; dragging = false; } }), true);   // the row's own loss only: the card's, bubbling up as the row takes it, had ended the drag
        return sv;
    }

    /// <summary>The big screen's verbs (back 10 s, play or pause, forward, next episode, skip intro, captions or tracks, the wall's mute) into a panel:
    /// on the big window's bar since 2026-10-01, where they belong, not in the hub's header.</summary>
    private void ScreenVerbs(StackPanel line, string screenSlot, bool playing, bool canCmd, bool canTracks, int size, bool canPause = true)
    {
        void Verb(string glyph, string tip, string cmd, bool enabled)
        {
            var b = Chip(VerbIcon(glyph, size), false); b.IsEnabled = enabled;
            ToolTipService.SetToolTip(b, enabled ? tip + MvAllTip(cmd) : tip + ". This service's adapter has no player script yet");
            b.Click += (_, __) => { if (!MvAllCommand(cmd)) _brain.Call(HostCalls.TileCommand, screenSlot, cmd); };
            line.Children.Add(b);
        }
        Verb("", "Back 10 s", "seekbackward", true);
        {
            // Play / Pause flips on each press (review 2026-10-01: the bar is drawn once a title, so a pressed Pause stayed a Pause)
            var isPlaying = playing;
            var ppIcon = new FontIcon { Glyph = isPlaying ? "\uE769" : "\uE768", FontSize = size };
            var pp = Chip(ppIcon, false);
            ToolTipService.SetToolTip(pp, (isPlaying ? "Pause" : "Play") + MvAllTip(isPlaying ? "pause" : "play"));
            var pressedAt = DateTime.MinValue;
            void ShowPlaying(bool p)
            {
                isPlaying = p;
                ppIcon.Glyph = p ? "\uE769" : "\uE768";
                ToolTipService.SetToolTip(pp, (p ? "Pause" : "Play") + MvAllTip(p ? "pause" : "play"));
            }
            if (!canPause) { ppIcon.Foreground = HubDim; ToolTipService.SetToolTip(pp, CannotPauseTip); }
            pp.Click += async (_, __) =>
            {
                var cmd = isPlaying ? "pause" : "play";
                if (cmd == "pause" && !await CanPauseAsync(screenSlot)) { SayCannotPause(screenSlot); return; }
                if (!MvAllCommand(cmd)) _brain.Call(HostCalls.TileCommand, screenSlot, cmd);
                pressedAt = DateTime.UtcNow;
                ShowPlaying(!isPlaying);
            };
            line.Children.Add(pp);
            // the player's own word, followed while the bar is up (2026-10-06, "the big window playback controls say play when the video is already
            // playing ... I press it and it turns to a Pause symbol, and then I press it again and it does pause"): the bar is drawn once a title,
            // often while it is still loading, so its first word was Play; a press is the person's for a moment, then the player's state again
            var seenLoaded = false;
            pp.Loaded += (_, __) => seenLoaded = true;
            _ = FollowPlayingAsync();
            async Task FollowPlayingAsync()
            {
                var t0 = DateTime.UtcNow;
                while ((DateTime.UtcNow - t0).TotalHours < 12)
                {
                    await Task.Delay(1200);
                    if (seenLoaded && !pp.IsLoaded) return;   // the bar is gone (another title, Watch closed)
                    if (!seenLoaded && (DateTime.UtcNow - t0).TotalSeconds > 10) return;   // never drawn
                    if ((DateTime.UtcNow - pressedAt).TotalSeconds < 2.5) continue;
                    try
                    {
                        var vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray;
                        var t = vs?.OfType<JsonObject>().FirstOrDefault(x => x["id"]?.GetValue<string>() == screenSlot);
                        if (t?["playing"] is JsonValue pv && pv.TryGetValue<bool>(out var now) && now != isPlaying && (DateTime.UtcNow - pressedAt).TotalSeconds >= 2.5) ShowPlaying(now);
                    }
                    catch { }
                }
            }
        }
        Verb("", "Forward 10 s", "seekforward", true);
        Verb("", "Next episode", "nextepisode", canCmd);
        Verb("", "Skip intro / recap", "skipintro", canCmd);
        if (canTracks) TracksVerb(screenSlot, size, b => line.Children.Add(b), null);
        else Verb("", "Captions", "captions", canCmd);
        // the wall's mute and volume here too, the same look and the same switch as on the stage bar and the music player
        var muteIcon2 = new FontIcon { Glyph = _wallMuted ? "\uE74F" : "\uE767", FontSize = size, Foreground = _wallMuted ? HubAmber : HubInk };
        var mute2 = Chip(muteIcon2, _wallMuted);
        ToolTipService.SetToolTip(mute2, _wallMuted ? "Muted. Press to unmute, or hover for the volume." : "Mute the wall. Hover for the volume.");
        mute2.Click += (_, __) => { SetWallMutedFromWall(screenSlot, !_wallMuted); muteIcon2.Glyph = _wallMuted ? "\uE74F" : "\uE767"; muteIcon2.Foreground = _wallMuted ? HubAmber : HubInk; };
        mute2.PointerEntered += (_, __) => ShowVolumeSlider(mute2, screenSlot);
        mute2.PointerExited += (_, __) => _volumeClose?.Start();
        line.Children.Add(mute2);
    }
    private static Button Chip(UIElement content, bool on)
    {
        var b = new Button { Content = content, Background = on ? HubChipOn : HubChip, BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(14), Padding = new Thickness(12, 6, 12, 6), VerticalAlignment = VerticalAlignment.Center };
        // the tooltip under the button, never under the pointer (2026-09-25, "When I put my mouse over show video, it often shows and loses focus. Why
        // do so many of your buttons do this?"): at the top of the wall a pointer-placed tip had no room above and opened on the pointer itself,
        // the button saw the pointer leave, and its hover went out about half a second in
        ToolTipService.SetPlacement(b, Microsoft.UI.Xaml.Controls.Primitives.PlacementMode.Bottom);
        OwnHover(b);
        if (s_devLog is { } log)   // dev only: the hover that comes and goes (2026-09-25)
        {
            string Name() => content is TextBlock t ? t.Text : content is Panel p ? string.Join(" ", p.Children.OfType<TextBlock>().Select(x => x.Text)) : content.GetType().Name;
            b.PointerEntered += (_, e) => log("hover in: " + Name() + " @" + e.GetCurrentPoint(b).Position);
            b.PointerExited += (_, e) => log("hover OUT: " + Name() + " @" + e.GetCurrentPoint(b).Position + " inside=" + (new Windows.Foundation.Rect(0, 0, b.ActualWidth, b.ActualHeight).Contains(e.GetCurrentPoint(b).Position)));
            b.PointerCaptureLost += (_, __) => log("capture lost: " + Name());
        }
        return b;
    }
    /// <summary>
    /// A pill's hover held by the pill itself (2026-09-25, "the pill that still has broken focus controls"): WinUI put a pill back to its normal look
    /// while the pointer stayed on it (host.log: no pointer-left, yet the capture showed it unlit), so the hover is no longer its visual state's. The
    /// pointer arriving sets the pill's own background lit - its colour, lightened - and only the pointer leaving (or a lost press) sets it back; the
    /// visual states are given the same lit colour, so whichever state WinUI is in, the pill reads as hovered. Code that turns a pill on or off sets its
    /// Background as before; the hover follows.
    /// </summary>
    internal static void OwnHover(Button b)
    {
        Brush baseBg = b.Background;
        var hovering = false; var ours = false;
        static bool IsOn(Brush x) => ReferenceEquals(x, HubChipOn) || (x is SolidColorBrush sb && sb.Color == HubChipOn.Color);
        static bool IsChip(Brush x) => ReferenceEquals(x, HubChip) || (x is SolidColorBrush sb && sb.Color == HubChip.Color);
        // any other colour (the Details page's, the setup pages'): lightened by a step, a see-through one given a faint white
        static Brush Lighter(Brush x, int step)
        {
            if (x is not SolidColorBrush sb) return new SolidColorBrush(Windows.UI.Color.FromArgb(0x22, 0xFF, 0xFF, 0xFF));
            var c = sb.Color;
            if (c.A < 0x40) return new SolidColorBrush(Windows.UI.Color.FromArgb((byte)Math.Min(255, 0x18 + step), 0xFF, 0xFF, 0xFF));
            byte L(byte v) => (byte)Math.Min(255, v + step);
            return new SolidColorBrush(Windows.UI.Color.FromArgb(c.A, L(c.R), L(c.G), L(c.B)));
        }
        // a button that already names its hover and press fills (the music player's corners) keeps them; the others get their colour lit
        var presetLit = b.Resources.TryGetValue("ButtonBackgroundPointerOver", out var pl) ? pl as Brush : null;
        var presetPressed = b.Resources.TryGetValue("ButtonBackgroundPressed", out var pp) ? pp as Brush : null;
        var keepBorders = b.Resources.ContainsKey("ButtonBorderBrushPointerOver");
        Brush Lit() => presetLit ?? (IsOn(baseBg) ? HubChipOnHover : IsChip(baseBg) ? HubChipHover : Lighter(baseBg, 0x16));
        Brush Pressed() => presetPressed ?? (IsOn(baseBg) ? HubChipOnPressed : IsChip(baseBg) ? HubChipPressed : Lighter(baseBg, 0x0A));
        void Set(Brush x) { ours = true; b.Background = x; ours = false; }
        void States()
        {
            b.Resources["ButtonBackgroundPointerOver"] = Lit();
            b.Resources["ButtonBackgroundPressed"] = Pressed();
            if (keepBorders) return;
            b.Resources["ButtonBorderBrushPointerOver"] = HubClear;
            b.Resources["ButtonBorderBrushPressed"] = HubClear;
        }
        States();
        b.RegisterPropertyChangedCallback(Control.BackgroundProperty, (_, __) =>
        {
            if (ours) return;
            baseBg = b.Background;   // the code turned it on or off
            States();
            if (hovering) Set(Lit());
        });
        b.PointerEntered += (_, __) => { if (!b.IsEnabled) return; hovering = true; Set(Lit()); };
        void Leave() { if (!hovering) return; hovering = false; Set(baseBg); }
        b.PointerExited += (_, __) => Leave();
        b.PointerCanceled += (_, __) => Leave();
        b.PointerCaptureLost += (_, e) => { if (!b.IsPointerOver) Leave(); };
    }
    /// <summary>
    /// A transport verb's icon. Back and forward 10 s are the circling arrow with a 10 in it, the usual skip symbol (2026-09-25, "can these be the
    /// typical circle arrow 10 s symbol instead of fast forward and rewind"): the icon font has a skip-back-10 but no forward one, so both are drawn
    /// alike - the circling arrow, turned for back, and the 10 set inside it. Every other verb keeps its glyph.
    /// </summary>
    private static UIElement VerbIcon(string glyph, double size)
    {
        var back = glyph == "\uEB9E"; var forward = glyph == "\uEB9D";
        if (!back && !forward) return new FontIcon { Glyph = glyph, FontSize = size };
        var g = new Grid { Width = size + 4, Height = size, Margin = new Thickness(0, -2, 0, -2) };   // the same height as the other verbs' glyphs
        var arrow = new FontIcon { Glyph = "\uE72C", FontSize = size + 3, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        if (back) { arrow.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5); arrow.RenderTransform = new ScaleTransform { ScaleX = -1 }; }
        g.Children.Add(arrow);
        g.Children.Add(new TextBlock { Text = "10", FontSize = Math.Max(7, Math.Round(size * 0.47)), FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 1, 0, 0) });
        return g;
    }
    /// <summary>The Watch verb's face: two arrows pointing in (the opposite of full screen) and the word (2026-09-25, "For Watch, let's add 2 arrows but
    /// going in like &gt; &lt; Watch. Opposite symbol of fullscreen").</summary>
    private static StackPanel WatchLabel() => new()
    {
        Orientation = Orientation.Horizontal, Spacing = 8,
        Children =
        {
            new FontIcon { Glyph = "\uE73F", FontSize = 13, Foreground = HubAmber },
            new TextBlock { Text = "Watch", FontSize = 13, Foreground = HubAmber },
        },
    };
    /// <summary>Dev only (PRISM_DEV_SHOT): a line into host.log.</summary>
    private static Action<string>? s_devLog;

    /// <summary>"3 days ago" from a real time only (core's log); the host never makes one up.</summary>
    private static string Ago(double at, double now)
    {
        var s = Math.Max(0, Math.Round((now - at) / 1000));
        if (s < 90) return "just now";
        var m = Math.Round(s / 60); if (m < 90) return m + " min ago";
        var h = Math.Round(m / 60); if (h < 36) return h + (h == 1 ? " hour ago" : " hours ago");
        var d = Math.Round(h / 24); if (d < 14) return d + (d == 1 ? " day ago" : " days ago");
        var w = Math.Round(d / 7); if (w < 9) return w + (w == 1 ? " week ago" : " weeks ago");
        var mo = Math.Round(d / 30); return mo + (mo == 1 ? " month ago" : " months ago");
    }

    /// <summary>A row of artwork cards (core's MenuCard shape: app, service, facet, item, recency, lastWatched?); a press plays the title on its service through the existing path.</summary>
    /// <summary>One menu card as a button (2026-09-22): the row draws these side by side, a row opened in full lays them out in a grid.</summary>
    private Button? MenuCardButton(JsonObject card, bool badge, double now)
    {
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
            var item = card["item"] as JsonObject; if (item is null) return null;
            var service = S(card, "service"); var facet = S(card, "facet");
            var id = S(item, "id"); var title = S(item, "title"); var kind = S(item, "kind"); var url = item["url"]?.GetValue<string>(); var art = item["artwork"]?.GetValue<string>(); var series = S(item, "series"); var subt = S(item, "subtitle");
            var text = series.Length > 0 && series != title ? series + "  ·  " + title : title;
            var poster = new Grid { Width = CardArtW, Height = CardArtH };
            poster.Children.Add(new Border { Background = HubCard, CornerRadius = new CornerRadius(6), Child = new TextBlock { Text = Shorten(title, 28), FontSize = 14, Foreground = HubDim, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, Margin = new Thickness(8) } });
            if (art is { Length: > 0 }) { try { poster.Children.Add(FitArt(art)); } catch { } }
            // the service as its symbol, not its name (2026-09-23, "Instead of showing 'netflix' and 'hulu' on every title, can we show a symbol for that
            // streaming service"); a title owned on several services shows each
            if (badge)
            {
                var marks = new List<(string, string)> { (S(card, "app"), service) };
                if (card["also"] is JsonArray alsoMarks) marks.AddRange(alsoMarks.OfType<JsonObject>().Select(x => (S(x, "app"), S(x, "service"))));
                poster.Children.Add(new Border { HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(6), Child = MarkStack(marks) });
            }
            // the service's own banner on its card ("New Season", "Leaving Soon", 2026-09-23), in its words - it is also why
            // the title stands at the front of My List (core's orderAlphabetical)
            if (S(item, "badge") is { Length: > 0 } tmdbNew && S(item, "badgeFrom") == "tmdb")
            {
                // TMDB's new episode this week (2026-09-23, "a corner diagonal banner ... 'New Sep 18' ... in a small red but readable banner"):
                // a red ribbon across the top-left corner (the service's symbol took the top right, 2026-09-23), white type; its tip names the source
                poster.Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, poster.Width, poster.Height) };
                var ribbon = new Border { Width = 124, Height = 22, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xC6, 0x28, 0x28)), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(-40, 18, 0, 0), RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5), RenderTransform = new RotateTransform { Angle = -45 }, Child = new TextBlock { Text = tmdbNew, FontSize = 11, FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xFF, 0xFF, 0xFF)), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } };
                ToolTipService.SetToolTip(ribbon, "A new episode aired " + tmdbNew.Replace("New ", "") + " - per TMDB.");
                poster.Children.Add(ribbon);
            }
            // a badge the service drew into its own picture (Netflix's box art) is not drawn again (2026-09-24, DANG!'s 'Recently Added' twice)
            else if (S(item, "badge") is { Length: > 0 } banner && item["badgeInArt"]?.GetValue<bool>() != true)
                poster.Children.Add(new Border { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE0, 0x0F, 0x12, 0x16)), CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 2, 6, 2), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(6, 6, 6, 10), Child = new TextBlock { Text = Shorten(banner, 26), FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubAmber } });
            if (item["progress"] is JsonValue pv && pv.TryGetValue<double>(out var pd) && pd > 0)
            {
                var bar = new Grid { Height = 4, VerticalAlignment = VerticalAlignment.Bottom, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x80, 0x0F, 0x12, 0x16)) };
                bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0.01, Math.Min(1, pd)), GridUnitType.Star) });
                bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0.01, 1 - Math.Min(1, pd)), GridUnitType.Star) });
                bar.Children.Add(new Border { Background = HubAmber });
                poster.Children.Add(bar);
            }
            var cell = new StackPanel { Spacing = 4, Width = CardCellW };
            cell.Children.Add(StackBehind(poster, card["also"] is JsonArray alsoN ? alsoN.Count + 1 : 1));
            cell.Children.Add(MarqueeTitle(Shorten(text, 36) + (subt.Length > 0 ? "  ·  " + Shorten(subt, 16) : ""), text + (subt.Length > 0 ? "  ·  " + subt : ""), CardTitleSize, HubInk));
            // the one time a card ever shows: the log's own; an inferred or ranked recency shows nothing (§4)
            if (card["lastWatched"] is JsonValue lw && lw.TryGetValue<double>(out var at))
                cell.Children.Add(new TextBlock { Text = Ago(at, now) + "  ·  " + service, FontSize = 11, Foreground = HubDim });
            // §4a: the lens's own number for this title, and TMDB's rating - always with its source and vote count, never bare;
            // both lines live on the card from the start and fill in as the sources answer (FollowHubAsync)
            var lensLabel = card["lens"] is JsonObject lv ? S(lv, "label") : "";
            var ratingText = card["rating"]?.GetValue<string>() ?? "";
            var lensTb = new TextBlock { Text = lensLabel, FontSize = 11, Foreground = HubAmber, TextTrimming = TextTrimming.CharacterEllipsis, Visibility = lensLabel.Length > 0 ? Visibility.Visible : Visibility.Collapsed };
            // the rating line with the person's own rating as the star's amber share (MainWindow.RatingLine.cs, 2026-10-03)
            var mine = card["mine"] is JsonValue mnv && mnv.TryGetValue<double>(out var mnd) ? mnd : (double?)null;
            var ratingTb = MakeRatingLine(ratingText != lensLabel ? ratingText : "", mine, 11, HubDim);   // under the rating lens the lens line already says it
            cell.Children.Add(lensTb); cell.Children.Add(ratingTb.Root);
            (_hubLines.TryGetValue(CardKey(card), out var lineList) ? lineList : _hubLines[CardKey(card)] = new()).Add((lensTb, ratingTb));
            var btn = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(4) };
            ToolTipService.SetToolTip(btn, "Plays " + title + " on " + service + ". " + RatingWords(ratingText, mine) + (ratingText is { Length: > 0 } ? " Right-click for the rating's disclosure and links." : ""));
            var fromContinue = card["__continue"]?.GetValue<bool>() == true;
            var (rmApp, rmId, rmTitle, rmService) = (S(card, "app"), id, series.Length > 0 ? series : title, service);
            // the card's service's own lists (2026-09-22 / 2026-09-23): Continue Watching's Remove, My List's Remove, else Add to My List
            var fromList = card["__mylist"]?.GetValue<bool>() == true;
            var (lsUrl, lsKind) = (url, series.Length > 0 ? "series" : kind.Length > 0 ? kind : "title");
            btn.ContextFlyout = RatingFlyout(series.Length > 0 ? series : title, series.Length > 0 ? "series" : kind, app: S(card, "app").Length > 0 ? S(card, "app") : null, extra: rmApp.Length > 0 && rmId.Length > 0 ? async fly =>
            {
                if (fromContinue) await AddRemoveItemAsync(fly, rmApp, rmService, rmId, rmTitle, btn);
                if (fromList) await AddListRemoveItemAsync(fly, rmApp, rmService, rmId, rmTitle, lsUrl, lsKind, btn);
                else if (!_watchActive) await AddListAddItemAsync(fly, rmApp, rmService, rmId, rmTitle, lsUrl, lsKind, null);   // the watchlist is My list while linked
            } : null);
            var (f2, k2, i2, u2, t2, a2, s2) = (facet, kind.Length > 0 ? kind : "title", id.Length > 0 ? id : url ?? title, url, text, art, service);
            // an offline channel has nothing to put in a window (2026-10-06, "if the channel is offline ... it wouldn't make sense to make it draggable"):
            // no drag; its press still opens the channel's page
            var offAir = k2 == "channel" && card["item"] is JsonObject chItem && ChannelOffline(chItem);
            if (offAir) ToolTipService.SetToolTip(btn, title + " is offline on " + service + ". Press to open the channel's page.");
            else btn.Tag = new CardPick(f2, k2, i2, u2, t2, a2, s2);   // what a drag onto a multiview window plays (MultiviewDrag)
            if (card["also"] is JsonArray also && also.Count > 0)
            {
                // owned on several services (2026-09-22): the press offers the choice, the card's own service first
                var pick = new MenuFlyout { Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Bottom };
                pick.Items.Add(new MenuFlyoutItem { Text = "Play on " + service, Icon = new FontIcon { Glyph = "\uE768" } });
                ((MenuFlyoutItem)pick.Items[0]).Click += (_, __) => { if (PickLeavesWatch(t2)) { CloseVideoHub(); ShowStageCurtain(t2, s2, a2); } _ = PlayOnAsync(f2, k2, i2, u2, t2); };
                foreach (var alt in also.OfType<JsonObject>())
                {
                    var ai = alt["item"] as JsonObject; if (ai is null) continue;
                    var (af, ak, aid, au, an) = (S(alt, "facet"), S(ai, "kind").Length > 0 ? S(ai, "kind") : "title", S(ai, "id").Length > 0 ? S(ai, "id") : ai["url"]?.GetValue<string>() ?? title, ai["url"]?.GetValue<string>(), S(alt, "service"));
                    var it = new MenuFlyoutItem { Text = "Play on " + an, Icon = new FontIcon { Glyph = "\uE768" } };
                    it.Click += (_, __) => { if (PickLeavesWatch(t2)) { CloseVideoHub(); ShowStageCurtain(t2, an, a2); } _ = PlayOnAsync(af, ak, aid, au, t2); };
                    pick.Items.Add(it);
                }
                ToolTipService.SetToolTip(btn, "Owned on " + service + " and " + string.Join(", ", also.OfType<JsonObject>().Select(x => S(x, "service"))) + ". Press to choose.");
                btn.Click += (_, __) => pick.ShowAt(btn);
            }
            // a channel that is off the air (Twitch's Followed row, kind "channel", 2026-10-05) opens its page, where nothing plays: no curtain to
            // wait on a play that will not come - the hub closes and the page shows
            else if (k2 == "channel") btn.Click += (_, __) => { if (PickLeavesWatch(t2)) CloseVideoHub(); _ = PlayOnAsync(f2, k2, i2, u2, t2); };
            else btn.Click += (_, __) => { if (PickLeavesWatch(t2)) { CloseVideoHub(); ShowStageCurtain(t2, s2, a2); } _ = PlayOnAsync(f2, k2, i2, u2, t2); };
        return btn;
    }
    /// <summary>
    /// A Library row built as it is reached (2026-09-25, Library's pictures slow to come: some 800 cards were built before the window could draw
    /// one): the first LibraryRowFirst cards at once, then LibraryRowStep more whenever the row's end comes within about a screen of the view -
    /// by mouse, drag or the arrows - on to the genre's last title (the rows had stopped at 40).
    /// </summary>
    private const int LibraryRowFirst = 14, LibraryRowStep = 20;
    private ScrollViewer CardRowPaged(List<JsonObject> cards, bool badge, double now, ref Button? first)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        var end = new Border { Width = 1, Height = 1 };
        row.Children.Add(end);
        var shown = 0; var busy = false;
        Button? firstBuilt = null;
        void More(int n)
        {
            var at = row.Children.IndexOf(end); if (at < 0) at = row.Children.Count;
            foreach (var c in cards.Skip(shown).Take(n))
            {
                if (MenuCardButton(c, badge, now) is not { } b) continue;
                row.Children.Insert(at++, b);
                firstBuilt ??= b;
            }
            shown = Math.Min(cards.Count, shown + n);
            if (shown >= cards.Count) row.Children.Remove(end);
        }
        More(LibraryRowFirst);
        end.EffectiveViewportChanged += (_, e) =>
        {
            if (busy || shown >= cards.Count || e.BringIntoViewDistanceX > 1600) return;
            busy = true;
            DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () => { More(LibraryRowStep); busy = false; });
        };
        first ??= firstBuilt;
        return Carousel(row);
    }
    private ScrollViewer CardRow(IEnumerable<JsonObject> cards, bool badge, double now, ref Button? first)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        foreach (var card in cards)
        {
            var btn = MenuCardButton(card, badge, now);
            if (btn is null) continue;
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(btn, "row:" + LiveKey(card));   // the key UpdateCardRowInPlace moves it by
            SlideOnMove(btn);
            row.Children.Add(btn);
            first ??= btn;
        }
        return Carousel(row);
    }

    /// <summary>§4a: a card's rating disclosure - what / who / decides, the source, the date - and its Details window (TMDB; no outbound IMDb / Letterboxd,
    /// Letterboxd links, navigation only. Built when opened, from core's word (lensDisclosure).</summary>
    /// <summary>The service's own subtitle and audio tracks as a Prism menu ("if you can pull those options into our own chrome, that would be
    /// better", 2026-09-21): the stage shield keeps the pointer from the page, so the service's own panel could be opened but not touched.
    /// The lists are read from the page through the adapter's videoTracks script when the menu opens (a read); a pick goes through core.</summary>
    private const string TracksJs = "(function(){try{var r=window.__prismVideoTracks&&window.__prismVideoTracks();return r?JSON.stringify(r):null;}catch(e){return null;}})()";
    private void TracksVerb(string slot, double size, Action<Button> place, Action? hold)
    {
        var b = Chip(new FontIcon { Glyph = "\uED1E", FontSize = size }, false);
        ToolTipService.SetToolTip(b, "Subtitles and audio. Choose the service's own tracks here.");
        var fly = new MenuFlyout { Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Top };
        fly.Items.Add(new MenuFlyoutItem { Text = "Reading\u2026", Foreground = HubInk, IsHitTestVisible = false });
        fly.Opening += async (_, __) =>
        {
            hold?.Invoke();
            JsonObject? t = null;
            try
            {
                // a service whose lists live in its own panel (Paramount+) opens it under its stylesheet on the first ask and answers once it has rendered: asked again, briefly
                for (var attempt = 0; attempt < 4 && t is null; attempt++)
                {
                    if (attempt > 0) await Task.Delay(450);
                    var raw = await _surfaces.EvalOnTileAsync(slot, TracksJs);
                    if (raw is not null && raw != "null" && !raw.StartsWith("__prism_eval_error", StringComparison.Ordinal) && JsonNode.Parse(raw)?.GetValue<string>() is { } inner) t = JsonNode.Parse(inner) as JsonObject;
                }
            }
            catch (Exception e) { LogLine("tracks: " + e.Message); }
            fly.Items.Clear();
            if (t is null) { fly.Items.Add(new MenuFlyoutItem { Text = "The player lists no tracks right now.", Foreground = HubInk, IsHitTestVisible = false }); return; }
            void Section(string head, string kind)
            {
                if (t[kind] is not JsonArray list || list.Count == 0) return;
                if (fly.Items.Count > 0) fly.Items.Add(new MenuFlyoutSeparator());
                fly.Items.Add(new MenuFlyoutItem { Text = head, Foreground = HubInk, IsHitTestVisible = false });
                foreach (var tr in list.OfType<JsonObject>())
                {
                    var id = tr["id"]?.GetValue<string>() ?? ""; var name = tr["name"]?.GetValue<string>() ?? id;
                    if (id.Length == 0) continue;
                    var it = new ToggleMenuFlyoutItem { Text = name, IsChecked = tr["selected"]?.GetValue<bool>() == true };
                    var (k2, id2) = (kind, id);
                    it.Click += (_, ___) => { _ = ModelCallAsync("videoTrack", slot, k2, id2); SetPill("Prism \u00B7 " + (k2 == "audio" ? "audio: " : "subtitles: ") + name); hold?.Invoke(); };
                    fly.Items.Add(it);
                }
            }
            Section("Subtitles", "subtitles");
            Section("Audio", "audio");
            if (fly.Items.Count == 0) fly.Items.Add(new MenuFlyoutItem { Text = "The player lists no tracks right now.", Foreground = HubInk, IsHitTestVisible = false });
        };
        fly.Closed += (_, __) => { hold?.Invoke(); _ = _surfaces.EvalOnTileAsync(slot, "(function(){try{return !!(window.__prismVideoTracksDone&&window.__prismVideoTracksDone());}catch(e){return false;}})()"); };   // a service whose lists live in its own panel closes it
        b.Click += (_, __) => fly.ShowAt(b);
        place(b);
    }
    private MenuFlyout RatingFlyout(string title, string? kind = null, Func<MenuFlyout, Task>? extra = null, string? app = null, string? tmdb = null, int? year = null)
    {
        var fly = new MenuFlyout();
        fly.Items.Add(new MenuFlyoutItem { Text = "Reading\u2026", Foreground = HubInk, IsHitTestVisible = false });
        fly.Opening += async (_, __) =>
        {
            JsonObject? d = null;
            try { d = JsonNode.Parse(await ModelCallAsync("lensDisclosure", title) ?? "null") as JsonObject; } catch { }
            fly.Items.Clear();
            // the title's details from TMDB, in Prism's own window (2026-09-23 - no outbound IMDb / Letterboxd links: "We should be able to avoid using it")
            var details = new MenuFlyoutItem { Text = "Details" + (char)0x2026, Icon = new FontIcon { Glyph = "\uE946" } };
            ToolTipService.SetToolTip(details, "Cast, where to watch, the trailer and more, from TMDB.");
            details.Click += (_, ___) => ShowTitleDetails(title, kind, app);
            if (await TmdbKeyAsync()) fly.Items.Add(details);   // TMDB's page: with a key only (MainWindow.TmdbGate)
            // Send to playlist, next to Details (docs/features/playlists.md, 2026-09-27): a show sends all its episodes, a movie itself
            if (await PlaylistsActiveAsync()) fly.Items.Add(await SendToSubAsync("Send to playlist", () => CardSource(title, kind, app, null, tmdb, null, year)));   // TMDB's id and year tell same-named shows apart (2026-09-27)
            await AddWatchlistItemAsync(fly, title, kind);   // the TMDB watchlist, while an account is linked (2026-10-03)
            fly.Items.Add(new MenuFlyoutSeparator());
            if (extra is not null) { await extra(fly); if (fly.Items.Count > 0) fly.Items.Add(new MenuFlyoutSeparator()); }   // a Continue watching card's Remove on the service
            var rating = d?["rating"]?.GetValue<string>();
            fly.Items.Add(new MenuFlyoutItem { Text = rating is { Length: > 0 } ? rating : "No TMDB rating for this title" + (rating is null ? " (no key, or not matched)" : ""), Foreground = HubInk, IsHitTestVisible = false });
            if (rating is { Length: > 0 })
            {
                fly.Items.Add(new MenuFlyoutItem { Text = "What is counted: TMDB members' votes, one to ten", Foreground = HubInk, IsHitTestVisible = false });
                fly.Items.Add(new MenuFlyoutItem { Text = "Who is counted: members who chose to vote on it", Foreground = HubInk, IsHitTestVisible = false });
                fly.Items.Add(new MenuFlyoutItem { Text = "Who decides: each voter equally; TMDB takes the mean", Foreground = HubInk, IsHitTestVisible = false });
                var at = (d?["facts"] as JsonObject)?["rating"] is JsonObject r && r["at"] is JsonValue av && av.TryGetValue<double>(out var ad) ? DateTimeOffset.FromUnixTimeMilliseconds((long)ad).ToString("yyyy-MM-dd") : "?";
                fly.Items.Add(new MenuFlyoutItem { Text = "Source: TMDB API · data date " + at + " · not endorsed or certified by TMDB", Foreground = HubInk, IsHitTestVisible = false });
            }
        };
        return fly;
    }

    /// <summary>An outbound link on the wall (navigation only): the "Links" App's popped page, in its own profile, with the wall's bar and Done.</summary>
    private async Task OpenLinkAsync(string url, string name)
    {
        if (!IsHttpUrl(url)) return;
        if (_model.App("links") is null)
        {
            var made = await ModelCallAsync("modelSaveApp", "{\"id\":\"links\",\"name\":\"Links\",\"baseUrl\":\"" + url.Replace("\"", "") + "\",\"profileId\":\"links\",\"setup\":{\"status\":\"unknown\"},\"render\":{\"audio\":\"mute\",\"persist\":true}}");
            LogLine("links app: " + Shorten(made ?? "?", 60));
            await Task.Delay(200);
        }
        SetPill("Prism · " + name);
        OpenRoute("prism://app/links/setup?url=" + Uri.EscapeDataString(url) + "&return=scene");
    }

    private static string CardKey(JsonObject card) { var item = card["item"] as JsonObject; return (card["app"]?.GetValue<string>() ?? "") + "|" + (item?["id"]?.GetValue<string>() ?? "") + "|" + (item?["title"]?.GetValue<string>() ?? ""); }

    /// <summary>While the lens sources are still answering: read the menu again every few seconds and fill the cards' lines in place -
    /// no rebuild, no lost scroll or focus. A lens's ORDER settles on the next open; the numbers arrive now.</summary>
    private async Task FollowHubAsync(Grid overlay)
    {
        // the page is handed to _videoHub only after its draw (B-267): the first check comes after the first wait, never before it
        for (var i = 0; i < 60; i++)
        {
            // the first look comes soon (a page opened right after a restart draws its lens rows as heads alone while the cache is read - the
            // cards were there a second later, but a shot at four seconds showed text rows, 2026-09-22); the later ones at the sources' pace
            await Task.Delay(i == 0 ? 1200 : 4000);
            if (!ReferenceEquals(_videoHub, overlay)) return;
            JsonObject? menu = null;
            try { menu = JsonNode.Parse(await ModelCallAsync("videoMenuRows", true) ?? "null") as JsonObject; } catch { }   // the rows and lens rows, not the Library (2026-10-03, perf)
            if (menu is null || !ReferenceEquals(_videoHub, overlay)) return;
            string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
            var pending = (menu["lens"] as JsonObject)?["pending"] is JsonValue pv && pv.TryGetValue<int>(out var pn) ? pn : 0;
            // the ratings under every card follow the sources (each title's lines, in whichever rows it sits); a lens's number and
            // a lens row's ORDER settle on the next open - a row is never rebuilt under a person
            foreach (var rowName in new[] { "continue", "list" })
                if (menu[rowName] is JsonArray cards)
                    foreach (var card in cards.OfType<JsonObject>())
                    {
                        if (!_hubLines.TryGetValue(CardKey(card), out var lineList)) continue;
                        var ratingText = card["rating"]?.GetValue<string>() ?? "";
                        var mine = card["mine"] is JsonValue mnv && mnv.TryGetValue<double>(out var mnd) ? mnd : (double?)null;
                        foreach (var lines in lineList)
                        {
                            var lensLabel = lines.lens.Text ?? "";
                            var want = ratingText != lensLabel ? ratingText : "";
                            if (lines.rating.Text != want || lines.rating.Mine != mine) SetRatingLine(lines.rating, want, mine);
                        }
                    }
            // a lens row drawn while its sources were reading: its titles go into its own panel the moment it has any (its order as
            // of now; it settles on the next open); its head says how many titles are still being read meanwhile
            if (menu["lensRows"] is JsonArray lensRows) try
            {
                var now = menu["now"] is JsonValue nv && nv.TryGetValue<double>(out var nd) ? nd : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                Button? first = null;
                foreach (var lr in lensRows.OfType<JsonObject>())
                {
                    if (!_hubLensPending.TryGetValue(S(lr, "id"), out var slot)) continue;
                    if (lr["catalog"]?.GetValue<bool>() == true)
                    {
                        // the catalog row redraws its own panel as titles are placed - never while the person stands in it
                        var catCards = (lr["cards"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
                        var catReading = lr["reading"] is JsonValue crv && crv.TryGetValue<int>(out var crn) && crn > 0;
                        slot.head.Text = CatalogLensShort(lr);
                        slot.disclosure.Text = CatalogLensTip(lr);
                        if (slot.disclosure.Tag is FrameworkElement tipHost) ToolTipService.SetToolTip(tipHost, slot.disclosure.Text);
                        // rebuilt only when its titles changed, never under the person's pointer or focus, and at the same scroll spot
                        // (2026-09-23, "Seeing my rows flickering and returning to the start a lot ... Specifically the most read row")
                        var sig = string.Join("|", catCards.Select(c => S(c, "id")));
                        var over = slot.host.Tag is string tg && tg.StartsWith("over|", StringComparison.Ordinal);
                        var had = slot.host.Tag is string tg2 ? (tg2.StartsWith("over|", StringComparison.Ordinal) ? tg2.Substring(5) : tg2) : "";
                        if (sig != had && !over && !FocusWithin(slot.host))
                        {
                            // in place, not rebuilt (2026-09-24, "instead of the whole line flashing repeatedly until complete, couldn't the load
                            // happen more organically? Adding and removing items as they're discovered, fluidly"): a title found fades in at its
                            // place, one gone leaves, the rest slide to their new places
                            var line = (FindChild<ScrollViewer>(slot.host)?.Content as StackPanel);
                            if (line is null)
                            {
                                Button? none = null;
                                if (catCards.Count > 0) { slot.host.Children.Clear(); slot.host.Children.Add(BrowseRow(catCards, ref none, true)); }
                            }
                            else UpdateRowInPlace(line, catCards, true);
                            slot.host.Tag = sig;
                        }
                        if (!catReading) { _hubLensPending.Remove(S(lr, "id")); LogLine("hub follow: " + slot.name + " read, " + catCards.Count + " titles"); }
                        continue;
                    }
                    var cards = (lr["cards"] as JsonArray)?.OfType<JsonObject>().Take(24).ToList() ?? new List<JsonObject>();
                    if (cards.Count == 0) { slot.head.Text = slot.name + (pending > 0 ? "  ·  reading " + pending + " title" + (pending == 1 ? "" : "s") + "…" : "  ·  nothing counted among these titles"); continue; }
                    slot.head.Text = slot.name;
                    slot.disclosure.Text = LensDisclosureLine(lr, S(lr, "dataDate") is { Length: > 0 } dd2 ? dd2 : "not read yet");
                    slot.host.Children.Add(CardRow(cards, true, now, ref first));
                    _hubLensPending.Remove(S(lr, "id"));
                    LogLine("hub follow: " + slot.name + " filled with " + cards.Count);
                }
            }
            catch (Exception ex) { LogLine("hub follow failed: " + ex.GetType().Name + ": " + ex.Message); }
            if (pending == 0) return;
        }
    }

    private async Task TuneAsync(string facetId, string channelId, string? url, string name)
    {
        var raw = await ModelCallAsync("videoTune", facetId, channelId, url, name);
        JsonObject? r = null;
        try { r = raw is null ? null : JsonNode.Parse(raw) as JsonObject; } catch { }
        if (r?["ok"]?.GetValue<bool>() == true)
        {
            if (r["switched"]?.GetValue<bool>() == true && r["sceneId"]?.GetValue<string>() is { } sceneId) await SceneAppliedAsync(sceneId, raw!);
            SetPill("Prism · tuning " + name);
            return;
        }
        SetPill("Prism · could not tune " + name + (raw is null ? "" : ": " + Shorten(raw, 80)));
    }

    /// <summary>Search everywhere: core asks every signed-in service on hidden surfaces; this polls the state and redraws the results row until every service has answered (or a limit passes). The rows come ordered from core.</summary>
    private async Task LookupAsync(string q, StackPanel results, Grid overlay, double? personId = null)
    {
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        JsonObject? st = null;
        try { st = JsonNode.Parse(await (personId is { } pid ? ModelCallAsync("videoLookupPerson", pid, q) : ModelCallAsync("videoLookup", q)) ?? "null") as JsonObject; } catch (Exception e) { LogLine("video lookup: " + e.Message); }
        if (st?["ok"]?.GetValue<bool>() != true) { SetPill("Prism · could not search" + (st is null ? "" : ": " + S(st, "error"))); return; }
        var token = S(st, "token");
        LogLine("video lookup: " + q + " (" + token + ")");
        _lookupGenre = null; _lookupApp = null;   // a new search starts unfiltered
        var started = DateTime.UtcNow;
        // the state under the filter (2026-09-22, "When searching, should be able to filter by genre and service"): core filters the rows and
        // names the chips the unfiltered rows offer; a chip press re-reads and redraws without a new search
        async Task<JsonObject?> ViewAsync() { try { return JsonNode.Parse(await ModelCallAsync("videoLookupView", _lookupGenre, _lookupApp) ?? "null") as JsonObject; } catch { return null; } }
        var gen = _hubSearchGen;
        if (results.Tag is Action showSearch) showSearch();
        async Task RedrawAsync() { var v = await ViewAsync(); if (v is not null && S(v, "token") == token && ReferenceEquals(_videoHub, overlay) && gen == _hubSearchGen) Draw(v); }
        st = await ViewAsync() ?? st;
        while (ReferenceEquals(_videoHub, overlay) && gen == _hubSearchGen)
        {
            Draw(st!);
            if (st!["done"]?.GetValue<bool>() == true || (DateTime.UtcNow - started).TotalSeconds > 60) break;
            await Task.Delay(700);
            st = await ViewAsync();
            if (st is null || S(st, "token") != token) break;   // a newer search took over, or the menu closed
        }

        void Draw(JsonObject state)
        {
            _redrawSearch = () => { if (ReferenceEquals(_videoHub, overlay) && gen == _hubSearchGen) Draw(state); };
            results.Children.Clear();
            var done = state["done"]?.GetValue<bool>() == true;
            results.Children.Add(RowHead((done ? "Results for “" : "Searching for “") + Shorten(q, 40) + "”", HubInk));
            // the status line: who is still looking, who could not - the service's own reason, never hidden
            var searching = new List<string>(); var cannot = new List<string>(); var empty = new List<string>();
            if (state["services"] is JsonArray svcs)
                foreach (var s in svcs.OfType<JsonObject>())
                {
                    var status = S(s, "status"); var name = S(s, "name");
                    if (status == "searching") searching.Add(name);
                    else if (status == "empty") empty.Add(name);
                    else if (status != "ok") cannot.Add(name + ": " + (S(s, "reason").Length > 0 ? S(s, "reason") : status));
                }
            var parts = new List<string>();
            if (searching.Count > 0) parts.Add("still searching " + string.Join(", ", searching));
            if (empty.Count > 0) parts.Add("nothing on " + string.Join(", ", empty));
            if (cannot.Count > 0) parts.Add(string.Join("  ·  ", cannot));
            var catalog = S(state, "source") == "catalog";
            if (catalog) { parts.Clear(); if (!done) parts.Add("asking TMDB"); if (cannot.Count > 0) parts.Add(string.Join("  ·  ", cannot)); }   // a catalog search: the services carrying nothing are simply absent from the row
            if (S(state, "attribution").Length > 0) parts.Add(S(state, "attribution"));
            if (parts.Count > 0) results.Children.Add(new TextBlock { Text = string.Join("  ·  ", parts), FontSize = 12, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
            // the filter chips: every genre and service the results offer (from the unfiltered rows, so a press never empties the other group)
            var genres = (state["genres"] as JsonArray)?.OfType<JsonValue>().Select(v => v.GetValue<string>()).Where(x => x.Length > 0).ToList() ?? new List<string>();
            var fsvcs = (state["filterServices"] as JsonArray)?.OfType<JsonObject>().Select(o => (S(o, "app"), S(o, "name"))).Where(x => x.Item1.Length > 0).ToList() ?? new List<(string, string)>();
            var all = state["all"] is JsonValue av && av.TryGetValue<int>(out var an) ? an : 0;
            if (genres.Count > 0 || fsvcs.Count > 1)
            {
                var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
                Button FChip(string label, bool on, string tip, Action press)
                {
                    var c2 = Chip(new TextBlock { Text = label, FontSize = 12, Foreground = on ? HubAmber : HubInk }, on);
                    ToolTipService.SetToolTip(c2, tip);
                    c2.Click += (_, __) => press();
                    return c2;
                }
                if (genres.Count > 0)
                {
                    chips.Children.Add(new TextBlock { Text = "Genre", FontSize = 12, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) });
                    chips.Children.Add(FChip("All", _lookupGenre is null, "Every genre.", () => { _lookupGenre = null; _ = RedrawAsync(); }));
                    foreach (var g in genres.Take(12)) { var g2 = g; chips.Children.Add(FChip(g, _lookupGenre == g, "Only titles TMDB files under " + g + ".", () => { _lookupGenre = _lookupGenre == g2 ? null : g2; _ = RedrawAsync(); })); }
                }
                if (fsvcs.Count > 1)
                {
                    chips.Children.Add(new TextBlock { Text = "Service", FontSize = 12, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(genres.Count > 0 ? 14 : 0, 0, 6, 0) });
                    chips.Children.Add(FChip("All", _lookupApp is null, "Every service.", () => { _lookupApp = null; _ = RedrawAsync(); }));
                    foreach (var (fa, fn) in fsvcs) { var a2 = fa; chips.Children.Add(FChip(fn, _lookupApp == fa, "Only " + fn + "'s results.", () => { _lookupApp = _lookupApp == a2 ? null : a2; _ = RedrawAsync(); })); }
                }
                results.Children.Add(Carousel(chips));
            }
            // one card per work, each service as its symbol, the household's own titles first, the top result, the people (MainWindow.Search.cs)
            DrawSearchBody(state, results, q, overlay, done, catalog, searching.Count, all);
        }
    }

    /// <summary>The Library tab's own drawing (2026-09-22): built off-screen and swapped into the tab's panel, so a sort press or the
    /// ratings arriving never rebuilds the page.</summary>
    private async Task DrawLibraryAsync(StackPanel panel, Grid overlay, double now)
    {
        if (_videoHub is not null && !ReferenceEquals(_videoHub, overlay)) return;
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        var built = new StackPanel { Spacing = 18 };
        Button? first = null;
        var drawnRows = 0;
        var deferred = new List<(StackPanel host, List<JsonObject> cards)>();
        void CardsInto(string head, IEnumerable<JsonObject> cards, bool badge, SolidColorBrush ink)
        {
            var list = cards.ToList();
            if (list.Count == 0) return;
            built.Children.Add(RowHead(head, ink));
            built.Children.Add(CardRowPaged(list, badge, now, ref first));
        }
    StackPanel SortChips(JsonObject? lib, bool hasKey)
        {
            var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            line.Children.Add(new TextBlock { Text = "Sort", FontSize = 12, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) });
            var sorts = lib?["sorts"] as JsonArray;
            if (sorts is null) return line;
            foreach (var so in sorts.OfType<JsonObject>())
            {
                var id = S(so, "id"); var on = id == _hubSort;
                var can = hasKey || id == "own" || id == "newest" || id == "oldest";   // a date can come from Wikidata without a key; a rating is TMDB's alone
                var chip = Chip(new TextBlock { Text = S(so, "label"), FontSize = 12, Foreground = on ? HubAmber : can ? HubInk : HubDim }, on);
                ToolTipService.SetToolTip(chip, S(so, "hint") + (can ? "" : "\n\nNeeds a TMDB key (Prism menu > TMDB key)."));
                chip.IsEnabled = can;
                var id2 = id;
                chip.Click += (_, __) => { if (_hubSort != id2) { _hubSort = id2; _ = DrawLibraryAsync(panel, overlay, now); } };
                line.Children.Add(chip);
            }
            return line;
        }
            // the Library tab (2026-09-22): what the person owns across services, one card per title, rated, a row per TMDB genre
            JsonObject? lib = null;
            try { lib = JsonNode.Parse(await ModelCallAsync("videoLibraryTab", _hubSort, _hubGroup) ?? "null") as JsonObject; } catch (Exception e) { LogLine("library tab: " + e.Message); }
            _hubGroup = S(lib, "group") == "none" ? "none" : "genre";
            _hubSort = S(lib, "sort").Length > 0 ? S(lib, "sort") : "own";
            var total = lib?["total"] is JsonValue tv && tv.TryGetValue<int>(out var tn) ? tn : 0;
            var twice = lib?["twice"] is JsonValue tw && tw.TryGetValue<int>(out var twn) ? twn : 0;
            var rated = lib?["rated"] is JsonValue rv && rv.TryGetValue<int>(out var rn) ? rn : 0;
            var libPending = lib?["pending"] is JsonValue lp && lp.TryGetValue<int>(out var lpn) ? lpn : 0;
            var libFrom = string.Join(", ", (lib?["services"] as JsonArray)?.OfType<JsonValue>().Select(v => v.GetValue<string>()) ?? Array.Empty<string>());
            var summary = total == 0 ? "Nothing owned is known yet. A service's library (Fandango at Home's My Movies, Movies Anywhere's) is read in the background after sign-in."
                : total + " titles owned on " + libFrom + (twice > 0 ? "  ·  " + twice + " on more than one service (press one to choose)" : "")
                + (lib?["tmdbKey"]?.GetValue<bool>() == true ? "  ·  " + rated + " rated" + (libPending > 0 ? ", reading " + libPending + " title" + (libPending == 1 ? "" : "s") + "…" : "") : "  ·  a TMDB key sorts them by genre and rates them");
            built.Children.Add(new TextBlock { Text = summary, FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
            if (total > 0)
            {
                // Group by (2026-09-23, "add a group by buttons, default is genre ... Add an option for None ... responsive and easy to understand"):
                // its own labeled line above Sort, the chosen one lit; each line scrolls sideways on a narrow window rather than clipping
                var groupLine = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
                groupLine.Children.Add(new TextBlock { Text = "Group by", FontSize = 12, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center, Width = 64 });
                foreach (var go in (lib?["groups"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                {
                    var gid = S(go, "id"); var on = gid == _hubGroup;
                    var gchip = Chip(new TextBlock { Text = S(go, "label"), FontSize = 12, Foreground = on ? HubAmber : HubInk }, on);
                    ToolTipService.SetToolTip(gchip, S(go, "hint"));
                    var gid2 = gid;
                    gchip.Click += (_, __) => { if (_hubGroup != gid2) { _hubGroup = gid2; _ = DrawLibraryAsync(panel, overlay, now); } };
                    groupLine.Children.Add(gchip);
                }
                if (((lib?["groups"] as JsonArray)?.Count ?? 0) > 1) built.Children.Add(Carousel(groupLine));   // no TMDB key: one grid, nothing to group by
                built.Children.Add(Carousel(SortChips(lib, lib?["tmdbKey"]?.GetValue<bool>() == true)));
            }
            if (lib?["rows"] is JsonArray genreRows)
                foreach (var g in genreRows.OfType<JsonObject>())
                {
                    var gcards = (g["cards"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
                    if (_hubGroup == "none" && S(g, "genre") == "All titles")
                    {
                        // one list: a grid as wide as the window, re-flowed when it resizes, drawn a page at a time
                        built.Children.Add(RowHead("All titles  \u00B7  " + gcards.Count, HubInk));
                        built.Children.Add(LibraryGrid(gcards, now, ref first, letters: _hubSort == "own"));
                        continue;
                    }
                    // the first rows at once, the rest a couple at a time once the page is up (2026-09-24): some 800 cards had been built before
                    // anything showed, and the window stood still meanwhile
                    if (drawnRows < LibraryRowsAtOnce) { CardsInto(S(g, "genre") + "  \u00B7  " + gcards.Count, gcards, true, HubInk); drawnRows++; }
                    else if (gcards.Count > 0)
                    {
                        built.Children.Add(RowHead(S(g, "genre") + "  \u00B7  " + gcards.Count, HubInk));
                        var later = new StackPanel { MinHeight = 200 };
                        built.Children.Add(later);
                        deferred.Add((later, gcards));
                    }
                }
            if (libPending > 0) { _ = FollowHubAsync(overlay); _ = FollowLibraryAsync(panel, overlay, now); }
                var wasEmpty = panel.Children.Count == 0;
        if (_videoHub is not null && !ReferenceEquals(_videoHub, overlay)) return;
        panel.Children.Clear();
        while (built.Children.Count > 0) { var child = built.Children[0]; built.Children.RemoveAt(0); panel.Children.Add(child); }
        if (first is not null && (wasEmpty || _hubCur is null)) { _hubCur = first; try { first.Focus(FocusState.Keyboard); } catch { } }
        // the rows held back: two per frame, while this page is still the one up
        for (var k = 0; k < deferred.Count; k++)
        {
            if (k % 2 == 0) await Task.Delay(16);
            if (!ReferenceEquals(_videoHub, overlay) || _hubTab != "library" || !ReferenceEquals(deferred[k].host.Parent, panel)) return;
            Button? none = null;
            deferred[k].host.MinHeight = 0;
            deferred[k].host.Children.Add(CardRowPaged(deferred[k].cards, true, now, ref none));
        }
    }
    /// <summary>Library's genre rows built before the page shows; the rest follow a couple per frame.</summary>
    private const int LibraryRowsAtOnce = 4;
    /// <summary>The whole library as one grid (Group by None): as many columns as its width holds, laid out again when the window resizes;
    /// 120 cards at first and a "Show more" for the next 120, so two thousand titles stay quick.</summary>
    private FrameworkElement LibraryGrid(List<JsonObject> all, double now, ref Button? first, bool letters = false)
    {
        const int Page = 120;
        var host = new StackPanel { Spacing = 12 };
        var cards = all;
        // the cards wrap at the width they have (2026-09-25, "in the library at the end of the grid, rows were ending with items off screen"):
        // the columns had been counted at 250 a card after the cards grew to 286, and the last column ran under the edge
        var grid = new FlowPanel { HorizontalSpacing = 12, VerticalSpacing = 12 };
        var buttons = new List<Button>();
        var more = Chip(new TextBlock { Text = "Show more", FontSize = 13, Foreground = HubInk }, false);
        more.HorizontalAlignment = HorizontalAlignment.Left;
        var shown = 0;
        void Add()
        {
            foreach (var c in cards.Skip(shown).Take(Page)) if (MenuCardButton(c, true, now) is { } b) { buttons.Add(b); grid.Children.Add(b); }
            shown = Math.Min(cards.Count, shown + Page);
            more.Visibility = shown < cards.Count ? Visibility.Visible : Visibility.Collapsed;
            ((TextBlock)more.Content).Text = "Show more  \u00B7  " + (cards.Count - shown) + " left";
        }
        Add();
        first ??= buttons.FirstOrDefault();
        more.Click += (_, __) => Add();
        // a letter strip over an A to Z grid (2026-10-06, "on Library I should be able to just view an A-Z grid of all items even when TMDB isn't
        // connected. Right now it says Unsorted 2223 and I have no way to dive in"): All, then # and each letter the titles begin with; a press
        // shows that letter's titles alone, from the top
        if (letters && all.Count > Page)
        {
            static string LetterOf(JsonObject c)
            {
                var t = ((c["item"] as JsonObject)?["title"]?.GetValue<string>() ?? "").TrimStart();
                var ch = t.Length > 0 ? char.ToUpperInvariant(t[0]) : '#';
                return ch >= 'A' && ch <= 'Z' ? ch.ToString() : "#";
            }
            var counts = all.GroupBy(LetterOf).ToDictionary(g => g.Key, g => g.Count());
            var strip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            var chosen = "";
            void DrawStrip()
            {
                strip.Children.Clear();
                foreach (var key in new[] { "" }.Concat(new[] { "#" }).Concat(Enumerable.Range('A', 26).Select(i => ((char)i).ToString())))
                {
                    if (key.Length > 0 && !counts.ContainsKey(key)) continue;
                    var on = key == chosen;
                    var chip = Chip(new TextBlock { Text = key.Length == 0 ? "All" : key, FontSize = 14, Foreground = on ? HubAmber : HubInk }, on);
                    chip.MinWidth = 36;
                    ToolTipService.SetToolTip(chip, key.Length == 0 ? "Every title, " + all.Count : (key == "#" ? "Titles starting with a number or a symbol" : "Titles starting with " + key) + ", " + counts[key]);
                    var k = key;
                    chip.Click += (_, __) =>
                    {
                        if (chosen == k) return;
                        chosen = k;
                        cards = k.Length == 0 ? all : all.Where(c => LetterOf(c) == k).ToList();
                        grid.Children.Clear(); buttons.Clear(); shown = 0;
                        Add();
                        DrawStrip();
                    };
                    strip.Children.Add(chip);
                }
            }
            DrawStrip();
            host.Children.Add(Carousel(strip));
        }
        // the next page as the end comes near (2026-09-25, "If on Library, grouped by None, it doesnt autoload more records as you scroll down, it
        // forces you to manually load more. Cant this be automatic as the user scrolls?"): Show more loads itself once it is within about a screen
        // of the view; the button stays for a remote's press
        var adding = false;
        more.EffectiveViewportChanged += (_, e) =>
        {
            if (adding || more.Visibility != Visibility.Visible || e.BringIntoViewDistanceY > 900) return;
            adding = true;
            DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () => { Add(); adding = false; });
        };
        host.Children.Add(grid);
        host.Children.Add(more);
        return host;
    }
    /// <summary>The Library's genre rows settle as TMDB answers: the panel is drawn again once the reading is done - the panel alone.</summary>
    private async Task FollowLibraryAsync(StackPanel panel, Grid overlay, double now)
    {
        for (var i = 0; i < 60; i++)
        {
            await Task.Delay(2000);
            if (!ReferenceEquals(_videoHub, overlay) || _hubTab != "library") return;
            JsonObject? lib = null;
            try { lib = JsonNode.Parse(await ModelCallAsync("videoLibraryTab", _hubSort, _hubGroup) ?? "null") as JsonObject; } catch { }
            var pending = lib?["pending"] is JsonValue pv && pv.TryGetValue<int>(out var pn) ? pn : 0;
            if (pending == 0) { if (ReferenceEquals(_videoHub, overlay) && _hubTab == "library") await DrawLibraryAsync(panel, overlay, now); return; }
        }
    }
    /// <summary>A Browse row opened in full (2026-09-22, "I'm seeing Yours has 988 in Action & Adventure but I can't actually see those 988"):
    /// the same row and the same rule, as a grid - Yours is every household title in the genre, a catalog row is read deeper. Paged by
    /// Show more, so a thousand posters are never built at once.</summary>
    private async Task DrawBrowseFullAsync(StackPanel panel, Grid overlay, double now)
    {
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        JsonObject? r = null;
        try { r = JsonNode.Parse(await ModelCallAsync("videoBrowseRow", _browseGenre, _browseRow, _browseOffer, _browseWant) ?? "null") as JsonObject; } catch (Exception e) { LogLine("browse row: " + e.Message); }
        if (!ReferenceEquals(_videoHub, overlay) || _hubTab != "browse" || _browseRow is null) return;
        var built = new StackPanel { Spacing = 14 };
        Button? first = null;
        var cards = (r?["cards"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var total = r?["total"] is JsonValue tv && tv.TryGetValue<int>(out var tn) ? tn : cards.Count;
        var done = r?["done"]?.GetValue<bool>() != false;
        var reading = r?["reading"] is JsonValue rv && rv.TryGetValue<int>(out var rn) ? rn : 0;   // Yours: the household titles whose genre TMDB has not answered for yet
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        var back = Chip(new TextBlock { Text = "←  Browse", FontSize = 13, Foreground = HubAmber }, false);
        ToolTipService.SetToolTip(back, "Back to the genre's rows.");
        back.Click += (_, __) => { _browseRow = null; _browseWant = BrowseWantStep; _ = DrawBrowseAsync(panel, overlay, now); };
        head.Children.Add(back);
        head.Children.Add(RowHead(S(r, "name") + "  ·  " + S(r, "genreName") + (total > 0 ? "  ·  " + total.ToString("N0") : "") + (done ? "" : "  ·  reading…"), HubInk));
        built.Children.Add(head);
        var disc = new TextBlock { Text = LensDisclosureLine(r ?? new JsonObject(), S(r, "dataDate")), FontSize = 12, Foreground = HubDim, TextWrapping = TextWrapping.Wrap };
        ToolTipService.SetToolTip(disc, "What is counted: " + S(r, "counted") + "\nWho is counted: " + S(r, "who") + "\nWho decides: " + S(r, "decides") + "\nSource: " + S(r, "source") + "  ·  " + S(r, "sourceUrl"));
        built.Children.Add(disc);
        if (cards.Count == 0) built.Children.Add(new TextBlock { Text = done ? "Nothing here." : "Reading…", FontSize = 13, Foreground = HubDim });
        else
        {
            var buttons = new List<Button>();
            foreach (var c in cards)
            {
                var btn = _browseRow == "yours" ? MenuCardButton(c, true, now) : BrowseCardButton(c);
                if (btn is not null) buttons.Add(btn);
            }
            first = buttons.FirstOrDefault();
            built.Children.Add(CardGrid(buttons));
        }
        if (r?["more"]?.GetValue<bool>() == true && done)
        {
            var more = Chip(new TextBlock { Text = "Show more", FontSize = 13, Foreground = HubAmber }, false);
            ToolTipService.SetToolTip(more, "Another " + BrowseWantStep + (_browseRow == "yours" ? " of your titles." : " from TMDB's catalog, read in the row's order."));
            more.Click += (_, __) => { _browseWant += BrowseWantStep; _ = DrawBrowseFullAsync(panel, overlay, now); };
            // as the Library's grid: the next page reads itself as Show more comes within about a screen of the view (2026-09-25)
            var asked = false;
            more.EffectiveViewportChanged += (sender, e) =>
            {
                if (asked || e.BringIntoViewDistanceY > 900) return;
                asked = true;
                ((TextBlock)more.Content).Text = "Loading more\u2026";
                _browseWant += BrowseWantStep; _ = DrawBrowseFullAsync(panel, overlay, now);
            };
            built.Children.Add(more);
        }
        var wasEmpty = panel.Children.Count == 0;
        if (!ReferenceEquals(_videoHub, overlay) || _hubTab != "browse" || _browseRow is null) return;
        panel.Children.Clear();
        while (built.Children.Count > 0) { var child = built.Children[0]; built.Children.RemoveAt(0); panel.Children.Add(child); }
        if (first is not null && (wasEmpty || _hubCur is null)) { _hubCur = first; try { first.Focus(FocusState.Keyboard); } catch { } }
        if (!done || reading > 0) _ = FollowBrowseFullAsync(panel, overlay, now);
    }
    /// <summary>A row opened in full while its deeper pages were still being read: drawn again once they are in.</summary>
    private async Task FollowBrowseFullAsync(StackPanel panel, Grid overlay, double now)
    {
        for (var i = 0; i < 40; i++)
        {
            await Task.Delay(1200);
            if (!ReferenceEquals(_videoHub, overlay) || _hubTab != "browse" || _browseRow is null) return;
            JsonObject? r = null;
            try { r = JsonNode.Parse(await ModelCallAsync("videoBrowseRow", _browseGenre, _browseRow, _browseOffer, _browseWant) ?? "null") as JsonObject; } catch { }
            var reading2 = r?["reading"] is JsonValue rv2 && rv2.TryGetValue<int>(out var rn2) ? rn2 : 0;
            if (r?["done"]?.GetValue<bool>() != false && reading2 == 0) { await DrawBrowseFullAsync(panel, overlay, now); return; }
        }
    }
    private DateTime _browseWarmAt = DateTime.MinValue;
    /// <summary>The other tabs read ahead (2026-09-22): while the person is on this one, the Browse genre they last chose and the Library's
    /// own rows are asked for once, so the press finds them there. Core keeps both a day (Browse) or in memory (the Library); this only starts
    /// them earlier, and never while a title is playing on the screen. The live guides too (2026-10-05, "taking a lot of time for live tv to
    /// get populated, and not in the background while I'm idling on the Watch tab either"): the Watch screen open is a person about to look,
    /// so the guides are read on their hidden, muted pages while the person is on any tab, at core's own cadence (15 min a service).</summary>
    private async Task WarmTabsAsync()
    {
        if (DateTime.UtcNow - _browseWarmAt < TimeSpan.FromMinutes(5)) return;
        _browseWarmAt = DateTime.UtcNow;
        try
        {
            if (_hubTab != "live") _ = ModelCallAsync("videoLiveRead", false);
            if (_hubTab != "browse") await ModelCallAsync("videoBrowse", _browseGenre, _browseOffer);
            if (_hubTab != "library") await ModelCallAsync("videoLibraryTab", _hubSort);
        }
        catch (Exception e) { LogLine("tab warm: " + e.Message); }
    }
    /// <summary>The Browse tab's own drawing (2026-09-22): the offer chips, the genre chips and the rows, built and then swapped into the
    /// tab's panel - a chip press or the rows arriving redraws this panel alone, never the page (the page had flashed on every press).</summary>
    private async Task DrawBrowseAsync(StackPanel panel, Grid overlay, double now)
    {
        if (_videoHub is not null && !ReferenceEquals(_videoHub, overlay)) return;   // a newer page took over while this was being read
        if (_browseRow is not null) { await DrawBrowseFullAsync(panel, overlay, now); return; }
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        var built = new StackPanel { Spacing = 18 };
        Button? first = null;

            // Browse by genre (2026-09-22, "let people browse by genre, need to use only transparent algorithms though, that's the rule"): a chip
            // per genre, then Yours and the three rows TMDB's catalog gives on the household's services - each with its formula, source, region and
            // data date on its head, the three-layer disclosure on hover, as the lens rows. Core applies only what the row names; the host draws.
            JsonObject? br = null;
            try { br = JsonNode.Parse(await ModelCallAsync("videoBrowse", _browseGenre, _browseOffer) ?? "null") as JsonObject; } catch (Exception e) { LogLine("browse: " + e.Message); }
            if (S(br, "genre").Length > 0) _browseGenre = S(br, "genre");
            if (S(br, "offer").Length > 0) _browseOffer = S(br, "offer");
            // the offer filter (2026-09-22): Included - with a subscription, free, free with ads, or owned - or Anything (rent and buy too); every row
            // it narrows prints it
            if (br?["tmdbKey"]?.GetValue<bool>() == true && br["offers"] is JsonArray offerList)
            {
                var offerLine = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
                offerLine.Children.Add(new TextBlock { Text = "Show", FontSize = 12, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) });
                foreach (var o in offerList.OfType<JsonObject>())
                {
                    var oid = S(o, "id"); var on = oid == _browseOffer;
                    var oc = Chip(new TextBlock { Text = S(o, "label"), FontSize = 12, Foreground = on ? HubAmber : HubInk }, on);
                    ToolTipService.SetToolTip(oc, S(o, "hint"));
                    var o2 = oid;
                    oc.Click += (_, __) => { if (_browseOffer != o2) { _browseOffer = o2; _browseRow = null; _ = DrawBrowseAsync(panel, overlay, now); } };
                    offerLine.Children.Add(oc);
                }
                built.Children.Add(offerLine);
            }
            var browseKey = br?["tmdbKey"]?.GetValue<bool>() == true;
            var genreName = S(br, "genreName");
            var genreChips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            foreach (var g in (br?["genres"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
            {
                var gid = S(g, "id"); var gname = S(g, "name"); var on = gid == _browseGenre;
                int? count = g["count"] is JsonValue cv && cv.TryGetValue<int>(out var cn) ? cn : null;
                var none = count == 0 && !on;
                var chip = Chip(new TextBlock { Text = gname, FontSize = 13, Foreground = on ? HubAmber : none ? HubDim : HubInk }, on);
                ToolTipService.SetToolTip(chip, none ? "TMDB lists nothing filed under " + gname + " on your services (availability by JustWatch, US)."
                    : count is int c ? c.ToString("N0") + " titles filed under " + gname + " on your services (TMDB; availability by JustWatch, US)." : gname);
                chip.IsEnabled = !none;   // a verb that cannot act, with its reason in the tooltip (the host's contrast rule)
                var g2 = gid;
                chip.Click += (_, __) => { if (_browseGenre != g2) { _browseGenre = g2; _browseRow = null; _ = DrawBrowseAsync(panel, overlay, now); } };
                genreChips.Children.Add(chip);
            }
            built.Children.Add(Carousel(genreChips));
            if (!browseKey) built.Children.Add(new TextBlock { Text = "A TMDB key (the TMDB key chip on the Watch tab) opens the rest: what each genre has on your services (top rated, newest, most voted). Without it only your own titles whose genre is already known show here.", FontSize = 13, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
            var browseDone = br?["done"]?.GetValue<bool>() != false;
            var yoursReading = 0;
            foreach (var r in (br?["rows"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
            {
                var rid = S(r, "id");
                var cards = (r["cards"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
                var reading = r["reading"] is JsonValue rv3 && rv3.TryGetValue<int>(out var rn3) ? rn3 : 0;
                if (rid == "yours") yoursReading = reading;
                var browseHead = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
                // the head opens the row in full ("I should be able to click one of the lenses like Yours, Top Rated, Newest, and see other items")
                var total = r["total"] is JsonValue tv2 && tv2.TryGetValue<int>(out var tn2) ? tn2 : cards.Count;
                var headText = S(r, "name") + (total > 0 ? "  ·  " + total.ToString("N0") : "") + (rid != "yours" && !browseDone && cards.Count == 0 ? "  ·  reading…" : "");
                var openRow = new Button { Content = RowHead(headText + "  →", HubInk), Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(0) };
                ToolTipService.SetToolTip(openRow, "See all of " + S(r, "name") + " for " + genreName + ", as a grid.");
                var rid2 = rid;
                openRow.Click += (_, __) => { _browseRow = rid2; _browseWant = BrowseWantStep; _ = DrawBrowseAsync(panel, overlay, now); };
                browseHead.Children.Add(openRow);
                var disc = new TextBlock { Text = LensDisclosureLine(r, S(r, "dataDate")), FontSize = 12, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Bottom, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 1400 };
                ToolTipService.SetToolTip(disc, "What is counted: " + S(r, "counted") + "\nWho is counted: " + S(r, "who") + "\nWho decides: " + S(r, "decides") + "\nSource: " + S(r, "source") + "  ·  " + S(r, "sourceUrl"));
                browseHead.Children.Add(disc);
                built.Children.Add(browseHead);
                if (rid == "yours")
                {
                    if (cards.Count > 0) built.Children.Add(CardRow(cards.Take(40), true, now, ref first));
                    else built.Children.Add(new TextBlock { Text = "None of your titles is filed under " + genreName + (browseKey && reading > 0 ? " yet. Reading " + reading + " titles' genres…" : "."), FontSize = 13, Foreground = HubDim });
                }
                else if (cards.Count > 0) built.Children.Add(BrowseRow(cards, ref first));
                else if (browseDone) built.Children.Add(new TextBlock { Text = "TMDB lists nothing here on your services.", FontSize = 13, Foreground = HubDim });
            }
        var wasEmpty = panel.Children.Count == 0;
        if (_videoHub is not null && !ReferenceEquals(_videoHub, overlay)) return;
        panel.Children.Clear();
        while (built.Children.Count > 0) { var child = built.Children[0]; built.Children.RemoveAt(0); panel.Children.Add(child); }
        // the page was put up before these rows existed, so the first card takes the focus when the panel first fills (and when the
        // page has none); a chip press mid-page leaves the focus where the person put it
        if (first is not null && (wasEmpty || _hubCur is null)) { _hubCur = first; try { first.Focus(FocusState.Keyboard); } catch { } }
        if (!browseDone || yoursReading > 0) _ = FollowBrowseAsync(panel, overlay, now);
    }
    /// <summary>A Browse row's cards (2026-09-22): TMDB's title, the row's own number with its source, and the household services that carry
    /// it with their offer - one plays on press, several offer the choice. The press goes through core (videoBrowsePlay: the service's own search).</summary>
    /// <summary>One Browse card as a button, for a row or for a row opened in full.</summary>
    private Button? BrowseCardButton(JsonObject c, bool compact = false)
    {
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
            var svcs = (c["services"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
            if (svcs.Count == 0 && S(c, "value") != "Not on your services") return null;   // a watchlist title on none of the services is shown (2026-10-03)
            var title = S(c, "title"); var cid = S(c, "id"); var poster = c["poster"]?.GetValue<string>(); var backdrop = c["backdrop"]?.GetValue<string>();
            var year = c["year"] is JsonValue yv && yv.TryGetValue<int>(out var yi) ? yi.ToString() : "";
            var kindWord = S(c, "kind") == "series" ? "Series" : "Movie";
            var art = new Grid { Width = CardArtW, Height = CardArtH };
            art.Children.Add(new Border { Background = HubCard, CornerRadius = new CornerRadius(6), Child = new TextBlock { Text = Shorten(title, 28), FontSize = 14, Foreground = HubDim, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, Margin = new Thickness(8) } });
            CardArt(art, backdrop, poster);
            // TMDB's new episode, as on My List (2026-09-24, "including the banner on the New episodes, Last 10 Days lens"): the red corner ribbon
            if (S(c, "badge") is { Length: > 0 } newEp && S(c, "badgeFrom") == "tmdb")
            {
                art.Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, art.Width, art.Height) };
                var ribbon = new Border { Width = 124, Height = 22, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xC6, 0x28, 0x28)), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(-40, 18, 0, 0), RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5), RenderTransform = new RotateTransform { Angle = -45 }, Child = new TextBlock { Text = newEp, FontSize = 11, FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xFF, 0xFF, 0xFF)), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } };
                ToolTipService.SetToolTip(ribbon, "A new episode aired " + newEp.Replace("New ", "") + " - per TMDB.");
                art.Children.Add(ribbon);
            }
            // each service as its symbol, a title on several of them on a small stack (2026-09-23)
            art.Children.Add(new Border { HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(6), Child = MarkStack(svcs.Select(x => (S(x, "app"), S(x, "name")))) });
            var cell = new StackPanel { Spacing = 4, Width = CardCellW };
            cell.Children.Add(StackBehind(art, svcs.Count));
            cell.Children.Add(MarqueeTitle(Shorten(title, 36), title, CardTitleSize, HubInk));
            var value = S(c, "value");
            // compact (Watch's rows, 2026-09-24, "move lines #2 and #4 under the tooltip for each item, so they can match the continue & my
            // list rows better"): the title and the rating; the row's own number and the facts line go to the tooltip
            if (value.Length > 0 && !compact) cell.Children.Add(new TextBlock { Text = value, FontSize = 11, Foreground = HubAmber, TextTrimming = TextTrimming.CharacterEllipsis });
            // TMDB's rating on every title (2026-09-24), as on the Continue / My List cards; not twice under a row that is itself the rating
            var ratingLine = S(c, "rating");
            var mineB = c["mine"] is JsonValue mbv && mbv.TryGetValue<double>(out var mbd) ? mbd : (double?)null;
            if ((ratingLine.Length > 0 && ratingLine != value) || mineB is not null) cell.Children.Add(MakeRatingLine(ratingLine != value ? ratingLine : "", mineB, 11, HubDim).Root);
            var offer = svcs.Count > 0 ? S(svcs[0], "offer") : "Not on your services";
            var facts = string.Join("  ·  ", new[] { year, kindWord, svcs.Count == 1 ? offer : svcs.Count + " of your services" }.Where(x => x.Length > 0));
            if (!compact) cell.Children.Add(new TextBlock { Text = facts, FontSize = 11, Foreground = HubDim, TextTrimming = TextTrimming.CharacterEllipsis });
            var btn = new Button { Content = cell, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(4) };
            var overview = S(c, "overview");
            var where = string.Join(", ", svcs.Select(x => S(x, "name") + (S(x, "offer").Length > 0 ? " (" + S(x, "offer") + ")" : "")));
            ToolTipService.SetToolTip(btn, title + (compact ? "\n" + (value.Length > 0 ? value + "\n" : "") + facts : "") + "\n\nOn " + where + "." + (overview.Length > 0 ? "\n\n" + Shorten(overview, 320) + "\n· TMDB" : ""));
            var playVerb = S(c, "play") == "binge" ? "videoBingePlay" : "videoBrowsePlay";   // The Binge's own guard + mismatch note (2026-09-24)
            // draggable onto Watch's windows like the rows above (2026-09-26): its first service, played the way its own press plays
            if (svcs.Count > 0) btn.Tag = new CardPick("", S(c, "kind"), cid, null, title, poster, S(svcs[0], "name"), S(svcs[0], "app"), playVerb);
            if (svcs.Count == 0)
            {
                var dk = S(c, "kind");
                btn.Click += (_, __) => ShowTitleDetails(title, dk, null);   // none of the services carries it: its page says where it streams
            }
            else if (svcs.Count == 1)
            {
                var (a1, n1) = (S(svcs[0], "app"), S(svcs[0], "name"));
                btn.Click += (_, __) => { if (PickLeavesWatch(title)) { CloseVideoHub(); ShowStageCurtain(title, n1, poster); } _ = BrowsePlayAsync(a1, cid, title, n1, playVerb); };
            }
            else
            {
                var pick = new MenuFlyout { Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Bottom };
                foreach (var sv in svcs)
                {
                    var (a1, n1, o1) = (S(sv, "app"), S(sv, "name"), S(sv, "offer"));
                    var it = new MenuFlyoutItem { Text = "Play on " + n1 + (o1.Length > 0 ? "  ·  " + o1 : ""), Icon = new FontIcon { Glyph = "\uE768" } };
                    it.Click += (_, __) => { if (PickLeavesWatch(title)) { CloseVideoHub(); ShowStageCurtain(title, n1, poster); } _ = BrowsePlayAsync(a1, cid, title, n1, playVerb); };
                    pick.Items.Add(it);
                }
                btn.Click += (_, __) => pick.ShowAt(btn);
            }
            // Add to a service's My List (2026-09-23): the service's own copy of the catalog title is found first
            var lsKind = S(c, "kind") == "series" ? "series" : "movie";
            var bTmdb = cid.StartsWith("tmdb:", StringComparison.Ordinal) ? cid.Substring(5) : null;
            int? bYear = c["year"] is JsonValue byv && byv.TryGetValue<double>(out var byd) ? (int)byd : null;
            btn.ContextFlyout = RatingFlyout(title, lsKind, tmdb: bTmdb, year: bYear, extra: async fly => { if (playVerb == "videoBingePlay") BingeHideItem(fly, cid, title); if (!_watchActive) foreach (var sv in svcs) await AddListAddItemAsync(fly, S(sv, "app"), S(sv, "name"), cid, title, null, lsKind, "1"); });
        return btn;
    }
    /// <summary>Cards laid out in a grid (a row opened in full): as many columns as the canvas fits.</summary>
    private Panel CardGrid(IReadOnlyList<Button> buttons)
    {
        // wrapped at the width it has, the corner's margin included (it had counted the canvas's width at 236 a card: the last column ran off)
        var grid = new FlowPanel { HorizontalSpacing = 12, VerticalSpacing = 12 };
        foreach (var b in buttons) grid.Children.Add(b);
        return grid;
    }
    /// <summary>A card row brought to a new list of cards without being rebuilt: the cards not in it leave, the new ones fade in at their
    /// place, the kept ones move (each card keyed by its id, AutomationId "row:<id>").</summary>
    private void UpdateRowInPlace(StackPanel line, List<JsonObject> cards, bool compact = false)
    {
        string Id(JsonObject c) => c["id"]?.GetValue<string>() ?? "";
        var want = cards.Select(Id).ToList();
        var wanted = new HashSet<string>(want);
        var have = new Dictionary<string, UIElement>();
        // a moved card glides and a leaving one fades as its place closes, as Continue watching and My list do (2026-09-25, the overnight list);
        // the dust is kept for a person's own removals
        var was = new Dictionary<UIElement, double>();
        foreach (var el in line.Children) { try { was[el] = el.TransformToVisual(line).TransformPoint(new Windows.Foundation.Point(0, 0)).X; } catch { } }
        foreach (var el in line.Children.ToList())
        {
            var id = Microsoft.UI.Xaml.Automation.AutomationProperties.GetAutomationId(el) is { Length: > 4 } a && a.StartsWith("row:", StringComparison.Ordinal) ? a.Substring(4) : "";
            if (id.Length == 0 || !wanted.Contains(id) || have.ContainsKey(id))
            {
                if (id == "gone") continue;
                Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(el, "gone"); el.IsHitTestVisible = false;
                ShrinkAway(line, el, 0, true);
            }
            else have[id] = el;
        }
        var glide = new List<(UIElement el, double x0)>();
        var at = 0;
        for (var i = 0; i < cards.Count; i++)
        {
            var id = want[i];
            if (have.TryGetValue(id, out var el))
            {
                var now = line.Children.IndexOf(el);
                if (now != at)
                {
                    try { Microsoft.UI.Xaml.Hosting.ElementCompositionPreview.GetElementVisual(el).ImplicitAnimations = null; } catch { }
                    line.Children.Move((uint)now, (uint)at);
                    if (was.TryGetValue(el, out var x0)) glide.Add((el, x0));
                }
                at++;
                continue;
            }
            var btn = BrowseCardButton(cards[i], compact);
            if (btn is null) continue;
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(btn, "row:" + id);
            btn.Opacity = 0;
            line.Children.Insert(at, btn);
            SlideOnMove(btn);
            var fade = new DoubleAnimation { From = 0, To = 1, Duration = new Duration(TimeSpan.FromMilliseconds(450)), EnableDependentAnimation = true };
            Storyboard.SetTarget(fade, btn); Storyboard.SetTargetProperty(fade, "Opacity");
            var sb = new Storyboard(); sb.Children.Add(fade); sb.Begin();
            at++;
        }
        if (glide.Count == 0) return;
        line.UpdateLayout();
        foreach (var (el, x0) in glide) Glide(line, el, x0);
    }
    /// <summary>A card slides to its new place when its row changes around it, instead of jumping (a composition implicit Offset animation).</summary>
    private static void SlideOnMove(UIElement el)
    {
        try
        {
            var visual = Microsoft.UI.Xaml.Hosting.ElementCompositionPreview.GetElementVisual(el);
            var comp = visual.Compositor;
            var move = comp.CreateVector3KeyFrameAnimation();
            move.Target = "Offset";
            move.InsertExpressionKeyFrame(1f, "this.FinalValue");
            move.Duration = TimeSpan.FromMilliseconds(380);
            var set = comp.CreateImplicitAnimationCollection();
            set["Offset"] = move;
            visual.ImplicitAnimations = set;
        }
        catch { /* the card jumps instead */ }
    }
    private ScrollViewer BrowseRow(IEnumerable<JsonObject> cards, ref Button? first, bool compact = false)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        foreach (var c in cards)
        {
            var btn = BrowseCardButton(c, compact);
            if (btn is null) continue;
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(btn, "row:" + S(c, "id"));   // the key UpdateRowInPlace moves it by
            SlideOnMove(btn);
            row.Children.Add(btn);
            first ??= btn;
        }
        return Carousel(row);
    }
    private async Task BrowsePlayAsync(string app, string cardId, string title, string service, string verb = "videoBrowsePlay")
    {
        var raw = await ModelCallAsync(verb, app, cardId);
        JsonObject? r = null;
        try { r = raw is null ? null : JsonNode.Parse(raw) as JsonObject; } catch { }
        if (r?["ok"]?.GetValue<bool>() == true)
        {
            if (r["resolving"]?.GetValue<bool>() == true) _ = AfterResolveAsync(app);
            SetPill("Prism · " + Shorten(title, 40) + " on " + service);
            return;
        }
        SetPill("Prism · could not play " + Shorten(title, 40) + (raw is null ? "" : ": " + Shorten(raw, 80)));
    }
    /// <summary>The Browse rows drawn while they were still being read: the panel is drawn again once they are in - the panel alone, never the page.</summary>
    private async Task FollowBrowseAsync(StackPanel panel, Grid overlay, double now)
    {
        for (var i = 0; i < 40; i++)
        {
            await Task.Delay(1200);
            if (!ReferenceEquals(_videoHub, overlay) || _hubTab != "browse") return;
            JsonObject? br = null;
            try { br = JsonNode.Parse(await ModelCallAsync("videoBrowse", _browseGenre, _browseOffer) ?? "null") as JsonObject; } catch { }
            var yr = 0;
            foreach (var row2 in (br?["rows"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                if (row2["id"]?.GetValue<string>() == "yours" && row2["reading"] is JsonValue yv && yv.TryGetValue<int>(out var yn)) yr = yn;
            if (br?["done"]?.GetValue<bool>() != false && yr == 0) { if (ReferenceEquals(_videoHub, overlay) && _hubTab == "browse") await DrawBrowseAsync(panel, overlay, now); return; }
        }
    }
    private async Task PlayResultAsync(string app, string candidateJson, string title, string service)
    {
        var raw = await ModelCallAsync("videoPlayResult", app, candidateJson);
        JsonObject? r = null;
        try { r = raw is null ? null : JsonNode.Parse(raw) as JsonObject; } catch { }
        if (r?["ok"]?.GetValue<bool>() == true)
        {
            if (r["switched"]?.GetValue<bool>() == true && r["sceneId"]?.GetValue<string>() is { } sceneId) await SceneAppliedAsync(sceneId, raw!);
            // a catalog card (2026-09-21): core asks the service's own search first and switches the screen itself once it has
            // the title - the model is re-read when the screen has become the service, so the chrome follows
            if (r["resolving"]?.GetValue<bool>() == true) _ = AfterResolveAsync(app);
            SetPill("Prism · " + Shorten(title, 40) + " on " + service);
            return;
        }
        SetPill("Prism · could not play " + Shorten(title, 40) + (raw is null ? "" : ": " + Shorten(raw, 80)));
    }
    private async Task AfterResolveAsync(string app)
    {
        var t0 = DateTime.UtcNow;
        while ((DateTime.UtcNow - t0).TotalSeconds < 45)
        {
            await Task.Delay(1000);
            JsonObject? sv = null;
            try { sv = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject; } catch { }
            if ((sv?["screen"] as JsonObject)?["app"]?.GetValue<string>() == app) { await ReadModelAsync(); _ = UpdateWatchGripAsync(); return; }
        }
    }

    private async Task SearchOnAsync(string facetId, string q, string name)
    {
        var raw = await ModelCallAsync("videoSearch", facetId, q);
        JsonObject? r = null;
        try { r = raw is null ? null : JsonNode.Parse(raw) as JsonObject; } catch { }
        if (r?["ok"]?.GetValue<bool>() == true)
        {
            if (r["switched"]?.GetValue<bool>() == true && r["sceneId"]?.GetValue<string>() is { } sceneId) await SceneAppliedAsync(sceneId, raw!);
            SetPill("Prism · searching " + name + " for " + q);
            return;
        }
        SetPill("Prism · could not search " + name + (raw is null ? "" : ": " + Shorten(raw, 80)));
    }
}
