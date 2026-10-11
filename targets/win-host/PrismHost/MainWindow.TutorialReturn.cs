using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace PrismHost;

/// <summary>
/// The way back to the tour (2026-10-10, "if its initiated by the tutorial there is a return to tutorial button? I dont like the dead
/// ends back to the home screen. Promote exploration through transparency"). A page of How Prism works can open the real thing: Set up
/// services, the TMDB guide, Watch settings, Pair a phone, Profiles, Updates. While that is up, a button at the top of the screen says
/// Back to How Prism works. Pressing it puts away whatever the tour opened and shows the tour at the page it was left on. Closing the
/// pairing card or the Updates dialog by their own Close does the same. The small X beside the button is for someone who would
/// rather stay where the tour took them.
/// </summary>
public sealed partial class MainWindow
{
    private StackPanel? _tourBack;

    /// <summary>True while something the tour opened is up, and the tour is owed its return.</summary>
    private bool TourOwed => _tourBack is not null;

    /// <summary>The tour has opened the real thing: the way back goes up over it.</summary>
    private void TourLaunched()
    {
        TourForget();
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 46, 0, 0) };
        Canvas.SetZIndex(row, 990);   // over every page the tour opens, under the Prism tab and its menu
        var back = Chip(new TextBlock { Text = (char)0x2039 + "  Back to How Prism works", FontSize = 17, Foreground = HubInk }, true);
        back.Click += (_, __) => TourReturn();
        var stay = Chip(new TextBlock { Text = ((char)0x2715).ToString(), FontSize = 15, Foreground = HubInk }, false);
        ToolTipService.SetToolTip(stay, "Stay here. Prism menu, then How Prism works, opens the tour again at the page you left.");
        stay.Click += (_, __) => TourForget();
        row.Children.Add(back); row.Children.Add(stay);
        RootGrid.Children.Add(row);
        _tourBack = row;
    }

    /// <summary>The way back taken down, nothing else touched.</summary>
    private void TourForget() { if (_tourBack is { } b) { RootGrid.Children.Remove(b); _tourBack = null; } }

    /// <summary>Back to the tour: whatever it opened is put away, and the tour shows the page it was left on.</summary>
    private void TourReturn()
    {
        if (_tourBack is null) return;
        TourForget();
        LogLine("tutorial: back from what it opened");
        try
        {
            ClosePairCard();
            CloseTmdbGuide();
            CloseWatchSettings();
            CloseProfilesWindow();
            _updatesDlg?.Hide();
            if (_welcome is not null) CloseWelcome();
        }
        catch (Exception ex) { LogLine("tutorial: closing what it opened: " + ex.Message); }
        ShowTutorial();
    }
}
