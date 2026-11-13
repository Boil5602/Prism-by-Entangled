using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== COMMUNITY: Fireworks Night (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// Fireworks over a river town (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// A shell bursts on every beat: its colour is the band that jumped, its size is the beat's strength, and its kind is one of five (a
/// round peony, a willow that hangs and falls, a ring with a heart, a palm of thick arms, a double shell). A burst lights the sky
/// around it, the river under it, a puff of smoke it leaves behind, and the edges of the family watching from the hill. Along the old
/// bridge stands a row of spark fountains, one a band, low notes to high, so the bridge is the meter while the sky keeps the beat.
/// A child on the hill holds a sparkler that follows the highs.
///
/// Every shape is made once in OnBuild. A spark is one line whose ends are worked out from the time since its burst, so a frame
/// allocates nothing.
/// </summary>
public sealed class FireworksNight : Tableau
{
    private const int N = 72, Shells = 12, Jets = 24, Glitters = 90;
    private sealed class Shell
    {
        public readonly Line[] Sp = new Line[N];
        public readonly double[] Dx = new double[N], Dy = new double[N];
        public Ellipse Sky = null!, Core = null!, Refl = null!, Smoke = null!;
        public Line Tail = null!;
        public Color Hue;
        public double X, Y, R, T = 99, Life = 1, K, Gv, Trail, Pow;
        public bool On, Dark = true, Crackled;
        public int Kind;
    }
    private readonly Shell[] _shells = new Shell[Shells];
    private readonly ScaleTransform[] _jet = new ScaleTransform[Jets];
    private readonly Ellipse[] _jetGlow = new Ellipse[Jets], _glit = new Ellipse[Glitters];
    private readonly Rectangle[] _jetRefl = new Rectangle[Jets];
    private readonly double[] _jetLv = new double[Jets], _glitT = new double[Glitters], _avg = new double[64];
    private readonly Line[] _sparkler = new Line[12];
    private readonly List<(Rectangle r, double x, double y, double w, double v)> _ripples = new();
    private readonly double[] _barge = { 0.3, 0.53, 0.74 };
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private Ellipse _sparkGlow = null!;
    private Rectangle _waterGlow = null!, _horizon = null!;
    private Canvas _rimC = null!, _bodyC = null!;
    private SolidColorBrush _rim = null!, _dark = null!;
    private RotateTransform _tail = null!;
    private double _wy, _deck, _bargeY, _flare, _prevBeat, _sinceBeat = 9, _sinceLaunch = 1, _lastX = 0.5, _idle, _rip, _wag, _sx, _sy;
    private int _lastCi = -1, _glitAt;

    private static readonly Color Dark = Color.FromArgb(255, 0x0A, 0x0A, 0x12);

    // ---- the people on the hill: a shape is drawn twice, a lit rim a little higher and the dark body over it
    private void Shape(double x, double by, double s, double rot, params double[] p)
    {
        var o = TableauCurve.Closed(p); double cr = Math.Cos(rot * Math.PI / 180), sr = Math.Sin(rot * Math.PI / 180); var off = s * 0.024;
        var rim = new double[o.Length];
        for (var i = 0; i + 1 < o.Length; i += 2)
        {
            double px = o[i] * s, py = o[i + 1] * s;
            o[i] = x + px * cr - py * sr; o[i + 1] = by + px * sr + py * cr; rim[i] = o[i]; rim[i + 1] = o[i + 1] - off;
        }
        var root = C; C = _rimC; GB(_rim, 1, rim); C = _bodyC; GB(_dark, 1, o); C = root;
    }
    private Line Limb(double x, double by, double s, double x1, double y1, double x2, double y2, double th)
    {
        Line Make(Brush b, double dy) => new Line { X1 = x + x1 * s, Y1 = by + y1 * s + dy, X2 = x + x2 * s, Y2 = by + y2 * s + dy, Stroke = b, StrokeThickness = th * s, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round };
        _rimC.Children.Add(Make(_rim, -s * 0.024)); var body = Make(_dark, 0); _bodyC.Children.Add(body); return body;
    }
    /// <summary>Someone sitting on the grass, seen from behind. hair: 0 short, 1 long, 2 a bun, 3 a hat. point: an arm raised at the sky.</summary>
    private void Seated(double x, double by, double s, double rot, int hair, int point = 0)
    {
        Shape(x, by, s, rot, -0.30, 0.06, -0.33, -0.35, -0.26, -0.62, -0.1, -0.7, 0.1, -0.7, 0.26, -0.62, 0.33, -0.35, 0.30, 0.06);
        Shape(x, by, s, rot, -0.07, -0.6, -0.06, -0.8, 0.06, -0.8, 0.07, -0.6);
        Shape(x, by, s, rot, 0.0, -1.04, 0.1, -1.0, 0.13, -0.9, 0.1, -0.79, 0.0, -0.75, -0.1, -0.79, -0.13, -0.9, -0.1, -1.0);
        if (hair == 1) Shape(x, by, s, rot, -0.14, -0.9, -0.1, -1.03, 0.0, -1.06, 0.1, -1.03, 0.14, -0.9, 0.17, -0.62, 0.1, -0.5, -0.1, -0.5, -0.17, -0.62);
        if (hair == 2) Shape(x, by, s, rot, 0.0, -1.15, 0.07, -1.11, 0.07, -1.03, 0.0, -1.0, -0.07, -1.03, -0.07, -1.11);
        if (hair == 3) { Shape(x, by, s, rot, -0.2, -0.97, -0.1, -1.0, -0.08, -1.1, 0.08, -1.1, 0.1, -1.0, 0.2, -0.97, 0.0, -0.93); }
        if (point != 0) { Limb(x, by, s, point * 0.28, -0.58, point * 0.46, -0.78, 0.1); Limb(x, by, s, point * 0.46, -0.78, point * 0.66, -1.08, 0.08); }
    }

    private double HillY(double fx) => 0.885 - 0.03 * Math.Sin(fx * 4.2 + 0.5) - 0.012 * Math.Sin(fx * 9.5 + 1);

    protected override void OnBuild()
    {
        _ripples.Clear(); _flare = 0; _sinceLaunch = 1;
        _wy = Y(0.64); _deck = Y(0.69); _bargeY = Y(0.815); var wy = _wy; var bridgeBase = Y(0.765);
        var rng = new Random(131);

        // ---- the sky and still stars
        RB(0, 0, W, wy, Vertical((Color.FromArgb(255, 0x04, 0x06, 0x16), 0), (Color.FromArgb(255, 0x0A, 0x10, 0x2C), 0.55), (Color.FromArgb(255, 0x1A, 0x1E, 0x46), 1)));
        _stars = new Ellipse[80];
        for (var i = 0; i < _stars.Length; i++) _stars[i] = E(X(rng.NextDouble()), Y(rng.NextDouble() * 0.5), S(0.002 + 0.003 * rng.NextDouble() * rng.NextDouble()), White, 0.4);
        _horizon = RB(0, wy - S(0.3), W, S(0.3), Vertical((A(P(1), 0), 0), (A(Mix(P(1), P(0), 0.5), 0.3), 1)));

        // ---- the shells: the light each one throws on the sky sits behind the town
        for (var i = 0; i < Shells; i++) { var s = _shells[i] = new Shell { Hue = P(i % 4) }; s.Sky = Glow(0, 0, 10, s.Hue, 0.55, 0); }

        // ---- the hills and the town on the far bank: houses, a church, a castle on its rock
        void Hill(Color top, Color bottom, params double[] f) { for (var i = 0; i + 1 < f.Length; i += 2) { f[i] = X(f[i]); f[i + 1] = Y(f[i + 1]); } GB(Vertical((top, 0), (bottom, 0.5), (bottom, 1)), 1, TableauCurve.Closed(f, 4)); }
        Hill(Color.FromArgb(255, 0x1C, 0x20, 0x46), Color.FromArgb(255, 0x14, 0x16, 0x34), -0.1, 0.60, 0.08, 0.55, 0.22, 0.57, 0.38, 0.52, 0.52, 0.58, 0.68, 0.53, 0.84, 0.47, 0.97, 0.54, 1.1, 0.52, 1.25, 1.0, -0.25, 1.0);
        var town = Color.FromArgb(255, 0x0E, 0x0E, 0x1E); var townB = B(town); var win = B(Color.FromArgb(255, 0xFF, 0xD0, 0x80));
        Hill(town, town, 0.62, 0.66, 0.72, 0.60, 0.80, 0.535, 0.88, 0.535, 0.95, 0.60, 1.05, 0.62, 1.2, 1.0, 0.5, 1.0);
        {   // the castle
            double cx = X(0.84), cy = Y(0.535), u = S(0.01);
            RB(cx - u * 5, cy - u * 3.2, u * 10, u * 4, townB);
            foreach (var (tx, tw, th) in new[] { (-5.6, 2.4, 6.2), (3.4, 2.4, 5.4), (-1.0, 2.6, 8.0) })
            {
                RB(cx + u * tx, cy - u * th, u * tw, u * th, townB);
                for (var k = 0; k < 3; k++) RB(cx + u * (tx + k * tw / 2.5), cy - u * (th + 0.5), u * tw / 5, u * 0.6, townB);
                RB(cx + u * (tx + tw * 0.38), cy - u * (th - 1.2), u * 0.5, u * 0.9, win, 0.9);
            }
            L(cx + u * 0.3, cy - u * 8.4, cx + u * 0.3, cy - u * 10.6, town, Math.Max(1, u * 0.18)); G(P(0), 0.8, cx + u * 0.4, cy - u * 10.6, cx + u * 2.2, cy - u * 10.1, cx + u * 0.4, cy - u * 9.6);
        }
        for (var x = -S(0.02); x < W;)
        {
            var bw = S(0.035 + 0.045 * rng.NextDouble()); var bh = S(0.03 + 0.055 * rng.NextDouble());
            RB(x, wy - bh, bw, bh + 1, townB);
            if (rng.NextDouble() < 0.6) GB(townB, 1, x - 1, wy - bh + 1, x + bw / 2, wy - bh - bw * (0.25 + 0.2 * rng.NextDouble()), x + bw + 1, wy - bh + 1);
            for (var k = 0; k < 4; k++) if (rng.NextDouble() < 0.7) RB(x + bw * (0.12 + 0.7 * rng.NextDouble()), wy - bh * (0.2 + 0.65 * rng.NextDouble()), Math.Max(1.5, S(0.004)), Math.Max(1.5, S(0.005)), win, 0.5 + 0.4 * rng.NextDouble());
            x += bw + S(0.002 + 0.01 * rng.NextDouble());
        }
        {   // the church
            double cx = X(0.21), u = S(0.01);
            RB(cx - u * 1.6, wy - u * 11, u * 3.2, u * 11, townB); GB(townB, 1, cx - u * 1.9, wy - u * 10.8, cx, wy - u * 17.5, cx + u * 1.9, wy - u * 10.8);
            RB(cx + u * 1.4, wy - u * 6, u * 7, u * 6, townB); GB(townB, 1, cx + u * 1.2, wy - u * 5.8, cx + u * 4.9, wy - u * 8.6, cx + u * 8.6, wy - u * 5.8);
            E(cx, wy - u * 8.6, u * 1.5, Color.FromArgb(255, 0xFF, 0xE0, 0xA0), 0.9); L(cx, wy - u * 17.4, cx, wy - u * 19, town, Math.Max(1, u * 0.2)); L(cx - u * 0.6, wy - u * 18.3, cx + u * 0.6, wy - u * 18.3, town, Math.Max(1, u * 0.2));
        }

        // ---- the river, and each shell's light on it
        RB(0, wy, W, H - wy, Vertical((Color.FromArgb(255, 0x1E, 0x22, 0x4C), 0), (Color.FromArgb(255, 0x12, 0x18, 0x3A), 0.4), (Color.FromArgb(255, 0x0C, 0x12, 0x2A), 1)));
        _waterGlow = RB(0, wy, W, H - wy, Vertical((A(White, 0.16), 0), (A(White, 0.03), 1)), 0);
        foreach (var s in _shells) s.Refl = Glow(0, 0, 10, s.Hue, 0.6, 0);
        for (var x = S(0.02); x < W; x += S(0.05 + 0.05 * rng.NextDouble()))
            RB(x, wy + 1, S(0.004), S(0.02 + 0.03 * rng.NextDouble()), Vertical((A(Color.FromArgb(255, 0xFF, 0xD0, 0x80), 0.5), 0), (A(Color.FromArgb(255, 0xFF, 0xD0, 0x80), 0), 1)));

        // ---- the old bridge: six arches, lamps on the piers
        {
            var stone = Vertical((Color.FromArgb(255, 0x1A, 0x18, 0x2A), 0), (Color.FromArgb(255, 0x0C, 0x0C, 0x18), 1));
            double x0 = -S(0.03), span = (W + S(0.06)) / 6, pw = S(0.014), ry = bridgeBase - _deck - S(0.022);
            for (var k = 0; k < 6; k++)
            {
                double a0 = x0 + k * span, a1 = a0 + span, cx = (a0 + a1) / 2, rx = span / 2 - pw;
                var p = new List<double> { a0, _deck, a1 + 1, _deck, a1 + 1, bridgeBase, a1 - pw, bridgeBase };
                for (var j = 0; j <= 14; j++) { var a = Math.PI * j / 14; p.Add(cx + Math.Cos(a) * rx); p.Add(bridgeBase - Math.Sin(a) * ry); }
                p.Add(a0); p.Add(bridgeBase);
                GB(stone, 1, p.ToArray());
                RB(a0 - pw * 0.4, bridgeBase - S(0.004), pw * 2.8, S(0.012), B(Color.FromArgb(255, 0x0A, 0x0A, 0x14)));
                if (k > 0)
                {
                    L(a0 + pw, _deck, a0 + pw, _deck - S(0.03), Color.FromArgb(255, 0x0C, 0x0C, 0x18), Math.Max(1, S(0.003)));
                    Glow(a0 + pw, _deck - S(0.032), S(0.035), Color.FromArgb(255, 0xFF, 0xD8, 0x9A), 0.9, 0.85); E(a0 + pw, _deck - S(0.032), S(0.006), Color.FromArgb(255, 0xFF, 0xF0, 0xD0));
                    RB(a0 + pw - S(0.003), bridgeBase + S(0.006), S(0.006), S(0.06), Vertical((A(Color.FromArgb(255, 0xFF, 0xD8, 0x9A), 0.45), 0), (A(Color.FromArgb(255, 0xFF, 0xD8, 0x9A), 0), 1)));
                }
            }
            RB(0, _deck - S(0.009), W, Math.Max(1, S(0.003)), B(Color.FromArgb(255, 0x1E, 0x1C, 0x30)));
        }

        // ---- the fountains' light on the water, the ripples, the barges the shells go up from
        for (var j = 0; j < Jets; j++)
        {
            var c = P((int)(j * 4.0 / Jets));
            _jetRefl[j] = RB(X(0.06 + 0.88 * j / (Jets - 1)) - S(0.006), bridgeBase + S(0.004), S(0.012), 4, Vertical((A(Mix(c, White, 0.4), 0.6), 0), (A(c, 0), 1)), 0.5);
        }
        var ripple = B(Color.FromArgb(255, 0x08, 0x0A, 0x1C));
        for (var i = 0; i < 80; i++)
        {
            var depth = rng.NextDouble(); var y = bridgeBase + S(0.008) + depth * (H - bridgeBase) * 0.75; var w = S(0.02 + 0.08 * rng.NextDouble()) * (0.6 + depth);
            var r = new Rectangle { Width = w, Height = Math.Max(1, S(0.002 + 0.003 * depth)), Fill = ripple, Opacity = 0.55 + 0.3 * depth }; At(r, 0, y); C.Children.Add(r);
            _ripples.Add((r, rng.NextDouble(), y, w, (0.008 + 0.02 * depth) * (rng.NextDouble() < 0.5 ? 1 : -1)));
        }
        foreach (var fx in _barge)
        {
            double bx = X(fx), u = S(0.01);
            G(Color.FromArgb(255, 0x08, 0x08, 0x12), 1, bx - u * 6, _bargeY - u * 0.8, bx + u * 6, _bargeY - u * 0.8, bx + u * 5, _bargeY + u * 0.5, bx - u * 5, _bargeY + u * 0.5);
            for (var k = -2; k <= 2; k++) RB(bx + u * (k * 1.6 - 0.3), _bargeY - u * 1.9, u * 0.6, u * 1.2, B(Color.FromArgb(255, 0x08, 0x08, 0x12)));
            Glow(bx - u * 5.4, _bargeY - u * 1.2, u * 1.6, Color.FromArgb(255, 0xFF, 0x50, 0x48), 1, 0.9);
        }

        // ---- in the air: smoke, the streak a shell went up on, the sparks, the flash
        var smoke = Color.FromArgb(255, 0x9A, 0x92, 0xB4);
        foreach (var s in _shells) s.Smoke = Glow(0, 0, 10, smoke, 0.4, 0);
        foreach (var s in _shells)
        {
            s.Tail = L(0, 0, 0, 0, Mix(s.Hue, White, 0.7), Math.Max(1, S(0.002)), 0);
            var a = B(Mix(s.Hue, White, 0.2)); var b = B(Mix(s.Hue, White, 0.7));
            for (var i = 0; i < N; i++)
            {
                var ln = new Line { Stroke = i % 3 == 0 ? b : a, StrokeThickness = S(0.004), StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Opacity = 0 };
                C.Children.Add(ln); s.Sp[i] = ln;
            }
            s.Core = Glow(0, 0, 10, Mix(s.Hue, White, 0.8), 1, 0);
        }
        for (var i = 0; i < Glitters; i++) { _glit[i] = E(0, 0, S(0.004 + 0.003 * rng.NextDouble()), Color.FromArgb(255, 0xFF, 0xF4, 0xD8), 0); _glitT[i] = 0; }

        // ---- the fountains along the bridge, one a band
        for (var j = 0; j < Jets; j++)
        {
            var c = P((int)(j * 4.0 / Jets)); var x = X(0.06 + 0.88 * j / (Jets - 1));
            _jetGlow[j] = Glow(x, _deck - S(0.012), S(0.07), c, 0.7, 0.4);
            double u = S(0.017), hh = S(0.24);
            var pts = TableauCurve.Closed(new[] { -0.12, 0.0, -0.3, -0.25, -0.8, -0.6, -1.0, -0.85, -0.55, -1.0, 0.0, -0.96, 0.55, -1.0, 1.0, -0.85, 0.8, -0.6, 0.3, -0.25, 0.12, 0.0 });
            for (var i = 0; i + 1 < pts.Length; i += 2) { pts[i] = x + pts[i] * u; pts[i + 1] = _deck + pts[i + 1] * hh; }
            var e = GB(Vertical((A(c, 0), 0), (A(c, 0.5), 0.3), (A(Mix(c, White, 0.25), 0.9), 0.7), (White, 1)), 1, pts);
            _jet[j] = new ScaleTransform { CenterX = x, CenterY = _deck }; e.RenderTransform = _jet[j]; _jetLv[j] = 0.2;
        }

        // ---- the hill on the near bank, and the family on it
        _rim = B(Mix(P(1), White, 0.4)); _dark = B(Dark);
        _rimC = new Canvas(); C.Children.Add(_rimC); _bodyC = new Canvas(); C.Children.Add(_bodyC);
        {
            var p = new List<double>(); var rimLine = new Polyline { Stroke = _rim, StrokeThickness = Math.Max(1.5, S(0.004)) };
            for (var i = 0; i <= 60; i++) { var fx = -0.02 + 1.04 * i / 60; p.Add(X(fx)); p.Add(Y(HillY(fx))); rimLine.Points.Add(new Pt(X(fx), Y(HillY(fx)) - S(0.002))); }
            p.Add(W + 2); p.Add(H + 2); p.Add(-2); p.Add(H + 2);
            _rimC.Children.Add(rimLine);
            var root = C; C = _bodyC; G(Dark, 1, p.ToArray()); C = root;
        }
        double At2(double fx) => Y(HillY(fx)) + S(0.012);
        var big = S(0.2);
        Seated(X(0.15), At2(0.15), big, 4, 0); Seated(X(0.15) + big * 0.56, At2(0.2), big * 0.95, -7, 1);                 // two, leaning together
        Seated(X(0.36), At2(0.36), big * 1.02, 0, 3, 1);                                                                  // a hat, pointing
        {   // a child standing with a sparkler
            double x = X(0.475), by = At2(0.475), s = S(0.15);
            Limb(x, by, s, -0.08, 0.05, -0.07, -0.45, 0.11); Limb(x, by, s, 0.08, 0.05, 0.07, -0.45, 0.11);
            Shape(x, by, s, 0, -0.17, -0.38, -0.19, -0.7, -0.1, -0.86, 0.1, -0.86, 0.19, -0.7, 0.17, -0.38);
            Shape(x, by, s, 0, 0.0, -1.16, 0.1, -1.12, 0.13, -1.02, 0.1, -0.91, 0.0, -0.87, -0.1, -0.91, -0.13, -1.02, -0.1, -1.12);
            Shape(x, by, s, 0, -0.12, -0.98, -0.21, -0.96, -0.24, -0.8, -0.17, -0.8); Shape(x, by, s, 0, 0.12, -0.98, 0.21, -0.96, 0.24, -0.8, 0.17, -0.8);
            Limb(x, by, s, 0.16, -0.8, 0.36, -0.95, 0.075); Limb(x, by, s, 0.36, -0.95, 0.5, -1.2, 0.065); Limb(x, by, s, -0.16, -0.8, -0.24, -0.52, 0.07);
            _sx = x + 0.62 * s; _sy = by - 1.5 * s;
            L(x + 0.5 * s, by - 1.2 * s, _sx, _sy, Color.FromArgb(255, 0x30, 0x2C, 0x38), Math.Max(1, s * 0.02));
        }
        {   // the dog
            double x = X(0.565), by = At2(0.565), s = S(0.13);
            Shape(x, by, s, 0, -0.2, 0.05, -0.22, -0.3, -0.1, -0.54, 0.08, -0.52, 0.2, -0.25, 0.2, 0.05);
            Shape(x, by, s, 0, -0.02, -0.78, 0.1, -0.74, 0.13, -0.62, 0.06, -0.5, -0.08, -0.5, -0.15, -0.62, -0.12, -0.74);
            Shape(x, by, s, 0, -0.12, -0.7, -0.16, -0.9, -0.04, -0.77); Shape(x, by, s, 0, 0.1, -0.7, 0.13, -0.9, 0.02, -0.77);
            var tail = Limb(x, by, s, 0.18, -0.04, 0.4, -0.16, 0.055); _tail = new RotateTransform { CenterX = x + 0.18 * s, CenterY = by - 0.04 * s }; tail.RenderTransform = _tail;
        }
        Seated(X(0.76), At2(0.76), big * 0.98, 3, 2); Seated(X(0.76) + big * 0.5, At2(0.81), big * 0.66, -4, 0, 1); Seated(X(0.93), At2(0.93), big, 2, 1);

        // ---- the sparkler
        _sparkGlow = Glow(_sx, _sy, S(0.07), Color.FromArgb(255, 0xFF, 0xE8, 0xB0), 1, 0.7);
        for (var i = 0; i < _sparkler.Length; i++) _sparkler[i] = L(_sx, _sy, _sx, _sy, Color.FromArgb(255, 0xFF, 0xF4, 0xD8), Math.Max(1, S(0.0018)), 0.9);
        Vignette(0.3);
    }

    /// <summary>A shell bursts: where, how big, which colour, which kind.</summary>
    private void Launch(double hit, double band)
    {
        var ci = Math.Max(0, Math.Min(3, (int)(band * 4)));
        if (ci == _lastCi && Rng.NextDouble() < 0.6) ci = (ci + 1 + Rng.Next(3)) % 4;
        _lastCi = ci;
        Shell s = _shells[0]; var best = -1e9;
        for (var i = 0; i < Shells; i++)
        {
            var c = _shells[i]; var score = (c.T > c.Life ? 100 : 0) + (i % 4 == ci ? 50 : 0) + Math.Min(c.T, 10);
            if (score > best) { best = score; s = c; }
        }
        var fx = 0.1 + 0.8 * Rng.NextDouble(); if (Math.Abs(fx - _lastX) < 0.18) fx = (fx + 0.3) % 0.8 + 0.1; _lastX = fx;
        s.R = Math.Min(W * 0.2, S(0.17 + 0.23 * hit)); s.X = X(fx); s.Y = Math.Max(s.R * 0.75, Y(0.13 + 0.25 * Rng.NextDouble()));
        s.T = 0; s.On = true; s.Dark = false; s.Crackled = false; s.Pow = 0.5 + 0.5 * hit; s.Kind = Rng.Next(5);
        double thick = S(0.0038);
        switch (s.Kind)
        {
            case 1: s.K = 2.0; s.Gv = S(0.04); s.Life = 2.3; s.Trail = 0.4; break;                       // willow
            case 2: s.K = 3.2; s.Gv = S(0.03); s.Life = 1.4; s.Trail = 0.13; break;                        // ring
            case 3: s.K = 2.4; s.Gv = S(0.05); s.Life = 1.9; s.Trail = 0.2; thick = S(0.0065); break;       // palm
            default: s.K = 3.2; s.Gv = S(0.035); s.Life = 1.55; s.Trail = 0.2; break;                     // peony, double
        }
        double tilt = Rng.NextDouble() * Math.PI, squash = 0.3 + 0.45 * Rng.NextDouble(), turn = Rng.NextDouble() * 6.28;
        for (var i = 0; i < N; i++)
        {
            double dx, dy;
            if (s.Kind == 2 && i < 36)
            {
                var a = 2 * Math.PI * i / 36; double ex = Math.Cos(a), ey = Math.Sin(a) * squash;
                dx = ex * Math.Cos(tilt) - ey * Math.Sin(tilt); dy = ex * Math.Sin(tilt) + ey * Math.Cos(tilt);
            }
            else if (s.Kind == 3)
            {
                var arm = i % 8; var a = turn + 2 * Math.PI * arm / 8; var reach = 0.4 + 0.1 * (i / 8);
                dx = Math.Cos(a) * reach; dy = (Math.Sin(a) * 0.85 - 0.2) * reach;
            }
            else
            {
                var z = Rng.NextDouble() * 2 - 1; var a = Rng.NextDouble() * 2 * Math.PI; var r = Math.Sqrt(1 - z * z) * (0.86 + 0.14 * Rng.NextDouble());
                if (s.Kind == 2) r *= 0.38; else if (s.Kind == 4 && i % 2 == 1) r *= 0.52; else if (s.Kind == 1) r *= 0.85;
                dx = Math.Cos(a) * r; dy = Math.Sin(a) * r;
            }
            s.Dx[i] = dx; s.Dy[i] = dy; s.Sp[i].StrokeThickness = thick;
        }
        var bx = _barge[0]; foreach (var b in _barge) if (Math.Abs(b - fx) < Math.Abs(bx - fx)) bx = b;
        s.Tail.X1 = X(bx); s.Tail.Y1 = _bargeY - S(0.02); s.Tail.X2 = s.X; s.Tail.Y2 = s.Y;
        Size(s.Sky, s.X, s.Y, s.R * 5); Size(s.Refl, s.X, _wy + (H - _wy) * 0.42, s.R * 1.7, (H - _wy) * 0.8);
        _rim.Color = Mix(s.Hue, White, 0.4);
        _flare = Math.Max(_flare, 0.45 + 0.55 * hit); _sinceLaunch = 0;
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;

        // ---- which band jumped: that is the next shell's colour
        var n = Math.Min(f.Levels.Length, _avg.Length); var jump = 0; var most = -1.0;
        for (var b = 0; b < n; b++) { var d = f.Levels[b] - _avg[b]; if (d > most) { most = d; jump = b; } _avg[b] += (f.Levels[b] - _avg[b]) * 0.12; }

        // ---- a shell on every beat; when the beat is away, one now and then
        _sinceBeat += dt; _sinceLaunch += dt;
        var hit = Clamp01(f.Beat * 2.2);
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.22)
        {
            _sinceBeat = 0; Launch(f.Reduced ? 0.25 + 0.3 * hit : hit, jump / (double)Math.Max(1, n - 1));
            if (!f.Reduced && hit > 0.8) Launch(hit * 0.6, Rng.NextDouble());
        }
        else if (_sinceLaunch > (f.Reduced ? 2.6 : 1.7)) Launch(0.25 + 0.35 * f.Loud, Rng.NextDouble());
        _prevBeat = f.Beat;
        _flare *= Math.Exp(-dt * 3.0);

        for (var i = 0; i < _stars.Length; i++) Op(_stars[i], (0.3 + 0.2 * Math.Sin(f.T * (0.7 + i % 7 * 0.23) + i * 1.7)) * (1 - 0.6 * _flare));
        Op(_horizon, 0.4 + 0.3 * f.Loud + 0.3 * _flare); Op(_waterGlow, _flare);

        // ---- the shells
        var drift = S(0.012);
        for (var k = 0; k < Shells; k++)
        {
            var s = _shells[k]; if (!s.On) continue;
            s.T += dts; var t = s.T; var u = t / s.Life;
            if (u < 1)
            {
                var t0 = Math.Max(0, t - s.Trail * (0.4 + 0.6 * u));
                double e1 = s.R * (1 - Math.Exp(-s.K * t)), e0 = s.R * (1 - Math.Exp(-s.K * t0));
                double x1 = s.X + drift * t, y1 = s.Y + s.Gv * t * t, x0 = s.X + drift * t0, y0 = s.Y + s.Gv * t0 * t0;
                var fade = 1 - u * u * u; var late = u > 0.55;
                var crackle = !s.Crackled && u > 0.7 && s.Kind != 2 && s.Kind != 3; if (crackle) s.Crackled = true;
                for (var i = 0; i < N; i++)
                {
                    var ln = s.Sp[i]; double dx = s.Dx[i], dy = s.Dy[i];
                    if (s.Kind == 3) { var back = 1 - 0.1 / (0.4 + 0.1 * (i / 8)); ln.X1 = x1 + dx * back * e1; ln.Y1 = y1 + dy * back * e1; } else { ln.X1 = x0 + dx * e0; ln.Y1 = y0 + dy * e0; }
                    ln.X2 = x1 + dx * e1; ln.Y2 = y1 + dy * e1;
                    ln.Opacity = Clamp01(late ? fade * (0.55 + 0.45 * Math.Sin(t * 37 + i * 2.4)) : fade);
                    if (crackle && i % 3 == 0)
                    {
                        var g = _glitAt = (_glitAt + 1) % Glitters; _glitT[g] = 0.45 + 0.4 * Rng.NextDouble();
                        Size(_glit[g], x1 + dx * e1, y1 + dy * e1, _glit[g].Width);
                    }
                }
            }
            else if (!s.Dark) { s.Dark = true; for (var i = 0; i < N; i++) s.Sp[i].Opacity = 0; }
            Op(s.Core, 1 - t / 0.25); if (t < 0.3) Size(s.Core, s.X, s.Y, s.R * (0.5 + 1.8 * Math.Min(1, t / 0.25)));
            Op(s.Sky, 0.62 * s.Pow * Math.Exp(-t * 2.0)); Op(s.Refl, 0.6 * s.Pow * Math.Exp(-t * 1.7)); Op(s.Tail, 0.55 * (1 - t / 0.4));
            var whole = s.Life + 2.5;
            Size(s.Smoke, s.X + drift * 2.5 * t, s.Y + S(0.012) * t, s.R * (1.1 + 0.4 * t));
            Op(s.Smoke, 0.5 * Clamp01((t - 0.1) * 3) * Clamp01(1 - t / whole) * (0.35 + 0.65 * _flare));
            if (t > whole) { s.On = false; s.Smoke.Opacity = 0; s.Sky.Opacity = 0; s.Refl.Opacity = 0; }
        }
        for (var i = 0; i < Glitters; i++)
        {
            if (_glitT[i] <= 0) continue;
            _glitT[i] -= dts;
            _glit[i].Opacity = _glitT[i] <= 0 ? 0 : Clamp01(_glitT[i] * 2.5) * (0.5 + 0.5 * Math.Sin(_glitT[i] * 48 + i));
        }

        // ---- the fountains on the bridge: one a band, quick up and slow down
        _idle += dts * 0.9;
        for (var j = 0; j < Jets; j++)
        {
            var band = j / (double)(Jets - 1);
            var target = f.Reduced ? 0.25 + 0.15 * Math.Sin(_idle + j * 0.5) : Clamp01(0.06 + Lv(f, band) * 1.15 + 0.12 * _flare);
            _jetLv[j] += (target - _jetLv[j]) * (target > _jetLv[j] ? 0.5 : 0.14);
            var lv = _jetLv[j]; _jet[j].ScaleY = 0.1 + 0.9 * lv; _jet[j].ScaleX = 0.55 + 0.45 * lv;
            Op(_jetGlow[j], 0.2 + 0.7 * lv); _jetRefl[j].Height = S(0.015 + 0.11 * lv); Op(_jetRefl[j], 0.25 + 0.55 * lv);
        }

        // ---- the river
        _rip += dts;
        for (var i = 0; i < _ripples.Count; i++)
        {
            var (r, x, y, w, v) = _ripples[i];
            At(r, X(((x + _rip * v) % 1.2 + 1.2) % 1.2 - 0.1) - w / 2, y);
        }

        // ---- the hill: the bursts' light along everyone's edges, the sparkler, the dog's tail
        Op(_rimC, 0.22 + 0.78 * _flare);
        Op(_sparkGlow, 0.35 + 0.6 * f.High);
        for (var i = 0; i < _sparkler.Length; i++)
        {
            var a = i * 0.524 + Math.Sin(f.T * 9 + i * 1.3) * 0.25; var len = S(0.012 + 0.04 * (0.3 + 0.7 * f.High)) * (0.5 + 0.5 * Math.Sin(f.T * 31 + i * 1.9));
            var ln = _sparkler[i]; ln.X2 = _sx + Math.Cos(a) * len; ln.Y2 = _sy + Math.Sin(a) * len;
        }
        _wag += dts * (3 + 11 * f.Loud); _tail.Angle = -18 + 22 * Math.Sin(_wag);
    }
}
