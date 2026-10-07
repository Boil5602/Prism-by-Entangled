using System.Text.Json;

namespace PrismHost.Storage;

/// <summary>
/// The host side of the Store seam (§10 — normative: NEVER wipe).
///
/// Layout under the root (default %LOCALAPPDATA%\Prism):
///   store.json          the whole key/value store core writes via store.set - a full snapshot, written at exit and every
///                       half hour (backups, scripts and the Device screen read it)
///   store\&lt;key&gt;.json    one file a changed key (2026-10-03): the working truth between snapshots, so a change writes
///                       its own kilobytes instead of the whole 12 MB three times a minute (SSD wear on a mini PC)
///   boot.json           host presentation cache (tile rects + snapshot paths)
///                       so boot shows the last dashboard in ~2s (§16/§8)
///   profiles\&lt;id&gt;\      WebView2 user-data folders — created, never deleted
///   snapshots\&lt;id&gt;.png  persisted §18 snapshots
///
/// Rules encoded here and pinned by tests (StoreServiceTests):
///   - Saves are atomic (temp + replace); a crash never truncates the store.
///   - With a save delay (the host's), saves are coalesced and written off the
///     caller's thread: a burst of store.set messages - core caching a hundred
///     lookups - became a hundred rewrites of the whole 9 MB file on the UI
///     thread, and the window stopped taking clicks for seconds (2026-09-28).
///     A change reaches the disk within SaveDelayMs of the last one and never
///     later than MaxSaveDelayMs after the first; Flush() writes at once
///     (window close, process exit).
///   - Migration NEVER deletes: unknown keys and newer-version data survive.
///   - A corrupt store file is set aside (store.json.corrupt-*), never erased,
///     and profiles/snapshots are untouched by any store code path.
///   - There is no delete/clear API for profiles at all — by construction.
/// </summary>
public sealed class StoreService
{
    public const int CurrentVersion = 1;

    private readonly object _lock = new();
    private readonly object _writeLock = new();
    private Dictionary<string, string> _data = new();
    private int _loadedVersion = CurrentVersion;
    private readonly int _saveDelayMs;
    private const int MaxSaveDelayMs = 20_000;   // a change waits this long at the most (2026-10-03: five seconds had the whole store written 20 times a minute)
    private readonly Timer? _saveTimer;
    private bool _dirty;
    private long _dirtySince;   // Environment.TickCount64 of the first change not yet written
    private readonly HashSet<string> _dirtyKeys = new();   // the keys changed since the last write (the per-key files)
    private long _lastFullAt;                               // TickCount64 of the last full snapshot
    private const int FullSnapshotMs = 30 * 60_000;
    public string KeysDir => Path.Combine(Root, "store");

    public string Root { get; }
    public string StorePath => Path.Combine(Root, "store.json");
    public string ProfilesDir => Path.Combine(Root, "profiles");
    public string SnapshotsDir => Path.Combine(Root, "snapshots");

    /// <param name="saveDelayMs">0 writes on every Set (tests, tools); the host passes a delay so a burst of sets is one write, off its UI thread.</param>
    public StoreService(string root, int saveDelayMs = 0)
    {
        Root = root;
        _saveDelayMs = saveDelayMs;
        if (saveDelayMs > 0)
        {
            _saveTimer = new Timer(_ => SaveNow(), null, Timeout.Infinite, Timeout.Infinite);
            AppDomain.CurrentDomain.ProcessExit += (_, __) => Flush();
        }
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(ProfilesDir);
        Directory.CreateDirectory(SnapshotsDir);
        Load();
    }

    /// <summary>Per-profile user-data folder; created on demand, never deleted here.</summary>
    public string ProfileDir(string profileId)
    {
        var safe = Sanitize(profileId);
        var dir = Path.Combine(ProfilesDir, safe);
        Directory.CreateDirectory(dir);
        return dir;
    }

    public string SnapshotPath(string tileId) => Path.Combine(SnapshotsDir, Sanitize(tileId) + ".png");

    public string? Get(string key)
    {
        lock (_lock) return _data.TryGetValue(key, out var v) ? v : null;
    }

    public void Set(string key, string value)
    {
        lock (_lock)
        {
            if (_data.TryGetValue(key, out var had) && had == value) return;   // nothing changed: nothing to write
            _data[key] = value;
            _dirtyKeys.Add(key);
            if (_saveTimer is null) { Save(_data); _dirtyKeys.Clear(); return; }
            var now = Environment.TickCount64;
            if (!_dirty) { _dirty = true; _dirtySince = now; }
            var left = MaxSaveDelayMs - (now - _dirtySince);
            _saveTimer.Change(Math.Max(0, Math.Min(_saveDelayMs, left)), Timeout.Infinite);
        }
    }

    /// <summary>Anything set and not yet on disk is written now, and the full snapshot with it (window close, process exit).</summary>
    public void Flush() => SaveNow(full: true);

    private void SaveNow() => SaveNow(full: false);
    private void SaveNow(bool full)
    {
        try
        {
            lock (_writeLock)   // the copy is taken inside the writer's lock, so an older copy is never written after a newer one
            {
                Dictionary<string, string> copy;
                List<string> keys;
                lock (_lock)
                {
                    if (!_dirty && !full) return;
                    _dirty = false;
                    keys = _dirtyKeys.ToList(); _dirtyKeys.Clear();
                    copy = new Dictionary<string, string>(_data);   // serialized outside the data lock: a Set never waits on the write
                }
                // the changed keys, each its own file; the whole store only now and then (or at exit)
                foreach (var k in keys) if (copy.TryGetValue(k, out var v)) SaveKey(k, v);
                if (full || Environment.TickCount64 - _lastFullAt >= FullSnapshotMs) { Save(copy); _lastFullAt = Environment.TickCount64; }
            }
        }
        catch
        {
            // the write failed (a locked file, a full disk): the change stays pending and is tried again
            lock (_lock) { if (!_dirty) { _dirty = true; _dirtySince = Environment.TickCount64; } }
            _saveTimer?.Change(Math.Max(_saveDelayMs, 1_000), Timeout.Infinite);
        }
    }

    /// <summary>Every key/value — the snapshot injected into the brain's storeGet.</summary>
    public IReadOnlyDictionary<string, string> All()
    {
        lock (_lock) return new Dictionary<string, string>(_data);
    }

    /// <summary>The version the store file carried when loaded (upgrade tests).</summary>
    public int LoadedVersion => _loadedVersion;

    private void Load()
    {
        var data = new Dictionary<string, string>();
        long snapshotAt = 0;
        if (File.Exists(StorePath))
        {
            try
            {
                snapshotAt = new FileInfo(StorePath).LastWriteTimeUtc.Ticks;
                using var doc = JsonDocument.Parse(File.ReadAllText(StorePath));
                var rootEl = doc.RootElement;
                _loadedVersion = rootEl.TryGetProperty("version", out var v) ? v.GetInt32() : 0;
                if (rootEl.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object)
                    foreach (var p in d.EnumerateObject())
                        data[p.Name] = p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString()! : p.Value.GetRawText();
            }
            catch (Exception)
            {
                // Corrupt store: set it aside for inspection — never erase, and
                // never touch profiles/snapshots (they are not ours to clean).
                var aside = StorePath + ".corrupt-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
                try { File.Move(StorePath, aside); } catch { /* keep going with empty data */ }
                data = new Dictionary<string, string>();
            }
        }
        // the per-key files over the snapshot: each written after its key last changed, so one newer than the snapshot is the truth; an
        // older one (a snapshot written by a later run with no per-key files, as tests and tools do) is left as it is
        if (Directory.Exists(KeysDir))
        {
            foreach (var f in Directory.GetFiles(KeysDir, "*.json"))
            {
                try
                {
                    var at = new FileInfo(f).LastWriteTimeUtc.Ticks;
                    using var doc = JsonDocument.Parse(File.ReadAllText(f));
                    var k = doc.RootElement.TryGetProperty("key", out var kp) ? kp.GetString() : null;
                    if (k is null || !doc.RootElement.TryGetProperty("value", out var vp) || vp.ValueKind != JsonValueKind.String) continue;
                    if (at >= snapshotAt || !data.ContainsKey(k)) data[k] = vp.GetString()!;
                }
                catch (Exception)
                {
                    var aside = f + ".corrupt-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
                    try { File.Move(f, aside); } catch { }
                }
            }
        }
        // Migration stub (§28): version bumps transform IN PLACE and never
        // drop a key. Data from a NEWER version loads as-is (rollback path).
        _data = Migrate(_loadedVersion, data);
        _lastFullAt = Environment.TickCount64;
    }

    /// <summary>One key's file: {"key","value"}, written whole and swapped in; the name is the key made safe plus a short hash, so two keys never share one.</summary>
    private void SaveKey(string key, string value)
    {
        Directory.CreateDirectory(KeysDir);
        var path = Path.Combine(KeysDir, KeyFileName(key));
        var tmp = path + ".tmp";
        long length;
        using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 14))
        using (var w = new StreamWriter(fs, new System.Text.UTF8Encoding(false), 1 << 14))
        {
            w.Write("{\"key\":"); WriteJsonString(w, key); w.Write(",\"value\":"); WriteJsonString(w, value); w.Write('}');
            w.Flush();
            length = fs.Length;
        }
        Saves++; SavedBytes += length;
        if (File.Exists(path)) File.Replace(tmp, path, null);
        else File.Move(tmp, path);
    }
    private static string KeyFileName(string key)
    {
        var safe = Sanitize(key);
        if (safe.Length > 80) safe = safe[..80];
        var hash = System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(key));
        return safe + "." + Convert.ToHexString(hash, 0, 4).ToLowerInvariant() + ".json";
    }

    private static Dictionary<string, string> Migrate(int fromVersion, Dictionary<string, string> data)
    {
        // No migrations exist yet. When one does, it must map values and may
        // add keys — deleting or renaming-away a key without a copy is a §10
        // violation and the upgrade test will fail it.
        _ = fromVersion;
        return data;
    }

    /// <summary>The wall's cost (perf.log, 2026-10-03): how many times the store was written and how many bytes, since the start.</summary>
    public long Saves { get; private set; }
    public long SavedBytes { get; private set; }
    private void Save(Dictionary<string, string> data)
    {
        lock (_writeLock)   // one writer at a time: the timer's write and a Flush never share the temp file
        {
            // streamed to the file, never one 7 MB string and its bytes (2026-10-03, perf: the whole-store string and byte array were the largest
            // objects on the host's heap, made again on every save); the file's shape is unchanged
            // (2026-10-03, an allocation trace: Utf8JsonWriter rented a six-times escape buffer per megabyte value and grew its output to the whole
            // file - half the host's churn) each string is escaped by hand straight into a 16 KB writer buffer; the file's shape is unchanged
            var tmp = StorePath + ".tmp";
            long length;
            using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 14))
            using (var w = new StreamWriter(fs, new System.Text.UTF8Encoding(false), 1 << 14))
            {
                w.Write("{\"version\":"); w.Write(CurrentVersion); w.Write(",\"data\":{");
                var first = true;
                foreach (var kv in data)
                {
                    if (!first) w.Write(','); first = false;
                    WriteJsonString(w, kv.Key); w.Write(':'); WriteJsonString(w, kv.Value);
                }
                w.Write("}}");
                w.Flush();
                length = fs.Length;
            }
            Saves++; SavedBytes += length;
            if (File.Exists(StorePath)) File.Replace(tmp, StorePath, null);
            else File.Move(tmp, StorePath);
        }
    }

    /// <summary>A JSON string written char by char: quotes, backslashes and control characters escaped, everything else as it is (valid JSON;
    /// the reader takes it like the serializer's own output).</summary>
    private static void WriteJsonString(TextWriter w, string s)
    {
        w.Write('"');
        var start = 0;
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            if (c >= ' ' && c != '"' && c != '\\' && !char.IsSurrogate(c)) continue;
            // a surrogate pair goes as it is; a lone surrogate is not a character and becomes U+FFFD (as the serializer did)
            if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) { i++; continue; }
            if (i > start) w.Write(s.AsSpan(start, i - start));
            start = i + 1;
            switch (c)
            {
                case '"': w.Write("\\\""); break;
                case '\\': w.Write("\\\\"); break;
                case '\n': w.Write("\\n"); break;
                case '\r': w.Write("\\r"); break;
                case '\t': w.Write("\\t"); break;
                case '\b': w.Write("\\b"); break;
                case '\f': w.Write("\\f"); break;
                default: if (char.IsSurrogate(c)) w.Write('\uFFFD'); else { w.Write("\\u"); w.Write(((int)c).ToString("x4")); } break;
            }
        }
        if (start < s.Length) w.Write(s.AsSpan(start));
        w.Write('"');
    }

    private static string Sanitize(string id)
    {
        var chars = id.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' or '.' ? c : '_').ToArray();
        var s = new string(chars);
        return string.IsNullOrEmpty(s) ? "_" : s;
    }
}
