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

    /// <summary>Whether a token is a paired phone's (the routes the host answers itself ask this; every other route is core's, which checks
    /// the pairing itself). Unset, those routes refuse every token (2026-10-05 review: they had taken any non-empty string).</summary>
    public Func<string, bool>? TokenOk { get; set; }
    private bool Paired(string? token) => token is { Length: > 0 } && TokenOk is { } ok && ok(token);

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

    // B-385 (2026-10-18, "I can't connect with the companion app again"): the accept loop ended on one failed accept (Windows fails an
    // accept with "connection reset" when the phone drops the connection before Prism takes it) and the listener socket stayed bound, so
    // every phone connection completed in the kernel's backlog and was never answered - the page spun until Prism was restarted. The
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
                        if (!Rebind()) { _log("remote accept: could not rebind port " + Port + ", the phone page is down until Prism restarts"); return; }
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
                    // head=classic (2026-10-05, a bisect for iOS: "I still don't have the button to add to my Home Screen"): the page as it was before the
                    // install nudge's head additions - no status-bar style, the 128 px touch icon, the one-icon manifest - so the two can be compared on the phone
                    if (query.Contains("head=classic"))
                    {
                        html = html.Replace("<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">", "")
                                   .Replace("<link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"/remote/icon-180.png\">", "<link rel=\"apple-touch-icon\" href=\"/remote/icon.png\">")
                                   .Replace("/remote/manifest.json?token=", "/remote/manifest.json?classic=1&token=");
                    }
                    await WriteAsync(stream, 200, html, "text/html; charset=utf-8"); return;
                }   // the token into the manifest link: a home-screen app opens paired
                // the page's icon and manifest (2026-10-04, "when added to the home screen should show Prism's icon"): Prism's own mark; the
                // manifest's start address keeps the phone's token so the home-screen icon opens the wall already paired
                // the page's version (2026-10-04, "a 5 min refresh banner"): a hash of the page as this host serves it; the page asks each minute
                if (method == "GET" && path == "/remote/version") { await WriteAsync(stream, 200, "{\"v\":\"" + PageVersion + "\"}", "application/json"); return; }
                // the phone's own audio state while it listens (2026-10-05, "Still no sound"): one line in host.log so the two sides can be read together;
                // the page's words alone, with a paired token, on the home network - nothing leaves the house
                if (method == "POST" && path == "/remote/diag")
                {
                    if (!Paired(token)) { await WriteAsync(stream, 401, "{}", "application/json"); return; }
                    _log("phone diag: " + (body.Length > 600 ? body[..600] : body));
                    await WriteAsync(stream, 200, "{\"ok\":true}", "application/json"); return;
                }
                // the PC's playback device, asked by a phone that hears silence (2026-10-05, "Remote listening isn't working right now": the PC's
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
                if (path == "/audio/live.mp3")
                {
                    // the live MP3 (ListenStream.ServeMp3Async): a phone's own player fetches it and keeps playing in the background
                    if (Listen is null) { await WriteAsync(stream, 501, "{\"error\":\"no listening on this host\"}", "application/json"); return; }
                    client.ReceiveTimeout = 0;
                    await Listen.ServeMp3Async(stream, query);
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
                var requestJson = PrismHost.Channel.ChannelParser.PhoneRequestJson(method, path, query, body, token, ua);   // B-218: an OAuth redirect's code and state ride the query
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

    /// <summary>The home-screen manifest: its start address keeps the phone's token, so the icon opens Prism already paired. Shared with
    /// the phone launcher (PhoneLauncher), which answers at the same address while Prism is closed.</summary>
    internal static string ManifestJson(string? token, bool classic)
    {
        var start = "/remote" + (token is { Length: > 0 } ? "?token=" + WebUtility.UrlEncode(token) : "");
        return classic
            ? JsonSerializer.Serialize(new { name = "Prism", short_name = "Prism", start_url = start, scope = "/remote", display = "standalone", background_color = "#14171C", theme_color = "#14171C", icons = new[] { new { src = "/remote/icon.png", sizes = "128x128", type = "image/png" } } })
            : JsonSerializer.Serialize(new { name = "Prism", short_name = "Prism", start_url = start, scope = "/remote", display = "standalone", background_color = "#14171C", theme_color = "#14171C", icons = new object[] {
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
        return "<b>Prism</b>";
    }
    /// <summary>The catalog's services as the page lists them (2026-10-11): [{id, name, kind}], set by the host once the catalog is read.</summary>
    public static volatile string ServicesJson = "[]";
    // the version first (a static field is set in declaration order): the page carries its own version, so it knows at once whether the PC
    // has moved on, whatever its first check returned (2026-10-14)
    private static readonly string PageVersion = Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(Encoding.UTF8.GetBytes(Services.RemotePage.Html + AppVersion.Text))).ToLowerInvariant()[..12];
    private static readonly string PageHtml = Services.RemotePage.Html.Replace("__WORDMARK__", Wordmark).Replace("__VERSION__", PageVersion);

    public void Dispose() { _stopped = true; try { _listener.Stop(); } catch { } }
}
