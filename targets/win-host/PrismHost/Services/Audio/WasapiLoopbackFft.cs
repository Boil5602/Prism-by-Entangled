using NAudio.CoreAudioApi;
using NAudio.Wave;
using PrismHost.Surfaces.Visualization;

namespace PrismHost.Services.Audio;

/// <summary>
/// §32 Layer 1 - the visualizer's audio feed (win-host-spec §6 WASAPI loopback):
/// a loopback capture of the render device the host plays through, a 2048-point
/// FFT (Hann window), log-spaced bands with attack/decay smoothing and a slow
/// automatic gain, delivered through <see cref="IVisualizationAudioSource"/>.
///
/// Idle when nothing asks: capture starts on the first active visualization
/// (<see cref="SetDemand"/>) and stops when the last goes idle. Silence (peak
/// below -80 dBFS) yields all-zero bands so a paused source visibly rests.
///
/// Scope (B-25, done as B-152 on 2026-09-08): given a target - the stage's source, resolved to its
/// WebView2 browser process - this taps a PROCESS-scoped loopback (<see cref="ProcessLoopbackCapture"/>,
/// Windows 10 2004+): the source and nothing else, so a conference call in another app no longer
/// moves the stage. Without a target, or where activation fails, the DEVICE loopback (everything
/// the machine plays) stands in as before. The target is re-checked every few seconds: a recycled
/// source has a new process, and a source that came up after the capture started gets its own.
/// </summary>
public sealed class WasapiLoopbackFft : IVisualizationAudioSource, IDisposable
{
    private const int FftSize = 2048;
    private readonly object _gate = new();
    private readonly float[] _ring = new float[FftSize];
    private int _ringPos;
    private long _samplesSeen;
    private WasapiLoopbackCapture? _capture;
    private ProcessLoopbackCapture? _process;
    private Func<uint?>? _target;
    private Timer? _watch;
    private int _demand;
    private int _sampleRate = 48000;
    private readonly Action<string> _log;

    // FFT scratch + smoothed output
    private readonly float[] _re = new float[FftSize];
    private readonly float[] _im = new float[FftSize];
    private readonly float[] _window = new float[FftSize];
    private readonly float[] _mag = new float[FftSize / 2];
    private float[] _smooth = Array.Empty<float>();
    private float _gain = 1f;
    private long _lastFftAt;
    private bool _silent = true;

    public WasapiLoopbackFft(Action<string>? log = null)
    {
        _log = log ?? (_ => { });
        for (var i = 0; i < FftSize; i++) _window[i] = 0.5f - 0.5f * MathF.Cos(2f * MathF.PI * i / (FftSize - 1));
    }

    public bool Capturing => _capture is not null || _process is not null;

    /// <summary>B-152: who to listen to - a resolver for the source's browser process id (null = the device). Re-read on every (re)start and by the watch.</summary>
    public void SetTargetResolver(Func<uint?>? target)
    {
        lock (_gate)
        {
            _target = target;
            if (_demand > 0) { StopCore(); Start(); }
        }
    }

    /// <summary>Every 3 s while capturing: the target's process changed (a recycle), appeared (a late source), or the process capture died - start over on the right one.</summary>
    private void Watch()
    {
        lock (_gate)
        {
            if (_demand == 0) return;
            uint? want = null;
            try { want = _target?.Invoke(); } catch { }
            var have = _process?.Pid;
            var dead = _process?.Error is not null;
            if (_process is { } pr) _log($"process loopback: pid {pr.Pid} wakes {pr.Wakes} packets {pr.Packets} frames {pr.FramesTotal} silent {pr.SilentPackets} peak {pr.Peak1000 / 1000.0:0.000} ring {_samplesSeen}" + (dead ? " ERROR " + pr.Error!.Message : ""));
            if (dead || (want is { } w && have != w) || (want is null && _process is not null)) { StopCore(); Start(); }
        }
    }

    public void SetDemand(bool active)
    {
        lock (_gate)
        {
            _demand = Math.Max(0, _demand + (active ? 1 : -1));
            if (_demand > 0 && !Capturing) Start();
            else if (_demand == 0 && Capturing) Stop();
        }
    }

    private void Start()
    {
        _watch ??= new Timer(_ => Watch(), null, 3000, 3000);
        uint? pid = null;
        try { pid = _target?.Invoke(); } catch { }
        if (pid is { } p)
        {
            try
            {
                _process = ProcessLoopbackCapture.Start(p, Feed);
                _sampleRate = _process.Format.SampleRate;
                _log($"process loopback capture started: browser process {p}, {_sampleRate} Hz");
                return;
            }
            catch (Exception ex) { _log("process loopback unavailable (" + ex.Message + "); the device loopback stands in"); _process = null; }
        }
        else if (_target is not null) _log("loopback: the source has no browser process yet - the device loopback stands in until it does");
        try
        {
            var cap = new WasapiLoopbackCapture();                   // the default render endpoint (what the host plays through)
            _sampleRate = cap.WaveFormat.SampleRate;
            var channels = cap.WaveFormat.Channels;
            var isFloat = cap.WaveFormat.Encoding == WaveFormatEncoding.IeeeFloat || (cap.WaveFormat is WaveFormatExtensible ext && ext.SubFormat == Guid.Parse("00000003-0000-0010-8000-00aa00389b71"));   // KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
            var bytesPerSample = cap.WaveFormat.BitsPerSample / 8;
            cap.DataAvailable += (_, e) =>
            {
                // downmix to mono into the ring buffer
                var frames = e.BytesRecorded / (bytesPerSample * channels);
                lock (_gate)
                {
                    for (var f = 0; f < frames; f++)
                    {
                        float sum = 0;
                        for (var c = 0; c < channels; c++)
                        {
                            var off = (f * channels + c) * bytesPerSample;
                            sum += isFloat ? BitConverter.ToSingle(e.Buffer, off)
                                 : bytesPerSample == 2 ? BitConverter.ToInt16(e.Buffer, off) / 32768f
                                 : bytesPerSample == 4 ? BitConverter.ToInt32(e.Buffer, off) / 2147483648f
                                 : 0f;
                        }
                        _ring[_ringPos] = sum / channels;
                        _ringPos = (_ringPos + 1) % FftSize;
                        _samplesSeen++;
                    }
                }
            };
            cap.RecordingStopped += (_, e) => { if (e.Exception is not null) _log("loopback stopped: " + e.Exception.Message); };
            cap.StartRecording();
            _capture = cap;
            _log($"loopback capture started: {_sampleRate} Hz, {channels} ch, {(isFloat ? "float" : bytesPerSample * 8 + "-bit")}");
        }
        catch (Exception ex)
        {
            _log("loopback capture unavailable: " + ex.Message);   // bands stay at zero; visualizations idle dark
            _capture = null;
        }
    }

    private void Stop()
    {
        StopCore();
        _log("loopback capture stopped (no active visualization)");
    }

    private void StopCore()
    {
        try { _capture?.StopRecording(); _capture?.Dispose(); } catch { }
        _capture = null;
        try { _process?.Dispose(); } catch { }
        _process = null;
        _samplesSeen = 0;
        Array.Clear(_ring);
        _smooth = Array.Empty<float>();
    }

    /// <summary>Interleaved float frames from the process capture: downmixed to mono into the ring.</summary>
    private void Feed(float[] buf, int frames, int channels)
    {
        lock (_gate)
        {
            for (var f = 0; f < frames; f++)
            {
                float sum = 0;
                for (var c = 0; c < channels; c++) sum += buf[f * channels + c];
                _ring[_ringPos] = sum / channels;
                _ringPos = (_ringPos + 1) % FftSize;
                _samplesSeen++;
            }
        }
    }

    public float[] Bands(int n)
    {
        lock (_gate) return BandsCore(n);   // B-152: the watch restarts captures from its own thread; the render thread must not see a half-swapped state
    }

    private float[] BandsCore(int n)
    {
        n = Math.Max(1, Math.Min(256, n));
        if (_smooth.Length != n) _smooth = new float[n];
        var out_ = new float[n];
        if (!Capturing || _samplesSeen < FftSize) return out_;
        var now = Environment.TickCount64;
        if (now - _lastFftAt >= 15) { _lastFftAt = now; ComputeFft(); }
        if (_silent) { for (var i = 0; i < n; i++) _smooth[i] *= 0.85f; Array.Copy(_smooth, out_, n); return out_; }

        // log-spaced bands from ~40 Hz to ~16 kHz over the magnitude spectrum
        var binHz = (double)_sampleRate / FftSize;
        var fLo = 40.0;
        var fHi = Math.Min(16000.0, _sampleRate / 2.0);
        for (var b = 0; b < n; b++)
        {
            var f0 = fLo * Math.Pow(fHi / fLo, (double)b / n);
            var f1 = fLo * Math.Pow(fHi / fLo, (double)(b + 1) / n);
            var i0 = Math.Max(1, (int)(f0 / binHz));
            var i1 = Math.Max(i0 + 1, (int)(f1 / binHz));
            float peak = 0;
            for (var i = i0; i < i1 && i < _mag.Length; i++) peak = Math.Max(peak, _mag[i]);
            var v = MathF.Min(1f, peak * _gain);
            // attack fast, decay slow
            _smooth[b] = v > _smooth[b] ? _smooth[b] + (v - _smooth[b]) * 0.6f : _smooth[b] * 0.82f + v * 0.18f;
            out_[b] = _smooth[b];
        }
        // slow AGC toward a comfortable ceiling
        var top = out_.Max();
        // slow AGC toward a comfortable ceiling; a ducked source (B-152) sits 60 dB down, so the ceiling is high and the climb faster when far below
        if (top > 0.95f) _gain *= 0.97f; else if (top < 0.35f && top > 0f) _gain = MathF.Min(_gain * (top < 0.05f ? 1.04f : 1.01f), 1e6f);
        return out_;
    }

    private void ComputeFft()
    {
        float peak = 0;
        lock (_gate)
        {
            for (var i = 0; i < FftSize; i++)
            {
                var s = _ring[(_ringPos + i) % FftSize];
                peak = Math.Max(peak, Math.Abs(s));
                _re[i] = s * _window[i];
                _im[i] = 0;
            }
        }
        _silent = peak < (_process is not null ? 1e-7f : 1e-4f);     // ~ -80 dBFS; a process capture yields exact zeros for silence, and a ducked source (-60 dB, B-152) is signal
        if (_silent) return;
        Fft(_re, _im);
        for (var i = 0; i < _mag.Length; i++) _mag[i] = MathF.Sqrt(_re[i] * _re[i] + _im[i] * _im[i]) / (FftSize / 4f);
    }

    /// <summary>In-place iterative radix-2 FFT (n = FftSize, a power of two).</summary>
    private static void Fft(float[] re, float[] im)
    {
        var n = re.Length;
        for (int i = 1, j = 0; i < n; i++)
        {
            var bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { (re[i], re[j]) = (re[j], re[i]); (im[i], im[j]) = (im[j], im[i]); }
        }
        for (var len = 2; len <= n; len <<= 1)
        {
            var ang = -2 * MathF.PI / len;
            var wr = MathF.Cos(ang); var wi = MathF.Sin(ang);
            for (var i = 0; i < n; i += len)
            {
                float cr = 1, ci = 0;
                for (var k = 0; k < len / 2; k++)
                {
                    var ur = re[i + k]; var ui = im[i + k];
                    var vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
                    var vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
                    re[i + k] = ur + vr; im[i + k] = ui + vi;
                    re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
                    var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
                }
            }
        }
    }

    public void Dispose() { lock (_gate) { _demand = 0; if (Capturing) Stop(); _watch?.Dispose(); _watch = null; } }
}
