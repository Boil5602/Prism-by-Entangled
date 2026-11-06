using PrismHost.Surfaces.Visualization;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// CS-8: the feed core pushes into a visualization surface
/// (surface.setVisualizationFeed, music-state.ts VisualizationFeed). The
/// palette arrives ALREADY tinted from core - concept-scenes 2.5.2 point 2 -
/// and the host renders it rather than deriving one; audioOwner is core's
/// answer about audio focus, which the metadata line reports.
///
/// The JSON below is the shape core emits, so a synthetic Media Session event
/// ("Aurora Skies" / "The Refractions") lands here first and in
/// VisualizationChrome.Metadata second.
/// </summary>
public sealed class VisualizationFeedTests
{
    private const string Playing = """
    {"visualization":"stage","source":"spotify-hidden","active":true,"playbackState":"playing",
     "metadata":{"title":"Aurora Skies","artist":"The Refractions","album":"Refraction"},
     "artwork":"https://a/cover.jpg","artworkMode":"backdrop","style":"prism-beams",
     "palette":["#2F6F9E","#4C8FA8","#6E5FA0","#9E5566"],"dominant":["#2F6F9E"],"audioOwner":true}
    """;

    [Fact]
    public void ParsesTheTrackTheModeAndCoresTintedPalette()
    {
        var f = VisualizationFeed.Parse(Playing);
        Assert.True(f.Active);
        Assert.Equal("playing", f.PlaybackState);
        Assert.Equal("Aurora Skies", f.Title);
        Assert.Equal("The Refractions", f.Artist);
        Assert.Equal("Refraction", f.Album);
        Assert.Equal("https://a/cover.jpg", f.Artwork);
        Assert.Equal("backdrop", f.ArtworkMode);
        Assert.Equal("prism-beams", f.Style);
        Assert.True(f.AudioOwner);
        Assert.Equal(new[] { "#2F6F9E", "#4C8FA8", "#6E5FA0", "#9E5566" }, f.Palette);
    }

    [Fact]
    public void TheMetadataBlockIsBuiltStraightFromTheFeed()
    {
        var f = VisualizationFeed.Parse(Playing);
        var block = PrismHost.Visualizations.VisualizationChrome.Metadata(f.Active, f.Title, f.Artist, f.AudioOwner);
        // P4: title and artist stay separate fields - the host never re-parses a
        // joined "title - artist" string to recover them.
        Assert.Equal("Aurora Skies", block.Title);
        Assert.Equal("The Refractions", block.Artist);
        Assert.Equal("\u266A exclusive", block.State);
    }

    [Fact]
    public void NoPaletteFromCoreMeansNoAnswerYet_ThePacksOwnPaletteStands()
    {
        // no palette field at all
        Assert.Empty(VisualizationFeed.Parse("""{"active":true,"style":"prism-beams"}""").Palette);
        // a malformed palette is dropped colour by colour, never guessed at
        var mixed = VisualizationFeed.Parse("""{"palette":["#F0A83C","tomato","#5cc8c0","#12345","#GGGGGG",7]}""");
        Assert.Equal(new[] { "#F0A83C", "#5cc8c0" }, mixed.Palette);
        Assert.False(mixed.AudioOwner);
    }

    [Fact]
    public void AnIdleOrUnreadableFeedIsTheIdleFeed()
    {
        foreach (var json in new[] { "not json", "[]", "\"\"", "null" })
        {
            var f = VisualizationFeed.Parse(json);
            Assert.False(f.Active);
            Assert.Equal("none", f.PlaybackState);
            Assert.Empty(f.Palette);
            Assert.False(f.AudioOwner);
        }
        // a paused source is not active: the metadata line goes empty (2.5.2 points 3 and 6)
        var paused = VisualizationFeed.Parse("""{"active":false,"playbackState":"paused","metadata":{"title":"Aurora Skies"},"artwork":null,"artworkMode":"backdrop"}""");
        Assert.False(paused.Active);
        Assert.Equal("paused", paused.PlaybackState);
        Assert.True(PrismHost.Visualizations.VisualizationChrome.Metadata(paused.Active, paused.Title, paused.Artist, false).IsEmpty);
    }
}
