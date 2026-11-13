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
/// whose lights and movement answer the music (the maintainer's ask, 2026-09-06). Every shape is created
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
    /// <summary>A stage scene (Tableaus.Stage.cs) is told each frame the square a cover in the middle takes (side 0: none) and whether it
    /// stands on its own ground (no cover behind it); a painted scene ignores both.</summary>
    public double FocalSide, FocalCx, FocalCy;
    public bool Ground = true;

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
    /// <summary>Dev: parts of a scene that are not moved this frame, to find the one that costs the most (a line of names in the
    /// diagnostics folder's viz-skip.txt, read once a second by the host).</summary>
    public static string DevSkip = "";
    protected static bool Skip(string part) => DevSkip.Length > 0 && DevSkip.Contains(part);
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
    /// <summary>The Seasons visual (Tableaus.Town.cs): one scene that follows the calendar and the settings.</summary>
    public static readonly IReadOnlyList<string> Seasonal = new[] { "seasons" };
    public static IEnumerable<string> All => Environment.Concat(Community).Concat(Seasonal);
    /// <summary>The four originals (Tableaus.Stage.cs): drawn by the same engine, but they paint no sky, so a cover shows behind or in front of them.</summary>
    public static readonly IReadOnlyList<string> Stage = new[] { "beams", "bars", "ribbon", "particles" };
    /// <summary>A scene that paints the stage edge to edge (the environment and community families).</summary>
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
        "seasons" => new SeasonsTown(),
        "beams" => new BeamsStage(),
        "bars" => new SpectrumStage(),
        "ribbon" => new RibbonStage(),
        "particles" => new BloomStage(),
        _ => null,
    };
}

// =============================================================== ENVIRONMENT

// Aurora Ridge is in Tableaus.Aurora.cs.

// Moonlit Ocean is in Tableaus.Ocean.cs.

// Firefly Forest is in Tableaus.Fireflies.cs.

// Rain on the Window is in Tableaus.Rain.cs.

// Snowfall Village is in Tableaus.Snow.cs.

// Desert Stars is in Tableaus.Desert.cs.

// Storm Front is in Tableaus.Storm.cs.

// Sunrise Meadow is in Tableaus.Sunrise.cs.
