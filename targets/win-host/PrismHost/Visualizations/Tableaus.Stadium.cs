using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;
using Path = Microsoft.UI.Xaml.Shapes.Path;

namespace PrismHost.Visualizations;

// =============================================================== COMMUNITY: Stadium Wave (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A full stadium at night, seen from high in the near stand (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The far stand is the meter: twenty-four blocks of seats round the bowl, a band a block, low notes at the left and high at the
/// right, and the crowd in a block lights its rows from the front row up as its band rises. The big screen over the roof shows the
/// same twenty-four levels as bars. Two sides play a match on the pitch (Tableaus.Stadium.Match.cs), and a goal is what starts the
/// wave (2026-11-11; a beat had started it): three crests run round the far stand as raised lights and come back along the near
/// stand, where the people in front jump as each passes, and confetti falls. The floodlights and their beams breathe with the
/// loudness, and the flags fly faster as the music gets louder.
///
/// Every shape is made once in OnBuild. A row of seats in a block is one dotted line, a block's wave crest is one path, so a
/// frame allocates nothing.
/// </summary>
public sealed partial class StadiumWave : Tableau
{
    private const int Secs = 24, Rows = 14, Conf = 90, FlagM = 14, Waves = 3;
    private readonly Line[] _row = new Line[Secs * Rows], _ribbon = new Line[Secs];
    private readonly Path[] _crest = new Path[Secs];
    private readonly TranslateTransform[] _crestT = new TranslateTransform[Secs];
    private readonly ScaleTransform[] _barS = new ScaleTransform[Secs];
    private readonly double[] _lv = new double[Secs], _wp = new double[Waves];
    private readonly List<Ellipse> _lamps = new();
    private readonly List<Polygon> _beams = new();
    private readonly List<(TranslateTransform t, double q)> _people = new();
    private readonly Rectangle[] _conf = new Rectangle[Conf];
    private readonly double[] _cX = new double[Conf], _cY = new double[Conf], _cV = new double[Conf], _cD = new double[Conf];
    private readonly bool[] _cLive = new bool[Conf];
    private readonly Polygon[] _flag = new Polygon[4];
    private readonly double[] _flagX = new double[2], _flagY = new double[2];
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private Ellipse _pitchGlow = null!, _haze = null!, _screenGlow = null!;
    private double _cx, _cy, _a0, _da, _b0, _db, _lift;
    private double _flare, _prevBeat, _sinceBeat = 9, _sinceWave = 9, _idle, _tw, _fl, _confCool;
    private int _confLeft;

    private const double Th0 = Math.PI - 0.3, Th1 = 2 * Math.PI + 0.3;
    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Ink = Rgb(0x05070C), Deep = Rgb(0x0E1626);
    private Color Hue(double bd) { var t = Math.Clamp(bd, 0, 0.9999) * 2; var k = (int)t; return Mix(P(1 + k), P(2 + k), t - k); }
    private double PX(double th, double r) => _cx + (_a0 + _da * r) * Math.Cos(th);
    private double PY(double th, double r) => _cy + (_b0 + _db * r) * Math.Sin(th) - _lift * r;
    private double RoofX(double th) => _cx + (_a0 + _da * 12.5) * Math.Cos(th);
    private double RoofY(double th) => _cy + (_b0 + _db * 12.5) * Math.Sin(th) - _lift * 16.6;
    private static double Bump(double d) { d = Math.Abs(d); if (d >= 0.11) return 0; var c = Math.Cos(d / 0.11 * Math.PI / 2); return c * c; }
    private static DoubleCollection Dash() => new() { 0, 2 };

    protected override void OnBuild()
    {
        _lamps.Clear(); _beams.Clear(); _people.Clear();
        var rng = new Random(227);
        _cx = W / 2; _cy = Y(0.78); _a0 = W * 0.43; _da = W * 0.0085; _b0 = S(0.2); _db = S(0.004); _lift = S(0.019);
        for (var k = 0; k < Waves; k++) _wp[k] = 9;

        // ---- the night over the bowl, lit from below
        RB(0, 0, W, H, Vertical((Rgb(0x04060E), 0), (Rgb(0x0A1222), 0.3), (Rgb(0x16263C), 0.6), (Rgb(0x0A101C), 1)));
        _stars = Stars(36, 0.2, White, 41);
        _haze = Glow(_cx, Y(0.3), W * 1.3, Mix(P(0), P(2), 0.25), 0.3, 0.6); _haze.Height = S(0.7); At(_haze, _cx - W * 0.65, Y(0.3) - S(0.35));

        // ---- the masts in the far corners, and the big screen over the roof
        foreach (var fx in new[] { 0.085, 0.915 })
        {
            double x = X(fx), top = Y(0.06); var steel = Rgb(0x1A2436);
            L(x - S(0.012), Y(0.5), x - S(0.004), top, steel, Math.Max(1.5, S(0.004))); L(x + S(0.012), Y(0.5), x + S(0.004), top, steel, Math.Max(1.5, S(0.004)));
            for (var k = 0; k < 7; k++) L(x - S(0.011), Y(0.44 - k * 0.055), x + S(0.011), Y(0.44 - k * 0.055 - 0.03), steel, Math.Max(1, S(0.002)));
            RB(x - S(0.05), top - S(0.012), S(0.1), S(0.07), B(Rgb(0x121A28)));
            _lamps.Add(Glow(x, top + S(0.022), S(0.3), White, 0.5, 0.6));
            for (var r = 0; r < 3; r++) for (var c = 0; c < 5; c++) _lamps.Add(Glow(x - S(0.038) + c * S(0.019), top + r * S(0.021), S(0.026), White, 1, 0.9));
        }
        {
            double sw = Math.Min(W * 0.3, S(0.62)), sx = _cx - sw / 2, sy = Y(0.018), sh = S(0.145);
            L(_cx - sw * 0.3, sy + sh, _cx - sw * 0.3, Y(0.25), Rgb(0x1A2436), S(0.008)); L(_cx + sw * 0.3, sy + sh, _cx + sw * 0.3, Y(0.25), Rgb(0x1A2436), S(0.008));
            _screenGlow = Glow(_cx, sy + sh / 2, sw * 1.5, P(2), 0.3, 0.5); _screenGlow.Height = sh * 2.6; At(_screenGlow, _cx - sw * 0.75, sy + sh / 2 - sh * 1.3);
            var frame = RB(sx - S(0.008), sy - S(0.008), sw + S(0.016), sh + S(0.016), B(Rgb(0x141C2C))); frame.RadiusX = frame.RadiusY = S(0.006);
            RB(sx, sy, sw, sh, Vertical((Rgb(0x060A14), 0), (Rgb(0x0C1424), 1)));
            for (var i = 0; i < Secs; i++)
            {
                var col = Hue(i / 23.0); double bw = sw * 0.94 / Secs, bx = sx + sw * 0.03 + bw * i, bh = sh * 0.86;
                var bar = RB(bx + bw * 0.14, sy + sh * 0.07, bw * 0.72, bh, Vertical((Mix(col, White, 0.55), 0), (col, 1)));
                bar.RenderTransformOrigin = new Pt(0.5, 1); _barS[i] = new ScaleTransform { ScaleY = 0.2 }; bar.RenderTransform = _barS[i];
            }
        }

        // ---- the bowl: the body of the stand, the floor, the pitch
        {
            const int n = 72; var xy = new double[(n + 1) * 4];
            for (var i = 0; i <= n; i++)
            {
                var th = Th0 - 0.12 + (Th1 - Th0 + 0.24) * i / n;
                xy[i * 2] = PX(th, 17.5); xy[i * 2 + 1] = PY(th, 17.5);
                var j = 2 * n + 1 - i; xy[j * 2] = PX(th, -0.7); xy[j * 2 + 1] = PY(th, -0.7);
            }
            GB(Vertical((Rgb(0x0C1322), 0), (Rgb(0x162236), 0.55), (Rgb(0x0E1626), 1)), 1, xy);
        }
        {
            var floor = new Ellipse { Width = _a0 * 1.99, Height = _b0 * 1.97, Fill = Vertical((Rgb(0x1C3A40), 0), (Rgb(0x0E2228), 1)) }; At(floor, _cx - _a0 * 0.995, _cy - _b0 * 0.985); C.Children.Add(floor);
            double yf = _cy - _b0 * 0.7, yn = _cy + _b0 * 0.45, wf = _a0 * 0.6, wn = _a0 * 0.8;
            double MX(double u, double v) => _cx + (2 * u - 1) * (wf + (wn - wf) * v);
            double MY(double v) => yf + (yn - yf) * v;
            for (var k = 0; k < 12; k++)
                G(k % 2 == 0 ? Rgb(0x2E7A3E) : Rgb(0x276C36), 1, MX(k / 12.0, 0), yf, MX((k + 1) / 12.0, 0) + 0.5, yf, MX((k + 1) / 12.0, 1) + 0.5, yn, MX(k / 12.0, 1), yn);
            var chalk = B(A(White, 0.6)); var th = Math.Max(1, S(0.0028));
            void Chalk(params double[] uv) { var p = PL(chalk, th); for (var q = 0; q + 1 < uv.Length; q += 2) p.Points.Add(new Pt(MX(uv[q], uv[q + 1]), MY(uv[q + 1]))); }
            Chalk(0, 0, 1, 0, 1, 1, 0, 1, 0, 0); Chalk(0.5, 0, 0.5, 1);
            Chalk(0, 0.2, 0.15, 0.2, 0.15, 0.8, 0, 0.8); Chalk(1, 0.2, 0.85, 0.2, 0.85, 0.8, 1, 0.8);
            Chalk(0, 0.36, 0.05, 0.36, 0.05, 0.64, 0, 0.64); Chalk(1, 0.36, 0.95, 0.36, 0.95, 0.64, 1, 0.64);
            var ring = new Ellipse { Width = wn * 0.3, Height = (yn - yf) * 0.3, Stroke = chalk, StrokeThickness = th }; At(ring, _cx - wn * 0.15, MY(0.5) - (yn - yf) * 0.15); C.Children.Add(ring);
            BuildMatch(yf, yn, wf, wn);
            _pitchGlow = Glow(_cx, _cy - _b0 * 0.1, _a0 * 2.1, White, 0.3, 0.5); _pitchGlow.Height = _b0 * 2.2; At(_pitchGlow, _cx - _a0 * 1.05, _cy - _b0 * 1.2);
        }
        {
            var wall = PL(B(Rgb(0x3A4A64)), Math.Max(1.5, S(0.005)), 0.9);
            for (var i = 0; i <= 72; i++) { var th = Th0 - 0.12 + (Th1 - Th0 + 0.24) * i / 72; wall.Points.Add(new Pt(PX(th, -0.7), PY(th, -0.7))); }
        }

        // ---- the crowd: a block a band, a dotted line a row
        var dot = Math.Max(2.5, S(0.0078));
        for (var s = 0; s < Secs; s++)
        {
            double span = (Th1 - Th0) / Secs, t0 = Th0 + span * (s + 0.07), t1 = Th0 + span * (s + 0.93); var col = Hue(s / 23.0);
            var seats = new GeometryGroup(); var up = new GeometryGroup();
            for (var j = 0; j < Rows; j++)
            {
                var r = j < 6 ? j : j + 1.0;
                seats.Children.Add(new LineGeometry { StartPoint = new Pt(PX(t0, r), PY(t0, r)), EndPoint = new Pt(PX(t1, r), PY(t1, r)) });
                up.Children.Add(new LineGeometry { StartPoint = new Pt(PX(t0, r), PY(t0, r) - dot * 0.9), EndPoint = new Pt(PX(t1, r), PY(t1, r) - dot * 0.9) });
            }
            C.Children.Add(new Path { Data = seats, Stroke = B(Mix(Rgb(0x2A3850), col, 0.3)), StrokeThickness = dot, StrokeDashArray = Dash(), StrokeDashCap = PenLineCap.Round, Opacity = 0.85 });
            for (var j = 0; j < Rows; j++)
            {
                var r = j < 6 ? j : j + 1.0;
                var line = L(PX(t0, r), PY(t0, r), PX(t1, r), PY(t1, r), Mix(col, White, 0.04 + 0.34 * j / (Rows - 1)), dot, 0);
                line.StrokeDashArray = Dash(); line.StrokeDashCap = PenLineCap.Round; _row[s * Rows + j] = line;
            }
            _ribbon[s] = L(PX(t0 - span * 0.07, 6), PY(t0 - span * 0.07, 6), PX(t1 + span * 0.07, 6), PY(t1 + span * 0.07, 6), Mix(col, White, 0.2), Math.Max(2, S(0.008)), 0.3);
            _crestT[s] = new TranslateTransform();
            _crest[s] = new Path { Data = up, Stroke = B(Mix(P(0), col, 0.15)), StrokeThickness = dot * 1.25, StrokeDashArray = Dash(), StrokeDashCap = PenLineCap.Round, Opacity = 0, RenderTransform = _crestT[s] };
            C.Children.Add(_crest[s]); _lv[s] = 0.3;
        }

        // ---- the roof over the stand, its lamps, the beams from the masts
        {
            const int n = 72; var xy = new double[(n + 1) * 4]; var edge = PL(B(Rgb(0x8C9CB4)), Math.Max(1.5, S(0.004)), 0.8);
            for (var i = 0; i <= n; i++)
            {
                var th = Th0 - 0.12 + (Th1 - Th0 + 0.24) * i / n;
                xy[i * 2] = PX(th, 17.5); xy[i * 2 + 1] = PY(th, 17.5);
                var j = 2 * n + 1 - i; xy[j * 2] = RoofX(th); xy[j * 2 + 1] = RoofY(th);
            }
            GB(Vertical((Rgb(0x1E2A3E), 0), (Rgb(0x0C1320), 1)), 1, xy);
            for (var i = 0; i <= n; i++) { var th = Th0 - 0.12 + (Th1 - Th0 + 0.24) * i / n; edge.Points.Add(new Pt(RoofX(th), RoofY(th))); }
            for (var i = 0; i <= 40; i++)
            {
                var th = Th0 + (Th1 - Th0) * i / 40;
                L(RoofX(th), RoofY(th), PX(th, 17.5), PY(th, 17.5), Rgb(0x2A3850), Math.Max(1, S(0.002)), 0.8);
                _lamps.Add(Glow(RoofX(th), RoofY(th) + S(0.004), S(0.034), White, 1, 0.8));
            }
        }
        foreach (var fx in new[] { 0.085, 0.915 })
        {
            double x = X(fx), y = Y(0.085), dir = fx < 0.5 ? 1 : -1;
            _beams.Add(GB(Vertical((A(White, 0.3), 0), (A(White, 0.08), 0.5), (A(White, 0), 1)), 0.5, x - S(0.04), y, x + S(0.04), y, _cx + dir * _a0 * 0.35, _cy + _b0 * 0.3, _cx - dir * _a0 * 0.75, _cy + _b0 * 0.3));
        }

        // ---- confetti, the flags, the people in front
        for (var i = 0; i < Conf; i++) { _conf[i] = RB(0, 0, S(0.009), S(0.006), B(i % 5 == 0 ? White : P(1 + i % 3)), 0); _cLive[i] = false; }
        for (var k = 0; k < 2; k++)
        {
            double px = X(k == 0 ? 0.05 : 0.95), top = Y(0.47), dir = k == 0 ? 1 : -1;
            L(px - dir * S(0.03), H + 2, px, top, Rgb(0x0A0E16), Math.Max(2, S(0.007)));
            _flagX[k] = px; _flagY[k] = top + S(0.008);
            var c0 = k == 0 ? P(1) : P(2); var c1 = k == 0 ? P(0) : P(3);
            for (var half = 0; half < 2; half++)
            {
                var p = new Polygon { Fill = B(Mix(half == 0 ? c0 : c1, Deep, 0.25)), Opacity = 0.95 };
                for (var i = 0; i < (FlagM + 1) * 2; i++) p.Points.Add(new Pt(px, top));
                C.Children.Add(p); _flag[k * 2 + half] = p;
            }
        }
        // the people in front (drawn again 2026-11-11, asked for another pass at them): two rows, the back one smaller and dimmer. A
        // person is shoulders, a neck and a head with a line of light along the top from the pitch, and one in three or so holds
        // something up: a scarf in both hands, both arms, one fist, or wears a hat
        var lightOn = Mix(Mix(P(0), P(2), 0.3), White, 0.15);
        void Person(double px, double by, double s, int kind, Color ink, double rimA)
        {
            var g = new Canvas(); C.Children.Add(g); var t = new TranslateTransform(); g.RenderTransform = t; _people.Add((t, Math.Clamp(px / W, 0, 1))); var root = C; C = g;
            double[] Torso(double up) => TableauCurve.Closed(new[] { px - 0.56 * s, by + 0.3 * s, px - 0.56 * s, by - 0.5 * s - up, px - 0.47 * s, by - 0.86 * s - up, px - 0.2 * s, by - 1.0 * s - up, px + 0.2 * s, by - 1.0 * s - up, px + 0.47 * s, by - 0.86 * s - up, px + 0.56 * s, by - 0.5 * s - up, px + 0.56 * s, by + 0.3 * s }, 4);
            void Arm(double side, double ex, double ey, double hx, double hy)
            {
                var a = PL(B(ink), s * 0.17); a.Points.Add(new Pt(px + side * 0.44 * s, by - 0.86 * s)); a.Points.Add(new Pt(px + side * ex * s, by - ey * s)); a.Points.Add(new Pt(px + side * hx * s, by - hy * s));
                E(px + side * hx * s, by - hy * s, s * 0.2, ink);
            }
            var col = P(1 + rng.Next(3));
            if (kind == 0)
            {   // a scarf held up in both hands
                Arm(-1, 0.66, 1.3, 0.6, 1.95); Arm(1, 0.66, 1.3, 0.6, 1.95);
                var sy = by - 2.0 * s; RB(px - s * 0.78, sy - s * 0.11, s * 1.56, s * 0.22, B(Mix(col, Deep, 0.2)));
                for (var q = 0; q < 4; q++) RB(px - s * 0.78 + s * (0.1 + 0.39 * q), sy - s * 0.11, s * 0.17, s * 0.22, B(Mix(White, Deep, 0.25)));
            }
            else if (kind == 1) { Arm(-1, 0.7, 1.35, 0.86, 1.9); Arm(1, 0.7, 1.35, 0.86, 1.9); }
            else if (kind == 2) { Arm(rng.Next(2) == 0 ? -1 : 1, 0.62, 1.4, 0.56, 2.0); }
            G(A(lightOn, rimA), 1, Torso(0.035 * s)); var hl = E(px, by - 1.4 * s, s * 0.5, A(lightOn, rimA)); hl.Height = s * 0.56;
            G(ink, 1, Torso(0)); RB(px - 0.11 * s, by - 1.16 * s, 0.22 * s, 0.22 * s, B(ink));
            var head = E(px, by - 1.36 * s, s * 0.5, ink); head.Height = s * 0.56; At(head, px - s * 0.25, by - 1.36 * s - s * 0.28);
            if (kind == 3)
            {   // a knitted hat with a bobble
                var hat = TableauCurve.Closed(new[] { px - 0.27 * s, by - 1.4 * s, px - 0.24 * s, by - 1.62 * s, px, by - 1.72 * s, px + 0.24 * s, by - 1.62 * s, px + 0.27 * s, by - 1.4 * s }, 4);
                G(Mix(col, Deep, 0.45), 1, hat); E(px, by - 1.76 * s, s * 0.14, Mix(White, Deep, 0.4));
            }
            else if (kind == 4) { RB(px - 0.3 * s, by - 1.52 * s, 0.72 * s, 0.07 * s, B(ink)); var cap = E(px, by - 1.5 * s, s * 0.52, Mix(col, Deep, 0.5)); cap.Height = s * 0.3; At(cap, px - 0.26 * s, by - 1.66 * s); }
            C = root;
        }
        for (var x = -S(0.03); x < W + S(0.05);)
        {
            var s = S(0.046 + 0.016 * rng.NextDouble()); Person(x + s * 0.5, H - S(0.035) + s * 0.3 * rng.NextDouble(), s, rng.Next(9), Rgb(0x0A0F1A), 0.5); x += s * (1.15 + 0.3 * rng.NextDouble());
        }
        for (var x = -S(0.02); x < W + S(0.05);)
        {
            var s = S(0.068 + 0.028 * rng.NextDouble()); Person(x + s * 0.5, H + s * (0.1 + 0.25 * rng.NextDouble()), s, rng.Next(7), Ink, 1); x += s * (1.18 + 0.3 * rng.NextDouble());
        }
        Vignette(0.3);
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;
        Twinkle(_stars, f, 0.3);

        // ---- the beat starts a wave; with no beat one starts by itself now and then
        _sinceBeat += dt; _sinceWave += dt; var hit = false;
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.2 && !f.Reduced) { _sinceBeat = 0; hit = true; }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 4.2);
        _idle += dts * 0.9; _tw += dts;
        // the match; a goal is the only thing that starts the wave: three crests, one behind the other, and the confetti
        var goal = PlayMatch(f, dt, hit);
        if (goal) { for (var k = 0; k < Waves; k++) _wp[k] = -0.12 - 0.42 * k; _sinceWave = 0; _flare = 1; _confLeft = 4; _confCool = 0; }
        for (var k = 0; k < Waves; k++) if (_wp[k] <= 2.2) _wp[k] += Math.Max(dts, dt * 0.5) * 0.85;

        // ---- the far stand: a band a block, rows lit from the front row up; the crest of the wave over it
        for (var s = 0; s < Secs; s++)
        {
            var target = f.Reduced ? 0.4 + 0.25 * Math.Sin(_idle + s * 0.5) : Clamp01(Lv(f, s / 23.0) * 1.3 + 0.1 * _flare);
            _lv[s] += (target - _lv[s]) * (target > _lv[s] ? 0.55 : 0.14);
            var lv = _lv[s]; double w = 0, pc = (s + 0.5) / Secs;
            for (var k = 0; k < Waves; k++) w = Math.Max(w, Bump(pc - _wp[k]));
            for (var j = 0; j < Rows; j++) Op(_row[s * Rows + j], Clamp01(lv * (Rows + 0.6) - j));
            Op(_ribbon[s], 0.2 + 0.55 * lv + 0.4 * w);
            _crestT[s].Y = -S(0.012) * w; Op(_crest[s], 0.9 * w);
            _barS[s].ScaleY = 0.04 + 0.96 * lv;
        }
        // ---- the near stand: the wave comes back from right to left and the people jump as it passes
        for (var i = 0; i < _people.Count; i++)
        {
            var (t, q) = _people[i]; double w = 0;
            for (var k = 0; k < Waves; k++) w = Math.Max(w, Bump((2 - q) - _wp[k]));
            t.Y = -S(0.055) * w - S(0.006) * _flare;
        }

        // ---- the lights
        var lampOp = 0.55 + 0.35 * f.Loud + 0.1 * _flare;
        for (var i = 0; i < _lamps.Count; i++) Op(_lamps[i], lampOp);
        for (var i = 0; i < _beams.Count; i++) Op(_beams[i], 0.3 + 0.5 * f.Loud + 0.15 * _flare);
        Op(_pitchGlow, 0.3 + 0.4 * f.Loud + 0.15 * _flare); Op(_haze, 0.4 + 0.4 * f.Loud); Op(_screenGlow, 0.3 + 0.5 * f.Loud);

        // ---- confetti after a goal: four showers
        _confCool -= dt;
        if (_confLeft > 0 && _confCool <= 0)
        {
            _confLeft--; _confCool = 0.6; var launch = 0;
            for (var i = 0; i < Conf && launch < 30; i++)
                if (!_cLive[i]) { _cLive[i] = true; _cX[i] = Rng.NextDouble(); _cY[i] = -0.05 + Rng.NextDouble() * 0.3; _cV[i] = 0.14 + Rng.NextDouble() * 0.16; _cD[i] = (Rng.NextDouble() - 0.5) * 0.06; launch++; }
        }
        for (var i = 0; i < Conf; i++)
        {
            if (!_cLive[i]) continue;
            _cY[i] += _cV[i] * dts; _cX[i] += _cD[i] * dts + Math.Sin(_tw * 5 + i) * 0.0006;
            if (_cY[i] > 1.02) { _cLive[i] = false; Op(_conf[i], 0); continue; }
            var c = _conf[i]; c.Height = S(0.002 + 0.007 * Osc(_tw, 11, i)); At(c, X(_cX[i]), Y(_cY[i])); Op(c, Math.Min(0.95, (_cY[i] + 0.06) * 8));
        }

        // ---- the flags fly faster as the music gets louder
        _fl += dts * (2.2 + 4.5 * f.Loud);
        for (var k = 0; k < 2; k++)
        {
            double dir = k == 0 ? 1 : -1, len = S(0.23), hgt = S(0.062), amp = S(0.016 + 0.014 * f.Loud);
            for (var half = 0; half < 2; half++)
            {
                var pts = _flag[k * 2 + half].Points; var n = (FlagM + 1) * 2;
                for (var i = 0; i <= FlagM; i++)
                {
                    var t = i / (double)FlagM; var x = _flagX[k] + dir * len * t * (0.96 + 0.04 * Math.Cos(_fl * 0.7 + t * 5));
                    var y = _flagY[k] + hgt * half + S(0.04) * t * t + amp * t * Math.Sin(t * 8.5 - _fl + k * 2) + amp * 0.5 * t * Math.Sin(t * 15 - _fl * 1.7);
                    var y2 = y + hgt + 1;
                    pts[i] = new Pt(x, y); pts[n - 1 - i] = new Pt(x, y2);
                }
            }
        }
    }
}
