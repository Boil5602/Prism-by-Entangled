using PrismHost.Surfaces.Visualization;
using PrismHost.Visualizations;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// CS-9, the host half: the Parkers' Music Lounge as the wall actually draws
/// it (docs/concept-scenes.md 2.5.2). The JSON below is what CORE pushes over
/// surface.setVisualizationFeed in each of the two states the demo has - the
/// idle wall the seed ships, and the same wall once a service has been signed
/// into and the staged track is playing.
///
/// The seeded feed is copied from what
/// packages/core/tests/music-lounge-demo.test.ts observes coming out of the
/// orchestrator for `demo-music-lounge`: source `demo:placeholder`, which is
/// not a facet, so there is no player surface, no music state, and the stage
/// idles. The playing feed is the same wall driven by `DEMO_TRACK`
/// ("Aurora Skies" / "The Refractions", scripts/seed-demo-household.mjs).
///
/// Every expected glyph is a \u escape so this file is plain ASCII on disk and
/// cannot drift with an encoding round-trip.
/// </summary>
public sealed class MusicLoungeDemoTests
{
    /// <summary>What core pushes for the lounge exactly as the seed leaves it: nothing playing, nothing signed in.</summary>
    private const string SeededIdle = """
    {"visualization":"stage","source":"demo:placeholder","active":false,"playbackState":"none",
     "metadata":null,"artwork":null,"artworkMode":"backdrop","style":"prism-beams",
     "palette":["#F0A83C","#5CC8C0","#C86CF0","#F05C7A"],"dominant":null,"audioOwner":false}
    """;

    /// <summary>The same wall with DEMO_TRACK playing and the hidden source owning audio. No artwork: we own none, and none is fetched.</summary>
    private const string PlayingAndOwner = """
    {"visualization":"stage","source":"spotify-player","active":true,"playbackState":"playing",
     "metadata":{"title":"Aurora Skies","artist":"The Refractions","artwork":null},
     "artwork":null,"artworkMode":"backdrop","style":"prism-beams",
     "palette":["#F0A83C","#5CC8C0","#C86CF0","#F05C7A"],"dominant":null,"audioOwner":true}
    """;

    /// <summary>Playing, but section 3 has the sound somewhere else.</summary>
    private const string PlayingNotOwner = """
    {"visualization":"stage","source":"spotify-player","active":true,"playbackState":"playing",
     "metadata":{"title":"Aurora Skies","artist":"The Refractions","artwork":null},
     "artwork":null,"artworkMode":"backdrop","style":"prism-beams",
     "palette":["#F0A83C","#5CC8C0","#C86CF0","#F05C7A"],"dominant":null,"audioOwner":false}
    """;

    private static readonly string[] PrismBands = { "#F0A83C", "#5CC8C0", "#C86CF0", "#F05C7A" };
    private const string Title = "Aurora Skies";
    private const string Artist = "The Refractions";
    private const string Exclusive = "\u266A exclusive";
    private const string Muted = "muted";

    // ------------------------------------------------- 2.5.2 point 6, idle

    [Fact]
    public void TheSeededLoungeIsIdle_EmptyLine_NoArtwork_ThePacksOwnPalette()
    {
        var f = VisualizationFeed.Parse(SeededIdle);
        Assert.False(f.Active);
        Assert.Equal("none", f.PlaybackState);
        Assert.Null(f.Title);
        Assert.Null(f.Artist);
        Assert.Null(f.Artwork);                       // backdrop with nothing behind it is the dark substrate
        Assert.Equal("backdrop", f.ArtworkMode);
        Assert.Equal("prism-beams", f.Style);
        Assert.False(f.AudioOwner);
        Assert.Equal(PrismBands, f.Palette);          // untinted: there is no art to take colours from
        // an idle wall says nothing (2.5.2 points 3 and 6)
        Assert.True(VisualizationChrome.Metadata(f.Active, f.Title, f.Artist, f.AudioOwner).IsEmpty);
        Assert.Equal("", VisualizationChrome.Metadata(f.Active, f.Title, f.Artist, f.AudioOwner).Text);
    }

    [Fact]
    public void AnIdleLoungeStillDrifts_NeverABlackScreen()
    {
        // the stage the seed ships has no source at all, so this is the signal it draws
        for (var t = 0.0; t < 12; t += 0.19)
        {
            var frame = VisualizationChrome.Ambient(t, 4);
            Assert.Equal(4, frame.Length);
            foreach (var v in frame) Assert.True(v >= VisualizationChrome.AmbientFloor, $"the lounge went black at t={t}");
        }
        Assert.NotEqual(VisualizationChrome.Ambient(0, 4), VisualizationChrome.Ambient(5, 4));
    }

    // --------------------------------- 2.5.2 point 3, the synthetic fixture

    [Fact]
    public void DemoTrackPlayingAndOwningAudio_IsTheLineTheShotShows()
    {
        var f = VisualizationFeed.Parse(PlayingAndOwner);
        Assert.True(f.Active);
        Assert.Equal("Aurora Skies", f.Title);
        Assert.Equal("The Refractions", f.Artist);
        Assert.Null(f.Artwork);
        Assert.True(f.AudioOwner);

        // P4 (adopted 2026-09-03): the block is TWO lines - the title, then
        // "artist (middot) state". The strings come from the feed's FIELDS, so
        // this holds before and after the seed's DEMO_TRACK.line split.
        var block = VisualizationChrome.Metadata(f.Active, f.Title, f.Artist, f.AudioOwner);
        Assert.Equal(Title, block.Title);
        Assert.Equal(Artist, block.Artist);
        Assert.Equal(Exclusive, block.State);
        Assert.Equal(Artist + " \u00B7 " + Exclusive, block.Line2);
        Assert.Equal(Title + "   " + Artist + " \u00B7 " + Exclusive, block.Text);
    }

    [Fact]
    public void DemoTrackPlayingWithTheSoundElsewhere_ReadsMuted()
    {
        var f = VisualizationFeed.Parse(PlayingNotOwner);
        var block = VisualizationChrome.Metadata(f.Active, f.Title, f.Artist, f.AudioOwner);
        Assert.Equal(Title, block.Title);
        Assert.Equal(Muted, block.State);             // still playing - only the sound moved (spec section 3)
        Assert.Equal(Artist + " \u00B7 " + Muted, block.Line2);
        Assert.False(block.IsEmpty);
    }

    // ------------------------------------------ 2.5.2 point 5, the chrome

    [Fact]
    public void TheLoungesStyleLabelShowsForFourSecondsThenLeavesTheWallClean()
    {
        // P5b (adopted 2026-09-03) replaced edit-mode-only: the label appears for
        // 4s after a scene applies and on every style/artwork change, then goes.
        // So the marketing shot IS takeable in the first four seconds, and the
        // wall still carries no chrome text at rest.
        var f = VisualizationFeed.Parse(PlayingAndOwner);
        // the demo declares no album art (DEMO_TRACK has artwork: null), so the
        // mode reads "none" rather than "album art"
        var hasArt = !string.IsNullOrWhiteSpace(f.Artwork);
        Assert.False(hasArt);
        Assert.Equal("PRISM BEAMS \u00B7 backdrop: none",
            VisualizationChrome.StyleLabel("Prism Beams", f.ArtworkMode, hasArt, editMode: false, secondsSinceChange: 0.5));
        Assert.Equal("", VisualizationChrome.StyleLabel("Prism Beams", f.ArtworkMode, hasArt, editMode: false, secondsSinceChange: 5));
        Assert.Equal("PRISM BEAMS \u00B7 backdrop: none",
            VisualizationChrome.StyleLabel("Prism Beams", f.ArtworkMode, hasArt, editMode: true, secondsSinceChange: 5));
    }
}
