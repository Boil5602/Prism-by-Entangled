using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== ENVIRONMENT: Rain on the Window (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A window on a rainy night, seen from the room (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The city beyond the glass is out of focus, and its lights are the meter: seventy-two soft discs, three to a band, low notes at
/// the left and high at the right, and a disc grows and brightens with its band. On the glass the beads of rain sit still, the
/// runs slide down faster as the music gets louder, the rain outside thickens with it, and a beat lands a few new drops. On the
/// sill a candle burns with the low notes beside a cup that steams and a plant.
///
/// A run of water (drawn again 2026-11-11, asked for water that is clear and bends what is behind it, in place of a white head on
/// a thin wavy tail): the drop is a small lens, dark along its top and pale along its foot as a real drop turns the view over, with
/// the colour of the light behind it inside, brighter as that light's band rises.
///
/// How the water behaves (2026-11-11, asked for streaks that stay on the glass, drops that get smaller as they streak, and runs that
/// meet and join). A drop sits and grows as the rain feeds it; past a weight of its own it runs. Its track stays where it was laid
/// and dries from the top. The drop leaves its water in the track, so it shrinks and at last stops, unless it takes up the beads
/// in its way. A drop that comes near another one's track slides across into it, goes faster down the wet path, and joins the drop
/// at its end, which grows by it. A beat lands water on two waiting drops and sets them off.
///
/// Every shape is made once in OnBuild. A run is a group, a track and four beads that are moved, so a frame allocates nothing.
/// </summary>
public sealed class RainWindow : Tableau
{
    private const int Bands = 24, Discs = 72, Runs = 44, Fall = 56, Rings = 8, Steam = 6;
    private readonly Ellipse[] _tint = new Ellipse[Runs], _crumb = new Ellipse[Runs * 4], _ring = new Ellipse[Rings], _steam = new Ellipse[Steam];
    private readonly double[] _dX = new double[Discs], _dY = new double[Discs], _dD = new double[Discs], _lv = new double[Bands];
    private readonly Line[] _fall = new Line[Fall];
    private const int Beads = 170;
    private readonly Polyline[] _track = new Polyline[Runs];
    // A size that changes every frame is set on the compositor's Visual, which sizes the finished picture; a size set on the shape
    // or through a render transform has XAML paint the shape again each frame (2026-11-12: this scene drew 10 frames a second where
    // others drew 30; the same finding as Sunrise Meadow's flower heads). The lights and the drops are drawn once at their largest.
    private readonly Canvas[] _disc = new Canvas[Discs];
    private readonly TranslateTransform[] _dT = new TranslateTransform[Discs];
    private readonly Microsoft.UI.Composition.Visual[] _dV = new Microsoft.UI.Composition.Visual[Discs], _hV = new Microsoft.UI.Composition.Visual[Runs];
    private const double DiscMax = 1.25, HeadMax = 2.5;
    /// <summary>A canvas whose size is the compositor's to set: `place` carries the position (t) and the opacity, the canvas returned
    /// holds the shapes, and v.Scale sizes them about (cx, cy).</summary>
    private Canvas Stage(double w, double h, double cx, double cy, TranslateTransform t, bool cache, out Canvas place, out Microsoft.UI.Composition.Visual v)
    {
        var cv = new Canvas(); if (w > 0) { cv.Width = w; cv.Height = h; } if (cache) cv.CacheMode = new BitmapCache();
        v = Microsoft.UI.Xaml.Hosting.ElementCompositionPreview.GetElementVisual(cv); v.CenterPoint = new System.Numerics.Vector3((float)cx, (float)cy, 0);
        place = new Canvas { RenderTransform = t }; At(cv, -cx, -cy); place.Children.Add(cv); C.Children.Add(place); return cv;
    }
    private readonly Canvas[] _beadG = new Canvas[Beads];
    private readonly double[] _bX = new double[Beads], _bY = new double[Beads], _bD = new double[Beads], _bT = new double[Beads];
    // a run: 0 waits and grows, 1 runs, 2 is gone into another (its track dries). M: its weight; Y0: the top of its track; E: where a
    // gone run's track ends; X0, Ay, Kx, By: the track's line, straight down X0 to Ay, across to Kx at By, then down
    private readonly int[] _rS = new int[Runs], _fol = new int[Runs], _tgt = new int[Runs], _gen = new int[Runs], _tgtGen = new int[Runs];
    private readonly bool[] _kink = new bool[Runs], _steer = new bool[Runs];
    private readonly double[] _rM = new double[Runs], _rY0 = new double[Runs], _rE = new double[Runs], _x0 = new double[Runs], _ay = new double[Runs], _kx = new double[Runs], _by = new double[Runs], _thr = new double[Runs], _rG = new double[Runs];
    private double _d0;

    private const int TrackPts = 14;

    /// <summary>The small wander of a run's path (2026-11-11, asked for paths that are not straight down): short stretches that lean a
    /// little one way and then the other, by chance, and fixed to the glass so that a track keeps the line the drop took.</summary>
    private double Wander(int i, double y)
    {
        var u = y / S(0.045) + i * 7.31; var k = Math.Floor(u); var f = u - k; f = f * f * (3 - 2 * f);
        static double Hash(double n) { var v = Math.Sin(n * 127.1) * 43758.5453; return v - Math.Floor(v) - 0.5; }
        return S(0.012) * (Hash(k + i * 31.7) * (1 - f) + Hash(k + 1 + i * 31.7) * f);
    }

    private double PathX(int i, double y)
    {
        var w = Wander(i, y);
        if (!_kink[i] || y <= _ay[i]) return _x0[i] + w;
        if (y >= _by[i]) return _kx[i] + w;
        return _x0[i] + (_kx[i] - _x0[i]) * (y - _ay[i]) / Math.Max(1, _by[i] - _ay[i]) + w;
    }

    private void Respawn(int i)
    {
        _gen[i]++; _x0[i] = X(0.03 + 0.94 * Rng.NextDouble()); _rY[i] = _rY0[i] = (0.03 + 0.8 * Rng.NextDouble()) * _sill; _rX[i] = _x0[i] + Wander(i, _rY[i]); _rM[i] = 0.15 + 0.4 * Rng.NextDouble();
        _rS[i] = 0; _kink[i] = false; _steer[i] = false; _fol[i] = -1; _thr[i] = 1 + 1.2 * Rng.NextDouble(); _rG[i] = 0.5 + Rng.NextDouble();
    }
    private readonly Canvas[] _headG = new Canvas[Runs];
    private readonly TranslateTransform[] _hT = new TranslateTransform[Runs];
    private readonly double[] _rD = new double[Runs];
    private readonly double[] _rX = new double[Runs], _rY = new double[Runs], _rV = new double[Runs], _rLen = new double[Runs], _rPh = new double[Runs];
    private readonly double[] _fX = new double[Fall], _fY = new double[Fall], _fV = new double[Fall];
    private readonly double[] _gT = new double[Rings], _gX = new double[Rings], _gY = new double[Rings];
    private Ellipse _candle = null!, _candleGlass = null!;
    private Polygon _flame = null!;
    private ScaleTransform _flameS = null!;
    private Rectangle _street = null!;
    private double _sill, _steamX, _steamY, _flare, _prevBeat, _sinceBeat = 9, _idle, _tw, _wet = 0.3;
    private int _next;

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Ink = Rgb(0x05060A), Warm = Rgb(0xFFB45C);

    protected override void OnBuild()
    {
        var rng = new Random(271); var sill = _sill = Y(0.86);

        // ---- the night outside: a street of lights with no edges
        RB(0, 0, W, H, Vertical((Rgb(0x04060E), 0), (Rgb(0x0C1226), 0.5), (Rgb(0x181630), 0.8), (Rgb(0x0C0C1A), 1)));
        _street = RB(0, Y(0.45), W, Y(0.45), Vertical((A(P(1), 0), 0), (A(Mix(P(1), P(2), 0.5), 0.16), 0.7), (A(P(1), 0), 1)));
        var hues = new[] { P(0), P(1), P(2), P(3), Rgb(0xF05060), Rgb(0xF0E0C0) };
        for (var i = 0; i < Discs; i++)
        {
            var b = i % Bands; var row = i / Bands; var deep = rng.NextDouble();
            _dX[i] = X((b + 0.5) / Bands + 0.035 * (rng.NextDouble() - 0.5)); _dY[i] = Y(row == 0 ? 0.5 + 0.2 * rng.NextDouble() : row == 1 ? 0.28 + 0.2 * rng.NextDouble() : 0.08 + 0.2 * rng.NextDouble());
            _dD[i] = S(row == 0 ? 0.09 + 0.08 * deep : row == 1 ? 0.06 + 0.06 * deep : 0.035 + 0.04 * deep);
            var c = hues[rng.Next(row == 0 ? 6 : 4)]; if (row == 0 && rng.NextDouble() < 0.3) c = Rgb(0xF05060);
            var dm = _dD[i] * DiscMax;
            var e = new Ellipse { Width = dm, Height = dm, Fill = B(A(c, 0.42)), Stroke = B(A(Mix(c, White, 0.25), 0.6)), StrokeThickness = Math.Max(1, S(0.0022)) };
            _dT[i] = new TranslateTransform { X = _dX[i], Y = _dY[i] };
            Stage(dm, dm, dm / 2, dm / 2, _dT[i], true, out var lamp, out _dV[i]).Children.Add(e); lamp.Opacity = 0.2; _disc[i] = lamp;
        }
        for (var b = 0; b < Bands; b++) _lv[b] = 0.3;
        // rain in the air beyond the glass
        for (var i = 0; i < Fall; i++) { _fX[i] = rng.NextDouble() * 1.2; _fY[i] = rng.NextDouble(); _fV[i] = 1.2 + rng.NextDouble(); _fall[i] = L(0, 0, 1, 1, Rgb(0xA8C0E0), Math.Max(1, S(0.0016)), 0.1); }

        // ---- the glass: a breath of mist, beads that sit, runs that slide, a small splash where a drop lands
        RB(0, 0, W, sill, Vertical((A(Rgb(0x8CA0C0), 0.05), 0), (A(Rgb(0x8CA0C0), 0.02), 0.5), (A(Rgb(0x8CA0C0), 0.1), 1)));
        _candleGlass = Glow(X(0.2), Y(0.72), S(0.6), Warm, 0.3, 0.4);
        for (var i = 0; i < Beads; i++)
        {
            double x = _bX[i] = X(rng.NextDouble()), y = _bY[i] = rng.NextDouble() * sill, d = _bD[i] = S(0.004 + 0.012 * rng.NextDouble() * rng.NextDouble()); _bT[i] = 1;
            var g = _beadG[i] = new Canvas(); C.Children.Add(g); var keep = C; C = g;
            var bead = E(x, y, d, Rgb(0x0A1020), 0.35); bead.Height = d * 1.25;
            E(x, y + d * 0.3, d * 0.55, Rgb(0xC8DCF4), 0.35 + 0.3 * rng.NextDouble()); E(x - d * 0.18, y - d * 0.25, d * 0.2, White, 0.5);
            C = keep;
        }
        var lens = Vertical((A(Rgb(0x02040A), 0.5), 0), (A(Rgb(0x8CA8D0), 0.05), 0.5), (A(Rgb(0xE4F0FF), 0.42), 1));
        var wake = B(A(Rgb(0xA8C4E8), 0.11)); var edge = B(A(Rgb(0xDCEBFF), 0.28)); var d0 = _d0 = S(0.0095);
        for (var i = 0; i < Runs; i++)
        {
            _rPh[i] = rng.NextDouble() * 6; Respawn(i); _rM[i] = 0.2 + 1.6 * rng.NextDouble();
            _track[i] = PL(wake, d0 * 0.62, 0); _track[i].StrokeStartLineCap = PenLineCap.Round; _track[i].StrokeLineJoin = PenLineJoin.Round; for (var k = 0; k < TrackPts; k++) _track[i].Points.Add(new Pt(0, 0));
            for (var k = 0; k < 4; k++) { var c = E(0, 0, d0 * (0.16 + 0.16 * rng.NextDouble()), Rgb(0xC8DCF4), 0); c.Height = c.Width * 1.2; _crumb[i * 4 + k] = c; }
            _hT[i] = new TranslateTransform(); var g = Stage(0, 0, 0, 0, _hT[i], false, out var drop, out _hV[i]); _headG[i] = drop;
            var big = new Canvas { RenderTransform = new ScaleTransform { ScaleX = HeadMax, ScaleY = HeadMax } }; g.Children.Add(big); var keep = C; C = big;
            var body = new Ellipse { Width = d0, Height = d0 * 1.22, Fill = lens, Stroke = edge, StrokeThickness = Math.Max(0.8, d0 * 0.07) }; At(body, -d0 / 2, -d0 * 1.22); C.Children.Add(body);
            _tint[i] = E(0, -d0 * 0.74, d0 * 0.56, hues[rng.Next(6)], 0.3);
            var foot = E(0, 0, d0 * 0.5, White, 0.32); foot.Height = d0 * 0.15; At(foot, -d0 * 0.25, -d0 * 0.3);
            E(-d0 * 0.2, -d0 * 0.94, d0 * 0.13, White, 0.55);
            C = keep;
        }
        for (var i = 0; i < Rings; i++)
        {
            var e = new Ellipse { Width = 4, Height = 4, Stroke = B(Rgb(0xDCEBFF)), StrokeThickness = Math.Max(1, S(0.0025)), Opacity = 0 }; C.Children.Add(e); _ring[i] = e; _gT[i] = 9;
        }

        // ---- the window's bars, the sill, and what stands on it
        var wood = Rgb(0x0A0808);
        RB(X(0.5) - S(0.011), 0, S(0.022), sill, B(wood)); RB(0, Y(0.36) - S(0.009), W, S(0.018), B(wood));
        RB(X(0.5) - S(0.011), 0, Math.Max(1, S(0.003)), sill, B(Rgb(0x2A2420)), 0.7); RB(0, Y(0.36) - S(0.009), W, Math.Max(1, S(0.003)), B(Rgb(0x2A2420)), 0.7);
        RB(0, 0, S(0.03), H, B(wood)); RB(W - S(0.03), 0, S(0.03), H, B(wood)); RB(0, 0, W, S(0.025), B(wood));
        RB(0, sill, W, H - sill + 2, Vertical((Rgb(0x2A1E18), 0), (Rgb(0x140E0C), 0.25), (Rgb(0x060404), 1)));
        RB(0, sill, W, Math.Max(1.5, S(0.004)), B(Rgb(0x5A4434)), 0.7);
        {   // the candle in its glass
            double cx = X(0.2), cb = sill + S(0.03), cw = S(0.07), chh = S(0.1);
            _candle = Glow(cx, cb - chh * 0.9, S(0.42), Warm, 0.65, 0.6);
            var jar = RB(cx - cw / 2, cb - chh, cw, chh, Vertical((A(Rgb(0xFFD8A0), 0.25), 0), (A(Warm, 0.5), 0.5), (A(Rgb(0x5A3418), 0.9), 1))); jar.RadiusX = jar.RadiusY = S(0.008);
            RB(cx - cw * 0.36, cb - chh * 0.5, cw * 0.72, chh * 0.5, Vertical((Rgb(0xF4E4C8), 0), (Rgb(0xB89868), 1)));
            L(cx, cb - chh * 0.5, cx, cb - chh * 0.62, Ink, Math.Max(1, S(0.002)));
            _flame = G(Rgb(0xFFE8B0), 1, TableauCurve.Closed(new[] { cx, cb - chh * 0.6, cx - cw * 0.09, cb - chh * 0.7, cx, cb - chh * 0.98, cx + cw * 0.09, cb - chh * 0.7 }, 5));
            _flameS = new ScaleTransform { CenterX = cx, CenterY = cb - chh * 0.6 }; _flame.RenderTransform = _flameS;
        }
        {   // the cup
            double mx = X(0.78), mb = sill + S(0.035), mw = S(0.085), mh = S(0.075); _steamX = mx; _steamY = mb - mh;
            for (var i = 0; i < Steam; i++) _steam[i] = Glow(0, 0, S(0.03), Rgb(0xC8D4E8), 0.5, 0);
            var ring = new Ellipse { Width = mw * 0.6, Height = mh * 0.62, Stroke = B(Rgb(0x1A1E2A)), StrokeThickness = S(0.012) }; At(ring, mx + mw * 0.3, mb - mh * 0.85); C.Children.Add(ring);
            var cup = RB(mx - mw / 2, mb - mh, mw, mh, Vertical((Rgb(0x2A3044), 0), (Rgb(0x10131C), 1))); cup.RadiusX = cup.RadiusY = S(0.012);
            RB(mx - mw / 2, mb - mh, mw, S(0.008), B(Rgb(0x4A546E)), 0.8); RB(mx - mw * 0.42, mb - mh * 0.8, Math.Max(1.5, S(0.004)), mh * 0.6, B(Rgb(0x5A6680)), 0.5);
        }
        {   // the plant
            double px = X(0.92), pb = sill + S(0.04);
            for (var k = 0; k < 9; k++)
            {
                var a = -Math.PI / 2 + (k - 4) * 0.3 + 0.1 * (rng.NextDouble() - 0.5); var len = S(0.14 + 0.1 * rng.NextDouble());
                double ex = px + Math.Cos(a) * len, ey = pb - S(0.07) + Math.Sin(a) * len, nx = -Math.Sin(a) * len * 0.13, ny = Math.Cos(a) * len * 0.13;
                G(k % 2 == 0 ? Rgb(0x0A1410) : Rgb(0x0E1C16), 1, px, pb - S(0.07), (px + ex) / 2 + nx, (pb - S(0.07) + ey) / 2 + ny, ex, ey, (px + ex) / 2 - nx, (pb - S(0.07) + ey) / 2 - ny);
            }
            G(Rgb(0x1C1412), 1, px - S(0.045), pb - S(0.075), px + S(0.045), pb - S(0.075), px + S(0.035), pb, px - S(0.035), pb);
        }
        Vignette(0.34);
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;
        _sinceBeat += dt; var hit = false;
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.2 && !f.Reduced) { _sinceBeat = 0; hit = true; }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 4);
        _idle += dts * 0.9; _tw += dts;
        _wet += ((f.Reduced ? 0.25 : f.Loud) - _wet) * 0.05;

        // ---- the lights beyond: a band to three discs
        for (var b = 0; b < Bands; b++)
        {
            var target = f.Reduced ? 0.38 + 0.25 * Math.Sin(_idle * 0.8 + b * 0.55) : Clamp01(Lv(f, b / 23.0) * 1.3 + 0.1 * _flare);
            _lv[b] += (target - _lv[b]) * (target > _lv[b] ? 0.5 : 0.12);
        }
        for (var i = 0; i < Discs; i++)
        {
            var lv = _lv[i % Bands]; var k = (float)((0.8 + 0.45 * lv) / DiscMax);
            _dV[i].Scale = new System.Numerics.Vector3(k, k, 1); _dT[i].X = _dX[i] + S(0.002) * Math.Sin(_tw * 0.6 + i); Op(_disc[i], 0.1 + 0.85 * lv);
        }
        Op(_street, 0.4 + 0.5 * f.Loud);

        // ---- the rain in the air, the runs on the glass, the rings
        var slant = S(0.03);
        for (var i = 0; i < Fall; i++)
        {
            _fY[i] += dts * _fV[i] * (0.8 + 0.8 * _wet); if (_fY[i] > 1) { _fY[i] -= 1.1; _fX[i] = Rng.NextDouble() * 1.2; }
            double x = X(_fX[i]) - slant * _fY[i] * 6, y = Y(_fY[i]) * 0.9; var l = _fall[i];
            l.X1 = x; l.Y1 = y; l.X2 = x - slant; l.Y2 = y + S(0.08); Op(l, i < Fall * (0.25 + 0.75 * _wet) ? 0.05 + 0.14 * _wet : 0);
        }
        for (var k = 0; k < Beads; k++) if (_bT[k] < 1) { _bT[k] += dt * (0.02 + 0.08 * _wet); Op(_beadG[k], (_bT[k] - 0.4) / 0.6); }
        double look = S(0.05), reach = S(0.04), gap = S(0.035);
        for (var i = 0; i < Runs; i++)
        {
            var st = _rS[i]; var d = _d0 * Math.Sqrt(_rM[i]);
            if (st == 0)
            {   // waits: the rain feeds it until it is heavy enough to run
                _rM[i] += dts * (0.03 + 0.2 * _wet) * _rG[i]; if (_rM[i] >= _thr[i]) _rS[i] = 1;
            }
            else if (st == 1)
            {
                var j = _steer[i] ? _tgt[i] : _fol[i];
                if (j >= 0 && (_gen[j] != _tgtGen[i] || (_rS[j] == 2 ? _rE[j] : _rY[j]) < _rY[i] - d)) { _steer[i] = false; _fol[i] = -1; j = -1; }   // that track is gone or behind
                var stick = 0.35 + 0.65 * Osc(_tw, 0.7 + i % 4 * 0.2, _rPh[i]);
                var dy = dts * H * (0.04 + 0.1 * _rM[i]) * (0.35 + 1.9 * _wet) * stick * (_fol[i] >= 0 ? 1.7 : 1);
                _rY[i] += dy; _rM[i] -= dy / H * 2.0 * (_fol[i] >= 0 ? 0.35 : 1);
                if (j < 0 && !_kink[i])
                {   // another run's track, or a waiting drop, close by and lower down: slide across to it
                    var best = -1; var bestD = reach;
                    for (var o = 0; o < Runs; o++)
                    {
                        if (o == i) continue; var end = _rS[o] == 2 ? _rE[o] : _rY[o];
                        if (end < _rY[i] + d * 0.6 || _rY0[o] > _rY[i] + look) continue;
                        var dx = Math.Abs(PathX(o, _rY[i]) - _rX[i]); if (dx < bestD) { bestD = dx; best = o; }
                    }
                    if (best >= 0) { _kink[i] = true; _steer[i] = true; _tgt[i] = best; _tgtGen[i] = _gen[best]; _ay[i] = _by[i] = _rY[i]; _kx[i] = _rX[i] - Wander(i, _rY[i]); j = best; }
                }
                if (_steer[i])
                {
                    var tx = PathX(j, _rY[i]); var dx = tx - _rX[i]; _rX[i] += Math.Sign(dx) * Math.Min(Math.Abs(dx), dy * 0.9); _by[i] = _rY[i]; _kx[i] = _rX[i] - Wander(i, _rY[i]);
                    if (Math.Abs(tx - _rX[i]) < 1) { _steer[i] = false; _fol[i] = j; }
                }
                else if (_fol[i] >= 0) _rX[i] = PathX(j, _rY[i]);
                else _rX[i] = (_kink[i] ? _kx[i] : _x0[i]) + Wander(i, _rY[i]);
                if (j >= 0 && _rS[j] != 2)
                {   // the two drops meet: the one in front takes the other's water
                    var dj = _d0 * Math.Sqrt(_rM[j]);
                    if (Math.Abs(_rX[j] - _rX[i]) < (d + dj) * 0.5 && _rY[i] >= _rY[j] - dj) { _rM[j] = Math.Min(6, _rM[j] + _rM[i]); _rS[i] = 2; _rE[i] = Math.Max(_rY0[i], _rY[j] - dj * 0.5); }
                }
                if (_rS[i] == 1)
                {
                    for (var k = 0; k < Beads; k++)
                        if (_bT[k] >= 1 && Math.Abs(_bX[k] - _rX[i]) < (d + _bD[k]) * 0.5 && _bY[k] > _rY[i] - d * 1.2 && _bY[k] < _rY[i] + 2) { _rM[i] = Math.Min(6, _rM[i] + _bD[k] * _bD[k] / (_d0 * _d0) * 0.5); _bT[k] = -0.6 * Rng.NextDouble(); Op(_beadG[k], 0); }
                    if (_rY[i] > _sill) { _rS[i] = 2; _rE[i] = _sill; }
                    else if (_rM[i] < 0.3) { _rS[i] = 0; _steer[i] = false; _fol[i] = -1; _thr[i] = 1 + 1.2 * Rng.NextDouble(); }   // spent: it stops and waits
                }
            }
            st = _rS[i]; var foot = st == 2 ? _rE[i] : _rY[i];
            // the track dries from the top; a run that is gone is made again when its track has dried
            _rY0[i] += dt * S(0.035) * (st == 2 ? 3 : 1);
            if (_rY0[i] >= foot)
            {
                _rY0[i] = foot;
                if (st == 2) { Respawn(i); st = 0; foot = _rY[i]; }
                else if (!_steer[i] && _fol[i] < 0) { _kink[i] = false; _x0[i] = _rX[i] - Wander(i, _rY[i]); }
            }
            d = _d0 * Math.Sqrt(_rM[i]); double x = _rX[i], y = Math.Min(_rY[i], _sill - 2);
            _hT[i].X = x; _hT[i].Y = y; var hk = (float)(d / _d0 / HeadMax); _hV[i].Scale = new System.Numerics.Vector3(hk, hk, 1); Op(_headG[i], st == 2 ? 0 : 0.6 + 0.25 * _wet);
            Op(_tint[i], 0.1 + 0.65 * _lv[Math.Clamp((int)(x / W * Bands), 0, Bands - 1)]);
            var tr = _track[i]; var top = _rY0[i]; var btm = Math.Min(foot, _sill) - (st == 2 ? 0 : d * 0.5);
            if (btm - top < 2) Op(tr, 0);
            else
            {
                var pts = tr.Points;
                for (var k = 0; k < TrackPts; k++) { var ty = top + (btm - top) * k / (TrackPts - 1.0); pts[k] = new Pt(k == TrackPts - 1 && st != 2 ? x : PathX(i, ty), ty); }
                Op(tr, 0.55 + 0.4 * _wet);
            }
            // the beads the run leaves: each keeps its place on the glass and fades as the drop goes on
            var m = Math.Floor((foot - d * 1.3) / gap);
            for (var k = 0; k < 4; k++)
            {
                var cy = (m - k) * gap; var c = _crumb[i * 4 + k];
                At(c, PathX(i, cy) + _d0 * 0.2 * Math.Sin((m - k) * 12.9898 + i) - c.Width / 2, cy); Op(c, cy < top || cy > btm ? 0 : 0.42 * (1 - (foot - cy) / (4 * gap)));
            }
        }
        // a beat: rain lands on two waiting drops, with a small splash, and sets them off
        if (hit) for (var k = 0; k < 2; k++) { var r = Rng.Next(Runs); if (_rS[r] != 0) continue; _rM[r] += 0.9; var i = _next++ % Rings; _gT[i] = 0; _gX[i] = _rX[r]; _gY[i] = _rY[r] - _d0; }
        for (var i = 0; i < Rings; i++)
        {
            if (_gT[i] > 0.9) { Op(_ring[i], 0); continue; }
            _gT[i] += dt; var d = S(0.008) + S(0.014) * Math.Sqrt(_gT[i] / 0.9); var e = _ring[i];
            e.Width = d; e.Height = d * 1.1; At(e, _gX[i] - d / 2, _gY[i] - d * 0.55); Op(e, 0.6 * (1 - _gT[i] / 0.9));
        }

        // ---- the sill: the candle with the lows, the steam
        var low = f.Reduced ? 0.4 : f.Low;
        var flick = 0.75 + 0.15 * Math.Sin(_tw * 9.1) * Math.Sin(_tw * 5.3) + 0.25 * low + 0.2 * _flare;
        _flameS.ScaleY = 0.8 + 0.4 * flick; _flameS.ScaleX = 0.95 + 0.1 * Math.Sin(_tw * 7.7);
        Op(_candle, 0.35 + 0.4 * flick); Op(_candleGlass, 0.15 + 0.3 * flick);
        for (var i = 0; i < Steam; i++)
        {
            var age = (_tw * 0.16 + i / (double)Steam) % 1.0;
            Size(_steam[i], _steamX + S(0.02) * Math.Sin(age * 7 + i * 2), _steamY - S(0.16) * age, S(0.02 + 0.05 * age)); Op(_steam[i], 0.3 * Math.Sin(Math.PI * Math.Sqrt(age)));
        }
    }
}
