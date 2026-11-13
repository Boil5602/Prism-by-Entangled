using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== ENVIRONMENT: Storm Front (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A storm crossing an open plain (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The rain is the meter: twenty-four curtains hang from the cloud base, a band a curtain, and a curtain falls further toward
/// the ground and thickens as its band rises. The cells of the cloud are lit from inside by the low notes, a strong beat throws
/// a fork of lightning to the ground and lights the whole plain, the wheat leans with the mids, and the windmill by the farm
/// turns with the loudness.
///
/// Every shape is made once in OnBuild. A bolt is a polyline whose points are rewritten on a strike, so a frame allocates nothing.
/// </summary>
public sealed class StormFront : Tableau
{
    private const int Bands = 24, Cells = 9, Bolts = 2, Seg = 12, Stalks = 220, Drops = 40;
    private readonly Rectangle[] _curtain = new Rectangle[Bands];
    private readonly ScaleTransform[] _curtainS = new ScaleTransform[Bands];
    private readonly Ellipse[] _cell = new Ellipse[Cells];
    private readonly double[] _lv = new double[Bands], _cellPh = new double[Cells], _bT = new double[Bolts];
    private readonly Polyline[] _bolt = new Polyline[Bolts], _boltGlow = new Polyline[Bolts], _fork = new Polyline[Bolts];
    private readonly Line[] _stalk = new Line[Stalks], _drop = new Line[Drops];
    private readonly double[] _stX = new double[Stalks], _stY = new double[Stalks], _stH = new double[Stalks], _dX = new double[Drops], _dY = new double[Drops];
    private Rectangle _flash = null!, _ground = null!;
    private Ellipse _strikeGlow = null!, _window = null!;
    private RotateTransform _mill = null!;
    private double _base, _hz, _flare, _prevBeat, _sinceBeat = 9, _idle, _tw, _sway, _spin, _rain;
    private int _next;

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Ink = Rgb(0x05070C);

    protected override void OnBuild()
    {
        var rng = new Random(283); var hz = _hz = Y(0.76); var cb = _base = Y(0.36);

        // ---- the sky under the storm: a band of clear evening light along the horizon
        RB(0, 0, W, H, Vertical((Rgb(0x080A14), 0), (Rgb(0x141A2C), 0.36), (Rgb(0x2A3248), 0.56), (Mix(P(0), Rgb(0xF0C890), 0.6), 0.73), (Rgb(0x1A1C24), 0.77), (Rgb(0x0A0C10), 1)));
        Glow(X(0.2), hz, W * 0.9, Rgb(0xF0D0A0), 0.35, 0.6).Height = S(0.2);
        // far hills
        G(Rgb(0x141826), 1, TableauCurve.Closed(new[] { -S(0.1), hz + 2, -S(0.1), hz - S(0.03), X(0.2), hz - S(0.05), X(0.45), hz - S(0.02), X(0.7), hz - S(0.045), W + S(0.1), hz - S(0.02), W + S(0.1), hz + 2 }, 5));

        // ---- the curtains of rain: a band a curtain, hung from the cloud base
        for (var b = 0; b < Bands; b++)
        {
            var x = X((b + 0.1) / Bands) - S(0.01); var w = W / Bands * 1.25;
            var r = RB(x, cb - S(0.03), w, hz - cb + S(0.03), Vertical((A(Mix(P(0), P(2), 0.4), 0.6), 0), (A(Mix(P(0), P(2), 0.5), 0.4), 0.7), (A(P(0), 0), 1)), 0.4);
            var sk = new SkewTransform { AngleX = -9 }; _curtainS[b] = new ScaleTransform { ScaleY = 0.3 };
            r.RenderTransform = new TransformGroup { Children = { _curtainS[b], sk } }; _curtain[b] = r; _lv[b] = 0.3;
        }
        for (var i = 0; i < Bolts; i++)
        {
            _boltGlow[i] = PL(B(P(3)), S(0.02), 0); _fork[i] = PL(B(Rgb(0xE8F0FF)), Math.Max(1, S(0.002)), 0); _bolt[i] = PL(B(White), Math.Max(1.5, S(0.0045)), 0);
            foreach (var pl in new[] { _boltGlow[i], _fork[i], _bolt[i] }) { pl.StrokeLineJoin = PenLineJoin.Round; for (var k = 0; k < Seg; k++) pl.Points.Add(new Pt(0, 0)); }
            _bT[i] = 9;
        }
        _strikeGlow = Glow(0, 0, S(0.5), Rgb(0xE8F0FF), 0.7, 0);

        // ---- the storm: an anvil shelf and banks of cloud with cells that light from inside
        RB(0, 0, W, cb + S(0.1), Vertical((Rgb(0x05060C), 0), (Rgb(0x10141E), 0.5), (Rgb(0x1A2030), 0.72), (A(Rgb(0x1A2030), 0), 1)));
        for (var i = 0; i < 26; i++) { var d = S(0.3 + 0.3 * rng.NextDouble()); var e = Glow(X(rng.NextDouble() * 1.1 - 0.05), cb - S(0.03) * rng.NextDouble(), d, Mix(Rgb(0x141826), Rgb(0x222A3C), rng.NextDouble()), 0.75, 1); e.Height = d * 0.5; }
        for (var i = 0; i < Cells; i++)
        {
            double cx = X((i + 0.5) / Cells + 0.04 * (rng.NextDouble() - 0.5)), cy = Y(0.1 + 0.2 * rng.NextDouble());
            _cell[i] = Glow(cx, cy, S(0.45 + 0.2 * rng.NextDouble()), Mix(P(3), P(1), 0.3 + 0.4 * rng.NextDouble()), 0.5, 0.1); _cellPh[i] = rng.NextDouble() * 6;
        }
        for (var i = 0; i < 40; i++)
        {
            var d = S(0.12 + 0.2 * rng.NextDouble()); double x = X(rng.NextDouble() * 1.1 - 0.05), y = Y(0.02 + 0.3 * rng.NextDouble());
            d *= 1.5; var e = Glow(x, y, d, Mix(Rgb(0x0A0C16), Rgb(0x1E2434), rng.NextDouble()), 0.7, 0.85); e.Height = d * (0.45 + 0.2 * rng.NextDouble());
            var hi = Glow(x - d * 0.05, y - d * 0.12, d * 0.7, Rgb(0x4A5676), 0.4, 0.22); hi.Height = d * 0.18;
        }
        // the ragged skirt of the shelf
        for (var i = 0; i < 34; i++) { var d = S(0.16 + 0.16 * rng.NextDouble()); var e = Glow(X(rng.NextDouble() * 1.1 - 0.05), cb - S(0.03) + S(0.035) * rng.NextDouble(), d, Rgb(0x10141D), 0.7, 0.95); e.Height = d * 0.38; }
        for (var i = 0; i < Drops; i++) { _dX[i] = rng.NextDouble() * 1.15; _dY[i] = rng.NextDouble(); _drop[i] = L(0, 0, 1, 1, Rgb(0xC8D8F0), Math.Max(1, S(0.0016)), 0.15); }

        // ---- the plain: a field of wheat, a lane, the farm and its windmill
        _ground = RB(0, hz, W, H - hz + 2, Vertical((Rgb(0x2A2A22), 0), (Rgb(0x18160E), 0.4), (Rgb(0x0A0906), 1)));
        G(Rgb(0x34301F), 0.8, X(0.42), H + 2, X(0.47), hz, X(0.485), hz, X(0.6), H + 2);
        {
            double fx = X(0.72), fb = hz + S(0.012);
            G(Ink, 1, fx - S(0.05), fb, fx - S(0.05), fb - S(0.04), fx - S(0.02), fb - S(0.065), fx + S(0.01), fb - S(0.04), fx + S(0.01), fb);
            G(Ink, 1, fx + S(0.02), fb, fx + S(0.02), fb - S(0.055), fx + S(0.05), fb - S(0.085), fx + S(0.08), fb - S(0.055), fx + S(0.08), fb);
            _window = Glow(fx - S(0.02), fb - S(0.022), S(0.07), Rgb(0xFFC870), 0.9, 0.8); RB(fx - S(0.026), fb - S(0.03), S(0.012), S(0.014), B(Rgb(0xFFD890)));
            for (var k = 0; k < 4; k++) { var tx = fx + S(0.1 + 0.03 * k); E(tx, fb - S(0.04), S(0.04 + 0.01 * (k % 2)), Ink); L(tx, fb, tx, fb - S(0.03), Ink, Math.Max(1, S(0.004))); }
            double mx = X(0.6), mb = hz + S(0.012), mt = mb - S(0.15);
            L(mx - S(0.018), mb, mx, mt, Ink, Math.Max(1, S(0.004))); L(mx + S(0.018), mb, mx, mt, Ink, Math.Max(1, S(0.004))); L(mx - S(0.012), mb - S(0.05), mx + S(0.012), mb - S(0.05), Ink, Math.Max(1, S(0.003)));
            var wheel = new Canvas(); _mill = new RotateTransform { CenterX = mx, CenterY = mt }; wheel.RenderTransform = _mill; C.Children.Add(wheel);
            var root = C; C = wheel;
            for (var k = 0; k < 10; k++) { var a = k * Math.PI / 5; G(Ink, 1, mx, mt, mx + Math.Cos(a - 0.2) * S(0.045), mt + Math.Sin(a - 0.2) * S(0.045), mx + Math.Cos(a + 0.2) * S(0.045), mt + Math.Sin(a + 0.2) * S(0.045)); }
            C = root;
            G(Ink, 1, mx, mt - S(0.006), mx - S(0.07), mt - S(0.022), mx - S(0.07), mt + S(0.022), mx, mt + S(0.006));
            for (var k = 0; k < 9; k++) { var px = X(0.02 + 0.045 * k); L(px, hz + S(0.03) + k * S(0.002), px, hz + S(0.005) + k * S(0.002), Ink, Math.Max(1, S(0.003))); }
            L(X(0.02), hz + S(0.012), X(0.38), hz + S(0.028), Ink, 1, 0.8);
        }
        for (var i = 0; i < Stalks; i++)
        {
            var depth = rng.NextDouble(); _stX[i] = X(rng.NextDouble()); _stY[i] = hz + S(0.04) + (H - hz) * depth; _stH[i] = S(0.03 + 0.07 * depth);
            if (_stX[i] > X(0.42 - 0.1 * depth) && _stX[i] < X(0.6 + 0.1 * depth)) _stX[i] += W * 0.25 * (rng.NextDouble() < 0.5 ? -1 : 1);
            _stalk[i] = L(_stX[i], _stY[i], _stX[i], _stY[i] - _stH[i], Mix(Rgb(0x3A3420), Rgb(0x8A7840), depth * rng.NextDouble()), Math.Max(1, S(0.002 + 0.002 * depth)), 0.9);
            _stalk[i].StrokeEndLineCap = PenLineCap.Round;
        }
        _flash = RB(0, 0, W, H, B(Rgb(0xC8D8FF)), 0);
        Vignette(0.36);
    }

    private void Strike(int i)
    {
        _bT[i] = 0; var x = X(0.1 + 0.8 * Rng.NextDouble()); var gx = x + S(0.14) * (Rng.NextDouble() - 0.5); var fk = 3 + Rng.Next(4);
        for (var k = 0; k < Seg; k++)
        {
            var t = k / (Seg - 1.0); var px = x + (gx - x) * t + (k == 0 || k == Seg - 1 ? 0 : S(0.03) * (Rng.NextDouble() - 0.5)); var py = _base - S(0.02) + (_hz - _base + S(0.02)) * t;
            var p = new Pt(px, py); _bolt[i].Points[k] = p; _boltGlow[i].Points[k] = p;
            _fork[i].Points[k] = k <= fk ? p : new Pt(_bolt[i].Points[fk].X + (k - fk) * S(0.022) * (i % 2 == 0 ? 1 : -1) + S(0.012) * (Rng.NextDouble() - 0.5), _bolt[i].Points[fk].Y + (k - fk) * S(0.02));
        }
        Size(_strikeGlow, gx, _hz, S(0.5)); _strikeGlow.Height = S(0.14); At(_strikeGlow, gx - S(0.25), _hz - S(0.07));
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;
        _sinceBeat += dt;
        if (f.Beat > 0.1 && _prevBeat <= 0.1 && _sinceBeat > 0.45 && !f.Reduced) { _sinceBeat = 0; Strike(_next++ % Bolts); }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 4);
        _idle += dts * 0.9; _tw += dts; _sway += dts * (0.6 + 2.2 * f.Mid); _spin += dts * (20 + 260 * f.Loud);
        _rain += ((f.Reduced ? 0.3 : f.Loud) - _rain) * 0.06;

        // ---- the curtains: a band a curtain
        for (var b = 0; b < Bands; b++)
        {
            var target = f.Reduced ? 0.4 + 0.25 * Math.Sin(_idle * 0.7 + b * 0.5) : Clamp01(Lv(f, b / 23.0) * 1.3 + 0.06 * _flare);
            _lv[b] += (target - _lv[b]) * (target > _lv[b] ? 0.5 : 0.1);
            _curtainS[b].ScaleY = 0.12 + 0.88 * _lv[b]; Op(_curtain[b], 0.15 + 0.75 * _lv[b]);
        }

        // ---- the cells of the cloud with the lows; the bolts
        var low = f.Reduced ? 0.3 + 0.1 * Math.Sin(_idle * 0.4) : f.Low; var lit = 0.0;
        for (var i = 0; i < Bolts; i++)
        {
            if (_bT[i] > 0.5) { Op(_bolt[i], 0); Op(_boltGlow[i], 0); Op(_fork[i], 0); continue; }
            _bT[i] += dt; var u = _bT[i] / 0.5; var a = (1 - u) * (0.6 + 0.4 * Math.Sign(Math.Sin(u * 38)));
            Op(_bolt[i], a); Op(_boltGlow[i], 0.4 * a); Op(_fork[i], 0.7 * a); lit = Math.Max(lit, a);
        }
        for (var i = 0; i < Cells; i++) Op(_cell[i], 0.06 + 0.5 * low * Osc(_tw, 0.9 + (i % 3) * 0.4, _cellPh[i]) + 0.3 * _flare * ((i + _next) % 3 == 0 ? 1 : 0.3) + 0.4 * lit);
        Op(_flash, 0.16 * lit); Op(_strikeGlow, 0.8 * lit); Op(_window, 0.6 + 0.2 * Math.Sin(_tw * 3.1));

        // ---- the near rain, the wheat, the windmill
        for (var i = 0; i < Drops; i++)
        {
            _dY[i] += dts * (1.6 + 1.2 * _rain); if (_dY[i] > 1) { _dY[i] -= 1.05; _dX[i] = Rng.NextDouble() * 1.15; }
            double x = X(_dX[i]) - S(0.16) * _dY[i], y = Y(_dY[i]); var l = _drop[i]; l.X1 = x; l.Y1 = y; l.X2 = x - S(0.014); l.Y2 = y + S(0.07); Op(l, i < Drops * (0.2 + 0.8 * _rain) ? 0.08 + 0.2 * _rain : 0);
        }
        for (var i = 0; i < Stalks; i++)
        {
            var lean = (0.12 + 0.4 * f.Mid) * (0.5 + 0.5 * Math.Sin(_sway - _stX[i] / S(0.25) + i * 0.3)) + 0.05;
            _stalk[i].X2 = _stX[i] - _stH[i] * lean; _stalk[i].Y2 = _stY[i] - _stH[i] * (1 - 0.3 * lean);
        }
        _mill.Angle = _spin % 360;
    }
}
