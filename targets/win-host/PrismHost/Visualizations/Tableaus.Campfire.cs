using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

// =============================================================== COMMUNITY: Campfire Circle (see Tableaus.cs for the toolkit)
// This file is pure ASCII.

/// <summary>
/// A family and friends around a fire in a forest clearing (redrawn 2026-11-10, asked for people that read as people, a fire that holds
/// the eye, and a backdrop that is plainly forest and far mountains).
///
/// The fire is the instrument: thirteen tongues in three layers of heat, each following a band of its own, licking upward as a travelling
/// wave; a beat flares the whole fire, throws a fan of streaking sparks, and lifts the light on
/// everything around it. The people are seated silhouettes built from limbs and smooth shapes; each part is drawn three times (a warm rim
/// toward the fire, the dark body, a lit overlay) so the firelight plays on them as it rises and falls. They sway with the music, a
/// guitarist strums with the mids, a child holds a marshmallow to the flames, the dog's tail keeps time.
///
/// The sky's stars stand still (2026-11-10). Sparks, embers and smoke fade out below the star field, so nothing crosses the sky.
/// Every shape is made once in OnBuild; Frame moves and re-lights them and allocates nothing.
/// </summary>
public sealed class CampfireCircle : Tableau
{
    // ---- sky
    private readonly List<(Ellipse dot, Ellipse? halo, double x, double y, double d, double band)> _stars = new();
    private double _starHue;

    // ---- the scene's frame: the fire's base, and a unit that keeps the circle together on any tile shape
    private double _cx, _fy, _u;
    private Color _rim;

    // ---- firelight on things
    private readonly List<(UIElement e, double w)> _rims = new(), _lits = new(), _treeLit = new();
    private readonly List<(RotateTransform rt, int kind, double amp, double ph)> _joints = new();
    private readonly List<(Polygon p, double gx, double gy, double hw)> _shadows = new();
    private readonly Stack<Canvas> _groups = new();
    private Ellipse _pool = null!, _halo = null!, _halo2 = null!, _core = null!, _bed = null!, _mallow = null!;
    private Rectangle _treeGlow = null!, _flash = null!;
    private Line _logGlow = null!;

    // ---- the moon (2026-11-10, asked for a moon that changes phase very slowly, only while a song plays): one turn through the phases
    // takes twelve minutes of music; it holds where it is when nothing plays, and across a rebuild of the scene
    private const int MoonPts = 15;
    private const double MoonTurn = 720;
    private Polygon _moon = null!;
    private Ellipse _moonGlow = null!;
    private double _mx, _my, _mr, _moonPhase = 0.18, _moonDrawn = -1;   // 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter

    // ---- the flames
    private const int Tongues = 13, K = 11;
    private static readonly double[] TX = { -0.075, -0.035, 0.0, 0.04, 0.078, -0.05, -0.018, 0.015, 0.045, 0.0, -0.022, 0.006, 0.03 };
    private static readonly double[] TW = { 0.050, 0.058, 0.066, 0.056, 0.048, 0.036, 0.042, 0.044, 0.036, 0.030, 0.022, 0.026, 0.020 };
    private static readonly double[] TBase = { 0.11, 0.15, 0.18, 0.14, 0.11, 0.08, 0.11, 0.12, 0.09, 0.13, 0.05, 0.07, 0.05 };
    private static readonly double[] TGain = { 0.16, 0.20, 0.24, 0.20, 0.15, 0.13, 0.16, 0.18, 0.14, 0.20, 0.10, 0.13, 0.10 };
    private static readonly double[] TBand = { 0.10, 0.25, 0.40, 0.30, 0.15, 0.45, 0.55, 0.50, 0.65, 0.60, 0.75, 0.85, 0.95 };
    private readonly Polygon[] _tongue = new Polygon[Tongues];
    private readonly double[] _tp1 = new double[Tongues], _tp2 = new double[Tongues], _tp3 = new double[Tongues], _th = new double[Tongues], _tipX = new double[Tongues], _tipY = new double[Tongues];

    // ---- sparks (streaks), embers (slow glows), licks (flame that breaks off), smoke, rings of light on the ground
    private const int Sparks = 170, Embers = 16, Licks = 8, Puffs = 7, Rings = 3;
    private readonly Line[] _sl = new Line[Sparks];
    private readonly double[] _sx = new double[Sparks], _sy = new double[Sparks], _svx = new double[Sparks], _svy = new double[Sparks], _sLife = new double[Sparks], _sDur = new double[Sparks], _sPh = new double[Sparks];
    private readonly Ellipse[] _em = new Ellipse[Embers];
    private readonly double[] _ex = new double[Embers], _ey = new double[Embers], _evy = new double[Embers], _eLife = new double[Embers], _eDur = new double[Embers], _ePh = new double[Embers], _eSize = new double[Embers];
    private readonly Ellipse[] _lk = new Ellipse[Licks];
    private readonly double[] _lx = new double[Licks], _ly = new double[Licks], _lLife = new double[Licks];
    private readonly Ellipse[] _pf = new Ellipse[Puffs];
    private readonly double[] _px = new double[Puffs], _pAge = new double[Puffs];
    private readonly Ellipse[] _ring = new Ellipse[Rings];
    private readonly double[] _rAge = new double[Rings];
    private Brush _hot = null!, _warm = null!, _red = null!;
    private int _sNext, _eNext, _lNext, _pNext, _rNext;
    private double _flare, _prevBeat, _sinceBurst = 9, _emit, _emitEmber, _emitPuff, _fl1, _fl2, _windPh, _swayPh, _strumPh, _tailPh;

    // =========================================================================================== building blocks

    /// <summary>A closed smooth outline through the given points (Catmull-Rom), as polygon points.</summary>
    private static double[] Curve(double[] p, int sub = 5) => TableauCurve.Closed(p, sub);
    private static double[] Mul(double k, params double[] p) { for (var i = 0; i < p.Length; i++) p[i] *= k; return p; }
    private static LinearGradientBrush Across(Color a, Color b)
    {
        var br = new LinearGradientBrush { StartPoint = new Pt(0, 0), EndPoint = new Pt(1, 0) };
        br.GradientStops.Add(new GradientStop { Color = a, Offset = 0 }); br.GradientStops.Add(new GradientStop { Color = b, Offset = 1 });
        return br;
    }
    private Ellipse Oval0(double cx, double cy, double w, double h, Brush fill, double op)
    {
        var e = new Ellipse { Width = Math.Max(0.5, w), Height = Math.Max(0.5, h), Fill = fill, Opacity = Clamp01(op) };
        At(e, cx - w / 2, cy - h / 2); C.Children.Add(e); return e;
    }
    private void Mountain(Color top, Color bottom, params double[] f)
    {
        for (var i = 0; i + 1 < f.Length; i += 2) { f[i] = X(f[i]); f[i + 1] = Y(f[i + 1]); }
        GB(Vertical((top, 0), (bottom, 0.7), (bottom, 1)), 1, Curve(f, 4));
    }

    /// <summary>A spruce: a pointed crown of drooping boughs, each side with its own raggedness, on a short trunk. `half` is the side that
    /// faces the fire (lit = +1 the right side, -1 the left), for the firelight laid over it.</summary>
    private static double[] Spruce(double x, double baseY, double h, double hw, Random r, int lit, out double[] half)
    {
        var n = 7 + r.Next(4); var top = baseY - h; var dy = h * 0.9 / n;
        var lw = new double[n]; var rw = new double[n];
        for (var k = 0; k < n; k++)
        {
            var w = hw * (0.10 + 0.90 * Math.Pow((k + 1.0) / n, 0.85));
            lw[k] = w * (0.78 + 0.4 * r.NextDouble()); rw[k] = w * (0.78 + 0.4 * r.NextDouble());
        }
        var full = new List<double> { x, top };
        for (var k = 0; k < n; k++)
        {
            var y = top + dy * (k + 1);
            full.Add(x + rw[k]); full.Add(y);
            if (k < n - 1) { full.Add(x + rw[k] * 0.45); full.Add(y - dy * 0.18); }
        }
        var yb = top + dy * n;
        full.Add(x + hw * 0.07); full.Add(yb - dy * 0.2); full.Add(x + hw * 0.07); full.Add(baseY);
        full.Add(x - hw * 0.07); full.Add(baseY); full.Add(x - hw * 0.07); full.Add(yb - dy * 0.2);
        for (var k = n - 1; k >= 0; k--)
        {
            var y = top + dy * (k + 1);
            full.Add(x - lw[k]); full.Add(y);
            if (k > 0) { full.Add(x - lw[k - 1] * 0.45); full.Add(y - dy - dy * 0.18); }
        }
        var hf = new List<double> { x, top };
        var sw = lit >= 0 ? rw : lw; var sg = lit >= 0 ? 1 : -1;
        for (var k = 0; k < n; k++)
        {
            var y = top + dy * (k + 1);
            hf.Add(x + sg * sw[k]); hf.Add(y);
            if (k < n - 1) { hf.Add(x + sg * sw[k] * 0.45); hf.Add(y - dy * 0.18); }
        }
        hf.Add(x); hf.Add(yb - dy * 0.2);
        half = hf.ToArray();
        return full.ToArray();
    }

    // ---- a body: local coordinates with the ground at y = 0, up negative, x toward the way it faces; one unit is the body's scale
    private sealed class Fig
    {
        public double Ox, Oy, S, Dir = 1, Rx, Ry, Dx, Dy, Px, Py, Tilt, RimW = 1, LitW = 1;
        public Color Dark, Lit;
    }
    private Fig Body(double ox, double oy, double s, double dir, Color lit, double litW)
    {
        var g = new Fig { Ox = ox, Oy = oy, S = s, Dir = dir, Dark = Color.FromArgb(255, 0x10, 0x0E, 0x13), Lit = lit, LitW = litW };
        // the rim sits on the side toward the fire
        double vx = _cx - ox, vy = (_fy - 0.12 * _u) - (oy - 0.6 * s); var len = Math.Max(1, Math.Sqrt(vx * vx + vy * vy));
        g.Rx = vx / len * s * 0.017; g.Ry = vy / len * s * 0.017;
        return g;
    }
    private static void Loc(Fig g, double lx, double ly, out double x, out double y)
    {
        lx += g.Dx; ly += g.Dy;
        if (g.Tilt != 0)
        {
            double c = Math.Cos(g.Tilt), s = Math.Sin(g.Tilt), rx = lx - g.Px, ry = ly - g.Py;
            lx = g.Px + rx * c - ry * s; ly = g.Py + rx * s + ry * c;
        }
        x = g.Ox + g.Dir * lx * g.S; y = g.Oy + ly * g.S;
    }
    private void Limb(Fig g, double x1, double y1, double x2, double y2, double thick, Color? lit = null, Color? dark = null)
    {
        Loc(g, x1, y1, out var ax, out var ay); Loc(g, x2, y2, out var bx, out var by); var th = thick * g.S;
        _rims.Add((L(ax + g.Rx, ay + g.Ry, bx + g.Rx, by + g.Ry, _rim, th, 0), g.RimW));
        L(ax, ay, bx, by, dark ?? g.Dark, th);
        _lits.Add((L(ax, ay, bx, by, lit ?? g.Lit, th, 0), g.LitW));
    }
    private void Blob(Fig g, Color? lit, Color? dark, params double[] local)
    {
        var p = new double[local.Length];
        for (var i = 0; i + 1 < local.Length; i += 2) { Loc(g, local[i], local[i + 1], out var x, out var y); p[i] = x; p[i + 1] = y; }
        var c = Curve(p); var r = new double[c.Length];
        for (var i = 0; i + 1 < c.Length; i += 2) { r[i] = c[i] + g.Rx; r[i + 1] = c[i + 1] + g.Ry; }
        _rims.Add((G(_rim, 0, r), g.RimW));
        G(dark ?? g.Dark, 1, c);
        _lits.Add((G(lit ?? g.Lit, 0, c), g.LitW));
    }
    private void Oval(Fig g, double cx, double cy, double w, double h, Color? lit = null, Color? dark = null)
    {
        var p = new double[16];
        for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; p[i * 2] = cx + Math.Cos(a) * w / 2; p[i * 2 + 1] = cy + Math.Sin(a) * h / 2; }
        Blob(g, lit, dark, p);
    }
    private Canvas Group() { var c = new Canvas(); C.Children.Add(c); _groups.Push(C); C = c; return c; }
    private void End() => C = _groups.Pop();
    /// <summary>The group turns about a point of the body. Kinds: 0 the body's sway, 1 a head, 2 the strumming arm, 3 the dog's tail, 4 the stick.</summary>
    private void Joint(Canvas grp, Fig g, double lx, double ly, int kind, double amp, double ph)
    {
        Loc(g, lx, ly, out var x, out var y);
        var rt = new RotateTransform { CenterX = x, CenterY = y };
        grp.RenderTransform = rt; _joints.Add((rt, kind, amp, ph));
    }

    private static readonly Color HairDark = Color.FromArgb(255, 0x0A, 0x09, 0x0C);

    /// <summary>A head in profile on its neck; (nx, ny) is the base of the neck. Hair: 0 short, 1 long, 2 a beanie, 3 a ponytail.</summary>
    private void HeadSide(Fig g, double nx, double ny, double k, Color skin, int hair, Color hairLit)
    {
        g.Dx = nx; g.Dy = ny;
        Limb(g, -0.01 * k, 0.04 * k, 0.02 * k, -0.05 * k, 0.09 * k, skin);
        Blob(g, skin, null, Mul(k, -0.08, -0.15, -0.03, -0.25, 0.07, -0.27, 0.14, -0.20, 0.15, -0.15, 0.185, -0.105, 0.15, -0.075, 0.145, -0.045, 0.12, -0.005, 0.04, -0.015, -0.03, -0.05));
        switch (hair)
        {
            case 1: Blob(g, hairLit, HairDark, Mul(k, -0.10, -0.14, -0.05, -0.27, 0.07, -0.29, 0.14, -0.22, 0.05, -0.20, -0.01, -0.12, -0.03, 0.02, -0.09, 0.14, -0.17, 0.12, -0.14, -0.04)); break;
            case 2:
                Oval(g, 0.01 * k, -0.32 * k, 0.075 * k, 0.075 * k, Mix(hairLit, White, 0.5), HairDark);
                Blob(g, hairLit, HairDark, Mul(k, -0.095, -0.16, -0.07, -0.26, 0.03, -0.31, 0.12, -0.27, 0.16, -0.19, 0.05, -0.205, -0.05, -0.16)); break;
            case 3:
                Blob(g, hairLit, HairDark, Mul(k, -0.08, -0.20, -0.17, -0.17, -0.21, -0.04, -0.15, -0.05, -0.12, -0.13));
                Blob(g, hairLit, HairDark, Mul(k, -0.09, -0.13, -0.06, -0.26, 0.06, -0.30, 0.15, -0.22, 0.06, -0.21, -0.02, -0.15, -0.05, -0.07)); break;
            default: Blob(g, hairLit, HairDark, Mul(k, -0.09, -0.13, -0.06, -0.26, 0.06, -0.30, 0.15, -0.22, 0.06, -0.21, -0.02, -0.15, -0.05, -0.07)); break;
        }
        g.Dx = g.Dy = 0;
    }

    /// <summary>A head seen from the front on its neck. Hair: 0 short, 1 long, 2 a brimmed hat, 3 a bun.</summary>
    private void HeadFront(Fig g, double nx, double ny, double tilt, Color skin, int hair, Color hairLit)
    {
        g.Dx = nx; g.Dy = ny; g.Px = nx; g.Py = ny; g.Tilt = tilt;
        Limb(g, 0, 0.06, 0, -0.04, 0.10, skin);
        if (hair == 1) Blob(g, hairLit, HairDark, -0.13, 0.03, -0.15, -0.2, -0.09, -0.32, 0, -0.35, 0.09, -0.32, 0.15, -0.2, 0.13, 0.03, 0, 0.0);   // the fall of long hair, behind the face
        Blob(g, skin, null, 0, -0.305, 0.085, -0.275, 0.11, -0.18, 0.085, -0.09, 0, -0.04, -0.085, -0.09, -0.11, -0.18, -0.085, -0.275);
        switch (hair)
        {
            case 2:
                Blob(g, hairLit, HairDark, -0.10, -0.24, -0.09, -0.37, 0, -0.40, 0.09, -0.37, 0.10, -0.24);
                Limb(g, -0.20, -0.245, 0.20, -0.245, 0.04, hairLit, HairDark); break;
            case 3:
                Oval(g, 0, -0.365, 0.10, 0.09, hairLit, HairDark);
                Blob(g, hairLit, HairDark, -0.115, -0.17, -0.12, -0.27, -0.06, -0.33, 0.03, -0.34, 0.11, -0.29, 0.125, -0.18, 0.09, -0.24, 0.0, -0.27, -0.08, -0.24); break;
            case 1: Blob(g, hairLit, HairDark, -0.12, -0.16, -0.12, -0.27, -0.05, -0.335, 0.04, -0.335, 0.12, -0.27, 0.12, -0.16, 0.075, -0.25, 0.0, -0.285, -0.075, -0.25); break;
            default: Blob(g, hairLit, HairDark, -0.115, -0.17, -0.12, -0.27, -0.06, -0.33, 0.03, -0.34, 0.11, -0.29, 0.125, -0.18, 0.09, -0.24, 0.0, -0.27, -0.08, -0.24); break;
        }
        g.Dx = g.Dy = g.Px = g.Py = g.Tilt = 0;
    }

    /// <summary>Someone on a log, seen from the side, facing the fire. Who: 0 hands on the knees, 1 a mug in hand, 2 the child with the marshmallow.</summary>
    private void Seated(Fig g, int who, Color skin, int hair, Color hairLit, Color legs, double headK, double ph)
    {
        Color wood = Color.FromArgb(255, 0x22, 0x15, 0x0E), woodLit = Color.FromArgb(255, 0x8A, 0x54, 0x2C), boot = Color.FromArgb(255, 0x4A, 0x30, 0x22);
        var rimW = g.RimW; g.RimW = 0;   // the log and the far leg sit in the body's shade: no rim of their own
        Limb(g, -0.26, -0.135, 0.12, -0.135, 0.27, woodLit, wood);
        Limb(g, 0.0, -0.30, 0.36, -0.38, 0.16, legs); Limb(g, 0.36, -0.38, 0.50, -0.07, 0.12, legs); Limb(g, 0.50, -0.04, 0.64, -0.035, 0.08, boot);
        g.RimW = rimW;
        Limb(g, 0.0, -0.29, 0.40, -0.35, 0.17, legs); Limb(g, 0.40, -0.35, 0.43, -0.07, 0.125, legs); Limb(g, 0.43, -0.04, 0.58, -0.035, 0.085, boot);
        var body = Group(); Joint(body, g, 0, -0.30, 0, 1.6 * g.Dir, ph);
        Blob(g, null, null, -0.13, -0.26, -0.15, -0.52, -0.11, -0.76, -0.02, -0.87, 0.10, -0.86, 0.16, -0.74, 0.15, -0.50, 0.11, -0.26);
        var head = Group(); Joint(head, g, 0.05, -0.88, 1, 3.0 * g.Dir, ph);
        HeadSide(g, 0.05, -0.88, headK, skin, hair, hairLit);
        End();
        if (who == 0)
        {
            Limb(g, 0.04, -0.78, 0.17, -0.55, 0.11); Limb(g, 0.17, -0.55, 0.36, -0.43, 0.085);
            Oval(g, 0.385, -0.425, 0.085, 0.075, skin);
        }
        else if (who == 1)
        {
            Limb(g, 0.04, -0.78, 0.19, -0.56, 0.11); Limb(g, 0.19, -0.56, 0.29, -0.73, 0.085);
            Blob(g, Color.FromArgb(255, 0xE8, 0xDC, 0xC0), null, 0.265, -0.835, 0.365, -0.835, 0.365, -0.725, 0.265, -0.725);
            Oval(g, 0.30, -0.745, 0.085, 0.075, skin);
        }
        else
        {
            Limb(g, 0.04, -0.78, 0.20, -0.60, 0.11); Limb(g, 0.20, -0.60, 0.40, -0.62, 0.085);
            var stick = Group(); Joint(stick, g, 0.41, -0.62, 4, 2.2 * g.Dir, ph);
            Limb(g, 0.34, -0.608, 1.80, -0.90, 0.024, Color.FromArgb(255, 0x9A, 0x6A, 0x3C), Color.FromArgb(255, 0x24, 0x18, 0x10));
            Oval(g, 1.83, -0.905, 0.10, 0.085, Color.FromArgb(255, 0xFF, 0xF4, 0xDC), Color.FromArgb(255, 0x6A, 0x5C, 0x50));
            Loc(g, 1.83, -0.905, out var mx, out var my);
            _mallow = Glow(mx, my, g.S * 0.32, Mix(P(2), White, 0.4), 0.7, 0.3);
            End();
            Oval(g, 0.41, -0.62, 0.085, 0.08, skin);
        }
        End();
    }

    /// <summary>Two under one blanket on the far side of the fire, heads together.</summary>
    private void Couple(Fig g, Color blanket, Color skinA, Color skinB, Color hairA, Color hairB)
    {
        var body = Group(); Joint(body, g, 0, 0, 0, 1.7, 2.1);
        var h1 = Group(); Joint(h1, g, -0.17, -0.64, 1, 2.2, 0.4); HeadFront(g, -0.17, -0.64, 0.20, skinA, 1, hairA); End();
        var h2 = Group(); Joint(h2, g, 0.18, -0.67, 1, 2.2, 1.3); HeadFront(g, 0.18, -0.67, -0.16, skinB, 0, hairB); End();
        Blob(g, blanket, null, -0.56, 0.0, -0.53, -0.3, -0.45, -0.58, -0.28, -0.70, -0.08, -0.63, 0.02, -0.61, 0.12, -0.66, 0.30, -0.73, 0.47, -0.60, 0.54, -0.3, 0.57, 0.0, 0.0, 0.03);
        // the blanket's stripes, in the lit pass only
        var st = Mix(blanket, White, 0.45);
        foreach (var sy in new[] { -0.16, -0.36 })
        {
            Loc(g, -0.535, sy, out var ax, out var ay); Loc(g, 0.545, sy, out var bx, out var by);
            _lits.Add((L(ax, ay, bx, by, st, g.S * 0.035, 0), g.LitW * 0.8));
        }
        End();
    }

    /// <summary>The guitarist, cross-legged on the far side, facing us; the strumming forearm is its own joint.</summary>
    private void Guitarist(Fig g, Color skin, Color hatLit, Color legs)
    {
        Color wood = Color.FromArgb(255, 0x2A, 0x18, 0x0E), woodLit = Color.FromArgb(255, 0xC8, 0x86, 0x40), neck = Color.FromArgb(255, 0x6A, 0x42, 0x28);
        Blob(g, legs, null, -0.42, 0.0, -0.40, -0.12, -0.2, -0.20, 0, -0.17, 0.2, -0.20, 0.40, -0.12, 0.42, 0.0, 0, 0.02);
        var body = Group(); Joint(body, g, 0, -0.1, 0, 1.5 * g.Dir, 4.0);
        Limb(g, -0.24, -0.60, -0.33, -0.38, 0.11);
        Blob(g, null, null, -0.20, -0.10, -0.23, -0.40, -0.25, -0.62, -0.10, -0.72, 0.10, -0.72, 0.25, -0.62, 0.23, -0.40, 0.20, -0.10);
        var head = Group(); Joint(head, g, 0, -0.74, 1, 3.0, 4.0); HeadFront(g, 0, -0.74, 0.05, skin, 2, hatLit); End();
        Limb(g, 0.16, -0.39, 0.64, -0.63, 0.05, neck, wood); Limb(g, 0.64, -0.63, 0.71, -0.665, 0.07, neck, wood);
        Oval(g, 0.12, -0.37, 0.25, 0.21, woodLit, wood); Oval(g, -0.07, -0.30, 0.36, 0.29, woodLit, wood);
        Oval(g, 0.0, -0.325, 0.09, 0.08, Color.FromArgb(255, 0x30, 0x1C, 0x10), Ink);
        Limb(g, 0.24, -0.60, 0.40, -0.43, 0.11); Limb(g, 0.40, -0.43, 0.50, -0.54, 0.085); Oval(g, 0.515, -0.555, 0.085, 0.08, skin);
        var strum = Group(); Joint(strum, g, -0.33, -0.38, 2, 9 * g.Dir, 0);
        Limb(g, -0.33, -0.38, -0.07, -0.29, 0.085); Oval(g, -0.04, -0.285, 0.085, 0.08, skin);
        End();
        End();
    }

    /// <summary>The dog, sitting, watching the fire; the tail is its own joint.</summary>
    private void Dog(Fig g)
    {
        var tail = Group(); Joint(tail, g, -0.30, -0.08, 3, 16 * g.Dir, 0);
        Limb(g, -0.30, -0.08, -0.50, -0.26, 0.075); Limb(g, -0.50, -0.26, -0.56, -0.44, 0.05);
        End();
        Blob(g, null, null, -0.30, 0.0, -0.37, -0.25, -0.26, -0.50, -0.06, -0.68, 0.12, -0.72, 0.21, -0.55, 0.16, -0.25, 0.20, 0.0, 0.05, 0.0, -0.1, 0.0);
        Limb(g, 0.13, -0.45, 0.17, -0.05, 0.09); Limb(g, 0.17, -0.03, 0.26, -0.03, 0.065);
        var head = Group(); Joint(head, g, 0.10, -0.68, 1, 4 * g.Dir, 5.0);
        Blob(g, null, null, 0.07, -0.93, 0.085, -1.12, 0.20, -0.96);
        Blob(g, null, null, 0.02, -0.80, 0.10, -0.95, 0.22, -0.97, 0.30, -0.90, 0.44, -0.86, 0.47, -0.80, 0.42, -0.75, 0.28, -0.72, 0.18, -0.64, 0.06, -0.64);
        End();
    }

    // =========================================================================================== the build

    protected override void OnBuild()
    {
        _rims.Clear(); _lits.Clear(); _treeLit.Clear(); _joints.Clear(); _shadows.Clear(); _groups.Clear(); _stars.Clear();
        _u = Math.Min(H, W * 0.6); _cx = X(0.5); _fy = Y(0.87);
        var u = _u; var cx = _cx; var fy = _fy;
        _rim = Mix(P(0), P(3), 0.5);
        _hot = B(Mix(P(3), White, 0.5)); _warm = B(Mix(P(0), P(2), 0.4)); _red = B(P(1));

        // ---- the sky: deep blue falling to a warm dusk at the tree line; the stars as they were
        Sky(0, 1, (Color.FromArgb(255, 0x03, 0x05, 0x10), 0), (Color.FromArgb(255, 0x08, 0x0A, 0x1C), 0.5), (Color.FromArgb(255, 0x16, 0x10, 0x20), 0.78), (Color.FromArgb(255, 0x14, 0x0C, 0x0A), 1));
        var way = Glow(X(0.42), Y(0.2), W * 0.95, Mix(White, P(2), 0.3), 0.12, 0.8);
        way.Height = S(0.3); way.RenderTransform = new RotateTransform { Angle = -14, CenterX = W * 0.475, CenterY = S(0.15) };
        var sky = new Random(5);
        for (var i = 0; i < 70; i++)
        {
            var big = sky.NextDouble() < 0.16;
            var d = S(big ? 0.006 + sky.NextDouble() * 0.004 : 0.0025 + sky.NextDouble() * 0.003);
            double sx = X(sky.NextDouble()), sy = Y(sky.NextDouble() * 0.45);
            var halo = big ? Glow(sx, sy, d * 4, White, 0.8, 0) : null;
            _stars.Add((E(sx, sy, d, White, 0.4), halo, sx, sy, d, sky.NextDouble()));
        }
        // the moon, off to one side; its phase moves while a song plays (see Frame)
        _mx = cx + 0.40 * u; _my = Y(0.15); _mr = S(0.034);
        _moonGlow = Glow(_mx, _my, _mr * 9, White, 0.16);
        E(_mx, _my, _mr * 2, Color.FromArgb(255, 0x9A, 0xA4, 0xC0), 0.10);   // the dark of the moon, just there
        _moon = new Polygon { Fill = B(Color.FromArgb(255, 0xF2, 0xF0, 0xE6)), Opacity = 0.92 };
        for (var i = 0; i < 2 * MoonPts; i++) _moon.Points.Add(new Pt(_mx, _my));
        C.Children.Add(_moon);
        DrawMoon();

        // ---- far mountains in haze: two soft ranges, plainly distant
        Mountain(Mix(Haze, Lift, 0.55), Mix(Ink2, Haze, 0.7), -0.1, 0.66, 0.08, 0.61, 0.2, 0.53, 0.30, 0.45, 0.36, 0.48, 0.44, 0.41, 0.52, 0.49, 0.62, 0.56, 0.74, 0.51, 0.84, 0.57, 0.95, 0.61, 1.1, 0.64, 1.25, 1.2, -0.25, 1.2);
        Mountain(Mix(Haze, Ink2, 0.35), Mix(Ink2, Haze, 0.3), -0.1, 0.70, 0.1, 0.67, 0.25, 0.61, 0.4, 0.67, 0.55, 0.63, 0.68, 0.58, 0.8, 0.64, 0.92, 0.69, 1.1, 0.67, 1.25, 1.2, -0.25, 1.2);
        RB(0, Y(0.56), W, S(0.24), Vertical((A(Haze, 0), 0), (A(Haze, 0.28), 0.75), (A(Haze, 0), 1)));

        // ---- the forest: a far wall of spruce, a nearer one, mist between, then the tall trees that frame the clearing
        var rng = new Random(91);
        var farC = Mix(Ink2, Haze, 0.42);
        for (var x = -S(0.03); x < W + S(0.05); x += S(0.03 + rng.NextDouble() * 0.045))
        {
            var h = S(0.12 + rng.NextDouble() * 0.14);
            G(farC, 1, Spruce(x, Y(0.805), h, h * 0.21, rng, 0, out _));
        }
        RB(0, Y(0.70), W, S(0.14), Vertical((A(Haze, 0), 0), (A(Haze, 0.34), 0.7), (A(Haze, 0), 1)));
        var midC = Mix(Ink2, Haze, 0.14);
        for (var x = -S(0.02); x < W + S(0.08); x += S(0.06 + rng.NextDouble() * 0.09))
        {
            var open = Math.Min(1, Math.Abs(x - cx) / (0.5 * u));   // lower toward the middle: the clearing opens on the sky
            var h = S(0.15 + rng.NextDouble() * 0.16) * (0.55 + 0.45 * open);
            var lit = x < cx ? 1 : -1;
            G(midC, 1, Spruce(x, Y(0.82), h, h * 0.2, rng, lit, out var half));
            _treeLit.Add((GB(lit > 0 ? Across(A(P(0), 0), A(P(0), 0.34)) : Across(A(P(0), 0.34), A(P(0), 0)), 0, half), 0.55 + 0.45 * (1 - open)));
        }
        RB(0, Y(0.755), W, S(0.05), Vertical((A(midC, 0), 0), (midC, 0.8), (midC, 1)));
        _treeGlow = HorizonGlow(0.80, 0.34, P(0), 0.26);
        var tu = Math.Min(H, W / 1.5); var nearC = Color.FromArgb(255, 0x09, 0x0B, 0x10);
        foreach (var (off, hh, by, wgt) in new[] { (0.31, 0.50, 0.835, 0.9), (-0.03, 0.95, 0.86, 0.45), (0.15, 0.74, 0.85, 0.7) })
            foreach (var side in new[] { 1, -1 })
            {
                var x = side > 0 ? off * tu : W - (off + 0.01) * tu;
                var h = S(hh * (side > 0 ? 1 : 0.94));
                G(nearC, 1, Spruce(x, Y(by), h, h * 0.2, rng, side, out var half));
                _treeLit.Add((GB(side > 0 ? Across(A(P(0), 0), A(Mix(P(0), P(1), 0.3), 0.5)) : Across(A(Mix(P(0), P(1), 0.3), 0.5), A(P(0), 0)), 0, half), wgt));
            }

        // ---- the ground, the fire's light on it, the rings a beat sends out, the shadows the circle throws
        RB(0, Y(0.795), W, H - Y(0.795), Vertical((Color.FromArgb(255, 0x1E, 0x15, 0x10), 0), (Color.FromArgb(255, 0x12, 0x0C, 0x0A), 0.45), (Ink, 1)));
        _pool = Glow(cx, fy, u * 1.8, P(0), 0.6, 0.6);
        for (var i = 0; i < Rings; i++)
        {
            _ring[i] = new Ellipse { Stroke = B(Mix(P(2), P(0), 0.4)), StrokeThickness = Math.Max(1, u * 0.008), Opacity = 0 };
            C.Children.Add(_ring[i]); _rAge[i] = -1;
        }
        // where everyone sits (the ground point of each), left to right: parent, child, the couple, the guitarist, the one with the mug, the dog
        double sA = 0.27 * u, sK = 0.19 * u, sF = 0.21 * u, sD = 0.16 * u;
        var seats = new (double x, double y, double hw)[]
        {
            (cx - 0.74 * u, fy + 0.035 * u, sA * 0.3), (cx - 0.50 * u, fy + 0.05 * u, sK * 0.3), (cx - 0.30 * u, fy - 0.04 * u, sF * 0.5),
            (cx + 0.30 * u, fy - 0.04 * u, sF * 0.4), (cx + 0.58 * u, fy + 0.035 * u, sA * 0.3), (cx + 0.765 * u, fy + 0.04 * u, sD * 0.3),
        };
        foreach (var (x, y, hw) in seats) _shadows.Add((G(Color.FromArgb(255, 0x05, 0x04, 0x06), 0.4, x - hw, y, x + hw, y, x + hw, y, x - hw, y), x, y, hw));
        _halo2 = Glow(cx, fy - 0.1 * u, Math.Max(W, H), P(1), 0.22, 0.5);
        _halo = Glow(cx, fy - 0.1 * u, u, P(0), 0.5, 0.6);

        // ---- the far side of the circle
        Couple(Body(seats[2].x, seats[2].y, sF, 1, Color.FromArgb(255, 0xA8, 0x40, 0x34), 0.95),
            Color.FromArgb(255, 0xA8, 0x40, 0x34), Color.FromArgb(255, 0xE2, 0xA8, 0x7C), Color.FromArgb(255, 0x9A, 0x62, 0x40), Color.FromArgb(255, 0x7A, 0x40, 0x22), Color.FromArgb(255, 0x3A, 0x2A, 0x22));
        Guitarist(Body(seats[3].x, seats[3].y, sF, -1, Color.FromArgb(255, 0x4E, 0x7A, 0x7E), 0.95),
            Color.FromArgb(255, 0xC8, 0x8E, 0x62), Color.FromArgb(255, 0xB8, 0x98, 0x60), Color.FromArgb(255, 0x4A, 0x52, 0x70));

        // ---- the fire: stones behind, the logs, the bed of embers, three layers of flame, the white heart
        var stone = Color.FromArgb(255, 0x1C, 0x18, 0x18);
        for (var i = 0; i < 5; i++)
        {
            var a = Math.PI * (1.12 + 0.19 * i);
            Oval0(cx + Math.Cos(a) * u * 0.175, fy + 0.012 * u + Math.Sin(a) * u * 0.045, u * 0.065, u * 0.042, B(Mix(stone, P(0), 0.22)), 1);
        }
        var log = Color.FromArgb(255, 0x2A, 0x18, 0x10);
        L(cx - 0.125 * u, fy + 0.006 * u, cx + 0.045 * u, fy - 0.085 * u, log, u * 0.036);
        L(cx + 0.125 * u, fy + 0.006 * u, cx - 0.045 * u, fy - 0.085 * u, Mix(log, Ink, 0.25), u * 0.036);
        L(cx - 0.02 * u, fy + 0.0 * u, cx + 0.0 * u, fy - 0.11 * u, log, u * 0.03);
        _bed = Glow(cx, fy, u * 0.3, Mix(P(2), White, 0.35), 1, 0.9);
        for (var i = 0; i < Tongues; i++)
        {
            var layer = i < 5 ? 0 : i < 10 ? 1 : 2;
            Brush br = layer == 0 ? Vertical((A(P(1), 0), 0), (A(P(1), 0.72), 0.3), (A(Mix(P(1), P(0), 0.6), 0.92), 0.72), (A(P(0), 0.96), 1))
                : layer == 1 ? Vertical((A(P(0), 0), 0), (A(P(0), 0.88), 0.32), (A(P(2), 0.96), 1))
                : Vertical((A(P(2), 0), 0), (A(P(3), 0.92), 0.38), (A(Mix(P(3), White, 0.6), 1), 1));
            var g = new Polygon { Fill = br };
            for (var j = 0; j < 2 * K; j++) g.Points.Add(new Pt(cx, fy));
            C.Children.Add(g); _tongue[i] = g;
            _tp1[i] = i * 1.3; _tp2[i] = i * 2.1; _tp3[i] = i * 0.7; _th[i] = TBase[i];
        }
        _core = Glow(cx, fy - 0.08 * u, u * 0.2, Mix(P(2), White, 0.55), 0.95, 0.8);
        for (var i = 0; i < Licks; i++) { _lk[i] = Oval0(0, 0, 1, 1, Radial(Mix(P(2), P(0), 0.3), 0.95), 0); _lLife[i] = 0; }
        // the log across the front with its glowing edge, and the near stones with the fire on their tops
        L(cx - 0.10 * u, fy + 0.022 * u, cx + 0.11 * u, fy + 0.014 * u, Color.FromArgb(255, 0x1C, 0x10, 0x0C), u * 0.04);
        _logGlow = L(cx - 0.09 * u, fy + 0.006 * u, cx + 0.10 * u, fy - 0.002 * u, Mix(P(0), P(1), 0.4), u * 0.01, 0.8);
        for (var i = 0; i < 6; i++)
        {
            var a = Math.PI * (0.06 + 0.176 * i);
            double x = cx + Math.Cos(a) * u * 0.185, y = fy + 0.012 * u + Math.Sin(a) * u * 0.05, w = u * (0.07 + 0.012 * (i % 3)), h = u * (0.048 + 0.006 * (i % 2));
            Oval0(x, y, w, h, B(Color.FromArgb(255, 0x12, 0x0F, 0x10)), 1);
            _rims.Add((Oval0(x, y - h * 0.37, w * 0.66, h * 0.2, B(Mix(P(0), P(1), 0.35)), 0), 0.55));
        }

        // ---- the near side of the circle
        Seated(Body(seats[0].x, seats[0].y, sA, 1, Color.FromArgb(255, 0x5C, 0x7A, 0x52), 0.7), 0,
            Color.FromArgb(255, 0xD8, 0x9C, 0x70), 1, Color.FromArgb(255, 0x6A, 0x3A, 0x22), Color.FromArgb(255, 0x44, 0x50, 0x74), 1, 0.0);
        Seated(Body(seats[1].x, seats[1].y, sK, 1, Color.FromArgb(255, 0xC8, 0x9A, 0x3C), 0.8), 2,
            Color.FromArgb(255, 0xE0, 0xA8, 0x80), 3, Color.FromArgb(255, 0x8A, 0x52, 0x2A), Color.FromArgb(255, 0x50, 0x48, 0x60), 1.22, 1.7);
        Seated(Body(seats[4].x, seats[4].y, sA, -1, Color.FromArgb(255, 0x8A, 0x4A, 0x6A), 0.7), 1,
            Color.FromArgb(255, 0x96, 0x60, 0x40), 2, Color.FromArgb(255, 0xC8, 0x54, 0x3C), Color.FromArgb(255, 0x3E, 0x44, 0x58), 1, 3.1);
        Dog(Body(seats[5].x, seats[5].y, sD, -1, Color.FromArgb(255, 0xA8, 0x74, 0x44), 0.85));

        // ---- what rises: smoke, then the sparks and the slow embers, in front of everything
        for (var i = 0; i < Puffs; i++) { _pf[i] = Glow(0, 0, u * 0.1, Mix(Haze, P(1), 0.3), 0.5, 0); _pAge[i] = -1; }
        for (var i = 0; i < Sparks; i++)
        {
            _sl[i] = new Line { Stroke = _hot, StrokeThickness = 2, Opacity = 0, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round };
            C.Children.Add(_sl[i]); _sLife[i] = 0;
        }
        for (var i = 0; i < Embers; i++) { _em[i] = Glow(0, 0, u * 0.02, Mix(P(0), P(2), 0.5), 1, 0); _eLife[i] = 0; }

        // ---- a beat's flash, centred on the fire, and the edge
        var fb = new RadialGradientBrush { Center = new Pt(0.5, 0.82), GradientOrigin = new Pt(0.5, 0.82), RadiusX = 0.75, RadiusY = 0.9 };
        fb.GradientStops.Add(new GradientStop { Color = A(P(2), 0.55), Offset = 0 });
        fb.GradientStops.Add(new GradientStop { Color = A(P(0), 0.22), Offset = 0.4 });
        fb.GradientStops.Add(new GradientStop { Color = A(P(1), 0), Offset = 1 });
        _flash = RB(0, 0, W, H, fb, 0);
        Vignette(0.3);
    }

    // =========================================================================================== the frame

    /// <summary>The lit part of the moon at the current phase: the limb on the lit side, and the terminator as half an ellipse.</summary>
    private void DrawMoon()
    {
        _moonDrawn = _moonPhase;
        var k = Math.Cos(_moonPhase * 2 * Math.PI); var side = _moonPhase < 0.5 ? 1 : -1;   // waxing is lit on the right
        const double rot = -0.5; double cr = Math.Cos(rot), sr = Math.Sin(rot);
        var pts = _moon.Points;
        for (var i = 0; i < MoonPts; i++)
        {
            var a = -Math.PI / 2 + Math.PI * i / (MoonPts - 1);
            double oy = Math.Sin(a) * _mr, ox = side * Math.Cos(a) * _mr, ix = ox * k;
            pts[i] = new Pt(_mx + ox * cr - oy * sr, _my + ox * sr + oy * cr);
            pts[2 * MoonPts - 1 - i] = new Pt(_mx + ix * cr - oy * sr, _my + ix * sr + oy * cr);
        }
        Op(_moonGlow, 0.25 + 0.75 * (1 - k) / 2);   // the halo grows with the lit share
    }

    private double SkyFade(double y) => Clamp01((y - H * 0.46) / (H * 0.12));   // gone before the stars

    private void Spark(double x, double y, double vx, double vy, double dur, double size)
    {
        var k = _sNext; _sNext = (_sNext + 1) % Sparks;
        _sx[k] = x; _sy[k] = y; _svx[k] = vx; _svy[k] = vy; _sLife[k] = dur; _sDur[k] = dur; _sPh[k] = Rng.NextDouble() * 6.28;
        _sl[k].StrokeThickness = Math.Max(1, size);
    }

    public override void Frame(TableauFrame f)
    {
        var u = _u; var cx = _cx; var fy = _fy;
        var dt = Math.Min(f.Dt, 0.1); var dts = dt * f.Speed;

        // ---- the stars: still, each swelling with a band of its own, their colour travelling the palette at the music's pace
        _starHue += dts * (0.04 + 0.5 * f.Mid + 0.3 * f.High);
        var swing = f.Reduced ? 0.35 : 1;
        for (var i = 0; i < _stars.Count; i++)
        {
            var st = _stars[i];
            var lv = Clamp01(Lv(f, st.band) * 0.85 + f.Beat * 0.25);
            Size(st.dot, st.x, st.y, st.d * (1 + 1.4 * lv * swing));
            Op(st.dot, 0.35 + 0.65 * lv);
            var at = _starHue + i * 0.37; var k = (int)Math.Floor(at);
            var c = Mix(White, Mix(P(k), P(k + 1), at - k), Clamp01(0.25 + 0.75 * lv));
            if (st.dot.Fill is SolidColorBrush b && b.Color != c) b.Color = c;
            if (st.halo is { } h) { Size(h, st.x, st.y, st.d * (3 + 4 * lv * swing)); Op(h, 0.6 * lv); }
        }

        // ---- the moon: only a playing song moves it
        if (!f.Reduced) { _moonPhase = (_moonPhase + dt / MoonTurn) % 1; if (Math.Abs(_moonPhase - _moonDrawn) > 0.0004) DrawMoon(); }

        // ---- the beat: a flare that decays, and (once per beat) a burst
        _sinceBurst += dt;
        var burst = f.Beat > 0.06 && _prevBeat <= 0.06 && _sinceBurst > 0.16;
        _prevBeat = f.Beat;
        var hit = Clamp01(f.Beat * 2.2);
        if (f.Beat > 0.03) _flare = Math.Max(_flare, f.Reduced ? hit * 0.3 : hit);
        _flare *= Math.Exp(-dt * 4.2);

        // ---- the light the fire gives this frame: the lows carry it, a flicker rides on top, a beat lifts it
        _fl1 += dts * (7 + 9 * f.High); _fl2 += dts * (13 + 6 * f.Mid); _windPh += dts * 0.5;
        var flick = 0.5 + 0.25 * Math.Sin(_fl1) + 0.25 * Math.Sin(_fl2 * 1.31 + 1.7);
        var light = Clamp01(0.28 + 0.36 * f.Low + 0.14 * f.Loud + 0.16 * flick + 0.5 * _flare);
        var wind = 0.10 * Math.Sin(_windPh) + 0.05 * Math.Sin(_windPh * 2.3 + 1);

        Size(_pool, cx, fy + 0.02 * u, u * (1.7 + 0.6 * light), u * (0.34 + 0.12 * light)); Op(_pool, 0.35 + 0.65 * light);
        Size(_halo, cx, fy - 0.12 * u, u * (0.85 + 0.55 * light + 0.3 * _flare)); Op(_halo, 0.3 + 0.6 * light);
        Size(_halo2, cx, fy - 0.12 * u, Math.Max(W, H) * (0.8 + 0.4 * f.Low + 0.2 * _flare)); Op(_halo2, 0.2 + 0.5 * light);
        Op(_treeGlow, 0.25 + 0.75 * light);
        Op(_flash, f.Reduced ? 0 : _flare * 0.55);
        for (var i = 0; i < _treeLit.Count; i++) Op(_treeLit[i].e, _treeLit[i].w * (0.12 + 0.88 * light));
        for (var i = 0; i < _rims.Count; i++) Op(_rims[i].e, _rims[i].w * (0.2 + 0.8 * light));
        for (var i = 0; i < _lits.Count; i++) Op(_lits[i].e, _lits[i].w * (0.16 + 0.66 * light));
        Op(_logGlow, 0.4 + 0.6 * flick);
        Op(_mallow, 0.15 + 0.5 * light);

        // ---- shadows: thrown outward from the fire, their ends moving against the flames' lean
        for (var i = 0; i < _shadows.Count; i++)
        {
            var (p, gx, gy, hw) = _shadows[i];
            var tx = gx + (gx - cx) * 0.8 - wind * u * 1.2; var ty = Math.Max(Y(0.81), gy + (gy - fy) * 0.8 + 0.014 * u);
            p.Points[2] = new Pt(tx + hw * 1.9, ty + hw * 0.25); p.Points[3] = new Pt(tx - hw * 1.9, ty - hw * 0.1);
            Op(p, 0.18 + 0.5 * light);
        }

        // ---- the circle moves with the music: a sway, heads keeping time, the strumming hand, the tail
        var live = f.Reduced ? 0.35 : 1;
        _swayPh += dts * (1.5 + 2.4 * f.Mid); _strumPh += dts * (6 + 9 * f.Mid); _tailPh += dts * (5 + 11 * f.Loud);
        for (var i = 0; i < _joints.Count; i++)
        {
            var (rt, kind, amp, ph) = _joints[i];
            rt.Angle = kind switch
            {
                0 => amp * live * (Math.Sin(_swayPh + ph) * (0.45 + 0.75 * f.Loud) + 0.8 * _flare),
                1 => amp * live * (Math.Sin(_swayPh + ph + 0.7) * 0.6 + 1.3 * _flare),
                2 => amp * live * Math.Sin(_strumPh) * (0.3 + 0.7 * f.Mid),
                3 => amp * live * Math.Sin(_tailPh) * (0.4 + 0.6 * f.Loud),
                _ => amp * Math.Sin(_swayPh * 0.5 + ph),
            };
        }

        // ---- the flames: each tongue follows its band, eased; a wave travels up it; the whole fire leans with a slow wind
        double tall = 0;
        for (var i = 0; i < Tongues; i++)
        {
            _tp1[i] += dts * (4.5 + (i * 0.37) % 2.2) * (1 + 0.8 * f.Mid); _tp2[i] += dts * (9 + (i * 1.7) % 5) * (1 + f.High); _tp3[i] += dts * (1.3 + 0.21 * i);
            var breathe = 0.5 + 0.5 * Math.Sin(_tp3[i]);
            var target = (TBase[i] * (0.8 + 0.4 * breathe) + TGain[i] * Clamp01(0.6 * Lv(f, TBand[i]) + 0.25 * f.Loud + 0.15 * f.Mid)) * (1 + 0.32 * _flare);
            _th[i] += (target - _th[i]) * (target > _th[i] ? 0.4 : 0.12);
            double hgt = _th[i] * u * 1.22, w = TW[i] * u * (1.05 + 0.3 * f.Low), bx = cx + TX[i] * u, by = fy - 0.012 * u;
            if (hgt > tall) tall = hgt;
            var pts = _tongue[i].Points;
            for (var j = 0; j < K; j++)
            {
                var y = j / (double)(K - 1);
                var mx = bx + wind * y * Math.Sqrt(y) * hgt + Math.Sin(_tp1[i] - y * 3.6) * w * 0.7 * y + Math.Sin(_tp2[i] - y * 7.5) * w * 0.28 * y;
                var hw = w * Math.Pow(1 - y, 0.9) * (0.72 + 1.1 * y * (1 - y));
                var py = by - hgt * y;
                pts[j] = new Pt(mx - hw, py); pts[2 * K - 1 - j] = new Pt(mx + hw, py);
                if (j == K - 1) { _tipX[i] = mx; _tipY[i] = py; }
            }
            Op(_tongue[i], 0.78 + 0.22 * light);
        }
        Size(_bed, cx, fy + 0.004 * u, u * (0.27 + 0.06 * light), u * (0.07 + 0.02 * flick)); Op(_bed, 0.7 + 0.3 * flick);
        Size(_core, cx + wind * u * 0.05, fy - 0.07 * u, u * (0.15 + 0.12 * light), u * (0.2 + 0.22 * light)); Op(_core, 0.5 + 0.5 * light);

        // ---- a burst on the beat: a fan of fast sparks, a ring of light across the ground, flame breaking off the tips
        if (burst)
        {
            _sinceBurst = 0;
            var n = f.Reduced ? 3 : 12 + (int)(26 * hit);
            for (var i = 0; i < n; i++)
            {
                var a = (Rng.NextDouble() - 0.5) * 1.5; var v = u * (0.32 + 0.5 * Rng.NextDouble()) * (0.7 + 0.5 * hit);
                Spark(cx + (Rng.NextDouble() - 0.5) * 0.12 * u, fy - (0.04 + 0.5 * Rng.NextDouble()) * tall, Math.Sin(a) * v, -Math.Cos(a) * v, 0.7 + 0.9 * Rng.NextDouble(), u * (0.0025 + 0.003 * Rng.NextDouble()));
            }
            if (!f.Reduced)
            {
                // (2026-11-11: the ring of light a beat sent across the ground was taken out; the rings are never started)
                for (var i = 0; i < 2; i++)
                {
                    var t = Rng.Next(Tongues); var k = _lNext; _lNext = (_lNext + 1) % Licks;
                    _lx[k] = _tipX[t]; _ly[k] = _tipY[t] + 0.03 * u; _lLife[k] = 1;
                }
            }
        }
        // the steady rise: more with the highs and the loudness
        _emit += dts * (7 + 30 * f.High + 18 * f.Loud);
        while (_emit >= 1)
        {
            _emit -= 1;
            Spark(cx + (Rng.NextDouble() - 0.5) * 0.14 * u, fy - (0.1 + 0.7 * Rng.NextDouble()) * tall, (Rng.NextDouble() - 0.5) * 0.12 * u, -u * (0.16 + 0.26 * Rng.NextDouble()), 0.9 + 1.2 * Rng.NextDouble(), u * (0.002 + 0.0025 * Rng.NextDouble()));
        }
        for (var i = 0; i < Sparks; i++)
        {
            var s = _sl[i];
            if (_sLife[i] <= 0) continue;
            _sLife[i] -= dt * (0.4 + 0.6 * f.Speed);
            if (_sLife[i] <= 0) { s.Opacity = 0; continue; }
            var drag = Math.Exp(-dts * 1.5);
            _svx[i] = _svx[i] * drag + (Math.Sin(_sPh[i] + f.T * 3.1) * 0.22 + wind * 0.9) * u * dts;
            _svy[i] = _svy[i] * drag - 0.11 * u * dts;
            _sx[i] += _svx[i] * dts; _sy[i] += _svy[i] * dts;
            var age = 1 - _sLife[i] / _sDur[i];
            s.X1 = _sx[i]; s.Y1 = _sy[i]; s.X2 = _sx[i] - _svx[i] * 0.035; s.Y2 = _sy[i] - _svy[i] * 0.035 + 0.5;
            var br = age < 0.35 ? _hot : age < 0.7 ? _warm : _red;
            if (!ReferenceEquals(s.Stroke, br)) s.Stroke = br;
            Op(s, (1 - age * age) * (0.65 + 0.35 * Math.Sin(_sPh[i] + f.T * 23)) * SkyFade(_sy[i]));
        }
        // slow embers: a few soft glows that wander up and wink out
        _emitEmber += dts * (1.2 + 2.5 * f.Loud);
        if (_emitEmber >= 1)
        {
            _emitEmber = 0;
            var k = _eNext; _eNext = (_eNext + 1) % Embers;
            _ex[k] = cx + (Rng.NextDouble() - 0.5) * 0.16 * u; _ey[k] = fy - (0.3 + 0.6 * Rng.NextDouble()) * tall; _evy[k] = u * (0.07 + 0.08 * Rng.NextDouble());
            _eDur[k] = _eLife[k] = 2.4 + 1.8 * Rng.NextDouble(); _ePh[k] = Rng.NextDouble() * 6.28; _eSize[k] = u * (0.014 + 0.012 * Rng.NextDouble());
        }
        for (var i = 0; i < Embers; i++)
        {
            if (_eLife[i] <= 0) continue;
            _eLife[i] -= dt * (0.4 + 0.6 * f.Speed);
            if (_eLife[i] <= 0) { _em[i].Opacity = 0; continue; }
            var age = 1 - _eLife[i] / _eDur[i];
            _ey[i] -= _evy[i] * dts; _ex[i] += (Math.Sin(_ePh[i] + f.T * 1.3) * 0.05 + wind * 0.35) * u * dts;
            Size(_em[i], _ex[i], _ey[i], _eSize[i] * (1 - 0.5 * age) * (0.8 + 0.4 * Math.Sin(_ePh[i] + f.T * 9)));
            Op(_em[i], Math.Sin(Math.PI * Math.Min(1, age * 1.15)) * (0.6 + 0.4 * f.High) * SkyFade(_ey[i]));
        }
        // flame that broke off a tip: rises, thins, is gone in under half a second
        for (var i = 0; i < Licks; i++)
        {
            if (_lLife[i] <= 0) continue;
            _lLife[i] -= dt * 2.4;
            if (_lLife[i] <= 0) { _lk[i].Opacity = 0; continue; }
            _ly[i] -= u * 0.3 * dt; _lx[i] += wind * u * 0.3 * dt;
            Size(_lk[i], _lx[i], _ly[i], u * 0.04 * _lLife[i], u * (0.05 + 0.07 * _lLife[i]));
            Op(_lk[i], _lLife[i] * 0.9 * SkyFade(_ly[i] + H * 0.06));
        }
        // rings of light across the ground
        for (var i = 0; i < Rings; i++)
        {
            if (_rAge[i] < 0) continue;
            _rAge[i] += dt / 0.9;
            if (_rAge[i] >= 1) { _rAge[i] = -1; _ring[i].Opacity = 0; continue; }
            var e = 1 - (1 - _rAge[i]) * (1 - _rAge[i]);
            double w = u * (0.3 + 2.1 * e), h = u * (0.07 + 0.46 * e);
            _ring[i].Width = w; _ring[i].Height = h; At(_ring[i], cx - w / 2, fy + 0.02 * u - h / 2);
            Op(_ring[i], (1 - _rAge[i]) * (1 - _rAge[i]) * 0.55);
        }
        // smoke: soft, lit from below, leaning with the wind, gone before the stars
        _emitPuff += dts * 1.3;
        if (_emitPuff >= 1) { _emitPuff = 0; _pAge[_pNext] = 0; _px[_pNext] = cx + (Rng.NextDouble() - 0.5) * 0.05 * u; _pNext = (_pNext + 1) % Puffs; }
        for (var i = 0; i < Puffs; i++)
        {
            if (_pAge[i] < 0) continue;
            _pAge[i] += dts / 4.5;
            if (_pAge[i] >= 1) { _pAge[i] = -1; _pf[i].Opacity = 0; continue; }
            var a = _pAge[i];
            _px[i] += wind * u * 0.16 * dts;
            var y = fy - tall * 0.8 - a * u * 0.42;
            Size(_pf[i], _px[i] + Math.Sin(a * 5 + i) * u * 0.02, y, u * (0.10 + 0.26 * a));
            Op(_pf[i], Math.Sin(Math.PI * a) * (0.16 + 0.12 * light) * SkyFade(y));
        }
    }
}
