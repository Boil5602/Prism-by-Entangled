using NAudio.CoreAudioApi;

namespace PrismHost.Surfaces;

/// <summary>
/// Private listening's sound rules (2026-10-04, "When I mute it on the PC, it also mutes it on the phone. That won't work. We should have
/// volume separation between the two"): the phone hears the shared browser through a process loopback that taps AFTER a page's own
/// mute and a session's volume, so while a phone listens the pages are left audible and at full session level, and the wall's own
/// mute and volume act on the playback device instead - the TV or soundbar - which the loopback does not pass through. The phone has
/// its own volume on its page. When the last phone leaves, the pages' mutes and the wall's volume go back where they were.
/// </summary>
public sealed partial class SurfaceManager
{
    private bool _private;
    private bool _deviceWasMuted; private float _deviceWasVolume = -1;
    private bool _wallMutedWhilePrivate;
    /// <summary>The window the sound is given to (the last one unmuted): the one page a phone hears. Every other window stays muted at the
    /// page while a phone listens (2026-10-06, "I'm using remote listening and it isn't playing what is on the screen in the big window" /
    /// "I should only ever be playing 1 window at a time, whether watching on Prism or remotely on my companion app": the listen lifted every
    /// muted page, and the phone heard all five windows at once).</summary>
    private string? _soundTile;
    internal void NoteSoundTile(string id) => _soundTile = id;
    /// <summary>A page the room hears: a visible one, or a music player's hidden facet (not a reader, which plays nothing).</summary>
    private static bool Audible(Tile t) => t.Kind != SurfaceKind.Hidden || !t.Id.StartsWith("app:", StringComparison.Ordinal);

    /// <summary>On while any phone listens.</summary>
    public bool PrivateListening
    {
        get => _private;
        set
        {
            if (_private == value) return;
            _private = value;
            try
            {
                using var en = new MMDeviceEnumerator();
                using var dev = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                if (value)
                {
                    _deviceWasMuted = dev.AudioEndpointVolume.Mute; _deviceWasVolume = dev.AudioEndpointVolume.MasterVolumeLevelScalar;
                    // the pages the room hears: their own mute lifted so the loopback hears them; the wall's mute carried by the device
                    _wallMutedWhilePrivate = false;
                    // only the window with the sound: muted, it is the wall's mute (carried by the device); the others' mutes are focus, kept
                    foreach (var t in _tiles.Values)
                        if (t.Id == _soundTile && Audible(t) && t.Muted && t.View?.CoreWebView2 is { } c) { c.IsMuted = false; _wallMutedWhilePrivate = true; }
                    SessionMute.Private = true;   // the sessions at full level under the wall's volume
                    dev.AudioEndpointVolume.Mute = _wallMutedWhilePrivate || _deviceMuteWanted;   // the phone's switch (PrivateDeviceMute) counts from the start
                    dev.AudioEndpointVolume.MasterVolumeLevelScalar = (float)Math.Clamp(SessionMute.Volume, 0, 1);
                    _onStatus("private listening: the wall's mute and volume are the device's for now");
                }
                else
                {
                    SessionMute.Private = false;
                    foreach (var t in _tiles.Values) if (Audible(t) && t.View?.CoreWebView2 is { } c) c.IsMuted = t.Muted;   // the pages' own mutes back
                    dev.AudioEndpointVolume.Mute = _deviceWasMuted;
                    if (_deviceWasVolume >= 0) dev.AudioEndpointVolume.MasterVolumeLevelScalar = _deviceWasVolume;
                    _onStatus("private listening: over; the wall's sound as it was");
                }
            }
            catch (Exception ex) { _onStatus("private listening: device " + ex.Message); }
        }
    }

    /// <summary>While a phone listens, a mute of an audible page is the device's mute; the page keeps playing for the loopback.</summary>
    private bool PrivateMute(Tile tile, bool muted)
    {
        if (!_private || !Audible(tile)) return false;
        if (muted && tile.Id != _soundTile) return false;   // another window: muted at its page, so the phone does not hear it either
        if (!muted)
        {
            // the sound moved here: this page is the one heard, and the window that had it is muted at its page (a mute that came first, while
            // it still had the sound, was taken as the wall's and left it audible - the phone's window choice, 2026-10-05, moves it this way)
            if (_soundTile is { } prev && prev != tile.Id && Get(prev) is { } was && was.Muted && was.View?.CoreWebView2 is { } pc) pc.IsMuted = true;
            _soundTile = tile.Id;
            if (tile.View?.CoreWebView2 is { } c) c.IsMuted = false;
        }
        tile.Muted = muted;
        try { using var en = new MMDeviceEnumerator(); using var dev = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia); dev.AudioEndpointVolume.Mute = muted; }
        catch (Exception ex) { _onStatus("private listening: mute " + ex.Message); }
        return true;
    }
    /// <summary>The phone's switch (2026-10-05, "no audio is coming through"): the playback device muted while a phone listens, or left as the
    /// wall's mute says. The device's mute only - the pages stay audible for the loopback the phone hears.</summary>
    private bool _deviceMuteWanted;
    public void PrivateDeviceMute(bool on)
    {
        _deviceMuteWanted = on;   // kept for the listen that is starting: the phone's ask may land before its stream has
        if (!_private) { _onStatus("private listening: device mute " + (on ? "on" : "off") + " kept for the next listen"); return; }
        try { using var en = new MMDeviceEnumerator(); using var dev = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia); dev.AudioEndpointVolume.Mute = on || _wallMutedWhilePrivate; _onStatus("private listening: device mute " + (on ? "on" : "off") + " (the phone's switch)"); }
        catch (Exception ex) { _onStatus("private listening: device mute " + ex.Message); }
    }
    /// <summary>While a phone listens, the wall's volume is the device's.</summary>
    private bool PrivateVolume(double v)
    {
        if (!_private) return false;
        try { using var en = new MMDeviceEnumerator(); using var dev = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia); dev.AudioEndpointVolume.MasterVolumeLevelScalar = (float)Math.Clamp(v, 0, 1); }
        catch (Exception ex) { _onStatus("private listening: volume " + ex.Message); }
        return true;
    }
}
