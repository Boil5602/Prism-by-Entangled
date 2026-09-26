using System.Text.Json;

namespace PrismHost.Storage;

/// <summary>
/// The host side of the Store seam (§10 — normative: NEVER wipe).
///
/// Layout under the root (default %LOCALAPPDATA%\Prism):
///   store.json          key/value store core writes via store.set
///   boot.json           host presentation cache (tile rects + snapshot paths)
///                       so boot shows the last dashboard in ~2s (§16/§8)
///   profiles\&lt;id&gt;\      WebView2 user-data folders — created, never deleted
///   snapshots\&lt;id&gt;.png  persisted §18 snapshots
///
/// Rules encoded here and pinned by tests (StoreServiceTests):
///   - Saves are atomic (temp + replace); a crash never truncates the store.
///   - Migration NEVER deletes: unknown keys and newer-version data survive.
///   - A corrupt store file is set aside (store.json.corrupt-*), never erased,
///     and profiles/snapshots are untouched by any store code path.
///   - There is no delete/clear API for profiles at all — by construction.
/// </summary>
public sealed class StoreService
{
    public const int CurrentVersion = 1;

    private readonly object _lock = new();
    private Dictionary<string, string> _data = new();
    private int _loadedVersion = CurrentVersion;

    public string Root { get; }
    public string StorePath => Path.Combine(Root, "store.json");
    public string ProfilesDir => Path.Combine(Root, "profiles");
    public string SnapshotsDir => Path.Combine(Root, "snapshots");

    public StoreService(string root)
    {
        Root = root;
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
            _data[key] = value;
            Save();
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
        if (!File.Exists(StorePath)) return;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(StorePath));
            var rootEl = doc.RootElement;
            _loadedVersion = rootEl.TryGetProperty("version", out var v) ? v.GetInt32() : 0;
            var data = new Dictionary<string, string>();
            if (rootEl.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object)
                foreach (var p in d.EnumerateObject())
                    data[p.Name] = p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString()! : p.Value.GetRawText();
            // Migration stub (§28): version bumps transform IN PLACE and never
            // drop a key. Data from a NEWER version loads as-is (rollback path).
            _data = Migrate(_loadedVersion, data);
        }
        catch (Exception)
        {
            // Corrupt store: set it aside for inspection — never erase, and
            // never touch profiles/snapshots (they are not ours to clean).
            var aside = StorePath + ".corrupt-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss");
            try { File.Move(StorePath, aside); } catch { /* keep going with empty data */ }
            _data = new Dictionary<string, string>();
        }
    }

    private static Dictionary<string, string> Migrate(int fromVersion, Dictionary<string, string> data)
    {
        // No migrations exist yet. When one does, it must map values and may
        // add keys — deleting or renaming-away a key without a copy is a §10
        // violation and the upgrade test will fail it.
        _ = fromVersion;
        return data;
    }

    private void Save()
    {
        var payload = JsonSerializer.Serialize(new { version = CurrentVersion, data = _data });
        var tmp = StorePath + ".tmp";
        File.WriteAllText(tmp, payload);
        if (File.Exists(StorePath)) File.Replace(tmp, StorePath, null);
        else File.Move(tmp, StorePath);
    }

    private static string Sanitize(string id)
    {
        var chars = id.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' or '.' ? c : '_').ToArray();
        var s = new string(chars);
        return string.IsNullOrEmpty(s) ? "_" : s;
    }
}
