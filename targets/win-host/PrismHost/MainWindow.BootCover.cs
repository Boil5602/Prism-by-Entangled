using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The boot cover (2026-09-24, "Why does the app restart and always go to some movie service's home page. It should either go to watch or to
/// the music player, whichever was opened last"): the Video player's screen tile loads a service's page at once, while Watch opens only when
/// core has read the kept rows - so for a few seconds the wall showed that service's home. The host remembers the player last on
/// (last-player.txt beside host.log's folder); when it was the Video player, a dark cover with the Prism mark stands over the wall from the
/// first frame until Watch is drawn (or a title is already up, or the wall turns out to be the Music player; 30 s at most). Shown at every start as
/// the Prism splash while the wall loads.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _bootCover;
    private static string LastPlayerPath => System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Prism", "last-player.txt");

    private void InitBootCover()
    {
        string? last = null;
        try { if (System.IO.File.Exists(LastPlayerPath)) last = System.IO.File.ReadAllText(LastPlayerPath).Trim(); } catch { }
        // a splash at every start ("lets get a Prism splash screen going while that's happening", 2026-09-24): Watch named when it is what comes up
        var mark = new Image { Width = 96, Height = 96 };
        try { var p = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "prism-icon.png"); if (System.IO.File.Exists(p)) mark.Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(p)); } catch { }
        // one product: the splash names Prism, not a player ("the music and video players are not separate products", 2026-09-24)
        var cover = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x0B, 0x0D, 0x11)) };
        cover.Children.Add(new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Spacing = 14,
            Children = { mark, new TextBlock { Text = "Loading Prism" + (char)0x2026, FontSize = 18, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x8A, 0x93, 0xA2)), HorizontalAlignment = HorizontalAlignment.Center } },
        });
        Canvas.SetZIndex(cover, 940);   // over the tiles and the Watch page's layer; beneath the pill and the grips
        RootGrid.Children.Add(cover);
        _bootCover = cover;
        var failsafe = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        failsafe.Tick += (_, __) => { failsafe.Stop(); RemoveBootCover("failsafe"); };
        failsafe.Start();
    }

    private void RemoveBootCover(string why)
    {
        if (_bootCover is null) return;
        var c = _bootCover; _bootCover = null;
        var fade = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { From = 1, To = 0, Duration = new Duration(TimeSpan.FromMilliseconds(260)) };
        var sb = new Microsoft.UI.Xaml.Media.Animation.Storyboard();
        Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(fade, c); Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(fade, "Opacity");
        sb.Children.Add(fade);
        sb.Completed += (_, __) => RootGrid.Children.Remove(c);
        sb.Begin();
        LogLine("boot cover: off (" + why + ")");
        // startup timings (2026-09-24, measure the launch before changing it): the splash's own time since the process began, then core's
        // milestones now and at 1 and 3 minutes - one "boot timing" line each in host.log
        try { LogLine("boot timing: splash off (" + why + ") at +" + (DateTime.Now - System.Diagnostics.Process.GetCurrentProcess().StartTime).TotalSeconds.ToString("0.0") + " s since the process started"); } catch { }
        _ = LogBootTimingsAsync();
    }

    private async Task LogBootTimingsAsync()
    {
        foreach (var wait in new[] { 0, 60, 120 })
        {
            if (wait > 0) await Task.Delay(TimeSpan.FromSeconds(wait));
            try
            {
                var started = System.Diagnostics.Process.GetCurrentProcess().StartTime;
                LogLine("boot timing: at +" + (DateTime.Now - started).TotalSeconds.ToString("0") + " s, core (ms since it began): " + (await ModelCallAsync("bootTimings") ?? "none"));
            }
            catch (Exception e) { LogLine("boot timing: " + e.Message); }
        }
    }

    /// <summary>The player on now, kept for the next start.</summary>
    private static void RememberPlayer(string? active)
    {
        if (active is null) return;
        try { System.IO.File.WriteAllText(LastPlayerPath, active); } catch { }
    }
}
