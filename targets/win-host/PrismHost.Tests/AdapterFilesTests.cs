using PrismHost.Core;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// Adapters and catalog entries from two places (2026-09-29): the ones Prism ships and the ones added on the device. The rules are
/// AdapterFiles' own: a newer added adapter stands over a shipped one, a shipped catalog entry always stands, a bad file is left out
/// with a line for the log and never breaks the rest.
/// </summary>
public sealed class AdapterFilesTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "prism-adapterfiles-" + Guid.NewGuid().ToString("N"));
    private string Shipped => Path.Combine(_root, "assets");
    private string Added => Path.Combine(_root, "data");

    public AdapterFilesTests()
    {
        foreach (var d in new[] { "adapters", "catalog" }) { Directory.CreateDirectory(Path.Combine(Shipped, d)); Directory.CreateDirectory(Path.Combine(Added, d)); }
        Write(Shipped, "adapters", "netflix", "{\"version\":\"0.4.2\",\"match\":[\"www.netflix.com\"]}");
        Write(Shipped, "catalog", "netflix", "{\"id\":\"netflix\",\"name\":\"Netflix\",\"url\":\"https://www.netflix.com/browse\",\"audio\":\"exclusive\"}");
        Write(Shipped, "catalog", "_example-custom", "{\"tile\":{}}");
    }

    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private static void Write(string root, string kind, string name, string json) => File.WriteAllText(Path.Combine(root, kind, name + ".json"), json);
    private AdapterFiles Files() => new(Shipped, Added);

    [Fact]
    public void ShippedFilesAreFoundAndDocumentationFilesAreNot()
    {
        var f = Files();
        Assert.Equal(new[] { "netflix" }, f.Adapters.Keys.ToArray());
        Assert.Equal(new[] { "netflix" }, f.Catalog.Keys.ToArray());
        Assert.False(f.IsAdded("netflix"));
        Assert.Empty(f.Notes);
    }

    [Fact]
    public void AServiceAddedOnTheDeviceJoinsTheList()
    {
        Write(Added, "adapters", "crunchyroll", "{\"version\":\"0.1.0\",\"match\":[\"www.crunchyroll.com\"]}");
        Write(Added, "catalog", "crunchyroll", "{\"id\":\"crunchyroll\",\"name\":\"Crunchyroll\",\"url\":\"https://www.crunchyroll.com/\",\"audio\":\"exclusive\"}");
        var f = Files();
        Assert.Equal(new[] { "crunchyroll", "netflix" }, f.Catalog.Keys.OrderBy(k => k).ToArray());
        Assert.True(f.IsAdded("crunchyroll"));
        Assert.EndsWith(Path.Combine("data", "adapters", "crunchyroll.json"), f.AdapterPath("crunchyroll"));
        Assert.Null(f.AdapterPath("nothing"));
        Assert.Null(f.AdapterPath(null));
    }

    [Fact]
    public void ANewerAddedAdapterStandsOverTheShippedOneAnOlderOneDoesNot()
    {
        Write(Added, "adapters", "netflix", "{\"version\":\"0.4.10\",\"match\":[\"www.netflix.com\"]}");
        var f = Files();
        Assert.EndsWith(Path.Combine("data", "adapters", "netflix.json"), f.AdapterPath("netflix"));
        Assert.False(f.IsAdded("netflix"));   // the service is Prism's own; only its adapter is newer

        Write(Added, "adapters", "netflix", "{\"version\":\"0.4.2\",\"match\":[\"www.netflix.com\"]}");
        f = Files();
        Assert.EndsWith(Path.Combine("assets", "adapters", "netflix.json"), f.AdapterPath("netflix"));
        Assert.Contains(f.Notes, n => n.Contains("not newer"));
    }

    [Fact]
    public void AShippedCatalogEntryAlwaysStands()
    {
        Write(Added, "catalog", "netflix", "{\"id\":\"netflix\",\"name\":\"Not Netflix\",\"url\":\"https://example.com/\"}");
        var f = Files();
        Assert.EndsWith(Path.Combine("assets", "catalog", "netflix.json"), f.Catalog["netflix"].Path);
        Assert.Contains(f.Notes, n => n.Contains("ships with Prism"));
    }

    [Fact]
    public void ABadFileIsLeftOutAndTheRestStand()
    {
        Write(Added, "adapters", "broken", "{ not json");
        Write(Added, "adapters", "nomatch", "{\"version\":\"1.0.0\"}");
        Write(Added, "adapters", "list", "[1,2]");
        Write(Added, "catalog", "plain", "{\"id\":\"plain\",\"name\":\"Plain\",\"url\":\"http://plain.example/\"}");
        Write(Added, "catalog", "good", "{\"id\":\"good\",\"name\":\"Good\",\"url\":\"https://good.example/\"}");
        var f = Files();
        Assert.Equal(new[] { "netflix" }, f.Adapters.Keys.ToArray());
        Assert.Equal(new[] { "good", "netflix" }, f.Catalog.Keys.OrderBy(k => k).ToArray());
        Assert.Equal(4, f.Notes.Count);
    }

    [Theory]
    [InlineData("0.4.10", "0.4.2", true)]
    [InlineData("0.4.2", "0.4.10", false)]
    [InlineData("1.0", "0.9.9", true)]
    [InlineData("0.4.2", "0.4.2", false)]
    [InlineData("0.4.2", "", true)]
    [InlineData("", "0.4.2", false)]
    [InlineData("new", "0.4.2", false)]
    public void VersionsCompareNumberByNumber(string candidate, string than, bool newer) => Assert.Equal(newer, AdapterFiles.Newer(candidate, than));

    [Fact]
    public void AFileDroppedWhilePrismRunsIsReadOnRefresh()
    {
        var f = Files();
        Assert.Single(f.Catalog);
        Write(Added, "catalog", "good", "{\"id\":\"good\",\"name\":\"Good\",\"url\":\"https://good.example/\"}");
        Assert.Single(f.Catalog);
        f.Refresh();
        Assert.Equal(2, f.Catalog.Count);
    }
}
