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
        if (BenchOn)
        {
            var record = new ToggleMenuFlyoutItem { Text = "Keep recording for training", IsChecked = s_record };
            record.Click += (_, __) => SetRecord(record.IsChecked);
            fly.Items.Add(record);
        }
        fly.ShowAt(at, new FlyoutShowOptions { Placement = FlyoutPlacementMode.BottomEdgeAlignedRight });
    }

    private void SetAdDebug(bool on)
    {
        WireAdDebug();
        _surfaces.AdDebug = on;
        s_adDebug = on;
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
            // where the controls' top is, kept from the last time they showed (they come and go; the strip stays put)
            if (StageBar.Visibility == Visibility.Visible && StageBar.ActualHeight > 0)
                try { _surfaces.ControlsTop = StageBar.TransformToVisual(null).TransformPoint(new Windows.Foundation.Point(0, 0)).Y; } catch { }
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
    private void SetRecord(bool on)
    {
        s_record = on;
        HostPrefs.Set("debug.record", on);
        LogLine("keep recording: " + (on ? "on" : "off"));
        SetPill("Prism" + Dot + (on ? "recording for training, with Ad debug on or off" : "recording only while Ad debug is on"));
    }

    private void InitAdDebug()
    {
        s_record = BenchOn && HostPrefs.GetBool("debug.record", false);
        if (s_record) LogLine("keep recording: on");
        if (!HostPrefs.GetBool("debug.ads", false)) return;
        WireAdDebug();
        _surfaces.AdDebug = true;
        s_adDebug = true;
    }

    // a report waits five seconds with an Undo beside it on the status line (2026-10-07, "I'd like to have been able to undo that ad report,
    // could we have a status come up at the top that says it's being sent in 5 seconds?"): the same press again on a window is not queued
    // twice, and the other answer within the five seconds replaces the first
    private readonly Dictionary<string, (bool IsAd, CancellationTokenSource Cts)> _adDebugPending = new();

    private async Task AdDebugReportAsync(string tileId, bool isAd)
    {
        var label = isAd ? "This is an ad" : "Not an ad";
        var pressedAt = DateTime.Now;   // how late a cover came is counted from the press, not from the send
        if (_adDebugPending.TryGetValue(tileId, out var pend))
        {
            if (pend.IsAd == isAd) { SetPill("Prism" + Dot + label + " is already on its way for this window"); return; }
            pend.Cts.Cancel();   // the other answer replaces it
            LogLine("ad debug " + tileId + ": " + label + " replaced the report before it was sent");
        }
        var cts = new CancellationTokenSource();
        _adDebugPending[tileId] = (isAd, cts);
        var url = _surfaces.SourceOf(tileId) ?? "";
        var site = "";
        try { site = new Uri(url).Host; } catch { }
        var covered = _surfaces.VeilStates().FirstOrDefault(v => v.Id == tileId).Covered;
        // how long a wrong cover had been up (2026-10-07, "I want to keep track of false neg/pos times. That's very important to me")
        double? wrongSec = !isAd && covered && _watches.TryGetValue(tileId, out var wc) && !double.IsNaN(wc.Model.ActiveSince) ? Math.Round(_watchClock.Elapsed.TotalSeconds - wc.Model.ActiveSince, 1) : null;
        // Not an ad over a cover lifts it, as the cover's own button does (the break watch's cover; a page's own ad signal is the page's)
        var dismissed = !isAd && covered && DismissBreak(tileId, out _, out _);
        // This is an ad after a Not an ad takes the hold back: the window may be covered again at once
        if (isAd && _watches.TryGetValue(tileId, out var held) && held.Model.Undismiss(_watchClock.Elapsed.TotalSeconds))
            LogLine("break watch " + tileId + ": This is an ad took back the Not an ad - it may be covered again");
        var channel = _watches.TryGetValue(tileId, out var st) ? st.ChannelName : "";
        var readings = st is not null ? st.Recent.ToList() : new List<string>();
        Bench(tileId, _watchClock.Elapsed.TotalSeconds, null, isAd ? "isad" : "notad");
        var undone = false;
        // the seconds counted down on the line, to 0 (2026-10-07, "can it countdown to 0 before disappearing?"); the Undo stays beside it
        string Line(int n) => "Prism" + Dot + label + (channel.Length > 0 ? " on " + channel : "") + ". The report sends in " + n + (n == 1 ? " second" : " seconds");
        ShowPillOffer(Line(5), "Undo", () => { undone = true; cts.Cancel(); }, 8);
        try
        {
            // the count follows its own line wherever it is: showing, or held while another line passes (the held line comes back after that
            // line's six seconds, without its Undo). It once followed only the line with its Undo, so a passing line left "The report sends in
            // 3 seconds" held on the screen for good (2026-10-07)
            var shown = Line(5);
            bool Mine() => _pillHeld == shown || _pillActionFor == shown;
            for (var n = 4; n >= 0; n--)
            {
                await Task.Delay(1000, cts.Token);
                if (!Mine()) continue;   // another held line took the status line: the count goes on without it
                if (PillLine.Text == shown) PillLine.Text = Line(n);
                if (_pillActionFor == shown) _pillActionFor = Line(n);
                _pillHeld = Line(n);
                shown = Line(n);
            }
            await Task.Delay(400, cts.Token);   // 0 shown a moment
            if (Mine()) ReleasePill("Prism" + Dot + label + (channel.Length > 0 ? " on " + channel : "") + ". Sending");
        }
        catch (TaskCanceledException)
        {
            if (_adDebugPending.TryGetValue(tileId, out var cur) && ReferenceEquals(cur.Cts, cts)) _adDebugPending.Remove(tileId);
            if (!undone) return;   // replaced by the other answer, which says its own
            if (dismissed && st is not null) st.Model.Undismiss(_watchClock.Elapsed.TotalSeconds);   // its hold taken back with it
            Bench(tileId, _watchClock.Elapsed.TotalSeconds, null, "undo " + (isAd ? "isad" : "notad"));
            LogLine("ad debug " + tileId + ": " + label + " undone, nothing sent");
            ReleasePill("Prism" + Dot + label + " undone. Nothing was sent");
            return;
        }
        if (_adDebugPending.TryGetValue(tileId, out var mine) && ReferenceEquals(mine.Cts, cts)) _adDebugPending.Remove(tileId);
        // a press can come a moment before a cover that was only slow (2026-10-07, "Sometimes I might hit 'this is an ad' because the program
        // was a little late to start hiding something"): an uncovered ad's report waits up to 15 s and says whether the cover came, and when
        double? lateSec = null;
        if (isAd && !covered)
        {
            var asked = pressedAt;
            while ((DateTime.Now - asked).TotalSeconds < 15)
            {
                await Task.Delay(500);
                if (_surfaces.VeilStates().FirstOrDefault(v => v.Id == tileId).Covered) { lateSec = Math.Round((DateTime.Now - asked).TotalSeconds, 1); break; }
            }
        }
        var what = isAd
            ? (covered ? "an ad, covered" : lateSec is { } ls ? "an ad, covered " + ls + " s after the press (late)" : "an ad, not covered within 15 s (missed)")
            : (covered ? "the show, covered (wrong cover" + (wrongSec is { } ws ? ", " + ws + " s" : "") + ")" : "the show, not covered");
        LogLine("ad debug " + tileId + ": the person says " + what + (channel.Length > 0 ? " (" + channel + ")" : ""));
        Correction(tileId, channel.Length > 0 ? channel : site, isAd ? (lateSec is { } l2 ? "is an ad (late " + l2 + " s)" : covered ? "is an ad" : "is an ad (missed)") : covered ? "not an ad (wrong cover" + (wrongSec is { } w2 ? " " + w2 + " s" : "") + ")" : "not an ad");
        var probe = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(System.Text.Json.JsonSerializer.Serialize(new
        {
            signals = new { intermission = covered ? "on" : "off", coveredAfterSec = lateSec, wrongCoverSec = wrongSec, channel, readings },
        }));
        await SendReportAsync(tileId, site, url, probe, null, isAd ? "is-an-ad" : "not-an-ad", "Ad debug: " + what, false);
    }
}
