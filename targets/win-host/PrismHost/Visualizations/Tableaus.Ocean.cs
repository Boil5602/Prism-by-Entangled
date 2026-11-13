using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== ENVIRONMENT: Moonlit Ocean (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A full moon over open water (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The moon's path on the water is the meter: twenty-four rows of light from the horizon to the eye, a band a row, the high notes
/// fine and far, the low notes broad and near, and a row spreads as wide and shines as bright as its band. The rows ride six
/// bands of swell that rise and run with the lows. The halo breathes with the loudness and its ring shows on a beat. A beat sends
/// a pod of dolphins over the path; the high notes light the near crests with sea-sparkle. A ship under sail crosses the horizon.
///
/// Every shape is made once in OnBuild. A swell is one polygon whose points are moved in place, a row of light is one rectangle,
/// a dolphin is one group on one transform, so a frame allocates nothing.
/// </summary>
public sealed class OceanMoon : Tableau
{
    private const int M = 48, Layers = 6, Rows = 24, Glints = 72, Sparks = 44, Dolphins = 5;
    private readonly Polygon[] _wave = new Polygon[Layers];
    private readonly Polyline[] _crest = new Polyline[Layers];
    private readonly double[] _base = new double[Layers], _amp = new double[Layers], _now = new double[Layers], _k = new double[Layers], _ph = new double[Layers], _rate = new double[Layers];
    private readonly Rectangle[] _rowR = new Rectangle[Rows], _glint = new Rectangle[Glints];
    private readonly double[] _rowY = new double[Rows], _rowT = new double[Rows], _rowHalf = new double[Rows], _lv = new double[Rows];
    private readonly int[] _rowLayer = new int[Rows], _gRow = new int[Glints], _sLayer = new int[Sparks];
    private readonly double[] _gOff = new double[Glints], _gPh = new double[Glints], _sX = new double[Sparks], _sPh = new double[Sparks];
    private readonly Ellipse[] _spark = new Ellipse[Sparks];
    private readonly CompositeTransform[] _dolT = new CompositeTransform[Dolphins];
    private readonly UIElement[] _dol = new UIElement[Dolphins];
    private readonly Ellipse[] _splashA = new Ellipse[Dolphins], _splashB = new Ellipse[Dolphins];
    private readonly double[] _dT = new double[Dolphins], _dX = new double[Dolphins], _dY = new double[Dolphins], _dDir = new double[Dolphins], _dSpan = new double[Dolphins], _dHigh = new double[Dolphins];
    private readonly List<(Ellipse c, Ellipse rim, double x, double y, double w)> _clouds = new();
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private Ellipse _halo = null!, _halo2 = null!, _ring = null!, _column = null!;
    private TranslateTransform _ship = null!;
    private double _hy, _cx, _swell = 0.3, _flare, _prevBeat, _sinceBeat = 9, _sinceJump = 3, _idle, _tw, _cloud, _shipX = 0.75;
    private int _jumps, _podLeft, _podDir = 1;
    private double _podX, _podIn;

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Moon = Rgb(0xF4F2E6), Abyss = Rgb(0x03060E);
    private double WaveD(int l, double x) => _now[l] * (0.7 * Math.Sin(_k[l] * x + _ph[l]) + 0.3 * Math.Sin(_k[l] * 1.9 * x - _ph[l] * 1.3 + l));

    private void Swell(int l, double baseY, double amp, double length, double rate, Color top, Color bottom)
    {
        _base[l] = baseY; _amp[l] = amp; _now[l] = amp; _k[l] = 2 * Math.PI / length; _rate[l] = rate; _ph[l] = l * 1.7;
        var p = new Polygon { Fill = Vertical((top, 0), (Mix(top, bottom, 0.7), 0.4), (bottom, 1)) };
        var c = new Polyline { Stroke = B(Mix(top, P(0), 0.5)), StrokeThickness = Math.Max(1, S(0.0018 + 0.0007 * l)), Opacity = 0.45 };
        for (var j = 0; j <= M; j++) { var x = -4 + (W + 8) * j / M; p.Points.Add(new Pt(x, baseY)); c.Points.Add(new Pt(x, baseY)); }
        p.Points.Add(new Pt(W + 4, H + 4)); p.Points.Add(new Pt(-4, H + 4));
        C.Children.Add(p); C.Children.Add(c); _wave[l] = p; _crest[l] = c;
    }

    protected override void OnBuild()
    {
        _clouds.Clear();
        var rng = new Random(251); var hy = _hy = Y(0.5); var cx = _cx = X(0.5);
        double my = Y(0.27), mr = S(0.125);

        // ---- the sky: the moon, its halo and ring, stars, thin cloud
        RB(0, 0, W, hy + 2, Vertical((Rgb(0x02050E), 0), (Rgb(0x081632), 0.5), (Rgb(0x16305A), 0.9), (Rgb(0x244878), 1)));
        _stars = Stars(110, 0.46, White, 61);
        _halo2 = Glow(cx, my, mr * 9, P(0), 0.22, 0.6); _halo = Glow(cx, my, mr * 4.2, Mix(P(0), White, 0.4), 0.45, 0.6);
        _ring = new Ellipse { Width = mr * 6.4, Height = mr * 6.4, Stroke = B(Mix(P(0), White, 0.5)), StrokeThickness = Math.Max(1, S(0.003)), Opacity = 0.04 }; At(_ring, cx - mr * 3.2, my - mr * 3.2); C.Children.Add(_ring);
        E(cx, my, mr * 2, Moon);
        foreach (var (dx, dy, d, a) in new[] { (-0.32, -0.25, 0.62, 0.16), (0.18, -0.42, 0.4, 0.13), (0.3, 0.1, 0.5, 0.14), (-0.2, 0.36, 0.44, 0.12), (-0.55, 0.12, 0.24, 0.1), (0.52, 0.48, 0.2, 0.1), (0.05, 0.02, 0.2, 0.08) })
            E(cx + dx * mr, my + dy * mr, d * mr, Rgb(0x8C94A4), a * 1.05);
        { var shade = new Ellipse { Width = mr * 2, Height = mr * 2 }; var br = new RadialGradientBrush { Center = new Pt(0.42, 0.4), GradientOrigin = new Pt(0.42, 0.4), RadiusX = 0.62, RadiusY = 0.62 };
          br.GradientStops.Add(new GradientStop { Color = A(Rgb(0x283C5C), 0), Offset = 0.6 }); br.GradientStops.Add(new GradientStop { Color = A(Rgb(0x283C5C), 0.4), Offset = 1 }); shade.Fill = br; At(shade, cx - mr, my - mr); C.Children.Add(shade); }
        for (var i = 0; i < 4; i++)
        {
            var w = S(0.5 + 0.5 * rng.NextDouble());
            var rim = Glow(0, 0, w, Mix(P(0), White, 0.3), 0.3, 0.3); var c = Glow(0, 0, w, Rgb(0x0C1830), 0.7, 0.4);
            _clouds.Add((c, rim, rng.NextDouble(), 0.12 + 0.3 * rng.NextDouble(), w));
        }
        RB(0, hy - S(0.12), W, S(0.12), Vertical((A(P(0), 0), 0), (A(P(0), 0.2), 1)));

        // ---- a ship under sail on the horizon
        {
            var g = new Canvas(); C.Children.Add(g); _ship = new TranslateTransform(); g.RenderTransform = _ship; var root = C; C = g; var u = S(0.0052); var ink = Rgb(0x050A16);
            G(ink, 1, -u * 8, hy - u * 1.4, u * 9.5, hy - u * 1.9, u * 7, hy + 1, -u * 7, hy + 1);
            foreach (var (mx, mh) in new[] { (-4.5, 9.0), (0.0, 11.5), (4.5, 9.5) })
            {
                L(u * mx, hy - u * 1.5, u * mx, hy - u * (mh + 1.5), ink, Math.Max(1, u * 0.3));
                for (var k = 0; k < 3; k++) { double y0 = hy - u * (2.2 + k * mh * 0.31), hw = u * (2.1 - 0.4 * k); G(ink, 0.92, u * mx - hw, y0, u * mx + hw, y0, u * mx + hw * 0.85, y0 - u * mh * 0.27, u * mx - hw * 0.85, y0 - u * mh * 0.27); }
            }
            G(ink, 0.92, u * 5, hy - u * 2.4, u * 12, hy - u * 2.4, u * 5, hy - u * 9);
            E(-u * 7.4, hy - u * 2.2, u * 1.0, Rgb(0xFFC070), 0.95);
            C = root;
        }

        // ---- the sea, far to near; the light of the moon straight under it
        RB(0, hy, W, H - hy + 2, Vertical((Rgb(0x1A3C68), 0), (Rgb(0x0C2444), 0.2), (Rgb(0x040A18), 1)));
        _column = Glow(cx, hy + S(0.12), S(0.3), Mix(P(0), White, 0.5), 0.5, 0.5); _column.Height = S(0.5); At(_column, cx - S(0.15), hy - S(0.13));
        Swell(0, Y(0.525), S(0.0025), S(0.22), 1.0, Rgb(0x183C68), Rgb(0x0E284C));
        Swell(1, Y(0.57), S(0.004), S(0.32), 0.9, Rgb(0x143460), Rgb(0x0C2242));
        Swell(2, Y(0.63), S(0.006), S(0.45), 0.8, Rgb(0x102C54), Rgb(0x0A1C38));
        for (var i = 0; i < Dolphins; i++) BuildDolphin(i);
        Swell(3, Y(0.71), S(0.009), S(0.62), 0.7, Rgb(0x0C2446), Rgb(0x08162C));
        Swell(4, Y(0.8), S(0.012), S(0.82), 0.6, Rgb(0x0A1C3A), Rgb(0x050E20));
        Swell(5, Y(0.9), S(0.016), S(1.05), 0.5, Rgb(0x081630), Rgb(0x030814));

        // ---- the moon's path: a row of light a band, and loose glints round it
        var light = Mix(Moon, P(0), 0.25);
        for (var k = 0; k < Rows; k++)
        {
            var t = Math.Pow((k + 0.5) / Rows, 1.55); _rowT[k] = t; _rowY[k] = hy + (H - hy) * (0.012 + 0.97 * t); _lv[k] = 0.3;
            var l = 0; for (var q = 0; q < Layers; q++) if (_base[q] <= _rowY[k]) l = q; _rowLayer[k] = l;
            var br = new LinearGradientBrush { StartPoint = new Pt(0, 0.5), EndPoint = new Pt(1, 0.5) };
            br.GradientStops.Add(new GradientStop { Color = A(light, 0), Offset = 0 }); br.GradientStops.Add(new GradientStop { Color = A(light, 0.75), Offset = 0.28 }); br.GradientStops.Add(new GradientStop { Color = A(Mix(light, White, 0.5), 0.9), Offset = 0.5 });
            br.GradientStops.Add(new GradientStop { Color = A(light, 0.75), Offset = 0.72 }); br.GradientStops.Add(new GradientStop { Color = A(light, 0), Offset = 1 });
            var r = RB(cx, _rowY[k], 10, Math.Max(1.5, S(0.0025 + 0.008 * t)), br, 0.5); r.RadiusX = r.RadiusY = S(0.004); _rowR[k] = r;
        }
        for (var i = 0; i < Glints; i++)
        {
            var k = rng.Next(Rows); _gRow[i] = k; _gOff[i] = (rng.NextDouble() < 0.5 ? -1 : 1) * (0.45 + 1.1 * rng.NextDouble()); _gPh[i] = rng.NextDouble() * 6;
            var g = RB(0, _rowY[k] + S(0.012) * (rng.NextDouble() - 0.5) * (0.3 + _rowT[k]), S(0.008 + 0.03 * _rowT[k]) * (0.5 + rng.NextDouble()), Math.Max(1, S(0.002 + 0.004 * _rowT[k])), B(light), 0); g.RadiusX = g.RadiusY = S(0.003); _glint[i] = g;
        }
        for (var i = 0; i < Sparks; i++)
        {
            _sLayer[i] = 3 + rng.Next(3); _sX[i] = X(rng.NextDouble()); _sPh[i] = rng.NextDouble() * 6;
            _spark[i] = Glow(0, 0, S(0.012 + 0.012 * rng.NextDouble()), Mix(P(1), White, 0.3), 1, 0);
        }
        Vignette(0.32);
    }

    private void BuildDolphin(int i)
    {
        _splashA[i] = Glow(0, 0, S(0.05), Mix(P(0), White, 0.6), 0.9, 0); _splashB[i] = Glow(0, 0, S(0.05), Mix(P(0), White, 0.6), 0.9, 0);
        var g = new Canvas { Opacity = 0 }; C.Children.Add(g); _dolT[i] = new CompositeTransform(); g.RenderTransform = _dolT[i]; _dol[i] = g; _dT[i] = 9; var root = C; C = g;
        var s = S(0.17); var ink = Rgb(0x040A16);
        var o = TableauCurve.Closed(new[] { 0.57, 0.04, 0.46, 0.0, 0.41, -0.05, 0.3, -0.095, 0.1, -0.135, -0.02, -0.138, -0.17, -0.27, -0.14, -0.122, -0.32, -0.068, -0.47, 0.0, -0.59, -0.02, -0.56, 0.05, -0.64, 0.125, -0.47, 0.058, -0.25, 0.062, 0.05, 0.1, 0.28, 0.095, 0.44, 0.072, 0.55, 0.06 }, 4);
        for (var q = 0; q < o.Length; q++) o[q] *= s; G(ink, 1, o);
        G(ink, 1, 0.24 * s, 0.085 * s, 0.07 * s, 0.215 * s, 0.11 * s, 0.09 * s);   // the flipper, swept back
        E(0.385 * s, -0.012 * s, Math.Max(1.2, s * 0.02), Mix(P(0), White, 0.7), 0.8);
        var back = PL(B(A(Mix(P(0), White, 0.5), 0.7)), Math.Max(1, s * 0.022)); foreach (var (px, py) in new[] { (0.44, -0.02), (0.4, -0.055), (0.3, -0.1), (0.1, -0.14), (-0.02, -0.143), (-0.165, -0.272) }) back.Points.Add(new Pt(px * s, py * s));
        C = root;
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;
        Twinkle(_stars, f, 0.35);

        // ---- the beat: the ring round the moon, a dolphin over the path
        _sinceBeat += dt; _sinceJump += dt; var hit = false;
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.2 && !f.Reduced) { _sinceBeat = 0; hit = true; }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 3.8);
        _idle += dts * 0.9; _tw += dts;
        // a pod (2026-11-11, asked for more dolphins): the first one over on the beat, and one or two more a moment behind it, the same way
        bool Leap(int dir, double fromX)
        {
            for (var i = 0; i < Dolphins; i++)
                if (_dT[i] > 1.3)
                {
                    _dT[i] = 0; _dDir[i] = dir; _dSpan[i] = S(0.24 + 0.1 * Rng.NextDouble()); _dHigh[i] = S(0.11 + 0.07 * Rng.NextDouble());
                    _dX[i] = fromX; _dY[i] = _base[3] + S(0.012); return true;
                }
            return false;
        }
        if ((hit && _sinceJump > 0.9) || _sinceJump > (f.Reduced ? 9 : 5))
        {
            _jumps++; _podDir = _jumps % 2 == 0 ? 1 : -1; _podX = _cx + S(0.5) * (Rng.NextDouble() - 0.5) - _podDir * S(0.15);
            if (Leap(_podDir, _podX)) { _sinceJump = 0; _podLeft = f.Reduced ? 0 : Rng.Next(3); _podIn = 0.28; }
        }
        if (_podLeft > 0 && (_podIn -= dt) <= 0) { _podX -= _podDir * S(0.13 + 0.06 * Rng.NextDouble()); Leap(_podDir, _podX); _podLeft--; _podIn = 0.24 + 0.12 * Rng.NextDouble(); }

        // ---- the swell rises and runs with the lows
        _swell += ((f.Reduced ? 0.3 : f.Low) - _swell) * 0.06;
        for (var l = 0; l < Layers; l++)
        {
            _ph[l] += dts * _rate[l] * (0.7 + 0.9 * _swell); _now[l] = _amp[l] * (0.5 + 2.4 * _swell);
            var p = _wave[l].Points; var crest = _crest[l].Points;
            for (var j = 0; j <= M; j++) { var x = -4 + (W + 8) * j / M; var pt = new Pt(x, _base[l] + WaveD(l, x)); p[j] = pt; crest[j] = pt; }
        }

        // ---- the moon's path: a band a row, wide and bright with its level
        for (var k = 0; k < Rows; k++)
        {
            var band = (Rows - 1 - k) / (double)(Rows - 1);
            var target = f.Reduced ? 0.38 + 0.22 * Math.Sin(_idle + k * 0.5) : Clamp01(Lv(f, band) * 1.3 + 0.1 * _flare);
            _lv[k] += (target - _lv[k]) * (target > _lv[k] ? 0.5 : 0.12);
            double lv = _lv[k], t = _rowT[k];
            var half = (S(0.02 + 0.05 * t) + W * (0.03 + 0.4 * t) * lv) * (0.9 + 0.1 * Math.Sin(_tw * 2.7 + k * 1.9)) * (0.72 + 0.5 * ((k * 0.618) % 1)); _rowHalf[k] = half;
            var r = _rowR[k]; r.Width = half * 2;
            At(r, _cx - half + half * 0.3 * Math.Sin(_tw * 0.9 + k * 2.4) + S(0.004 + 0.012 * t) * Math.Sin(_tw * 1.3 + k * 0.8), _rowY[k] + WaveD(_rowLayer[k], _cx) - r.Height / 2);
            Op(r, (0.3 + 0.7 * lv) * (0.82 + 0.18 * Math.Sin(_tw * 3.1 + k * 2.3)));
        }
        for (var i = 0; i < Glints; i++)
        {
            var k = _gRow[i]; var g = _glint[i];
            Canvas.SetLeft(g, _cx + _gOff[i] * _rowHalf[k] - g.Width / 2);
            Op(g, (0.1 + 0.8 * _lv[k]) * Math.Pow(Osc(_tw, 2.2 + i % 5 * 0.6, _gPh[i]), 2) * (Math.Abs(_gOff[i]) > 1 ? 0.6 : 0.9));
        }
        for (var i = 0; i < Sparks; i++)
        {
            var l = _sLayer[i]; var tw = Math.Pow(Osc(_tw, 3 + i % 4, _sPh[i]), 4);
            At(_spark[i], _sX[i], _base[l] + WaveD(l, _sX[i]) - S(0.004)); Op(_spark[i], f.Reduced ? 0.12 * tw : Clamp01(f.High * 1.6 - 0.1) * tw);
        }

        // ---- the dolphins
        for (var i = 0; i < Dolphins; i++)
        {
            if (_dT[i] > 1.3) { Op(_dol[i], 0); Op(_splashA[i], 0); Op(_splashB[i], 0); continue; }
            _dT[i] += dt * (0.55 + 0.45 * f.Speed) / 1.15; var t = Math.Min(1, _dT[i]);
            double x = _dX[i] + _dDir[i] * _dSpan[i] * t, y = _dY[i] - 4 * _dHigh[i] * t * (1 - t) + S(0.012);
            var ang = Math.Atan2(-4 * _dHigh[i] * (1 - 2 * t), _dSpan[i]) * 57.29578;
            var tr = _dolT[i]; tr.TranslateX = x; tr.TranslateY = y; tr.ScaleX = _dDir[i]; tr.Rotation = ang * _dDir[i];
            Op(_dol[i], _dT[i] > 1 ? 0 : 1);
            Size(_splashA[i], _dX[i], _dY[i], S(0.03) + S(0.1) * _dT[i], S(0.008) + S(0.016) * _dT[i]); Op(_splashA[i], 0.8 * Math.Exp(-_dT[i] * 4));
            var late = _dT[i] - 0.95;
            if (late > 0) { Size(_splashB[i], _dX[i] + _dDir[i] * _dSpan[i], _dY[i], S(0.03) + S(0.3) * late, S(0.008) + S(0.05) * late); Op(_splashB[i], 0.9 * Math.Exp(-late * 9)); } else Op(_splashB[i], 0);
        }

        // ---- the moon, the cloud, the ship
        Op(_halo, 0.4 + 0.45 * f.Loud + 0.15 * _flare); Op(_halo2, 0.3 + 0.5 * f.Loud); Op(_ring, 0.03 + 0.05 * f.Loud + 0.22 * _flare);
        Op(_column, 0.3 + 0.5 * f.Loud);
        _cloud += dts * 0.005;
        for (var i = 0; i < _clouds.Count; i++)
        {
            var (c, rim, x, y, w) = _clouds[i]; var px = X((x + _cloud * (0.7 + 0.25 * (i % 3)) + 0.4) % 1.8 - 0.4);
            Size(c, px, Y(y), w, w * 0.07); Size(rim, px + S(0.01), Y(y) - w * 0.012, w * 0.96, w * 0.06);
        }
        _shipX += dts * 0.0028; if (_shipX > 1.1) _shipX = -0.1;   // bow first: the jib and the long end of the hull are at the right (2026-11-11, it sailed stern first) _ship.X = X(_shipX); _ship.Y = S(0.0015) * Math.Sin(_tw * 0.8);
    }
}
