using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace PrismMusicPoc;

/// <summary>
/// A tiny loopback HTTP server for the harness's own pages. EME refuses opaque
/// origins ("EME use is not allowed on unique origins" on file://), and
/// http://127.0.0.1 is a secure context, so the local probe pages get a real
/// origin here - the same origin in WebView2 and in headless Edge.
/// Serves only files from the harness output directory; loopback only.
/// </summary>
public sealed class LocalServer : IDisposable
{
    private readonly TcpListener _listener;
    private readonly string _root;
    private bool _stopped;
    private readonly TaskCompletionSource<bool> _resultArrived = new(TaskCreationOptions.RunContinuationsAsynchronously);
    /// <summary>The JSON a probe page POSTed to /result, once it has.</summary>
    public string? Result { get; private set; }
    public Task WaitForResultAsync(int timeoutMs) => Task.WhenAny(_resultArrived.Task, Task.Delay(timeoutMs));
    public int Port { get; }
    public string BaseUrl => $"http://127.0.0.1:{Port}/";

    public LocalServer(string root)
    {
        _root = root;
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _ = Task.Run(AcceptLoop);
    }

    private async Task AcceptLoop()
    {
        while (!_stopped)
        {
            TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(); } catch { break; }
            _ = Task.Run(() => Serve(client));
        }
    }

    private async Task Serve(TcpClient client)
    {
        using (client)
        {
            try
            {
                using var stream = client.GetStream();
                var buf = new byte[8192];
                var n = await stream.ReadAsync(buf);
                var request = Encoding.UTF8.GetString(buf, 0, n);
                var headEnd = request.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                var line = request.Split("\r\n")[0].Split(' ');
                var method = line[0];
                var path = line.Length > 1 ? line[1] : "/";
                var q = path.IndexOf('?'); if (q >= 0) path = path[..q];
                if (path == "/") path = "/probe.html";
                byte[] body; string status = "200 OK"; string type = "text/plain";
                if (method == "POST" && path == "/result")
                {
                    // the page delivers its JSON here; read to Content-Length
                    var len = 0;
                    foreach (var h in request[..Math.Max(0, headEnd)].Split("\r\n"))
                        if (h.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) len = int.Parse(h[15..].Trim());
                    var have = Encoding.UTF8.GetBytes(request[(headEnd + 4)..]);
                    var ms = new MemoryStream(); ms.Write(have);
                    while (ms.Length < len) { var m = await stream.ReadAsync(buf); if (m <= 0) break; ms.Write(buf, 0, m); }
                    Result = Encoding.UTF8.GetString(ms.ToArray());
                    _resultArrived.TrySetResult(true);
                    body = Encoding.UTF8.GetBytes("ok");
                }
                else if (path == "/hold")
                {
                    // an <img src="/hold"> keeps the page's load event open until the result is
                    // in (or 90 s), so a headless --dump-dom cannot fire before the probe ends
                    await Task.WhenAny(_resultArrived.Task, Task.Delay(90000));
                    body = Array.Empty<byte>(); status = "404 Not Found";
                }
                else
                {
                    var name = Path.GetFileName(path);                        // no directories, no traversal
                    var file = Path.Combine(_root, name);
                    if (File.Exists(file) && (name.EndsWith(".html") || name.EndsWith(".js")))
                    {
                        body = await File.ReadAllBytesAsync(file);
                        type = name.EndsWith(".html") ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8";
                    }
                    else { body = Encoding.UTF8.GetBytes("not found"); status = "404 Not Found"; }
                }
                var head = $"HTTP/1.1 {status}\r\nContent-Type: {type}\r\nContent-Length: {body.Length}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
                await stream.WriteAsync(Encoding.ASCII.GetBytes(head));
                await stream.WriteAsync(body);
            }
            catch { }
        }
    }

    public void Dispose() { _stopped = true; try { _listener.Stop(); } catch { } }
}
