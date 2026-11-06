using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace PrismHost.Services.Audio;

/// <summary>
/// The room in step with a listener (2026-10-31): while a phone or
/// the listen page listens and a music source has the sound, the browser's own output is turned down to nothing (SessionMuter.Step, a
/// ten-thousandth, -80 dB), the loopback capture is multiplied back up, and this plays that capture through the playback device a set
/// delay later - the listener's own lag - so the room and the phone hit the beat together. Measured 2026-10-31: the capture is scaled
/// before the tap, not cut, and keeps its shape down to a ten-thousandth, so nothing is lost.
///
/// A ring of float stereo frames at 48 kHz, fifteen seconds deep; the reader sits <see cref="DelayMs"/> behind the writer. A change of
/// delay moves the reader under a short fade, so the room hears no click. Written from the capture's pump thread, read by WASAPI's own
/// thread; the two meet on one lock around the indexes alone.
/// </summary>
internal sealed class RoomDelay : IDisposable
{
    private const int Rate = 48000, Channels = 2, Depth = Rate * 15;
    private readonly float[] _ring = new float[Depth * Channels];
    private readonly object _lock = new();
    private long _written;            // frames written in all
    private long _read;               // frames read in all
    private int _delayFrames;
    private int _fade;                // frames left of a fade after a move (down then up)
    private int _fadeLen;
    private bool _fadeDown;
    private long _pendingRead = -1;   // where the reader goes once the fade-down is done
    private WasapiOut? _out;
    private readonly Action<string> _log;
    private volatile bool _disposed;
    private DateTime _lastRestart = DateTime.MinValue;

    public RoomDelay(double delayMs, Action<string> log)
    {
        _log = log;
        _delayFrames = Frames(delayMs);
        _read = -_delayFrames;   // the reader starts a delay behind an empty ring: silence for the delay, then the music
        Open();
    }

    private static int Frames(double ms) => (int)Math.Clamp(Math.Round(ms / 1000.0 * Rate), 0, Depth - Rate);

    public double DelayMs { get => _delayFrames * 1000.0 / Rate; }

    /// <summary>A new delay: the reader moves there under a 40 ms fade each way.</summary>
    public void SetDelay(double delayMs)
    {
        var want = Frames(delayMs);
        lock (_lock)
        {
            if (want == _delayFrames) return;
            _delayFrames = want;
            _pendingRead = _written - want;
            _fadeLen = Rate / 25; _fade = _fadeLen; _fadeDown = true;
        }
        _log("room delay: " + (want * 1000 / Rate) + " ms");
    }

    /// <summary>The capture's frames, already brought back to full scale.</summary>
    public void Push(float[] samples, int frames, int channels)
    {
        if (_disposed || frames <= 0) return;
        lock (_lock)
        {
            for (var i = 0; i < frames; i++)
            {
                var at = (int)((_written + i) % Depth) * Channels;
                _ring[at] = samples[i * channels];
                _ring[at + 1] = channels >= 2 ? samples[i * channels + 1] : samples[i * channels];
            }
            _written += frames;
            if (_written - _read > Depth - Rate) _read = _written - _delayFrames;   // the reader fell too far behind (the device stalled): back under the writer
        }
        if (_out is null || _out.PlaybackState == PlaybackState.Stopped) { if ((DateTime.UtcNow - _lastRestart).TotalSeconds > 5) Open(); }
    }

    private void Open()
    {
        _lastRestart = DateTime.UtcNow;
        try
        {
            try { _out?.Dispose(); } catch { }
            using var en = new MMDeviceEnumerator();
            var dev = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            _out = new WasapiOut(dev, AudioClientShareMode.Shared, true, 60);
            _out.Init(new Reader(this));
            _out.PlaybackStopped += (_, e) => { if (e.Exception is not null) _log("room delay: playback stopped: " + e.Exception.Message); };
            _out.Play();
            _log("room delay: playing to " + dev.FriendlyName + " at " + DelayMs + " ms");
        }
        catch (Exception ex) { _log("room delay: could not open the playback device: " + ex.Message); _out = null; }
    }

    private int Read(float[] buffer, int offset, int count)
    {
        var frames = count / Channels;
        lock (_lock)
        {
            for (var i = 0; i < frames; i++)
            {
                float gain = 1f;
                if (_fade > 0)
                {
                    gain = _fadeDown ? (float)_fade / _fadeLen : 1f - (float)_fade / _fadeLen;
                    if (--_fade == 0 && _fadeDown) { _fadeDown = false; _fade = _fadeLen; if (_pendingRead >= 0) { _read = _pendingRead; _pendingRead = -1; } }
                }
                if (_read < 0 || _read >= _written) { buffer[offset + i * Channels] = 0; buffer[offset + i * Channels + 1] = 0; _read++; continue; }   // nothing yet: silence
                var at = (int)(_read % Depth) * Channels;
                buffer[offset + i * Channels] = _ring[at] * gain;
                buffer[offset + i * Channels + 1] = _ring[at + 1] * gain;
                _read++;
            }
        }
        return frames * Channels;
    }

    private sealed class Reader : ISampleProvider
    {
        private readonly RoomDelay _o;
        public Reader(RoomDelay o) { _o = o; }
        public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(Rate, Channels);
        public int Read(float[] buffer, int offset, int count) => _o.Read(buffer, offset, count);
    }

    public void Dispose()
    {
        _disposed = true;
        try { _out?.Stop(); _out?.Dispose(); } catch { }
        _out = null;
    }
}
