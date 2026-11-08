using PrismHost.Tiles;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// docs/concept-scenes.md §6 fixes the micro-facet URLs as directories
/// (https://tiles.prism/chores/), and WebView2's folder mapping serves files.
/// Found on the wall 2026-09-02: the directory URL loaded an empty document
/// while the explicit index.html loaded and revealed. The surface therefore
/// navigates a tiles.prism directory URL as its index.html, and touches no
/// other URL - a streaming site's trailing slash is its own business.
/// </summary>
public sealed class TilesDocumentUrlTests
{
    [Theory]
    [InlineData("https://tiles.prism/chores/", "https://tiles.prism/chores/index.html")]
    [InlineData("https://tiles.prism/timer/", "https://tiles.prism/timer/index.html")]
    [InlineData("https://TILES.PRISM/chores/", "https://tiles.prism/chores/index.html")]   // host is case-insensitive
    public void a_tiles_directory_url_loads_its_index(string url, string expected)
    {
        Assert.Equal(expected, TilesBridge.DocumentUrl(url));
    }

    [Theory]
    [InlineData("https://tiles.prism/chores/index.html")]      // already a file
    [InlineData("https://tiles.prism/shared/tiles.css")]
    [InlineData("https://www.hulu.com/live/")]                 // not our host: a site's trailing slash is left alone
    [InlineData("http://tiles.prism/chores/")]                  // wrong scheme is not a tiles page (IsTilesOrigin)
    [InlineData("not a url")]
    public void everything_else_is_untouched(string url)
    {
        Assert.Equal(url, TilesBridge.DocumentUrl(url));
    }
}
