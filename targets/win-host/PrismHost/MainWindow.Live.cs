using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// The Live tab (docs/features/live.md, 2026-09-28, "We need to create a live tab. This is where we'll put all stations and their schedules"):
/// every live channel the household's services carry, as a schedule - half-hour columns from the current half hour, three hours out, a row a
/// channel. Type chips (core's types, the service's own category first), a live search that looks through the guide, and a channel's menu that
/// tunes THE CHANNEL into the big window or a multiview window. Core reads the guides (videoLiveRead, only while this tab is open) and draws
/// nothing; this file only lays out core's rows.
/// </summary>
public sealed partial class MainWindow
{
    private string? _liveType;
    private string _liveQ = "";
    private int _liveSearchRun;
    private int _liveDrawRun;
    private int _liveLoop;            // one follow loop a tab open: a newer one ends the older
    private double _liveScrollX;      // where the schedule was scrolled to, kept across a redraw
    private const double LiveSlotW = 220, LiveChanW = 260, LiveRowH = 60;
    private const long LiveSlotMs = 30 * 60_000;

    private static string LiveClock(double ms) => DateTimeOffset.FromUnixTimeMilliseconds((long)ms).ToLocalTime().ToString("h:mm tt");

    /// <summary>
    /// Modes (2026-09-30, "Let's make the filters buttons across the top of the live screen work as 'mode' buttons ... Preferably we turn all
    /// the filters on live into fun modes for people to choose from"): a type chip is a mode with a symbol; picked, it filters the grid, puts a
    /// title above it, marks each program on now with a symbol (in Sports mode, the sport's), and in Sports mode shows the day's scores. The
    /// choice is kept on the device (host-prefs live.mode) and comes back when the tab opens again. "All" is no mode.
    /// </summary>
    private static string ModeSymbol(string? type) => type switch
    {
        null or "" => "",
        "Sports" => "\U0001F3C6",
        "News" => "\U0001F4F0",
        "Kids" => "\U0001F9F8",
        "Movies" => "\U0001F3AC",
        "Comedy" => "\U0001F602",
        "Drama" => "\U0001F3AD",
        "Reality" => "\U0001F4FA",
        "Entertainment" => "\u2728",
        "Music" => "\U0001F3B5",
        "Local" => "\U0001F4CD",
        "Documentary" => "\U0001F30D",
        "Formula 1" => "\U0001F3CE",
        "MLS" => "\u26BD",
        _ => "\U0001F4FA",
    };
    private static string SportSymbol(string? sport) => sport switch
    {
        "football" => "\U0001F3C8", "soccer" => "\u26BD", "baseball" => "\u26BE", "basketball" => "\U0001F3C0", "hockey" => "\U0001F3D2",
        "golf" => "\u26F3", "tennis" => "\U0001F3BE", "racing" => "\U0001F3CE", "fighting" => "\U0001F94A", _ => "\U0001F3C6",
    };
    // ink, not grey, for anything that is information on its own: the time line, a row's "Starts ...", a block's start, a card's state
    // (2026-10-01, "Too much gray text on gray. Sometimes your contrast choices are painful"; win-host-spec section 5: grey only for a
    // secondary line under a primary one, which here is a row's service line)
    private string? _liveModeLoaded;
    private async Task DrawLiveAsync(StackPanel panel, Grid overlay)
    {
        panel.Children.Clear();
        if (_liveModeLoaded is null) { _liveModeLoaded = HostPrefs.GetString("live.mode", ""); _liveType = _liveModeLoaded.Length > 0 ? _liveModeLoaded : null; }
        _ = ModelCallAsync("videoLiveRead", false);   // core reads a guide only when it is due (15 minutes), and only while this tab is open
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        var search = new TextBox { PlaceholderText = "Search channels and shows", Width = 380, Text = _liveQ, FontSize = 15 };
        ToolTipService.SetToolTip(search, "Looks through the guide: channel names, what's on now and what's on later. Not the catalog.");
        var status = new TextBlock { FontSize = 12, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap, MaxWidth = 900 };
        var refresh = Chip(new TextBlock { Text = "Refresh", FontSize = 13, Foreground = HubInk }, false);
        ToolTipService.SetToolTip(refresh, "Reads each service's guide again now.");
        _liveRefresh = refresh;
        // the status line says only "Reading the guides..." while one is read; each service's count and read time sit in Refresh's tooltip
        // (2026-10-01, "a lot of unnecessary label text to the right of refresh")
        head.Children.Add(search); head.Children.Add(refresh); head.Children.Add(status);
        panel.Children.Add(head);
        var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        panel.Children.Add(chips);
        // live events above the grid (2026-09-30, Apple TV's Formula 1 and MLS): a match on now is the most time-bound thing on the tab, and
        // a grid of 126 channels had put the row out of sight
        var events = new StackPanel { Spacing = 8, Margin = new Thickness(0, 0, 0, 6) };
        panel.Children.Add(events);
        var grid = new StackPanel { Spacing = 4 };
        panel.Children.Add(grid);
        Task Draw() => DrawLiveGridAsync(grid, chips, status, events, overlay);
        refresh.Click += async (_, __) => { await ModelCallAsync("videoLiveRead", true); SetPill("Prism" + Mid + "reading the guides"); _liveReading = true; await Draw(); };
        search.TextChanged += async (_, __) =>
        {
            var my = ++_liveSearchRun;
            await Task.Delay(300);   // a word at a time, not a letter
            if (my != _liveSearchRun || !ReferenceEquals(_videoHub, overlay)) return;
            _liveQ = search.Text.Trim();
            await Draw();
        };
        await Draw();
        _ = FollowLiveAsync(grid, chips, status, events, overlay);
    }

    private bool _liveReading;
    private Button? _liveRefresh;
    /// <summary>The tab follows its guide for as long as it is up (one loop a tab open): every few seconds while a guide is being read, every five
    /// minutes otherwise - "Now" moves on, and core is asked to read again (it reads a guide only when it is due). A draw another draw overtook
    /// changes nothing here (2026-09-29 review: typing during a read had ended the loop, and a tab left up kept its first "Now").</summary>
    private async Task FollowLiveAsync(StackPanel grid, StackPanel chips, TextBlock status, StackPanel events, Grid overlay)
    {
        var loop = ++_liveLoop;
        var quiet = 0;
        while (true)
        {
            await Task.Delay(4000);
            if (loop != _liveLoop || !ReferenceEquals(_videoHub, overlay) || _hubTab != "live") return;
            if (!_liveReading && ++quiet < 75) continue;   // nothing being read: the next look in five minutes
            if (!_liveReading) { quiet = 0; _ = ModelCallAsync("videoLiveRead", false); }
            await DrawLiveGridAsync(grid, chips, status, events, overlay);
        }
    }

    /// <summary>The chips, the status line, the grid and the live events from core's guide; true while a service's guide is still being read.</summary>
    private async Task<bool> DrawLiveGridAsync(StackPanel grid, StackPanel chips, TextBlock status, StackPanel events, Grid overlay)
    {
        var run = ++_liveDrawRun;
        JsonObject? g = null;
        try { g = JsonNode.Parse(await ModelCallAsync("videoLiveGuide", _liveType, _liveQ.Length > 0 ? _liveQ : null) ?? "null") as JsonObject; } catch (Exception e) { LogLine("live: " + e.Message); }
        if (run != _liveDrawRun || !ReferenceEquals(_videoHub, overlay) || _hubTab != "live") return false;   // overtaken: _liveReading stands as it was
        grid.Children.Clear(); chips.Children.Clear(); events.Children.Clear();
        if (g is null) { grid.Children.Add(new TextBlock { Text = "The guide couldn't be read.", FontSize = 16, Foreground = HubInk }); return false; }

        // the status line: each service's guide, how many channels, when it was read
        var reading = false;
        var parts = new List<string>();
        foreach (var gd in (g["guides"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var n = gd["channels"]?.GetValue<int>() ?? 0;
            var ne = gd["events"]?.GetValue<int>() ?? 0;
            // a service with events and no channels (Apple TV): its events, when they were read
            if (n == 0 && ne > 0)
            {
                var eline = S(gd, "name") + " " + ne + (ne == 1 ? " event" : " events");
                if (gd["eventsReading"]?.GetValue<bool>() == true) { eline += ", reading its pages" + (char)0x2026; reading = true; }
                else if (gd["eventsReadAt"] is JsonValue era && era.TryGetValue<double>(out var erat)) eline += ", read " + LiveClock(erat);
                parts.Add(eline);
                continue;
            }
            var line = S(gd, "name") + " " + n + (n == 1 ? " channel" : " channels");
            if (gd["reading"]?.GetValue<bool>() == true) { line += ", reading its guide" + (char)0x2026; reading = true; }
            else if (gd["readAt"] is JsonValue ra && ra.TryGetValue<double>(out var rat)) line += ", read " + LiveClock(rat);
            else if (gd["canRead"]?.GetValue<bool>() != true) line += ", as its player last showed them";
            if (S(gd, "status") != "signed-in") line += " (sign in to read it)";
            parts.Add(line);
        }
        status.Text = reading ? "Reading the guides" + (char)0x2026 : "";
        if (_liveRefresh is not null) ToolTipService.SetToolTip(_liveRefresh, "Reads each service's guide again now." + (parts.Count > 0 ? "\n" + string.Join("\n", parts) : ""));
        _liveReading = reading;

        // the type chips: All, then each type with its count - the service's own category first, Prism's guess from the name otherwise
        var types = (g["types"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var total = types.Sum(t => t["count"]?.GetValue<int>() ?? 0);
        // a kept mode that is no longer a type (Local, taken out 2026-10-02) falls back to All, once the guide has anything to say
        if (_liveType is { Length: > 0 } kept && total > 0 && !types.Any(t => S(t, "type") == kept)) { _liveType = null; HostPrefs.Set("live.mode", ""); await DrawLiveGridAsync(grid, chips, status, events, overlay); return _liveReading; }
        void TypeChip(string label, string? type, int count)
        {
            var sym = ModeSymbol(type);
            var b = Chip(new TextBlock { Text = (sym.Length > 0 ? sym + "  " : "") + label + "  " + count, FontSize = 13, Foreground = HubInk }, _liveType == type);
            b.Padding = new Thickness(12, 4, 12, 4);
            ToolTipService.SetToolTip(b, type is null ? "Every channel, no mode." : type + " mode: only what is filed under " + type + " (the service's own category where it gives one, Prism's guess from the name otherwise), each program on now marked" + (type == "Sports" ? ", and the day's scores" : "") + ". Prism remembers the mode you leave on.");
            b.Click += async (_, __) => { _liveType = type; HostPrefs.Set("live.mode", type ?? ""); await DrawLiveGridAsync(grid, chips, status, events, overlay); };
            chips.Children.Add(b);
        }
        TypeChip("All", null, total);
        foreach (var t in types) TypeChip(S(t, "type"), S(t, "type"), t["count"]?.GetValue<int>() ?? 0);

        var rows = (g["rows"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        if (rows.Count == 0)
        {
            grid.Children.Add(new TextBlock { Text = _liveQ.Length > 0 ? "Nothing in the guide matches \"" + _liveQ + "\"." : reading ? "Reading the guides" + (char)0x2026 : "No live channels yet. Open a service's live guide once, or press Refresh.", FontSize = 15, Foreground = HubInk, Margin = new Thickness(0, 12, 0, 0) });
            return reading;
        }
        // the channels grouped by service, the services by name, a header a service and a "Jump to" strip above the grid in the same
        // order (2026-09-30, "Can we group the live channels by service but give us quick jump to buttons for each service" / "Sort the
        // groups by service name. Same with the buttons"): core's order (type, then name) stands within a service
        var serviceOrder = rows.Select(r => S(r, "service")).Where(n => n.Length > 0).Distinct().OrderBy(n => n, StringComparer.CurrentCultureIgnoreCase).ToList();
        rows = rows.OrderBy(r => { var i = serviceOrder.IndexOf(S(r, "service")); return i < 0 ? int.MaxValue : i; }).ToList();   // a stable sort: core's order within a service
        var headers = new Dictionary<string, FrameworkElement>();
        var jump = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 2, 0, 4) };
        jump.Children.Add(new TextBlock { Text = "Jump to", FontSize = 12, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 4, 0) });
        foreach (var sn in serviceOrder)
        {
            var count = rows.Count(r => S(r, "service") == sn);
            if (count == 0) continue;
            var sn2 = sn;
            // the same chips as above Continue watching (FillContinueJumps): the service's mark and its name
            var app = S(rows.First(r => S(r, "service") == sn), "app");
            var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { ServiceMark(app, sn, 18), new TextBlock { Text = sn, FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center } } };
            var chip = Chip(content, false);
            chip.Padding = new Thickness(6, 3, 10, 3);
            var allEvents = rows.Where(r => S(r, "service") == sn).All(r => r["event"]?.GetValue<bool>() == true);
            ToolTipService.SetToolTip(chip, sn + " has " + count + (allEvents ? (count == 1 ? " event" : " events") : (count == 1 ? " channel" : " channels")) + " in the guide. Press to go to them.");
            chip.Click += (_, __) => { if (headers.TryGetValue(sn2, out var h)) h.StartBringIntoView(new BringIntoViewOptions { VerticalAlignmentRatio = 0, AnimationDesired = true }); };
            jump.Children.Add(chip);
        }
        if (serviceOrder.Count(sn => rows.Any(r => S(r, "service") == sn)) > 1) grid.Children.Add(jump);
        var ws = (g["window"] as JsonObject)?["start"]?.GetValue<double>() ?? 0;
        var we = (g["window"] as JsonObject)?["end"]?.GetValue<double>() ?? ws + 6 * LiveSlotMs;
        // the grid begins now (core's window): every row's program on now starts at the left edge; the half hours are marked from there
        var width = (we - ws) / LiveSlotMs * LiveSlotW;

        // the channels stay put on the left; the schedule beside them scrolls sideways, as far as the services list (2026-09-29)
        var body = new Grid();
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(LiveChanW) });
        body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var namesCol = new StackPanel { Spacing = 4 };
        var linesCol = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Left };
        namesCol.Children.Add(new Border { Height = 26 });
        var times = new Canvas { Width = width, Height = 26 };
        var nowTag = new TextBlock { Text = "Now", FontSize = 12, Foreground = HubAmber };
        Canvas.SetLeft(nowTag, 4); times.Children.Add(nowTag);
        var day = DateTimeOffset.FromUnixTimeMilliseconds((long)ws).ToLocalTime().Date;
        for (var t = Math.Ceiling(ws / LiveSlotMs) * LiveSlotMs; t < we; t += LiveSlotMs)
        {
            var x = (t - ws) / LiveSlotMs * LiveSlotW;
            if (x < 60) continue;   // too close to "Now" to read
            var at = DateTimeOffset.FromUnixTimeMilliseconds((long)t).ToLocalTime();
            var lbl = new TextBlock { Text = (at.Date != day && at.TimeOfDay.TotalMinutes < 30 ? at.ToString("ddd") + " " : "") + LiveClock(t), FontSize = 12, Foreground = HubInk };
            Canvas.SetLeft(lbl, x + 4); times.Children.Add(lbl);
        }
        linesCol.Children.Add(times);
        // a bit of a grid (2026-10-01, "Give the episode guide a bit of a grid please" / "remove those and go with horizontal"): a faint
        // rule under each row, on a sheet behind the rows (the rows' heights are fixed, so the sheet knows where each one ends); no
        // half-hour rules down the schedule
        var sheet = new Grid { Width = width, HorizontalAlignment = HorizontalAlignment.Left };
        sheet.Children.Add(linesCol);
        var scroller = Carousel(sheet);
        scroller.HorizontalScrollBarVisibility = ScrollBarVisibility.Auto;
        // the schedule stays where it was scrolled to when the grid is drawn again
        var keepX = _liveScrollX;
        scroller.ViewChanged += (_, __) => _liveScrollX = scroller.HorizontalOffset;
        if (keepX > 0) scroller.Loaded += (_, __) => scroller.ChangeView(keepX, null, null, true);
        Grid.SetColumn(scroller, 1);
        var nameSheet = new Grid { Children = { namesCol } };   // the rules run under the names too, so a row reads as one line
        body.Children.Add(nameSheet); body.Children.Add(scroller);
        grid.Children.Add(body);

        DrawModeHead(events);   // the mode's title, and in Sports mode the day's scores (2026-09-30)
        // the "Upcoming live events" strip is gone (2026-10-01, "Upcoming live events are all repeated in the schedule below. Therefore there
        // is no reason for this row, right?"): every event is a row under its service, first in the grid, and a live one says LIVE
        string? lastService = null;
        var y = 26.0 + 4;   // the time line and the column's spacing: where the first row begins on the sheet
        // a rule under the time line too (2026-10-01, "1 more row grid line between the times and the first channel")
        foreach (var sh in new[] { sheet, nameSheet }) sh.Children.Insert(0, new Border { Height = 1, Background = HubRule, VerticalAlignment = VerticalAlignment.Top, HorizontalAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(0, 26 + 1, 0, 0) });
        for (var i = 0; i < rows.Count; i++)
        {
            var sn = S(rows[i], "service");
            var (who, line) = LiveRow(rows[i], ws, we, width);
            if (sn != lastService)
            {
                // a group begins with a gap, no header: the service is named by the chip above and on every row (2026-10-01, "Let's get rid
                // of the plain text 'Apple TV' above that column of Apple TV logos"); the Jump to chip brings the group's first row into view
                lastService = sn;
                headers[sn] = (FrameworkElement)who;
                if (i > 0) { namesCol.Children.Add(new Border { Height = 14 }); linesCol.Children.Add(new Border { Height = 14 }); y += 14 + 4; }
            }
            namesCol.Children.Add(who); linesCol.Children.Add(line);
            sheet.Children.Insert(0, new Border { Height = 1, Background = HubRule, VerticalAlignment = VerticalAlignment.Top, HorizontalAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(0, y + LiveRowH + 1, 0, 0) });
            nameSheet.Children.Insert(0, new Border { Height = 1, Background = HubRule, VerticalAlignment = VerticalAlignment.Top, HorizontalAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(0, y + LiveRowH + 1, 0, 0) });
            y += LiveRowH + 4;
            if (i % 15 == 14) { await Task.Delay(1); if (run != _liveDrawRun || !ReferenceEquals(_videoHub, overlay)) return reading; }   // a long guide is laid out a little at a time
        }
        return reading;
    }

    /// <summary>A channel's row in two parts: its logo and name (the fixed column), and its programs on the time line (the scrolling one). A press on
    /// either offers the channel's menu.</summary>
    private (UIElement who, UIElement line) LiveRow(JsonObject r, double ws, double we, double width)
    {
        var name = S(r, "name"); var service = S(r, "service"); var logo = r["logo"]?.GetValue<string>();
        var who = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center, Height = LiveRowH, Width = LiveChanW - 8 };
        var art = new Border { Width = 64, Height = 40, CornerRadius = new CornerRadius(6), Background = HubCard, VerticalAlignment = VerticalAlignment.Center };
        if (logo is { Length: > 0 }) { try { art.Child = new Image { Source = new BitmapImage(Services.ArtCache.UriFor(logo)), Stretch = Stretch.Uniform }; } catch { } }
        if (art.Child is null) art.Child = new Border { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Child = ServiceMark(S(r, "app"), service, 28) };   // no logo given: the service's mark
        who.Children.Add(art);
        var names = new StackPanel { VerticalAlignment = VerticalAlignment.Center, MaxWidth = LiveChanW - 90 };
        names.Children.Add(new TextBlock { Text = name, FontSize = 14, Foreground = HubInk, TextTrimming = TextTrimming.CharacterEllipsis });
        // an event on now says LIVE in amber on its second line, as the score cards do (2026-10-01, the events strip gone)
        var isEvent = r["event"]?.GetValue<bool>() == true;
        var eventOn = isEvent && (r["programs"] as JsonArray)?.OfType<JsonObject>().Any(p => p["now"]?.GetValue<bool>() == true) == true;
        names.Children.Add(new TextBlock { Text = service + Mid + (S(r, "series") is { Length: > 0 } series ? series : S(r, "type")) + (eventOn ? Mid + "\u25CF LIVE" : ""), FontSize = 11, Foreground = eventOn ? HubAmber : HubDim, TextTrimming = TextTrimming.CharacterEllipsis });
        who.Children.Add(names);

        var line = new Canvas { Width = width, Height = LiveRowH - 8, VerticalAlignment = VerticalAlignment.Center };
        foreach (var p in (r["programs"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var ps = p["start"]?.GetValue<double>() ?? ws; var pe = p["end"]?.GetValue<double>() ?? we;
            var x = Math.Max(0, (ps - ws) / LiveSlotMs * LiveSlotW);
            var x2 = Math.Min(width, (pe - ws) / LiveSlotMs * LiveSlotW);
            if (x2 - x < 8) continue;
            var on = p["now"]?.GetValue<bool>() == true; var hit = p["match"]?.GetValue<bool>() == true;
            var shown = p["startsAt"] is JsonValue sa && sa.TryGetValue<double>(out var sat) ? sat : ps;   // drawn from the edge in place of a sliver: its real start
            var text = new StackPanel { Spacing = 1 };
            // in a mode, what is on now carries a symbol: the sport's in Sports mode (core's reading of the words), else the mode's
            var mark = _liveType is { Length: > 0 } && on ? (S(p, "sport") is { Length: > 0 } sp ? SportSymbol(sp) : ModeSymbol(_liveType)) + "  " : "";
            text.Children.Add(new TextBlock { Text = mark + S(p, "title"), FontSize = 13, Foreground = HubInk, TextTrimming = TextTrimming.CharacterEllipsis });
            text.Children.Add(new TextBlock { Text = on ? "on now" + (p["end"] is JsonValue ? ", until " + LiveClock(pe) : "") : LiveClock(shown), FontSize = 11, Foreground = on ? HubAmber : HubInk });
            var block = new Border { Width = x2 - x - 4, Height = LiveRowH - 8, CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 4, 8, 4), Background = on ? HubChipOn : HubCard, BorderBrush = hit ? HubAmber : null, BorderThickness = new Thickness(hit ? 2 : 0), Child = text };
            if (S(p, "desc") is { Length: > 0 } desc) ToolTipService.SetToolTip(block, S(p, "title") + ": " + desc);
            // a program still to come plays nothing yet (2026-10-07, "they should be able to do it to the channel or the current episode, not one
            // in the future"): a press on it says when it starts
            if (!on) block.Tag = "later:" + S(p, "title") + " starts " + LiveClock(shown);
            Canvas.SetLeft(block, x); line.Children.Add(block);
        }

        // an event row whose only block lies hours to the right (the F1 Weekend Warm-Up at 4:30 AM against a window that begins now) looked
        // empty until the schedule was scrolled: it says when it starts at its left edge, where there is nothing else (2026-10-01)
        if (r["event"]?.GetValue<bool>() == true && line.Children.Count > 0 && line.Children.OfType<Border>().Min(b => Canvas.GetLeft(b)) > 4 * LiveSlotW
            && (r["programs"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault()?["start"] is JsonValue fsv && fsv.TryGetValue<long>(out var fms))
        {
            var far = new TextBlock { Text = "Starts " + StartWords(DateTimeOffset.FromUnixTimeMilliseconds(fms).ToLocalTime()), FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
            Canvas.SetLeft(far, 8); Canvas.SetTop(far, (LiveRowH - 8) / 2 - 9); line.Children.Add(far);
        }
        // a channel with no schedule listed (a pop-up channel) says so instead of a bare row; it still tunes (2026-09-30)
        if (line.Children.Count == 0)
        {
            // an event row with its start beyond the window says when (2026-09-30, Apple TV's F1 sessions at night)
            var nextAt = r["next"] is JsonValue nv && nv.TryGetValue<long>(out var nms) ? DateTimeOffset.FromUnixTimeMilliseconds(nms).ToLocalTime() : (DateTimeOffset?)null;
            var none = new TextBlock { Text = nextAt is { } na ? "Starts " + StartWords(na) : "No schedule listed for this channel", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
            Canvas.SetLeft(none, 8); Canvas.SetTop(none, (LiveRowH - 8) / 2 - 9); line.Children.Add(none);
        }
        var (facet, id, url) = (S(r, "facet"), S(r, "id"), r["url"]?.GetValue<string>());
        // an event row (2026-09-30) still to come is not sent anywhere - its page's first button is not Watch, and a press there could write to
        // the household's Up Next (review): the row says when it starts, and a press says so again
        var eventNext = r["next"] is JsonValue nxv && nxv.TryGetValue<long>(out var nxms) ? DateTimeOffset.FromUnixTimeMilliseconds(nxms).ToLocalTime() : (DateTimeOffset?)null;
        var eventWhen = eventNext is { } en ? StartWords(en) : (r["programs"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault()?["start"] is JsonValue psv && psv.TryGetValue<long>(out var pms) ? StartWords(DateTimeOffset.FromUnixTimeMilliseconds(pms).ToLocalTime()) : "";
        Button Press(UIElement content)
        {
            var b = new Button { Content = content, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(0), Height = LiveRowH, HorizontalContentAlignment = HorizontalAlignment.Left };
            OwnHover(b);
            // the type's source in the tooltip, not on the row (2026-10-01: "(Prism's guess)" had been cutting the row's second line short)
            var typeNote = S(r, "typeSource") == "prism" ? " Filed under " + S(r, "type") + " by Prism's reading of the name; the service gives no category."
                : S(r, "typeSource") == "tmdb" ? " Filed under " + S(r, "type") + " by TMDB's genre for " + (S(r, "typeTitle") is { Length: > 0 } tt ? tt : name) + "; the service gives no category." : "";
            // listed under a mode for what is on now (2026-10-02, Movies mode): the title and TMDB's word for it
            if (r["alsoBy"] is JsonObject ab) typeNote += " Listed under " + S(ab, "type") + " while " + S(ab, "title") + " is on, " + (S(ab, "type") == "Movies" ? "a film" : "a documentary") + " by TMDB's word; the channel itself is filed under " + S(r, "type") + ".";
            ToolTipService.SetToolTip(b, (isEvent ? (eventOn ? name + " on " + service + ", on now." : name + " on " + service + " has not started." + (eventWhen.Length > 0 ? " It starts " + eventWhen + "." : "")) : name + " on " + service + ". The channel plays, whatever is on it.") + typeNote);
            // the menu opens at the press, not at the row (2026-09-29, "The menu to send an item to a screen on the live screen comes nowhere
            // close to the cursor. It often closes before the cursor can get to it"): a row is as wide as the whole schedule, and a flyout
            // shown at the row stood at its middle, thousands of pixels from the pointer, across pages that dismiss a flyout on hover
            // a click plays the channel in the big window, as a card's click plays its title; held and pulled, the channel lifts onto the windows
            // as a card does; the menu of windows is the right-click (2026-10-07, "it doesn't let me drag a channel from the schedule up to the
            // windows. It only allows me to click one and choose a dropdown menu, but single clicks should just launch videos")
            Windows.Foundation.Point? pressAt = null;
            Windows.Foundation.Point downAt = default; long downT = 0; var down = false; var lifted = false; uint pid = 0;
            string? later = null;   // the press landed on a program still to come: what it is and when
            string? LaterUnder(object? src)
            {
                for (var d = src as DependencyObject; d is not null && !ReferenceEquals(d, b); d = VisualTreeHelper.GetParent(d))
                    if (d is FrameworkElement { Tag: string tg } && tg.StartsWith("later:", StringComparison.Ordinal)) return tg.Substring(6);
                return null;
            }
            void SayLater() => SetPill("Prism" + Mid + later + ". Press " + name + " or what's on now to watch it");
            b.AddHandler(UIElement.PointerPressedEvent, new Microsoft.UI.Xaml.Input.PointerEventHandler((_, e) =>
            {
                var pt = e.GetCurrentPoint(RootGrid);
                pressAt = pt.Position;
                later = LaterUnder(e.OriginalSource);
                if (!pt.Properties.IsLeftButtonPressed) return;
                down = true; lifted = false; downAt = pt.Position; downT = Environment.TickCount64; pid = e.Pointer.PointerId;
            }), true);
            b.AddHandler(UIElement.PointerMovedEvent, new Microsoft.UI.Xaml.Input.PointerEventHandler((_, e) =>
            {
                if (!down || e.Pointer.PointerId != pid) return;
                var p = e.GetCurrentPoint(RootGrid).Position;
                double dx = Math.Abs(p.X - downAt.X), dy = Math.Abs(p.Y - downAt.Y);
                if (dx < 16 && dy < 16) return;   // a press that barely moves is a click
                down = false;
                // a lift wants the press held a moment or a pull up or down off the row; a quick sideways pull is the schedule's scroll
                if (Environment.TickCount64 - downT < 350 && dx > dy) return;
                if (isEvent && !eventOn) { SetPill("Prism" + Mid + name + " has not started" + (eventWhen.Length > 0 ? ". It starts " + eventWhen : "")); return; }
                if (later is not null) { SayLater(); return; }
                b.ReleasePointerCapture(e.Pointer);
                if (_videoHub is { } hub && BeginLiveDrag(hub, e, new LivePick(facet, id, url, name, service, logo))) { lifted = true; e.Handled = true; }
            }), true);
            b.AddHandler(UIElement.PointerReleasedEvent, new Microsoft.UI.Xaml.Input.PointerEventHandler((_, __) => down = false), true);
            b.Click += async (_, __) =>
            {
                pressAt = null;
                if (lifted) { lifted = false; return; }   // the end of a drag, not a click
                if (later is not null) { SayLater(); return; }
                if (isEvent && !eventOn) { SetPill("Prism" + Mid + name + " has not started" + (eventWhen.Length > 0 ? ". It starts " + eventWhen : "")); return; }
                await TuneIntoAsync(0, facet, id, url, name, service, logo);
            };
            b.RightTapped += (_, e) =>
            {
                e.Handled = true;
                var at = e.GetPosition(RootGrid);
                later = LaterUnder(e.OriginalSource);
                if (later is not null) { SayLater(); return; }
                if (isEvent && !eventOn) { SetPill("Prism" + Mid + name + " has not started" + (eventWhen.Length > 0 ? ". It starts " + eventWhen : "")); return; }
                LiveMenu(at, facet, id, url, name, service, logo);
            };
            return b;
        }
        return (Press(who), Press(line));
    }

    /// <summary>A channel's menu: the big window, or a multiview window - it is the channel that goes there, not the program on it now.</summary>
    private void LiveMenu(Windows.Foundation.Point at, string facet, string id, string? url, string name, string service, string? logo)
    {
        var fly = new MenuFlyout { MenuFlyoutPresenterStyle = (Style)RootGrid.Resources["PrismMenuPresenter"] };
        // the wall under the menu is covered while it is open, so the pointer never reaches a page (a page's hover dismisses a flyout);
        // a press on the cover closes the menu and goes no further
        var shield = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)) };
        Canvas.SetZIndex(shield, 999);
        shield.PointerPressed += (_, e) => { e.Handled = true; fly.Hide(); };
        fly.Opened += (_, __) => { if (!RootGrid.Children.Contains(shield)) RootGrid.Children.Add(shield); };
        fly.Closed += (_, __) => RootGrid.Children.Remove(shield);
        _liveMenu = fly;
        var big = new MenuFlyoutItem { Text = "Watch " + name + " in the big window" };
        big.Click += (_, __) => _ = TuneIntoAsync(0, facet, id, url, name, service, logo);
        fly.Items.Add(big);
        for (var i = 1; i < MvMax; i++)
        {
            var n = i;
            var it = new MenuFlyoutItem { Text = "Add to window " + (n + 1) };
            it.Click += (_, __) => _ = TuneIntoAsync(n, facet, id, url, name, service, logo);
            fly.Items.Add(it);
        }
        fly.ShowAt(RootGrid, new FlyoutShowOptions { Position = at, Placement = FlyoutPlacementMode.BottomEdgeAlignedLeft });
        LogLine("live menu: " + name + " at " + (int)at.X + "," + (int)at.Y);
    }
    private MenuFlyout? _liveMenu;

    /// <summary>The channel tuned into window `index` (0 = the big window): multiview comes on for a small window; the target goes back after.</summary>
    private async Task TuneIntoAsync(int index, string facet, string id, string? url, string name, string service, string? logo)
    {
        if (index == 0 && !_mvOn)
        {
            if (PickLeavesWatch(name)) { CloseVideoHub(); ShowStageCurtain(name, service, logo); }
            await TuneAsync(facet, id, url, name);
            return;
        }
        if (!_mvOn) await MvCallAsync("on");
        if (!_mvOn) { SetPill("Prism" + Mid + "multiview could not come on"); return; }
        var was = _mvTarget;
        await MvCallAsync("target", index.ToString());
        SetPill("Prism" + Mid + Shorten(name, 40) + " " + (char)0x2192 + " " + (index == 0 ? "the big window" : "window " + (index + 1)));
        await TuneAsync(facet, id, url, name);
        await MvCallAsync("target", was.ToString());
        DrawMvStrip();
        await Task.Delay(2500);   // the window's page is up by now: its name on the strip
        await MvCallAsync("state");
        DrawMvStrip();
    }

    /// <summary>The mode's title above the grid, and in Sports mode the day's scores: a collapsed bar with the headline lines, expanded to a strip of cards.</summary>
    private void DrawModeHead(StackPanel into)
    {
        if (_liveType is not { Length: > 0 } mode) { _scoresTimer?.Stop(); return; }
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Margin = new Thickness(0, 2, 0, 2) };
        var title = new TextBlock { Text = ModeSymbol(mode) + "  " + mode.ToUpperInvariant() + " MODE", FontSize = 20, Foreground = HubAmber, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center };
        // the explanation lives in the tooltip, not on the screen (2026-10-01, "A little verbose ... tuck descriptive label text under tooltips")
        ToolTipService.SetToolTip(title, "Only what is filed under " + mode + (mode == "Sports" ? ", with the day's scores" : "") + ". Press All for everything. Prism remembers the mode you leave on.");
        head.Children.Add(title);
        _modeTitle = title;
        into.Children.Add(head);
        if (mode == "News" || mode == "Local")
        {
            // Local mode's front page is the stations' own local news (2026-10-02), under the same News Headlines checkbox
            // what the live news shows reported (2026-10-01): a front page a network, a press tunes the show's channel - behind a checkbox
            // on by default and kept for next time (2026-10-02, "Let's add a checkbox to display the news headlines ... Persist the setting")
            _scoresTimer?.Stop();
            var on = HostPrefs.GetBool("live.newsHeadlines", true);
            var box = new CheckBox { Content = new TextBlock { Text = "News Headlines", FontSize = 14, Foreground = HubInk }, IsChecked = on, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 0, 0), MinWidth = 0 };
            ToolTipService.SetToolTip(box, "What the live news shows reported, under the title: a front page a network. Prism remembers this.");
            head.Children.Add(box);
            var news = new StackPanel { Spacing = 8, Visibility = on ? Visibility.Visible : Visibility.Collapsed };
            into.Children.Add(news);
            _newsBar = news;
            box.Checked += (_, __) => { HostPrefs.Set("live.newsHeadlines", true); news.Visibility = Visibility.Visible; _ = DrawNewsAsync(news, false); _newsTimer?.Start(); };
            box.Unchecked += (_, __) => { HostPrefs.Set("live.newsHeadlines", false); news.Visibility = Visibility.Collapsed; news.Children.Clear(); _newsTimer?.Stop(); };
            if (!on) return;
            _ = DrawNewsAsync(news, false);
            if (_newsTimer is null) { _newsTimer = RootGrid.DispatcherQueue.CreateTimer(); _newsTimer.Interval = TimeSpan.FromMinutes(2); _newsTimer.IsRepeating = true; }
            _newsTimer.Tick -= NewsTick; _newsTimer.Tick += NewsTick;
            _newsTimer.Start();
            return;
        }
        _newsTimer?.Stop();
        if (mode != "Sports" && mode != "News" && mode != "Local")
        {
            // what is on across the mode's channels as TMDB knows it (2026-10-02, "A Now-on strip ... I love it most"): a row of posters
            // with TMDB's year and rating, a press tunes the channel; behind a checkbox on by default, kept for next time
            _scoresTimer?.Stop();
            var on2 = HostPrefs.GetBool("live.nowOn", true);
            var box2 = new CheckBox { Content = new TextBlock { Text = "Now on", FontSize = 14, Foreground = HubInk }, IsChecked = on2, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 0, 0), MinWidth = 0 };
            ToolTipService.SetToolTip(box2, "What is on across these channels, as TMDB knows it: a poster a show with TMDB's year and rating. Prism remembers this.");
            head.Children.Add(box2);
            var strip = new StackPanel { Spacing = 6, Visibility = on2 ? Visibility.Visible : Visibility.Collapsed };
            into.Children.Add(strip);
            _nowOnBar = strip;
            box2.Checked += (_, __) => { HostPrefs.Set("live.nowOn", true); strip.Visibility = Visibility.Visible; _ = DrawNowOnAsync(strip); _nowOnTimer?.Start(); };
            box2.Unchecked += (_, __) => { HostPrefs.Set("live.nowOn", false); strip.Visibility = Visibility.Collapsed; strip.Children.Clear(); _nowOnTimer?.Stop(); };
            if (!on2) return;
            _ = DrawNowOnAsync(strip);
            // the lookups come in one at a time: the strip is drawn again every few seconds while any are pending, then every two minutes
            if (_nowOnTimer is null) { _nowOnTimer = RootGrid.DispatcherQueue.CreateTimer(); _nowOnTimer.Interval = TimeSpan.FromSeconds(4); _nowOnTimer.IsRepeating = true; }
            _nowOnTimer.Tick -= NowOnTick; _nowOnTimer.Tick += NowOnTick;
            _nowOnTimer.Start();
            return;
        }
        _nowOnTimer?.Stop();
        if (mode != "Sports") { _scoresTimer?.Stop(); return; }
        var bar = new StackPanel { Spacing = 6 };
        into.Children.Add(bar);
        _ = DrawScoresAsync(bar, false);
        // the scores follow the games while the tab is open in Sports mode: read again every two minutes
        if (_scoresTimer is null) { _scoresTimer = RootGrid.DispatcherQueue.CreateTimer(); _scoresTimer.Interval = TimeSpan.FromMinutes(2); _scoresTimer.IsRepeating = true; }
        _scoresTimer.Tick -= ScoresTick; _scoresTimer.Tick += ScoresTick;
        _scoresBar = bar;
        _scoresTimer.Start();
    }
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _scoresTimer;
    private TextBlock? _modeTitle;
    private StackPanel? _scoresBar;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _nowOnTimer;
    private StackPanel? _nowOnBar;
    private bool _nowOnAll;
    private int _nowOnQuiet;
    private void NowOnTick(Microsoft.UI.Dispatching.DispatcherQueueTimer t, object _)
    {
        if (!VideoHubOpen || _hubTab != "live" || _liveType is not { Length: > 0 } || _liveType is "Sports" or "News" or "Local" || _nowOnBar is not { } bar) { t.Stop(); return; }
        if (_nowOnQuiet > 0 && --_nowOnQuiet > 0) return;   // nothing pending: every two minutes
        _ = DrawNowOnAsync(bar);
    }
    /// <summary>
    /// The Now-on strip (docs/features/live.md, 2026-10-02): a poster a show on across the mode's channels - the program on now, or the
    /// show a loop channel is named after - where TMDB matched the name exactly; TMDB's year and rating under each, the channel's name
    /// beneath, in the guide's own order. A press tunes the channel. One row, the rest behind "N more".
    /// </summary>
    private async Task DrawNowOnAsync(StackPanel bar)
    {
        try { await DrawNowOnInnerAsync(bar); } catch (Exception e) { LogLine("now on draw: " + e.Message); }
    }
    private async Task DrawNowOnInnerAsync(StackPanel bar)
    {
        JsonObject? nv = null;
        try { nv = JsonNode.Parse(await ModelCallAsync("liveNowOn", _liveType) ?? "null") as JsonObject; } catch (Exception e) { LogLine("now on: " + e.Message); }
        if (!ReferenceEquals(_nowOnBar, bar) || _liveType is not { Length: > 0 } || _liveType is "Sports" or "News" or "Local") return;
        var cards = (nv?["cards"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var pending = nv?["pending"]?.GetValue<int>() ?? 0;
        var hasKey = nv?["hasKey"]?.GetValue<bool>() == true;
        _nowOnQuiet = pending > 0 ? 0 : 30;   // 30 ticks of four seconds: two minutes
        // nothing changed: the strip stands (the posters would blink otherwise)
        var sig = string.Join("|", cards.Select(c => (c["tmdb"]?.ToString() ?? "") + S(c["channel"] as JsonObject, "id"))) + "|" + pending + "|" + _nowOnAll + "|" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 60000;   // the minute too: the elapsed share moves (review 2026-10-02)
        if (sig == _nowOnSig && bar.Children.Count > 0) return;
        _nowOnSig = sig;
        bar.Children.Clear();
        if (cards.Count == 0)
        {
            // nothing to show and nothing coming: the strip stays empty rather than say so (the checkbox's tooltip explains it)
            var why = !hasKey ? "Add a TMDB key under Settings to see what is on as posters." : pending > 0 ? "Asking TMDB" + (char)0x2026 : "";
            if (why.Length > 0) bar.Children.Add(new TextBlock { Text = why, FontSize = 13, Foreground = HubInk });
            return;
        }
        var wrap = new VariableSizedWrapGrid { Orientation = Orientation.Horizontal, ItemWidth = 118, ItemHeight = 214, HorizontalAlignment = HorizontalAlignment.Left };
        var cells = new List<UIElement>();
        foreach (var c in cards)
        {
            var ch = c["channel"] as JsonObject; if (ch is null) continue;
            var (title, chName, service, app, facet, id, url) = (S(c, "title"), S(ch, "name"), S(ch, "service"), S(ch, "app"), S(ch, "facet"), S(ch, "id"), ch["url"]?.GetValue<string>());
            var col = new StackPanel { Spacing = 3, Width = 108 };
            var art = new Border { Width = 108, Height = 162, CornerRadius = new CornerRadius(6), Background = HubCard };
            // the show's progress on the poster (2026-10-02, "If the show has already started can we show the lapsed time on the poster? Maybe
            // show the part of the poster in the elapsed time space as greyscale and color in the time remaining space"): the elapsed part
            // of the width in grey, the rest in colour, a hairline where now is
            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var frac = c["start"] is JsonValue sv0 && sv0.TryGetValue<double>(out var ps) && c["end"] is JsonValue ev0 && ev0.TryGetValue<double>(out var pe) && pe > ps ? Math.Clamp((nowMs - ps) / (pe - ps), 0, 1) : 0;
            var elapsedWords = frac > 0 && c["start"] is JsonValue sv1 && sv1.TryGetValue<double>(out var ps1) && c["end"] is JsonValue ev1 && ev1.TryGetValue<double>(out var pe1)
                ? (int)Math.Round((nowMs - ps1) / 60000) + " min in, " + Math.Max(0, (int)Math.Round((pe1 - nowMs) / 60000)) + " min left" : "";
            if (c["poster"]?.GetValue<string>() is { Length: > 0 } poster)
            {
                try
                {
                    var uri = Services.ArtCache.UriFor(poster);
                    var stack = new Grid { Width = 108, Height = 162 };
                    var colour = new Image { Source = new BitmapImage(uri), Stretch = Stretch.UniformToFill, Width = 108, Height = 162 };
                    if (frac > 0.02 && frac < 0.98)
                    {
                        var grey = new Image { Stretch = Stretch.UniformToFill, Width = 108, Height = 162, Opacity = 0.9 };
                        stack.Children.Add(grey);
                        _ = GreyPosterAsync(poster, uri, grey);
                        colour.Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(108 * frac, 0, 108 * (1 - frac), 162) };
                        stack.Children.Add(colour);
                        stack.Children.Add(new Border { Width = 2, Background = HubAmber, HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(108 * frac - 1, 0, 0, 0) });
                    }
                    else stack.Children.Add(colour);
                    art.Child = stack;
                }
                catch { }
            }
            if (art.Child is null) art.Child = new TextBlock { Text = title, FontSize = 12, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(6), VerticalAlignment = VerticalAlignment.Center, TextAlignment = TextAlignment.Center };
            col.Children.Add(art);
            var year = c["year"] is JsonValue yv && yv.TryGetValue<int>(out var y) ? y.ToString() : "";
            var rating = c["rating"] is JsonValue rv && rv.TryGetValue<double>(out var rt) ? rt.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) : "";
            var facts = (year.Length > 0 ? year : "") + (rating.Length > 0 ? (year.Length > 0 ? Mid : "") + "\u2605 " + rating : "");
            col.Children.Add(new TextBlock { Text = title, FontSize = 12, Foreground = HubInk, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1 });
            // TMDB's US rating on the line (2026-10-02, Kids mode): in Kids mode a rating that is not a children's one is amber, so a parent sees it
            var cert = S(c, "cert");
            var kidsOk = c["kids"] is JsonValue kv && kv.TryGetValue<bool>(out var kb) ? kb : (bool?)null;
            var line2 = new TextBlock { FontSize = 11, Foreground = HubInk, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1 };
            if (facts.Length > 0) line2.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = facts });
            if (cert.Length > 0) { if (line2.Inlines.Count > 0) line2.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = Mid }); line2.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = cert, Foreground = _liveType == "Kids" && kidsOk == false ? HubAmber : HubInk, FontWeight = _liveType == "Kids" ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal }); }
            if (line2.Inlines.Count > 0) line2.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = Mid });
            var also = (c["also"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
            line2.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = also.Count > 0 ? (also.Count + 1) + " channels" : chName });
            col.Children.Add(line2);
            var cell = new Button { Content = col, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(0), Margin = new Thickness(0, 0, 10, 8), HorizontalContentAlignment = HorizontalAlignment.Left };
            OwnHover(cell);
            ToolTipService.SetToolTip(cell, title + (year.Length > 0 ? " (" + year + ")" : "") + (rating.Length > 0 ? ", TMDB " + rating + " of 10" : "") + (cert.Length > 0 ? ", rated " + cert + " (TMDB's US rating)" + (kidsOk == false ? ", not a children's rating" : "") : "") + ". " + (elapsedWords.Length > 0 ? elapsedWords + ". " : "") + (S(c, "overview") is { Length: > 0 } ov ? ov + " " : "") + "Press to watch " + chName + " on " + service + " in the big window." + (also.Count > 0 ? " Also on " + string.Join(", ", also.Select(a => S(a, "name"))) + "." : "") + " Titles from TMDB.");
            cell.Click += async (_, __) => await TuneIntoAsync(0, facet, id, url, chName, service, ch["logo"]?.GetValue<string>());
            cells.Add(cell);
        }
        var lastCols = 0;
        void Lay(int cols)
        {
            wrap.Children.Clear();
            var room = _nowOnAll ? cells.Count : Math.Min(cells.Count, Math.Max(1, cols - (cells.Count > cols ? 1 : 0)));
            foreach (var c in cells.Take(room)) wrap.Children.Add(c);
            if (cells.Count > room || _nowOnAll && cells.Count > cols)
            {
                var more = Chip(new TextBlock { Text = _nowOnAll ? "Fewer" : (cells.Count - room) + " more", FontSize = 13, Foreground = HubInk }, false);
                more.HorizontalAlignment = HorizontalAlignment.Center; more.VerticalAlignment = VerticalAlignment.Center;
                more.Click += (_, __) => { _nowOnAll = !_nowOnAll; _nowOnSig = ""; Lay(lastCols); };
                wrap.Children.Add(new Border { Child = more, Width = 108, Height = 162, CornerRadius = new CornerRadius(6), Background = HubCard, Margin = new Thickness(0, 0, 10, 8) });
            }
        }
        wrap.SizeChanged += (_, e) => { var cols = Math.Max(1, (int)Math.Floor(e.NewSize.Width / 118)); if (cols != lastCols) { lastCols = cols; Lay(cols); } };
        var host = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
        host.SizeChanged += (_, e) => { var cols = Math.Max(1, (int)Math.Floor(e.NewSize.Width / 118)); if (cols != lastCols) { lastCols = cols; Lay(cols); } };
        host.Children.Add(wrap);
        Lay(Math.Min(cells.Count, 10));
        bar.Children.Add(host);
        if (pending > 0) bar.Children.Add(new TextBlock { Text = "Asking TMDB about " + pending + " more" + (char)0x2026, FontSize = 11, Foreground = HubInk });
    }
    private string _nowOnSig = "";
    private static readonly Dictionary<string, Microsoft.UI.Xaml.Media.Imaging.WriteableBitmap> _greyPosters = new();
    private static readonly Queue<string> _greyOrder = new();
    /// <summary>The poster in greyscale, made once from the kept file and remembered by the poster's address (at most 64, the oldest let go;
    /// review 2026-10-02); the Image takes it when it is ready. Not yet kept: the colour poster stands alone until the next draw.</summary>
    private async Task GreyPosterAsync(string key, Uri uri, Image into)
    {
        try
        {
            if (_greyPosters.TryGetValue(key, out var had)) { into.Source = had; return; }
            // the picture not kept yet (its first draw): wait for the art cache to keep it, up to ten seconds, rather than leave the elapsed
            // part a blank block until the next draw (2026-10-02, "Some of your grayscales aren't working right. They're just blocked out")
            for (var tries = 0; !uri.IsFile && tries < 20; tries++) { await Task.Delay(500); uri = Services.ArtCache.UriFor(key); }
            if (!uri.IsFile) return;
            Windows.Storage.Streams.IRandomAccessStream stream = await (await Windows.Storage.StorageFile.GetFileFromPathAsync(uri.LocalPath)).OpenReadAsync();
            using (stream)
            {
                var dec = await Windows.Graphics.Imaging.BitmapDecoder.CreateAsync(stream);
                var scale = Math.Min(1.0, 216.0 / Math.Max(1, dec.PixelWidth));
                var tf = new Windows.Graphics.Imaging.BitmapTransform { ScaledWidth = (uint)Math.Max(1, Math.Round(dec.PixelWidth * scale)), ScaledHeight = (uint)Math.Max(1, Math.Round(dec.PixelHeight * scale)) };
                var px = await dec.GetPixelDataAsync(Windows.Graphics.Imaging.BitmapPixelFormat.Bgra8, Windows.Graphics.Imaging.BitmapAlphaMode.Premultiplied, tf, Windows.Graphics.Imaging.ExifOrientationMode.IgnoreExifOrientation, Windows.Graphics.Imaging.ColorManagementMode.DoNotColorManage);
                var data = px.DetachPixelData();
                for (var i = 0; i + 3 < data.Length; i += 4)
                {
                    var g = (byte)Math.Clamp((data[i] * 0.114 + data[i + 1] * 0.587 + data[i + 2] * 0.299) * 0.85, 0, 255);   // a shade darker than the colour, so the split reads
                    data[i] = g; data[i + 1] = g; data[i + 2] = g;
                }
                var wb = new Microsoft.UI.Xaml.Media.Imaging.WriteableBitmap((int)tf.ScaledWidth, (int)tf.ScaledHeight);
                using (var st = System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsStream(wb.PixelBuffer)) await st.WriteAsync(data, 0, data.Length);
                wb.Invalidate();
                if (!_greyPosters.ContainsKey(key)) { _greyOrder.Enqueue(key); while (_greyOrder.Count > 64) _greyPosters.Remove(_greyOrder.Dequeue()); }
                _greyPosters[key] = wb;
                into.Source = wb;
            }
        }
        catch (Exception e) { LogLine("grey poster: " + e.Message); }
    }
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _newsTimer;
    private StackPanel? _newsBar;
    private readonly HashSet<string> _newsAll = new();
    private void NewsTick(Microsoft.UI.Dispatching.DispatcherQueueTimer t, object _)
    {
        if (!VideoHubOpen || _hubTab != "live" || _liveType is not ("News" or "Local") || _newsBar is not { } bar) { t.Stop(); return; }
        _ = DrawNewsAsync(bar, false);
    }
    /// <summary>
    /// What the live news shows reported (docs/features/live.md, 2026-10-01, "show headlines for the news being covered by a specific live news
    /// show, so you can click the headline to watch the show ... tied to that network and what they're reporting on"): a group a show the guide
    /// has on now (its network's own feed of the segments it aired, paired in the adapter), a card a segment, newest first as the network
    /// lists them, a press tunes the show's channel in the big window. Every word is the network's; the rules that leave an item out are
    /// named in the group's tooltip (section 5).
    /// </summary>
    private async Task DrawNewsAsync(StackPanel bar, bool force)
    {
        JsonObject? nv = null;
        var modeNow = _liveType;
        try { nv = JsonNode.Parse(await ModelCallAsync("liveNews", force, modeNow) ?? "null") as JsonObject; } catch (Exception e) { LogLine("news: " + e.Message); }
        if (!ReferenceEquals(_newsBar, bar) || _liveType is not ("News" or "Local") || _liveType != modeNow) return;
        bar.Children.Clear();
        var groups = (nv?["groups"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var rules = (nv?["rules"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0).ToList() ?? new List<string>();
        if (groups.Count == 0) return;   // no news show with a feed is on: nothing to say
        foreach (var g in groups)
        {
            var ch = g["channel"] as JsonObject;
            if (ch is null) continue;
            var (name, chName, service, app, facet, id, url) = (S(g, "name"), S(ch, "name"), S(ch, "service"), S(ch, "app"), S(ch, "facet"), S(ch, "id"), ch["url"]?.GetValue<string>());
            var stories = (g["stories"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
            var reading = g["reading"]?.GetValue<bool>() == true;
            var readAt = g["readAt"] is JsonValue rav && rav.TryGetValue<double>(out var rat) ? rat : (double?)null;
            var left = (g["leftOut"] as JsonObject)?.Select(kv => kv.Value?.GetValue<int>() + " " + kv.Key).ToList() ?? new List<string>();
            // a front page, not cards (2026-10-02, "I would maybe like the headlines to look like newspaper headlines with grouping and linkage
            // by service name. But I don't want to take up any more room"): a masthead a network - its name in a serif, the show on now, and
            // the channel on its service as a chip that tunes it - then the headlines in a serif, set down columns like a page, a hairline
            // between, each a press that tunes the channel. Three rows of three at most; the rest behind "N more"
            // the masthead's name: a station's own (NBC Boston) in Local mode, the network's in News mode
            var network = _liveType == "Local" ? name : app == "peacock" ? "NBC News" : app == "paramountplus" ? "CBS News" : service;   // another adapter's feeds carry its service's name until it says otherwise
            var serif = new FontFamily("Georgia, Cambria, Times New Roman");
            var mast = new Grid { Margin = new Thickness(0, 6, 0, 0), ColumnSpacing = 10 };
            mast.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            mast.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            mast.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            mast.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var mastName = new TextBlock { Text = network.ToUpperInvariant(), FontFamily = serif, FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.Bold, CharacterSpacing = 120, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
            mast.Children.Add(mastName);
            var mastShow = new TextBlock { Text = _liveType == "Local" || name.Equals(chName, StringComparison.OrdinalIgnoreCase) ? "" : name, FontFamily = serif, FontStyle = Windows.UI.Text.FontStyle.Italic, FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(mastShow, 1); mast.Children.Add(mastShow);
            // the linkage: the channel on its service, a chip that tunes it
            var link = Chip(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { ServiceMark(app, service, 16), new TextBlock { Text = chName + " on " + service, FontSize = 12, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center } } }, false);
            link.Padding = new Thickness(6, 2, 10, 2);
            ToolTipService.SetToolTip(link, "Watch " + chName + " on " + service + " in the big window.");
            link.Click += async (_, __) => await TuneIntoAsync(0, facet, id, url, chName, service, null);
            Grid.SetColumn(link, 3); mast.Children.Add(link);
            ToolTipService.SetToolTip(mastName, (_liveType == "Local" ? name + "'s local news, from its own feed (" + S(g, "feed") + ")" : "The segments " + name + " aired, as " + network + " lists them in its own feed (" + S(g, "feed") + ")")
                + (readAt is { } ra ? ", read " + LiveClock(ra) : "") + ". Newest first, in the network's order; Prism ranks nothing."
                + (left.Count > 0 ? " Left out by rule: " + string.Join(", ", left) + "." : "") + (rules.Count > 0 ? " The rules: " + string.Join("; ", rules) + "." : "")
                + (S(g, "error") is { Length: > 0 } err ? " Last read: " + err + "." : "") + " Press a headline to watch " + chName + " in the big window.");
            bar.Children.Add(mast);
            bar.Children.Add(new Border { Height = 1, Background = HubInk, Opacity = 0.5, Margin = new Thickness(0, 0, 0, 2) });   // the masthead's rule
            if (stories.Count == 0) { bar.Children.Add(new TextBlock { Text = reading ? "Reading" + (char)0x2026 : "Nothing listed yet.", FontFamily = serif, FontSize = 13, Foreground = HubInk }); continue; }
            var key = S(g, "feed");
            var page = new Grid { ColumnSpacing = 18 };
            var lastCols = 0;
            void Set(int cols)
            {
                page.Children.Clear(); page.ColumnDefinitions.Clear();
                var all = _newsAll.Contains(key);
                // three rows a network in News mode; one row a station in Local mode, where six stations share the page (2026-10-02)
                var rowsEach = _liveType == "Local" ? 1 : 3;
                var room = all ? stories.Count : Math.Min(stories.Count, cols * rowsEach);
                var shown = stories.Take(room).ToList();
                var per = (int)Math.Ceiling(shown.Count / (double)cols);
                for (var c = 0; c < cols; c++)
                {
                    page.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                    var col = new StackPanel();
                    foreach (var st in shown.Skip(c * per).Take(per))
                    {
                        var at = st["at"] is JsonValue atv && atv.TryGetValue<double>(out var atms) ? atms : (double?)null;
                        var when = "";
                        if (at is { } a2)
                        {
                            var d2 = DateTimeOffset.FromUnixTimeMilliseconds((long)a2).ToLocalTime();
                            when = LiveClock(a2) + (d2.Date == DateTimeOffset.Now.Date ? "" : d2.Date == DateTimeOffset.Now.Date.AddDays(-1) ? " yesterday" : " " + d2.ToString("ddd", System.Globalization.CultureInfo.InvariantCulture));
                        }
                        var line = new TextBlock { FontFamily = serif, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxLines = 2, TextTrimming = TextTrimming.CharacterEllipsis, LineHeight = 20 };
                        line.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = S(st, "title") });
                        if (when.Length > 0) line.Inlines.Add(new Microsoft.UI.Xaml.Documents.Run { Text = "  " + when, FontSize = 11, FontWeight = Microsoft.UI.Text.FontWeights.Normal, FontFamily = new FontFamily("Segoe UI Variable, Segoe UI") });
                        var item = new Button { Content = line, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(2, 5, 2, 5), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left };
                        OwnHover(item);
                        ToolTipService.SetToolTip(item, (S(st, "desc") is { Length: > 0 } d ? d + " " : "") + "Press to watch " + chName + " on " + service + " in the big window.");
                        item.Click += async (_, __) => await TuneIntoAsync(0, facet, id, url, chName, service, null);
                        col.Children.Add(item);
                        col.Children.Add(new Border { Height = 1, Background = HubRule });
                    }
                    Grid.SetColumn(col, c); page.Children.Add(col);
                }
                if (stories.Count > cols * rowsEach)
                {
                    var more = new HyperlinkButton { Content = new TextBlock { Text = all ? "Fewer" : (stories.Count - room) + " more", FontSize = 12, Foreground = HubAmber }, Padding = new Thickness(4, 0, 4, 0), HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 2, 0, 0) };
                    more.Click += (_, __) => { if (!_newsAll.Remove(key)) _newsAll.Add(key); Set(lastCols); };
                    Grid.SetColumn(more, cols - 1); Grid.SetRow(more, 1);
                    if (page.RowDefinitions.Count == 0) { page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); page.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); }
                    page.Children.Add(more);
                }
            }
            page.SizeChanged += (_, e) =>
            {
                var w = e.NewSize.Width; if (w < 200) return;
                var cols = Math.Max(1, Math.Min(3, (int)Math.Floor(w / 340)));
                if (cols != lastCols) { lastCols = cols; Set(cols); }
            };
            lastCols = 3; Set(3);
            bar.Children.Add(page);
        }
    }
    private void ScoresTick(Microsoft.UI.Dispatching.DispatcherQueueTimer t, object _)
    {
        if (!VideoHubOpen || _hubTab != "live" || _liveType != "Sports" || _scoresBar is not { } bar) { t.Stop(); return; }
        _ = DrawScoresAsync(bar, true);
    }
    /// <summary>The scores bar: collapsed, one line with the source and the headline games; open, a card a game. Every number is ESPN's (section 5).</summary>
    private async Task DrawScoresAsync(StackPanel bar, bool force)
    {
        JsonObject? sc = null;
        try { sc = JsonNode.Parse(await ModelCallAsync("liveScores", force) ?? "null") as JsonObject; } catch (Exception e) { LogLine("scores: " + e.Message); }
        if (!ReferenceEquals(_scoresBar, bar) || _liveType != "Sports") return;   // the mode left while the read was out (review 2026-10-01)
        bar.Children.Clear();
        var games = (sc?["games"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var source = S(sc ?? new JsonObject(), "source") is { Length: > 0 } src ? src : "ESPN";
        var reading = sc?["reading"]?.GetValue<bool>() == true;
        var readAt = sc?["readAt"] is JsonValue rv && rv.TryGetValue<double>(out var rd) ? rd : (double?)null;
        var day = DateTime.Now.AddHours(-4).ToString("ddd MMM d", System.Globalization.CultureInfo.InvariantCulture);   // the sports day rolls at 4 AM, as core counts it: the night games belong to the evening they began
        // no pill to open (2026-10-01, "I don't think in sports mode that we need the expansion pill. Just show the scores"): the scores stand,
        // a caption line naming the day and the source
        // no caption (2026-10-01, "Remove the 13 games ESPN line"): the count, the source and the read time go to the mode title's tooltip
        if (_modeTitle is { } mt) ToolTipService.SetToolTip(mt, "Only what is filed under Sports, with the last 24 hours' games across the leagues in season as " + source + " lists them: " + games.Count + (games.Count == 1 ? " game" : " games") + (readAt is { } ra ? ", read " + LiveClock(ra) : "") + ". Press All for everything. Prism remembers the mode you leave on.");
        if (games.Count == 0) { bar.Children.Add(new TextBlock { Text = reading && readAt is null ? "Reading the scores" + (char)0x2026 : "No games in the last 24 hours", FontSize = 12, Foreground = HubInk }); return; }
        // the cards in one grid across the page, the same size each, wrapping as the width allows (2026-10-01, "Can the cards have even
        // placement across the page instead of stacking"); grouped by league, a league with a game on first, in play first within it
        var ordered = games.GroupBy(g => S(g, "leagueName")).OrderBy(grp => grp.Any(g => S(g, "state") == "in") ? 0 : 1).SelectMany(grp => grp).ToList();
        var wrap = new VariableSizedWrapGrid { Orientation = Orientation.Horizontal, ItemWidth = 250, ItemHeight = 186, HorizontalAlignment = HorizontalAlignment.Stretch };
        var cards = new List<UIElement>();
        // the cells share the width evenly: as many 240-px cells as fit, each widened to take its share; two rows at most unless the person
        // asked for all (2026-10-01, "Let the user drill down into them if too big, place in cards if fits in under 2 rows")
        var lastCols = 0;
        void Lay(int cols)
        {
            wrap.Children.Clear();
            var room = _scoresAll ? cards.Count : Math.Max(1, cols * 2 - (cards.Count > cols * 2 ? 1 : 0));
            foreach (var c in cards.Take(room)) wrap.Children.Add(c);
            if (cards.Count > room || _scoresAll && cards.Count > cols * 2)
            {
                var more = Chip(new TextBlock { Text = _scoresAll ? "Show fewer" : "Show all " + cards.Count, FontSize = 14, Foreground = HubInk }, false);
                more.VerticalAlignment = VerticalAlignment.Center; more.HorizontalAlignment = HorizontalAlignment.Center;
                ToolTipService.SetToolTip(more, _scoresAll ? "Back to two rows." : (cards.Count - room) + " more " + (cards.Count - room == 1 ? "game" : "games") + " of the last 24 hours.");
                more.Click += (_, __) => { _scoresAll = !_scoresAll; Lay(lastCols); };
                var cell = new Border { Child = more, Background = HubCard, CornerRadius = new CornerRadius(8), Margin = new Thickness(0, 0, 10, 10), HorizontalAlignment = HorizontalAlignment.Stretch };
                wrap.Children.Add(cell);
            }
        }
        // the rows as tall as the tallest card and no taller (2026-10-01, "All of the live scorecards have a large unnecessary margin at the
        // bottom"): each card measured at the cell's width, the grid's row height set to the biggest
        void Fit()
        {
            double h = 0;
            foreach (var c in cards) { c.Measure(new Windows.Foundation.Size(wrap.ItemWidth, double.PositiveInfinity)); h = Math.Max(h, c.DesiredSize.Height); }
            if (h > 40 && Math.Abs(wrap.ItemHeight - Math.Ceiling(h)) > 1) wrap.ItemHeight = Math.Ceiling(h);
        }
        wrap.SizeChanged += (_, e) =>
        {
            var w = e.NewSize.Width; if (w < 240) return;
            var cols = Math.Max(1, Math.Min(cards.Count, (int)Math.Floor(w / 240)));
            var cell = Math.Floor(w / cols);
            if (Math.Abs(wrap.ItemWidth - cell) > 1) wrap.ItemWidth = cell;
            if (cols != lastCols) { lastCols = cols; Lay(cols); }
            Fit();
        };
        foreach (var g in ordered)
        {
            var state = S(g, "state");
            var col = new StackPanel { Spacing = 3 };
            // the league on the card, with the sport's mark (the cards lie in one grid across the page, grouped by league)
            var leagueLine = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            if (g["sportLogo"]?.GetValue<string>() is { Length: > 0 } sportLogo) { try { leagueLine.Children.Add(new Image { Source = new BitmapImage(Services.ArtCache.UriFor(sportLogo)), Width = 16, Height = 16, Stretch = Stretch.Uniform, VerticalAlignment = VerticalAlignment.Center }); } catch { } }
            // the league once when its short name is its full name (UEFA Nations League, 2026-10-01), "MLB . Major League Baseball" otherwise
            var (lgShort, lgFull) = (S(g, "league"), S(g, "leagueName"));
            var lgText = lgFull.Length == 0 ? lgShort : lgFull.StartsWith(lgShort, StringComparison.OrdinalIgnoreCase) || lgShort.StartsWith(lgFull, StringComparison.OrdinalIgnoreCase) ? (lgFull.Length >= lgShort.Length ? lgFull : lgShort) : lgShort + Mid + lgFull;
            leagueLine.Children.Add(new TextBlock { Text = lgText, FontSize = 11, Foreground = HubInk, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 190, VerticalAlignment = VerticalAlignment.Center });
            col.Children.Add(leagueLine);
            void Team(JsonObject? t)
            {
                if (t is null) return;
                var row = new Grid { ColumnSpacing = 8 };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(4) });    // the team's colour
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(34) });   // its mark
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var win = t["winner"]?.GetValue<bool>() == true;
                var colorHex = S(t, "color");
                var stripe = new Border { Width = 4, Height = 28, CornerRadius = new CornerRadius(2), Background = colorHex.Length == 6 ? new SolidColorBrush(Windows.UI.Color.FromArgb(255, Convert.ToByte(colorHex.Substring(0, 2), 16), Convert.ToByte(colorHex.Substring(2, 2), 16), Convert.ToByte(colorHex.Substring(4, 2), 16))) : HubClear, VerticalAlignment = VerticalAlignment.Center };
                row.Children.Add(stripe);
                var logo = t["logo"]?.GetValue<string>();
                var markBox = new Border { Width = 34, Height = 34, VerticalAlignment = VerticalAlignment.Center };
                if (logo is { Length: > 0 }) { try { markBox.Child = new Image { Source = new BitmapImage(Services.ArtCache.UriFor(logo)), Stretch = Stretch.Uniform }; } catch { } }
                Grid.SetColumn(markBox, 1); row.Children.Add(markBox);
                // a long name shrinks to its room instead of being cut off (2026-10-01, "The text that's cut off like Jaume M, can that shrink
                // to fit?"): the name at its full size inside a box that only ever scales down
                var nmText = new TextBlock { Text = S(t, "name"), FontSize = 18, Foreground = HubInk, FontWeight = win ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal };
                var nm = new Viewbox { Child = nmText, StretchDirection = StretchDirection.DownOnly, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center, MaxHeight = 26 };
                Grid.SetColumn(nm, 2);
                var scv = S(t, "score");
                var scr = new TextBlock { Text = scv, FontSize = scv.Length > 4 ? 15 : 22, Foreground = win ? HubAmber : HubInk, FontWeight = win ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal, VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(scr, 3);
                row.Children.Add(nm); row.Children.Add(scr);
                col.Children.Add(row);
            }
            Team(g["away"] as JsonObject); Team(g["home"] as JsonObject);
            var tvs = (g["tv"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0).ToList() ?? new List<string>();
            var when = state == "pre" ? (g["start"] is JsonValue sv && sv.TryGetValue<double>(out var st) ? LiveClock(st) : S(g, "detail")) : S(g, "detail");
            var stateMark = state == "in" ? "\u25CF LIVE" + Mid : state == "post" ? "\u2713 " : "\u23F0 ";   // a dot for on now, a check for over, a clock for to come
            col.Children.Add(new TextBlock { Text = stateMark + when + (state != "in" && S(g, "day") is { Length: > 0 } dayWord && dayWord != "today" ? " " + dayWord : "") + (tvs.Count > 0 ? Mid + string.Join(", ", tvs) : ""), FontSize = 11, Foreground = state == "in" ? HubAmber : HubInk, TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(0, 3, 0, 0) });
            // a live game a service on this wall carries (core's match of the teams' names to the service's events and channels): Watch
            // (2026-10-01, "If the game is live, and we have access to it through one of the services, make sure we can click through")
            if (state == "in" && g["watch"] is JsonObject w && S(w, "service") is { Length: > 0 } wsvc)
            {
                var watch = Chip(new TextBlock { Text = "\u25B6  Watch on " + wsvc, FontSize = 12, Foreground = HubInk }, false);
                watch.Padding = new Thickness(10, 3, 10, 3); watch.Margin = new Thickness(0, 4, 0, 0); watch.HorizontalAlignment = HorizontalAlignment.Left;
                ToolTipService.SetToolTip(watch, S(w, "title") + " on " + wsvc + ", in the big window.");
                var (lg, gid, gline) = (S(g, "league"), S(g, "id"), S(g, "line"));
                watch.Click += async (_, __) =>
                {
                    JsonObject? r = null;
                    try { r = JsonNode.Parse(await ModelCallAsync("liveScoreWatch", lg, gid) ?? "null") as JsonObject; } catch (Exception e) { LogLine("score watch: " + e.Message); }
                    if (r?["ok"]?.GetValue<bool>() == true) { if (PickLeavesWatch(gline)) { CloseVideoHub(); ShowStageCurtain(S(w, "title"), wsvc, null); } }
                    else SetPill("Prism" + Mid + Sentence(r?["error"]?.GetValue<string>() ?? "could not open " + gline));
                };
                col.Children.Add(watch);
            }
            var card = new Border { Child = col, Background = state == "in" ? HubChipOn : HubCard, CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 8, 12, 8), Margin = new Thickness(0, 0, 10, 10), HorizontalAlignment = HorizontalAlignment.Stretch };
            ToolTipService.SetToolTip(card, S(g, "line") + " (" + source + ")" + (S(g, "day") is { Length: > 0 } dy && dy != "today" ? Mid + dy : ""));
            cards.Add(card);
        }
        Lay(Math.Max(1, Math.Min(cards.Count, 5)));   // until the width is known
        Fit();
        bar.Children.Add(wrap);
    }
    private bool _scoresAll;
    /// <summary>"Today 3:00 PM", "Tomorrow 1:50 AM", "Sun 1:50 AM", "Oct 25 2:50 PM": a start as a person says it.</summary>
    private static string StartWords(DateTimeOffset t)
    {
        var today = DateTimeOffset.Now.Date; var day = t.Date;
        var clock = t.ToString("h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
        // within the next twelve hours: how long until it starts, the clock beside (2026-10-01, "Confused by some of these times like today at
        // 4:30 am. You mean 18+ hours ago? Or tomorrow"): past midnight, "Today 4:30 AM" read as a time already gone
        var until = t - DateTimeOffset.Now;
        if (until > TimeSpan.Zero && until < TimeSpan.FromHours(12))
            return "in " + (until.TotalHours >= 1 ? (int)until.TotalHours + " h " + (until.Minutes > 0 ? until.Minutes + " min " : "") : Math.Max(1, until.Minutes) + " min ") + "(" + clock + ")";
        if (day == today) return "Today " + clock;
        if (day == today.AddDays(1)) return "Tomorrow " + clock;
        if (day > today && day < today.AddDays(7)) return t.ToString("ddd", System.Globalization.CultureInfo.InvariantCulture) + " " + clock;
        return t.ToString("MMM d", System.Globalization.CultureInfo.InvariantCulture) + " " + clock;
    }
}
