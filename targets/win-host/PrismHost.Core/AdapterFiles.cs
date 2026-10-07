using System.Text.Json;

namespace PrismHost.Core;

/// <summary>
/// Where adapters and catalog entries come from (2026-09-29, "Can people add/remove adapters to the list? ... I'll come out with more. And
/// some people won't need"): the ones Prism ships (Assets/adapters, Assets/catalog beside the program) and the ones added on the device
/// (adapters/ and catalog/ in the data folder). A file dropped in the data folder is read at the next start.
///
/// Which file stands for a name:
///  - an adapter both places name: the higher "version" (a newer one dropped over a shipped one); the same version, the shipped one;
///  - a catalog entry both places name: the shipped one (a service Prism ships is described by Prism);
///  - a file that is not a JSON object, an adapter with no "match" list, a catalog entry without an id, a name and an https address, and
///    a name beginning with "_" are left out, each with a line for the log.
/// Nothing here reaches a network, and nothing is written.
/// </summary>
public sealed class AdapterFiles
{
    public sealed record Entry(string Name, string Path, bool Added);

    private readonly string _shipped;
    private readonly string _added;
    private readonly List<string> _notes = new();
    private Dictionary<string, Entry>? _adapters;
    private Dictionary<string, Entry>? _catalog;

    /// <param name="shippedRoot">the folder holding the shipped adapters/ and catalog/ (the program's Assets)</param>
    /// <param name="addedRoot">the folder holding the device's own adapters/ and catalog/ (the data folder)</param>
    public AdapterFiles(string shippedRoot, string addedRoot) { _shipped = shippedRoot; _added = addedRoot; }

    public string AddedAdaptersDir => System.IO.Path.Combine(_added, "adapters");
    public string AddedCatalogDir => System.IO.Path.Combine(_added, "catalog");

    /// <summary>What was left out and why, since the folders were last read.</summary>
    public IReadOnlyList<string> Notes { get { _ = Adapters; _ = Catalog; return _notes; } }

    public IReadOnlyDictionary<string, Entry> Adapters => _adapters ??= Read("adapters", adapter: true);
    public IReadOnlyDictionary<string, Entry> Catalog => _catalog ??= Read("catalog", adapter: false);

    /// <summary>The file that stands for an adapter's name, or null.</summary>
    public string? AdapterPath(string? name) => !string.IsNullOrEmpty(name) && Adapters.TryGetValue(name, out var e) ? e.Path : null;

    /// <summary>True when the adapter, or the catalog entry, of this name came from the device's own folder.</summary>
    public bool IsAdded(string? name) =>
        !string.IsNullOrEmpty(name) && ((Catalog.TryGetValue(name, out var c) && c.Added) || (Adapters.TryGetValue(name, out var a) && a.Added && !Catalog.ContainsKey(name)));

    /// <summary>Read the folders again (a file was dropped while Prism ran).</summary>
    public void Refresh() { _adapters = null; _catalog = null; _notes.Clear(); }

    private Dictionary<string, Entry> Read(string kind, bool adapter)
    {
        var found = new Dictionary<string, Entry>(StringComparer.OrdinalIgnoreCase);
        var versions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (dir, added) in new[] { (System.IO.Path.Combine(_shipped, kind), false), (System.IO.Path.Combine(_added, kind), true) })
        {
            string[] files;
            try { files = Directory.Exists(dir) ? Directory.GetFiles(dir, "*.json") : Array.Empty<string>(); } catch { continue; }
            foreach (var file in files.OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
            {
                var stem = System.IO.Path.GetFileNameWithoutExtension(file);
                if (stem.StartsWith('_')) continue;
                string name = stem, version = "";
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(file));
                    var r = doc.RootElement;
                    if (r.ValueKind != JsonValueKind.Object) { Note(added, file, "it is not a JSON object"); continue; }
                    string Str(string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
                    version = Str("version");
                    if (adapter)
                    {
                        if (!r.TryGetProperty("match", out var m) || m.ValueKind != JsonValueKind.Array || m.GetArrayLength() == 0) { Note(added, file, "an adapter names the hosts it reads in \"match\""); continue; }
                    }
                    else
                    {
                        var id = Str("id");
                        if (id.Length == 0 || Str("name").Length == 0 || !Str("url").StartsWith("https://", StringComparison.OrdinalIgnoreCase)) { Note(added, file, "a catalog entry has an id, a name and an https address"); continue; }
                        name = id;
                    }
                }
                catch (Exception e) { Note(added, file, "it could not be read (" + e.GetType().Name + ")"); continue; }

                if (found.TryGetValue(name, out var have))
                {
                    name = have.Name;   // the spelling the first file gave (an added Netflix.json is the netflix adapter, as the Apps name it)
                    if (!added) { Note(added, file, "another shipped file already names " + name); continue; }
                    if (!adapter) { Note(added, file, have.Added ? "another added file already names " + name : name + " ships with Prism; the shipped entry stands"); continue; }
                    if (!Newer(version, versions.GetValueOrDefault(name, ""))) { Note(added, file, name + " " + (version.Length > 0 ? version : "(no version)") + " is not newer than the shipped " + versions.GetValueOrDefault(name, "") + "; the shipped one stands"); continue; }
                    _ = have;
                }
                found[name] = new Entry(name, file, added);
                versions[name] = version;
            }
        }
        return found;
    }

    private void Note(bool added, string file, string why) =>
        _notes.Add((added ? "added " : "shipped ") + System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(file)) + "/" + System.IO.Path.GetFileName(file) + " left out: " + why);

    /// <summary>a.b.c compared number by number; a version that is not numbers is never newer.</summary>
    public static bool Newer(string candidate, string than)
    {
        static int[]? Parts(string v)
        {
            var p = v.Split('.');
            var n = new int[p.Length];
            for (var i = 0; i < p.Length; i++) if (!int.TryParse(p[i], out n[i]) || n[i] < 0) return null;
            return p.Length == 0 || v.Length == 0 ? null : n;
        }
        var a = Parts(candidate); var b = Parts(than);
        if (a is null) return false;
        if (b is null) return true;
        for (var i = 0; i < Math.Max(a.Length, b.Length); i++)
        {
            var x = i < a.Length ? a[i] : 0; var y = i < b.Length ? b[i] : 0;
            if (x != y) return x > y;
        }
        return false;
    }
}
