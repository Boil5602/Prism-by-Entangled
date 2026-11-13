using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== SEASONS: the town's small stories
// This file is pure ASCII.

/// <summary>
/// The small stories of the town (2026-11-12, asked for more detail and for scenes that move a person): each is a short play
/// that comes round every minute or so, on its own clock, so the square is never the same twice. A reunion, a child who learns
/// to ride, an elder's bench, a storyteller, a lantern hung from a ladder, a dish carried to a neighbour's door. Around them:
/// smoke from the chimneys, clouds, a windmill on the hill.
///
/// Every figure is drawn once in each pose it takes; a story moves it and shows one pose at a time. Nothing is sized in a frame.
/// </summary>
public sealed partial class SeasonsTown
{
    /// <summary>One neighbour who acts in a story: the same person drawn in a few poses, one shown at a time.</summary>
    private sealed class Actor
    {
        public Canvas G = null!; public TranslateTransform T = null!; public Canvas[] P = Array.Empty<Canvas>(); private int _cur;
        public List<double> Gait = null!; public int Ch; private double _lx;
        public void Pose(int i) { if (i == _cur) return; P[_cur].Opacity = 0; P[i].Opacity = 1; _cur = i; }
        /// <summary>Places the actor; the legs and arms swing while the place changes.</summary>
        public void Put(double x, double y, double op = 1)
        {
            var d = Math.Abs(x - _lx); _lx = x; Gait[Ch] += ((d > 0.05 && d < 40 ? 1 : 0) - Gait[Ch]) * 0.2;
            T.X = x; T.Y = y; G.Opacity = op < 0 ? 0 : op > 1 ? 1 : op;
        }
    }

    private readonly List<(double period, double offset, Action<double> step)> _stories = new();
    private readonly List<(Canvas g, TranslateTransform t, double x, double y, double ph)> _puffs = new();
    private readonly List<Microsoft.UI.Composition.Visual> _puffV = new();
    private readonly List<(TranslateTransform t, double v, double ph)> _clouds = new();
    private RotateTransform? _mill, _signR;
    private readonly Ellipse?[] _aur = new Ellipse?[Bands];
    private Ellipse? _plaza;
    private double _lowS, _dim;
    private string _sky = "dusk";
    private TranslateTransform? _skyT;

    /// <summary>A colour of the land as the hour has it: darker and bluer at night.</summary>
    private Color Tn(int v) => Mix(Rgb(v), Rgb(0x0A1030), _dim);

    /// <summary>The sun or the moon where the plan puts it: low at one side at dawn and dusk, on an arch over the town between.</summary>
    private void PlaceSky(SeasonsPlan plan)
    {
        if (_skyT is null) return;
        if (plan.Sky == "dusk") { _skyT.X = X(0.74); _skyT.Y = Y(0.56); }
        else if (plan.Sky == "dawn") { _skyT.X = X(0.26); _skyT.Y = Y(0.56); }
        else { _skyT.X = X(0.1 + 0.8 * plan.SunAt); _skyT.Y = Y(0.5 - 0.38 * Math.Sin(Math.PI * plan.SunAt)); }
    }

    /// <summary>
    /// The land beyond the town (2026-11-12, asked for in place of brown hills: grass, forest, mountains far off on one side,
    /// dunes on the other). From the back: snow mountains at the left, dunes at the right, a green hill with a forest on it,
    /// and the near rise, which goes from grass at the left to sand at the right. The town is where they meet.
    /// </summary>
    private void Land()
    {
        var rng = new Random(5); var winter = _season == "winter";
        // mountains, far off at the left
        var rock = new[] { 0x8A9AC4, 0x7688B4, 0x6478A6, 0x8090BC };
        var peaks = new[] { (0.30, 0.37, 0.14), (0.03, 0.36, 0.15), (0.41, 0.43, 0.12), (0.17, 0.27, 0.17) };
        for (var k = 0; k < peaks.Length; k++)
        {
            var (cx, top, hw) = peaks[k]; const double by = 0.64; var mid = top + (by - top) * 0.45;
            var body = new[] { X(cx - hw), Y(by), X(cx - hw * 0.5), Y(mid), X(cx - hw * 0.15), Y(top + 0.03), X(cx), Y(top), X(cx + hw * 0.2), Y(top + 0.05), X(cx + hw * 0.55), Y(mid + 0.02), X(cx + hw), Y(by) };
            G(Tn(rock[k]), 1, body); Over(Rock, 0.3, body);
            G(Dark, 0.16, X(cx), Y(top), X(cx + hw * 0.2), Y(top + 0.05), X(cx + hw * 0.55), Y(mid + 0.02), X(cx + hw), Y(by), X(cx + hw * 0.1), Y(by), X(cx + hw * 0.05), Y(mid));
            G(Mix(White, Rgb(0x0A1030), _dim * 0.6), 0.95, X(cx), Y(top), X(cx + hw * 0.2), Y(top + 0.05), X(cx + hw * 0.1), Y(top + 0.075), X(cx + hw * 0.03), Y(top + 0.055), X(cx - hw * 0.07), Y(top + 0.085), X(cx - hw * 0.15), Y(top + 0.03));
        }
        RB(0, Y(0.42), W * 0.6, H * 0.22, Vertical((A(White, 0), 0), (A(White, 0.2), 1)));   // the haze at their feet
        // dunes, at the right
        { var q = TableauCurve.Closed(new[] { X(0.48), Y(0.66), X(0.56), Y(0.55), X(0.68), Y(0.48), X(0.8), Y(0.53), X(0.9), Y(0.46), W + S(0.1), Y(0.5), W + S(0.1), Y(0.68) }, 5); G(Tn(0xF2DCAC), 1, q); Over(Ripple, 0.16, q); }
        G(Tn(0xD8B478), 0.55, TableauCurve.Closed(new[] { X(0.68), Y(0.48), X(0.74), Y(0.52), X(0.78), Y(0.58), X(0.7), Y(0.6), X(0.66), Y(0.54) }, 4));
        G(Tn(0xD8B478), 0.55, TableauCurve.Closed(new[] { X(0.9), Y(0.46), X(0.95), Y(0.5), X(0.99), Y(0.57), X(0.92), Y(0.58), X(0.88), Y(0.52) }, 4));
        { var q = TableauCurve.Closed(new[] { X(0.56), Y(0.68), X(0.66), Y(0.58), X(0.78), Y(0.54), X(0.87), Y(0.59), X(0.97), Y(0.54), W + S(0.1), Y(0.57), W + S(0.1), Y(0.7) }, 5); G(Tn(0xE6C488), 1, q); Over(Ripple, 0.2, q); }
        G(Tn(0xC8A066), 0.5, TableauCurve.Closed(new[] { X(0.78), Y(0.54), X(0.83), Y(0.58), X(0.86), Y(0.64), X(0.79), Y(0.64), X(0.76), Y(0.59) }, 4));
        // a lake at the mountains' feet, seen over a dip in the green hill (2026-11-12, asked for)
        {
            double lx = X(0.31), ly = Y(0.548), lw = W * 0.2, lh = S(0.062); var water = winter ? 0xBCD4EC : 0x4A9AD8;
            Oval(lx, ly, lw * 1.04, lh * 1.25, Tn(winter ? 0xE4ECF6 : 0x9A8A60), 1);   // the shore
            Oval(lx, ly, lw, lh, Tn(water), 1); Oval(lx, ly - lh * 0.18, lw * 0.8, lh * 0.45, Tn(0x8AC4EC), 0.6);
            Oval(lx - lw * 0.08, ly - lh * 0.25, lw * 0.16, lh * 0.3, White, 0.35);     // the snow of the peak in the water
            foreach (var (fx, fy, fw) in new[] { (-0.2, 0.05, 0.12), (0.15, 0.18, 0.16), (-0.05, 0.3, 0.1), (0.25, -0.02, 0.08) }) L(lx + lw * fx, ly + lh * fy, lx + lw * (fx + fw), ly + lh * fy, White, Math.Max(1, S(0.002)), 0.5);
        }
        // the green hill and its forest
        var (g1, g2) = _season switch { "summer" => (0x3E8A4A, 0x4A9A48), "autumn" => (0x6A9440, 0x8AA040), "winter" => (0xD0DCEC, 0xE4ECF6), _ => (0x58A85A, 0x5AB058) };
        { var q = TableauCurve.Closed(new[] { -S(0.1), Y(0.72), -S(0.1), Y(0.54), X(0.12), Y(0.5), X(0.2), Y(0.55), X(0.31), Y(0.578), X(0.42), Y(0.55), X(0.47), Y(0.53), X(0.6), Y(0.6), X(0.68), Y(0.72) }, 5); G(Tn(g1), 1, q); Over(Tuft, 0.22, q); }
        var leaf = _season switch
        {
            "summer" => new[] { 0x1E6A3A, 0x2A7A40, 0x3A8A48, 0x2E7038 },
            "autumn" => new[] { 0xD8742A, 0xC83A2A, 0xE8A82A, 0x2E6A3A, 0xB85A22 },
            "winter" => new[] { 0x2A5A4A, 0x3A6A58, 0x244E44 },
            _ => new[] { 0x4AA050, 0x6ABA60, 0xF0A8C0, 0x3A8A48 },
        };
        var trees = new List<(double x, double y, int k)>();
        for (var k = 0; k < 150; k++)
        {
            double fx = -0.02 + 0.56 * rng.NextDouble(), row = rng.NextDouble(), crest = 0.525 + 0.03 * Math.Sin(fx * 9 + 1.2) + (fx > 0.44 ? (fx - 0.44) * 0.5 : 0);
            if (fx > 0.18 && fx < 0.44) crest = 0.585;   // none in front of the lake
            trees.Add((fx, crest + 0.012 + 0.08 * row, k));
        }
        foreach (var (fx, fy, k) in trees.OrderBy(t => t.y))
        {
            double x = X(fx), y = Y(fy), z = S(0.02 + 0.03 * (fy - 0.52) / 0.1); var c = Tn(leaf[k % leaf.Length]);
            if (k % 5 < 3)
            {   // a conifer, always green
                var cc = _season == "autumn" || _season == "spring" ? Tn(0x2E6A3A + (k % 3) * 0x000808) : c;
                G(cc, 1, x - z * 0.5, y, x + z * 0.5, y, x, y - z * 1.0); G(cc, 1, x - z * 0.4, y - z * 0.5, x + z * 0.4, y - z * 0.5, x, y - z * 1.5);
                if (winter) G(White, 0.9, x - z * 0.16, y - z * 1.1, x + z * 0.16, y - z * 1.1, x, y - z * 1.5);
            }
            else
            {
                L(x, y, x, y - z * 0.5, Tn(0x5A4030), Math.Max(1, z * 0.12)); E(x, y - z * 0.8, z * 0.95, c); E(x - z * 0.15, y - z * 0.95, z * 0.4, Mix(c, White, 0.25), 0.6);
            }
        }
        // the near rise: grass at the left, sand at the right
        var near = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(1, 0) };
        near.GradientStops.Add(new GradientStop { Color = Tn(g2), Offset = 0 }); near.GradientStops.Add(new GradientStop { Color = Tn(g2), Offset = 0.55 });
        near.GradientStops.Add(new GradientStop { Color = Tn(0xDCC084), Offset = 0.8 }); near.GradientStops.Add(new GradientStop { Color = Tn(0xDCC084), Offset = 1 });
        { var q = TableauCurve.Closed(new[] { -S(0.1), Y(0.74), -S(0.1), Y(0.61), X(0.2), Y(0.585), X(0.45), Y(0.63), X(0.72), Y(0.6), W + S(0.1), Y(0.62), W + S(0.1), Y(0.74) }, 5); GB(near, 1, q); Over(Tuft, 0.2, q); }
        // a few palms where the sand begins
        foreach (var (fx, fy) in new[] { (0.775, 0.6), (0.8, 0.612), (0.985, 0.6) })
        {
            double x = X(fx), y = Y(fy), z = S(0.05); L(x, y, x + z * 0.12, y - z, Tn(0x7A5A3A), Math.Max(1.5, z * 0.07));
            for (var q = 0; q < 5; q++) { var an = Math.PI * (0.05 + 0.225 * q); L(x + z * 0.12, y - z, x + z * 0.12 + Math.Cos(an) * z * 0.5, y - z - Math.Sin(an) * z * 0.22 + z * 0.12 * Math.Abs(Math.Cos(an)), Tn(0x3A8A48), Math.Max(1.5, z * 0.09)); }
        }
    }

    /// <summary>
    /// The lawn: one field of grass over the whole ground, under the square, so the square's stones lie on it with a clean
    /// edge (2026-11-12: three ovals of grass had been laid over the stones). Not in winter, when the ground is snow.
    /// </summary>
    private void Lawn()
    {
        if (_season == "winter") return;
        var (a, b) = _season switch { "summer" => (0x4A9A48, 0x3A8040), "autumn" => (0x8AA040, 0x6A8A38), _ => (0x5AB058, 0x48984A) };
        RB(0, Y(0.69), W, H - Y(0.69), Vertical((A(Tn(a), 0), 0), (A(Tn(a), 0.9), 0.12), (Tn(b), 1)));
    }

    /// <summary>Grass: tufts of blades on the lawn, and flowers in spring and summer (2026-11-12, asked for).</summary>
    private void Grass(Random rng)
    {
        var cols = _season switch { "summer" => new[] { 0x3A9040, 0x62B858 }, "autumn" => new[] { 0x7A9A3A, 0xA8B048 }, "winter" => new[] { 0x6A8A70, 0x8AA090 }, _ => new[] { 0x4AA850, 0x7AD070 } };
        var flowers = _season == "spring" || _season == "summer"; var n = _season == "winter" ? 60 : 190;
        for (var k = 0; k < n; k++)
        {
            double fx = rng.NextDouble(), fy = 0.69 + 0.31 * rng.NextDouble();
            if (Math.Pow((fx - 0.5) / 0.33, 2) + Math.Pow((fy - 0.9) / 0.11, 2) < 1) continue;   // the square is bare
            double x = X(fx), y = Y(fy), z = S(0.006 + 0.012 * (fy - 0.69) / 0.31);
            G(Tn(cols[k % 2]), 0.92, x - z * 0.5, y, x - z * 0.35, y - z * 1.1, x - z * 0.15, y, x, y - z * 1.5, x + z * 0.15, y, x + z * 0.4, y - z * 1.0, x + z * 0.5, y);
            if (flowers && k % 6 == 0) E(x + z * 0.4, y - z * 1.1, z * 0.5, Rgb(new[] { 0xFFF4E0, 0xF8D040, 0xF888B8 }[k % 3]));
        }
    }

    /// <summary>
    /// Four square (2026-11-12, asked for in place of a ring that threw a ball nowhere): a court of four squares, a child in
    /// each. The one who has the ball hits it into another's square; it bounces once there, and that child lifts both arms to
    /// take it and hits it on.
    /// </summary>
    /// <summary>One piece of food for the market, about z across: 0 apple, 1 bananas, 2 melon slice, 3 carrot, 4 lettuce, 5 grapes, 6 long loaf, 7 round loaf, 8 crescent roll.</summary>
    private void Food(int kind, double x, double y, double z)
    {
        var thin = Math.Max(1, z * 0.1); Windows.Foundation.Point P2(double px, double py) => new(px, py);
        switch (kind)
        {
            case 0:
                E(x, y, z, Rgb(0xD8382E)); E(x + z * 0.18, y + z * 0.1, z * 0.6, Rgb(0xB82A24), 0.6); E(x - z * 0.2, y - z * 0.2, z * 0.28, White, 0.55);
                L(x, y - z * 0.4, x + z * 0.1, y - z * 0.75, Rgb(0x5A3A20), thin); Oval(x + z * 0.32, y - z * 0.68, z * 0.42, z * 0.2, Rgb(0x4A9A48)); break;
            case 1:
                for (var j = -1; j <= 1; j++)
                {
                    var pl = PL(B(j == 0 ? Rgb(0xF6D848) : Rgb(0xE8C030)), z * 0.3);
                    for (var t = 0; t <= 6; t++) { var an = Math.PI * (0.12 + 0.76 * t / 6); pl.Points.Add(P2(x + j * z * 0.2 + Math.Cos(an) * z * 0.75, y + z * 0.35 - Math.Sin(an) * z * (0.75 - 0.12 * Math.Abs(j)))); }
                }
                E(x + z * 0.72, y + z * 0.08, z * 0.2, Rgb(0x5A3A20)); E(x - z * 0.72, y + z * 0.08, z * 0.2, Rgb(0x5A3A20)); break;
            case 2:
                foreach (var (r, c) in new[] { (0.95, Rgb(0x2E7A3A)), (0.8, Rgb(0xE8F0D0)), (0.7, Rgb(0xE8424A)) })
                {
                    var pts = new double[18]; for (var t = 0; t <= 8; t++) { var an = Math.PI * t / 8; pts[t * 2] = x + Math.Cos(an) * z * r; pts[t * 2 + 1] = y - z * 0.4 + Math.Sin(an) * z * r; }
                    G(c, 1, pts);
                }
                foreach (var dx in new[] { -0.3, 0.0, 0.3 }) E(x + z * dx, y - z * 0.1 + z * 0.12 * (dx == 0 ? 1 : 0), z * 0.13, Rgb(0x2A1C18)); break;
            case 3:
                foreach (var dx in new[] { -0.25, 0.0, 0.25 }) L(x, y - z * 0.5, x + z * dx, y - z * 1.1, Rgb(0x4A9A48), thin * 1.3);
                G(Rgb(0xF2882A), 1, x - z * 0.36, y - z * 0.5, x + z * 0.36, y - z * 0.5, x, y + z * 0.7); L(x - z * 0.14, y - z * 0.15, x + z * 0.12, y - z * 0.15, Rgb(0xC86A1A), thin, 0.8); L(x - z * 0.08, y + z * 0.15, x + z * 0.06, y + z * 0.15, Rgb(0xC86A1A), thin, 0.8); break;
            case 4:
                E(x, y, z * 1.15, Rgb(0x3A8A40)); E(x, y, z * 0.85, Rgb(0x6AB858)); E(x, y - z * 0.03, z * 0.5, Rgb(0xA8D878));
                L(x, y - z * 0.4, x, y + z * 0.4, Rgb(0x3A8A40), thin, 0.6); L(x - z * 0.35, y - z * 0.2, x, y + z * 0.1, Rgb(0x3A8A40), thin, 0.6); L(x + z * 0.35, y - z * 0.2, x, y + z * 0.1, Rgb(0x3A8A40), thin, 0.6); break;
            case 5:
                L(x, y - z * 0.5, x + z * 0.15, y - z * 0.95, Rgb(0x4A7A30), thin * 1.2);
                foreach (var (dx, dy) in new[] { (-0.4, -0.3), (0.0, -0.35), (0.4, -0.3), (-0.2, 0.05), (0.2, 0.05), (0.0, 0.4) })
                { E(x + z * dx, y + z * dy, z * 0.45, Rgb(0x7A3A9A)); E(x + z * dx - z * 0.08, y + z * dy - z * 0.08, z * 0.14, White, 0.5); }
                break;
            case 6:
                L(x - z * 0.3, y + z * 0.5, x + z * 0.35, y - z * 1.2, Rgb(0xC88A40), z * 0.5); L(x - z * 0.3, y + z * 0.5, x + z * 0.35, y - z * 1.2, Rgb(0xE8B868), z * 0.28);
                foreach (var f in new[] { 0.25, 0.5, 0.75 }) { double mx = x - z * 0.3 + z * 0.65 * f, my = y + z * 0.5 - z * 1.7 * f; L(mx - z * 0.14, my - z * 0.02, mx + z * 0.1, my - z * 0.16, Rgb(0x9A6428), thin); }
                break;
            case 7:
                Oval(x, y, z * 1.35, z * 1.0, Rgb(0xA86A30)); Oval(x, y - z * 0.1, z * 1.1, z * 0.7, Rgb(0xD09850)); Oval(x - z * 0.2, y - z * 0.22, z * 0.5, z * 0.22, Rgb(0xF0D8A0), 0.6);
                L(x - z * 0.28, y - z * 0.25, x + z * 0.05, y + z * 0.1, Rgb(0x8A5424), thin); L(x + z * 0.02, y - z * 0.28, x + z * 0.32, y + z * 0.05, Rgb(0x8A5424), thin); break;
            default:
            {
                var pl = PL(B(Rgb(0xD89A40)), z * 0.5); var hi = PL(B(Rgb(0xF0C878)), z * 0.2);
                for (var t = 0; t <= 6; t++) { var an = Math.PI * (0.1 + 0.8 * t / 6); var pt = P2(x + Math.Cos(an) * z * 0.6, y - z * 0.35 + Math.Sin(an) * z * 0.6); pl.Points.Add(pt); hi.Points.Add(P2(pt.X, pt.Y - z * 0.08)); }
                foreach (var dx in new[] { -0.3, 0.0, 0.3 }) L(x + z * dx - z * 0.06, y + z * 0.02, x + z * dx + z * 0.06, y + z * 0.32, Rgb(0xA86A28), thin);
                break;
            }
        }
    }

    /// <summary>
    /// The food market at the back of the square (2026-11-12, asked for a market to visit): three stalls with striped
    /// awnings, a seller behind each counter, fruit, greens and bread set out, and people who shop.
    /// </summary>
    private void Market()
    {
        double b = Y(0.8), w = S(0.115), hi = S(0.168); var wood = Rgb(0x8A5A30);
        var goods = new[] { new[] { 0xE84A3A, 0xF29A2A, 0xF2D040, 0x7AC04A }, new[] { 0x4A9A48, 0x8A4AA0, 0xF2882A, 0x9AC84A }, new[] { 0xD8A860, 0xC08A48, 0xE8C080, 0xB87838 } };
        var cloth = new[] { 0xE8483A, 0x2E8A7A, 0xF2B030 };
        for (var k = 0; k < 3; k++)
        {
            var x = X(0.395 + 0.058 * k); var post = Math.Max(1.5, S(0.004));
            L(x - w / 2, b, x - w / 2, b - hi, Rgb(0x5A3A20), post); L(x + w / 2, b, x + w / 2, b - hi, Rgb(0x5A3A20), post);
            _noUmb = true; In(Sub(x, b - S(0.036), out _), () => Person(0.8, k == 1 ? 6 : 5, false, k == 2)); _noUmb = false;   // the seller, under cover
            R(x - w / 2, b - S(0.042), w, S(0.042), wood, 1, S(0.003)); Img(Tex(w, S(0.042), Planks(7), null, 0.3), x - w / 2, b - S(0.042), w, S(0.042));
            R(x - w / 2 - S(0.004), b - S(0.052), w + S(0.008), S(0.013), Mix(wood, White, 0.25), 1, S(0.003));
            for (var q = 0; q < 3; q++)
            {   // three crates on the counter, each with one kind of food drawn as what it is (2026-11-12: all of it had been dots)
                double cw = w * 0.31, cxq = x - w * 0.33 + w * 0.33 * q, top = b - S(0.052), z = S(0.0145);
                for (var n = 0; n < 3; n++) Food(k * 3 + q, cxq - cw * 0.3 + cw * 0.3 * n, top - S(0.021) - (n == 1 ? z * 0.4 : 0), z);
                R(cxq - cw / 2, top - S(0.017), cw, S(0.019), Rgb(0x6A4424), 1, S(0.002)); L(cxq - cw / 2 + 1, top - S(0.008), cxq + cw / 2 - 1, top - S(0.008), Rgb(0x4A2E18), 1, 0.7);
            }
            // the awning: six stripes that widen toward the front, with a scalloped edge
            double t0 = b - hi - S(0.012), t1 = b - hi + S(0.026), h0 = w * 0.5, h1 = w * 0.6;
            for (var q = 0; q < 6; q++)
            {
                var c = q % 2 == 0 ? Rgb(cloth[k]) : Rgb(0xFBF3E4); double f0 = q / 6.0 * 2 - 1, f1 = (q + 1) / 6.0 * 2 - 1;
                G(c, 1, x + h0 * f0, t0, x + h0 * f1, t0, x + h1 * f1, t1, x + h1 * f0, t1); E(x + h1 * (f0 + f1) / 2, t1, h1 / 3, c);
            }
            G(Dark, 0.12, x - h1, t1, x + h1, t1, x + h1 * 0.96, t1 + S(0.012), x - h1 * 0.96, t1 + S(0.012));
        }
        // people who shop: one with a basket, a pair, a child who points
        In(Sub(X(0.385), Y(0.822), out _), () => { Person(0.82, 3); R(S(0.012), -S(0.03), S(0.016), S(0.012), Rgb(0xB88A48), 1, S(0.003)); });
        In(Sub(X(0.44), Y(0.826), out _), () => Person(0.82, 6)); In(Sub(X(0.452), Y(0.828), out _), () => Person(0.8, 2, true));
        In(Sub(X(0.515), Y(0.824), out _), () => Person(0.82, 2, false, true));
    }

    /// <summary>
    /// Someone shops (2026-11-12, asked for): they come out of their home, walk to a stall, the seller sets a bag on the
    /// counter, they take it, carry it home and go in with it. A while after, they come out, stand by the tree, and go home
    /// before the next time.
    /// </summary>
    private void Shopping()
    {
        var trips = new[] { (0.345, 0.844, 0, 120.0, 15.0), (0.65, 0.846, 2, 150.0, 80.0) };
        for (var k = 0; k < trips.Length; k++)
        {
            var (fx, fy, stall, per, off) = trips[k]; double u = S(0.015) * 0.85, dx = X(fx), dy = Y(fy) + S(0.004);
            double stx = X(0.395 + 0.058 * stall) + (k == 0 ? 1 : -1) * S(0.024), sty = Y(0.826), cnx = X(0.395 + 0.058 * stall), cny = Y(0.8) - S(0.06);
            double restX = X(0.6) + (k == 0 ? -1 : 1) * S(0.05), restY = Y(0.905);
            var dark = R(dx - S(0.019), dy - S(0.086), S(0.038), S(0.082), Rgb(0x16100C), 0, S(0.005));
            var who = Act(0.85, false, k == 1, 0, 3, 1);
            var bagG = Sub(0, 0, out var bagT); bagG.Opacity = 0;
            In(bagG, () =>
            {   // a paper bag with a loaf and some greens at its top
                L(-u * 0.1, -u * 1.5, u * 0.35, -u * 2.5, Rgb(0xD8A860), u * 0.32); E(-u * 0.35, -u * 1.6, u * 0.7, Rgb(0x4A9A48)); E(u * 0.1, -u * 1.5, u * 0.55, Rgb(0xD8382E));
                G(Rgb(0xC89A5A), 1, -u * 0.7, -u * 1.5, u * 0.7, -u * 1.5, u * 0.6, 0, -u * 0.6, 0); G(Rgb(0xA87A40), 0.7, u * 0.2, -u * 1.5, u * 0.7, -u * 1.5, u * 0.6, 0, u * 0.25, 0);
            });
            _stories.Add((per, off, t =>
            {
                double x = dx, y = dy, op = 1, door = 0, bx = cnx, by = cny, bop = 0; var pose = 0;
                double Door(double a0) => Seg(t, a0, a0 + 1) * (1 - Seg(t, a0 + 2, a0 + 3));
                if (t < 3) { door = Door(0); op = Seg(t, 1, 2); }
                else if (t < 10) { var q = Ease(Seg(t, 3, 10)); x = Lerp(dx, stx, q); y = Lerp(dy, sty, q); }
                else if (t < 14)
                {   // at the stall: the bag comes up onto the counter, then into the hand
                    x = stx; y = sty; pose = t > 11.5 ? 1 : 0; bop = Seg(t, 10.5, 11.2);
                    var q = Ease(Seg(t, 12, 13.5)); bx = Lerp(cnx, x + u * 1.2, q); by = Lerp(cny, y - u * 1.6, q) - Math.Sin(Math.PI * Seg(t, 10.5, 11.2)) * 0;
                }
                else if (t < 21) { var q = Ease(Seg(t, 14, 21)); x = Lerp(stx, dx, q); y = Lerp(sty, dy, q); bop = 1; bx = x + u * 1.2; by = y - u * 1.6; }
                else if (t < 24) { door = Door(21); op = 1 - Seg(t, 22, 23); bop = op; bx = x + u * 1.2; by = y - u * 1.6; }
                else if (t < 44) op = 0;
                else if (t < 47) { door = Door(44); op = Seg(t, 45, 46); }
                else if (t < 55) { var q = Ease(Seg(t, 47, 55)); x = Lerp(dx, restX, q); y = Lerp(dy, restY, q); }
                else if (t < per - 12) { x = restX; y = restY; pose = t < 58 ? 2 : 0; }
                else if (t < per - 4) { var q = Ease(Seg(t, per - 12, per - 4)); x = Lerp(restX, dx, q); y = Lerp(restY, dy, q); }
                else { door = Door(per - 4); op = 1 - Seg(t, per - 3, per - 2); }
                Op(dark, door * 0.9); who.Pose(pose); who.Put(x, y, op); bagT.X = bx; bagT.Y = by; bagG.Opacity = bop;
            }));
        }
    }

    /// <summary>
    /// People who call at a home (2026-11-12, asked for people who go into the buildings now and then): one comes in from the
    /// side, walks to a door on the square, the door opens, they go in; some time after, the door opens and they leave the way
    /// they came.
    /// </summary>
    private void Visits()
    {
        var calls = new[] { (0.163, 0.842, -1, 70.0, 6.0), (0.094, 0.847, -1, 96.0, 40.0), (0.897, 0.857, 1, 84.0, 22.0), (0.827, 0.846, 1, 110.0, 61.0) };
        for (var k = 0; k < calls.Length; k++)
        {
            var (fx, fy, side, per, off) = calls[k]; double dx = X(fx), dy = Y(fy), from = side < 0 ? -W * 0.08 : W * 1.08, lane = Y(0.905);
            var dark = R(dx - S(0.019), dy - S(0.082), S(0.038), S(0.082), Rgb(0x16100C), 0, S(0.005));
            var who = Act(0.85, false, k == 2, 0);
            _stories.Add((per, off, t =>
            {
                double x, y, op = 1, door = 0;
                if (t < 12) { var q = t / 12; x = Lerp(from, dx, q); y = Lerp(lane, dy + S(0.004), Ease(Seg(t, 7, 12))); }
                else if (t < 15) { x = dx; y = dy + S(0.004); door = Seg(t, 12, 13) * (1 - Seg(t, 14, 15)); op = 1 - Seg(t, 13, 14); }
                else if (t < per - 16) { x = dx; y = dy + S(0.004); op = 0; }
                else if (t < per - 13) { var s0 = per - 16; x = dx; y = dy + S(0.004); door = Seg(t, s0, s0 + 1) * (1 - Seg(t, s0 + 2, s0 + 3)); op = Seg(t, s0 + 1, s0 + 2); }
                else if (t < per - 1) { var q = Seg(t, per - 13, per - 1); x = Lerp(dx, from, q); y = Lerp(dy + S(0.004), lane, Ease(Seg(t, per - 13, per - 8))); }
                else { x = from; y = lane; op = 0; }
                Op(dark, door * 0.9); who.Put(x, y, op);
            }));
        }
    }

    private readonly TextBlock?[] _fsScore = new TextBlock?[4];

    /// <summary>A walker's height on the screen as they pass the court: whoever would cross it goes round, above or below (2026-11-12, asked for).</summary>
    private double Around(double fx, double y)
    {
        double lo = Y(0.8), hi = Y(0.9); if (y <= lo || y >= hi) return y;
        var near = 1 - Seg(Math.Abs(fx - 0.47), 0.055, 0.1); if (near <= 0) return y;
        return Lerp(y, y < Y(0.856) ? lo - S(0.004) : hi + S(0.008), Ease(near));
    }

    private void Court()
    {   // the court is paint on the stones: it is drawn with the ground, so whoever walks by is in front of it (2026-11-12: people
        // had passed behind it)
        double cx = X(0.47), cy = Y(0.856), a = S(0.075), d = S(0.022), th = Math.Max(1.5, S(0.0025)); Color line = Rgb(0xFFF6E4);
        R(cx - a, cy - d, 2 * a, 2 * d, Rgb(0x6A7A9A), 0.45, S(0.004));
        L(cx - a, cy - d, cx + a, cy - d, line, th, 0.85); L(cx - a, cy + d, cx + a, cy + d, line, th, 0.85); L(cx - a, cy - d, cx - a, cy + d, line, th, 0.85); L(cx + a, cy - d, cx + a, cy + d, line, th, 0.85);
        L(cx, cy - d, cx, cy + d, line, th, 0.85); L(cx - a, cy, cx + a, cy, line, th, 0.85);
        var cs = new[] { (-1, -1), (1, -1), (1, 1), (-1, 1) }; var fs = S(0.02);
        for (var i = 0; i < 4; i++)
        {   // each square's score, in chalk
            var tb = new TextBlock { Text = "0", FontSize = fs, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = B(A(line, 0.75)), Width = a, TextAlignment = TextAlignment.Center };
            At(tb, cx + cs[i].Item1 * a * 0.5 - a / 2, cy + cs[i].Item2 * d * 0.5 - fs * 0.68); C.Children.Add(tb); _fsScore[i] = tb;
        }
    }

    private void FourSquare()
    {
        double cx = X(0.47), cy = Y(0.856), a = S(0.075), d = S(0.022), uc = S(0.015) * 0.95 * 0.64, th = Math.Max(1.5, S(0.0025)); Color line = Rgb(0xFFF6E4);
        var side = new[] { (-1, -1), (1, -1), (1, 1), (-1, 1) }; var pl = new Actor[4];
        double[] px = new double[4], py = new double[4], qx = new double[4], qy = new double[4];
        for (var i = 0; i < 4; i++) { px[i] = cx + side[i].Item1 * a * 1.2; py[i] = cy + side[i].Item2 * d * 1.3; qx[i] = cx + side[i].Item1 * a * 0.5; qy[i] = cy + side[i].Item2 * d * 0.5; }
        foreach (var i in new[] { 0, 1, 3, 2 }) pl[i] = Act(0.95, true, false, 0, 1);
        var shG = Sub(0, 0, out var shT); In(shG, () => Oval(0, 0, S(0.02), S(0.006), Dark, 0.3));
        var ballG = Sub(0, 0, out var ballT); In(ballG, () => { E(0, 0, S(0.018), Rgb(0xF04848)); E(-S(0.003), -S(0.003), S(0.006), White, 0.7); });
        // The ball goes in one straight line over the ground: from the child who hits it, to its bounce in another's square,
        // and on the same way after the bounce. The child whose square it is runs to where that line can be met and takes it
        // there; the next hit starts from that place. After a few hits one is missed: the ball goes out past the child, the one
        // who hit it scores (the count is in chalk in their square), the ball comes back to them, and they serve: one bounce
        // in their own square, then the hit (2026-11-12, asked for a score and a serve).
        int from = 0, to = 2, seg = 0, hits = 0, rally = 3; double tau = 0, last = -1; var rnd = new Random(7); var score = new int[4]; var miss = false;
        double[] sx = new double[4], sy = new double[4]; for (var i = 0; i < 4; i++) { sx[i] = px[i]; sy[i] = py[i]; }
        double gx0 = px[0], gy0 = py[0], bx0 = 0, by0 = 0, mx = 0, my = 0, ox = 0, oy = 0, hh = uc * 4.6;
        var plusG = Sub(0, 0, out var plusT); plusG.Opacity = 0;
        In(plusG, () => { var tb = new TextBlock { Text = "+1", FontSize = S(0.026), FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = B(Rgb(0xFFE890)) }; At(tb, -S(0.014), -S(0.03)); C.Children.Add(tb); });
        void Aim()
        {
            gx0 = sx[from]; gy0 = sy[from]; miss = hits >= rally;
            bx0 = qx[to] + (rnd.NextDouble() - 0.5) * a * 0.5; by0 = qy[to] + (rnd.NextDouble() - 0.5) * d * 0.5;
            double dx = bx0 - gx0, dy = by0 - gy0, len = Math.Sqrt(dx * dx + dy * dy) + 1e-6, go = Math.Min(len * 0.5, a * 0.55);
            mx = bx0 + dx / len * go; my = by0 + dy / len * go; ox = mx + dx / len * a * 1.3; oy = my + dy / len * a * 1.3;
        }
        Aim();
        _stories.Add((1e9, 0, t =>
        {
            var dt = last < 0 ? 0 : Math.Clamp(t - last, 0, 0.2); last = t; tau += dt;
            var dur = seg switch { 0 => 0.6, 1 => 0.4, 2 => 0.7, 3 => 1.6, _ => 1.1 };
            if (tau >= dur)
            {
                tau -= dur;
                if (seg == 0) seg = 1;
                else if (seg == 1 && !miss) { sx[to] = mx; sy[to] = my; from = to; to = (from + 1 + rnd.Next(3)) % 4; hits++; Aim(); seg = 0; }
                else if (seg == 1) seg = 2;
                else if (seg == 2)
                {
                    score[from]++; if (score[from] > 9) Array.Clear(score);
                    for (var i = 0; i < 4; i++) if (_fsScore[i] is { } tb) tb.Text = score[i].ToString();
                    seg = 3;
                }
                else if (seg == 3) seg = 4;
                else { hits = 0; rally = 2 + rnd.Next(5); to = (from + 1 + rnd.Next(3)) % 4; Aim(); seg = 0; }
                dur = seg switch { 0 => 0.6, 1 => 0.4, 2 => 0.7, 3 => 1.6, _ => 1.1 };
            }
            double p = Math.Min(1, tau / dur), gx, gy, up;
            if (seg == 0) { gx = Lerp(gx0, bx0, p); gy = Lerp(gy0, by0, p); up = hh * (1 - p * p) + Math.Sin(Math.PI * p) * S(0.01); }
            else if (seg == 1) { gx = Lerp(bx0, mx, p); gy = Lerp(by0, my, p); up = hh * (miss ? 0.5 : 1) * (1 - (1 - p) * (1 - p)); }
            else if (seg == 2) { gx = Lerp(mx, ox, p); gy = Lerp(my, oy, p); up = hh * 0.5 * (1 - p) * (1 - p) + Math.Abs(Math.Sin(Math.PI * p * 2)) * S(0.006) * (1 - p); }
            else if (seg == 3) { var q = Ease(p); gx = Lerp(ox, sx[from], q); gy = Lerp(oy, sy[from], q); up = hh * q + Math.Sin(Math.PI * p) * S(0.03); }
            else { gx = sx[from]; gy = sy[from]; up = hh * (p < 0.5 ? 1 : Math.Abs(Math.Cos(Math.PI * (p - 0.5) / 0.5))); }
            ballT.X = gx; ballT.Y = gy - up; shT.X = gx; shT.Y = gy; ballG.Opacity = shG.Opacity = 1 - _inside;
            plusG.Opacity = seg == 3 ? Math.Sin(Math.PI * p) * (1 - _inside) : 0; plusT.X = sx[from]; plusT.Y = sy[from] - hh * 1.5 - p * S(0.03);
            var k = Math.Min(1, dt * 5);
            for (var i = 0; i < 4; i++)
            {
                // the one the ball is coming to runs to meet it (and falls short of one they miss); the one who hit it stays a
                // moment; after a point everyone goes back to their places
                double wx = px[i], wy = py[i]; var kk = k;
                if (i == to && seg <= 1) { wx = miss ? Lerp(px[i], mx, 0.45) : mx; wy = miss ? Lerp(py[i], my, 0.45) : my; kk = Math.Min(1, dt * 7); }
                else if (i == from && seg == 0 && p < 0.5) { wx = sx[i]; wy = sy[i]; }
                sx[i] += (wx - sx[i]) * kk; sy[i] += (wy - sy[i]) * kk;
                var hit = i == from && seg == 0 && p < 0.3; var take = i == to && seg == 1 && p > 0.3 && !miss;
                var cheer = i == from && seg == 3; var hold = i == from && seg == 4;
                pl[i].Pose(hit || take || cheer || hold ? 1 : 0);
                pl[i].Put(sx[i], sy[i] - (hit ? Math.Sin(Math.PI * p / 0.3) * S(0.006) : cheer ? Math.Abs(Math.Sin(p * 12)) * S(0.007) : 0), 1 - _inside);
            }
        }));
    }
    private double _st, _millA;

    private static double Seg(double t, double a, double b) => Clamp01((t - a) / (b - a));
    private static double Ease(double p) => p * p * (3 - 2 * p);
    private static double Lerp(double a, double b, double p) => a + (b - a) * p;
    private double Bob(double t) => Math.Abs(Math.Sin(t * 7)) * S(0.004);
    private void Ring(double cx, double cy, double d, Color c, double th) { var e = new Ellipse { Width = d, Height = d, Stroke = B(c), StrokeThickness = th }; At(e, cx - d / 2, cy - d / 2); C.Children.Add(e); }

    private Actor Act(double sc, bool child, bool grey, params int[] poses)
    {
        var a = new Actor { G = Sub(0, 0, out var t), P = new Canvas[poses.Length] }; a.T = t; a.G.Opacity = 0; var n0 = _pn;
        a.Gait = _gait; a.Ch = _gait.Count; _gait.Add(0); _ch = a.Ch;
        for (var i = 0; i < poses.Length; i++)
        {
            var pc = new Canvas { Opacity = i == 0 ? 1 : 0 }; a.G.Children.Add(pc); a.P[i] = pc; _pn = n0; var pose = poses[i];
            In(pc, () => Person(sc, pose, child, grey));
        }
        _pn = n0 + 1; _ch = 0; return a;
    }

    private void StoriesReset() { _umb.Clear(); _indoors.Clear(); _stories.Clear(); _puffs.Clear(); _puffV.Clear(); _clouds.Clear(); _mill = null; _signR = null; _plaza = null; Array.Clear(_aur); }

    // ------------------------------------------------------------------ the sky and the hills
    private void StoriesSky()
    {
        // the music along the horizon: a soft column of light for each band, behind the hills (2026-11-12, asked for a town that
        // answers the music more)
        for (var i = 0; i < Bands; i++) { var e = Glow(0, 0, S(0.16), P(i % 4), 0.85, 0); Size(e, X((i + 0.5) / Bands), Y(0.48), S(0.16), S(0.62)); _aur[i] = e; }
        var (top, under, cop) = _sky switch
        {
            "day" => (White, Rgb(0xB4C2DA), 0.95),
            "night" => (Rgb(0x6A78A0), Rgb(0x283258), 0.6),
            "dawn" => (Rgb(0xFFE8D0), Rgb(0xD898A8), 0.9),
            _ => (Rgb(0xFFDCC8), Rgb(0xB87898), 0.9),
        };
        var places = new[] { (0.1, 1.0), (0.2, 0.75), (0.31, 0.6), (0.06, 0.5), (0.26, 0.9) };
        for (var k = 0; k < places.Length; k++)
        {
            var (fy, sc) = places[k]; var g = Sub(0, Y(fy), out var t); double cw = S(0.62) * sc, ch = cw / 3;
            In(g, () => Img(CloudTex(k + 1, top, under), -cw / 2, -ch / 2, cw, ch, cop));
            _clouds.Add((t, 0.003 + 0.0022 * sc, (0.13 + 0.29 * k) % 1.4));
        }
        WeatherSky();
    }

    private void StoriesHills()
    {
        Sign();
        // a windmill on the far hill; it turns with the middle of the music
        double x = X(0.935), yb = Y(0.6), yt = Y(0.44), r = S(0.075); var cream = Rgb(0xF4ECDC);
        G(Mix(cream, Dark, 0.15), 1, x - S(0.014), yb, x + S(0.014), yb, x + S(0.008), yt, x - S(0.008), yt);
        G(Rgb(0x9A2A4A), 1, x - S(0.011), yt, x + S(0.011), yt, x, yt - S(0.018));
        Light(x, yt + S(0.05), S(0.006), Warm);
        _mill = new RotateTransform(); var hub = Sub(x, yt + S(0.004), out _); var blades = new Canvas { RenderTransform = _mill }; hub.Children.Add(blades);
        In(blades, () =>
        {
            for (var k = 0; k < 4; k++)
            {
                var a = Math.PI / 2 * k;
                L(0, 0, Math.Cos(a) * r, Math.Sin(a) * r, Rgb(0x5A3A20), Math.Max(1.5, S(0.003)));
                G(cream, 0.92, Math.Cos(a) * r * 0.25, Math.Sin(a) * r * 0.25, Math.Cos(a) * r, Math.Sin(a) * r, Math.Cos(a + 0.2) * r, Math.Sin(a + 0.2) * r, Math.Cos(a + 0.5) * r * 0.3, Math.Sin(a + 0.5) * r * 0.3);
            }
            E(0, 0, S(0.01), Rgb(0x5A3A20));
        });
    }

    private void Chimney(int home)
    {
        var (x, b, w, h, _, _, _, _, _) = _homes[home]; double cx = x + w * 0.74, top = b - h;
        R(cx, top - h * 0.5, w * 0.09, h * 0.34, Rgb(0x8A4A40)); R(cx - w * 0.012, top - h * 0.53, w * 0.114, h * 0.045, Rgb(0x5A2A28));
        // smoke (2026-11-12, asked for smoke more like smoke; it had been three pairs of ovals): twelve wisps a chimney, each a
        // soft picture made from noise. A wisp leaves the pot small and dense, rises, leans with the air, wavers, spreads and thins.
        for (var k = 0; k < 12; k++)
        {
            var g = Sub(0, 0, out var t); g.Opacity = 0; var d = S(0.075);
            var inner = new Canvas(); g.Children.Add(inner); In(inner, () => Img(SmokeTex(k % 4), -d / 2, -d / 2, d, d));   // the outer canvas carries the place, the inner one the size
            _puffs.Add((g, t, cx + w * 0.045, top - h * 0.54, k / 12.0 + home * 0.17));
            _puffV.Add(Microsoft.UI.Xaml.Hosting.ElementCompositionPreview.GetElementVisual(inner));
        }
    }

    /// <summary>After the homes behind the square are built.</summary>
    private void StoriesBackRow() { Chimney(2); Chimney(5); }

    // ------------------------------------------------------------------ the stories at the back and the sides of the square
    private void StoriesMid()
    {
        Chimney(7); Chimney(12);
        { var e = Glow(0, 0, S(1), Warm, 0.6, 0); Size(e, X(0.5), Y(0.9), W * 0.7, S(0.26)); _plaza = e; }   // the square warms on a beat
        Reunion(); Dish(); Bench(); Ladder(); Storyteller();
    }

    /// <summary>
    /// The town's name on a billboard on the hill behind the homes: "Welcome to" over "CONVERGENCE" (2026-11-12, asked for in
    /// place of a board that hung in the square). Its feet are behind the back row; two lamps on its top light it at night.
    /// </summary>
    private void Sign()
    {
        double cx = X(0.68), top = Y(0.345), w = S(0.36), h = S(0.1), x = cx - w / 2, foot = Y(0.6), th = Math.Max(2, S(0.006));
        Color post = Tn(0x5A4030), board = Mix(Rgb(0xFBF3DC), Rgb(0x0A1030), _dim * 0.5), ink = Rgb(0x2A3A6A), trim = Rgb(0xD8483A);
        foreach (var fx in new[] { 0.16, 0.84 }) L(x + w * fx, top + h, x + w * fx, foot, post, th);
        L(x + w * 0.16, top + h + S(0.012), x + w * 0.84, top + h + S(0.075), post, th * 0.5); L(x + w * 0.84, top + h + S(0.012), x + w * 0.16, top + h + S(0.075), post, th * 0.5);
        R(x - S(0.006), top - S(0.006), w + S(0.012), h + S(0.012), post, 1, S(0.008));
        R(x, top, w, h, board, 1, S(0.005)); Img(Tex(w, h, Plaster, null, 0.12), x, top, w, h);
        R(x + S(0.008), top + h - S(0.016), w - S(0.016), S(0.006), trim, 0.9, S(0.003));
        double f1 = S(0.026), f2 = S(0.042);
        var t1 = new TextBlock { Text = "Welcome to", FontSize = f1, FontStyle = Windows.UI.Text.FontStyle.Italic, FontFamily = new FontFamily("Georgia"), Foreground = B(trim), Width = w, TextAlignment = TextAlignment.Center };
        At(t1, x, top + S(0.004)); C.Children.Add(t1);
        var t2 = new TextBlock { Text = "CONVERGENCE", FontSize = f2, CharacterSpacing = 120, FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = B(ink), Width = w, TextAlignment = TextAlignment.Center };
        At(t2, x, top + S(0.032)); C.Children.Add(t2);
        foreach (var fx in new[] { 0.25, 0.75 })
        {
            L(x + w * fx, top - S(0.006), x + w * fx, top - S(0.02), post, th * 0.5); E(x + w * fx, top - S(0.022), S(0.012), Rgb(0xFFE8A0));
            if (_sky == "night" || _sky == "dusk" || _sky == "dawn") Glow(x + w * fx, top + h * 0.3, S(0.2), Rgb(0xFFE8A0), 0.5, _sky == "night" ? 0.5 : 0.25);
        }
    }

    /// <summary>Someone comes home with a bag. Someone has waited. They see each other across the square.</summary>
    private void Reunion()
    {
        double ly = Y(0.905), u = S(0.015) * 0.8, xm = X(0.47), xa = X(0.3), xb = X(0.64);   // in front of the court
        var bagG = Sub(0, ly, out var bagT); bagG.Opacity = 0;
        In(bagG, () => { R(-u * 0.7, -u * 1.5, u * 1.4, u * 1.3, Rgb(0x8A5A30), 1, u * 0.2); R(-u * 0.3, -u * 1.9, u * 0.6, u * 0.45, Rgb(0x5A3A20), 1, u * 0.15); R(-u * 0.7, -u * 1.0, u * 1.4, u * 0.15, Rgb(0xD8B060)); });
        var a = Act(0.8, false, false, 0, 1, 5, 3); var b = Act(0.8, false, true, 0, 1, 5, 2);
        var hG = Sub(0, 0, out var hT); hG.Opacity = 0; var rose = Rgb(0xF04870);
        In(hG, () => { Glow(0, 0, u * 6, Rgb(0xFF80A8), 0.7); E(-u * 0.45, -u * 0.3, u * 1.0, rose); E(u * 0.45, -u * 0.3, u * 1.0, rose); G(rose, 1, -u * 0.92, -u * 0.1, u * 0.92, -u * 0.1, 0, u * 1.1); });
        _stories.Add((90, 5, t =>
        {
            if (t >= 52) { a.Put(0, ly, 0); b.Put(0, ly, 0); bagG.Opacity = 0; hG.Opacity = 0; return; }
            double ax, bx, bob = Bob(t);
            if (t < 14) { ax = Lerp(-W * 0.08, xa, t / 14); bx = Lerp(W * 1.08, xb, Seg(t, 4, 14)); a.Pose(0); b.Pose(0); }
            else if (t < 15.5) { ax = xa; bx = xb; a.Pose(1); b.Pose(1); bob = Math.Abs(Math.Sin(t * 9)) * S(0.006); }
            else if (t < 19) { var p = Ease(Seg(t, 15.5, 19)); ax = Lerp(xa, xm - u, p); bx = Lerp(xb, xm + u, p); a.Pose(1); b.Pose(1); bob *= 1.5; }
            else if (t < 27) { ax = xm - u * 0.9; bx = xm + u * 0.9; a.Pose(2); b.Pose(2); bob = 0; }
            else { ax = Lerp(xm - u * 1.5, W * 1.1, Seg(t, 27, 52)); bx = ax + u * 3.0; a.Pose(3); b.Pose(3); }
            a.Put(ax, ly - bob); b.Put(bx, ly - bob);
            bagT.X = t < 27 ? ax - u * 1.9 : bx + u * 1.9; bagG.Opacity = 1;
            var hp = Seg(t, 19.5, 26.5); hG.Opacity = t >= 19.5 && t < 26.5 ? Math.Sin(Math.PI * hp) : 0; hT.X = xm; hT.Y = ly - u * 6.5 - hp * S(0.05);
        }));
    }

    /// <summary>A neighbour carries a warm dish across the square to another door. The door opens.</summary>
    private void Dish()
    {
        var h8 = _homes[8]; var h11 = _homes[11]; double gy = Y(0.858), u = S(0.015) * 0.85, xa = h8.door, xb = h11.door - u * 2.4;
        double dw = h11.w * 0.17, dh = h11.h * 0.52;
        var dg = R(h11.door - dw / 2, h11.b - dh, dw, dh, Flame, 0, dw * 0.12);
        var n = Act(0.85, false, true, 0, 6); var c = Act(0.85, false, false, 6, 1, 0);
        var potG = Sub(0, 0, out var potT); potG.Opacity = 0;
        In(potG, () => { Glow(0, -u * 0.9, u * 3.4, White, 0.3); Oval(0, 0, u * 1.5, u * 0.9, Rgb(0xD05A44)); R(-u * 0.8, -u * 0.5, u * 1.6, u * 0.25, Rgb(0xF2DCA8), 1, u * 0.1); E(0, -u * 0.65, u * 0.3, Rgb(0x5A3A20)); });
        _stories.Add((100, 40, t =>
        {
            if (t >= 66) { c.Put(0, gy, 0); n.Put(0, gy, 0); potG.Opacity = 0; Op(dg, 0); return; }
            Op(dg, (t < 44 ? Seg(t, 28, 29.5) : 1 - Seg(t, 44, 46)) * 0.9);
            var nOp = t < 43 ? Seg(t, 29, 30) : 1 - Seg(t, 43, 44.5); n.Pose(t >= 32 ? 1 : 0); n.Put(h11.door, h11.b + S(0.003), nOp);
            double cx, cy = gy, cOp = 1;
            if (t < 26) { cx = Lerp(xa, xb, Seg(t, 2, 26)); cy = gy - (t > 2 ? Bob(t) : 0); c.Pose(0); cOp = Seg(t, 0, 1.5); }
            else if (t < 33) { cx = xb; c.Pose(0); if (t < 28) cy = gy - Math.Abs(Math.Sin(t * 8)) * S(0.003); }
            else if (t < 36) { cx = xb; c.Pose(2); }
            else if (t < 39.5) { cx = xb; c.Pose(1); cy = gy - Math.Abs(Math.Sin(t * 6)) * S(0.005); }
            else { cx = Lerp(xb, xa, Seg(t, 39.5, 62)); cy = gy - Bob(t); c.Pose(2); cOp = 1 - Seg(t, 62, 64); }
            c.Put(cx, cy, cOp);
            var hand = Ease(Seg(t, 30, 33));
            potT.X = Lerp(cx + u * 0.15, h11.door + u * 0.15, hand); potT.Y = (t < 33 ? cy : h11.b + S(0.003)) - u * 2.9; potG.Opacity = t < 33 ? cOp : nOp;
        }));
    }

    /// <summary>An elder on a bench, a flower on the empty place, birds at their feet. A child comes and sits a while.</summary>
    private void Bench()
    {
        double bx = X(0.12), by = Y(0.893), u = S(0.015) * 0.9, uc = u * 0.64, xs = bx + S(0.4), xc = bx + S(0.022); Color wood = Rgb(0x7A5030);
        var glow = Glow(bx, by - S(0.05), S(0.2), Warm, 0.6, 0);
        R(bx - S(0.05), by - u * 2.6, S(0.1), u * 0.32, wood, 1, u * 0.1); R(bx - S(0.047), by - u * 2.6, u * 0.3, u * 2.6, Rgb(0x5A3A20)); R(bx + S(0.047) - u * 0.3, by - u * 2.6, u * 0.3, u * 2.6, Rgb(0x5A3A20));
        R(bx - S(0.05), by - u * 1.08, S(0.1), u * 0.4, wood, 1, u * 0.1);
        L(xc, by - u * 1.08, xc, by - u * 1.9, Rgb(0x2E9A5A), Math.Max(1, u * 0.14)); E(xc, by - u * 2.0, u * 0.55, Rgb(0xF070A8)); E(xc, by - u * 2.0, u * 0.2, Rgb(0xF2C040));
        In(Sub(bx - S(0.022), by + u * 0.9, out _), () => Person(0.9, 4, false, true));
        var child = Act(0.9, true, false, 0, 4, 1);
        var birds = new List<TownBird>();
        for (var k = 0; k < 4; k++)
        {
            var b = k % 2 == 0 ? Bird(S(0.017), Rgb(0x8A8A9C), Rgb(0x5A5A70)) : Bird(S(0.017), Rgb(0xB89A78), Rgb(0x7A5A40));
            b.X = bx + S(0.08) + k * S(0.024); b.Y = by + S(0.004) + (k % 2) * S(0.009); birds.Add(b);
        }
        _stories.Add((64, 0, t =>
        {
            var away = t < 40 ? Ease(Seg(t, 22, 25)) : 1 - Ease(Seg(t, 56, 62));
            for (var k = 0; k < birds.Count; k++)
            {   // on the ground they hop and peck; when the child comes they take to the air
                var b = birds[k];
                if (away <= 0) { Fold(b); b.T.X = b.X; b.T.Y = b.Y - Math.Abs(Math.Sin(t * 5 + k * 1.7)) * S(0.002); b.Tilt.Angle = 28 * Math.Max(0, Math.Sin(t * 2.2 + k * 2.1)); b.G.Opacity = 1; }
                else { b.Tilt.Angle = -18; Flap(b, t * 14 + k, k); b.T.X = b.X + away * S(0.3 + 0.06 * k); b.T.Y = b.Y - away * S(0.34 + 0.04 * k); b.G.Opacity = 1 - away * away; }
            }
            if (t < 16 || t >= 60) child.Put(xs, by, 0);
            else if (t < 24) { child.Pose(0); child.Put(Lerp(xs, xc, Seg(t, 16, 24)), by - Bob(t), Seg(t, 16, 17)); }
            else if (t < 48) { child.Pose(1); child.Put(xc, by + uc * 0.9); }
            else if (t < 51) { child.Pose(2); child.Put(xc + S(0.014), by - Bob(t)); }
            else { child.Pose(0); child.Put(Lerp(xc + S(0.014), xs, Seg(t, 51, 60)), by - Bob(t), 1 - Seg(t, 59, 60)); }
            Op(glow, 0.6 * Ease(Seg(t, 24, 27)) * (1 - Seg(t, 47, 49)) * (0.8 + 0.2 * Math.Sin(t * 2)));
        }));
    }

    /// <summary>Two neighbours hang a lantern on the post: one climbs, one holds the ladder. It stays lit a while.</summary>
    private void Ladder()
    {
        double px = X(0.3), gy = Y(0.888), u = S(0.015) * 0.9, x0 = px + S(0.05), xt = px + S(0.01), yt = Y(0.665), th = Math.Max(1.5, S(0.003)); Color wood = Rgb(0x9A6A3A);
        L(x0 - S(0.008), gy, xt - S(0.008), yt, wood, th); L(x0 + S(0.008), gy, xt + S(0.008), yt, wood, th);
        for (var k = 1; k < 9; k++) { double cx = Lerp(x0, xt, k / 9.0), cy = Lerp(gy, yt, k / 9.0); L(cx - S(0.008), cy, cx + S(0.008), cy, wood, th); }
        var lg = new Canvas { Opacity = 0 }; C.Children.Add(lg);
        In(lg, () => { L(px, Y(0.63), px - S(0.014), Y(0.63), Dark, th); Hung(px - S(0.014), Y(0.63), S(0.008), S(0.024), Rgb(0xF2B030), true); });
        var helper = Act(0.9, false, false, 3, 1); _shadow = false; var climber = Act(0.9, false, false, 0, 1); _shadow = true; var hx = x0 - u * 2.3;
        _stories.Add((56, 20, t =>
        {
            var c = t < 10 ? Ease(Seg(t, 0, 10)) * 0.62 : t < 14 ? 0.62 : t < 24 ? (1 - Ease(Seg(t, 14, 24))) * 0.62 : 0;
            climber.Pose(t >= 10.5 && t < 13.5 ? 1 : 0);
            if (t < 24) climber.Put(Lerp(x0, xt, c), Lerp(gy, yt, c)); else climber.Put(x0 + u * 2.4 * Seg(t, 24, 26), gy);
            lg.Opacity = t < 50 ? Seg(t, 12.5, 14) : 1 - Seg(t, 52, 56);
            if (t >= 14 && t < 20) { helper.Pose(1); helper.Put(hx, gy - Math.Abs(Math.Sin(t * 6)) * S(0.006)); } else { helper.Pose(0); helper.Put(hx, gy); }
        }));
    }

    /// <summary>An elder reads to children who sit on the ground. What the story tells of rises over them, one picture at a time.</summary>
    private void Storyteller()
    {
        double sx = X(0.885), sy = Y(0.893), u = S(0.015) * 0.9, uc = u * 0.64; Color cream = Rgb(0xFFF6E4);
        foreach (var (dx, dy) in new[] { (-4.6, -0.3), (0.1, 0.3), (-3.0, 0.5), (-1.4, 0.8) })
            Figure(sx + dx * u, sy + dy * u + uc * 1.5, 1, S(0.0015), dx, () => Person(0.9, 7, true));
        In(Sub(sx + u * 3.0, sy + u * 0.9, out _), () =>
        {
            Person(0.9, 4, false, true);
            R(-u * 0.75, -u * 3.0, u * 1.8, u * 0.95, Rgb(0x9A2A4A), 1, u * 0.1); R(-u * 0.62, -u * 2.9, u * 1.54, u * 0.75, cream); L(u * 0.15, -u * 2.9, u * 0.15, -u * 2.15, Rgb(0x9A2A4A), 1);
        });
        E(sx + u * 1.7, sy - u * 4.6, u * 0.35, White, 0.5); E(sx + u * 0.9, sy - u * 5.6, u * 0.5, White, 0.5);
        double ix = sx - u * 1.0, iy = sy - u * 8.5;
        var icons = new List<(Canvas g, TranslateTransform t)>();
        void Icon(Action draw) { var g = Sub(ix, iy, out var t); g.Opacity = 0; In(g, draw); icons.Add((g, t)); }
        Icon(() =>
        {   // a star
            Glow(0, 0, u * 6, Rgb(0xFFE890), 0.6); var p = new double[20];
            for (var k = 0; k < 10; k++) { var a = -Math.PI / 2 + Math.PI * k / 5; var r = k % 2 == 0 ? u * 1.6 : u * 0.7; p[k * 2] = Math.Cos(a) * r; p[k * 2 + 1] = Math.Sin(a) * r; }
            G(Rgb(0xF8D040), 1, p);
        });
        Icon(() =>
        {   // a boat
            Glow(0, 0, u * 6, Rgb(0x8AD0FF), 0.5);
            G(cream, 1, -u * 1.6, u * 0.3, u * 1.6, u * 0.3, u * 1.0, u * 1.1, -u * 1.0, u * 1.1); L(0, u * 0.3, 0, -u * 1.6, cream, Math.Max(1, u * 0.15)); G(Rgb(0xF06CA0), 1, u * 0.15, -u * 1.5, u * 1.3, u * 0.1, u * 0.15, u * 0.1);
        });
        Icon(() =>
        {   // the moon
            Glow(0, 0, u * 6, White, 0.5); var r = u * 1.5; var p = new List<double>();
            for (var d = 60.0; d <= 300.01; d += 20) { p.Add(Math.Cos(d * Math.PI / 180) * r); p.Add(Math.Sin(d * Math.PI / 180) * r); }
            for (var d = 263.4; d >= 96.59; d -= 20.85) { p.Add(0.6 * r + Math.Cos(d * Math.PI / 180) * r * 0.872); p.Add(Math.Sin(d * Math.PI / 180) * r * 0.872); }
            G(Rgb(0xFFF6D8), 1, p.ToArray());
        });
        _stories.Add((24, 0, t =>
        {
            for (var i = 0; i < icons.Count; i++)
            {
                var lp = ((t / 8.0 - i) % 3 + 3) % 3; var (g, it) = icons[i];
                if (lp < 1) { g.Opacity = Math.Sin(Math.PI * lp) * 0.95; it.Y = iy - lp * S(0.03); } else g.Opacity = 0;
            }
        }));
    }

    // ------------------------------------------------------------------ the story at the front
    /// <summary>A child learns to ride. A parent runs behind with a hand on the seat, lets go, and the child rides on.</summary>
    private void StoriesFront()
    {
        Visits(); Shopping();
        double y0 = Y(0.962), u = S(0.015), xl = X(0.42); Color red = Rgb(0xE8503C);
        var bg = Sub(0, y0, out var bt); bg.Opacity = 0; var wob = new RotateTransform(); var inner = new Canvas { RenderTransform = wob }; bg.Children.Add(inner);
        In(inner, () =>
        {
            var th = Math.Max(1.5, u * 0.2);
            Ring(-u * 1.3, -u * 0.9, u * 1.8, Dark, u * 0.18); Ring(u * 1.3, -u * 0.9, u * 1.8, Dark, u * 0.18);
            L(-u * 1.3, -u * 0.9, 0, -u * 1.0, red, th); L(0, -u * 1.0, -u * 0.3, -u * 2.0, red, th); L(-u * 0.3, -u * 2.0, u * 0.9, -u * 2.2, red, th); L(u * 0.9, -u * 2.2, u * 1.3, -u * 0.9, red, th);
            L(0, -u * 1.0, u * 0.9, -u * 2.2, red, th); L(u * 0.9, -u * 2.2, u * 0.8, -u * 2.8, Dark, th); R(-u * 0.75, -u * 2.2, u * 0.85, u * 0.22, Dark, 1, u * 0.1);
            _shadow = false; Figure(-u * 0.3, -u * 1.05, 0, 0, 0, () => Person(1, 6, true)); _shadow = true;
        });
        var parent = Act(1, false, false, 3, 1, 0);
        _stories.Add((75, 30, t =>
        {
            var bx = t < 14 ? Lerp(-W * 0.08, xl, t / 14) : Lerp(xl, W * 1.1, Seg(t, 14, 30));
            if (t < 30) { bt.X = bx; bg.Opacity = 1; wob.Angle = (t < 14 ? 6 : 2.5) * Math.Sin(t * 5); } else bg.Opacity = 0;
            if (t < 14) { parent.Pose(0); parent.Put(bx - u * 2.9, y0 - Bob(t)); }
            else if (t < 15) { parent.Pose(0); parent.Put(xl - u * 2.9, y0); }
            else if (t < 23) { parent.Pose(1); parent.Put(xl - u * 2.9, y0 - Math.Abs(Math.Sin(t * 6)) * S(0.008)); }
            else if (t < 42) { parent.Pose(2); parent.Put(Lerp(xl - u * 2.9, W * 1.1, Seg(t, 23, 42)), y0 - Bob(t)); }
            else parent.Put(0, y0, 0);
        }));
    }

    // ------------------------------------------------------------------ a bird
    /// <summary>A bird that faces right: a body with a head, a beak, a pale belly and a forked tail, two wings and two legs.</summary>
    private sealed class TownBird
    {
        public Canvas G = null!, Legs = null!; public TranslateTransform T = null!; public RotateTransform Tilt = null!; public Polygon Near = null!, Far = null!;
        public double U, X, Y; public bool Folded;
    }

    private TownBird Bird(double u, Color body, Color wing)
    {
        var b = new TownBird { U = u }; b.G = Sub(0, 0, out var t); b.T = t; b.Tilt = new RotateTransform(); var inner = new Canvas { RenderTransform = b.Tilt }; b.G.Children.Add(inner);
        Color gold = Rgb(0xF2B030);
        In(inner, () =>
        {
            b.Legs = new Canvas { Opacity = 0 }; C.Children.Add(b.Legs);
            In(b.Legs, () => { L(-0.05 * u, 0.05 * u, -0.1 * u, 0.42 * u, gold, Math.Max(1, u * 0.06)); L(0.2 * u, 0.05 * u, 0.18 * u, 0.42 * u, gold, Math.Max(1, u * 0.06)); });
            b.Far = G(Mix(wing, White, 0.25), 0.9, 0, 0, 0, 0, 0, 0);
            G(body, 1, -1.1 * u, -0.1 * u, -0.45 * u, -0.1 * u, 0.25 * u, -0.15 * u, 0.62 * u, -0.2 * u, 0.8 * u, -0.14 * u, 1.06 * u, -0.04 * u, 0.78 * u, 0.0, 0.3 * u, 0.1 * u, -0.45 * u, 0.06 * u, -1.1 * u, 0.12 * u, -0.86 * u, 0.0);
            G(Mix(body, White, 0.4), 0.9, -0.4 * u, 0.04 * u, 0.2 * u, -0.02 * u, 0.7 * u, -0.02 * u, 0.3 * u, 0.09 * u);
            G(gold, 1, 1.0 * u, -0.1 * u, 1.3 * u, -0.04 * u, 1.0 * u, 0.0); E(0.82 * u, -0.11 * u, 0.1 * u, White); E(0.83 * u, -0.11 * u, 0.05 * u, Dark);
            b.Near = G(wing, 0.97, 0, 0, 0, 0, 0, 0);
        });
        return b;
    }

    /// <summary>A wing beat: up and down, the tip a little after the wrist, with a short glide now and then. Returns the beat.</summary>
    private static double Flap(TownBird bd, double ph, int i)
    {
        var u = bd.U; var glide = Math.Sin(ph * 0.11 + i * 1.7) > 0.72; double b = glide ? 0.25 : Math.Sin(ph), tip = glide ? 0.32 : Math.Sin(ph - 0.5);
        Pts(bd.Near, 0.38 * u, -0.1 * u, 0.3 * u, (-0.1 - 0.7 * b) * u, -0.3 * u, (-0.1 - 1.35 * tip) * u, -0.18 * u, (-0.08 - 0.55 * b) * u, -0.32 * u, -0.04 * u);
        Pts(bd.Far, 0.44 * u, -0.12 * u, 0.42 * u, (-0.12 - 0.6 * b) * u, -0.08 * u, (-0.12 - 1.15 * tip) * u, -0.02 * u, (-0.1 - 0.45 * b) * u, -0.2 * u, -0.08 * u);
        if (bd.Folded) { bd.Folded = false; bd.Legs.Opacity = 0; }
        return b;
    }

    /// <summary>The wings laid along the body and the legs down: a bird on the ground. Set once, not each frame.</summary>
    private static void Fold(TownBird bd)
    {
        if (bd.Folded) return; var u = bd.U; bd.Folded = true; bd.Legs.Opacity = 1;
        Pts(bd.Near, 0.35 * u, -0.14 * u, -0.3 * u, -0.2 * u, -0.8 * u, 0.0, -0.2 * u, 0.06 * u, 0.2 * u, 0.02 * u);
        Pts(bd.Far, 0.3 * u, -0.16 * u, -0.3 * u, -0.22 * u, -0.7 * u, -0.04 * u, -0.2 * u, 0.0, 0.2 * u, -0.02 * u);
    }

    private void StepStories(double dts, TableauFrame f)
    {
        _st += dts; _millA += dts * (8 + 40 * f.Mid);
        if (_mill is not null) _mill.Angle = _millA;
        if (_signR is not null) _signR.Angle = 1.2 * Math.Sin(_st * 0.9);
        for (var i = 0; i < Bands; i++) if (_aur[i] is { } a) Op(a, f.Reduced ? 0.1 : 0.05 + 0.6 * _lv[i]);
        if (_plaza is not null) Op(_plaza, 0.1 + 0.6 * _flare + 0.2 * f.Loud);
        foreach (var (t, v, ph) in _clouds) t.X = ((ph + _st * v) % 1.4 - 0.2) * W;
        for (var i = 0; i < _puffs.Count; i++)
        {
            var (g, t, x, y, ph) = _puffs[i]; var p = (_st * 0.06 + ph) % 1.0;
            t.X = x + S(0.1) * p * p + S(0.007) * Math.Sin(p * 10 + ph * 40) * (0.3 + p); t.Y = y - S(0.2) * Math.Pow(p, 0.8);
            g.Opacity = Math.Min(1, p * 14) * Math.Pow(1 - p, 1.2) * 0.9;
            var sc = (float)(0.32 + 2.0 * p); _puffV[i].Scale = new System.Numerics.Vector3(sc, sc, 1);   // the size goes on the compositor's visual
        }
        foreach (var (period, offset, step) in _stories) step((_st + offset) % period);
    }
}
