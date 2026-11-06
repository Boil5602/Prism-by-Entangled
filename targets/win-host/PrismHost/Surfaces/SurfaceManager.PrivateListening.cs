namespace PrismHost.Surfaces;

/// <summary>
/// Private listening's sound rules. Since B-472 (2026-11-01) there is
/// one rule: Prism's controls act on Prism's sound in the room and never on the playback device. The person's mute takes Prism's own
/// audio sessions to a floor (SessionMuter.RoomMuted, the room step's Step) and the wall's volume is their level; the captures a phone,
/// the listen page and the visualizations hear multiply that back up (ListenStream.SourceLevel, WasapiLoopbackFft.SourceLevel), so a
/// listener hears Prism at full while the room hears what the person set, and other apps on the PC keep their sound. Nothing here
/// touches the device any more (2026-10-04 to 2026-10-31 it carried the person's mute and volume on the device while a phone listened,
/// which muted every app on the PC and left the switch meaning two things).
/// What stays: the window the sound is given to, the one page a phone hears (2026-10-06).
/// </summary>
public sealed partial class SurfaceManager
{
    private bool _private;
    /// <summary>The window the sound is given to (the last one unmuted, or core's owner): the one page a phone hears. Every other window
    /// is muted at the page by audio focus, so the loopback a phone hears carries this one alone.</summary>
    private string? _soundTile;
    /// <summary>True while the sound window is the host's own guess from a page's now-playing (before core's owner was read), which a read that names
    /// no owner drops (B-470).</summary>
    private bool _soundTileGuessed;
    /// <summary>The window a phone will hear, from core's audio owner (MainWindow.Visualizations reads it with the state).</summary>
    internal void NoteSoundTile(string? id)
    {
        if (id is null)
        {
            if (!_soundTileGuessed || _soundTile is null) return;   // core names no owner: a guess from a page's own word is dropped (B-470)
            _soundTile = null; _soundTileGuessed = false;
            return;
        }
        _soundTileGuessed = false;
        _soundTile = id;
    }
    /// <summary>A page the room hears: a visible one, or a music player's hidden facet (not a reader, which plays nothing).</summary>
    private static bool Audible(Tile t) => t.Kind != SurfaceKind.Hidden || !t.Id.StartsWith("app:", StringComparison.Ordinal);

    /// <summary>On while any phone listens. The sound itself needs nothing from it since B-472; it is said in the log for the record.</summary>
    public bool PrivateListening
    {
        get => _private;
        set
        {
            if (_private == value) return;
            _private = value;
            _onStatus(value ? "private listening: a phone listens; the room keeps Prism's own mute and volume, the phone hears Prism at full" : "private listening: over");
        }
    }
}
