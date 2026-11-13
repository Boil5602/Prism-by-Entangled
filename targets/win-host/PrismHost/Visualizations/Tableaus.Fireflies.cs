using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== ENVIRONMENT: Firefly Forest (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A clearing in an old forest at night (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The fireflies are the meter: twenty-four swarms across the clearing, a band a swarm, and a swarm lights from the forest floor
/// upward as its band rises, eight flies to a swarm, amber near the ground and green at the top. Each fly wanders round its own
/// place and blinks, faster with the high notes. The glow behind the trees breathes with the lows and edges the trunks, shafts
/// of moonlight come and go with the loudness, the mushrooms on the floor pulse on a beat and the owl opens its eyes.
///
/// Every shape is made once in OnBuild. A fly is two ellipses that are moved, so a frame allocates nothing.
/// </summary>
public sealed class ForestFireflies : Tableau
{
    private const int Bands = 24, Per = 8, N = Bands * Per;
    private readonly Ellipse[] _glow = new Ellipse[N], _core = new Ellipse[N];
    private readonly double[] _hx = new double[N], _hy = new double[N], _p1 = new double[N], _p2 = new double[N], _sz = new double[N], _lv = new double[Bands];
    private readonly List<Polygon> _shafts = new();
    private readonly List<(Ellipse g, double ph)> _shrooms = new();
    private Ellipse _back = null!, _back2 = null!, _eyeL = null!, _eyeR = null!, _eyeGlow = null!;
    private Canvas _rimC = null!;
    private double _fly, _flare, _idle, _tw, _blink = 3;

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Ink = Rgb(0x03070A);

    private void Trunk(double x, double w, double top, double baseY, Color c, double lean, bool rim, double side)
    {
        G(c, 1, x - w * 0.5 + lean, top, x + w * 0.5 + lean, top, x + w * 0.62, baseY - w * 1.2, x + w * 1.25, baseY, x - w * 1.25, baseY, x - w * 0.62, baseY - w * 1.2);
        if (!rim) return;
        var root = C; C = _rimC;
        var e = side * w * 0.5;
        G(Mix(P(1), P(0), 0.5), 0.55, x + e + lean, top, x + e + lean - side * w * 0.16, top, x + side * w * 0.62 - side * w * 0.2, baseY - w * 1.2, x + side * w * 1.0, baseY, x + side * w * 1.25, baseY, x + side * w * 0.62, baseY - w * 1.2);
        C = root;
    }
    private void Fern(double x, double y, double s, Random r)
    {
        for (var k = 0; k < 7; k++)
        {
            var a = -Math.PI / 2 + (k - 3) * 0.36 + (r.NextDouble() - 0.5) * 0.15; var len = s * (0.6 + 0.4 * r.NextDouble());
            double ex = x + Math.Cos(a) * len, ey = y + Math.Sin(a) * len * 0.8 + len * 0.12 * Math.Abs(k - 3), nx = -Math.Sin(a) * len * 0.11, ny = Math.Cos(a) * len * 0.11;
            G(Ink, 1, x, y, (x + ex) / 2 + nx, (y + ey) / 2 + ny - len * 0.08, ex, ey, (x + ex) / 2 - nx, (y + ey) / 2 - ny - len * 0.08);
        }
    }

    protected override void OnBuild()
    {
        _shafts.Clear(); _shrooms.Clear();
        var rng = new Random(263); var gy = Y(0.83); var cxg = X(0.56);

        // ---- the depth of the wood: night green, a warm light far behind the trees, mist
        RB(0, 0, W, H, Vertical((Rgb(0x020608), 0), (Rgb(0x06161A), 0.45), (Rgb(0x0C2622), 0.8), (Rgb(0x06120E), 1)));
        _back2 = Glow(cxg, Y(0.62), W * 1.1, Mix(P(2), P(0), 0.4), 0.3, 0.5); _back2.Height = S(0.9); At(_back2, cxg - W * 0.55, Y(0.62) - S(0.45));
        _back = Glow(cxg, Y(0.66), S(0.9), Mix(P(1), P(0), 0.5), 0.6, 0.5); _back.Height = S(0.6); At(_back, cxg - S(0.45), Y(0.66) - S(0.3));
        for (var i = 0; i < 22; i++) { var x = X(rng.NextDouble()); var w = S(0.008 + 0.012 * rng.NextDouble()); G(Rgb(0x0C2A26), 0.75, x - w / 2, -2, x + w / 2, -2, x + w * 0.7, Y(0.78), x - w * 0.7, Y(0.78)); }
        { var mist = Glow(0, 0, W * 1.4, Rgb(0x9CC8B0), 0.2, 0.7); mist.Height = S(0.2); At(mist, -W * 0.2, Y(0.66)); }
        // shafts of moonlight through the canopy
        foreach (var (fx, wd) in new[] { (0.3, 0.05), (0.45, 0.08), (0.6, 0.04), (0.72, 0.07), (0.86, 0.05) })
        {
            var br = Vertical((A(Rgb(0xC8F0DC), 0.3), 0), (A(Rgb(0xC8F0DC), 0.1), 0.6), (A(Rgb(0xC8F0DC), 0), 1));
            _shafts.Add(GB(br, 0.5, X(fx), -2, X(fx + wd * 0.6), -2, X(fx + wd - 0.18), gy, X(fx - 0.2 - wd * 0.4), gy));
        }
        for (var i = 0; i < 12; i++) { var x = X(0.03 + 0.94 * (i + rng.NextDouble() * 0.7) / 12); Trunk(x, S(0.022 + 0.014 * rng.NextDouble()), -2, Y(0.8), Rgb(0x071A1A), S(0.02) * (rng.NextDouble() - 0.5), false, 0); }
        RB(0, Y(0.76), W, H - Y(0.76), Vertical((A(Rgb(0x06120E), 0), 0), (Rgb(0x050E0C), 0.3), (Rgb(0x020506), 1)));

        // ---- the fireflies behind the near trees: the even swarms
        _rimC = new Canvas();
        for (var b = 0; b < Bands; b += 2) Swarm(b, rng, gy);
        // ---- the near trees, edged by the light behind them
        C.Children.Add(_rimC);
        var near = new[] { (0.07, 0.075), (0.27, 0.05), (0.44, 0.04), (0.79, 0.06), (0.95, 0.085) };
        var bodies = new Canvas(); C.Children.Add(bodies);
        {
            var root = C; C = bodies;
            foreach (var (fx, fw) in near)
            {
                var x = X(fx); var w = S(fw);
                Trunk(x, w, -2, gy + S(0.03), Rgb(0x030809), S(0.03) * (rng.NextDouble() - 0.5), true, x < cxg ? 1 : -1);
                for (var k = 0; k < 5; k++) { var by = Y(0.1 + 0.6 * rng.NextDouble()); L(x + w * (rng.NextDouble() - 0.5) * 0.6, by, x + w * (rng.NextDouble() - 0.5) * 0.6, by + S(0.05), Rgb(0x0A1618), Math.Max(1, S(0.003)), 0.8); }
            }
            // the owl's branch
            double ox = X(0.79) - S(0.06), oy = Y(0.3);
            G(Rgb(0x030809), 1, X(0.79), oy + S(0.005), ox - S(0.1), oy - S(0.01), ox - S(0.1), oy + S(0.004), X(0.79), oy + S(0.03));
            var owl = TableauCurve.Closed(new[] { -0.3, 0.0, -0.36, -0.5, -0.3, -0.92, -0.2, -1.06, -0.1, -0.96, 0.1, -0.96, 0.2, -1.06, 0.3, -0.92, 0.36, -0.5, 0.3, 0.0 }, 5); var os = S(0.07);
            for (var q = 0; q + 1 < owl.Length; q += 2) { owl[q] = ox - S(0.03) + owl[q] * os; owl[q + 1] = oy + owl[q + 1] * os; }
            G(Rgb(0x040A0C), 1, owl);
            _eyeGlow = Glow(ox - S(0.03), oy - os * 0.74, os * 1.6, P(0), 0.6, 0);
            _eyeL = E(ox - S(0.03) - os * 0.14, oy - os * 0.74, os * 0.2, Mix(P(0), P(1), 0.3)); _eyeR = E(ox - S(0.03) + os * 0.14, oy - os * 0.74, os * 0.2, Mix(P(0), P(1), 0.3));
            E(ox - S(0.03) - os * 0.14, oy - os * 0.74, os * 0.09, Ink); E(ox - S(0.03) + os * 0.14, oy - os * 0.74, os * 0.09, Ink);
            C = root;
        }
        // ---- the canopy overhead
        RB(0, 0, W, S(0.3), Vertical((Rgb(0x010405), 0), (A(Rgb(0x010405), 0.85), 0.4), (A(Rgb(0x010405), 0), 1)));
        for (var i = 0; i < 46; i++) { var d = S(0.08 + 0.14 * rng.NextDouble()); var e = E(X(rng.NextDouble() * 1.1 - 0.05), S(0.1 * rng.NextDouble() * rng.NextDouble()) - d * 0.1, d, Rgb(0x020607)); e.Height = d * 0.6; }

        // ---- the floor: mushrooms that glow, ferns, then the odd swarms in front
        for (var i = 0; i < 7; i++)
        {
            double mx = X(0.1 + 0.82 * (i + 0.6 * rng.NextDouble()) / 7), my = gy + S(0.02 + 0.07 * rng.NextDouble()); var col = Mix(P(2), Rgb(0x5CE8E0), 0.4);
            _shrooms.Add((Glow(mx, my - S(0.012), S(0.13), col, 0.6, 0.4), rng.NextDouble() * 6));
            for (var k = 0; k < 3; k++)
            {
                double sx = mx + S(0.02) * (k - 1) + S(0.006) * rng.NextDouble(), sh = S(0.014 + 0.02 * rng.NextDouble()), cw = S(0.012 + 0.012 * rng.NextDouble());
                L(sx, my, sx, my - sh, Mix(col, White, 0.3), Math.Max(1, S(0.003)), 0.8);
                G(Mix(col, White, 0.25), 0.95, TableauCurve.Closed(new[] { sx - cw, my - sh, sx - cw * 0.6, my - sh - cw * 0.7, sx, my - sh - cw * 0.95, sx + cw * 0.6, my - sh - cw * 0.7, sx + cw, my - sh }, 4));
            }
        }
        for (var b = 1; b < Bands; b += 2) Swarm(b, rng, gy);
        for (var i = 0; i < 9; i++) Fern(X(-0.02 + 1.04 * (i + rng.NextDouble() * 0.6) / 9), H + S(0.02), S(0.12 + 0.1 * rng.NextDouble()), rng);
        Vignette(0.36);
    }

    private void Swarm(int b, Random rng, double gy)
    {
        for (var j = 0; j < Per; j++)
        {
            var i = b * Per + j; var t = j / (Per - 1.0);
            _hx[i] = X((b + 0.5) / Bands + 0.03 * (rng.NextDouble() - 0.5)); _hy[i] = gy + S(0.02) - S(0.06 + 0.6 * Math.Pow(t, 0.9)) + S(0.03) * (rng.NextDouble() - 0.5);
            _p1[i] = rng.NextDouble() * 6.28; _p2[i] = rng.NextDouble() * 6.28; _sz[i] = S(0.007 + 0.004 * rng.NextDouble());
            var col = t < 0.5 ? Mix(P(1), P(0), t * 2) : Mix(P(0), P(2), t * 2 - 1);
            _glow[i] = Glow(_hx[i], _hy[i], _sz[i] * 6, col, 0.8, 0); _core[i] = E(_hx[i], _hy[i], _sz[i], Mix(col, White, 0.6), 0);
        }
        _lv[b] = 0.3;
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 4);
        _idle += dts * 0.9; _tw += dts; _fly += dts * (0.5 + 1.6 * f.High);

        // ---- the swarms: a band a swarm, lit from the floor up
        for (var b = 0; b < Bands; b++)
        {
            var target = f.Reduced ? 0.4 + 0.25 * Math.Sin(_idle * 0.8 + b * 0.5) : Clamp01(Lv(f, b / 23.0) * 1.3 + 0.1 * _flare);
            _lv[b] += (target - _lv[b]) * (target > _lv[b] ? 0.5 : 0.1);
            for (var j = 0; j < Per; j++)
            {
                var i = b * Per + j; var lit = Clamp01(_lv[b] * (Per + 0.7) - j);
                var blink = 0.6 + 0.4 * Math.Sin(_fly * (1.3 + (i % 5) * 0.35) + _p1[i] * 3);
                double x = _hx[i] + S(0.022) * Math.Sin(_fly * 0.7 + _p1[i]) + S(0.01) * Math.Sin(_fly * 1.9 + _p2[i]), y = _hy[i] + S(0.016) * Math.Cos(_fly * 0.9 + _p2[i]) + S(0.008) * Math.Sin(_fly * 2.3 + _p1[i]);
                var d = _sz[i] * (3.6 + 2.4 * lit + 2.5 * _flare * lit);
                Size(_glow[i], x, y, d); Op(_glow[i], (0.04 + 0.9 * lit) * blink);
                Size(_core[i], x, y, _sz[i]); Op(_core[i], (0.1 + 0.9 * lit) * blink);
            }
        }

        // ---- the light behind the trees, the shafts, the floor, the owl
        var low = f.Reduced ? 0.4 + 0.1 * Math.Sin(_idle * 0.5) : f.Low;
        Op(_back, 0.3 + 0.5 * low + 0.15 * _flare); Op(_back2, 0.3 + 0.4 * f.Loud); Op(_rimC, 0.25 + 0.5 * low + 0.2 * _flare);
        for (var i = 0; i < _shafts.Count; i++) Op(_shafts[i], (0.25 + 0.55 * f.Loud) * (0.7 + 0.3 * Math.Sin(_tw * 0.3 + i * 1.9)));
        for (var i = 0; i < _shrooms.Count; i++) { var (g, ph) = _shrooms[i]; Op(g, 0.25 + 0.25 * low + 0.2 * Osc(_tw, 0.8, ph) + 0.45 * _flare); }
        _blink -= dt; if (_blink < -0.14) _blink = 2.5 + 4 * Rng.NextDouble();
        var open = _blink < 0 ? 0.0 : 1.0;
        Op(_eyeL, open); Op(_eyeR, open); Op(_eyeGlow, open * (0.15 + 0.6 * _flare));
    }
}
