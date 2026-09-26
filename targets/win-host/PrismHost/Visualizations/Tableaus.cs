using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;

namespace PrismHost.Visualizations;

/// <summary>
/// One frame's music, already smoothed by the renderer: the per-band levels, four
/// summaries (low / mid / high / loud, 0..1), the beat impulse, the clock, and the
/// pack's speed for this state (idle drifts at the reduced speed with no beat).
/// </summary>
public readonly record struct TableauFrame(double[] Levels, double Low, double Mid, double High, double Loud, double Beat, double T, double Dt, double Speed, bool Reduced, double W, double H);

/// <summary>
/// A tableau is a composed scene - a sky, layered silhouettes, lights, weather -
/// whose lights and movement answer the music (the maintainer's ask, 2026-09-06:
/// "visual scenes ... tableaus with movements and lights"). Every shape is created
/// ONCE in <see cref="OnBuild"/>; <see cref="Frame"/> only moves and re-lights
/// them, so a frame allocates nothing (the renderer lockups of 2026-09-04 were
/// per-frame allocations). Particle pools are fixed-size and recycled.
///
/// The toolkit that makes them read as scenes rather than diagrams (polish pass,
/// 2026-09-06): radial-gradient glows for every light, gradient skies with a
/// horizon, three depths of silhouette with atmospheric perspective, gradient
/// reflections, a vignette, and a constant gentle drift the music rides on.
///
/// Sixteen ship, in two families the packs name: ENVIRONMENT (this file) and
/// COMMUNITY (Tableaus.Community.cs). A pack's `program` is the tableau's id.
/// </summary>
public abstract class Tableau
{
    protected Canvas C = null!;
    protected double W, H;
    protected Color[] Pal = Array.Empty<Color>();
    protected readonly Random Rng = new(11);

    protected static readonly Color Ink = Color.FromArgb(255, 0x0B, 0x0D, 0x12);
    protected static readonly Color Ink2 = Color.FromArgb(255, 0x14, 0x18, 0x21);
    protected static readonly Color Ink3 = Color.FromArgb(255, 0x1E, 0x24, 0x30);
    protected static readonly Color Haze = Color.FromArgb(255, 0x2A, 0x34, 0x48);
    protected static readonly Color White = Color.FromArgb(255, 0xEC, 0xEC, 0xF0);

    public void Build(Canvas c, double w, double h, Color[] pal)
    {
        C = c; W = w; H = h; Pal = pal.Length > 0 ? pal : StylePacks.PrismBands;
        C.Children.Clear();
        OnBuild();
    }

    protected abstract void OnBuild();
    public abstract void Frame(TableauFrame f);

    // ---- geometry and color helpers
    protected double X(double fx) => fx * W;
    protected double Y(double fy) => fy * H;
    /// <summary>A length that scales with the tile (fraction of its height).</summary>
    protected double S(double fh) => fh * H;
    protected Color P(int i) => Pal[Math.Abs(i) % Pal.Length];
    protected static Color A(Color c, double a) => Color.FromArgb((byte)Math.Clamp(a * 255, 0, 255), c.R, c.G, c.B);
    protected static Color Mix(Color a, Color b, double t) => Color.FromArgb(255, (byte)(a.R + (b.R - a.R) * t), (byte)(a.G + (b.G - a.G) * t), (byte)(a.B + (b.B - a.B) * t));
    protected static SolidColorBrush B(Color c) => new(c);
    protected static void At(UIElement e, double x, double y) { Canvas.SetLeft(e, x); Canvas.SetTop(e, y); }
    protected static double Lv(TableauFrame f, double frac) => f.Levels.Length == 0 ? 0 : f.Levels[(int)Math.Clamp(frac * (f.Levels.Length - 1), 0, f.Levels.Length - 1)];
    protected static double Clamp01(double v) => double.IsFinite(v) ? Math.Clamp(v, 0, 1) : 0;
    /// <summary>Every opacity a tableau writes goes through here: XAML refuses a value outside 0..1 with E_INVALIDARG, and inside a frame
    /// callback that ends the process (2026-09-07: harbor-lights' beam at 0.45 + 0.55 * Loud on a loud bar, seven wall deaths).</summary>
    protected static void Op(UIElement e, double v) => e.Opacity = Clamp01(v);
    protected static double Osc(double t, double rate, double phase = 0) => 0.5 + 0.5 * Math.Sin(t * rate + phase);

    protected static LinearGradientBrush Vertical(params (Color c, double at)[] stops)
    {
        var br = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(0, 1) };
        foreach (var (c, at) in stops) br.GradientStops.Add(new GradientStop { Color = c, Offset = at });
        return br;
    }
    protected static RadialGradientBrush Radial(Color c, double innerA, double outerA = 0, double mid = 0.45, double midA = -1)
    {
        var br = new RadialGradientBrush();
        br.GradientStops.Add(new GradientStop { Color = A(c, innerA), Offset = 0 });
        br.GradientStops.Add(new GradientStop { Color = A(c, midA < 0 ? innerA * 0.6 : midA), Offset = mid });
        br.GradientStops.Add(new GradientStop { Color = A(c, outerA), Offset = 1 });
        return br;
    }

    // ---- shapes, each added to the canvas
    protected Rectangle R(double x, double y, double w, double h, Color c, double op = 1, double rad = 0)
    {
        var r = new Rectangle { Width = Math.Max(0.5, w), Height = Math.Max(0.5, h), Fill = B(c), Opacity = Clamp01(op), RadiusX = rad, RadiusY = rad };
        At(r, x, y); C.Children.Add(r); return r;
    }
    protected Rectangle RB(double x, double y, double w, double h, Brush fill, double op = 1)
    {
        var r = new Rectangle { Width = Math.Max(0.5, w), Height = Math.Max(0.5, h), Fill = fill, Opacity = Clamp01(op) };
        At(r, x, y); C.Children.Add(r); return r;
    }
    protected Ellipse E(double cx, double cy, double d, Color c, double op = 1)
    {
        var e = new Ellipse { Width = Math.Max(0.5, d), Height = Math.Max(0.5, d), Fill = B(c), Opacity = Clamp01(op) };
        At(e, cx - d / 2, cy - d / 2); C.Children.Add(e); return e;
    }
    /// <summary>A soft light: an ellipse filled with a radial falloff. Resize it with <see cref="Size"/>.</summary>
    protected Ellipse Glow(double cx, double cy, double d, Color c, double innerA, double op = 1)
    {
        var e = new Ellipse { Width = Math.Max(0.5, d), Height = Math.Max(0.5, d), Fill = Radial(c, innerA), Opacity = Clamp01(op) };
        At(e, cx - d / 2, cy - d / 2); C.Children.Add(e); return e;
    }
    protected static void Size(Ellipse e, double cx, double cy, double d) { d = Math.Max(0.5, d); e.Width = e.Height = d; At(e, cx - d / 2, cy - d / 2); }
    protected static void Size(Ellipse e, double cx, double cy, double w, double h) { e.Width = Math.Max(0.5, w); e.Height = Math.Max(0.5, h); At(e, cx - w / 2, cy - h / 2); }
    protected Line L(double x1, double y1, double x2, double y2, Color c, double thick, double op = 1)
    {
        var l = new Line { X1 = x1, Y1 = y1, X2 = x2, Y2 = y2, Stroke = B(c), StrokeThickness = Math.Max(0.5, thick), Opacity = Clamp01(op), StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round };
        C.Children.Add(l); return l;
    }
    protected Polyline PL(Brush stroke, double thick, double op = 1)
    {
        var p = new Polyline { Stroke = stroke, StrokeThickness = Math.Max(0.5, thick), Opacity = Clamp01(op), StrokeLineJoin = PenLineJoin.Round, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round };
        C.Children.Add(p); return p;
    }
    /// <summary>A polygon from absolute points (x0,y0,x1,y1,...).</summary>
    protected Polygon G(Color c, double op, params double[] xy) => GB(B(c), op, xy);
    protected Polygon GB(Brush fill, double op, params double[] xy)
    {
        var g = new Polygon { Fill = fill, Opacity = Clamp01(op) };
        for (var i = 0; i + 1 < xy.Length; i += 2) g.Points.Add(new Windows.Foundation.Point(xy[i], xy[i + 1]));
        C.Children.Add(g); return g;
    }
    protected static void Pts(Polygon g, params double[] xy)
    {
        g.Points.Clear();
        for (var i = 0; i + 1 < xy.Length; i += 2) g.Points.Add(new Windows.Foundation.Point(xy[i], xy[i + 1]));
    }
    /// <summary>A sky: a vertical gradient over a band of the tile.</summary>
    /// <summary>Night colours were chosen near black and read as mud on a wall: every sky stop is lifted toward a deep blue first (the "drab" fix, 2026-09-06).</summary>
    protected static readonly Color Lift = Color.FromArgb(255, 0x2A, 0x38, 0x62);
    protected Rectangle Sky(double y0, double y1, params (Color c, double at)[] stops) => RB(0, Y(y0), W, Y(y1) - Y(y0), Vertical(stops.Select(s => (s.c.A == 255 ? Mix(s.c, Lift, 0.35) : s.c, s.at)).ToArray()));
    /// <summary>A soft band of light along a horizon.</summary>
    protected Rectangle HorizonGlow(double y, double thickness, Color c, double a)
        => RB(0, Y(y) - S(thickness) / 2, W, S(thickness), Vertical((A(c, 0), 0), (A(c, a), 0.5), (A(c, 0), 1)));
    /// <summary>A jagged ridge polygon with a base at baseY; heights in tile fractions. Shaded top → bottom.</summary>
    protected Polygon Ridge(Color top, Color bottom, double baseY, double minH, double maxH, int steps, int seed, double jag = 0.5)
    {
        var rng = new Random(seed);
        var pts = new List<double> { 0, H };
        var prev = minH + rng.NextDouble() * (maxH - minH);
        for (var i = 0; i <= steps; i++)
        {
            var target = minH + rng.NextDouble() * (maxH - minH);
            var hgt = prev + (target - prev) * jag;
            prev = hgt;
            pts.Add(X(i / (double)steps)); pts.Add(Y(baseY) - S(hgt));
        }
        pts.Add(W); pts.Add(H);
        return GB(Vertical((top, 0), (bottom, 1)), 1, pts.ToArray());
    }
    /// <summary>Stars with a size spread; call <see cref="Twinkle"/> per frame.</summary>
    protected Ellipse[] Stars(int n, double maxY, Color c, int seed = 5)
    {
        var rng = new Random(seed);
        var s = new Ellipse[n];
        for (var i = 0; i < n; i++)
        {
            var big = rng.NextDouble() < 0.12;
            var d = S(big ? 0.006 + rng.NextDouble() * 0.004 : 0.002 + rng.NextDouble() * 0.003);
            s[i] = big ? Glow(X(rng.NextDouble()), Y(rng.NextDouble() * maxY), d * 2.5, c, 1) : E(X(rng.NextDouble()), Y(rng.NextDouble() * maxY), d, c, 0.5);
        }
        return s;
    }
    protected static void Twinkle(Ellipse[] stars, TableauFrame f, double baseOp = 0.45)
    {
        for (var i = 0; i < stars.Length; i++) Op(stars[i], Clamp01(baseOp + 0.35 * Math.Sin(f.T * (0.9 + i % 7 * 0.31) + i * 1.7) * (0.5 + f.High)));
    }
    /// <summary>The cinematic edge: dark at the corners, clear in the middle. Always last.</summary>
    protected Rectangle Vignette(double strength = 0.3)
    {
        var br = new RadialGradientBrush { RadiusX = 0.78, RadiusY = 0.85 };
        br.GradientStops.Add(new GradientStop { Color = A(Ink, 0), Offset = 0.45 });
        br.GradientStops.Add(new GradientStop { Color = A(Ink, strength), Offset = 1 });
        return RB(0, 0, W, H, br);
    }
    /// <summary>A pine: three stacked triangles, darker toward the base.</summary>
    protected void Pine(double x, double top, double wd, double hgt, Color c)
    {
        var y1 = top + hgt * 0.42; var y2 = top + hgt * 0.72; var y3 = top + hgt;
        G(c, 1, x, top, x + wd * 0.55, y1, x - wd * 0.55, y1);
        G(c, 1, x, top + hgt * 0.22, x + wd * 0.8, y2, x - wd * 0.8, y2);
        G(c, 1, x, top + hgt * 0.5, x + wd, y3, x - wd, y3);
    }
}

/// <summary>The registry the renderer and the pack validator consult.</summary>
public static class Tableaus
{
    public static readonly IReadOnlyList<string> Environment = new[] { "aurora-ridge", "ocean-moon", "forest-fireflies", "rain-window", "snow-village", "desert-stars", "storm-front", "sunrise-meadow" };
    public static readonly IReadOnlyList<string> Community = new[] { "campfire-circle", "city-skyline", "lantern-festival", "fireworks-night", "harbor-lights", "night-train", "street-fair", "stadium-wave" };
    public static IEnumerable<string> All => Environment.Concat(Community);
    public static bool Known(string? program) => program is not null && All.Contains(program);

    public static Tableau? Create(string program) => program switch
    {
        "aurora-ridge" => new AuroraRidge(),
        "ocean-moon" => new OceanMoon(),
        "forest-fireflies" => new ForestFireflies(),
        "rain-window" => new RainWindow(),
        "snow-village" => new SnowVillage(),
        "desert-stars" => new DesertStars(),
        "storm-front" => new StormFront(),
        "sunrise-meadow" => new SunriseMeadow(),
        "campfire-circle" => new CampfireCircle(),
        "city-skyline" => new CitySkyline(),
        "lantern-festival" => new LanternFestival(),
        "fireworks-night" => new FireworksNight(),
        "harbor-lights" => new HarborLights(),
        "night-train" => new NightTrain(),
        "street-fair" => new StreetFair(),
        "stadium-wave" => new StadiumWave(),
        _ => null,
    };
}

// =============================================================== ENVIRONMENT

/// <summary>Curtains of aurora over a mountain lake: three depths of ridge, the curtains breathe with the mids and mirror in the water, stars twinkle with the highs.</summary>
public sealed class AuroraRidge : Tableau
{
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private readonly List<Polygon> _curtains = new();
    private readonly List<Polygon> _mirror = new();
    private Rectangle _base = null!;
    private const int Curtains = 22;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x04, 0x07, 0x14), 0), (Color.FromArgb(255, 0x0A, 0x14, 0x2A), 0.55), (Color.FromArgb(255, 0x06, 0x0C, 0x1C), 0.72), (Color.FromArgb(255, 0x03, 0x06, 0x0E), 1));
        _stars = Stars(110, 0.6, White);
        _base = HorizonGlow(0.5, 0.3, P(0), 0.14);
        _curtains.Clear(); _mirror.Clear();
        for (var i = 0; i < Curtains; i++)
        {
            var c = P(i % 3 == 0 ? 1 : 0);
            _curtains.Add(GB(Vertical((A(c, 0.05), 0), (A(c, 0.5), 0.35), (A(c, 0.0), 1)), 0.7, 0, 0, 0, 0, 0, 0, 0, 0));
        }
        Ridge(Haze, Mix(Haze, Ink2, 0.6), 0.72, 0.12, 0.3, 18, 3, 0.7);
        Ridge(Ink2, Ink, 0.75, 0.05, 0.2, 14, 5, 0.6);
        // the lake: the curtains' mirror, dimmer and slower, beneath a near shore
        Sky(0.75, 1, (Color.FromArgb(255, 0x07, 0x10, 0x1E), 0), (Color.FromArgb(255, 0x03, 0x05, 0x0C), 1));
        for (var i = 0; i < Curtains; i++)
        {
            var c = P(i % 3 == 0 ? 1 : 0);
            _mirror.Add(GB(Vertical((A(c, 0.0), 0), (A(c, 0.22), 0.7), (A(c, 0.0), 1)), 0.5, 0, 0, 0, 0, 0, 0, 0, 0));
        }
        Ridge(Ink, Ink, 0.98, 0.01, 0.05, 22, 9, 0.8);
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        Twinkle(_stars, f);
        Op(_base, 0.5 + 0.5 * f.Mid);
        for (var i = 0; i < Curtains; i++)
        {
            var fx = (i + 0.5) / Curtains;
            var lvl = Lv(f, fx);
            var sway = Math.Sin(f.T * 0.45 * f.Speed + i * 0.6) * W * 0.02 + Math.Sin(f.T * 0.12 * f.Speed + i) * W * 0.015;
            var x = X(fx) + sway; var wd = W / Curtains * 0.7;
            var top = Y(0.05) + Osc(f.T * f.Speed, 0.3, i) * H * 0.06;
            var bottom = Y(0.34 + 0.22 * lvl + 0.12 * f.Mid);
            var g = _curtains[i];
            Pts(g, x - wd * 0.15, top, x + wd * 1.15, top + H * 0.02, x + wd * 0.85 + sway * 0.6, bottom, x + wd * 0.15 + sway * 0.6, bottom + H * 0.03);
            Op(g, 0.35 + 0.5 * lvl + 0.15 * f.Beat);
            var m = _mirror[i];
            var mtop = Y(0.76); var mbot = Y(0.76 + 0.14 + 0.1 * lvl);
            Pts(m, x + wd * 0.15 + sway * 0.4, mtop, x + wd * 0.85 + sway * 0.4, mtop, x + wd * 1.1, mbot, x - wd * 0.1, mbot);
            Op(m, 0.2 + 0.4 * lvl);
        }
    }
}

/// <summary>A moon over open water: a gradient sky, a two-layer halo that breathes with the loudness, a shimmering moon path, five swells rolling with the lows, a cloud drifting past.</summary>
public sealed class OceanMoon : Tableau
{
    private Ellipse _halo = null!, _halo2 = null!, _moon = null!;
    private readonly List<Rectangle> _path = new();
    private readonly List<Polyline> _waves = new();
    private readonly List<Ellipse> _cloud = new();
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    protected override void OnBuild()
    {
        Sky(0, 0.6, (Color.FromArgb(255, 0x03, 0x06, 0x12), 0), (Color.FromArgb(255, 0x0A, 0x14, 0x2C), 0.8), (Color.FromArgb(255, 0x14, 0x22, 0x3A), 1));
        _stars = Stars(80, 0.5, White);
        _halo2 = Glow(X(0.72), Y(0.22), S(0.9), P(0), 0.14);
        _halo = Glow(X(0.72), Y(0.22), S(0.36), P(3), 0.35);
        _moon = Glow(X(0.72), Y(0.22), S(0.15), P(3), 1, 1);
        _moon.Fill = Radial(P(3), 1, 0.95, 0.7, 1);
        E(X(0.75), Y(0.2), S(0.02), A(P(2), 0.15));     // a mare
        E(X(0.7), Y(0.25), S(0.025), A(P(2), 0.12));
        _cloud.Clear();
        for (var i = 0; i < 5; i++) _cloud.Add(Glow(0, 0, S(0.12 + i * 0.02), Haze, 0.55, 0.6));
        Ridge(Mix(Ink2, Haze, 0.3), Ink2, 0.6, 0.02, 0.07, 26, 11, 0.5);   // far islands
        Sky(0.6, 1, (Color.FromArgb(255, 0x0C, 0x22, 0x3A), 0), (Color.FromArgb(255, 0x06, 0x10, 0x1E), 0.4), (Color.FromArgb(255, 0x03, 0x06, 0x0E), 1));
        _path.Clear();
        for (var i = 0; i < 14; i++) _path.Add(RB(X(0.62), Y(0.6 + i * 0.028), W * 0.2, S(0.016), Vertical((A(P(0), 0), 0), (A(P(3), 0.5), 0.5), (A(P(0), 0), 1)), 0.3));
        _waves.Clear();
        for (var k = 0; k < 5; k++) _waves.Add(PL(B(A(k == 4 ? White : P(1 + k % 2), 0.2 + k * 0.1)), S(0.002 + k * 0.001), 0.8));
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        Twinkle(_stars, f, 0.35);
        Size(_halo2, X(0.72), Y(0.22), S(0.8 + 0.5 * f.Loud + 0.2 * f.Beat));
        Size(_halo, X(0.72), Y(0.22), S(0.32 + 0.2 * f.Low));
        Op(_halo2, 0.35 + 0.65 * f.Loud);
        var cx = X(0.3 + Osc(f.T * f.Speed, 0.02) * 0.5);
        for (var i = 0; i < _cloud.Count; i++) Size(_cloud[i], cx + (i - 2) * S(0.09), Y(0.3) + Math.Abs(i - 2) * S(0.02), S(0.14 + (2 - Math.Abs(i - 2)) * 0.04));
        for (var i = 0; i < _path.Count; i++)
        {
            var r = _path[i];
            var shimmer = Osc(f.T * f.Speed, 2.3 + i * 0.4, i * 1.9);
            Op(r, 0.08 + 0.35 * shimmer * (0.4 + f.Mid));
            var wd = W * (0.06 + i * 0.012); r.Width = wd; At(r, X(0.72) - wd / 2 + Math.Sin(f.T * 0.8 + i) * S(0.01), Y(0.61 + i * 0.027));
        }
        for (var k = 0; k < _waves.Count; k++)
        {
            var pl = _waves[k]; pl.Points.Clear();
            var baseY = Y(0.64 + k * 0.08);
            var amp = S(0.006 + 0.03 * f.Low) * (1 + k * 0.35);
            for (var i = 0; i <= 48; i++)
            {
                var x = X(i / 48.0);
                var y = baseY + Math.Sin(i * 0.42 + f.T * (0.7 + k * 0.15) * f.Speed) * amp + Math.Sin(i * 0.11 - f.T * 0.4 * f.Speed + k) * amp * 0.6;
                pl.Points.Add(new Windows.Foundation.Point(x, y));
            }
        }
    }
}

/// <summary>Fireflies between three depths of pines under a sliver of moon; each fly is a soft glow that flickers with the highs, mist lies on the ground, a warm glow breathes with the lows.</summary>
public sealed class ForestFireflies : Tableau
{
    private Ellipse _glow = null!;
    private Rectangle _mist = null!;
    private readonly List<(Ellipse dot, double x, double y, double ph, int band)> _flies = new();
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x04, 0x0A, 0x10), 0), (Color.FromArgb(255, 0x0A, 0x18, 0x18), 0.6), (Color.FromArgb(255, 0x06, 0x0E, 0x0C), 1));
        Stars(50, 0.4, White);
        Glow(X(0.15), Y(0.14), S(0.25), White, 0.25);
        E(X(0.15), Y(0.14), S(0.06), White, 0.85);
        E(X(0.17), Y(0.13), S(0.055), Color.FromArgb(255, 0x06, 0x0E, 0x14));   // the crescent
        var rng = new Random(21);
        // three depths, each lighter and smaller the farther back
        for (var d = 0; d < 3; d++)
        {
            var col = d == 0 ? Mix(Ink2, Haze, 0.35) : d == 1 ? Ink2 : Ink;
            var n = 10 + d * 4;
            for (var i = 0; i < n; i++)
            {
                var x = X(rng.NextDouble()); var hgt = S(0.28 + rng.NextDouble() * 0.22) * (0.6 + d * 0.3); var wd = S(0.05 + rng.NextDouble() * 0.03) * (0.6 + d * 0.3);
                Pine(x, Y(0.92) - hgt, wd, hgt, col);
            }
            if (d == 0) _mist = RB(0, Y(0.58), W, S(0.2), Vertical((A(Haze, 0), 0), (A(Haze, 0.35), 0.6), (A(Haze, 0), 1)), 0.6);
        }
        _glow = Glow(X(0.5), Y(1.0), W * 0.5, P(0), 0.3);
        R(0, Y(0.92), W, S(0.08), Ink);
        _flies.Clear();
        for (var i = 0; i < 60; i++) _flies.Add((Glow(0, 0, S(0.012 + rng.NextDouble() * 0.012), P(i % 2 == 0 ? 0 : 1), 1, 0.3), rng.NextDouble(), 0.3 + rng.NextDouble() * 0.6, rng.NextDouble() * 10, i % 4));
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        Size(_glow, X(0.5), Y(1.02), W * (0.45 + 0.3 * f.Low), S(0.35 + 0.2 * f.Low));
        Op(_glow, 0.3 + 0.5 * f.Low);
        Op(_mist, 0.35 + 0.3 * Osc(f.T * f.Speed, 0.2));
        for (var i = 0; i < _flies.Count; i++)
        {
            var fl = _flies[i];
            var x = fl.x + Math.Sin(f.T * 0.22 * f.Speed + fl.ph) * 0.03 + Math.Sin(f.T * 0.06 * f.Speed + i) * 0.02;
            var y = fl.y + Math.Cos(f.T * 0.27 * f.Speed + fl.ph * 1.3) * 0.03 + Math.Sin(f.T * 0.9 * f.Speed + i) * 0.004;
            var flick = Osc(f.T * f.Speed, 1.6 + fl.ph * 0.3, fl.ph * 7);
            var lvl = Lv(f, 0.6 + 0.4 * (fl.band / 4.0));
            Op(fl.dot, Clamp01(0.08 + 0.75 * flick * flick * (0.35 + lvl) + 0.3 * f.Beat));
            At(fl.dot, X(x) - fl.dot.Width / 2, Y(y) - fl.dot.Height / 2);
        }
    }
}

/// <summary>Rain on a night window: the city beyond is bokeh - soft discs that pulse with their bands - behind a wet pane where streaks run and gather; the rain falls harder as it gets louder.</summary>
public sealed class RainWindow : Tableau
{
    private readonly List<(Ellipse dot, int band, double ph)> _bokeh = new();
    private readonly List<(Line l, double x, double y, double len, double v)> _drops = new();
    private readonly List<(Ellipse bead, double x, double y, double v)> _beads = new();
    private const int Drops = 90;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x06, 0x08, 0x12), 0), (Color.FromArgb(255, 0x12, 0x14, 0x22), 0.7), (Color.FromArgb(255, 0x0A, 0x0C, 0x14), 1));
        var rng = new Random(31);
        _bokeh.Clear();
        for (var i = 0; i < 34; i++)
        {
            var band = i % Pal.Length; var d = S(0.05 + rng.NextDouble() * 0.12);
            _bokeh.Add((Glow(X(rng.NextDouble()), Y(0.25 + rng.NextDouble() * 0.5), d, P(band), 0.8, 0.4), band, rng.NextDouble() * 6));
        }
        Ridge(Mix(Ink2, Haze, 0.4), Ink2, 0.9, 0.02, 0.22, 30, 7, 0.9);
        // the pane: a faint sheen and the frame's crossbars
        RB(0, 0, W, H, Vertical((A(P(1), 0.05), 0), (A(P(1), 0.0), 0.5), (A(P(2), 0.05), 1)));
        R(X(0.5) - S(0.006), 0, S(0.012), H, Ink, 0.85);
        R(0, Y(0.5) - S(0.006), W, S(0.012), Ink, 0.85);
        _drops.Clear();
        for (var i = 0; i < Drops; i++)
        {
            var len = S(0.03 + rng.NextDouble() * 0.06);
            var l = new Line { Stroke = Vertical((A(White, 0), 0), (A(White, 0.5), 1)), StrokeThickness = S(0.002 + rng.NextDouble() * 0.002), Opacity = 0.4, StrokeEndLineCap = PenLineCap.Round };
            C.Children.Add(l);
            _drops.Add((l, rng.NextDouble(), rng.NextDouble(), len, 0.3 + rng.NextDouble() * 0.5));
        }
        _beads.Clear();
        for (var i = 0; i < 40; i++) _beads.Add((E(0, 0, S(0.004 + rng.NextDouble() * 0.006), A(White, 0.5), 0.5), rng.NextDouble(), rng.NextDouble(), 0.02 + rng.NextDouble() * 0.04));
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        for (var i = 0; i < _bokeh.Count; i++)
        {
            var (dot, band, ph) = _bokeh[i];
            var lvl = Lv(f, (band + 0.5) / Pal.Length);
            Op(dot, 0.15 + 0.55 * lvl + 0.2 * f.Beat * Osc(f.T, 3, ph));
        }
        var speed = (0.25 + 0.9 * f.Loud) * f.Speed;
        for (var i = 0; i < _drops.Count; i++)
        {
            var d = _drops[i];
            var y = d.y + d.v * speed * f.Dt;
            if (y > 1.05) { y = -0.05; d.x = Rng.NextDouble(); }
            _drops[i] = (d.l, d.x, y, d.len, d.v);
            var x = X(d.x) + Math.Sin(y * 20 + i) * S(0.003);
            d.l.X1 = x; d.l.Y1 = Y(y); d.l.X2 = x + S(0.002); d.l.Y2 = Y(y) + d.len;
            Op(d.l, 0.2 + 0.4 * f.Loud);
        }
        for (var i = 0; i < _beads.Count; i++)
        {
            var b = _beads[i];
            var y = b.y + b.v * f.Speed * f.Dt * (0.3 + f.Loud);
            if (y > 1.02) { y = -0.02; b.x = Rng.NextDouble(); }
            _beads[i] = (b.bead, b.x, y, b.v);
            At(b.bead, X(b.x), Y(y));
        }
    }
}

/// <summary>Snow settling over a village: hills behind, chimneys breathing smoke, every window a warm glow lit by its band, flakes of three sizes drifting with the mids.</summary>
public sealed class SnowVillage : Tableau
{
    private readonly List<(Ellipse win, int band)> _windows = new();
    private readonly List<(Ellipse fl, double x, double y, double v, double ph, double d)> _flakes = new();
    private readonly List<(Ellipse puff, double x, double born, bool live)> _smoke = new();
    private readonly List<double> _chimneys = new();
    private Ellipse _moon = null!;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x08, 0x0C, 0x1C), 0), (Color.FromArgb(255, 0x1E, 0x26, 0x40), 0.75), (Color.FromArgb(255, 0x2A, 0x30, 0x48), 1));
        Stars(50, 0.45, White);
        Glow(X(0.82), Y(0.16), S(0.45), White, 0.22);
        _moon = E(X(0.82), Y(0.16), S(0.1), White, 0.92);
        Ridge(Mix(Haze, White, 0.2), Haze, 0.78, 0.06, 0.2, 12, 41, 0.6);     // snowy hills, far
        var rng = new Random(43);
        _windows.Clear(); _chimneys.Clear();
        double x = W * 0.02;
        var k = 0;
        while (x < W * 0.96)
        {
            var hw = S(0.14 + rng.NextDouble() * 0.12); var hh = S(0.16 + rng.NextDouble() * 0.12); var top = Y(0.88) - hh;
            var body = rng.NextDouble() < 0.5 ? Ink2 : Ink3;
            R(x, top, hw, hh, body);
            G(Ink, 1, x - hw * 0.06, top, x + hw / 2, top - hh * 0.55, x + hw * 1.06, top);                              // roof
            G(White, 0.9, x - hw * 0.05, top + hh * 0.02, x + hw / 2, top - hh * 0.5, x + hw * 1.05, top + hh * 0.02, x + hw / 2, top - hh * 0.36);   // snow on the roof
            var cx = x + hw * 0.72; R(cx - hw * 0.05, top - hh * 0.32, hw * 0.1, hh * 0.3, Ink); R(cx - hw * 0.06, top - hh * 0.34, hw * 0.12, hh * 0.04, White, 0.9);
            _chimneys.Add(cx);
            var cols = 1 + (int)(hw / S(0.1));
            for (var c = 0; c < cols; c++)
            {
                var wx = x + hw * (c + 0.5) / cols; var wy = top + hh * 0.5;
                R(wx - hw * 0.07, wy - hh * 0.12, hw * 0.14, hh * 0.24, Ink, 1, 2);
                _windows.Add((Glow(wx, wy, S(0.09), P(k % Pal.Length), 0.9, 0.5), k % Pal.Length)); k++;
            }
            R(x + hw * 0.42, top + hh * 0.62, hw * 0.16, hh * 0.38, Ink);   // the door
            x += hw + S(0.03 + rng.NextDouble() * 0.06);
        }
        // pines between the houses and the near snow
        for (var i = 0; i < 9; i++) Pine(X(0.02 + i * 0.12 + rng.NextDouble() * 0.05), Y(0.88) - S(0.12), S(0.03), S(0.12), Ink2);
        RB(0, Y(0.87), W, S(0.13), Vertical((Color.FromArgb(255, 0xD8, 0xDC, 0xE8), 0), (Color.FromArgb(255, 0x9A, 0xA6, 0xC0), 1)));
        _smoke.Clear();
        for (var i = 0; i < 24; i++) _smoke.Add((Glow(0, 0, S(0.03), White, 0.5, 0), 0, 0, false));
        _flakes.Clear();
        for (var i = 0; i < 140; i++)
        {
            var d = S(0.003 + rng.NextDouble() * 0.009);
            _flakes.Add((d > S(0.008) ? Glow(0, 0, d * 1.6, White, 1, 0.8) : E(0, 0, d, White, 0.7), rng.NextDouble(), rng.NextDouble(), 0.02 + rng.NextDouble() * 0.05, rng.NextDouble() * 10, d));
        }
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        for (var i = 0; i < _windows.Count; i++) Op(_windows[i].win, 0.3 + 0.65 * Lv(f, (i % 7) / 7.0) + 0.1 * f.Beat);
        if (Rng.NextDouble() < 0.08 * f.Speed && _chimneys.Count > 0)
        {
            for (var i = 0; i < _smoke.Count; i++)
                if (!_smoke[i].live) { _smoke[i] = (_smoke[i].puff, _chimneys[Rng.Next(_chimneys.Count)], f.T, true); break; }
        }
        for (var i = 0; i < _smoke.Count; i++)
        {
            var s = _smoke[i];
            if (!s.live) continue;
            var age = (f.T - s.born) / 5.0;
            if (age >= 1) { Op(s.puff, 0); _smoke[i] = (s.puff, s.x, s.born, false); continue; }
            Size(s.puff, s.x + Math.Sin(age * 6 + i) * S(0.02) + age * S(0.06), Y(0.62) - age * S(0.22), S(0.02 + age * 0.08));
            Op(s.puff, (1 - age) * 0.35);
        }
        for (var i = 0; i < _flakes.Count; i++)
        {
            var s = _flakes[i];
            var y = s.y + s.v * f.Speed * f.Dt * (0.6 + f.Loud);
            if (y > 1.02) { y = -0.02; s.x = Rng.NextDouble(); }
            _flakes[i] = (s.fl, s.x, y, s.v, s.ph, s.d);
            var x = s.x + Math.Sin(f.T * 0.5 * f.Speed + s.ph) * (0.01 + 0.02 * f.Mid);
            At(s.fl, X(x) - s.fl.Width / 2, Y(y) - s.fl.Height / 2);
        }
    }
}

/// <summary>Dunes under the Milky Way: a broad band of stars, shaded dunes in three depths, a couple of cacti, a moon, and shooting stars with tails that launch on the beat.</summary>
public sealed class DesertStars : Tableau
{
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private readonly List<(Line l, Ellipse head, double x, double y, double born, bool live)> _shots = new();
    private Ellipse _moon = null!, _way = null!;
    private double _lastIdle;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x03, 0x05, 0x12), 0), (Color.FromArgb(255, 0x10, 0x0E, 0x24), 0.6), (Color.FromArgb(255, 0x2A, 0x1A, 0x22), 0.75), (Color.FromArgb(255, 0x12, 0x0A, 0x0C), 1));
        _way = Glow(X(0.55), Y(0.3), W * 0.9, Mix(White, P(2), 0.4), 0.16, 0.9);
        _way.Height = S(0.35); _way.RenderTransform = new RotateTransform { Angle = -18, CenterX = W * 0.45, CenterY = S(0.175) };
        _stars = Stars(220, 0.72, White, 51);
        Glow(X(0.18), Y(0.55), S(0.5), P(0), 0.25);
        _moon = E(X(0.18), Y(0.55), S(0.14), P(0), 0.9);
        Ridge(Color.FromArgb(255, 0x4A, 0x32, 0x2A), Color.FromArgb(255, 0x2A, 0x1C, 0x18), 0.82, 0.04, 0.16, 6, 53, 0.9);
        Ridge(Color.FromArgb(255, 0x3A, 0x26, 0x1E), Color.FromArgb(255, 0x1C, 0x12, 0x0E), 0.9, 0.02, 0.12, 5, 55, 0.95);
        // two cacti on the near dune
        foreach (var (fx, hf) in new[] { (0.72, 0.16), (0.3, 0.1) })
        {
            var x = X(fx); var top = Y(0.9) - S(hf); var wd = S(0.02);
            R(x - wd / 2, top, wd, S(hf) + S(0.02), Ink, 1, wd / 2);
            R(x - wd * 2.2, top + S(hf) * 0.35, wd * 0.8, S(hf) * 0.3, Ink, 1, wd / 2); R(x - wd * 2.2, top + S(hf) * 0.35, wd * 2.2, wd * 0.8, Ink);
            R(x + wd * 1.4, top + S(hf) * 0.2, wd * 0.8, S(hf) * 0.35, Ink, 1, wd / 2); R(x + wd * 0.5, top + S(hf) * 0.5, wd * 1.6, wd * 0.8, Ink);
        }
        Ridge(Color.FromArgb(255, 0x16, 0x0E, 0x0A), Ink, 0.98, 0.01, 0.06, 8, 57, 0.9);
        _shots.Clear();
        for (var i = 0; i < 6; i++)
        {
            var l = new Line { Stroke = Vertical((A(White, 0), 0), (A(White, 0.9), 1)), StrokeThickness = S(0.003), Opacity = 0 };
            C.Children.Add(l);
            _shots.Add((l, Glow(0, 0, S(0.02), White, 1, 0), 0, 0, -10, false));
        }
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        Twinkle(_stars, f, 0.5);
        Op(_way, 0.6 + 0.4 * f.High);
        Op(_moon, 0.7 + 0.3 * f.Low);
        var idleLaunch = f.T - _lastIdle > 5 + Rng.NextDouble() * 4;   // a quiet sky still gets the odd shooting star
        if (f.Beat > 0.05 || idleLaunch)
        {
            _lastIdle = f.T;
            for (var i = 0; i < _shots.Count; i++)
                if (!_shots[i].live) { _shots[i] = (_shots[i].l, _shots[i].head, 0.1 + Rng.NextDouble() * 0.7, 0.05 + Rng.NextDouble() * 0.35, f.T, true); break; }
        }
        for (var i = 0; i < _shots.Count; i++)
        {
            var s = _shots[i];
            if (!s.live) continue;
            var age = (f.T - s.born) / 1.1;
            if (age >= 1) { Op(s.l, 0); Op(s.head, 0); _shots[i] = (s.l, s.head, s.x, s.y, s.born, false); continue; }
            var x = X(s.x) + age * W * 0.22; var y = Y(s.y) + age * H * 0.1;
            var tail = S(0.08) * (1 - age * 0.5);
            s.l.X1 = x - tail * 2.2; s.l.Y1 = y - tail; s.l.X2 = x; s.l.Y2 = y;
            Op(s.l, (1 - age) * 0.9); Size(s.head, x, y, S(0.014 + 0.01 * (1 - age))); Op(s.head, (1 - age));
        }
    }
}

/// <summary>A storm on the plain: banks of soft cloud lit from within, driving rain, a farmhouse with one lit window, a bolt and a flash on a strong beat, the wet ground catching it all.</summary>
public sealed class StormFront : Tableau
{
    private Rectangle _flash = null!, _wet = null!;
    private readonly List<Ellipse> _clouds = new();
    private readonly List<(Line l, double x, double y, double v)> _rain = new();
    private Polyline _bolt = null!;
    private Ellipse _window = null!;
    private double _flashLevel;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x06, 0x08, 0x12), 0), (Color.FromArgb(255, 0x18, 0x1C, 0x2A), 0.55), (Color.FromArgb(255, 0x10, 0x12, 0x1C), 1));
        var rng = new Random(61);
        _clouds.Clear();
        for (var i = 0; i < 26; i++) _clouds.Add(Glow(X(rng.NextDouble() * 1.1 - 0.05), Y(0.05 + rng.NextDouble() * 0.32), S(0.3 + rng.NextDouble() * 0.35), i % 3 == 0 ? P(2) : Haze, 0.55, 0.5));
        Ridge(Mix(Ink2, Haze, 0.3), Ink2, 0.82, 0.01, 0.06, 20, 63, 0.6);
        // the farmhouse and its barn, far off to the right, one window lit
        var fx = X(0.78); var fy = Y(0.8);
        R(fx, fy - S(0.09), S(0.16), S(0.09), Ink); G(Ink, 1, fx - S(0.01), fy - S(0.09), fx + S(0.08), fy - S(0.15), fx + S(0.17), fy - S(0.09));
        R(fx + S(0.2), fy - S(0.11), S(0.12), S(0.11), Ink); G(Ink, 1, fx + S(0.19), fy - S(0.11), fx + S(0.26), fy - S(0.16), fx + S(0.33), fy - S(0.11));
        _window = Glow(fx + S(0.06), fy - S(0.045), S(0.05), P(3), 1, 0.9);
        R(fx + S(0.045), fy - S(0.06), S(0.03), S(0.03), P(3), 0.9);
        _wet = RB(0, Y(0.82), W, S(0.18), Vertical((A(Haze, 0.35), 0), (A(Ink, 1), 1)));
        _bolt = PL(B(White), S(0.004), 0);
        _rain.Clear();
        for (var i = 0; i < 170; i++)
        {
            var l = new Line { Stroke = Vertical((A(White, 0), 0), (A(White, 0.45), 1)), StrokeThickness = S(0.0015), Opacity = 0.3 };
            C.Children.Add(l);
            _rain.Add((l, rng.NextDouble(), rng.NextDouble(), 0.5 + rng.NextDouble() * 0.6));
        }
        _flash = R(0, 0, W, H, White, 0);
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        for (var i = 0; i < _clouds.Count; i++)
        {
            var c = _clouds[i];
            Op(c, 0.3 + 0.4 * Lv(f, i / 26.0) + 0.5 * _flashLevel);
            At(c, Canvas.GetLeft(c) - f.Dt * f.Speed * S(0.01) * (1 + i % 3), Canvas.GetTop(c));
            if (Canvas.GetLeft(c) < -c.Width) At(c, W, Canvas.GetTop(c));
        }
        Op(_window, 0.5 + 0.5 * f.Low);
        var fall = (0.6 + 1.2 * f.Loud) * f.Speed;
        for (var i = 0; i < _rain.Count; i++)
        {
            var r = _rain[i];
            var y = r.y + r.v * fall * f.Dt;
            if (y > 1.05) { y = -0.05; r.x = Rng.NextDouble(); }
            _rain[i] = (r.l, r.x, y, r.v);
            var x = X(r.x) - y * W * 0.05;
            r.l.X1 = x + S(0.004); r.l.Y1 = Y(y); r.l.X2 = x; r.l.Y2 = Y(y) + S(0.06);
            Op(r.l, 0.15 + 0.35 * f.Loud);
        }
        if (f.Beat > 0.18 && !f.Reduced)
        {
            _flashLevel = Math.Max(_flashLevel, 0.4 + 0.4 * Math.Min(1, f.Beat));
            _bolt.Points.Clear();
            var x = X(0.15 + Rng.NextDouble() * 0.6); var y = Y(0.1);
            _bolt.Points.Add(new Windows.Foundation.Point(x, y));
            for (var k = 0; k < 7; k++) { x += (Rng.NextDouble() - 0.5) * S(0.12); y += S(0.1); _bolt.Points.Add(new Windows.Foundation.Point(x, y)); }
            Op(_bolt, 1);
        }
        _flashLevel *= 0.78;
        Op(_flash, _flashLevel * 0.7);
        _bolt.Opacity *= 0.7;
        Op(_wet, 0.7 + 0.3 * _flashLevel);
    }
}

/// <summary>A sun rising with the loudness over a meadow: night cross-fades to dawn as it climbs, a big corona and turning rays, two lines of hills, tall grass swaying with the mids, flowers waking up.</summary>
public sealed class SunriseMeadow : Tableau
{
    private Ellipse _sun = null!, _corona = null!, _corona2 = null!;
    private Rectangle _dawn = null!;
    private readonly List<Polygon> _rays = new();
    private readonly List<(Polyline blade, double x, double h, double ph)> _grass = new();
    private readonly List<(Ellipse fl, double x, double y)> _flowers = new();
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private double _rise;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x08, 0x0A, 0x1E), 0), (Color.FromArgb(255, 0x1A, 0x14, 0x30), 0.6), (Color.FromArgb(255, 0x2A, 0x1C, 0x2C), 1));
        _stars = Stars(60, 0.5, White);
        _dawn = Sky(0, 0.78, (A(P(2), 0.15), 0), (A(P(1), 0.6), 0.5), (A(P(0), 0.95), 1));
        _rays.Clear();
        for (var i = 0; i < 18; i++) _rays.Add(GB(Vertical((A(P(2), 0.35), 0), (A(P(2), 0), 1)), 0.3, 0, 0, 0, 0, 0, 0));
        _corona2 = Glow(X(0.5), Y(0.75), S(1.4), P(0), 0.25);
        _corona = Glow(X(0.5), Y(0.75), S(0.6), P(2), 0.5);
        _sun = Glow(X(0.5), Y(0.75), S(0.22), P(2), 1, 1);
        _sun.Fill = Radial(Mix(P(2), White, 0.5), 1, 1, 0.7, 1);
        Ridge(Mix(Ink2, P(1), 0.15), Ink2, 0.74, 0.01, 0.07, 10, 71, 0.6);
        Ridge(Color.FromArgb(255, 0x12, 0x22, 0x16), Color.FromArgb(255, 0x0A, 0x14, 0x0E), 0.8, 0.0, 0.04, 8, 73, 0.6);
        RB(0, Y(0.8), W, S(0.2), Vertical((Color.FromArgb(255, 0x10, 0x1E, 0x12), 0), (Color.FromArgb(255, 0x08, 0x10, 0x0A), 1)));
        _grass.Clear();
        var rng = new Random(75);
        for (var i = 0; i < 140; i++)
        {
            var pl = PL(B(Mix(Color.FromArgb(255, 0x1E, 0x38, 0x22), Color.FromArgb(255, 0x3A, 0x5C, 0x30), rng.NextDouble())), S(0.002 + rng.NextDouble() * 0.003));
            _grass.Add((pl, rng.NextDouble(), 0.06 + rng.NextDouble() * 0.16, rng.NextDouble() * 6));
        }
        _flowers.Clear();
        for (var i = 0; i < 24; i++) _flowers.Add((Glow(0, 0, S(0.02), P(i % 2 == 0 ? 3 : 0), 1, 0.2), rng.NextDouble(), 0.84 + rng.NextDouble() * 0.14));
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        _rise += ((0.3 + 0.7 * f.Loud) - _rise) * 0.025;   // never a sun below the hills: a resting dawn, a full one on a loud mix
        var cy = Y(0.8 - 0.36 * _rise);
        Size(_sun, X(0.5), cy, S(0.2 + 0.06 * f.Low));
        Size(_corona, X(0.5), cy, S(0.5 + 0.3 * f.Loud + 0.15 * f.Beat));
        Size(_corona2, X(0.5), cy, S(1.2 + 0.6 * f.Loud));
        Op(_corona, 0.5 + 0.5 * f.Loud); Op(_corona2, 0.3 + 0.6 * _rise);
        Op(_dawn, 0.45 + 0.55 * _rise);
        for (var i = 0; i < _stars.Length; i++) Op(_stars[i], (1 - _rise) * (0.3 + 0.3 * Osc(f.T, 1.1, i)));
        for (var i = 0; i < _rays.Count; i++)
        {
            var a = f.T * 0.06 * f.Speed + i * Math.PI * 2 / _rays.Count;
            var len = S(0.5 + 0.5 * Lv(f, i / (double)_rays.Count)); var half = 0.045;
            Pts(_rays[i], X(0.5), cy, X(0.5) + Math.Cos(a - half) * len, cy + Math.Sin(a - half) * len, X(0.5) + Math.Cos(a + half) * len, cy + Math.Sin(a + half) * len);
            Op(_rays[i], 0.15 + 0.4 * Lv(f, i / (double)_rays.Count) * _rise);
        }
        for (var i = 0; i < _grass.Count; i++)
        {
            var g = _grass[i]; g.blade.Points.Clear();
            var baseX = X(g.x); var top = Y(1 - g.h);
            var lean = Math.Sin(f.T * 1.1 * f.Speed + g.ph) * S(0.01 + 0.035 * f.Mid) + S(0.01);
            g.blade.Points.Add(new Windows.Foundation.Point(baseX, H));
            g.blade.Points.Add(new Windows.Foundation.Point(baseX + lean * 0.35, (H + top) / 2));
            g.blade.Points.Add(new Windows.Foundation.Point(baseX + lean, top));
        }
        for (var i = 0; i < _flowers.Count; i++)
        {
            var (fl, x, y) = _flowers[i];
            Size(fl, X(x) + Math.Sin(f.T * 1.1 * f.Speed + i) * S(0.006), Y(y), S(0.012 + 0.02 * _rise));
            Op(fl, 0.2 + 0.8 * _rise);
        }
    }
}
