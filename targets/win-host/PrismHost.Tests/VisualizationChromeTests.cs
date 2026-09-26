using PrismHost.Visualizations;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// CS-8: the Prism Beams composition's pure rules (docs/concept-scenes.md
/// 2.5.2). The drawing itself is verified by eye on the wall; everything a
/// test can hold - what the metadata line says in each state, that idle is
/// never a black screen, that the style label is edit-mode only - is held
/// here.
///
/// Point 3's four states are the ones the Parkers' synthetic Media Session
/// fixture drives: "Aurora Skies" / "The Refractions" playing and owning
/// audio, playing and muted, paused, and idle. Expected strings are written
/// with \u escapes so this file is ASCII on disk and cannot drift with an
/// encoding round-trip.
/// </summary>
public sealed class VisualizationChromeTests
{
    private const string Title = "Aurora Skies";
    private const string Artist = "The Refractions";
    private const string Exclusive = "\u266A exclusive";
    private const string Muted = "muted";

    // B-213: the mute button reads the wall's switch, not the ownership - before the music starts nothing owns the
    // audio, and the tip said "Muted" over an unmuted wall
    [Fact]
    public void MuteTip_FollowsTheWallSwitch_NotTheOwnership()
    {
        Assert.StartsWith("Muted", VisualizationChrome.MuteTip(wallMuted: true, owns: false));
        Assert.StartsWith("Muted", VisualizationChrome.MuteTip(wallMuted: true, owns: true));
        Assert.StartsWith("Sound on", VisualizationChrome.MuteTip(wallMuted: false, owns: true));
        Assert.StartsWith("Sound on", VisualizationChrome.MuteTip(wallMuted: false, owns: false));
        Assert.Contains("starts silent", VisualizationChrome.MuteTip(wallMuted: false, owns: false));
    }

    [Fact]
    public void MetadataBlock_PlayingAndTheAudioOwner_ReadsExclusive()
    {
        var b = VisualizationChrome.Metadata(true, Title, Artist, audioOwner: true);
        Assert.Equal(Title, b.Title);
        Assert.Equal(Artist, b.Artist);
        Assert.Equal(Exclusive, b.State);
        // P4: line 2 is "artist (middot) state"
        Assert.Equal(Artist + " \u00B7 " + Exclusive, b.Line2);
        Assert.False(b.IsEmpty);
    }

    [Fact]
    public void MetadataBlock_PlayingButNotTheAudioOwner_ReadsMuted()
    {
        var b = VisualizationChrome.Metadata(true, Title, Artist, audioOwner: false);
        // 2026-09-06: the third line and the paused state - a loaded track stays up on the wall
        var paused = VisualizationChrome.Metadata(true, Title, Artist, audioOwner: true, album: "Discovery", playing: false);
        Assert.Equal("Discovery", paused.Album);
        Assert.Equal(VisualizationChrome.StatePaused, paused.State);
        Assert.False(paused.IsEmpty);
        Assert.True(VisualizationChrome.Metadata(false, Title, Artist, true, "Discovery", false).IsEmpty);   // nothing loaded: still nothing
        Assert.Equal("Apple Music", VisualizationChrome.Metadata(true, Title, Artist, true, null, true, "Apple Music").Service);
        Assert.Equal("Alex's Station", VisualizationChrome.Metadata(true, Title, Artist, true, "SOUR", true, "Apple Music", "Alex's Station").Collection);
        // the loading signal (2026-09-07): a pick names itself while the page queues it; a failure says so
        Assert.Equal("loading Vibes\u2026", VisualizationChrome.PendingState("Vibes", null));
        Assert.Equal("couldn't start Vibes", VisualizationChrome.PendingState(" Vibes ", "error:x"));
        // B-123: a session the service dropped is named, not shrugged at
        Assert.Equal("sign in to Apple Music to play", VisualizationChrome.PendingState("Vibes", "needs-signin", "Apple Music"));
        Assert.Equal("signed out - open the player to sign in", VisualizationChrome.SignedOutState(null));
        Assert.Equal("", VisualizationChrome.Metadata(true, Title, Artist, true, "Discovery", true, "Apple Music", "discovery").Collection);   // the album's own name is not repeated
        Assert.Equal(Title, b.Title);
        Assert.Equal(Artist + " \u00B7 " + Muted, b.Line2);
    }

    [Fact]
    public void MetadataBlock_PausedOrIdle_IsEmpty()
    {
        // paused and stopped are both "nothing is playing" (2.5.2 point 6)
        var paused = VisualizationChrome.Metadata(false, Title, Artist, audioOwner: true);
        Assert.True(paused.IsEmpty);
        Assert.Equal("", paused.Title);
        Assert.Equal("", paused.Line2);
        Assert.Equal("", paused.Text);
        var idle = VisualizationChrome.Metadata(false, null, null, audioOwner: false);
        Assert.True(idle.IsEmpty);
    }

    [Fact]
    public void MetadataBlock_AMissingArtistCollapsesLineTwoToTheStateAlone()
    {
        var b = VisualizationChrome.Metadata(true, Title, null, audioOwner: true);
        Assert.Equal(Title, b.Title);
        Assert.Equal("", b.Artist);
        Assert.Equal(Exclusive, b.Line2);     // P4: the state alone, no dangling separator
    }

    [Fact]
    public void MetadataBlock_AMissingTitleLeavesLineOneEmptyRatherThanPromotingTheArtist()
    {
        // P4 is explicit: a promoted artist would read as a track name and lie
        // about what is playing.
        var b = VisualizationChrome.Metadata(true, "   ", Artist, audioOwner: true);
        Assert.Equal("", b.Title);
        Assert.Equal(Artist, b.Artist);
        Assert.Equal(Artist + " \u00B7 " + Exclusive, b.Line2);

        // a playing source with no metadata at all still reports the audio state
        var bare = VisualizationChrome.Metadata(true, null, null, audioOwner: false);
        Assert.Equal("", bare.Title);
        Assert.Equal(Muted, bare.Line2);
        Assert.Equal(Muted, bare.Text);
    }

    [Fact]
    public void StyleLabel_TextIsTheStyleUppercaseAndTheModeSpelledOut()
    {
        // P5b: "PRISM BEAMS (middot) backdrop: album art"
        Assert.Equal("PRISM BEAMS \u00B7 backdrop: album art",
            VisualizationChrome.StyleLabelText("Prism Beams", "backdrop", hasArt: true));
        // the source declared no art
        Assert.Equal("PRISM BEAMS \u00B7 backdrop: none",
            VisualizationChrome.StyleLabelText("Prism Beams", "backdrop", hasArt: false));
        // focal / off as configured
        Assert.Equal("PRISM BEAMS \u00B7 focal", VisualizationChrome.StyleLabelText("Prism Beams", "focal", hasArt: true));
        Assert.Equal("PRISM BEAMS \u00B7 off", VisualizationChrome.StyleLabelText("Prism Beams", "off", hasArt: false));
        // a pack that failed to load leaves no dangling separator
        Assert.Equal("backdrop: album art", VisualizationChrome.StyleLabelText(null, "backdrop", hasArt: true));
        Assert.Equal("PRISM BEAMS", VisualizationChrome.StyleLabelText("Prism Beams", null, hasArt: true));
    }

    [Fact]
    public void StyleLabel_ShowsForFourSecondsThenHides_AndIsPinnedWhileEditing()
    {
        Assert.Equal(4.0, VisualizationChrome.LabelWindowSeconds);

        // inside the window: visible without edit mode (this is what P5b bought -
        // a viewer learns what they are looking at, and the shot is takeable)
        Assert.True(VisualizationChrome.LabelVisible(editMode: false, secondsSinceChange: 0));
        Assert.True(VisualizationChrome.LabelVisible(editMode: false, secondsSinceChange: 3.9));
        Assert.NotEqual("", VisualizationChrome.StyleLabel("Prism Beams", "backdrop", true, editMode: false, secondsSinceChange: 1));

        // past it: gone, so the label does not live on the wall for good
        Assert.False(VisualizationChrome.LabelVisible(editMode: false, secondsSinceChange: 4.0));
        Assert.Equal("", VisualizationChrome.StyleLabel("Prism Beams", "backdrop", true, editMode: false, secondsSinceChange: 9));

        // edit mode pins it regardless of age
        Assert.True(VisualizationChrome.LabelVisible(editMode: true, secondsSinceChange: 600));
        Assert.Equal("PRISM BEAMS \u00B7 backdrop: album art",
            VisualizationChrome.StyleLabel("Prism Beams", "backdrop", true, editMode: true, secondsSinceChange: 600));

        // a clock that goes backwards counts as "just changed", never "long ago"
        Assert.True(VisualizationChrome.LabelVisible(editMode: false, secondsSinceChange: -1));
    }

    [Fact]
    public void Prism_SitsWhereTheCompositionNeedsIt()
    {
        // P1 put it at 0.50 from a static mockup; at wall width that left the
        // input beam crossing half the canvas and the dispersion with nowhere to
        // open. Revised to 0.32 by the maintainer 2026-09-04.
        Assert.Equal(0.32, VisualizationChrome.PrismCenterX);
        Assert.Equal(0.44, VisualizationChrome.PrismCenterY);

        // the point of the move: the dispersion gets most of the wall
        Assert.True(1 - VisualizationChrome.PrismCenterX > 0.6,
            "the bands need room to fan; a prism near the centre line has half a canvas");
    }

    [Fact]
    public void SpectrumFloor_HasTheShapeP3Adopted()
    {
        Assert.Equal(42, VisualizationChrome.SpectrumBars);
        Assert.Equal(0.5, VisualizationChrome.SpectrumOpacity);            // the beams stay the subject
        // the mockup's span: x 90 -> 720 of 800, the middle ~79% of the width
        Assert.Equal(90.0 / 800.0, VisualizationChrome.SpectrumLeft, 6);
        Assert.Equal(720.0 / 800.0, VisualizationChrome.SpectrumRight, 6);
        Assert.Equal(0.7875, VisualizationChrome.SpectrumRight - VisualizationChrome.SpectrumLeft, 6);
    }

    [Fact]
    public void SpectrumFloor_BarIReadsBandITimesBandsOver42()
    {
        // point 8's mapping, at both ends and in the middle
        Assert.Equal(0, VisualizationChrome.SpectrumBandOf(0, 64));
        Assert.Equal(32, VisualizationChrome.SpectrumBandOf(21, 64));
        Assert.Equal(62, VisualizationChrome.SpectrumBandOf(41, 64));
        // fewer bands than bars: several bars share one band, and nothing runs off the end
        Assert.Equal(0, VisualizationChrome.SpectrumBandOf(0, 4));
        Assert.Equal(3, VisualizationChrome.SpectrumBandOf(41, 4));
        for (var i = 0; i < VisualizationChrome.SpectrumBars; i++)
        {
            Assert.InRange(VisualizationChrome.SpectrumBandOf(i, 8), 0, 7);
            Assert.InRange(VisualizationChrome.SpectrumBandOf(i, 1), 0, 0);
        }
        Assert.Equal(0, VisualizationChrome.SpectrumBandOf(0, 0));          // no bands at all: no crash
    }

    [Fact]
    public void SpectrumFloor_IdleSettlesToItsFloorAndNeverFlattensToNothing()
    {
        const double h = 1080;
        var sixth = h / 6;
        var floor = VisualizationChrome.SpectrumBarHeight(0, h, reducedMotion: false);
        var full = VisualizationChrome.SpectrumBarHeight(1, h, reducedMotion: false);

        Assert.True(floor > 0);                                             // never nothing
        // ...and quiet: an idle bar must be clearly WIDER than it is tall on a
        // normal wall, or 42 rounded bars read as a row of dots (seen 2026-09-03).
        var idleBarWidth = 1426 * (VisualizationChrome.SpectrumRight - VisualizationChrome.SpectrumLeft) / VisualizationChrome.SpectrumBars * 0.62;
        Assert.True(floor < idleBarWidth, $"idle bar {floor:F1}px tall vs {idleBarWidth:F1}px wide - too tall to read as a floor");
        Assert.Equal(VisualizationChrome.SpectrumFloor * sixth * VisualizationChrome.SpectrumCeil, floor, 6);
        Assert.Equal(sixth * VisualizationChrome.SpectrumCeil, full, 6);
        Assert.True(full <= sixth);                                         // stays inside the bottom sixth
        Assert.True(full > floor);

        // reduced motion: static AT the floor whatever the audio says
        Assert.Equal(floor, VisualizationChrome.SpectrumBarHeight(1, h, reducedMotion: true), 6);
        Assert.Equal(floor, VisualizationChrome.SpectrumBarHeight(0.4, h, reducedMotion: true), 6);

        // a level out of range is clamped, not trusted
        Assert.Equal(full, VisualizationChrome.SpectrumBarHeight(9, h, reducedMotion: false), 6);
        Assert.Equal(floor, VisualizationChrome.SpectrumBarHeight(-3, h, reducedMotion: false), 6);

        // the ambient signal (idle) lands between the two, so the field drifts
        foreach (var v in VisualizationChrome.Ambient(1.5, 8))
        {
            var bh = VisualizationChrome.SpectrumBarHeight(v, h, reducedMotion: false);
            Assert.InRange(bh, floor, full);
        }
    }

    [Fact]
    public void Idle_IsADriftAndNeverABlackScreen()
    {
        foreach (var n in new[] { 1, 4, 16, 64 })
            for (var t = 0.0; t < 40; t += 0.37)
            {
                var frame = VisualizationChrome.Ambient(t, n);
                Assert.Equal(n, frame.Length);
                foreach (var v in frame)
                {
                    Assert.True(v >= VisualizationChrome.AmbientFloor, $"ambient band {v} fell to the substrate at t={t}, n={n}");
                    Assert.True(v <= VisualizationChrome.AmbientFloor + VisualizationChrome.AmbientSwing);
                }
            }
        Assert.Empty(VisualizationChrome.Ambient(0, 0));
        // and it drifts rather than standing still
        Assert.NotEqual(VisualizationChrome.Ambient(0, 8), VisualizationChrome.Ambient(6, 8));
    }

    [Fact]
    public void Idle_IsFrameForFrameCoresAmbientSignal()
    {
        // pinned in packages/core/tests/visualization.test.ts against the same numbers
        AssertFrame(new[] { 0.0973, 0.1163, 0.0661, 0.0577 }, VisualizationChrome.Ambient(2, 4));
        AssertFrame(new[] { 0.085 }, VisualizationChrome.Ambient(0, 1));
    }

    private static void AssertFrame(double[] expected, float[] actual)
    {
        Assert.Equal(expected.Length, actual.Length);
        for (var i = 0; i < expected.Length; i++) Assert.Equal(expected[i], actual[i], 4);
    }

    [Fact]
    public void BreakClock_WithThePagesCount_NamesTheAd()
    {
        // 2026-09-15: Spotify's ad subtitle counts the break (1 of 3 .. 3 of 3); the clock says which ad it is timing
        Assert.Equal("Ad 2 of 3 \u00B7 0:12 / 0:30", VisualizationChrome.BreakClock("2 of 3", "0:12 / 0:30"));
        Assert.Equal("0:12 / 0:30", VisualizationChrome.BreakClock(null, "0:12 / 0:30"));
        Assert.Equal("0:12 / 0:30", VisualizationChrome.BreakClock("  ", "0:12 / 0:30"));
    }

    [Fact]
    public void ResumeBlock_NothingLoaded_NamesTheRememberedTrackAndTheWayBack()
    {
        // B-204 (2026-09-15): a restart boots the source paused on its page with nothing loaded; the block says what Play resumes
        var b = VisualizationChrome.ResumeBlock("Apple Music", "Gnarly", "KATSEYE", "Alex Parker's Station");
        Assert.Equal("Gnarly", b.Title);
        Assert.Equal("KATSEYE", b.Artist);
        Assert.Equal(VisualizationChrome.StateResume, b.State);
        Assert.Equal("KATSEYE \u00B7 tap play to resume", b.Line2);
        Assert.Equal("Apple Music", b.Service);
        Assert.Equal("Alex Parker's Station", b.Collection);
        Assert.False(b.IsEmpty);
        Assert.Equal("tap play to resume", VisualizationChrome.ResumeBlock(null, "Gnarly", null, null).Line2);   // no artist: the state alone
    }

    [Fact]
    public void SwitchToLabel_NamesTheServiceAndWhatPlaysOn()
    {
        Assert.Equal("Switch to Spotify \u00B7 Marigny", VisualizationChrome.SwitchToLabel("Spotify", "Marigny"));
        Assert.Equal("Switch to Amazon Music", VisualizationChrome.SwitchToLabel("Amazon Music", null));
        Assert.Equal("Switch to Amazon Music", VisualizationChrome.SwitchToLabel("Amazon Music", "  "));
    }
}
