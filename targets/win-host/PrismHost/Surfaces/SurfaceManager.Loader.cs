using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Media.Imaging;
using Path = Microsoft.UI.Xaml.Shapes.Path;

namespace PrismHost.Surfaces;

/// <summary>
/// The loading mark (2026-10-07, "When I go full screen and all the windows are still black, shouldn't I see the gold ring spinning? Think we
/// could do Prism's triangle with a glow running around it instead?"): the ring was the YouTube TV page's own, drawn inside the page, and a
/// window still loading is black under the host's dark substrate (section 16), where the page draws nothing. The host's mark sits on that
/// substrate: Prism's triangle, dimmed, with a light running around its edges. It runs only on a visible window whose page is live and still
/// covered; parked and hidden windows run nothing.
/// </summary>
public sealed partial class SurfaceManager
{
    private static readonly Windows.UI.Color LoaderGold = Windows.UI.Color.FromArgb(255, 0xF2, 0xB1, 0x4C);
    private readonly Dictionary<string, (Grid Sign, Path Glow, Path Line, Storyboard Run)> _loaders = new();
    private DispatcherTimer? _loaderTimer;

    private void StartLoaderWatch()
    {
        _loaderTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
        _loaderTimer.Tick += (_, __) => SyncLoaders();
        _loaderTimer.Start();
    }

    private void SyncLoaders()
    {
        foreach (var (id, t) in _tiles.ToArray())
        {
            var on = t.Kind == SurfaceKind.Slot && !t.HiddenPresence && t.View is not null && t.Container.Visibility == Visibility.Visible
                     && t.Overlay.Opacity > 0.5 && t.Rect.W >= 80 && t.Rect.H >= 60;
            if (on)
            {
                if (!_loaders.TryGetValue(id, out var l)) { l = MakeLoader(t); _loaders[id] = l; }
                var size = Math.Clamp(Math.Min(t.Rect.W, t.Rect.H) * 0.16, 36, 120);
                if (Math.Abs(l.Sign.Width - size) > 0.5) SizeLoader(l, size);
                if (l.Sign.Visibility != Visibility.Visible) { l.Sign.Visibility = Visibility.Visible; l.Run.Begin(); }
            }
            else if (_loaders.TryGetValue(id, out var l) && l.Sign.Visibility == Visibility.Visible)
            {
                l.Run.Stop();
                l.Sign.Visibility = Visibility.Collapsed;
            }
        }
        foreach (var gone in _loaders.Keys.Where(k => !_tiles.ContainsKey(k)).ToList()) { _loaders[gone].Run.Stop(); _loaders.Remove(gone); }
    }

    private (Grid Sign, Path Glow, Path Line, Storyboard Run) MakeLoader(Tile t)
    {
        var mark = new Grid { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, IsHitTestVisible = false, Visibility = Visibility.Collapsed };
        var icon = new Image { Opacity = 0.32, Stretch = Stretch.Uniform };
        try { icon.Source = new BitmapImage(new Uri(System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "prism-icon-192.png"))); } catch { }
        var cap = PenLineCap.Round;
        var glow = new Path { Stroke = new SolidColorBrush(Windows.UI.Color.FromArgb(90, LoaderGold.R, LoaderGold.G, LoaderGold.B)), StrokeLineJoin = PenLineJoin.Round, StrokeStartLineCap = cap, StrokeEndLineCap = cap, StrokeDashCap = cap };
        var line = new Path { Stroke = new SolidColorBrush(LoaderGold), StrokeLineJoin = PenLineJoin.Round, StrokeStartLineCap = cap, StrokeEndLineCap = cap, StrokeDashCap = cap };
        mark.Children.Add(icon);
        mark.Children.Add(glow);
        mark.Children.Add(line);
        t.Overlay.Children.Add(mark);   // above the substrate and the frozen picture, faded with them
        var run = new Storyboard { RepeatBehavior = RepeatBehavior.Forever };
        foreach (var p in new[] { glow, line })
        {
            var a = new DoubleAnimation { Duration = new Duration(TimeSpan.FromMilliseconds(1500)), EnableDependentAnimation = true };
            Storyboard.SetTarget(a, p);
            Storyboard.SetTargetProperty(a, "StrokeDashOffset");
            run.Children.Add(a);
        }
        var l = (mark, glow, line, run);
        return l;
    }

    /// <summary>The triangle drawn at the mark's size (a dash is counted in stroke widths, so the path is built in pixels, never stretched).
    /// The corners follow the icon's own triangle (prism-icon-192.png: x 8-184, y 18-174 of 192).</summary>
    private static void SizeLoader((Grid Sign, Path Glow, Path Line, Storyboard Run) l, double size)
    {
        l.Run.Stop();
        l.Sign.Width = size; l.Sign.Height = size;
        var k = size / 192.0;
        var a = new Windows.Foundation.Point(96 * k, 20 * k);
        var b = new Windows.Foundation.Point(182 * k, 172 * k);
        var c = new Windows.Foundation.Point(10 * k, 172 * k);
        var perimeter = Dist(a, b) + Dist(b, c) + Dist(c, a);
        var glowW = Math.Max(4, size / 14); var lineW = Math.Max(1.5, size / 40);
        var i = 0;
        foreach (var (p, w) in new[] { (l.Glow, glowW), (l.Line, lineW) })
        {
            var fig = new PathFigure { StartPoint = a, IsClosed = true };
            fig.Segments.Add(new LineSegment { Point = b });
            fig.Segments.Add(new LineSegment { Point = c });
            var g = new PathGeometry(); g.Figures.Add(fig);
            p.Data = g;
            p.StrokeThickness = w;
            var run = perimeter * 0.22;   // the light: a fifth of the way round
            p.StrokeDashArray = new DoubleCollection { run / w, (perimeter - run) / w };
            var anim = (DoubleAnimation)l.Run.Children[i++];
            anim.From = perimeter / w; anim.To = 0;   // clockwise, a lap a beat
        }
        if (l.Sign.Visibility == Visibility.Visible) l.Run.Begin();
    }

    private static double Dist(Windows.Foundation.Point p, Windows.Foundation.Point q) => Math.Sqrt((p.X - q.X) * (p.X - q.X) + (p.Y - q.Y) * (p.Y - q.Y));
}
