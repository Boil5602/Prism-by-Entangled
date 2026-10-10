using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// Multiview by hand (2026-09-23, "I want to be able to click/hold/drag a video card, and pull it onto Big Window, Window 2, Window 3,
/// Window 4 areas to enable them playing in the multiview configuration. And let me drag something OUT to get it back out of Multiview
/// config"). A card held (or pulled downward off its row) lifts; a bar of the four places drops in at the top of the Watch page; let go
/// on a place and the title plays there (multiview comes on if it was off). A filled place in the strip lifts the same way: onto another
/// place it trades places, anywhere else it leaves multiview. The big window out, the next one backfills it; the last one out leaves
/// the stage empty - the empty stage is drawn ("show a picture of a movie stage, purple curtains").
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>What a card plays - the same six things its press passes to PlayOnAsync, and its service's name.</summary>
    /// <summary>What a dragged card plays. A Browse-style card (Most read, New episodes, New movies, The Binge) names no address: it carries the
    /// service and the catalog id, and plays the way its own press does (2026-09-26, "only the top 2 lines are allowing me to drop them into the video
    /// player windows while on Watch. I really want all of the video cards to be eligible").</summary>
    internal sealed record CardPick(string Facet, string Kind, string Id, string? Url, string Title, string? Art, string Service, string? BrowseApp = null, string? PlayVerb = null);

    /// <summary>The rows' lift: a static row (Carousel) hands a held card to the page that owns the drag.</summary>
    private static Func<Button, PointerRoutedEventArgs, bool>? s_cardLift;

    private CardPick? _dragCard;            // a card in the air
    /// <summary>A Live channel lifted off the schedule (2026-10-07): dropped on a place, the channel is tuned into it.</summary>
    internal sealed record LivePick(string Facet, string Id, string? Url, string Name, string Service, string? Logo);
    private LivePick? _dragLive;
    private string? _dragTile;              // or a window from the strip
    private int _dragFrom = -1;
    private uint _dragPointer;
    private Border? _dragGhost;
    private Border? _dropBar;
    private readonly List<(FrameworkElement zone, int index)> _dropZones = new();
    private bool _dragWired;

    /// <summary>Called as the Watch page is built: the page's root owns every drag on it.</summary>
    private void WireMvDrag(Grid overlay)
    {
        _dragWired = false;
        s_cardLift = (b, e) => b.Tag is CardPick c && BeginDrag(overlay, e, c, null, -1);
        overlay.AddHandler(UIElement.PointerMovedEvent, new PointerEventHandler((_, e) => DragMoved(overlay, e)), true);
        overlay.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler((_, e) => _ = DragReleasedAsync(overlay, e)), true);
        overlay.AddHandler(UIElement.PointerCaptureLostEvent, new PointerEventHandler((_, e) => { if (ReferenceEquals(e.OriginalSource, overlay) && e.Pointer.PointerId == _dragPointer) EndDrag(overlay); }), true);
        _dragWired = true;
    }

    /// <summary>A filled place in the strip lifts when pulled past a few pixels (a click still makes it the target).</summary>
    private void MakeChipDraggable(UIElement chip, string tile, int index)
    {
        Windows.Foundation.Point start = default; bool down = false; uint id = 0;
        chip.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, e) =>
        {
            var pt = e.GetCurrentPoint(chip);
            if (!pt.Properties.IsLeftButtonPressed) return;
            down = true; id = e.Pointer.PointerId; start = pt.Position;
        }), true);
        chip.AddHandler(UIElement.PointerMovedEvent, new PointerEventHandler((_, e) =>
        {
            if (!down || e.Pointer.PointerId != id || _videoHub is not { } overlay) return;
            var p = e.GetCurrentPoint(chip).Position;
            if (Math.Abs(p.X - start.X) < 12 && Math.Abs(p.Y - start.Y) < 12) return;
            down = false;
            chip.ReleasePointerCapture(e.Pointer);
            BeginDrag(overlay, e, null, tile, index);
        }), true);
        chip.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler((_, __) => down = false), true);
    }

    private bool BeginDrag(Grid overlay, PointerRoutedEventArgs e, CardPick? card, string? tile, int from)
    {
        if (!_dragWired || !ReferenceEquals(_videoHub, overlay) || (card is null && tile is null && _dragLive is null)) return false;
        if (!overlay.CapturePointer(e.Pointer)) return false;
        _dragCard = card; _dragTile = tile; _dragFrom = from; _dragPointer = e.Pointer.PointerId;
        var name = card?.Title ?? _dragLive?.Name ?? MvWindowName(tile!);
        var ghostBody = new StackPanel { Spacing = 4, Width = 200 };
        if ((card?.Art ?? _dragLive?.Logo) is { Length: > 0 } art) { try { ghostBody.Children.Add(new Border { CornerRadius = new CornerRadius(6), Height = 112, Child = new Image { Source = new BitmapImage(Services.ArtCache.UriFor(art)), Stretch = Stretch.UniformToFill } }); } catch { } }
        ghostBody.Children.Add(new TextBlock { Text = Shorten(name, 30), FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, TextTrimming = TextTrimming.CharacterEllipsis });
        _dragGhost = new Border { Child = ghostBody, Padding = new Thickness(8), CornerRadius = new CornerRadius(8), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE8, 0x1A, 0x1D, 0x24)), BorderBrush = HubAmber, BorderThickness = new Thickness(2), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, IsHitTestVisible = false, Opacity = 0.92 };
        // on the window's own top layer, over the playing windows too (2026-10-09, "When I drag a live channel over to a screen, the dragged
        // item appears to go behind the screen ... in front of the windows is more intuitive, as though it is being dropped on top"): as a
        // child of the Watch page it passed under any window drawn above the page
        Canvas.SetZIndex(_dragGhost, 990);
        Grid.SetRowSpan(_dragGhost, 20); Grid.SetColumnSpan(_dragGhost, 20);
        RootGrid.Children.Add(_dragGhost);
        ShowDropBar(overlay);
        DragMoved(overlay, e);
        LogLine("multiview drag: " + (card is not null ? "card " + card.Title + " (" + card.Service + ")" : _dragLive is not null ? "channel " + _dragLive.Name + " (" + _dragLive.Service + ")" : "window " + tile + " from " + from));
        return true;
    }

    private bool BeginLiveDrag(Grid overlay, PointerRoutedEventArgs e, LivePick pick)
    {
        _dragLive = pick;
        if (BeginDrag(overlay, e, null, null, -1)) return true;
        _dragLive = null;
        return false;
    }

    private string MvWindowName(string tile)
    {
        var w = _mvWindows.OfType<JsonObject>().FirstOrDefault(x => x["tile"]?.GetValue<string>() == tile);
        return w is null ? tile : (w["title"]?.GetValue<string>() is { Length: > 0 } t ? t : w["name"]?.GetValue<string>() ?? tile);
    }

    /// <summary>The drop targets for a drag: the Watch page's own strip, in place - scrolled into view, its places the zones (2026-09-23, "just
    /// drag them in place into the Big Screen + Window 2 ... Instead of popping up 5 new possible windows"). A tab without the strip (Library,
    /// Browse) gets the pinned bar, offering the same places.</summary>
    /// <summary>The drop places drawn again from core's state as it is now (a pick since the last read may have filled the big screen).</summary>
    private async Task RefreshDropPlacesAsync()
    {
        var had = _mvBigHas;
        await MvCallAsync("state");
        if (!_stripDragging || had == _mvBigHas) return;
        DrawMvStrip();
        _dropZones.Clear();
        _dropZones.AddRange(_stripZones);
        _dropZones.AddRange(_stackZones);
    }
    private void ShowDropBar(Grid overlay)
    {
        // Watch: its corner places are the drop places, nothing pops up (2026-09-25)
        if (_stackZones.Count > 0 && ReferenceEquals(_stackOverlay, overlay))
        {
            _dropZones.Clear();
            _dropZones.AddRange(_stackZones);
            return;
        }
        if (_mvStrip is { } strip && strip.XamlRoot is not null)
        {
            _stripDragging = true;
            DrawMvStrip();
            _dropZones.Clear();
            _dropZones.AddRange(_stripZones);
            _dropZones.AddRange(_stackZones);   // Watch's corner places take a drop too (2026-09-25)
            _ = RefreshDropPlacesAsync();   // what the big screen holds now decides whether Window 2 is offered
            strip.StartBringIntoView(new BringIntoViewOptions { AnimationDesired = true, VerticalAlignmentRatio = 0.1 });
            return;
        }
        _dropZones.Clear();
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        for (var i = 0; i < MvShownPlaces(); i++)
        {
            var w = _mvOn ? _mvWindows.OfType<JsonObject>().FirstOrDefault(x => x["index"] is JsonValue iv && iv.TryGetValue<int>(out var ii) && ii == i) : null;
            var what = w is null ? (i == 0 && !_mvOn ? "what is on the screen now" : "empty") : (w["name"]?.GetValue<string>() ?? "") + (w["title"]?.GetValue<string>() is { Length: > 0 } t ? " · " + Shorten(t, 22) : "");
            var zone = new Border
            {
                Width = i == 0 ? 280 : 210, Height = i == 0 ? 120 : 96, CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(2),
                BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x80, 0xE8, 0xEC, 0xF2)), Background = HubCard, Padding = new Thickness(12, 8, 12, 8), VerticalAlignment = VerticalAlignment.Top,
                Child = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center, Children =
                {
                    new TextBlock { Text = i == 0 ? "Big window" : "Window " + (i + 1), FontSize = 18, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk },
                    new TextBlock { Text = what, FontSize = 13, Foreground = HubDim, TextTrimming = TextTrimming.CharacterEllipsis },
                } },
            };
            _dropZones.Add((zone, i));
            row.Children.Add(zone);
        }
        var hint = new TextBlock
        {
            Text = _dragCard is not null ? "Drop on a window to play it there · anywhere else to cancel" : "Drop on another window to trade places · anywhere else takes it out of multiview",
            FontSize = 14, Foreground = HubAmber, HorizontalAlignment = HorizontalAlignment.Center,
        };
        _dropBar = new Border
        {
            HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 18, 0, 0), Padding = new Thickness(18, 14, 18, 14),
            CornerRadius = new CornerRadius(12), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF4, 0x12, 0x13, 0x1A)), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x5A, 0xF0, 0xA8, 0x3C)), BorderThickness = new Thickness(1),
            Child = new StackPanel { Spacing = 10, Children = { row, hint } },
        };
        Canvas.SetZIndex(_dropBar, 40);
        overlay.Children.Add(_dropBar);
    }

    private int ZoneAt(Grid overlay, Windows.Foundation.Point p)
    {
        foreach (var (zone, index) in _dropZones)
        {
            if (zone.Visibility != Visibility.Visible) continue;   // a Watch window not offered yet
            try
            {
                var r = zone.TransformToVisual(overlay).TransformBounds(new Windows.Foundation.Rect(0, 0, zone.ActualWidth, zone.ActualHeight));
                if (r.Contains(p)) return index;
            }
            catch { }
        }
        return -1;
    }

    private void DragMoved(Grid overlay, PointerRoutedEventArgs e)
    {
        if (_dragGhost is null || e.Pointer.PointerId != _dragPointer) return;
        // a move with no button held is a drag whose release was lost (2026-09-25, "I cleared videos and animal control started itself back up":
        // a card lifted under a press over remote desktop and dropped on the big screen) - it ends with nothing dropped
        var cur = e.GetCurrentPoint(overlay);
        if (e.Pointer.PointerDeviceType == Microsoft.UI.Input.PointerDeviceType.Mouse && !cur.Properties.IsLeftButtonPressed) { LogLine("multiview drag: button up, dropped nothing"); EndDrag(overlay); return; }
        var p = cur.Position;
        var rp = e.GetCurrentPoint(RootGrid).Position;
        _dragGhost.Margin = new Thickness(rp.X + 14, rp.Y + 10, 0, 0);
        var at = ZoneAt(overlay, p);
        foreach (var (zone, index) in _dropZones)
        {
            var on = index == at;
            if (zone is Border bz) { bz.BorderBrush = on ? HubAmber : new SolidColorBrush(Windows.UI.Color.FromArgb(0x80, 0xE8, 0xEC, 0xF2)); bz.Background = on ? HubChipOn : HubCard; }
            else if (zone is Control cz) { cz.Background = on ? HubChipOn : HubChip; cz.BorderBrush = HubAmber; cz.BorderThickness = new Thickness(on ? 2 : 0); }
        }
        e.Handled = true;
    }

    private async Task DragReleasedAsync(Grid overlay, PointerRoutedEventArgs e)
    {
        if (_dragGhost is null || e.Pointer.PointerId != _dragPointer) return;
        var at = ZoneAt(overlay, e.GetCurrentPoint(overlay).Position);
        var (card, tile, from, live) = (_dragCard, _dragTile, _dragFrom, _dragLive);
        e.Handled = true;
        EndDrag(overlay);
        overlay.ReleasePointerCaptures();
        if (card is not null) { if (at >= 0) await DropCardAsync(card, at); return; }
        if (live is not null) { if (at >= 0) { await TuneIntoAsync(at, live.Facet, live.Id, live.Url, live.Name, live.Service, live.Logo); DrawMvStrip(); } return; }
        if (tile is null) return;
        if (at >= 0 && at != from) { await MvCallAsync("place", tile + ":" + at); SetPill("Prism · " + Shorten(MvWindowName(tile), 40) + " → " + (at == 0 ? "the big window" : "window " + (at + 1))); }
        else if (at < 0)
        {
            var name = MvWindowName(tile);
            var r = await MvCallAsync("remove", tile);
            if (r?["ok"]?.GetValue<bool>() == false) { SetPill("Prism · " + (r["error"]?.GetValue<string>() ?? "could not take it out")); return; }
            if (r?["sceneId"]?.GetValue<string>() is { } sid) await SceneAppliedAsync(sid, r.ToJsonString());
            SetPill("Prism · " + Shorten(name, 40) + " is out of multiview" + (_mvWindows.Count == 0 ? ". Nothing is playing now" : ""));
        }
        DrawMvStrip();
    }

    private void EndDrag(Grid overlay)
    {
        if (_dragGhost is not null) RootGrid.Children.Remove(_dragGhost);
        if (_dropBar is not null) overlay.Children.Remove(_dropBar);
        _dragGhost = null; _dropBar = null; _dropZones.Clear();
        _dragCard = null; _dragTile = null; _dragFrom = -1; _dragLive = null;
        if (_stripDragging) { _stripDragging = false; DrawMvStrip(); }   // the strip plain again: Swap and Turn off back
    }

    /// <summary>A card let go on a place: multiview on if it was off, the place as the target for this one pick, the pick as a press
    /// would make it - Watch stays up for the next drag, and the target goes back to what it was.</summary>
    private Task PlayPickAsync(CardPick c) =>
        c.BrowseApp is { } app ? BrowsePlayAsync(app, c.Id, c.Title, c.Service, c.PlayVerb ?? "videoBrowsePlay") : PlayOnAsync(c.Facet, c.Kind, c.Id, c.Url, c.Title);

    private async Task DropCardAsync(CardPick c, int index)
    {
        // a small place with nothing on the big screen: the big screen first (a second window only once the big one has a title, 2026-09-24);
        // a place past the windows there are is the next one (core keeps the windows in order, no gaps)
        if (index > 0 && !_mvBigHas) index = 0;
        if (index > 0 && _mvOn) index = Math.Min(index, Math.Max(1, _mvWindows.Count));
        if (index > 0 && !_mvOn) index = 1;
        // no Multiview button (2026-09-24, "If I drag a single window up to the big screen, thats still a single mode session ... get rid of
        // the multiview button and just drag stuff up to kick it off"): the big screen with multiview off is a plain pick; a small window starts it
        if (!_mvOn && index == 0)
        {
            SetPill("Prism \u00B7 " + Shorten(c.Title, 40) + " on the big screen");
            _mvBigHas = true;   // at once: a drop on window 2 right after is window 2's, not a second pick for the big screen
            await PlayPickAsync(c);
            _ = FollowStartingAsync();
            // the big screen in Watch's corner at once (2026-09-24, "immediately open the mini window showing the big screen is playing when they
            // drag an item to it ... That way they can just click the window and start watching"): the page is drawn again once the pick is
            // loading, and the corner comes with it
            for (var i = 0; i < 24 && VideoHubOpen; i++)
            {
                // the corner takes it in place (2026-09-25, "There is a long freeze between adding an item to the big screen and when I can click again,
                // or drag another item to window 2"): the whole page had been drawn again for it, and a drag begun meanwhile went with the old page
                if (await ScreenTitleUpAsync()) { await MvCallAsync("state"); break; }
                await Task.Delay(250);
            }
            return;
        }
        if (!_mvOn) await MvCallAsync("on");
        if (!_mvOn) { SetPill("Prism · multiview could not come on"); return; }
        var was = _mvTarget;
        await MvCallAsync("target", index.ToString());
        SetPill("Prism · " + Shorten(c.Title, 40) + " → " + (index == 0 ? "the big window" : "window " + (index + 1)));
        await PlayPickAsync(c);
        _ = FollowStartingAsync();
        await MvCallAsync("target", was.ToString());
        DrawMvStrip();
        await Task.Delay(2500);   // the window's page is up by now: its name on the strip
        await MvCallAsync("state");
        DrawMvStrip();
    }

    // ---------------------------------------------------------------- the empty stage
    private Grid? _emptyStage;
    /// <summary>Multiview on and no window left: nothing is playing, and the wall says so with a stage - purple curtains drawn in, a
    /// spot on the boards. Drawn, not a picture: no asset, no network. Gone the moment a window is filled.</summary>
    private void SyncEmptyStage()
    {
        // the single big screen too, once nothing is on it (2026-09-25, "I clicked back to video even though I show blank, it took me to the paramount
        // home page. If the videos are all cleared, nothing should be playing"): the service's home under a cleared screen is not a thing to watch.
        // Only while the Video player is the wall; a pick (loading counts) takes it away
        // never over Watch: the stage stands above the tile canvas, Watch included - it comes up as Watch closes
        // never over a sign-in or the welcome page (2026-09-29, a new device: the stage stood over the service's sign-in page)
        var show = !VideoHubOpen && !_asSession && _welcome is null && ((_mvOn && _mvWindows.Count == 0) || (!_mvOn && !_mvBigHas && WatchGrip.Visibility == Visibility.Visible));
        if (!show) { if (_emptyStage is not null) _emptyStage.Visibility = Visibility.Collapsed; return; }
        _emptyStage ??= BuildEmptyStage();
        _emptyStage.Visibility = Visibility.Visible;
    }
    /// <summary>
    /// A drape's tie-back as a gold rope (2026-09-25, "The gold ties are pretty low quality, anything you can improve to make them look like ropes"):
    /// a twisted cord (diagonal strands repeating in light, mid and dark gold), lit from above and shaded below, with a thin dark edge; the drape
    /// shaded where it is cinched; a knot where the rope wraps it on the screen side, and a tassel of threads hanging from the knot.
    /// </summary>
    private static FrameworkElement TieBack(bool leftDrape)
    {
        static Windows.UI.Color C(byte r, byte g, byte b, byte a = 0xFF) => Windows.UI.Color.FromArgb(a, r, g, b);
        var g = new Grid { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 120, 0, 0), Height = 180, HorizontalAlignment = leftDrape ? HorizontalAlignment.Left : HorizontalAlignment.Right };
        // the drape pulled in: darker above and below the cord
        g.Children.Add(new Border
        {
            Height = 90, VerticalAlignment = VerticalAlignment.Center,
            Background = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0.5, 0), EndPoint = new Windows.Foundation.Point(0.5, 1), GradientStops = {
                new GradientStop { Color = C(0, 0, 0, 0x00), Offset = 0 }, new GradientStop { Color = C(0, 0, 0, 0x70), Offset = 0.42 },
                new GradientStop { Color = C(0, 0, 0, 0x70), Offset = 0.58 }, new GradientStop { Color = C(0, 0, 0, 0x00), Offset = 1 } } },
        });
        // the cord: twisted strands, then light from above and shade below
        var twist = new LinearGradientBrush
        {
            MappingMode = BrushMappingMode.Absolute, SpreadMethod = GradientSpreadMethod.Repeat,
            StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(12, 12),
            GradientStops = {
                new GradientStop { Color = C(0xF3, 0xD7, 0x86), Offset = 0 }, new GradientStop { Color = C(0xD4, 0xA6, 0x48), Offset = 0.35 },
                new GradientStop { Color = C(0x8C, 0x62, 0x1C), Offset = 0.62 }, new GradientStop { Color = C(0x5E, 0x3F, 0x0E), Offset = 0.78 },
                new GradientStop { Color = C(0xF3, 0xD7, 0x86), Offset = 1 } },
        };
        var cord = new Grid { Height = 26, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(-4, 0, -4, 0) };
        cord.Children.Add(new Border { Background = twist, CornerRadius = new CornerRadius(13), BorderBrush = new SolidColorBrush(C(0x3A, 0x26, 0x08)), BorderThickness = new Thickness(1) });
        cord.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(13),
            Background = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0.5, 0), EndPoint = new Windows.Foundation.Point(0.5, 1), GradientStops = {
                new GradientStop { Color = C(0xFF, 0xF4, 0xD0, 0x70), Offset = 0 }, new GradientStop { Color = C(0xFF, 0xF4, 0xD0, 0x00), Offset = 0.4 },
                new GradientStop { Color = C(0, 0, 0, 0x00), Offset = 0.6 }, new GradientStop { Color = C(0, 0, 0, 0x80), Offset = 1 } } },
        });
        g.Children.Add(cord);
        // the knot on the screen side, and the tassel hanging from it
        var hang = new StackPanel { HorizontalAlignment = leftDrape ? HorizontalAlignment.Right : HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = leftDrape ? new Thickness(0, 72, -14, 0) : new Thickness(-14, 72, 0, 0) };
        hang.Children.Add(new Microsoft.UI.Xaml.Shapes.Ellipse
        {
            Width = 36, Height = 36, HorizontalAlignment = HorizontalAlignment.Center, Stroke = new SolidColorBrush(C(0x3A, 0x26, 0x08)), StrokeThickness = 1,
            Fill = new RadialGradientBrush { Center = new Windows.Foundation.Point(0.35, 0.3), GradientOrigin = new Windows.Foundation.Point(0.35, 0.3), RadiusX = 0.7, RadiusY = 0.7, GradientStops = {
                new GradientStop { Color = C(0xFB, 0xE6, 0xA4), Offset = 0 }, new GradientStop { Color = C(0xC8, 0x96, 0x3A), Offset = 0.55 }, new GradientStop { Color = C(0x6E, 0x4A, 0x12), Offset = 1 } } },
        });
        // the tassel's cap, then its threads: fine vertical strands, lit at the top, fading at the tips
        hang.Children.Add(new Border { Width = 24, Height = 10, HorizontalAlignment = HorizontalAlignment.Center, CornerRadius = new CornerRadius(3), Margin = new Thickness(0, -3, 0, 0), Background = new SolidColorBrush(C(0xB0, 0x80, 0x2A)), BorderBrush = new SolidColorBrush(C(0x3A, 0x26, 0x08)), BorderThickness = new Thickness(1) });
        var threads = new Grid { Width = 40, Height = 88, HorizontalAlignment = HorizontalAlignment.Center };
        threads.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(4, 4, 20, 20),
            Background = new LinearGradientBrush { MappingMode = BrushMappingMode.Absolute, SpreadMethod = GradientSpreadMethod.Repeat, StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(3, 0), GradientStops = {
                new GradientStop { Color = C(0xE9, 0xC4, 0x6C), Offset = 0 }, new GradientStop { Color = C(0xA8, 0x78, 0x26), Offset = 0.5 }, new GradientStop { Color = C(0xE9, 0xC4, 0x6C), Offset = 1 } } },
        });
        threads.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(4, 4, 20, 20),
            Background = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0.5, 0), EndPoint = new Windows.Foundation.Point(0.5, 1), GradientStops = {
                new GradientStop { Color = C(0, 0, 0, 0x50), Offset = 0 }, new GradientStop { Color = C(0, 0, 0, 0x00), Offset = 0.3 },
                new GradientStop { Color = C(0x0B, 0x08, 0x10, 0x00), Offset = 0.7 }, new GradientStop { Color = C(0x0B, 0x08, 0x10, 0xB0), Offset = 1 } } },
        });
        hang.Children.Add(threads);
        g.Children.Add(hang);
        return g;
    }

    private Grid BuildEmptyStage()
    {
        var g = StageArt("Nothing is playing", "Drag a title from Watch onto the big window", 34, 17);
        Canvas.SetZIndex(g, 924);   // under the curtain (925) and the Watch page (930): a pick's own face and the page stand over it
        RootGrid.Children.Add(g);
        return g;
    }

    /// <summary>
    /// The valance across the top (2026-09-25, "Can we get any texture up top?"): pleated like the drapes and lit from above, its lower edge
    /// hanging in swags trimmed with gold rope, a tassel where two swags meet, and a twisted gold cord along the top.
    /// </summary>
    private static FrameworkElement Valance()
    {
        static Windows.UI.Color C(byte r, byte g, byte b, byte a = 0xFF) => Windows.UI.Color.FromArgb(a, r, g, b);
        const double body = 96, depth = 38;
        var v = new Grid { VerticalAlignment = VerticalAlignment.Top, Height = body + depth + 40, IsHitTestVisible = false };
        // the pleats: repeating lit and deep purple across, then light from above and shade toward the hem
        var pleats = new LinearGradientBrush
        {
            MappingMode = BrushMappingMode.Absolute, SpreadMethod = GradientSpreadMethod.Repeat,
            StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(44, 0),
            GradientStops = {
                new GradientStop { Color = C(0x5E, 0x24, 0x80), Offset = 0 }, new GradientStop { Color = C(0x7A, 0x36, 0x9E), Offset = 0.3 },
                new GradientStop { Color = C(0x3A, 0x12, 0x55), Offset = 0.7 }, new GradientStop { Color = C(0x5E, 0x24, 0x80), Offset = 1 } },
        };
        var shade = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0.5, 0), EndPoint = new Windows.Foundation.Point(0.5, 1),
            GradientStops = {
                new GradientStop { Color = C(0xFF, 0xE8, 0xFF, 0x30), Offset = 0 }, new GradientStop { Color = C(0, 0, 0, 0x00), Offset = 0.35 },
                new GradientStop { Color = C(0x10, 0x04, 0x18, 0x90), Offset = 1 } },
        };
        var cloth = new Microsoft.UI.Xaml.Shapes.Path { Fill = pleats, Stretch = Stretch.None };
        var dim = new Microsoft.UI.Xaml.Shapes.Path { Fill = shade, Stretch = Stretch.None };
        var gold = new LinearGradientBrush
        {
            MappingMode = BrushMappingMode.Absolute, SpreadMethod = GradientSpreadMethod.Repeat,
            StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(9, 9),
            GradientStops = {
                new GradientStop { Color = C(0xF3, 0xD7, 0x86), Offset = 0 }, new GradientStop { Color = C(0xC8, 0x96, 0x3A), Offset = 0.45 },
                new GradientStop { Color = C(0x7A, 0x52, 0x16), Offset = 0.75 }, new GradientStop { Color = C(0xF3, 0xD7, 0x86), Offset = 1 } },
        };
        var trimEdge = new Microsoft.UI.Xaml.Shapes.Path { Stroke = new SolidColorBrush(C(0x2A, 0x1A, 0x06)), StrokeThickness = 9, Stretch = Stretch.None };
        var trim = new Microsoft.UI.Xaml.Shapes.Path { Stroke = gold, StrokeThickness = 7, Stretch = Stretch.None };
        var tassels = new Canvas();
        v.Children.Add(cloth); v.Children.Add(dim); v.Children.Add(trimEdge); v.Children.Add(trim);
        // the cord along the top
        v.Children.Add(new Border { Height = 12, VerticalAlignment = VerticalAlignment.Top, Background = gold, BorderBrush = new SolidColorBrush(C(0x2A, 0x1A, 0x06)), BorderThickness = new Thickness(0, 0, 0, 1) });
        v.Children.Add(tassels);
        v.SizeChanged += (_, e) =>
        {
            var W = e.NewSize.Width;
            if (W < 100) return;
            var n = Math.Max(4, (int)Math.Round(W / 300));
            PathGeometry Body()
            {
                var fig = new PathFigure { StartPoint = new Windows.Foundation.Point(0, 0), IsClosed = true, IsFilled = true };
                fig.Segments.Add(new LineSegment { Point = new Windows.Foundation.Point(W, 0) });
                fig.Segments.Add(new LineSegment { Point = new Windows.Foundation.Point(W, body) });
                for (var q = n; q > 0; q--)
                {
                    double xa = W * q / n, xb = W * (q - 1) / n;
                    fig.Segments.Add(new QuadraticBezierSegment { Point1 = new Windows.Foundation.Point((xa + xb) / 2, body + depth * 2), Point2 = new Windows.Foundation.Point(xb, body) });
                }
                var geo = new PathGeometry(); geo.Figures.Add(fig); return geo;
            }
            cloth.Data = Body(); dim.Data = Body();
            PathGeometry Edge()
            {
                var fig = new PathFigure { StartPoint = new Windows.Foundation.Point(0, body), IsClosed = false, IsFilled = false };
                for (var q = 0; q < n; q++)
                {
                    double xa = W * q / n, xb = W * (q + 1) / n;
                    fig.Segments.Add(new QuadraticBezierSegment { Point1 = new Windows.Foundation.Point((xa + xb) / 2, body + depth * 2), Point2 = new Windows.Foundation.Point(xb, body) });
                }
                var geo = new PathGeometry(); geo.Figures.Add(fig); return geo;
            }
            trimEdge.Data = Edge(); trim.Data = Edge();
            // a tassel where two swags meet
            tassels.Children.Clear();
            for (var q = 1; q < n; q++)
            {
                var x = W * q / n;
                var knob = new Microsoft.UI.Xaml.Shapes.Ellipse
                {
                    Width = 20, Height = 20, Stroke = new SolidColorBrush(C(0x2A, 0x1A, 0x06)), StrokeThickness = 1,
                    Fill = new RadialGradientBrush { Center = new Windows.Foundation.Point(0.35, 0.3), GradientOrigin = new Windows.Foundation.Point(0.35, 0.3), RadiusX = 0.7, RadiusY = 0.7, GradientStops = {
                        new GradientStop { Color = C(0xFB, 0xE6, 0xA4), Offset = 0 }, new GradientStop { Color = C(0xC8, 0x96, 0x3A), Offset = 0.55 }, new GradientStop { Color = C(0x6E, 0x4A, 0x12), Offset = 1 } } },
                };
                Canvas.SetLeft(knob, x - 10); Canvas.SetTop(knob, body - 6);
                var threads = new Border
                {
                    Width = 16, Height = 30, CornerRadius = new CornerRadius(2, 2, 8, 8),
                    Background = new LinearGradientBrush { MappingMode = BrushMappingMode.Absolute, SpreadMethod = GradientSpreadMethod.Repeat, StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(3, 0), GradientStops = {
                        new GradientStop { Color = C(0xE9, 0xC4, 0x6C), Offset = 0 }, new GradientStop { Color = C(0xA8, 0x78, 0x26), Offset = 0.5 }, new GradientStop { Color = C(0xE9, 0xC4, 0x6C), Offset = 1 } } },
                };
                Canvas.SetLeft(threads, x - 8); Canvas.SetTop(threads, body + 12);
                tassels.Children.Add(threads); tassels.Children.Add(knob);
            }
        };
        return v;
    }

    /// <summary>The stage itself: boards, a spot, the valance, the drapes gathered by gold ropes, and the screen between them with its two lines.</summary>
    private static Grid StageArt(string line1, string line2, double size1, double size2)
    {
        var g = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x0B, 0x08, 0x10)), IsHitTestVisible = false };
        // the boards and the spot
        g.Children.Add(new Border
        {
            VerticalAlignment = VerticalAlignment.Bottom, Height = 220,
            Background = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(0, 1), GradientStops = { new GradientStop { Color = Windows.UI.Color.FromArgb(0xFF, 0x2A, 0x1A, 0x10), Offset = 0 }, new GradientStop { Color = Windows.UI.Color.FromArgb(0xFF, 0x12, 0x0B, 0x07), Offset = 1 } } },
        });
        g.Children.Add(new Microsoft.UI.Xaml.Shapes.Ellipse
        {
            Width = 900, Height = 170, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 40),
            Fill = new RadialGradientBrush { GradientStops = { new GradientStop { Color = Windows.UI.Color.FromArgb(0x70, 0xFF, 0xE2, 0xA8), Offset = 0 }, new GradientStop { Color = Windows.UI.Color.FromArgb(0x00, 0xFF, 0xE2, 0xA8), Offset = 1 } } },
        });
        // the curtains open on a blank screen (2026-09-25, "Hey you added the curtains to the show video screen. I love those. Can they be open with a
        // blank screen?"): the drapes gathered to the sides, each held by a gold tie-back, and between them the screen at rest - dimly lit, a dark
        // room is not glared at. Folds are alternating bands of deep and lit purple, tighter where the drape is gathered
        var stage = new Grid { Margin = new Thickness(0, 0, 0, 150) };
        stage.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.16, GridUnitType.Star) });
        stage.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        stage.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.16, GridUnitType.Star) });
        var screen = new Border
        {
            Margin = new Thickness(18, 150, 18, 44), CornerRadius = new CornerRadius(4),
            BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x0A, 0x0A, 0x0E)), BorderThickness = new Thickness(6),
            Background = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0.5, 0), EndPoint = new Windows.Foundation.Point(0.5, 1), GradientStops = {
                new GradientStop { Color = Windows.UI.Color.FromArgb(0xFF, 0x33, 0x35, 0x3D), Offset = 0 },
                new GradientStop { Color = Windows.UI.Color.FromArgb(0xFF, 0x26, 0x28, 0x2F), Offset = 0.6 },
                new GradientStop { Color = Windows.UI.Color.FromArgb(0xFF, 0x1D, 0x1E, 0x24), Offset = 1 } } },
            Child = new StackPanel
            {
                VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Spacing = 8,
                Children =
                {
                    new TextBlock { Text = line1, FontSize = size1, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xE8, 0xEC, 0xF2)), HorizontalAlignment = HorizontalAlignment.Center },
                    new TextBlock { Text = line2, FontSize = size2, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x8A, 0x93, 0xA2)), HorizontalAlignment = HorizontalAlignment.Center },
                },
            },
        };
        Grid.SetColumn(screen, 1);
        stage.Children.Add(screen);
        for (var side = 0; side < 2; side++)
        {
            var folds = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(1, 0) };
            const int n = 7;
            for (var k = 0; k <= n; k++)
            {
                var lit = k % 2 == 0;
                folds.GradientStops.Add(new GradientStop { Color = lit ? Windows.UI.Color.FromArgb(0xFF, 0x6A, 0x2C, 0x8E) : Windows.UI.Color.FromArgb(0xFF, 0x2E, 0x0F, 0x42), Offset = (double)k / n });
            }
            var drape = new Grid();
            var cloth = new Microsoft.UI.Xaml.Shapes.Path { Fill = folds, Stretch = Stretch.None };
            var tie = TieBack(side == 0);
            drape.Children.Add(cloth);
            drape.Children.Add(tie);
            var left = side == 0;
            // gathered as a tied curtain is (2026-09-25, the ropes "pretty low quality"): full at the top, cinched to about half its width at the rope,
            // flaring out again to the floor; the rope wraps the cinch only
            drape.SizeChanged += (_, e) =>
            {
                double W = e.NewSize.Width, H = e.NewSize.Height;
                if (W < 20 || H < 100) return;
                var ropeY = H / 2 + 60; var pinch = W * 0.5;
                double X(double x) => left ? x : W - x;
                var fig = new PathFigure { StartPoint = new Windows.Foundation.Point(X(0), 0), IsClosed = true, IsFilled = true };
                fig.Segments.Add(new LineSegment { Point = new Windows.Foundation.Point(X(W), 0) });
                fig.Segments.Add(new BezierSegment { Point1 = new Windows.Foundation.Point(X(W), ropeY * 0.45), Point2 = new Windows.Foundation.Point(X(pinch), ropeY * 0.8), Point3 = new Windows.Foundation.Point(X(pinch), ropeY) });
                fig.Segments.Add(new BezierSegment { Point1 = new Windows.Foundation.Point(X(pinch), ropeY + (H - ropeY) * 0.25), Point2 = new Windows.Foundation.Point(X(W * 0.85), ropeY + (H - ropeY) * 0.55), Point3 = new Windows.Foundation.Point(X(W * 0.9), H) });
                // the hem and the outer side ruffled like the inner (2026-09-25, "Can the edges of the curtain border be ruffled on the outside like the
                // inside"): scallops, one per fold, always inside the drape's own width and height so the window's edge cuts none of them
                var amp = Math.Max(3, W * 0.07);
                var hemN = 5; double hx0 = W * 0.9;
                for (var k = 0; k < hemN; k++)
                {
                    double xa = hx0 - hx0 * k / hemN, xb = hx0 - hx0 * (k + 1) / hemN;
                    fig.Segments.Add(new QuadraticBezierSegment { Point1 = new Windows.Foundation.Point(X((xa + xb) / 2), H - amp * 0.8), Point2 = new Windows.Foundation.Point(X(xb), H) });
                }
                var sideN = Math.Max(6, (int)Math.Round(H / 70));
                for (var k = 0; k < sideN; k++)
                {
                    double ya = H - H * k / sideN, yb = H - H * (k + 1) / sideN;
                    fig.Segments.Add(new QuadraticBezierSegment { Point1 = new Windows.Foundation.Point(X(amp), (ya + yb) / 2), Point2 = new Windows.Foundation.Point(X(0), yb) });
                }
                var geo = new PathGeometry(); geo.Figures.Add(fig);
                cloth.Data = geo;
                tie.Width = pinch + 8;
            };
            Grid.SetColumn(drape, side == 0 ? 0 : 2);
            stage.Children.Add(drape);
        }
        g.Children.Add(stage);
        g.Children.Add(Valance());
        return g;
    }
}
