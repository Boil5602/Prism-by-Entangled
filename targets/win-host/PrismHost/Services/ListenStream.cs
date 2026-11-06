using System.Buffers.Binary;
using System.Diagnostics;
using System.Globalization;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PrismHost.Services.Audio;

namespace PrismHost.Services;

/// <summary>
/// Private listening (dashboard-schema §14; 2026-10-03): sound to a phone over a WebSocket (or a live MP3) on the remote listener, as 16-bit PCM at 48 kHz stereo in 20 ms frames.
/// A phone presents a ticket core minted for its pairing token (POST /audio/stream-ticket); the host redeems it with core and streams,
/// or refuses. A slow phone has frames dropped, never queued without end.
///
/// Each phone hears its own window (2026-10-06): core routes every listener to a window (ui.listenRoutes), the window's own page is tapped
/// (its player's sound read in the page, before the page's mute, so the room's sound is untouched) and the tap's frames go to the phones
/// routed there. A phone with no route, or whose window's tap is silent or gone (a service whose protection keeps its sound from the page),
/// hears the shared browser's sound through the process loopback, as before: the window that has the room's sound.
/// </summary>
public sealed class ListenStream : IDisposable
{
    private readonly Func<string, Task<string>> _redeem;          // ticket -> listener id, or ""
    private readonly Func<uint> _browserPid;                       // the shared browser's process, 0 when none
    private readonly Func<uint> _ambientPid;                       // the soundscapes' browser (the intermission's sound), 0 until a break has made one
    private readonly Action<int> _listeners;                       // how many phones listen now (the wall goes quiet while any does)
    private readonly Action<string> _log;
    private readonly object _lock = new();
    private readonly List<Phone> _phones = new();
    private ProcessLoopbackCapture.Shared? _capture;   // the browser's one capture, shared with the visualizer (B-475, 2026-11-03)
    private DateTime _captureAt = DateTime.MinValue, _heardAt = DateTime.MinValue;   // when the capture was opened, and when it last gave a sample that was not zero
    private sealed class Phone
    {
        public NetworkStream Stream = null!; public string Who = ""; public int Dropped; public bool Dead; public bool Mp3;
        public readonly SemaphoreSlim Gate = new(1, 1); public readonly Queue<byte[]> Queue = new(); public bool Draining;
        public NAudio.Lame.LameMP3FileWriter? Encoder;   // an MP3 phone's own encoder: phones on different windows hear different sound
        public string? Fed;                               // what feeds it now: a window's tap, or null for the shared sound (logged on change)
        public string Ticket = ""; public long StartFrames;   // the ticket that opened it (its own clock question, GET /audio/clock) and where its stream began on the clock
        public bool Stamp;                                   // its frames carry their time on the clock (?stamp=1, ListenPlayer.cs): 8 bytes, a double of ms, little-endian, before the samples
        public long PendingShift, Dropping, ShiftedFrames;   // a live MP3 shifted on core's word (Shift): frames owed (+ cut, - silence), frames being dropped now, and the total so far for the clock answer
        public bool FadeIn;                                  // the first frame after a shift's seam fades in
    }
    // the routes: listener -> window; the big window for a listener core has not named
    private Dictionary<string, string?> _routes = new();
    private string? _hero;
    /// <summary>The windows phones listen to now (the shell taps exactly these pages).</summary>
    public event Action<HashSet<string>>? TapsWanted;

    public ListenStream(Func<string, Task<string>> redeem, Func<uint> browserPid, Action<int> listeners, Action<string> log, Func<uint>? ambientPid = null)
    { _redeem = redeem; _browserPid = browserPid; _listeners = listeners; _log = log; _ambientPid = ambientPid ?? (() => 0u); }

    public int Count { get { lock (_lock) return _phones.Count; } }
    /// <summary>A ticket redeemed with core: the listener id, or "" (the bands socket asks for the listen page's, 2026-10-31).</summary>
    public Task<string> RedeemAsync(string ticket) => _redeem(ticket);
    /// <summary>The streams as they stand, listener ids as JSON, on every join and leave (2026-10-31): core's room-in-step rule reads it.</summary>
    public event Action<string, int>? StreamsChanged;
    private void AnnounceStreams() { try { string[] who; lock (_lock) who = _phones.Where(p => !p.Dead).Select(p => p.Who).ToArray(); StreamsChanged?.Invoke(JsonSerializer.Serialize(who), who.Length); } catch { } }

    // ---- the room in step with a listener (2026-10-31): the browser sits
    // at SessionMuter.Step, the shared capture is brought back up by the same factor before anything hears it, and RoomDelay plays it to the
    // room the listener's lag later. The taps (a window's own page) are before the session volume and need no gain.
    private volatile float _sourceGain = 1f;
    private volatile bool _stepWanted;
    private RoomDelay? _room;
    public void RoomStep(bool on, double delayMs)
    {
        lock (_lock)
        {
            _stepWanted = on;
            if (on)
            {
                if (_room is null) _room = new RoomDelay(delayMs, _log); else _room.SetDelay(delayMs);   // the gain waits for the muter's word (SourceLevel)
            }
            else
            {
                _sourceGain = 1f;   // down at once: the browser comes back up within the muter's next pass
                try { _room?.Dispose(); } catch { }
                _room = null;
            }
        }
    }
    /// <summary>The level the muter has in force on the browser (SessionMuter.LevelApplied): the gain is its inverse - the room step's and the
    /// person's mute's floor (B-472) and the wall's volume alike - so the phones hear Prism at full whatever the room hears, never before the
    /// sessions are confirmed at that level (review 2026-10-31). A pass that could not confirm (-1) leaves the gain as it was.</summary>
    public static float GainFor(float level) => level < 0f ? float.NaN : level >= 1f ? 1f : 1f / Math.Max(level, SessionMuter.Step);
    public void SourceLevel(uint browserPid, float level)
    {
        var g = GainFor(level); if (float.IsNaN(g)) return;
        if (_capture is { } cap && cap.Pid == browserPid) { if (g != _sourceGain) { _sourceGain = g; _log("listen: source gain " + (g == 1f ? "1" : "x" + Math.Round(g))); } }
        else if (_ambient is { } amb && amb.Pid == browserPid) { if (g != _ambientGain) { _ambientGain = g; _log("listen: soundscape gain " + (g == 1f ? "1" : "x" + Math.Round(g))); } }
        // another tree's word is neither capture's
    }
    /// <summary>Whether a listener id may still be fed (2026-10-31): asked every two seconds for each stream; a no ends the stream. The host
    /// answers for the house (the listen page's switch as the store has it) and yes for the phones, whose tickets the brain already checked.</summary>
    public Func<string, bool>? StillOk { get; set; }
    /// <summary>Every stream of one listener id ended now (2026-10-31): the listen page's switch going off, or its key replaced, cuts the house's
    /// streams at once instead of letting them run on. The sockets close, so each serve loop leaves by itself.</summary>
    public void Drop(string who)
    {
        List<Phone> gone;
        lock (_lock) { gone = _phones.Where(p => (p.Who == who || p.Who.StartsWith(who + ":", StringComparison.Ordinal)) && !p.Dead).ToList(); foreach (var p in gone) p.Dead = true; }
        foreach (var p in gone) { try { p.Stream.Dispose(); } catch { } }
        if (gone.Count > 0) _log("listen: " + gone.Count + " stream(s) of " + (who.StartsWith("house:", StringComparison.Ordinal) ? "the house" : "a phone") + " dropped");
    }

    /// <summary>Core's routes (ui.listenRoutes): {routes: {listener: tile|null}, hero}.</summary>
    public void SetRoutes(string json)
    {
        try
        {
            using var d = JsonDocument.Parse(json);
            var r = new Dictionary<string, string?>();
            if (d.RootElement.TryGetProperty("routes", out var rs) && rs.ValueKind == JsonValueKind.Object)
                foreach (var p in rs.EnumerateObject()) r[p.Name] = p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : null;
            var hero = d.RootElement.TryGetProperty("hero", out var h) && h.ValueKind == JsonValueKind.String ? h.GetString() : null;
            lock (_lock) { _routes = r; _hero = hero; }
            _log("listen: routes " + string.Join(", ", r.Select(kv => Short(kv.Key) + " -> " + (kv.Value ?? "the big window"))) + (hero is null ? "" : " (big window " + hero + ")"));
        }
        catch (Exception ex) { _log("listen: routes " + ex.Message); }
        AnnounceTaps();
    }
    private static string Short(string who) => who.Length > 6 ? who[..6] : who;
    private string? RouteOf(Phone p) => _routes.TryGetValue(p.Who, out var t) ? t ?? _hero : _hero;
    private void AnnounceTaps()
    {
        HashSet<string> want;
        lock (_lock) want = _phones.Where(p => !p.Dead).Select(RouteOf).Where(t => t is not null).Select(t => t!).ToHashSet();
        TapsWanted?.Invoke(want);
    }

    /// <summary>The live MP3: the headers written, the phone added, the socket held until it closes.</summary>
    public async Task ServeMp3Async(NetworkStream stream, string query)
    {
        var ticket = "";
        foreach (var kv in query.Split('&', StringSplitOptions.RemoveEmptyEntries)) if (kv.StartsWith("ticket=", StringComparison.Ordinal)) ticket = System.Net.WebUtility.UrlDecode(kv[7..]);
        var who = ticket.Length > 0 ? await _redeem(ticket) : "";
        if (who.Length == 0)
        {
            var refuse = Encoding.ASCII.GetBytes("HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: 62\r\nConnection: close\r\n\r\n{\"error\":\"no valid stream ticket: ask for one with your token\"}");
            await stream.WriteAsync(refuse); return;
        }
        await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nCache-Control: no-store\r\nAccept-Ranges: none\r\nConnection: close\r\nicy-name: Prism\r\n\r\n"));
        var phone = new Phone { Stream = stream, Who = who, Mp3 = true, Ticket = ticket };
        try { phone.Encoder = new NAudio.Lame.LameMP3FileWriter(new PhoneSink(this, phone), new NAudio.Wave.WaveFormat(48000, 16, 2), 128); }
        catch (Exception ex) { _log("listen: mp3 encoder failed: " + ex.Message); return; }
        Join(phone, "by mp3");
        try
        {
            var buf = new byte[256];
            while (!phone.Dead) { int n; try { n = await stream.ReadAsync(buf); } catch { break; } if (n <= 0) break; }
        }
        finally { Leave(phone, "an mp3 phone left", "chunks"); }
    }
    // an MP3 phone's encoder writes here: its chunks to its own socket
    private sealed class PhoneSink : Stream
    {
        private readonly ListenStream _o; private readonly Phone _p;
        public PhoneSink(ListenStream o, Phone p) { _o = o; _p = p; }
        public override bool CanRead => false; public override bool CanSeek => false; public override bool CanWrite => true; public override long Length => 0; public override long Position { get => 0; set { } }
        public override void Flush() { } public override int Read(byte[] b, int o, int c) => 0; public override long Seek(long o, SeekOrigin s) => 0; public override void SetLength(long v) { }
        public override void Write(byte[] buffer, int offset, int count) { var chunk = new byte[count]; Buffer.BlockCopy(buffer, offset, chunk, 0, count); _ = _o.SendRawAsync(_p, chunk); }
    }
    // an MP3 phone's own gate: a phone that cannot take a chunk within a second is gone (its socket closed so the serve loop ends)
    private async Task SendRawAsync(Phone p, byte[] bytes)
    {
        if (p.Dead) return;
        if (!await p.Gate.WaitAsync(0)) { p.Dropped++; return; }
        try { using var cts = new CancellationTokenSource(1000); await p.Stream.WriteAsync(bytes, cts.Token); }
        catch { p.Dead = true; try { p.Stream.Dispose(); } catch { } }
        finally { p.Gate.Release(); }
    }

    /// <summary>The upgrade: the handshake answered, the phone added, the socket held until it closes.</summary>
    public async Task ServeAsync(NetworkStream stream, Dictionary<string, string> headers, string query)
    {
        var ticket = "";
        foreach (var kv in query.Split('&', StringSplitOptions.RemoveEmptyEntries)) if (kv.StartsWith("ticket=", StringComparison.Ordinal)) ticket = System.Net.WebUtility.UrlDecode(kv[7..]);
        var who = ticket.Length > 0 ? await _redeem(ticket) : "";
        if (who.Length == 0 || !headers.TryGetValue("Sec-WebSocket-Key", out var key))
        {
            var refuse = Encoding.ASCII.GetBytes("HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: 62\r\nConnection: close\r\n\r\n{\"error\":\"no valid stream ticket: ask for one with your token\"}");
            await stream.WriteAsync(refuse); return;
        }
        var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n"));
        var stamp = false; foreach (var kv in query.Split('&', StringSplitOptions.RemoveEmptyEntries)) if (kv == "stamp=1") stamp = true;   // the page plays by the clock (ListenPlayer.cs, 2026-11-03)
        var phone = new Phone { Stream = stream, Who = who, Ticket = ticket, Stamp = stamp };
        Join(phone, stamp ? "by the clock" : "");
        try
        {
            await SendTextAsync(phone, stamp ? "{\"rate\":48000,\"channels\":2,\"stamp\":8}" : "{\"rate\":48000,\"channels\":2}");
            // the socket is read only to see it close (a client's close frame, or the connection dropping); pings are answered by the browser itself
            var buf = new byte[256];
            while (!phone.Dead)
            {
                int n;
                try { n = await stream.ReadAsync(buf); } catch { break; }
                if (n <= 0) break;
                if ((buf[0] & 0x0F) == 0x8) break;   // close
            }
        }
        finally { Leave(phone, "a phone left", "frames"); }
    }

    private void Join(Phone phone, string how)
    {
        var pid = _browserPid();
        lock (_lock)
        {
            _phones.Add(phone);
            phone.StartFrames = Interlocked.Read(ref _sharedFrames);   // its first frame is the clock's next
            // the shared sound stays captured while anyone listens: the fallback for a window whose tap is silent
            if (_capture is null && pid != 0)
            {
                try { _capture = ProcessLoopbackCapture.Take(pid, OnFrames); _captureAt = DateTime.UtcNow; _heardAt = DateTime.MinValue; _log("listen: capture of browser " + pid + " started"); }
                catch (Exception ex) { _log("listen: capture failed: " + ex.Message); }
            }
            if (_capture is not null) StartPacer();
        }
        _listeners(Count);
        _log("listen: a phone listens" + (how.Length > 0 ? " " + how : "") + " (" + Count + ")");
        AnnounceTaps(); AnnounceStreams();
        if (StillOk is { } ok) _ = Task.Run(async () =>   // the stream's standing asked while it runs: the house's ends within two seconds of its switch going off
        {
            while (!phone.Dead)
            {
                await Task.Delay(2000);
                if (phone.Dead) break;
                bool still; try { still = ok(phone.Who); } catch { still = true; }
                if (!still) { Drop(phone.Who); break; }
            }
        });
    }
    private void Leave(Phone phone, string what, string unit)
    {
        lock (_lock)
        {
            phone.Dead = true; _phones.Remove(phone);
            try { phone.Encoder?.Dispose(); } catch { }
            phone.Encoder = null;
            if (_phones.Count == 0 && _capture is not null) { try { _capture.Dispose(); } catch { } _capture = null; StopPacer(); _log("listen: capture stopped"); }
            if (_phones.Count == 0 && _ambient is not null) { try { _ambient.Dispose(); } catch { } _ambient = null; _ambientGain = 1f; _log("listen: soundscape capture stopped"); }
        }
        _listeners(Count);
        _log("listen: " + what + " (" + Count + ", " + phone.Dropped + " " + unit + " dropped)");
        AnnounceTaps(); AnnounceStreams();
    }

    // ---- the sound's sources: each window's tap, and the shared loopback. Each has its own level (a slow gain toward a third of full scale, up to
    // 8x, a soft knee above 0.8; 2026-10-05,: a service's own mix can peak at 3 to 9 percent) and
    // its own 20 ms framing
    private sealed class Source
    {
        public float Gain = 1f, Peak = 0f;
        public readonly List<byte> Pending = new();
        public DateTime LastFrame = DateTime.MinValue, LastSound = DateTime.MinValue, Started = DateTime.UtcNow;
        public double NextStamp = -1;   // a tap's next frame's time on the stream clock (ms); -1 until it has met the clock
    }
    private readonly Source _shared = new();
    private readonly Dictionary<string, Source> _taps = new();
    private const int FrameBytes = 960 * 2 * 2;   // 20 ms
    private const float AgcTarget = 0.33f, AgcMax = 8f;

    /// <summary>A tap is the phone's while it sends frames with sound in them: frames within the last second and a half, and not all-zero
    /// for three seconds (a protected player hands the page zeros, never quiet).</summary>
    private bool TapLive(string? tile)
    {
        if (tile is null || !_taps.TryGetValue(tile, out var s)) return false;
        var now = DateTime.UtcNow;
        if ((now - s.LastFrame).TotalSeconds > 1.5) return false;
        return (now - s.LastSound).TotalSeconds < 3 || (now - s.Started).TotalSeconds < 3;
    }

    private static byte[] Level(Source src, float[] samples, int frames, int channels)
    {
        var bytes = new byte[frames * 2 * 2];
        var o = 0;
        float peak = 0f;
        for (var i = 0; i < frames * channels; i++) { var av = Math.Abs(samples[i]); if (av > peak) peak = av; }
        src.Peak = peak > src.Peak ? peak : src.Peak * 0.98f;
        var want = src.Peak > 0.001f ? Math.Clamp(AgcTarget / src.Peak, 1f, AgcMax) : src.Gain;
        src.Gain += (want - src.Gain) * (want < src.Gain ? 0.3f : 0.1f);
        for (var i = 0; i < frames; i++)
            for (var c = 0; c < 2; c++)
            {
                var v = (channels >= 2 ? samples[i * channels + c] : samples[i * channels]) * src.Gain;
                if (v > 0.8f) v = 0.8f + (v - 0.8f) / (1f + (v - 0.8f) * 4f); else if (v < -0.8f) v = -0.8f + (v + 0.8f) / (1f - (v + 0.8f) * 4f);
                var s = (short)Math.Clamp(v * 32767f, -32768f, 32767f);
                bytes[o++] = (byte)(s & 0xFF); bytes[o++] = (byte)((s >> 8) & 0xFF);
            }
        return bytes;
    }

    // ---- the shared sound on a clock of its own (2026-10-31 evening): the capture hands over what the browser renders and nothing while it renders nothing (between songs, at an ad's switch), so
    // the stream ran short of real time (a sixty-second pull came two percent short) and every player starved and fell further behind at each
    // gap, each by its own browser's measure. Now a pacer emits exactly 960 frames every 20 ms from a short queue of captured sound - a
    // silent frame when the queue holds less than one, the oldest dropped past 300 ms - so the stream is real time by construction, and its
    // frame count is the clock every listener holds a fixed distance behind (Clock, GET /audio/clock: where its own stream began, and now).
    // A second queue for the soundscapes' browser (2026-10-31 evening): the intermission's sound is a hidden page in the prism-ambient profile's own process, which the shared capture never
    // heard; the pacer adds its frames to the shared ones, each at its own tree's room-step gain, so a phone hears the break as the room does.
    private sealed class Fifo
    {
        private readonly object _l = new(); private readonly float[] _b = new float[48000 * 2]; private int _head, _count; public long Dropped;
        private const int Cap = 14400 * 2;   // 300 ms of stereo
        public void Push(float[] samples, int frames, int channels)
        {
            lock (_l)
            {
                for (var i = 0; i < frames; i++)
                {
                    if (_count >= Cap) { _head = (_head + 2) % _b.Length; _count -= 2; Dropped++; }
                    var at = (_head + _count) % _b.Length;
                    _b[at] = samples[i * channels]; _b[at + 1] = channels >= 2 ? samples[i * channels + 1] : samples[i * channels];
                    _count += 2;
                }
            }
        }
        /// <summary>A whole frame into <paramref name="frame"/>, or false and nothing taken (a silent frame then, the rest kept whole).</summary>
        public bool Take(float[] frame)
        {
            lock (_l)
            {
                if (_count < frame.Length) return false;
                for (var i = 0; i < frame.Length; i++) { frame[i] = _b[_head]; _head = (_head + 1) % _b.Length; }
                _count -= frame.Length; return true;
            }
        }
        public void Clear() { lock (_l) { _head = 0; _count = 0; } }
    }
    private readonly Fifo _sharedFifo = new(), _ambientFifo = new();
    private ProcessLoopbackCapture.Shared? _ambient;
    private volatile float _ambientGain = 1f;
    private long _sharedFrames;
    private Thread? _pacer; private volatile bool _pacing;
    [DllImport("winmm.dll")] private static extern uint timeBeginPeriod(uint ms);
    [DllImport("winmm.dll")] private static extern uint timeEndPeriod(uint ms);
    private void OnFrames(float[] samples, int frames, int channels)
    {
        var n = frames * channels;
        for (var i = 0; i < n; i += 8) if (samples[i] > 1e-7f || samples[i] < -1e-7f) { _heardAt = DateTime.UtcNow; break; }   // at the room step's floor a sound is a few hundred-thousandths; silence is zero
        _sharedFifo.Push(samples, frames, channels);
    }
    /// <summary>A session born in the browser tree (SessionMuter.Born; B-475, 2026-11-03): a process loopback hears the
    /// processes alive when it was opened, and Chromium starts its audio process at the first sound, so a capture opened before the music began
    /// (the listen page coming back by itself a second after a restart) stayed silent through the music, the phones and the room with it. A
    /// capture that has heard nothing, or nothing for three seconds, when a session is born is opened again; one that hears sound is left alone.</summary>
    public void CaptureAgain(uint pid)
    {
        lock (_lock)
        {
            if (_capture is not { } cap || cap.Pid != pid) return;
            var heard = _heardAt > DateTime.MinValue;
            var quiet = heard ? (DateTime.UtcNow - _heardAt).TotalSeconds : (DateTime.UtcNow - _captureAt).TotalSeconds;
            if (heard && quiet < 3) return;
            try { if (!ProcessLoopbackCapture.Reopen(pid)) return; _captureAt = DateTime.UtcNow; _heardAt = DateTime.MinValue; _log("listen: capture of browser " + pid + " opened again for every taker (a session born while " + (heard ? "nothing was heard for " + Math.Round(quiet) + " s" : "nothing had been heard") + ")"); }
            catch (Exception ex) { _log("listen: capture could not be opened again: " + ex.Message); }
        }
    }
    private void OnAmbientFrames(float[] samples, int frames, int channels) => _ambientFifo.Push(samples, frames, channels);
    /// <summary>The soundscapes' browser captured while it exists (a break makes it; it may come and go), looked at once a second by the pacer.</summary>
    private void LookAtAmbient()
    {
        var pid = _ambientPid();
        if (_ambient is { } a && (pid == 0 || a.Pid != pid)) { try { a.Dispose(); } catch { } _ambient = null; _ambientGain = 1f; _ambientFifo.Clear(); _log("listen: soundscape capture stopped"); }
        if (_ambient is null && pid != 0)
        {
            try { _ambient = ProcessLoopbackCapture.Take(pid, OnAmbientFrames); _log("listen: soundscape capture of browser " + pid + " started"); }
            catch (Exception ex) { _log("listen: soundscape capture failed: " + ex.Message); }
        }
    }
    private void StartPacer()
    {
        if (_pacing) return;
        _pacing = true;
        _pacer = new Thread(Pace) { IsBackground = true, Name = "prism-listen-pacer", Priority = ThreadPriority.AboveNormal };
        _pacer.Start();
    }
    private void StopPacer()
    {
        _pacing = false;
        try { _pacer?.Join(300); } catch { }
        _pacer = null;
        _sharedFifo.Clear(); _ambientFifo.Clear();
    }
    private void Pace()
    {
        try { timeBeginPeriod(1); } catch { }
        var sw = Stopwatch.StartNew(); long n = 0; var frame = new float[960 * 2]; var more = new float[960 * 2]; var silent = 0L; var noted = 0.0; var peak = 0f; var raw = 0f; var early = false;   // peak after the gain: what the listeners are sent (2026-11-01)
        try
        {
            while (_pacing)
            {
                n++;
                var due = n * 20.0; var wait = due - sw.Elapsed.TotalMilliseconds;
                if (wait < -2000) { n = (long)(sw.Elapsed.TotalMilliseconds / 20); continue; }   // the thread was held for seconds: that time is lost to the clock, not sent as a burst
                if (wait > 2) Thread.Sleep((int)(wait - 1));
                while (_pacing && sw.Elapsed.TotalMilliseconds < due) Thread.Yield();
                if (n % 50 == 0) LookAtAmbient();
                var got = _sharedFifo.Take(frame);
                if (!got) { Array.Clear(frame); silent++; }
                else for (var i = 0; i < frame.Length; i += 4) { var a = frame[i] < 0f ? -frame[i] : frame[i]; if (a > raw) raw = a; }   // what the capture gives before the gain (B-475: a capture that gives zeros)
                var g = _sourceGain;
                if (g != 1f) for (var i = 0; i < frame.Length; i++) { var v = frame[i] * g; frame[i] = v > 1f ? 1f : v < -1f ? -1f : v; }   // the browser's -80 dB undone (RoomStep), never past full scale
                if (_ambient is not null && _ambientFifo.Take(more))
                {
                    var ga = _ambientGain;
                    for (var i = 0; i < frame.Length; i++) { var v = frame[i] + more[i] * ga; frame[i] = v > 1f ? 1f : v < -1f ? -1f : v; }   // the soundscape added, at its own tree's gain
                }
                for (var i = 0; i < frame.Length; i++) { var a = frame[i] < 0f ? -frame[i] : frame[i]; if (a > peak) peak = a; }
                Emit(frame, 960, 2);
                Interlocked.Add(ref _sharedFrames, 960);
                if (!early && sw.Elapsed.TotalSeconds >= 10) { early = true; _log("listen: sent peak " + peak.ToString("0.000") + " in the first 10 s (gain x" + Math.Round(_sourceGain) + ", raw " + raw.ToString("0.000000") + ")"); peak = 0f; raw = 0f; }
                if (sw.Elapsed.TotalSeconds - noted >= 60) { noted = sw.Elapsed.TotalSeconds; _log("listen: clock " + (Interlocked.Read(ref _sharedFrames) / 48000) + " s, sent peak " + peak.ToString("0.000") + " (raw " + raw.ToString("0.000000") + ", gain x" + Math.Round(_sourceGain) + "), " + silent + " silent frames filled, " + _sharedFifo.Dropped + "+" + _ambientFifo.Dropped + " dropped in the last minute"); silent = 0; peak = 0f; raw = 0f; _sharedFifo.Dropped = 0; _ambientFifo.Dropped = 0; }
            }
        }
        catch (Exception ex) { _log("listen: pacer stopped: " + ex.Message); }
        finally { try { timeEndPeriod(1); } catch { } }
    }
    /// <summary>The clock for a stream, by the ticket that opened it: where the stream began (ms on the clock), where the clock stands, and how much the PC has
    /// shifted the stream since (ms, cut positive, silence negative; Shift); null when no stream of that ticket runs.</summary>
    public string? Clock(string ticket)
    {
        if (ticket.Length == 0) return null;
        Phone? p; lock (_lock) p = _phones.FirstOrDefault(x => !x.Dead && x.Ticket == ticket);
        if (p is null) return null;
        var now = Interlocked.Read(ref _sharedFrames) / 48.0;
        return "{\"now\":" + now.ToString("0.0", CultureInfo.InvariantCulture) + ",\"start\":" + (p.StartFrames / 48.0).ToString("0.0", CultureInfo.InvariantCulture) + ",\"shift\":" + (p.ShiftedFrames / 48.0).ToString("0.0", CultureInfo.InvariantCulture) + "}";
    }
    /// <summary>The level the room hears of the delayed capture (B-472 review): the person's mute is zero and the wall's volume is the rest, since the
    /// room-in-step path plays the capture at full scale and would otherwise sound past the mute. The phones are never scaled by it.</summary>
    private volatile float _roomLevel = 1f;
    private float[] _roomScratch = Array.Empty<float>();
    public void SetRoomLevel(float level)
    {
        level = Math.Clamp(level, 0f, 1f);
        if (level == _roomLevel) return;
        _roomLevel = level; _log("listen: the room hears the delayed sound at " + (level <= 0f ? "nothing (muted)" : Math.Round(level * 100) + "%"));
    }
    // the shared sound as the pacer emits it: float stereo 48 kHz in 20 ms frames, for every phone not fed by a live tap
    private void Emit(float[] samples, int frames, int channels)
    {
        if (_room is { } room)
        {
            var lv = _roomLevel;
            if (lv >= 1f) room.Push(samples, frames, channels);
            else
            {
                var n = frames * channels;
                if (_roomScratch.Length < n) _roomScratch = new float[n];
                var sc = _roomScratch;
                if (lv <= 0f) Array.Clear(sc, 0, n); else for (var i = 0; i < n; i++) sc[i] = samples[i] * lv;
                room.Push(sc, frames, channels);
            }
        }
        var bytes = Level(_shared, samples, frames, channels);
        Deliver(_shared, bytes, null, Interlocked.Read(ref _sharedFrames) / 48.0);   // this frame's time on the clock: the count before it is added
    }

    /// <summary>A window's tap (its page's player, 16-bit stereo 48 kHz as the page sent it).</summary>
    public void OnTap(string tile, byte[] pcm16)
    {
        var frames = pcm16.Length / 4;
        if (frames == 0) return;
        var f = new float[frames * 2];
        var any = false;
        for (var i = 0; i < frames * 2; i++) { var s = (short)(pcm16[2 * i] | (pcm16[2 * i + 1] << 8)); if (s != 0) any = true; f[i] = s / 32768f; }
        Source src;
        lock (_lock)
        {
            if (!_taps.TryGetValue(tile, out src!)) { src = new Source(); _taps[tile] = src; }
            src.LastFrame = DateTime.UtcNow;
            if (any) src.LastSound = src.LastFrame;
        }
        Deliver(src, Level(src, f, frames, 2), tile, -1);
    }

    /// <summary>Into 20 ms frames, to the phones this source feeds now: a tap feeds the phones routed to its window while it is live; the
    /// shared sound feeds the rest. Each frame carries its time on the stream clock for a page that asked (?stamp=1, ListenPlayer.cs, 2026-11-03):
    /// the shared sound's is the pacer's count; a tap's runs 20 ms a frame from where it met the clock, set again when it falls more than
    /// 300 ms behind the clock or a second ahead of it (a burst is spread back to real time by its stamps, on the page).</summary>
    private void Deliver(Source src, byte[] bytes, string? tile, double stampMs)
    {
        var sends = new List<(Phone p, byte[] frame)>();
        lock (_lock)
        {
            src.Pending.AddRange(bytes);
            var k = 0;
            while (src.Pending.Count >= FrameBytes)
            {
                var frame = src.Pending.GetRange(0, FrameBytes).ToArray(); src.Pending.RemoveRange(0, FrameBytes);
                double stamp;
                if (tile is null) stamp = stampMs + 20.0 * k++;
                else
                {
                    var now = Interlocked.Read(ref _sharedFrames) / 48.0;
                    if (src.NextStamp < 0 || now - src.NextStamp > 300 || src.NextStamp - now > 1000) src.NextStamp = now;
                    stamp = src.NextStamp; src.NextStamp += 20;
                }
                foreach (var p in _phones)
                {
                    if (p.Dead) continue;
                    var route = RouteOf(p);
                    var feed = TapLive(route) ? route : null;
                    if (feed != tile) continue;
                    if (p.Fed != feed) { p.Fed = feed; _log("listen: " + Short(p.Who) + " hears " + (feed is null ? "the shared sound" + (route is null ? "" : " (" + route + "'s own is silent or not tapped yet)") : feed + "'s own sound")); }
                    if (p.Mp3) FeedMp3(p, frame);
                    else sends.Add((p, p.Stamp ? Stamped(frame, stamp) : frame));
                }
            }
        }
        foreach (var (p, frame) in sends) _ = SendBinaryAsync(p, frame);
    }
    private static byte[] Stamped(byte[] frame, double stampMs)
    {
        var all = new byte[8 + frame.Length];
        BinaryPrimitives.WriteDoubleLittleEndian(all, stampMs);
        Buffer.BlockCopy(frame, 0, all, 8, frame.Length);
        return all;
    }

    /// <summary>Core's word (ui.listenShift, 2026-11-03): the listener's live MP3 streams shifted by ms - cut that much nearer the clock (ms > 0), or held
    /// back with that much silence (ms < 0). The live MP3 is the one player the PC steers (an iPhone's Safari takes no rate on it); a page holds
    /// its own frames to the clock by their stamps and never asks.</summary>
    public void Shift(string who, double ms)
    {
        var frames = (long)Math.Round(ms * 48); if (frames == 0) return;
        var n = 0;
        lock (_lock) foreach (var p in _phones) if (!p.Dead && p.Mp3 && p.Who == who) { p.PendingShift = frames; n++; }
        _log("listen: " + (n == 0 ? "no live MP3 of that listener to shift" : n + " live MP3 stream(s) " + (ms > 0 ? "cut " + (ms / 1000).ToString("0.0", CultureInfo.InvariantCulture) + " s nearer the clock" : "held back " + (-ms / 1000).ToString("0.0", CultureInfo.InvariantCulture) + " s")));
    }
    // an MP3 phone's frame into its encoder, with the shift the PC owes it: the frame at the seam fades out, then frames are dropped (a cut) or
    // silence written (held back), and the first frame after fades in - no click at either edge
    private void FeedMp3(Phone p, byte[] frame)
    {
        try
        {
            if (p.PendingShift != 0)
            {
                var f = (byte[])frame.Clone(); Ramp(f, false); p.Encoder?.Write(f, 0, f.Length);
                if (p.PendingShift < 0)
                {
                    var silent = new byte[FrameBytes]; var n = (int)Math.Ceiling(-p.PendingShift / 960.0);
                    for (var i = 0; i < n; i++) p.Encoder?.Write(silent, 0, FrameBytes);
                    p.ShiftedFrames -= n * 960L;
                }
                else p.Dropping = p.PendingShift;
                p.PendingShift = 0; p.FadeIn = true; return;
            }
            if (p.Dropping > 0) { p.Dropping -= 960; p.ShiftedFrames += 960; return; }
            if (p.FadeIn) { p.FadeIn = false; var f = (byte[])frame.Clone(); Ramp(f, true); p.Encoder?.Write(f, 0, f.Length); return; }
            p.Encoder?.Write(frame, 0, frame.Length);
        }
        catch (Exception ex) { _log("listen: mp3 " + ex.Message); }
    }
    // a 20 ms frame of 16-bit stereo ramped from silence up, or down to it
    private static void Ramp(byte[] frame, bool up)
    {
        var n = frame.Length / 4;
        for (var i = 0; i < n; i++)
        {
            var g = n > 1 ? (float)i / (n - 1) : 1f; if (!up) g = 1f - g;
            for (var c = 0; c < 2; c++)
            {
                var o = i * 4 + c * 2;
                var s = (short)(frame[o] | (frame[o + 1] << 8));
                var v = (short)Math.Round(s * g);
                frame[o] = (byte)(v & 0xFF); frame[o + 1] = (byte)((v >> 8) & 0xFF);
            }
        }
    }

    private static byte[] Frame(byte opcode, byte[] payload)
    {
        var len = payload.Length;
        var head = len < 126 ? new byte[] { (byte)(0x80 | opcode), (byte)len }
            : len < 65536 ? new byte[] { (byte)(0x80 | opcode), 126, (byte)(len >> 8), (byte)len }
            : new byte[] { (byte)(0x80 | opcode), 127, 0, 0, 0, 0, (byte)(len >> 24), (byte)(len >> 16), (byte)(len >> 8), (byte)len };
        var all = new byte[head.Length + len];
        Buffer.BlockCopy(head, 0, all, 0, head.Length); Buffer.BlockCopy(payload, 0, all, head.Length, len);
        return all;
    }
    private Task SendTextAsync(Phone p, string text) { SendAsync(p, Frame(0x1, Encoding.UTF8.GetBytes(text))); return Task.CompletedTask; }
    private Task SendBinaryAsync(Phone p, byte[] payload) { SendAsync(p, Frame(0x2, payload)); return Task.CompletedTask; }
    // a frame goes into the phone's own queue and one writer drains it in order (2026-10-05,:
    // a write that took longer than 15 ms had the next frame dropped, and a dropped 20 ms frame is a cut); only beyond half a second are
    // the oldest frames dropped, so the stream still cannot drift behind the PC
    private const int QueueMax = 25;
    private void SendAsync(Phone p, byte[] frame)
    {
        if (p.Dead) return;
        lock (p.Queue)
        {
            p.Queue.Enqueue(frame);
            while (p.Queue.Count > QueueMax) { p.Queue.Dequeue(); p.Dropped++; }
            if (p.Draining) return;
            p.Draining = true;
        }
        _ = Task.Run(async () =>
        {
            while (true)
            {
                byte[]? next;
                lock (p.Queue) { if (p.Queue.Count == 0 || p.Dead) { p.Draining = false; return; } next = p.Queue.Dequeue(); }
                try { using var cts = new CancellationTokenSource(1500); await p.Stream.WriteAsync(next, cts.Token); }
                catch { p.Dead = true; lock (p.Queue) { p.Draining = false; } return; }
            }
        });
    }

    public void Dispose()
    {
        lock (_lock)
        {
            foreach (var p in _phones) { p.Dead = true; try { p.Encoder?.Dispose(); } catch { } }
            _phones.Clear(); try { _capture?.Dispose(); } catch { } _capture = null;
            try { _room?.Dispose(); } catch { } _room = null;
        }
    }
}
