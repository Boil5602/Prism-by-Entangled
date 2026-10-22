using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media.Animation;
using PrismHost.Visualizations;

namespace PrismHost;

/// <summary>
/// The music player's sleep (2026-10-22, "lets let the music player go to sleep, where it still shows the visual, poster art, and the
/// song/service/album/station/playlist details in the bottom left. Let everything else hide when the mouse isnt actively over the window
/// after a few seconds" / "and hide the mouse cursor after 10 seconds (lets just make the rest time 10 seconds)"). Ten seconds after the
/// pointer last moved, the transport, the clock, the top-left column, the progress bar and the top-centre block (this PC's name, MUTED)
/// fade out, and the cursor hides while it rests over the stage; the first move brings everything back at once. The visual, the poster
/// and the track block never sleep: they are what the screen is for. The pointer's place is read from the system every half second
/// (MainWindow.PointerCheck.cs: Entered / Exited cannot be trusted across a WebView2), so a pointer that left the window sleeps the
/// player too. The rule itself is VisualizationChrome.Asleep / CursorHidden (tested); music.sleep (host-prefs.json) turns it off from
/// the Prism menu. docs/concept-scenes.md, the 2026-10-22 decision.
/// </summary>
public sealed partial class MainWindow
{
    [DllImport("user32.dll")] private static extern int ShowCursor(bool show);

    private const string MusicSleepKey = "music.sleep";
    private static bool MusicSleepOn => HostPrefs.GetBool(MusicSleepKey, true);

    private DispatcherTimer? _vizSleepTimer;
    private CursorPoint _vizPointerAt;
    private DateTime _vizPointerStill = DateTime.UtcNow;
    private bool _vizAsleep, _cursorHidden;
    /// <summary>The last Quick play or order flyout shown: the player stays awake while one is open.</summary>
    private FlyoutBase? _vizFlyout;

    private void EnsureVizSleepTimer()
    {
        if (_vizSleepTimer is not null) return;
        _vizSleepTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _vizSleepTimer.Tick += (_, __) => VizSleepTick();
        _vizSleepTimer.Start();
    }

    private void VizSleepTick()
    {
        try
        {
            // a move counts only over this window: a mouse at work in another window lets the player rest ("I woke it by putting my mouse
            // over it, then left, but it never went back to rest mode", 2026-10-22 11:18 - the first cut reset the clock on any move anywhere)
            if (GetCursorPos(out var p))
            {
                var moved = p.X != _vizPointerAt.X || p.Y != _vizPointerAt.Y;
                _vizPointerAt = p;
                if (moved && PointerIsOverWindow(p)) _vizPointerStill = DateTime.UtcNow;
            }
            var still = (DateTime.UtcNow - _vizPointerStill).TotalSeconds;
            var chromeUp = _vizChrome.Values.Any(g => g.Opacity > 0) && !VideoHubOpen && !VisualizationEditMode;
            var open = _volumePopup is { IsOpen: true } || _soundWheel is { IsOpen: true } || _vizFlyout is { IsOpen: true } || _menuOpen;
            var asleep = MusicSleepOn && VisualizationChrome.Asleep(still, chromeUp, open);
            if (asleep != _vizAsleep) SetVizAsleep(asleep);
            var overStage = asleep && _vizChrome.Values.Any(g => g.Opacity > 0 && PointerIsOver(g));
            SetCursorHidden(VisualizationChrome.CursorHidden(asleep, overStage));
        }
        catch (Exception ex) { LogLine("viz sleep: " + ex.Message); }
    }

    /// <summary>Is a screen point (physical pixels, as GetCursorPos gives it) inside this window?</summary>
    private bool PointerIsOverWindow(CursorPoint p)
    {
        try
        {
            var pos = AppWindow.Position; var sz = AppWindow.Size;
            return p.X >= pos.X && p.X < pos.X + sz.Width && p.Y >= pos.Y && p.Y < pos.Y + sz.Height;
        }
        catch { return false; }
    }

    /// <summary>A move or a tap on the chrome: awake now, not at the next tick.</summary>
    private void WakeViz()
    {
        _vizPointerStill = DateTime.UtcNow;
        if (GetCursorPos(out var p)) _vizPointerAt = p;
        if (_vizAsleep) SetVizAsleep(false);
        SetCursorHidden(false);
    }

    /// <summary>The window's own furniture asleep with the stage - the Prism grip and the top-right corner (the Music / Video switch, the report
    /// flag) - each with the opacity and hit-test state it had when sleep came ("Can we include the Prism menu and the three buttons ... in the
    /// items that hide during rest", 2026-10-22 11:22).</summary>
    private readonly List<(UIElement el, double rest, bool hit)> _windowSleepers = new();

    private void SetVizAsleep(bool asleep)
    {
        _vizAsleep = asleep;
        LogLine("viz sleep: " + (asleep ? "asleep" : "awake"));
        foreach (var parts in _vizParts.Values)
            foreach (var (el, rest, hit) in parts.Sleepers)
            {
                el.IsHitTestVisible = !asleep && hit;
                FadeTo(el, asleep ? 0 : rest, asleep ? 700 : 160);
            }
        if (asleep)
        {
            _windowSleepers.Clear();
            foreach (var el in new UIElement?[] { MenuGrip, PlayerGrip, _reportGrip })
            {
                if (el is null) continue;
                _windowSleepers.Add((el, el.Opacity, el.IsHitTestVisible));
                el.IsHitTestVisible = false;
                FadeTo(el, 0, 700);
            }
        }
        else
        {
            foreach (var (el, rest, hit) in _windowSleepers) { el.IsHitTestVisible = hit; FadeTo(el, rest, 160); }
            _windowSleepers.Clear();
        }
    }

    /// <summary>A fade that leaves the element's own Opacity free afterwards (the base value set to the target, the animation released at its end), so the transport's own brighten-and-settle keeps working between sleeps.</summary>
    private static void FadeTo(UIElement el, double to, int ms)
    {
        var from = el.Opacity;
        el.Opacity = to;
        if (Math.Abs(from - to) < 0.001) return;
        var a = new DoubleAnimation { From = from, To = to, Duration = new Duration(TimeSpan.FromMilliseconds(ms)), FillBehavior = FillBehavior.Stop };
        Storyboard.SetTarget(a, el); Storyboard.SetTargetProperty(a, "Opacity");
        var sb = new Storyboard(); sb.Children.Add(a); sb.Begin();
    }

    private void SetCursorHidden(bool hidden)
    {
        if (hidden == _cursorHidden) return;
        _cursorHidden = hidden;
        ShowCursor(!hidden);
        LogLine("viz sleep: cursor " + (hidden ? "hidden" : "shown"));
    }

    private static string MusicSleepTip() =>
        "Ten seconds after the mouse stops, the music player's controls, clock and name fade and the cursor hides. The visual, the poster and the song stay. Press to turn it " + (MusicSleepOn ? "off." : "on.");

    private void ToggleMusicSleep()
    {
        var on = !MusicSleepOn;
        HostPrefs.Set(MusicSleepKey, on);
        LogLine("viz sleep: " + (on ? "on" : "off"));
        if (!on) { if (_vizAsleep) SetVizAsleep(false); SetCursorHidden(false); }
        SetPill("Prism" + Mid + (on ? "the music player sleeps after 10 seconds" : "the music player stays awake"));
    }
}
