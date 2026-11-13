using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== ENVIRONMENT: Aurora Ridge (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// The northern lights over a mountain lake (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The aurora is the meter: two curtains of light, each a row of rays, and a ray stands as tall and as bright as the band under
/// it, low notes at the left and high at the right. The curtains drift in slow folds with the mids, and a fold seen edge-on is
/// brighter, as it is in the sky. The lake mirrors the curtains below the mirrored peaks, and the snow on the peaks and the shore
/// takes the colour of the light as the music gets louder. The stars twinkle with the highs and a strong beat sends a shooting
/// star. A cabin on the shore keeps its fire.
///
/// Every shape is made once in OnBuild. A ray is one rectangle that is moved and sized, so a frame allocates nothing.
/// </summary>
public sealed class AuroraRidge : Tableau
{
    private const int N = 64, Bands = 24, Smoke = 8;
    private readonly Rectangle[] _ray = new Rectangle[N * 2], _mir = new Rectangle[N * 2];
    private readonly double[] _lv = new double[Bands], _ph = new double[2];
    private readonly List<(Rectangle r, double op, double ph)> _ripples = new();
    private readonly Ellipse[] _smoke = new Ellipse[Smoke];
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private Polygon _snowTint = null!, _shoreTint = null!;
    private Ellipse _skyGlow = null!, _lakeGlow = null!, _fire = null!;
    private Rectangle _window = null!;
    private Line _shoot = null!;
    private double _hy, _rayW, _sh, _flare, _idle, _tw, _shootT = 9, _shootCool, _sx, _sy, _smokeX, _smokeY;

    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static readonly Color Night = Rgb(0x050912), Warm = Rgb(0xFFB45C);

    /// <summary>A ridge line by midpoint displacement: the seed heights are halved and roughened a few times.</summary>
    private static double[] Crest(Random r, int levels, double rough, params double[] seed)
    {
        var h = seed;
        for (var l = 0; l < levels; l++)
        {
            var n = new double[h.Length * 2 - 1]; var amp = rough / Math.Pow(1.9, l);
            for (var i = 0; i < h.Length; i++) { n[2 * i] = h[i]; if (i + 1 < h.Length) n[2 * i + 1] = (h[i] + h[i + 1]) / 2 + (r.NextDouble() - 0.5) * amp; }
            h = n;
        }
        return h;
    }
    private double[] Outline(double[] h, double baseY, double lo, double hi, double flip = 0)
    {
        var n = h.Length; var xy = new double[(n + 2) * 2];
        for (var j = 0; j < n; j++)
        {
            var y = baseY - S(lo + (hi - lo) * h[j]);
            xy[j * 2] = -4 + (W + 8) * j / (n - 1); xy[j * 2 + 1] = flip > 0 ? baseY + (baseY - y) * flip : y;
        }
        xy[n * 2] = W + 4; xy[n * 2 + 1] = baseY + (flip > 0 ? -1 : 1); xy[n * 2 + 2] = -4; xy[n * 2 + 3] = baseY + (flip > 0 ? -1 : 1);
        return xy;
    }
    private double[] SnowCap(double[] h, double baseY, double lo, double hi, double line, Random r)
    {
        var n = h.Length; var xy = new double[n * 4];
        for (var j = 0; j < n; j++)
        {
            var x = -4 + (W + 8) * j / (n - 1); var y = baseY - S(lo + (hi - lo) * h[j]);
            var depth = Math.Max(0, h[j] - line) * S(hi - lo) * (0.3 + 0.25 * r.NextDouble()) * (j % 2 == 0 ? 1 : 0.75);
            xy[j * 2] = x; xy[j * 2 + 1] = y; var k = 2 * n - 1 - j; xy[k * 2] = x + S(0.004); xy[k * 2 + 1] = y + depth;
        }
        return xy;
    }
    private double RayBase(int r, double u) => Y(r == 0 ? 0.33 : 0.23) + S(r == 0 ? 0.07 : 0.05) * (0.6 * Math.Sin(u * 6.6 + _ph[r]) + 0.4 * Math.Sin(u * 15.1 - _ph[r] * 1.7 + r * 2));

    protected override void OnBuild()
    {
        _ripples.Clear();
        var rng = new Random(239); var hy = _hy = Y(0.68);

        // ---- the sky: deep night, many stars, a faint river of them
        RB(0, 0, W, hy + 2, Vertical((Rgb(0x02040C), 0), (Rgb(0x061022), 0.5), (Rgb(0x0C2036), 1)));
        { var mw = Glow(0, 0, W * 1.2, Rgb(0x8FA8D8), 0.16, 0.7); mw.Height = S(0.22); At(mw, -W * 0.1, Y(0.02)); mw.RenderTransformOrigin = new Pt(0.5, 0.5); mw.RenderTransform = new RotateTransform { Angle = -14 }; }
        _stars = Stars(150, 0.66, White, 53);
        _skyGlow = Glow(X(0.5), Y(0.36), W * 1.3, Mix(P(0), P(1), 0.4), 0.3, 0.5); _skyGlow.Height = S(0.7); At(_skyGlow, X(0.5) - W * 0.65, Y(0.36) - S(0.35));
        _shoot = L(0, 0, 1, 1, White, Math.Max(1.5, S(0.003)), 0); _shoot.StrokeEndLineCap = PenLineCap.Round;

        // ---- the two curtains, the far one first; a ray is a strip with its bright hem at the foot
        _rayW = W * 1.12 / N * 2.3;
        for (var r = 1; r >= 0; r--)
            for (var i = 0; i < N; i++)
            {
                var hem = r == 0 ? Mix(P(0), P(1), 0.5 * i / (N - 1.0)) : Mix(P(1), P(3), i / (N - 1.0)); var crown = r == 0 ? Mix(P(2), P(3), 0.3) : P(2);
                _ray[r * N + i] = RB(0, 0, _rayW, 10, Vertical((A(crown, 0), 0), (A(crown, 0.22), 0.4), (A(Mix(hem, crown, 0.3), 0.5), 0.72), (A(hem, 0.95), 0.93), (A(Mix(hem, White, 0.45), 0.9), 0.975), (A(hem, 0), 1)), 0.2);
            }

        // ---- the far peaks with their snow, a nearer wooded ridge
        var peaks = Crest(rng, 5, 0.36, 0.3, 0.78, 0.42, 1.0, 0.5, 0.86, 0.36, 0.68, 0.3);
        G(Rgb(0x0E1C30), 1, Outline(peaks, hy, 0.05, 0.36));
        var cap = SnowCap(peaks, hy, 0.05, 0.36, 0.42, rng);
        G(Rgb(0x4C6282), 0.8, cap); _snowTint = G(Mix(P(0), White, 0.2), 0.3, (double[])cap.Clone());
        var woods = Crest(rng, 6, 0.5, 0.5, 0.2, 0.7, 0.35, 0.15, 0.55, 0.9);
        G(Rgb(0x081220), 1, Outline(woods, hy, 0.015, 0.13));

        // ---- the lake: the sky's colour, the curtains mirrored, the peaks mirrored over them, ripples
        RB(0, hy, W, H - hy + 2, Vertical((Rgb(0x0C2034), 0), (Rgb(0x071426), 0.4), (Rgb(0x03070E), 1)));
        _lakeGlow = Glow(X(0.5), hy + S(0.16), W * 1.3, Mix(P(0), P(1), 0.4), 0.3, 0.4); _lakeGlow.Height = S(0.4); At(_lakeGlow, X(0.5) - W * 0.65, hy - S(0.04));
        for (var r = 1; r >= 0; r--)
            for (var i = 0; i < N; i++)
            {
                var hem = r == 0 ? Mix(P(0), P(1), 0.5 * i / (N - 1.0)) : Mix(P(1), P(3), i / (N - 1.0)); var crown = r == 0 ? Mix(P(2), P(3), 0.3) : P(2);
                _mir[r * N + i] = RB(0, 0, _rayW, 10, Vertical((A(hem, 0), 0), (A(hem, 0.8), 0.08), (A(Mix(hem, crown, 0.3), 0.4), 0.3), (A(crown, 0.16), 0.6), (A(crown, 0), 1)), 0.1);
            }
        G(Rgb(0x0A1626), 0.8, Outline(peaks, hy, 0.05, 0.36, 0.5)); G(Rgb(0x060E1A), 0.9, Outline(woods, hy, 0.015, 0.13, 0.6));
        RB(0, hy - 1, W, Math.Max(2, S(0.004)), B(Rgb(0x1C3048)), 0.8);
        for (var i = 0; i < 44; i++)
        {
            var t = rng.NextDouble(); var w = S(0.03 + 0.16 * rng.NextDouble()) * (0.4 + t); var dark = rng.NextDouble() < 0.55;
            _ripples.Add((RB(X(rng.NextDouble()) - w / 2, hy + (H - hy) * (0.03 + 0.95 * t * t), w, Math.Max(1, S(0.0016 + 0.003 * t)), B(dark ? Rgb(0x02050A) : Mix(P(1), White, 0.4)), 0.3), dark ? 0.55 : 0.28, rng.NextDouble() * 6));
        }

        BuildShore(rng);
        Vignette(0.3);
    }

    private void BuildShore(Random rng)
    {
        var hy = _hy; var pine = Rgb(0x040810); var bank = Vertical((Rgb(0x263850), 0), (Rgb(0x0C1420), 0.3), (Rgb(0x04070C), 1));
        // the right bank with the cabin
        var right = TableauCurve.Closed(new[] { X(0.56), H + 4, X(0.6), Y(0.9), X(0.68), Y(0.845), X(0.8), Y(0.825), X(0.93), Y(0.815), W + 20, Y(0.8), W + 20, H + 4 }, 6);
        for (var i = 0; i < 9; i++) { var x = X(0.84 + 0.17 * rng.NextDouble()); var hgt = S(0.16 + 0.2 * rng.NextDouble()); Pine(x, Y(0.83) - hgt, hgt * 0.2, hgt, pine); }
        double cx = X(0.775), cb = Y(0.832), cw = S(0.15), ch = S(0.07);
        _smokeX = cx + cw * 0.3; _smokeY = cb - ch - S(0.075);
        for (var i = 0; i < Smoke; i++) _smoke[i] = Glow(0, 0, S(0.03), Rgb(0x7C8CA4), 0.5, 0);
        GB(bank, 1, right); _shoreTint = G(P(0), 0.1, X(0.6), Y(0.9), X(0.68), Y(0.845), X(0.8), Y(0.825), X(0.93), Y(0.815), W + 20, Y(0.8), W + 20, Y(0.86), X(0.8), Y(0.875), X(0.66), Y(0.93));
        _fire = Glow(cx - cw * 0.12, cb - ch * 0.4, S(0.2), Warm, 0.5, 0.6);
        RB(cx - cw / 2, cb - ch, cw, ch, Vertical((Rgb(0x1A1410), 0), (Rgb(0x0A0808), 1)));
        for (var k = 1; k < 5; k++) L(cx - cw / 2, cb - ch * k / 5, cx + cw / 2, cb - ch * k / 5, Rgb(0x050404), Math.Max(1, S(0.0018)), 0.8);
        RB(cx + cw * 0.26, cb - ch - S(0.07), S(0.02), S(0.05), B(Rgb(0x0C0A0A)));
        G(Rgb(0x0A0C12), 1, cx - cw * 0.58, cb - ch + 1, cx, cb - ch - S(0.055), cx + cw * 0.58, cb - ch + 1);
        G(Rgb(0x8498B4), 0.85, cx - cw * 0.58, cb - ch + 1, cx, cb - ch - S(0.055), cx + cw * 0.58, cb - ch + 1, cx + cw * 0.5, cb - ch - S(0.004), cx, cb - ch - S(0.043), cx - cw * 0.5, cb - ch - S(0.004));
        _window = RB(cx - cw * 0.24, cb - ch * 0.72, cw * 0.24, ch * 0.42, Vertical((Mix(Warm, White, 0.4), 0), (Warm, 1)));
        L(cx - cw * 0.12, cb - ch * 0.72, cx - cw * 0.12, cb - ch * 0.3, Rgb(0x1A1410), Math.Max(1, S(0.002))); L(cx - cw * 0.24, cb - ch * 0.51, cx, cb - ch * 0.51, Rgb(0x1A1410), Math.Max(1, S(0.002)));
        RB(cx + cw * 0.16, cb - ch * 0.66, cw * 0.14, ch * 0.66, B(Rgb(0x060505)));
        for (var i = 0; i < 4; i++) { var x = X(0.63 + 0.1 * rng.NextDouble() + (i > 1 ? 0.27 : 0)); var hgt = S(0.2 + 0.14 * rng.NextDouble()); Pine(x, Y(0.9 + 0.04 * i) - hgt, hgt * 0.2, hgt + S(0.1), pine); }

        // the left bank: tall pines that frame the lake, a jetty, someone on it with a dog
        double jy = Y(0.895);
        G(Rgb(0x0A0E16), 1, X(0.2), jy, X(0.47), jy - S(0.012), X(0.47), jy, X(0.2), jy + S(0.016));
        L(X(0.2), jy, X(0.47), jy - S(0.012), Rgb(0x34465E), Math.Max(1, S(0.003)), 0.8);
        foreach (var fx in new[] { 0.3, 0.38, 0.465 }) RB(X(fx) - S(0.004), jy - S(0.006), S(0.008), S(0.05), B(Rgb(0x070A10)));
        {
            double px = X(0.445), py = jy - S(0.012), s = S(0.05); var ink = Rgb(0x05080E);
            G(ink, 1, TableauCurve.Closed(new[] { px - 0.22 * s, py + 0.02 * s, px - 0.24 * s, py - 0.5 * s, px - 0.1 * s, py - 0.78 * s, px + 0.12 * s, py - 0.76 * s, px + 0.22 * s, py - 0.45 * s, px + 0.5 * s, py - 0.1 * s, px + 0.5 * s, py + 0.04 * s }));
            E(px, py - 0.98 * s, 0.34 * s, ink); G(ink, 1, px - 0.2 * s, py - 0.98 * s, px, py - 1.28 * s, px + 0.2 * s, py - 0.98 * s);
            var dx = px - 0.75 * s;
            G(ink, 1, TableauCurve.Closed(new[] { dx - 0.2 * s, py + 0.02 * s, dx - 0.22 * s, py - 0.3 * s, dx - 0.05 * s, py - 0.52 * s, dx + 0.12 * s, py - 0.4 * s, dx + 0.18 * s, py + 0.02 * s }));
            E(dx + 0.02 * s, py - 0.6 * s, 0.26 * s, ink); G(ink, 1, dx - 0.1 * s, py - 0.66 * s, dx - 0.08 * s, py - 0.86 * s, dx + 0.02 * s, py - 0.7 * s); G(ink, 1, dx + 0.04 * s, py - 0.7 * s, dx + 0.12 * s, py - 0.86 * s, dx + 0.14 * s, py - 0.64 * s);
        }
        GB(bank, 1, TableauCurve.Closed(new[] { -20, Y(0.84), X(0.08), Y(0.855), X(0.19), Y(0.885), X(0.27), Y(0.93), X(0.3), H + 4, -20, H + 4 }, 6));
        for (var i = 0; i < 7; i++) { var x = X(-0.02 + 0.2 * rng.NextDouble() * (0.4 + 0.1 * i)); var hgt = S(0.3 + 0.38 * rng.NextDouble()); Pine(x, Y(0.9 + 0.02 * i) - hgt, hgt * 0.19, hgt + S(0.1), pine); }
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed; var hy = _hy;
        Twinkle(_stars, f, 0.4);
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 3.5);
        _idle += dts * 0.9; _tw += dts; _sh += dts * (1.2 + 2.5 * f.High);
        _ph[0] += dts * (0.1 + 0.32 * f.Mid); _ph[1] -= dts * (0.07 + 0.22 * f.Mid);

        // ---- the bands, eased; a ray reads the band under it
        for (var b = 0; b < Bands; b++)
        {
            var target = f.Reduced ? 0.38 + 0.22 * Math.Sin(_idle * 0.8 + b * 0.55) : Clamp01(Lv(f, b / 23.0) * 1.3 + 0.1 * _flare);
            _lv[b] += (target - _lv[b]) * (target > _lv[b] ? 0.35 : 0.08);
        }
        for (var r = 0; r < 2; r++)
            for (var i = 0; i < N; i++)
            {
                var u = i / (N - 1.0); var fb = (r == 0 ? u : 1 - u) * (Bands - 1); var b0 = (int)fb; var b1 = Math.Min(Bands - 1, b0 + 1);
                var lv = _lv[b0] + (_lv[b1] - _lv[b0]) * (fb - b0);
                var yb = RayBase(r, u); var fold = Math.Min(1, Math.Abs(RayBase(r, u + 0.016) - RayBase(r, u - 0.016)) / S(0.022));
                var hgt = S(r == 0 ? 0.14 + 0.36 * lv : 0.12 + 0.26 * lv);
                var op = (0.1 + 0.42 * lv) * (0.75 + 0.9 * fold) * (0.72 + 0.28 * Math.Sin(i * 0.9 - _sh + r * 2)) * (r == 0 ? 1 : 0.8) + 0.04 * _flare;
                var x = W * 1.12 * u - W * 0.06 - _rayW / 2 + S(0.012) * Math.Sin(_tw * 0.5 + i * 0.4 + r);
                var ray = _ray[r * N + i]; ray.Height = hgt; At(ray, x, yb - hgt); Op(ray, op);
                var m = _mir[r * N + i]; m.Height = hgt * 0.55; At(m, x, hy + (hy - yb) * 0.5); Op(m, op * 0.5);
            }

        // ---- the light on the land and the water
        Op(_skyGlow, 0.2 + 0.5 * f.Loud + 0.1 * _flare); Op(_lakeGlow, 0.15 + 0.4 * f.Loud);
        Op(_snowTint, 0.08 + 0.34 * f.Loud + 0.1 * _flare); Op(_shoreTint, 0.04 + 0.14 * f.Loud);
        for (var i = 0; i < _ripples.Count; i++) { var (rp, op, ph) = _ripples[i]; Op(rp, op * (0.3 + 0.7 * Osc(_tw, 0.9 + i % 5 * 0.3, ph))); }

        // ---- a shooting star on a strong beat
        _shootCool -= dt; _shootT += dt;
        if (f.Beat > 0.2 && _shootCool <= 0 && !f.Reduced) { _shootCool = 3.5; _shootT = 0; _sx = X(0.15 + 0.6 * Rng.NextDouble()); _sy = Y(0.04 + 0.14 * Rng.NextDouble()); }
        if (_shootT < 0.7)
        {
            var t = _shootT / 0.7; double hx = _sx + S(0.5) * t, hyy = _sy + S(0.16) * t, tail = S(0.14) * Math.Sin(Math.PI * t);
            _shoot.X2 = hx; _shoot.Y2 = hyy; _shoot.X1 = hx - tail; _shoot.Y1 = hyy - tail * 0.32; Op(_shoot, 0.9 * Math.Sin(Math.PI * t));
        }
        else Op(_shoot, 0);

        // ---- the cabin: the fire inside, the smoke
        var fire = 0.6 + 0.2 * Osc(_tw, 7.3) * Osc(_tw, 3.1, 1) + 0.2 * f.Low;
        Op(_window, 0.55 + 0.45 * fire); Op(_fire, 0.3 + 0.4 * fire);
        for (var i = 0; i < Smoke; i++)
        {
            var age = (_tw * 0.11 + i / (double)Smoke) % 1.0;
            Size(_smoke[i], _smokeX + S(0.05) * age * age + S(0.008) * Math.Sin(age * 9 + i), _smokeY - S(0.16) * age, S(0.016 + 0.06 * age));
            Op(_smoke[i], 0.4 * Math.Sin(Math.PI * Math.Sqrt(age)));
        }
    }
}
