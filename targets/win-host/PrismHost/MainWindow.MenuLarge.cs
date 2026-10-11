using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The short Prism menu at a size for the room (2026-10-10, "Now that the Prism menu is cleaned up for general users, lets make it
/// larger and more integrated into the scene", "we need to do this in both the music player and the video player"). It is one menu
/// for both players, so both get it: rows half as tall again with text read from the sofa, a wider card in the tab's own colours,
/// and the picture dimmed softly behind it while it is open, so the menu reads as part of the scene and not as a list floating over
/// it. The full menu (five presses on About's first line) keeps the compact size: it is a builder's tool with thirty rows.
/// </summary>
public sealed partial class MainWindow
{
    private const double LargeMenuText = 19;
    private MenuFlyout? _appMenuFlyout;

    private void LargeMenu(MenuFlyout menu, Grid shield)
    {
        var style = new Style(typeof(MenuFlyoutPresenter)) { BasedOn = (Style)RootGrid.Resources["PrismMenuPresenter"] };
        style.Setters.Add(new Setter(FrameworkElement.MinWidthProperty, 440d));
        style.Setters.Add(new Setter(Control.PaddingProperty, new Thickness(10, 12, 10, 12)));
        style.Setters.Add(new Setter(Control.CornerRadiusProperty, new CornerRadius(14)));
        menu.MenuFlyoutPresenterStyle = style;
        Grow(menu.Items);
        // the scene steps back while the menu is up: still seen, still playing
        shield.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x66, 0x05, 0x06, 0x09));

        static void Grow(IList<MenuFlyoutItemBase> items)
        {
            foreach (var it in items)
            {
                if (it is MenuFlyoutSeparator) { it.Margin = new Thickness(0, 6, 0, 6); continue; }
                it.FontSize = LargeMenuText;
                it.MinHeight = 52;
                it.Padding = new Thickness(18, 12, 18, 12);
                it.CornerRadius = new CornerRadius(8);
                if (it is MenuFlyoutSubItem sub) Grow(sub.Items);
            }
        }
    }
}
