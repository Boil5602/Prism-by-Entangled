namespace PrismHost.Visualizations;

/// <summary>
/// The pure half of the Prism Beams composition (docs/concept-scenes.md
/// section 2.5.2): the text of the metadata line, the edit-mode style label,
/// and the ambient idle signal. No WinUI here, so the composition rules are
/// asserted headless in CI while the drawing itself
/// (Visualizations/StyleRenderer.cs) and the chrome layout
/// (Visualizations/MainWindow.Visualizations.cs) stay in the app.
///
/// Every glyph the composition names is written as a \u escape (em dash,
/// middot, eighth note) so this file is plain ASCII on disk: the host's
/// sources are mixed cp1252/UTF-8 and no encoding round-trip may quietly
/// change what the wall says.
/// </summary>
public static class VisualizationChrome
{
    /// <summary>
    /// Separator between the artist and the state on line 2: "artist (middot)
    /// state" (2.5.2 point 3 as amended by P4, adopted 2026-09-03).
    /// </summary>
    public const string MetaSeparator = " \u00B7 ";

    /// <summary>The state half of line 2 while the hidden source owns audio (spec section 3, exclusive).</summary>
    public const string StateExclusive = "\u266A exclusive";

    /// <summary>The state half while it does not: playing, but not the audio owner.</summary>
    public const string StateMuted = "muted";

    /// <summary>Separator in the style/mode label: "PRISM BEAMS (middot) backdrop: album art".</summary>
    public const string LabelSeparator = " \u00B7 ";

    /// <summary>
    /// 2.5.2 point 3 as amended by P4: the bottom-left metadata block is TWO
    /// lines - line 1 the title in the display face at semibold, line 2
    /// "artist (middot) state" with the artist in dim sans and the state alone
    /// in dim monospace. The three pieces stay separate here because they carry
    /// three different type treatments on the wall; the host never re-parses a
    /// joined string to recover them.
    /// </summary>
    public readonly record struct MetadataBlock(string Title, string Artist, string State, string Album = "", string Service = "", string Collection = "")
    {
        public bool IsEmpty => Title.Length == 0 && Artist.Length == 0 && State.Length == 0 && Album.Length == 0;

        /// <summary>
        /// Line 2 as one string. A missing artist collapses it to the state
        /// alone (P4); the state is never dropped while something is playing.
        /// </summary>
        public string Line2 => Artist.Length == 0 ? State : State.Length == 0 ? Artist : Artist + MetaSeparator + State;

        /// <summary>Both lines as one string - what a log line or a test asserts.</summary>
        public string Text => IsEmpty ? "" : Title.Length == 0 ? Line2 : Line2.Length == 0 ? Title : Title + "   " + Line2;
    }

    /// <summary>
    /// 2.5.2 point 3 (P4). `active` is core's feed/nowPlaying "playing" - paused
    /// and stopped are both "nothing is playing" and render an empty block
    /// (point 6). `audioOwner` is core's answer (the feed's audioOwner, or
    /// /state's audioOwner matched against this source): the host never guesses.
    ///
    /// A missing TITLE leaves line 1 empty rather than promoting the artist into
    /// it - P4 is explicit about that, because a promoted artist reads as a track
    /// name and lies about what is playing.
    /// </summary>
    public static MetadataBlock Metadata(bool active, string? title, string? artist, bool audioOwner)
        => Metadata(active, title, artist, audioOwner, null, true);

    /// <summary>
    /// The block with its third line and its paused state (the maintainer's ask, 2026-09-06:
    /// keep the song, album and artist up). `active` is now "a track is loaded" - the host passes
    /// playing OR a title - and `playing` decides the state word: exclusive / muted while playing,
    /// "paused" otherwise. Nothing loaded is still an empty block (point 6).
    /// </summary>
    public static MetadataBlock Metadata(bool active, string? title, string? artist, bool audioOwner, string? album, bool playing)
        => Metadata(active, title, artist, audioOwner, album, playing, null);

    /// <summary>With the service's name (the App the hidden facet belongs to), shown as a small line above the title (2026-09-06). Empty when nothing is loaded.</summary>
    public static MetadataBlock Metadata(bool active, string? title, string? artist, bool audioOwner, string? album, bool playing, string? service)
        => Metadata(active, title, artist, audioOwner, album, playing, service, null);

    /// <summary>With the collection playing - a station or playlist name the page reported - as its own line (2026-09-06). An album already has its line; a collection equal to the album is not repeated.</summary>
    public static MetadataBlock Metadata(bool active, string? title, string? artist, bool audioOwner, string? album, bool playing, string? service, string? collection)
    {
        if (!active) return new MetadataBlock("", "", "");
        var state = !playing ? StatePaused : audioOwner ? StateExclusive : StateMuted;
        var alb = (album ?? "").Trim(); var col = (collection ?? "").Trim();
        if (col.Length > 0 && string.Equals(col, alb, StringComparison.OrdinalIgnoreCase)) col = "";
        return new MetadataBlock((title ?? "").Trim(), (artist ?? "").Trim(), state, alb, (service ?? "").Trim(), col);
    }

    /// <summary>Line 2's state word when a track is loaded but not playing.</summary>
    public const string StatePaused = "paused";

    /// <summary>B-204 (2026-09-15): line 2's state when nothing is loaded but Prism remembers what the tile played - the way back is the Play button.</summary>
    public const string StateResume = "tap play to resume";
    /// <summary>B-205 (2026-09-15): the Quick play menu's first entry under each service - the wall switches to it and plays on. Names what that is when Prism knows.</summary>
    public static string SwitchToLabel(string service, string? what)
        => string.IsNullOrWhiteSpace(what) ? "Switch to " + service.Trim() : "Switch to " + service.Trim() + " \u00B7 " + what.Trim();
    /// <summary>The block for a source with nothing loaded and a remembered track: the track and artist as they were, the state saying what a Play press does, the collection it came from.</summary>
    public static MetadataBlock ResumeBlock(string? service, string title, string? artist, string? collection)
        => new MetadataBlock(title.Trim(), (artist ?? "").Trim(), StateResume, "", (service ?? "").Trim(), (collection ?? "").Trim());

    /// <summary>
    /// B-213 (2026-09-16): the mute button's tooltip reads the wall's one switch (B-150), never the ownership. It used to say
    /// "Muted" whenever the stage's source did not own the audio - which is every source before the music starts - while the
    /// switch was off, and the button sat dimmed like the disabled controls beside it ("It appears grayed out"). A press that
    /// lands before the music starts holds: the music starts silent, and the button says so before the press.
    /// </summary>
    public const string MuteTipMuted = "Muted - the wall is silent and the beams have no signal to react to. Tap to unmute.";
    public const string MuteTipOwner = "Sound on - this source owns the room's audio (section 3 exclusive). Tap to mute the wall.";
    public const string MuteTipIdle = "Sound on - nothing owns the room's audio yet. A mute pressed now holds, so the music starts silent.";
    public static string MuteTip(bool wallMuted, bool owns) => wallMuted ? MuteTipMuted : owns ? MuteTipOwner : MuteTipIdle;

    /// <summary>B-143 (2026-09-08): line 1 during an ad break the wall covers - the extension's word, for continuity.</summary>
    public const string IntermissionTitle = "Intermission";
    /// <summary>Line 2 during the break: what the wall does about it - muted, or the soundscape it plays instead of silence.</summary>
    public static string IntermissionState(string? soundscape)
        => string.IsNullOrWhiteSpace(soundscape) ? "muted for the ad" : "muted for the ad \u00B7 " + soundscape.Trim().ToLowerInvariant() + " instead";

    /// <summary>2026-09-15: the clock during a break the page counts (Spotify's ad subtitle says "1 of 3" .. "3 of 3"):
    /// "Ad 2 of 3 (middot) 0:12 / 0:30", so a 30 s clock starting over three times reads as three ads, not one stuck ad.
    /// Without a count the clock stands alone.</summary>
    public static string BreakClock(string? adCount, string clock)
        => string.IsNullOrWhiteSpace(adCount) ? clock : "Ad " + adCount.Trim() + " \u00B7 " + clock;

    /// <summary>
    /// Line 2's state while a quick-play pick is between the tap and the page playing it (2026-09-07): a big
    /// playlist takes the service ten seconds and more to queue, and a wall that shows nothing for ten
    /// seconds reads as broken. Loading names the pick; a failure (the page's own word, or the timeout) says
    /// so instead of pretending.
    /// </summary>
    public static string PendingState(string name, string? failed)
        => PendingState(name, failed, null);

    /// <summary>With the service named: a pick that failed for want of a session says "sign in to Apple Music to play" (B-123) - the real answer, not a shrug.</summary>
    public static string PendingState(string name, string? failed, string? service)
    {
        if (failed is null) return "loading " + name.Trim() + "\u2026";
        if (failed == "needs-signin") return SignedOutState(service);
        return "couldn't start " + name.Trim();
    }

    /// <summary>Line 2 while the page is signed out and nothing is loaded (B-123).</summary>
    public static string SignedOutState(string? service)
        => string.IsNullOrWhiteSpace(service) ? "signed out - open the player to sign in" : "sign in to " + service.Trim() + " to play";

    /// <summary>The artwork card: a clear copy of the cover in the top-right corner, as a fraction of the tile's height, with its inset from the edges.</summary>
    public const double ArtCardHeight = 0.2, ArtCardInset = 0.022;

    /// <summary>
    /// How long the style/mode label stays up after a scene applies or the style
    /// or artwork mode changes (2.5.2 point 5 as amended by P5b, adopted
    /// 2026-09-03). A viewer learns what they are looking at without the label
    /// living on the wall for good - and a marketing shot can be taken inside it.
    /// </summary>
    public const double LabelWindowSeconds = 4.0;

    /// <summary>
    /// The artwork half of the label, spelled out (P5b): "backdrop: album art"
    /// when the source declared art, "backdrop: none" when it did not, and
    /// "focal" / "off" as configured.
    /// </summary>
    public static string ArtworkModeLabel(string? artwork, bool hasArt)
    {
        var m = (artwork ?? "").Trim().ToLowerInvariant();
        return m switch
        {
            "backdrop" => hasArt ? "backdrop: album art" : "backdrop: none",
            "" => "",
            _ => m,
        };
    }

    /// <summary>
    /// The label text: the style name UPPERCASE, then the spelled-out mode
    /// (P5b) - "PRISM BEAMS (middot) backdrop: album art".
    /// </summary>
    public static string StyleLabelText(string? styleName, string? artwork, bool hasArt)
    {
        var s = (styleName ?? "").Trim().ToUpperInvariant();
        var m = ArtworkModeLabel(artwork, hasArt);
        if (s.Length == 0) return m;
        return m.Length == 0 ? s : s + LabelSeparator + m;
    }

    /// <summary>
    /// P5b's visibility rule: pinned in edit mode (scene builder / rail / layout
    /// or facet editor open), otherwise visible for <see cref="LabelWindowSeconds"/>
    /// after a scene applies and after every style or artwork-mode change, then
    /// gone. A negative age counts as "just changed" rather than "long ago".
    /// </summary>
    public static bool LabelVisible(bool editMode, double secondsSinceChange)
        => editMode || secondsSinceChange < LabelWindowSeconds;

    /// <summary>
    /// 2.5.2 point 5 as amended by P5b: the label, or "" when its window has
    /// closed and the wall is not in edit mode.
    /// </summary>
    public static string StyleLabel(string? styleName, string? artwork, bool hasArt, bool editMode, double secondsSinceChange)
        => LabelVisible(editMode, secondsSinceChange) ? StyleLabelText(styleName, artwork, hasArt) : "";

    /// <summary>
    /// 2.5.2 point 1. The prism's centre in canvas fractions.
    ///
    /// P1 (2026-09-03) moved this to 0.50 from the mock-4 draft. Seen at wall
    /// width the next day it composed badly: the white input beam crossed HALF
    /// the canvas as a single thin line while all four dispersed bands were
    /// crammed into the other half, and a beam swinging its full 39 degrees ran
    /// off the right edge almost at once. Revised to 0.32 on 2026-09-04 by the
    /// maintainer - a short bright entry, and two thirds of the wall for the
    /// dispersion to open across. The height is unchanged.
    /// </summary>
    public const double PrismCenterX = 0.32, PrismCenterY = 0.44;

    /// <summary>
    /// 2.5.2 point 8 (P3): the spectrum floor. 42 bars across the middle ~79% of
    /// the width (the mockup's x 90 -> 720 of 800), band-coloured at 50% opacity
    /// so the beams stay the subject, rising on the SAME smoothed bands the beams
    /// bend on.
    /// </summary>
    public const int SpectrumBars = 42;
    public const double SpectrumLeft = 90.0 / 800.0, SpectrumRight = 720.0 / 800.0;
    public const double SpectrumOpacity = 0.5;
    /// <summary>The floor a bar never falls below, as a share of its band - "it never flattens to nothing".</summary>
    /// <summary>
    /// The floor a bar never falls below, as a share of its band - "it never
    /// flattens to nothing". Lowered from 0.22 on 2026-09-03 after seeing it on
    /// a wall: at 0.22 an idle bar was about as tall as it was wide, and with a
    /// half-width corner radius 42 of them read as a row of coloured DOTS across
    /// the bottom of the room rather than a quiet floor under the beams.
    /// </summary>
    public const double SpectrumFloor = 0.09;
    /// <summary>The tallest a bar gets, as a share of the bottom sixth (the mockup's tallest is 60 of 450).</summary>
    public const double SpectrumCeil = 0.8;

    /// <summary>Which band bar <paramref name="bar"/> reads: bar i -> band i * bands / 42 (point 8).</summary>
    public static int SpectrumBandOf(int bar, int bands)
        => bands <= 0 ? 0 : Math.Min(bands - 1, Math.Max(0, bar) * bands / SpectrumBars);

    /// <summary>
    /// A bar's height in pixels on a canvas <paramref name="height"/> tall. Idle
    /// settles to the floor and drifts with the ambient signal; reduced motion is
    /// static AT the floor. Never zero either way (point 8, and point 6's "never
    /// a black screen" applied to the floor).
    /// </summary>
    public static double SpectrumBarHeight(double level, double height, bool reducedMotion)
    {
        var l = reducedMotion ? 0 : Math.Min(1, Math.Max(0, level));
        return Math.Max(1, (SpectrumFloor + (1 - SpectrumFloor) * l) * (height / 6) * SpectrumCeil);
    }

    /// <summary>Floor of the ambient idle frame - core's AMBIENT_FLOOR. Above zero is the "never a black screen" guarantee.</summary>
    public const double AmbientFloor = 0.05;

    /// <summary>Swing of the ambient idle frame - core's AMBIENT_SWING.</summary>
    public const double AmbientSwing = 0.07;

    /// <summary>
    /// 2.5.2 point 6, the C# twin of core's <c>ambientSignal(t, n)</c>
    /// (packages/core/src/visualization.ts): one slow wave across the bands, no
    /// beat, every value at or above <see cref="AmbientFloor"/>. A visualization
    /// with no playing source drifts on this instead of going dark.
    /// </summary>
    public static float[] Ambient(double t, int n)
    {
        if (n <= 0) return Array.Empty<float>();
        var o = new float[n];
        for (var i = 0; i < n; i++)
        {
            var x = n == 1 ? 0 : (double)i / (n - 1);
            var wave = (Math.Sin(t * 0.18 + x * Math.PI * 1.6) + 1) / 2;
            o[i] = (float)(AmbientFloor + AmbientSwing * wave);
        }
        return o;
    }
}
