using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PrismHost.Updating;

/// <summary>
/// The fixed install folder and incremental updates (docs/features/updates.md, 2026-10-06, "build the fixed install folder and incremental
/// updates"). Every Prism runs from one folder that never moves (%LOCALAPPDATA%\Programs\Prism), so Windows' firewall rule, keyed on the
/// exe's path, is asked for once in Prism's life instead of once an update; and an update fetches only the files that changed (about 2 MB
/// against a 127 MB zip, 10 of 660 files between 0.23.0 and 0.24.0).
///
///   install   the folder Prism runs from. Its .files.json lists every file with its SHA-256, its install.json the version.
///   next      an update is staged here whole: unchanged files copied from the running copy, changed ones downloaded and checked.
///   previous  what a promotion replaced, kept for a rollback until the next update is staged.
///
/// A promotion (Promote) copies only what differs from the install folder, with the replaced files moved aside first, and puts them back
/// if anything fails. It runs in a process that is not running from the install folder - the staged copy itself, started with
/// --prism-promote after the old one has exited - so nothing it writes is locked. No file is ever deleted from the data folder (section 10);
/// this is the program, kept apart from the data.
///
/// Integrity: the file list is fetched at the address the signed manifest names and its bytes must hash to the manifest's filesSha256;
/// every file is checked against the list's SHA-256 before it is placed. A path in a list must be relative and stay inside the folder.
/// </summary>
public sealed class UpdateInstaller
{
    public const string IndexName = ".files.json";
    public const string MarkerName = "install.json";
    public const string VerifiedName = ".verified";

    public string InstallDir { get; }
    public string NextDir { get; }
    public string PreviousDir { get; }
    private readonly HttpClient _http;
    private readonly Action<string> _log;

    public UpdateInstaller(string installDir, HttpClient http, Action<string> log)
    {
        InstallDir = Path.GetFullPath(installDir).TrimEnd(Path.DirectorySeparatorChar);
        NextDir = InstallDir + ".next";
        PreviousDir = InstallDir + ".previous";
        _http = http;
        _log = log;
    }

    public sealed record FileEntry(string Path, string Sha256, long Size);
    /// <summary>What a staging did: files kept from the running copy, files downloaded, the bytes that came over the network (compressed, what the
    /// person waits for) and those files' size once unpacked.</summary>
    public sealed record StageResult(int Copied, int Downloaded, long DownloadedBytes, long UnpackedBytes);

    // ---------------------------------------------------------------- the file list

    /// <summary>The list's files, each path checked: relative, forward or back slashes, no "..", no drive, no empty part.</summary>
    public static (string version, List<FileEntry> files) ParseFileList(string json)
    {
        var j = JsonNode.Parse(json) as JsonObject ?? throw new InvalidDataException("the file list is not an object");
        var version = j["version"]?.GetValue<string>() ?? throw new InvalidDataException("the file list names no version");
        var arr = j["files"] as JsonArray ?? throw new InvalidDataException("the file list has no files");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var files = new List<FileEntry>();
        foreach (var n in arr)
        {
            if (n is not JsonObject o) throw new InvalidDataException("a file entry is not an object");
            var p = SafeRelative(o["path"]?.GetValue<string>());
            var sha = (o["sha256"]?.GetValue<string>() ?? "").Trim().ToLowerInvariant();
            if (sha.Length != 64 || !sha.All(Uri.IsHexDigit)) throw new InvalidDataException("bad hash for " + p);
            var size = o["size"]?.GetValue<long>() ?? -1;
            if (size < 0) throw new InvalidDataException("no size for " + p);
            if (!seen.Add(p)) throw new InvalidDataException("the file list names " + p + " twice");
            files.Add(new FileEntry(p, sha, size));
        }
        if (!files.Any(f => string.Equals(f.Path, "PrismHost.exe", StringComparison.OrdinalIgnoreCase))) throw new InvalidDataException("the file list has no PrismHost.exe");
        return (version, files);
    }

    /// <summary>A list path made safe for this machine: forward slashes, never rooted, never climbing out.</summary>
    public static string SafeRelative(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) throw new InvalidDataException("an empty path");
        var p = path.Replace('\\', '/').Trim();
        if (p.StartsWith('/') || p.Contains(':')) throw new InvalidDataException("a rooted path: " + path);
        var parts = p.Split('/');
        if (parts.Any(x => x.Length == 0 || x == "." || x == "..")) throw new InvalidDataException("a path that climbs or is empty: " + path);
        return string.Join('/', parts);
    }

    public static string ListJson(string version, IEnumerable<FileEntry> files) =>
        new JsonObject
        {
            ["version"] = version,
            ["files"] = new JsonArray(files.OrderBy(f => f.Path, StringComparer.Ordinal).Select(f => (JsonNode)new JsonObject { ["path"] = f.Path, ["sha256"] = f.Sha256, ["size"] = f.Size }).ToArray()),
        }.ToJsonString(new JsonSerializerOptions { WriteIndented = true });

    public static string Sha256Hex(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    public static string Sha256File(string path) { using var f = File.OpenRead(path); return Convert.ToHexString(SHA256.HashData(f)).ToLowerInvariant(); }

    private static string Full(string dir, string rel) => Path.Combine(dir, rel.Replace('/', Path.DirectorySeparatorChar));

    /// <summary>A folder's files and their hashes: its .files.json when it has one (sizes checked against the disk), else every file hashed.</summary>
    public static Dictionary<string, FileEntry> IndexOf(string dir)
    {
        var map = new Dictionary<string, FileEntry>(StringComparer.OrdinalIgnoreCase);
        if (!Directory.Exists(dir)) return map;
        var idx = Path.Combine(dir, IndexName);
        if (File.Exists(idx))
        {
            try
            {
                var (_, files) = ParseFileList(File.ReadAllText(idx));
                var ok = files.All(f => { var fi = new FileInfo(Full(dir, f.Path)); return fi.Exists && fi.Length == f.Size; });
                if (ok) { foreach (var f in files) map[f.Path] = f; return map; }
            }
            catch { /* hashed below */ }
        }
        foreach (var file in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(dir, file).Replace(Path.DirectorySeparatorChar, '/');
            var name = Path.GetFileName(rel);
            if (name is IndexName or MarkerName or VerifiedName) continue;
            map[rel] = new FileEntry(rel, Sha256File(file), new FileInfo(file).Length);
        }
        return map;
    }

    /// <summary>The version a folder holds (its install.json), or null.</summary>
    public static string? VersionOf(string dir)
    {
        try
        {
            var m = Path.Combine(dir, MarkerName);
            if (!File.Exists(m) || !File.Exists(Path.Combine(dir, "PrismHost.exe"))) return null;
            return (JsonNode.Parse(File.ReadAllText(m)) as JsonObject)?["version"]?.GetValue<string>();
        }
        catch { return null; }
    }

    private static void WriteMarker(string dir, string version, string how) =>
        File.WriteAllText(Path.Combine(dir, MarkerName), new JsonObject { ["version"] = version, ["how"] = how, ["at"] = DateTime.UtcNow.ToString("o") }.ToJsonString());

    // ---------------------------------------------------------------- staging

    /// <summary>
    /// Stage a release in the next folder from its file list: what the running copy already has (same path or same hash) is copied from it,
    /// the rest is downloaded from blobBase + sha + ".gz", unpacked, and checked against the list before it is placed.
    /// </summary>
    public async Task<StageResult> StageFromListAsync(string version, string listUrl, string listSha, string sourceDir, Action<string> status, CancellationToken ct = default)
    {
        listSha = listSha.Trim().ToLowerInvariant();
        var listBytes = await _http.GetByteArrayAsync(listUrl, ct);
        if (Sha256Hex(listBytes) != listSha) throw new InvalidDataException("the file list does not match the signed manifest's hash - refused");
        var listJson = System.Text.Encoding.UTF8.GetString(listBytes);
        var (listVersion, files) = ParseFileList(listJson);
        if (listVersion != version) throw new InvalidDataException("the file list is for " + listVersion + ", not " + version);
        var blobBase = listUrl[..(listUrl.LastIndexOf('/') + 1)];

        ResetDir(NextDir);
        var have = IndexOf(sourceDir);
        var byHash = new Dictionary<string, string>();
        foreach (var f in have.Values) byHash.TryAdd(f.Sha256, f.Path);

        var toFetch = new List<FileEntry>();
        var copied = 0;
        foreach (var f in files)
        {
            var dest = Full(NextDir, f.Path);
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            var from = have.TryGetValue(f.Path, out var h) && h.Sha256 == f.Sha256 ? f.Path : byHash.TryGetValue(f.Sha256, out var other) ? other : null;
            if (from is not null) { File.Copy(Full(sourceDir, from), dest, true); copied++; }
            else toFetch.Add(f);
        }
        // the status says what came over the network (2026-10-06, "fix the status line to show the transferred size": it had said the files'
        // unpacked size, 5.3 MB for a 1.7 MB download)
        long got = 0, unpacked = 0;
        for (var i = 0; i < toFetch.Count; i++)
        {
            var f = toFetch[i];
            status("Prism " + version + ": downloading " + (i + 1) + " of " + toFetch.Count + " changed files" + (got > 0 ? " (" + (got / 1048576.0).ToString("0.0") + " MB)" : "") + "\u2026");
            got += await FetchBlobAsync(blobBase + f.Sha256 + ".gz", f, Full(NextDir, f.Path), ct);
            unpacked += f.Size;
        }
        // the copies checked too: a file that changed on disk since its index was written is fetched instead
        foreach (var f in files)
        {
            if (toFetch.Contains(f)) continue;
            var dest = Full(NextDir, f.Path);
            if (new FileInfo(dest).Length != f.Size || Sha256File(dest) != f.Sha256) { got += await FetchBlobAsync(blobBase + f.Sha256 + ".gz", f, dest, ct); unpacked += f.Size; toFetch.Add(f); copied--; }
        }
        File.WriteAllText(Path.Combine(NextDir, IndexName), listJson);
        File.WriteAllText(Path.Combine(NextDir, VerifiedName), listSha + "\n" + DateTime.UtcNow.ToString("o"));
        WriteMarker(NextDir, version, "list");
        _log("updates: " + version + " staged from its file list: " + copied + " files kept, " + toFetch.Count + " downloaded (" + (got / 1048576.0).ToString("0.0") + " MB transferred, " + (unpacked / 1048576.0).ToString("0.0") + " MB unpacked)");
        return new StageResult(copied, toFetch.Count, got, unpacked);
    }

    /// <summary>One file fetched, unpacked and checked; returns the bytes that came over the network for it.</summary>
    private async Task<long> FetchBlobAsync(string url, FileEntry f, string dest, CancellationToken ct)
    {
        var tmp = dest + ".part";
        long transferred;
        using (var res = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct))
        {
            res.EnsureSuccessStatusCode();
            await using var raw = await res.Content.ReadAsStreamAsync(ct);
            await using var counted = new CountingStream(raw);
            await using (var gz = new GZipStream(counted, CompressionMode.Decompress, leaveOpen: true))
            await using (var dst = File.Create(tmp))
                await gz.CopyToAsync(dst, ct);
            transferred = counted.Count;
        }
        var fi = new FileInfo(tmp);
        if (fi.Length != f.Size || Sha256File(tmp) != f.Sha256) { File.Delete(tmp); throw new InvalidDataException(f.Path + " did not match its hash - refused"); }
        File.Move(tmp, dest, true);
        return transferred;
    }

    /// <summary>A read-only pass-through that counts the bytes read from the stream under it.</summary>
    private sealed class CountingStream : Stream
    {
        private readonly Stream _inner;
        public long Count { get; private set; }
        public CountingStream(Stream inner) { _inner = inner; }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => Count; set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count) { var n = _inner.Read(buffer, offset, count); Count += n; return n; }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) { var n = await _inner.ReadAsync(buffer, ct); Count += n; return n; }
        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct) { var n = await _inner.ReadAsync(buffer.AsMemory(offset, count), ct); Count += n; return n; }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) _inner.Dispose(); base.Dispose(disposing); }
    }

    /// <summary>Stage a whole release already unpacked in a folder (the zip path): moved into next and indexed.</summary>
    public void StageFromUnpacked(string version, string unpackedDir)
    {
        ResetDir(NextDir);
        Directory.Move(unpackedDir, NextDir);
        var idx = IndexOf(NextDir);
        File.WriteAllText(Path.Combine(NextDir, IndexName), ListJson(version, idx.Values));
        WriteMarker(NextDir, version, "zip");
        File.WriteAllText(Path.Combine(NextDir, VerifiedName), "zip\n" + DateTime.UtcNow.ToString("o"));
    }

    /// <summary>The staged version, when next holds a whole one.</summary>
    public string? StagedVersion() => File.Exists(Path.Combine(NextDir, VerifiedName)) ? VersionOf(NextDir) : null;

    // ---------------------------------------------------------------- promotion

    /// <summary>
    /// Make the install folder hold what sourceDir holds: only the files that differ are written; each one replaced (or no longer in the
    /// release) is moved to previous first, and all of them are put back if any step fails. Returns the version installed.
    /// </summary>
    public string Promote(string sourceDir, string? knownVersion = null)
    {
        sourceDir = Path.GetFullPath(sourceDir).TrimEnd(Path.DirectorySeparatorChar);
        if (string.Equals(sourceDir, InstallDir, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("the install folder cannot promote itself");
        // a copy an older updater unpacked has no install.json: the running copy says its own version
        var version = VersionOf(sourceDir) ?? knownVersion ?? throw new InvalidDataException("the folder to install names no version");
        var src = IndexOf(sourceDir);
        var old = IndexOf(InstallDir);
        var changed = src.Values.Where(f => !old.TryGetValue(f.Path, out var o) || o.Sha256 != f.Sha256).ToList();
        var removed = old.Keys.Where(p => !src.ContainsKey(p)).ToList();

        ResetDir(PreviousDir);
        Directory.CreateDirectory(InstallDir);
        var movedAside = new List<string>();
        var written = new List<string>();
        try
        {
            foreach (var rel in changed.Select(f => f.Path).Concat(removed))
            {
                var at = Full(InstallDir, rel);
                if (!File.Exists(at)) continue;
                var aside = Full(PreviousDir, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(aside)!);
                RetryIo(() => File.Move(at, aside, true));
                movedAside.Add(rel);
            }
            foreach (var f in changed)
            {
                var to = Full(InstallDir, f.Path);
                Directory.CreateDirectory(Path.GetDirectoryName(to)!);
                RetryIo(() => File.Copy(Full(sourceDir, f.Path), to, true));
                written.Add(f.Path);
            }
            // the old index and marker go aside too, so a rollback restores them
            foreach (var meta in new[] { IndexName, MarkerName, VerifiedName })
                if (File.Exists(Path.Combine(InstallDir, meta))) File.Copy(Path.Combine(InstallDir, meta), Path.Combine(PreviousDir, meta), true);
            File.WriteAllText(Path.Combine(InstallDir, IndexName), ListJson(version, src.Values));
            WriteMarker(InstallDir, version, "promoted");
            File.WriteAllText(Path.Combine(InstallDir, VerifiedName), "promoted\n" + DateTime.UtcNow.ToString("o"));
            _log("updates: " + version + " installed at " + InstallDir + ": " + changed.Count + " files written, " + removed.Count + " removed, " + (src.Count - changed.Count) + " unchanged");
            return version;
        }
        catch (Exception ex)
        {
            _log("updates: installing " + version + " failed (" + ex.Message + "), putting the previous files back");
            foreach (var rel in written) { try { File.Delete(Full(InstallDir, rel)); } catch { } }
            foreach (var rel in movedAside) { try { File.Move(Full(PreviousDir, rel), Full(InstallDir, rel), true); } catch { } }
            foreach (var meta in new[] { IndexName, MarkerName, VerifiedName })
                if (File.Exists(Path.Combine(PreviousDir, meta))) { try { File.Copy(Path.Combine(PreviousDir, meta), Path.Combine(InstallDir, meta), true); } catch { } }
            throw;
        }
    }

    /// <summary>How many times a locked file is tried again, a quarter second apart (tests make it small).</summary>
    public static int IoRetries { get; set; } = 40;

    private static void RetryIo(Action a)
    {
        // a scanner or the old process's last handle can hold a file for a moment after it exits
        for (var i = 0; ; i++)
        {
            try { a(); return; }
            catch (IOException) when (i < IoRetries) { Thread.Sleep(250); }
            catch (UnauthorizedAccessException) when (i < IoRetries) { Thread.Sleep(250); }
        }
    }

    private static void ResetDir(string dir)
    {
        if (Directory.Exists(dir)) RetryIo(() => Directory.Delete(dir, true));
        Directory.CreateDirectory(dir);
    }

    /// <summary>The staged copy, once promoted, is not needed: removed (quietly retried at the next start if its process still holds it).</summary>
    public void CleanNext()
    {
        try { if (Directory.Exists(NextDir) && StagedVersion() is { } v && VersionOf(InstallDir) == v) Directory.Delete(NextDir, true); } catch { }
    }

    // ---------------------------------------------------------------- what a start does

    public enum StartAction { Run, HandOffToInstall, InstallSelfThenLaunch, LaunchStagedToPromote }

    /// <summary>
    /// What a start does, from where it runs and what is installed and staged:
    ///   from the install folder, a newer whole release staged: start the staged copy to promote itself, and leave;
    ///   from the install folder otherwise: run;
    ///   from anywhere else (an older update folder, an unzipped download), the installed copy as new or newer: hand off to it;
    ///   from anywhere else, nothing installed or something older: install this copy, then start it from the install folder.
    /// </summary>
    public static StartAction Decide(string runningDir, Version running, string installDir, Version? installed, Version? staged)
    {
        var fromInstall = string.Equals(Path.GetFullPath(runningDir).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(installDir).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
        if (fromInstall) return staged is not null && staged > running ? StartAction.LaunchStagedToPromote : StartAction.Run;
        return installed is not null && installed >= running ? StartAction.HandOffToInstall : StartAction.InstallSelfThenLaunch;
    }
}
