using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== COMMUNITY: Lantern Festival (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>Smooth outlines for the scenes that draw people and soft shapes.</summary>
internal static class TableauCurve
{
    /// <summary>A closed smooth outline through the given points (Catmull-Rom), as polygon points.</summary>
    public static double[] Closed(double[] p, int sub = 5)
    {
        var n = p.Length / 2; var o = new double[n * sub * 2]; var k = 0;
        for (var i = 0; i < n; i++)
        {
            int i0 = (i - 1 + n) % n, i2 = (i + 1) % n, i3 = (i + 2) % n;
            for (var s = 0; s < sub; s++)
            {
                var t = s / (double)sub; double t2 = t * t, t3 = t2 * t;
                for (var c = 0; c < 2; c++)
                {
                    double a = p[i0 * 2 + c], b = p[i * 2 + c], d = p[i2 * 2 + c], e = p[i3 * 2 + c];
                    o[k++] = 0.5 * (2 * b + (d - a) * t + (2 * a - 5 * b + 4 * d - e) * t2 + (3 * b - a - 3 * d + e) * t3);
                }
            }
        }
        return o;
    }
}

/// <summary>
/// A lantern festival on a lake shore (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The lanterns are the instrument: paper sky lanterns in three depths, each with a band of its own. A lantern's light swells with its
/// band; all of them climb faster as the music gets louder; a beat lets a new handful go from the crowd on the shore and lifts every
/// light for a moment. The lake gives the sky back: each lantern has its light on the water, floating lanterns drift there, the far
/// shore is a row of stalls and a bridge hung with lights. Two garlands of paper lanterns cross the top, one lantern a band, low notes
/// to high. The crowd along the bottom is seen from behind, lit along its edges by what it has let go.
///
/// Every shape is made once in OnBuild. A lantern is one group moved by one transform, so a frame allocates nothing.
/// </summary>
public sealed class LanternFestival : Tableau
{
    private sealed class Lantern
    {
        public Canvas G = null!;
        public CompositeTransform T = null!;
        public Ellipse Halo = null!, Inner = null!;
        public Ellipse? Refl;
        public double X0, Y, Vy, Ph, Rate, D, Band, Start, Sway, Since, Wait;
        public bool Waiting;
    }
    private readonly List<Lantern> _lanterns = new();
    private readonly List<(Ellipse halo, Ellipse body, double band)> _garland = new();
    private readonly List<(RotateTransform rt, double ph, double amp)> _swings = new();
    private readonly List<(Canvas rim, double w)> _rims = new();
    private readonly List<(Ellipse light, Rectangle refl, double band, double ph)> _stalls = new();
    private readonly List<(TranslateTransform t, Ellipse glow, double x, double y, double v, double ph, double band)> _floats = new();
    private readonly List<(Rectangle r, double x, double y, double w, double v)> _ripples = new();
    private readonly List<(Ellipse halo, Ellipse inner, TranslateTransform t, double ph)> _held = new();
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private Rectangle _horizon = null!, _lakeGlow = null!;
    private double _wy, _flare, _prevBeat, _sinceBeat = 9, _wind, _windPh, _sway, _rip;
    private int _release;

    private static readonly Color Deep = Color.FromArgb(255, 0x7A, 0x28, 0x10);
    private static readonly Color Dark = Color.FromArgb(255, 0x0D, 0x0A, 0x14);
    private static double[] Curve(params double[] p) => TableauCurve.Closed(p);

    /// <summary>A sky lantern, built about its own centre and moved by its transform: halo, paper body, the light inside, the rim, the flame.</summary>
    private Lantern Make(double d, Color c, bool detail)
    {
        var l = new Lantern { D = d };
        var g = new Canvas(); C.Children.Add(g); var root = C; C = g;
        l.G = g; l.T = new CompositeTransform(); g.RenderTransform = l.T;
        l.Halo = Glow(0, 0, d * 3.6, Mix(c, P(1), 0.3), 0.5, 0.4);
        var pts = Curve(-0.36, -0.42, -0.2, -0.5, 0.2, -0.5, 0.36, -0.42, 0.40, -0.1, 0.33, 0.3, 0.26, 0.5, -0.26, 0.5, -0.33, 0.3, -0.40, -0.1);
        for (var i = 0; i < pts.Length; i++) pts[i] *= d;
        GB(Vertical((Mix(c, Deep, 0.45), 0), (c, 0.4), (Mix(c, White, 0.5), 1)), 0.96, pts);
        if (detail)
        {
            L(-0.14 * d, -0.47 * d, -0.1 * d, 0.48 * d, Mix(c, Deep, 0.6), Math.Max(1, d * 0.012), 0.35);
            L(0.14 * d, -0.47 * d, 0.1 * d, 0.48 * d, Mix(c, Deep, 0.6), Math.Max(1, d * 0.012), 0.35);
        }
        l.Inner = Glow(0, d * 0.16, d * 0.95, Mix(c, White, 0.75), 0.95, 0.6);
        if (detail)
        {
            L(-0.23 * d, 0.5 * d, 0.23 * d, 0.5 * d, Mix(Deep, Dark, 0.4), Math.Max(1, d * 0.05));
            Glow(0, 0.43 * d, d * 0.34, Color.FromArgb(255, 0xFF, 0xF6, 0xDC), 1, 0.95);
        }
        C = root;
        return l;
    }

    /// <summary>Someone in the crowd, seen from behind: shoulders, head and hair, sometimes arms up. The rim is the light of the lanterns on them.</summary>
    private void Person(double x, double baseY, double s, int hair, int arms, double ph, Random r)
    {
        var g = new Canvas(); C.Children.Add(g); var root = C; C = g;
        var rt = new RotateTransform { CenterX = x, CenterY = baseY }; g.RenderTransform = rt; _swings.Add((rt, ph, 1.1 + r.NextDouble()));
        var rimC = Mix(P(1), P(2), 0.5); var off = s * 0.022;
        double[] Map(double dy, params double[] p) { var o = Curve(p); for (var i = 0; i + 1 < o.Length; i += 2) { o[i] = x + o[i] * s; o[i + 1] = baseY + o[i + 1] * s + dy; } return o; }
        var shapes = new List<double[]>
        {
            new[] { -0.36, 0.3, -0.37, -0.2, -0.30, -0.46, -0.12, -0.56, 0.12, -0.56, 0.30, -0.46, 0.37, -0.2, 0.36, 0.3 },                 // shoulders and back
            new[] { 0.0, -0.93, 0.10, -0.89, 0.13, -0.77, 0.10, -0.64, 0.0, -0.58, -0.10, -0.64, -0.13, -0.77, -0.10, -0.89 },            // the head
        };
        if (hair == 1) shapes.Add(new[] { -0.14, -0.8, -0.1, -0.93, 0.0, -0.96, 0.1, -0.93, 0.14, -0.8, 0.16, -0.5, 0.1, -0.36, -0.1, -0.36, -0.16, -0.5 });   // long hair
        if (hair == 2) shapes.Add(new[] { 0.0, -1.06, 0.07, -1.02, 0.07, -0.93, 0.0, -0.9, -0.07, -0.93, -0.07, -1.02 });                    // a bun
        if (hair == 3) { shapes.Add(new[] { -0.12, -0.84, -0.21, -0.82, -0.24, -0.66, -0.17, -0.66 }); shapes.Add(new[] { 0.12, -0.84, 0.21, -0.82, 0.24, -0.66, 0.17, -0.66 }); }   // pigtails
        if (hair == 4) { shapes.Add(new[] { -0.135, -0.8, -0.12, -0.92, 0.0, -0.97, 0.12, -0.92, 0.135, -0.8, 0.0, -0.84 }); shapes.Add(new[] { 0.0, -1.04, 0.045, -1.0, 0.0, -0.96, -0.045, -1.0 }); }   // a hat with a bobble
        var limbs = new List<(double x1, double y1, double x2, double y2, double th)> { (0, -0.52, 0, -0.62, 0.11) };
        if (arms != 0)
            foreach (var sd in arms == 2 ? new[] { -1.0, 1.0 } : new[] { arms > 0 ? 1.0 : -1.0 })
            {
                limbs.Add((sd * 0.30, -0.44, sd * 0.37, -0.80, 0.105)); limbs.Add((sd * 0.37, -0.80, sd * 0.35, -1.14, 0.085));
                shapes.Add(new[] { sd * 0.35 - 0.045, -1.17, sd * 0.35, -1.22, sd * 0.35 + 0.045, -1.17, sd * 0.35, -1.12 });
            }
        // the rim first, a little higher than the body it belongs to; then the body
        var rim = new Canvas(); C.Children.Add(rim); var body = C; C = rim;
        foreach (var sh in shapes) G(rimC, 1, Map(-off, sh));
        foreach (var (x1, y1, x2, y2, th) in limbs) L(x + x1 * s, baseY + y1 * s - off, x + x2 * s, baseY + y2 * s - off, rimC, th * s);
        C = body; _rims.Add((rim, 0.6 + 0.4 * r.NextDouble()));
        foreach (var sh in shapes) G(Dark, 1, Map(0, sh));
        foreach (var (x1, y1, x2, y2, th) in limbs) L(x + x1 * s, baseY + y1 * s, x + x2 * s, baseY + y2 * s, Dark, th * s);
        C = root;
    }

    protected override void OnBuild()
    {
        _lanterns.Clear(); _garland.Clear(); _swings.Clear(); _rims.Clear(); _stalls.Clear(); _floats.Clear(); _ripples.Clear(); _held.Clear();
        _wy = Y(0.63); var wy = _wy;
        var rng = new Random(111);

        // ---- the sky, still stars, the glow over the far shore
        RB(0, 0, W, wy, Vertical((Color.FromArgb(255, 0x06, 0x0A, 0x1E), 0), (Color.FromArgb(255, 0x10, 0x16, 0x38), 0.5), (Color.FromArgb(255, 0x2A, 0x20, 0x4C), 0.85), (Color.FromArgb(255, 0x4A, 0x2A, 0x4E), 1)));
        _stars = new Ellipse[80];
        for (var i = 0; i < _stars.Length; i++) _stars[i] = E(X(rng.NextDouble()), Y(rng.NextDouble() * 0.5), S(0.002 + 0.003 * rng.NextDouble() * rng.NextDouble()), White, 0.5);
        _horizon = RB(0, wy - S(0.34), W, S(0.34), Vertical((A(P(1), 0), 0), (A(Mix(P(1), P(0), 0.4), 0.34), 1)));

        // ---- far lanterns: small, slow, already high
        for (var i = 0; i < 20; i++) Add(Make(S(0.022 + 0.02 * rng.NextDouble()), P(i), false), 0.61, 0.012 + 0.012 * rng.NextDouble(), rng, false);

        // ---- the far shore: two ranges of hills, a line of trees, the stalls' lights, the bridge
        void Hill(Color top, Color bottom, params double[] f) { for (var i = 0; i + 1 < f.Length; i += 2) { f[i] = X(f[i]); f[i + 1] = Y(f[i + 1]); } GB(Vertical((top, 0), (bottom, 0.6), (bottom, 1)), 1, TableauCurve.Closed(f, 4)); }
        Hill(Color.FromArgb(255, 0x34, 0x2E, 0x5C), Color.FromArgb(255, 0x22, 0x1E, 0x44), -0.1, 0.60, 0.1, 0.52, 0.24, 0.47, 0.38, 0.54, 0.5, 0.50, 0.64, 0.43, 0.78, 0.50, 0.9, 0.55, 1.1, 0.5, 1.25, 1.0, -0.25, 1.0);
        Hill(Color.FromArgb(255, 0x1E, 0x1A, 0x38), Color.FromArgb(255, 0x12, 0x10, 0x26), -0.1, 0.59, 0.12, 0.60, 0.3, 0.56, 0.46, 0.60, 0.62, 0.575, 0.8, 0.60, 0.95, 0.57, 1.1, 0.6, 1.25, 1.0, -0.25, 1.0);
        var tree = B(Color.FromArgb(255, 0x0E, 0x0C, 0x1C));
        for (var x = -S(0.02); x < W; x += S(0.02 + 0.03 * rng.NextDouble())) { var d = S(0.025 + 0.03 * rng.NextDouble()); var e = new Ellipse { Width = d * 1.3, Height = d, Fill = tree }; At(e, x, wy - d * 0.8); C.Children.Add(e); }
        RB(0, wy - S(0.012), W, S(0.016), tree);
        // the lake
        RB(0, wy, W, H - wy, Vertical((Color.FromArgb(255, 0x30, 0x20, 0x48), 0), (Color.FromArgb(255, 0x14, 0x12, 0x30), 0.3), (Color.FromArgb(255, 0x07, 0x08, 0x16), 1)));
        _lakeGlow = RB(0, wy, W, S(0.2), Vertical((A(Mix(P(1), P(0), 0.4), 0.3), 0), (A(P(1), 0), 1)));
        // the bridge, hung with lights, and its shape on the water
        {
            double bx = X(0.2), hw = S(0.16); var stone = Color.FromArgb(255, 0x12, 0x0E, 0x1E);
            var arch = new double[52]; var mirror = new double[52];
            for (var i = 0; i < 13; i++)
            {
                var a = Math.PI * i / 12;
                arch[i * 2] = bx - Math.Cos(a) * hw; arch[i * 2 + 1] = wy - S(0.006) - Math.Sin(a) * S(0.062);
                var j = 25 - i; arch[j * 2] = bx - Math.Cos(a) * hw * 0.8; arch[j * 2 + 1] = wy + S(0.002) - Math.Sin(a) * S(0.042);
                mirror[i * 2] = arch[i * 2]; mirror[i * 2 + 1] = wy + Math.Sin(a) * S(0.04); mirror[j * 2] = arch[j * 2]; mirror[j * 2 + 1] = wy + Math.Sin(a) * S(0.026);
            }
            G(stone, 0.45, mirror); G(stone, 1, arch);
            for (var i = 0; i < 9; i++)
            {
                var a = Math.PI * (i + 0.5) / 9; double lx = bx - Math.Cos(a) * hw * 0.96, ly = wy - S(0.012) - Math.Sin(a) * S(0.062);
                var c = P(i);
                _stalls.Add((Glow(lx, ly, S(0.03), Mix(c, White, 0.3), 1, 0.7), RB(lx - S(0.003), wy + S(0.004), S(0.006), S(0.05), Vertical((A(c, 0.55), 0), (A(c, 0), 1)), 0.4), i / 8.0, rng.NextDouble() * 6));
            }
        }
        // the stalls along the shore
        for (var x = X(0.4); x < W - S(0.02); x += S(0.035 + 0.03 * rng.NextDouble()))
        {
            var c = Mix(P(rng.Next(Pal.Length)), Color.FromArgb(255, 0xFF, 0xD8, 0x9A), 0.5);
            _stalls.Add((Glow(x, wy - S(0.012), S(0.026), c, 1, 0.7), RB(x - S(0.003), wy + S(0.004), S(0.006), S(0.045 + 0.03 * rng.NextDouble()), Vertical((A(c, 0.5), 0), (A(c, 0), 1)), 0.4), Clamp01(x / W), rng.NextDouble() * 6));
        }

        // ---- the lake holds every lantern's light (made here so the lanterns' own shapes sit above the water)
        var mid = new List<(double d, Color c, bool near)>();
        for (var i = 0; i < 16; i++) mid.Add((S(0.045 + 0.03 * rng.NextDouble()), P(i + 1), false));
        for (var i = 0; i < 9; i++) mid.Add((S(0.085 + 0.045 * rng.NextDouble()), P(i), true));
        var refl = new List<Ellipse>();
        foreach (var (d, c, _) in mid) refl.Add(Glow(0, 0, d * 2, Mix(c, P(1), 0.3), 0.55, 0));
        // floating lanterns on the water
        for (var i = 0; i < 13; i++)
        {
            var depth = rng.NextDouble(); var fy = wy + S(0.02) + depth * S(0.15); var s = S(0.008 + 0.011 * depth); var c = Mix(P(i), Color.FromArgb(255, 0xFF, 0xE0, 0xA8), 0.45);
            var g = new Canvas(); C.Children.Add(g); var t = new TranslateTransform(); g.RenderTransform = t; var root = C; C = g;
            RB(-s * 0.35, s * 0.6, s * 0.7, s * 3.2, Vertical((A(c, 0.5), 0), (A(c, 0), 1)), 0.7);
            var glow = Glow(0, 0, s * 5, c, 0.6, 0.6);
            RB(-s, -s * 1.1, s * 2, s * 1.7, Vertical((Mix(c, White, 0.55), 0), (c, 1)));
            R(-s * 1.15, s * 0.5, s * 2.3, Math.Max(1, s * 0.3), Color.FromArgb(255, 0x1A, 0x10, 0x18));
            C = root;
            _floats.Add((t, glow, rng.NextDouble(), fy, (0.004 + 0.008 * depth) * (i % 3 == 0 ? -1 : 1), rng.NextDouble() * 6, i / 12.0));
        }
        var ripple = B(Color.FromArgb(255, 0x0A, 0x0A, 0x1C));
        for (var i = 0; i < 70; i++)
        {
            var depth = rng.NextDouble(); var y = wy + S(0.01) + depth * (H - wy) * 0.6; var w = S(0.02 + 0.08 * rng.NextDouble()) * (0.6 + depth);
            var r = new Rectangle { Width = w, Height = Math.Max(1, S(0.002 + 0.003 * depth)), Fill = ripple, Opacity = 0.6 + 0.25 * depth }; At(r, 0, y); C.Children.Add(r);
            _ripples.Add((r, rng.NextDouble(), y, w, (0.008 + 0.02 * depth) * (rng.NextDouble() < 0.5 ? 1 : -1)));
        }

        // ---- the lanterns the crowd lets go: the middle ones, then the near ones
        for (var i = 0; i < mid.Count; i++)
        {
            var (d, c, near) = mid[i];
            var l = Make(d, c, true); l.Refl = refl[i];
            Add(l, near ? 0.86 : 0.82, near ? 0.045 + 0.02 * rng.NextDouble() : 0.028 + 0.014 * rng.NextDouble(), rng, near);
        }

        // ---- the crowd on the near shore, from behind; two of them still hold a lantern up
        RB(0, H - S(0.07), W, S(0.07), Vertical((A(Dark, 0), 0), (Dark, 0.7), (Dark, 1)));
        var k = 0;
        for (var x = S(0.06) - S(0.1) * rng.NextDouble(); x < W + S(0.05);)
        {
            var kid = k % 4 == 2; var s = kid ? S(0.15 + 0.03 * rng.NextDouble()) : S(0.22 + 0.07 * rng.NextDouble());
            var holds = k % 5 == 1; var arms = holds ? 2 : k % 3 == 0 ? (k % 2 == 0 ? 1 : -1) : 0;
            var baseY = H + s * 0.05;
            if (holds)
            {
                var d = s * 0.62; var c = P(k);
                var l = Make(d, c, true); l.T.TranslateX = x; l.T.TranslateY = baseY - s * 1.5;
                var t = new TranslateTransform(); l.G.RenderTransform = new TransformGroup { Children = { l.T, t } };
                _held.Add((l.Halo, l.Inner, t, rng.NextDouble() * 6));
            }
            Person(x, baseY, s, kid ? 3 - k % 2 : k % 5, arms, rng.NextDouble() * 6, rng);
            x += s * (0.62 + 0.5 * rng.NextDouble()); k++;
        }

        // ---- two garlands across the top: a paper lantern a band, low notes to high
        var n = 0;
        foreach (var (x0, y0, x1, y1, sag) in new[] { (-0.03, 0.05, 0.6, 0.0, 0.13), (0.42, -0.02, 1.03, 0.08, 0.12) })
        {
            var g = new Canvas(); C.Children.Add(g); var root = C; C = g;
            var rt = new RotateTransform { CenterX = X((x0 + x1) / 2), CenterY = Y(Math.Min(y0, y1)) - S(0.4) }; g.RenderTransform = rt; _swings.Add((rt, n * 2.0, 0.35));
            var cord = PL(B(Color.FromArgb(255, 0x1A, 0x14, 0x22)), Math.Max(1, S(0.003)));
            for (var i = 0; i <= 40; i++) { var t = i / 40.0; cord.Points.Add(new Pt(X(x0 + (x1 - x0) * t), Y(y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)))); }
            const int count = 12;
            for (var i = 0; i < count; i++)
            {
                var t = (i + 0.5) / count; double lx = X(x0 + (x1 - x0) * t), ly = Y(y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)); var d = S(0.042);
                var c = P(n + i); var band = (n * count + i) / (2.0 * count - 1);
                var halo = Glow(lx, ly + d * 0.75, d * 3.2, c, 0.5, 0.3);
                L(lx, ly, lx, ly + d * 0.2, Color.FromArgb(255, 0x1A, 0x14, 0x22), Math.Max(1, S(0.002)));
                var body = new Ellipse { Width = d * 0.9, Height = d, Fill = Vertical((Mix(c, Deep, 0.35), 0), (c, 0.45), (Mix(c, White, 0.45), 1)) }; At(body, lx - d * 0.45, ly + d * 0.22); C.Children.Add(body);
                R(lx - d * 0.16, ly + d * 0.17, d * 0.32, d * 0.09, Color.FromArgb(255, 0x1A, 0x14, 0x22)); R(lx - d * 0.16, ly + d * 1.18, d * 0.32, d * 0.09, Color.FromArgb(255, 0x1A, 0x14, 0x22));
                L(lx, ly + d * 1.27, lx, ly + d * 1.6, Mix(c, Deep, 0.3), Math.Max(1, S(0.002)), 0.8);
                _garland.Add((halo, body, band));
            }
            C = root; n++;
        }
        Vignette(0.3);
    }

    /// <summary>A lantern joins the flight somewhere on its way up.</summary>
    private void Add(Lantern l, double start, double vy, Random r, bool near)
    {
        l.Start = start; l.Vy = vy; l.X0 = 0.03 + 0.94 * r.NextDouble(); l.Y = start - r.NextDouble() * (start + 0.1);
        l.Ph = r.NextDouble() * 6.28; l.Rate = 0.35 + 0.5 * r.NextDouble(); l.Band = r.NextDouble(); l.Sway = near ? 0.014 : 0.02; l.Wait = 1.5 + 4 * r.NextDouble();
        _lanterns.Add(l);
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed; var wy = _wy;
        for (var i = 0; i < _stars.Length; i++) Op(_stars[i], 0.35 + 0.3 * Math.Sin(f.T * (0.7 + i % 7 * 0.23) + i * 1.7) * (0.4 + 0.6 * f.High));

        // ---- the beat: every light lifts for a moment, and a handful of lanterns is let go
        _sinceBeat += dt;
        var hit = Clamp01(f.Beat * 2.2);
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.2) { _sinceBeat = 0; _release = f.Reduced ? 1 : 2 + (int)(4 * hit); }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, hit * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 3.8);
        _windPh += dts * 0.23; _wind = 0.6 * Math.Sin(_windPh) + 0.4 * Math.Sin(_windPh * 2.7 + 1);
        _sway += dts * (1.2 + 1.8 * f.Mid); _rip += dts;

        Op(_horizon, 0.5 + 0.35 * f.Loud + 0.25 * _flare); Op(_lakeGlow, 0.4 + 0.4 * f.Loud + 0.3 * _flare);

        // ---- the lanterns: up with the loudness, each swaying on its own, each light on its own band
        var climb = 0.35 + 0.9 * f.Loud + 0.7 * _flare;
        for (var i = 0; i < _lanterns.Count; i++)
        {
            var l = _lanterns[i];
            if (l.Waiting)
            {
                l.Since += dt;
                if (_release > 0 || l.Since > l.Wait) { if (_release > 0) _release--; l.Waiting = false; l.Y = l.Start; l.X0 = 0.03 + 0.94 * Rng.NextDouble(); l.Band = Rng.NextDouble(); }
                else continue;
            }
            l.Y -= l.Vy * climb * dts; l.Ph += dts * l.Rate;
            if (l.Y < -0.16) { l.Waiting = true; l.Since = 0; l.G.Opacity = 0; if (l.Refl is { } gone) gone.Opacity = 0; continue; }
            var x = X(l.X0 + Math.Sin(l.Ph) * l.Sway + _wind * (l.Start - l.Y) * 0.05); var y = Y(l.Y);
            l.T.TranslateX = x; l.T.TranslateY = y; l.T.Rotation = Math.Cos(l.Ph) * 5;
            var seen = Clamp01((l.Start - l.Y) / 0.05) * Clamp01((l.Y + 0.16) / 0.1);
            l.G.Opacity = seen;
            var lv = Clamp01(Lv(f, l.Band) * 1.15 + 0.35 * _flare);
            Op(l.Inner, 0.4 + 0.6 * lv); Op(l.Halo, 0.2 + 0.55 * lv);
            if (l.Refl is { } rf)
            {
                if (y < wy)
                {
                    var up = (wy - y) / (H * 0.55);
                    Size(rf, x + Math.Sin(_rip * 1.3 + i) * S(0.004), wy + (wy - y) * 0.34 + l.D * 0.6, l.D * 1.5, l.D * (2.4 + 2 * up));
                    Op(rf, seen * (0.14 + 0.3 * lv) * Clamp01(1 - up));
                }
                else rf.Opacity = 0;
            }
        }

        // ---- the garlands and the far shore: a light a band
        for (var i = 0; i < _garland.Count; i++)
        {
            var (halo, body, band) = _garland[i];
            var lv = Clamp01(Lv(f, band) * 1.2 + 0.3 * _flare);
            Op(halo, 0.12 + 0.75 * lv); Op(body, 0.6 + 0.4 * lv);
        }
        for (var i = 0; i < _stalls.Count; i++)
        {
            var (light, refl, band, ph) = _stalls[i];
            var lv = Clamp01(Lv(f, band) * 1.1 + 0.3 * _flare);
            Op(light, 0.4 + 0.6 * lv); Op(refl, (0.2 + 0.5 * lv) * (0.6 + 0.4 * Osc(_rip, 1.6, ph)));
        }

        // ---- the lake: floating lanterns drift and bob, ripples cross
        for (var i = 0; i < _floats.Count; i++)
        {
            var (t, glow, x, y, v, ph, band) = _floats[i];
            var fx = ((x + _rip * v) % 1.2 + 1.2) % 1.2 - 0.1;
            t.X = X(fx); t.Y = y + Math.Sin(_rip * 0.9 + ph) * S(0.0025);
            Op(glow, 0.3 + 0.6 * Clamp01(Lv(f, band * 0.5) * 1.1 + 0.3 * _flare));
        }
        for (var i = 0; i < _ripples.Count; i++)
        {
            var (r, x, y, w, v) = _ripples[i];
            At(r, X(((x + _rip * v) % 1.2 + 1.2) % 1.2 - 0.1) - w / 2, y);
        }

        // ---- the crowd: a sway, the lanterns' light along their edges, the held lanterns breathing
        var live = f.Reduced ? 0.35 : 1;
        for (var i = 0; i < _swings.Count; i++) { var (rt, ph, amp) = _swings[i]; rt.Angle = amp * live * Math.Sin(_sway * (amp < 0.5 ? 0.4 : 1) + ph) * (0.5 + 0.6 * f.Loud); }
        var glowOn = 0.25 + 0.4 * f.Loud + 0.45 * _flare;
        for (var i = 0; i < _rims.Count; i++) Op(_rims[i].rim, _rims[i].w * glowOn);
        for (var i = 0; i < _held.Count; i++)
        {
            var (halo, inner, t, ph) = _held[i];
            t.Y = Math.Sin(_sway * 0.6 + ph) * S(0.006) - _flare * S(0.012);
            Op(inner, 0.5 + 0.5 * f.Low); Op(halo, 0.3 + 0.4 * f.Low + 0.3 * _flare);
        }
    }
}
