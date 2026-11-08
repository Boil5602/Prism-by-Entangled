using System.Diagnostics;
using PrismHost.Surfaces.Visualization;

namespace PrismHost.Visualizations;

/// <summary>
/// The deterministic development signal - the C# twin of core's
/// <c>testSignal(t, n)</c> (packages/core/src/visualization.ts): a slow sweep
/// across the bands, a 120 bpm pulse on the low bands, a shimmer on the high
/// ones. Same formula, frame for frame, so a renderer looks the same in every
/// port; core's test pins two frames of it. Implements the host's ONE audio
/// contract (Surfaces/Visualization/VisualizationHost.cs), so it drops in
/// where the WASAPI feed goes.
/// </summary>
public sealed class TestSignalAudioSource : IVisualizationAudioSource
{
    private readonly Stopwatch _clock = Stopwatch.StartNew();

    public float[] Bands(int n) => Sample(_clock.Elapsed.TotalSeconds, n);
    public void SetDemand(bool active) { }

    /// <summary>Pure: identical to core's testSignal(t, n) (pinned there at t = 0.5, n = 4 and t = 2, n = 8).</summary>
    public static float[] Sample(double t, int n)
    {
        if (n <= 0) return Array.Empty<float>();
        var o = new float[n];
        var beat = Math.Pow(Math.Max(0, Math.Cos(((t % 0.5) / 0.5) * Math.PI * 2)), 4);
        var sweep = (Math.Sin(t * 0.7) + 1) / 2;
        for (var i = 0; i < n; i++)
        {
            var x = n == 1 ? 0 : (double)i / (n - 1);
            var hump = Math.Exp(-Math.Pow((x - sweep) * 3.2, 2));
            var low = x < 0.25 ? beat * (1 - x / 0.25) : 0;
            var shimmer = x > 0.7 ? 0.15 * (Math.Sin(t * 9 + i * 1.7) + 1) / 2 : 0;
            o[i] = (float)Math.Min(1, Math.Max(0, 0.08 + 0.6 * hump + 0.5 * low + shimmer));
        }
        return o;
    }
}

/// <summary>
/// The audio source the SurfaceManager hands every visualization: normally
/// the WASAPI loopback FFT, switchable to the test signal from the Device
/// page for development (the switch is live - every host reads through it).
/// </summary>
public sealed class SwitchableAudioSource : IVisualizationAudioSource
{
    private readonly IVisualizationAudioSource? _live;
    private readonly TestSignalAudioSource _test = new();
    private bool _demand;

    public SwitchableAudioSource(IVisualizationAudioSource? live) { _live = live; }

    public bool TestSignal { get; set; }

    public float[] Bands(int n) => TestSignal ? _test.Bands(n) : _live?.Bands(n) ?? new float[Math.Max(0, n)];

    public void SetDemand(bool active)
    {
        _demand = active;
        _live?.SetDemand(active);
    }
}
