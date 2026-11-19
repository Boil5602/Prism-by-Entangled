namespace PrismHost;

/// <summary>
/// The wait after a press on a Play button that resumes music (2026-11-16, asked that the seconds between the press and the sound say
/// what happens, and that every such button follows one rule). One of these sits behind each button: the music panel's card and the
/// music bar on the screen. From the press until the player answers the button is a ring and its line reads Starting or Pausing with
/// the service's name; a start that has not come after 20 seconds says so, until music plays or the button is pressed again.
/// </summary>
public sealed class PlayWait
{
    public const int GiveUpMs = 20000;
    private string? _pending; private long _at; private bool _failed;

    /// <summary>True from a press until the player answers or the wait gives up: the button shows a ring and takes no press.</summary>
    public bool Waiting => _pending is not null || _loading;
    // a pick that loads with no press on this button (a start over from the music panel, 2026-11-16): the same ring and word
    private bool _loading;

    /// <summary>A press: what was asked of the player ("pause" while it plays, else "play").</summary>
    public string Press(bool playing, long now)
    {
        _pending = playing ? "pause" : "play"; _at = now; _failed = false;
        return _pending;
    }

    /// <summary>The player's state as each refresh reads it. <paramref name="has"/> is false when the button has no player at all.</summary>
    public void Read(bool playing, bool has, long now, bool loading = false)
    {
        _loading = loading && has;
        if (_pending is not null && (!has || playing == (_pending == "play"))) _pending = null;
        else if (_pending is not null && now - _at > GiveUpMs) { _failed = _pending == "play"; _pending = null; }
        if (playing) _failed = false;
    }

    /// <summary>The words for the wait, or null when there is none: the line reads as it always does.</summary>
    public string? Words => _pending == "play" ? "Starting" + (char)0x2026 : _pending == "pause" ? "Pausing" + (char)0x2026
        : _loading ? "Starting" + (char)0x2026 : _failed ? "Did not start. Press Play again" : null;

    /// <summary>The button's name while it waits (its tooltip and what a screen reader says).</summary>
    public string? Label => _pending == "play" ? "Starting" : _pending == "pause" ? "Pausing" : _loading ? "Starting" : null;
}
