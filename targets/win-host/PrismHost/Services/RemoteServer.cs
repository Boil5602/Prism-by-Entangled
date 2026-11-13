using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace PrismHost.Services;

/// <summary>
/// The device-local remote API listener (dashboard-schema §6, win-host-spec §2
/// "remote API (local HTTP/WS server)"). A thin HTTP/1.1 front on a TcpListener
/// (no URL ACL / admin needed): every request is handed to core as
/// PrismRuntime.http(requestId, {method, path, body, token, userAgent}) and the
/// answer arrives back over the channel as {op:"http.response", requestId, …}.
/// The host routes nothing and authenticates nothing - core's pairing tokens do
/// (§6); this class only moves bytes. Loopback + LAN, port 8471 by default.
/// The remote PWA itself (GET /remote) is served here as a placeholder page
/// until the shared PWA lands (build order item 3).
/// </summary>
public sealed class RemoteServer : IDisposable
{
    private TcpListener _listener;   // replaced only by AcceptLoop's bounded recovery (B-385)
    private readonly Action<int, string, string> _dispatch;                 // (requestId, requestJson) → PrismRuntime.http
    private readonly Action<string> _log;
    private readonly ConcurrentDictionary<int, TaskCompletionSource<(int status, string body, string contentType)>> _pending = new();
    private int _nextId;
    private bool _stopped;

    public int Port { get; }

    /// <summary>Private listening (ListenStream, 2026-10-03): set by the host once the brain is up; a stream request before that is refused.</summary>
    public ListenStream? Listen { get; set; }

    /// <summary>The lounge's bands for the phone's own visual (2026-10-27): the host's
    /// loopback FFT (WasapiLoopbackFft.Bands) and its demand switch, so the capture runs while a phone's visual is open. Set by the host.</summary>
    public Func<int, float[]>? Bands { get; set; }
    public Action<bool>? BandsDemand { get; set; }

    /// <summary>Whether a token is a paired phone's (the routes the host answers itself ask this; every other route is core's, which checks
    /// the pairing itself). Unset, those routes refuse every token (2026-10-05 review: they had taken any non-empty string).</summary>
    public Func<string, bool>? TokenOk { get; set; }
    private bool Paired(string? token) => token is { Length: > 0 } && TokenOk is { } ok && ok(token);
    /// <summary>The listen page's household key (2026-10-31): core's record, on and matching. It opens the page and the bands, nothing of a pairing's.</summary>
    public Func<string, bool>? HouseOk { get; set; }
    private bool House(string? key) => key is { Length: > 0 } && HouseOk is { } ok && ok(key);

    /// <param name="dispatch">The request for core, and the copy of it the log gets (no body: ChannelParser.PhoneRequestJson).</param>
    /// <summary>A service's mark (bytes and type) by app id, for the phone's cards; set by the host, null until then.</summary>
    public Func<string, Task<(byte[]? bytes, string? mime)>>? MarkOf { get; set; }
    public RemoteServer(int port, Action<int, string, string> dispatch, Action<string> log)
    {
        _dispatch = dispatch;
        _log = log;
        _listener = new TcpListener(IPAddress.Any, port);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _ = Task.Run(AcceptLoop);
        _ = Task.Run(AcceptWatch);
    }

    /// <summary>The base URL a phone on the LAN reaches this frame at (first non-loopback IPv4).</summary>
    public string BaseUrl()
    {
        try
        {
            foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up || ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback) continue;
                foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                    if (ua.Address.AddressFamily == AddressFamily.InterNetwork) return $"http://{ua.Address}:{Port}";
            }
        }
        catch { }
        return $"http://127.0.0.1:{Port}";
    }

    /// <summary>core → host {op:"http.response"}: completes the waiting request.</summary>
    public void OnResponse(int requestId, int status, string body, string contentType)
    {
        if (_pending.TryRemove(requestId, out var tcs)) tcs.TrySetResult((status, body, contentType));
    }

    // B-385 (2026-10-18): the accept loop ended on one failed accept (Windows fails an
    // accept with "connection reset" when the phone drops the connection before PRISM takes it) and the listener socket stayed bound, so
    // every phone connection completed in the kernel's backlog and was never answered - the page spun until PRISM was restarted. The
    // loop now survives a failed accept: it logs, pauses briefly, and after twenty failures in a row rebinds the port (bounded: twenty
    // tries, then it stops and says so). A watcher restarts the loop should it ever end while the server is not stopped.
    private int _acceptLoopRuns;
    private volatile bool _acceptLoopAlive;

    private async Task AcceptLoop()
    {
        _acceptLoopAlive = true;
        var runs = Interlocked.Increment(ref _acceptLoopRuns);
        var failures = 0;
        try
        {
            while (!_stopped)
            {
                TcpClient client;
                try { client = await _listener.AcceptTcpClientAsync(); failures = 0; }
                catch (Exception ex) when (!_stopped)
                {
                    failures++;
                    _log("remote accept failed (" + failures + "): " + ex.Message);
                    if (failures >= 20)
                    {
                        if (!Rebind()) { _log("remote accept: could not rebind port " + Port + ", the phone page is down until PRISM restarts"); return; }
                        failures = 0;
                    }
                    await Task.Delay(Math.Min(100 * failures, 2000));
                    continue;
                }
                catch { break; }   // stopped: the listener was closed by Dispose
                _ = Task.Run(() => ServeAsync(client));
            }
        }
        finally
        {
            _acceptLoopAlive = false;
            if (!_stopped) _log("remote accept loop ended (run " + runs + ")");
        }
    }

    /// <summary>A new listener on the same port, at most twenty times in the server's life; false when the port cannot be bound again.</summary>
    private int _rebinds;
    private bool Rebind()
    {
        if (Interlocked.Increment(ref _rebinds) > 20) return false;
        try { _listener.Stop(); } catch { }
        try { _listener = new TcpListener(IPAddress.Any, Port); _listener.Start(); _log("remote API rebound on port " + Port); return true; }
        catch (Exception ex) { _log("remote rebind failed: " + ex.Message); return false; }
    }

    /// <summary>Every ten seconds: an accept loop that has ended while the server lives is started again (at most twenty times).</summary>
    private async Task AcceptWatch()
    {
        while (!_stopped)
        {
            await Task.Delay(10000);
            if (_stopped || _acceptLoopAlive) continue;
            if (_acceptLoopRuns >= 20) { _log("remote accept loop ended twenty times, not started again"); return; }
            _log("remote accept loop restarted");
            _ = Task.Run(AcceptLoop);
        }
    }

    private async Task ServeAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = 10000;
                using var stream = client.GetStream();
                using var readCap = new CancellationTokenSource(10000);   // ReceiveTimeout is for synchronous reads only (B-385)
                var (head, bodyStart) = await ReadHeadAsync(stream, readCap.Token);
                if (head is null) return;
                var lines = head.Split("\r\n");
                var reqLine = lines[0].Split(' ');
                if (reqLine.Length < 2) return;
                var method = reqLine[0].ToUpperInvariant();
                var target = reqLine[1];
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var l in lines.Skip(1)) { var i = l.IndexOf(':'); if (i > 0) headers[l[..i].Trim()] = l[(i + 1)..].Trim(); }
                var len = headers.TryGetValue("Content-Length", out var cl) && int.TryParse(cl, out var n) ? n : 0;
                var body = await ReadBodyAsync(stream, bodyStart, len, readCap.Token);
                var q = target.IndexOf('?');
                var path = q >= 0 ? target[..q] : target;
                var query = q >= 0 ? target[(q + 1)..] : "";
                string? token = null;
                if (headers.TryGetValue("Authorization", out var auth) && auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) token = auth[7..].Trim();
                foreach (var kv in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
                    if (kv.StartsWith("token=", StringComparison.Ordinal)) token ??= WebUtility.UrlDecode(kv[6..]);

                if (method == "OPTIONS") { await WriteAsync(stream, 204, "", "text/plain"); return; }
                if (method == "GET" && path == "/remote")
                {
                    var html = PageHtml.Replace("__TOKEN__", WebUtility.UrlEncode(token ?? "")).Replace("__SERVICES__", ServicesJson);
                    // head=classic (2026-10-05, a bisect for iOS): the page as it was before the
                    // install nudge's head additions - no status-bar style, the 128 px touch icon, the one-icon manifest - so the two can be compared on the phone
                    if (query.Contains("head=classic"))
                    {
                        html = html.Replace("<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">", "")
                                   .Replace("<link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"/remote/icon-180.png\">", "<link rel=\"apple-touch-icon\" href=\"/remote/icon.png\">")
                                   .Replace("/remote/manifest.json?token=", "/remote/manifest.json?classic=1&token=");
                    }
                    await WriteAsync(stream, 200, html, "text/html; charset=utf-8"); return;
                }   // the token into the manifest link: a home-screen app opens paired
                // the page's icon and manifest (2026-10-04): PRISM's own mark; the
                // manifest's start address keeps the phone's token so the home-screen icon opens the wall already paired
                // the page's version (2026-10-04): a hash of the page as this host serves it; the page asks each minute
                if (method == "GET" && path == "/remote/version") { await WriteAsync(stream, 200, "{\"v\":\"" + PageVersion + "\"}", "application/json"); return; }
                // the listen page (Services/ListenPage.cs, 2026-10-31): the house's view-and-listen page, by the household key in its address;
                // with the switch off or another key, a page that says so and nothing else
                if (method == "GET" && path == "/listen/silence.wav") { await WriteBytesAsync(stream, 200, SilenceWav, "audio/wav"); return; }   // two seconds of nothing, for Silk (ListenPage.cs, keepSilk)
                if (method == "GET" && path == "/listen")
                {
                    var key = ""; foreach (var kv in query.Split('&', StringSplitOptions.RemoveEmptyEntries)) if (kv.StartsWith("key=", StringComparison.Ordinal)) key = WebUtility.UrlDecode(kv[4..]);
                    // the page itself goes to anyone on the network while the switch is on (its address is short enough to type, 2026-10-31); the host
                    // checks no code: the page reads one from its own address when the QR brought it, else asks, and core checks it on the page's
                    // routes with its per-device count of wrong tries (the review: one gate, not two)
                    if (HouseOk is { } hoo && hoo("")) { await WriteAsync(stream, 200, ListenHtml, "text/html; charset=utf-8"); return; }
                    _log("listen page: off");
                    await WriteAsync(stream, 200, Services.ListenPage.OffHtml, "text/html; charset=utf-8"); return;
                }
                // the phone's own audio state while it listens (2026-10-05): one line in host.log so the two sides can be read together;
                // the page's words alone, with a paired token, on the home network - nothing leaves the house
                if (method == "POST" && path == "/remote/diag")
                {
                    if (!Paired(token)) { await WriteAsync(stream, 401, "{}", "application/json"); return; }
                    _log("phone diag: " + (body.Length > 600 ? body[..600] : body));
                    await WriteAsync(stream, 200, "{\"ok\":true}", "application/json"); return;
                }
                // the PC's playback device, asked by a phone that hears silence (2026-10-05,: the PC's
                // sign-in session was disconnected, Windows had dropped every audio device from it, and the browser played into nothing - the
                // phone could only say "the PC is sending silence"). {device: name | null}; the page says what null means.
                if (method == "GET" && path == "/audio/device")
                {
                    if (!Paired(token)) { await WriteAsync(stream, 401, "{}", "application/json"); return; }
                    string? name = null;
                    try { using var en = new NAudio.CoreAudioApi.MMDeviceEnumerator(); using var dev = en.GetDefaultAudioEndpoint(NAudio.CoreAudioApi.DataFlow.Render, NAudio.CoreAudioApi.Role.Multimedia); name = dev.FriendlyName; }
                    catch { name = null; }
                    // the session left behind by a remote desktop, and whether the media hub switch would bring it back (docs/features/media-hub.md)
                    var disconnected = MediaHub.SessionDisconnected();
                    var keep = await MediaHub.RefreshAsync();
                    if (disconnected && name is null) _log("audio device asked: none, this session is disconnected (keep the console " + (keep ? "on" : "off") + ")");
                    await WriteAsync(stream, 200, JsonSerializer.Serialize(new { ok = true, device = name, session = disconnected ? "disconnected" : "connected", keepConsole = keep }), "application/json"); return;
                }
                // a service's mark for the phone's cards (2026-10-14): the PC's own cached mark, by app id; nothing leaves the machine
                if (method == "GET" && path == "/remote/mark")
                {
                    var app = ""; foreach (var kv in query.Split('&', StringSplitOptions.RemoveEmptyEntries)) { var eq = kv.IndexOf('='); if (eq > 0 && kv[..eq] == "app") app = WebUtility.UrlDecode(kv[(eq + 1)..]); }
                    var mk = MarkOf is { } mo && app.Length > 0 ? await mo(app) : (null, null);
                    if (mk.bytes is { Length: > 0 } mb) { await WriteBytesAsync(stream, 200, mb, mk.mime ?? "image/png"); return; }
                    await WriteAsync(stream, 404, "{}", "application/json"); return;
                }
                // the home-screen icons (docs/features/companion-install.md, 2026-10-05): 180 for iOS's touch icon, 192 and 512 for the manifest,
                // the maskable 512 on the page's dark surface; all derived from the brand mark by scripts/brand-icons.py
                if (method == "GET" && IconFile(path) is { } file)
                {
                    if (File.Exists(file)) { await WriteBytesAsync(stream, 200, await File.ReadAllBytesAsync(file), "image/png"); return; }
                    await WriteAsync(stream, 404, "{}", "application/json"); return;
                }
                if (method == "GET" && path == "/remote/manifest.json") { await WriteAsync(stream, 200, ManifestJson(token, query.Contains("classic=1")), "application/manifest+json"); return; }
                if (method == "GET" && path == "/audio/clock")
                {   // the stream's clock for the ticket that opened it (ListenStream.Clock, 2026-10-31 evening): every listener holds a fixed distance behind it
                    var tk = ""; foreach (var kv in query.Split('&', StringSplitOptions.RemoveEmptyEntries)) if (kv.StartsWith("ticket=", StringComparison.Ordinal)) tk = WebUtility.UrlDecode(kv[7..]);
                    var cj = Listen?.Clock(tk);
                    if (cj is null) { await WriteAsync(stream, 404, "{\"error\":\"no stream of that ticket runs\"}", "application/json"); return; }
                    await WriteAsync(stream, 200, cj, "application/json"); return;
                }
                if (path == "/audio/live.mp3")
                {
                    // the live MP3 (ListenStream.ServeMp3Async): a phone's own player fetches it and keeps playing in the background
                    if (Listen is null) { await WriteAsync(stream, 501, "{\"error\":\"no listening on this host\"}", "application/json"); return; }
                    client.ReceiveTimeout = 0;
                    await Listen.ServeMp3Async(stream, query);
                    return;
                }
                if (path == "/viz/bands")
                {
                    // the WebSocket of the lounge's bands (48 a frame as bytes, 30 a second) to a paired phone, for as long as its visual is open
                    if (Bands is null || !headers.TryGetValue("Upgrade", out var upb) || !upb.Equals("websocket", StringComparison.OrdinalIgnoreCase)) { await WriteAsync(stream, 501, "{\"error\":\"no visual bands on this host\"}", "application/json"); return; }
                    var btok = ""; var bticket = ""; foreach (var kv in query.Split('&', StringSplitOptions.RemoveEmptyEntries)) { if (kv.StartsWith("token=", StringComparison.Ordinal)) btok = WebUtility.UrlDecode(kv[6..]); if (kv.StartsWith("ticket=", StringComparison.Ordinal)) bticket = WebUtility.UrlDecode(kv[7..]); }
                    // a paired phone by its token; the listen page by a stream ticket core minted for the house's code (2026-10-31): the code itself is checked in core alone
                    var houseWho = bticket.Length > 0 && Listen is { } lsn ? await lsn.RedeemAsync(bticket) : "";
                    var bandsOk = Paired(btok) || houseWho.StartsWith("house:", StringComparison.Ordinal);
                    if (!bandsOk || !headers.TryGetValue("Sec-WebSocket-Key", out var bkey)) { await WriteAsync(stream, 401, "{\"error\":\"not a paired phone\"}", "application/json"); return; }
                    client.ReceiveTimeout = 0;
                    await ServeBandsAsync(stream, bkey, () => btok.Length > 0 ? Paired(btok) : (Listen?.StillOk?.Invoke(houseWho) ?? true));   // asked again every two seconds: a switch gone off, a code replaced, a phone forgotten, closes it
                    return;
                }
                if (path == "/audio/stream")
                {
                    // the WebSocket of the wall's sound (ListenStream): the socket is held for as long as the phone listens
                    if (Listen is null || !headers.TryGetValue("Upgrade", out var up) || !up.Equals("websocket", StringComparison.OrdinalIgnoreCase)) { await WriteAsync(stream, 501, "{\"error\":\"private listening is a WebSocket at /audio/stream?ticket=\"}", "application/json"); return; }
                    client.ReceiveTimeout = 0;
                    await Listen.ServeAsync(stream, headers, query);
                    return;
                }

                var id = Interlocked.Increment(ref _nextId);
                var tcs = new TaskCompletionSource<(int, string, string)>(TaskCreationOptions.RunContinuationsAsynchronously);
                _pending[id] = tcs;
                var ua = headers.TryGetValue("User-Agent", out var uaS) ? uaS : null;
                string? clientAddr = null; try { clientAddr = (client.Client.RemoteEndPoint as System.Net.IPEndPoint)?.Address.ToString(); } catch { }
                var requestJson = PrismHost.Channel.ChannelParser.PhoneRequestJson(method, path, query, body, token, ua, client: clientAddr);   // B-218: an OAuth redirect's code and state ride the query
                // the log's copy has no body: it can be text typed on the phone or the person's TMDB key (2026-10-10)
                _dispatch(id, requestJson, PrismHost.Channel.ChannelParser.PhoneRequestJson(method, path, query, body, token, ua, forLog: true));
                var done = await Task.WhenAny(tcs.Task, Task.Delay(15000));
                if (done != tcs.Task) { _pending.TryRemove(id, out _); await WriteAsync(stream, 504, "{\"error\":\"core did not answer\"}", "application/json"); return; }
                var (status, rbody, ctype) = tcs.Task.Result;
                await WriteAsync(stream, status, rbody, ctype);
            }
            catch (Exception ex) { _log("remote request failed: " + ex.Message); }
        }
    }

    /// <summary>The bands socket (see Bands): one binary frame every 33 ms until the phone closes it or the connection drops; the FFT's
    /// capture is held for the socket's life. Read only to see it close, like the listen socket.</summary>
    private async Task ServeBandsAsync(NetworkStream stream, string key, Func<bool>? stillOk = null)
    {
        var frames = 0;
        var accept = Convert.ToBase64String(System.Security.Cryptography.SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n"));
        var closed = false;
        _ = Task.Run(async () =>
        {
            var buf = new byte[256];
            try { while (!closed) { var n = await stream.ReadAsync(buf); if (n <= 0 || (buf[0] & 0x0F) == 0x8) break; } } catch { }
            closed = true;
        });
        BandsDemand?.Invoke(true);
        _log("viz bands: a phone's visual opened");
        try
        {
            while (!closed)
            {
                var bands = Bands?.Invoke(48) ?? Array.Empty<float>();
                var frame = new byte[2 + bands.Length];
                frame[0] = 0x82; frame[1] = (byte)bands.Length;   // one final binary frame, its payload under 126 bytes
                for (var i = 0; i < bands.Length; i++) frame[2 + i] = (byte)Math.Clamp((int)Math.Round(bands[i] * 255f), 0, 255);
                await stream.WriteAsync(frame);
                await Task.Delay(33);
                if (++frames % 60 == 0 && stillOk is { } ok && !ok()) break;   // the key no longer stands (2026-10-31)
            }
        }
        catch { }
        finally { closed = true; BandsDemand?.Invoke(false); _log("viz bands: a phone's visual closed"); }
    }

    /// <summary>The home-screen manifest: its start address keeps the phone's token, so the icon opens PRISM already paired. Shared with
    /// the phone launcher (PhoneLauncher), which answers at the same address while PRISM is closed.</summary>
    /// <summary>The manifest carries an explicit id (B-446, 2026-10-28): with two home-screen web apps on a phone, iOS opened the other one
    /// from the Now Playing control while PRISM played (WebKit bug 267810); a reader there found an explicit "id" in the playing app's manifest
    /// sets it right, read at install, so the app must be removed from the home screen and added again to take it.</summary>
    internal const string ManifestId = "prism-companion";
    internal static string ManifestJson(string? token, bool classic)
    {
        var start = "/remote" + (token is { Length: > 0 } ? "?token=" + WebUtility.UrlEncode(token) : "");
        return classic
            ? JsonSerializer.Serialize(new { name = "PRISM", short_name = "PRISM", id = ManifestId, start_url = start, scope = "/remote", display = "standalone", background_color = "#14171C", theme_color = "#14171C", icons = new[] { new { src = "/remote/icon.png", sizes = "128x128", type = "image/png" } } })
            : JsonSerializer.Serialize(new { name = "PRISM", short_name = "PRISM", id = ManifestId, start_url = start, scope = "/remote", display = "standalone", background_color = "#14171C", theme_color = "#14171C", icons = new object[] {
            new { src = "/remote/icon.png", sizes = "128x128", type = "image/png" },
            new { src = "/remote/icon-192.png", sizes = "192x192", type = "image/png" },
            new { src = "/remote/icon-512.png", sizes = "512x512", type = "image/png" },
            new { src = "/remote/icon-512-maskable.png", sizes = "512x512", type = "image/png", purpose = "maskable" } } });
    }

    /// <summary>The file behind one of the page's icon addresses, or null for any other path.</summary>
    internal static string? IconFile(string path) => path switch
    {
        "/remote/icon.png" => Path.Combine(AppContext.BaseDirectory, "Assets", "prism-icon.png"),
        "/remote/icon-180.png" or "/remote/icon-192.png" or "/remote/icon-512.png" or "/remote/icon-512-maskable.png" => Path.Combine(AppContext.BaseDirectory, "Assets", "prism-" + path["/remote/".Length..]),
        _ => null,
    };

    internal static async Task<(string? head, byte[] rest)> ReadHeadAsync(NetworkStream s, CancellationToken ct)
    {
        var buf = new MemoryStream();
        var tmp = new byte[4096];
        while (buf.Length < 64 * 1024)
        {
            var n = await s.ReadAsync(tmp, ct);
            if (n <= 0) break;
            buf.Write(tmp, 0, n);
            var arr = buf.ToArray();
            var idx = IndexOf(arr, "\r\n\r\n"u8.ToArray());
            if (idx >= 0) return (Encoding.ASCII.GetString(arr, 0, idx), arr[(idx + 4)..]);
        }
        return (null, Array.Empty<byte>());
    }

    internal static async Task<string> ReadBodyAsync(NetworkStream s, byte[] have, int len, CancellationToken ct)
    {
        if (len <= 0) return "";
        var ms = new MemoryStream(); ms.Write(have);
        var tmp = new byte[4096];
        while (ms.Length < len) { var n = await s.ReadAsync(tmp, ct); if (n <= 0) break; ms.Write(tmp, 0, n); }
        var arr = ms.ToArray();
        return Encoding.UTF8.GetString(arr, 0, Math.Min(len, arr.Length));
    }

    private static int IndexOf(byte[] hay, byte[] needle)
    {
        for (var i = 0; i <= hay.Length - needle.Length; i++)
        {
            var ok = true;
            for (var j = 0; j < needle.Length; j++) if (hay[i + j] != needle[j]) { ok = false; break; }
            if (ok) return i;
        }
        return -1;
    }

    internal static Task WriteAsync(NetworkStream s, int status, string body, string contentType) => WriteBytesAsync(s, status, Encoding.UTF8.GetBytes(body), contentType);
    internal static async Task WriteBytesAsync(NetworkStream s, int status, byte[] bytes, string contentType)
    {
        var reason = status switch { 200 => "OK", 204 => "No Content", 400 => "Bad Request", 401 => "Unauthorized", 404 => "Not Found", 409 => "Conflict", 501 => "Not Implemented", 504 => "Gateway Timeout", _ => "Status" };
        var head = $"HTTP/1.1 {status} {reason}\r\nContent-Type: {contentType}\r\nContent-Length: {bytes.Length}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        await s.WriteAsync(Encoding.ASCII.GetBytes(head));
        if (bytes.Length > 0) await s.WriteAsync(bytes);
    }

    // the animated wordmark where the header's name is (docs/features/animated-wordmark.md, 2026-10-04): core's snippet from Assets/brain,
    // read once; without the file the header keeps its plain name, so an old build or a fresh clone still serves the page
    private static readonly string Wordmark = ReadWordmark();
    private static string ReadWordmark()
    {
        try { var p = Path.Combine(AppContext.BaseDirectory, "Assets", "brain", "prism-wordmark.html"); if (File.Exists(p)) { var s = File.ReadAllText(p).Trim(); if (s.Length > 0) return s; } } catch { }
        return "<b>PRISM</b>";
    }
    /// <summary>The catalog's services as the page lists them (2026-10-11): [{id, name, kind}], set by the host once the catalog is read.</summary>
    public static volatile string ServicesJson = "[]";
    // the version first (a static field is set in declaration order): the page carries its own version, so it knows at once whether the PC
    // has moved on, whatever its first check returned (2026-10-14)
    private static readonly string PageVersion = Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(Encoding.UTF8.GetBytes(Services.RemotePage.Html + Services.VizScene.Js + Services.ListenPage.Html + AppVersion.Text))).ToLowerInvariant()[..12];
    private static readonly string PageHtml = Services.RemotePage.Html.Replace("__VIZ_SCENE__", Services.VizScene.Js).Replace("__LISTEN_PLAYER__", Services.ListenPlayer.Js).Replace("__WORDMARK__", Wordmark).Replace("__VERSION__", PageVersion);
    // the listen page with the same scene (2026-10-31); its key goes in at serve time
    private static readonly string ListenHtml = Services.ListenPage.Html.Replace("__VIZ_SCENE__", Services.VizScene.Js).Replace("__LISTEN_PLAYER__", Services.ListenPlayer.Js);
    /// <summary>Two seconds of silence as a WAV (8 kHz, 8-bit, mono): the Echo Show's Silk leaves a page after idle minutes unless a sound is
    /// loaded afresh now and then (2026-10-31; the listen page plays this every minute on Silk).</summary>
    private static readonly byte[] SilenceWav = MakeSilenceWav(2);
    private static byte[] MakeSilenceWav(int seconds)
    {
        const int rate = 8000; var data = rate * seconds; var b = new byte[44 + data];
        void U32(int at, uint v) { b[at] = (byte)v; b[at + 1] = (byte)(v >> 8); b[at + 2] = (byte)(v >> 16); b[at + 3] = (byte)(v >> 24); }
        void U16(int at, ushort v) { b[at] = (byte)v; b[at + 1] = (byte)(v >> 8); }
        Encoding.ASCII.GetBytes("RIFF").CopyTo(b, 0); U32(4, (uint)(36 + data)); Encoding.ASCII.GetBytes("WAVE").CopyTo(b, 8);
        Encoding.ASCII.GetBytes("fmt ").CopyTo(b, 12); U32(16, 16); U16(20, 1); U16(22, 1); U32(24, rate); U32(28, rate); U16(32, 1); U16(34, 8);
        Encoding.ASCII.GetBytes("data").CopyTo(b, 36); U32(40, (uint)data);
        for (var i = 44; i < b.Length; i++) b[i] = 128;   // 8-bit WAV: silence is the midpoint
        return b;
    }

    public void Dispose() { _stopped = true; try { _listener.Stop(); } catch { } }
}
