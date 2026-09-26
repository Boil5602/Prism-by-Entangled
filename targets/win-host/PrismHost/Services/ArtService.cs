using System.Security.Cryptography;
using System.Text.Json;
using PrismHost.Storage;

namespace PrismHost.Services;

/// <summary>
/// One image the veil can show, with everything needed to say where it came
/// from. `Attribution` is null only for the legacy signed pool, which has no
/// per-image record on the device (concept-scenes 3: packs are how imagery
/// gets attributed; the pool stays for continuity).
/// </summary>
/// <param name="Path">Absolute path of the file on disk.</param>
/// <param name="PackId">Pack the image came from, or null for the pool.</param>
public sealed record ArtPick(string Path, string? PackId, ArtAttribution? Attribution);

/// <summary>
/// The spec 26 card corner, straight from the pack's LOCAL manifest - no
/// lookup, no network, nothing about the image ever leaves the device
/// (spec 19/22). The two lines follow packages/core/src/imagery-pack.ts
/// `cardAttribution`, which is the normative rule and carries the fixtures:
/// the card says title (with creator) + credit + licence; minimal mode
/// collapses to the credit alone - collapsed, never hidden.
/// </summary>
public sealed record ArtAttribution(
    string Headline,
    string Credit,
    string LicenseName,
    string SourceUrl,
    string Line,
    string MinimalLine);

/// <summary>
/// Intermission imagery (spec 26/27). Two sources, both offline at render time:
///
/// 1. **Imagery packs** (concept-scenes 3) - `Assets/packs/&lt;id&gt;/pack.json`
///    bundled with the build, every image carrying its provenance. This is the
///    source a scene names (`pack:gallery` / `pack:cosmos`).
/// 2. **The signed art pool** - cached under %LOCALAPPDATA%\Prism\art, fetched
///    from the project's own pool (prism.entangled.world/veil/art) with
///    UNPARAMETERIZED requests only (spec 19/22 - no identifiers, ever); each
///    file is verified against the sha256 the pool's list declares before it is
///    kept. Kept working unchanged: packs are an addition, not a replacement.
///
/// TODO(M3 polish): verify list.sig against the offline key like the
/// extension does; until then the per-file hashes bound to the fetched list
/// give integrity of files against the list, not list provenance.
/// Degrades to nothing: no art yet means the overlay shows its dark
/// substrate - never a broken veil.
/// </summary>
public sealed class ArtService
{
    private const string Base = "https://prism.entangled.world/veil/art/";
    private const int CacheCount = 14;
    private static readonly HttpClient Http = new();
    private readonly StoreService _store;
    private readonly Random _rng = new();
    private readonly Dictionary<string, List<ArtPick>> _packs = new(StringComparer.OrdinalIgnoreCase);
    private Task? _fetch;

    public ArtService(StoreService store)
    {
        _store = store;
        Directory.CreateDirectory(Dir);
        LoadPacks();
        _fetch = FetchAsync();          // warm the pool cache in the background
    }

    private string Dir => Path.Combine(_store.Root, "art");

    /// <summary>Pack ids the build actually shipped, in id order (for the settings list).</summary>
    public IReadOnlyCollection<string> PackIds => _packs.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray();

    /// <summary>How many attributed images a pack shipped with.</summary>
    public int PackSize(string packId) => _packs.TryGetValue(packId, out var l) ? l.Count : 0;

    /// <summary>A random cached artwork path, or null (substrate-only veil).</summary>
    public string? RandomArt() => RandomPoolArt();

    /// <summary>
    /// Spec 26: one image for this veil, with its provenance where we have it.
    /// `source` is the scene's intermission source - "pack:gallery",
    /// "pack:cosmos", or anything else (the pool). A named pack that shipped
    /// no bytes falls back to the pool rather than to a blank veil; when
    /// neither has anything the caller shows the dark substrate.
    /// </summary>
    public ArtPick? Pick(string? source)
    {
        var packId = PackIdOf(source);
        if (packId is not null && _packs.TryGetValue(packId, out var images) && images.Count > 0)
            return images[_rng.Next(images.Count)];
        return RandomPoolArt() is { } path ? new ArtPick(path, null, null) : null;
    }

    /// <summary>"pack:gallery" -> "gallery"; anything else -> null (the pool / a photos album).</summary>
    private static string? PackIdOf(string? source)
    {
        if (string.IsNullOrWhiteSpace(source)) return null;
        var s = source.Trim();
        return s.StartsWith("pack:", StringComparison.OrdinalIgnoreCase) && s.Length > 5 ? s[5..] : null;
    }

    private string? RandomPoolArt()
    {
        try
        {
            var files = Directory.GetFiles(Dir, "*.jpg");
            if (files.Length == 0)
            {
                _fetch ??= FetchAsync();
                return null;
            }
            return files[_rng.Next(files.Length)];
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Read the bundled pack manifests. An entry whose file is missing, or which
    /// is missing any required field, is DROPPED - the spec 5 rule is absolute:
    /// no unlabelled image reaches a wall, so a half-described picture simply
    /// does not exist as far as the veil is concerned.
    /// </summary>
    private void LoadPacks()
    {
        try
        {
            var root = Path.Combine(AppContext.BaseDirectory, "Assets", "packs");
            if (!Directory.Exists(root)) return;
            foreach (var dir in Directory.GetDirectories(root))
            {
                var manifest = Path.Combine(dir, "pack.json");
                if (!File.Exists(manifest)) continue;
                try
                {
                    using var doc = JsonDocument.Parse(File.ReadAllText(manifest));
                    var rootEl = doc.RootElement;
                    var id = Str(rootEl, "id") ?? Path.GetFileName(dir);
                    if (!rootEl.TryGetProperty("images", out var images) || images.ValueKind != JsonValueKind.Array) continue;
                    var picks = new List<ArtPick>();
                    foreach (var img in images.EnumerateArray())
                    {
                        if (ToPick(dir, id, img) is { } pick) picks.Add(pick);
                    }
                    if (picks.Count > 0) _packs[id] = picks;
                }
                catch { /* a malformed manifest ships nothing, never a wrong caption */ }
            }
        }
        catch { /* no packs: the pool and the dark substrate still work */ }
    }

    private static ArtPick? ToPick(string dir, string packId, JsonElement img)
    {
        var file = Str(img, "file");
        var title = Str(img, "title");
        var credit = Str(img, "credit");
        var sourceUrl = Str(img, "sourceUrl");
        if (file is null || title is null || credit is null || sourceUrl is null) return null;
        if (!img.TryGetProperty("license", out var lic) || lic.ValueKind != JsonValueKind.Object) return null;
        var licenseName = Str(lic, "name");
        if (licenseName is null) return null;

        var path = Path.Combine(dir, file);
        if (!File.Exists(path)) return null;                     // pinned but not shipped: it does not exist

        var creator = Str(img, "creator");
        var headline = creator is null ? title : title + " · " + creator;
        var line = string.Join(" · ", new[] { headline, credit, licenseName }.Where(s => !string.IsNullOrWhiteSpace(s)));
        return new ArtPick(path, packId, new ArtAttribution(headline, credit, licenseName, sourceUrl, line, credit));
    }

    private static string? Str(JsonElement el, string name) =>
        el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString())
            ? v.GetString()
            : null;

    private async Task FetchAsync()
    {
        try
        {
            var listJson = await Http.GetStringAsync(Base + "list.json");
            using var doc = JsonDocument.Parse(listJson);
            var entries = new List<(string f, string sha)>();
            foreach (var e in doc.RootElement.GetProperty("files").EnumerateArray())
            {
                var f = e.GetProperty("f").GetString();
                var sha = e.TryGetProperty("sha256", out var s) ? s.GetString() : null;
                if (f is not null && sha is not null && f.EndsWith(".jpg")) entries.Add((f, sha));
            }
            // random subset, verified, cached; already-cached files are kept
            foreach (var (f, sha) in entries.OrderBy(_ => _rng.Next()).Take(CacheCount))
            {
                var dest = Path.Combine(Dir, Path.GetFileName(f));
                if (File.Exists(dest)) continue;
                try
                {
                    var bytes = await Http.GetByteArrayAsync(Base + f);
                    var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
                    if (hash != sha.ToLowerInvariant()) continue;   // integrity or nothing
                    await File.WriteAllBytesAsync(dest, bytes);
                }
                catch { /* next file */ }
            }
        }
        catch { /* offline / first run: substrate-only veils */ }
    }
}
