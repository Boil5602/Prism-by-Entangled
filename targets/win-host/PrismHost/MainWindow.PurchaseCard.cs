using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Renting and buying, by the phone (2026-10-11, "Maybe we should show a buy option but give them a QR code to perform the transaction
/// on their phones"): a Rent or Buy logo under a title's Where to watch opens this card. Its code is the service's own page for the
/// title (core purchase.ts: the service's search address, never a third party's link), where the price is shown and the purchase is
/// the person's to make, with the account and the payment they already use there. Prism takes no part: it never handles payment, takes
/// no cut and adds no referral code, as it never signs anyone up (docs/third-party-services-policy.md).
///
/// Where a service sells is that service's own fact ("Some are fine to point to their native apps ... some only allow purchasing through
/// a browser"): the card says it only when the service's adapter records it, with its source. Otherwise it says in general words what
/// to do when the phone's app shows no way to buy. For one of the household's own services the card also offers Open here instead
/// (the service's page in the big window, as a press did before) and I've bought it (the service's lists read again).
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _purchaseCard;

    private void ClosePurchaseCard() { if (_purchaseCard is { } c) { RootGrid.Children.Remove(c); _purchaseCard = null; } }

    /// <param name="app">The household's service this is (null: a service the household has not set up).</param>
    /// <param name="openHere">What a press did before the card: the title on the service's page in the big window.</param>
    private async void ShowPurchaseCard(string title, string service, JsonObject offer, string? app, Action? openHere)
    {
        var url = offer["url"]?.GetValue<string>() ?? "";
        if (!url.StartsWith("https://", StringComparison.Ordinal)) { openHere?.Invoke(); return; }
        ClosePurchaseCard();
        var where = offer["where"]?.GetValue<string>() ?? "";
        var note = offer["note"]?.GetValue<string>() ?? "";
        LogLine("purchase card: " + service + (app is null ? " (not one of the household's services)" : ""));
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE0, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 987);
        var card = new StackPanel { Spacing = 14, Padding = new Thickness(28), Background = HubCard, CornerRadius = new CornerRadius(12), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, MaxWidth = 700 };
        TextBlock Words(string t, double size, Brush ink) => new() { Text = t, FontSize = size, Foreground = ink, TextWrapping = TextWrapping.Wrap };
        var head = Words("Rent or buy on " + service, 28, HubInk);
        head.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        card.Children.Add(head);
        card.Children.Add(Words(title, 20, HubAmber));
        card.Children.Add(Words("Scan this with your phone's camera. It opens " + service + "'s own page for this title, where you'll see the price and can pay with the account you already use there.", 19, HubInk));
        try
        {
            var qr = await QrWithMarkAsync(url, 280);
            qr.HorizontalAlignment = HorizontalAlignment.Center;
            card.Children.Add(qr);
        }
        catch (Exception ex) { LogLine("purchase card: qr " + ex.Message); }
        try { card.Children.Add(new TextBlock { Text = new Uri(url).Host, FontSize = 15, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center }); } catch { }
        // where the service sells: its own recorded fact, or the general case in plain words
        card.Children.Add(Words(
            note.Length > 0 ? note
            : where == "browser" ? service + " sells in a browser, not in its app. If the code opens the app, open the same address in your phone's browser."
            : where == "app" ? "The " + service + " app on your phone can make the purchase itself."
            : "If your phone opens " + service + "'s app and it shows no way to rent or buy, open the same address in your phone's browser.", 16, HubInk));
        card.Children.Add(Words("Prism takes no part in the purchase. It adds no referral code, takes no cut and never sees your payment.", 16, HubInk));
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 4, 0, 0) };
        Button Verb(string text, bool main, Action press)
        {
            var b = Chip(new TextBlock { Text = text, FontSize = 18, Foreground = HubInk }, main);
            b.Click += (_, __) => press();
            return b;
        }
        if (app is not null)
        {
            // the quickest way to the title once bought: the service's own page knows at once and plays it (2026-10-11, "How do we quickly
            // surface that item to the user?"); the lists are read again behind it, so Watch's New in your library catches up
            var bought = Verb(openHere is not null ? "I've bought it, play it" : "I've bought it", true, () =>
            {
                ClosePurchaseCard();
                _ = ModelCallAsync("videoRefreshApp", app, true);   // its owned pages too: a bought title never started is on no Continue row
                if (openHere is not null) openHere();
                else SetPill("Prism" + Dot + "reading " + service + "'s lists again. It shows under New in your library on Watch within a few minutes");
            });
            ToolTipService.SetToolTip(bought, (openHere is not null ? "Plays the title on " + service + " in the big window, and reads " : "Reads ") + service + "'s lists again, so it shows under New in your library on Watch.");
            row.Children.Add(bought);
        }
        if (openHere is not null)
        {
            var here = Verb("Open here instead", false, () => { ClosePurchaseCard(); openHere(); });
            ToolTipService.SetToolTip(here, "Opens the title on " + service + "'s own page in the big window, to rent or buy it there with a remote or a keyboard.");
            row.Children.Add(here);
        }
        row.Children.Add(Verb("Close", false, ClosePurchaseCard));
        card.Children.Add(row);
        scrim.PointerPressed += (_, __) => ClosePurchaseCard();
        card.PointerPressed += (_, e) => e.Handled = true;
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; ClosePurchaseCard(); };
        scrim.KeyboardAccelerators.Add(esc);
        scrim.Children.Add(card);
        RootGrid.Children.Add(scrim);
        _purchaseCard = scrim;
        scrim.Focus(FocusState.Programmatic);
    }
}
