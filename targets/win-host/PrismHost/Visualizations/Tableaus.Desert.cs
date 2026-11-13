using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== ENVIRONMENT: Desert Stars (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// Dunes under the Milky Way (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The Milky Way is the meter: it arches over the desert in twenty-four reaches, low notes at the left horizon and high notes at
/// the right, and the stars and the dust of a reach brighten with its band. A caravan of camels walks the far crest, a tent
/// glows and its fire burns with the lows, the sand shines along the crests with the loudness, and a beat sends a shooting star
/// across the sky.
///
/// Every shape is made once in OnBuild. A reach is a canvas whose opacity is set, so a frame allocates nothing.
/// </summary>
public sealed class DesertStars : Tableau
{
    private const int Bands = 24, Shots = 3, Camels = 5, Sparks = 10;
    private readonly Canvas[] _reach = new Canvas[Bands];
    private readonly Ellipse[] _dust = new Ellipse[Bands], _spark = new Ellipse[Sparks];
    private readonly double[] _lv = new double[Bands], _sT = new double[Shots], _sX = new double[Shots], _sY = new double[Shots], _sA = new double[Shots];
    private readonly Line[] _shot = new Line[Shots];
    private readonly Ellipse[] _shotHead = new Ellipse[Shots];
    private readonly List<(Ellipse e, double ph)> _stars = new();
    private readonly List<Polyline> _crest = new();
    private Canvas _caravan = null!;
    private TranslateTransform _caravanT = null!;
    private readonly List<(Line l, double x, double y, double len, double ph)> _legs = new();
    private Ellipse _fire = null!, _fireGround = null!, _tent = null!, _moon = null!;
    private Polygon _flame = null!;
    private ScaleTransform _flameS = null!;
    private double _fx, _fy, _flare, _prevBeat, _sinceBeat = 9, _idle, _tw, _walk;
    private int _next;

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Ink = Rgb(0x0A0710);

    private double[] Dune(double y0, double amp, double ph, double f1, double f2)
    {
        var p = new List<double> { -4, H + 4 };
        for (var k = 0; k <= 48; k++) { var t = k / 48.0; p.Add(t * (W + 8) - 4); p.Add(y0 - amp * (0.6 * Math.Sin(t * f1 + ph) + 0.4 * Math.Sin(t * f2 + ph * 2.3))); }
        p.Add(W + 4); p.Add(H + 4); return p.ToArray();
    }
    private void Crest(double[] dune, Color c)
    {
        var pl = PL(B(c), Math.Max(1, S(0.003)), 0.5);
        for (var q = 2; q + 3 < dune.Length; q += 2) pl.Points.Add(new Pt(dune[q], dune[q + 1]));
        _crest.Add(pl);
    }
    private void Camel(double x, double y, double s, int idx)
    {
        var body = TableauCurve.Closed(new[] { -0.5, -0.5, -0.3, -0.62, -0.12, -0.95, 0.08, -0.66, 0.3, -0.6, 0.5, -0.9, 0.6, -1.18, 0.78, -1.2, 0.86, -1.1, 0.7, -1.04, 0.62, -0.7, 0.5, -0.42, 0.2, -0.36, -0.3, -0.36 }, 5);
        for (var q = 0; q + 1 < body.Length; q += 2) { body[q] = x + body[q] * s; body[q + 1] = y + body[q + 1] * s; }
        G(Ink, 1, body);
        foreach (var lx in new[] { -0.36, -0.22, 0.3, 0.42 }) { var l = L(x + lx * s, y - 0.4 * s, x + lx * s, y, Ink, Math.Max(1.2, s * 0.07)); _legs.Add((l, x + lx * s, y - 0.4 * s, 0.42 * s, idx * 1.3 + lx * 9)); }
        L(x - 0.5 * s, y - 0.5 * s, x - 0.6 * s, y - 0.3 * s, Ink, Math.Max(1, s * 0.04));
        if (idx % 2 == 0) { RB(x - 0.2 * s, y - 0.86 * s, 0.3 * s, 0.26 * s, B(Mix(P(3), Ink, 0.5))); Glow(x - 0.05 * s, y - 0.5 * s, s * 0.7, P(0), 0.8, 0.5); E(x - 0.05 * s, y - 0.5 * s, s * 0.08, Rgb(0xFFE0A0)); }
    }

    protected override void OnBuild()
    {
        _stars.Clear(); _crest.Clear(); _legs.Clear();
        var rng = new Random(281); var hz = Y(0.66);

        // ---- the sky: violet night to a last ember of dusk on the horizon
        RB(0, 0, W, H, Vertical((Rgb(0x04030C), 0), (Rgb(0x0C0A22), 0.35), (Rgb(0x241438), 0.58), (Mix(P(3), Rgb(0x3A1830), 0.6), 0.68), (Rgb(0x1A0E1C), 1)));
        Glow(X(0.5), hz, W * 1.2, Mix(P(0), P(3), 0.5), 0.3, 0.5).Height = S(0.3);
        for (var i = 0; i < 150; i++) _stars.Add((E(X(rng.NextDouble()), Y(0.64 * rng.NextDouble()), S(0.0016 + 0.003 * rng.NextDouble() * rng.NextDouble()), Mix(P(1), rng.NextDouble() < 0.2 ? P(0) : Rgb(0xC8D4FF), rng.NextDouble()), 0.6), rng.NextDouble() * 6));

        // ---- the Milky Way: an arch of twenty-four reaches
        for (var b = 0; b < Bands; b++)
        {
            var t = (b + 0.5) / Bands; var ang = Math.PI * (1 - t);
            double cx = X(0.5) + Math.Cos(ang) * W * 0.56, cy = hz + S(0.04) - Math.Sin(ang) * S(0.56);
            var col = Mix(Mix(P(2), P(3), t), P(1), 0.35);
            _dust[b] = Glow(cx, cy, S(0.26), col, 0.4, 0.2);
            var cv = new Canvas(); C.Children.Add(cv); _reach[b] = cv; var root = C; C = cv;
            Glow(cx, cy, S(0.14), Mix(col, White, 0.5), 0.35, 0.8);
            for (var k = 0; k < 44; k++)
            {
                var a = ang + (rng.NextDouble() - 0.5) * Math.PI / Bands * 1.5; var off = (rng.NextDouble() + rng.NextDouble() - 1) * S(0.085);
                double sx = X(0.5) + Math.Cos(a) * W * 0.56 + Math.Cos(a) * off, sy = hz + S(0.04) - Math.Sin(a) * S(0.56) - Math.Sin(a) * off;
                if (sy > hz - S(0.01)) continue;
                E(sx, sy, S(0.0022 + 0.0044 * rng.NextDouble() * rng.NextDouble()), Mix(col, White, 0.5 + 0.5 * rng.NextDouble()), 0.6 + 0.4 * rng.NextDouble());
            }
            // dark lanes of dust through the arch
            C = root; _lv[b] = 0.3;
        }
        _moon = Glow(X(0.14), Y(0.2), S(0.2), Rgb(0xFFE8C0), 0.5, 0.6);
        E(X(0.14), Y(0.2), S(0.05), Rgb(0xFFF0D0)); E(X(0.14) + S(0.016), Y(0.2) - S(0.006), S(0.047), Rgb(0x0A0920));
        for (var i = 0; i < Shots; i++)
        {
            _shot[i] = L(0, 0, 1, 1, White, Math.Max(1.5, S(0.003)), 0); _shot[i].StrokeStartLineCap = PenLineCap.Round;
            _shot[i].Stroke = new LinearGradientBrush { StartPoint = new Pt(0, 0), EndPoint = new Pt(1, 1), GradientStops = { new GradientStop { Color = A(White, 0), Offset = 0 }, new GradientStop { Color = White, Offset = 1 } } };
            _shotHead[i] = Glow(0, 0, S(0.03), White, 0.9, 0); _sT[i] = 9;
        }

        // ---- far mesas, then four ranges of dunes
        G(Rgb(0x1C0F22), 1, -2, hz + 2, -2, hz - S(0.05), X(0.08), hz - S(0.055), X(0.1), hz - S(0.09), X(0.2), hz - S(0.09), X(0.22), hz - S(0.04), X(0.3), hz - S(0.03), X(0.33), hz + 2);
        G(Rgb(0x1C0F22), 1, X(0.62), hz + 2, X(0.66), hz - S(0.07), X(0.74), hz - S(0.075), X(0.76), hz - S(0.11), X(0.8), hz - S(0.11), X(0.82), hz - S(0.05), X(0.93), hz - S(0.04), W + 2, hz - S(0.02), W + 2, hz + 2);
        var d1 = Dune(Y(0.675), S(0.035), 0.6, 7, 13);
        GB(Vertical((Rgb(0x3A1E34), 0), (Rgb(0x1E1020), 1)), 1, d1); Crest(d1, Mix(P(0), P(3), 0.5));
        // the caravan on the far crest, walking
        _caravan = new Canvas(); _caravanT = new TranslateTransform(); _caravan.RenderTransform = _caravanT; C.Children.Add(_caravan);
        {
            var root = C; C = _caravan;
            for (var i = 0; i < Camels; i++) Camel(i * S(0.085), 0, S(0.05), i);
            for (var i = 0; i + 1 < Camels; i++) L(i * S(0.085) + S(0.04), -S(0.055), (i + 1) * S(0.085) - S(0.025), -S(0.03), Ink, 1, 0.8);
            C = root;
        }
        var d2 = Dune(Y(0.78), S(0.05), 2.1, 5, 11);
        GB(Vertical((Rgb(0x4A2A38), 0), (Rgb(0x24121E), 0.6), (Rgb(0x160A14), 1)), 1, d2); Crest(d2, P(0));
        // the camp between the dunes
        {
            double tx = X(0.7), tb = Y(0.83); _fx = tx - S(0.11); _fy = tb + S(0.01);
            _fireGround = Glow(_fx, _fy, S(0.5), P(0), 0.5, 0.5); _fireGround.Height = S(0.14); At(_fireGround, _fx - S(0.25), _fy - S(0.07));
            _tent = Glow(tx, tb - S(0.03), S(0.22), P(0), 0.5, 0.5);
            G(Rgb(0x2A1620), 1, tx - S(0.08), tb, tx, tb - S(0.09), tx + S(0.08), tb); GB(Vertical((A(Rgb(0xFFD890), 0.9), 0), (A(P(0), 0.7), 1)), 1, tx - S(0.022), tb, tx, tb - S(0.06), tx + S(0.022), tb);
            L(tx, tb - S(0.09), tx, tb - S(0.11), Ink, Math.Max(1, S(0.003))); G(P(3), 0.9, tx, tb - S(0.11), tx + S(0.02), tb - S(0.103), tx, tb - S(0.096));
            _fire = Glow(_fx, _fy - S(0.02), S(0.16), Rgb(0xFFC060), 0.8, 0.7);
            L(_fx - S(0.018), _fy, _fx + S(0.018), _fy - S(0.008), Ink, Math.Max(1.5, S(0.005))); L(_fx - S(0.018), _fy - S(0.008), _fx + S(0.018), _fy, Ink, Math.Max(1.5, S(0.005)));
            _flame = G(Rgb(0xFFC870), 1, TableauCurve.Closed(new[] { _fx - S(0.012), _fy - S(0.004), _fx - S(0.008), _fy - S(0.03), _fx, _fy - S(0.042), _fx + S(0.009), _fy - S(0.028), _fx + S(0.012), _fy - S(0.004) }, 4));
            _flameS = new ScaleTransform { CenterX = _fx, CenterY = _fy }; _flame.RenderTransform = _flameS;
            for (var i = 0; i < Sparks; i++) _spark[i] = E(0, 0, S(0.004), Rgb(0xFFD080), 0);
            foreach (var px in new[] { -0.045, 0.04 }) { E(_fx + S(px), _fy - S(0.03), S(0.018), Ink); G(Ink, 1, _fx + S(px) - S(0.018), _fy + S(0.004), _fx + S(px) - S(0.012), _fy - S(0.022), _fx + S(px) + S(0.012), _fy - S(0.022), _fx + S(px) + S(0.018), _fy + S(0.004)); }
        }
        var d3 = Dune(Y(0.9), S(0.06), 4.0, 4, 9);
        GB(Vertical((Rgb(0x341C28), 0), (Rgb(0x180C14), 0.5), (Rgb(0x0C060C), 1)), 1, d3); Crest(d3, Mix(P(0), White, 0.2));
        // a cactus and dry grass close by
        {
            double cx = X(0.12), cb = H + 2; var cw = Math.Max(3, S(0.028));
            L(cx, cb, cx, Y(0.66), Ink, cw).StrokeEndLineCap = PenLineCap.Round;
            var a1 = PL(B(Ink), cw * 0.8, 1); a1.StrokeLineJoin = PenLineJoin.Round; a1.StrokeEndLineCap = PenLineCap.Round; a1.Points.Add(new Pt(cx, Y(0.84))); a1.Points.Add(new Pt(cx - S(0.05), Y(0.84))); a1.Points.Add(new Pt(cx - S(0.05), Y(0.75)));
            var a2 = PL(B(Ink), cw * 0.8, 1); a2.StrokeLineJoin = PenLineJoin.Round; a2.StrokeEndLineCap = PenLineCap.Round; a2.Points.Add(new Pt(cx, Y(0.8))); a2.Points.Add(new Pt(cx + S(0.045), Y(0.8))); a2.Points.Add(new Pt(cx + S(0.045), Y(0.72)));
            for (var k = 0; k < 16; k++) { var gx = X(0.3 + 0.6 * rng.NextDouble()); L(gx, H, gx + S(0.02) * (rng.NextDouble() - 0.5), H - S(0.02 + 0.03 * rng.NextDouble()), Ink, Math.Max(1, S(0.002))); }
        }
        Vignette(0.34);
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;
        _sinceBeat += dt; var hit = false;
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.22 && !f.Reduced) { _sinceBeat = 0; hit = true; }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 4);
        _idle += dts * 0.9; _tw += dts; _walk += dts * (0.5 + 0.8 * f.Mid);

        // ---- the Milky Way: a band a reach
        for (var b = 0; b < Bands; b++)
        {
            var target = f.Reduced ? 0.4 + 0.25 * Math.Sin(_idle * 0.7 + b * 0.5) : Clamp01(Lv(f, b / 23.0) * 1.3 + 0.08 * _flare);
            _lv[b] += (target - _lv[b]) * (target > _lv[b] ? 0.5 : 0.1);
            Op(_reach[b], 0.14 + 0.86 * _lv[b]); Op(_dust[b], 0.08 + 0.6 * _lv[b]);
        }
        for (var i = 0; i < _stars.Count; i++) { var (e, ph) = _stars[i]; Op(e, 0.25 + 0.5 * Osc(_tw, 0.5 + (i % 5) * 0.25, ph) + 0.2 * f.High); }
        Op(_moon, 0.45 + 0.3 * f.Loud);

        // ---- a shooting star on a beat
        if (hit) { var i = _next++ % Shots; _sT[i] = 0; _sX[i] = X(0.15 + 0.7 * Rng.NextDouble()); _sY[i] = Y(0.05 + 0.25 * Rng.NextDouble()); _sA[i] = (Rng.NextDouble() < 0.5 ? 0.35 : Math.PI - 0.35) + 0.3 * (Rng.NextDouble() - 0.5); }
        for (var i = 0; i < Shots; i++)
        {
            if (_sT[i] > 0.7) { Op(_shot[i], 0); Op(_shotHead[i], 0); continue; }
            _sT[i] += dt; var u = _sT[i] / 0.7; var d = S(0.5) * (1 - Math.Pow(1 - u, 2)); var tail = S(0.14) * Math.Sin(Math.PI * u);
            double hx = _sX[i] + Math.Cos(_sA[i]) * d, hy = _sY[i] + Math.Sin(_sA[i]) * d * 0.6; var l = _shot[i];
            l.X1 = hx - Math.Cos(_sA[i]) * tail; l.Y1 = hy - Math.Sin(_sA[i]) * tail * 0.6; l.X2 = hx; l.Y2 = hy;
            ((LinearGradientBrush)l.Stroke).StartPoint = new Pt(l.X1 < l.X2 ? 0 : 1, 0); ((LinearGradientBrush)l.Stroke).EndPoint = new Pt(l.X1 < l.X2 ? 1 : 0, 0);
            Op(l, Math.Sin(Math.PI * u)); Size(_shotHead[i], hx, hy, S(0.03)); Op(_shotHead[i], Math.Sin(Math.PI * u));
        }

        // ---- the caravan, the camp, the sand
        var span = W + S(0.6); var cx = (S(0.75) + _walk * S(0.02)) % span;
        _caravanT.X = cx - S(0.5); _caravanT.Y = Y(0.675) - S(0.035) * (0.6 * Math.Sin((cx - S(0.3)) / (W + 8) * 7 + 0.6) + 0.4 * Math.Sin((cx - S(0.3)) / (W + 8) * 13 + 1.38)) + S(0.004);
        for (var i = 0; i < _legs.Count; i++) { var (l, x, y, len, ph) = _legs[i]; var sw = Math.Sin(_walk * 2.2 + ph) * len * 0.3; l.X2 = x + sw; l.Y2 = y + len - Math.Abs(sw) * 0.2; }
        var low = f.Reduced ? 0.4 : f.Low;
        var flick = 0.7 + 0.15 * Math.Sin(_tw * 9.3) * Math.Sin(_tw * 5.1) + 0.3 * low + 0.2 * _flare;
        _flameS.ScaleY = 0.7 + 0.6 * flick; _flameS.ScaleX = 0.9 + 0.15 * Math.Sin(_tw * 7.9);
        Op(_fire, 0.35 + 0.5 * flick); Op(_fireGround, 0.2 + 0.4 * flick); Op(_tent, 0.3 + 0.3 * flick);
        for (var i = 0; i < Sparks; i++)
        {
            var age = (_tw * 0.5 + i / (double)Sparks) % 1.0;
            At(_spark[i], _fx + S(0.03) * Math.Sin(age * 5 + i * 2.1) * age, _fy - S(0.04) - S(0.12) * age); Op(_spark[i], (0.3 + 0.7 * low) * (1 - age));
        }
        for (var i = 0; i < _crest.Count; i++) Op(_crest[i], 0.15 + 0.5 * f.Loud + 0.2 * _flare);
    }
}
