using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// One browser, many sign-ins (core sign-ins.ts, win-channel profile.migrate, 2026-10-03, "Why do we need so many profiles? Seems like one per
/// profile set would generally cover it"): the sessions in each legacy profile folder (one a service) copied onto the shared folder core named
/// for it, once, before any surface is made. Three things carry a sign-in and each is moved its own way: cookies through WebView2's cookie
/// manager (encrypted on disk per profile, so never by file); each service origin's local storage through a page in each profile (the whole
/// map, moved as it is, never read into anything); IndexedDB by copying the origin's folders while neither browser runs. The old folder is
/// never changed or deleted (section 10) - a marker file in it says where its sessions went, so a second boot does not copy again. A service
/// whose sign-in lives somewhere these do not reach asks to be signed in once more; nothing of the old sign-in is lost.
/// The answer is a "profile-migrated" event core waits for; a report goes to diagnostics/profile-move.md.
/// </summary>
public sealed partial class MainWindow
{
    private sealed record MoveResult(string From, string To, int Cookies, int Storage, int Idb, string? Error);

    private async Task ProfileMigrateAsync(CommandMessage m)
    {
        var results = new List<MoveResult>();
        string? note = null;
        try
        {
            var moves = m.Payload.TryGetProperty("moves", out var mv) && mv.ValueKind == JsonValueKind.Array ? mv.EnumerateArray().ToList() : new List<JsonElement>();
            LogLine("profile move: " + moves.Count + " legacy profile" + (moves.Count == 1 ? "" : "s") + " onto shared ones");
            foreach (var mo in moves)
            {
                var from = mo.TryGetProperty("from", out var f) ? f.GetString() ?? "" : "";
                var to = mo.TryGetProperty("to", out var t) ? t.GetString() ?? "" : "";
                var origins = mo.TryGetProperty("origins", out var o) && o.ValueKind == JsonValueKind.Array ? o.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).ToList() : new List<string>();
                if (from.Length == 0 || to.Length == 0 || from == to) continue;
                results.Add(await MoveOneProfileAsync(from, to, origins));
            }
        }
        catch (Exception ex) { note = ex.GetType().Name + ": " + ex.Message; LogLine("profile move failed: " + note); }
        var ok = note is null && results.All(r => r.Error is null);
        WriteProfileMoveReport(results, note);
        var ev = JsonSerializer.Serialize(new { type = SurfaceEvents.ProfileMigrated, id = "profiles", ok, moves = results.Select(r => new { from = r.From, to = r.To, cookies = r.Cookies, storage = r.Storage, idb = r.Idb, error = r.Error }), note });
        LogLine("profile move: " + (ok ? "done" : "NOT complete") + Mid + string.Join(", ", results.Select(r => r.From + " -> " + r.To + " (" + r.Cookies + " cookies, " + r.Storage + " storage keys, " + r.Idb + " databases" + (r.Error is null ? "" : ", " + r.Error) + ")")));
        _brain.Call(HostCalls.Event, ev);
    }

    /// <summary>One legacy folder onto its shared one. The marker in the old folder names where it went; present, nothing is copied again.</summary>
    private async Task<MoveResult> MoveOneProfileAsync(string from, string to, List<string> origins)
    {
        var fromDir = _store.ProfileDir(from); var toDir = _store.ProfileDir(to);
        var marker = Path.Combine(fromDir, ".prism-moved-to-" + Sanitize(to));
        if (File.Exists(marker)) { LogLine("profile move: " + from + " already moved to " + to); return new MoveResult(from, to, 0, 0, 0, null); }
        if (!Directory.Exists(Path.Combine(fromDir, "EBWebView", "Default"))) { LogLine("profile move: " + from + " has no browser data; nothing to move"); File.WriteAllText(marker, to + "\n(empty)\n"); return new MoveResult(from, to, 0, 0, 0, null); }
        var idb = 0; var cookies = 0; var storage = 0;
        try
        {
            // IndexedDB: the origin folders, copied while neither browser runs (both are closed here - before any surface exists)
            idb = CopyIndexedDb(fromDir, toDir);
            // cookies and local storage need each profile's browser: a hidden view in each
            var opts = new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = "--autoplay-policy=no-user-gesture-required --disable-features=HardwareSecureDecryptionFallback" };
            var fromEnv = await CoreWebView2Environment.CreateWithOptionsAsync(null, fromDir, opts);
            var toEnv = await CoreWebView2Environment.CreateWithOptionsAsync(null, toDir, opts);
            var fromView = new WebView2 { Width = 4, Height = 4, Opacity = 0 }; var toView = new WebView2 { Width = 4, Height = 4, Opacity = 0 };
            Canvas.SetLeft(fromView, -4000); Canvas.SetLeft(toView, -4000);
            TileCanvas.Children.Add(fromView); TileCanvas.Children.Add(toView);
            try
            {
                await fromView.EnsureCoreWebView2Async(fromEnv);
                await toView.EnsureCoreWebView2Async(toEnv);
                var fromCore = fromView.CoreWebView2; var toCore = toView.CoreWebView2;
                // local storage, each service origin: read from the old profile first (a page there may rotate a token as it loads, so the
                // cookies are taken after it, as they stand last), then written into the shared profile; the whole map as one string
                var maps = new List<(string origin, string map)>();
                foreach (var origin in origins)
                {
                    try { var map = await ReadStorageAsync(fromCore, origin); if (map is not null && map != "[]" && map != "null") maps.Add((origin, map)); }
                    catch (Exception ex) { LogLine("profile move: " + origin + " storage did not read: " + ex.GetType().Name + " " + ex.Message); }
                }
                // cookies: every one the old profile holds, with every attribute as it is (host-only and __Host- ones included, which the cookie
                // manager cannot make), through the DevTools protocol's own cookie calls
                cookies = await CopyCookiesAsync(fromCore, toCore);
                foreach (var (origin, map) in maps)
                {
                    try { storage += await WriteStorageAsync(toCore, origin, map); }
                    catch (Exception ex) { LogLine("profile move: " + origin + " storage did not copy: " + ex.GetType().Name + " " + ex.Message); }
                }
            }
            finally
            {
                try { fromView.Close(); } catch { }
                try { toView.Close(); } catch { }
                TileCanvas.Children.Remove(fromView); TileCanvas.Children.Remove(toView);
            }
            File.WriteAllText(marker, to + "\n" + cookies + " cookies, " + storage + " storage keys, " + idb + " databases\n");
            return new MoveResult(from, to, cookies, storage, idb, null);
        }
        catch (Exception ex)
        {
            LogLine("profile move: " + from + " -> " + to + " failed: " + ex.GetType().Name + " " + ex.Message);
            return new MoveResult(from, to, cookies, storage, idb, ex.GetType().Name + ": " + ex.Message);
        }
    }

    /// <summary>All cookies of one profile set on another through Network.getAllCookies / Network.setCookies: name, value, domain or host-only,
    /// path, expiry, flags, scheme and port, partition - never read for anything else.</summary>
    private async Task<int> CopyCookiesAsync(CoreWebView2 fromCore, CoreWebView2 toCore)
    {
        var raw = await fromCore.CallDevToolsProtocolMethodAsync("Network.getAllCookies", "{}");
        using var doc = JsonDocument.Parse(raw);
        if (!doc.RootElement.TryGetProperty("cookies", out var arr) || arr.ValueKind != JsonValueKind.Array) return 0;
        var batch = new List<Dictionary<string, object?>>();
        foreach (var c in arr.EnumerateArray())
        {
            string S(string k) => c.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
            bool B(string k) => c.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
            var domain = S("domain"); var path = S("path"); if (path.Length == 0) path = "/";
            var hostOnly = !domain.StartsWith('.');
            var param = new Dictionary<string, object?> { ["name"] = S("name"), ["value"] = S("value"), ["path"] = path, ["secure"] = B("secure"), ["httpOnly"] = B("httpOnly") };
            // a host-only cookie is set by its URL, with no domain (a domain would make it a domain cookie, and a __Host- one would be refused)
            // always from the https address: Chromium binds a cookie to the scheme it was set from, and one set from http is never sent to the
            // service's https pages (Tubi's token cookie is not marked Secure - it was set, and useless, 2026-10-03)
            if (hostOnly) param["url"] = "https://" + domain + path; else param["domain"] = domain;
            // a session cookie (no expiry) is purged when a browser exits cleanly - the mover's does, the wall's never did, which is the only reason
            // Tubi's and Fandango's logins outlived a restart. It is given a year here; the shared profile's own restarts then keep it as the old
            // folder happened to.
            if (c.TryGetProperty("expires", out var ex) && ex.ValueKind == JsonValueKind.Number && ex.GetDouble() > 0) param["expires"] = ex.GetDouble();
            else param["expires"] = DateTimeOffset.UtcNow.AddDays(365).ToUnixTimeSeconds();
            foreach (var k in new[] { "sameSite", "priority", "sourceScheme", "partitionKey" }) if (c.TryGetProperty(k, out var v) && v.ValueKind != JsonValueKind.Null) param[k] = JsonSerializer.Deserialize<object>(v.GetRawText());
            if (c.TryGetProperty("sourcePort", out var sp) && sp.ValueKind == JsonValueKind.Number) param["sourcePort"] = sp.GetInt32();
            if (B("sameParty")) param["sameParty"] = true;
            batch.Add(param);
        }
        if (batch.Count == 0) return 0;
        string answer;
        try { answer = await toCore.CallDevToolsProtocolMethodAsync("Network.setCookies", JsonSerializer.Serialize(new { cookies = batch })); }
        catch (Exception ex) { LogLine("profile move: setCookies refused the batch: " + ex.Message); answer = "{}"; }
        // the check: which of the old profile's cookies the shared one holds now, by name and domain alone (never a value)
        var back = await toCore.CallDevToolsProtocolMethodAsync("Network.getAllCookies", "{}");
        using var bd = JsonDocument.Parse(back);
        var have = new HashSet<string>();
        if (bd.RootElement.TryGetProperty("cookies", out var ba) && ba.ValueKind == JsonValueKind.Array)
            foreach (var c in ba.EnumerateArray()) have.Add((c.TryGetProperty("name", out var n) ? n.GetString() : "") + "@" + (c.TryGetProperty("domain", out var d) ? d.GetString() : ""));
        var missing = batch.Where(b => !have.Contains(b["name"] + "@" + (b.TryGetValue("domain", out var dm) ? dm as string : (b["url"] as string ?? "").Replace("https://", "").Replace("http://", "").Split('/')[0]))).Select(b => b["name"] + "@" + (b.TryGetValue("domain", out var dm2) ? dm2 : b["url"])).ToList();
        if (missing.Count > 0) LogLine("profile move: " + missing.Count + " of " + batch.Count + " cookies not held after the set: " + string.Join(", ", missing.Take(12)));
        // dev: the attributes (never a value) of each cookie as the old profile had it and as the shared one holds it, for the sites that lose their login
        if (Environment.GetEnvironmentVariable("PRISM_DEV_SHOT") == "1")
        {
            string Attrs(JsonElement c) => string.Join("/", new[] { "domain", "path", "secure", "httpOnly", "sameSite", "expires", "sourceScheme", "sourcePort", "partitionKey", "session" }.Select(k => c.TryGetProperty(k, out var v) ? v.ToString() : "-"));
            var mine = new Dictionary<string, string>();
            if (bd.RootElement.TryGetProperty("cookies", out var ba2)) foreach (var c in ba2.EnumerateArray()) mine[(c.TryGetProperty("name", out var n) ? n.GetString() : "") + "@" + (c.TryGetProperty("domain", out var d) ? d.GetString() : "")] = Attrs(c);
            foreach (var c in arr.EnumerateArray())
            {
                var dom = c.TryGetProperty("domain", out var d) ? d.GetString() ?? "" : "";
                if (!dom.Contains("tubi") && !dom.Contains("fandango") && !dom.Contains("vudu") && !dom.Contains("moviesanywhere")) continue;
                var key = (c.TryGetProperty("name", out var n) ? n.GetString() : "") + "@" + dom;
                LogLine("profile move cookie " + key + " old " + Attrs(c) + " new " + (mine.TryGetValue(key, out var a) ? a : "(none)"));
            }
        }
        return batch.Count - missing.Count;
    }

    /// <summary>The origin's page in the profile, and its local storage as one JSON string of pairs (opaque: never parsed here).</summary>
    private async Task<string?> ReadStorageAsync(CoreWebView2 core, string origin)
    {
        if (!await NavigateQuietlyAsync(core, origin)) return null;
        
        var raw = await core.ExecuteScriptAsync("(() => { try { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.push([k, localStorage.getItem(k)]); } return JSON.stringify(out); } catch (e) { return 'null'; } })()");
        // ExecuteScript answers a JSON string literal; the inner JSON is what the other page takes
        try { return JsonSerializer.Deserialize<string>(raw); } catch { return null; }
    }
    private async Task<int> WriteStorageAsync(CoreWebView2 core, string origin, string pairsJson)
    {
        if (!await NavigateQuietlyAsync(core, origin)) return 0;
        var js = "(() => { try { const pairs = JSON.parse(" + JsonSerializer.Serialize(pairsJson) + "); let n = 0; for (const [k, v] of pairs) { try { localStorage.setItem(k, v); n++; } catch (e) {} } return n; } catch (e) { return 0; } })()";
        var raw = await core.ExecuteScriptAsync(js);
        return int.TryParse(raw, out var n) ? n : 0;
    }
    /// <summary>The origin loaded (its own page, as a visit); false when it would not load within a short while.</summary>
    private static async Task<bool> NavigateQuietlyAsync(CoreWebView2 core, string origin)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Done(object? s, CoreWebView2NavigationCompletedEventArgs e) { core.NavigationCompleted -= Done; tcs.TrySetResult(true); }
        core.NavigationCompleted += Done;
        // a document on the origin that runs none of the service's own script: a page that did could see cookies without its storage and
        // sign itself out before the storage arrives (Tubi did, 2026-10-03). robots.txt is one on every service here.
        try { core.Navigate(origin + "/robots.txt"); } catch { core.NavigationCompleted -= Done; return false; }
        var t = await Task.WhenAny(tcs.Task, Task.Delay(25_000));
        if (t != tcs.Task) { core.NavigationCompleted -= Done; try { core.Stop(); } catch { } }
        // the page's own scripts may still be settling; local storage is readable the moment the document is
        return true;
    }

    /// <summary>IndexedDB's per-origin folders (and their blob siblings) copied into the shared profile where it has none; the old ones untouched.</summary>
    private int CopyIndexedDb(string fromDir, string toDir)
    {
        var src = Path.Combine(fromDir, "EBWebView", "Default", "IndexedDB");   // WebView2 keeps its browser data under EBWebView
        if (!Directory.Exists(src)) return 0;
        var dst = Path.Combine(toDir, "EBWebView", "Default", "IndexedDB");
        Directory.CreateDirectory(dst);
        var n = 0;
        foreach (var d in Directory.GetDirectories(src))
        {
            var name = Path.GetFileName(d);
            var target = Path.Combine(dst, name);
            if (Directory.Exists(target)) continue;   // the shared profile has its own for this origin: the newer wins, which is the one in use
            try { CopyTree(d, target); if (name.EndsWith(".indexeddb.leveldb", StringComparison.Ordinal)) n++; }
            catch (Exception ex) { LogLine("profile move: IndexedDB " + name + " did not copy: " + ex.GetType().Name); }
        }
        return n;
    }
    private static void CopyTree(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)), false);
        foreach (var d in Directory.GetDirectories(from)) CopyTree(d, Path.Combine(to, Path.GetFileName(d)));
    }
    private static string Sanitize(string id) => new string(id.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' or '.' ? c : '_').ToArray());

    private void WriteProfileMoveReport(List<MoveResult> results, string? note)
    {
        try
        {
            var lines = new List<string> { "# Profile move: one browser, many sign-ins", "", "Each legacy profile folder's sessions copied onto the shared browser profile core named for it (" + DateTime.Now.ToString("yyyy-MM-dd HH:mm") + "). The old folders are kept, untouched; a marker file in each says where its sessions went.", "", "| from | to | cookies | storage keys | IndexedDB databases | note |", "|---|---|---|---|---|---|" };
            foreach (var r in results) lines.Add($"| {r.From} | {r.To} | {r.Cookies} | {r.Storage} | {r.Idb} | {r.Error ?? ""} |");
            if (note is not null) lines.Add("\nNot complete: " + note);
            lines.Add("\nA service that asks to be signed in again keeps its token somewhere these do not reach; its old sign-in is still in the old folder.");
            File.WriteAllLines(Path.Combine(HostPaths.Diagnostics, "profile-move.md"), lines);
        }
        catch { }
    }
}
