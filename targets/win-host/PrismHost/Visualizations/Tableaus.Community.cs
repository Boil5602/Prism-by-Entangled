using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;

namespace PrismHost.Visualizations;

// =============================================================== COMMUNITY (see Tableaus.cs for the toolkit)

/// <summary>Friends around a fire under the pines: layered flames with a bright core, a glow that reaches the faces and the tents, sparks with tails on the beat, the whole circle breathing with the lows.</summary>
public sealed class CampfireCircle : Tableau
{
    private readonly List<Polygon> _flames = new();
    private readonly List<Ellipse> _faces = new();
    private Ellipse _glow = null!, _core = null!;
    private Rectangle _ground = null!;
    private readonly List<(Ellipse s, double x, double y, double vy, double drift, double born, bool live)> _sparks = new();
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x04, 0x06, 0x10), 0), (Color.FromArgb(255, 0x0E, 0x0A, 0x12), 0.7), (Color.FromArgb(255, 0x14, 0x0C, 0x0A), 1));
        Stars(70, 0.45, White);
        var rng = new Random(91);
        for (var i = 0; i < 14; i++) { var x = X(rng.NextDouble()); var hgt = S(0.3 + rng.NextDouble() * 0.25); Pine(x, Y(0.82) - hgt, S(0.05), hgt, i % 2 == 0 ? Ink2 : Ink); }
        // two tents at the back, lit from the fire
        foreach (var (fx, sz) in new[] { (0.12, 0.13), (0.86, 0.11) })
        {
            var x = X(fx); var y = Y(0.82); var s = S(sz);
            G(Ink3, 1, x - s, y, x, y - s * 0.9, x + s, y);
            G(Mix(Ink3, P(0), 0.35), 1, x - s * 0.25, y, x, y - s * 0.55, x + s * 0.25, y);   // the lit doorway
        }
        _ground = RB(0, Y(0.8), W, S(0.2), Vertical((Color.FromArgb(255, 0x1A, 0x12, 0x0C), 0), (Ink, 1)));
        _glow = Glow(X(0.5), Y(0.8), W * 0.55, P(0), 0.45);
        // the circle: shoulders and heads, near ones larger, all lit from the fire's side
        _faces.Clear();
        foreach (var (fx, fy, sz) in new[] { (0.2, 0.86, 0.09), (0.32, 0.9, 0.11), (0.68, 0.9, 0.11), (0.8, 0.86, 0.09), (0.44, 0.94, 0.12), (0.56, 0.94, 0.12) })
        {
            var x = X(fx); var y = Y(fy); var s = S(sz);
            G(Ink2, 1, x - s * 0.7, y, x - s * 0.62, y - s * 0.55, x - s * 0.3, y - s * 0.7, x + s * 0.3, y - s * 0.7, x + s * 0.62, y - s * 0.55, x + s * 0.7, y);
            E(x, y - s * 0.92, s * 0.42, Ink2);
            _faces.Add(Glow(x + (fx < 0.5 ? s * 0.12 : -s * 0.12), y - s * 0.92, s * 0.5, P(0), 0.6, 0.4));
        }
        // logs and stones
        for (var i = 0; i < 9; i++) { var a = i * Math.PI * 2 / 9; E(X(0.5) + Math.Cos(a) * S(0.11), Y(0.87) + Math.Sin(a) * S(0.035), S(0.028), Ink3); }
        G(Color.FromArgb(255, 0x34, 0x20, 0x14), 1, X(0.44), Y(0.87), X(0.57), Y(0.84), X(0.585), Y(0.865), X(0.455), Y(0.895));
        G(Color.FromArgb(255, 0x2A, 0x18, 0x10), 1, X(0.42), Y(0.845), X(0.55), Y(0.88), X(0.54), Y(0.905), X(0.41), Y(0.87));
        _flames.Clear();
        for (var i = 0; i < 6; i++) _flames.Add(GB(Vertical((A(i < 2 ? P(2) : P(0), 0.9), 0), (A(P(1), 0.85), 0.55), (A(P(1), 0.0), 1)), 0.9));
        _core = Glow(X(0.5), Y(0.85), S(0.1), Mix(P(2), White, 0.5), 1, 0.9);
        _sparks.Clear();
        for (var i = 0; i < 48; i++) _sparks.Add((Glow(0, 0, S(0.012), P(2), 1, 0), 0, 0, 0, 0, 0, false));
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        Size(_glow, X(0.5), Y(0.82), W * (0.45 + 0.3 * f.Low + 0.1 * f.Beat), S(0.7 + 0.3 * f.Low));
        Op(_glow, 0.5 + 0.5 * f.Low);
        for (var i = 0; i < _faces.Count; i++) Op(_faces[i], 0.25 + 0.5 * f.Low + 0.2 * Osc(f.T * f.Speed, 5 + i, i));
        var cx = X(0.5); var baseY = Y(0.86);
        for (var i = 0; i < _flames.Count; i++)
        {
            var g = _flames[i];
            var hgt = S(0.1 + 0.28 * Lv(f, 0.25 + 0.12 * i) + 0.1 * f.High) * (1 - i * 0.1);
            var wd = S(0.06 - i * 0.007);
            var lean = Math.Sin(f.T * (3.5 + i * 0.7) * f.Speed + i * 1.3) * wd * 0.7;
            var lean2 = Math.Sin(f.T * (7 + i) * f.Speed) * wd * 0.25;
            Pts(g, cx - wd, baseY, cx - wd * 0.55 + lean * 0.3, baseY - hgt * 0.45, cx + lean + lean2, baseY - hgt, cx + wd * 0.55 + lean * 0.3, baseY - hgt * 0.45, cx + wd, baseY);
        }
        Size(_core, cx, Y(0.855), S(0.08 + 0.08 * f.Mid), S(0.12 + 0.12 * f.Mid));
        if (f.Beat > 0.05)
        {
            var launch = 0;
            for (var i = 0; i < _sparks.Count && launch < 6; i++)
                if (!_sparks[i].live) { _sparks[i] = (_sparks[i].s, 0.47 + Rng.NextDouble() * 0.06, 0.84, 0.15 + Rng.NextDouble() * 0.25, (Rng.NextDouble() - 0.5) * 0.08, f.T, true); launch++; }
        }
        for (var i = 0; i < _sparks.Count; i++)
        {
            var s = _sparks[i];
            if (!s.live) continue;
            var age = (f.T - s.born) / 1.8;
            if (age >= 1) { Op(s.s, 0); _sparks[i] = (s.s, s.x, s.y, s.vy, s.drift, s.born, false); continue; }
            var y = s.y - age * s.vy * 2.2; var x = s.x + s.drift * age + Math.Sin(age * 10 + i) * 0.015;
            Size(s.s, X(x), Y(y), S(0.006 + 0.01 * (1 - age)));
            Op(s.s, (1 - age) * (0.7 + 0.3 * Osc(f.T, 25, i)));
        }
    }
}

/// <summary>A city at night in three depths: far towers in haze, near blocks with rooftop tanks and antennas, every window a band, beacons on the beat, headlights sliding along the street below.</summary>
public sealed class CitySkyline : Tableau
{
    private readonly List<(Rectangle win, double band)> _windows = new();
    private readonly List<Ellipse> _beacons = new();
    private readonly List<(Ellipse car, double x, double v, bool right)> _cars = new();
    private Ellipse[] _stars = Array.Empty<Ellipse>();
    private Rectangle _streetGlow = null!;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x05, 0x07, 0x12), 0), (Color.FromArgb(255, 0x14, 0x12, 0x24), 0.7), (Color.FromArgb(255, 0x2A, 0x1E, 0x2A), 1));
        _stars = Stars(60, 0.4, White);
        Glow(X(0.2), Y(0.16), S(0.3), White, 0.2); E(X(0.2), Y(0.16), S(0.08), White, 0.85);
        var rng = new Random(101);
        // far towers: hazy, with dim window dots
        double x = -S(0.05);
        while (x < W)
        {
            var bw = S(0.06 + rng.NextDouble() * 0.12); var bh = S(0.2 + rng.NextDouble() * 0.5);
            RB(x, Y(0.9) - bh, bw, bh, Vertical((Mix(Ink2, Haze, 0.55), 0), (Mix(Ink2, Haze, 0.3), 1)));
            x += bw + S(0.01);
        }
        HorizonGlow(0.9, 0.5, P(0), 0.12);
        _windows.Clear(); _beacons.Clear();
        x = 0;
        var b = 0;
        while (x < W)
        {
            var bw = S(0.14 + rng.NextDouble() * 0.22); var bh = S(0.28 + rng.NextDouble() * 0.5); var top = H - bh;
            RB(x, top, bw, bh, Vertical((b % 2 == 0 ? Ink2 : Ink3, 0), (Ink, 1)));
            // rooftop: a water tank or an antenna
            if (rng.NextDouble() < 0.5) { R(x + bw * 0.6, top - S(0.05), S(0.035), S(0.05), Ink2); R(x + bw * 0.6 - S(0.005), top - S(0.052), S(0.045), S(0.008), Ink2); }
            else { R(x + bw * 0.3, top - S(0.09), S(0.004), S(0.09), Ink3); _beacons.Add(Glow(x + bw * 0.3 + S(0.002), top - S(0.09), S(0.025), P(3), 1, 0.5)); }
            var cols = Math.Max(2, (int)(bw / S(0.04))); var rows = Math.Max(2, (int)(bh / S(0.06)));
            for (var r = 0; r < rows; r++)
                for (var c = 0; c < cols; c++)
                {
                    if (rng.NextDouble() < 0.22) continue;
                    var band = x / W * 0.7 + r / (double)rows * 0.3;
                    _windows.Add((R(x + bw * (c + 0.25) / cols, top + bh * (r + 0.25) / rows, bw / cols * 0.5, bh / rows * 0.45, P((b + r) % Pal.Length), 0.3, 1), band));
                }
            x += bw + S(0.012); b++;
        }
        _streetGlow = RB(0, Y(0.94), W, S(0.06), Vertical((A(P(0), 0.25), 0), (A(P(0), 0), 1)));
        _cars.Clear();
        for (var i = 0; i < 10; i++) { var right = i % 2 == 0; _cars.Add((Glow(0, 0, S(0.02), right ? White : P(3), 1, 0.9), rng.NextDouble(), 0.05 + rng.NextDouble() * 0.08, right)); }
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        Twinkle(_stars, f, 0.35);
        for (var i = 0; i < _windows.Count; i++)
        {
            var (win, band) = _windows[i];
            var lvl = Lv(f, band);
            Op(win, 0.1 + 0.8 * lvl * (0.7 + 0.3 * Osc(f.T, 0.5, i)));
        }
        var blink = f.Beat > 0.05 ? 1.0 : 0.2 + 0.3 * Osc(f.T * f.Speed, 2);
        foreach (var bc in _beacons) Op(bc, blink);
        Op(_streetGlow, 0.4 + 0.6 * f.Loud);
        for (var i = 0; i < _cars.Count; i++)
        {
            var c = _cars[i];
            var x = c.x + (c.right ? 1 : -1) * c.v * (0.5 + f.Loud) * f.Speed * f.Dt;
            if (x > 1.05) x = -0.05; if (x < -0.05) x = 1.05;
            _cars[i] = (c.car, x, c.v, c.right);
            Size(c.car, X(x), Y(c.right ? 0.965 : 0.98), S(0.014 + 0.01 * f.Loud));
        }
    }
}

/// <summary>Lanterns rising over a festival: bunting overhead, a pagoda roofline, a crowd of heads and raised hands, every lantern a soft warm body with a glow that answers its band.</summary>
public sealed class LanternFestival : Tableau
{
    private readonly List<(Rectangle body, Ellipse glow, Ellipse flame, double x, double y, double v, double ph, int band)> _lanterns = new();
    private readonly List<Ellipse> _heads = new();
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x06, 0x05, 0x12), 0), (Color.FromArgb(255, 0x1E, 0x10, 0x1E), 0.75), (Color.FromArgb(255, 0x2A, 0x14, 0x1A), 1));
        Stars(60, 0.5, White);
        HorizonGlow(0.82, 0.6, P(1), 0.18);
        // a pagoda on the far right, a temple gate on the left
        var px = X(0.86); var py = Y(0.84);
        for (var t = 0; t < 3; t++)
        {
            var wd = S(0.2 - t * 0.04); var yb = py - S(0.12) * t;
            R(px - wd * 0.35, yb - S(0.1), wd * 0.7, S(0.1), Ink2);
            G(Ink, 1, px - wd * 0.6, yb - S(0.1), px - wd * 0.5, yb - S(0.15), px, yb - S(0.19), px + wd * 0.5, yb - S(0.15), px + wd * 0.6, yb - S(0.1));
        }
        var gx = X(0.12);
        R(gx - S(0.09), Y(0.5), S(0.02), S(0.34), Ink2); R(gx + S(0.07), Y(0.5), S(0.02), S(0.34), Ink2);
        G(Ink, 1, gx - S(0.14), Y(0.52), gx - S(0.12), Y(0.47), gx + S(0.12), Y(0.47), gx + S(0.14), Y(0.52)); R(gx - S(0.11), Y(0.56), S(0.22), S(0.015), Ink);
        // bunting: two strings of little flags
        for (var s = 0; s < 2; s++)
            for (var i = 0; i < 30; i++)
            {
                var fx = i / 29.0; var sag = Math.Sin(fx * Math.PI) * 0.06;
                var x = X(fx); var y = Y(0.08 + s * 0.09 + sag);
                G(P((i + s) % Pal.Length), 0.7, x - S(0.012), y, x + S(0.012), y, x, y + S(0.03));
            }
        _lanterns.Clear();
        var rng = new Random(111);
        for (var i = 0; i < 40; i++)
        {
            var band = i % Pal.Length; var d = S(0.035 + rng.NextDouble() * 0.045);
            var glow = Glow(0, 0, d * 3.2, P(band), 0.6, 0.5);
            var body = RB(0, 0, d * 0.75, d, Vertical((A(P(band), 0.95), 0), (A(Mix(P(band), White, 0.4), 0.95), 0.5), (A(P(band), 0.95), 1)), 0.85);
            body.RadiusX = body.RadiusY = d * 0.3;
            var flame = Glow(0, 0, d * 0.5, White, 0.9, 0.8);
            _lanterns.Add((body, glow, flame, rng.NextDouble(), 0.25 + rng.NextDouble() * 0.85, 0.02 + rng.NextDouble() * 0.03, rng.NextDouble() * 6, band));
        }
        // the crowd: shoulders as a ridge, heads as a row of ellipses, a few raised arms
        Ridge(Ink2, Ink, 0.9, 0.02, 0.08, 40, 113, 0.3);
        _heads.Clear();
        for (var i = 0; i < 46; i++)
        {
            var x = X(i / 45.0 + (rng.NextDouble() - 0.5) * 0.015); var s = S(0.03 + rng.NextDouble() * 0.015);
            G(Ink, 1, x - s * 1.3, Y(0.94), x - s * 1.1, Y(0.94) - s * 1.1, x + s * 1.1, Y(0.94) - s * 1.1, x + s * 1.3, Y(0.94));
            _heads.Add(E(x, Y(0.94) - s * 1.6, s, Ink));
            if (rng.NextDouble() < 0.25) L(x + s * 0.8, Y(0.94) - s * 1.2, x + s * 1.6, Y(0.94) - s * 3.2, Ink, s * 0.4);
        }
        R(0, Y(0.94), W, S(0.06), Ink);
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        for (var i = 0; i < _lanterns.Count; i++)
        {
            var l = _lanterns[i];
            var y = l.y - l.v * f.Speed * f.Dt * (0.4 + f.Loud);
            if (y < -0.12) { y = 1.0; l.x = Rng.NextDouble(); }
            _lanterns[i] = (l.body, l.glow, l.flame, l.x, y, l.v, l.ph, l.band);
            var x = l.x + Math.Sin(f.T * 0.35 * f.Speed + l.ph) * 0.025;
            var lvl = Lv(f, (l.band + 0.5) / Pal.Length);
            var bx = X(x) - l.body.Width / 2; var by = Y(y) - l.body.Height / 2;
            At(l.body, bx, by);
            Op(l.body, 0.55 + 0.45 * lvl);
            Size(l.glow, X(x), Y(y), l.body.Height * (2.4 + 1.8 * lvl + 0.8 * f.Beat));
            Op(l.glow, 0.2 + 0.5 * lvl);
            Size(l.flame, X(x), Y(y) + l.body.Height * 0.15, l.body.Height * (0.3 + 0.2 * Osc(f.T * f.Speed, 9, i)));
        }
    }
}

/// <summary>Fireworks over a town: a shell climbs on each beat and bursts into a bloom of glowing sparks that fall and fade; rooftops and a church spire below, their windows warm, smoke hanging where the bursts were.</summary>
public sealed class FireworksNight : Tableau
{
    private sealed class Burst { public Ellipse[] Dots = Array.Empty<Ellipse>(); public Ellipse Shell = null!, Smoke = null!; public double X, Y, Born = -10, Size; public bool Live; public int Band; }
    private readonly List<Burst> _bursts = new();
    private readonly List<Ellipse> _windows = new();
    private double _lastIdle;
    private const int Dots = 26;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x04, 0x05, 0x10), 0), (Color.FromArgb(255, 0x12, 0x0E, 0x22), 0.7), (Color.FromArgb(255, 0x1E, 0x14, 0x1E), 1));
        Stars(50, 0.5, White);
        _bursts.Clear();
        for (var b = 0; b < 8; b++)
        {
            var burst = new Burst { Dots = new Ellipse[Dots], Smoke = Glow(0, 0, S(0.2), Haze, 0.5, 0), Shell = Glow(0, 0, S(0.02), White, 1, 0) };
            for (var i = 0; i < Dots; i++) burst.Dots[i] = Glow(0, 0, S(0.02), P(b % Pal.Length), 1, 0);
            _bursts.Add(burst);
        }
        Ridge(Mix(Ink2, Haze, 0.4), Ink2, 0.88, 0.03, 0.14, 24, 121, 0.7);
        // the town: gabled roofs, a spire, lit windows
        var rng = new Random(123);
        double x = 0;
        _windows.Clear();
        while (x < W)
        {
            var hw = S(0.1 + rng.NextDouble() * 0.12); var hh = S(0.08 + rng.NextDouble() * 0.08); var top = Y(0.96) - hh;
            R(x, top, hw, hh, Ink); G(Ink, 1, x - hw * 0.05, top, x + hw / 2, top - hh * 0.7, x + hw * 1.05, top);
            for (var c = 0; c < 1 + (int)(hw / S(0.07)); c++) _windows.Add(Glow(x + hw * (c + 0.5) / (1 + (int)(hw / S(0.07))), top + hh * 0.5, S(0.03), P(0), 1, 0.6));
            x += hw + S(0.02);
        }
        var sx = X(0.62); R(sx - S(0.02), Y(0.66), S(0.04), S(0.3), Ink); G(Ink, 1, sx - S(0.03), Y(0.66), sx, Y(0.54), sx + S(0.03), Y(0.66));
        R(0, Y(0.96), W, S(0.04), Ink);
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        for (var i = 0; i < _windows.Count; i++) Op(_windows[i], 0.4 + 0.4 * Osc(f.T, 0.4, i) + 0.2 * f.Low);
        // idle carries no beat (§2.5.2 point 6 wants a drift, not an empty sky): one slow shell every few seconds
        var idleLaunch = f.T - _lastIdle > 3.5 + Rng.NextDouble() * 3;
        if (f.Beat > 0.05 || idleLaunch)
        {
            _lastIdle = f.T;
            foreach (var b in _bursts)
            {
                if (b.Live) continue;
                b.Live = true; b.Born = f.T; b.X = 0.12 + Rng.NextDouble() * 0.76; b.Y = 0.12 + Rng.NextDouble() * 0.38; b.Size = S(0.12 + 0.3 * Math.Min(1, f.Beat * 2)); b.Band = Rng.Next(Pal.Length);
                foreach (var d in b.Dots) d.Fill = Radial(P(b.Band), 1);
                break;
            }
        }
        foreach (var b in _bursts)
        {
            if (!b.Live) continue;
            var age = (f.T - b.Born) / 2.2;
            if (age >= 1) { b.Live = false; foreach (var d in b.Dots) Op(d, 0); Op(b.Shell, 0); Op(b.Smoke, 0); continue; }
            if (age < 0.25)
            {
                // the climb: a shell from the rooftops to the burst point
                var t = age / 0.25;
                Size(b.Shell, X(b.X) + Math.Sin(t * 6) * S(0.01), Y(0.88) - (Y(0.88) - Y(b.Y)) * (1 - (1 - t) * (1 - t)), S(0.012 + 0.01 * (1 - t)));
                Op(b.Shell, 0.9);
                foreach (var d in b.Dots) Op(d, 0);
                continue;
            }
            Op(b.Shell, 0);
            var a2 = (age - 0.25) / 0.75;
            var r = b.Size * Math.Sqrt(a2); var fall = a2 * a2 * S(0.12);
            for (var i = 0; i < Dots; i++)
            {
                var an = i * Math.PI * 2 / Dots + (i % 2) * 0.12;
                var rr = r * (0.85 + 0.15 * (i % 3) / 2.0);
                Size(b.Dots[i], X(b.X) + Math.Cos(an) * rr, Y(b.Y) + Math.Sin(an) * rr + fall, S(0.008 + 0.018 * (1 - a2)));
                Op(b.Dots[i], (1 - a2) * (0.6 + 0.4 * Osc(f.T, 18, i)));
            }
            Size(b.Smoke, X(b.X), Y(b.Y) + fall * 0.5, b.Size * (1.2 + a2));
            Op(b.Smoke, a2 * (1 - a2) * 0.5);
        }
    }
}

/// <summary>A harbor at night: a lighthouse whose beam fades along its length sweeps the water, boats with masts bob on the swell, a pier of lamps mirrored in the sea, buoys blinking, a town across the bay.</summary>
public sealed class HarborLights : Tableau
{
    private Polygon _beam = null!;
    private readonly List<(Polygon hull, Line mast, Ellipse lamp, Rectangle reflect, double x, double ph, int band, double size)> _boats = new();
    private readonly List<(Ellipse lamp, Rectangle reflect, int band)> _pier = new();
    private readonly List<Polyline> _waves = new();
    private readonly List<Ellipse> _buoys = new();
    private Ellipse _lampTop = null!, _lampGlow = null!;
    protected override void OnBuild()
    {
        Sky(0, 0.58, (Color.FromArgb(255, 0x04, 0x07, 0x12), 0), (Color.FromArgb(255, 0x0C, 0x18, 0x2A), 0.85), (Color.FromArgb(255, 0x18, 0x24, 0x38), 1));
        Stars(60, 0.5, White);
        Ridge(Mix(Ink2, Haze, 0.35), Ink2, 0.58, 0.02, 0.07, 30, 131, 0.5);
        var rng = new Random(133);
        for (var i = 0; i < 26; i++) E(X(rng.NextDouble() * 0.7), Y(0.53 + rng.NextDouble() * 0.04), S(0.006), P(0), 0.6);   // the town's windows
        Sky(0.58, 1, (Color.FromArgb(255, 0x0A, 0x1A, 0x2C), 0), (Color.FromArgb(255, 0x05, 0x0C, 0x18), 0.5), (Color.FromArgb(255, 0x02, 0x05, 0x0C), 1));
        _beam = GB(new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(1, 0.5), EndPoint = new Windows.Foundation.Point(0, 0.5), GradientStops = { new GradientStop { Color = A(P(0), 0.5), Offset = 0 }, new GradientStop { Color = A(P(0), 0), Offset = 1 } } }, 1, 0, 0, 0, 0, 0, 0);
        // the lighthouse on its rock
        G(Ink, 1, X(0.8), Y(0.62), X(0.86), Y(0.55), X(0.92), Y(0.6), X(0.96), Y(0.62));
        RB(X(0.855), Y(0.3), S(0.04), S(0.27), Vertical((Ink3, 0), (Ink, 1)));
        for (var i = 0; i < 3; i++) R(X(0.855), Y(0.36 + i * 0.07), S(0.04), S(0.02), White, 0.25);
        R(X(0.85), Y(0.28), S(0.05), S(0.025), Ink); G(Ink, 1, X(0.848), Y(0.28), X(0.875), Y(0.25), X(0.902), Y(0.28));
        _lampGlow = Glow(X(0.875), Y(0.295), S(0.12), P(0), 0.6);
        _lampTop = Glow(X(0.875), Y(0.295), S(0.03), Mix(P(0), White, 0.5), 1, 0.95);
        // the pier, left, with lamps and their reflections
        R(0, Y(0.66), W * 0.32, S(0.012), Ink2);
        for (var i = 0; i < 5; i++) R(X(0.04 + i * 0.065), Y(0.67), S(0.008), S(0.06), Ink2);
        _pier.Clear();
        for (var i = 0; i < 4; i++)
        {
            var x = X(0.06 + i * 0.08); R(x - S(0.002), Y(0.58), S(0.004), S(0.08), Ink2);
            _pier.Add((Glow(x, Y(0.58), S(0.06), P(i % Pal.Length), 1, 0.7), RB(x - S(0.008), Y(0.67), S(0.016), S(0.2), Vertical((A(P(i % Pal.Length), 0.45), 0), (A(P(i % Pal.Length), 0), 1)), 0.6), i % Pal.Length));
        }
        _boats.Clear();
        for (var i = 0; i < 6; i++)
        {
            var s = S(0.035 + rng.NextDouble() * 0.03); var band = i % Pal.Length;
            var hull = G(Ink2, 1, -s * 1.5, 0, s * 1.5, 0, s * 1.1, s * 0.5, -s * 1.0, s * 0.5);
            var mast = L(0, 0, 0, 0, Ink3, s * 0.12);
            var lamp = Glow(0, 0, s, P(band), 1, 0.9);
            var refl = RB(0, 0, s * 0.35, s * 3, Vertical((A(P(band), 0.4), 0), (A(P(band), 0), 1)), 0.5);
            _boats.Add((hull, mast, lamp, refl, 0.36 + rng.NextDouble() * 0.36, rng.NextDouble() * 6, band, s));
        }
        _buoys.Clear();
        for (var i = 0; i < 3; i++) _buoys.Add(Glow(X(0.3 + i * 0.22), Y(0.78 + i * 0.05), S(0.02), P(3), 1, 0.5));
        _waves.Clear();
        for (var k = 0; k < 4; k++) _waves.Add(PL(B(A(k == 3 ? White : P(2), 0.15 + k * 0.08)), S(0.0015 + k * 0.001)));
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        var sweep = f.T * 0.55 * f.Speed;
        var ax = X(0.875); var ay = Y(0.3);
        var ang = Math.PI - 0.08 - Osc(sweep, 1) * 0.5;   // sin(pi - t) > 0: down the screen, across the water
        var len = W * 0.95; var half = 0.06 + 0.04 * f.Loud;
        Pts(_beam, ax, ay, ax + Math.Cos(ang - half) * len, ay + Math.Sin(ang - half) * len, ax + Math.Cos(ang + half) * len, ay + Math.Sin(ang + half) * len);
        Op(_beam, 0.45 + 0.55 * f.Loud);
        Op(_lampGlow, 0.5 + 0.5 * f.High); Size(_lampGlow, ax, ay, S(0.1 + 0.08 * f.High));
        for (var i = 0; i < _pier.Count; i++)
        {
            var lvl = Lv(f, (_pier[i].band + 0.5) / Pal.Length);
            Op(_pier[i].lamp, 0.45 + 0.55 * lvl); Op(_pier[i].reflect, 0.3 + 0.5 * lvl * Osc(f.T, 5, i));
        }
        for (var i = 0; i < _boats.Count; i++)
        {
            var b = _boats[i];
            var bob = Math.Sin(f.T * 1.1 * f.Speed + b.ph) * S(0.006 + 0.025 * f.Low);
            var x = X(b.x) + Math.Sin(f.T * 0.15 * f.Speed + b.ph) * S(0.02); var y = Y(0.72 + i * 0.035) + bob;
            At(b.hull, x, y);
            // B-135: the boat's own size, never the lamp's current width - reading the width back and scaling it again
            // compounded every frame (x1.3 to x2.1) until the mast's end was infinite ~30 s in, and XAML refused it
            var s = b.size;
            b.mast.X1 = x; b.mast.Y1 = y; b.mast.X2 = x + bob * 0.3; b.mast.Y2 = y - s * 2.2;
            var lvl = Lv(f, (b.band + 0.5) / Pal.Length);
            Size(b.lamp, b.mast.X2, b.mast.Y2, s * (1.3 + 0.8 * lvl));
            Op(b.lamp, 0.5 + 0.5 * lvl);
            At(b.reflect, x - b.reflect.Width / 2, y + s * 0.5); Op(b.reflect, 0.25 + 0.4 * lvl * Osc(f.T, 4, i));
        }
        for (var i = 0; i < _buoys.Count; i++) Op(_buoys[i], Osc(f.T * f.Speed, 1.5, i * 2) > 0.85 ? 1 : 0.15);
        for (var k = 0; k < _waves.Count; k++)
        {
            var pl = _waves[k]; pl.Points.Clear();
            var baseY = Y(0.68 + k * 0.09);
            for (var i = 0; i <= 40; i++)
                pl.Points.Add(new Windows.Foundation.Point(X(i / 40.0), baseY + Math.Sin(i * 0.55 + f.T * (0.7 + k * 0.25) * f.Speed) * S(0.004 + 0.022 * f.Low)));
        }
    }
}

/// <summary>A night train crossing the plain: a locomotive with a headlight cone and a plume of smoke, lit carriages, a trestle bridge, poles and hills sliding past at the music's speed.</summary>
public sealed class NightTrain : Tableau
{
    private readonly List<(Rectangle car, Rectangle roof, Ellipse[] wins)> _cars = new();
    private readonly List<Line> _poles = new();
    private readonly List<(Ellipse puff, double born, bool live)> _smoke = new();
    private Polygon _cone = null!, _loco = null!;
    private Rectangle _stack = null!;
    private Ellipse _lamp = null!;
    private double _pos = 0.85, _poleOff, _last;   // enters within seconds, then wraps from the right
    private const int Cars = 6;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x05, 0x07, 0x14), 0), (Color.FromArgb(255, 0x12, 0x10, 0x22), 0.7), (Color.FromArgb(255, 0x1C, 0x16, 0x24), 1));
        Stars(80, 0.55, White);
        Glow(X(0.14), Y(0.2), S(0.3), White, 0.2); E(X(0.14), Y(0.2), S(0.09), White, 0.85);
        Ridge(Mix(Ink2, Haze, 0.4), Ink2, 0.74, 0.03, 0.14, 16, 141, 0.6);
        Ridge(Ink2, Ink, 0.78, 0.01, 0.08, 20, 143, 0.6);
        _poles.Clear();
        for (var i = 0; i < 9; i++) { _poles.Add(L(0, Y(0.5), 0, Y(0.8), Ink3, S(0.006))); }
        // the trestle: a bridge deck on legs over a dark river
        RB(0, Y(0.8), W, S(0.2), Vertical((Color.FromArgb(255, 0x06, 0x0C, 0x18), 0), (Ink, 1)));
        R(0, Y(0.795), W, S(0.02), Ink3);
        for (var i = 0; i < 14; i++) { var x = X(i / 13.0); G(Ink2, 1, x - S(0.03), Y(0.98), x - S(0.012), Y(0.81), x + S(0.012), Y(0.81), x + S(0.03), Y(0.98)); }
        R(0, Y(0.79), W, S(0.006), Ink3);
        _smoke.Clear();
        for (var i = 0; i < 40; i++) _smoke.Add((Glow(0, 0, S(0.05), Haze, 0.7, 0), 0, false));
        _cars.Clear();
        var carW = S(0.28); var carH = S(0.09);
        for (var c = 0; c < Cars; c++)
        {
            var car = RB(0, Y(0.7), carW, carH, Vertical((Ink3, 0), (Ink2, 1)), 1); car.RadiusX = car.RadiusY = S(0.006);
            var roof = R(0, Y(0.69), carW, S(0.012), Ink3, 1, S(0.004));
            var wins = new Ellipse[5];
            for (var k = 0; k < 5; k++) wins[k] = Glow(0, 0, S(0.05), P((c + k) % Pal.Length), 1, 0.5);
            _cars.Add((car, roof, wins));
        }
        _loco = G(Ink3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        _stack = R(0, 0, S(0.03), S(0.05), Ink2, 1, S(0.004));
        _cone = GB(new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(1, 0.5), EndPoint = new Windows.Foundation.Point(0, 0.5), GradientStops = { new GradientStop { Color = A(P(0), 0.55), Offset = 0 }, new GradientStop { Color = A(P(0), 0), Offset = 1 } } }, 1, 0, 0, 0, 0, 0, 0);
        _lamp = Glow(0, 0, S(0.04), Mix(P(0), White, 0.6), 1, 0.95);
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        var v = (0.05 + 0.32 * f.Loud) * f.Speed;
        _pos -= v * f.Dt;
        var pitch = 0.075; var carWf = 0.072;
        var total = Cars * pitch + 0.09;
        if (_pos < -total - 0.1) _pos = 1.25;
        _poleOff = (_poleOff + v * f.Dt * 0.55) % (1.0 / 9);
        for (var i = 0; i < _poles.Count; i++) { var x = X(((i / 9.0) - _poleOff + 1) % 1.0); _poles[i].X1 = _poles[i].X2 = x; }
        var y = Y(0.7);
        for (var c = 0; c < Cars; c++)
        {
            var (car, roof, wins) = _cars[c];
            var x = X(_pos + 0.09 + c * pitch);
            At(car, x, y); At(roof, x, y - S(0.008));
            for (var k = 0; k < wins.Length; k++)
            {
                Size(wins[k], x + car.Width * (0.1 + k * 0.2), y + car.Height * 0.45, S(0.04 + 0.02 * Lv(f, (c * 5 + k) / (double)(Cars * 5))));
                Op(wins[k], 0.35 + 0.65 * Lv(f, (c * 5 + k) / (double)(Cars * 5)));
            }
        }
        // the locomotive leads on the left: a boiler, a cab, a stack, its headlight cone thrown ahead
        var lx = X(_pos); var lw = S(0.26); var lh = S(0.09);
        Pts(_loco, lx, y + lh, lx, y + lh * 0.35, lx + lw * 0.08, y + lh * 0.2, lx + lw * 0.62, y + lh * 0.2, lx + lw * 0.66, y - lh * 0.25, lx + lw * 0.98, y - lh * 0.25, lx + lw, y + lh);
        At(_stack, lx + lw * 0.14, y - lh * 0.3);
        Size(_lamp, lx + S(0.004), y + lh * 0.5, S(0.03 + 0.02 * f.Loud));
        Pts(_cone, lx, y + lh * 0.5, lx - W * 0.4, y + lh * 0.5 - S(0.16), lx - W * 0.4, y + lh * 0.5 + S(0.22));
        Op(_cone, 0.5 + 0.5 * f.Loud);
        if (f.T - _last > 0.18 / (0.4 + f.Loud))
        {
            _last = f.T;
            for (var i = 0; i < _smoke.Count; i++) if (!_smoke[i].live) { _smoke[i] = (_smoke[i].puff, f.T, true); break; }
        }
        for (var i = 0; i < _smoke.Count; i++)
        {
            var s = _smoke[i];
            if (!s.live) continue;
            var age = (f.T - s.born) / 3.0;
            if (age >= 1) { Op(s.puff, 0); _smoke[i] = (s.puff, s.born, false); continue; }
            Size(s.puff, lx + lw * 0.17 + age * W * (0.2 + 0.4 * f.Loud), y - lh * 0.5 - age * S(0.25) - Math.Sin(age * 5 + i) * S(0.01), S(0.03 + age * 0.14));
            Op(s.puff, (1 - age) * 0.5);
        }
    }
}

/// <summary>A street fair at night: a ferris wheel with a lit rim and gondolas turning with the loudness, striped stalls glowing with their bands, strings of bulbs chasing across the sky, a crowd below.</summary>
public sealed class StreetFair : Tableau
{
    private readonly List<(Ellipse bulb, int band)> _bulbs = new();
    private readonly List<Line> _spokes = new();
    private readonly List<(Ellipse cabin, Ellipse glow)> _cabins = new();
    private readonly List<(Rectangle front, Ellipse glow, int band)> _stalls = new();
    private readonly List<Ellipse> _rim = new();
    private Ellipse _hub = null!;
    private double _wheel;
    private const int Spokes = 14;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x06, 0x05, 0x12), 0), (Color.FromArgb(255, 0x1E, 0x12, 0x22), 0.75), (Color.FromArgb(255, 0x2E, 0x18, 0x22), 1));
        Stars(40, 0.35, White);
        HorizonGlow(0.9, 0.5, P(0), 0.18);
        var cx = X(0.78); var cy = Y(0.48); var rad = S(0.34);
        Glow(cx, cy, rad * 2.6, P(3), 0.14);
        G(Ink3, 1, cx - rad * 0.45, Y(0.92), cx - S(0.01), cy, cx + S(0.01), cy, cx + rad * 0.45, Y(0.92));
        _spokes.Clear(); _cabins.Clear(); _rim.Clear();
        for (var i = 0; i < Spokes; i++) _spokes.Add(L(cx, cy, cx, cy, Mix(Haze, White, 0.25), S(0.004)));
        for (var i = 0; i < Spokes * 3; i++) _rim.Add(E(cx, cy, S(0.008), P(i % Pal.Length), 0.7));
        for (var i = 0; i < Spokes; i++) _cabins.Add((E(cx, cy, S(0.035), Mix(P(i % Pal.Length), Ink2, 0.35)), Glow(cx, cy, S(0.09), P(i % Pal.Length), 0.9, 0.6)));
        _hub = E(cx, cy, S(0.05), Ink3);
        // stalls with striped awnings
        _stalls.Clear();
        for (var i = 0; i < 5; i++)
        {
            var sx = X(0.03 + i * 0.125); var sw = S(0.2); var band = i % Pal.Length;
            R(sx, Y(0.76), sw, S(0.16), Ink2);
            for (var s = 0; s < 6; s++) R(sx + sw * s / 6, Y(0.7), sw / 6, S(0.06), s % 2 == 0 ? P(band) : White, 0.85);
            G(Ink2, 1, sx - S(0.01), Y(0.76), sx + sw / 2, Y(0.66), sx + sw + S(0.01), Y(0.76));
            _stalls.Add((R(sx + sw * 0.1, Y(0.78), sw * 0.8, S(0.1), P(band), 0.4, S(0.006)), Glow(sx + sw / 2, Y(0.83), sw * 1.2, P(band), 0.5, 0.5), band));
        }
        // the crowd, then the ground
        var rng = new Random(151);
        for (var i = 0; i < 40; i++) { var x = X(rng.NextDouble()); var s = S(0.025 + rng.NextDouble() * 0.015); G(Ink, 1, x - s * 1.2, Y(0.98), x - s, Y(0.94) - s, x + s, Y(0.94) - s, x + s * 1.2, Y(0.98)); E(x, Y(0.94) - s * 1.5, s * 0.9, Ink); }
        R(0, Y(0.97), W, S(0.03), Ink);
        _bulbs.Clear();
        for (var s = 0; s < 2; s++)
            for (var i = 0; i < 28; i++)
            {
                var fx = 0.01 + i * 0.036 + s * 0.018; var sag = Math.Sin(i / 27.0 * Math.PI) * 0.1;
                if (i > 0) L(X(fx - 0.036), Y(0.14 + s * 0.13 + Math.Sin((i - 1) / 27.0 * Math.PI) * 0.1), X(fx), Y(0.14 + s * 0.13 + sag), Ink3, S(0.002));
                _bulbs.Add((Glow(X(fx), Y(0.14 + s * 0.13 + sag), S(0.03 + 0.008 * s), P((i + s) % Pal.Length), 1, 0.5), (i + s) % Pal.Length));
            }
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        _wheel += (0.12 + 0.55 * f.Loud) * f.Speed * f.Dt;
        var cx = X(0.78); var cy = Y(0.48); var rad = S(0.34);
        for (var i = 0; i < Spokes; i++)
        {
            var a = _wheel + i * Math.PI * 2 / Spokes;
            var ex = cx + Math.Cos(a) * rad; var ey = cy + Math.Sin(a) * rad;
            _spokes[i].X2 = ex; _spokes[i].Y2 = ey;
            var (cabin, glow) = _cabins[i];
            Size(cabin, ex, ey + S(0.025), S(0.035)); Size(glow, ex, ey + S(0.025), S(0.08 + 0.06 * Lv(f, i / (double)Spokes)));
            Op(glow, 0.35 + 0.65 * Lv(f, i / (double)Spokes));
        }
        for (var i = 0; i < _rim.Count; i++)
        {
            var a = _wheel + i * Math.PI * 2 / _rim.Count;
            Size(_rim[i], cx + Math.Cos(a) * rad, cy + Math.Sin(a) * rad, S(0.008));
            Op(_rim[i], 0.55 + 0.45 * Osc(f.T * f.Speed, 6, i * 0.5) * (0.5 + f.High));
        }
        for (var i = 0; i < _bulbs.Count; i++)
        {
            var (bulb, band) = _bulbs[i];
            var chase = Osc(f.T * 4 * f.Speed, 1, -i * 0.6);
            Op(bulb, 0.5 + 0.5 * chase * (0.5 + Lv(f, (band + 0.5) / Pal.Length)) + 0.2 * f.Beat);
        }
        for (var i = 0; i < _stalls.Count; i++)
        {
            var lvl = Lv(f, (i + 0.5) / _stalls.Count);
            Op(_stalls[i].front, 0.55 + 0.45 * lvl); Op(_stalls[i].glow, 0.35 + 0.5 * lvl);
        }
    }
}

/// <summary>A stadium at night: floodlight cones over the tiers, a lit pitch, a crowd that lights to its band, and a wave that runs through it on every beat with confetti on the big ones.</summary>
public sealed class StadiumWave : Tableau
{
    private readonly List<(Ellipse dot, double fx, int tier)> _crowd = new();
    private readonly List<Polygon> _flood = new();
    private readonly List<Ellipse> _lamps = new();
    private readonly List<(Ellipse c, double x, double y, double v, double drift, bool live)> _confetti = new();
    private Rectangle _pitch = null!, _board = null!;
    private double _wavePos = 2, _waveVel;
    protected override void OnBuild()
    {
        Sky(0, 1, (Color.FromArgb(255, 0x05, 0x07, 0x10), 0), (Color.FromArgb(255, 0x10, 0x14, 0x20), 0.6), (Color.FromArgb(255, 0x16, 0x1E, 0x2A), 1));
        Stars(40, 0.3, White);
        _flood.Clear(); _lamps.Clear();
        foreach (var fx in new[] { 0.1, 0.9 })
        {
            R(X(fx) - S(0.006), Y(0.1), S(0.012), S(0.5), Ink3);
            R(X(fx) - S(0.07), Y(0.08), S(0.14), S(0.035), Ink2);
            for (var k = 0; k < 4; k++) _lamps.Add(Glow(X(fx) - S(0.05) + k * S(0.033), Y(0.1), S(0.035), White, 1, 0.9));
            _flood.Add(GB(new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0.5, 0), EndPoint = new Windows.Foundation.Point(0.5, 1), GradientStops = { new GradientStop { Color = A(White, 0.3), Offset = 0 }, new GradientStop { Color = A(White, 0.02), Offset = 1 } } }, 1,
                X(fx) - S(0.06), Y(0.11), X(fx) + S(0.06), Y(0.11), X(fx < 0.5 ? 0.72 : 0.28), Y(0.98), X(fx < 0.5 ? 0.0 : 1.0), Y(0.98)));
        }
        // the scoreboard between the masts
        _board = RB(X(0.42), Y(0.14), S(0.3), S(0.1), Vertical((A(P(1), 0.6), 0), (A(P(1), 0.25), 1)), 0.7); _board.RadiusX = _board.RadiusY = S(0.01);
        R(X(0.42) - S(0.01), Y(0.13), S(0.32), S(0.008), Ink3);
        // four tiers, each lit crowd of dots
        _crowd.Clear();
        var rng = new Random(161);
        for (var t = 0; t < 4; t++)
        {
            var y0 = 0.46 + t * 0.1;
            RB(0, Y(y0), W, S(0.1), Vertical((t % 2 == 0 ? Ink3 : Ink2, 0), (Ink, 1)));
            var n = 70 + t * 14;
            for (var i = 0; i < n; i++)
            {
                var fx = (i + 0.5) / n;
                _crowd.Add((E(X(fx), Y(y0 + 0.05 + (i % 2) * 0.02), S(0.008 + t * 0.002), P((i + t) % Pal.Length), 0.2), fx, t));
            }
        }
        _pitch = RB(0, Y(0.86), W, S(0.14), Vertical((Color.FromArgb(255, 0x14, 0x30, 0x1C), 0), (Color.FromArgb(255, 0x0A, 0x1C, 0x10), 1)));
        R(0, Y(0.9), W, S(0.003), White, 0.4); R(X(0.5) - S(0.002), Y(0.86), S(0.004), S(0.14), White, 0.4);
        E(X(0.5), Y(0.93), S(0.16), A(White, 0), 1);
        var ring = new Ellipse { Width = S(0.16), Height = S(0.06), Stroke = B(A(White, 0.4)), StrokeThickness = S(0.003) }; At(ring, X(0.5) - S(0.08), Y(0.93) - S(0.03)); C.Children.Add(ring);
        _confetti.Clear();
        for (var i = 0; i < 80; i++) _confetti.Add((E(0, 0, S(0.007), P(i % Pal.Length), 0), 0, 0, 0, 0, false));
        Vignette(0.28);
    }
    public override void Frame(TableauFrame f)
    {
        foreach (var g in _flood) Op(g, 0.4 + 0.6 * f.Loud);
        foreach (var l in _lamps) Op(l, 0.6 + 0.4 * f.Loud);
        Op(_board, 0.5 + 0.5 * Osc(f.T * f.Speed, 1.5) * (0.5 + f.Mid));
        Op(_pitch, 0.7 + 0.3 * f.Loud);
        if (f.Beat > 0.06 && _wavePos > 1.15) { _wavePos = -0.2; _waveVel = 0.45 + 0.5 * Math.Min(1, f.Beat); }
        if (_wavePos <= 1.15) _wavePos += _waveVel * f.Speed * f.Dt;
        for (var i = 0; i < _crowd.Count; i++)
        {
            var (dot, fx, tier) = _crowd[i];
            var d = Math.Abs(fx - (_wavePos - tier * 0.05));
            var wave = d < 0.14 ? 1 - d / 0.14 : 0;
            var lvl = Lv(f, fx);
            Op(dot, Clamp01(0.12 + 0.35 * lvl + 0.8 * wave));
            var lift = wave * S(0.035);
            At(dot, X(fx) - dot.Width / 2, Y(0.51 + tier * 0.1 + (i % 2) * 0.02) - lift);
        }
        if (f.Beat > 0.2)
        {
            var launch = 0;
            for (var i = 0; i < _confetti.Count && launch < 20; i++)
                if (!_confetti[i].live) { _confetti[i] = (_confetti[i].c, Rng.NextDouble(), 0.05 + Rng.NextDouble() * 0.2, 0.15 + Rng.NextDouble() * 0.15, (Rng.NextDouble() - 0.5) * 0.06, true); launch++; }
        }
        for (var i = 0; i < _confetti.Count; i++)
        {
            var c = _confetti[i];
            if (!c.live) continue;
            var y = c.y + c.v * f.Speed * f.Dt; var x = c.x + c.drift * f.Dt + Math.Sin(f.T * 5 + i) * 0.003;
            if (y > 0.86) { Op(c.c, 0); _confetti[i] = (c.c, x, y, c.v, c.drift, false); continue; }
            _confetti[i] = (c.c, x, y, c.v, c.drift, true);
            Size(c.c, X(x), Y(y), S(0.006), S(0.004 + 0.004 * Osc(f.T, 12, i)));
            Op(c.c, 0.9);
        }
    }
}
