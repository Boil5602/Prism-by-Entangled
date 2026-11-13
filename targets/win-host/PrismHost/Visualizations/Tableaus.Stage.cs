using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;
using Pt = Windows.Foundation.Point;

namespace PrismHost.Visualizations;

/// <summary>
/// The four originals drawn again as stage scenes (2026-11-11, asked for all four to be made new, and for Bloom not to sit
/// wholly behind a cover in the middle): PRISM Beams, Spectrum, Ribbon and Bloom. A stage scene does not paint a sky: its ground
/// is see-through over a backdrop cover, and each one is told the square a cover in the middle takes (Tableau.FocalSide) and
/// draws around it. Every shape is made once in OnBuild; a frame moves and re-lights them, and a pool is recycled.
/// </summary>
public abstract class StageTableau : Tableau
{
    protected Rectangle? GroundRect;
    protected Ellipse? GroundGlow;
    protected bool Focal => FocalSide > 0;
    protected double Cx => Focal ? FocalCx : W / 2;
    protected double Cy => Focal ? FocalCy : H / 2;
    protected Color Blend(double u)
    {
        var x = Math.Clamp(u, 0, 1) * (Pal.Length - 1); var i = (int)Math.Floor(x); var j = Math.Min(Pal.Length - 1, i + 1);
        return Mix(Pal[i], Pal[j], x - i);
    }
    protected static Color Lighten(Color c, double t) => Mix(c, Color.FromArgb(255, 255, 255, 255), t);
    protected static LinearGradientBrush Across(params (Color c, double at)[] stops)
    {
        var br = new LinearGradientBrush { StartPoint = new Pt(0, 0), EndPoint = new Pt(1, 0) };
        foreach (var (c, at) in stops) br.GradientStops.Add(new GradientStop { Color = c, Offset = at });
        return br;
    }
    /// <summary>The dark ground with a breath of the palette in it: shown with no cover behind, clear over a backdrop cover.</summary>
    protected void MakeGround(Color tint)
    {
        GroundRect = RB(0, 0, W, H, Vertical((Color.FromArgb(255, 0x0A, 0x0E, 0x1A), 0), (Mix(Color.FromArgb(255, 0x10, 0x16, 0x28), tint, 0.10), 0.6), (Color.FromArgb(255, 0x07, 0x09, 0x10), 1)));
        GroundGlow = Glow(W / 2, H / 2, Math.Max(W, H) * 1.1, tint, 0.16);
    }
    protected void GroundFrame(double glow)
    {
        if (GroundRect is not null) Op(GroundRect, Ground ? 1 : 0);
        if (GroundGlow is not null) { Op(GroundGlow, (Ground ? 1 : 0.6) * (0.35 + 0.65 * glow)); Size(GroundGlow, Cx, Cy, Math.Max(W, H) * (0.9 + 0.35 * glow)); }
    }
}

// ------------------------------------------------------------------------------------------------ Spectrum
/// <summary>Spectrum: bars in the palette low to high, each with a cap that holds its peak and falls, a reflection under the line they
/// stand on, and a glow behind that breathes with the loudness. With a cover in the middle the bars stand in two wings beside it.</summary>
public sealed class SpectrumStage : StageTableau
{
    private const int N = 48;
    private readonly Rectangle[] _bar = new Rectangle[N], _cap = new Rectangle[N], _refl = new Rectangle[N];
    private readonly double[] _peak = new double[N], _lv = new double[N];
    private Rectangle _line = null!;
    private Ellipse _back = null!;
    private double _pulse;

    protected override void OnBuild()
    {
        MakeGround(P(2));
        _back = Glow(W / 2, Y(0.8), W, P(1), 0.22, 0);
        for (var i = 0; i < N; i++)
        {
            var c = Blend(i / (double)(N - 1));
            _refl[i] = RB(0, 0, 1, 1, Vertical((A(c, 0.34), 0), (A(c, 0), 1)));
            _bar[i] = RB(0, 0, 1, 1, Vertical((Lighten(c, 0.45), 0), (c, 0.35), (Mix(c, Ink, 0.45), 1)));
            _cap[i] = R(0, 0, 1, 1, Lighten(c, 0.6), 0.95);
        }
        _line = RB(0, 0, W, Math.Max(1, S(0.0022)), Across((A(White, 0), 0), (A(White, 0.4), 0.5), (A(White, 0), 1)));
        Vignette(0.28);
    }

    public override void Frame(TableauFrame f)
    {
        _pulse = Math.Max(_pulse * 0.88, Clamp01(f.Beat * 4));
        GroundFrame(f.Loud);
        var y0 = Y(0.80); var maxH = S(0.60);
        double left, slot; var wings = Focal;
        if (wings) { left = X(0.03); slot = Math.Max(2, (FocalCx - FocalSide / 2 - X(0.025) - left) / (N / 2)); }
        else { left = X(0.05); slot = (W - 2 * left) / N; }
        var bw = Math.Max(1.5, slot * 0.64); var rad = bw * 0.28;
        for (var i = 0; i < N; i++)
        {
            double x, lvl;
            if (wings)
            {
                // two wings, the low bands next to the cover and the high ones at the edges; the right wing mirrors the left
                var j = i / 2; var rightWing = (i & 1) == 1; lvl = Lv(f, (j + 0.5) / (N / 2));
                var inner = FocalCx - FocalSide / 2 - X(0.025);
                x = rightWing ? W - inner + j * slot + (slot - bw) / 2 : inner - (j + 1) * slot + (slot - bw) / 2;
            }
            else { lvl = Lv(f, i / (double)(N - 1)); x = left + i * slot + (slot - bw) / 2; }
            // the highs of a mix sit far under its lows: each bar is lifted by its place, so the right of the row moves too
            var place = wings ? (i / 2 + 0.5) / (N / 2) : i / (double)(N - 1); lvl = Math.Pow(Clamp01(lvl * (0.8 + 1.5 * place)), 0.85);
            _lv[i] += (lvl - _lv[i]) * (lvl > _lv[i] ? 0.7 : 0.3);
            _peak[i] = Math.Max(_lv[i], _peak[i] - f.Dt * (f.Reduced ? 0.08 : 0.42));
            var bh = Math.Max(S(0.008), (0.03 + 0.97 * _lv[i]) * maxH);
            var b = _bar[i]; b.Width = bw; b.Height = bh; b.RadiusX = b.RadiusY = rad; At(b, x, y0 - bh); Op(b, 0.82 + 0.18 * _pulse);
            var r = _refl[i]; r.Width = bw; r.Height = Math.Max(1, bh * 0.42); At(r, x, y0 + S(0.006)); Op(r, 0.5 + 0.4 * _lv[i]);
            var c = _cap[i]; var ch = Math.Max(1.5, S(0.005)); c.Width = bw; c.Height = ch; c.RadiusX = c.RadiusY = ch / 2;
            At(c, x, y0 - Math.Max(bh, (0.03 + 0.97 * _peak[i]) * maxH) - ch - S(0.006)); Op(c, 0.35 + 0.65 * Clamp01((_peak[i] - _lv[i]) * 6 + 0.25));
        }
        At(_line, 0, y0 + S(0.002));
        Size(_back, Cx, y0, W * (0.8 + 0.3 * f.Loud), S(0.9 + 0.5 * f.Loud)); Op(_back, 0.25 + 0.6 * f.Loud + 0.15 * _pulse);
    }
}

// ------------------------------------------------------------------------------------------------ Ribbon
/// <summary>Ribbon: five silk bands that cross the stage and travel, each as thick as the music under it and each a pass behind the
/// one before. The lows lift the swell, the highs put a shimmer on the leading edge.</summary>
public sealed class RibbonStage : StageTableau
{
    private const int K = 5, M = 56;
    private readonly Polygon[] _body = new Polygon[K];
    private readonly Polyline[] _edge = new Polyline[K], _halo = new Polyline[K];
    private readonly double[] _env = new double[M], _smooth = new double[M];
    private double _flow, _swell, _pulse;
    private Ellipse[] _motes = Array.Empty<Ellipse>();
    private double[] _mx = Array.Empty<double>(), _my = Array.Empty<double>(), _mp = Array.Empty<double>();

    protected override void OnBuild()
    {
        MakeGround(P(1));
        for (var k = K - 1; k >= 0; k--)
        {
            var a = P(k); var b = P(k + 1); var depth = 1 - k / (double)K;
            _halo[k] = PL(Across((A(a, 0), 0), (A(a, 0.5), 0.3), (A(b, 0.5), 0.7), (A(b, 0), 1)), S(0.022), 0.25 * depth);
            _body[k] = GB(Across((A(a, 0), 0), (A(a, 0.75), 0.18), (A(Mix(a, b, 0.5), 0.6), 0.5), (A(b, 0.75), 0.82), (A(b, 0), 1)), 0.2 + 0.7 * depth);
            for (var i = 0; i < 2 * M; i++) _body[k].Points.Add(new Pt(0, 0));
            _edge[k] = PL(Across((A(White, 0), 0), (A(Lighten(a, 0.6), 0.95), 0.25), (A(Lighten(b, 0.6), 0.95), 0.75), (A(White, 0), 1)), Math.Max(1.2, S(0.0035)), 0.3 + 0.7 * depth);
            for (var i = 0; i < M; i++) { _edge[k].Points.Add(new Pt(0, 0)); _halo[k].Points.Add(new Pt(0, 0)); }
        }
        var rng = new Random(23); const int motes = 36;
        _motes = new Ellipse[motes]; _mx = new double[motes]; _my = new double[motes]; _mp = new double[motes];
        for (var i = 0; i < motes; i++) { _mx[i] = rng.NextDouble(); _my[i] = rng.NextDouble(); _mp[i] = rng.NextDouble() * 6.28; _motes[i] = Glow(0, 0, S(0.008 + 0.01 * rng.NextDouble()), Lighten(P(i), 0.5), 0.9, 0); }
        Vignette(0.3);
    }

    public override void Frame(TableauFrame f)
    {
        _pulse = Math.Max(_pulse * 0.9, Clamp01(f.Beat * 4));
        GroundFrame(f.Loud);
        _flow += f.Dt * f.Speed * (0.55 + 1.3 * f.Mid); _swell += (f.Low - _swell) * 0.08;
        for (var i = 0; i < M; i++)
        {
            // the music under each point of the ribbon: the lows at the left, the highs at the right, smoothed along the length
            var u = i / (double)(M - 1); var raw = 0.3 * Lv(f, u) + 0.2 * (Lv(f, Math.Max(0, u - 0.03)) + Lv(f, Math.Min(1, u + 0.03))) + 0.15 * (Lv(f, Math.Max(0, u - 0.07)) + Lv(f, Math.Min(1, u + 0.07)));
            _env[i] += (raw - _env[i]) * (raw > _env[i] ? 0.5 : 0.14);
        }
        // smoothed once more along the length: a ribbon has no corners
        _smooth[0] = _env[0]; _smooth[M - 1] = _env[M - 1];
        for (var i = 1; i < M - 1; i++) _smooth[i] = (_env[Math.Max(0, i - 2)] + 2 * _env[i - 1] + 3 * _env[i] + 2 * _env[i + 1] + _env[Math.Min(M - 1, i + 2)]) / 9;
        var cy = Cy; var amp = S(Focal ? 0.22 : 0.18) * (0.4 + 0.6 * _swell + 0.2 * _pulse);
        for (var k = 0; k < K; k++)
        {
            var body = _body[k]; var edge = _edge[k]; var halo = _halo[k];
            var ph = k * 0.9; var lag = _flow - k * 0.22; var off = (k - (K - 1) / 2.0) * S(Focal ? 0.09 : 0.075);
            for (var i = 0; i < M; i++)
            {
                var u = i / (double)(M - 1); var x = -W * 0.02 + u * W * 1.04; var taper = Math.Pow(Math.Sin(Math.PI * Math.Clamp(u, 0.001, 0.999)), 0.5);
                var wave = Math.Sin(u * 5.2 - lag * 1.3 + ph) * 0.58 + Math.Sin(u * 9.1 + lag * 0.9 + ph * 1.7) * 0.27 + Math.Sin(u * 15.0 - lag * 2.1 + ph * 0.6) * 0.15 * (0.4 + f.High);
                var y = cy + off + wave * amp * (0.55 + 0.9 * _smooth[i]);
                var half = (S(0.012) + S(0.11) * _smooth[i] * (1 - k * 0.1)) * taper;
                var twist = Math.Sin(u * 3.3 + lag * 0.7 + ph) * 0.5;   // the ribbon turns: the body leans above or below its bright edge
                body.Points[i] = new Pt(x, y - half * (1 + twist)); body.Points[2 * M - 1 - i] = new Pt(x, y + half * (1 - twist));
                var p = new Pt(x, y - half * (1 + twist)); edge.Points[i] = p; halo.Points[i] = new Pt(x, y);
            }
            Op(halo, (0.14 + 0.3 * f.Loud + 0.2 * _pulse) * (1 - k / (double)(K + 1)));
        }
        for (var i = 0; i < _motes.Length; i++)
        {
            _mx[i] += f.Dt * f.Speed * (0.012 + 0.03 * f.Mid) * (0.5 + (i % 5) * 0.2); if (_mx[i] > 1.05) _mx[i] = -0.05;
            var u = Math.Clamp(_mx[i], 0, 1); var e = _env[(int)(u * (M - 1))];
            var y = cy + (_my[i] - 0.5) * S(0.7) + Math.Sin(f.T * 0.6 + _mp[i]) * S(0.02);
            Size(_motes[i], X(_mx[i]), y, S(0.006 + 0.016 * e)); Op(_motes[i], 0.08 + 0.75 * e * Osc(f.T, 2.2, _mp[i]));
        }
    }
}

// ------------------------------------------------------------------------------------------------ Bloom
/// <summary>Bloom: a flower of light. Three rings of petals stand around the middle, a petal a band, and each opens as far as its band
/// is loud; the rings turn against each other with the mids. A beat throws pollen from the petals' tips.
/// With a cover in the middle the flower opens around it: the petals start at the cover's edge, so the cover is the flower's heart.</summary>
public sealed class BloomStage : StageTableau
{
    private const int Petals = 24, Layers = 3, Rings = 4, Pollen = 110;
    private readonly Ellipse[,] _petal = new Ellipse[Layers, Petals];
    private readonly RotateTransform[,] _rot = new RotateTransform[Layers, Petals];
    private readonly double[,] _open = new double[Layers, Petals];
    private readonly double[] _spin = new double[Layers];
    private readonly Ellipse[] _ring = new Ellipse[Rings];
    private readonly double[] _ringAge = new double[Rings];
    private readonly Ellipse[] _dot = new Ellipse[Pollen];
    private readonly double[] _px = new double[Pollen], _py = new double[Pollen], _vx = new double[Pollen], _vy = new double[Pollen], _age = new double[Pollen], _life = new double[Pollen];
    private Ellipse _halo = null!, _heart = null!, _heartCore = null!;
    private double _pulse, _since = 9;
    private int _nextRing, _nextDot;

    protected override void OnBuild()
    {
        MakeGround(P(0));
        _halo = Glow(W / 2, H / 2, S(1), P(0), 0.5, 0);
        for (var i = 0; i < Rings; i++) { _ring[i] = new Ellipse { Stroke = B(Lighten(P(i), 0.4)), StrokeThickness = Math.Max(1.5, S(0.004)), Opacity = 0 }; C.Children.Add(_ring[i]); _ringAge[i] = 9; }
        for (var l = Layers - 1; l >= 0; l--)
            for (var i = 0; i < Petals; i++)
            {
                var c = Blend(((i + l * 3) % Petals) / (double)(Petals - 1)); var tip = Lighten(c, 0.35);
                var e = new Ellipse { Fill = Across((A(c, 0.05), 0), (A(c, 0.55), 0.45), (A(tip, 0.9), 0.82), (A(tip, 0.25), 1)), Opacity = 0 };
                var rt = new RotateTransform(); e.RenderTransform = rt; C.Children.Add(e); _petal[l, i] = e; _rot[l, i] = rt;
            }
        _heart = Glow(W / 2, H / 2, S(0.3), Lighten(P(2), 0.5), 0.95, 0);
        _heartCore = Glow(W / 2, H / 2, S(0.1), White, 1, 0);
        for (var i = 0; i < Pollen; i++) { _dot[i] = Glow(0, 0, S(0.012), Lighten(P(i), 0.45), 1, 0); _age[i] = 9; _life[i] = 1; }
        Vignette(0.3);
    }

    public override void Frame(TableauFrame f)
    {
        var hit = Clamp01(f.Beat * 4); _pulse = Math.Max(_pulse * 0.9, hit); _since += f.Dt;
        GroundFrame(f.Loud);
        double cx = Cx, cy = Cy; var rng = Rng;
        // the petals' foot: just inside the cover's edge when a cover is the heart, else a small heart of light
        var r0 = Focal ? FocalSide * 0.47 : S(0.06 + 0.02 * f.Loud);
        var reach = Focal ? Math.Max(S(0.2), Math.Min(W / 2 - r0, S(0.62))) : S(0.52);
        for (var l = 0; l < Layers; l++)
        {
            var scale = l == 0 ? 1.0 : l == 1 ? 0.7 : 0.44; var dir = l % 2 == 0 ? 1 : -1;
            _spin[l] += dir * f.Dt * f.Speed * (3 + 22 * f.Mid) * (1 + l * 0.35);
            for (var i = 0; i < Petals; i++)
            {
                var lvl = Math.Pow(Clamp01(Lv(f, ((i * (l + 1) * 5) % Petals) / (double)(Petals - 1))), 0.8);
                _open[l, i] += (lvl - _open[l, i]) * (lvl > _open[l, i] ? 0.55 : 0.12);
                var o = _open[l, i]; var len = (S(0.05) + reach * (0.24 + 0.76 * o) * (1 + 0.1 * _pulse)) * scale;
                var wide = Math.Max(2, (r0 + len * 0.55) * 2 * Math.PI / Petals * (0.62 + 0.3 * o));
                var e = _petal[l, i]; e.Width = len; e.Height = wide; At(e, cx + r0, cy - wide / 2);
                var rt = _rot[l, i]; rt.CenterX = -r0; rt.CenterY = wide / 2; rt.Angle = _spin[l] + (i + l * 0.5) * 360.0 / Petals;
                Op(e, (0.22 + 0.78 * o) * (l == 0 ? 0.8 : l == 1 ? 0.9 : 1));
            }
        }
        Size(_halo, cx, cy, (r0 * 2 + reach * 1.5) * (0.9 + 0.3 * f.Loud + 0.15 * _pulse)); Op(_halo, 0.3 + 0.5 * f.Loud + 0.2 * _pulse);
        Size(_heart, cx, cy, Focal ? FocalSide * 1.5 : S(0.2 + 0.12 * f.Loud + 0.08 * _pulse)); Op(_heart, Focal ? 0.25 + 0.3 * _pulse : 0.7 + 0.3 * _pulse);
        Size(_heartCore, cx, cy, S(0.07 + 0.05 * _pulse)); Op(_heartCore, Focal ? 0 : 0.85);
        // a beat: pollen off the tips
        if (!f.Reduced && hit > 0.3 && _since > 0.28)
        {
            _since = 0;   // (2026-11-11: the ring of light a beat sent out was taken out; the rings are never started)
            var count = (int)(8 + 26 * hit);
            for (var k = 0; k < count; k++)
            {
                var i = _nextDot; _nextDot = (_nextDot + 1) % Pollen; var ang = rng.NextDouble() * Math.PI * 2;
                var start = r0 + reach * (0.25 + 0.5 * rng.NextDouble()); var v = S(0.10 + 0.32 * rng.NextDouble()) * (0.6 + hit);
                if (Focal) { var edge = FocalSide / 2 / Math.Max(Math.Abs(Math.Cos(ang)), Math.Abs(Math.Sin(ang))); start = Math.Max(start, edge + S(0.01)); }   // never born under the cover
                _px[i] = cx + Math.Cos(ang) * start; _py[i] = cy + Math.Sin(ang) * start; _vx[i] = Math.Cos(ang) * v; _vy[i] = Math.Sin(ang) * v;
                _age[i] = 0; _life[i] = 1.4 + 1.8 * rng.NextDouble();
            }
        }
        for (var i = 0; i < Rings; i++)
        {
            _ringAge[i] += f.Dt; var a = _ringAge[i] / 1.5;
            if (a >= 1) { Op(_ring[i], 0); continue; }
            var d = 2 * (r0 + (reach * 1.25 + S(0.1)) * (1 - Math.Pow(1 - a, 2.2)));
            _ring[i].Width = _ring[i].Height = d; At(_ring[i], cx - d / 2, cy - d / 2); Op(_ring[i], 0.7 * (1 - a) * (1 - a));
        }
        for (var i = 0; i < Pollen; i++)
        {
            if (_age[i] >= _life[i]) { if (_dot[i].Opacity != 0) _dot[i].Opacity = 0; continue; }
            _age[i] += f.Dt; var a = _age[i] / _life[i];
            _px[i] += _vx[i] * f.Dt; _py[i] += _vy[i] * f.Dt; _vx[i] *= 0.985; _vy[i] = _vy[i] * 0.985 - S(0.02) * f.Dt;
            Size(_dot[i], _px[i], _py[i], S(0.008 + 0.012 * (1 - a) + 0.008 * f.High)); Op(_dot[i], Math.Sin(Math.PI * Math.Min(1, a * 1.15 + 0.05)) * 0.95);
        }
    }
}

// ------------------------------------------------------------------------------------------------ PRISM Beams
/// <summary>PRISM Beams: a white beam enters a glass prism and leaves as the palette's four bands. Each band is a quarter of the music:
/// it swings, widens and brightens with its own energy and lays a pool of light where it lands. Dust in the room shows where a beam
/// passes, the prism flashes on a beat, and the spectrum floor stands along the bottom (concept-scenes 2.5.2 points 1 and 8).
/// With a cover in the middle the prism stands at the cover's left and the bands leave from behind it.</summary>
public sealed class BeamsStage : StageTableau
{
    private const int Bars = VisualizationChrome.SpectrumBars, Dust = 70;
    private const double Swing = 0.55, Spread = 0.75;
    private Polygon _prism = null!, _facet = null!, _inGlow = null!;
    private Line _inCore = null!;
    private Ellipse _flash = null!;
    private Polygon[] _cone = Array.Empty<Polygon>(), _coneWide = Array.Empty<Polygon>();
    private Line[] _core = Array.Empty<Line>();
    private Ellipse[] _pool = Array.Empty<Ellipse>();
    private double[] _lo = Array.Empty<double>(), _hi = Array.Empty<double>(), _e = Array.Empty<double>(), _ang = Array.Empty<double>();
    private readonly Rectangle[] _bars = new Rectangle[Bars], _barRefl = new Rectangle[Bars];
    private readonly Ellipse[] _dust = new Ellipse[Dust];
    private readonly double[] _dx = new double[Dust], _dy = new double[Dust], _dp = new double[Dust];
    private double _pulse;

    protected override void OnBuild()
    {
        MakeGround(P(2));
        var n = Pal.Length; _cone = new Polygon[n]; _coneWide = new Polygon[n]; _core = new Line[n]; _pool = new Ellipse[n];
        _lo = new double[n]; _hi = new double[n]; _e = new double[n]; _ang = new double[n];
        for (var i = 0; i < n; i++) _hi[i] = 0.2;
        _inGlow = GB(Across((A(White, 0), 0), (A(White, 0.3), 1)), 1, 0, 0, 0, 0, 0, 0);
        _inCore = L(0, 0, 0, 0, White, Math.Max(1.5, S(0.006)), 0.9);
        for (var i = 0; i < n; i++)
        {
            var c = P(i);
            _coneWide[i] = GB(Across((A(c, 0.32), 0), (A(c, 0.12), 0.55), (A(c, 0), 1)), 0, 0, 0, 0, 0, 0, 0);
            _cone[i] = GB(Across((A(Lighten(c, 0.25), 0.8), 0), (A(c, 0.42), 0.5), (A(c, 0.06), 1)), 0, 0, 0, 0, 0, 0, 0);
        }
        for (var i = 0; i < n; i++) { _core[i] = L(0, 0, 0, 0, Lighten(P(i), 0.5), Math.Max(1.2, S(0.004)), 0); _pool[i] = Glow(0, 0, S(0.2), P(i), 0.7, 0); }
        var rng = new Random(31);
        for (var i = 0; i < Dust; i++) { _dx[i] = rng.NextDouble(); _dy[i] = rng.NextDouble(); _dp[i] = rng.NextDouble() * 6.28; _dust[i] = Glow(0, 0, S(0.006 + 0.008 * rng.NextDouble()), White, 1, 0); }
        _flash = Glow(0, 0, S(0.3), White, 0.9, 0);
        _prism = new Polygon
        {
            Fill = new LinearGradientBrush { StartPoint = new Pt(0, 0), EndPoint = new Pt(1, 1), GradientStops = { new GradientStop { Color = A(White, 0.34), Offset = 0 }, new GradientStop { Color = A(White, 0.08), Offset = 0.55 }, new GradientStop { Color = A(P(2), 0.22), Offset = 1 } } },
            Stroke = B(A(White, 0.85)), StrokeThickness = Math.Max(1.2, S(0.003)), StrokeLineJoin = PenLineJoin.Round,
        };
        for (var i = 0; i < 3; i++) _prism.Points.Add(new Pt(0, 0));
        C.Children.Add(_prism);
        _facet = GB(Across((A(White, 0.4), 0), (A(White, 0), 1)), 0.7, 0, 0, 0, 0, 0, 0);
        for (var i = 0; i < Bars; i++)
        {
            var c = Blend(i / (double)(Bars - 1));
            _barRefl[i] = RB(0, 0, 1, 1, Vertical((A(c, 0.3), 0), (A(c, 0), 1)));
            _bars[i] = RB(0, 0, 1, 1, Vertical((Lighten(c, 0.4), 0), (c, 0.5), (Mix(c, Ink, 0.4), 1)), 0.75);
        }
        Vignette(0.3);
    }

    public override void Frame(TableauFrame f)
    {
        _pulse = Math.Max(_pulse * 0.88, Clamp01(f.Beat * 4));
        GroundFrame(f.Loud);
        var n = Pal.Length; var t = f.T * f.Speed;
        double cx = X(VisualizationChrome.PrismCenterX), cy = Y(VisualizationChrome.PrismCenterY); var ps = 0.22 * Math.Min(W, H);
        if (Focal)
        {
            // the prism at the cover's left, in the room the cover leaves; the bands come out from behind the cover's right edge
            var room = FocalCx - FocalSide / 2; ps = Math.Min(ps, room * 0.62); cx = Math.Max(ps * 0.7, room - ps * 0.75); cy = FocalCy;
        }
        ps *= 1 + 0.08 * _pulse;
        _prism.Points[0] = new Pt(cx, cy - ps * 0.6); _prism.Points[1] = new Pt(cx + ps * 0.55, cy + ps * 0.4); _prism.Points[2] = new Pt(cx - ps * 0.55, cy + ps * 0.4);
        Pts(_facet, cx, cy - ps * 0.6, cx - ps * 0.12, cy + ps * 0.4, cx - ps * 0.55, cy + ps * 0.4);
        double inX = cx - ps * 0.27, inY = cy - ps * 0.02, y00 = cy + H * 0.1; var iw = S(0.01 + 0.02 * f.Loud);
        Pts(_inGlow, 0, y00 - iw * 0.3, inX, inY - iw, inX, inY + iw, 0, y00 + iw * 0.3); Op(_inGlow, 0.3 + 0.6 * f.Loud);
        _inCore.X1 = 0; _inCore.Y1 = y00; _inCore.X2 = inX; _inCore.Y2 = inY; Op(_inCore, 0.5 + 0.5 * f.Loud);
        double ox = cx + ps * 0.27, oy = cy - ps * 0.02;
        var levels = f.Levels.Length;
        for (var i = 0; i < n; i++)
        {
            // the peak of the band's quarter of the spectrum, measured across its own recent range (a mean that wide hardly moves)
            var from = i * levels / n; var to = Math.Max(from + 1, (i + 1) * levels / n); double raw = 0;
            for (var k = from; k < to && k < levels; k++) raw = Math.Max(raw, f.Levels[k]);
            _hi[i] = Math.Max(raw, _hi[i] - (_hi[i] - raw) * 0.012); _lo[i] = Math.Min(raw, _lo[i] + (raw - _lo[i]) * 0.012);
            var e = Math.Clamp((raw - _lo[i]) / Math.Max(0.04, _hi[i] - _lo[i]), 0, 1); _e[i] = e;
            var rest = (i - (n - 1) / 2.0) * (Spread / Math.Max(1, n - 1));
            var ang = rest * (0.85 + 0.35 * e) + (e - 0.5) * Swing + Math.Sin(t * 0.8 + i) * 0.03; _ang[i] = ang;
            double ux = Math.Cos(ang), uy = Math.Sin(ang); var len = (W - ox) / Math.Max(0.3, ux) * 1.04; double x2 = ox + ux * len, y2 = oy + uy * len;   // just past the right edge
            void Cone(Polygon g, double half) { double nx = -uy * half, ny = ux * half; Pts(g, ox, oy - S(0.004), x2 + nx, y2 + ny, x2 - nx, y2 - ny, ox, oy + S(0.004)); }
            Cone(_coneWide[i], (0.05 + 0.24 * e) * H); Op(_coneWide[i], 0.25 + 0.75 * e);
            Cone(_cone[i], (0.012 + 0.085 * e) * H); Op(_cone[i], 0.3 + 0.7 * e);
            var core = _core[i]; core.X1 = ox; core.Y1 = oy; core.X2 = x2; core.Y2 = y2; core.StrokeThickness = Math.Max(1.2, S(0.003 + 0.007 * e)); Op(core, 0.3 + 0.7 * e);
            // where the band lands: the right edge, or the top or bottom when it swings that far
            var reachX = (W - ox) / Math.Max(0.05, ux); var hitX = W; var hitY = oy + uy * reachX;
            if (hitY < 0) { hitY = 0; hitX = ox + ux * (-oy / Math.Min(-0.001, uy)); } else if (hitY > H) { hitY = H; hitX = ox + ux * ((H - oy) / Math.Max(0.001, uy)); }
            Size(_pool[i], hitX, hitY, S(0.16 + 0.5 * e)); Op(_pool[i], 0.15 + 0.75 * e);
        }
        Size(_flash, ox, oy, ps * (0.5 + 0.9 * _pulse + 0.3 * f.Loud)); Op(_flash, 0.18 + 0.25 * f.Loud + 0.4 * _pulse);
        for (var i = 0; i < Dust; i++)
        {
            // dust in the room: dim until a band passes over it
            _dx[i] += f.Dt * f.Speed * 0.006 * (1 + i % 3); if (_dx[i] > 1.02) _dx[i] = -0.02;
            double x = X(_dx[i]), y = Y(_dy[i]) + Math.Sin(f.T * 0.4 + _dp[i]) * S(0.015); var lit = 0.0;
            if (x > ox)
            {
                var a = Math.Atan2(y - oy, x - ox);
                for (var b = 0; b < n; b++) { var d = Math.Abs(a - _ang[b]); var half = 0.02 + 0.09 * _e[b]; if (d < half) lit = Math.Max(lit, (1 - d / half) * (0.3 + 0.7 * _e[b])); }
            }
            Size(_dust[i], x, y, S(0.005 + 0.012 * lit)); Op(_dust[i], 0.05 + 0.85 * lit * Osc(f.T, 1.7, _dp[i]) + 0.1 * lit);
        }
        // the spectrum floor (2.5.2 point 8): the same levels as the bands above it, with a reflection
        var x0 = W * VisualizationChrome.SpectrumLeft; var span = W * (VisualizationChrome.SpectrumRight - VisualizationChrome.SpectrumLeft);
        var slot = span / Bars; var bw = Math.Max(1, slot * 0.62); var baseY = H - S(0.035);
        for (var i = 0; i < Bars; i++)
        {
            var lvl = levels == 0 ? 0 : f.Levels[VisualizationChrome.SpectrumBandOf(i, levels)];
            var bh = VisualizationChrome.SpectrumBarHeight(lvl, H, f.Reduced); var x = x0 + i * slot + (slot - bw) / 2;
            var r = _bars[i]; r.Width = bw; r.Height = bh; r.RadiusX = r.RadiusY = bw / 2; At(r, x, baseY - bh);
            var m = _barRefl[i]; m.Width = bw; m.Height = Math.Max(1, Math.Min(S(0.035), bh * 0.5)); At(m, x, baseY + 1);
        }
    }
}
