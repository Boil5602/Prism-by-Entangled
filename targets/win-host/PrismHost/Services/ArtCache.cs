using System.Security.Cryptography;
using System.Text;

namespace PrismHost.Services;

/// <summary>
/// Card artwork kept on the device (2026-09-25, "That slow poster loading at launch, i'm surprised we dont have some faster cached load available"):
/// every Watch card's picture had been fetched from its service's image server again at each start. The first sight of a picture saves it here;
/// every later start draws it from the disk. A plain GET with no cookies and no identifiers (spec 19/22), the same request the image itself would
/// make; only raster images are kept; the oldest go once the folder passes its size.
/// </summary>
internal static class ArtCache
{
    private static readonly HttpClient Http = MakeHttp();
    private static HttpClient MakeHttp()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        // a picture asked for as a picture (2026-09-29: a channel logo's CDN answered 406 Not Acceptable to a bare request, 42 times in an
        // evening, once every draw); nothing about the device goes with it
        h.DefaultRequestHeaders.Accept.ParseAdd("image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.5");
        // named as itself, never as a browser (third-party policy: no disguises); a request with no user agent at all is what some CDNs refuse
        try { h.DefaultRequestHeaders.UserAgent.ParseAdd("Prism/" + AppVersion.Text.Split('+')[0].Split(' ')[0]); } catch { }
        return h;
    }
    /// <summary>A fetch that failed is not asked again for an hour (a person's pace: the picture is drawn from its address meanwhile).</summary>
    private static readonly Dictionary<string, DateTime> FailedAt = new();
    private static readonly string Dir = Path.Combine(HostPaths.DataDir, "art-cache");
    private static readonly HashSet<string> Fetching = new();
    private const long MaxBytes = 400L * 1024 * 1024;
    private const int MaxBytesOne = 8 * 1024 * 1024;

    private static string PathFor(string url)
    {
        var h = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(url))).ToLowerInvariant();
        return Path.Combine(Dir, h + ".img");
    }

    /// <summary>The picture's address to draw from: the kept file when there is one, else the address itself (and it is kept for next time).</summary>
    public static Uri UriFor(string url)
    {
        if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) return new Uri(url);
        try
        {
            var p = PathFor(url);
            if (File.Exists(p)) return new Uri(p);
            _ = KeepAsync(url, p);
        }
        catch { }
        return new Uri(url);
    }

    private static async Task KeepAsync(string url, string p)
    {
        lock (Fetching) { if (!Fetching.Add(p)) return; }
        lock (FailedAt) { if (FailedAt.TryGetValue(p, out var at) && DateTime.UtcNow - at < TimeSpan.FromHours(1)) { lock (Fetching) Fetching.Remove(p); return; } }
        var ok = false;
        try
        {
            Directory.CreateDirectory(Dir);
            var bytes = await Http.GetByteArrayAsync(url);
            ok = true;
            if (bytes.Length < 64 || bytes.Length > MaxBytesOne || bytes[0] == (byte)'<' || bytes[0] == (byte)'{') return;   // not a raster image
            var tmp = p + ".part";
            await File.WriteAllBytesAsync(tmp, bytes);
            File.Move(tmp, p, true);
        }
        catch { /* drawn from the address this time; kept another time */ }
        finally { if (!ok) lock (FailedAt) FailedAt[p] = DateTime.UtcNow; lock (Fetching) Fetching.Remove(p); }
    }

    /// <summary>At start: the oldest kept pictures go once the folder is past its size.</summary>
    public static void Prune()
    {
        try
        {
            if (!Directory.Exists(Dir)) return;
            var files = new DirectoryInfo(Dir).GetFiles("*.img").OrderByDescending(f => f.LastWriteTimeUtc).ToList();
            long total = 0;
            foreach (var f in files) { total += f.Length; if (total > MaxBytes) { try { f.Delete(); } catch { } } }
            foreach (var part in new DirectoryInfo(Dir).GetFiles("*.part")) { try { part.Delete(); } catch { } }
        }
        catch { }
    }
}
