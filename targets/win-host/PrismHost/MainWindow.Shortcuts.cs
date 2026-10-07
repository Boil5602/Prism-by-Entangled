using System;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace PrismHost;

/// <summary>
/// Where Prism can be started from (2026-10-06, "On first run when prism goes to its final folder location, we should prompt the user to see
/// whether they want to add a shortcut to their desktop, taskbar, start menu"). Asked once when a download has installed itself into the
/// install folder, and again from the Device page. The Start menu and the desktop are shortcuts Prism writes in the person's own folders.
/// The taskbar is the person's own to pin (Windows gives a desktop app no way to pin itself), so choosing it shows the two presses that do it.
/// </summary>
public sealed partial class MainWindow
{
    private async Task AskShortcutsAsync(bool firstRun)
    {
        var body = new StackPanel { Spacing = 10, MaxWidth = 520 };
        body.Children.Add(new TextBlock { Text = firstRun ? "Prism is installed. Where would you like to start it from?" : "Where would you like to start Prism from?", FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        CheckBox Box(string text, bool on) => new() { Content = new TextBlock { Text = text, FontSize = 15, Foreground = HubInk }, IsChecked = on };
        var start = Box("Start menu", firstRun || Services.Updates.HasShortcut(Services.Updates.ShortcutPlace.StartMenu));
        var desk = Box("Desktop", Services.Updates.HasShortcut(Services.Updates.ShortcutPlace.Desktop));
        var bar = Box("Taskbar", false);
        var barHow = new TextBlock { FontSize = 14, Foreground = HubAmber, TextWrapping = TextWrapping.Wrap, Visibility = Visibility.Collapsed, Margin = new Thickness(28, -4, 0, 0) };
        void SayHow()
        {
            barHow.Visibility = bar.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
            barHow.Text = start.IsChecked == true
                ? "Windows lets only you pin an app to the taskbar. After Done, open Start, right-click Prism and choose Pin to taskbar."
                : "Windows lets only you pin an app to the taskbar. Right-click Prism's button on the taskbar and choose Pin to taskbar.";
        }
        bar.Checked += (_, __) => SayHow(); bar.Unchecked += (_, __) => SayHow();
        start.Checked += (_, __) => SayHow(); start.Unchecked += (_, __) => SayHow();
        body.Children.Add(start); body.Children.Add(desk); body.Children.Add(bar); body.Children.Add(barHow);
        body.Children.Add(new TextBlock { Text = "You can change this later in the Prism menu under Device.", FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        var dlg = new ContentDialog { Title = "Shortcuts", Content = body, PrimaryButtonText = "Done", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark, DefaultButton = ContentDialogButton.Primary };
        if (!firstRun) dlg.CloseButtonText = "Cancel";
        var result = ContentDialogResult.Primary;
        try { result = await dlg.ShowAsync(); }
        catch (Exception ex) { LogLine("shortcuts: " + ex.Message); if (!firstRun) return; }   // another dialog was up: the first run still gets its Start menu entry
        // the first run applies the choice however the dialog closed, so Prism is never left with no way to start it; later, Cancel changes nothing
        if (!firstRun && result != ContentDialogResult.Primary) return;
        var okStart = Services.Updates.SetShortcut(Services.Updates.ShortcutPlace.StartMenu, start.IsChecked == true, LogLine);
        var okDesk = Services.Updates.SetShortcut(Services.Updates.ShortcutPlace.Desktop, desk.IsChecked == true, LogLine);
        LogLine("shortcuts: start menu " + (start.IsChecked == true) + ", desktop " + (desk.IsChecked == true) + ", taskbar asked " + (bar.IsChecked == true));
        if (!okStart || !okDesk) SetPill("Prism" + Mid + "a shortcut could not be changed. host.log says why.");
        else if (!firstRun) SetPill("Prism" + Mid + "shortcuts saved");
    }

    /// <summary>The Device page's line: where shortcuts are now.</summary>
    private static string ShortcutsLine()
    {
        var s = Services.Updates.HasShortcut(Services.Updates.ShortcutPlace.StartMenu);
        var d = Services.Updates.HasShortcut(Services.Updates.ShortcutPlace.Desktop);
        return s && d ? "Prism is in your Start menu and on your desktop."
            : s ? "Prism is in your Start menu."
            : d ? "Prism is on your desktop."
            : "Prism has no Start menu or desktop shortcut. It is in " + Services.Updates.InstallDir + ".";
    }
}
