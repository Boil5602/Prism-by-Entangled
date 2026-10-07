using System;
using System.IO;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// Credits (2026-09-24, "Let's add a credits page at the top right corner near settings. Add them and their logo there. Just watch can be
/// added too"): the sources behind Watch's numbers, each named with what it provides. TMDB's API terms ask for their notice and their logo,
/// less prominent than Prism's own mark; TMDB's watch-provider data must be credited to JustWatch. The logos ship with the app (Assets/credits),
/// never fetched: the page makes no network call.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _creditsWin;

    public void CloseCredits()
    {
        if (_creditsWin is null) return;
        RootGrid.Children.Remove(_creditsWin);
        _creditsWin = null;
    }

    public void ShowCredits()
    {
        CloseCredits();
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xD8, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 960);
        scrim.PointerPressed += (_, __) => CloseCredits();
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; CloseCredits(); };
        scrim.KeyboardAccelerators.Add(esc);
        var body = new StackPanel { Spacing = 16, Margin = new Thickness(32, 26, 32, 26) };
        var card = new Border
        {
            Background = HubCard, CornerRadius = new CornerRadius(14), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x55, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(1),
            Width = 900, MaxHeight = 900, Margin = new Thickness(60, 40, 60, 40), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            Child = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled },
        };
        card.PointerPressed += (_, e) => e.Handled = true;
        scrim.Children.Add(card);

        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(new TextBlock { Text = "Credits", FontSize = 26, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
        var close = Chip(new FontIcon { Glyph = "\uE711", FontSize = 13 }, false);
        ToolTipService.SetToolTip(close, "Close (Esc)");
        close.Click += (_, __) => CloseCredits();
        Grid.SetColumn(close, 1);
        head.Children.Add(close);
        body.Children.Add(head);

        // Prism by Entangled first, its mark the largest on the page (2026-09-24, "Should entangled have a credit to itself there? ...
        // we're not currently mentioning entangled anywhere. And it is Prism by Entangled"); TMDB's terms want their logo less prominent
        var own = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, Margin = new Thickness(0, 4, 0, 4) };
        try
        {
            var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "prism-icon.png");
            if (File.Exists(icon)) own.Children.Add(new Image { Source = new BitmapImage(new Uri(icon)), Width = 56, Height = 56, VerticalAlignment = VerticalAlignment.Center });
        }
        catch { /* the name alone */ }
        var ownText = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center, MaxWidth = 760 };   // wraps beside the mark (the license line ran off the card, 2026-09-26)
        ownText.Children.Add(new TextBlock { Text = "Prism by Entangled\u2122", FontSize = 22, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
        ownText.Children.Add(new TextBlock { Text = "Open source and free, made by Entangled Labs LLC.", FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        // the license (2026-09-25, "Not MIT. Instead let's do GPLv3"; "I think we need to update the credit page"): named in words, the source's address
        // as text to copy - Credits' links open Entangled's own pages only
        ownText.Children.Add(new TextBlock { Text = "Free software under the GNU General Public License, version 3 or later, with absolutely no warranty. The source is at github.com/Boil5602/Prism-by-Entangled.", FontSize = 13, Foreground = HubDim, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true });
        own.Children.Add(ownText);
        body.Children.Add(own);
        // Entangled's own obligations, in its words (2026-09-24, "some of our personal obligations (no ads, data theft, data mining,
        // attention mining, endless subscriptions)")
        var promises = new StackPanel { Spacing = 3, Margin = new Thickness(72, 0, 0, 0) };
        promises.Children.Add(new TextBlock { Text = "Our promises to you", FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubAmber });
        foreach (var promise in new[] { "No ads.", "No data theft.", "No data mining.", "No attention mining.", "No endless subscriptions." })
            promises.Children.Add(new TextBlock { Text = "\u00B7  " + promise, FontSize = 14, Foreground = HubInk });
        // what the promises cover (2026-09-25, "something we can write on the credits page to indicate we're not guaranteeing things like no ads with
        // third party services utilized through prism"): Prism's own, not the services opened in it
        promises.Children.Add(new TextBlock
        {
            Text = "These promises are about Prism itself. The services you watch and listen to in Prism, like Netflix, Hulu or Spotify, are run by their own companies. Their ads, subscriptions and data practices are theirs, and their own terms apply. Prism hides ads where it can, but it can't promise a service will show none.",
            FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 0), MaxWidth = 720, HorizontalAlignment = HorizontalAlignment.Left,
        });
        body.Children.Add(promises);
        // the home page, and support - offered, never pressed (2026-09-24, "I want to guide but not force people through to the entangled
        // site and hopefully donate"): the home page and support, each opened on the wall only when pressed; nothing in Prism asks again
        var support = new StackPanel { Spacing = 2, Margin = new Thickness(72, 6, 0, 0) };
        support.Children.Add(new TextBlock { Text = "Prism is free. If you'd like to support Entangled, you can do that on our site. It's entirely up to you.", FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        // the addresses: Prism's page is part of Entangled's site, entangled.world/prism (2026-09-26, "I dont see why the page needs to be at
        // prism.entangled.world instead of part of the site at entangled.world"; that name stays the extension's storage), support at entangled.world/support
        var home = new HyperlinkButton { Content = new TextBlock { Text = "entangled.world/prism", FontSize = 14, Foreground = HubAmber }, Padding = new Thickness(0, 2, 0, 2) };
        ToolTipService.SetToolTip(home, "Prism's home page. It opens on the wall.");
        home.Click += (_, __) => ShowLinkModal("https://entangled.world/prism", "entangled.world/prism");   // a window over Credits, X to come back (2026-09-25)
        support.Children.Add(home);
        var give = new HyperlinkButton { Content = new TextBlock { Text = "entangled.world/support", FontSize = 14, Foreground = HubAmber }, Padding = new Thickness(0, 2, 0, 2) };
        ToolTipService.SetToolTip(give, "Support Entangled, if you'd like to. It opens on the wall.");
        give.Click += (_, __) => ShowLinkModal("https://entangled.world/support", "entangled.world/support");
        support.Children.Add(give);
        body.Children.Add(support);
        body.Children.Add(new TextBlock { Text = "Here's where the information on Watch comes from.", FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) });

        FrameworkElement? Logo(string file, double height)
        {
            try
            {
                var path = Path.Combine(AppContext.BaseDirectory, "Assets", "credits", file);
                if (!File.Exists(path)) return null;
                ImageSource src = file.EndsWith(".svg", StringComparison.OrdinalIgnoreCase) ? new SvgImageSource(new Uri(path)) : new BitmapImage(new Uri(path));
                return new Image { Source = src, Height = height, HorizontalAlignment = HorizontalAlignment.Left, Stretch = Stretch.Uniform };
            }
            catch { return null; }
        }
        void Section(string name, FrameworkElement? logo, string provides, string? notice, string site)
        {
            var box = new StackPanel { Spacing = 6, Margin = new Thickness(0, 6, 0, 0) };
            box.Children.Add(logo ?? new TextBlock { Text = name, FontSize = 18, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
            box.Children.Add(new TextBlock { Text = provides, FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
            if (notice is not null) box.Children.Add(new TextBlock { Text = notice, FontSize = 14, Foreground = HubAmber, TextWrapping = TextWrapping.Wrap });
            box.Children.Add(new TextBlock { Text = site, FontSize = 12, Foreground = HubDim });
            body.Children.Add(box);
        }

        Section("TMDB", Logo("tmdb-long.png", 16),
            "Ratings, titles, pictures, genres, cast, episode lists and air dates. They power the ratings on every card, Search everywhere, Browse, The Binge, and the New episodes and New movies rows. Prism reads them on this device using your own TMDB key.",
            "This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.",
            "themoviedb.org");
        Section("JustWatch", Logo("justwatch.png", 24),
            "Which of your services carry each title, and whether it's included, with ads, or to rent or buy. JustWatch provides this through TMDB.",
            "Streaming availability data provided by JustWatch.",
            "justwatch.com");
        Section("Wikipedia", null,
            "The Most read about this week row counts how often each title's Wikipedia article is read each day. Wikidata helps match each article to the right title.",
            null,
            "wikipedia.org  \u00B7  wikidata.org");
        Section("Your services", null,
            "Continue watching, My list and your library, with their pictures and badges, come from your own services, signed in on this device.",
            null,
            "Prism doesn't send any of this anywhere. Each source is contacted directly from this device.");

        // the company, in full (2026-09-25, "The new company name, in full, is Entangled Labs LLC. No additional DBA. Should probably update credits")
        // the mark (2026-09-25, "Prism by Entangled will be the registered trademark though"): TM until it is registered, then (R)
        body.Children.Add(new TextBlock { Text = "\u00A9 2026 Entangled Labs LLC. Licensed under the GNU GPL v3 or later. Prism comes with absolutely no warranty. See the GNU GPL for details. Prism by Entangled is a trademark of Entangled Labs LLC. Netflix, Hulu, Disney+ and the other service names and logos shown in Prism belong to their owners. Prism isn't affiliated with or endorsed by them.", FontSize = 12, Foreground = HubDim, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) });

        RootGrid.Children.Add(scrim);
        _creditsWin = scrim;
        scrim.Loaded += (_, __) => scrim.Focus(FocusState.Programmatic);
    }
}
