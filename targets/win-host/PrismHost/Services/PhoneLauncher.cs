using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using PrismHost.Launching;

namespace PrismHost.Services;

/// <summary>
/// The phone launcher (2026-10-23, "Can't launch my companion app remotely right now. Guessing prism is offline. How do we make the
/// companion app work even with prism offline, allow it to open prism even"). The phone's page is served by Prism on port 8471, so with
/// Prism closed the phone had nothing to reach, and a phone browser keeps no page of its own for a plain home-network address (a service
/// worker needs https).
///
/// The launcher is Prism's own exe started with --launcher, by Prism itself at each start, and it stays when Prism closes. It has no
/// window and opens no WebView. (Starting it at Windows sign-in as well, so a PC that has not opened Prism since it started is covered,
/// waits on the person's go-ahead: it is an entry in Windows' startup list.) It is the same exe, so the firewall rule that lets phones reach Prism lets them reach it too.
///   - While Prism runs (its named mutex is held) the launcher only waits.
///   - While Prism is closed it answers on 8471: the phone's address shows "Prism is closed" with an Open Prism button for a paired
///     phone (the pairings core stored, read from disk and never written), and every other route says Prism is closed.
///   - Open Prism gives the port back and starts this exe; the page waits for Prism's own page and loads it.
///   - Prism stopping without closing (the mutex abandoned: a crash) is started again after a short wait, at most three times an
///     hour (RestartBudget). A Prism the person closed stays closed.
/// The PC asleep or off is beyond it: nothing on the PC can answer, and a phone browser cannot wake it.
/// </summary>
public static class PhoneLauncher
{
    public const string Arg = "--launcher";
    private const string HostMutexName = @"Local\PrismHostRunning";
    private const string LauncherMutexName = @"Local\PrismPhoneLauncher";
    private const string QuitEventName = @"Local\PrismPhoneLauncherQuit";
    // PRISM_LAUNCHER_PORT moves only the launcher (a test beside a running Prism); the phone's address is always 8471
    private static readonly int Port = int.TryParse(Environment.GetEnvironmentVariable("PRISM_LAUNCHER_PORT"), out var p) && p > 0 ? p : DeviceSetup.RemotePort;

    // ---------------------------------------------------------------- the host's side

    private static Mutex? _hostRunning;

    /// <summary>At Prism's start, on the UI thread: Prism says it is running, and the launcher is made ready for when it closes - one
    /// started from this exe (one from another copy is stopped first). A run pointed at another data folder (run-fresh) leaves the
    /// launcher alone; turned off (enabled false), a running one is stopped.</summary>
    public static void HostStarted(bool enabled, bool dataDirOverridden, Action<string> log)
    {
        try
        {
            _hostRunning = new Mutex(true, HostMutexName, out var created);
            if (!created) { try { _hostRunning.WaitOne(3000); } catch (AbandonedMutexException) { } }
        }
        catch (Exception ex) { log("phone launcher: the running mark failed (" + ex.Message + ")"); }
        if (dataDirOverridden) return;
        var exe = Environment.ProcessPath ?? "";
        if (!enabled) { StopRunning(log); return; }
        _ = Task.Run(() =>
        {
            try
            {
                if (RunningLauncherExe() is { } other)
                {
                    if (string.Equals(other, exe, StringComparison.OrdinalIgnoreCase)) return;
                    log("phone launcher: the running one is another copy's, started again from this one");
                    StopRunning(log);
                }
                var psi = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) };
                psi.ArgumentList.Add(Arg);
                using var _p = Process.Start(psi);
                log("phone launcher: started");
            }
            catch (Exception ex) { log("phone launcher: could not start (" + ex.Message + ")"); }
        });
    }

    /// <summary>At Prism's close, on the UI thread, after the phone listener has let go of the port: the running mark goes, so the
    /// launcher knows this was a close and not a crash.</summary>
    public static void HostClosing()
    {
        try { _hostRunning?.ReleaseMutex(); } catch { }
    }

    /// <summary>The exe the running launcher was started from, or null when none runs.</summary>
    private static string? RunningLauncherExe()
    {
        if (!Mutex.TryOpenExisting(LauncherMutexName, out var m)) return null;
        m.Dispose();
        try { var j = JsonDocument.Parse(File.ReadAllText(InfoFile)); return j.RootElement.GetProperty("exe").GetString(); }
        catch { return ""; }
    }

    /// <summary>Asks a running launcher to leave and waits for it (five seconds, then it is stopped): before an update or a reset moves
    /// the files it runs from. Safe to call with none running.</summary>
    public static void StopRunning(Action<string> log)
    {
        try
        {
            if (!Mutex.TryOpenExisting(LauncherMutexName, out var m)) return;
            m.Dispose();
            if (EventWaitHandle.TryOpenExisting(QuitEventName, out var quit)) { using (quit) quit.Set(); }
            for (var i = 0; i < 50; i++)
            {
                if (!Mutex.TryOpenExisting(LauncherMutexName, out var still)) { log("phone launcher: stopped"); return; }
                still.Dispose();
                Thread.Sleep(100);
            }
            try
            {
                var pid = JsonDocument.Parse(File.ReadAllText(InfoFile)).RootElement.GetProperty("pid").GetInt32();
                using var p = Process.GetProcessById(pid);
                if (p.ProcessName.Equals("PrismHost", StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(3000); log("phone launcher: did not leave when asked, stopped"); }
            }
            catch { }
        }
        catch (Exception ex) { log("phone launcher: stop failed (" + ex.Message + ")"); }
    }

    // ---------------------------------------------------------------- the launcher's side

    /// <summary>The data folder as HostPaths names it, without HostPaths: its first use applies a pending reset or restore, which belongs
    /// to Prism's own start, never to the launcher.</summary>
    private static string DataDir
    {
        get
        {
            var env = Environment.GetEnvironmentVariable("PRISM_DATA_DIR");
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Prism");
            if (!string.IsNullOrWhiteSpace(env)) { try { dir = Path.GetFullPath(env.Trim()); } catch { } }
            return dir;
        }
    }
    private static string InfoFile => Path.Combine(DataDir, "diagnostics", "launcher.json");

    private static readonly object Gate = new();
    private static TcpListener? _listener;
    private static Process? _opened;          // the Prism this launcher started, until it takes the running mark
    private static DateTime _openedAt;
    private static readonly RestartBudget Restarts = new();
    private static EventWaitHandle? _quit;

    /// <summary>The launcher's life: one per sign-in session, until asked to leave.</summary>
    public static void Run()
    {
        using var mine = new Mutex(true, LauncherMutexName, out var created);
        if (!created) return;
        _quit = new EventWaitHandle(false, EventResetMode.ManualReset, QuitEventName);
        _quit.Reset();
        try
        {
            Directory.CreateDirectory(Path.Combine(DataDir, "diagnostics"));
            File.WriteAllText(InfoFile, JsonSerializer.Serialize(new { pid = Environment.ProcessId, exe = Environment.ProcessPath, at = DateTime.Now.ToString("o") }));
        }
        catch { }
        Log("launcher " + AppVersion.Text + " running");
        try { Watch(); }
        finally
        {
            Unbind();
            try { mine.ReleaseMutex(); } catch { }
            Log("launcher leaving");
        }
    }

    /// <summary>Prism up: wait on its mark. Prism down: hold the port for the phone. A mark abandoned is a crash.</summary>
    private static void Watch()
    {
        while (!_quit!.WaitOne(0))
        {
            var crashed = false;
            if (Mutex.TryOpenExisting(HostMutexName, out var host))
            {
                var waited = false;
                using (host)
                {
                    var owned = false;
                    try { owned = !host.WaitOne(0); if (!owned) host.ReleaseMutex(); }
                    catch (AbandonedMutexException) { try { host.ReleaseMutex(); } catch { } }   // found abandoned at a look: not this launcher's to restart
                    if (owned)
                    {
                        Unbind();
                        lock (Gate) _opened = null;
                        waited = true;
                        try
                        {
                            var i = WaitHandle.WaitAny(new WaitHandle[] { host, _quit });
                            if (i == 0) host.ReleaseMutex();
                            else return;
                        }
                        catch (AbandonedMutexException) { crashed = true; try { host.ReleaseMutex(); } catch { } }
                        Log(crashed ? "Prism stopped without closing" : "Prism closed");
                    }
                }
                // after the handle is let go: while the launcher holds one, the mark it checks for a Prism that came back still exists
                if (crashed) RestartAfterCrash();
                if (waited) continue;
            }
            // Prism is not running: the port is the launcher's, unless a Prism it started is still on its way up (three minutes at most)
            bool starting;
            lock (Gate) starting = _opened is { } p && !HasExited(p) && DateTime.Now - _openedAt < TimeSpan.FromMinutes(3);
            if (starting) Unbind(); else Bind();
            _quit.WaitOne(1000);
        }
    }

    private static bool HasExited(Process p) { try { return p.HasExited; } catch { return true; } }

    /// <summary>A crash: fifteen seconds for whatever restarts Prism itself (an update, a restart, a person), then Prism is started
    /// again if nothing else did, within the budget.</summary>
    private static void RestartAfterCrash()
    {
        if (_quit!.WaitOne(15_000)) return;
        if (Mutex.TryOpenExisting(HostMutexName, out var back)) { back.Dispose(); return; }
        var me = Environment.ProcessId;
        if (Process.GetProcessesByName("PrismHost").Any(p => { using (p) return p.Id != me; })) { Log("another Prism process is running; not started again"); return; }
        if (!Restarts.TryTake(DateTime.Now)) { Log("Prism stopped " + Restarts.Max + " times this hour; left closed"); return; }
        OpenPrism("after it stopped");
    }

    /// <summary>Starts Prism from this exe; the port is given back first so Prism's own listener can take it.</summary>
    private static bool OpenPrism(string why)
    {
        lock (Gate)
        {
            if (_opened is { } p && !HasExited(p) && DateTime.Now - _openedAt < TimeSpan.FromMinutes(3)) return true;   // already on its way
            Unbind();
            try
            {
                var exe = Environment.ProcessPath!;
                var psi = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) };
                _opened = Process.Start(psi);
                _openedAt = DateTime.Now;
                Log("Prism opened " + why);
                return _opened is not null;
            }
            catch (Exception ex) { Log("Prism could not be opened: " + ex.Message); return false; }
        }
    }

    private static void Bind()
    {
        lock (Gate)
        {
            if (_listener is not null) return;
            try
            {
                var l = new TcpListener(IPAddress.Any, Port);
                l.Start();
                _listener = l;
                Log("answering the phone on port " + Port);
                _ = Task.Run(() => AcceptLoop(l));
            }
            catch (SocketException) { /* still held (Prism letting go, or another program): tried again each second */ }
        }
    }

    private static void Unbind()
    {
        lock (Gate)
        {
            if (_listener is null) return;
            try { _listener.Stop(); } catch { }
            _listener = null;
            Log("port " + Port + " given back");
        }
    }

    private static async Task AcceptLoop(TcpListener l)
    {
        var failures = 0;
        while (true)
        {
            lock (Gate) if (_listener != l) return;
            TcpClient c;
            try { c = await l.AcceptTcpClientAsync(); failures = 0; }
            catch
            {
                lock (Gate) if (_listener != l) return;
                if (++failures > 50) { Log("accepting failed fifty times; the port is given back and taken again"); Unbind(); return; }
                await Task.Delay(200);
                continue;
            }
            _ = Task.Run(() => ServeAsync(c));
        }
    }

    private static async Task ServeAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                using var stream = client.GetStream();
                using var cap = new CancellationTokenSource(10000);
                var (head, rest) = await RemoteServer.ReadHeadAsync(stream, cap.Token);
                if (head is null) return;
                var lines = head.Split("\r\n");
                var req = lines[0].Split(' ');
                if (req.Length < 2) return;
                var method = req[0].ToUpperInvariant();
                var target = req[1];
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var ln in lines.Skip(1)) { var i = ln.IndexOf(':'); if (i > 0) headers[ln[..i].Trim()] = ln[(i + 1)..].Trim(); }
                var len = headers.TryGetValue("Content-Length", out var cl) && int.TryParse(cl, out var n) ? Math.Min(n, 4096) : 0;
                _ = await RemoteServer.ReadBodyAsync(stream, rest, len, cap.Token);
                var q = target.IndexOf('?');
                var path = q >= 0 ? target[..q] : target;
                var query = q >= 0 ? target[(q + 1)..] : "";
                string? token = null;
                if (headers.TryGetValue("Authorization", out var auth) && auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) token = auth[7..].Trim();
                foreach (var kv in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
                    if (kv.StartsWith("token=", StringComparison.Ordinal)) token ??= WebUtility.UrlDecode(kv[6..]);

                if (method == "OPTIONS") { await RemoteServer.WriteAsync(stream, 204, "", "text/plain"); return; }
                if (method == "GET" && path == "/remote") { await RemoteServer.WriteAsync(stream, 200, ClosedPage.Replace("__TOKEN__", WebUtility.UrlEncode(token ?? "")), "text/html; charset=utf-8"); return; }
                if (method == "GET" && path == "/remote/version")
                {
                    bool opening; lock (Gate) opening = _opened is { } p && !HasExited(p);
                    await RemoteServer.WriteAsync(stream, 200, JsonSerializer.Serialize(new { v = "closed", opening }), "application/json"); return;
                }
                if (method == "GET" && path == "/remote/manifest.json") { await RemoteServer.WriteAsync(stream, 200, RemoteServer.ManifestJson(token, query.Contains("classic=1")), "application/manifest+json"); return; }
                if (method == "GET" && RemoteServer.IconFile(path) is { } icon)
                {
                    if (File.Exists(icon)) { await RemoteServer.WriteBytesAsync(stream, 200, await File.ReadAllBytesAsync(icon), "image/png"); return; }
                    await RemoteServer.WriteAsync(stream, 404, "{}", "application/json"); return;
                }
                if (method == "GET" && path == "/launcher/state")
                {
                    await RemoteServer.WriteAsync(stream, 200, JsonSerializer.Serialize(new { closed = true, paired = PhoneLauncherRules.PairedOnDisk(DataDir, token) }), "application/json"); return;
                }
                if (method == "POST" && path == "/launcher/open")
                {
                    if (!PhoneLauncherRules.PairedOnDisk(DataDir, token)) { await RemoteServer.WriteAsync(stream, 401, "{\"error\":\"this phone is not paired\"}", "application/json"); return; }
                    await RemoteServer.WriteAsync(stream, 200, "{\"ok\":true}", "application/json");
                    OpenPrism("from a paired phone");
                    return;
                }
                await RemoteServer.WriteAsync(stream, 503, "{\"error\":\"Prism is closed on this PC\",\"closed\":true}", "application/json");
            }
            catch (Exception ex) { Log("request failed: " + ex.Message); }
        }
    }

    private static readonly object LogGate = new();
    private static void Log(string text)
    {
        try
        {
            lock (LogGate)
            {
                var path = Path.Combine(DataDir, "diagnostics", "launcher.log");
                if (File.Exists(path) && new FileInfo(path).Length > 1_000_000) File.Move(path, path + ".prev", overwrite: true);
                File.AppendAllText(path, Diagnostics.Redact.Line(DateTime.Now.ToString("MM-dd HH:mm:ss.fff") + " " + text) + "\n");
            }
        }
        catch { }
    }

    /// <summary>The phone's page while Prism is closed: the colours of the phone page's :root, one line, one button. It waits for Prism's
    /// own page (its version answer stops saying "closed") and loads it in place.</summary>
    private const string ClosedPage = """
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#14171C"><title>Prism</title>
<link rel="manifest" href="/remote/manifest.json?token=__TOKEN__"><link rel="apple-touch-icon" sizes="180x180" href="/remote/icon-180.png">
<style>
:root{color-scheme:dark;--ink:#E8ECF2;--dim:#8A93A2;--amber:#F2B14C;--amber-ink:#14171C;--ground:#14171C;--panel:#1C2129}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font:16px system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px calc(24px + env(safe-area-inset-bottom))}
img{width:72px;height:72px;border-radius:16px;margin-bottom:18px}h1{margin:0 0 8px;font:600 22px system-ui;text-align:center}p{margin:0 0 22px;font-size:16px;line-height:1.45;text-align:center;max-width:22em}
button{width:100%;max-width:340px;background:var(--amber);color:var(--amber-ink);border:0;border-radius:14px;padding:18px;font:600 18px system-ui}button:disabled{opacity:.5}
.work{display:none;align-items:center;gap:10px;color:var(--amber);font-size:16px}.work.on{display:flex}.work i{width:10px;height:10px;border-radius:50%;background:var(--amber);animation:pulse 1s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
</style></head><body>
<img src="/remote/icon-180.png" alt="">
<h1 id="h">Prism is closed</h1>
<p id="say">Checking this phone&hellip;</p>
<button id="go" style="display:none">Open Prism</button>
<div class="work" id="work"><i></i><span>Opening Prism&hellip;</span></div>
<script>
const T = '__TOKEN__';
const auth = T ? { Authorization: 'Bearer ' + decodeURIComponent(T.replace(/\+/g, ' ')) } : {};
const q = s => document.querySelector(s);
let openedAt = 0;
function say(t) { q('#say').textContent = t; }
async function look() {
  try {
    const r = await fetch('/launcher/state', { headers: auth, cache: 'no-store' });
    if (!r.ok) { location.reload(); return; }
    const s = await r.json();
    if (s.paired) { say('Open it on this PC from here.'); q('#go').style.display = 'block'; }
    else say('This phone is not paired with Prism on this PC. Open Prism on the PC and scan its phone code.');
  } catch { say('This PC did not answer. Try again in a moment.'); setTimeout(look, 4000); }
}
q('#go').onclick = async () => {
  q('#go').disabled = true;
  try {
    const r = await fetch('/launcher/open', { method: 'POST', headers: auth });
    if (r.status === 401) { say('This phone is not paired with Prism on this PC.'); return; }
    if (!r.ok) throw 0;
  } catch { say('This PC did not answer. Try again.'); q('#go').disabled = false; return; }
  openedAt = Date.now(); q('#go').style.display = 'none'; q('#work').classList.add('on'); say('Prism takes a minute or two to start.');
  wait();
};
async function wait() {
  try {
    const r = await fetch('/remote/version', { cache: 'no-store' });
    const v = await r.json();
    if (v.v && v.v !== 'closed') { location.replace('/remote' + (T ? '?token=' + T : '')); return; }
    if (v.v === 'closed' && !v.opening && Date.now() - openedAt > 8000) { fail(); return; }
  } catch {}
  if (Date.now() - openedAt > 4 * 60 * 1000) { fail(); return; }
  setTimeout(wait, 1500);
}
function fail() { q('#work').classList.remove('on'); say('Prism did not open. Try again.'); q('#go').disabled = false; q('#go').style.display = 'block'; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !openedAt) fetch('/remote/version', { cache: 'no-store' }).then(r => r.json()).then(v => { if (v.v !== 'closed') location.replace('/remote' + (T ? '?token=' + T : '')); }).catch(() => {}); });
look();
</script></body></html>
""";
}
