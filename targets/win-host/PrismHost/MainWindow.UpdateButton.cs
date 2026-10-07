using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The update beside the report flag (2026-10-07, "show an update link/symbol next to the flag link when there is an app update to download and
/// the user has auto-update enabled. This should kick off the download and they can finish it off in the status message by telling it to run
/// the install"): shown while updates are checked for and a newer Prism is offered, or one is installed and waits for a restart. A press
/// downloads and installs the offered one (the status line follows it, and offers Restart now when it is ready); with one waiting, a press
/// restarts into it. The Updates dialog does the same with more to say.
/// </summary>
public sealed partial class MainWindow
{
    private Button? _updateButton;
    private bool _updateWaiting;   // a newer version offered, or one installed and waiting for a restart
    private bool _updateRunning;

    private Button BuildUpdateButton()
    {
        var b = Chip(new FontIcon { Glyph = ((char)0xE896).ToString(), FontSize = 14, Foreground = HubAmber }, false);
        b.Padding = new Thickness(8, 4, 8, 4);
        b.Visibility = Visibility.Collapsed;
        b.Click += async (_, __) => await UpdateButtonPressedAsync();
        _updateButton = b;
        // updates are looked for on core's schedule: the button follows what it found, every quarter hour and after each install
        var t = new DispatcherTimer { Interval = TimeSpan.FromMinutes(15) };
        t.Tick += async (_, __) => { await PollUpdateStatusAsync(); SyncUpdateButton(); };
        t.Start();
        // seen only while the controls are up, and then it pulses (2026-10-07, "Make the update button flash if there is an update waiting, but I
        // dont want to see it unless the mouse is on the screen causing the controls to appear")
        var pulse = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        pulse.Tick += (_, __) =>
        {
            var controls = StageBar.Visibility == Visibility.Visible || VideoHubOpen;
            var want = _updateWaiting && controls;
            b.Visibility = want ? Visibility.Visible : Visibility.Collapsed;
            b.Opacity = want && !_updateRunning ? (b.Opacity > 0.7 ? 0.35 : 1.0) : 1.0;
        };
        pulse.Start();
        return b;
    }

    /// <summary>Shown while checks run and a newer version is offered or one waits for a restart.</summary>
    private void SyncUpdateButton()
    {
        if (_updateButton is not { } b) return;
        var staged = Services.Updates.Staged();
        var av = (_updateStatus?["available"] as System.Text.Json.Nodes.JsonObject)?["version"]?.GetValue<string>();
        var show = Services.Updates.Enabled && (staged is not null || av is { Length: > 0 });
        _updateWaiting = show;   // drawn by the pulse, only while the controls are up
        if (!show) return;
        ToolTipService.SetToolTip(b, staged is { } st ? "Prism " + st.version + " is installed. Press to restart into it."
            : _updateRunning ? "Downloading Prism " + av + Mid + "the status line says how far"
            : "Prism " + av + " is ready. Press to download and install it. Prism asks before it restarts.");
    }

    private async Task UpdateButtonPressedAsync()
    {
        if (Services.Updates.Staged() is not null) { RestartIntoStaged(); return; }
        if (_updateRunning) { SetPill("Prism" + Mid + "the update is downloading. The status line says how far"); return; }
        _updateRunning = true; SyncUpdateButton();
        LogLine("updates: install pressed beside the flag");
        try { _updateStatus = System.Text.Json.Nodes.JsonNode.Parse(await ModelCallAwaitAsync("updateInstallNow", 15 * 60_000) ?? "null") as System.Text.Json.Nodes.JsonObject; }
        catch (Exception ex) { LogLine("updates: install " + ex.Message); }
        _updateRunning = false;
        SyncUpdateButton();
        OfferRestartIfStaged();   // ready: the status line offers Restart now
    }
}
