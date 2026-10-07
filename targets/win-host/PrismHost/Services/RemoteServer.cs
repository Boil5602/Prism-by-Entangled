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
    private readonly TcpListener _listener;
    private readonly Action<int, string> _dispatch;                 // (requestId, requestJson) → PrismRuntime.http
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

    public RemoteServer(int port, Action<int, string> dispatch, Action<string> log)
    {
        _dispatch = dispatch;
        _log = log;
        _listener = new TcpListener(IPAddress.Any, port);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _ = Task.Run(AcceptLoop);
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

    private async Task AcceptLoop()
    {
        while (!_stopped)
        {
            TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(); } catch { break; }
            _ = Task.Run(() => ServeAsync(client));
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
                var (head, bodyStart) = await ReadHeadAsync(stream);
                if (head is null) return;
                var lines = head.Split("\r\n");
                var reqLine = lines[0].Split(' ');
                if (reqLine.Length < 2) return;
                var method = reqLine[0].ToUpperInvariant();
                var target = reqLine[1];
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var l in lines.Skip(1)) { var i = l.IndexOf(':'); if (i > 0) headers[l[..i].Trim()] = l[(i + 1)..].Trim(); }
                var len = headers.TryGetValue("Content-Length", out var cl) && int.TryParse(cl, out var n) ? n : 0;
                var body = await ReadBodyAsync(stream, bodyStart, len);
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
                    var html = PageHtml.Replace("__TOKEN__", WebUtility.UrlEncode(token ?? ""));
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
                if (method == "GET" && path == "/remote/icon.png")
                {
                    var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "prism-icon.png");
                    if (File.Exists(icon)) { await WriteBytesAsync(stream, 200, await File.ReadAllBytesAsync(icon), "image/png"); return; }
                    await WriteAsync(stream, 404, "{}", "application/json"); return;
                }
                // the home-screen icons (docs/features/companion-install.md, 2026-10-05): 180 for iOS's touch icon, 192 and 512 for the manifest,
                // the maskable 512 on the page's dark surface; all derived from the brand mark by scripts/brand-icons.py
                if (method == "GET" && (path == "/remote/icon-180.png" || path == "/remote/icon-192.png" || path == "/remote/icon-512.png" || path == "/remote/icon-512-maskable.png"))
                {
                    var file = Path.Combine(AppContext.BaseDirectory, "Assets", "prism-" + path["/remote/".Length..]);
                    if (File.Exists(file)) { await WriteBytesAsync(stream, 200, await File.ReadAllBytesAsync(file), "image/png"); return; }
                    await WriteAsync(stream, 404, "{}", "application/json"); return;
                }
                if (method == "GET" && path == "/remote/manifest.json")
                {
                    var start = "/remote" + (token is { Length: > 0 } ? "?token=" + WebUtility.UrlEncode(token) : "");
                    var classic = query.Contains("classic=1");
                    var manifest = classic
                        ? JsonSerializer.Serialize(new { name = "Prism", short_name = "Prism", start_url = start, scope = "/remote", display = "standalone", background_color = "#14171C", theme_color = "#14171C", icons = new[] { new { src = "/remote/icon.png", sizes = "128x128", type = "image/png" } } })
                        : JsonSerializer.Serialize(new { name = "Prism", short_name = "Prism", start_url = start, scope = "/remote", display = "standalone", background_color = "#14171C", theme_color = "#14171C", icons = new object[] {
                        new { src = "/remote/icon.png", sizes = "128x128", type = "image/png" },
                        new { src = "/remote/icon-192.png", sizes = "192x192", type = "image/png" },
                        new { src = "/remote/icon-512.png", sizes = "512x512", type = "image/png" },
                        new { src = "/remote/icon-512-maskable.png", sizes = "512x512", type = "image/png", purpose = "maskable" } } });
                    await WriteAsync(stream, 200, manifest, "application/manifest+json"); return;
                }
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
                var requestJson = JsonSerializer.Serialize(new { method, path, query = query.Length == 0 ? null : query, body = body.Length == 0 ? null : body, token, userAgent = headers.TryGetValue("User-Agent", out var uaS) ? uaS : null });   // B-218: an OAuth redirect's code and state ride the query
                _dispatch(id, requestJson);
                var done = await Task.WhenAny(tcs.Task, Task.Delay(15000));
                if (done != tcs.Task) { _pending.TryRemove(id, out _); await WriteAsync(stream, 504, "{\"error\":\"core did not answer\"}", "application/json"); return; }
                var (status, rbody, ctype) = tcs.Task.Result;
                await WriteAsync(stream, status, rbody, ctype);
            }
            catch (Exception ex) { _log("remote request failed: " + ex.Message); }
        }
    }

    private static async Task<(string? head, byte[] rest)> ReadHeadAsync(NetworkStream s)
    {
        var buf = new MemoryStream();
        var tmp = new byte[4096];
        while (buf.Length < 64 * 1024)
        {
            var n = await s.ReadAsync(tmp);
            if (n <= 0) break;
            buf.Write(tmp, 0, n);
            var arr = buf.ToArray();
            var idx = IndexOf(arr, "\r\n\r\n"u8.ToArray());
            if (idx >= 0) return (Encoding.ASCII.GetString(arr, 0, idx), arr[(idx + 4)..]);
        }
        return (null, Array.Empty<byte>());
    }

    private static async Task<string> ReadBodyAsync(NetworkStream s, byte[] have, int len)
    {
        if (len <= 0) return "";
        var ms = new MemoryStream(); ms.Write(have);
        var tmp = new byte[4096];
        while (ms.Length < len) { var n = await s.ReadAsync(tmp); if (n <= 0) break; ms.Write(tmp, 0, n); }
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

    private static Task WriteAsync(NetworkStream s, int status, string body, string contentType) => WriteBytesAsync(s, status, Encoding.UTF8.GetBytes(body), contentType);
    private static async Task WriteBytesAsync(NetworkStream s, int status, byte[] bytes, string contentType)
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
    private static readonly string PageHtml = Services.RemotePage.Html.Replace("__WORDMARK__", Wordmark);
    private static readonly string PageVersion = Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(Encoding.UTF8.GetBytes(PageHtml + AppVersion.Text))).ToLowerInvariant()[..12];

    public void Dispose() { _stopped = true; try { _listener.Stop(); } catch { } }
}
