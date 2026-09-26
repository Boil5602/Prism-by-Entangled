using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using PrismHost.Channel;
using PrismHost.Surfaces.Visualization;

namespace PrismHost;

/// <summary>
/// B-221 (2026-09-16): the mini player's side of the main window - opening it from the stage's corner button, feeding it
/// the stage's visual (a mirror VisualizationHost on the same style, source and bands), keeping its transport in step
/// with the stage's poll, and taking its presses through the same core calls the stage uses. Plain ASCII on purpose.
/// </summary>
public sealed partial class MainWindow
{
    private MiniPlayer.MiniPlayerWindow? _mini;
    private string? _miniTile;
    private bool _miniWired;

    /// <summary>The wall's bands, read-only: the mirror never toggles the stage's capture (disposing it must not switch the FFT off).</summary>
    private sealed class MirrorAudio : IVisualizationAudioSource
    {
        private readonly IVisualizationAudioSource? _inner;
        public MirrorAudio(IVisualizationAudioSource? inner) => _inner = inner;
        public float[] Bands(int n) => _inner?.Bands(n) ?? Array.Empty<float>();
        public void SetDemand(bool active) { }
    }

    /// <summary>"If the music player takes up the full Prism scene, minimize the full window. If it is only a frame within a
    /// Prism window, the mini player is disabled as an option" (2026-09-16): a stage fills the wall when its rect covers
    /// nine tenths of the canvas both ways.</summary>
    private bool StageFillsWall(string tileId)
        => _surfaces.RectOf(tileId) is { } r && TileCanvas.ActualWidth > 0 && TileCanvas.ActualHeight > 0 && r.W >= TileCanvas.ActualWidth * 0.9 && r.H >= TileCanvas.ActualHeight * 0.9;

    private const string MiniTipLive = "Mini player - this visual and its controls in a small window that stays on top of everything, no title bar. The full player minimizes; sign-in and settings stay there. Esc or a double-click on it brings the full player back";
    private const string MiniTipShared = "Mini player - not here: this stage shares the scene with other tiles. It is for a stage that fills the wall";

    /// <summary>The corner button's look: live ink while the stage fills the wall, dim with the reason otherwise (never disabled - a disabled control shows no tooltip).</summary>
    private void ApplyMiniLook(string tileId, VizChromeParts parts)
    {
        if (parts.Mini is null) return;
        var fills = StageFillsWall(tileId);
        parts.Mini.Foreground = fills ? VizNowInk : VizDimInk;
        ToolTipService.SetToolTip(parts.Mini, fills ? MiniTipLive : MiniTipShared);
    }

    private void OpenMiniPlayer(string tileId, string source)
    {
        if (_mini is not null) { try { _mini.Activate(); } catch { } return; }
        if (!StageFillsWall(tileId)) { SetPill("Prism " + (char)0xB7 + " the mini player is for a stage that fills the wall - this one shares the scene with other tiles"); LogLine("mini player: refused - the stage does not fill the wall"); return; }
        var spec = _surfaces.VisualizationSpec(tileId);
        if (spec is null) { SetPill("Prism " + (char)0xB7 + " no visual on this stage yet"); return; }
        var mini = new MiniPlayer.MiniPlayerWindow { Log = LogLine };
        mini.Command += cmd =>
        {
            LogLine("mini player: " + cmd);
            if (cmd is "mute" or "unmute") SetWallMutedFromWall(source, cmd == "mute");
            else _brain.Call(HostCalls.TileCommand, source, cmd);
            _ = System.Threading.Tasks.Task.Delay(400).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = RefreshVisualizationTransportAsync()));
        };
        mini.ReturnRequested += () => { LogLine("mini player: back to the full player"); CloseMiniPlayer(); RestoreMainFromMini(); };
        mini.Closed += (_, __) => { if (ReferenceEquals(_mini, mini)) { _mini = null; _miniTile = null; LogLine("mini player: closed"); } };
        _mini = mini; _miniTile = tileId;
        MirrorScene(spec.Value);
        if (!_miniWired)
        {
            _miniWired = true;
            // core's feed for the stage reaches the mirror too; a restyle (a new visual) rebuilds it
            _surfaces.FeedMirror = (id, json) => { if (id == _miniTile) _mini?.Feed(json); };
            _surfaces.VisualizationCreated = id => { if (id == _miniTile && _surfaces.VisualizationSpec(id) is { } s2) MirrorScene(s2); };
            Closed += (_, __) => CloseMiniPlayer();
        }
        try { mini.Activate(); } catch (Exception ex) { LogLine("mini player: activate failed: " + ex.Message); }
        HideMainForMini();
        _ = RefreshVisualizationTransportAsync();
    }

    /// <summary>"Don't apps normally hide the main window when a mini player is up?" (2026-09-16) - they do. But a MINIMIZED
    /// window's pages read as hidden (document.visibilityState, measured 2026-09-17), and a hidden Amazon page held its play
    /// until the window came back ("it never started to play"). So the full player is parked off the visible desktop
    /// instead: still a restored window, its pages still visible to themselves, its taskbar entry still there - just not
    /// on any screen. Returning brings it back where it was. While the wall is full screen (no window to park) it hides.</summary>
    private bool _mainHiddenForMini;
    private Windows.Graphics.PointInt32? _mainParkedFrom;
    private const int ParkX = -32000, ParkY = -32000;
    private void HideMainForMini()
    {
        try
        {
            if (AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter)
            {
                _mainParkedFrom = AppWindow.Position;
                AppWindow.Move(new Windows.Graphics.PointInt32(ParkX, ParkY));
                _mainHiddenForMini = true;
                LogLine("mini player: full player parked off screen (from " + _mainParkedFrom.Value.X + "," + _mainParkedFrom.Value.Y + ")");
            }
            else { AppWindow.Hide(); _mainHiddenForMini = true; LogLine("mini player: full player hidden (full screen)"); }
        }
        catch (Exception ex) { LogLine("mini player: could not park the full player: " + ex.Message); }
    }
    private void RestoreMainFromMini()
    {
        try
        {
            if (_mainHiddenForMini)
            {
                _mainHiddenForMini = false;
                if (!AppWindow.IsVisible) AppWindow.Show();
                if (AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter op && op.State == Microsoft.UI.Windowing.OverlappedPresenterState.Minimized) op.Restore();
                if (_mainParkedFrom is { } from && AppWindow.Position.X <= ParkX + 1) { AppWindow.Move(from); }
                _mainParkedFrom = null;
            }
            Activate();
            LogLine("mini player: full player back");
        }
        catch (Exception ex) { LogLine("mini player: could not bring the full player back: " + ex.Message); }
    }

    private void MirrorScene((string Style, string Source, string Artwork, bool Spill, string? Feed) spec)
    {
        if (_mini is null) return;
        try
        {
            var host = new VisualizationHost(spec.Style, spec.Source, spec.Artwork, new MirrorAudio(_surfaces.AudioSource), spill: false, sampleArtwork: false);
            _mini.ShowScene(host);
            if (spec.Feed is { } f) _mini.Feed(f);
            LogLine("mini player: scene " + spec.Style + " <- " + spec.Source);
        }
        catch (Exception ex) { LogLine("mini player: scene failed: " + ex.Message); }
    }

    private void CloseMiniPlayer()
    {
        var m = _mini;
        if (m is null) return;
        _mini = null; _miniTile = null;
        try { m.Close(); } catch (Exception ex) { LogLine("mini player: close failed: " + ex.Message); }
    }
}
