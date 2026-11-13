using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== ENVIRONMENT: Sunrise Meadow (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A meadow at sunrise (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The flowers are the meter: twenty-four tall flowers stand across the meadow, a band a flower, and a flower rises on its stem
/// and opens as its band rises. The sun climbs out of the hills with the loudness and the night gives way to the day as it
/// goes, its rays turn slowly, the mist lies in the valley, the grass sways with the mids, butterflies wander with the high
/// notes, and a beat lifts the flock a wing beat (2026-11-11: the ring of light a beat sent out from the sun was taken out, and the
/// birds were drawn again as bodies with two wings).
///
/// Every shape is made once in OnBuild. A flower is a canvas that is moved and scaled, so a frame allocates nothing; no brush is
/// recoloured (a gradient brush does not repaint when its stops change).
/// </summary>
public sealed class SunriseMeadow : Tableau
{
    private const int Bands = 24, Blades = 110, Birds = 7, Flies = 6, Rays = 14;
    private readonly Canvas[] _head = new Canvas[Bands];
    private readonly Microsoft.UI.Composition.Visual[] _headV = new Microsoft.UI.Composition.Visual[Bands];   // the head's size is set on the compositor's own visual: XAML does not paint the head again for it
    private readonly TranslateTransform[] _headT = new TranslateTransform[Bands], _bloomT = new TranslateTransform[Bands];
    private int _half;
    private const double HeadMax = 1.2;   // the largest a head is drawn
    private readonly Line[] _stem = new Line[Bands], _blade = new Line[Blades];
    private readonly Ellipse[] _bloom = new Ellipse[Bands];
    private readonly double[] _lv = new double[Bands], _fx = new double[Bands], _fb = new double[Bands], _fh = new double[Bands], _fph = new double[Bands];
    private readonly double[] _bx = new double[Blades], _by = new double[Blades], _bh = new double[Blades];
    private readonly Polygon[] _wingNear = new Polygon[Birds], _wingFar = new Polygon[Birds];
    private readonly TranslateTransform[] _birdT = new TranslateTransform[Birds];
    private readonly double[] _birdU = new double[Birds];
    private readonly (Polygon a, Polygon b, ScaleTransform s, TranslateTransform t)[] _fly = new (Polygon, Polygon, ScaleTransform, TranslateTransform)[Flies];
    private readonly List<(Ellipse e, double ph)> _stars = new();
    private Canvas _sunC = null!, _rayC = null!;
    private TranslateTransform _sunT = null!;
    private RotateTransform _rayR = null!, _swingR = null!;
    private readonly Polygon[] _birdBody = new Polygon[Birds];
    private readonly SolidColorBrush[][] _birdBr = new SolidColorBrush[Birds][];

    /// <summary>A colour from a hue (any number, one turn each whole), a saturation and a value.</summary>
    private static Color Hue(double h, double s, double v)
    {
        h = (h - Math.Floor(h)) * 6; var k = (int)h; var fr = h - k; double p = v * (1 - s), q = v * (1 - s * fr), t = v * (1 - s * (1 - fr));
        var (r, g, b) = k switch { 0 => (v, t, p), 1 => (q, v, p), 2 => (p, v, t), 3 => (p, q, v), 4 => (t, p, v), _ => (v, p, q) };
        return Color.FromArgb(255, (byte)(r * 255), (byte)(g * 255), (byte)(b * 255));
    }
    private Rectangle _day = null!, _field = null!;
    private Ellipse _corona = null!, _mist = null!;
    private double _sunX, _sunY0, _rise = 0.3, _flare, _prevBeat, _sinceBeat = 9, _idle, _tw, _sway, _flap, _flit, _birdX;

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);

    protected override void OnBuild()
    {
        _stars.Clear();
        var rng = new Random(293); var hz = Y(0.62); _sunX = X(0.5); _sunY0 = hz + S(0.02);

        // ---- the night sky, and the day laid over it as the sun climbs
        RB(0, 0, W, H, Vertical((Rgb(0x0A0C24), 0), (Rgb(0x241C44), 0.4), (Rgb(0x6A3058), 0.58), (Mix(P(1), Rgb(0xF08060), 0.5), 0.64), (Rgb(0x201828), 1)));
        for (var i = 0; i < 60; i++) _stars.Add((E(X(rng.NextDouble()), Y(0.45 * rng.NextDouble()), S(0.002 + 0.003 * rng.NextDouble()), Rgb(0xE8ECFF), 0.6), rng.NextDouble() * 6));
        _day = RB(0, 0, W, hz + 4, Vertical((Rgb(0x3C78C8), 0), (Rgb(0x8CB8E8), 0.45), (Mix(P(2), Rgb(0xFFE0B0), 0.5), 0.8), (Mix(P(0), P(2), 0.5), 1)), 0.3);

        // ---- the sun: corona, turning rays, the disc
        _sunC = new Canvas(); _sunT = new TranslateTransform(); _sunC.RenderTransform = _sunT; C.Children.Add(_sunC);
        {
            var root = C; C = _sunC;
            Glow(_sunX, _sunY0, S(1.5), Mix(P(0), P(1), 0.4), 0.35, 0.5); _corona = Glow(_sunX, _sunY0, S(0.7), Mix(P(0), P(2), 0.5), 0.5, 0.7);
            // the rays are drawn once into a picture and the picture is turned (2026-11-11: this scene drew thirteen frames a second
            // where the others drew thirty; fourteen see-through triangles that reach past the corners were painted again at every
            // angle). The picture is made small and stretched: the rays are soft, and a full-size one would be very large on a big screen
            {
                var len = S(1.45); var len0 = Math.Min(len, 640.0);   // past the furthest corner, and no further
                _rayC = new Canvas { Width = len0 * 2, Height = len0 * 2, CacheMode = new BitmapCache() }; _rayR = new RotateTransform();
                _rayC.RenderTransform = new TransformGroup { Children = { new TranslateTransform { X = -len0, Y = -len0 }, new ScaleTransform { ScaleX = len / len0, ScaleY = len / len0 }, _rayR, new TranslateTransform { X = _sunX, Y = _sunY0 } } };
                C.Children.Add(_rayC); C = _rayC; var near = len0 * 0.1 / 1.45;
                for (var k = 0; k < Rays; k++)
                {
                    var a = k * 2 * Math.PI / Rays; var wd = 0.07 + 0.04 * (k % 2);
                    G(Mix(P(2), White, 0.4), k % 2 == 0 ? 0.13 : 0.08, len0 + Math.Cos(a) * near, len0 + Math.Sin(a) * near, len0 + Math.Cos(a - wd) * len0, len0 + Math.Sin(a - wd) * len0, len0 + Math.Cos(a + wd) * len0, len0 + Math.Sin(a + wd) * len0);
                }
            }
            C = _sunC;
            Glow(_sunX, _sunY0, S(0.3), Rgb(0xFFF0C0), 0.8, 0.9); E(_sunX, _sunY0, S(0.17), Rgb(0xFFF6DC)); E(_sunX, _sunY0, S(0.15), Rgb(0xFFFAEA));
            C = root;
        }
        // thin clouds that catch the light
        foreach (var (cx, cy, cw) in new[] { (0.18, 0.2, 0.3), (0.72, 0.14, 0.36), (0.9, 0.32, 0.24), (0.34, 0.36, 0.2) })
        {
            for (var k = 0; k < 5; k++) { var d = S(cw * (0.3 + 0.25 * rng.NextDouble())); var e = Glow(X(cx) + S(cw) * (k - 2) * 0.2, Y(cy) + S(0.012) * (rng.NextDouble() - 0.5), d, Mix(P(1), Rgb(0xFFE0D0), 0.6), 0.6, 0.4); e.Height = d * 0.3; }
        }
        // ---- the mountains, a mist in the valley, the near hill, a lone tree
        Mountains(hz);
        // in front of the mountains (2026-11-11, asked for: the flock passed behind them)
        // the flock: each bird is a body with a head, a beak and a forked tail, flying to the right, and two wings that beat. The far
        // wing is paler and a little behind the near one; the birds further back in the V are smaller
        for (var i = 0; i < Birds; i++)
        {
            var u = _birdU[i] = S(0.028) * (1 - 0.09 * ((i + 1) / 2)); var ink = Rgb(0x1A1420); var keep = C;
            var g = new Canvas(); C.Children.Add(g); _birdT[i] = new TranslateTransform(); g.RenderTransform = _birdT[i]; C = g;
            _wingFar[i] = G(Mix(ink, P(2), 0.3), 0.9, 0, 0, 0, 0, 0, 0);
            _birdBody[i] = G(ink, 0.95, -1.1 * u, -0.1 * u, -0.45 * u, -0.1 * u, 0.25 * u, -0.15 * u, 0.62 * u, -0.2 * u, 0.8 * u, -0.14 * u, 1.06 * u, -0.04 * u, 0.78 * u, 0.0, 0.3 * u, 0.1 * u, -0.45 * u, 0.06 * u, -1.1 * u, 0.12 * u, -0.86 * u, 0.0);
            _wingNear[i] = G(ink, 0.95, 0, 0, 0, 0, 0, 0);
            // each bird in a bright colour of its own that turns through the hues (2026-11-11, asked for colours that stand out and change)
            _birdBr[i] = new[] { B(ink), B(ink), B(ink) }; _birdBody[i].Fill = _birdBr[i][0]; _wingNear[i].Fill = _birdBr[i][1]; _wingFar[i].Fill = _birdBr[i][2];
            C = keep;
        }
        _mist = Glow(X(0.5), hz + S(0.01), W * 1.3, Rgb(0xFFE8D8), 0.5, 0.5); _mist.Height = S(0.12); At(_mist, X(0.5) - W * 0.65, hz - S(0.05));
        GB(Vertical((Rgb(0x3C5A3C), 0), (Rgb(0x24402C), 1)), 1, TableauCurve.Closed(new[] { -S(0.1), H, -S(0.1), hz + S(0.02), X(0.25), hz - S(0.02), X(0.5), hz + S(0.05), X(0.78), hz - S(0.01), W + S(0.1), hz + S(0.03), W + S(0.1), H }, 5));
        {
            // the tree and its swing, drawn in (2026-11-11, asked for: they were one dark shape): a brown trunk lit on the sun's side,
            // a bough for the swing, leaves in three greens with the light on the right of each clump, two ropes and a wooden seat.
            // The swing rocks a little from the bough
            double tx = X(0.2), tb = hz + S(0.03);
            E(tx + S(0.01), tb + S(0.002), S(0.11), Rgb(0x0E1E12), 0.45).Height = S(0.018);                        // its shade on the grass
            GB(Vertical((Rgb(0x6A4A2C), 0), (Rgb(0x3E2A18), 1)), 1, tx - S(0.016), tb + S(0.004), tx - S(0.007), tb - S(0.11), tx + S(0.007), tb - S(0.11), tx + S(0.017), tb + S(0.004));
            G(Rgb(0x9A7244), 0.55, tx + S(0.004), tb, tx + S(0.003), tb - S(0.1), tx + S(0.007), tb - S(0.1), tx + S(0.013), tb);   // the lit side
            G(Rgb(0x4E3620), 1, tx, tb - S(0.085), tx + S(0.095), tb - S(0.112), tx + S(0.097), tb - S(0.104), tx, tb - S(0.07));  // the bough
            var clumps = new[] { (0.0, -0.16, 0.14), (-0.06, -0.12, 0.1), (0.06, -0.125, 0.1), (-0.02, -0.21, 0.09), (0.04, -0.2, 0.08) };
            foreach (var (ox, oy, d) in clumps) E(tx + S(ox), tb + S(oy), S(d), Rgb(0x1C4424));
            foreach (var (ox, oy, d) in clumps) E(tx + S(ox + d * 0.06), tb + S(oy - d * 0.07), S(d * 0.8), Rgb(0x2F6A32));
            foreach (var (ox, oy, d) in clumps) E(tx + S(ox + d * 0.2), tb + S(oy - d * 0.18), S(d * 0.34), Mix(Rgb(0x6FA844), P(0), 0.18), 0.6);
            var leaf = new Random(77);
            for (var k = 0; k < 26; k++) { var (ox, oy, d) = clumps[k % clumps.Length]; var a = leaf.NextDouble() * 6.283; var r = d * 0.42 * Math.Sqrt(leaf.NextDouble()); E(tx + S(ox + r * Math.Cos(a)), tb + S(oy + r * Math.Sin(a)), S(0.012 + 0.012 * leaf.NextDouble()), k % 3 == 0 ? Rgb(0x9CC860) : Rgb(0x16381E), 0.55); }
            {
                var keep = C; var sw = new Canvas(); keep.Children.Add(sw); _swingR = new RotateTransform { CenterX = tx + S(0.0625), CenterY = tb - S(0.105) }; sw.RenderTransform = _swingR; C = sw;
                var rope = Rgb(0xC8B088); var th = Math.Max(1, S(0.0022));
                L(tx + S(0.05), tb - S(0.105), tx + S(0.05), tb - S(0.036), rope, th); L(tx + S(0.075), tb - S(0.105), tx + S(0.075), tb - S(0.036), rope, th);
                RB(tx + S(0.044), tb - S(0.038), S(0.037), S(0.0075), Vertical((Rgb(0xB88850), 0), (Rgb(0x6E4A28), 1)));
                C = keep;
            }
        }
        _field = RB(0, hz + S(0.06), W, H - hz, Vertical((A(Rgb(0x2C5030), 0), 0), (Rgb(0x2C5030), 0.2), (Rgb(0x16301C), 0.7), (Rgb(0x0A180E), 1)));
        // a path through the meadow
        G(Rgb(0x6A5A3A), 0.35, TableauCurve.Closed(new[] { X(0.44), H + 2, X(0.52), Y(0.84), X(0.47), Y(0.74), X(0.5), hz + S(0.07), X(0.508), hz + S(0.07), X(0.5), Y(0.74), X(0.58), Y(0.84), X(0.6), H + 2 }, 4));

        // ---- the grass behind, the flowers, the grass in front
        for (var i = 0; i < Blades; i++)
        {
            var near = i >= Blades / 2; _bx[i] = X(rng.NextDouble()); _by[i] = near ? H + S(0.01) : Y(0.8 + 0.14 * rng.NextDouble()); _bh[i] = S(near ? 0.06 + 0.08 * rng.NextDouble() : 0.03 + 0.04 * rng.NextDouble());
            if (i == Blades / 2) Flowers(rng);
            _blade[i] = L(_bx[i], _by[i], _bx[i], _by[i] - _bh[i], Mix(Rgb(0x1C3A20), near ? Rgb(0x2C5A2C) : Rgb(0x4A7A3A), rng.NextDouble()), Math.Max(1, S(near ? 0.004 : 0.0025)), 0.95); _blade[i].StrokeEndLineCap = PenLineCap.Round;
        }
        for (var i = 0; i < Flies; i++)
        {
            var cv = new Canvas(); var s = new ScaleTransform(); var t = new TranslateTransform(); cv.RenderTransform = new TransformGroup { Children = { s, t } }; C.Children.Add(cv);
            var root = C; C = cv; var c = P(i % 4); var z = S(0.012);
            var a = G(Mix(c, White, 0.3), 0.95, 0, 0, -z, -z * 0.9, -z * 1.1, z * 0.2, -z * 0.5, z * 0.7); var b = G(Mix(c, White, 0.3), 0.95, 0, 0, z, -z * 0.9, z * 1.1, z * 0.2, z * 0.5, z * 0.7);
            L(0, -z * 0.4, 0, z * 0.5, Rgb(0x1A1420), Math.Max(1, S(0.002))); C = root; _fly[i] = (a, b, s, t);
        }
        Vignette(0.26);
    }

    /// <summary>
    /// The mountains behind the meadow (2026-11-11, asked for a range like the Cascades: tall, worn smooth, with forest, rock, bare
    /// ground and trails). Two ranges with a low saddle in the middle, where the sun comes up. The far one is high and hazy: round
    /// shoulders, two summits with snow, gullies down their sides, and the slopes that face the sun warmed. The near one is lower and
    /// darker: a forest of small firs up to a tree line that rises and falls, single trees above it, grey rock near the crest, a few
    /// open meadows in the trees, and two trails that zigzag up from the valley. Nothing here moves.
    /// </summary>
    private void Mountains(double hz)
    {
        var rng = new Random(77);
        double[] far = { -0.08, 0.10, 0.05, 0.17, 0.108, 0.25, 0.14, 0.266, 0.172, 0.25, 0.21, 0.20, 0.28, 0.15, 0.36, 0.10, 0.44, 0.045, 0.5, 0.02, 0.57, 0.05, 0.65, 0.13, 0.72, 0.21, 0.765, 0.296, 0.80, 0.314, 0.835, 0.296, 0.87, 0.24, 0.94, 0.17, 1.08, 0.13 };
        double[] mid = { -0.08, 0.07, 0.04, 0.115, 0.12, 0.085, 0.2, 0.135, 0.3, 0.075, 0.4, 0.03, 0.5, 0.0, 0.6, 0.035, 0.7, 0.095, 0.79, 0.07, 0.88, 0.125, 0.97, 0.09, 1.08, 0.1 };
        double Ht(double[] c, double u) { for (var i = 0; i + 3 < c.Length; i += 2) if (u <= c[i + 2]) { var t = Math.Clamp((u - c[i]) / (c[i + 2] - c[i]), 0, 1); return c[i + 1] + (c[i + 3] - c[i + 1]) * t; } return c[^1]; }
        double[] Outline(double[] c)
        {
            var o = new double[c.Length + 4]; o[0] = X(c[0]); o[1] = hz + S(0.12);
            for (var i = 0; i < c.Length; i += 2) { o[2 + i] = X(c[i]); o[3 + i] = hz - S(c[i + 1]); }
            o[^2] = X(c[^2]); o[^1] = hz + S(0.12); return TableauCurve.Closed(o, 6);
        }
        double[] At2(params double[] uh) { var o = new double[uh.Length]; for (var i = 0; i < uh.Length; i += 2) { o[i] = X(uh[i]); o[i + 1] = hz - S(uh[i + 1]); } return o; }

        // ---- the far range
        GB(Vertical((Rgb(0x8474A6), 0), (Rgb(0x6A5A8C), 0.5), (Rgb(0x54466E), 1)), 1, Outline(far));
        var warm = Rgb(0xFFC8A0);
        G(warm, 0.2, At2(0.775, 0.29, 0.72, 0.208, 0.65, 0.128, 0.6, 0.07, 0.69, 0.1, 0.76, 0.19, 0.79, 0.26));
        G(warm, 0.2, At2(0.165, 0.245, 0.21, 0.198, 0.28, 0.148, 0.36, 0.09, 0.27, 0.11, 0.2, 0.16, 0.16, 0.225));
        // snow on the two round summits (2026-11-11, asked for round tops, not a point, with the snow kept): a cap takes the
        // summit's own line for its top and ends below in a few uneven lobes
        var crest = Outline(far);
        void Cap(double ua, double ub, double drop, Color c, double op)
        {
            var o = new List<double>();
            for (var i = 0; i + 1 < crest.Length; i += 2) if (crest[i] >= X(ua) && crest[i] <= X(ub) && crest[i + 1] < hz) { o.Add(crest[i]); o.Add(crest[i + 1]); }
            if (o.Count < 6) return; double xl = o[0], yl = o[1], xr = o[^2], yr = o[^1]; const int lobes = 7;
            for (var k = 1; k < lobes; k++) { var t = k / (double)lobes; o.Add(xr + (xl - xr) * t); o.Add(yr + (yl - yr) * t + S(drop) * (k % 2 == 1 ? 1 : 0.4)); }
            G(c, op, o.ToArray());
        }
        var snow = Rgb(0xF6F2FF);
        Cap(0.762, 0.838, 0.03, snow, 0.92); Cap(0.80, 0.838, 0.024, Rgb(0xC8C0E8), 0.55);
        Cap(0.112, 0.168, 0.022, snow, 0.88); Cap(0.14, 0.168, 0.018, Rgb(0xC8C0E8), 0.5);
        foreach (var (u0, h0, u1, h1) in new[] { (0.805, 0.24, 0.83, 0.15), (0.79, 0.24, 0.775, 0.14), (0.84, 0.22, 0.88, 0.14), (0.145, 0.22, 0.17, 0.14), (0.13, 0.22, 0.105, 0.14), (0.24, 0.16, 0.26, 0.09), (0.69, 0.15, 0.7, 0.08), (0.93, 0.15, 0.95, 0.09) })
            L(X(u0), hz - S(h0), X(u1), hz - S(h1), Rgb(0x3A2C54), Math.Max(1, S(0.0022)), 0.3);

        // ---- the near range: rock and bare ground above, forest below
        GB(Vertical((Rgb(0x5A5870), 0), (Rgb(0x3E4A52), 0.5), (Rgb(0x2A3A38), 1)), 1, Outline(mid));
        double Line(double u) => Math.Max(0, Ht(mid, u) * (0.5 + 0.22 * Math.Sin(u * 23 + 1) + 0.1 * Math.Sin(u * 61)) - 0.004);   // the tree line
        for (var k = 0; k < 14; k++)
        {   // rock near the crest
            var u = 0.02 + 0.96 * rng.NextDouble(); var top = Ht(mid, u); if (top < 0.05) continue; var h = top - 0.012 - 0.02 * rng.NextDouble(); double w = 0.008 + 0.014 * rng.NextDouble(), t = 0.006 + 0.01 * rng.NextDouble();
            G(Mix(Rgb(0x8E889C), Rgb(0x6A6478), rng.NextDouble()), 0.55, At2(u - w, h - t, u - w * 0.4, h + t * 0.3, u + w * 0.5, h + t * 0.1, u + w, h - t * 0.8, u + w * 0.2, h - t * 1.3));
        }
        var firs = new[] { Rgb(0x1C3428), Rgb(0x223C2C), Rgb(0x183024), Rgb(0x2A4434) };
        {   // the forest's body under the tree line
            var n = 120; var o = new double[(n + 3) * 2];
            for (var k = 0; k <= n; k++) { var u = -0.06 + 1.12 * k / n; o[k * 2] = X(u); o[k * 2 + 1] = hz - S(Line(u)); }
            o[(n + 1) * 2] = X(1.06); o[(n + 1) * 2 + 1] = hz + S(0.12); o[(n + 2) * 2] = X(-0.06); o[(n + 2) * 2 + 1] = hz + S(0.12);
            GB(Vertical((Rgb(0x244030), 0), (Rgb(0x1A3026), 1)), 1, o);
        }
        void Fir(double u, double h, double size, double op = 1) { double x = X(u), y = hz - S(h), w = S(size * 0.34), t = S(size); G(firs[rng.Next(4)], op, x - w, y + t * 0.15, x, y - t, x + w, y + t * 0.15); }
        foreach (var (mu, mh, mw) in new[] { (0.17, 0.045, 0.03), (0.27, 0.03, 0.022), (0.72, 0.035, 0.028), (0.9, 0.05, 0.03), (0.06, 0.04, 0.02) })
        {   // open meadows in the trees
            var e = E(X(mu), hz - S(mh), S(mw) * 2, Rgb(0x6A8A50), 0.5); e.Height = S(mw) * 0.6; At(e, X(mu) - S(mw), hz - S(mh) - S(mw) * 0.3);
        }
        foreach (var (u0, dir, reach) in new[] { (0.335, -1.0, 0.15), (0.665, 1.0, 0.2) })
        {   // a trail up from the valley to a crest (drawn again 2026-11-11, asked for trails that follow the land): it keeps a
            // share of the slope's own height, so it rises and dips with the ground, climbs in long easy bends, gets thinner
            // with distance, and goes under the firs that are drawn after it
            const int n = 48; var pale = Rgb(0xE6D6AE);
            for (var part = 0; part < 3; part++)
            {
                var trail = PL(B(pale), Math.Max(1, S(0.0034 - 0.0009 * part)), 0.75 - 0.12 * part); trail.StrokeLineJoin = PenLineJoin.Round; trail.StrokeStartLineCap = trail.StrokeEndLineCap = PenLineCap.Round;
                for (var k = part * n / 3; k <= (part + 1) * n / 3; k++)
                {
                    var t = k / (double)n; var u = u0 + dir * (reach * t + 0.02 * Math.Sin(t * Math.PI * 5) * (1 - 0.5 * t));
                    trail.Points.Add(new Pt(X(u), hz - S(Math.Max(0.004, Ht(mid, u) * (0.1 + 0.8 * t) - 0.004))));
                }
            }
        }
        for (var u = -0.03; u < 1.03; u += 0.0045 + 0.004 * rng.NextDouble()) { var l = Line(u); if (l > 0.006) Fir(u, l - 0.002, 0.012 + 0.01 * rng.NextDouble()); }
        for (var k = 0; k < 150; k++)
        {   // rows of firs down the slope, and single ones above the tree line where the ground is bare
            var u = rng.NextDouble(); var l = Line(u); var top = Ht(mid, u);
            if (k < 100) { if (l > 0.02) Fir(u, l * (0.25 + 0.7 * rng.NextDouble()), 0.011 + 0.008 * rng.NextDouble(), 0.9); }
            else if (top - l > 0.02) Fir(u, l + (top - l - 0.012) * rng.NextDouble() * 0.7, 0.008 + 0.006 * rng.NextDouble(), 0.85);
        }
    }

    private void Flowers(Random rng)
    {
        for (var b = 0; b < Bands; b++)
        {
            _fx[b] = X((b + 0.5) / Bands + 0.012 * (rng.NextDouble() - 0.5)); _fb[b] = Y(0.93 + 0.05 * rng.NextDouble()); _fh[b] = S(0.2 + 0.05 * rng.NextDouble()); _fph[b] = rng.NextDouble() * 6;
            _stem[b] = L(_fx[b], _fb[b], _fx[b], _fb[b] - _fh[b] * 0.4, Rgb(0x3A6A30), Math.Max(1.5, S(0.004)));
            // A flower's head grows and shrinks with its band. It is painted once into a picture, at its largest, and the picture is
            // sized (2026-11-11: sizing the shapes themselves had them all painted again every frame, the glow with them, and held
            // this scene to thirteen frames a second where the others draw thirty). The glow is on its own behind the head and only
            // moves and fades.
            var col = Mix(P(b % 4), P((b + 1) % 4), 0.3 * rng.NextDouble()); var r = S(0.026); var n = 6 + b % 3; var half = Math.Ceiling(r * 1.5);
            _bloom[b] = Glow(0, 0, r * 5, col, 0.5, 0); _bloomT[b] = new TranslateTransform(); _bloom[b].RenderTransform = _bloomT[b];
            // (second pass the same day: a size set through a render transform still had the picture made again each frame; the
            // size is now the element's own Scale, which the compositor applies to the finished picture)
            var cv = new Canvas { Width = half * 2, Height = half * 2, CacheMode = new BitmapCache() };
            _headV[b] = Microsoft.UI.Xaml.Hosting.ElementCompositionPreview.GetElementVisual(cv); _headV[b].CenterPoint = new System.Numerics.Vector3((float)half, (float)half, 0); _headT[b] = new TranslateTransform();
            var place = new Canvas { RenderTransform = _headT[b] }; At(cv, -half, -half); place.Children.Add(cv); C.Children.Add(place); _head[b] = cv;
            var inner = new Canvas { RenderTransform = new TransformGroup { Children = { new ScaleTransform { ScaleX = HeadMax, ScaleY = HeadMax }, new TranslateTransform { X = half, Y = half } } } }; cv.Children.Add(inner);
            var root = C; C = inner;
            for (var k = 0; k < n; k++)
            {
                var a = k * 2 * Math.PI / n; double px = Math.Cos(a), py = Math.Sin(a);
                G(k % 2 == 0 ? col : Mix(col, White, 0.25), 1, TableauCurve.Closed(new[] { px * r * 0.2, py * r * 0.2, px * r * 0.7 - py * r * 0.34, py * r * 0.7 + px * r * 0.34, px * r * 1.1, py * r * 1.1, px * r * 0.7 + py * r * 0.34, py * r * 0.7 - px * r * 0.34 }, 4));
            }
            E(0, 0, r * 0.7, Rgb(0x4A2C14)); E(0, 0, r * 0.45, Rgb(0xFFD070));
            C = root; _lv[b] = 0.3;
        }
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;
        _sinceBeat += dt;
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.3 && !f.Reduced) { _sinceBeat = 0; }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 4);
        _idle += dts * 0.9; _tw += dts; _sway += dts * (0.7 + 2 * f.Mid); _flap += dts * (5 + 6 * _flare); _flit += dts * (0.5 + 1.5 * f.High); _birdX += dts * 0.03;

        // ---- the sun climbs with the loudness; the day comes with it
        _rise += ((f.Reduced ? 0.4 + 0.1 * Math.Sin(_idle * 0.3) : Clamp01(f.Loud * 1.15)) - _rise) * 0.02;
        if (!Skip("sun")) _sunT.Y = -S(0.36) * _rise; if (!Skip("rays")) _rayR.Angle = (_tw * 4) % 360;
        if (!Skip("fade")) { Op(_day, 0.1 + 0.8 * _rise); Op(_rayC, 0.5 + 0.5 * _rise + 0.3 * _flare); Op(_corona, 0.5 + 0.3 * _rise + 0.2 * _flare); Op(_mist, 0.6 - 0.35 * _rise); }
        if (!Skip("stars")) for (var i = 0; i < _stars.Count; i++) { var (e, ph) = _stars[i]; Op(e, (1 - _rise) * (0.3 + 0.5 * Osc(_tw, 0.6, ph))); }

        // ---- the flowers: a band a flower
        if (!Skip("flowers")) for (var b = 0; b < Bands; b++)
        {
            var target = f.Reduced ? 0.4 + 0.25 * Math.Sin(_idle * 0.7 + b * 0.5) : Clamp01(Lv(f, b / 23.0) * 1.3 + 0.06 * _flare);
            _lv[b] += (target - _lv[b]) * (target > _lv[b] ? 0.45 : 0.1);
            var h = _fh[b] * (0.3 + 0.7 * _lv[b]); var lean = S(0.012) * Math.Sin(_sway * 0.8 + _fph[b]) * (0.4 + 0.6 * _lv[b]);
            if (!Skip("stems")) { _stem[b].X2 = _fx[b] + lean; _stem[b].Y2 = _fb[b] - h; }
            if (!Skip("headmove")) { _headT[b].X = _fx[b] + lean; _headT[b].Y = _fb[b] - h; }
            if (!Skip("headsize")) { var hs = (float)((0.45 + 0.75 * _lv[b]) / HeadMax); _headV[b].Scale = new System.Numerics.Vector3(hs, hs, 1); }
            if (!Skip("bloommove")) { _bloomT[b].X = _fx[b] + lean; _bloomT[b].Y = _fb[b] - h; }
            if (!Skip("bloomfade")) Op(_bloom[b], 0.6 * _lv[b]);
        }

        // ---- the grass, the butterflies, the flock
        _half ^= 1;
        if (!Skip("grass")) for (var i = _half; i < Blades; i += 2) { var lean = (0.15 + 0.3 * f.Mid) * Math.Sin(_sway - _bx[i] / S(0.3) + i); _blade[i].X2 = _bx[i] + _bh[i] * lean; _blade[i].Y2 = _by[i] - _bh[i] * (1 - 0.2 * Math.Abs(lean)); }
        if (!Skip("flies")) for (var i = 0; i < Flies; i++)
        {
            var (a, b, s, t) = _fly[i];
            t.X = X(0.12 + 0.76 * ((i + 0.5) / Flies)) + S(0.07) * Math.Sin(_flit * 0.7 + i * 2.1) + S(0.03) * Math.Sin(_flit * 1.9 + i); t.Y = Y(0.74) + S(0.07) * Math.Sin(_flit * 0.9 + i * 1.3) + S(0.02) * Math.Cos(_flit * 2.3 + i);
            s.ScaleX = 0.25 + 0.75 * Math.Abs(Math.Sin(_flit * 9 + i * 1.7));
        }
        if (_swingR is not null) _swingR.Angle = f.Reduced ? 0 : 5 * Math.Sin(_sway * 0.45);
        if (!Skip("birds")) for (var i = 0; i < Birds; i++)
        {
            var row = (i + 1) / 2; var side = i % 2 == 0 ? 1 : -1; var x = ((_birdX + 0.3) % 1.3 - 0.15) * W - row * S(0.046); var y = Y(0.24) + side * row * S(0.029) + S(0.01) * Math.Sin(_tw * 0.7 + i);
            // a wing beat: up and down, with the tip trailing the wrist a little, and a short glide now and then
            var u = _birdU[i]; var ph = _flap + i * 0.6; var glide = Math.Sin(ph * 0.11 + i * 1.7) > 0.72;
            double b = glide ? 0.25 : Math.Sin(ph), tip = glide ? 0.32 : Math.Sin(ph - 0.5);
            _birdT[i].X = x; _birdT[i].Y = y - b * u * 0.08;
            Pts(_wingNear[i], 0.38 * u, -0.1 * u, 0.3 * u, (-0.1 - 0.7 * b) * u, -0.3 * u, (-0.1 - 1.35 * tip) * u, -0.18 * u, (-0.08 - 0.55 * b) * u, -0.32 * u, -0.04 * u);
            Pts(_wingFar[i], 0.44 * u, -0.12 * u, 0.42 * u, (-0.12 - 0.6 * b) * u, -0.08 * u, (-0.12 - 1.15 * tip) * u, -0.02 * u, (-0.1 - 0.45 * b) * u, -0.2 * u, -0.08 * u);
            var hue = i * 0.17 + _tw * 0.045 + 0.2 * _flare;
            _birdBr[i][0].Color = Hue(hue, 0.82, 1); _birdBr[i][1].Color = Hue(hue + 0.09, 0.9, 0.86); _birdBr[i][2].Color = Mix(Hue(hue - 0.09, 0.7, 1), White, 0.3);
        }
    }
}
