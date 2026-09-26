using System.Text.Json;
using PrismHost.Brain;
using PrismHost.Storage;

namespace PrismHost.Services;

public sealed record PosterInfo(string? ImagePath, string Name, string? BackgroundColor);

/// <summary>
/// §31 poster fetcher, host side. The host is dumb transport + cache: the
/// RESOLUTION ORDER (manifest icons -> apple-touch-icon -> og:image ->
/// wordmark) is core's decision, asked via PrismRuntime.posterPlan in the
/// brain. Winning images cache under %LOCALAPPDATA%\Prism\posters\ID
/// (page data on disk - never repo content, never bundled).
/// </summary>
public sealed class PosterService
{
    // a plain browser name, the same one every copy of Prism sends (no identifier, §19/§22): HBO Max answers a request with none "403" and its
    // icon never came (2026-09-25, "Can you find a better logo for hbo max" - its tile drew the initials HM)
    private static readonly HttpClient Http = MakeHttp();
    private static HttpClient MakeHttp()
    {
        var h = new HttpClient();
        h.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0");
        return h;
    }
    private readonly StoreService _store;
    private readonly BrainHost _brain;

    public PosterService(StoreService store, BrainHost brain)
    {
        _store = store;
        _brain = brain;
        Directory.CreateDirectory(Dir);
    }

    private string Dir => Path.Combine(_store.Root, "posters");
    private string ImgPath(string id) => Path.Combine(Dir, id + ".img");
    private string MetaPath(string id) => Path.Combine(Dir, id + ".meta.json");

    public async Task<PosterInfo> GetAsync(string id, string name, string url)
    {
        try
        {
            if (File.Exists(ImgPath(id))) return new(ImgPath(id), name, MetaBg(id));
            if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return new(null, name, null);
            // docs/concept-scenes.md §6: the first-party micro-facets exist only
            // inside this app (the tiles.prism virtual host). Asking the network
            // for their poster would be a lookup for a name that is ours and
            // resolves nowhere - the wordmark is the honest answer (§19/§22).
            if (Tiles.TilesBridge.IsTilesOrigin(url)) return new(null, name, null);
            var html = await Http.GetStringAsync(url);
            var plan = await PlanAsync(name, url, html, null);
            if (plan?.ManifestUrl is { } mu)
            {
                try { plan = await PlanAsync(name, url, html, await Http.GetStringAsync(mu)) ?? plan; }
                catch { /* manifest unreachable - html candidates remain */ }
            }
            if (plan is null) return new(null, name, null);
            foreach (var candidate in plan.Candidates)
            {
                try
                {
                    if (!candidate.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) continue;
                    var bytes = await Http.GetByteArrayAsync(candidate);
                    if (bytes.Length < 64 || bytes[0] == (byte)'<' || bytes[0] == (byte)'{') continue; // not a raster image
                    await File.WriteAllBytesAsync(ImgPath(id), bytes);
                    File.WriteAllText(MetaPath(id), JsonSerializer.Serialize(new { src = candidate, bg = plan.Bg }));
                    return new(ImgPath(id), name, plan.Bg);
                }
                catch { /* next candidate */ }
            }
            File.WriteAllText(MetaPath(id), JsonSerializer.Serialize(new { src = (string?)null, bg = plan.Bg }));
            return new(null, name, plan.Bg);
        }
        catch
        {
            return new(null, name, MetaBg(id));
        }
    }

    /// <summary>A service's symbol at card size (2026-09-23, Fandango's app tile read as mush at 26 px): the site's own small icon, as core's
    /// markPlan orders them, cached apart from the poster (ID.mark.img); a site with none gives its poster.</summary>
    // one fetch per service however many cards ask at once (2026-09-23, "some say the disney logo, some say D+": parallel asks raced, and the
    // ones that finished first fell back to the initials)
    private readonly Dictionary<string, Task<PosterInfo>> _marks = new();
    public Task<PosterInfo> GetMarkAsync(string id, string name, string url)
    {
        lock (_marks)
        {
            if (_marks.TryGetValue(id, out var t) && !(t.IsCompleted && t.Result.ImagePath is null)) return t;
            return _marks[id] = FetchMarkAsync(id, name, url);
        }
    }
    private async Task<PosterInfo> FetchMarkAsync(string id, string name, string url)
    {
        var markPath = Path.Combine(Dir, id + ".mark.img");
        var nonePath = Path.Combine(Dir, id + ".mark.none");
        try
        {
            if (File.Exists(markPath)) return new(markPath, name, MetaBg(id));
            if (File.Exists(nonePath) || !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || Tiles.TilesBridge.IsTilesOrigin(url)) return await GetAsync(id, name, url);
            var html = await Http.GetStringAsync(url);
            var raw = await _brain.EvalAsync("PrismRuntime.markPlan(" + JsonSerializer.Serialize(url) + "," + JsonSerializer.Serialize(html) + ")");
            var candidates = new List<string>();
            if (raw is not null && raw != "null")
            {
                using var outer = JsonDocument.Parse(raw);
                if (outer.RootElement.ValueKind == JsonValueKind.String)
                {
                    using var doc = JsonDocument.Parse(outer.RootElement.GetString()!);
                    if (doc.RootElement.TryGetProperty("candidates", out var arr) && arr.ValueKind == JsonValueKind.Array)
                        foreach (var e in arr.EnumerateArray()) if (e.TryGetProperty("url", out var u) && u.GetString() is { } c) candidates.Add(c);
                }
            }
            foreach (var c in candidates)
            {
                try
                {
                    if (!c.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) continue;
                    var bytes = await Http.GetByteArrayAsync(c);
                    if (bytes.Length < 64 || bytes[0] == (byte)'<' || bytes[0] == (byte)'{') continue;
                    await File.WriteAllBytesAsync(markPath, bytes);
                    return new(markPath, name, MetaBg(id));
                }
                catch { /* next */ }
            }
            File.WriteAllText(nonePath, "");
        }
        catch { }
        return await GetAsync(id, name, url);
    }

    private string? MetaBg(string id)
    {
        try
        {
            if (!File.Exists(MetaPath(id))) return null;
            using var d = JsonDocument.Parse(File.ReadAllText(MetaPath(id)));
            return d.RootElement.TryGetProperty("bg", out var b) ? b.GetString() : null;
        }
        catch { return null; }
    }

    private sealed record Plan(string? ManifestUrl, List<string> Candidates, string? Bg);

    private async Task<Plan?> PlanAsync(string name, string url, string html, string? manifestJson)
    {
        var js = "PrismRuntime.posterPlan(" + JsonSerializer.Serialize(name) + "," + JsonSerializer.Serialize(url) + ","
               + JsonSerializer.Serialize(html) + "," + (manifestJson is null ? "null" : JsonSerializer.Serialize(manifestJson)) + ")";
        var raw = await _brain.EvalAsync(js);
        if (raw is null || raw == "null") return null;
        string inner;
        using (var outer = JsonDocument.Parse(raw))
        {
            if (outer.RootElement.ValueKind != JsonValueKind.String) return null;
            inner = outer.RootElement.GetString()!;
        }
        using var doc = JsonDocument.Parse(inner);
        var root = doc.RootElement;
        var candidates = new List<string>();
        if (root.TryGetProperty("candidates", out var arr) && arr.ValueKind == JsonValueKind.Array)
            foreach (var e in arr.EnumerateArray())
                if (e.TryGetProperty("url", out var u) && u.GetString() is { } s) candidates.Add(s);
        var manifest = root.TryGetProperty("manifestUrl", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
        string? bg = null;
        if (root.TryGetProperty("wordmark", out var w) && w.TryGetProperty("background", out var b)) bg = b.GetString();
        return new Plan(manifest, candidates, bg);
    }
}
