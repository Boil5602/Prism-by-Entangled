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
/// pack - beams (PRISM Beams: a beam enters a prism and leaves as the brand's
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
        _paintsScene = true;   // every program is a tableau: none places the cover itself, the chrome's card does (2026-11-11)
    }

    /// <summary>True for a pack whose program paints the scene edge to edge (a tableau): it cannot show artwork itself.</summary>
    public static bool PaintsScene(string styleId)
    {
        return true;   // 2026-11-11: the four originals too. The cover is the chrome's card on every visual, in the corner or the middle by the one preference
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
            // B-187 (2026-09-09): -
            // the placed poster was a box inset by fixed fractions of the stage, taller than the chrome's square; one geometry now
            var side = Math.Max(200, Math.Round(Math.Min(width, height) * 0.6));
            if (Math.Abs(side - _focalSide) > 0.5) { _focalSide = side; fi.Width = side; fi.Height = side; fi.Margin = new Thickness(0, 0, 0, 40); }
        }
        var ambient = !_active || _reducedMotion;
        // With no music the scene almost stands still (2026-11-12, asked for: it had moved at its full pace on ten frames a
        // second, which read as choppy). The idle tick comes ten times a second and each one now moves the scene by an eighth
        // of that time, so what moves only sways.
        var dt = ambient ? 0.0125 : 1 / 30.0;
        _time += dt;
        var n = bands.Length;
        if (n == 0)
        {
            if (_canvas.Children.Count > 0) { _canvas.Children.Clear(); }
            _levels = Array.Empty<double>();
            return;
        }
        if (_levels.Length != n) { _levels = new double[n]; _canvas.Children.Clear(); }
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
        DrawTableau(_pack.Program, width, height, dt, beat, speed, ambient);   // every program is a tableau since 2026-11-11 (the four originals: Tableaus.Stage.cs)
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

    /// <summary>The chrome's cover card stands in the middle of the stage (the person's one preference, B-184), and a cover is showing in it:
    /// a stage scene draws around that square (2026-11-11, the four originals had placed the cover themselves, always in the middle).</summary>
    public static bool CoverCentred, CoverShown;

    /// <summary>Dev: a file that takes every frame one scene is given (the first renderer to draw after it is set), null when off.</summary>
    public static System.IO.StreamWriter? FrameLog;
    public static object? FrameLogOwner;
    /// <summary>Diagnostic hook: the per-beam energies actually used, after ranging.</summary>
    public static Action<string>? BeamDiagnostic;
    private double _lastBeamReport;

    private const int SpectrumBars = VisualizationChrome.SpectrumBars;

    // ------------------------------------------------ programs
    // A tableau: silhouettes and lights that answer the music (Tableaus.cs). Rebuilt when the tile
    // resizes or the palette changes (SetPalette clears the canvas); every frame only moves and re-lights.
    private void DrawTableau(string prog, double w, double h, double dt, double beat, double speed, bool ambient)
    {
        _tableau ??= Tableaus.Create(prog) ?? Tableaus.Create("beams")!;
        // a stage scene draws around a cover in the middle (the same square the chrome's card uses, B-187) and stands on its own ground only with no cover behind it
        var focal = CoverCentred && CoverShown;
        _tableau.FocalSide = focal ? Math.Max(200, Math.Round(Math.Min(w, h) * 0.6)) : 0; _tableau.FocalCx = w / 2; _tableau.FocalCy = h / 2 - 20;
        _tableau.Ground = !(_artMode == "backdrop" && _art is not null);
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
        var frame = new TableauFrame(_levels, C(low), C(mid), C(high), C(loud), C(beat), _time, dt, speed, ambient || _reducedMotion, w, h);
        if (FrameLog is { } fl && (FrameLogOwner ??= this) == this)
        {
            // dev (MainWindow.DevRecord.cs): what one scene was given, frame by frame, so a script can draw the same frames again
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            try { fl.WriteLine(string.Join(' ', new[] { frame.T, frame.Dt, frame.Speed, frame.Reduced ? 1 : 0, frame.Beat, frame.Low, frame.Mid, frame.High, frame.Loud }.Select(v => v.ToString("0.#####", inv))) + " | " + string.Join(' ', _levels.Select(v => v.ToString("0.####", inv)))); } catch { }
        }
        _tableau.Frame(frame);
    }

    private readonly double[] _sumLo = new double[4], _sumHi = { 0.2, 0.2, 0.2, 0.2 };
    private double Range(int k, double raw)
    {
        _sumHi[k] = Math.Max(raw, _sumHi[k] - (_sumHi[k] - raw) * 0.012);
        _sumLo[k] = Math.Min(raw, _sumLo[k] + (raw - _sumLo[k]) * 0.012);
        return Math.Clamp((raw - _sumLo[k]) / Math.Max(0.04, _sumHi[k] - _sumLo[k]), 0, 1);
    }
}
