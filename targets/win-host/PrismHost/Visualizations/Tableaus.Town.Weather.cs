using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI;

namespace PrismHost.Visualizations;

// =============================================================== SEASONS: the weather of Convergence
// This file is pure ASCII.

/// <summary>
/// Convergence has weather of its own (2026-11-12, asked for: random, sometimes a little too rainy, sometimes a long spell of
/// sun, sometimes a little rain with the sun through it). It is made up on the PC; nothing is looked up. One kind holds for
/// some minutes and then another is drawn by lot:
///   0 clear (the longest), 1 fair, 2 overcast, 3 a shower with the sun through it and a rainbow, 4 rain, 5 a storm with
///   lightning, 6 mist. In winter rain is snow and a storm is heavy snow without lightning.
/// What the weather forbids: no balloon, fireworks or lanterns go up while it is wet, and the kite comes down in rain and storm.
/// With no music the town waits: the people stop where they are (2026-11-12).
/// </summary>
public sealed partial class SeasonsTown
{
    private double _go = 1, _pt;                     // 1 while music plays, 0 while the town waits; the people's own clock
    private int _wKind; private double _wLeft, _wGrey, _wCloud, _wRain, _wBow, _wMist, _wFlash, _boltIn = 6, _rainY, _kiteUp = 1;
    private Canvas? _bowG, _stormG, _rainG, _kiteG; private TranslateTransform? _rainT;
    private Microsoft.UI.Xaml.Shapes.Rectangle? _greyR, _mistR, _flashR;
    private readonly List<Microsoft.UI.Xaml.UIElement> _bolts = new();
    // In the rain everyone who stays out has an umbrella, and those at play go indoors: the four square, the rope and the
    // child with the kite (2026-11-12, asked for umbrellas or a run for cover).
    private readonly List<Canvas> _umb = new(); private readonly List<Canvas> _indoors = new(); private double _umbOp, _inside, _umbSet = -1;
    private static readonly int[] Brollies = { 0xE84A4A, 0x2E6ACF, 0xF2C040, 0x38B8B0, 0x9A5AD8, 0x2A2A38, 0xF088A8 };
    private Canvas Indoors(Canvas g) { _indoors.Add(g); return g; }

    /// <summary>An umbrella over a person, hidden until it rains: a stick from the hand and a canopy over the head.</summary>
    private void Umbrella(double u, int n)
    {
        if (_noUmb) return;   // under a roof
        var g = new Canvas { Opacity = 0, IsHitTestVisible = false }; C.Children.Add(g); _umb.Add(g);
        In(g, () =>
        {
            double x = u * 0.85, y = -u * (6.9 + _umbLift); var c = Rgb(Brollies[n % Brollies.Length]);
            L(x, -u * 3.3, x, y - u * 1.5, Rgb(0x2A1C18), Math.Max(1, u * 0.13));
            var pts = new double[22]; for (var k = 0; k <= 10; k++) { var an = Math.PI * k / 10; pts[k * 2] = x + Math.Cos(an) * u * 2.7; pts[k * 2 + 1] = y - Math.Sin(an) * u * 1.5; }
            G(c, 1, pts); G(Mix(c, White, 0.3), 0.8, x - u * 0.9, y, x + u * 0.9, y, x, y - u * 1.5);
        });
    }

    private int _wTick; private bool _wForce, _noUmb; private double _umbLift;
    private bool Wet => _wKind >= 3 && _wKind <= 5;

    /// <summary>A balloon, fireworks and lanterns need dry air (their lengths name them: 70, 8 and 34 seconds).</summary>
    private static bool NeedsDry(Surprise s) => s.Len is 70 or 8 or 34;

    private void NextWeather(bool first)
    {
        // by lot: clear 30, fair 24, overcast 10, shower 11, rain 12, storm 6, mist 7
        var lots = new[] { 30, 24, 10, 11, 12, 6, 7 }; var n = Rng.Next(100); var k = 0;
        while (k < lots.Length - 1 && n >= lots[k]) { n -= lots[k]; k++; }
        if (!first && k == _wKind) k = (k + 1 + Rng.Next(lots.Length - 1)) % lots.Length;
        _wKind = k;
        _wLeft = k switch { 0 => 300 + 600 * Rng.NextDouble(), 4 => 180 + 320 * Rng.NextDouble(), 5 => 90 + 150 * Rng.NextDouble(), 3 => 90 + 120 * Rng.NextDouble(), _ => 120 + 240 * Rng.NextDouble() };
    }

    /// <summary>In the sky, behind the land: the storm's clouds, the rainbow, the lightning.</summary>
    private void WeatherSky()
    {
        _bolts.Clear();
        _bowG = Sub(0, 0, out _); _bowG.Opacity = 0;
        var bow = new[] { 0xE84A4A, 0xF29A3A, 0xF2D84A, 0x5AC06A, 0x4A9AE8, 0x8A6AD8 };
        for (var i = 0; i < bow.Length; i++)
        {
            double d = S(1.25) - i * S(0.022), th = S(0.012);
            var e = new Ellipse { Width = d, Height = d, Stroke = B(Rgb(bow[i])), StrokeThickness = th, Opacity = 0.55, IsHitTestVisible = false };
            At(e, X(0.36) - d / 2, Y(0.72) - d / 2); _bowG.Children.Add(e);
        }
        _stormG = Sub(0, 0, out _); _stormG.Opacity = 0;
        In(_stormG, () =>
        {
            Color top = Mix(Rgb(0x9AA2B4), Rgb(0x0A1030), _dim), under = Mix(Rgb(0x3E465C), Rgb(0x0A1030), _dim);
            var at = new[] { (0.12, 0.07, 0.62), (0.45, 0.03, 0.7), (0.8, 0.08, 0.64), (0.28, 0.17, 0.5), (0.64, 0.19, 0.55), (0.97, 0.2, 0.45) };
            for (var k = 0; k < at.Length; k++) { var (fx, fy, fw) = at[k]; double cw = W * fw, ch = cw / 3; Img(CloudTex(20 + k, top, under), X(fx) - cw / 2, Y(fy) - ch / 2, cw, ch); }
        });
        for (var b = 0; b < 3; b++)
        {   // a bolt: a broken line from the cloud to the hills
            var pl = PL(B(Rgb(0xF4F6FF)), Math.Max(2, S(0.004)), 0); var x = X(0.2 + 0.3 * b) + S(0.05) * b; var y = Y(0.12);
            for (var k = 0; k <= 7; k++) { pl.Points.Add(new Windows.Foundation.Point(x, y)); x += S(0.03) * (((k * 7 + b * 3) % 5) - 2) * 0.6; y += S(0.055); }
            _bolts.Add(pl);
        }
    }

    /// <summary>In front of the town: the grey of a wet day, the mist, the rain or the snow, the flash.</summary>
    private void WeatherFront()
    {
        _greyR = R(0, 0, W, H, Rgb(0x1C2438), 0); _mistR = R(0, 0, W, H, Rgb(0xE8ECF2), 0);
        _rainG = Sub(0, 0, out _rainT); _rainG.Opacity = 0; _rainG.IsHitTestVisible = false; var snow = _season == "winter"; var rng = new Random(11);
        In(_rainG, () =>
        {
            for (var k = 0; k < (snow ? 220 : 170); k++)
            {
                double x = -W * 0.1 + W * 1.2 * rng.NextDouble(), y = H * rng.NextDouble(), len = S(0.03 + 0.02 * rng.NextDouble());
                foreach (var dy in new[] { 0.0, -H })
                {
                    if (snow) E(x, y + dy, S(0.004 + 0.004 * (k % 3)), White, 0.85);
                    else L(x, y + dy, x - len * 0.22, y + dy + len, Rgb(0xD4E4FF), Math.Max(1, S(0.0016)), 0.55);
                }
            }
        });
        _flashR = R(0, 0, W, H, White, 0);
        if (_wLeft <= 0) NextWeather(true);
    }

    private void WeatherStep(double dt, TableauFrame f)
    {
        // a developer's switch (only with PRISM_DEV_SHOT=1): a digit 0 to 6 in diagnostics/weather.txt holds that kind of weather
        if (++_wTick % 30 == 0 && Environment.GetEnvironmentVariable("PRISM_DEV_SHOT") == "1")
        {
            try
            {
                var wp = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Prism", "diagnostics", "weather.txt");
                _wForce = System.IO.File.Exists(wp) && int.TryParse(System.IO.File.ReadAllText(wp).Trim(), out var fk) && fk >= 0 && fk <= 6;
                if (_wForce) { _wKind = int.Parse(System.IO.File.ReadAllText(wp).Trim()); _wLeft = 60; }
            }
            catch { _wForce = false; }
        }
        _wLeft -= dt; if (_wLeft <= 0) NextWeather(false);
        var snow = _season == "winter"; var k = _wKind;
        // what each kind asks for: the grey over the town, the storm's clouds, the rain, the rainbow, the mist
        var (grey, cloud, rain, bow, mist) = k switch
        {
            1 => (0.0, 0.0, 0.0, 0.0, 0.0), 2 => (0.2, 0.85, 0.0, 0.0, 0.0), 3 => (0.06, 0.45, 0.45, 1.0, 0.0),
            4 => (0.28, 0.95, 0.8, 0.0, 0.0), 5 => (0.42, 1.0, 1.0, 0.0, 0.0), 6 => (0.0, 0.2, 0.0, 0.0, 0.3), _ => (0.0, 0.0, 0.0, 0.0, 0.0),
        };
        if (_sky == "night") bow = 0;
        var ease = _wForce ? 0.1 : Math.Min(1, dt * 0.12);
        _wGrey += (grey - _wGrey) * ease; _wCloud += (cloud - _wCloud) * ease; _wRain += (rain - _wRain) * ease; _wBow += (bow - _wBow) * ease; _wMist += (mist - _wMist) * ease;
        if (_greyR is not null) Op(_greyR, _wGrey); if (_mistR is not null) Op(_mistR, _wMist);
        if (_stormG is not null) _stormG.Opacity = _wCloud; if (_bowG is not null) _bowG.Opacity = _wBow * (1 - _wGrey * 2) * 0.8;
        if (_rainG is not null && _rainT is not null)
        {
            _rainG.Opacity = _wRain;
            if (_wRain > 0.01) { _rainY = (_rainY + dt * H * (snow ? 0.12 : 1.5 + 0.8 * _wRain)) % H; _rainT.Y = _rainY; _rainT.X = snow ? S(0.01) * Math.Sin(_tw * 0.8) : 0; }
        }
        // lightning: in a storm, by itself now and then, and on a hard beat
        if (k == 5 && !snow && _wRain > 0.6)
        {
            _boltIn -= dt;
            if (_boltIn <= 0 || (_boltIn < 6 && _flare > 0.85))
            {
                _boltIn = 5 + 9 * Rng.NextDouble(); _wFlash = 1; var pick = Rng.Next(Math.Max(1, _bolts.Count));
                for (var b = 0; b < _bolts.Count; b++) _bolts[b].Opacity = b == pick ? 1 : 0;
            }
        }
        if (_wFlash > 0.001)
        {
            _wFlash *= Math.Exp(-Math.Max(dt, 1 / 30.0) * 7); if (_wFlash < 0.02) _wFlash = 0;
            if (_flashR is not null) Op(_flashR, _wFlash * 0.3);
            foreach (var b in _bolts) if (b.Opacity > 0) b.Opacity = _wFlash;
        }
        var wantU = Clamp01((_wRain - 0.15) * 4); _umbOp += (wantU - _umbOp) * (_wForce ? 0.2 : Math.Min(1, dt * 0.8));
        if (Math.Abs(_umbOp - _umbSet) > 0.02 || (_umbOp < 0.02 && _umbSet != 0)) { _umbSet = _umbOp < 0.02 ? 0 : _umbOp; foreach (var g in _umb) g.Opacity = _umbSet; }
        _inside += ((_wRain > 0.25 ? 1 : 0) - _inside) * (_wForce ? 0.2 : Math.Min(1, dt * 0.6));
        foreach (var g in _indoors) g.Opacity = 1 - _inside;
        // the kite comes down in rain and storm
        _kiteUp += ((k >= 4 && k <= 5 ? 0 : 1) - _kiteUp) * Math.Min(1, dt * 0.5);
        if (_kiteG is not null) _kiteG.Opacity = _kiteUp;
    }
}
