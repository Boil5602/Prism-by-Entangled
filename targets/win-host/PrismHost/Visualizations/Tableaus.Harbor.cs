using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== COMMUNITY: Harbor Lights (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A fishing harbor at night (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The sea is the instrument's body: five bands of swell, far to near, that rise and run with the lows, and three boats that ride
/// them, each lifted and tipped by the water under it. The boats are dressed with strings of bulbs, a bulb a band, low notes to
/// high across the three of them. The lamps along the quay follow bands too and lay their light down the water. The lighthouse turns
/// with the mids: its two beams shorten as they swing toward the eye and the lamp flares when one points straight out; a beat
/// flashes the lamp, the mast lights and the buoys in turn.
///
/// Every shape is made once in OnBuild. A swell is one polygon whose points are moved in place, a boat is one group moved by one
/// transform, so a frame allocates nothing.
/// </summary>
public sealed class HarborLights : Tableau
{
    private const int M = 48, Layers = 5;
    private sealed class Floater
    {
        public CompositeTransform T = null!;
        public double X, Half, Sink, Tip = 1;
        public int Layer;
        public FrameworkElement? Refl;
        public Ellipse? Light;
    }
    private readonly Polygon[] _wave = new Polygon[Layers];
    private readonly Polyline[] _crest = new Polyline[Layers];
    private readonly double[] _base = new double[Layers], _amp = new double[Layers], _now = new double[Layers], _k = new double[Layers], _ph = new double[Layers], _rate = new double[Layers];
    private readonly List<Floater> _boats = new(), _buoys = new();
    private readonly List<(Ellipse glow, Ellipse core, double band)> _bulbs = new();
    private readonly List<(Ellipse glow, Rectangle refl, double band, double ph)> _lamps = new();
    private readonly List<(Rectangle r, double op, double ph)> _streaks = new();
    private readonly List<(Ellipse c, double x, double y, double w)> _clouds = new();
    private double[] _bulbLv = Array.Empty<double>();
    // the town's windows (2026-11-11, asked for the music to reach the buildings' lights): a house follows one band, low at the left
    // of the town to high at the right. A lit window brightens and dims with it; a dark one comes on only when the band passes its own mark.
    private readonly List<(Rectangle r, int house, double rest, double mark)> _windows = new();
    private double[] _houseLv = Array.Empty<double>(), _houseBand = Array.Empty<double>();
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private Polygon _beamR = null!, _beamL = null!;
    private Ellipse _lampFlare = null!, _lampGlow = null!, _lantern = null!;
    private Rectangle _towerRefl = null!, _horizon = null!;
    private TranslateTransform _ship = null!;
    private RotateTransform _tail = null!;
    private Canvas _rimC = null!, _bodyC = null!;
    private SolidColorBrush _rim = null!, _dark = null!;
    private double _lx, _ly, _turn = 0.6, _swell = 0.3, _flare, _prevBeat, _sinceBeat = 9, _idle, _cloud, _shipX = 0.3, _tw, _wag;
    private int _beats;

    private static readonly Color Cream = Color.FromArgb(255, 0xFF, 0xE6, 0xB0);
    private static readonly Color Dark = Color.FromArgb(255, 0x07, 0x0B, 0x12);

    private double WaveY(int l, double x) => _base[l] + _now[l] * (0.7 * Math.Sin(_k[l] * x + _ph[l]) + 0.3 * Math.Sin(_k[l] * 1.9 * x - _ph[l] * 1.3 + l));

    /// <summary>One band of swell: a polygon whose top edge is moved every frame, and the pale line along its crest.</summary>
    private void Swell(int l, double baseY, double amp, double length, double rate, Color top, Color bottom)
    {
        _base[l] = baseY; _amp[l] = amp; _now[l] = amp; _k[l] = 2 * Math.PI / length; _rate[l] = rate; _ph[l] = l * 1.7;
        var p = new Polygon { Fill = Vertical((top, 0), (Mix(top, bottom, 0.7), 0.35), (bottom, 1)) };
        var c = new Polyline { Stroke = B(Mix(top, P(2), 0.45)), StrokeThickness = Math.Max(1, S(0.0022 + 0.0006 * l)), Opacity = 0.5 };
        for (var j = 0; j <= M; j++) { var x = -4 + (W + 8) * j / M; p.Points.Add(new Pt(x, baseY)); c.Points.Add(new Pt(x, baseY)); }
        p.Points.Add(new Pt(W + 4, H + 4)); p.Points.Add(new Pt(-4, H + 4));
        C.Children.Add(p); C.Children.Add(c); _wave[l] = p; _crest[l] = c;
    }
    private void Streak(double x, double y, double w, double h, Color c, double a, double op, Random r)
        => _streaks.Add((RB(x - w / 2, y, w, h, Vertical((A(c, a), 0), (A(c, 0), 1)), op), op, r.NextDouble() * 6));

    /// <summary>A boat riding one band of swell. kind 0 a trawler, 1 a sloop. Its strings of bulbs take the next eight bands.</summary>
    private void Boat(double fx, int layer, double u, int kind, bool flip, Color trim, ref int band, Random r)
    {
        var b = new Floater { X = X(fx), Layer = layer, Half = u * 5, Sink = u * 0.5, Tip = 0.8 };
        var glow = Glow(0, 0, u * 10, Mix(Cream, trim, 0.25), 0.5, 0.6); glow.Height = S(0.03) + u * 6; b.Refl = glow;
        var g = new Canvas(); C.Children.Add(g); b.T = new CompositeTransform(); g.RenderTransform = b.T; var root = C; C = g;
        double Fx(double x) => (flip ? -x : x) * u;
        var hullTop = Mix(Color.FromArgb(255, 0x1C, 0x26, 0x34), trim, 0.16); var hullLow = Color.FromArgb(255, 0x0A, 0x10, 0x1A);
        var wood = Color.FromArgb(255, 0x10, 0x16, 0x20);
        void Stay(double x1, double y1, double x2, double y2, int bulbs, ref int bandAt)
        {
            var line = PL(B(Color.FromArgb(255, 0x1E, 0x26, 0x30)), Math.Max(1, u * 0.07));
            for (var i = 0; i <= 10; i++) { var t = i / 10.0; line.Points.Add(new Pt(Fx(x1 + (x2 - x1) * t), (y1 + (y2 - y1) * t + 2.2 * t * (1 - t)) * u)); }
            for (var i = 0; i < bulbs; i++)
            {
                var t = (i + 0.7) / (bulbs + 0.4); double bx = Fx(x1 + (x2 - x1) * t), by = (y1 + (y2 - y1) * t + 2.2 * t * (1 - t) + 0.25) * u;
                var bd = bandAt++ / 23.0; var c = P((int)(bd * 2.99));
                _bulbs.Add((Glow(bx, by, u * 2.8, c, 0.9, 0.4), E(bx, by, u * 0.5, Mix(c, White, 0.55), 0.9), bd));
            }
        }
        if (kind == 0)
        {
            double mx = -0.6, top = -9.4;
            L(Fx(mx), -3.6 * u, Fx(mx), top * u, wood, Math.Max(1.5, u * 0.22)); L(Fx(mx), -6.4 * u, Fx(3.9), -4.9 * u, wood, Math.Max(1, u * 0.16));
            Stay(mx, top, 5.9, -2.1, 4, ref band); Stay(mx, top, -5.0, -1.5, 4, ref band);
            GB(Vertical((hullTop, 0), (hullLow, 0.6), (A(hullLow, 0), 1)), 1, Fx(-5.2), -1.3 * u, Fx(-4.9), -1.55 * u, Fx(4.4), -1.55 * u, Fx(6.1), -2.15 * u, Fx(5.0), 0.3 * u, Fx(4.0), 1.2 * u, Fx(-4.4), 1.2 * u, Fx(-5.0), 0.2 * u);
            L(Fx(-4.9), -1.3 * u, Fx(5.7), -1.75 * u, Mix(trim, White, 0.2), Math.Max(1, u * 0.14), 0.75);
            RB(Fx(flip ? 0.2 : -2.9), -4.0 * u, 3.1 * u, 2.5 * u, B(Color.FromArgb(255, 0x16, 0x1E, 0x2A))); RB(Fx(flip ? 0.4 : -3.1), -4.3 * u, 3.5 * u, 0.4 * u, B(wood));
            for (var i = 0; i < 3; i++) RB(Fx(-2.5 + i * 0.95) - (flip ? 0.62 * u : 0), -3.5 * u, 0.62 * u, 0.85 * u, B(Cream), 0.92);
            b.Light = Glow(Fx(mx), top * u, u * 3.4, Color.FromArgb(255, 0xF4, 0xF8, 0xFF), 1, 0.7); E(Fx(mx), top * u, u * 0.4, White);
        }
        else
        {
            double mx = 0.4, top = -12.5;
            L(Fx(mx), -1.8 * u, Fx(mx), top * u, wood, Math.Max(1.5, u * 0.2)); L(Fx(mx), -2.7 * u, Fx(-4.3), -2.5 * u, Color.FromArgb(255, 0x8C, 0x98, 0xA8), Math.Max(2, u * 0.5));
            Stay(mx, top, 6.1, -1.5, 4, ref band); Stay(mx, top, -4.9, -1.0, 4, ref band);
            GB(Vertical((hullTop, 0), (hullLow, 0.6), (A(hullLow, 0), 1)), 1, Fx(-5.0), -1.05 * u, Fx(4.6), -1.05 * u, Fx(6.3), -1.6 * u, Fx(4.8), 0.5 * u, Fx(3.6), 1.2 * u, Fx(-4.0), 1.2 * u, Fx(-5.0), 0.0);
            L(Fx(-4.9), -0.85 * u, Fx(5.8), -1.3 * u, Mix(trim, White, 0.2), Math.Max(1, u * 0.14), 0.75);
            G(Color.FromArgb(255, 0x16, 0x1E, 0x2A), 1, Fx(-2.4), -1.0 * u, Fx(-1.9), -1.95 * u, Fx(1.6), -1.95 * u, Fx(2.4), -1.0 * u);
            E(Fx(-1.0), -1.45 * u, 0.55 * u, Cream, 0.92); E(Fx(0.6), -1.45 * u, 0.55 * u, Cream, 0.92);
            b.Light = Glow(Fx(mx), top * u, u * 3.4, Color.FromArgb(255, 0xF4, 0xF8, 0xFF), 1, 0.7); E(Fx(mx), top * u, u * 0.4, White);
        }
        C = root; _boats.Add(b);
    }
    private void Buoy(double fx, int layer, double u, Color c)
    {
        var b = new Floater { X = X(fx), Layer = layer, Half = u * 1.5, Sink = u * 0.3, Tip = 1.6 };
        b.Refl = RB(0, 0, u * 1.6, S(0.05), Vertical((A(c, 0.6), 0), (A(c, 0), 1)), 0.5);
        var g = new Canvas(); C.Children.Add(g); b.T = new CompositeTransform(); g.RenderTransform = b.T; var root = C; C = g;
        GB(Vertical((Mix(c, Dark, 0.55), 0), (Mix(c, Dark, 0.8), 0.6), (A(Dark, 0), 1)), 1, -u * 1.2, 0.5 * u, -u * 0.9, -1.1 * u, u * 0.9, -1.1 * u, u * 1.2, 0.5 * u);
        L(-u * 0.6, -1.1 * u, 0, -3.2 * u, Dark, Math.Max(1, u * 0.18)); L(u * 0.6, -1.1 * u, 0, -3.2 * u, Dark, Math.Max(1, u * 0.18));
        b.Light = Glow(0, -3.4 * u, u * 5, c, 1, 0.3); E(0, -3.4 * u, u * 0.6, Mix(c, White, 0.5));
        C = root; _buoys.Add(b);
    }

    // ---- on the dock: a shape is drawn twice, a lit rim toward the lantern and the dark body over it
    private void Shape(double x, double by, double s, params double[] p)
    {
        var o = TableauCurve.Closed(p); var rim = new double[o.Length]; var off = s * 0.03;
        for (var i = 0; i + 1 < o.Length; i += 2) { o[i] = x + o[i] * s; o[i + 1] = by + o[i + 1] * s; rim[i] = o[i] + off; rim[i + 1] = o[i + 1] - off * 0.6; }
        var root = C; C = _rimC; GB(_rim, 1, rim); C = _bodyC; GB(_dark, 1, o); C = root;
    }
    private Line Limb(double x, double by, double s, double x1, double y1, double x2, double y2, double th)
    {
        Line Make(Brush b, double dx, double dy) => new Line { X1 = x + x1 * s + dx, Y1 = by + y1 * s + dy, X2 = x + x2 * s + dx, Y2 = by + y2 * s + dy, Stroke = b, StrokeThickness = th * s, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round };
        _rimC.Children.Add(Make(_rim, s * 0.03, -s * 0.018)); var body = Make(_dark, 0, 0); _bodyC.Children.Add(body); return body;
    }

    protected override void OnBuild()
    {
        _boats.Clear(); _buoys.Clear(); _bulbs.Clear(); _lamps.Clear(); _streaks.Clear(); _clouds.Clear();
        var hy = Y(0.565); var rng = new Random(151);

        // ---- the sky: a sea night, still stars, a thin moon, slow cloud
        RB(0, 0, W, hy + 2, Vertical((Color.FromArgb(255, 0x03, 0x08, 0x16), 0), (Color.FromArgb(255, 0x08, 0x18, 0x2C), 0.55), (Color.FromArgb(255, 0x14, 0x30, 0x44), 1)));
        _stars = new Ellipse[90];
        for (var i = 0; i < _stars.Length; i++) _stars[i] = E(X(rng.NextDouble()), Y(rng.NextDouble() * 0.48), S(0.002 + 0.003 * rng.NextDouble() * rng.NextDouble()), White, 0.45);
        {
            double mx = X(0.74), my = Y(0.13), mr = S(0.034); var moon = Color.FromArgb(255, 0xF0, 0xF2, 0xE6);
            Glow(mx, my, mr * 8, Color.FromArgb(255, 0xB8, 0xD0, 0xF0), 0.22);
            var pts = new double[60];
            for (var i = 0; i < 15; i++)
            {
                var a = -Math.PI / 2 + Math.PI * i / 14; double ox = Math.Cos(a) * mr, oy = Math.Sin(a) * mr, ix = ox * 0.45; const double rot = 0.5;
                pts[i * 2] = mx + ox * Math.Cos(rot) - oy * Math.Sin(rot); pts[i * 2 + 1] = my + ox * Math.Sin(rot) + oy * Math.Cos(rot);
                var j = 29 - i; pts[j * 2] = mx + ix * Math.Cos(rot) - oy * Math.Sin(rot); pts[j * 2 + 1] = my + ix * Math.Sin(rot) + oy * Math.Cos(rot);
            }
            G(moon, 0.95, pts);
        }
        for (var i = 0; i < 6; i++)
        {
            var w = S(0.3 + 0.35 * rng.NextDouble());
            var c = Glow(0, 0, w, Color.FromArgb(255, 0x50, 0x70, 0x90), 0.4, 0.22); c.Height = w * 0.16;
            _clouds.Add((c, rng.NextDouble(), 0.1 + 0.3 * rng.NextDouble(), w));
        }
        _horizon = RB(0, hy - S(0.22), W, S(0.22), Vertical((A(P(1), 0), 0), (A(Mix(P(1), P(2), 0.5), 0.22), 1)));

        // ---- the far shore, a ship passing, the town on the quay
        var land = Color.FromArgb(255, 0x0A, 0x14, 0x20); var landB = B(land);
        void Hill(Color c, params double[] f) { for (var i = 0; i + 1 < f.Length; i += 2) { f[i] = X(f[i]); f[i + 1] = Y(f[i + 1]); } G(c, 1, TableauCurve.Closed(f, 4)); }
        Hill(Color.FromArgb(255, 0x10, 0x22, 0x34), -0.1, 0.55, 0.05, 0.535, 0.2, 0.545, 0.4, 0.552, 0.55, 0.535, 0.7, 0.47, 0.86, 0.43, 1.0, 0.45, 1.15, 0.42, 1.2, 0.7, -0.2, 0.7);
        for (var i = 0; i < 16; i++) E(X(0.02 + 0.5 * rng.NextDouble()), hy - S(0.004 + 0.012 * rng.NextDouble()), S(0.004), Cream, 0.55);
        {
            var ship = new Canvas(); C.Children.Add(ship); _ship = new TranslateTransform(); ship.RenderTransform = _ship; var root = C; C = ship; var u = S(0.004);
            G(land, 1, -u * 9, hy - u * 1.6, u * 9, hy - u * 1.6, u * 8, hy + 1, -u * 8, hy + 1); RB(-u * 5, hy - u * 3.6, u * 4, u * 2, landB); RB(-u * 3.6, hy - u * 5.4, u * 1.2, u * 1.8, landB);
            for (var i = 0; i < 5; i++) E(-u * 6 + i * u * 3, hy - u * 2.2, u * 0.9, Cream, 0.9);
            E(-u * 3, hy - u * 5.8, u * 1.0, Color.FromArgb(255, 0xFF, 0x60, 0x50), 0.9);
            C = root;
        }
        var quayTop = Y(0.535); var houseBands = new List<double>(); _windows.Clear();
        for (var x = X(0.57); x < W + S(0.02);)
        {
            var house = houseBands.Count; houseBands.Add(0.04 + 0.86 * Clamp01((x - X(0.57)) / (W - X(0.57))));
            var bw = S(0.055 + 0.035 * rng.NextDouble()); var bh = S(0.085 + 0.08 * rng.NextDouble()); var tint = P(rng.Next(3));
            var wall = Mix(Color.FromArgb(255, 0x12, 0x1C, 0x2A), tint, 0.14); var roof = Color.FromArgb(255, 0x0C, 0x12, 0x1C);
            RB(x, quayTop - bh, bw, bh + 1, Vertical((wall, 0), (Mix(wall, land, 0.5), 1)));
            GB(B(roof), 1, x - bw * 0.04, quayTop - bh + 1, x + bw / 2, quayTop - bh - bw * (0.3 + 0.2 * rng.NextDouble()), x + bw * 1.04, quayTop - bh + 1);
            if (rng.NextDouble() < 0.6) RB(x + bw * 0.68, quayTop - bh - bw * 0.36, bw * 0.12, bw * 0.3, B(roof));
            var rows = (int)(bh / S(0.034)); var cols = bw > S(0.07) ? 3 : 2;
            for (var row = 0; row < rows; row++)
                for (var c = 0; c < cols; c++)
                {
                    var on = rng.NextDouble() < 0.55; double wx = x + bw * (0.16 + 0.68 * c / Math.Max(1, cols - 1)) - S(0.006), wyy = quayTop - bh + S(0.014) + row * S(0.034);
                    var rest = on ? 0.6 + 0.35 * rng.NextDouble() : 0; var mark = 0.45 + 0.4 * rng.NextDouble();
                    RB(wx, wyy, S(0.012), S(0.017), B(Color.FromArgb(255, 0x0A, 0x10, 0x18)));
                    _windows.Add((RB(wx, wyy, S(0.012), S(0.017), B(Mix(Cream, tint, 0.15)), rest), house, rest, mark));
                }
            x += bw + S(0.003);
        }
        _houseBand = houseBands.ToArray(); _houseLv = new double[_houseBand.Length];
        RB(X(0.55), quayTop, W, hy - quayTop + S(0.02), Vertical((Color.FromArgb(255, 0x1A, 0x22, 0x2E), 0), (Color.FromArgb(255, 0x0A, 0x10, 0x18), 1)));

        // ---- the lighthouse on its rock, and its two beams
        _lx = X(0.2); var foot = hy - S(0.03); var th = S(0.3); _ly = foot - th - S(0.022);
        {
            Hill(land, 0.09, 0.575, 0.12, 0.545, 0.165, 0.522, 0.215, 0.515, 0.26, 0.535, 0.31, 0.56, 0.33, 0.6, 0.07, 0.6);
            double wb = S(0.03), wt = S(0.018); var pale = Color.FromArgb(255, 0x8C, 0x9C, 0xB0); var red = Color.FromArgb(255, 0x8E, 0x30, 0x36);
            for (var i = 0; i < 5; i++)
            {
                double t0 = i / 5.0, t1 = (i + 1) / 5.0, w0 = wb + (wt - wb) * t0, w1 = wb + (wt - wb) * t1, y0 = foot - th * t0, y1 = foot - th * t1 - 0.5;
                G(i % 2 == 0 ? pale : red, 1, _lx - w0, y0, _lx + w0, y0, _lx + w1, y1, _lx - w1, y1);
            }
            G(Dark, 0.42, _lx + wb * 0.1, foot, _lx + wb, foot, _lx + wt, foot - th, _lx + wt * 0.1, foot - th);
            RB(_lx - S(0.005), foot - S(0.03), S(0.01), S(0.03), B(Dark)); RB(_lx - S(0.004), foot - th * 0.5, S(0.008), S(0.014), B(Dark)); RB(_lx - S(0.004), foot - th * 0.78, S(0.008), S(0.012), B(Dark));
            RB(_lx - wt * 1.6, foot - th - S(0.006), wt * 3.2, S(0.008), B(Dark));
            _lampGlow = Glow(_lx, _ly, S(0.16), Mix(Cream, White, 0.4), 0.8, 0.7);
            RB(_lx - wt * 0.85, foot - th - S(0.036), wt * 1.7, S(0.03), B(Mix(Cream, White, 0.5)), 0.95);
            L(_lx, foot - th - S(0.036), _lx, foot - th - S(0.006), Dark, Math.Max(1, S(0.002))); L(_lx - wt * 0.85, foot - th - S(0.036), _lx - wt * 0.85, foot - th - S(0.006), Dark, Math.Max(1, S(0.0025))); L(_lx + wt * 0.85, foot - th - S(0.036), _lx + wt * 0.85, foot - th - S(0.006), Dark, Math.Max(1, S(0.0025)));
            G(Dark, 1, _lx - wt * 1.15, foot - th - S(0.035), _lx, foot - th - S(0.062), _lx + wt * 1.15, foot - th - S(0.035));
            var ray = Mix(Cream, White, 0.55);
            LinearGradientBrush Across(bool right)
            {
                var g = new LinearGradientBrush { StartPoint = new Pt(right ? 0 : 1, 0.5), EndPoint = new Pt(right ? 1 : 0, 0.5) };
                g.GradientStops.Add(new GradientStop { Color = A(ray, 0.85), Offset = 0 }); g.GradientStops.Add(new GradientStop { Color = A(ray, 0.3), Offset = 0.45 }); g.GradientStops.Add(new GradientStop { Color = A(ray, 0), Offset = 1 });
                return g;
            }
            _beamR = GB(Across(true), 0.5, _lx, _ly, _lx + 10, _ly - 2, _lx + 10, _ly + 2);
            _beamL = GB(Across(false), 0.5, _lx, _ly, _lx - 10, _ly - 2, _lx - 10, _ly + 2);
            _lampFlare = Glow(_lx, _ly, S(0.2), White, 1, 0);
        }

        // ---- the sea, far to near, with everything that floats set between its bands
        var band = 0;
        Swell(0, Y(0.585), S(0.004), S(0.28), 0.9, Color.FromArgb(255, 0x18, 0x3A, 0x50), Color.FromArgb(255, 0x0C, 0x20, 0x34));
        _towerRefl = RB(_lx - S(0.012), Y(0.59), S(0.024), S(0.3), Vertical((A(Cream, 0.5), 0), (A(Cream, 0.12), 0.5), (A(Cream, 0), 1)), 0.5);
        for (var j = 0; j < 9; j++)
        {
            var x = X(0.59 + 0.4 * j / 8.0); var c = Mix(P(0), Cream, 0.45); var bd = j / 8.0;
            L(x, quayTop, x, quayTop - S(0.03), Dark, Math.Max(1, S(0.0025)));
            _lamps.Add((Glow(x, quayTop - S(0.032), S(0.05), c, 0.95, 0.6), RB(x - S(0.005), Y(0.59), S(0.01), S(0.05), Vertical((A(c, 0.7), 0), (A(c, 0), 1)), 0.5), bd, rng.NextDouble() * 6));
            E(x, quayTop - S(0.032), S(0.007), Mix(c, White, 0.6));
        }
        for (var i = 0; i < 14; i++) Streak(X(0.6 + 0.4 * rng.NextDouble()), Y(0.592), S(0.006), S(0.02 + 0.03 * rng.NextDouble()), Cream, 0.5, 0.4, rng);
        Boat(0.49, 0, S(0.012), 0, true, P(1), ref band, rng);
        Swell(1, Y(0.655), S(0.006), S(0.4), 0.8, Color.FromArgb(255, 0x14, 0x32, 0x48), Color.FromArgb(255, 0x0A, 0x1C, 0x2E));
        for (var i = 0; i < 10; i++) Streak(X(0.58 + 0.42 * rng.NextDouble()), Y(0.665 + 0.03 * rng.NextDouble()), S(0.02 + 0.03 * rng.NextDouble()), Math.Max(1.5, S(0.003)), Cream, 0.5, 0.3, rng);
        for (var i = 0; i < 6; i++) Streak(_lx + S(0.03) * (rng.NextDouble() - 0.5), Y(0.665 + 0.05 * rng.NextDouble()), S(0.02 + 0.03 * rng.NextDouble()), Math.Max(1.5, S(0.003)), Cream, 0.6, 0.35, rng);
        Buoy(0.33, 1, S(0.009), Color.FromArgb(255, 0xFF, 0x50, 0x48)); Buoy(0.9, 1, S(0.009), Color.FromArgb(255, 0x50, 0xF0, 0x90));
        Boat(0.72, 1, S(0.019), 1, false, P(0), ref band, rng);
        Swell(2, Y(0.74), S(0.008), S(0.55), 0.7, Color.FromArgb(255, 0x10, 0x2A, 0x40), Color.FromArgb(255, 0x08, 0x16, 0x26));
        Boat(0.37, 2, S(0.027), 0, false, P(2), ref band, rng);
        Swell(3, Y(0.83), S(0.01), S(0.75), 0.6, Color.FromArgb(255, 0x0C, 0x22, 0x36), Color.FromArgb(255, 0x06, 0x10, 0x1E));
        Swell(4, Y(0.92), S(0.012), S(0.95), 0.5, Color.FromArgb(255, 0x08, 0x1A, 0x2C), Color.FromArgb(255, 0x04, 0x0A, 0x14));
        _bulbLv = new double[_bulbs.Count];

        // ---- the dock in front: posts, a lantern, a cat, a gull
        _rim = B(Mix(P(0), Cream, 0.5)); _dark = B(Dark);
        _rimC = new Canvas(); C.Children.Add(_rimC); _bodyC = new Canvas(); C.Children.Add(_bodyC);
        {
            double x0 = X(0.56), yl = Y(0.905), yr = Y(0.885); var root = C;
            double DockY(double x) => yl + (yr - yl) * (x - x0) / (W - x0);
            C = _rimC; L(x0, yl - S(0.003), W, yr - S(0.003), Mix(P(0), Cream, 0.5), Math.Max(1.5, S(0.004)));
            C = _bodyC; G(Dark, 1, x0, yl, W + 2, yr, W + 2, H + 2, x0 + S(0.02), H + 2); C = root;
            foreach (var fx in new[] { 0.585, 0.715, 0.845, 0.975 })
            {
                var x = X(fx); var top = DockY(x) - S(0.05);
                C = _rimC; RB(x - S(0.011) + S(0.004), top - S(0.003), S(0.022), S(0.1), _rim); C = _bodyC; RB(x - S(0.011), top, S(0.022), H - top, _dark); C = root;
            }
            {   // the lantern post
                var x = X(0.9); double by = DockY(x), top = Y(0.6);
                C = _bodyC; L(x, by, x, top, Dark, Math.Max(2, S(0.007))); L(x, top, x - S(0.05), top - S(0.012), Dark, Math.Max(2, S(0.005))); L(x - S(0.05), top - S(0.012), x - S(0.05), top + S(0.012), Dark, Math.Max(1, S(0.002))); C = root;
                _lantern = Glow(x - S(0.05), top + S(0.03), S(0.3), Mix(P(0), Cream, 0.4), 0.55, 0.7);
                RB(x - S(0.061), top + S(0.012), S(0.022), S(0.032), B(Mix(Cream, White, 0.3))); RB(x - S(0.065), top + S(0.008), S(0.03), S(0.006), B(Dark)); RB(x - S(0.065), top + S(0.042), S(0.03), S(0.005), B(Dark));
            }
            {   // the cat, watching the boats
                var x = X(0.655); double by = DockY(x) + S(0.004), s = S(0.105);
                Shape(x, by, s, -0.2, 0.02, -0.24, -0.3, -0.14, -0.58, 0.04, -0.62, 0.17, -0.34, 0.2, 0.02);
                Shape(x, by, s, -0.06, -0.86, 0.07, -0.84, 0.12, -0.72, 0.07, -0.6, -0.08, -0.58, -0.17, -0.68, -0.15, -0.8);
                Shape(x, by, s, -0.16, -0.76, -0.17, -0.98, -0.05, -0.84); Shape(x, by, s, 0.0, -0.84, 0.1, -0.98, 0.11, -0.78);
                var tail = Limb(x, by, s, 0.17, -0.03, 0.42, -0.02, 0.06); _tail = new RotateTransform { CenterX = x + 0.17 * s, CenterY = by - 0.03 * s }; tail.RenderTransform = _tail;
            }
            {   // the gull on its post
                var x = X(0.715); double by = DockY(x) - S(0.05), s = S(0.05); var gull = Color.FromArgb(255, 0xB4, 0xC0, 0xCC);
                L(x - 0.1 * s, by, x - 0.1 * s, by - 0.3 * s, Color.FromArgb(255, 0xC8, 0x90, 0x50), Math.Max(1, s * 0.05)); L(x + 0.1 * s, by, x + 0.1 * s, by - 0.3 * s, Color.FromArgb(255, 0xC8, 0x90, 0x50), Math.Max(1, s * 0.05));
                var body = TableauCurve.Closed(new[] { -0.75, -0.5, -0.3, -0.72, 0.2, -0.78, 0.45, -0.6, 0.3, -0.36, -0.2, -0.28 });
                for (var i = 0; i + 1 < body.Length; i += 2) { body[i] = x + body[i] * s; body[i + 1] = by + body[i + 1] * s; }
                G(gull, 0.9, body); G(Color.FromArgb(255, 0x60, 0x6C, 0x7C), 0.9, x - 0.95 * s, by - 0.52 * s, x - 0.2 * s, by - 0.66 * s, x - 0.3 * s, by - 0.42 * s);
                E(x + 0.42 * s, by - 0.86 * s, 0.34 * s, gull, 0.95); G(Color.FromArgb(255, 0xE0, 0xA0, 0x40), 1, x + 0.55 * s, by - 0.9 * s, x + 0.86 * s, by - 0.8 * s, x + 0.55 * s, by - 0.76 * s);
            }
        }
        Vignette(0.3);
    }

    private void Float(Floater b)
    {
        var y = WaveY(b.Layer, b.X); var slope = (WaveY(b.Layer, b.X + b.Half) - WaveY(b.Layer, b.X - b.Half)) / (2 * b.Half);
        b.T.TranslateX = b.X; b.T.TranslateY = y + b.Sink; b.T.Rotation = Math.Atan(slope) * 57.3 * b.Tip;
        if (b.Refl is { } r) At(r, b.X - r.Width / 2 + Math.Sin(_tw * 1.7 + b.X) * S(0.003), y + b.Sink * (r is Ellipse ? 0.4 : 2.4));
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;
        Twinkle(_stars, f, 0.35);

        // ---- the beat: the lamp, the mast lights, a buoy in turn
        _sinceBeat += dt;
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.2) { _sinceBeat = 0; _beats++; }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 4.2);
        _idle += dts * 0.9; _tw += dts;

        // ---- the swell rises and runs with the lows
        _swell += ((f.Reduced ? 0.3 : f.Low) - _swell) * 0.06;
        for (var l = 0; l < Layers; l++)
        {
            _ph[l] += dts * _rate[l] * (0.7 + 0.9 * _swell); _now[l] = _amp[l] * (0.5 + 2.4 * _swell);
            var p = _wave[l].Points; var crest = _crest[l].Points;
            for (var j = 0; j <= M; j++) { var x = -4 + (W + 8) * j / M; var pt = new Pt(x, WaveY(l, x)); p[j] = pt; crest[j] = pt; }
        }
        for (var i = 0; i < _boats.Count; i++)
        {
            var b = _boats[i]; Float(b);
            if (b.Light is { } m) Op(m, 0.45 + 0.55 * _flare);
            if (b.Refl is { } r) Op(r, 0.4 + 0.3 * f.Loud + 0.25 * _flare);
        }
        for (var i = 0; i < _buoys.Count; i++)
        {
            var b = _buoys[i]; Float(b);
            var on = (_beats + i) % 2 == 0 ? _flare : 0;
            var slow = f.Reduced ? Math.Pow(Osc(_idle, 1.3, i * 3.1), 8) : 0;
            if (b.Light is { } m) Op(m, 0.12 + 0.88 * Math.Max(on, slow));
            if (b.Refl is { } r) Op(r, 0.15 + 0.6 * Math.Max(on, slow));
        }

        // ---- the bulbs on the boats and the lamps on the quay: a light a band
        for (var i = 0; i < _bulbs.Count; i++)
        {
            var (glow, core, band) = _bulbs[i];
            var target = f.Reduced ? 0.35 + 0.25 * Math.Sin(_idle + i * 0.45) : Clamp01(Lv(f, band) * 1.2 + 0.25 * _flare);
            _bulbLv[i] += (target - _bulbLv[i]) * (target > _bulbLv[i] ? 0.55 : 0.16);
            Op(glow, 0.08 + 0.9 * _bulbLv[i]); Op(core, 0.45 + 0.55 * _bulbLv[i]);
        }
        for (var i = 0; i < _houseLv.Length; i++) { var target = f.Reduced ? 0.5 : Clamp01(Lv(f, _houseBand[i]) * 1.2 + 0.15 * _flare); _houseLv[i] += (target - _houseLv[i]) * (target > _houseLv[i] ? 0.5 : 0.12); }
        for (var i = 0; i < _windows.Count; i++)
        {
            var (r, house, rest, mark) = _windows[i]; var lv = _houseLv[house];
            Op(r, f.Reduced ? rest : rest > 0 ? rest * (0.4 + 0.75 * lv) : 0.85 * Clamp01((lv - mark) * 5));
        }
        for (var i = 0; i < _lamps.Count; i++)
        {
            var (glow, refl, band, ph) = _lamps[i];
            var lv = f.Reduced ? 0.4 + 0.2 * Math.Sin(_idle * 0.7 + i) : Clamp01(Lv(f, band) * 1.15 + 0.2 * _flare);
            Op(glow, 0.35 + 0.65 * lv); refl.Height = S(0.03 + 0.12 * lv); Op(refl, (0.3 + 0.6 * lv) * (0.7 + 0.3 * Osc(_tw, 2.1, ph)));
        }
        for (var i = 0; i < _streaks.Count; i++) { var (r, op, ph) = _streaks[i]; Op(r, op * (0.35 + 0.65 * Osc(_tw, 1.6 + i % 4 * 0.5, ph))); }

        // ---- the lighthouse turns with the mids: the beams shorten as they swing toward the eye, the lamp flares when one points out
        _turn += dts * (0.45 + 1.0 * f.Mid);
        double c = Math.Abs(Math.Cos(_turn)), toward = Math.Pow(Math.Abs(Math.Sin(_turn)), 10);
        double len = W * 0.85 * c + S(0.03), spread = S(0.012) + len * 0.075;
        var pr = _beamR.Points; pr[1] = new Pt(_lx + len, _ly - spread); pr[2] = new Pt(_lx + len, _ly + spread);
        var pl = _beamL.Points; pl[1] = new Pt(_lx - len, _ly - spread); pl[2] = new Pt(_lx - len, _ly + spread);
        var beam = (0.3 + 0.4 * c) * (0.65 + 0.35 * f.High);
        Op(_beamR, beam); Op(_beamL, beam);
        var flash = Math.Max(toward, _flare * 0.7);
        Size(_lampFlare, _lx, _ly, S(0.1) + S(0.26) * flash); Op(_lampFlare, 0.85 * flash);
        Op(_lampGlow, 0.6 + 0.4 * flash); Op(_towerRefl, 0.3 + 0.55 * flash + 0.1 * f.Loud);
        Op(_horizon, 0.5 + 0.4 * f.Loud);

        // ---- the sky and the far ship drift; the lantern breathes; the cat's tail
        _cloud += dts * 0.004;
        for (var i = 0; i < _clouds.Count; i++)
        {
            var (cl, x, y, w) = _clouds[i];
            Size(cl, X((x + _cloud * (0.7 + 0.2 * (i % 3)) + 0.3) % 1.6 - 0.3), Y(y), w, w * 0.16);
        }
        _shipX = (_shipX + dts * 0.0035) % 0.6; _ship.X = X(-0.03 + _shipX);
        Op(_lantern, 0.55 + 0.25 * f.Loud + 0.2 * _flare); Op(_rimC, 0.45 + 0.3 * f.Loud + 0.25 * _flare);
        _wag += dts * (1.2 + 3 * f.Loud); _tail.Angle = -30 + 28 * Math.Sin(_wag);
    }
}
