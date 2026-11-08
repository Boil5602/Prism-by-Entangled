using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace PrismHost.Services;

/// <summary>The break watch pack (docs/features/break-watch-packs.md; first cut 2026-11-07): the learned model, the picture network and the
/// ad catalog as signed data, the newer of the pack bundled with the install (Assets/breakwatch/pack) and the one downloaded (with the
/// person's one opt-in, once a day) by its serial. Every pack is verified the same way: the pack key over pack.json's exact bytes
/// (ECDSA P-256 / SHA-256, raw r||s, as the update manifest), every named file against its sha256, and its minPrism against this build.
/// A pack that fails is refused whole and the held one stays. Nothing in a pack runs as code; the readers refuse fields they do not know.</summary>
public static class BreakPack
{
    public const string DefaultUrl = "https://prism.entangled.world/breakwatch/pack.json";
    /// <summary>The pack key's public half (its own key, never the update key; a fork sets its own beside its own address).</summary>
    public const string DefaultKey = "{\"kty\":\"EC\",\"x\":\"LrWgoxu5PyGer3kYoG6IbqfUUy9enje0FZFh5JaBaFA\",\"y\":\"1OHpA5kQ0lZfWNgrtEeo1s-6rOGjSy-kqiSiEcf9T5Y\",\"crv\":\"P-256\"}";
    public static string Url { get => HostPrefs.GetString("pack.url", DefaultUrl); set => HostPrefs.Set("pack.url", value.Trim()); }
    public static string Key { get => HostPrefs.GetString("pack.key", DefaultKey); set => HostPrefs.Set("pack.key", value.Trim()); }
    /// <summary>The one opt-in (decision 2026-11-07): off, nothing is fetched and the bundled pack alone is used.</summary>
    public static bool Enabled { get => HostPrefs.GetBool("video.adCoverUpdates", false); set => HostPrefs.Set("video.adCoverUpdates", value); }

    public static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Prism", "breakwatch-pack");
    public static string BundledDir => Path.Combine(AppContext.BaseDirectory, "Assets", "breakwatch", "pack");

    public sealed record Pack(string Serial, string Date, string Notes, string Dir, string Source, string? ModelPath, string? PictureNetPath, string? PrintsPath, int Files)
    {
        public string Line => "pack " + Serial + " (" + Source + (string.IsNullOrEmpty(Date) ? "" : ", " + Date) + ")";
    }

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(60) };
    static BreakPack() { Http.DefaultRequestHeaders.UserAgent.ParseAdd("Prism/" + AppVersion.Text); }

    /// <summary>The pack in force: the newer by serial of the bundled and the downloaded, each verified; null with neither.</summary>
    public static Pack? Held(Action<string>? log = null)
    {
        var a = Read(BundledDir, "installed", log);
        var b = Read(Dir, "downloaded", log);
        if (a is null) return b;
        if (b is null) return a;
        return Newer(b.Serial, a.Serial) ? b : a;
    }

    /// <summary>"YYYY-MM-DD.N": later day, then higher count.</summary>
    public static bool Newer(string x, string y)
    {
        static (string, int) Split(string s) { var i = s.LastIndexOf('.'); return i < 0 ? (s, 0) : (s[..i], int.TryParse(s[(i + 1)..], out var n) ? n : 0); }
        var (dx, nx) = Split(x ?? ""); var (dy, ny) = Split(y ?? "");
        var c = string.CompareOrdinal(dx, dy);
        return c != 0 ? c > 0 : nx > ny;
    }

    private static bool VersionAtLeast(string have, string need)
    {
        static int[] P(string v) => (v ?? "").Split('-')[0].Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();
        var h = P(have); var n = P(need);
        for (var i = 0; i < Math.Max(h.Length, n.Length); i++)
        {
            var a = i < h.Length ? h[i] : 0; var b = i < n.Length ? n[i] : 0;
            if (a != b) return a > b;
        }
        return true;
    }

    /// <summary>A folder holding pack.json, pack.sig and files/: the pack if it verifies, else null (the reason logged once per folder).</summary>
    public static Pack? Read(string dir, string source, Action<string>? log)
    {
        try
        {
            var pj = Path.Combine(dir, "pack.json"); var ps = Path.Combine(dir, "pack.sig");
            if (!File.Exists(pj) || !File.Exists(ps)) return null;
            var bytes = File.ReadAllBytes(pj);
            if (!Updates.Verify(bytes, File.ReadAllText(ps).Trim(), Key)) { Say(log, dir, "its signature does not match the pack key"); return null; }
            using var doc = JsonDocument.Parse(bytes);
            var r = doc.RootElement;
            if (!r.TryGetProperty("format", out var f) || f.GetInt32() != 1) { Say(log, dir, "a format this build does not read"); return null; }
            var serial = r.GetProperty("pack").GetString() ?? "";
            var minPrism = r.TryGetProperty("minPrism", out var mp) ? mp.GetString() ?? "" : "";
            if (minPrism.Length > 0 && !VersionAtLeast(AppVersion.Text, minPrism)) { Say(log, dir, "it needs Prism " + minPrism); return null; }
            string? Part(JsonElement e)
            {
                var file = e.GetProperty("file").GetString() ?? ""; var sha = e.GetProperty("sha256").GetString() ?? "";
                if (file.Contains("..") || file.StartsWith('/') || file.StartsWith('\\')) throw new InvalidDataException("a file path outside the pack");
                var full = Path.Combine(dir, file.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(full)) throw new FileNotFoundException(file);
                if (!string.Equals(Sha256(full), sha, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException(file + " does not match its hash");
                return full;
            }
            string? model = null, net = null, prints = null; var n = 0;
            if (r.TryGetProperty("models", out var models) && models.TryGetProperty("prism", out var prism)) { model = Part(prism); n++; }
            if (r.TryGetProperty("pictureNet", out var pn)) { net = Part(pn); n++; }
            if (r.TryGetProperty("prints", out var pr)) { prints = Part(pr); n++; }
            var date = r.TryGetProperty("date", out var d) ? d.GetString() ?? "" : "";
            var notes = r.TryGetProperty("notes", out var no) ? no.GetString() ?? "" : "";
            return new Pack(serial, date, notes, dir, source, model, net, prints, n);
        }
        catch (Exception ex) { Say(log, dir, ex.Message); return null; }
    }

    private static readonly HashSet<string> s_said = new(StringComparer.OrdinalIgnoreCase);
    private static void Say(Action<string>? log, string dir, string why)
    {
        if (log is null || !s_said.Add(dir + "|" + why)) return;
        log("break watch pack: the one at " + dir + " is refused: " + why);
    }

    private static string Sha256(string path)
    {
        using var s = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(s)).ToLowerInvariant();
    }

    /// <summary>One check (the opt-in on): pack.json and pack.sig from the address, If-None-Match with the server's ETag, verified before
    /// anything is kept; the files it names are fetched only when their hashes are new. True when a newer pack than the held one is now
    /// in Dir, ready to apply.</summary>
    public static async Task<bool> CheckAsync(Action<string> log)
    {
        if (!Enabled) return false;
        try
        {
            Directory.CreateDirectory(Path.Combine(Dir, "files"));
            var url = Url; var baseUrl = url[..(url.LastIndexOf('/') + 1)]; var sigUrl = url.EndsWith(".json", StringComparison.OrdinalIgnoreCase) ? url[..^5] + ".sig" : url + ".sig";
            var etagPath = Path.Combine(Dir, "etag.txt");
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            if (File.Exists(etagPath)) { var et = File.ReadAllText(etagPath).Trim(); if (et.Length > 0) req.Headers.TryAddWithoutValidation("If-None-Match", et); }
            using var res = await Http.SendAsync(req);
            if (res.StatusCode == System.Net.HttpStatusCode.NotModified) return false;
            if (!res.IsSuccessStatusCode) { log("break watch pack: the server answered " + (int)res.StatusCode); return false; }
            var bytes = await res.Content.ReadAsByteArrayAsync();
            var sig = (await Http.GetStringAsync(sigUrl)).Trim();
            if (!Updates.Verify(bytes, sig, Key)) { log("break watch pack: the signature does not match the pack key - refused"); return false; }
            string serial; List<(string File, string Sha)> files = new();
            using (var doc = JsonDocument.Parse(bytes))
            {
                var r = doc.RootElement;
                if (!r.TryGetProperty("format", out var f) || f.GetInt32() != 1) { log("break watch pack: a format this build does not read"); return false; }
                serial = r.GetProperty("pack").GetString() ?? "";
                var minPrism = r.TryGetProperty("minPrism", out var mp) ? mp.GetString() ?? "" : "";
                if (minPrism.Length > 0 && !VersionAtLeast(AppVersion.Text, minPrism)) { log("break watch pack " + serial + " needs Prism " + minPrism + "; kept for a later version"); return false; }
                void Add(JsonElement e) { var fl = e.GetProperty("file").GetString() ?? ""; var sh = e.GetProperty("sha256").GetString() ?? ""; if (fl.Length > 0 && sh.Length > 0) files.Add((fl, sh)); }
                if (r.TryGetProperty("models", out var models)) foreach (var m in models.EnumerateObject()) Add(m.Value);
                if (r.TryGetProperty("pictureNet", out var pn)) Add(pn);
                if (r.TryGetProperty("prints", out var pr)) Add(pr);
            }
            var held = Held(log);
            if (held is not null && !Newer(serial, held.Serial))
            {
                if (res.Headers.ETag is { } tag0) File.WriteAllText(etagPath, tag0.ToString());
                return false;
            }
            foreach (var (file, sha) in files)
            {
                if (file.Contains("..") || !file.StartsWith("files/", StringComparison.Ordinal)) { log("break watch pack " + serial + ": a file path outside the pack - refused"); return false; }
                var full = Path.Combine(Dir, file.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(full) && string.Equals(Sha256(full), sha, StringComparison.OrdinalIgnoreCase)) continue;
                var data = await Http.GetByteArrayAsync(baseUrl + file);
                var got = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
                if (!string.Equals(got, sha, StringComparison.OrdinalIgnoreCase)) { log("break watch pack " + serial + ": " + file + " does not match its hash - refused"); return false; }
                Directory.CreateDirectory(Path.GetDirectoryName(full)!);
                var tmp = full + ".part"; File.WriteAllBytes(tmp, data); File.Move(tmp, full, true);
            }
            var pj = Path.Combine(Dir, "pack.json"); var ps = Path.Combine(Dir, "pack.sig");
            File.WriteAllBytes(pj + ".part", bytes); File.WriteAllText(ps + ".part", sig);
            File.Move(ps + ".part", ps, true); File.Move(pj + ".part", pj, true);
            if (res.Headers.ETag is { } tag) File.WriteAllText(etagPath, tag.ToString());
            var now = Read(Dir, "downloaded", log);
            if (now is null) { log("break watch pack " + serial + ": downloaded but does not verify as a whole - not used"); return false; }
            log("break watch pack " + serial + " downloaded (" + now.Files + " files); applied when no cover is up");
            return true;
        }
        catch (Exception ex) { log("break watch pack: the check failed: " + ex.Message); return false; }
    }
}
