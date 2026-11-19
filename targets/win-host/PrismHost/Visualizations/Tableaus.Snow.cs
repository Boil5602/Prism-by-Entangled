using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== ENVIRONMENT: Snowfall Village (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A village in a snowy valley at night (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The houses are the meter: twelve houses along the lane and the village hall, twenty-four lit windows, a band a window from the left
/// of the village to the right, and a window warms and throws its light on the snow as its band rises. The snow falls in three
/// depths and drifts with the mids, the chimney smoke rises with the loudness, the string of lights over the square runs with
/// the high notes, and a beat rings the hall's bell: the bell tower flashes and the lights on the pines brighten.
///
/// Detail added 2026-11-16 (asked for): every building has a door with a lamp and a step, the windows have shutters and a sill
/// under snow, the eaves carry icicles, the mountains are tall peaks with a lit face and a shaded one, and a flake is a six-point
/// star. The hall carries no sign of any faith.
///
/// Every shape is made once in OnBuild. A flake is a polygon that is moved, so a frame allocates nothing.
/// </summary>
public sealed class SnowVillage : Tableau
{
    private const int Bands = 24, Flakes = 150, Puffs = 15, Bulbs = 22;
    private readonly Rectangle[] _win = new Rectangle[Bands];
    private readonly Polygon[] _fl = new Polygon[Flakes];
    private readonly Ellipse[] _spill = new Ellipse[Bands], _halo = new Ellipse[Bands], _puff = new Ellipse[Puffs], _bulb = new Ellipse[Bulbs];
    private readonly double[] _lv = new double[Bands], _fx = new double[Flakes], _fy = new double[Flakes], _fv = new double[Flakes], _fp = new double[Flakes];
    private readonly double[] _chX = new double[5], _chY = new double[5];
    private readonly List<(Ellipse e, double ph)> _stars = new();
    private readonly List<(Ellipse e, double ph)> _treeLights = new();
    private Ellipse _belfry = null!, _moon = null!;
    private int _wn, _cn;
    private double _flare, _idle, _tw, _drift, _run;

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Ink = Rgb(0x070A14), Warm = Rgb(0xFFC470);

    private void Window(double x, double y, double w, double h)
    {
        if (_wn >= Bands) return;
        var i = _wn++;
        _halo[i] = Glow(x + w / 2, y + h / 2, w * 4.2, Warm, 0.5, 0);
        _spill[i] = null!;
        RB(x - w * 0.34, y, w * 0.26, h, B(Rgb(0x121828)), 0.95); RB(x + w * 1.08, y, w * 0.26, h, B(Rgb(0x121828)), 0.95);   // shutters
        RB(x - 1, y - 1, w + 2, h + 2, B(Rgb(0x0A0C14)));
        { var sill = RB(x - w * 0.2, y + h, w * 1.4, Math.Max(1.5, h * 0.14), B(Rgb(0xE4ECFA)), 0.92); sill.RadiusX = sill.RadiusY = Math.Max(1, h * 0.07); }   // snow on the sill
        _win[i] = RB(x, y, w, h, Vertical((Rgb(0xFFE6B0), 0), (P(1), 1)), 0.2);
        L(x + w / 2, y, x + w / 2, y + h, Rgb(0x1A1410), Math.Max(1, w * 0.1), 0.8); L(x, y + h * 0.5, x + w, y + h * 0.5, Rgb(0x1A1410), Math.Max(1, w * 0.1), 0.8);
    }
    private static readonly int[] DoorColors = { 0x6A2226, 0x1E5040, 0x24507E, 0x70501E, 0x4A2A5C };
    private void House(double x, double baseY, double w, double h, double roof, int wins, Color wall, bool chimney, Random r, bool hall = false)
    {
        RB(x, baseY - h, w, h + 2, Vertical((Mix(wall, Rgb(0x30405C), 0.25), 0), (wall, 1)));
        for (var k = 1; k < 5; k++) L(x + 1, baseY - h * k / 5.0, x + w - 1, baseY - h * k / 5.0, Rgb(0x05070E), Math.Max(1, S(0.0015)), 0.22);   // planks
        RB(x, baseY - h, Math.Max(1.5, w * 0.03), h, B(Rgb(0x0C1018)), 0.7); RB(x + w - Math.Max(1.5, w * 0.03), baseY - h, Math.Max(1.5, w * 0.03), h, B(Rgb(0x0C1018)), 0.7);   // corner posts
        G(Rgb(0x10141E), 1, x - w * 0.08, baseY - h, x + w * 0.5, baseY - h - roof, x + w * 1.08, baseY - h);
        // snow on the roof: a thick cap that hangs over the eaves
        G(Rgb(0xDCE6F8), 1, TableauCurve.Closed(new[] { x - w * 0.1, baseY - h + roof * 0.06, x + w * 0.2, baseY - h - roof * 0.62, x + w * 0.5, baseY - h - roof * 1.1, x + w * 0.8, baseY - h - roof * 0.62, x + w * 1.1, baseY - h + roof * 0.06, x + w * 0.82, baseY - h - roof * 0.34, x + w * 0.5, baseY - h - roof * 0.84, x + w * 0.18, baseY - h - roof * 0.34 }, 4));
        if (chimney && _cn < 5)
        {
            double cx = x + w * (0.22 + 0.5 * r.NextDouble()), ct = baseY - h - roof * 0.95;
            RB(cx - w * 0.06, ct, w * 0.12, roof * 0.7, B(Rgb(0x1A1418))); var cap = RB(cx - w * 0.08, ct - S(0.006), w * 0.16, S(0.01), B(Rgb(0xE4ECFA))); cap.RadiusX = cap.RadiusY = S(0.004);
            _chX[_cn] = cx; _chY[_cn] = ct - S(0.008); _cn++;
        }
        // icicles under the eaves
        for (var k = 0; k < 7; k++) { var ix = x + w * (0.03 + 0.94 * r.NextDouble()); var il = S(0.008 + 0.014 * r.NextDouble()); var iw = Math.Max(1.2, S(0.003)); G(Rgb(0xDCE6F8), 0.75, ix - iw, baseY - h, ix + iw, baseY - h, ix, baseY - h + il); }
        var ww = w / (wins * 2.0 + 1);
        for (var k = 0; k < wins; k++) Window(x + ww * (1 + 2 * k), baseY - h * 0.82, ww, h * 0.3);
        // the door (2026-11-16, asked for: a building has a door): in the gap between two windows, beside a single one, under the hall's middle one
        {
            double dw = hall ? w * 0.17 : Math.Min(ww * 0.9, w * 0.2), dh = h * (hall ? 0.46 : 0.42), dx = (wins == 1 ? x + w * 0.8 : x + w / 2) - dw / 2, dt = baseY - dh;
            var dc = Rgb(DoorColors[r.Next(DoorColors.Length)]); var edge = Math.Max(1.5, dw * 0.12);
            Glow(dx - dw * 0.5, dt + dh * 0.12, dw * 3.2, Warm, 0.5, 0.55);   // the lamp's light on the wall
            if (hall) E(dx + dw / 2, dt, dw + edge * 2, Rgb(0x0C0E16));
            RB(dx - edge, dt - (hall ? 0 : edge), dw + edge * 2, dh + (hall ? 0 : edge), B(Rgb(0x0C0E16)));
            if (hall) E(dx + dw / 2, dt, dw, Mix(dc, Rgb(0xFFE6B0), 0.2));
            RB(dx, dt, dw, dh, Vertical((Mix(dc, Rgb(0xFFE6B0), 0.2), 0), (dc, 1)));
            if (hall) L(dx + dw / 2, dt - dw * 0.45, dx + dw / 2, baseY, Rgb(0x0C0E16), Math.Max(1, dw * 0.05));
            else { RB(dx + dw * 0.18, dt + dh * 0.1, dw * 0.64, dh * 0.32, B(Mix(dc, Rgb(0x05070E), 0.4)), 0.85); RB(dx + dw * 0.18, dt + dh * 0.52, dw * 0.64, dh * 0.36, B(Mix(dc, Rgb(0x05070E), 0.4)), 0.85); }
            E(dx + dw * (hall ? 0.4 : 0.82), dt + dh * 0.52, Math.Max(1.5, dw * 0.13), Rgb(0xFFD890)); if (hall) E(dx + dw * 0.6, dt + dh * 0.52, Math.Max(1.5, dw * 0.13), Rgb(0xFFD890));
            // a lamp on a bracket beside the door
            L(dx - dw * 0.5, dt - edge, dx - dw * 0.5, dt + dh * 0.06, Rgb(0x0C0E16), Math.Max(1, dw * 0.07)); E(dx - dw * 0.5, dt + dh * 0.12, Math.Max(2, dw * 0.26), Rgb(0xFFE9B8));
            RB(x - w * 0.04, baseY - S(0.006), w * 1.08, S(0.016), B(Rgb(0xC4D0E8)), 0.9).RadiusX = S(0.008);
            { var step = RB(dx - dw * 0.3, baseY - S(0.003), dw * 1.6, S(0.012), B(Rgb(0xEEF4FF))); step.RadiusX = step.RadiusY = S(0.005); }   // the step, under snow
        }
    }

    /// <summary>One peak: the body, the face in shade (the moon stands to the right), the snow cap and its shaded side, two snow streaks.</summary>
    private void Peak(double ax, double ay, double hw, double baseY)
    {
        var d = baseY - ay;
        GB(Vertical((Rgb(0x7084B8), 0), (Rgb(0x3A4878), 0.45), (Rgb(0x1E2848), 1)), 1,
            ax - hw, baseY, ax - hw * 0.55, ay + d * 0.58, ax - hw * 0.42, ay + d * 0.36, ax - hw * 0.16, ay + d * 0.2, ax, ay, ax + hw * 0.2, ay + d * 0.16, ax + hw * 0.36, ay + d * 0.42, ax + hw * 0.6, ay + d * 0.56, ax + hw, baseY);
        G(Rgb(0x0E1430), 0.5, ax, ay, ax - hw * 0.16, ay + d * 0.2, ax - hw * 0.42, ay + d * 0.36, ax - hw * 0.55, ay + d * 0.58, ax - hw, baseY, ax - hw * 0.12, baseY, ax - hw * 0.2, ay + d * 0.7, ax - hw * 0.04, ay + d * 0.5, ax - hw * 0.1, ay + d * 0.34, ax + hw * 0.04, ay + d * 0.22);
        G(Rgb(0xEAF1FF), 1, ax, ay, ax + hw * 0.2, ay + d * 0.16, ax + hw * 0.3, ay + d * 0.32, ax + hw * 0.2, ay + d * 0.27, ax + hw * 0.13, ay + d * 0.4, ax + hw * 0.05, ay + d * 0.28, ax - hw * 0.03, ay + d * 0.42, ax - hw * 0.1, ay + d * 0.3, ax - hw * 0.2, ay + d * 0.4, ax - hw * 0.25, ay + d * 0.27, ax - hw * 0.16, ay + d * 0.2);
        G(Rgb(0x8698CC), 0.6, ax, ay, ax - hw * 0.16, ay + d * 0.2, ax - hw * 0.25, ay + d * 0.27, ax - hw * 0.2, ay + d * 0.4, ax - hw * 0.1, ay + d * 0.3, ax - hw * 0.03, ay + d * 0.42, ax + hw * 0.04, ay + d * 0.22);
        G(Rgb(0xD4E0F8), 0.45, ax + hw * 0.34, ay + d * 0.42, ax + hw * 0.3, ay + d * 0.62, ax + hw * 0.24, ay + d * 0.48);
        G(Rgb(0xD4E0F8), 0.4, ax + hw * 0.14, ay + d * 0.46, ax + hw * 0.16, ay + d * 0.68, ax + hw * 0.08, ay + d * 0.54);
    }
    /// <summary>A pine with snow on its boughs and small lights that run with the high notes. No star on top.</summary>
    private void LitPine(double x, double baseY, double hgt, int lights, Random r)
    {
        var wd = hgt * 0.42;
        RB(x - hgt * 0.035, baseY - hgt * 0.06, hgt * 0.07, hgt * 0.08, B(Rgb(0x1A1410)));
        Pine(x, baseY - hgt, wd, hgt * 0.96, Rgb(0x0E2420));
        foreach (var (t, k) in new[] { (0.42, 0.55), (0.72, 0.8), (1.0, 1.0) })
        {
            double y = baseY - hgt + hgt * 0.96 * t, w = wd * k;
            G(Rgb(0xDCE6F8), 0.85, x - w, y, x - w * 0.55, y - hgt * 0.09, x - w * 0.2, y - hgt * 0.03, x + w * 0.3, y - hgt * 0.1, x + w, y, x + w * 0.4, y - hgt * 0.035, x, y - hgt * 0.01, x - w * 0.5, y - hgt * 0.04);
        }
        for (var k = 0; k < lights; k++)
        {
            var t = 0.08 + 0.8 * r.NextDouble(); var off = wd * 0.8 * (1 - t) * (r.NextDouble() * 2 - 1);
            _treeLights.Add((Glow(x + off, baseY - hgt * 0.08 - hgt * 0.86 * t, Math.Max(S(0.012), hgt * 0.13), P(k % 4), 0.95, 0.7), r.NextDouble() * 6));
        }
    }
    /// <summary>A snowflake: a six-point star around its own middle (2026-11-16, asked for in place of round dots). Moved with At, never resized.</summary>
    private Polygon Flake(double r, double waist, double turn, double op)
    {
        var xy = new double[24];
        for (var k = 0; k < 12; k++) { var rad = k % 2 == 0 ? r : r * waist; var a = turn + k * Math.PI / 6; xy[k * 2] = rad * Math.Cos(a); xy[k * 2 + 1] = rad * Math.Sin(a); }
        return G(Rgb(0xF0F6FF), op, xy);
    }

    protected override void OnBuild()
    {
        _stars.Clear(); _treeLights.Clear(); _wn = 0; _cn = 0;
        var rng = new Random(277); var lane = Y(0.74);

        // ---- the night: deep blue, stars, a moon behind thin cloud, mountains
        RB(0, 0, W, H, Vertical((Rgb(0x060A1C), 0), (Rgb(0x10183A), 0.45), (Rgb(0x283860), 0.75), (Rgb(0x3A4A70), 1)));
        for (var i = 0; i < 70; i++) _stars.Add((E(X(rng.NextDouble()), Y(0.5 * rng.NextDouble() * rng.NextDouble() + 0.02), S(0.002 + 0.003 * rng.NextDouble()), Rgb(0xE8F0FF), 0.6), rng.NextDouble() * 6));
        Glow(X(0.8), Y(0.16), S(0.5), Rgb(0xB0C4F0), 0.3, 0.55); _moon = Glow(X(0.8), Y(0.16), S(0.2), Rgb(0xE8F0FF), 0.7, 0.8); E(X(0.8), Y(0.16), S(0.075), Rgb(0xF0F4FF), 0.95);
        {
            // redrawn 2026-11-16 (the range was one low pale ridge): a far range in haze, and in front of it four tall peaks, each with a
            // face the moon lights, a face in shade and a snow cap with a broken lower edge
            var far = new List<double> { -2, lane };
            foreach (var (px, py) in new[] { (-0.02, 0.5), (0.07, 0.41), (0.15, 0.47), (0.24, 0.37), (0.34, 0.46), (0.45, 0.36), (0.54, 0.46), (0.66, 0.35), (0.76, 0.45), (0.86, 0.39), (1.02, 0.47) }) { far.Add(X(px)); far.Add(Y(py)); }
            far.Add(W + 2); far.Add(lane); GB(Vertical((Rgb(0x52649A), 0), (Rgb(0x303E68), 1)), 0.8, far.ToArray());
            foreach (var (px, py, hw) in new[] { (0.07, 0.3, 0.2), (0.58, 0.27, 0.2), (0.33, 0.17, 0.25), (0.97, 0.23, 0.22) }) Peak(X(px), Y(py), X(hw), lane);
        }
        // a hill of pines behind the village
        G(Rgb(0x16203A), 1, TableauCurve.Closed(new[] { -S(0.1), lane + S(0.1), -S(0.1), Y(0.56), X(0.2), Y(0.52), X(0.45), Y(0.6), X(0.7), Y(0.53), W + S(0.1), Y(0.57), W + S(0.1), lane + S(0.1) }, 5));
        for (var i = 0; i < 40; i++) { var fx = rng.NextDouble(); var py = Y(0.55 + 0.03 * Math.Sin(fx * 9) + 0.04 * rng.NextDouble()); { var ph = S(0.05 + 0.04 * rng.NextDouble()); Pine(X(fx), py + S(0.03) - ph, ph * 0.5, ph, Rgb(0x0C1428)); } }

        // pines with lights in the forest, behind the roofs
        foreach (var (fx, fh) in new[] { (0.04, 0.1), (0.15, 0.085), (0.275, 0.11), (0.41, 0.09), (0.57, 0.1), (0.69, 0.115), (0.83, 0.09), (0.95, 0.105) })
            LitPine(X(fx), Y(0.6 + 0.03 * Math.Sin(fx * 9)), S(fh), 6, rng);

        // ---- the back row: the village hall with its bell tower, and six houses up the slope
        var walls = new[] { Rgb(0x1C2238), Rgb(0x241E2C), Rgb(0x1A2430), Rgb(0x2A2030) };
        {
            double cx = X(0.5), cb = Y(0.68), cw = S(0.16), chh = S(0.13);
            RB(cx - S(0.03), cb - chh - S(0.14), S(0.06), S(0.16), Vertical((Rgb(0x2A3250), 0), (Rgb(0x1C2238), 1)));
            _belfry = Glow(cx, cb - chh - S(0.1), S(0.2), Warm, 0.9, 0.2);
            var arch = RB(cx - S(0.012), cb - chh - S(0.12), S(0.024), S(0.04), B(Rgb(0xFFDFA0)), 0.8); arch.RadiusX = arch.RadiusY = S(0.012);
            G(Rgb(0x10141E), 1, cx - S(0.04), cb - chh - S(0.14), cx, cb - chh - S(0.3), cx + S(0.04), cb - chh - S(0.14));
            G(Rgb(0xDCE6F8), 1, cx - S(0.042), cb - chh - S(0.138), cx, cb - chh - S(0.3), cx + S(0.012), cb - chh - S(0.25), cx - S(0.018), cb - chh - S(0.15));
            // a plain finial on the tower: a short pole and a ball. No sign of any faith is drawn on the hall (2026-11-16, asked that the
            // village's hall belongs to no one religion; a cross stood here before).
            L(cx, cb - chh - S(0.3), cx, cb - chh - S(0.325), Rgb(0xC8D4EC), Math.Max(1, S(0.003))); E(cx, cb - chh - S(0.329), S(0.009), Rgb(0xC8D4EC), 1);
            House(cx - cw / 2, cb, cw, chh, S(0.07), 3, Rgb(0x222A44), false, rng, true);
        }
        foreach (var (fx, fw, fh, n) in new[] { (0.06, 0.1, 0.08, 1), (0.2, 0.12, 0.1, 2), (0.33, 0.09, 0.075, 1), (0.61, 0.1, 0.085, 2), (0.74, 0.12, 0.1, 2), (0.89, 0.09, 0.075, 1) })
            House(X(fx), Y(0.69 - 0.02 * Math.Sin(fx * 7)), S(fw * 1.2), S(fh), S(0.05), n, walls[rng.Next(4)], rng.NextDouble() < 0.6, rng);

        // ---- the snow field and the lane; the windows' light lies on it
        GB(Vertical((Rgb(0xC0CCE8), 0), (Rgb(0x8494BC), 0.35), (Rgb(0x4A5884), 1)), 1, TableauCurve.Closed(new[] { -S(0.1), H + S(0.1), -S(0.1), Y(0.7), X(0.25), Y(0.73), X(0.5), Y(0.7), X(0.75), Y(0.73), W + S(0.1), Y(0.7), W + S(0.1), H + S(0.1) }, 5));
        // ---- the front row: six bigger houses on the lane
        var back = _wn;
        foreach (var (fx, fw, fh, n) in new[] { (0.02, 0.15, 0.13, 2), (0.19, 0.13, 0.11, 2), (0.34, 0.1, 0.1, 1), (0.6, 0.11, 0.1, 2), (0.73, 0.13, 0.12, 2), (0.875, 0.12, 0.11, 2) })
        {
            if (_wn + n > Bands) break;
            House(X(fx), Y(0.83), S(fw * 1.35), S(fh * 1.2), S(0.07), n, walls[rng.Next(4)], true, rng);
        }
        // sort the windows left to right so the bands run across the village
        {
            var order = Enumerable.Range(0, _wn).OrderBy(i => Canvas.GetLeft(_win[i])).ToArray();
            var w2 = order.Select(i => _win[i]).ToArray(); var h2 = order.Select(i => _halo[i]).ToArray();
            for (var i = 0; i < _wn; i++) { _win[i] = w2[i]; _halo[i] = h2[i]; }
        }
        for (var i = 0; i < _wn; i++)
        {
            double wx = Canvas.GetLeft(_win[i]) + _win[i].Width / 2, wy = Canvas.GetTop(_win[i]) + _win[i].Height;
            var front = wy > Y(0.72); var sp = Glow(wx, (front ? Y(0.86) : wy + S(0.05)), S(front ? 0.2 : 0.12), Warm, 0.5, 0); sp.Height = S(front ? 0.06 : 0.035); At(sp, wx - sp.Width / 2, (front ? Y(0.85) : wy + S(0.03))); _spill[i] = sp; _lv[i] = 0.3;
        }
        for (var i = 0; i < Puffs; i++) _puff[i] = Glow(0, 0, S(0.03), Rgb(0xC8D4EC), 0.6, 0);

        // ---- the square: pines with lights, a string of bulbs, a snowman, fences
        {
            // 2026-11-16: one tall tree with a star stood alone in the square and read as one faith's tree. Now pines with lights stand
            // through the village and the forest, none with a star: three in the square, some by the houses.
            LitPine(X(0.455), Y(0.9), S(0.17), 12, rng); LitPine(X(0.53), Y(0.885), S(0.12), 9, rng); LitPine(X(0.57), Y(0.91), S(0.2), 14, rng);
            LitPine(X(0.175), Y(0.85), S(0.1), 7, rng); LitPine(X(0.325), Y(0.86), S(0.085), 6, rng); LitPine(X(0.715), Y(0.855), S(0.09), 6, rng); LitPine(X(0.865), Y(0.85), S(0.1), 7, rng);
        }
        {
            double x0 = X(0.3), x1 = X(0.7), y0 = Y(0.66), sag = S(0.05);
            L(x0, y0, x0, Y(0.86), Rgb(0x10141E), Math.Max(1.5, S(0.005))); L(x1, y0, x1, Y(0.86), Rgb(0x10141E), Math.Max(1.5, S(0.005)));
            var pts = new double[42]; for (var k = 0; k <= 20; k++) { var t = k / 20.0; pts[k * 2] = x0 + (x1 - x0) * t; pts[k * 2 + 1] = y0 + sag * 4 * t * (1 - t); }
            { var pl = PL(B(Rgb(0x10141E)), Math.Max(1, S(0.002)), 0.9); for (var k = 0; k <= 20; k++) pl.Points.Add(new Pt(pts[k * 2], pts[k * 2 + 1])); }
            for (var k = 0; k < Bulbs; k++) { var t = (k + 0.5) / Bulbs; _bulb[k] = Glow(x0 + (x1 - x0) * t, y0 + sag * 4 * t * (1 - t) + S(0.006), S(0.03), P(k % 4), 0.95, 0.5); }
        }
        {
            double sx = X(0.4), sb = Y(0.92);
            E(sx, sb - S(0.022), S(0.05), Rgb(0xE4ECFA)); E(sx, sb - S(0.06), S(0.036), Rgb(0xEEF4FF)); E(sx, sb - S(0.088), S(0.026), Rgb(0xF4F8FF));
            E(sx - S(0.005), sb - S(0.091), S(0.004), Ink); E(sx + S(0.005), sb - S(0.091), S(0.004), Ink); G(P(1), 1, sx, sb - S(0.087), sx + S(0.016), sb - S(0.084), sx, sb - S(0.082));
            RB(sx - S(0.012), sb - S(0.112), S(0.024), S(0.014), B(Ink)); RB(sx - S(0.018), sb - S(0.1), S(0.036), S(0.004), B(Ink));
            L(sx - S(0.016), sb - S(0.062), sx - S(0.04), sb - S(0.08), Rgb(0x1A1410), Math.Max(1, S(0.003))); L(sx + S(0.016), sb - S(0.062), sx + S(0.04), sb - S(0.085), Rgb(0x1A1410), Math.Max(1, S(0.003)));
        }
        for (var i = 0; i < 9; i++) { var fx = X(0.02 + 0.04 * i); L(fx, H - S(0.02) - i * S(0.004), fx, H - S(0.07) - i * S(0.004), Rgb(0x141826), Math.Max(1.5, S(0.005))); E(fx, H - S(0.072) - i * S(0.004), S(0.012), Rgb(0xE4ECFA)); }
        for (var i = 0; i < 4; i++) { var fx = i % 2 == 0 ? -0.01 + 0.03 * rng.NextDouble() : 0.98 + 0.03 * rng.NextDouble(); var ph = S(0.16 + 0.08 * rng.NextDouble()); LitPine(X(fx), H + S(0.02), ph, 10, rng); }

        // ---- the snow in the air, in three depths
        for (var i = 0; i < Flakes; i++)
        {
            var depth = i % 3; _fx[i] = rng.NextDouble(); _fy[i] = rng.NextDouble(); _fv[i] = (0.05 + 0.04 * depth) * (0.8 + 0.4 * rng.NextDouble()); _fp[i] = rng.NextDouble() * 6;
            _fl[i] = Flake(S(0.003 + 0.0035 * depth + 0.002 * rng.NextDouble()), depth == 2 ? 0.26 : 0.4, rng.NextDouble() * Math.PI, 0.4 + 0.25 * depth);
        }
        Vignette(0.3);
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 3.5);
        _idle += dts * 0.9; _tw += dts; _drift += dts * (0.3 + 1.2 * f.Mid); _run += dts * (1 + 5 * f.High);

        // ---- the windows: a band a window
        for (var i = 0; i < _wn; i++)
        {
            var target = f.Reduced ? 0.4 + 0.25 * Math.Sin(_idle * 0.7 + i * 0.6) : Clamp01(Lv(f, i / (double)Math.Max(1, _wn - 1)) * 1.3 + 0.08 * _flare);
            _lv[i] += (target - _lv[i]) * (target > _lv[i] ? 0.5 : 0.1);
            Op(_win[i], 0.12 + 0.88 * _lv[i]); Op(_halo[i], 0.75 * _lv[i]); Op(_spill[i], 0.7 * _lv[i]);
        }

        // ---- the bell, the tree, the string of lights, the sky
        Op(_belfry, 0.15 + 0.8 * _flare);
        for (var i = 0; i < _treeLights.Count; i++) { var (e, ph) = _treeLights[i]; Op(e, 0.35 + 0.5 * Osc(_run, 0.6, ph) + 0.25 * _flare); }
        for (var k = 0; k < Bulbs; k++) Op(_bulb[k], 0.25 + 0.7 * Math.Pow(0.5 + 0.5 * Math.Sin(_run * 1.4 - k * 0.7), 2) + 0.2 * _flare);
        for (var i = 0; i < _stars.Count; i++) { var (e, ph) = _stars[i]; Op(e, 0.3 + 0.5 * Osc(_tw, 0.5 + (i % 5) * 0.2, ph)); }
        Op(_moon, 0.65 + 0.2 * f.Loud);

        // ---- the smoke and the snow
        for (var i = 0; i < Puffs; i++)
        {
            var c = i % Math.Max(1, _cn); if (_cn == 0) break;
            var age = (_tw * (0.1 + 0.08 * f.Loud) + i / (double)Puffs * 3.0) % 1.0;
            Size(_puff[i], _chX[c] + S(0.05) * age * age + S(0.008) * Math.Sin(age * 9 + i), _chY[c] - S(0.14) * age, S(0.02 + 0.06 * age)); Op(_puff[i], (0.25 + 0.35 * f.Loud) * Math.Sin(Math.PI * Math.Sqrt(age)));
        }
        for (var i = 0; i < Flakes; i++)
        {
            _fy[i] += dts * _fv[i]; if (_fy[i] > 1.02) { _fy[i] = -0.02; _fx[i] = Rng.NextDouble(); }
            var e = _fl[i]; At(e, X(_fx[i]) + S(0.02 + 0.01 * (i % 3)) * Math.Sin(_drift * (0.6 + 0.2 * (i % 4)) + _fp[i]), Y(_fy[i]));
        }
    }
}
