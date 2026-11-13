using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== COMMUNITY: Street Fair (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A street fair at night (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The big wheel is the meter: twenty-four spokes, a band a spoke, and the bulbs on a spoke light from the hub outward as its band
/// rises, so the wheel is a round sound meter that turns with the loudness. The carousel turns with it and its horses rise and fall
/// with their bands. The strength tower in the middle is a meter too: the puck climbs with the low notes, lights the marks it
/// passes and rings the bell at the top. The stalls glow with their bands, the strings of bulbs chase, and the crowd in front
/// jumps on a beat.
///
/// Every shape is made once in OnBuild. The wheel is one group on one transform, a horse and a gondola are one group each, so a
/// frame allocates nothing.
/// </summary>
public sealed class StreetFair : Tableau
{
    private const int Spokes = 24, Per = 7, RimN = 48, Gond = 12, Horses = 6, Marks = 12;
    private readonly Line[] _bar = new Line[Spokes];
    private readonly Ellipse[] _bulb = new Ellipse[Spokes * Per], _rimB = new Ellipse[RimN];
    private readonly double[] _dx = new double[Spokes], _dy = new double[Spokes], _lv = new double[Spokes];
    private readonly TranslateTransform[] _gond = new TranslateTransform[Gond];
    private readonly CompositeTransform[] _horse = new CompositeTransform[Horses];
    private readonly UIElement[] _horseC = new UIElement[Horses];
    private readonly int[] _horseZ = new int[Horses];
    private readonly (Ellipse glow, Ellipse core)[] _mark = new (Ellipse, Ellipse)[Marks];
    private readonly List<(Ellipse glow, Ellipse core, int i)> _garland = new(), _canopy = new();
    private readonly List<(Ellipse glow, Rectangle front, double band)> _stalls = new();
    private readonly List<(RotateTransform rt, double ph)> _balloons = new();
    private readonly TranslateTransform[] _rowT = new TranslateTransform[2];
    private readonly Canvas[] _rowRim = new Canvas[2];
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private RotateTransform _wheelT = null!;
    private Ellipse _wheelGlow = null!, _hubGlow = null!, _bellGlow = null!, _carGlow = null!;
    private Rectangle _puck = null!, _haze = null!, _carLight = null!;
    private Canvas _rimC = null!, _bodyC = null!;
    private SolidColorBrush _rim = null!, _dark = null!;
    private double _gy, _wx, _wy, _wr, _ccx, _cw, _sx, _sBase, _sTrack;
    private double _wheel, _car = 0.4, _bob, _chase, _puckLv, _flare, _prevBeat, _sinceBeat = 9, _idle, _tw, _bell;
    private int _beats;

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Cream = Rgb(0xFFE8BC), Ink = Rgb(0x07050F), Night = Rgb(0x1A1432);
    private Color Hue(double bd) { var t = Math.Clamp(bd, 0, 0.9999) * 3; var k = (int)t; return Mix(P(k), P(k + 1), t - k); }
    private Ellipse Ring(double cx, double cy, double d, Color col, double th, double op = 1)
    {
        var e = new Ellipse { Width = d, Height = d, Stroke = B(col), StrokeThickness = th, Opacity = op }; At(e, cx - d / 2, cy - d / 2); C.Children.Add(e); return e;
    }
    private Line Cap(Line l) { l.StrokeStartLineCap = PenLineCap.Round; l.StrokeEndLineCap = PenLineCap.Round; return l; }
    private void Stripes(double xa, double xb, double ya, double xc, double xd, double yb, int n, Color col)
    {
        for (var k = 0; k < n; k++)
        {
            double t0 = k / (double)n, t1 = (k + 1) / (double)n;
            G(k % 2 == 0 ? col : Mix(Cream, Night, 0.25), 1, xa + (xb - xa) * t0, ya, xa + (xb - xa) * t1 + 0.5, ya, xc + (xd - xc) * t1 + 0.5, yb, xc + (xd - xc) * t0, yb);
        }
    }

    protected override void OnBuild()
    {
        _garland.Clear(); _canopy.Clear(); _stalls.Clear(); _balloons.Clear();
        var rng = new Random(211);
        _gy = Y(0.87); _sx = X(0.435);

        // ---- the sky over the fair, and the town behind it
        RB(0, 0, W, _gy + 2, Vertical((Rgb(0x06041A), 0), (Rgb(0x140E38), 0.45), (Rgb(0x341A4C), 0.8), (Rgb(0x58284E), 1)));
        _stars = Stars(70, 0.45, White, 23);
        _haze = RB(0, _gy - S(0.4), W, S(0.4), Vertical((A(P(1), 0), 0), (A(Mix(P(1), P(0), 0.4), 0.3), 1)));
        for (var x = -S(0.02); x < W;)
        {
            var bw = S(0.05 + 0.07 * rng.NextDouble()); var bh = S(0.04 + 0.1 * rng.NextDouble()); var wall = Rgb(0x130D26);
            RB(x, _gy - bh, bw, bh + 1, B(wall));
            if (rng.NextDouble() < 0.5) G(wall, 1, x, _gy - bh + 1, x + bw / 2, _gy - bh - bw * 0.3, x + bw, _gy - bh + 1);
            for (var k = 0; k < 4; k++) if (rng.NextDouble() < 0.5) RB(x + bw * (0.15 + 0.6 * rng.NextDouble()), _gy - bh * (0.25 + 0.6 * rng.NextDouble()), S(0.008), S(0.011), B(Mix(Cream, P(1), 0.4)), 0.45);
            x += bw;
        }
        RB(0, _gy, W, H - _gy + 2, Vertical((Rgb(0x1C1434), 0), (Rgb(0x0A0716), 1)));

        Garland(0.435, 0.225, 1.03, 0.02, 0.05, 14, 0.028);
        BuildWheel(rng);
        BuildCarousel(rng);
        Stall(0.47, 0.57, 0.5, P(2), rng); Stall(0.79, 0.895, 0.15, P(0), rng); Stall(0.905, 1.02, 0.85, P(3), rng);
        BuildStriker();
        Garland(-0.03, 0.14, 0.435, 0.225, 0.1, 16, 0.036);
        BuildCrowd(rng);
        Vignette(0.3);
    }

    private void Garland(double fx0, double fy0, double fx1, double fy1, double sag, int count, double size)
    {
        var cord = PL(B(Rgb(0x1A1430)), Math.Max(1, S(0.0025)));
        for (var i = 0; i <= 40; i++) { var t = i / 40.0; cord.Points.Add(new Pt(X(fx0 + (fx1 - fx0) * t), Y(fy0 + (fy1 - fy0) * t + sag * 4 * t * (1 - t)))); }
        for (var i = 0; i < count; i++)
        {
            var t = (i + 0.5) / count; double bx = X(fx0 + (fx1 - fx0) * t), by = Y(fy0 + (fy1 - fy0) * t + sag * 4 * t * (1 - t)) + S(size * 0.2);
            var col = P(i % 4);
            _garland.Add((Glow(bx, by, S(size), col, 0.9, 0.4), E(bx, by, S(size * 0.24), Mix(col, White, 0.6), 0.9), _garland.Count));
        }
    }

    private void BuildWheel(Random rng)
    {
        _wx = X(0.67); _wy = Y(0.43); var r = _wr = Math.Min(S(0.33), W * 0.3);
        _wheelGlow = Glow(_wx, _wy, r * 3.1, P(3), 0.22, 0.6);
        L(_wx, _wy, _wx - r * 0.4, _gy, Rgb(0x120D26), S(0.012)); L(_wx, _wy, _wx + r * 0.4, _gy, Rgb(0x120D26), S(0.012));
        var g = new Canvas(); C.Children.Add(g); At(g, _wx, _wy); _wheelT = new RotateTransform(); g.RenderTransform = _wheelT; var root = C; C = g;
        Ring(0, 0, 2 * r, Rgb(0x54447C), S(0.006)); Ring(0, 0, 1.86 * r, Rgb(0x3C305E), S(0.004)); Ring(0, 0, 1.0 * r, Rgb(0x2E2648), S(0.003)); Ring(0, 0, 0.3 * r, Rgb(0x3C305E), S(0.004));
        for (var i = 0; i < Spokes; i++)
        {
            var a = i * 2 * Math.PI / Spokes; double dx = _dx[i] = Math.Cos(a), dy = _dy[i] = Math.Sin(a); var col = Hue(i / 23.0);
            L(dx * r * 0.1, dy * r * 0.1, dx * r, dy * r, Rgb(0x2E2648), Math.Max(1, S(0.003)));
            _bar[i] = Cap(L(dx * r * 0.13, dy * r * 0.13, dx * r * 0.2, dy * r * 0.2, col, S(0.021), 0.32));
            for (var j = 0; j < Per; j++) { var rr = r * (0.17 + 0.76 * j / (Per - 1)); _bulb[i * Per + j] = E(dx * rr, dy * rr, S(0.0125), Mix(col, White, 0.45), 0.2); }
            _lv[i] = 0.3;
        }
        for (var i = 0; i < RimN; i++) { var a = (i + 0.5) * 2 * Math.PI / RimN; _rimB[i] = E(Math.Cos(a) * r, Math.Sin(a) * r, S(0.0085), Cream, 0.5); }
        C = root;
        var frame = Rgb(0x221A3E);
        L(_wx, _wy, _wx - r * 0.5, _gy, frame, S(0.013)); L(_wx, _wy, _wx + r * 0.5, _gy, frame, S(0.013));
        var by = _wy + (_gy - _wy) * 0.62; L(_wx - r * 0.31, by, _wx + r * 0.31, by, frame, S(0.008));
        E(_wx, _wy, r * 0.2, Rgb(0x2A2048)); _hubGlow = Glow(_wx, _wy, r * 0.55, Mix(P(1), White, 0.4), 0.9, 0.5); E(_wx, _wy, r * 0.075, Cream);
        var gs = S(0.042);
        for (var i = 0; i < Gond; i++)
        {
            var c = new Canvas(); C.Children.Add(c); _gond[i] = new TranslateTransform(); c.RenderTransform = _gond[i]; C = c; var col = Mix(P(i % 4), Night, 0.3);
            L(0, 0, 0, gs * 0.45, Rgb(0x0E0A1E), Math.Max(1, S(0.003))); E(0, 0, S(0.009), Rgb(0x54447C));
            G(Mix(col, Ink, 0.5), 1, -gs * 0.62, gs * 0.47, 0, gs * 0.2, gs * 0.62, gs * 0.47);
            var body = RB(-gs * 0.5, gs * 0.45, gs, gs * 0.62, Vertical((col, 0), (Mix(col, Ink, 0.5), 1))); body.RadiusX = body.RadiusY = gs * 0.12;
            RB(-gs * 0.36, gs * 0.53, gs * 0.72, gs * 0.24, B(Cream), 0.85); L(0, gs * 0.53, 0, gs * 0.77, Mix(col, Ink, 0.5), Math.Max(1, gs * 0.06));
            C = root;
        }
        // the ticket booth at its foot
        double bx = _wx - S(0.04), bt = _gy - S(0.1);
        RB(bx, bt, S(0.08), S(0.1), Vertical((Rgb(0x2E2040), 0), (Rgb(0x181028), 1))); Stripes(bx - S(0.008), bx + S(0.088), bt, bx - S(0.008), bx + S(0.088), bt + S(0.022), 6, Mix(P(1), Night, 0.25));
        RB(bx + S(0.018), bt + S(0.036), S(0.044), S(0.03), B(Cream), 0.8);
    }

    private void BuildCarousel(Random rng)
    {
        _ccx = X(0.2); var cw = _cw = Math.Min(S(0.44), W * 0.36); double hw = cw * 0.54, eave = _gy - S(0.36), apex = _gy - S(0.5), val = S(0.036);
        _carGlow = Glow(_ccx, _gy - S(0.2), cw * 1.7, P(1), 0.25, 0.6);
        RB(_ccx - cw * 0.47, eave, cw * 0.94, _gy - eave, Vertical((Rgb(0x3A2440), 0), (Rgb(0x22162E), 1)));
        _carLight = RB(_ccx - cw * 0.47, eave, cw * 0.94, _gy - eave, Vertical((A(Mix(P(1), Cream, 0.5), 0.5), 0), (A(P(1), 0.18), 1)));
        // the drum in the middle is solid (2026-11-11, the far horses showed through the middle): the drum and the horses share one group,
        // and a horse on the far side of the round is put behind the drum, one on the near side in front of it
        var outer = C; var grp = new Canvas(); outer.Children.Add(grp); C = grp;
        double dw = cw * 0.4, dl = _ccx - dw / 2;
        RB(dl, eave, dw, _gy - eave, new LinearGradientBrush { StartPoint = new Pt(0, 0), EndPoint = new Pt(1, 0), GradientStops = {
            new GradientStop { Color = Mix(P(0), Night, 0.62), Offset = 0 }, new GradientStop { Color = Mix(Mix(P(0), Cream, 0.35), Night, 0.18), Offset = 0.5 }, new GradientStop { Color = Mix(P(0), Night, 0.62), Offset = 1 } } });
        for (var k = 0; k < 4; k++)
        {
            // four panels round the drum, each a mirror in a frame, narrower toward the drum's edges as a round thing shows them
            double u0 = Math.Sin((k - 2) * Math.PI / 5) * 0.5 + 0.5, u1 = Math.Sin((k - 1) * Math.PI / 5) * 0.5 + 0.5; double px0 = dl + dw * (0.5 + (u0 - 0.5) * 1.5), px1 = dl + dw * (0.5 + (u1 - 0.5) * 1.5);
            px0 = Math.Max(dl, px0) + S(0.006); px1 = Math.Min(dl + dw, px1) - S(0.006); if (px1 - px0 < S(0.008)) continue;
            RB(px0, eave + val + S(0.02), px1 - px0, _gy - eave - val - S(0.075), Vertical((A(Cream, 0.34), 0), (A(Mix(P(1), Cream, 0.4), 0.16), 1)));
            L(px0, eave + val + S(0.02), px0, _gy - S(0.055), Mix(P(2), Cream, 0.5), Math.Max(1, S(0.003)), 0.7); L(px1, eave + val + S(0.02), px1, _gy - S(0.055), Mix(P(2), Cream, 0.5), Math.Max(1, S(0.003)), 0.7);
        }
        RB(dl - S(0.004), _gy - S(0.05), dw + S(0.008), S(0.05), Vertical((Mix(P(2), Cream, 0.3), 0), (Mix(P(2), Night, 0.55), 1)));
        var s = S(0.085); var root = C;
        for (var i = 0; i < Horses; i++)
        {
            var c = new Canvas(); C.Children.Add(c); _horse[i] = new CompositeTransform(); c.RenderTransform = _horse[i]; _horseC[i] = c; C = c;
            var coat = Mix(Mix(Rgb(0xF4E8D8), P(i % 4), 0.18), Night, 0.12); var shade = Mix(coat, Night, 0.45);
            L(0.02 * s, -2.7 * s, 0.02 * s, 1.3 * s, Mix(P(1), Cream, 0.4), Math.Max(1.5, 0.045 * s));
            void Leg(Color col, params double[] p) { for (var q = 0; q + 3 < p.Length; q += 2) Cap(L(p[q] * s, p[q + 1] * s, p[q + 2] * s, p[q + 3] * s, col, 0.085 * s)); }
            Leg(shade, 0.3, 0.02, 0.34, 0.3, 0.2, 0.44); Leg(shade, -0.3, 0.04, -0.26, 0.3, -0.42, 0.46);
            var tail = TableauCurve.Closed(new[] { -0.48, -0.22, -0.72, -0.1, -0.84, 0.16, -0.66, 0.04, -0.5, -0.04 }); for (var q = 0; q < tail.Length; q++) tail[q] *= s; G(Mix(P(i % 4), Night, 0.3), 1, tail);
            var o = TableauCurve.Closed(new[] { -0.5, -0.05, -0.45, -0.25, -0.1, -0.3, 0.2, -0.32, 0.42, -0.62, 0.55, -0.82, 0.66, -0.74, 0.86, -0.52, 0.8, -0.44, 0.6, -0.5, 0.5, -0.3, 0.48, -0.02, 0.2, 0.08, -0.3, 0.06, -0.48, 0.05 });
            for (var q = 0; q < o.Length; q++) o[q] *= s; GB(Vertical((coat, 0), (shade, 1)), 1, o);
            Leg(coat, 0.38, 0.0, 0.6, 0.22, 0.5, 0.42); Leg(coat, -0.38, 0.02, -0.5, 0.26, -0.7, 0.38);
            G(Mix(P((i + 2) % 4), Night, 0.15), 1, -0.12 * s, -0.33 * s, 0.14 * s, -0.35 * s, 0.17 * s, -0.16 * s, -0.15 * s, -0.14 * s);
            G(Mix(P(i % 4), Night, 0.3), 1, 0.36 * s, -0.56 * s, 0.5 * s, -0.8 * s, 0.56 * s, -0.78 * s, 0.46 * s, -0.5 * s);
            C = root;
        }
        C = outer;
        // the canopy: a striped cone, a valance with a row of bulbs, a ball on top
        for (var k = 0; k < 9; k++)
        {
            double x0 = _ccx - hw + 2 * hw * k / 9, x1 = _ccx - hw + 2 * hw * (k + 1) / 9; var col = k % 2 == 0 ? Mix(P(0), Night, 0.3) : Mix(Cream, Night, 0.3);
            G(Mix(col, Night, 0.35 * Math.Abs(k - 4) / 4.0), 1, _ccx - S(0.008), apex, _ccx + S(0.008), apex, x1 + 0.5, eave, x0, eave);
        }
        RB(_ccx - hw, eave, 2 * hw, val, Vertical((Mix(P(0), Night, 0.45), 0), (Mix(P(0), Night, 0.65), 1)));
        L(_ccx - hw, eave, _ccx + hw, eave, Mix(P(1), Cream, 0.3), Math.Max(1, S(0.003)), 0.8);
        for (var i = 0; i < 13; i++)
        {
            var bx = _ccx - hw + 2 * hw * (i + 0.5) / 13; var col = Mix(P(1), Cream, 0.5);
            _canopy.Add((Glow(bx, eave + val * 0.55, S(0.036), col, 0.9, 0.4), E(bx, eave + val * 0.55, S(0.009), Mix(col, White, 0.6)), i));
        }
        L(_ccx, apex, _ccx, apex - S(0.03), Rgb(0x1A1430), Math.Max(1, S(0.004))); E(_ccx, apex - S(0.035), S(0.022), Mix(P(1), Cream, 0.4));
        G(P(2), 0.9, _ccx, apex - S(0.075), _ccx + S(0.045), apex - S(0.062), _ccx, apex - S(0.05));
        L(_ccx, apex - S(0.045), _ccx, apex - S(0.078), Rgb(0x1A1430), Math.Max(1, S(0.003)));
        RB(_ccx - cw / 2, _gy - S(0.032), cw, S(0.04), Vertical((Rgb(0x3A2850), 0), (Rgb(0x1A1230), 1)));
        L(_ccx - cw / 2, _gy - S(0.032), _ccx + cw / 2, _gy - S(0.032), Mix(P(1), Cream, 0.3), Math.Max(1, S(0.003)), 0.8);
        for (var i = 0; i < 11; i++) E(_ccx - cw / 2 + cw * (i + 0.5) / 11, _gy - S(0.013), S(0.008), Mix(P(1), Cream, 0.5), 0.75);
    }

    private void Stall(double fx0, double fx1, double band, Color col, Random rng)
    {
        double x0 = X(fx0), x1 = X(fx1), w = x1 - x0, top = _gy - S(0.19), aw = S(0.05);
        var glow = Glow((x0 + x1) / 2, _gy - S(0.08), w * 1.5, Mix(col, Cream, 0.4), 0.5, 0.5);
        RB(x0, top + aw * 0.5, w, _gy - top, Vertical((Rgb(0x241A3A), 0), (Rgb(0x120C22), 1)));
        var front = RB(x0 + w * 0.06, top + aw, w * 0.88, S(0.075), Vertical((A(Mix(col, Cream, 0.6), 0.95), 0), (A(Mix(col, Cream, 0.3), 0.5), 1)), 0.5);
        for (var k = 0; k < 5; k++) E(x0 + w * (0.16 + 0.17 * k), top + aw + S(0.02 + 0.012 * (k % 2)), S(0.024), Mix(P((k + (int)(band * 7)) % 4), Night, 0.25), 0.95);
        RB(x0, _gy - S(0.062), w, S(0.062), Vertical((Mix(col, Night, 0.55), 0), (Mix(col, Ink, 0.75), 1)));
        for (var k = 0; k < 6; k++) RB(x0 + w * (k + 0.25) / 6, _gy - S(0.062), w / 12, S(0.062), B(A(Cream, 0.12)));
        Stripes(x0 + w * 0.04, x1 - w * 0.04, top, x0 - w * 0.05, x1 + w * 0.05, top + aw, 7, Mix(col, Night, 0.2));
        for (var k = 0; k < 7; k++) E(x0 - w * 0.05 + w * 1.1 * (k + 0.5) / 7, top + aw, w * 1.1 / 7, k % 2 == 0 ? Mix(col, Night, 0.2) : Mix(Cream, Night, 0.25));
        _stalls.Add((glow, front, band));
    }

    private void BuildStriker()
    {
        double x = _sx, top = Y(0.25), tw = S(0.036); _sBase = _gy - S(0.05); _sTrack = _sBase - top - S(0.03);
        RB(x - tw / 2, top, tw, _gy - top, Vertical((Mix(P(0), Night, 0.35), 0), (Mix(P(0), Ink, 0.7), 1)));
        RB(x - tw * 0.16, top + S(0.01), tw * 0.32, _sBase - top - S(0.01), B(Rgb(0x0E0A1C)));
        for (var j = 0; j < Marks; j++)
        {
            var y = _sBase - _sTrack * (j + 0.5) / Marks; var col = Hue(j / (Marks - 1.0));
            _mark[j] = (Glow(x, y, S(0.05), col, 0.9, 0.2), E(x + tw * 0.33, y, S(0.008), Mix(col, White, 0.5), 0.4));
            E(x - tw * 0.33, y, S(0.008), Mix(col, White, 0.5), 0.4);
        }
        _puck = RB(x - tw * 0.3, _sBase, tw * 0.6, S(0.014), B(Mix(P(1), White, 0.5))); _puck.RadiusX = _puck.RadiusY = S(0.004);
        G(Mix(P(1), Night, 0.3), 1, x - tw * 1.1, top + S(0.004), x, top - S(0.05), x + tw * 1.1, top + S(0.004));
        _bellGlow = Glow(x, top - S(0.012), S(0.12), Mix(P(1), White, 0.5), 0.95, 0);
        E(x, top - S(0.012), S(0.04), Mix(P(1), Cream, 0.5)); E(x - S(0.006), top - S(0.018), S(0.012), White, 0.7);
        RB(x - S(0.055), _gy - S(0.03), S(0.11), S(0.032), Vertical((Rgb(0x3A2850), 0), (Rgb(0x1A1230), 1))); RB(x + S(0.02), _gy - S(0.042), S(0.03), S(0.014), B(Mix(P(0), Night, 0.2)));
    }

    // ---- the crowd, from behind: a shape is drawn twice, the lit rim and the dark body over it
    private void Shape(double x, double by, double s, params double[] p)
    {
        var o = TableauCurve.Closed(p); var rim = new double[o.Length];
        for (var i = 0; i + 1 < o.Length; i += 2) { o[i] = x + o[i] * s; o[i + 1] = by + o[i + 1] * s; rim[i] = o[i]; rim[i + 1] = o[i + 1] - s * 0.024; }
        var root = C; C = _rimC; GB(_rim, 1, rim); C = _bodyC; GB(_dark, 1, o); C = root;
    }
    private void Person(double x, double by, double s, int hair)
    {
        Shape(x, by, s, -0.36, 0.3, -0.37, -0.2, -0.30, -0.46, -0.12, -0.56, 0.12, -0.56, 0.30, -0.46, 0.37, -0.2, 0.36, 0.3);
        Shape(x, by, s, 0.0, -0.93, 0.10, -0.89, 0.13, -0.77, 0.10, -0.64, 0.0, -0.58, -0.10, -0.64, -0.13, -0.77, -0.10, -0.89);
        if (hair == 1) Shape(x, by, s, -0.14, -0.8, -0.1, -0.93, 0.0, -0.96, 0.1, -0.93, 0.14, -0.8, 0.16, -0.5, 0.1, -0.36, -0.1, -0.36, -0.16, -0.5);
        if (hair == 2) Shape(x, by, s, 0.0, -1.06, 0.07, -1.02, 0.07, -0.93, 0.0, -0.9, -0.07, -0.93, -0.07, -1.02);
        if (hair == 3) { Shape(x, by, s, -0.135, -0.8, -0.12, -0.92, 0.0, -0.97, 0.12, -0.92, 0.135, -0.8, 0.0, -0.84); Shape(x, by, s, 0.0, -1.04, 0.045, -1.0, 0.0, -0.96, -0.045, -1.0); }
    }
    private void BuildCrowd(Random rng)
    {
        _rim = B(Mix(P(1), Cream, 0.45)); _dark = B(Ink);
        for (var row = 0; row < 2; row++)
        {
            double s0 = row == 0 ? S(0.125) : S(0.2), by = row == 0 ? Y(1.0) : Y(1.1); var root = C;
            if (row == 0)
                for (var k = 0; k < 5; k++)
                {
                    double bx = X(0.06 + 0.2 * k + 0.1 * rng.NextDouble()), hy = by - s0 * 0.5, len = s0 * (1.5 + 0.5 * rng.NextDouble()); var col = P(k % 4);
                    var bc = new Canvas(); C.Children.Add(bc); var rt = new RotateTransform { CenterX = bx, CenterY = hy }; bc.RenderTransform = rt; _balloons.Add((rt, rng.NextDouble() * 6)); C = bc;
                    L(bx, hy, bx, hy - len, Rgb(0x2A2244), Math.Max(1, S(0.002)));
                    var b = E(bx, hy - len - s0 * 0.24, s0 * 0.34, Mix(col, Night, 0.15), 0.95); b.Height = s0 * 0.41;
                    E(bx - s0 * 0.07, hy - len - s0 * 0.3, s0 * 0.1, White, 0.45);
                    C = root;
                }
            var g = new Canvas(); C.Children.Add(g); _rowT[row] = new TranslateTransform(); g.RenderTransform = _rowT[row];
            _rimC = new Canvas(); g.Children.Add(_rimC); _bodyC = new Canvas(); g.Children.Add(_bodyC); _rowRim[row] = _rimC;
            for (var x = -S(0.03) + (row == 0 ? 0 : S(0.05)); x < W + s0 * 0.4;)
            {
                var s = s0 * (0.82 + 0.3 * rng.NextDouble());
                Person(x, by, s, rng.Next(5) % 4);
                x += s * (0.6 + 0.55 * rng.NextDouble());
            }
        }
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed; var r = _wr;
        Twinkle(_stars, f, 0.3);

        // ---- the beat
        _sinceBeat += dt; var hit = false;
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.2) { _sinceBeat = 0; _beats++; hit = true; }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 4.2);
        _idle += dts * 0.9; _tw += dts; _chase += dts * (3 + 6 * f.High);

        // ---- the wheel: a band a spoke, lit from the hub outward; it turns with the loudness
        _wheel += dts * (0.1 + 0.5 * f.Loud); _wheelT.Angle = _wheel * 57.29578;
        for (var i = 0; i < Spokes; i++)
        {
            var target = f.Reduced ? 0.45 + 0.3 * Math.Sin(_idle + i * 0.52) : Clamp01(Lv(f, i / 23.0) * 1.3 + 0.12 * _flare);
            _lv[i] += (target - _lv[i]) * (target > _lv[i] ? 0.55 : 0.14);
            var lv = _lv[i]; var len = r * (0.15 + 0.8 * lv);
            _bar[i].X2 = _dx[i] * len; _bar[i].Y2 = _dy[i] * len; Op(_bar[i], 0.15 + 0.3 * lv);
            for (var j = 0; j < Per; j++) Op(_bulb[i * Per + j], 0.12 + 0.88 * Clamp01(lv * (Per + 0.6) - j));
        }
        for (var i = 0; i < RimN; i++) Op(_rimB[i], 0.3 + 0.7 * Osc(_chase, 1, -i * 0.52) * (0.6 + 0.4 * f.High) + 0.3 * _flare);
        for (var i = 0; i < Gond; i++)
        {
            var a = _wheel + i * 2 * Math.PI / Gond;
            _gond[i].X = _wx + Math.Cos(a) * r; _gond[i].Y = _wy + Math.Sin(a) * r;
        }
        Op(_wheelGlow, 0.35 + 0.5 * f.Loud + 0.15 * _flare); Op(_hubGlow, 0.4 + 0.6 * _flare);

        // ---- the carousel: the horses go round, and rise and fall with their bands
        _car += dts * (0.25 + 0.9 * f.Loud); _bob += dts * (1.5 + 2.5 * f.Loud);
        for (var i = 0; i < Horses; i++)
        {
            var a = _car + i * 2 * Math.PI / Horses; double depth = Math.Cos(a), sc = 0.82 + 0.18 * depth;
            var lift = f.Reduced ? 0.5 : Lv(f, (i + 0.5) / Horses);
            var t = _horse[i]; t.TranslateX = _ccx + _cw * 0.42 * Math.Sin(a); t.TranslateY = _gy - S(0.135) - S(0.022) * depth + S(0.03) * Math.Sin(_bob + i * 2.1) * (0.4 + lift);
            t.ScaleX = sc * Math.Clamp(depth * 4, -1, 1); t.ScaleY = sc; Op(_horseC[i], 0.45 + 0.55 * Clamp01(depth * 1.5 + 0.6));
            var z = depth < 0 ? -1 : 1; if (_horseZ[i] != z) { _horseZ[i] = z; Canvas.SetZIndex(_horseC[i], z); }
        }
        for (var i = 0; i < _canopy.Count; i++)
        {
            var (glow, core, n) = _canopy[i]; var on = (n + _beats) % 3 == 0 ? 1.0 : 0.25;
            Op(glow, 0.15 + 0.6 * on + 0.25 * _flare); Op(core, 0.5 + 0.5 * on);
        }
        Op(_carGlow, 0.4 + 0.4 * f.Loud + 0.2 * _flare); Op(_carLight, 0.6 + 0.3 * f.Mid + 0.1 * _flare);

        // ---- the strength tower: the puck climbs with the lows and rings the bell at the top
        var want = f.Reduced ? 0.3 + 0.25 * Math.Sin(_idle * 0.8) : Clamp01(f.Low * 1.15 + 0.25 * _flare);
        _puckLv += (want - _puckLv) * (want > _puckLv ? 0.5 : 0.07);
        Canvas.SetTop(_puck, _sBase - _sTrack * _puckLv - _puck.Height);
        for (var j = 0; j < Marks; j++)
        {
            var on = Clamp01((_puckLv - (j + 0.2) / Marks) * Marks);
            Op(_mark[j].glow, 0.08 + 0.85 * on); Op(_mark[j].core, 0.35 + 0.65 * on);
        }
        if (hit && _puckLv > 0.72) _bell = 1;
        _bell *= Math.Exp(-dt * 3.5); Op(_bellGlow, _bell);

        // ---- the stalls, the strings of bulbs, the crowd
        for (var i = 0; i < _stalls.Count; i++)
        {
            var (glow, front, band) = _stalls[i]; var lv = f.Reduced ? 0.45 + 0.15 * Math.Sin(_idle * 0.7 + i * 2) : Lv(f, band);
            Op(glow, 0.3 + 0.6 * lv + 0.1 * _flare); Op(front, 0.45 + 0.55 * lv);
        }
        for (var i = 0; i < _garland.Count; i++)
        {
            var (glow, core, n) = _garland[i]; var c = Osc(_chase, 1, -n * 0.7);
            var lv = f.Reduced ? 0.5 : Lv(f, (n % 4 + 0.5) / 4);
            Op(glow, 0.15 + 0.55 * c * (0.5 + lv) + 0.3 * _flare); Op(core, 0.55 + 0.45 * c);
        }
        _rowT[0].Y = -S(0.012) * _flare; _rowT[1].Y = -S(0.018) * Math.Sqrt(_flare);
        Op(_rowRim[0], 0.4 + 0.3 * f.Loud + 0.3 * _flare); Op(_rowRim[1], 0.35 + 0.3 * f.Loud + 0.3 * _flare);
        for (var i = 0; i < _balloons.Count; i++) { var (rt, ph) = _balloons[i]; rt.Angle = 7 * Math.Sin(_tw * 1.1 + ph) + 3 * Math.Sin(_tw * 2.3 + ph * 2); }
        Op(_haze, 0.55 + 0.35 * f.Loud + 0.1 * _flare);
    }
}
