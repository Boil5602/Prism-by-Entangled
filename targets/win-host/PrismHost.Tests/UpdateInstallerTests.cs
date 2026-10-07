using System.IO.Compression;
using System.Net;
using System.Text;
using PrismHost.Updating;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// The fixed install folder and incremental updates (docs/features/updates.md, 2026-10-06): paths in a file list stay inside the folder;
/// a first install copies everything; an update writes only what changed and keeps what it replaced; a failure puts every file back;
/// staging downloads only what the running copy lacks, and refuses a list or a file that does not match its hash; and a start does the
/// right thing from wherever it runs.
/// </summary>
public sealed class UpdateInstallerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "prism-update-test-" + Guid.NewGuid().ToString("N"));
    private string Install => Path.Combine(_root, "Programs", "Prism");
    private readonly List<string> _log = new();

    public UpdateInstallerTests() { Directory.CreateDirectory(_root); UpdateInstaller.IoRetries = 2; }
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private UpdateInstaller Make(HttpClient? http = null) => new(Install, http ?? new HttpClient(), s => _log.Add(s));

    private string Release(string name, string version, Dictionary<string, string> files, bool marker = true)
    {
        var dir = Path.Combine(_root, name);
        foreach (var (rel, text) in files) { var p = Path.Combine(dir, rel.Replace('/', Path.DirectorySeparatorChar)); Directory.CreateDirectory(Path.GetDirectoryName(p)!); File.WriteAllText(p, text); }
        if (marker) File.WriteAllText(Path.Combine(dir, UpdateInstaller.MarkerName), "{\"version\":\"" + version + "\"}");
        return dir;
    }

    private static string Read(string dir, string rel) => File.ReadAllText(Path.Combine(dir, rel.Replace('/', Path.DirectorySeparatorChar)));

    [Theory]
    [InlineData("../evil.dll")]
    [InlineData("Assets/../../evil.dll")]
    [InlineData("/abs.dll")]
    [InlineData("C:/Windows/evil.dll")]
    [InlineData("Assets//double.dll")]
    [InlineData("")]
    public void A_path_that_leaves_the_folder_is_refused(string path) =>
        Assert.Throws<InvalidDataException>(() => UpdateInstaller.SafeRelative(path));

    [Fact]
    public void A_nested_path_is_kept_with_forward_slashes() =>
        Assert.Equal("Assets/brain/prism-runtime.js", UpdateInstaller.SafeRelative(@"Assets\brain\prism-runtime.js"));

    [Fact]
    public void A_file_list_must_name_PrismHost_exe_and_each_file_once()
    {
        const string h = "0000000000000000000000000000000000000000000000000000000000000000";
        Assert.Throws<InvalidDataException>(() => UpdateInstaller.ParseFileList("{\"version\":\"1.0.0\",\"files\":[{\"path\":\"a.dll\",\"sha256\":\"" + h + "\",\"size\":1}]}"));
        Assert.Throws<InvalidDataException>(() => UpdateInstaller.ParseFileList("{\"version\":\"1.0.0\",\"files\":[{\"path\":\"PrismHost.exe\",\"sha256\":\"" + h + "\",\"size\":1},{\"path\":\"prismhost.exe\",\"sha256\":\"" + h + "\",\"size\":1}]}"));
        var (v, files) = UpdateInstaller.ParseFileList("{\"version\":\"1.0.0\",\"files\":[{\"path\":\"PrismHost.exe\",\"sha256\":\"" + h + "\",\"size\":1}]}");
        Assert.Equal("1.0.0", v);
        Assert.Single(files);
    }

    [Fact]
    public void A_first_install_copies_every_file_and_records_the_version()
    {
        var src = Release("unzipped", "0.26.0", new() { ["PrismHost.exe"] = "exe 26", ["a.dll"] = "a", ["Assets/brain/x.js"] = "x" }, marker: false);
        var v = Make().Promote(src, knownVersion: "0.26.0");
        Assert.Equal("0.26.0", v);
        Assert.Equal("0.26.0", UpdateInstaller.VersionOf(Install));
        Assert.Equal("x", Read(Install, "Assets/brain/x.js"));
        Assert.Equal(3, UpdateInstaller.IndexOf(Install).Count);
        Assert.True(File.Exists(Path.Combine(src, "PrismHost.exe")));   // the source is copied, never moved
    }

    [Fact]
    public void An_update_writes_only_what_changed_and_keeps_what_it_replaced()
    {
        var inst = Make();
        inst.Promote(Release("v1", "1.0.0", new() { ["PrismHost.exe"] = "exe 1", ["runtime.dll"] = "big runtime", ["gone.dll"] = "old" }));
        var runtimeStamp = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        File.SetLastWriteTimeUtc(Path.Combine(Install, "runtime.dll"), runtimeStamp);

        inst.Promote(Release("v2", "2.0.0", new() { ["PrismHost.exe"] = "exe 2", ["runtime.dll"] = "big runtime", ["new.dll"] = "new" }));

        Assert.Equal("2.0.0", UpdateInstaller.VersionOf(Install));
        Assert.Equal("exe 2", Read(Install, "PrismHost.exe"));
        Assert.Equal("new", Read(Install, "new.dll"));
        Assert.False(File.Exists(Path.Combine(Install, "gone.dll")));
        Assert.Equal(runtimeStamp, File.GetLastWriteTimeUtc(Path.Combine(Install, "runtime.dll")));   // unchanged: not written
        Assert.Equal("exe 1", Read(inst.PreviousDir, "PrismHost.exe"));                                // replaced: kept aside
        Assert.Equal("old", Read(inst.PreviousDir, "gone.dll"));
    }

    [Fact]
    public void A_failed_install_puts_every_file_back()
    {
        var inst = Make();
        inst.Promote(Release("v1", "1.0.0", new() { ["PrismHost.exe"] = "exe 1", ["a.dll"] = "a1", ["b.dll"] = "b1" }));
        var v2 = Release("v2", "2.0.0", new() { ["PrismHost.exe"] = "exe 2", ["a.dll"] = "a2", ["b.dll"] = "b2" });
        // b.dll held open with no sharing: it cannot be moved aside, so the install fails partway
        using (new FileStream(Path.Combine(Install, "b.dll"), FileMode.Open, FileAccess.Read, FileShare.None))
            Assert.ThrowsAny<Exception>(() => inst.Promote(v2));
        Assert.Equal("exe 1", Read(Install, "PrismHost.exe"));
        Assert.Equal("a1", Read(Install, "a.dll"));
        Assert.Equal("b1", Read(Install, "b.dll"));
        Assert.Equal("1.0.0", UpdateInstaller.VersionOf(Install));
    }

    [Fact]
    public void The_install_folder_never_promotes_itself()
    {
        var inst = Make();
        inst.Promote(Release("v1", "1.0.0", new() { ["PrismHost.exe"] = "exe 1" }));
        Assert.Throws<InvalidOperationException>(() => inst.Promote(Install));
    }

    // ---- staging from a file list, against a fake server

    private sealed class FakeServer : HttpMessageHandler
    {
        public readonly Dictionary<string, byte[]> Files = new();
        public readonly List<string> Asked = new();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var url = request.RequestUri!.ToString();
            Asked.Add(url);
            return Task.FromResult(Files.TryGetValue(url, out var b)
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(b) }
                : new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }

    private static byte[] Gz(string text)
    {
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, CompressionLevel.Optimal, leaveOpen: true)) { var b = Encoding.UTF8.GetBytes(text); gz.Write(b); }
        return ms.ToArray();
    }

    private static (string json, string sha) List(string version, Dictionary<string, string> files)
    {
        var entries = files.Select(kv => new UpdateInstaller.FileEntry(kv.Key, UpdateInstaller.Sha256Hex(Encoding.UTF8.GetBytes(kv.Value)), Encoding.UTF8.GetByteCount(kv.Value)));
        var json = UpdateInstaller.ListJson(version, entries);
        return (json, UpdateInstaller.Sha256Hex(Encoding.UTF8.GetBytes(json)));
    }

    [Fact]
    public async Task Staging_downloads_only_what_the_running_copy_lacks()
    {
        var running = Release("running", "1.0.0", new() { ["PrismHost.exe"] = "exe 1", ["runtime.dll"] = "big runtime", ["Assets/a.json"] = "adapter 1" });
        var next = new Dictionary<string, string> { ["PrismHost.exe"] = "exe 2", ["runtime.dll"] = "big runtime", ["Assets/a.json"] = "adapter 2" };
        var (json, sha) = List("2.0.0", next);
        var server = new FakeServer();
        const string baseUrl = "https://example.test/windows/files/";
        server.Files[baseUrl + "list.json"] = Encoding.UTF8.GetBytes(json);
        foreach (var (rel, text) in next) server.Files[baseUrl + UpdateInstaller.Sha256Hex(Encoding.UTF8.GetBytes(text)) + ".gz"] = Gz(text);

        var inst = Make(new HttpClient(server));
        var r = await inst.StageFromListAsync("2.0.0", baseUrl + "list.json", sha, running, _ => { });

        Assert.Equal(2, r.Downloaded);
        Assert.Equal(1, r.Copied);
        // what came over the network is the compressed files' size, not their size unpacked (2026-10-06)
        Assert.Equal(next.Where(kv => kv.Key != "runtime.dll").Sum(kv => (long)Gz(kv.Value).Length), r.DownloadedBytes);
        Assert.Equal(next.Where(kv => kv.Key != "runtime.dll").Sum(kv => (long)Encoding.UTF8.GetByteCount(kv.Value)), r.UnpackedBytes);
        Assert.DoesNotContain(server.Asked, u => u.Contains(UpdateInstaller.Sha256Hex(Encoding.UTF8.GetBytes("big runtime"))));
        Assert.Equal("2.0.0", inst.StagedVersion());
        Assert.Equal("adapter 2", Read(inst.NextDir, "Assets/a.json"));
        Assert.Equal("big runtime", Read(inst.NextDir, "runtime.dll"));

        // and the staged copy installs over the running one
        inst.Promote(running);
        inst.Promote(inst.NextDir);
        Assert.Equal("2.0.0", UpdateInstaller.VersionOf(Install));
        Assert.Equal("exe 2", Read(Install, "PrismHost.exe"));
    }

    [Fact]
    public async Task A_list_that_does_not_match_the_signed_hash_is_refused()
    {
        var running = Release("running", "1.0.0", new() { ["PrismHost.exe"] = "exe 1" });
        var (json, _) = List("2.0.0", new() { ["PrismHost.exe"] = "exe 2" });
        var server = new FakeServer();
        server.Files["https://example.test/files/list.json"] = Encoding.UTF8.GetBytes(json);
        var inst = Make(new HttpClient(server));
        await Assert.ThrowsAsync<InvalidDataException>(() => inst.StageFromListAsync("2.0.0", "https://example.test/files/list.json", new string('a', 64), running, _ => { }));
        Assert.Null(inst.StagedVersion());
    }

    [Fact]
    public async Task A_file_that_does_not_match_its_hash_is_refused()
    {
        var running = Release("running", "1.0.0", new() { ["PrismHost.exe"] = "exe 1" });
        var (json, sha) = List("2.0.0", new() { ["PrismHost.exe"] = "exe 2" });
        var server = new FakeServer();
        server.Files["https://example.test/files/list.json"] = Encoding.UTF8.GetBytes(json);
        server.Files["https://example.test/files/" + UpdateInstaller.Sha256Hex(Encoding.UTF8.GetBytes("exe 2")) + ".gz"] = Gz("tampered");
        var inst = Make(new HttpClient(server));
        await Assert.ThrowsAsync<InvalidDataException>(() => inst.StageFromListAsync("2.0.0", "https://example.test/files/list.json", sha, running, _ => { }));
        Assert.Null(inst.StagedVersion());
    }

    // ---- what a start does

    [Fact]
    public void A_start_does_the_right_thing_from_wherever_it_runs()
    {
        var install = Install;
        Version v(string s) => Version.Parse(s);
        Assert.Equal(UpdateInstaller.StartAction.Run, UpdateInstaller.Decide(install, v("1.0.0"), install, v("1.0.0"), null));
        Assert.Equal(UpdateInstaller.StartAction.LaunchStagedToPromote, UpdateInstaller.Decide(install + Path.DirectorySeparatorChar, v("1.0.0"), install, v("1.0.0"), v("1.1.0")));
        Assert.Equal(UpdateInstaller.StartAction.Run, UpdateInstaller.Decide(install, v("1.1.0"), install, v("1.1.0"), v("1.1.0")));   // staged and promoted: run
        Assert.Equal(UpdateInstaller.StartAction.HandOffToInstall, UpdateInstaller.Decide(@"C:\Prism", v("0.25.0"), install, v("0.26.0"), null));
        Assert.Equal(UpdateInstaller.StartAction.HandOffToInstall, UpdateInstaller.Decide(@"C:\Prism", v("0.26.0"), install, v("0.26.0"), null));
        Assert.Equal(UpdateInstaller.StartAction.InstallSelfThenLaunch, UpdateInstaller.Decide(@"C:\Users\x\Downloads\Prism", v("0.26.0"), install, null, null));
        Assert.Equal(UpdateInstaller.StartAction.InstallSelfThenLaunch, UpdateInstaller.Decide(@"C:\Users\x\AppData\Local\Prism\app\0.27.0", v("0.27.0"), install, v("0.26.0"), null));
    }
}
