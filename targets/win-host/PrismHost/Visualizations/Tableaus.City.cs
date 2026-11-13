using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;
using Rc = Windows.Foundation.Rect;

namespace PrismHost.Visualizations;

// =============================================================== COMMUNITY: City Skyline (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A city across the water at night (redrawn 2026-11-10, asked for the same idea on a new stage).
///
/// The towers are the instrument: each one follows a band of its own, low notes on the left to high on the right, and lights up floor
/// by floor to that band's level, warm at the street and the pack's colour at the top, with a bright line that holds the peak and
/// falls slowly. A few windows stay lit all the time, so it is a city before it is a meter. The water gives every tower's light back as
/// a broken reflection. A beat lifts the glow behind the skyline, flashes the beacons and the crowns, and runs a wave of light along
/// the waterfront. Searchlights sweep with the mids, an observation wheel turns faster as the music gets louder with a cabin for every
/// band, cars run the embankment, a ferry crosses.
///
/// Every shape is made once in OnBuild. A tower's lit floors are one layer of windows behind a clip, so a frame moves one rectangle a
/// tower and allocates nothing.
/// </summary>
public sealed class CitySkyline : Tableau
{
    private sealed class Tower
    {
        public double X, W, Top, H, Band, Lv, Pk;
        public RectangleGeometry Clip = null!;
        public Rectangle? Peak, Refl, Neon;
        public Ellipse? Crown;
        public bool Near;
    }
    private readonly List<Tower> _towers = new();
    private readonly List<Ellipse> _beacons = new();
    private readonly List<(Polygon p, RotateTransform rt, double rest, double swing, double ph, double rate)> _beams = new();
    private readonly List<(Ellipse c, double x, double y, double d, double ph)> _clouds = new();
    private readonly List<(Ellipse car, double x, double v, bool right)> _cars = new();
    private readonly List<(Rectangle r, double x, double y, double w, double v)> _ripples = new();
    private readonly List<(Rectangle r, double band, double ph)> _glints = new();
    private readonly List<(Rectangle r, double ph)> _lampRefl = new();
    private readonly List<(Ellipse cab, double band)> _cabins = new();
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private Rectangle _skyGlow = null!, _haze = null!, _shore = null!;
    private Ellipse _wheelHub = null!, _wheelRefl = null!, _moonHalo = null!;
    private RotateTransform _wheelTurn = null!;
    private TranslateTransform _boatAt = null!;
    private double _waterY, _flare, _prevBeat, _sinceBeat = 9, _sweep = 2, _idlePh, _rip, _cloud, _boat = 0.2, _wheelPh, _blink;

    private static readonly Color Cream = Color.FromArgb(255, 0xFF, 0xE8, 0xB8);
    private Color HueAt(double t)
    {
        var n = Math.Max(1, Math.Min(3, Pal.Length)); var at = Clamp01(t) * (n - 1); var i = (int)Math.Floor(at);
        return n == 1 ? P(0) : Mix(P(i), P(Math.Min(n - 1, i + 1)), at - i);
    }
    private Rectangle Box(double x, double y, double w, double h, Brush b, double op = 1)
    {
        var r = new Rectangle { Width = Math.Max(0.5, w), Height = Math.Max(0.5, h), Fill = b, Opacity = Clamp01(op) };
        At(r, x, y); C.Children.Add(r); return r;
    }

    /// <summary>One tower: its body and crown, the windows that are always on, and the layer of lit floors behind a clip.</summary>
    private Tower Build(double x, double w, double h, double baseY, double band, int kind, Random r, bool near)
    {
        var top = baseY - h; var hue = HueAt(band);
        var bodyTop = near ? Color.FromArgb(255, 0x18, 0x1C, 0x30) : Color.FromArgb(255, 0x26, 0x26, 0x44);
        var bodyBot = near ? Color.FromArgb(255, 0x0C, 0x0E, 0x1A) : Color.FromArgb(255, 0x1A, 0x18, 0x30);
        var body = B(Mix(bodyTop, bodyBot, 0.4)); var roof = B(bodyTop);
        var t = new Tower { X = x, W = w, Top = top, H = h, Band = band, Near = near, Lv = 0.2, Pk = 0.2 };
        RB(x, top, w, h, Vertical((bodyTop, 0), (bodyBot, 1)));
        // the lit edge: a tower catches the sky's glow down one side
        Box(x, top, Math.Max(1, w * 0.035), h, B(A(Mix(hue, White, 0.5), 0.16)));

        // ---- the crown
        double spireX = x + w * 0.5, spireY = top; var spire = 0.0;
        switch (kind % 5)
        {
            case 0:
                Box(x + w * 0.25, top - S(0.018), w * 0.5, S(0.018) + 1, roof); spireY = top - S(0.018); spire = near ? 0.075 : 0.04; break;
            case 1:
                Box(x + w * 0.14, top - S(0.034), w * 0.72, S(0.034) + 1, roof); Box(x + w * 0.3, top - S(0.064), w * 0.4, S(0.031), roof);
                Box(x + w * 0.14, top - S(0.034), w * 0.72, Math.Max(1.5, S(0.003)), B(A(hue, 0.7)));
                spireY = top - S(0.064); spire = near ? 0.11 : 0.05; break;
            case 2:
                GB(roof, 1, x, top + 1, x + w, top + 1, x + w, top - S(0.05)); spireX = x + w * 0.93; spireY = top - S(0.047); spire = 0.03; break;
            case 3:
                GB(roof, 1, x + w * 0.08, top + 1, x + w * 0.5, top - S(0.085), x + w * 0.92, top + 1); spireY = top - S(0.083); spire = near ? 0.07 : 0.035; break;
            default:
                Box(x + w * 0.56, top - S(0.045), w * 0.26, S(0.034), roof); Box(x + w * 0.60, top - S(0.012), Math.Max(1, w * 0.02), S(0.013), roof); Box(x + w * 0.76, top - S(0.012), Math.Max(1, w * 0.02), S(0.013), roof);
                Box(x + w * 0.12, top - S(0.014), w * 0.3, S(0.015), roof); break;
        }
        if (spire > 0)
        {
            Box(spireX - Math.Max(0.75, S(0.0015)), spireY - S(spire), Math.Max(1.5, S(0.003)), S(spire) + 1, roof);
            _beacons.Add(Glow(spireX, spireY - S(spire), S(near ? 0.026 : 0.016), Color.FromArgb(255, 0xFF, 0x48, 0x40), 1, 0.4));
        }

        // ---- the windows: a grid of floors and bays
        var pitch = S(near ? 0.024 : 0.03); var rows = Math.Max(3, (int)(h / pitch)); pitch = h / rows; var sh = pitch * 0.48;
        var cols = Math.Max(2, (int)(w / S(near ? 0.018 : 0.024)));
        double x0 = x + w * 0.1, iw = w * 0.8, cw = iw / cols, ww = cw * 0.62;
        var dim = B(A(Mix(Cream, hue, 0.25), near ? 0.42 : 0.3));
        for (var row = 0; row < rows; row++)
            for (var c = 0; c < cols; c++)
                if (r.NextDouble() < 0.16) Box(x0 + c * cw, top + row * pitch + pitch * 0.26, ww, sh, dim);
        // the lit floors, one strip a floor, cut into bays by the piers; some windows stay dark
        var lit = new Canvas(); C.Children.Add(lit);
        t.Clip = new RectangleGeometry { Rect = new Rc(x, baseY, w, 0) }; lit.Clip = t.Clip;
        var root = C; C = lit;
        for (var row = 0; row < rows; row++)
        {
            var up = 1 - row / (double)Math.Max(1, rows - 1);
            Box(x0, top + row * pitch + pitch * 0.26, iw - (cw - ww), sh, B(Mix(Cream, Mix(hue, White, 0.1), 0.45 + 0.55 * up)));
        }
        for (var c = 0; c < cols - 1; c++) Box(x0 + c * cw + ww, top, cw - ww, h, body);
        for (var row = 0; row < rows; row++)
            for (var c = 0; c < cols; c++)
                if (r.NextDouble() < (near ? 0.17 : 0.12)) Box(x0 + c * cw - 0.5, top + row * pitch + pitch * 0.26 - 0.5, ww + 1, sh + 1, body);
        C = root;
        t.Peak = Box(x0, baseY, iw - (cw - ww), Math.Max(1.5, S(0.0035)), B(Mix(hue, White, 0.65)), 0.9);
        t.Neon = Box(x, top - 1, w, Math.Max(2, S(0.004)), B(hue), 0.3);
        if (near && h > H * 0.44) t.Crown = Glow(x + w / 2, top - S(0.02), w * 2.6, hue, 0.55, 0);
        _towers.Add(t);
        return t;
    }

    protected override void OnBuild()
    {
        _towers.Clear(); _beacons.Clear(); _beams.Clear(); _clouds.Clear(); _cars.Clear(); _ripples.Clear(); _glints.Clear(); _lampRefl.Clear(); _cabins.Clear();
        _waterY = Y(0.8); var wy = _waterY;
        var rng = new Random(101);

        // ---- the sky: night above, the city's glow at the skyline
        RB(0, 0, W, wy, Vertical((Color.FromArgb(255, 0x06, 0x08, 0x1C), 0), (Color.FromArgb(255, 0x12, 0x10, 0x34), 0.42), (Color.FromArgb(255, 0x34, 0x1C, 0x52), 0.74), (Color.FromArgb(255, 0x5E, 0x2C, 0x5A), 1)));
        _stars = new Ellipse[90];
        for (var i = 0; i < _stars.Length; i++) _stars[i] = E(X(rng.NextDouble()), Y(rng.NextDouble() * 0.5), S(0.002 + 0.003 * rng.NextDouble() * rng.NextDouble()), White, 0.5);
        double mx = X(0.27), my = Y(0.17), mr = S(0.052);
        _moonHalo = Glow(mx, my, mr * 9, Color.FromArgb(255, 0xD8, 0xDC, 0xF8), 0.2);
        E(mx, my, mr * 2, Color.FromArgb(255, 0xF4, 0xF0, 0xE2), 0.96);
        E(mx - mr * 0.3, my - mr * 0.25, mr * 0.55, Color.FromArgb(255, 0xC8, 0xC4, 0xC0), 0.35); E(mx + mr * 0.32, my + mr * 0.2, mr * 0.4, Color.FromArgb(255, 0xC8, 0xC4, 0xC0), 0.3); E(mx - mr * 0.05, my + mr * 0.48, mr * 0.28, Color.FromArgb(255, 0xC8, 0xC4, 0xC0), 0.28);
        _skyGlow = RB(0, wy - S(0.55), W, S(0.55), Vertical((A(P(2), 0), 0), (A(P(2), 0.2), 0.55), (A(Mix(P(0), P(2), 0.4), 0.5), 1)));
        for (var i = 0; i < 7; i++)
        {
            var d = S(0.2 + rng.NextDouble() * 0.2);
            _clouds.Add((Glow(0, 0, d, Mix(P(2), Color.FromArgb(255, 0x60, 0x50, 0x90), 0.6), 0.5, 0.3), rng.NextDouble(), 0.2 + rng.NextDouble() * 0.3, d, rng.NextDouble() * 6));
        }

        // ---- the far city: a haze of towers with a scatter of lights
        var farBrush = B(Color.FromArgb(255, 0x3A, 0x2C, 0x5C)); var farLight = B(A(Cream, 0.45));
        for (var x = -S(0.02); x < W;)
        {
            var bw = S(0.04 + rng.NextDouble() * 0.07); var bh = S(0.12 + rng.NextDouble() * 0.3) * (0.6 + 0.4 * Math.Sin(Math.PI * Clamp01(x / W)));
            Box(x, wy - bh, bw, bh, farBrush);
            if (rng.NextDouble() < 0.3) Box(x + bw * 0.45, wy - bh - S(0.03), Math.Max(1, S(0.002)), S(0.03), farBrush);
            for (var k = 0; k < 5; k++) Box(x + bw * (0.15 + 0.7 * rng.NextDouble()), wy - bh * (0.1 + 0.8 * rng.NextDouble()), Math.Max(1, S(0.0035)), Math.Max(1, S(0.004)), farLight);
            x += bw + S(0.004);
        }
        _haze = RB(0, wy - S(0.3), W, S(0.3), Vertical((A(P(2), 0), 0), (A(Mix(P(2), P(0), 0.3), 0.26), 1)));

        // ---- the middle city: towers that follow their bands, and the searchlights on their roofs
        var kind = 0;
        for (var x = -S(0.03); x < W;)
        {
            var bw = S(0.07 + rng.NextDouble() * 0.06); var fx = Clamp01((x + bw / 2) / W);
            var bh = S(0.2 + rng.NextDouble() * 0.22) * (0.65 + 0.35 * Math.Sin(Math.PI * fx));
            Build(x, bw, bh, wy, fx, kind++ + rng.Next(3), rng, false);
            x += bw + S(0.012 + rng.NextDouble() * 0.03);
        }
        foreach (var (fx, rest, swing, ph, rate) in new[] { (0.36, -24.0, 20.0, 0.0, 0.5), (0.47, 20.0, 24.0, 1.4, 0.62), (0.68, -14.0, 26.0, 2.9, 0.45), (0.86, 16.0, 18.0, 4.4, 0.7) })
        {
            double bx = X(fx), by = wy - S(0.3), len = S(0.75), w0 = S(0.004), w1 = S(0.05);
            var beam = GB(Vertical((A(Mix(P(3), P(1), 0.3), 0), 0), (A(Mix(P(3), P(1), 0.3), 0.7), 1)), 0.2, bx - w0, by, bx + w0, by, bx + w1, by - len, bx - w1, by - len);
            var rt = new RotateTransform { CenterX = bx, CenterY = by, Angle = rest }; beam.RenderTransform = rt;
            _beams.Add((beam, rt, rest, swing, ph, rate));
        }

        // ---- the near city: the tall ones, lower at the left where the wheel stands
        double wheelR = Math.Min(S(0.15), W * 0.085), wheelX = Math.Max(wheelR * 1.5, X(0.13)), wheelY = wy - wheelR - S(0.035);
        for (var x = S(0.01); x < W - S(0.02);)
        {
            var bw = S(0.085 + rng.NextDouble() * 0.075); var fx = Clamp01((x + bw / 2) / W);
            var bell = Math.Exp(-Math.Pow((fx - 0.6) / 0.28, 2));
            var bh = S(0.24 + 0.44 * bell * (0.62 + 0.38 * rng.NextDouble()) + 0.06 * rng.NextDouble());
            if (x < wheelX + wheelR * 1.25) bh = S(0.13 + 0.07 * rng.NextDouble());
            Build(x, bw, bh, wy, fx, kind++ + rng.Next(3), rng, true);
            x += bw + S(0.01 + rng.NextDouble() * 0.045);
        }

        // ---- the waterfront: the embankment, its lamps, the cars
        var lampY = wy - S(0.024);
        RB(0, wy - S(0.012), W, S(0.022), Vertical((Color.FromArgb(255, 0x14, 0x12, 0x22), 0), (Color.FromArgb(255, 0x08, 0x08, 0x12), 1)));
        _shore = RB(0, wy - S(0.05), W, S(0.05), Vertical((A(P(0), 0), 0), (A(P(0), 0.3), 1)), 0.5);
        var lampBrush = B(Color.FromArgb(255, 0xFF, 0xD8, 0x9A));
        for (var x = S(0.03); x < W; x += S(0.075))
        {
            Box(x - 0.75, lampY, 1.5, S(0.014), B(Color.FromArgb(255, 0x10, 0x10, 0x1C)));
            Glow(x, lampY, S(0.03), Color.FromArgb(255, 0xFF, 0xD8, 0x9A), 0.9, 0.9); Box(x - S(0.002), lampY - S(0.002), S(0.004), S(0.004), lampBrush);
        }
        for (var i = 0; i < 14; i++) { var right = i % 2 == 0; _cars.Add((Glow(0, 0, S(0.011), right ? Color.FromArgb(255, 0xFF, 0xF4, 0xDC) : Color.FromArgb(255, 0xFF, 0x50, 0x48), 1, 0.95), rng.NextDouble(), 0.03 + rng.NextDouble() * 0.05, right)); }

        // ---- the water: the sky's colour at the shore falling to black, every tower's light given back, the lamps' streaks
        RB(0, wy + S(0.008), W, H - wy, Vertical((Color.FromArgb(255, 0x2C, 0x1A, 0x44), 0), (Color.FromArgb(255, 0x10, 0x0E, 0x26), 0.35), (Color.FromArgb(255, 0x05, 0x06, 0x10), 1)));
        foreach (var t in _towers)
        {
            if (!t.Near) continue;
            var hue = HueAt(t.Band);
            t.Refl = RB(t.X + t.W * 0.06, wy + S(0.01), t.W * 0.88, 2, Vertical((A(Mix(hue, Cream, 0.3), 0.46), 0), (A(hue, 0.26), 0.45), (A(hue, 0), 1)), 0.8);
        }
        for (var x = S(0.03); x < W; x += S(0.075))
            _lampRefl.Add((RB(x - S(0.003), wy + S(0.01), S(0.006), S(0.07), Vertical((A(Color.FromArgb(255, 0xFF, 0xD8, 0x9A), 0.6), 0), (A(Color.FromArgb(255, 0xFF, 0xD8, 0x9A), 0), 1)), 0.5), rng.NextDouble() * 6));

        // ---- the observation wheel on the waterfront: a cabin for every band
        {
            var steel = Color.FromArgb(255, 0x1A, 0x1C, 0x2E);
            _wheelRefl = Glow(wheelX, wy + S(0.07), wheelR * 1.6, Mix(P(1), P(2), 0.5), 0.4, 0.4); _wheelRefl.Height = S(0.14);
            L(wheelX, wheelY, wheelX - wheelR * 0.55, wy - S(0.004), steel, Math.Max(2, S(0.007))); L(wheelX, wheelY, wheelX + wheelR * 0.55, wy - S(0.004), steel, Math.Max(2, S(0.007)));
            var turning = new Canvas(); C.Children.Add(turning); _wheelTurn = new RotateTransform { CenterX = wheelX, CenterY = wheelY }; turning.RenderTransform = _wheelTurn;
            var root = C; C = turning;
            var rim = new Ellipse { Width = wheelR * 2, Height = wheelR * 2, Stroke = B(Mix(steel, P(1), 0.6)), StrokeThickness = Math.Max(2, S(0.005)) }; At(rim, wheelX - wheelR, wheelY - wheelR); C.Children.Add(rim);
            var rim2 = new Ellipse { Width = wheelR * 1.72, Height = wheelR * 1.72, Stroke = B(Mix(steel, P(1), 0.2)), StrokeThickness = Math.Max(1, S(0.002)) }; At(rim2, wheelX - wheelR * 0.86, wheelY - wheelR * 0.86); C.Children.Add(rim2);
            for (var i = 0; i < 12; i++) { var a = i * Math.PI / 6; L(wheelX, wheelY, wheelX + Math.Cos(a) * wheelR, wheelY + Math.Sin(a) * wheelR, Mix(steel, P(1), 0.45), Math.Max(1, S(0.0018))); }
            for (var i = 0; i < 24; i++)
            {
                var a = i * Math.PI / 12; var band = i / 23.0;
                _cabins.Add((Glow(wheelX + Math.Cos(a) * wheelR, wheelY + Math.Sin(a) * wheelR, wheelR * 0.26, Mix(HueAt(band), White, 0.3), 1, 0.5), band));
            }
            C = root;
            _wheelHub = Glow(wheelX, wheelY, wheelR * 0.5, P(3), 0.9, 0.6);
        }

        // ---- the water's surface over the reflections: dark ripples that break them up, glints that follow the bands, the ferry
        var ripple = B(Color.FromArgb(255, 0x08, 0x08, 0x16));
        for (var i = 0; i < 120; i++)
        {
            var depth = Math.Pow(rng.NextDouble(), 1.6); var y = wy + S(0.014) + depth * (H - wy - S(0.02)); var w = S(0.02 + 0.09 * rng.NextDouble()) * (0.6 + depth);
            _ripples.Add((Box(0, y, w, Math.Max(1, S(0.002 + 0.003 * depth)), ripple, 0.7 + 0.25 * depth), rng.NextDouble(), y, w, (0.01 + 0.03 * depth) * (rng.NextDouble() < 0.5 ? 1 : -1)));
        }
        for (var i = 0; i < 44; i++)
        {
            var fx = rng.NextDouble(); var depth = rng.NextDouble();
            _glints.Add((Box(X(fx), wy + S(0.014) + depth * (H - wy) * 0.8, S(0.008 + 0.02 * rng.NextDouble()), Math.Max(1, S(0.002)), B(Mix(HueAt(fx), White, 0.4)), 0), fx, rng.NextDouble() * 6));
        }
        {
            var boat = new Canvas(); C.Children.Add(boat); _boatAt = new TranslateTransform(); boat.RenderTransform = _boatAt;
            var root = C; C = boat; var by = Y(0.905); var s = S(0.012);
            Glow(0, by + s * 1.6, s * 14, Cream, 0.3, 0.6).Height = s * 3;
            G(Color.FromArgb(255, 0x0A, 0x0B, 0x16), 1, -s * 6, by - s * 0.9, s * 6.6, by - s * 0.9, s * 5.4, by + s * 0.5, -s * 5.2, by + s * 0.5);
            Box(-s * 4, by - s * 2.3, s * 7.2, s * 1.5, B(Color.FromArgb(255, 0x12, 0x14, 0x22))); Box(-s * 2.4, by - s * 3.3, s * 3.2, s * 1.1, B(Color.FromArgb(255, 0x12, 0x14, 0x22)));
            for (var i = 0; i < 6; i++) Box(-s * 3.5 + i * s * 1.15, by - s * 1.95, s * 0.7, s * 0.7, B(Cream), 0.95);
            Glow(s * 6.2, by - s * 1.1, s * 1.6, Color.FromArgb(255, 0x60, 0xFF, 0x90), 1, 0.9); Glow(-s * 5.6, by - s * 1.1, s * 1.6, Color.FromArgb(255, 0xFF, 0x50, 0x48), 1, 0.9);
            C = root;
        }
        Vignette(0.3);
    }

    public override void Frame(TableauFrame f)
    {
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed; var wy = _waterY;
        Twinkle(_stars, f, 0.35);

        // ---- the beat: a flare that decays, and a wave of light that runs the waterfront
        _sinceBeat += dt;
        if (f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBeat > 0.2 && !f.Reduced) { _sinceBeat = 0; _sweep = -0.1; }
        _prevBeat = f.Beat;
        if (f.Beat > 0.03) _flare = Math.Max(_flare, Clamp01(f.Beat * 2.2) * (f.Reduced ? 0.3 : 1));
        _flare *= Math.Exp(-dt * 4.5);
        if (_sweep < 1.5) _sweep += dt * 1.9;
        _idlePh += dts * 0.9;

        Op(_skyGlow, 0.45 + 0.35 * f.Loud + 0.3 * _flare); Op(_haze, 0.5 + 0.5 * f.Low); Op(_shore, 0.35 + 0.4 * f.Loud + 0.3 * _flare);
        Op(_moonHalo, 0.7 + 0.3 * f.High);
        _cloud += dts * 0.004;
        for (var i = 0; i < _clouds.Count; i++)
        {
            var (c, x, y, d, ph) = _clouds[i];
            var fx = (x + _cloud * (0.6 + 0.15 * (i % 3)) + 0.3) % 1.4 - 0.2;
            Size(c, X(fx), Y(y) + Math.Sin(_idlePh * 0.2 + ph) * S(0.004), d * 2.4 * (1 + 0.08 * f.Low), d * 0.5);
            Op(c, 0.16 + 0.22 * f.Low + 0.12 * _flare);
        }

        // ---- the towers: each follows its band, quick up and slow down; the peak line holds, then falls
        for (var i = 0; i < _towers.Count; i++)
        {
            var t = _towers[i];
            var wave = Math.Exp(-Math.Pow(((t.X + t.W / 2) / W - _sweep) / 0.07, 2));
            var idle = f.Reduced ? 0.26 + 0.16 * Math.Sin(_idlePh + t.X / W * 7) : 0;
            var target = Clamp01(Math.Max(idle, 0.1 + 0.9 * Clamp01(Lv(f, t.Band) * 1.15 + 0.12 * _flare) + 0.22 * wave));
            t.Lv += (target - t.Lv) * (target > t.Lv ? 0.5 : 0.14);
            if (t.Lv > t.Pk) t.Pk = t.Lv; else t.Pk = Math.Max(t.Lv, t.Pk - dt * 0.22);
            var lit = t.H * t.Lv;
            t.Clip.Rect = new Rc(t.X, t.Top + t.H - lit, t.W, lit);
            if (t.Peak is { } pk) Canvas.SetTop(pk, t.Top + t.H * (1 - t.Pk) - pk.Height);
            if (t.Neon is { } neon) Op(neon, 0.2 + 0.6 * t.Lv + 0.4 * _flare);
            if (t.Crown is { } crown) Op(crown, 0.1 + 0.35 * t.Lv + 0.6 * _flare);
            if (t.Refl is { } refl) { refl.Height = Math.Max(2, Math.Min(H - wy - S(0.012), lit * 0.5)); Op(refl, 0.35 + 0.6 * t.Lv); }
        }

        // ---- beacons: a slow blink, a flash on the beat; the searchlights sweep with the mids
        _blink += dts * 2.2;
        var blink = Math.Max(_flare, 0.25 + 0.5 * Math.Pow(0.5 + 0.5 * Math.Sin(_blink), 6));
        for (var i = 0; i < _beacons.Count; i++) Op(_beacons[i], blink);
        for (var i = 0; i < _beams.Count; i++)
        {
            var (p, rt, rest, swing, ph, rate) = _beams[i];
            ph += dts * rate * (0.5 + 1.2 * f.Mid); _beams[i] = (p, rt, rest, swing, ph, rate);
            rt.Angle = rest + swing * Math.Sin(ph);
            Op(p, f.Reduced ? 0.16 : 0.2 + 0.4 * f.High + 0.4 * _flare);
        }

        // ---- the waterfront: cars, the wheel
        for (var i = 0; i < _cars.Count; i++)
        {
            var c = _cars[i];
            var x = c.x + (c.right ? 1 : -1) * c.v * (0.5 + f.Loud) * dts;
            if (x > 1.05) x = -0.05; if (x < -0.05) x = 1.05;
            _cars[i] = (c.car, x, c.v, c.right);
            Size(c.car, X(x), wy - S(c.right ? 0.004 : 0.009), S(0.009 + 0.004 * f.Loud));
        }
        _wheelPh += dts * (3 + 12 * f.Loud); _wheelTurn.Angle = _wheelPh % 360;
        for (var i = 0; i < _cabins.Count; i++) Op(_cabins[i].cab, 0.3 + 0.7 * Clamp01(Lv(f, _cabins[i].band) * 1.2 + 0.4 * _flare));
        Op(_wheelHub, 0.35 + 0.3 * f.Loud + 0.5 * _flare); Op(_wheelRefl, 0.2 + 0.35 * f.Loud + 0.3 * _flare);

        // ---- the water: ripples drift, glints follow their bands, the lamps' streaks shimmer, the ferry crosses
        _rip += dts;
        for (var i = 0; i < _ripples.Count; i++)
        {
            var (r, x, y, w, v) = _ripples[i];
            var fx = ((x + _rip * v) % 1.2 + 1.2) % 1.2 - 0.1;
            At(r, X(fx) - w / 2, y);
        }
        for (var i = 0; i < _glints.Count; i++)
        {
            var (r, band, ph) = _glints[i];
            Op(r, Clamp01(Lv(f, band) * 1.1 + 0.3 * _flare) * (0.35 + 0.65 * Osc(_rip, 2.2 + i % 5 * 0.6, ph)));
        }
        for (var i = 0; i < _lampRefl.Count; i++) Op(_lampRefl[i].r, 0.3 + 0.35 * Osc(_rip, 1.7, _lampRefl[i].ph));
        _boat = (_boat + dts * 0.012) % 1.3;
        _boatAt.X = X(_boat - 0.15); _boatAt.Y = Math.Sin(_rip * 0.9) * S(0.002);
    }
}
