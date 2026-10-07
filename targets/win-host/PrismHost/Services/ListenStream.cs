using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PrismHost.Services.Audio;

namespace PrismHost.Services;

/// <summary>
/// Private listening (dashboard-schema §14; 2026-10-03, "The app should also enable the private listening feature through the phone
/// sound"): sound to a phone over a WebSocket (or a live MP3) on the remote listener, as 16-bit PCM at 48 kHz stereo in 20 ms frames.
/// A phone presents a ticket core minted for its pairing token (POST /audio/stream-ticket); the host redeems it with core and streams,
/// or refuses. A slow phone has frames dropped, never queued without end.
///
/// Each phone hears its own window (2026-10-06, "there could be 10 people private listening, in which case they should each hear whatever
/// they have selected in the companion app"): core routes every listener to a window (ui.listenRoutes), the window's own page is tapped
/// (its player's sound read in the page, before the page's mute, so the room's sound is untouched) and the tap's frames go to the phones
/// routed there. A phone with no route, or whose window's tap is silent or gone (a service whose protection keeps its sound from the page),
/// hears the shared browser's sound through the process loopback, as before: the window that has the room's sound.
/// </summary>
public sealed class ListenStream : IDisposable
{
    private readonly Func<string, Task<string>> _redeem;          // ticket -> listener id, or ""
    private readonly Func<uint> _browserPid;                       // the shared browser's process, 0 when none
    private readonly Action<int> _listeners;                       // how many phones listen now (the wall goes quiet while any does)
    private readonly Action<string> _log;
    private readonly object _lock = new();
    private readonly List<Phone> _phones = new();
    private ProcessLoopbackCapture? _capture;
    private sealed class Phone
    {
        public NetworkStream Stream = null!; public string Who = ""; public int Dropped; public bool Dead; public bool Mp3;
        public readonly SemaphoreSlim Gate = new(1, 1); public readonly Queue<byte[]> Queue = new(); public bool Draining;
        public NAudio.Lame.LameMP3FileWriter? Encoder;   // an MP3 phone's own encoder: phones on different windows hear different sound
        public string? Fed;                               // what feeds it now: a window's tap, or null for the shared sound (logged on change)
    }
    // the routes: listener -> window; the big window for a listener core has not named
    private Dictionary<string, string?> _routes = new();
    private string? _hero;
    /// <summary>The windows phones listen to now (the shell taps exactly these pages).</summary>
    public event Action<HashSet<string>>? TapsWanted;

    public ListenStream(Func<string, Task<string>> redeem, Func<uint> browserPid, Action<int> listeners, Action<string> log)
    { _redeem = redeem; _browserPid = browserPid; _listeners = listeners; _log = log; }

    public int Count { get { lock (_lock) return _phones.Count; } }

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
        var phone = new Phone { Stream = stream, Who = who, Mp3 = true };
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
        var phone = new Phone { Stream = stream, Who = who };
        Join(phone, "");
        try
        {
            await SendTextAsync(phone, "{\"rate\":48000,\"channels\":2}");
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
            // the shared sound stays captured while anyone listens: the fallback for a window whose tap is silent
            if (_capture is null && pid != 0)
            {
                try { _capture = ProcessLoopbackCapture.Start(pid, OnFrames); _log("listen: capture of browser " + pid + " started"); }
                catch (Exception ex) { _log("listen: capture failed: " + ex.Message); }
            }
        }
        _listeners(Count);
        _log("listen: a phone listens" + (how.Length > 0 ? " " + how : "") + " (" + Count + ")");
        AnnounceTaps();
    }
    private void Leave(Phone phone, string what, string unit)
    {
        lock (_lock)
        {
            phone.Dead = true; _phones.Remove(phone);
            try { phone.Encoder?.Dispose(); } catch { }
            phone.Encoder = null;
            if (_phones.Count == 0 && _capture is not null) { try { _capture.Dispose(); } catch { } _capture = null; _log("listen: capture stopped"); }
        }
        _listeners(Count);
        _log("listen: " + what + " (" + Count + ", " + phone.Dropped + " " + unit + " dropped)");
        AnnounceTaps();
    }

    // ---- the sound's sources: each window's tap, and the shared loopback. Each has its own level (a slow gain toward a third of full scale, up to
    // 8x, a soft knee above 0.8; 2026-10-05, "Sound is arriving from the PC (level 3%)": a service's own mix can peak at 3 to 9 percent) and
    // its own 20 ms framing
    private sealed class Source
    {
        public float Gain = 1f, Peak = 0f;
        public readonly List<byte> Pending = new();
        public DateTime LastFrame = DateTime.MinValue, LastSound = DateTime.MinValue, Started = DateTime.UtcNow;
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

    // the shared loopback: float stereo 48 kHz, for every phone not fed by a live tap
    private void OnFrames(float[] samples, int frames, int channels)
    {
        var bytes = Level(_shared, samples, frames, channels);
        Deliver(_shared, bytes, null);
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
        Deliver(src, Level(src, f, frames, 2), tile);
    }

    /// <summary>Into 20 ms frames, to the phones this source feeds now: a tap feeds the phones routed to its window while it is live; the
    /// shared sound feeds the rest.</summary>
    private void Deliver(Source src, byte[] bytes, string? tile)
    {
        var sends = new List<(Phone p, byte[] frame)>();
        lock (_lock)
        {
            src.Pending.AddRange(bytes);
            while (src.Pending.Count >= FrameBytes)
            {
                var frame = src.Pending.GetRange(0, FrameBytes).ToArray(); src.Pending.RemoveRange(0, FrameBytes);
                foreach (var p in _phones)
                {
                    if (p.Dead) continue;
                    var route = RouteOf(p);
                    var feed = TapLive(route) ? route : null;
                    if (feed != tile) continue;
                    if (p.Fed != feed) { p.Fed = feed; _log("listen: " + Short(p.Who) + " hears " + (feed is null ? "the shared sound" + (route is null ? "" : " (" + route + "'s own is silent or not tapped yet)") : feed + "'s own sound")); }
                    if (p.Mp3) { try { p.Encoder?.Write(frame, 0, frame.Length); } catch (Exception ex) { _log("listen: mp3 " + ex.Message); } }
                    else sends.Add((p, frame));
                }
            }
        }
        foreach (var (p, frame) in sends) _ = SendBinaryAsync(p, frame);
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
    // a frame goes into the phone's own queue and one writer drains it in order (2026-10-05, "every ~10 seconds I hear a momentary cut":
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
        }
    }
}
