using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PrismHost.Services;

/// <summary>
/// Updates for Prism on Windows (docs/features/updates.md, dashboard-schema §28; 2026-10-05, "an auto-update mechanism with a server
/// address so the user can choose to update from there ... if someone forked and set up their own environment, they would set the
/// server address"). Core owns the policy (when to check, what is newer, the night window); this is the bytes:
///   - the manifest fetched at exactly the configured address (no query, no identifying header) and its signature beside it
///     (manifest.sig, ECDSA P-256 over the manifest bytes) checked against the configured public key - a manifest that does not
///     verify is refused, so a fork's Prism takes only its own releases and ours takes only ours;
///   - a release downloaded to the data folder, its SHA-256 compared with the manifest's, unpacked beside the running version under
///     the data folder's app\, and recorded as the current one; the running process is never overwritten;
///   - at the next start the older exe hands off to the newest unpacked version (HandOffIfNewer) - the person's shortcut keeps working.
/// Sign-ins and settings live in the data folder and are not touched (§10). Settings: update.url, update.key (a public JWK), update.channel,
/// in host prefs; the defaults are Entangled's. Empty key = no signature check (a fork testing locally), said in the log.
/// </summary>
public static class Updates
{
    public const string DefaultUrl = "https://prism.entangled.world/windows/manifest.json";
    public const string DefaultKey = "{\"kty\":\"EC\",\"x\":\"4-m00p3jr4DQgOOqAz_uwcW8uU--yV8T0y9zIJaruLY\",\"y\":\"eDH7lZDLov5b19QF0gXePCP67zmnpqZN9HKE_2nEoek\",\"crv\":\"P-256\"}";

    public static string Url { get => HostPrefs.GetString("update.url", DefaultUrl); set => HostPrefs.Set("update.url", value.Trim()); }
    public static string Key { get => HostPrefs.GetString("update.key", DefaultKey); set => HostPrefs.Set("update.key", value.Trim()); }
    /// <summary>The track this build is published on (2026-10-05, "I would call this current track Alpha. And we'll work toward beta and full"):
    /// alpha while Prism is built, beta for the candidate, stable for the full release. A Prism follows the track it was built for unless the
    /// person picks another in the Updates dialog.</summary>
    public const string BuildTrack = "alpha";
    public static string Channel { get => AsTrack(HostPrefs.GetString("update.channel", BuildTrack)); set => HostPrefs.Set("update.channel", AsTrack(value)); }
    public static string AsTrack(string? v) => v is "alpha" or "beta" or "stable" ? v : BuildTrack;
    /// <summary>The track's name as a person reads it: Alpha, Beta, Full.</summary>
    public static string TrackLabel(string ch) => ch == "alpha" ? "Alpha" : ch == "beta" ? "Beta" : "Full";
    /// <summary>True when the address or the key is not Entangled's: a fork's Prism, or one someone pointed elsewhere.</summary>
    public static bool ServerIsCustom => Url != DefaultUrl || Key != DefaultKey;
    public static bool Enabled { get => HostPrefs.GetBool("update.enabled", true); set => HostPrefs.Set("update.enabled", value); }
    /// <summary>When the check runs (2026-10-06, "Let the user check for updates at a scheduled time"): a time of day on the PC's clock, "HH:MM"
    /// (04:00 unless chosen), and for a weekly check the day (0 Sunday to 6 Saturday; -1 every day).</summary>
    public static string CheckAt { get => HostPrefs.GetString("update.at", "04:00"); set => HostPrefs.Set("update.at", value); }
    public static int CheckWeekday { get => (int)HostPrefs.GetDouble("update.weekday", -1); set => HostPrefs.Set("update.weekday", (double)value); }
    /// <summary>The schedule as core takes it.</summary>
    public static object Schedule => CheckWeekday is >= 0 and <= 6 ? new { at = CheckAt, weekday = CheckWeekday } : new { at = CheckAt, weekday = (int?)null };

    /// <summary>The version alone ("0.22.0"), without the commit or the debug mark.</summary>
    public static string CurrentVersion
    {
        get
        {
            var t = AppVersion.Text;
            var cut = t.IndexOfAny(new[] { '+', ' ' });
            return cut < 0 ? t : t[..cut];
        }
    }

    public static string AppRoot => Path.Combine(HostPaths.DataDir, "app");
    private static string CurrentFile => Path.Combine(AppRoot, "current.json");

    private static readonly HttpClient Http = MakeHttp();
    private static HttpClient MakeHttp()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        try { h.DefaultRequestHeaders.UserAgent.ParseAdd("Prism/" + CurrentVersion); } catch { }
        return h;
    }

    /// <summary>core's update.fetchManifest: the text at the address, verified against the key beside it; throws with the reason.</summary>
    public static async Task<string> FetchManifestAsync(string url, Action<string> log)
    {
        if (url.Contains('?') || url.Contains('#')) throw new InvalidOperationException("the update address carries a query, which §28 forbids");
        if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("the update address must be https");
        var text = await Http.GetStringAsync(url);
        var key = Key;
        if (string.IsNullOrWhiteSpace(key)) { log("updates: no key set, the manifest is taken unsigned"); return text; }
        var sigUrl = url.EndsWith(".json", StringComparison.OrdinalIgnoreCase) ? url[..^5] + ".sig" : url + ".sig";
        string sigText;
        try { sigText = (await Http.GetStringAsync(sigUrl)).Trim(); }
        catch (Exception ex) { throw new InvalidOperationException("the manifest's signature could not be read (" + sigUrl + "): " + ex.Message); }
        if (!Verify(Encoding.UTF8.GetBytes(text), sigText, key)) throw new InvalidOperationException("the manifest's signature does not match the update key - refused");
        return text;
    }

    /// <summary>ECDSA P-256 / SHA-256, the signature as raw r||s in base64 (what sign-manifest.mjs writes), the key a public JWK.</summary>
    public static bool Verify(byte[] data, string sigBase64, string jwk)
    {
        try
        {
            var j = JsonNode.Parse(jwk) as JsonObject;
            if (j is null || (j["kty"]?.GetValue<string>() ?? "") != "EC" || (j["crv"]?.GetValue<string>() ?? "") != "P-256") return false;
            static byte[] B64Url(string s) { s = s.Replace('-', '+').Replace('_', '/'); while (s.Length % 4 != 0) s += "="; return Convert.FromBase64String(s); }
            using var ecdsa = ECDsa.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = B64Url(j["x"]!.GetValue<string>()), Y = B64Url(j["y"]!.GetValue<string>()) } });
            return ecdsa.VerifyData(data, Convert.FromBase64String(sigBase64), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch { return false; }
    }

    // ---- the fixed install folder (2026-10-06, "build the fixed install folder and incremental updates"; PrismHost.Core UpdateInstaller)

    private static readonly string Ell = ((char)0x2026).ToString();

    /// <summary>Where Prism runs from, for good: %LOCALAPPDATA%\Programs\Prism (PRISM_INSTALL_DIR for a test). Apart from the data folder, so a
    /// reset to defaults never moves the program; the one path Windows' firewall rule names, so the rule is asked for once, not each update.</summary>
    public static string InstallDir
    {
        get
        {
            var env = Environment.GetEnvironmentVariable("PRISM_INSTALL_DIR");
            if (!string.IsNullOrWhiteSpace(env)) { try { return Path.GetFullPath(env.Trim()); } catch { } }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Prism");
        }
    }
    public static string InstallExe => Path.Combine(InstallDir, "PrismHost.exe");
    /// <summary>Given to the installed copy by the copy that installed it, with the folder it ran from: the first-run note (2026-10-06).</summary>
    public const string InstalledFromArg = "--prism-installed-from";
    /// <summary>The folder this copy was installed from, when the copy that installed it said so; null otherwise.</summary>
    public static string? InstalledFrom()
    {
        var a = Environment.GetCommandLineArgs().ToList();
        var i = a.IndexOf(InstalledFromArg);
        return i >= 0 && i + 1 < a.Count && a[i + 1].Length > 0 ? a[i + 1] : null;
    }
    /// <summary>Whether a folder is one of the update folders older Prisms unpacked under the data folder (removed, not the person's own).</summary>
    public static bool IsOldUpdateFolder(string dir) =>
        Path.GetFullPath(dir).StartsWith(Path.GetFullPath(AppRoot) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    private static Updating.UpdateInstaller Installer(Action<string> log) => new(InstallDir, Http, log);
    private static bool SelfTest => Environment.GetEnvironmentVariable("PRISM_UPDATE_SELFTEST") is { Length: > 0 };

    /// <summary>core's update.apply: the release staged whole in the install folder's next copy - from its file list when the manifest names
    /// one (only the changed files fetched, each checked against the signed list), else from the zip - and run at the next start or on
    /// Restart now. "staged", or "failed" with the reason logged. Progress goes to the status line.</summary>
    public static async Task<string> ApplyAsync(JsonObject release, Action<string> log, Action<string> status)
    {
        var version = release["version"]?.GetValue<string>() ?? "";
        var url = release["url"]?.GetValue<string>() ?? "";
        var sha = (release["sha256"]?.GetValue<string>() ?? "").Trim().ToLowerInvariant();
        var files = release["files"]?.GetValue<string>() ?? "";
        var filesSha = (release["filesSha256"]?.GetValue<string>() ?? "").Trim().ToLowerInvariant();
        if (version.Length == 0) { log("updates: the release names no version"); return "failed"; }
        var inst = Installer(log);
        if (inst.StagedVersion() == version) { log("updates: " + version + " was already staged and verified"); return "staged"; }
        var source = AppContext.BaseDirectory;
        if (files.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && filesSha.Length == 64)
        {
            try
            {
                status("Prism " + version + ": reading what changed" + Ell);
                var r = await inst.StageFromListAsync(version, files, filesSha, source, status);
                status("Prism " + version + " is ready: " + r.Downloaded + " changed files, " + (r.DownloadedBytes / 1048576.0).ToString("0.0") + " MB downloaded. It runs at the next start, or Restart now.");
                return "staged";
            }
            catch (Exception ex) { log("updates: " + version + " from its file list failed (" + ex.Message + "), taking the whole zip instead"); }
        }
        if (url.Length == 0 || sha.Length != 64) { log("updates: the release names no address or hash"); return "failed"; }
        if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) { log("updates: the release address is not https"); return "failed"; }
        try
        {
            var work = InstallDir + ".download";
            if (Directory.Exists(work)) Directory.Delete(work, true);
            Directory.CreateDirectory(work);
            var zip = Path.Combine(work, "Prism-" + version + ".zip");
            status("Prism " + version + ": downloading" + Ell);
            using (var res = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
            {
                res.EnsureSuccessStatusCode();
                var total = res.Content.Headers.ContentLength ?? -1;
                await using var src = await res.Content.ReadAsStreamAsync();
                await using var dst = File.Create(zip);
                var buf = new byte[1 << 16]; long got = 0; int n; var lastSaid = DateTime.UtcNow;
                while ((n = await src.ReadAsync(buf)) > 0)
                {
                    await dst.WriteAsync(buf.AsMemory(0, n)); got += n;
                    if ((DateTime.UtcNow - lastSaid).TotalSeconds >= 2) { lastSaid = DateTime.UtcNow; status("Prism " + version + ": downloading " + (got >> 20) + (total > 0 ? " of " + (total >> 20) + " MB" : " MB") + Ell); }
                }
            }
            status("Prism " + version + ": checking" + Ell);
            string actual;
            await using (var f = File.OpenRead(zip)) actual = Convert.ToHexString(await SHA256.HashDataAsync(f)).ToLowerInvariant();
            if (actual != sha) { log("updates: " + version + " hash mismatch (" + actual[..12] + " vs " + sha[..12] + ") - the file is not the release, deleted"); try { Directory.Delete(work, true); } catch { } return "failed"; }
            status("Prism " + version + ": unpacking" + Ell);
            var unpacked = Path.Combine(work, "unpacked");
            ZipFile.ExtractToDirectory(zip, unpacked);
            if (!File.Exists(Path.Combine(unpacked, "PrismHost.exe"))) { log("updates: " + version + " unpacked without PrismHost.exe - not a Prism release"); return "failed"; }
            inst.StageFromUnpacked(version, unpacked);
            try { Directory.Delete(work, true); } catch { }
            log("updates: " + version + " staged at " + inst.NextDir + " from the zip");
            status("Prism " + version + " is ready. It runs at the next start, or Restart now.");
            return "staged";
        }
        catch (Exception ex) { log("updates: " + version + " failed: " + ex.Message); status("Prism " + version + " could not be installed: " + ex.Message); return "failed"; }
    }

    public static Version? ParseVersion(string? s) { if (s is null) return null; var cut = s.IndexOfAny(new[] { '+', ' ', '-' }); if (cut >= 0) s = s[..cut]; return Version.TryParse(s, out var v) ? v : null; }

    /// <summary>The staged release, if a whole one is staged and newer than what runs: its version and the staged exe.</summary>
    public static (string version, string exe)? Staged()
    {
        try
        {
            var inst = Installer(_ => { });
            var v = inst.StagedVersion();
            var pv = ParseVersion(v); var running = ParseVersion(CurrentVersion);
            if (v is null || pv is null || running is null || pv <= running) return null;
            return (v, Path.Combine(inst.NextDir, "PrismHost.exe"));
        }
        catch { return null; }
    }

    /// <summary>Restart now: the staged copy is started to install itself once this process has gone (--prism-promote), then it starts Prism
    /// from the install folder. True when started; the caller closes.</summary>
    public static bool StartPromotion(Action<string> log)
    {
        if (Staged() is not { } st) return false;
        log("updates: restarting into " + st.version);
        return Launch(st.exe, new[] { "--prism-promote", Environment.ProcessId.ToString() }, log);
    }

    private static bool Launch(string exe, IEnumerable<string> args, Action<string> log)
    {
        var list = args.ToList();
        if (SelfTest) { log("updates: self-test, would start " + exe + " " + string.Join(" ", list)); return true; }
        try
        {
            // no environment of its own: a shell start with one was refused by .NET (the 0.23.0 Restart button's bug)
            var psi = new System.Diagnostics.ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) };
            foreach (var a in list) psi.ArgumentList.Add(a);
            System.Diagnostics.Process.Start(psi);
            return true;
        }
        catch (Exception ex) { log("updates: could not start " + exe + ": " + ex.Message); return false; }
    }

    /// <summary>
    /// What a start does (UpdateInstaller.Decide), before anything else opens. True when this process should leave:
    ///   --prism-promote pid: this is a staged copy - wait for the old Prism to go, install over the install folder, start Prism there;
    ///   from the install folder with a newer copy staged: start the staged copy to install itself, and leave;
    ///   from anywhere else, an installed Prism as new or newer: hand off to it (an older update folder, the unzipped download);
    ///   from anywhere else otherwise: install this copy into the install folder and start it from there - the first run of a download,
    ///   and the first run of this version after an older Prism unpacked it under the data folder.
    /// A debug build (a developer's) never installs or hands off; PRISM_NO_HANDOFF turns all of it off.
    /// </summary>
    public static bool AtStart(Action<string> log)
    {
        if (Environment.GetEnvironmentVariable("PRISM_NO_HANDOFF") is { Length: > 0 }) return false;
#if DEBUG
        if (!SelfTest) return false;
#endif
        var args = Environment.GetCommandLineArgs().Skip(1).ToList();
        // the first-run note's argument is for the copy it was given to, never passed on (2026-10-06)
        var noteAt = args.IndexOf(InstalledFromArg);
        if (noteAt >= 0) args.RemoveRange(noteAt, Math.Min(2, args.Count - noteAt));
        var myDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        var inst = Installer(log);
        var pi = args.IndexOf("--prism-promote");
        if (pi >= 0)
        {
            var rest = args.Where((_, i) => i != pi && i != pi + 1).ToList();
            if (pi + 1 < args.Count && int.TryParse(args[pi + 1], out var pid))
            {
                try { using var old = System.Diagnostics.Process.GetProcessById(pid); old.WaitForExit(60_000); } catch { /* already gone */ }
            }
            try { inst.Promote(myDir, CurrentVersion); WriteLegacyPointer(log); EnsureShortcut(log); }
            catch (Exception ex) { log("updates: the staged copy could not install itself (" + ex.Message + "); the installed Prism starts as it was"); }
            Launch(InstallExe, rest, log);
            return true;
        }
        var running = ParseVersion(CurrentVersion);
        if (running is null) return false;
        var action = Updating.UpdateInstaller.Decide(myDir, running, InstallDir, ParseVersion(Updating.UpdateInstaller.VersionOf(InstallDir)), ParseVersion(inst.StagedVersion()));
        switch (action)
        {
            case Updating.UpdateInstaller.StartAction.LaunchStagedToPromote:
                log("updates: a newer version is staged; it installs itself as this one closes");
                return Launch(Path.Combine(inst.NextDir, "PrismHost.exe"), new[] { "--prism-promote", Environment.ProcessId.ToString() }.Concat(args), log);
            case Updating.UpdateInstaller.StartAction.HandOffToInstall:
                log("updates: handing off to the installed Prism at " + InstallExe);
                return Launch(InstallExe, args, log);
            case Updating.UpdateInstaller.StartAction.InstallSelfThenLaunch:
                if (RunningFromInstall()) { log("updates: Prism is already running from " + InstallDir + "; this copy runs as it is"); return false; }
                try
                {
                    log("updates: installing this copy (" + CurrentVersion + ") into " + InstallDir);
                    inst.Promote(myDir, CurrentVersion);
                    WriteLegacyPointer(log);
                    EnsureShortcut(log);
                    // the installed copy says once where Prism now lives and that the downloaded folder can go (the first-run note)
                    return Launch(InstallExe, args.Concat(new[] { InstalledFromArg, myDir }), log);
                }
                catch (Exception ex) { log("updates: could not install into " + InstallDir + " (" + ex.Message + "); running from " + myDir); return false; }
            default:
                inst.CleanNext();
                WriteLegacyPointer(log);
                EnsureShortcut(log);
                _ = Task.Run(() => RemoveOldUpdateFolders(log));
                if (SelfTest) { log("updates: self-test, running from the install folder - leaving"); return true; }
                return false;
        }
    }

    /// <summary>Another Prism running from the install folder (its files are in use).</summary>
    private static bool RunningFromInstall()
    {
        try
        {
            var me = Environment.ProcessId;
            foreach (var p in System.Diagnostics.Process.GetProcessesByName("PrismHost"))
            {
                using (p)
                {
                    if (p.Id == me) continue;
                    try { if (string.Equals(Path.GetDirectoryName(p.MainModule?.FileName ?? ""), InstallDir, StringComparison.OrdinalIgnoreCase)) return true; } catch { }
                }
            }
        }
        catch { }
        return false;
    }

    /// <summary>The pointer an older Prism reads at its start (data folder app\current.json): it names the installed Prism, so a shortcut to an
    /// old unzipped copy, or an older update folder, hands off to the install folder.</summary>
    private static void WriteLegacyPointer(Action<string> log)
    {
        try
        {
            var v = Updating.UpdateInstaller.VersionOf(InstallDir);
            if (v is null) return;
            Directory.CreateDirectory(AppRoot);
            var want = JsonSerializer.Serialize(new { version = v, dir = InstallDir, exe = InstallExe, at = DateTime.UtcNow.ToString("o") });
            var cur = File.Exists(CurrentFile) ? JsonNode.Parse(File.ReadAllText(CurrentFile)) as JsonObject : null;
            if (cur?["version"]?.GetValue<string>() != v || cur?["exe"]?.GetValue<string>() != InstallExe) File.WriteAllText(CurrentFile, want);
        }
        catch (Exception ex) { log("updates: pointer " + ex.Message); }
    }

    /// <summary>The update folders older Prisms unpacked under the data folder (app\0.23.0 and so on): the installed Prism replaces them.</summary>
    private static void RemoveOldUpdateFolders(Action<string> log)
    {
        try
        {
            if (!Directory.Exists(AppRoot)) return;
            foreach (var d in Directory.GetDirectories(AppRoot))
            {
                if (ParseVersion(Path.GetFileName(d)) is null) continue;
                try { Directory.Delete(d, true); log("updates: old update folder " + Path.GetFileName(d) + " removed (Prism runs from " + InstallDir + ")"); }
                catch { /* in use (an older Prism still closing): next start */ }
            }
        }
        catch (Exception ex) { log("updates: tidy " + ex.Message); }
    }

    /// <summary>Where a shortcut to Prism can live that Prism may write itself (the person's own folders; no administrator rights). The taskbar
    /// is not one: Windows lets only the person pin a desktop app there.</summary>
    public enum ShortcutPlace { StartMenu, Desktop }
    public static string ShortcutPath(ShortcutPlace place) =>
        Path.Combine(Environment.GetFolderPath(place == ShortcutPlace.StartMenu ? Environment.SpecialFolder.Programs : Environment.SpecialFolder.DesktopDirectory), "Prism.lnk");
    public static bool HasShortcut(ShortcutPlace place) { try { return File.Exists(ShortcutPath(place)); } catch { return false; } }
    private static bool ShortcutsOff => SelfTest || Environment.GetEnvironmentVariable("PRISM_INSTALL_DIR") is { Length: > 0 };

    /// <summary>The shortcuts that exist follow the install folder (an older one pointed at an unzipped copy or an update folder). None is made
    /// here: the first run asks where the person wants them (2026-10-06, "On first run when prism goes to its final folder location, we should
    /// prompt the user to see whether they want to add a shortcut to their desktop, taskbar, start menu").</summary>
    private static void EnsureShortcut(Action<string> log)
    {
        if (ShortcutsOff) return;
        foreach (var place in new[] { ShortcutPlace.StartMenu, ShortcutPlace.Desktop })
        {
            var lnk = ShortcutPath(place);
            if (!File.Exists(lnk)) continue;
            try
            {
                var type = Type.GetTypeFromProgID("WScript.Shell");
                if (type is null) return;
                dynamic shell = Activator.CreateInstance(type)!;
                dynamic sc = shell.CreateShortcut(lnk);
                var target = (string)sc.TargetPath;
                if (string.Equals(target, InstallExe, StringComparison.OrdinalIgnoreCase)) continue;
                if (!string.Equals(Path.GetFileName(target), "PrismHost.exe", StringComparison.OrdinalIgnoreCase)) continue;   // someone else's Prism.lnk
                WriteShortcut(sc);
                log("updates: the " + (place == ShortcutPlace.StartMenu ? "Start menu" : "desktop") + " shortcut points at " + InstallExe);
            }
            catch (Exception ex) { log("updates: shortcut " + ex.Message); }
        }
    }
    private static void WriteShortcut(dynamic sc)
    {
        sc.TargetPath = InstallExe;
        sc.WorkingDirectory = InstallDir;
        sc.Description = "Prism by Entangled";
        sc.IconLocation = InstallExe + ",0";
        sc.Save();
    }

    /// <summary>The person's choice: a shortcut to the installed Prism made, or taken away (only one that starts Prism, never another app's
    /// Prism.lnk). True when the place now matches the choice.</summary>
    public static bool SetShortcut(ShortcutPlace place, bool on, Action<string> log)
    {
        if (ShortcutsOff) { log("updates: shortcuts are off for a test install"); return false; }
        var lnk = ShortcutPath(place);
        var name = place == ShortcutPlace.StartMenu ? "Start menu" : "desktop";
        try
        {
            var type = Type.GetTypeFromProgID("WScript.Shell");
            if (type is null) return false;
            dynamic shell = Activator.CreateInstance(type)!;
            if (on)
            {
                dynamic sc = shell.CreateShortcut(lnk);
                if (File.Exists(lnk) && string.Equals((string)sc.TargetPath, InstallExe, StringComparison.OrdinalIgnoreCase)) return true;
                WriteShortcut(sc);
                log("updates: " + name + " shortcut made (" + lnk + ")");
                return true;
            }
            if (!File.Exists(lnk)) return true;
            dynamic cur = shell.CreateShortcut(lnk);
            if (!string.Equals(Path.GetFileName((string)cur.TargetPath), "PrismHost.exe", StringComparison.OrdinalIgnoreCase)) { log("updates: " + lnk + " is not Prism's; left"); return false; }
            File.Delete(lnk);
            log("updates: " + name + " shortcut removed");
            return true;
        }
        catch (Exception ex) { log("updates: " + name + " shortcut " + ex.Message); return false; }
    }
}
