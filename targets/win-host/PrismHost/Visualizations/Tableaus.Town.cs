using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== SEASONS: the town (see Tableaus.cs for the toolkit)
// UNDER CONSTRUCTION (2026-11-12): Seasons is not ready and is held back from releases (StylePacks.Held). It shows only in a development start.
// This file is pure ASCII.

/// <summary>
/// The Seasons visual (2026-11-12, asked for a seasonal scene a person can set up, and for one scene in which people of different
/// beliefs live side by side and celebrate together).
///
/// A small town at dusk, in the season of the year: thirteen homes of many builds around a square with one great tree, a long
/// table set for everyone, and neighbours out walking. The windows are the meter, a band a window from the left of the town to
/// the right. The string of lights over the square runs with the high notes, the walkers step with the low ones, and what is in
/// the air (petals, fireflies, leaves, snow) drifts with the mids.
///
/// The holidays that are on today (SeasonsCalendar, by the settings) each dress one home: lamps on a step, lanterns at a door,
/// lights along a roof. More than one shows at a time, next door to each other. What is drawn is what a household puts out for
/// the day: lights, flowers, food, cloth. No one who is worshipped is drawn, no one at prayer, and no writing.
///
/// Every shape is made once in OnBuild; a frame moves and lights them. The town is made again when the plan changes (a new day,
/// a new setting), which the scene looks for every few seconds.
/// </summary>
public sealed partial class SeasonsTown : Tableau
{
    /// <summary>The host's reading of the settings and the clock; null in a test, which gets the town in spring with no holiday.</summary>
    public static Func<SeasonsPlan>? PlanSource;

    private const int Bands = 24, Motes = 90, Bulbs = 26, Walkers = 9;
    private readonly Rectangle[] _win = new Rectangle[Bands];
    private readonly Ellipse[] _halo = new Ellipse[Bands], _mote = new Ellipse[Motes], _bulb = new Ellipse[Bulbs];
    private readonly double[] _lv = new double[Bands], _mx = new double[Motes], _my = new double[Motes], _mv = new double[Motes], _mp = new double[Motes];
    private readonly TranslateTransform[] _walkT = new TranslateTransform[Walkers];
    private readonly double[] _wx = new double[Walkers], _wy = new double[Walkers], _wv = new double[Walkers], _wp = new double[Walkers];
    private readonly List<(Ellipse e, double ph)> _lights = new(), _stars = new();
    private readonly List<(double x, double b, double w, double h, double door, double winX, double winY, double winW, double winH)> _homes = new();
    private Ellipse _sun = null!, _treeGlow = null!;
    private int _wn;
    private string _sig = "", _season = "spring";
    private double _since, _flare, _idle, _tw, _drift, _run, _step, _rope, _surIn = 10, _surP;
    private int _pn, _surI = -1, _last = -1;
    private readonly List<(TranslateTransform t, int kind, double x, double y, double amp, double ph)> _movers = new();
    private readonly List<Surprise> _sur = new();
    // arms and legs: each turns about its shoulder or hip. A channel says how much its owner walks (0 at rest, 1 walking).
    private readonly List<(RotateTransform r, double sign, double walk, double idle, bool wave, int ch, double ph)> _limbs = new();
    private readonly List<double> _gait = new();
    private int _ch;
    private TranslateTransform? _ballT; private RotateTransform? _kiteR; private (double x, double y)[] _ballPts = Array.Empty<(double, double)>();
    private Microsoft.UI.Composition.Visual? _ropeV;

    /// <summary>Something that happens in the town now and then, and is not there the rest of the time.</summary>
    private sealed class Surprise { public Canvas G = null!; public TranslateTransform T = null!; public double Len; public Action<Surprise, double> Step = (_, _) => { }; public Action? Start; }

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Dark = Rgb(0x0C0E16), Warm = Rgb(0xFFC470), Flame = Rgb(0xFFD890);

    // ------------------------------------------------------------------ small parts
    private void Light(double x, double y, double d, Color c, double a = 0.9)
    {
        var rng = _lights.Count * 1.7;
        _lights.Add((Glow(x, y, d * 3.2, c, a, 0.7), rng)); E(x, y, d, Mix(c, White, 0.5));
    }
    private void Candle(double x, double baseY, double h, Color body)
    {
        R(x - h * 0.12, baseY - h, h * 0.24, h, body); Light(x, baseY - h - h * 0.22, h * 0.22, Flame);
    }
    private void Bunting(double x0, double x1, double y, double size, params Color[] cols)
    {
        var n = Math.Max(3, (int)((x1 - x0) / (size * 1.3)));
        L(x0, y, x1, y, Dark, Math.Max(1, size * 0.08), 0.8);
        for (var k = 0; k < n; k++) { var x = x0 + (x1 - x0) * (k + 0.5) / n; G(cols[k % cols.Length], 0.95, x - size * 0.45, y, x + size * 0.45, y, x, y + size); }
    }
    private void Hung(double x, double y, double drop, double d, Color c, bool tall = false)
    {
        L(x, y, x, y + drop, Dark, Math.Max(1, d * 0.08), 0.8);
        _lights.Add((Glow(x, y + drop + d * 0.5, d * 3, c, 0.8, 0.6), x));
        var body = E(x, y + drop + d * 0.5, d, c); if (tall) { body.Height = d * 1.4; }
        R(x - d * 0.22, y + drop - d * 0.08, d * 0.44, d * 0.14, Rgb(0xD8B050)); R(x - d * 0.22, y + drop + d * (tall ? 1.32 : 0.94), d * 0.44, d * 0.12, Rgb(0xD8B050));
    }
    private void Stand(double x, double baseY, double w, Color cloth)
    {
        R(x - w / 2, baseY - w * 0.5, w, w * 0.1, cloth); R(x - w * 0.42, baseY - w * 0.42, w * 0.06, w * 0.42, Dark); R(x + w * 0.36, baseY - w * 0.42, w * 0.06, w * 0.42, Dark);
    }

    private void Window(double x, double y, double w, double h, bool arched)
    {
        if (_wn >= Bands) return;
        var i = _wn++;
        _halo[i] = Glow(x + w / 2, y + h / 2, w * 4, Warm, 0.5, 0);
        var frame = RB(x - 1.5, y - 1.5, w + 3, h + 3, B(Rgb(0x14121A))); if (arched) { frame.RadiusX = frame.RadiusY = w * 0.5; }
        _win[i] = RB(x, y, w, h, Vertical((Rgb(0xFFEEC0), 0), (Rgb(0xF0A040), 1)), 0.2); if (arched) { _win[i].RadiusX = _win[i].RadiusY = w * 0.5; }
        L(x + w / 2, y + (arched ? w * 0.2 : 0), x + w / 2, y + h, Rgb(0x2A2018), Math.Max(1, w * 0.08), 0.7);
        if (!arched)
        {   // curtains, drawn back
            var cur = Rgb(Cloths[(i * 3 + 2) % Cloths.Length]);
            G(cur, 0.85, x, y, x + w * 0.4, y, x + w * 0.14, y + h * 0.62, x, y + h * 0.95); G(cur, 0.85, x + w, y, x + w * 0.6, y, x + w * 0.86, y + h * 0.62, x + w, y + h * 0.95);
        }
        // a box of the season's flowers on the sill
        var fc = _season switch { "summer" => new[] { 0xF04848, 0xF8D040, 0xB060E0 }, "autumn" => new[] { 0xF08A28, 0xF0C040, 0xC84A28 }, "winter" => new[] { 0x2E8A50, 0xD83A34, 0x2E8A50 }, _ => new[] { 0xF888B8, 0xFFF4E0, 0xF8D860 } };
        R(x - w * 0.14, y + h, w * 1.28, h * 0.1, Rgb(0x6A4428));
        for (var k = 0; k < 4; k++) E(x + w * (0.08 + 0.28 * k), y + h - h * 0.01, w * 0.3, Rgb(fc[k % 3]));
    }

    /// <summary>One home: a wall, a roof of its own build, a door, its windows. The builds are ways of building that stand next to each
    /// other in many towns; none is meant as one people's.</summary>
    private void Home(double x, double b, double w, double h, int build, Color wall, Color roof, int wins, bool snow)
    {
        var top = b - h; var snowC = Rgb(0xE8F0FC);
        RB(x, top, w, h + 2, Vertical((Mix(wall, White, 0.2), 0), (Mix(wall, Dark, 0.14), 1)));
        WallFace(build, x, top, w, h); var rb = RoofBrush(build, roof, w, h);
        switch (build % 7)
        {
            case 0:   // a gable
                GB(rb, 1, x - w * 0.07, top, x + w * 0.5, top - h * 0.5, x + w * 1.07, top);
                if (snow) G(snowC, 0.95, x - w * 0.07, top, x + w * 0.5, top - h * 0.5, x + w * 1.07, top, x + w * 0.5, top - h * 0.36);
                break;
            case 1:   // a hipped roof
                GB(rb, 1, x - w * 0.06, top, x + w * 0.2, top - h * 0.34, x + w * 0.8, top - h * 0.34, x + w * 1.06, top);
                if (snow) R(x + w * 0.2, top - h * 0.36, w * 0.6, h * 0.07, snowC, 0.95, h * 0.03);
                break;
            case 2:   // a flat roof with a low wall round it
                R(x - w * 0.03, top - h * 0.1, w * 1.06, h * 0.12, roof);
                for (var k = 0; k < 5; k++) R(x + w * (0.02 + 0.2 * k), top - h * 0.17, w * 0.1, h * 0.08, roof);
                if (snow) R(x - w * 0.03, top - h * 0.12, w * 1.06, h * 0.04, snowC, 0.95, h * 0.02);
                break;
            case 3:   // a flat roof with a dome
                R(x - w * 0.03, top - h * 0.07, w * 1.06, h * 0.09, Mix(roof, Dark, 0.2));
                { var dome = E(x + w * 0.5, top - h * 0.07, w * 0.5, roof); dome.Height = h * 0.62; dome.Fill = rb; At(dome, x + w * 0.25, top - h * 0.38); R(x + w * 0.25, top - h * 0.07, w * 0.5, h * 0.09, Mix(roof, Dark, 0.2)); }
                if (snow) { var cap = E(x + w * 0.5, top - h * 0.34, w * 0.3, snowC, 0.9); cap.Height = h * 0.12; }
                break;
            case 4:   // wide eaves that lift at the ends
                GB(rb, 1, TableauCurve.Closed(new[] { x - w * 0.18, top - h * 0.1, x + w * 0.12, top - h * 0.04, x + w * 0.5, top - h * 0.42, x + w * 0.88, top - h * 0.04, x + w * 1.18, top - h * 0.1, x + w * 1.0, top + h * 0.03, x + w * 0.5, top - h * 0.02, x, top + h * 0.03 }, 4));
                if (snow) { var cap = E(x + w * 0.5, top - h * 0.3, w * 0.5, snowC, 0.9); cap.Height = h * 0.1; }
                break;
            case 5:   // a stepped gable
                GB(rb, 1, x - w * 0.04, top, x - w * 0.04, top - h * 0.12, x + w * 0.14, top - h * 0.12, x + w * 0.14, top - h * 0.26, x + w * 0.32, top - h * 0.26, x + w * 0.32, top - h * 0.4, x + w * 0.68, top - h * 0.4, x + w * 0.68, top - h * 0.26, x + w * 0.86, top - h * 0.26, x + w * 0.86, top - h * 0.12, x + w * 1.04, top - h * 0.12, x + w * 1.04, top);
                if (snow) R(x + w * 0.32, top - h * 0.43, w * 0.36, h * 0.05, snowC, 0.95, h * 0.02);
                break;
            default:  // a round roof of thatch or tile
                { var cap = E(x + w * 0.5, top, w * 1.16, roof); cap.Height = h * 0.8; cap.Fill = rb; At(cap, x - w * 0.08, top - h * 0.4); R(x, top, w, h * 0.42, Mix(wall, White, 0.1)); RB(x, top, w, h * 0.42, Vertical((A(Dark, 0.25), 0), (A(Dark, 0), 1))); }
                if (snow) { var cap = E(x + w * 0.5, top - h * 0.3, w * 0.6, snowC, 0.9); cap.Height = h * 0.12; }
                break;
        }
        RB(x, top, w, h * 0.1, Vertical((A(Dark, 0.3), 0), (A(Dark, 0), 1))); R(x, b - h * 0.07, w, h * 0.09, Mix(wall, Dark, 0.3));
        // the door, to one side, and the windows beside it
        var left = build % 2 == 0; double dw = w * 0.17, dh = h * 0.52, dx = x + (left ? w * 0.16 : w * 0.67), arch = build % 3 == 0 ? dw * 0.5 : dw * 0.12;
        R(dx - dw * 0.1, b - dh - dw * 0.1, dw * 1.2, dh + dw * 0.1, Mix(wall, Dark, 0.5), 1, arch); R(dx, b - dh, dw, dh, Mix(roof, Dark, 0.35), 1, arch); E(dx + dw * 0.78, b - dh * 0.45, dw * 0.12, Rgb(0xE0C070));
        R(dx - dw * 0.3, b - h * 0.03, dw * 1.6, h * 0.05, Mix(wall, Dark, 0.55));
        R(dx + dw * 0.16, b - dh * 0.84, dw * 0.68, dh * 0.3, Mix(roof, White, 0.14), 0.55, arch * 0.5); R(dx + dw * 0.16, b - dh * 0.46, dw * 0.68, dh * 0.36, Mix(roof, White, 0.14), 0.55, dw * 0.06);
        R(dx + (left ? dw * 1.3 : -dw * 0.5), b - dh * 0.95, dw * 0.2, dh * 0.2, Dark, 0.9, dw * 0.04); Light(dx + (left ? dw * 1.4 : -dw * 0.4), b - dh * 0.85, w * 0.022, Warm);
        double ww = w * (wins > 1 ? 0.15 : 0.19), wh = h * 0.34, wx0 = x + (left ? w * 0.46 : w * 0.1), gap = w * 0.24;
        for (var k = 0; k < wins; k++) Window(wx0 + gap * k, b - h * 0.72, ww, wh, build % 3 == 0);
        _homes.Add((x, b, w, h, dx + dw / 2, wx0, b - h * 0.72, ww, wh));
    }

    // ------------------------------------------------------------------ what a home puts out for a holiday
    private void Dress(string id, int home)
    {
        var (x, b, w, h, door, winX, winY, winW, winH) = _homes[home];
        double u = w * 0.045, top = b - h, sill = winY + winH, wx = winX + winW / 2, side = door < x + w / 2 ? x + w * 0.86 : x + w * 0.14;
        Color red = Rgb(0xD83A34), gold = Rgb(0xF0C040), green = Rgb(0x2E9A5A), blue = Rgb(0x3A7AD8), pink = Rgb(0xF070A8), purple = Rgb(0x9A5AD8), orange = Rgb(0xF08A28), teal = Rgb(0x38B8B0), cream = Rgb(0xF4ECD8);
        switch (id)
        {
            case "christmas":
                for (var k = 0; k < 9; k++) Light(x + w * (0.04 + 0.115 * k), top + u * 0.5, u * 0.5, k % 3 == 0 ? red : k % 3 == 1 ? green : gold);
                { var ring = new Ellipse { Width = u * 3, Height = u * 3, Stroke = B(Rgb(0x1E7A44)), StrokeThickness = u * 0.8 }; At(ring, door - u * 1.5, b - h * 0.5); C.Children.Add(ring); E(door, b - h * 0.5 + u * 2.7, u * 0.8, red); }
                G(Rgb(0x16603A), 1, side, b - u * 7, side + u * 2.2, b - u * 3, side - u * 2.2, b - u * 3); G(Rgb(0x16603A), 1, side, b - u * 5, side + u * 2.8, b - u * 0.4, side - u * 2.8, b - u * 0.4);
                Light(side, b - u * 7.2, u * 0.6, gold); Light(side - u, b - u * 3.6, u * 0.4, red); Light(side + u * 1.2, b - u * 2, u * 0.4, gold); Light(side - u * 1.4, b - u * 1.2, u * 0.4, blue);
                break;
            case "easter":
                { var basket = E(side, b - u * 0.9, u * 4, Rgb(0x9A6A3A)); basket.Height = u * 2; }
                foreach (var (dx, c) in new[] { (-1.2, pink), (-0.4, Rgb(0xA8D8F0)), (0.4, Rgb(0xF4E08A)), (1.2, Rgb(0xB8E0A8)) }) { var egg = E(side + dx * u, b - u * 2.1, u * 0.9, c); egg.Height = u * 1.2; }
                for (var k = 0; k < 4; k++) { var fx = door + (k - 1.5) * u * 1.4; L(fx, b, fx, b - u * 2.6, green, Math.Max(1, u * 0.14)); E(fx, b - u * 2.8, u * 0.9, cream); E(fx, b - u * 2.8, u * 0.35, gold); }
                break;
            case "ramadan":
                foreach (var (dx, c) in new[] { (-3.4, gold), (0.0, teal), (3.4, purple) }) Hung(door + dx * u, top + u * 0.3, u * (1.4 + Math.Abs(dx) * 0.2), u * 1.5, c, true);
                for (var k = 0; k < 8; k++) Light(x + w * (0.06 + 0.125 * k), top - u * 0.2, u * 0.4, Warm);
                break;
            case "eid-al-fitr":
                Bunting(x + w * 0.02, x + w * 0.98, top + u * 0.3, u * 1.5, gold, teal, pink, green, purple);
                Hung(door - u * 2.6, top + u * 2, u * 1.2, u * 1.4, gold, true); Hung(door + u * 2.6, top + u * 2, u * 1.2, u * 1.4, green, true);
                Stand(side, b, u * 5, cream); foreach (var dx in new[] { -1.2, 0.0, 1.2 }) E(side + dx * u, b - u * 2.9, u * 1.0, dx == 0.0 ? pink : gold);
                break;
            case "eid-al-adha":
                for (var k2 = 0; k2 < 5; k2++)
                {   // star lamps: two squares, one turned
                    double sx = x + w * (0.12 + 0.19 * k2), sy = top + u * 2.4, r = u * 1.1; var c = k2 % 2 == 0 ? gold : teal;
                    L(sx, top + u * 0.2, sx, sy - r, Dark, Math.Max(1, u * 0.1), 0.8); _lights.Add((Glow(sx, sy, r * 4, c, 0.8, 0.6), k2));
                    G(c, 1, sx - r, sy - r, sx + r, sy - r, sx + r, sy + r, sx - r, sy + r); G(c, 1, sx, sy - r * 1.42, sx + r * 1.42, sy, sx, sy + r * 1.42, sx - r * 1.42, sy);
                }
                break;
            case "diwali":
                for (var k2 = 0; k2 < 7; k2++) { var lx = x + w * (0.08 + 0.14 * k2); var dish = E(lx, b - u * 0.3, u * 1.1, Rgb(0xA85A2A)); dish.Height = u * 0.6; Light(lx, b - u * 0.95, u * 0.45, Flame); }
                for (var k2 = 0; k2 < 9; k2++) { var a = Math.PI * (k2 + 0.5) / 9; E(door - Math.Cos(a) * u * 2.6, b - h * 0.56 - Math.Sin(a) * u * 1.6, u * 0.8, k2 % 2 == 0 ? orange : gold); }
                {   // a pattern of coloured powder on the ground before the door
                    double gx = door, gy = b + u * 2.4;
                    foreach (var (d, c) in new[] { (7.0, pink), (5.2, gold), (3.6, teal), (2.0, cream) }) { var ring = E(gx, gy, u * d, c, 0.9); ring.Height = u * d * 0.34; At(ring, gx - u * d / 2, gy - u * d * 0.17); }
                    for (var k2 = 0; k2 < 8; k2++) { var a = Math.PI * 2 * k2 / 8; var p = E(gx + Math.Cos(a) * u * 2.9, gy + Math.Sin(a) * u * 0.95, u * 0.7, k2 % 2 == 0 ? red : green); p.Height = u * 0.35; }
                }
                break;
            case "holi":
                foreach (var (dx, dy, d, c) in new[] { (-3.0, -1.0, 5.0, pink), (0.5, -2.4, 6.0, gold), (3.4, -0.8, 5.0, teal), (-1.2, -4.2, 4.5, purple), (2.2, -4.6, 4.0, green), (-4.6, -3.4, 3.6, orange) })
                    Glow(door + dx * u, b + dy * u, u * d, c, 0.85, 0.75);
                foreach (var (dx, c) in new[] { (-1.6, pink), (0.0, gold), (1.6, blue) }) { var bowl = E(side + dx * u, b - u * 0.4, u * 1.4, Rgb(0xC8A060)); bowl.Height = u * 0.8; var heap = E(side + dx * u, b - u * 0.85, u * 1.1, c); heap.Height = u * 0.7; }
                break;
            case "vesak":
                {
                    var cols = new[] { blue, gold, red, cream, orange };
                    for (var k2 = 0; k2 < 5; k2++) Hung(x + w * (0.12 + 0.19 * k2), top + u * 0.3, u * (1 + k2 % 2), u * 1.5, cols[k2]);
                    for (var k2 = 0; k2 < 3; k2++) { var fx = door + (k2 - 1) * u * 1.8; var lotus = E(fx, b - u * 0.5, u * 1.6, pink); lotus.Height = u * 0.9; Light(fx, b - u * 1.1, u * 0.35, Flame); }
                }
                break;
            case "lunar-new-year":
                Hung(door - u * 2.4, b - h * 0.62, u * 0.8, u * 2.2, red); Hung(door + u * 2.4, b - h * 0.62, u * 0.8, u * 2.2, red);
                R(door - u * 2.9, b - h * 0.4, u * 0.9, h * 0.36, red); R(door + u * 2.0, b - h * 0.4, u * 0.9, h * 0.36, red);
                R(door - u * 2.2, b - h * 0.58, u * 4.4, u * 0.9, red); for (var k2 = 0; k2 < 3; k2++) E(door + (k2 - 1) * u * 1.3, b - h * 0.58 + u * 0.45, u * 0.4, gold);
                break;
            case "mid-autumn":
                {
                    var cols = new[] { orange, pink, gold, teal, red, green };
                    L(x + w * 0.04, top + u * 0.4, x + w * 0.96, top + u * 0.4, Dark, Math.Max(1, u * 0.1), 0.8);
                    for (var k2 = 0; k2 < 6; k2++) Hung(x + w * (0.1 + 0.16 * k2), top + u * 0.4, u * 0.6, u * 1.6, cols[k2]);
                    Stand(side, b, u * 5, red); foreach (var dx in new[] { -1.2, 0.0, 1.2 }) { var cake = E(side + dx * u, b - u * 2.8, u * 1.0, Rgb(0xC88A3A)); cake.Height = u * 0.7; }
                }
                break;
            case "vaisakhi":
                Bunting(x + w * 0.02, x + w * 0.98, top + u * 0.3, u * 1.6, Rgb(0xF09A20), Rgb(0x2A4AA8));
                for (var k2 = 0; k2 < 7; k2++) { var a = -Math.PI / 2 + (k2 - 3) * 0.16; L(side, b, side + Math.Cos(a) * u * 5.5, b + Math.Sin(a) * u * 5.5, Rgb(0xE0B040), Math.Max(1, u * 0.2)); E(side + Math.Cos(a) * u * 5.5, b + Math.Sin(a) * u * 5.5, u * 0.7, Rgb(0xF0C860)); }
                R(side - u * 0.9, b - u * 2.4, u * 1.8, u * 0.5, Rgb(0xF09A20));
                break;
            case "hanukkah":
                R(wx - winW * 0.42, sill - u * 0.5, winW * 0.84, u * 0.3, Rgb(0xD8C070)); R(wx - u * 0.15, sill - u * 0.5, u * 0.3, u * 0.5, Rgb(0xD8C070));
                for (var k2 = 0; k2 < 9; k2++) { var cx = wx + (k2 - 4) * winW * 0.095; var ch = k2 == 4 ? u * 1.5 : u * 1.0; R(cx - u * 0.1, sill - u * 0.5 - ch, u * 0.2, ch, cream); Light(cx, sill - u * 0.5 - ch - u * 0.3, u * 0.28, Flame); }
                break;
            case "passover":
                Candle(wx - winW * 0.2, sill, u * 1.6, cream); Candle(wx + winW * 0.2, sill, u * 1.6, cream);
                R(side - u * 0.7, b - u * 2.2, u * 1.4, u * 2.2, Rgb(0x6A8AB8), 1, u * 0.4);
                for (var k2 = 0; k2 < 5; k2++) { var a = -Math.PI / 2 + (k2 - 2) * 0.3; L(side, b - u * 2.2, side + Math.Cos(a) * u * 3.6, b - u * 2.2 + Math.Sin(a) * u * 3.6, Rgb(0x5A4030), Math.Max(1, u * 0.15)); E(side + Math.Cos(a) * u * 3.6, b - u * 2.2 + Math.Sin(a) * u * 3.6, u * 0.8, k2 % 2 == 0 ? pink : cream); }
                break;
            case "rosh-hashanah":
                Stand(side, b, u * 5.5, cream);
                { var bowl = E(side - u * 1.2, b - u * 3.0, u * 2.6, Rgb(0xB88A50)); bowl.Height = u * 1.0; }
                E(side - u * 1.8, b - u * 3.6, u * 1.1, red); E(side - u * 0.8, b - u * 3.7, u * 1.1, Rgb(0xC8D040)); E(side - u * 1.3, b - u * 4.3, u * 1.1, red);
                R(side + u * 0.8, b - u * 4.2, u * 1.2, u * 1.5, Rgb(0xE8A020), 1, u * 0.3); R(side + u * 0.7, b - u * 4.5, u * 1.4, u * 0.35, Rgb(0x8A5A20));
                E(side + u * 2.4, b - u * 3.2, u * 1.2, Rgb(0xA82040));
                break;
            case "new-year":
                for (var k2 = 0; k2 < 6; k2++) { var sx = x + w * (0.1 + 0.16 * k2); var c = new[] { gold, pink, teal, purple, red, green }[k2]; L(sx, top + u * 0.3, sx + u * (k2 % 2 == 0 ? 1.2 : -1.2), top + u * 4, c, Math.Max(1, u * 0.22), 0.9); }
                foreach (var (dx, dy, c) in new[] { (0.2, -0.75, gold), (0.55, -1.0, pink), (0.85, -0.7, teal) })
                    for (var k2 = 0; k2 < 8; k2++) { var a = Math.PI * 2 * k2 / 8; Light(x + w * dx + Math.Cos(a) * u * 2.2, top + h * dy + Math.Sin(a) * u * 2.2, u * 0.3, c, 0.8); }
                break;
            case "nowruz":
                Stand(side, b, u * 6.5, Rgb(0x2A8A7A));
                R(side - u * 2.8, b - u * 3.9, u * 1.8, u * 0.6, cream); for (var k2 = 0; k2 < 6; k2++) L(side - u * 2.7 + k2 * u * 0.32, b - u * 3.9, side - u * 2.7 + k2 * u * 0.32, b - u * 5.2, green, Math.Max(1, u * 0.16));
                E(side, b - u * 4.1, u * 1.7, Rgb(0xB8DCF0), 0.85); E(side + u * 0.2, b - u * 4.0, u * 0.5, orange);
                Candle(side + u * 1.6, b - u * 3.3, u * 1.4, cream); Candle(side + u * 2.6, b - u * 3.3, u * 1.4, cream);
                L(door + u * 3, b, door + u * 3, b - u * 2.4, green, Math.Max(1, u * 0.2)); { var hy = E(door + u * 3, b - u * 3, u * 1.0, purple); hy.Height = u * 1.8; }
                break;
            case "kwanzaa":
                R(wx - winW * 0.4, sill - u * 0.45, winW * 0.8, u * 0.3, Rgb(0x8A5A2A));
                for (var k2 = 0; k2 < 7; k2++) { var cx = wx + (k2 - 3) * winW * 0.115; var c = k2 < 3 ? red : k2 == 3 ? Rgb(0x181818) : green; R(cx - u * 0.12, sill - u * 0.45 - u * 1.3, u * 0.24, u * 1.3, c); Light(cx, sill - u * 2.05, u * 0.28, Flame); }
                break;
            case "day-of-the-dead":
                for (var k2 = 0; k2 < 13; k2++) { var a = Math.PI * (k2 + 0.5) / 13; E(door - Math.Cos(a) * u * 3.2, b - h * 0.3 - Math.Sin(a) * h * 0.36, u * 1.0, k2 % 2 == 0 ? orange : gold); }
                for (var k2 = 0; k2 < 5; k2++) Candle(side + (k2 - 2) * u * 1.2, b, u * (1.2 + (k2 % 2) * 0.5), cream);
                { var cols = new[] { pink, teal, orange, purple, green, gold }; L(x + w * 0.03, top + u * 0.4, x + w * 0.97, top + u * 0.4, Dark, Math.Max(1, u * 0.1), 0.8); for (var k2 = 0; k2 < 8; k2++) R(x + w * (0.06 + 0.115 * k2), top + u * 0.4, u * 1.5, u * 1.3, cols[k2 % 6], 0.95); }
                break;
            case "harvest":
                foreach (var (dx, d) in new[] { (-1.6, 2.4), (0.6, 3.0), (2.4, 2.0) }) { var p = E(side + dx * u, b - u * d * 0.36, u * d, orange); p.Height = u * d * 0.78; R(side + dx * u - u * 0.15, b - u * d * 0.86, u * 0.3, u * 0.5, Rgb(0x4A6A2A)); }
                for (var k2 = 0; k2 < 6; k2++) { var a = -Math.PI / 2 + (k2 - 2.5) * 0.13; L(door + u * 3.4, b, door + u * 3.4 + Math.Cos(a) * u * 6, b + Math.Sin(a) * u * 6, Rgb(0xC8A860), Math.Max(1, u * 0.24)); }
                { var ring = new Ellipse { Width = u * 3, Height = u * 3, Stroke = B(Rgb(0xC8642A)), StrokeThickness = u * 0.8 }; At(ring, door - u * 1.5, b - h * 0.5); C.Children.Add(ring); E(door - u * 1.2, b - h * 0.5 + u * 0.6, u * 0.8, red); E(door + u * 1.1, b - h * 0.5 + u * 2.2, u * 0.8, gold); }
                break;
        }
    }

    private static readonly int[] Skins = { 0xF2CDA6, 0xC98F60, 0x8C5A3C, 0xE2AC7E, 0x6B4129, 0xF6DCC0, 0xA9744C };
    private static readonly int[] Cloths = { 0xE8503C, 0x3C78D8, 0xF2B030, 0x34B078, 0xA860D8, 0xF4ECDC, 0xF06CA0, 0x28A8B8, 0xF08030, 0x7088E8 };
    private static readonly int[] Hairs = { 0x1A1410, 0x3A2416, 0x6A4A2A, 0x201818, 0x8A3A1A, 0xD8B060 };
    private void Oval(double cx, double cy, double w, double h, Color c, double op = 1) { var e = E(cx, cy, w, c, op); e.Height = Math.Max(0.5, h); At(e, cx - w / 2, cy - h / 2); }
    private void In(Canvas g, Action draw) { var keep = C; C = g; try { draw(); } finally { C = keep; } }
    private Canvas Sub(double x, double y, out TranslateTransform t) { t = new TranslateTransform { X = x, Y = y }; var g = new Canvas { RenderTransform = t }; C.Children.Add(g); return g; }
    /// <summary>One figure or thing with a place of its own; kind 1 hops with the low notes, 2 sways, 3 jumps the rope.</summary>
    private void Figure(double x, double y, int kind, double amp, double ph, Action draw) { var g = Sub(x, y, out var t); In(g, draw); if (kind > 0) _movers.Add((t, kind, x, y, amp, ph)); }
    private Surprise Sur(double len, Action draw) { var s = new Surprise { Len = len }; s.G = Sub(0, 0, out var t); s.T = t; s.G.Opacity = 0; s.G.IsHitTestVisible = false; In(s.G, draw); _sur.Add(s); return s; }
    private static double Fade(double p) => Clamp01(Math.Min(p, 1 - p) * 10);

    private void Limb(double x, double y, double sign, double walk, double idle, bool wave, Action draw)
    {
        var r = new RotateTransform(); var g = new Canvas { RenderTransform = r }; At(g, x, y); C.Children.Add(g); In(g, draw);
        _limbs.Add((r, sign, walk, idle, wave, _ch, _pn * 1.3));
    }

    /// <summary>A neighbour, feet at the canvas's origin. Pose: 0 arms down, 1 arms up, 2 left arm out, 3 right arm out, 4 seated on a
    /// stool, 5 both arms out, 6 hands in front. Skin, hair, clothes and what is worn on the head come round in turn.</summary>
    private void Person(double scale, int pose = 0, bool child = false, bool grey = false)
    {
        var n = _pn++; var u = S(0.015) * scale * (child ? 0.64 : 1);
        if (_shadow) Oval(0, pose == 7 ? -u * 1.5 : pose == 4 ? -u * 0.9 : 0, u * 2.9, u * 0.55, Dark, 0.24);   // the shadow at the feet
        Umbrella(u, n);
        Color cloth = Rgb(Cloths[(n * 7 + 1) % Cloths.Length]), skin = Rgb(Skins[(n * 5 + 2) % Skins.Length]), hair = grey ? Rgb(0xD8D4CC) : Rgb(Hairs[(n * 5 + 1) % Hairs.Length]);
        Color low = Mix(Rgb(Cloths[(n * 3 + 4) % Cloths.Length]), Dark, 0.45), other = Mix(Rgb(Cloths[(n * 3 + 2) % Cloths.Length]), White, 0.15), shade = Mix(skin, Dark, 0.2), ink = Rgb(0x2A1C18);
        var head = child ? (n % 2) * 5 : n % 6; var robe = !child && n % 3 == 1; var sleeves = n % 2 == 0; var sits = pose == 4 || pose == 7;
        if (pose == 7) R(-u * 1.0, -u * 2.0, u * 2.0, u * 0.5, low, 1, u * 0.25);   // sits on the ground; the caller sets the figure 1.5 lower
        else if (pose == 4)
        {   // the caller sets a seated figure 0.9 lower: the ground is at -0.9
            R(-u * 0.8, -u * 1.9, u * 1.6, u * 0.4, Rgb(0x7A5030), 1, u * 0.1); R(-u * 0.65, -u * 1.5, u * 0.22, u * 0.6, Rgb(0x5A3A20)); R(u * 0.43, -u * 1.5, u * 0.22, u * 0.6, Rgb(0x5A3A20));
            R(-u * 0.78, -u * 2.35, u * 1.56, u * 0.5, low, 1, u * 0.2);
        }
        else if (robe) { R(-u * 0.85, -u * 0.28, u * 0.8, u * 0.28, Dark, 0.9, u * 0.12); R(u * 0.05, -u * 0.28, u * 0.8, u * 0.28, Dark, 0.9, u * 0.12); }
        else
            foreach (var side in new[] { -1.0, 1.0 })   // a leg and its shoe turn about the hip
                Limb(side * u * 0.42, -u * 1.75, -side, 22, 0, false, () => { Sv(Leg, low, u); Sv(Shoe, Dark, u, 0.92); });
        var (lx, ly, rx, ry) = pose switch
        {
            1 => (-1.5, -5.0, 1.5, -5.0), 2 => (-2.0, -2.9, 1.15, -1.9), 3 => (-1.15, -1.9, 2.0, -2.9), 5 => (-1.9, -2.6, 1.9, -2.6),
            4 or 6 or 7 => (-0.6, -2.5, 0.9, -2.5), _ => (-1.15, -1.9, 1.15, -1.9),
        };
        var swing = pose == 0 ? 18.0 : 4.0;   // an arm and its hand turn about the shoulder; raised arms wave
        void Arm(double sx, double hx, double hy, double sign) => Limb(sx * u, -u * 3.35, sign, swing, 4, pose == 1, () =>
        {
            double dx = (hx - sx) * u, dy = (hy + 3.35) * u;
            L(0, 0, dx, dy, cloth, u * 0.52); if (sleeves) L(dx * 0.55, dy * 0.55, dx, dy, skin, u * 0.4); E(dx, dy, u * 0.5, skin);
        });
        Arm(-0.7, lx, ly, 1); Arm(0.7, rx, ry, -1);
        // the body
        if (robe && !sits) { Sv(Robe, cloth, u); Sv(Hem, other, u, 0.92); } else Sv(Torso, cloth, u);
        if (n % 4 == 2) Sv(Belt, other, u, 0.95);
        if (n % 5 == 3) Sv(Sash, other, u); else if (n % 3 == 0) Sv(Neck, skin, u);
        if (n % 4 == 1 && !robe) { E(0, -u * 3.2, u * 0.16, other); E(0, -u * 2.8, u * 0.16, other); }
        // the head
        if (head == 5) Sv(HairLong, hair, u);
        if (head == 1) Sv(ScarfBack, other, u); else { E(-u * 0.7, -u * 4.45, u * 0.26, shade); E(u * 0.7, -u * 4.45, u * 0.26, shade); }
        if (child && n % 4 == 0) { E(-u * 0.78, -u * 4.95, u * 0.5, hair); E(u * 0.78, -u * 4.95, u * 0.5, hair); }
        E(0, -u * 4.5, u * 1.4, skin);
        E(-u * 0.25, -u * 4.52, u * 0.15, ink); E(u * 0.25, -u * 4.52, u * 0.15, ink);
        E(-u * 0.4, -u * 4.28, u * 0.28, Rgb(0xF07080), 0.3); E(u * 0.4, -u * 4.28, u * 0.28, Rgb(0xF07080), 0.3);
        Sv(Smile, ink, u, 0.7);
        if (!child && n % 7 == 4 && head != 1) Sv(Beard, hair, u);
        if (head == 0 || head == 5 || head == 4) Sv(HairCap, hair, u);
        if (head == 1) Sv(ScarfFront, other, u);
        if (head == 2) { Oval(0, -u * 5.02, u * 2.2, u * 0.34, low); Sv(HatCrown, low, u); Sv(HatBand, other, u); }
        if (head == 3) { Sv(Wrap, other, u); Sv(WrapFold, Mix(other, White, 0.35), u); }
        if (head == 4) Sv(Cap, low, u);
    }

    /// <summary>People who cross the square together: 0 two parents and a child hand in hand, 1 a couple, 2 a parent with a pram,
    /// 3 an elder with a cane and a grandchild, 4 someone with a dog, 5 a child on a parent's shoulders, 6 friends, one with a balloon.</summary>
    private void Group(int kind, double sc)
    {
        var u = S(0.015) * sc; Color wood = Rgb(0x6A4428), fur = Rgb(0xB87A40);
        switch (kind)
        {
            case 0: Figure(-u * 2.6, 0, 0, 0, 0, () => Person(sc, 3)); Figure(u * 2.6, 0, 0, 0, 0, () => Person(sc, 2)); Figure(0, 0, 0, 0, 0, () => Person(sc, 1, true)); break;
            case 1: Figure(-u * 1.5, 0, 0, 0, 0, () => Person(sc, 3)); Figure(u * 1.5, 0, 0, 0, 0, () => Person(sc, 2)); break;
            case 2:
                Person(sc, 3);
                L(u * 2.0, -u * 2.9, u * 2.7, -u * 1.6, Dark, u * 0.2); Oval(u * 3.7, -u * 1.5, u * 2.6, u * 1.5, Rgb(0x3C78D8)); Oval(u * 4.3, -u * 2.0, u * 1.5, u * 1.5, Rgb(0x2A5AA8));
                E(u * 3.0, -u * 0.4, u * 0.8, Dark); E(u * 4.4, -u * 0.4, u * 0.8, Dark); E(u * 3.0, -u * 0.4, u * 0.3, Rgb(0xC8C8D0)); E(u * 4.4, -u * 0.4, u * 0.3, Rgb(0xC8C8D0));
                break;
            case 3:
                Figure(-u * 1.3, 0, 0, 0, 0, () => Person(sc, 3, false, true)); L(-u * 2.45, -u * 1.9, -u * 2.8, 0, wood, u * 0.22);
                Figure(u * 1.3, 0, 0, 0, 0, () => Person(sc, 1, true));
                break;
            case 4:
                Person(sc, 3); L(u * 2.0, -u * 2.9, u * 4.5, -u * 1.5, Dark, Math.Max(1, u * 0.1), 0.8);
                Oval(u * 5.0, -u * 1.1, u * 2.2, u * 1.0, fur); E(u * 6.1, -u * 1.7, u * 1.0, fur); Oval(u * 5.8, -u * 2.0, u * 0.4, u * 0.8, Mix(fur, Dark, 0.4));
                R(u * 4.2, -u * 0.8, u * 0.3, u * 0.8, fur); R(u * 5.6, -u * 0.8, u * 0.3, u * 0.8, fur); L(u * 4.0, -u * 1.3, u * 3.5, -u * 2.2, fur, u * 0.25);
                break;
            case 5:
            {   // a child who sits on a grown-up's shoulders (2026-11-12: she had stood on his head, and each had an umbrella). She
                // is drawn first, seated, so his head is in front of her; her legs hang on his chest; the one umbrella is his, held higher
                var uc = u * 0.64; var leg = Rgb(0x3A3A52);
                _shadow = false; _noUmb = true; Figure(0, -u * 4.6 + uc * 1.5, 0, 0, 0, () => Person(sc, 7, true)); _noUmb = false; _shadow = true;
                _umbLift = 2.7; Person(sc, 1); _umbLift = 0;
                foreach (var sg in new[] { -1, 1 }) { L(sg * u * 0.5, -u * 4.45, sg * u * 0.55, -u * 3.5, leg, u * 0.42); E(sg * u * 0.55, -u * 3.4, u * 0.5, Rgb(0x2A1C18)); }
                break;
            }
            default:
                Figure(-u * 2.3, 0, 0, 0, 0, () => Person(sc, 0)); Figure(0, 0, 0, 0, 0, () => Person(sc, 0)); Figure(u * 2.4, 0, 0, 0, 0, () => Person(sc, 1, true));
                L(u * 3.35, -u * 3.2, u * 3.9, -u * 7.2, Dark, Math.Max(1, u * 0.08), 0.7); Oval(u * 3.9, -u * 8.0, u * 1.5, u * 1.8, Rgb(0xF04848));
                break;
        }
    }
    private void Walker(int i, double yFrac, double sc, int kind, Random rng)
    {
        var dir = i % 2 == 0 ? 1 : -1;
        _wy[i] = Y(yFrac); _wx[i] = (i * 0.37 + 0.1 * rng.NextDouble()) % 1.0; _wv[i] = dir * (0.006 + 0.006 * rng.NextDouble()) * sc; _wp[i] = rng.NextDouble() * 6;
        var g = Sub(0, 0, out var t); _walkT[i] = t;
        var flip = new Canvas { RenderTransform = new ScaleTransform { ScaleX = dir } }; g.Children.Add(flip);
        In(flip, () => { _ch = 1; Group(kind, sc); _ch = 0; });
    }

    protected override void OnBuild()
    {
        _lights.Clear(); _stars.Clear(); _homes.Clear(); _movers.Clear(); _sur.Clear(); _wn = 0; _since = 0; _pn = 0; _surI = -1; _surIn = 10; StoriesReset();
        _limbs.Clear(); _gait.Clear(); _gait.Add(0); _gait.Add(1); _gait.Add(0.5); _ch = 0;
        var plan = PlanSource?.Invoke() ?? new SeasonsPlan("spring", Array.Empty<string>());
        _sig = plan.Signature; var season = _season = plan.Season; _sky = plan.Sky; _dim = _sky == "night" ? 0.5 : _sky == "dawn" ? 0.12 : 0; var rng = new Random(331);
        bool winter = season == "winter", autumn = season == "autumn", summer = season == "summer";

        // ---- the sky at dusk, in the season's colours
        var sky = season switch
        {
            "summer" => new[] { 0x16346A, 0x3A70A8, 0xF8A860, 0xFFDC98 },
            "autumn" => new[] { 0x241A4A, 0x6A3A78, 0xE86A48, 0xFFB868 },
            "winter" => new[] { 0x0A1030, 0x1A2C60, 0x4A5CA0, 0x8A9AD0 },
            _ => new[] { 0x24306A, 0x6A5AA8, 0xF090B0, 0xFFD0B8 },
        };
        // those are the dusk; the day, the night and the dawn have skies of their own
        if (_sky == "day") sky = season switch
        {
            "summer" => new[] { 0x1E78D8, 0x4A9CE8, 0x8CC8F4, 0xC8E8F8 },
            "autumn" => new[] { 0x4A88C8, 0x7AAEDC, 0xB8D4E8, 0xF0E0C8 },
            "winter" => new[] { 0x6A90B8, 0x9AB8D4, 0xC8D8E8, 0xE8EEF4 },
            _ => new[] { 0x3A8AD8, 0x6AB0E8, 0xA8D4F4, 0xD8ECF8 },
        };
        else if (_sky == "night") sky = new[] { 0x04061A, 0x0A1030, 0x141C48, 0x242A5A };
        else if (_sky == "dawn") sky = new[] { 0x2A3A78, 0x7A6AB0, 0xF0A0A0, 0xFFD8A0 };
        RB(0, 0, W, H, Vertical((Rgb(sky[0]), 0), (Rgb(sky[1]), 0.38), (Rgb(sky[2]), 0.66), (Rgb(sky[3]), 0.8)));
        for (var i = 0; i < (_sky == "night" ? 120 : _sky == "day" ? 0 : winter ? 70 : 36); i++) _stars.Add((E(X(rng.NextDouble()), Y(0.36 * rng.NextDouble() * rng.NextDouble() + 0.02), S(0.002 + 0.003 * rng.NextDouble()), Rgb(0xF0F4FF), 0.5), rng.NextDouble() * 6));
        {   // the sun by day, the moon by night, where the clock of the place puts them
            var night = _sky == "night"; var g = Sub(0, 0, out var st); _skyT = st; PlaceSky(plan);
            var c = night ? Rgb(0xC8D8FF) : _sky == "day" ? Rgb(0xFFF4C8) : Rgb(0xFFD8A0);
            In(g, () =>
            {
                _sun = Glow(0, 0, S(night ? 0.36 : 0.7), c, night ? 0.5 : 0.75, 0.7);
                E(0, 0, S(night ? 0.077 : 0.1), night ? Rgb(0xF4F2E4) : Rgb(0xFFF6D8), 0.97);
                if (night)
                {   // the moon's phase: a disc of the sky's colour over the part that is dark
                    var lit = (1 - Math.Cos(2 * Math.PI * plan.Moon)) / 2; var d = S(0.079);
                    if (lit < 0.97) E((plan.Moon < 0.5 ? -1 : 1) * d * lit, 0, d, Rgb(sky[1]), 0.97);
                }
            });
        }

        // ---- the surprises of the sky: each comes now and then (Frame picks one), and is not there the rest of the time
        Color sRed = Rgb(0xE8503C), sGold = Rgb(0xF2C040), sTeal = Rgb(0x38B8B0), sPink = Rgb(0xF06CA0);
        {   // a shooting star
            double x0 = 0, y0 = 0;
            var s = Sur(1.4, () => { L(-S(0.16), -S(0.06), 0, 0, Rgb(0xF0F4FF), Math.Max(1.5, S(0.0025)), 0.7); Glow(0, 0, S(0.03), White, 0.9); });
            s.Start = () => { x0 = X(0.1 + 0.6 * Rng.NextDouble()); y0 = Y(0.04 + 0.2 * Rng.NextDouble()); };
            s.Step = (q, p) => { q.T.X = x0 + S(0.45) * p; q.T.Y = y0 + S(0.17) * p; q.G.Opacity = Math.Sin(Math.PI * p); };
        }
        {   // two rings of stars, linked
            var s = Sur(22, () =>
            {
                double cx = X(0.3), cy = Y(0.2), r = S(0.075);
                foreach (var dx in new[] { -0.6, 0.6 })
                {
                    var ring = new Ellipse { Width = r * 2, Height = r * 2, Stroke = B(Rgb(0xDCE6FF)), StrokeThickness = Math.Max(1, S(0.0015)), StrokeDashArray = new DoubleCollection { 2, 5 }, Opacity = 0.7 };
                    At(ring, cx + dx * r - r, cy - r); C.Children.Add(ring);
                    for (var k = 0; k < 7; k++) { var a = Math.PI * 2 * k / 7 + dx; Glow(cx + dx * r + Math.Cos(a) * r, cy + Math.Sin(a) * r, S(0.018), White, 0.95); }
                }
            });
            s.Step = (q, p) => q.G.Opacity = 0.9 * Math.Sin(Math.PI * p);
        }
        {   // a balloon that drifts over
            var s = Sur(70, () =>
            {
                var d = S(0.1); Oval(0, 0, d, d * 1.15, sRed); Oval(0, 0, d * 0.58, d * 1.15, sGold); Oval(0, 0, d * 0.2, d * 1.15, sTeal);
                L(-d * 0.3, d * 0.45, -d * 0.1, d * 0.8, Dark, 1, 0.8); L(d * 0.3, d * 0.45, d * 0.1, d * 0.8, Dark, 1, 0.8);
                Glow(0, d * 0.62, d * 0.35, Flame, 0.9, 0.8); R(-d * 0.12, d * 0.8, d * 0.24, d * 0.16, Rgb(0x8A5A30), 1, d * 0.03);
            });
            s.Step = (q, p) => { q.T.X = -S(0.1) + (W + S(0.2)) * p; q.T.Y = Y(0.2) + S(0.02) * Math.Sin(p * 25); q.G.Opacity = 1; };
        }
        {   // fireworks over the hills: each burst is drawn once at its full size and opened by the compositor
            var bursts = new List<(Canvas c, Microsoft.UI.Composition.Visual v)>();
            var s = Sur(8, () =>
            {
                for (var b = 0; b < 3; b++)
                {
                    var holder = Sub(X(new[] { 0.27, 0.5, 0.7 }[b]), Y(new[] { 0.24, 0.16, 0.27 }[b]), out _); var bc = new Canvas(); holder.Children.Add(bc);
                    var col = new[] { sGold, sPink, sTeal }[b];
                    In(bc, () =>
                    {
                        var r = S(0.12);
                        for (var k = 0; k < 16; k++) { var a = Math.PI * 2 * k / 16; Glow(Math.Cos(a) * r, Math.Sin(a) * r, S(0.024), col, 0.95); }
                        for (var k = 0; k < 9; k++) { var a = Math.PI * 2 * k / 9 + 0.3; Glow(Math.Cos(a) * r * 0.55, Math.Sin(a) * r * 0.55, S(0.018), White, 0.9); }
                    });
                    bursts.Add((bc, Microsoft.UI.Xaml.Hosting.ElementCompositionPreview.GetElementVisual(bc)));
                }
            });
            s.Step = (q, p) =>
            {
                q.G.Opacity = 1;
                for (var b = 0; b < bursts.Count; b++)
                {
                    var lp = (p - b * 0.22) / 0.5; var (c, v) = bursts[b];
                    if (lp <= 0 || lp >= 1) { c.Opacity = 0; continue; }
                    var k = (float)(1 - Math.Pow(1 - lp, 3)); v.Scale = new System.Numerics.Vector3(k, k, 1); c.Opacity = lp < 0.6 ? 1 : (1 - lp) / 0.4;
                }
            };
        }

        StoriesSky();
        // ---- the land beyond: mountains, a forest, green hills, dunes
        Land();
        // the flock flies in front of the mountains (2026-11-12: it had passed behind them)
        {   // birds on their way somewhere: each a body with two wings that beat, as in Sunrise Meadow
            var flock = new List<TownBird>();
            var s = Sur(26, () =>
            {
                for (var k = 0; k < 7; k++)
                {
                    var row = (k + 1) / 2; var side = k % 2 == 0 ? 1 : -1;
                    var b = Bird(S(0.026) * (1 - 0.09 * row), Rgb(0x1C1C28), Rgb(0x3A3A52)); b.X = -row * S(0.046); b.Y = side * row * S(0.029); flock.Add(b);
                }
            });
            s.Step = (q, p) =>
            {
                q.T.X = -S(0.3) + (W + S(0.6)) * p; q.T.Y = Y(0.36) - S(0.14) * p; q.G.Opacity = 1;
                for (var k = 0; k < flock.Count; k++) { var b = flock[k]; var beat = Flap(b, _tw * 9 + k * 0.6, k); b.T.X = b.X; b.T.Y = b.Y - beat * b.U * 0.08 + S(0.004) * Math.Sin(_tw * 0.7 + k); }
            };
        }

        StoriesHills();
        // ---- the homes on the rise behind the square
        var walls = new[] { 0xE0784A, 0xF2DCA8, 0x5A9AD8, 0xF0B83A, 0xF088A8, 0xF4EEE0, 0x7CC088, 0xD05A44, 0x9A7AD8, 0x48B8B0 };
        var roofs = new[] { 0xB03A2A, 0x2E5A9A, 0x7A3A22, 0x1E7A72, 0x9A2A4A, 0x4A4A62, 0xD8842A };
        var b0 = 0;
        foreach (var (fx, fw, fh, n) in new[] { (0.02, 0.17, 0.13, 2), (0.15, 0.15, 0.15, 1), (0.275, 0.16, 0.12, 2), (0.405, 0.15, 0.14, 1), (0.535, 0.16, 0.125, 2), (0.665, 0.15, 0.15, 1), (0.795, 0.17, 0.13, 2) })
        { Home(X(fx), Y(0.675 - 0.012 * Math.Sin(fx * 9)), S(fw), S(fh), b0 + 3, Tn(walls[(b0 * 3 + 1) % walls.Length]), Tn(roofs[(b0 * 2 + 3) % roofs.Length]), n, winter); b0++; }

        StoriesBackRow();
        // ---- the ground: the square and the lane
        var ground = season switch
        {
            "summer" => new[] { 0x8AC858, 0x4A8A3A, 0x24502A },
            "autumn" => new[] { 0xD8A848, 0xA87834, 0x5A3A20 },
            "winter" => new[] { 0xDCE6F8, 0xA8B8DC, 0x6878A8 },
            _ => new[] { 0x9AD878, 0x5AA858, 0x2A5A38 },
        };
        GB(Vertical((Tn(ground[0]), 0), (Tn(ground[1]), 0.35), (Tn(ground[2]), 1)), 1, TableauCurve.Closed(new[] { -S(0.1), H + S(0.1), -S(0.1), Y(0.69), X(0.25), Y(0.675), X(0.5), Y(0.69), X(0.75), Y(0.675), W + S(0.1), Y(0.69), W + S(0.1), H + S(0.1) }, 5));
        Lawn();
        { var plaza = E(X(0.5), Y(0.9), W * 0.62, Mix(winter ? Rgb(0xD4E0F8) : Rgb(0xECD4A0), Rgb(0x0A1030), _dim), 0.7); plaza.Height = S(0.2); plaza.Opacity = 1; At(plaza, X(0.5) - W * 0.31, Y(0.8)); }
        Cobbles(); Court();

        GroundGrain(); Grass(rng); Market();
        // ---- the six homes on the square, three to a side
        foreach (var (fx, fw, fh, n) in new[] { (0.0, 0.23, 0.19, 2), (0.135, 0.21, 0.2, 2), (0.265, 0.2, 0.17, 2), (0.625, 0.2, 0.18, 2), (0.745, 0.21, 0.2, 2), (0.87, 0.23, 0.185, 2) })
        { Home(X(fx), Y(0.85), S(fw), S(fh), b0, Tn(walls[(b0 * 3 + 2) % walls.Length]), Tn(roofs[(b0 * 2 + 1) % roofs.Length]), n, winter); b0++; }
        // the windows run left to right, a band each
        {
            var order = Enumerable.Range(0, _wn).OrderBy(i => Canvas.GetLeft(_win[i])).ToArray();
            var w2 = order.Select(i => _win[i]).ToArray(); var h2 = order.Select(i => _halo[i]).ToArray();
            for (var i = 0; i < _wn; i++) { _win[i] = w2[i]; _halo[i] = h2[i]; _lv[i] = 0.3; }
        }

        // ---- the holidays that are on: the homes on the square first, then the ones behind
        {
            var order = new[] { 8, 11, 9, 10, 7, 12, 1, 5, 3, 0, 6, 2, 4 }; var k = 0;
            foreach (var id in plan.Holidays) { if (k >= order.Length) break; Dress(id, order[k++]); }
        }

        // ---- the great tree in the square, as the season has it
        {
            double tx = X(0.6), tb = Y(0.9);   // to one side since 2026-11-12: the market has the back of the square
            _treeGlow = Glow(tx, tb - S(0.2), S(0.5), Warm, 0.35, 0.3);
            Sv(Trunk, Rgb(0x4A3020), S(0.01), 1, tx, tb); Sv(Bark, Rgb(0x6E4C32), S(0.01), 0.7, tx, tb);
            if (winter)
                foreach (var (dx, dy, len, a) in new[] { (-0.05, -0.24, 0.07, -2.2), (0.0, -0.3, 0.08, -1.57), (0.055, -0.25, 0.07, -0.9), (-0.03, -0.22, 0.06, -2.6), (0.03, -0.22, 0.06, -0.5) })
                { L(tx + S(dx), tb + S(dy), tx + S(dx) + Math.Cos(a) * S(len), tb + S(dy) + Math.Sin(a) * S(len), Rgb(0x3A2A20), Math.Max(1.5, S(0.006))); L(tx + S(dx), tb + S(dy) - S(0.004), tx + S(dx) + Math.Cos(a) * S(len), tb + S(dy) + Math.Sin(a) * S(len) - S(0.004), Rgb(0xE8F0FC), Math.Max(1, S(0.003)), 0.9); }
            else
            {
                var crown = season switch { "summer" => new[] { 0x2A7A44, 0x3A9A54, 0x1E5A34 }, "autumn" => new[] { 0xD87A28, 0xC84A28, 0xE8A838 }, _ => new[] { 0xF0A8C0, 0xF8C8D8, 0xE088A8 } };
                foreach (var (dx, dy, d) in new[] { (-0.07, -0.25, 0.13), (0.07, -0.26, 0.13), (0.0, -0.33, 0.16), (-0.04, -0.2, 0.1), (0.045, -0.2, 0.1), (-0.11, -0.2, 0.08), (0.115, -0.21, 0.08), (0.0, -0.25, 0.13) })
                {
                    var col = Tn(crown[rng.Next(3)]); double cx = tx + S(dx), cy = tb + S(dy), r = S(d) / 2; var pts = new double[18];
                    for (var k = 0; k < 9; k++) { var a = Math.PI * 2 * k / 9; var rr = r * (0.84 + 0.3 * rng.NextDouble()); pts[k * 2] = cx + Math.Cos(a) * rr; pts[k * 2 + 1] = cy + Math.Sin(a) * rr * 0.9; }
                    G(col, 0.97, TableauCurve.Closed(pts, 5)); Oval(cx - r * 0.25, cy - r * 0.3, r * 0.9, r * 0.6, Mix(col, White, 0.25), 0.5);
                }
                for (var k = 0; k < 70; k++)
                {
                    var a = rng.NextDouble() * Math.PI * 2; var rr = Math.Sqrt(rng.NextDouble());
                    Oval(tx + Math.Cos(a) * rr * S(0.15), tb - S(0.26) + Math.Sin(a) * rr * S(0.1), S(0.012), S(0.007), Mix(Tn(crown[rng.Next(3)]), k % 3 == 0 ? White : Dark, 0.22), 0.9);
                }
            }
            for (var k = 0; k < 9; k++) { var a = Math.PI * 2 * k / 9; Light(tx + Math.Cos(a) * S(0.085), tb - S(0.25) + Math.Sin(a) * S(0.06), S(0.006), P(k % 4), 0.8); }
        }
        // ---- the string of lights over the square
        {
            double x0 = X(0.3), x1 = X(0.7), y0 = Y(0.62), sag = S(0.045);
            L(x0, y0, x0, Y(0.87), Dark, Math.Max(1.5, S(0.005))); L(x1, y0, x1, Y(0.87), Dark, Math.Max(1.5, S(0.005)));
            var pl = PL(B(Dark), Math.Max(1, S(0.002)), 0.9); for (var k = 0; k <= 20; k++) { var t = k / 20.0; pl.Points.Add(new Pt(x0 + (x1 - x0) * t, y0 + sag * 4 * t * (1 - t))); }
            for (var k = 0; k < Bulbs; k++) { var t = (k + 0.5) / Bulbs; _bulb[k] = Glow(x0 + (x1 - x0) * t, y0 + sag * 4 * t * (1 - t) + S(0.006), S(0.028), P(k % 4), 0.95, 0.5); }
        }
        {   // paper lanterns let go from the square
            var s = Sur(34, () =>
            {
                for (var k = 0; k < 11; k++)
                {
                    double lx = (k - 5) * S(0.05) + S(0.012) * Math.Sin(k * 2.3), ly = S(0.25) * ((k * 7) % 11) / 11.0;
                    Glow(lx, ly, S(0.055), Rgb(0xFFB050), 0.7, 0.7); R(lx - S(0.007), ly - S(0.01), S(0.014), S(0.02), Flame, 0.95, S(0.004));
                }
            });
            s.Step = (q, p) => { q.T.X = X(0.5) + S(0.03) * Math.Sin(p * 7); q.T.Y = Y(0.72) - p * S(1.3); q.G.Opacity = Fade(p); };
        }
        // ---- neighbours who cross behind the square
        for (var i = 0; i < 3; i++) Walker(i, 0.862 + 0.005 * i, 0.78, new[] { 1, 3, 6 }[i], rng);
        StoriesMid();
        // ---- a board game, with someone looking on
        In(Sub(X(0.215), Y(0.893), out _), () =>
        {
            var u = S(0.015) * 0.9;
            Figure(0, -u * 0.6, 1, S(0.002), 1.0, () => Person(0.9, 0, true));
            Figure(-u * 2.5, u * 0.9, 0, 0, 0, () => Person(0.9, 4)); Figure(u * 2.5, u * 0.9, 0, 0, 0, () => Person(0.9, 4, false, true));
            R(-u * 1.5, -u * 2.2, u * 3.0, u * 0.3, Rgb(0x8A5A30), 1, u * 0.1); R(-u * 0.15, -u * 1.9, u * 0.3, u * 1.9, Rgb(0x5A3A20));
            for (var k = 0; k < 6; k++) R(-u * 1.2 + k * u * 0.4, -u * 2.42, u * 0.4, u * 0.22, k % 2 == 0 ? Rgb(0xF4ECDC) : Rgb(0x2A2A30));
            E(-u * 0.6, -u * 2.6, u * 0.32, Rgb(0xE8503C)); E(u * 0.6, -u * 2.6, u * 0.32, Rgb(0xF2C040));
        });
        // ---- two pairs who dance
        In(Sub(X(0.665), Y(0.893), out _), () =>
        {
            _ch = 2;
            for (var k = 0; k < 2; k++)
            {
                var px = (k * 2 - 1) * S(0.032); var ph = k * 2.0;
                Figure(px - S(0.013), 0, 2, S(0.009), ph, () => Person(0.9, 3)); Figure(px + S(0.013), 0, 2, S(0.009), ph + Math.PI, () => Person(0.9, 2));
            }
            _ch = 0;
        });
        // ---- the band: a drum, strings, a flute
        In(Sub(X(0.745), Y(0.893), out _), () =>
        {
            var u = S(0.015) * 0.9;
            Figure(-u * 3.2, 0, 1, S(0.004), 0, () => { Person(0.9, 6); R(-u * 0.9, -u * 2.3, u * 1.8, u * 1.5, Rgb(0xB8642A), 1, u * 0.3); Oval(0, -u * 2.3, u * 1.8, u * 0.5, Rgb(0xF4ECDC)); });
            Figure(0, 0, 1, S(0.004), 1.5, () => { Person(0.9, 6); L(u * 0.4, -u * 2.4, -u * 1.7, -u * 3.9, Rgb(0x5A3A20), u * 0.3); Oval(u * 0.5, -u * 2.0, u * 1.5, u * 1.9, Rgb(0xD89A48)); E(u * 0.5, -u * 2.0, u * 0.5, Rgb(0x3A2416)); });
            Figure(u * 3.2, 0, 1, S(0.004), 3.0, () => { Person(0.9, 6); L(-u * 0.3, -u * 4.0, u * 1.9, -u * 3.7, Rgb(0xF4ECDC), u * 0.22); });
        });
        // ---- the long table: a place for everyone, with lamps and dishes down its length
        {
            double x0 = X(0.36), x1 = X(0.64), ty = Y(0.935);
            for (var k = 0; k < 9; k++)
            {   // the far side of the table: neighbours seated shoulder to shoulder, some with a glass raised
                var pose = k % 4 == 1 ? 1 : 6; var small = k == 4;
                In(Sub(x0 + (x1 - x0) * (k + 0.5) / 9, ty - S(0.004), out _), () => Person(0.9, pose, small));
            }
            R(x0 - S(0.01), ty - S(0.026), x1 - x0 + S(0.02), S(0.012), Rgb(0xFFF6E4), 1, S(0.003)); R(x0 - S(0.006), ty - S(0.014), x1 - x0 + S(0.012), S(0.03), Rgb(0xE8DCC4), 0.97);
            for (var k = 0; k < 9; k++) { var px = x0 + (x1 - x0) * (k + 0.5) / 9; if (k % 2 == 0) Light(px, ty - S(0.036), S(0.006), Flame); else Oval(px, ty - S(0.03), S(0.024), S(0.009), P(k % 4)); }
        }
        FourSquare();
        // ---- a skipping rope: two turn it, one jumps. The rope is drawn once and turned by the compositor
        In(Indoors(Sub(X(0.8), Y(0.952), out _)), () =>
        {
            double u = S(0.015), w = u * 4.2, a = w - u * 2.0;
            Figure(-w, 0, 0, 0, 0, () => Person(1, 3)); Figure(w, 0, 0, 0, 0, () => Person(1, 2));
            var holder = Sub(0, -u * 2.9, out _); var rc = new Canvas(); holder.Children.Add(rc);
            In(rc, () => { var pl = PL(B(Rgb(0xFFF6E4)), Math.Max(1.5, S(0.003))); for (var k = 0; k <= 16; k++) { var t = k / 16.0; pl.Points.Add(new Pt(-a + 2 * a * t, u * 2.8 * 4 * t * (1 - t))); } });
            _ropeV = Microsoft.UI.Xaml.Hosting.ElementCompositionPreview.GetElementVisual(rc);
            Figure(0, 0, 3, u * 1.2, 0, () => Person(1, 1, true));
        });
        // ---- a child with a kite
        In(Indoors(Sub(X(0.955), Y(0.95), out _)), () =>
        {
            Person(1, 1, true);
            var holder = Sub(-S(0.0144), -S(0.048), out _); _kiteR = new RotateTransform(); var kg = new Canvas { RenderTransform = _kiteR }; holder.Children.Add(kg); _kiteG = kg;
            In(kg, () =>
            {
                double kx = -S(0.16), ky = -S(0.5);
                L(0, 0, kx, ky, Rgb(0xF4ECDC), 1, 0.7);
                G(Rgb(0xE8503C), 1, kx, ky - S(0.032), kx + S(0.022), ky, kx, ky + S(0.038), kx - S(0.022), ky); G(Rgb(0xF2C040), 1, kx, ky - S(0.032), kx + S(0.022), ky, kx, ky);
                var tail = PL(B(Rgb(0x38B8B0)), Math.Max(1.5, S(0.003))); for (var k = 0; k <= 8; k++) tail.Points.Add(new Pt(kx + S(0.008) * Math.Sin(k * 1.4), ky + S(0.038) + k * S(0.009)));
            });
        });
        StoriesFront();
        {   // a cat on business of its own
            var s = Sur(18, () =>
            {
                var u = S(0.012); var fur = Rgb(0x2A2622);
                L(-u * 1.4, -u * 1.5, -u * 2.2, -u * 3.0, fur, u * 0.3); Oval(0, -u * 1.3, u * 3.0, u * 1.3, fur); E(u * 1.7, -u * 2.0, u * 1.3, fur);
                G(fur, 1, u * 1.2, -u * 2.5, u * 1.4, -u * 3.1, u * 1.7, -u * 2.6); G(fur, 1, u * 1.8, -u * 2.6, u * 2.1, -u * 3.1, u * 2.3, -u * 2.5);
                foreach (var lx in new[] { -1.1, -0.6, 0.6, 1.1 }) R(lx * u - u * 0.12, -u * 0.8, u * 0.24, u * 0.8, fur);
                E(u * 1.95, -u * 2.05, u * 0.22, Rgb(0xF2C040));
            });
            s.Step = (q, p) => { q.T.X = -S(0.05) + (W + S(0.1)) * p; q.T.Y = Y(0.962) - Math.Abs(Math.Sin(p * 90)) * S(0.003); q.G.Opacity = 1; };
        }
        // ---- families and friends who cross in front, nearest last
        for (var i = 3; i < Walkers; i++) Walker(i, 0.972 + 0.005 * (i - 3), 1.12, new[] { 0, 4, 2, 5, 1, 6 }[i - 3], rng);
        // ---- what is in the air
        var moteC = season switch { "summer" => Rgb(0xF8F0A0), "autumn" => Rgb(0xE8903A), "winter" => Rgb(0xF4F8FF), _ => Rgb(0xF8C0D4) };
        for (var i = 0; i < Motes; i++)
        {
            _mx[i] = rng.NextDouble(); _my[i] = rng.NextDouble(); _mv[i] = (summer ? 0.01 : winter ? 0.06 : 0.035) * (0.6 + 0.8 * rng.NextDouble()); _mp[i] = rng.NextDouble() * 6;
            var d = S(summer ? 0.004 : 0.004 + 0.004 * rng.NextDouble());
            _mote[i] = summer ? Glow(0, 0, d * 3, moteC, 0.9, 0.6) : E(0, 0, d, autumn && i % 3 == 0 ? Rgb(0xC84A28) : moteC, 0.75); if (autumn) _mote[i].Height = d * 0.6;
        }
        WeatherFront();
        Vignette(0.3);
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;
        _since += dt;
        if (_since > 5)
        {   // a new day or a new setting: the town is made again
            _since = 0; var now = PlanSource?.Invoke();
            if (now is not null && now.Signature != _sig) { Build(C, W, H, Pal); return; }
            if (now is not null) PlaceSky(now);
        }
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 3.5); _lowS += ((f.Reduced ? 0 : f.Low) - _lowS) * 0.3;
        // with no music the people stop where they are and wait (2026-11-12): their clock runs only while music plays
        _go += ((f.Reduced ? 0 : 1) - _go) * 0.08; if (_go < 0.01) _go = 0; var dp = dts * _go; _pt += dp;
        _idle += dts * 0.9; _tw += dts; _drift += dts * (0.3 + 1.2 * f.Mid); _run += dts * (1 + 5 * f.High); _step += dp * (2.2 + 4 * (f.Reduced ? 0 : f.Low));

        for (var i = 0; i < _wn; i++)
        {
            var target = f.Reduced ? 0.4 + 0.25 * Math.Sin(_idle * 0.7 + i * 0.6) : Clamp01(Lv(f, i / (double)Math.Max(1, _wn - 1)) * 1.3 + 0.08 * _flare);
            _lv[i] += (target - _lv[i]) * (target > _lv[i] ? 0.5 : 0.1);
            Op(_win[i], 0.25 + 0.75 * _lv[i]); Op(_halo[i], 0.1 + 0.9 * _lv[i]);
        }
        for (var k = 0; k < Bulbs; k++)
            Op(_bulb[k], f.Reduced ? 0.45 + 0.4 * Math.Pow(0.5 + 0.5 * Math.Sin(_run * 1.4 - k * 0.7), 2) : 0.2 + 0.85 * Clamp01(Lv(f, k / (Bulbs - 1.0)) * 1.5) + 0.25 * _flare);
        for (var i = 0; i < _lights.Count; i++) { var (e, ph) = _lights[i]; Op(e, 0.3 + 0.35 * Osc(_tw, 2.1 + (i % 5) * 0.5, ph) + 0.5 * _flare); }
        for (var i = 0; i < _stars.Count; i++) { var (e, ph) = _stars[i]; Op(e, 0.2 + 0.4 * Osc(_tw, 0.5 + (i % 5) * 0.2, ph) + 0.5 * (f.Reduced ? 0 : f.High)); }
        Op(_sun, 0.5 + 0.45 * f.Loud); Op(_treeGlow, 0.25 + 0.75 * _flare);

        // the walkers cross the square and come round again; they step with the low notes
        for (var i = 0; i < Walkers; i++)
        {
            _wx[i] += dp * _wv[i]; if (_wx[i] > 1.12) _wx[i] = -0.12; else if (_wx[i] < -0.12) _wx[i] = 1.12;
            _walkT[i].X = X(_wx[i]); _walkT[i].Y = Around(_wx[i], _wy[i]) - Math.Abs(Math.Sin(_step + _wp[i])) * S(0.004) * (0.6 + 1.6 * _lowS) - _flare * S(0.004);
        }
        // the pods: hops and sways with the low notes, the rope, the ball, the kite
        _rope += dp * (5 + 3 * f.Low);
        foreach (var (t, kind, x, y, amp, ph) in _movers)
        {
            if (kind == 1) t.Y = y - Math.Abs(Math.Sin(_step * 0.5 + ph)) * amp * (0.5 + 2.4 * _lowS) - _flare * S(0.005);
            else if (kind == 2) t.X = x + Math.Sin(_step * 0.5 + ph) * amp * (0.6 + 1.6 * _lowS);
            else t.Y = y - Math.Pow(Math.Max(0, Math.Cos(_rope)), 2) * amp;
        }
        if (_ropeV is not null) _ropeV.Scale = new System.Numerics.Vector3(1, (float)Math.Cos(_rope), 1);
        if (_ballT is not null && _ballPts.Length > 1)
        {
            var bp = _tw * 0.9; var bi = (int)bp % _ballPts.Length; var bj = (bi + 2) % _ballPts.Length; var fr = bp - Math.Floor(bp);
            _ballT.X = _ballPts[bi].x + (_ballPts[bj].x - _ballPts[bi].x) * fr; _ballT.Y = _ballPts[bi].y + (_ballPts[bj].y - _ballPts[bi].y) * fr - Math.Sin(Math.PI * fr) * S(0.05);
        }
        if (_kiteR is not null) _kiteR.Angle = 3 * Math.Sin(_tw * 0.7) + 1.5 * Math.Sin(_tw * 1.9);
        StepStories(dp, f); WeatherStep(dt, f);
        foreach (var (r, sign, walk, idle, wave, ch, ph) in _limbs)
            r.Angle = sign * (wave ? 12 * Math.Sin(_step * 0.5 + ph) : walk * _gait[ch] * Math.Sin(_pt * 7 + ph) + idle * _go * Math.Sin(_tw * 1.3 + ph));
        // a surprise now and then, never the one before
        if (_surI < 0)
        {
            _surIn -= dt * _go;
            if (_surIn <= 0 && _sur.Count > 1) { var n = Rng.Next(_sur.Count - 1); _surI = n >= _last && _last >= 0 ? n + 1 : n; _last = _surI; _surP = 0; if (Wet && NeedsDry(_sur[_surI])) { _surI = -1; _surIn = 8; } else _sur[_surI].Start?.Invoke(); }
        }
        else
        {
            var su = _sur[_surI]; _surP += dt * _go / su.Len;
            if (_surP >= 1) { su.G.Opacity = 0; _surI = -1; _surIn = 30 + 40 * Rng.NextDouble(); } else su.Step(su, _surP);
        }
        var summer = _season == "summer";
        for (var i = 0; i < Motes; i++)
        {
            if (summer) { _my[i] += dts * _mv[i] * Math.Sin(_drift * 0.4 + _mp[i]); if (_my[i] < 0.5) _my[i] = 0.5; else if (_my[i] > 1) _my[i] = 1; }
            else { _my[i] += dts * _mv[i]; if (_my[i] > 1.02) { _my[i] = -0.02; _mx[i] = Rng.NextDouble(); } }
            var e = _mote[i]; At(e, X(_mx[i]) + S(0.03) * Math.Sin(_drift * (0.6 + 0.2 * (i % 4)) + _mp[i]) - e.Width / 2, Y(_my[i]));
            if (summer) Op(e, 0.2 + 0.6 * Osc(_tw, 1.2 + (i % 5) * 0.3, _mp[i]));
        }
    }
}
