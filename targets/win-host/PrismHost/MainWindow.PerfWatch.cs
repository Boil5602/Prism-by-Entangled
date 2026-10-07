using System.Diagnostics;
using System.Runtime.InteropServices;

namespace PrismHost;

/// <summary>
/// The wall's cost, once a minute, to diagnostics/perf.log (2026-10-03, "How can we troubleshoot and optimize performance? ... I'd like to see
/// how busy the app is, downloads, cpu, gpu, memory" / "Good call with measure first"): the host and every WebView2 process it owns, each
/// with its CPU share over the minute, its GPU share (Windows' per-process GPU engine counters), its working set and its IO rate (file and
/// network together, the nearest Windows gives without a capture), and the surfaces each renderer draws, so the heaviest page has a name.
/// One line a minute, nothing on screen; the panel comes after a day of lines. Local only: the log never leaves the machine.
/// </summary>
public sealed partial class MainWindow
{
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _perfWatch;
    private readonly Dictionary<int, (TimeSpan cpu, ulong io, DateTime at)> _perfPrev = new();
    private readonly Dictionary<string, (long raw, long ts, long freq)> _gpuPrev = new();
    private int _perfStalls;
    private DateTime _perfStallTick = DateTime.MinValue;
    private long _perfWrites;
    private long _perfAllocPrev;
    private readonly Dictionary<string, (int n, long bytes)> _perfSets = new();
    private long _perfSavesPrev, _perfSavedBytesPrev;
    /// <summary>A store.set from the brain, counted by its key's family (the part before the last colon) for the minute's line.</summary>
    private void PerfNoteSet(string key, int bytes)
    {
        var i = key.LastIndexOf(':'); var fam = i > 0 ? key[..i] : key;
        lock (_perfSets) { _perfSets[fam] = _perfSets.TryGetValue(fam, out var had) ? (had.n + 1, had.bytes + bytes) : (1, bytes); }
    }

    /// <summary>The brain's answers by function and the surfaces' events by type, bytes this minute (2026-10-03: the host's remaining allocation
    /// was the Watch page's follow loop parsing the 1.5 MB menu every three seconds; this line is how the next one is found).</summary>
    private readonly Dictionary<string, (int n, long bytes)> _perfCalls = new(), _perfEvents = new();
    private void PerfNoteCall(string fn, int bytes) { lock (_perfCalls) { _perfCalls[fn] = _perfCalls.TryGetValue(fn, out var had) ? (had.n + 1, had.bytes + bytes) : (1, bytes); } }
    private void PerfNoteEvent(string eventJson)
    {
        var i = eventJson.IndexOf("\"type\":\"", StringComparison.Ordinal);
        var type = "?";
        if (i >= 0) { var j = eventJson.IndexOf('"', i + 8); if (j > i) type = eventJson[(i + 8)..j]; }
        lock (_perfEvents) { _perfEvents[type] = _perfEvents.TryGetValue(type, out var had) ? (had.n + 1, had.bytes + eventJson.Length) : (1, eventJson.Length); }
    }

    private void StartPerfWatch()
    {
        // the UI thread's lateness: a half-second timer that arrives more than 200 ms late counts a stall (a wall that "feels sluggish")
        var stall = DispatcherQueue.CreateTimer();
        stall.Interval = TimeSpan.FromMilliseconds(500); stall.IsRepeating = true;
        stall.Tick += (_, __) => { var now = DateTime.UtcNow; if (_perfStallTick != DateTime.MinValue && (now - _perfStallTick).TotalMilliseconds > 700) _perfStalls++; _perfStallTick = now; };
        stall.Start();
        _perfStallTimer = stall;
        _perfWatch = DispatcherQueue.CreateTimer();
        _perfWatch.Interval = TimeSpan.FromSeconds(60); _perfWatch.IsRepeating = true;
        var busy = false;
        _perfWatch.Tick += async (_, __) =>
        {
            if (busy) return;
            busy = true;
            try { await PerfSampleAsync(); } catch (Exception e) { LogLine("perf: " + e.Message); } finally { busy = false; }
        };
        _perfWatch.Start();
        _ = Task.Run(async () => { await Task.Delay(20_000); try { await PerfSampleAsync(); } catch { } });   // a first line soon after the start (the deltas begin here)
        // readers dark (2026-10-03): the switch from host-prefs, the idle readers dozed every half minute while it is on
        _surfaces.ReadersDark = HostPrefs.GetBool("perf.readersDark", false);
        var doze = DispatcherQueue.CreateTimer();
        doze.Interval = TimeSpan.FromSeconds(30); doze.IsRepeating = true;
        doze.Tick += async (_, __) => { try { await _surfaces.DozeIdleReadersAsync(); } catch (Exception e) { LogLine("readers: " + e.Message); } };
        doze.Start();
        _dozeTimer = doze;
    }
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _dozeTimer;
    /// <summary>The switch flipped (the dev hook "readers on|off"): kept in host-prefs; off wakes every dozing reader on the next tick.</summary>
    private void SetReadersDark(bool on) { HostPrefs.Set("perf.readersDark", on); _surfaces.ReadersDark = on; LogLine("readers dark: " + (on ? "on" : "off")); }
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _perfStallTimer;

    /// <summary>What the host allocates, by type (2026-10-03): the runtime's allocation-tick events (one per ~100 KB allocated, naming the
    /// type) heard in-process and summed by type for the minute's line. Behind host-prefs perf.allocTypes; the listener costs a little itself.</summary>
    private sealed class AllocWatch : System.Diagnostics.Tracing.EventListener
    {
        private readonly Dictionary<string, long> _by = new();
        protected override void OnEventSourceCreated(System.Diagnostics.Tracing.EventSource source)
        {
            if (source.Name == "Microsoft-Windows-DotNETRuntime") EnableEvents(source, System.Diagnostics.Tracing.EventLevel.Verbose, (System.Diagnostics.Tracing.EventKeywords)0x1);
        }
        protected override void OnEventWritten(System.Diagnostics.Tracing.EventWrittenEventArgs e)
        {
            if (e.EventName is null || !e.EventName.StartsWith("GCAllocationTick", StringComparison.Ordinal) || e.PayloadNames is null || e.Payload is null) return;
            var ti = e.PayloadNames.IndexOf("TypeName"); var ai = e.PayloadNames.IndexOf("AllocationAmount64");
            if (ti < 0) return;
            var type = e.Payload[ti] as string ?? "?";
            var amount = ai >= 0 && e.Payload[ai] is ulong u ? (long)u : 100_000;
            lock (_by) _by[type] = _by.TryGetValue(type, out var had) ? had + amount : amount;
        }
        public string Take(int top)
        {
            lock (_by)
            {
                var items = _by.OrderByDescending(kv => kv.Value).Take(top).Select(kv => Short(kv.Key) + " " + kv.Value / 1048576 + "M").ToList();
                _by.Clear();
                return string.Join(", ", items);
            }
        }
        private static string Short(string t) { var i = t.LastIndexOf('.'); return i >= 0 && !t.Contains('[') ? t[(i + 1)..] : t.Replace("System.", ""); }
    }
    private AllocWatch? _allocWatch;
    private long _perfSelfAlloc;
    private bool _perfDumpAsked;
    /// <summary>The next perf line also lists every process (dev hook "perf"); the line itself comes at its minute, or now when asked.</summary>
    private void PerfDumpNow() { _perfDumpAsked = true; _ = PerfSampleAsync(); }
    private async Task PerfSampleAsync()
    {
        var selfStart = GC.GetTotalAllocatedBytes(false);   // what this sampler itself allocates, so its own cost is on the line
        var map = await _surfaces.ProcessMapAsync();   // pid -> kind + the surfaces it draws
        var tiles = _surfaces.Describe().ToDictionary(t => t.Id, t => t);
        var pids = new HashSet<int> { Environment.ProcessId };
        foreach (var p in map) pids.Add((int)p.Pid);
        var gpu = await Task.Run(GpuByPid);
        var now = DateTime.UtcNow;
        var rows = new List<(int pid, string kind, string[] surfaces, double cpu, double gpu, double memMb, double ioKbs, string profile)>();
        double cpuAll = 0, gpuAll = 0, memAll = 0, ioAll = 0;
        var seen = new HashSet<int>();
        foreach (var pid in pids)
        {
            Process proc;
            try { proc = Process.GetProcessById(pid); } catch { _perfPrev.Remove(pid); continue; }
            TimeSpan cpuT; long ws; ulong io;
            try { cpuT = proc.TotalProcessorTime; ws = proc.WorkingSet64; io = IoBytes(proc.Handle); } catch { continue; }
            finally { proc.Dispose(); }
            seen.Add(pid);
            double cpu = 0, ioKbs = 0;
            if (_perfPrev.TryGetValue(pid, out var prev))
            {
                var secs = Math.Max(1, (now - prev.at).TotalSeconds);
                cpu = Math.Max(0, (cpuT - prev.cpu).TotalSeconds / secs / Environment.ProcessorCount * 100);
                ioKbs = Math.Max(0, (double)(io - prev.io) / secs / 1024);
            }
            _perfPrev[pid] = (cpuT, io, now);
            var m = map.FirstOrDefault(x => (int)x.Pid == pid);
            var kind = pid == Environment.ProcessId ? "host" : m?.Kind.ToLowerInvariant() ?? "?";
            var g = gpu.TryGetValue(pid, out var gv) ? gv : 0;
            var memMb = ws / 1048576.0;
            rows.Add((pid, kind, m?.Surfaces ?? Array.Empty<string>(), cpu, g, memMb, ioKbs, pid == Environment.ProcessId ? "host" : m?.Profile ?? "?"));
            cpuAll += cpu; gpuAll += g; memAll += memMb; ioAll += ioKbs;
        }
        foreach (var gone in _perfPrev.Keys.Where(k => !seen.Contains(k)).ToList()) _perfPrev.Remove(gone);
        // dev: every process on one line each, asked for with the hub request "perf" (2026-10-03: what is inside the one browser)
        if (_perfDumpAsked) { _perfDumpAsked = false; foreach (var r in rows.OrderByDescending(r => r.memMb)) LogLine($"perf proc {r.pid} {r.kind} {r.profile} mem={r.memMb:0}M cpu={r.cpu:0.0} gpu={r.gpu:0.0} io={r.ioKbs:0}K/s {string.Join("+", r.surfaces.Select(x => tiles.TryGetValue(x, out var t) ? x + (t.Hidden ? "(hidden)" : "") : x))}"); }
        var stalls = _perfStalls; _perfStalls = 0;
        // the surfaces by cost: a renderer's cost is its surfaces'; the top three named
        var top = rows.Where(r => r.surfaces.Length > 0).OrderByDescending(r => r.cpu + r.gpu).Take(3)
            .Select(r => string.Join("+", r.surfaces.Select(s => tiles.TryGetValue(s, out var t) ? s + (t.Hidden ? "(hidden)" : "") : s)) + " cpu=" + r.cpu.ToString("0.0") + " gpu=" + r.gpu.ToString("0.0") + " mem=" + r.memMb.ToString("0") + "M" + (r.ioKbs > 1 ? " io=" + r.ioKbs.ToString("0") + "K/s" : ""));
        var hidden = tiles.Values.Count(t => t.Hidden);
        // each profile's browser as a whole (its browser, GPU, utility and renderer processes): the GPU work of a profile's pages lands in its one
        // GPU process, which no page owns, so a service's cost is only honest at this level
        var byProfile = rows.GroupBy(r => r.profile).Select(g => (profile: g.Key, cpu: g.Sum(r => r.cpu), gpu: g.Sum(r => r.gpu), mem: g.Sum(r => r.memMb), n: g.Count()))
            .OrderByDescending(x => x.cpu + x.gpu).Take(4).Select(x => $"{x.profile} cpu={x.cpu:0.0} gpu={x.gpu:0.0} mem={x.mem:0}M x{x.n}");
        // the host's own memory split: the managed heap against its working set (the rest is WebView2's host-side composition, XAML and native)
        var hostRow = rows.FirstOrDefault(r => r.pid == Environment.ProcessId);
        // the managed heap as it stands (garbage not yet collected included) and the allocation rate over the minute: the rate is the honest
        // number for churn (a heap that swings by a gigabyte between lines is GC timing, not a leak)
        _perfSelfAlloc = GC.GetTotalAllocatedBytes(false) - selfStart;
        var managedMb = GC.GetTotalMemory(false) / 1048576.0;
        var allocated = GC.GetTotalAllocatedBytes(false);
        var allocMbMin = _perfAllocPrev > 0 ? (allocated - _perfAllocPrev) / 1048576.0 : 0;
        _perfAllocPrev = allocated;
        // the store: sets by key family this minute, and the file's writes (the whole store serialized each time)
        List<KeyValuePair<string, (int n, long bytes)>> sets;
        lock (_perfSets) { sets = _perfSets.OrderByDescending(kv => kv.Value.bytes).ToList(); _perfSets.Clear(); }
        var saves = _store.Saves - _perfSavesPrev; var savedMb = (_store.SavedBytes - _perfSavedBytesPrev) / 1048576.0;
        _perfSavesPrev = _store.Saves; _perfSavedBytesPrev = _store.SavedBytes;
        var storeWords = $"store sets={sets.Sum(kv => kv.Value.n)} ({string.Join(", ", sets.Take(3).Select(kv => kv.Key + " x" + kv.Value.n + " " + kv.Value.bytes / 1024 + "K"))}) saves={saves} {savedMb:0}M";
        List<KeyValuePair<string, (int n, long bytes)>> calls, events;
        lock (_perfCalls) { calls = _perfCalls.OrderByDescending(kv => kv.Value.bytes).ToList(); _perfCalls.Clear(); }
        lock (_perfEvents) { events = _perfEvents.OrderByDescending(kv => kv.Value.bytes).ToList(); _perfEvents.Clear(); }
        var trafficWords = $"calls={calls.Sum(kv => kv.Value.n)} {calls.Sum(kv => kv.Value.bytes) / 1024}K ({string.Join(", ", calls.Take(3).Select(kv => kv.Key + " x" + kv.Value.n + " " + kv.Value.bytes / 1024 + "K"))}) events={events.Sum(kv => kv.Value.n)} {events.Sum(kv => kv.Value.bytes) / 1024}K ({string.Join(", ", events.Take(2).Select(kv => kv.Key + " x" + kv.Value.n + " " + kv.Value.bytes / 1024 + "K"))})";
        var selfMb = _perfSelfAlloc / 1048576.0;
        if (_allocWatch is null && HostPrefs.GetBool("perf.allocTypes", true)) _allocWatch = new AllocWatch();
        var allocTypes = _allocWatch is { } aw ? " by type (" + aw.Take(6) + ")" : "";
        var beatMb = _surfaces.BeatAlloc / 1048576.0; var beatCalls = _surfaces.BeatCalls; _surfaces.BeatAlloc = 0; _surfaces.BeatCalls = 0;
        allocTypes += $" beat {beatCalls} calls {beatMb:0}M";
        var hostWords = $"host ws={hostRow.memMb:0}M managed={managedMb:0}M alloc={allocMbMin:0}M/min{allocTypes} (perf itself {selfMb:0}M) gc={GC.CollectionCount(2)} readers={(_surfaces.ReadersDark ? "dark" : "lit")}({_surfaces.DozingCount} dozing) {storeWords} {trafficWords}";
        var line = $"{DateTime.Now:HH:mm:ss} cpu={cpuAll:0.0}% gpu={gpuAll:0.0}% mem={memAll:0}M io={ioAll / 1024:0.00}M/s procs={rows.Count} surfaces={tiles.Count}(hidden {hidden}) stalls={stalls} {hostWords} | " + string.Join("; ", byProfile) + " | " + string.Join("; ", top);
        var diag = HostPaths.Diagnostics;
        Directory.CreateDirectory(diag);
        var path = Path.Combine(diag, "perf.log");
        try
        {
            if (++_perfWrites % 200 == 0 && new FileInfo(path).Length > 2_000_000)
            {
                // rotated in place: the newest half kept
                var all = File.ReadAllLines(path); File.WriteAllLines(path, all.Skip(all.Length / 2));
            }
        }
        catch { }
        File.AppendAllText(path, line + "\n");
        RootGrid.DispatcherQueue.TryEnqueue(RefreshPerfPanel);   // the Watch page's panel, when on
    }

    /// <summary>GPU share per process from the "GPU Engine" counters: every engine of a process summed (3D, video decode, copy), a rate over the
    /// last sample. The first call seeds and reports nothing.</summary>
    private Dictionary<int, double> GpuByPid()
    {
        var out2 = new Dictionary<int, double>();
        try
        {
            var cat = new PerformanceCounterCategory("GPU Engine");
            var data = cat.ReadCategory();
            var util = data["Utilization Percentage"];
            if (util is null) return out2;
            var seenNow = new HashSet<string>();
            foreach (System.Collections.DictionaryEntry e in util)
            {
                var name = e.Key as string; var sample = (InstanceData)e.Value!;
                if (name is null) continue;
                var m = System.Text.RegularExpressions.Regex.Match(name, @"^pid_(\d+)_");
                if (!m.Success) continue;
                var pid = int.Parse(m.Groups[1].Value);
                var cur = sample.Sample;
                seenNow.Add(name);
                if (_gpuPrev.TryGetValue(name, out var prev) && cur.TimeStamp100nSec > prev.ts)
                {
                    // a 100 ns timer counter: busy time over wall time
                    var pct = (double)(cur.RawValue - prev.raw) / (cur.TimeStamp100nSec - prev.ts) * 100;
                    if (pct > 0) out2[pid] = (out2.TryGetValue(pid, out var had) ? had : 0) + Math.Min(100, pct);
                }
                _gpuPrev[name] = (cur.RawValue, cur.TimeStamp100nSec, cur.CounterFrequency);
            }
            foreach (var k in _gpuPrev.Keys.Where(k => !seenNow.Contains(k)).ToList()) _gpuPrev.Remove(k);
        }
        catch (Exception e) { if (_perfWrites == 0) LogLine("perf: gpu counters unavailable - " + e.Message); }
        return out2;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessIoCounters(IntPtr hProcess, out IoCounters counters);
    private static ulong IoBytes(IntPtr h) => GetProcessIoCounters(h, out var c) ? c.ReadBytes + c.WriteBytes : 0;
}
