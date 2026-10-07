using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Ad debug, on the report flag's menu (2026-10-07, "Lets add an AD Debug ... option to the flag menu. When enabled, both Not an Ad, and Is an
/// Ad should show up on each of the visible up to 5 screens. And the ads aren't shown, but the reporting buttons should be. We can let the
/// reporting work for any service ... AND we need to know that Intermission WOULD be ON or OFF"): while it is on, covers are not drawn and
/// every visible window shows its intermission state and the two reports (Surfaces/SurfaceManager.AdDebug.cs). A report goes to the report
/// inbox at once (the channel, the state, the break watch's readings of the last forty seconds on YouTube TV) and is kept on this PC with
/// the bench's recording, so each one is a labelled moment to tune on.
/// </summary>
public sealed partial class MainWindow
{
    private bool _adDebugWired;

    /// <summary>The flag's menu: the report form, and the Ad debug switch.</summary>
    private void ShowFlagMenu(FrameworkElement at)
    {
        var fly = new MenuFlyout { MenuFlyoutPresenterStyle = (Style)RootGrid.Resources["PrismMenuPresenter"] };
        var shield = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)) };
        Canvas.SetZIndex(shield, 999);
        shield.PointerPressed += (_, e) => { e.Handled = true; fly.Hide(); };
        fly.Opened += (_, __) => { if (!RootGrid.Children.Contains(shield)) RootGrid.Children.Add(shield); };
        fly.Closed += (_, __) => RootGrid.Children.Remove(shield);
        var report = new MenuFlyoutItem { Text = "Report a problem or an idea" };
        report.Click += (_, __) => _ = ShowReportFormAsync();
        fly.Items.Add(report);
        var debug = new ToggleMenuFlyoutItem { Text = "Ad debug", IsChecked = _surfaces.AdDebug };
        debug.Click += (_, __) => SetAdDebug(debug.IsChecked);
        fly.Items.Add(debug);
        fly.ShowAt(at, new FlyoutShowOptions { Placement = FlyoutPlacementMode.BottomEdgeAlignedRight });
    }

    private void SetAdDebug(bool on)
    {
        WireAdDebug();
        _surfaces.AdDebug = on;
        HostPrefs.Set("debug.ads", on);
        LogLine("ad debug: " + (on ? "on" : "off"));
        SetPill("Prism" + Dot + (on ? "ad debug on: covers aren't drawn, each window shows its intermission state and two reports" : "ad debug off"));
    }

    private void WireAdDebug()
    {
        if (_adDebugWired) return;
        _adDebugWired = true;
        _surfaces.AdDebugReport += (id, isAd) => _ = AdDebugReportAsync(id, isAd);
        var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        t.Tick += (_, __) =>
        {
            if (!_surfaces.AdDebug) return;
            _surfaces.BigWindowFoot = Math.Max(120, StageBar.ActualHeight + StageBar.Margin.Bottom + 14);   // above the controls, wherever they sit
            _surfaces.SyncAdDebug();   // windows come and go; the strips follow
        };
        t.Start();
    }

    /// <summary>At start: the switch as it was left (once the surfaces are made).</summary>
    private void InitAdDebugSoon()
    {
        var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        t.Tick += (_, __) =>
        {
            if (_surfaces is null) return;
            t.Stop();
            // a muted break's Unmute / Mute again (Watch settings' Video ads): core keeps the word for the rest of the break
            _surfaces.BreakUnmutePressed += (id, on) => { _ = ModelCallAsync("intermissionUnmute", id, on); LogLine("break " + id + ": " + (on ? "unmuted" : "muted again") + " by the person"); };
            InitAdDebug();
        };
        t.Start();
    }
    private void InitAdDebug()
    {
        if (!HostPrefs.GetBool("debug.ads", false)) return;
        WireAdDebug();
        _surfaces.AdDebug = true;
    }

    private async Task AdDebugReportAsync(string tileId, bool isAd)
    {
        var url = _surfaces.SourceOf(tileId) ?? "";
        var site = "";
        try { site = new Uri(url).Host; } catch { }
        var covered = _surfaces.VeilStates().FirstOrDefault(v => v.Id == tileId).Covered;
        var channel = _watches.TryGetValue(tileId, out var st) ? st.ChannelName : "";
        var readings = st is not null ? st.Recent.ToList() : new List<string>();
        Bench(tileId, _watchClock.Elapsed.TotalSeconds, null, isAd ? "isad" : "notad");
        // a press can come a moment before a cover that was only slow (2026-10-07, "Sometimes I might hit 'this is an ad' because the program
        // was a little late to start hiding something"): an uncovered ad's report waits up to 15 s and says whether the cover came, and when
        double? lateSec = null;
        if (isAd && !covered)
        {
            var asked = DateTime.Now;
            while ((DateTime.Now - asked).TotalSeconds < 15)
            {
                await Task.Delay(500);
                if (_surfaces.VeilStates().FirstOrDefault(v => v.Id == tileId).Covered) { lateSec = Math.Round((DateTime.Now - asked).TotalSeconds, 1); break; }
            }
        }
        var what = isAd
            ? (covered ? "an ad, covered" : lateSec is { } ls ? "an ad, covered " + ls + " s after the press (late)" : "an ad, not covered within 15 s (missed)")
            : (covered ? "the show, covered (wrong cover)" : "the show, not covered");
        LogLine("ad debug " + tileId + ": the person says " + what + (channel.Length > 0 ? " (" + channel + ")" : ""));
        Correction(tileId, channel.Length > 0 ? channel : site, isAd ? (lateSec is { } l2 ? "is an ad (late " + l2 + " s)" : covered ? "is an ad" : "is an ad (missed)") : "not an ad");
        var probe = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(System.Text.Json.JsonSerializer.Serialize(new
        {
            signals = new { intermission = covered ? "on" : "off", coveredAfterSec = lateSec, channel, readings },
        }));
        await SendReportAsync(tileId, site, url, probe, null, isAd ? "is-an-ad" : "not-an-ad", "Ad debug: " + what, false);
    }
}
