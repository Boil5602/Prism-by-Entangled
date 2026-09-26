using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// The screens in Watch's corner (2026-09-25, "fit the other 4 mini screens below it (1/4 the size, 2x2 grid layout, same extents as the video
/// screen above? We can show them all the time, and drag windows there (blank if nothing is set). And overlay the service logo & show/movie
/// title over each screen while in the Watch window"). The big screen sits in the top right corner as before; under it windows 2 to 5 in a
/// 2x2 grid of the same width. A place with a window is that window's own surface moved in and drawn smaller (as the big screen always was),
/// still playing; an empty place is drawn blank. Every place is a drop place for a dragged card. Each filled place carries its service's mark
/// and its title, on Watch only: the labels leave with the page.
/// </summary>
public sealed partial class MainWindow
{
    private const int WatchPlaces = 5;
    private const double WatchStackGap = 8;
    private Grid? _stackOverlay;
    private readonly Border?[] _stackCells = new Border?[WatchPlaces];
    private readonly Grid?[] _stackLabels = new Grid?[WatchPlaces];
    private readonly Windows.Foundation.Rect[] _stackRects = new Windows.Foundation.Rect[WatchPlaces];
    /// <summary>The places at the top of the corner; _stackRects are these moved down by _stackDy (2026-09-25, "align the big screen centered with
    /// the top row (continue watching), and when a screen is added, move it up fluidly and make room for windows 2-5, and then start playing the
    /// movie, fade in show window 2 bucket"): an empty big window sits level with Continue watching; with a title it rises to the top.</summary>
    private readonly Windows.Foundation.Rect[] _stackBase = new Windows.Foundation.Rect[WatchPlaces];
    private double _stackDy;
    private bool _stackMoving, _stackPlaced;
    /// <summary>The glide's timer, held here: a timer nothing refers to is collected, and its glide never ended - the big window's video waited on it for
    /// good (2026-09-25, "Dragged a title in and nothing happened": Abbott Elementary played behind Watch, never moved into the big window).</summary>
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _stackTimer;
    private long _stackMoveAt;
    private readonly bool[] _stackWasShown = new bool[WatchPlaces];
    private readonly string?[] _stackKey = new string?[WatchPlaces];
    /// <summary>The surfaces moved into Watch's places, to be put back when it closes.</summary>
    private readonly HashSet<string> _pipSlots = new();
    private readonly List<(FrameworkElement zone, int index)> _stackZones = new();
    private JsonObject? _mvBig;
    /// <summary>The control bar under the screens (the Details page leaves it, with the screens, undimmed).</summary>
    private Border? _stackBar;
    /// <summary>Where the corner's screens and their control bar sit, in the given element's coordinates; null when Watch has no corner up.</summary>
    private Windows.Foundation.Rect? StackBounds(UIElement to)
    {
        if (_stackOverlay is null || !ReferenceEquals(_videoHub, _stackOverlay)) return null;
        Windows.Foundation.Rect? all = null;
        void Add(FrameworkElement? e)
        {
            if (e is null || e.ActualWidth <= 0 || e.Visibility != Visibility.Visible) return;
            try
            {
                var r = e.TransformToVisual(to).TransformBounds(new Windows.Foundation.Rect(0, 0, e.ActualWidth, e.ActualHeight));
                if (all is { } a) { a.Union(r); all = a; } else all = r;
            }
            catch { }
        }
        foreach (var c in _stackCells) Add(c);
        Add(_stackBar);
        return all;
    }
    private static readonly SolidColorBrush StackRing = new(Windows.UI.Color.FromArgb(0x90, 0xE8, 0xEC, 0xF2));
    private static readonly SolidColorBrush StackLabelBack = new(Windows.UI.Color.FromArgb(0xC8, 0x0B, 0x0D, 0x12));

    /// <summary>The corner stack's width for a page this wide (the big place's; the grid under it is as wide).</summary>
    /// <summary>The control bar's height: its chips (34) and its padding.</summary>
    private const double StackBarH = 42;
    private static double StackWidth(double pageW) => Math.Round(Math.Min(440, pageW * 0.24));
    /// <summary>How far down the stack reaches from the top of the page: the rows beside it end before it.</summary>
    private double StackBottom => _stackBase[WatchPlaces - 1].Bottom + _stackFullDy;
    /// <summary>How far down the whole group (the big window and windows 2 to 5) sits, centered on Continue watching: the page's rows keep room for it.</summary>
    private double _stackFullDy;

    /// <summary>Called as Watch is built: the five places drawn on the page (under the surfaces), laid out on every resize.</summary>
    private void BuildWatchStack(Grid overlay)
    {
        _stackOverlay = overlay;
        _stackZones.Clear();
        // a small control bar under the five screens, at their right edge (2026-09-25, "Move the clear screens button underneath the 5 screens, but I
        // dont think this needs to push My List down, there is room"; "We need a button to unmute/volume control from the Watch page. Can put it on a
        // little control bar with Clear Screens"): the sound (a press mutes or unmutes, hovering shows the volume, the stage bar's own switch) and
        // Clear screens; in the gap beside My list's heading, above the page, never moving the rows
        var bar = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        var src = _mvBig?["tile"]?.GetValue<string>() ?? "screen";
        var soundIcon = new FontIcon { Glyph = _wallMuted ? "\uE74F" : "\uE767", FontSize = 15, Foreground = _wallMuted ? HubAmber : HubInk };
        var sound = Chip(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { soundIcon } }, false);
        sound.CornerRadius = new CornerRadius(6); sound.Height = 34; sound.Padding = new Thickness(10, 0, 10, 0);
        ToolTipService.SetToolTip(sound, "Sound: press to mute or unmute. Hover for the volume.");
        sound.Click += (_, __) =>
        {
            SetWallMutedFromWall(_mvBig?["tile"]?.GetValue<string>() ?? src, !_wallMuted);
            soundIcon.Glyph = _wallMuted ? "\uE74F" : "\uE767"; soundIcon.Foreground = _wallMuted ? HubAmber : HubInk;
        };
        sound.PointerEntered += (_, __) => ShowVolumeSlider(sound, _mvBig?["tile"]?.GetValue<string>() ?? src);
        sound.PointerExited += (_, __) => _volumeClose?.Start();
        bar.Children.Add(sound);
        var clear = ClearScreensButton();
        clear.CornerRadius = new CornerRadius(6); clear.Height = 34;
        bar.Children.Add(clear);
        // Show video (2026-09-25, "Move <> Show Video under the video window cards on Watch"): Watch closes onto the screens in their full window,
        // whatever is on them ("not a back to title, I could be playing 5 things or nothing"), and stays closed (_stayOnVideo)
        var show = Chip(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = {
            new FontIcon { Glyph = "\uE740", FontSize = 13, Foreground = HubAmber },
            new TextBlock { Text = "Show video", FontSize = 13, Foreground = HubAmber } } }, true);
        show.CornerRadius = new CornerRadius(6); show.Height = 34;
        ToolTipService.SetToolTip(show, "Closes Watch: the video screens in their full window again, whatever is on them.");
        show.Click += (_, __) => { _stayOnVideo = true; CloseVideoHub(); };
        bar.Children.Add(show);
        var panel = new Border
        {
            Child = bar, Padding = new Thickness(4), CornerRadius = new CornerRadius(8), Background = HubCard,
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top,
        };
        Canvas.SetZIndex(panel, 30);
        overlay.Children.Add(panel);
        _stackBar = panel;
        for (var i = 0; i < WatchPlaces; i++)
        {
            var cell = new Border { BorderBrush = StackRing, BorderThickness = new Thickness(2), CornerRadius = new CornerRadius(3), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Background = HubCard };
            overlay.Children.Add(cell);
            _stackCells[i] = cell;
            _stackKey[i] = null;
            _stackZones.Add((cell, i));
        }
        void Shape()
        {
            var w = overlay.ActualWidth; var h = overlay.ActualHeight;
            if (w < 200 || h < 200) return;
            var bw = StackWidth(w); var bh = Math.Round(bw * 9 / 16);
            // the control bar above the screens, fixed at the top (2026-09-25, "put the controls currently under the windows on the right of the watch
            // screen above them so they're not constantly moving around"): the screens start under it
            var x0 = w - 24 - bw; var y0 = 24.0 + StackBarH + 8;
            panel.Margin = new Thickness(0, 24, 24, 0);
            _stackBase[0] = new Windows.Foundation.Rect(x0, y0, bw, bh);
            var cw = Math.Floor((bw - WatchStackGap) / 2); var ch = Math.Round(cw * 9 / 16);
            for (var i = 1; i < WatchPlaces; i++)
            {
                var col = (i - 1) % 2; var row = (i - 1) / 2;
                _stackBase[i] = new Windows.Foundation.Rect(x0 + col * (bw - cw), y0 + bh + WatchStackGap + row * (ch + WatchStackGap), cw, ch);
            }
            for (var i = 0; i < WatchPlaces; i++) _stackKey[i] = null;   // placed again below at the new size
            PlaceStack();
            SyncWatchStack();
        }
        overlay.SizeChanged += (_, __) => Shape();
    }

    /// <summary>What each place shows now, from core's multiview word: the surfaces moved in or out, the blanks and labels drawn.</summary>
    private void SyncWatchStack()
    {
        if (_stackOverlay is not { } overlay || !ReferenceEquals(_videoHub, overlay) || _stackRects[0].Width <= 0) return;
        s_devLog?.Invoke("sync watch stack");
        var want = new string?[WatchPlaces];
        var info = new JsonObject?[WatchPlaces];
        if (_mvOn)
            foreach (var w in _mvWindows.OfType<JsonObject>())
            {
                if (w["index"] is not JsonValue iv || !iv.TryGetValue<int>(out var i) || i < 0 || i >= WatchPlaces) continue;
                var tile = w["tile"]?.GetValue<string>();
                if (tile is null || _surfaces.RectOf(tile) is null) continue;
                want[i] = tile; info[i] = w;
            }
        else if (_mvBigHas && _mvBig?["tile"]?.GetValue<string>() is { } bt && _surfaces.RectOf(bt) is not null) { want[0] = bt; info[0] = _mvBig; }
        // where the corner sits: level with Continue watching while the big window is empty, at the top once it holds a title - the first time
        // Watch draws it, straight there; after that, a glide (the surfaces wait for its end to move in, the next window fades in after it)
        if (_stackMoving && Environment.TickCount64 - _stackMoveAt > 1500) { _stackMoving = false; _stackTimer?.Stop(); _stackTimer = null; _stackDy = StackTargetDy(want[0] is null) is var d && d >= 0 ? d : _stackDy; PlaceStack(); }   // never held longer than its time
        var fresh = !_stackPlaced;
        var target = StackTargetDy(want[0] is null);
        if (target < 0) { if (fresh) PlaceStack(); }   // Continue watching not measured yet: the corner is placed when it is
        else if (fresh) { _stackPlaced = true; _stackDy = target; PlaceStack(); }
        else if (!_stackMoving && Math.Abs(target - _stackDy) > 1) MoveStack(target);
        // a surface no longer in a place goes back to its own
        foreach (var s in _pipSlots.ToList()) if (!want.Contains(s)) { _surfaces.EndPip(s); _pipSlots.Remove(s); }
        // one window at a time (2026-09-25, "hide the other 4 screens. Then when someone adds something to the big screen, show window 2's bucket as
        // available ... Window 2 gets filled, 3 is available, etc through 5"): the big window always, every filled one, and the first empty one after
        // a filled big window; the rest are not drawn and take no drop
        var nextFree = -1;
        if (want[0] is not null && !_stackMoving) for (var k = 1; k < WatchPlaces; k++) if (want[k] is null) { nextFree = k; break; }
        var lowest = 0.0;
        for (var i = 0; i < WatchPlaces; i++)
        {
            var shown = i == 0 || want[i] is not null || i == nextFree;
            if (_stackCells[i] is { } sc)
            {
                sc.Visibility = shown ? Visibility.Visible : Visibility.Collapsed;
                if (shown && !_stackWasShown[i] && i > 0 && !fresh) FadeIn(sc);   // a window offered: it fades in
            }
            _stackWasShown[i] = shown;
            if (shown) lowest = Math.Max(lowest, _stackRects[i].Bottom);
        }

        for (var i = 0; i < WatchPlaces; i++)
        {
            var r = _stackRects[i];
            var tile = want[i];
            var key = tile is null ? "blank" : tile + "|" + (info[i]?["app"]?.GetValue<string>() ?? "") + "|" + (info[i]?["title"]?.GetValue<string>() ?? "");
            if (tile is not null && _stackMoving) continue;   // it moves in where the glide ends
            if (tile is not null) { _surfaces.BeginPip(tile, new ChannelRect(r.X, r.Y, r.Width, r.Height)); _pipSlots.Add(tile); }
            if (_stackKey[i] == key) continue;
            _stackKey[i] = key;
            if (_stackCells[i] is { } cell)
            {
                cell.Background = tile is null ? HubCard : HubClear;
                // the plain screen when empty, the big window too (2026-09-25, the curtains taken back: "a little too much of a blink when the movie is
                // added ... go back to the original movie screen without the curtains in the Watch screen"; the glide and the fade-ins stay)
                cell.Child = tile is null ? BlankPlace(i) : null;
            }
            if (_stackLabels[i] is { } old) { TileCanvas.Children.Remove(old); _stackLabels[i] = null; }
            if (tile is not null && info[i] is { } o) _stackLabels[i] = PlaceLabel(o, r, i == 0, tile, i);
        }
        _pipSlot = want[0];
    }

    /// <summary>How far down the corner reaches now: the lowest window shown (the rows beside it end before the corner, the rows below it run full width).</summary>
    private double ShownStackBottom()
    {
        var lowest = 0.0;
        for (var i = 0; i < WatchPlaces; i++) if (_stackCells[i] is { } c && c.Visibility == Visibility.Visible) lowest = Math.Max(lowest, _stackRects[i].Bottom);
        return lowest > 0 ? lowest : StackBottom;
    }
    /// <summary>The corner's places at the current offset: the cells, and the bar under what is shown.</summary>
    private void PlaceStack()
    {
        var lowest = 0.0;
        for (var i = 0; i < WatchPlaces; i++)
        {
            var b = _stackBase[i];
            var r = _stackRects[i] = new Windows.Foundation.Rect(b.X, b.Y + _stackDy, b.Width, b.Height);
            if (_stackCells[i] is { } c)
            {
                c.Margin = new Thickness(r.X - 2, r.Y - 2, 0, 0); c.Width = r.Width + 4; c.Height = r.Height + 4;
                if (c.Visibility == Visibility.Visible) lowest = Math.Max(lowest, r.Bottom);
            }
        }

    }

    /// <summary>How far down the corner sits: an empty big window level with the middle of Continue watching (its cards); with a title, the whole
    /// group centered there. Only the big window is seen to move between the two; windows 2 to 5 are hidden while it does and fade in after.</summary>
    private double StackTargetDy(bool bigEmpty)
    {
        if (_stackOverlay is not { } overlay || !_liveRows.TryGetValue("continue", out var row) || row.head.Visibility != Visibility.Visible) { _stackFullDy = 0; return 0; }
        if (row.host.ActualHeight <= 0)
        {
            // drawn but not laid out yet: asked again once it has its size
            void Sized(object sender, SizeChangedEventArgs e) { row.host.SizeChanged -= Sized; SyncWatchStack(); }
            row.host.SizeChanged += Sized;
            return -1;
        }
        try
        {
            var r = row.host.TransformToVisual(overlay).TransformBounds(new Windows.Foundation.Rect(0, 0, row.host.ActualWidth, row.host.ActualHeight));
            var big = _stackBase[0];
            var mid = r.Y + r.Height / 2;
            // the whole group centered on the row once the big window holds a title (2026-09-25, "the group of all ... windows can be centered
            // vertically with the continue watching row"); the big window alone while it is empty
            _stackFullDy = Math.Max(0, Math.Round(mid - (big.Y + (_stackBase[WatchPlaces - 1].Bottom - big.Y) / 2)));
            return bigEmpty ? Math.Max(0, Math.Round(mid - (big.Y + big.Height / 2))) : _stackFullDy;
        }
        catch { return 0; }
    }

    /// <summary>The corner glides to its new place, quick and easing out; then the surfaces move in and the next window fades in.</summary>
    private void MoveStack(double to)
    {
        _stackMoving = true; _stackMoveAt = Environment.TickCount64;
        var from = _stackDy;
        var clock = System.Diagnostics.Stopwatch.StartNew();
        _stackTimer?.Stop();
        var timer = _stackTimer = DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromMilliseconds(15);
        timer.Tick += (t, __) =>
        {
            var p = Math.Min(1, clock.Elapsed.TotalMilliseconds / 420);
            var e = 1 - Math.Pow(1 - p, 3);
            _stackDy = from + (to - from) * e;
            PlaceStack();
            if (p < 1 && _stackOverlay is not null) return;
            t.Stop();
            if (ReferenceEquals(_stackTimer, t)) _stackTimer = null;
            _stackMoving = false;
            for (var i = 0; i < WatchPlaces; i++) _stackKey[i] = null;
            SyncWatchStack();
        };
        timer.Start();
        // and a look after its time, whatever the timer did: the surfaces move in, the next window is offered
        _ = Task.Delay(1600).ContinueWith(_ => DispatcherQueue.TryEnqueue(() => { if (_stackMoving) SyncWatchStack(); }));
    }

    private static void FadeIn(UIElement el)
    {
        el.Opacity = 0;
        var a = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { From = 0, To = 1, Duration = new Duration(TimeSpan.FromMilliseconds(380)), EnableDependentAnimation = true };
        Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(a, el); Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(a, "Opacity");
        var sb = new Microsoft.UI.Xaml.Media.Animation.Storyboard(); sb.Children.Add(a); sb.Begin();
    }

    private static FrameworkElement BlankPlace(int i) => new StackPanel
    {
        Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
        Children =
        {
            new TextBlock { Text = i == 0 ? "Nothing playing" : "Window " + (i + 1), FontSize = i == 0 ? 15 : 12, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center },
            new TextBlock { Text = "Drag a title here", FontSize = 11, Foreground = HubDim, HorizontalAlignment = HorizontalAlignment.Center },
        },
    };

    /// <summary>The service's mark and the title over a filled place, above the surface. The bar is the window's handle: dragged onto another
    /// place the two trade, dragged off the places the window leaves multiview. The rest of the place takes no presses (they reach the player).</summary>
    private Grid PlaceLabel(JsonObject w, Windows.Foundation.Rect r, bool big, string tile, int index)
    {
        var app = w["app"]?.GetValue<string>() ?? "";
        var name = w["name"]?.GetValue<string>() ?? app;
        var title = w["title"]?.GetValue<string>() ?? "";
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var mark = ServiceMark(app, name, big ? 22 : 16); mark.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(mark);
        row.Children.Add(new TextBlock { Text = title.Length > 0 ? title : name, FontSize = big ? 13 : 11, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = r.Width - (big ? 50 : 38) });
        var g = new Grid { Width = r.Width, Height = r.Height };   // no background: only the bar takes a press
        var bar = new Border { VerticalAlignment = VerticalAlignment.Bottom, Background = StackLabelBack, Padding = new Thickness(6, 4, 6, 4), Child = row };
        if (_mvOn)
        {
            ToolTipService.SetToolTip(bar, "Drag onto another window to trade places, or off the windows to take it out.");
            MakeChipDraggable(bar, tile, index);
        }
        // windows 2 to 5 carry the X alone (2026-09-25, "lets get rid of the title bar on each of the mini windows. The X's are great, but none of
        // the other junk is functional and its all just in the way"): the big window keeps its name
        if (big) g.Children.Add(bar);
        // an X in the top right of a screen with something on it (2026-09-25, "If a window has a video playing in it, add an X in the top right
        // corner to allow the user to clear it. If window 1 gets X'd, the content from the next player moves to the previous. Same rule"): core's
        // remove - the windows after it move up a place; the big screen alone is cleared
        var x = new Button
        {
            Content = new FontIcon { Glyph = "\uE711", FontSize = big ? 12 : 10, Foreground = HubInk },
            Width = big ? 30 : 24, Height = big ? 30 : 24, Padding = new Thickness(0), CornerRadius = new CornerRadius(big ? 15 : 12),
            Background = StackLabelBack, BorderThickness = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 6, 6, 0),
        };
        ToolTipService.SetToolTip(x, _mvOn ? "Clear this screen. The screens after it move up a place." : "Clear the screen.");
        x.Click += async (_, __) =>
        {
            if (_mvOn) await MvRemoveWindowAsync(tile);
            else await ClearScreensAsync();
        };
        g.Children.Add(x);
        Canvas.SetLeft(g, r.X); Canvas.SetTop(g, r.Y);
        Canvas.SetZIndex(g, 915);   // over the surfaces in the places (910), under a drag's ghost on the page
        TileCanvas.Children.Add(g);
        return g;
    }

    /// <summary>Watch closing: every surface back to its own place, the labels gone. The surfaces that were in a place were never covered.</summary>
    private IReadOnlyCollection<string> EndWatchStack()
    {
        var was = _pipSlots.ToList();
        foreach (var s in was) _surfaces.EndPip(s);
        _pipSlots.Clear();
        for (var i = 0; i < WatchPlaces; i++) { if (_stackLabels[i] is { } l) TileCanvas.Children.Remove(l); _stackLabels[i] = null; _stackCells[i] = null; _stackKey[i] = null; }
        _stackZones.Clear();
        _stackOverlay = null;
        _pipSlot = null;
        _stackPlaced = false; _stackMoving = false; _stackTimer?.Stop(); _stackTimer = null;
        Array.Clear(_stackWasShown);
        return was;
    }
}
