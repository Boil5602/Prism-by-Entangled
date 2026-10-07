using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace PrismHost;

/// <summary>
/// The media hub switch in the Prism menu (docs/features/media-hub.md, 2026-10-05): the trade-off said before Windows asks, the scheduled
/// task registered or removed by Services.MediaHub, the pill saying what happened.
/// </summary>
public sealed partial class MainWindow
{
    private async Task ToggleMediaHubAsync()
    {
        var on = await Services.MediaHub.RefreshAsync(force: true);
        var body = new TextBlock
        {
            TextWrapping = TextWrapping.Wrap, Foreground = HubInk, FontSize = 15, MaxWidth = 560,
            Text = on
                ? "The scheduled task that puts this PC's sign-in session back on its own screen after a Remote Desktop connection leaves will be removed. "
                  + "After that, a remote desktop that leaves takes Prism's sound and screen with it until someone signs in at the PC."
                  + "\n\nWindows will ask for permission once."
                : "When a Remote Desktop connection to this PC is closed, Windows leaves this sign-in session off the screen and takes every audio device away from it: "
                  + "Prism goes dark and silent, and a phone listening hears nothing. With this on, a small scheduled task puts the session back on the PC's own screen "
                  + "the moment a remote desktop leaves, so Prism and its sound carry on."
                  + "\n\nThe trade-off: after a remote desktop leaves, this PC's screen shows the desktop signed in, not the sign-in screen. Anyone at the PC has it. "
                  + "Turn this on for a PC whose screen is Prism's."
                  + "\n\nWindows will ask for permission once.",
        };
        var dlg = new ContentDialog
        {
            Title = Services.MediaHub.MenuLabel + (on ? ": turn off" : ": turn on"),
            Content = body,
            PrimaryButtonText = on ? "Turn off" : "Turn on",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = RootGrid.XamlRoot,
            RequestedTheme = ElementTheme.Dark,
        };
        try { if (await dlg.ShowAsync() != ContentDialogResult.Primary) return; }
        catch { return; }
        var ok = on ? await Services.MediaHub.TurnOffAsync(LogLine) : await Services.MediaHub.TurnOnAsync(LogLine);
        SetPill("Prism" + Mid + (ok
            ? (on ? "the screen and the sound now leave with a remote desktop" : "the screen and the sound stay when a remote desktop leaves")
            : "Windows did not allow the change"));
    }
}
