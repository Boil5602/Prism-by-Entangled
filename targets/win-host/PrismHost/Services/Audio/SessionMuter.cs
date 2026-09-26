using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;

namespace PrismHost.Services.Audio;

/// <summary>
/// B-152 (2026-09-08): "mute" a music source at its Windows AUDIO SESSION instead of the WebView2.
/// WebView2's own mute (CoreWebView2.IsMuted) stops the page rendering audio at all, so the
/// process-scoped loopback the stage listens to gets zeros and a muted source cannot move the
/// stage. A session mute (ISimpleAudioVolume on the render sessions of the source's browser process
/// tree) turned out to be applied BEFORE the loopback tap as well (measured 2026-09-08: zeros), so the
/// "mute" is a DUCK: the session's volume goes to -60 dB (<see cref="Duck"/>). The room hears nothing
/// a room can hear; the loopback still gets the signal, and the analyser's gain brings it back up.
///
/// Sessions are found by process ancestry (Chromium renders from an audio-service child of the
/// browser process), re-applied on session creation and by a 1.5 s sweep in BOTH directions -
/// Windows remembers a session's volume per app, so a session born after an unmute would otherwise
/// come up at the old duck. Callers keep the WebView2 mute as the fallback until a session exists.
///
/// Threading (the wall froze on 2026-09-08): every audio-session call runs on ONE worker thread in
/// the multithreaded apartment. The UI thread only enqueues; it never waits on a lock a COM call
/// could need it for. Results come back through a callback on the worker - callers hop to their
/// own dispatcher.
/// </summary>
public sealed class SessionMuter : IDisposable
{
    /// <summary>-60 dB: the linear scalar the session sits at while "muted".</summary>
    public const float Duck = 0.001f;

    private readonly Action<string> _log;
    private readonly ConcurrentDictionary<uint, bool> _wanted = new();     // browser pid -> muted
    private readonly BlockingCollection<Action> _work = new();
    private readonly Thread _worker;
    private Timer? _sweep;
    private MMDevice? _device;
    private AudioSessionManager? _manager;
    private volatile bool _disposed;
    private volatile float _volume = 1f;
    /// <summary>B-191: a tree wanted muted has just been ducked - at a session's birth, or by a sweep that found one where the mute found none. The host lifts its WebView2 mute then, so the loopback hears the ducked music.</summary>
    public event Action<uint>? Ducked;

    /// <summary>The wall's volume (0..1, B-176): the level every unmuted session sits at; a change re-applies on the worker at once.</summary>
    public float Volume
    {
        get => _volume;
        set { _volume = Math.Clamp(value, 0f, 1f); if (!_disposed) { EnsureSweep(); QueueSweep(); } }
    }

    /// <summary>A browser tree the wall volume applies to even when nothing ever mutes it (a visible page): tracked unmuted.</summary>
    public void Track(uint browserPid)
    {
        if (_disposed || browserPid == 0 || !_wanted.TryAdd(browserPid, false)) return;
        EnsureSweep();
        _work.Add(() => Apply(browserPid, _wanted.TryGetValue(browserPid, out var w) ? w : false));
    }

    private void EnsureSweep() => _sweep ??= new Timer(_ => { if (!_disposed) QueueSweep(); }, null, 1500, 1500);

    /// <summary>One sweep in the queue at a time: a slider drag used to queue one per tick, each a full pass over every session.</summary>
    private int _sweepQueued;
    private void QueueSweep()
    {
        if (System.Threading.Interlocked.CompareExchange(ref _sweepQueued, 1, 0) != 0) return;
        _work.Add(() => { System.Threading.Interlocked.Exchange(ref _sweepQueued, 0); Sweep(); });
    }

    public SessionMuter(Action<string>? log = null)
    {
        _log = log ?? (_ => { });
        _worker = new Thread(Pump) { IsBackground = true, Name = "prism-session-mute" };
        _worker.SetApartmentState(ApartmentState.MTA);
        _worker.Start();
    }

    /// <summary>Duck (or restore) every render session in the process tree under <paramref name="browserPid"/>. Non-blocking; <paramref name="applied"/> gets the session count on the worker.</summary>
    public void SetMuted(uint browserPid, bool muted, Action<int>? applied = null)
    {
        if (_disposed) return;
        _wanted[browserPid] = muted;
        _log($"wanted {browserPid} = {(muted ? "muted" : "unmuted")} | {Wanted()}" + (_work.Count > 4 ? $" | backlog {_work.Count}" : ""));   // 2026-09-17: who asks, the map, and a backlog if one has formed
        EnsureSweep();
        // 2026-09-17 (the one-second on / one-second off): a queued job applies the map AS IT STANDS when it runs, never the
        // value it was queued with - a backlog of mute/unmute jobs could otherwise replay a fight the wall had already settled
        _work.Add(() => { var want = _wanted.TryGetValue(browserPid, out var w) ? w : muted; var n = Apply(browserPid, want); applied?.Invoke(n); });
    }

    private void Pump()
    {
        foreach (var job in _work.GetConsumingEnumerable())
        {
            try { job(); } catch (Exception ex) { _log("session mute job failed: " + ex.Message); }
        }
    }

    private int Apply(uint browserPid, bool muted)
    {
        try
        {
            var mgr = Manager();
            mgr.RefreshSessions();
            var sessions = mgr.Sessions;
            var parents = ParentMap();
            var n = 0;
            for (var i = 0; i < sessions.Count; i++)
            {
                var s = sessions[i];
                uint pid;
                try { pid = s.GetProcessID; } catch { continue; }
                if (!InTree(pid, browserPid, parents)) continue;
                try
                {
                    var v = s.SimpleAudioVolume; v.Mute = false;
                    var want = muted ? Duck : _volume;
                    if (Math.Abs(v.Volume - want) > 0.0005f) { var had = v.Volume; v.Volume = want; _log($"session {pid} (tree {browserPid}): volume {had:0.000} -> {want:0.000} | {Wanted()}"); }
                    n++;
                }
                catch (Exception ex) { _log($"session {pid}: {ex.Message}"); }
            }
            return n;
        }
        catch (Exception ex) { Stale(ex); return 0; }
    }

    /// <summary>B-271 (2026-09-22): the session manager is taken from the default endpoint once; when the default device changes (a restart, a
    /// monitor's audio going away) every pass since fails with 'Element not found' against the dead handle - twice a second, forty thousand log
    /// lines in a morning. The handle is dropped so the next pass re-acquires the endpoint of the moment, and the failure is said once a minute.</summary>
    private long _staleSaidAt;
    private void Stale(Exception ex)
    {
        try { _manager = null; _device?.Dispose(); } catch { } finally { _device = null; }
        var now = Environment.TickCount64;
        if (now - _staleSaidAt > 60_000) { _staleSaidAt = now; _log("session mute failed: " + ex.Message + " - the audio endpoint re-acquired on the next pass"); }
    }
    private string Wanted() => string.Join(" ", _wanted.ToArray().Select(kv => kv.Key + (kv.Value ? "=m" : "=u")));

    private int _sweeps;
    private void Sweep()
    {
        foreach (var (pid, muted) in _wanted.ToArray()) { var n = Apply(pid, muted); if (muted && n > 0) Ducked?.Invoke(pid); }   // B-191: a session that appeared since the mute
        // every fifth sweep: what the UNMUTED trees are actually putting out (the soundscape's level during a break)
        if (++_sweeps % 5 == 0) LogPeaks();
    }

    private void LogPeaks()
    {
        try
        {
            var mgr = Manager(); mgr.RefreshSessions(); var sessions = mgr.Sessions; var parents = ParentMap();
            for (var i = 0; i < sessions.Count; i++)
            {
                var s = sessions[i]; uint pid; try { pid = s.GetProcessID; } catch { continue; }
                foreach (var (root, muted) in _wanted.ToArray())
                    if (!muted && InTree(pid, root, parents)) { float pk = 0; try { pk = s.AudioMeterInformation.MasterPeakValue; } catch { } if (pk > 0.0005f) _log($"session tree {root}: peak {pk:0.000} at volume {s.SimpleAudioVolume.Volume:0.000}"); }
            }
        }
        catch { }
    }

    private AudioSessionManager Manager()
    {
        if (_manager is not null) return _manager;
        _device = new MMDeviceEnumerator().GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        _manager = _device.AudioSessionManager;
        _manager.OnSessionCreated += (_, newSession) =>
        {
            // a stream that appears under a known tree takes the wanted volume at birth (both directions)
            var s = new AudioSessionControl(newSession);
            _work.Add(() =>
            {
                try
                {
                    var pid = s.GetProcessID;
                    var parents = ParentMap();
                    foreach (var (root, muted) in _wanted.ToArray())
                        if (InTree(pid, root, parents)) { s.SimpleAudioVolume.Mute = false; s.SimpleAudioVolume.Volume = muted ? Duck : _volume; if (muted) Ducked?.Invoke(root); _log($"session {pid} born (tree {root}): volume {(muted ? Duck : _volume):0.000}"); }
                }
                catch (Exception ex) { _log("session birth: " + ex.Message); }
            });
        };
        return _manager;
    }

    private static bool InTree(uint pid, uint root, Dictionary<uint, uint> parents)
    {
        for (var p = pid; p != 0 && p != 4; )
        {
            if (p == root) return true;
            if (!parents.TryGetValue(p, out var parent) || parent == p) return false;
            p = parent;
        }
        return false;
    }

    // ---- process ancestry (Toolhelp)

    private static Dictionary<uint, uint> ParentMap()
    {
        var map = new Dictionary<uint, uint>();
        var snap = CreateToolhelp32Snapshot(0x2, 0);
        if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return map;
        try
        {
            var pe = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32>() };
            if (Process32First(snap, ref pe))
            {
                do { map[pe.th32ProcessID] = pe.th32ParentProcessID; } while (Process32Next(snap, ref pe));
            }
        }
        finally { CloseHandle(snap); }
        return map;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32
    {
        public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID;
        public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32First(IntPtr snap, ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32Next(IntPtr snap, ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);

    /// <summary>Restores every known tree to full volume (never leaves a session ducked behind), then stops the worker. Bounded wait.</summary>
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _sweep?.Dispose(); _sweep = null;
        var done = new ManualResetEventSlim(false);
        try
        {
            _work.Add(() =>
            {
                foreach (var (pid, muted) in _wanted.ToArray()) if (muted) Apply(pid, false);
                try { _device?.Dispose(); } catch { }
                done.Set();
            });
            _work.CompleteAdding();
            done.Wait(1500);
        }
        catch { }
    }
}
