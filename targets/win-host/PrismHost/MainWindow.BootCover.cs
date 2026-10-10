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
    /// <summary>The splash page is on its way: the cover waits for its run before going (four seconds at most after Watch asks).</summary>
    private bool _splashPending;
    private string? _coverReleaseWhy;
    private DispatcherTimer? _coverWait;
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
        // the splash reads PRISM with the wordmark's own run (2026-10-05, "it says loading prism on a splash screen. We need that to instead
        // read PRISM with the fading effect ... I want that in the splash screen every time"): core's splash page (Assets/brain/prism-splash.html,
        // docs/features/animated-wordmark.md) in a WebView2 over the cover, shown once it has painted; the mark stands alone until then,
        // and alone when the page is missing. No "Loading" line: the word is the splash.
        mark.HorizontalAlignment = HorizontalAlignment.Center; mark.VerticalAlignment = VerticalAlignment.Center;
        cover.Children.Add(mark);
        Canvas.SetZIndex(cover, 940);   // over the tiles and the Watch page's layer; beneath the pill and the grips
        RootGrid.Children.Add(cover);
        _bootCover = cover;
        _ = ShowSplashWordmarkAsync(cover, mark);
        var failsafe = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        failsafe.Tick += (_, __) => { failsafe.Stop(); RemoveBootCover("failsafe"); };
        failsafe.Start();
    }

    /// <summary>The splash wordmark: core's page in a WebView2 over the cover, visible once it has painted (the mark alone until then).</summary>
    private async Task ShowSplashWordmarkAsync(Grid cover, Image mark)
    {
        string html;
        try
        {
            var p = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "brain", "prism-splash.html");
            if (!System.IO.File.Exists(p)) { LogLine("boot cover: no splash page, the mark alone"); return; }
            html = System.IO.File.ReadAllText(p);
            if (html.Trim().Length == 0) return;
        }
        catch { return; }
        _splashPending = true;
        var started = DateTime.Now;
        var view = new WebView2 { DefaultBackgroundColor = Windows.UI.Color.FromArgb(0xFF, 0x0B, 0x0D, 0x11), Opacity = 0, IsHitTestVisible = false };
        cover.Children.Add(view);
        try
        {
            // the data folder by its static path: the cover is made before the store service exists (MainWindow's constructor, line 48 before 61)
            var env = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateWithOptionsAsync(null, System.IO.Path.Combine(HostPaths.DataDir, "linkview"), new Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions());
            await view.EnsureCoreWebView2Async(env);
            if (!ReferenceEquals(_bootCover, cover)) { view.Close(); SplashDone("cover already gone"); return; }
            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false; core.Settings.AreDefaultContextMenusEnabled = false; core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false; core.Settings.IsZoomControlEnabled = false;
            // the page is the one string; a link out of it goes nowhere (there is none)
            core.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith("data:", StringComparison.Ordinal) && !e.Uri.StartsWith("about:", StringComparison.Ordinal)) e.Cancel = true; };
            core.NewWindowRequested += (_, e) => { e.Handled = true; };
            core.NavigationCompleted += (sender, e) =>
            {
                if (!e.IsSuccess || !ReferenceEquals(_bootCover, cover)) { SplashDone(e.IsSuccess ? "cover gone before the page" : "page failed " + e.WebErrorStatus); return; }
                view.Opacity = 1; mark.Visibility = Visibility.Collapsed;
                // the word plays whatever Windows says about animations, under the PC's own Full motion rule (2026-10-09, "why isn't my
                // splash screen animating??": Remote Desktop turns animations off, the page saw reduced motion and stood still). Where
                // it has already played, the page's own two-second guard makes this nothing.
                if (PrismHost.Surfaces.Visualization.VisualizationHost.ForceFullMotion)
                    _ = PlaySplashWordAsync(core);
                LogLine("boot cover: wordmark up at +" + (DateTime.Now - started).TotalSeconds.ToString("0.0") + " s");
                // the run: two frames to start, 1.5 s to play (docs/features/animated-wordmark.md), then the cover may go
                var run = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1800) };
                run.Tick += (_, __) => { run.Stop(); SplashDone("played"); };
                run.Start();
            };
            core.NavigateToString(html);
        }
        catch (Exception e) { LogLine("boot cover: wordmark " + e.Message); try { cover.Children.Remove(view); view.Close(); } catch { } SplashDone("failed"); }
    }

    /// <summary>Full motion: the splash's word is marked pw-full and played; host.log says whether the page had been asked for reduced motion and what ran.</summary>
    private async Task PlaySplashWordAsync(Microsoft.Web.WebView2.Core.CoreWebView2 core)
    {
        try
        {
            var r = await core.ExecuteScriptAsync("(function(){var e=document.querySelector('.pw');if(!e||!window.PrismWordmark)return 'no word';var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;e.classList.add('pw-full');var played=PrismWordmark.play(e);return (reduced?'reduced motion asked, ':'')+(played?'played':'already playing')+', animation '+getComputedStyle(e).animationName;})()");
            LogLine("boot cover: full motion, " + r.Trim('"'));
        }
        catch (Exception e) { LogLine("boot cover: full motion " + e.Message); }
    }

    /// <summary>The splash's run is over, or never came: the cover goes if something already asked it to.</summary>
    private void SplashDone(string why)
    {
        _splashPending = false;
        if (_coverWait is { } t) { t.Stop(); _coverWait = null; }
        LogLine("boot cover: splash " + why);
        if (_coverReleaseWhy is { } held) { _coverReleaseWhy = null; RemoveBootCover(held); }
    }

    private void RemoveBootCover(string why)
    {
        if (_bootCover is null) return;
        // the wordmark's run first (2026-10-05, "I want that in the splash screen every time"): a cover asked away while the splash page is still
        // starting or playing waits for the run, four seconds at most, so a boot that draws Watch in two seconds still shows the word play once
        if (why != "failsafe" && _splashPending)
        {
            if (_coverReleaseWhy is null)
            {
                _coverReleaseWhy = why;
                var wait = new DispatcherTimer { Interval = TimeSpan.FromSeconds(4) };
                wait.Tick += (_, __) => { wait.Stop(); if (ReferenceEquals(_coverWait, wait)) { _coverWait = null; _splashPending = false; var held = _coverReleaseWhy ?? why; _coverReleaseWhy = null; LogLine("boot cover: splash not up in time"); RemoveBootCover(held); } };
                wait.Start(); _coverWait = wait;
            }
            return;
        }
        _coverReleaseWhy = null;
        if (_coverWait is { } w0) { w0.Stop(); _coverWait = null; }
        var c = _bootCover; _bootCover = null;
        var fade = new Microsoft.UI.Xaml.Media.Animation.DoubleAnimation { From = 1, To = 0, Duration = new Duration(TimeSpan.FromMilliseconds(260)) };
        var sb = new Microsoft.UI.Xaml.Media.Animation.Storyboard();
        Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTarget(fade, c); Microsoft.UI.Xaml.Media.Animation.Storyboard.SetTargetProperty(fade, "Opacity");
        sb.Children.Add(fade);
        sb.Completed += (_, __) =>
        {
            RootGrid.Children.Remove(c);
            // the splash's WebView2 closed with the cover: its browser process goes, nothing of it stays behind the wall
            for (var i = c.Children.Count - 1; i >= 0; i--) if (c.Children[i] is WebView2 w) { c.Children.RemoveAt(i); try { w.Close(); } catch { } }
        };
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
