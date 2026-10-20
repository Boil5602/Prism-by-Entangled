using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;

namespace PrismHost;

/// <summary>
/// The tour's notice and its introduction (2026-10-11, "put up a new alert in the status area at the top center that we've added the
/// new tutorial section, and give them the option to enter into it from that status button in a little pill on the same line. Lets
/// leave that up until they press the button ... show an animation of opening the Prism menu (can you highlight that part of the
/// screen and dim the rest) and then show a second animated mouse cursor clicking on the tutorial button and then show the tutorial
/// screen. No need to show that again" - "A sort of First Run event? And then add an option to re-enable the tutorial notification").
///
/// The notice: one line in the status area, the words in a pill and Show me in a pill beside them. It stays until Show me is pressed,
/// through restarts, and steps down a line while the status line has something of its own to say. It waits for the Set up services
/// page to be closed. Shown once for a data folder (host-prefs tutorial.noticeDone); the tour's list of subjects can bring it back.
///
/// The introduction: the screen dims but for the Prism tab, a drawn pointer travels to the tab and presses it, the real menu opens
/// and stays bright, the pointer travels to How Prism works and presses it, and the tour opens. It teaches where the tour lives by
/// going there. The pointer is a drawing: the person's own pointer is never moved and nothing is pressed for them but the two things
/// shown. A press anywhere, or Escape, goes straight to the tour. With motion turned down in Windows (and Full motion not chosen in
/// Prism) the pointer does not travel: each step is shown still.
/// </summary>
public sealed partial class MainWindow
{
    private StackPanel? _tourNotice;
    private MenuFlyoutItem? _tourMenuItem;   // How Prism works in the open Prism menu (set where the menu is built)
    private bool _tourIntroPlaying;
    private DispatcherTimer? _tourNoticeTimer;
    private bool _tourNoticeFollowsPill;

    /// <summary>From the start: a look every few seconds until the notice has been shown and answered.</summary>
    private void TourNoticeWatch()
    {
        _tourNoticeTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(6) };
        _tourNoticeTimer.Tick += (_, __) => TourNoticeIfOwed();
        _tourNoticeTimer.Start();
    }

    private void TourNoticeIfOwed()
    {
        if (HostPrefs.GetBool("tutorial.noticeDone", false)) { _tourNoticeTimer?.Stop(); return; }
        if (_tourNotice is not null || _tourIntroPlaying || _tutorial is not null || _welcome is not null || RootGrid.XamlRoot is null) return;
        ShowTourNotice();
    }

    private void PlaceTourNotice() { if (_tourNotice is { } n) n.Margin = new Thickness(0, PillBorder.Visibility == Visibility.Visible ? 70 : 34, 0, 0); }

    private void ShowTourNotice()
    {
        if (_tourNotice is not null) return;
        var words = new TextBlock { FontSize = 15, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
        words.Inlines.Add(new Run { Text = "New", Foreground = HubAmber, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        words.Inlines.Add(new Run { Text = "   How Prism works, a short tour of what Prism can do" });
        var line = new Border { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE6, 0x12, 0x13, 0x1A)), BorderBrush = Tokens.AmberAt(0x3A), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(16, 7, 16, 7), Child = words };
        var go = Chip(new TextBlock { Text = "Show me", FontSize = 15, Foreground = HubInk }, true);
        ToolTipService.SetToolTip(go, "A few seconds showing where the tour lives, then the tour itself. It is in the Prism menu any time, under How Prism works.");
        go.Click += (_, __) => { TourNoticeDone(); _ = PlayTourIntroAsync(); };
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top };
        Canvas.SetZIndex(row, 951);   // the status area, just over the status line's own layer
        row.Children.Add(line); row.Children.Add(go);
        RootGrid.Children.Add(row);
        _tourNotice = row;
        PlaceTourNotice();
        if (!_tourNoticeFollowsPill) { _tourNoticeFollowsPill = true; PillBorder.RegisterPropertyChangedCallback(UIElement.VisibilityProperty, (_, __) => PlaceTourNotice()); }
        LogLine("tutorial notice: shown");
    }

    private void TourNoticeDone()
    {
        if (_tourNotice is { } n) { RootGrid.Children.Remove(n); _tourNotice = null; }
        HostPrefs.Set("tutorial.noticeDone", true);
        _tourNoticeTimer?.Stop();
    }

    /// <summary>The notice put back (the tour's list offers it): it shows now and stays until Show me is pressed again.</summary>
    private void TourNoticeAgain()
    {
        HostPrefs.Set("tutorial.noticeDone", false);
        LeaveTutorial();
        ShowTourNotice();
        _tourNoticeTimer?.Start();
    }

    private static bool TourMotion()
    {
        try { return PrismHost.Surfaces.Visualization.VisualizationHost.ForceFullMotion || new Windows.UI.ViewManagement.UISettings().AnimationsEnabled; }
        catch { return true; }
    }

    private async Task PlayTourIntroAsync()
    {
        if (_tourIntroPlaying) return;
        _tourIntroPlaying = true;
        LogLine("tutorial intro: playing");
        if (VideoHubOpen) _tourFromWatch = true;
        Grid? scrim = null; Popup? top = null;
        var skip = false;
        var motion = TourMotion();
        var gripWas = MenuGrip.Opacity;
        try
        {
            CloseTutorial();
            double w = RootGrid.ActualWidth, h = RootGrid.ActualHeight;
            MenuGrip.Opacity = 1;

            // the shade: everything dimmed but a hole, under the Prism tab and its menu
            var shade = new Microsoft.UI.Xaml.Shapes.Path { Fill = new SolidColorBrush(Windows.UI.Color.FromArgb(0xC8, 0x05, 0x06, 0x09)) };
            scrim = new Grid { Children = { shade } };
            Canvas.SetZIndex(scrim, 998);
            scrim.PointerPressed += (_, e) => { e.Handled = true; skip = true; };
            var esc = new Microsoft.UI.Xaml.Input.KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
            esc.Invoked += (_, e) => { e.Handled = true; skip = true; };
            scrim.KeyboardAccelerators.Add(esc);
            RootGrid.Children.Add(scrim);

            // over everything, the menu too: the ring round what is being shown, the words, the drawn pointer and its press
            var layer = new Canvas { Width = w, Height = h, IsHitTestVisible = false };
            var ring = new Border { BorderBrush = HubAmber, BorderThickness = new Thickness(2), CornerRadius = new CornerRadius(12), IsHitTestVisible = false };
            var itemRing = new Border { BorderBrush = HubAmber, BorderThickness = new Thickness(2), CornerRadius = new CornerRadius(8), Visibility = Visibility.Collapsed, IsHitTestVisible = false };
            var caption = new TextBlock { FontSize = 24, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextAlignment = TextAlignment.Center, Width = 760, TextWrapping = TextWrapping.Wrap, IsHitTestVisible = false };
            var ripple = new Ellipse { Stroke = HubAmber, StrokeThickness = 3, Opacity = 0, IsHitTestVisible = false };
            var arrow = new Polygon { Fill = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xFF, 0xFF, 0xFF)), Stroke = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x14, 0x17, 0x1C)), StrokeThickness = 1.5, IsHitTestVisible = false };
            foreach (var (x, y) in new[] { (0.0, 0.0), (0.0, 29.0), (7.5, 22.0), (12.5, 34.0), (17.0, 32.0), (12.0, 21.0), (21.0, 21.0) }) arrow.Points.Add(new Point(x, y));
            layer.Children.Add(ring); layer.Children.Add(itemRing); layer.Children.Add(caption); layer.Children.Add(ripple); layer.Children.Add(arrow);
            // a windowed popup (its own top-level window), like the menu's own: an in-window popup can never stand over a menu flyout,
            // so the cursor went behind the menu (2026-10-12, "the animated mouse cursor goes BEHIND the menu"); opened again after the
            // menu, it is the newer window and stands over it
            top = new Popup { XamlRoot = RootGrid.XamlRoot, Child = layer, IsHitTestVisible = false, ShouldConstrainToRootBounds = false };

            double px = w / 2, py = h * 0.58;
            void At(double x, double y) { px = x; py = y; Canvas.SetLeft(arrow, x); Canvas.SetTop(arrow, y); }
            void Hole(Rect r, string words)
            {
                var g = new GeometryGroup { FillRule = FillRule.EvenOdd };
                g.Children.Add(new RectangleGeometry { Rect = new Rect(0, 0, w, h) });
                g.Children.Add(new RectangleGeometry { Rect = r });
                shade.Data = g;
                ring.Width = r.Width; ring.Height = r.Height; Canvas.SetLeft(ring, r.X); Canvas.SetTop(ring, r.Y);
                caption.Text = words;
                Canvas.SetLeft(caption, Math.Clamp(r.X + r.Width / 2 - 380, 12, Math.Max(12, w - 772)));
                Canvas.SetTop(caption, Math.Min(r.Bottom + 22, h - 90));
            }
            var menuUp = false;   // once the menu is open, its closing by a press beside it is a skip too
            async Task Hold(int ms) { for (var t = 0; t < ms && !skip; t += 40) { await Task.Delay(40); if (menuUp && !_menuOpen) skip = true; } }
            async Task Glide(double tx, double ty, int ms)
            {
                if (!motion) { At(tx, ty); await Hold(250); return; }
                double sx = px, sy = py;
                var started = Environment.TickCount64;
                while (!skip)
                {
                    var u = Math.Min(1.0, (Environment.TickCount64 - started) / (double)ms);
                    var e = 1 - Math.Pow(1 - u, 3);   // quick away, soft landing
                    At(sx + (tx - sx) * e, sy + (ty - sy) * e);
                    if (u >= 1) break;
                    await Task.Delay(16);
                }
            }
            async Task Press()
            {
                var started = Environment.TickCount64;
                while (!skip)
                {
                    var u = Math.Min(1.0, (Environment.TickCount64 - started) / 380.0);
                    var d = 10 + 46 * u;
                    ripple.Width = d; ripple.Height = d; ripple.Opacity = 1 - u;
                    Canvas.SetLeft(ripple, px - d / 2); Canvas.SetTop(ripple, py - d / 2);
                    if (u >= 1 || !motion) break;
                    await Task.Delay(16);
                }
                ripple.Opacity = 0;
            }
            Rect Bounds(FrameworkElement el) => el.TransformToVisual(null).TransformBounds(new Rect(0, 0, el.ActualWidth, el.ActualHeight));
            static Rect Grow(Rect r, double by) => new(r.X - by, r.Y - by, r.Width + 2 * by, r.Height + 2 * by);

            // 1. the Prism tab
            var grip = Bounds(MenuGrip);
            Hole(Grow(grip, 10), "The Prism menu is always up here.");
            At(px, py);
            top.IsOpen = true;
            await Hold(900);
            await Glide(grip.X + grip.Width / 2, grip.Y + grip.Height / 2 + 2, 850);
            await Press();
            if (skip) return;

            // 2. the real menu, opened as a press on the tab opens it
            _tourMenuItem = null;
            await OpenAppMenuAsync();
            for (var i = 0; i < 40 && !skip && (_tourMenuItem is null || _tourMenuItem.ActualHeight <= 0); i++) await Task.Delay(50);
            if (skip || _tourMenuItem is not { ActualHeight: > 0 } item) return;
            menuUp = true;
            top.IsOpen = false; top.IsOpen = true;   // opened again, so it stands over the menu
            var itemBox = Bounds(item);
            var menuBox = itemBox;
            for (DependencyObject? d = item; d is not null; d = VisualTreeHelper.GetParent(d)) if (d is MenuFlyoutPresenter mp) { menuBox = Bounds(mp); break; }
            var both = new Rect(Math.Min(grip.X, menuBox.X), grip.Y, Math.Max(grip.Right, menuBox.Right) - Math.Min(grip.X, menuBox.X), menuBox.Bottom - grip.Y);
            Hole(Grow(both, 8), "How Prism works opens the tour whenever you want it.");
            await Hold(700);

            // 3. How Prism works
            itemRing.Width = itemBox.Width; itemRing.Height = itemBox.Height; Canvas.SetLeft(itemRing, itemBox.X); Canvas.SetTop(itemRing, itemBox.Y);
            itemRing.Visibility = Visibility.Visible;
            await Glide(itemBox.X + Math.Min(150, itemBox.Width / 2), itemBox.Y + itemBox.Height / 2, 900);
            await Press();
            await Hold(250);
        }
        catch (Exception ex) { LogLine("tutorial intro: " + ex.GetType().Name + ": " + ex.Message); }
        finally
        {
            try { if (top is not null) top.IsOpen = false; } catch { }
            try { _appMenuFlyout?.Hide(); } catch { }
            if (scrim is not null) RootGrid.Children.Remove(scrim);
            MenuGrip.Opacity = gripWas;
            _tourIntroPlaying = false;
            LogLine("tutorial intro: " + (skip ? "skipped to the tour" : "done"));
            _tutorialTopic = -1;   // the tour from its list of subjects
            ShowTutorial();
        }
    }
}
