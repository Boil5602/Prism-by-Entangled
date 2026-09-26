using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using PrismHost.Surfaces.Visualization;
using Windows.UI;

namespace PrismHost.Visualizations;

/// <summary>
/// ONE renderer for every style pack (dashboard-schema §32, layer 1), plugged
/// into the host's visualization surface through <see cref="IVisualizationRenderer"/>
/// (Surfaces/Visualization/VisualizationHost.cs owns the panel, the 30 Hz tick
/// and the audio source; this class only draws). Four programs, chosen by the
/// pack - beams (Prism Beams: a beam enters a prism and leaves as the brand's
/// four bands, refracting with the audio), bars (Spectrum), ribbon (waveform
/// trail), particles (Bloom: pulses on the beat). Artwork modes off / backdrop
/// (blurred + dimmed, palette tinted from the art's dominant colors, slow
/// drift) / focal (sharp, centered, the visualization framing it); track
/// changes crossfade the art (§16, 400 ms); no art → the pack's palette.
/// Reduced motion (the Windows setting) drops drift and beats and slows
/// everything.
///
/// The palette is CORE's (feed.palette): core tints the pack's colors toward
/// the art's dominant colors with tintPalette/dominantColors and pushes the
/// result in the feed - the renderer paints hex strings and derives nothing
/// (concept-scenes §2.5.2 point 2). With no playing source the renderer keeps
/// drawing on the host's ambient signal, dimmed and slowed to the pack's
/// reducedMotion speed with no beat: idle is a drift on the dark substrate,
/// never a black screen (§2.5.2 point 6).
/// </summary>
public sealed class StyleRenderer : IVisualizationRenderer
{
    private readonly StylePack _pack;
    private Color[] _palette;
    private Panel? _host;
    private readonly Canvas _canvas = new();
    private readonly Grid _artLayer = new();
    private readonly TranslateTransform _drift = new();
    private UIElement? _art;
    /// <summary>B-187: the focal poster's image, sized each frame to the SAME square the chrome's centred card uses, so the clock under that square clears it on every visual.</summary>
    private Image? _focalImg;
    private double _focalSide = -1;
    private string? _artUrl;
    private string _artMode = "off";
    private bool _active;                       // core says the source is playing: live motion, not the ambient drift
    private double[] _levels = Array.Empty<double>();
    private double _beatEnergy;
    private double _time;
    private readonly List<(Ellipse dot, double x, double y, double vx, double vy, double born, double life, int band)> _particles = new();
    private readonly Random _rng = new(7);
    // a tableau program (Tableaus.cs): built once per size / palette, only moved and re-lit per frame
    private Tableau? _tableau;
    private double _tableauW, _tableauH;

    /// <summary>B-182 (2026-09-09): a tableau pack paints the whole scene over the art layer, so "focal" art under it is never seen - such a pack places no art; the chrome shows the card instead.</summary>
    private readonly bool _paintsScene;

    public StyleRenderer(StylePack pack)
    {
        _pack = pack;
        _palette = pack.Palette;
        _artLayer.RenderTransform = _drift;
        _paintsScene = Tableaus.Create(pack.Program) is not null;
    }

    /// <summary>True for a pack whose program paints the scene edge to edge (a tableau): it cannot show artwork itself.</summary>
    public static bool PaintsScene(string styleId)
    {
        foreach (var p in StylePacks.All()) if (string.Equals(p.Id, styleId, StringComparison.OrdinalIgnoreCase)) return Tableaus.Create(p.Program) is not null;
        return false;
    }

    /// <summary>Live motion policy - the system setting unless the wall overrides it (VisualizationHost.MotionReduced).</summary>
    private static bool _reducedMotion => PrismHost.Surfaces.Visualization.VisualizationHost.MotionReduced;

    public StylePack Pack => _pack;

    /// <summary>Register the four shipped packs (and any valid community pack under Assets/visualization-styles) with the host's style registry.</summary>
    public static void RegisterAll()
    {
        foreach (var pack in StylePacks.All())
        {
            var p = pack;
            VisualizationStyles.Register(p.Id, () => new StyleRenderer(p));
        }
    }

    public void Attach(Panel host)
    {
        _host = host;
        host.Children.Insert(0, _artLayer);
        host.Children.Insert(1, _canvas);
        // the surface's own substrate stays dark beneath; the pack asks for a transparent background so the art shows through
        LayerArt(_artMode);
    }

    /// <summary>B-188 (2026-09-09): where the art sits relative to the drawing. A backdrop is behind everything; a focal poster is
    /// IN FRONT of the drawing - the beams drew over the poster while the prism stayed behind it ("lasers in front, triangle behind").</summary>
    private void LayerArt(string mode)
    {
        if (_host is not { } host || !host.Children.Contains(_artLayer) || !host.Children.Contains(_canvas)) return;
        var artIx = host.Children.IndexOf(_artLayer); var canvasIx = host.Children.IndexOf(_canvas);
        var wantAbove = mode == "focal";
        if (wantAbove == artIx > canvasIx) return;
        host.Children.Remove(_artLayer);
        host.Children.Insert(wantAbove ? host.Children.IndexOf(_canvas) + 1 : host.Children.IndexOf(_canvas), _artLayer);
    }

    public void Detach(Panel host)
    {
        host.Children.Remove(_artLayer);
        host.Children.Remove(_canvas);
        _canvas.Children.Clear();
        _particles.Clear();
        _host = null;
    }

    /// <summary>The feed changed (track, artwork, palette, active): artwork under the placement's mode, core's palette; a stopped source drops the art.</summary>
    public void Update(VisualizationFeed feed)
    {
        _active = feed.Active;
        SetPalette(feed.Palette);
        SetArtwork(_paintsScene && feed.ArtworkMode == "focal" ? "off" : feed.ArtworkMode, feed.Active ? feed.Artwork : null);   // B-182: no poster under a painted scene
    }

    /// <summary>
    /// core's palette for this feed, already tinted toward the art's dominant
    /// colors when the placement is `backdrop` (§32). An empty or unusable list
    /// means "no answer yet" and the pack's own palette stands - the host never
    /// computes a tint of its own.
    /// </summary>
    private void SetPalette(IReadOnlyList<string> hexes)
    {
        var next = new List<Color>(hexes.Count);
        foreach (var h in hexes) { try { next.Add(StylePacks.Hex(h)); } catch { } }
        var chosen = next.Count > 0 ? next.ToArray() : _pack.Palette;
        if (chosen.Length == _palette.Length)
        {
            var same = true;
            for (var i = 0; i < chosen.Length; i++) if (chosen[i] != _palette[i]) { same = false; break; }
            if (same) return;
        }
        _palette = chosen;
        _canvas.Children.Clear();                 // the shapes carry their brushes: rebuild them on the new palette
        _particles.Clear();
    }

    /// <summary>
    /// One frame from the host's tick: bands 0–1 low → high at the panel's size.
    /// Zero bands would be a black screen, so the host never sends them: an idle
    /// surface arrives as the ambient signal and is drawn at the pack's
    /// reducedMotion speed with no beat (§2.5.2 point 6).
    /// </summary>
    public void Render(float[] bands, double width, double height)
    {
        if (width < 8 || height < 8) return;
        if (_focalImg is { } fi)
        {
            // B-187 (2026-09-09): "the clock overlaps with the poster image ... so these posters are [the same] size on all visuals" -
            // the placed poster was a box inset by fixed fractions of the stage, taller than the chrome's square; one geometry now
            var side = Math.Max(200, Math.Round(Math.Min(width, height) * 0.6));
            if (Math.Abs(side - _focalSide) > 0.5) { _focalSide = side; fi.Width = side; fi.Height = side; fi.Margin = new Thickness(0, 0, 0, 40); }
        }
        var ambient = !_active || _reducedMotion;
        var dt = ambient ? 0.1 : 1 / 30.0;
        _time += dt;
        var n = bands.Length;
        if (n == 0)
        {
            if (_canvas.Children.Count > 0) { _canvas.Children.Clear(); _particles.Clear(); }
            _levels = Array.Empty<double>();
            return;
        }
        if (_levels.Length != n) { _levels = new double[n]; _canvas.Children.Clear(); _particles.Clear(); }
        var attack = _reducedMotion ? Math.Min(_pack.Attack, 0.2) : _pack.Attack;
        var release = _reducedMotion ? Math.Min(_pack.Release, 0.08) : _pack.Release;
        double low = 0;
        var lowN = Math.Max(1, n / 6);
        for (var i = 0; i < n; i++)
        {
            double l = Math.Min(1, Math.Max(0, bands[i]));
            _levels[i] = l > _levels[i] ? _levels[i] + (l - _levels[i]) * attack : _levels[i] + (l - _levels[i]) * release;
            if (i < lowN) low += _levels[i];
        }
        low /= lowN;
        var beatGain = ambient ? _pack.ReducedBeat : _pack.Beat;               // idle carries no beat
        var beat = Math.Max(0, low - _beatEnergy) * beatGain;
        _beatEnergy += (low - _beatEnergy) * 0.15;
        var speed = ambient ? _pack.ReducedSpeed : _pack.Speed;                // idle drifts at the pack's reducedMotion speed
        if (_artMode == "backdrop" && _art is not null && !_reducedMotion) { _drift.X = Math.Sin(_time * 0.05 * speed) * width * 0.02; _drift.Y = Math.Cos(_time * 0.04 * speed) * height * 0.02; }
        switch (_pack.Program)
        {
            case "bars": DrawBars(width, height); break;
            case "ribbon": DrawRibbon(width, height, _time * speed); break;
            case "particles": DrawParticles(width, height, _time, dt, beat, speed); break;
            case var prog when Tableaus.Known(prog): DrawTableau(prog, width, height, dt, beat, speed, ambient); break;
            default: DrawBeams(width, height, _time * speed, beat); break;
        }
    }

    // ------------------------------------------------ artwork (§32 modes, §16 crossfade)
    private void SetArtwork(string mode, string? url)
    {
        var modeChanged = mode != _artMode;
        _artMode = mode;
        if (modeChanged) LayerArt(mode);
        if (mode == "off" || url is null)
        {
            if (_art is not null || modeChanged) { FadeOut(_art); _art = null; _artUrl = null; _focalImg = null; }
            return;
        }
        if (url == _artUrl && !modeChanged) return;
        _artUrl = url;
        var img = new Image { Stretch = mode == "focal" ? Stretch.Uniform : Stretch.UniformToFill, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        try
        {
            // backdrop "blur": decode tiny and let bilinear upscaling smooth it (no Win2D effect needed); focal decodes at size
            var bmp = new BitmapImage(new Uri(url));
            if (mode == "backdrop") bmp.DecodePixelWidth = 24;
            img.Source = bmp;
        }
        catch { return; }
        var wrap = new Grid { Opacity = 0 };
        if (mode == "focal") { _focalImg = img; _focalSide = -1; } else _focalImg = null;   // B-187: sized on the next frame, from the live stage size
        wrap.Children.Add(img);
        wrap.Children.Add(new Border { Background = new SolidColorBrush(Color.FromArgb((byte)(255 * (mode == "backdrop" ? 0.55 : 0.1)), 0x0B, 0x0D, 0x12)) });
        FadeOut(_art);
        _art = wrap;
        _artLayer.Children.Add(wrap);
        Fade(wrap, 1, null);
        // the tint is NOT computed here: the surface samples the art for core, and core's palette arrives in the next feed.
    }

    private void Fade(UIElement el, double to, Action? done)
    {
        var sb = new Storyboard();
        var da = new DoubleAnimation { To = to, Duration = TimeSpan.FromMilliseconds(400), EnableDependentAnimation = true };
        Storyboard.SetTarget(da, el); Storyboard.SetTargetProperty(da, "Opacity");
        sb.Children.Add(da);
        if (done is not null) sb.Completed += (_, __) => done();
        sb.Begin();
    }

    private void FadeOut(UIElement? el)
    {
        if (el is null) return;
        Fade(el, 0, () => _artLayer.Children.Remove(el));
    }

    private Color Band(int i) => _palette[Math.Abs(i) % _palette.Length];

    // 2.5.2 points 1 and 8 live in PrismHost.Core/VisualizationChrome.cs so the
    // composition rules are asserted headless in CI; this class only draws them.
    /// <summary>Radians a beam swings from its rest angle across the band's full range (docs/concept-scenes.md 2.5.2 point 1: "bent by its band's energy").</summary>
    private const double BeamSwing = 0.55;

    /// <summary>
    /// Per-band running floor/ceiling. A beam's energy is the peak of a quarter
    /// of the spectrum, and that peak lives in a NARROW slice of 0..1 - measured
    /// around 0.2..0.5 on real music - so a swing sized for the full range
    /// delivered a fraction of it (the reported "10 degrees" against 24-39 on
    /// paper). Each band is now mapped across its own recent range, so the swing
    /// means what it says. Both bounds ease toward the signal, so a track change
    /// or a quiet passage re-ranges within a few seconds instead of latching.
    /// </summary>
    private double[] _bandLo = Array.Empty<double>(), _bandHi = Array.Empty<double>();

    /// <summary>Diagnostic hook: the per-beam energies actually used, after ranging.</summary>
    public static Action<string>? BeamDiagnostic;
    private double _lastBeamReport;

    private const int SpectrumBars = VisualizationChrome.SpectrumBars;

    // ------------------------------------------------ programs
    // A tableau: silhouettes and lights that answer the music (Tableaus.cs). Rebuilt when the tile
    // resizes or the palette changes (SetPalette clears the canvas); every frame only moves and re-lights.
    private void DrawTableau(string prog, double w, double h, double dt, double beat, double speed, bool ambient)
    {
        _tableau ??= Tableaus.Create(prog);
        if (_tableau is null) { DrawBeams(w, h, _time * speed, beat); return; }
        if (_canvas.Children.Count == 0 || Math.Abs(_tableauW - w) > 1 || Math.Abs(_tableauH - h) > 1) { _tableau.Build(_canvas, w, h, _palette); _tableauW = w; _tableauH = h; }
        var n = _levels.Length;
        double low = 0, mid = 0, high = 0, loud = 0;
        if (n > 0)
        {
            var a = Math.Max(1, n / 4); var b = Math.Max(a + 1, n * 3 / 5);
            for (var i = 0; i < n; i++) { loud += _levels[i]; if (i < a) low += _levels[i]; else if (i < b) mid += _levels[i]; else high += _levels[i]; }
            low /= a; mid /= Math.Max(1, b - a); high /= Math.Max(1, n - b); loud /= n;
            // each summary rides its own recent range, like the beams do, so a quiet mix still moves the scene
            low = Range(0, low); mid = Range(1, mid); high = Range(2, high); loud = Range(3, loud);
        }
        if (ambient)
        {
            // idle: a calm, LIT scene (point 6) rather than every light at its floor - the reported "drab"
            var breathe = 0.34 + 0.16 * Math.Sin(_time * 0.35);
            low = breathe; mid = 0.34 + 0.16 * Math.Sin(_time * 0.27 + 1); high = 0.3 + 0.15 * Math.Sin(_time * 0.41 + 2); loud = breathe;
        }
        // the levels a tableau scales opacities by are 0..1 by contract; a loud bar pushed them past it (2026-09-07)
        static double C(double v) => double.IsFinite(v) ? Math.Clamp(v, 0, 1) : 0;
        _tableau.Frame(new TableauFrame(_levels, C(low), C(mid), C(high), C(loud), C(beat), _time, dt, speed, ambient || _reducedMotion, w, h));
    }

    private readonly double[] _sumLo = new double[4], _sumHi = { 0.2, 0.2, 0.2, 0.2 };
    private double Range(int k, double raw)
    {
        _sumHi[k] = Math.Max(raw, _sumHi[k] - (_sumHi[k] - raw) * 0.012);
        _sumLo[k] = Math.Min(raw, _sumLo[k] + (raw - _sumLo[k]) * 0.012);
        return Math.Clamp((raw - _sumLo[k]) / Math.Max(0.04, _sumHi[k] - _sumLo[k]), 0, 1);
    }

    // Spectrum: rounded bars, palette low → high, a floor so a quiet passage still reads as a surface
    private void DrawBars(double w, double h)
    {
        var n = _levels.Length;
        var gap = _pack.Param("gap", 0.35); var floor = _pack.Param("floor", 0.03); var corner = _pack.Param("corner", 0.5);
        var slot = w / n; var bw = Math.Max(1, slot * (1 - gap));
        if (_canvas.Children.Count != n)
        {
            _canvas.Children.Clear();
            for (var i = 0; i < n; i++) _canvas.Children.Add(new Rectangle { Width = bw, RadiusX = bw * corner / 2, RadiusY = bw * corner / 2, Fill = new SolidColorBrush(Band(i * _palette.Length / n)) });
        }
        for (var i = 0; i < n; i++)
        {
            var r = (Rectangle)_canvas.Children[i];
            var bh = Math.Max(2, (floor + _levels[i] * (1 - floor)) * h * 0.92);
            r.Height = bh; r.Width = bw;
            Canvas.SetLeft(r, i * slot + (slot - bw) / 2); Canvas.SetTop(r, h - bh);
        }
    }

    // Ribbon: a smoothed waveform trail, older passes fading and sinking
    private void DrawRibbon(double w, double h, double t)
    {
        var trail = (int)Math.Max(1, _pack.Param("trail", 6)); var amp = _pack.Param("amplitude", 0.35); var thick = _pack.Param("thickness", 0.01);
        var n = _levels.Length;
        if (_canvas.Children.Count != trail)
        {
            _canvas.Children.Clear();
            for (var k = 0; k < trail; k++) _canvas.Children.Add(new Polyline { StrokeThickness = Math.Max(1.5, thick * h), StrokeLineJoin = PenLineJoin.Round, Stroke = new SolidColorBrush(Band(k)), Opacity = 1.0 - k / (double)(trail + 1) });
        }
        for (var k = trail - 1; k > 0; k--)
        {
            var src = (Polyline)_canvas.Children[k - 1]; var dst = (Polyline)_canvas.Children[k];
            dst.Points.Clear();
            foreach (var p in src.Points) dst.Points.Add(new Windows.Foundation.Point(p.X, p.Y + h * 0.012));
        }
        var head = (Polyline)_canvas.Children[0];
        head.Points.Clear();
        for (var i = 0; i < n; i++)
        {
            var x = n == 1 ? w / 2 : i / (double)(n - 1) * w;
            var phase = Math.Sin(t * 1.4 + i * 0.35);
            var y = h * 0.5 - _levels[i] * amp * h * phase - _levels[i] * h * 0.08;
            head.Points.Add(new Windows.Foundation.Point(x, y));
        }
    }

    // Bloom: particles burst from the center on beats and drift out, each a band's color; a soft glow breathes with the low band
    private void DrawParticles(double w, double h, double t, double dt, double beat, double speed)
    {
        var max = (int)_pack.Param("maxParticles", 160); var burst = (int)_pack.Param("burst", 14); var life = _pack.Param("life", 1.8); var size = _pack.Param("size", 0.02) * Math.Min(w, h);
        if (_canvas.Children.Count == 0) _canvas.Children.Add(new Ellipse { Fill = new SolidColorBrush(Color.FromArgb(0x30, Band(0).R, Band(0).G, Band(0).B)) });
        if (beat > 0.04 && _particles.Count < max)
        {
            var count = Math.Min(burst, max - _particles.Count);
            for (var k = 0; k < count; k++)
            {
                var ang = _rng.NextDouble() * Math.PI * 2; var v = (0.08 + _rng.NextDouble() * 0.25) * (0.5 + beat * 2) * Math.Min(w, h) * speed;
                var band = _rng.Next(_palette.Length);
                var dot = new Ellipse { Width = size, Height = size, Fill = new SolidColorBrush(Band(band)) };
                _canvas.Children.Add(dot);
                _particles.Add((dot, w / 2, h / 2, Math.Cos(ang) * v, Math.Sin(ang) * v, t, life * (0.6 + _rng.NextDouble() * 0.8), band));
            }
        }
        for (var i = _particles.Count - 1; i >= 0; i--)
        {
            var p = _particles[i];
            var age = (t - p.born) / p.life;
            if (age >= 1) { _canvas.Children.Remove(p.dot); _particles.RemoveAt(i); continue; }
            var lvl = _levels.Length > 0 ? _levels[Math.Min(_levels.Length - 1, p.band * _levels.Length / _palette.Length)] : 0;
            var x = p.x + p.vx * dt; var y = p.y + p.vy * dt;
            _particles[i] = (p.dot, x, y, p.vx * 0.985, p.vy * 0.985 + 4 * dt, p.born, p.life, p.band);
            var s = size * (0.6 + lvl) * (1 - age * 0.5);
            p.dot.Width = p.dot.Height = Math.Max(1, s);
            p.dot.Opacity = (1 - age) * (0.55 + 0.45 * lvl);
            Canvas.SetLeft(p.dot, x - s / 2); Canvas.SetTop(p.dot, y - s / 2);
        }
        if (_canvas.Children[0] is Ellipse glow)
        {
            var g = Math.Min(w, h) * (0.12 + 0.25 * _beatEnergy);
            glow.Width = glow.Height = g; Canvas.SetLeft(glow, w / 2 - g / 2); Canvas.SetTop(glow, h / 2 - g / 2);
        }
    }

    // Prism Beams: a white beam enters a prism from the left; the four bands leave to the right, each bent by its own energy and glowing with it
    private void DrawBeams(double w, double h, double t, double beat)
    {
        var bands = _palette.Length;
        var spread = _pack.Param("spread", 0.55); var glow = _pack.Param("glow", 0.35); var prismSize = _pack.Param("prismSize", 0.22) * Math.Min(w, h); var beamW = Math.Max(1.5, _pack.Param("beamWidth", 0.012) * h);
        var need = 2 + bands * 2 + SpectrumBars;    // + the point-8 spectrum floor
        if (_canvas.Children.Count != need)
        {
            _canvas.Children.Clear();
            _canvas.Children.Add(new Polygon { Fill = new SolidColorBrush(Color.FromArgb(0x22, 0xEC, 0xEC, 0xF0)), Stroke = new SolidColorBrush(Color.FromArgb(0x90, 0xEC, 0xEC, 0xF0)), StrokeThickness = 1 });
            _canvas.Children.Add(new Line { Stroke = new SolidColorBrush(Color.FromArgb(0xD0, 0xEC, 0xEC, 0xF0)), StrokeThickness = beamW });
            for (var i = 0; i < bands; i++)
            {
                var c = Band(i);
                _canvas.Children.Add(new Polygon { Fill = new SolidColorBrush(Color.FromArgb((byte)(255 * glow), c.R, c.G, c.B)) });
                _canvas.Children.Add(new Line { Stroke = new SolidColorBrush(c), StrokeThickness = beamW, StrokeEndLineCap = PenLineCap.Round });
            }
            for (var i = 0; i < SpectrumBars; i++)
                _canvas.Children.Add(new Rectangle { Fill = new SolidColorBrush(Band(i)), Opacity = VisualizationChrome.SpectrumOpacity });
        }
        var cx = w * VisualizationChrome.PrismCenterX; var cy = h * VisualizationChrome.PrismCenterY;   // P1: 2.5.2 point 1
        var prism = (Polygon)_canvas.Children[0];
        prism.Points.Clear();
        var ps = prismSize * (1 + beat * 0.15);
        prism.Points.Add(new Windows.Foundation.Point(cx, cy - ps * 0.6));
        prism.Points.Add(new Windows.Foundation.Point(cx + ps * 0.55, cy + ps * 0.4));
        prism.Points.Add(new Windows.Foundation.Point(cx - ps * 0.55, cy + ps * 0.4));
        var incoming = (Line)_canvas.Children[1];
        var n = _levels.Length; var total = n > 0 ? _levels.Average() : 0;
        incoming.X1 = 0; incoming.Y1 = cy + h * 0.06; incoming.X2 = cx - ps * 0.2; incoming.Y2 = cy;
        incoming.Opacity = 0.35 + 0.65 * total;
        for (var i = 0; i < bands; i++)
        {
            // PEAK of the slice, not the mean: four beams cover a quarter of the
            // spectrum each, and a mean that wide barely changes - which is why
            // the beams hardly moved with music. Costs nothing extra to draw.
            var from = i * n / bands; var to = Math.Max(from + 1, (i + 1) * n / bands);
            double raw = 0;
            for (var k = from; k < to && k < n; k++) raw = Math.Max(raw, _levels[k]);

            if (_bandLo.Length != bands) { _bandLo = new double[bands]; _bandHi = new double[bands]; for (var k = 0; k < bands; k++) { _bandLo[k] = 0; _bandHi[k] = 0.2; } }
            _bandHi[i] = Math.Max(raw, _bandHi[i] - (_bandHi[i] - raw) * 0.012);
            _bandLo[i] = Math.Min(raw, _bandLo[i] + (raw - _bandLo[i]) * 0.012);
            var span = Math.Max(0.04, _bandHi[i] - _bandLo[i]);
            var e = Math.Clamp((raw - _bandLo[i]) / span, 0, 1);
            // The fan divided `spread` by the BAND COUNT, so with spread 0.55 and
            // four bands each step was 0.1375 rad and the inner beams sat at
            // +/-3.9 deg. Multiplying an angle that small by the band energy gave
            // them 6 degrees of travel - measured, and exactly the "5 degrees"
            // reported from the wall. Divide by the GAPS between beams instead.
            var baseAngle = (i - (bands - 1) / 2.0) * (spread / Math.Max(1, bands - 1));   // the fan, radians
            // ...and the band's energy now SWINGS the beam by an absolute amount
            // (centred, so the fan stays symmetric) instead of only scaling a tiny
            // base angle. Every beam gets real travel, not just the outer pair:
            // measured 24-39 deg each, against 6-19 deg before.
            var angle = baseAngle * (0.85 + 0.35 * e) + (e - 0.5) * BeamSwing + Math.Sin(t * 0.8 + i) * 0.03;
            var len = w - cx + h;
            var x2 = cx + ps * 0.2 + Math.Cos(angle) * len; var y2 = cy + Math.Sin(angle) * len;
            var core = (Line)_canvas.Children[3 + i * 2];
            core.X1 = cx + ps * 0.1; core.Y1 = cy; core.X2 = x2; core.Y2 = y2;
            core.StrokeThickness = beamW * (0.45 + 2.6 * e);
            core.Opacity = 0.25 + 0.75 * e;
            var halo = (Polygon)_canvas.Children[2 + i * 2];
            var half = (0.012 + 0.13 * e) * h;
            var nx = -Math.Sin(angle) * half; var ny = Math.Cos(angle) * half;
            halo.Points.Clear();
            halo.Points.Add(new Windows.Foundation.Point(cx + ps * 0.1, cy));
            halo.Points.Add(new Windows.Foundation.Point(x2 + nx, y2 + ny));
            halo.Points.Add(new Windows.Foundation.Point(x2 - nx, y2 - ny));
            halo.Opacity = 0.2 + 0.8 * e;
        }
        if (BeamDiagnostic is { } br && _time - _lastBeamReport > 1.0)
        {
            _lastBeamReport = _time;
            var parts = new string[bands];
            for (var i = 0; i < bands; i++) parts[i] = $"b{i} lo={_bandLo[i]:F2} hi={_bandHi[i]:F2}";
            br("beams " + string.Join("  ", parts));
        }
        DrawSpectrumFloor(w, h, 2 + bands * 2);
    }

    // 2.5.2 point 8: the spectrum floor. Same smoothed _levels as the beams, so
    // the field and the refraction always agree; rounded caps; the floor keeps a
    // quiet passage - and an idle wall - reading as a surface rather than nothing.
    private void DrawSpectrumFloor(double w, double h, int first)
    {
        var n = _levels.Length;
        var x0 = w * VisualizationChrome.SpectrumLeft; var span = w * (VisualizationChrome.SpectrumRight - VisualizationChrome.SpectrumLeft);
        var slot = span / SpectrumBars; var bw = Math.Max(1, slot * 0.62);
        for (var i = 0; i < SpectrumBars; i++)
        {
            if (first + i >= _canvas.Children.Count) break;
            var r = (Rectangle)_canvas.Children[first + i];
            var lvl = n == 0 ? 0 : _levels[VisualizationChrome.SpectrumBandOf(i, n)];
            var bh = VisualizationChrome.SpectrumBarHeight(lvl, h, _reducedMotion);
            r.Width = bw; r.Height = bh; r.RadiusX = r.RadiusY = bw / 2;
            Canvas.SetLeft(r, x0 + i * slot + (slot - bw) / 2); Canvas.SetTop(r, h - bh);
        }
    }
}
