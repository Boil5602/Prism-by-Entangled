using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== COMMUNITY: Night Train (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A night train on a viaduct across a lake (redrawn 2026-11-10, asked for the same idea on a new stage). Since 2026-11-11 the
/// train leaves the viaduct for about two minutes at a time: the land comes in, a wood and then a town go by behind the train and a
/// meadow in front of it, and the lake comes back.
///
/// The eye rides beside the train, so the train holds its place and the land goes by: two ranges of mountains, a wooded shore with
/// its villages, the arches and the poles of the viaduct, the reeds at the near bank, each at its own depth and all at the music's
/// speed. The train is the meter: twenty-four windows, a band a window, low notes at the engine and high at the tail, and each lays
/// a streak of its light on the water whose length is its level. The engine puffs as it goes and gives a big puff on a beat, the
/// firebox flares with it, and the high notes throw sparks from the stack.
///
/// Every shape is made once in OnBuild. A depth is one group moved by one transform, so a frame allocates nothing.
/// </summary>
public sealed class NightTrain : Tableau
{
    private sealed class Scroll { public TranslateTransform T = null!; public double Tile, Rate, Off; }
    private const int Wins = 24, Puffs = 40, Sparks = 14, Glints = 36, Cars = 3;
    private readonly List<Scroll> _layers = new();
    private readonly List<(Rectangle r, double op, double ph)> _glit = new();
    private readonly List<(Ellipse c, double x, double y, double w)> _clouds = new();
    private readonly Rectangle[] _lit = new Rectangle[Wins], _refl = new Rectangle[Wins];
    private readonly Ellipse[] _halo = new Ellipse[Wins], _under = new Ellipse[Cars];
    private readonly double[] _lv = new double[Wins], _carLv = new double[Cars];
    private readonly Ellipse[] _puff = new Ellipse[Puffs], _spark = new Ellipse[Sparks];
    private readonly double[] _pAge = new double[Puffs], _pX = new double[Puffs], _pSeed = new double[Puffs];
    private readonly bool[] _pLive = new bool[Puffs], _pBig = new bool[Puffs];
    private readonly double[] _sAge = new double[Sparks], _sX = new double[Sparks], _sVx = new double[Sparks], _sVy = new double[Sparks];
    private readonly Rectangle[] _glint = new Rectangle[Glints];
    private readonly double[] _gX = new double[Glints], _gRate = new double[Glints], _gPh = new double[Glints];
    private readonly RotateTransform[] _drive = new RotateTransform[3];
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private TranslateTransform _trainT = null!;
    private Line _rodC = null!, _rodM = null!, _rodP = null!;
    private Polygon _cone = null!;
    private Rectangle _railLit = null!, _horizon = null!, _cabFire = null!;
    private Ellipse _lampFlare = null!, _fireGlow = null!, _stackGlow = null!, _trainRefl = null!;
    private double _u, _ry, _wy, _x0, _spd = 0.25, _dist, _wa, _flare, _prevBeat, _sinceBeat = 9, _idle, _tw, _cloud, _puffGap, _sparkDue;

    // ---- the land (2026-11-11, asked for the train to leave the bridge for a couple of minutes at a time, and for a scene that changes
    // behind it): two panels as wide as the stage, one behind the train and one in front of it, that come in from the left at the ground's
    // own speed, stay while a wood and a town go by inside them, and leave to the right. Inside a panel a depth slides as the others do.
    private sealed class Panel { public TranslateTransform T = null!; public readonly List<Scroll> Layers = new(); }
    private readonly Panel _back = new(), _front = new();
    private readonly List<(Ellipse e, double op, double ph)> _townLights = new();
    private sealed class Item { public Canvas G = null!; public TranslateTransform T = null!; public double X, Wd; public bool On; }
    private readonly List<Item> _items = new();
    private double _itemTile = 1, _itemOff;
    private Canvas _backG = null!, _frontG = null!;
    private double _panelW, _panelEdge, _panelX, _phaseT;
    private int _phase;   // 0 on the bridge, 1 the land comes in, 2 on the land, 3 the land leaves
    private const double BridgeFor = 80, LandFor = 135;
    /// <summary>Dev: seconds into the bridge-and-land round a new scene starts at (a clip of the land without the wait).</summary>
    public static double DevStart;

    private Canvas PanelGroup(Panel p)
    {
        var g = new Canvas(); C.Children.Add(g); p.T = new TranslateTransform(); g.RenderTransform = p.T; p.Layers.Clear(); return g;
    }
    private Scroll PanelLayer(Panel p, Canvas inner, double tile, double rate)
    {
        var g = new Canvas(); inner.Children.Add(g);
        var s = new Scroll { T = new TranslateTransform(), Tile = tile, Rate = rate, Off = tile * 0.21 };
        g.RenderTransform = s.T; p.Layers.Add(s); C = g; return s;
    }
    /// <summary>Draw at x, and again a tile on while that copy still shows inside a panel.</summary>
    private void Twice(Scroll s, double x, Action<double> draw) { for (var xx = x; xx < s.Tile + _panelW + S(0.2); xx += s.Tile) draw(xx); }

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Cream = Rgb(0xFFE6B0), Dark = Rgb(0x060A12), Pale = Rgb(0x8C9CB4), Fire = Rgb(0xFF8C38), Steel = Rgb(0x58667A);
    private static double Tri(double p) { p -= Math.Floor(p); return 1 - 2 * Math.Abs(p - 0.5); }

    /// <summary>A depth of the land: a group that slides right and repeats every tile. What is drawn into it must repeat too.</summary>
    private Scroll Layer(double tile, double rate)
    {
        var g = new Canvas(); C.Children.Add(g);
        var s = new Scroll { T = new TranslateTransform(), Tile = tile, Rate = rate, Off = tile * 0.37 };
        g.RenderTransform = s.T; _layers.Add(s); C = g; return s;
    }
    private void Rep(Scroll s, double x, Action<double> draw) { for (var xx = x; xx < s.Tile + W + S(0.15); xx += s.Tile) draw(xx); }

    /// <summary>A range of mountains that repeats every tile: three triangle waves of whole counts, and a moonlit line along the top.</summary>
    private void Range(double tile, double baseY, double lift, double height, int f1, int f2, int f3, double ph, Color top, Color bottom, Color rim)
    {
        var step = W / 110.0; var n = (int)((tile + W) / step) + 2; var xy = new double[(n + 3) * 2];
        for (var j = 0; j <= n; j++)
        {
            var x = j * step; var t = x / tile;
            xy[j * 2] = x; xy[j * 2 + 1] = baseY - lift - height * (0.5 * Tri(f1 * t + ph) + 0.3 * Tri(f2 * t + ph * 2.3) + 0.2 * Tri(f3 * t + ph * 3.7));
        }
        xy[(n + 1) * 2] = n * step; xy[(n + 1) * 2 + 1] = baseY + 2; xy[(n + 2) * 2] = 0; xy[(n + 2) * 2 + 1] = baseY + 2;
        GB(Vertical((top, 0), (bottom, 1)), 1, xy);
        var line = PL(B(rim), Math.Max(1, S(0.002)), 0.3);
        for (var j = 0; j <= n; j++) line.Points.Add(new Pt(xy[j * 2], xy[j * 2 + 1]));
    }

    protected override void OnBuild()
    {
        _layers.Clear(); _glit.Clear(); _clouds.Clear();
        _phase = 0; _phaseT = DevStart; if (DevStart >= BridgeFor) { _phase = 2; _phaseT = DevStart - BridgeFor; }
        var rng = new Random(173);
        var u = _u = Math.Min(W / 150.0, H / 62.0);
        var ry = _ry = Y(0.66); var wy = _wy = ry + 11.5 * u; var x0 = _x0 = Math.Max(W * 0.2, W - 116 * u); var hy = ry - 4 * u;

        Rectangle Box(double xa, double xb, double top, double bot, Brush b, double rad = 0, double op = 1)
        {
            var r = RB(xa * u, -top * u, (xb - xa) * u, (top - bot) * u, b, op); if (rad > 0) r.RadiusX = r.RadiusY = rad * u; return r;
        }
        Polygon Sh(Brush b, params double[] p) { for (var q = 0; q + 1 < p.Length; q += 2) { p[q] *= u; p[q + 1] *= -u; } return GB(b, 1, p); }
        Ellipse Ring(double cx, double cy, double d, Color col, double th, double op)
        {
            var e = new Ellipse { Width = d, Height = d, Stroke = B(col), StrokeThickness = th, Opacity = op }; At(e, cx - d / 2, cy - d / 2); C.Children.Add(e); return e;
        }
        void Disc(double cx, double r)
        {
            E(cx * u, -r * u, 2 * r * u, Rgb(0x0A0E14)); Ring(cx * u, -r * u, 2 * r * u, Steel, 0.22 * u, 0.8); E(cx * u, -r * u, 0.7 * r * u, Steel, 0.7);
        }
        RotateTransform Drive(double cx)
        {
            var g = new Canvas(); C.Children.Add(g); At(g, cx * u, -2.15 * u); var rt = new RotateTransform(); g.RenderTransform = rt; var keep = C; C = g;
            E(0, 0, 4.3 * u, Rgb(0x0A0E14)); Ring(0, 0, 4.3 * u, Steel, 0.3 * u, 0.9);
            L(-1.9 * u, 0, 1.9 * u, 0, Rgb(0x34404F), 0.3 * u); L(0, -1.9 * u, 0, 1.9 * u, Rgb(0x34404F), 0.3 * u);
            G(Rgb(0x3E4A5C), 1, -1.9 * u, -0.7 * u, -1.25 * u, -1.15 * u, -1.25 * u, 1.15 * u, -1.9 * u, 0.7 * u);
            E(0, 0, 1.0 * u, Steel); E(1.0 * u, 0, 0.6 * u, Pale);
            C = keep; return rt;
        }

        // ---- the sky: stars, a full moon over the engine, slow cloud
        RB(0, 0, W, hy + 2, Vertical((Rgb(0x03060F), 0), (Rgb(0x081428), 0.5), (Rgb(0x16304A), 0.92), (Rgb(0x244860), 1)));
        _stars = Stars(110, 0.5, White, 37);
        double mx = X(0.16), my = Y(0.17), mr = S(0.046);
        {
            Glow(mx, my, mr * 9, Rgb(0xB8D0F0), 0.2); Glow(mx, my, mr * 3.4, White, 0.35); E(mx, my, mr * 2, Rgb(0xF2F0E2));
            E(mx - mr * 0.35, my - mr * 0.2, mr * 0.5, Rgb(0xD2D2C6), 0.6); E(mx + mr * 0.3, my + mr * 0.35, mr * 0.36, Rgb(0xD2D2C6), 0.5); E(mx + mr * 0.22, my - mr * 0.48, mr * 0.24, Rgb(0xD2D2C6), 0.5);
        }
        for (var i = 0; i < 5; i++)
        {
            var w = S(0.3 + 0.35 * rng.NextDouble());
            var cl = Glow(0, 0, w, Rgb(0x506E90), 0.4, 0.2); cl.Height = w * 0.15;
            _clouds.Add((cl, rng.NextDouble(), 0.08 + 0.26 * rng.NextDouble(), w));
        }

        // ---- the land behind, three depths: far mountains, near mountains, the wooded shore with its villages
        var root = C;
        Layer(W * 1.6, 0.03); Range(W * 1.6, hy, S(0.05), S(0.3), 2, 5, 11, 0.13, Rgb(0x1E3250), Rgb(0x10203A), Rgb(0xA8C0E0)); C = root;
        Layer(W * 1.3, 0.07); Range(W * 1.3, hy, S(0.015), S(0.17), 3, 7, 13, 0.51, Rgb(0x122036), Rgb(0x0A1424), Rgb(0x7088A8)); C = root;
        _horizon = RB(0, hy - S(0.22), W, S(0.22), Vertical((A(P(2), 0), 0), (A(P(2), 0.22), 1)));
        RB(0, hy, W, H - hy + 2, Vertical((Rgb(0x1A3448), 0), (Rgb(0x0E2034), 0.3), (Rgb(0x060E1A), 1)));
        {
            var s = Layer(W * 1.2, 0.16); const int n = 64; var hg = new double[n];
            for (var i = 0; i < n; i++) hg[i] = u * (1.3 + 3.6 * rng.NextDouble() * rng.NextDouble());
            var pitch = s.Tile / n; var count = (int)((s.Tile + W) / pitch) + 2; var xy = new double[(count * 2 + 2) * 2];
            for (var j = 0; j < count; j++)
            {
                var x = j * pitch; var hill = u * 1.1 * (1 + Math.Sin(2 * Math.PI * 2 * x / s.Tile)); var h = hg[j % n];
                xy[j * 4] = x - pitch / 2; xy[j * 4 + 1] = hy - hill - h * 0.25; xy[j * 4 + 2] = x; xy[j * 4 + 3] = hy - hill - h;
            }
            xy[count * 4] = count * pitch; xy[count * 4 + 1] = hy + 1; xy[count * 4 + 2] = -pitch; xy[count * 4 + 3] = hy + 1;
            G(Rgb(0x071018), 1, xy);
            foreach (var vx in new[] { 0.22, 0.71 })
            {
                var spire = 0.03 + 0.02 * rng.NextDouble(); var lights = new double[22];
                for (var i = 0; i < lights.Length; i++) lights[i] = rng.NextDouble();
                Rep(s, s.Tile * vx, xx =>
                {
                    G(Rgb(0x0A141E), 1, xx - u * 0.5, hy, xx - u * 0.5, hy - u * 3.2, xx, hy - u * 5.2, xx + u * 0.5, hy - u * 3.2, xx + u * 0.5, hy);
                    for (var i = 0; i + 1 < lights.Length; i += 2)
                        E(xx + (lights[i] - 0.5) * W * (0.09 + spire), hy - u * (0.3 + 1.6 * lights[i + 1]), u * 0.55, Mix(Cream, P(1), 0.3), 0.55 + 0.4 * lights[i + 1]);
                });
            }
            C = root;
        }

        // ---- the land behind the train: a wood, then a town, then the wood again (hidden while the train is on the bridge)
        _panelW = W + S(0.1); _panelEdge = S(0.5); _townLights.Clear();
        {
            var g = _backG = PanelGroup(_back); var keep = C; C = g;
            RB(0, hy - 0.6 * u, _panelW, ry - hy + 0.8 * u, Vertical((Rgb(0x0C1A16), 0), (Rgb(0x060E0C), 1)));
            GB(B(Rgb(0x0A1612)), 1, _panelW, hy - 0.6 * u, _panelW + _panelEdge * 0.5, ry + 0.2 * u, _panelW, ry + 0.2 * u);
            GB(B(Rgb(0x0A1612)), 1, 0, hy - 0.6 * u, -_panelEdge * 0.5, ry + 0.2 * u, 0, ry + 0.2 * u);
            var inner = new Canvas { Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, -H, _panelW, H * 3) } }; g.Children.Add(inner);
            // far: rounded hills of trees. They stand still in the panel: that far off, the land hardly moves
            {
                var step = W / 60.0; var n = (int)(_panelW / step) + 1; var xy = new double[(n + 3) * 2];
                for (var j = 0; j <= n; j++) { var x = Math.Min(_panelW, j * step); var t = x / _panelW; xy[j * 2] = x; xy[j * 2 + 1] = ry - u * (9 + 5 * Tri(2 * t + 0.2) + 3 * Tri(7 * t + 0.6) + 1.2 * Tri(23 * t)) * Math.Min(1, Math.Min(t, 1 - t) * 9); }
                xy[(n + 1) * 2] = _panelW; xy[(n + 1) * 2 + 1] = ry + 1; xy[(n + 2) * 2] = 0; xy[(n + 2) * 2 + 1] = ry + 1;
                C = inner; GB(Vertical((Rgb(0x14283A), 0), (Rgb(0x0A1620), 1)), 1, xy);
            }
            // near: a wood for most of the round, and a town in the rest of it. Each tree and house is its own small group, placed each
            // frame and hidden while it is outside the panel, so nothing wide is drawn that is not seen
            {
                _items.Clear(); _itemTile = W * 9; _itemOff = _itemTile * 0.3; var pr = new Random(91);
                Canvas Item(double x, double wd) { var ic = new Canvas { Visibility = Visibility.Collapsed }; inner.Children.Add(ic); var tt = new TranslateTransform(); ic.RenderTransform = tt; _items.Add(new Item { G = ic, T = tt, X = x, Wd = wd }); C = ic; return ic; }
                double woodTo = _itemTile * 0.6, townFrom = _itemTile * 0.64, townTo = _itemTile * 0.96;
                for (var x = 0.0; x < woodTo;)
                {
                    var hgt = u * (11 + 15 * pr.NextDouble()); var wd = hgt * (0.2 + 0.08 * pr.NextDouble()); var shade = Mix(Rgb(0x06120E), Rgb(0x10241C), pr.NextDouble());
                    Item(x, wd * 2); Pine(wd, ry - hgt, wd, hgt + u, shade);
                    x += wd * (0.9 + 1.5 * pr.NextDouble());
                }
                for (var x = townFrom; x < townTo;)
                {
                    var wd = u * (7 + 6 * pr.NextDouble()); var hgt = u * (7 + 7 * pr.NextDouble()); var wall = Mix(Rgb(0x141C28), P(pr.Next(4)), 0.1); var roofH = u * (2 + 3 * pr.NextDouble());
                    var church = pr.NextDouble() < 0.14; var rows = Math.Max(1, (int)(hgt / (3.1 * u))); var cols = Math.Max(2, (int)(wd / (2.6 * u)));
                    var warm = Mix(Cream, P(1), 0.25); var lamp = pr.NextDouble() < 0.6; var xx = 0.5 * u;
                    Item(x, wd + 5 * u);
                    RB(xx, ry - hgt, wd, hgt + u, Vertical((wall, 0), (Mix(wall, Dark, 0.5), 1)));
                    G(Rgb(0x0A1018), 1, xx - 0.4 * u, ry - hgt, xx + wd / 2, ry - hgt - roofH, xx + wd + 0.4 * u, ry - hgt);
                    if (church) { RB(xx + wd * 0.38, ry - hgt - 9 * u, wd * 0.24, 9 * u, B(Mix(wall, Dark, 0.3))); G(Rgb(0x0A1018), 1, xx + wd * 0.34, ry - hgt - 9 * u, xx + wd / 2, ry - hgt - 16 * u, xx + wd * 0.66, ry - hgt - 9 * u); _townLights.Add((Glow(xx + wd / 2, ry - hgt - 6.5 * u, 3.2 * u, warm, 0.9, 0.8), 0.8, pr.NextDouble() * 6)); }
                    for (var r = 0; r < rows; r++)
                        for (var c = 0; c < cols; c++)
                        {
                            var v = pr.NextDouble(); if (v < 0.42) continue;
                            RB(xx + wd * (c + 0.5) / cols - 0.55 * u, ry - hgt + 1.3 * u + r * 3.1 * u, 1.1 * u, 1.5 * u, B(warm), 0.45 + 0.5 * v);
                        }
                    if (lamp) { var lx = xx + wd + 1.4 * u; L(lx, ry, lx, ry - 6.5 * u, Rgb(0x0A0E16), 0.3 * u); _townLights.Add((Glow(lx, ry - 6.6 * u, 5 * u, warm, 0.9, 0.7), 0.7, pr.NextDouble() * 6)); E(lx, ry - 6.6 * u, 0.8 * u, Cream); }
                    x += wd + u * (2.5 + 5 * pr.NextDouble());
                }
            }
            C = keep;
        }

        // ---- the viaduct: poles and wires over it, arches under it, at the train's own speed
        {
            var s = Layer(40 * u, 1.0); var wire = B(Rgb(0x2C3A4C)); var stone = Vertical((Rgb(0x2C3646), 0), (Rgb(0x141C28), 1));
            for (var xx = 0.0; xx < s.Tile + W + 40 * u; xx += 20 * u)
            {
                double top = ry + 2.3 * u, spring = ry + 8.8 * u; var xy = new double[(7 + 15) * 2]; var k = 0;
                void Add(double px, double py) { xy[k++] = px; xy[k++] = py; }
                Add(xx, top); Add(xx + 20 * u, top); Add(xx + 20 * u, wy); Add(xx + 18 * u, wy);
                var arc = PL(B(Pale), Math.Max(1, 0.16 * u), 0.3);
                for (var a = 0; a <= 14; a++)
                {
                    var an = Math.PI * a / 14; double px = xx + 10 * u + 8 * u * Math.Cos(an), py = spring - 5.6 * u * Math.Sin(an);
                    Add(px, py); arc.Points.Add(new Pt(px, py));
                }
                Add(xx + 2 * u, wy); Add(xx, wy); Add(xx, top);
                C.Children.Remove(arc); GB(stone, 1, xy); C.Children.Add(arc);
            }
            for (var xx = 0.0; xx < s.Tile + W + 40 * u; xx += 40 * u)
            {
                L(xx, ry, xx, ry - 17 * u, Rgb(0x0A0E16), 0.5 * u); L(xx - 1.9 * u, ry - 15.8 * u, xx + 1.9 * u, ry - 15.8 * u, Rgb(0x0A0E16), 0.35 * u); L(xx - 1.3 * u, ry - 14.6 * u, xx + 1.3 * u, ry - 14.6 * u, Rgb(0x0A0E16), 0.35 * u);
                foreach (var wh in new[] { 15.8, 14.6 })
                {
                    var line = PL(wire, Math.Max(1, 0.13 * u), 0.9);
                    for (var j = 0; j <= 10; j++) { var t = j / 10.0; line.Points.Add(new Pt(xx + 40 * u * t, ry - wh * u + 1.7 * u * 4 * t * (1 - t))); }
                }
            }
            C = root;
        }
        RB(0, ry, W, 2.4 * u, Vertical((Rgb(0x38445A), 0), (Rgb(0x283244), 1))); RB(0, ry + 2.1 * u, W, 0.35 * u, B(Rgb(0x161E2A)));
        L(0, ry, W, ry, Pale, Math.Max(1, 0.18 * u), 0.55);

        // ---- the smoke and the sparks, behind the train
        for (var i = 0; i < Puffs; i++) { _puff[i] = Glow(0, 0, u * 3, Rgb(0x94A6C0), 0.85, 0); _pLive[i] = false; _pSeed[i] = rng.NextDouble(); }
        _stackGlow = Glow(x0 + 5.1 * u, ry - 13.6 * u, u * 9, Fire, 0.7, 0);
        for (var i = 0; i < Sparks; i++) { _spark[i] = E(0, 0, Math.Max(1.5, u * 0.35), Mix(Fire, Cream, 0.5), 0); _sAge[i] = 9; }

        // ---- the headlamp's beam ahead of the engine
        LinearGradientBrush Ahead(double a0, double a1)
        {
            var g = new LinearGradientBrush { StartPoint = new Pt(1, 0.5), EndPoint = new Pt(0, 0.5) }; var ray = Mix(Cream, White, 0.5);
            g.GradientStops.Add(new GradientStop { Color = A(ray, a0), Offset = 0 }); g.GradientStops.Add(new GradientStop { Color = A(ray, a1), Offset = 0.5 }); g.GradientStops.Add(new GradientStop { Color = A(ray, 0), Offset = 1 });
            return g;
        }
        double lampX = x0 + 2.5 * u, lampY = ry - 10.55 * u;
        _cone = GB(Ahead(0.7, 0.22), 0.5, lampX, lampY, -S(0.05), lampY - 5 * u, -S(0.05), ry + 0.4 * u);
        _railLit = RB(-2, ry - 0.2 * u, lampX + 2, Math.Max(1.5, 0.4 * u), Ahead(0.9, 0.35), 0.6);

        // ---- the train: one group, the rail is its zero line
        var winX = new double[Wins]; var winC = new Color[Wins];
        var train = new Canvas(); C.Children.Add(train); _trainT = new TranslateTransform { X = x0, Y = ry }; train.RenderTransform = _trainT; C = train;
        {
            var black = B(Rgb(0x0A0E16)); var side = Vertical((Rgb(0x263244), 0), (Rgb(0x0E141E), 1)); var brass = B(A(P(1), 0.55));
            // the engine
            Box(2.6, 22, 4.3, 1.6, B(Rgb(0x070A10)));
            Disc(4.3, 1.05); Disc(6.9, 1.05);
            _fireGlow = Glow(18.6 * u, -2.4 * u, 10 * u, Fire, 0.8, 0.3);
            _drive[0] = Drive(10.6); _drive[1] = Drive(15.2); _drive[2] = Drive(19.8);
            Box(3.6, 7.6, 4.2, 1.9, B(Rgb(0x161E2A)), 0.4);
            _rodP = L(7.6 * u, -3.05 * u, 9 * u, -3.05 * u, Steel, 0.3 * u);
            _rodM = L(0, 0, 1, 0, Rgb(0x7A88A0), 0.42 * u); _rodC = L(0, 0, 1, 0, Rgb(0x8C9CB4), 0.45 * u);
            Sh(black, 0, 0.2, 2.8, 0.2, 2.8, 4.3, 2.0, 4.3);
            Box(1.6, 22.2, 4.8, 4.3, B(Rgb(0x1A2230))); L(1.6 * u, -4.8 * u, 15 * u, -4.8 * u, Pale, Math.Max(1, 0.12 * u), 0.35);
            Box(2.6, 15.4, 9.7, 4.8, Vertical((Rgb(0x4A586E), 0), (Rgb(0x1A2230), 0.35), (Rgb(0x0A0E16), 1)), 1.3);
            Box(2.2, 4.6, 9.9, 4.8, black, 0.9);
            foreach (var bx in new[] { 6.6, 9.6, 12.6 }) Box(bx, bx + 0.25, 9.7, 4.8, brass);
            Sh(black, 4.4, 9.6, 4.6, 11.7, 4.1, 12.6, 6.1, 12.6, 5.6, 11.7, 5.8, 9.6);
            Box(8.4, 10.4, 10.9, 9.4, B(Mix(Rgb(0x0A0E16), P(1), 0.3)), 0.9); Box(11.8, 13.3, 10.5, 9.4, black, 0.7);
            Box(2.5, 3.9, 11.3, 9.8, black, 0.2);
            Box(15.2, 21.8, 11.6, 4.3, side); Box(14.5, 22.5, 12.2, 11.5, black, 0.3);
            Box(16.4, 19.4, 10.4, 7.6, B(Rgb(0x3A1C08))); _cabFire = Box(16.4, 19.4, 10.4, 7.6, Vertical((Mix(Fire, Cream, 0.5), 0), (Fire, 1)), 0, 0.6);
            E(18.1 * u, -8.5 * u, 1.3 * u, Dark, 0.85); Box(17.2, 19.0, 8.0, 7.6, B(Dark), 0.3, 0.85);
            Glow(2.5 * u, -10.55 * u, 5 * u, Mix(Cream, White, 0.5), 0.9, 0.8); E(2.5 * u, -10.55 * u, 1.0 * u, White);
            _lampFlare = Glow(2.5 * u, -10.55 * u, 8 * u, White, 1, 0);
            // the tender
            Box(22, 23.4, 2.7, 2.2, black); Box(23.2, 32, 2.6, 1.7, black); Disc(25, 1.2); Disc(27.6, 1.2); Disc(30.2, 1.2);
            Sh(B(Rgb(0x04060A)), 24, 8.5, 25.5, 9.5, 27.5, 9.9, 29.5, 9.4, 31.2, 8.5);
            Box(23.4, 31.8, 8.6, 2.6, side, 0.3); Box(23.4, 31.8, 7.7, 7.45, brass);
            // the carriages: eight windows each, a band a window
            var body = Vertical((Mix(Rgb(0x2A3448), P(2), 0.14), 0), (Mix(Rgb(0x121824), P(2), 0.08), 1));
            for (var car = 0; car < Cars; car++)
            {
                var cx = 33 + car * 29.0;
                Box(cx - 1, cx + 0.2, 8.8, 2.4, black); Box(cx + 0.6, cx + 27.4, 2.4, 1.5, black); Box(cx + 10, cx + 18, 1.6, 0.7, black);
                Box(cx + 1.8, cx + 7.6, 1.7, 1.0, black); Box(cx + 20.4, cx + 26.2, 1.7, 1.0, black);
                Disc(cx + 3.2, 1.15); Disc(cx + 6.2, 1.15); Disc(cx + 21.8, 1.15); Disc(cx + 24.8, 1.15);
                Box(cx, cx + 28, 9.6, 2.3, body, 0.5);
                Sh(black, cx - 0.2, 9.5, cx + 0.6, 10.5, cx + 3, 10.9, cx + 25, 10.9, cx + 27.4, 10.5, cx + 28.2, 9.5);
                L((cx + 3) * u, -10.9 * u, (cx + 25) * u, -10.9 * u, Pale, Math.Max(1, 0.12 * u), 0.4);
                Box(cx, cx + 28, 4.6, 4.3, brass); Box(cx, cx + 28, 9.0, 8.88, B(A(P(1), 0.3)));
                for (var k = 0; k < 8; k++)
                {
                    var i = car * 8 + k; var bd = i / 23.0; var col = Mix(Cream, P((int)(bd * 3.99)), 0.7); var wx = cx + 2.5 + 3 * k;
                    Box(wx, wx + 2, 8.2, 5.4, B(Rgb(0x2A1E10)), 0.25);
                    _lit[i] = Box(wx, wx + 2, 8.2, 5.4, Vertical((Mix(col, White, 0.4), 0), (col, 1)), 0.25, 0.4);
                    if (rng.NextDouble() < 0.45) { var hx = wx + 0.6 + 0.8 * rng.NextDouble(); E(hx * u, -6.3 * u, 1.05 * u, Dark, 0.8); Box(hx - 0.75, hx + 0.75, 5.85, 5.4, B(Dark), 0.25, 0.8); }
                    _halo[i] = Glow((wx + 1) * u, -6.8 * u, 6.5 * u, col, 0.5, 0.3);
                    winX[i] = x0 + (wx + 1) * u; winC[i] = col; _lv[i] = 0.3;
                }
                var ug = Glow(0, 0, 10, Mix(Cream, P(1), 0.5), 0.5, 0.3); Size(ug, (cx + 14) * u, 0.6 * u, 30 * u, 3.2 * u); _under[car] = ug;
            }
            Glow(120.6 * u, -3.4 * u, 5 * u, Rgb(0xFF4038), 0.9, 0.8); E(120.4 * u, -3.4 * u, 0.7 * u, Rgb(0xFF8070));
        }
        C = root;

        // ---- the water in front: the viaduct's shadow, the moon's path, a streak of light under every window
        RB(0, wy, W, 6 * u, Vertical((A(Dark, 0.6), 0), (A(Dark, 0), 1)));
        for (var i = 0; i < 12; i++)
        {
            var t = rng.NextDouble(); var w = S(0.012 + 0.05 * t * rng.NextDouble() + 0.01);
            _glit.Add((RB(mx - w / 2 + S(0.012) * (rng.NextDouble() - 0.5), wy + (H - wy) * (0.06 + 0.9 * t), w, Math.Max(1.5, S(0.003)), B(Rgb(0xD8E4F4)), 0.5), 0.3 + 0.4 * rng.NextDouble(), rng.NextDouble() * 6));
        }
        // ---- the land in front of the train: the bank the line runs on, a fence at its foot, a meadow down to the near edge
        {
            var g = _frontG = PanelGroup(_front); var keep = C; C = g; var top = ry + 2.4 * u; var grass = Vertical((Rgb(0x1A2C22), 0), (Rgb(0x0C1A14), 0.35), (Rgb(0x040A08), 1));
            RB(0, top, _panelW, H - top + 2, grass);
            GB(grass, 1, _panelW - 1, top, _panelW + _panelEdge * 0.25, top, _panelW + _panelEdge, H + 2, _panelW - 1, H + 2);
            GB(grass, 1, 1, top, -_panelEdge * 0.25, top, -_panelEdge, H + 2, 1, H + 2);
            var inner = new Canvas { Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, -H, _panelW, H * 3) } }; g.Children.Add(inner);
            {
                // the ballast under the rail and the fence along the foot of the bank, at the train's own speed
                var sl = PanelLayer(_front, inner, 48 * u, 1.0); var post = Rgb(0x05080A); var fy = top + 7.5 * u;
                for (var xx = 0.0; xx < sl.Tile + _panelW + 12 * u; xx += 6 * u)
                {
                    L(xx, fy, xx, fy - 3 * u, post, 0.45 * u); L(xx, fy - 2.4 * u, xx + 6 * u, fy - 2.4 * u, post, 0.22 * u); L(xx, fy - 1.3 * u, xx + 6 * u, fy - 1.3 * u, post, 0.22 * u);
                }
                var pr = new Random(57);
                for (var k = 0; k < 7; k++) { var bx = sl.Tile * (k + pr.NextDouble()) / 7; var bw = u * (4 + 5 * pr.NextDouble()); var by = fy + u * (0.5 + 2 * pr.NextDouble()); Twice(sl, bx, xx => { var e = E(xx, by, bw, Rgb(0x061008)); e.Height = bw * 0.55; }); }
            }
            {
                // the meadow nearer the eye, a little faster: tufts, and flowers in the palette that the moon picks out
                var sl = PanelLayer(_front, inner, W * 0.5, 1.25); var pr = new Random(63);
                for (var k = 0; k < 22; k++)
                {
                    var fx = sl.Tile * pr.NextDouble(); var fyy = wy + (H - wy) * (0.15 + 0.8 * pr.NextDouble()); var col = Mix(P(pr.Next(4)), Cream, 0.3); var d = u * (0.5 + 0.5 * pr.NextDouble());
                    Twice(sl, fx, xx => { L(xx, fyy + 1.6 * u, xx, fyy, Rgb(0x0A1A10), 0.18 * u); E(xx, fyy, d, col, 0.55); });
                }
            }
            C = keep;
        }
        { var tr = Glow(0, 0, 10, Mix(Cream, P(1), 0.4), 0.35, 0.4); Size(tr, x0 + 76 * u, wy + 2.5 * u, 96 * u, 9 * u); _trainRefl = tr; }
        for (var i = 0; i < Wins; i++) _refl[i] = RB(winX[i] - 1.0 * u, wy + 0.3 * u, 2.0 * u, 6 * u, Vertical((A(winC[i], 0.8), 0), (A(winC[i], 0.3), 0.5), (A(winC[i], 0), 1)), 0.5);
        for (var i = 0; i < Glints; i++)
        {
            var t = rng.NextDouble(); var w = S(0.012 + 0.04 * rng.NextDouble()) * (0.6 + 0.8 * t);
            _glint[i] = RB(0, wy + (H - wy) * (0.05 + 0.93 * t), w, Math.Max(1, S(0.0022)), B(Mix(Rgb(0x9CC0D8), P(2), 0.3)), 0.3);
            _gX[i] = rng.NextDouble() * W; _gRate[i] = 0.9 + 0.9 * t; _gPh[i] = rng.NextDouble() * 6;
        }

        // ---- the near bank: reeds and posts that go by fastest
        {
            var s = Layer(W * 1.4, 1.5); var ink = Rgb(0x03060A);
            for (var cIdx = 0; cIdx < 6; cIdx++)
            {
                var bx = s.Tile * (cIdx + 0.2 + 0.6 * rng.NextDouble()) / 6; var blades = new double[8 * 3];
                for (var i = 0; i < blades.Length; i++) blades[i] = rng.NextDouble();
                Rep(s, bx, xx =>
                {
                    for (var i = 0; i + 2 < blades.Length; i += 3)
                    {
                        double fx = xx + (blades[i] - 0.5) * S(0.09), hgt = S(0.045 + 0.085 * blades[i + 1]), lean = (blades[i + 2] - 0.5) * S(0.05);
                        L(fx, H + 2, fx + lean, H - hgt, ink, Math.Max(1.5, S(0.004)));
                        if (blades[i + 2] > 0.45) L(fx + lean * 0.86, H - hgt * 0.86, fx + lean, H - hgt, ink, Math.Max(3, S(0.01)));
                    }
                });
            }
            Rep(s, s.Tile * 0.55, xx => RB(xx, H - S(0.1), S(0.02), S(0.11), B(ink)));
            C = root;
        }
        Vignette(0.3);
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed; var u = _u;
        Twinkle(_stars, f, 0.35);

        // ---- the beat: a big puff, the firebox, the lamp
        _sinceBeat += dt; var hit = false;
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.2 && !f.Reduced) { _sinceBeat = 0; hit = true; }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 4.2);
        _idle += dts * 0.9; _tw += dts;

        // ---- the speed follows the loudness; every depth slides by its own share of it
        _spd += ((f.Reduced ? 0.25 : f.Loud) - _spd) * 0.04;
        var dx = u * (16 + 80 * _spd) * f.Speed * dt; _dist += dx;
        for (var i = 0; i < _layers.Count; i++) { var s = _layers[i]; s.Off = (s.Off + dx * s.Rate) % s.Tile; s.T.X = s.Off - s.Tile; }
        _trainT.Y = _ry + u * 0.09 * Math.Sin(_dist / (2.3 * u));

        // ---- the bridge and the land take turns: the land comes in from the left at the ground's speed, stays, and leaves to the right
        _phaseT += dt; double hidden = -(_panelW + _panelEdge + 2), covering = -(_panelW - W) / 2, gone = W + _panelEdge + 2;
        switch (_phase)
        {
            case 0: _panelX = hidden; if (_phaseT > BridgeFor) { _phase = 1; } break;
            case 1: _panelX += dx; if (_panelX >= covering) { _panelX = covering; _phase = 2; _phaseT = 0; } break;
            case 2: _panelX = covering; if (_phaseT > LandFor) { _phase = 3; } break;
            default: _panelX += dx; if (_panelX >= gone) { _panelX = hidden; _phase = 0; _phaseT = 0; } break;
        }
        _back.T.X = _panelX; _front.T.X = _panelX;
        var shown = _phase != 0 ? Visibility.Visible : Visibility.Collapsed; if (_backG.Visibility != shown) { _backG.Visibility = shown; _frontG.Visibility = shown; }
        _itemOff = (_itemOff + dx * 0.62) % _itemTile;
        if (_phase != 0)
            for (var i = 0; i < _items.Count; i++)
            {
                // a tree or a house keeps its own place on the ground; it is drawn only while it is inside the panel
                var it = _items[i]; var rel = (it.X + _itemOff - _panelX) % _itemTile; if (rel < 0) rel += _itemTile; var px = rel - 40 * u;
                var on = px < _panelW && px + it.Wd > 0;
                if (on != it.On) { it.On = on; it.G.Visibility = on ? Visibility.Visible : Visibility.Collapsed; }
                if (on) it.T.X = px;
            }
        foreach (var pn in new[] { _back, _front })
            for (var i = 0; i < pn.Layers.Count; i++)
            {
                // a depth inside a panel keeps its own place on the ground whatever the panel does
                var sl = pn.Layers[i]; sl.Off = (sl.Off + dx * sl.Rate) % sl.Tile; var rel = (sl.Off - _panelX) % sl.Tile; if (rel < 0) rel += sl.Tile; sl.T.X = rel - sl.Tile;
            }
        if (_phase != 0) for (var i = 0; i < _townLights.Count; i++) { var (e, op, ph) = _townLights[i]; Op(e, op * (0.6 + 0.3 * f.Loud + 0.1 * Osc(_tw, 1.3, ph))); }

        // ---- the wheels and the rods
        _wa = (_wa - dx / (2.15 * u)) % (2 * Math.PI);
        double ca = Math.Cos(_wa) * u, sa = Math.Sin(_wa) * u, wyc = -2.15 * u;
        for (var i = 0; i < 3; i++) _drive[i].Angle = _wa * 57.29578;
        _rodC.X1 = 10.6 * u + ca; _rodC.Y1 = wyc + sa; _rodC.X2 = 19.8 * u + ca; _rodC.Y2 = wyc + sa;
        var head = 8.6 * u + ca;
        _rodM.X1 = 15.2 * u + ca; _rodM.Y1 = wyc + sa; _rodM.X2 = head; _rodM.Y2 = -3.05 * u; _rodP.X2 = head;

        // ---- the windows: a band each, and its streak on the water
        for (var c = 0; c < Cars; c++) _carLv[c] = 0;
        for (var i = 0; i < Wins; i++)
        {
            var target = f.Reduced ? 0.4 + 0.25 * Math.Sin(_idle + i * 0.5) : Clamp01(Lv(f, i / 23.0) * 1.25 + 0.15 * _flare);
            _lv[i] += (target - _lv[i]) * (target > _lv[i] ? 0.55 : 0.16);
            var lv = _lv[i]; _carLv[i / 8] += lv / 8;
            Op(_lit[i], 0.12 + 0.88 * lv); Op(_halo[i], 0.75 * lv);
            _refl[i].Height = u * (2 + 25 * lv); Op(_refl[i], (0.2 + 0.75 * lv) * (0.75 + 0.25 * Osc(_tw, 2.3, i * 1.7)));
        }
        double all = 0;
        for (var c = 0; c < Cars; c++) { Op(_under[c], 0.15 + 0.6 * _carLv[c]); all += _carLv[c] / Cars; }
        Op(_trainRefl, 0.15 + 0.5 * all);

        // ---- the engine: the beam, the lamp, the fire
        Op(_cone, 0.3 + 0.4 * f.Loud + 0.2 * _flare); Op(_railLit, 0.35 + 0.5 * f.Loud);
        Size(_lampFlare, 2.5 * u, -10.55 * u, u * (5 + 9 * _flare)); Op(_lampFlare, 0.8 * _flare);
        Op(_cabFire, 0.4 + 0.25 * f.Low + 0.45 * _flare); Op(_fireGlow, 0.2 + 0.2 * f.Low + 0.6 * _flare); Op(_stackGlow, 0.75 * _flare);

        // ---- the smoke: a puff every few yards of track, a big one on the beat; it stays in the air while the train leaves it
        double sx = _x0 + 5.1 * u, sy = _ry - 12.8 * u;
        _puffGap += dx;
        if (hit || _puffGap > 4.2 * u)
        {
            _puffGap = 0;
            for (var i = 0; i < Puffs; i++) if (!_pLive[i]) { _pLive[i] = true; _pBig[i] = hit; _pAge[i] = 0; _pX[i] = sx; break; }
        }
        for (var i = 0; i < Puffs; i++)
        {
            if (!_pLive[i]) continue;
            _pAge[i] += dt; _pX[i] += dx * 0.92; var age = _pAge[i]; var big = _pBig[i] ? 1.45 : 1.0;
            var d = u * (2.6 + 8.5 * (1 - Math.Exp(-age * 0.8))) * big;
            if (age > 7 || _pX[i] - d > W) { _pLive[i] = false; Op(_puff[i], 0); continue; }
            var y = sy - u * (1.2 + (8 + 4 * _pSeed[i]) * (1 - Math.Exp(-age * 0.9))) + Math.Sin(age * 3 + i) * 0.35 * u;
            Size(_puff[i], _pX[i], y, d); Op(_puff[i], Math.Min(1, age * 8) * 0.8 * Math.Exp(-age * 0.3) * (_pBig[i] ? 1.25 : 1));
        }

        // ---- the sparks: the high notes throw them from the stack
        _sparkDue -= dt * (f.Reduced ? 0 : 40 * f.High);
        for (var i = 0; i < Sparks; i++)
        {
            if (_sAge[i] > 0.8)
            {
                Op(_spark[i], 0);
                if (_sparkDue >= 0) continue;
                _sparkDue += 1; _sAge[i] = 0; _sX[i] = sx; _sVx[i] = u * (2 + 9 * ((i * 0.37) % 1)); _sVy[i] = u * (12 + 14 * ((i * 0.61 + _tw) % 1));
            }
            _sAge[i] += dt; _sX[i] += dx * 0.9 + _sVx[i] * dt; var a = _sAge[i];
            At(_spark[i], _sX[i], sy - _sVy[i] * a + 22 * u * a * a); Op(_spark[i], 1 - a / 0.8);
        }
        if (_sparkDue < -2) _sparkDue = -2;

        // ---- the water and the sky
        for (var i = 0; i < Glints; i++)
        {
            var g = _glint[i]; _gX[i] += dx * _gRate[i]; if (_gX[i] > W) _gX[i] -= W + g.Width;
            var onLand = _phase != 0 && _gX[i] > _panelX - _panelEdge * 0.6 && _gX[i] < _panelX + _panelW + _panelEdge * 0.6;
            Canvas.SetLeft(g, _gX[i]); Op(g, onLand ? 0 : 0.08 + 0.3 * Osc(_tw, 1.9, _gPh[i]));
        }
        for (var i = 0; i < _glit.Count; i++) { var (r, op, ph) = _glit[i]; Op(r, op * (0.3 + 0.7 * Osc(_tw, 1.4 + i % 4 * 0.5, ph))); }
        Op(_horizon, 0.5 + 0.4 * f.Loud);
        _cloud += dts * 0.004;
        for (var i = 0; i < _clouds.Count; i++)
        {
            var (cl, x, y, w) = _clouds[i];
            Size(cl, X((x + _cloud * (0.7 + 0.2 * (i % 3)) + 0.3) % 1.6 - 0.3), Y(y), w, w * 0.15);
        }
    }
}
