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
                if (method == "GET" && path == "/remote") { await WriteAsync(stream, 200, RemotePage, "text/html; charset=utf-8"); return; }
                if (path == "/audio/stream") { await WriteAsync(stream, 501, "{\"error\":\"private listening stream not served by this host yet (§14)\"}", "application/json"); return; }

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

    private static async Task WriteAsync(NetworkStream s, int status, string body, string contentType)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        var reason = status switch { 200 => "OK", 204 => "No Content", 400 => "Bad Request", 401 => "Unauthorized", 404 => "Not Found", 409 => "Conflict", 501 => "Not Implemented", 504 => "Gateway Timeout", _ => "Status" };
        var head = $"HTTP/1.1 {status} {reason}\r\nContent-Type: {contentType}\r\nContent-Length: {bytes.Length}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        await s.WriteAsync(Encoding.ASCII.GetBytes(head));
        if (bytes.Length > 0) await s.WriteAsync(bytes);
    }

    private const string RemotePage = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Prism remote</title>" +
        "<style>body{background:#14171C;color:#F2F4F7;font:15px system-ui;padding:24px;max-width:520px;margin:auto}code{color:#F2B14C}</style>" +
        "<h2>Prism remote</h2><p>This frame is paired. The remote app (build order item 3) is not bundled with this host build yet; the API answers at " +
        "<code>/state</code>, <code>/now-playing</code>, <code>/items/{id}/tap</code>, <code>/items/{id}/action</code>, <code>/scenes/next</code> with your <code>?token=</code>.</p>";

    public void Dispose() { _stopped = true; try { _listener.Stop(); } catch { } }
}
