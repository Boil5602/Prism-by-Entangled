using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The listen page's switch (2026-10-31): a card from the
/// PRISM menu with the switch, and while it is on, the address and a QR for it. Core holds the switch and mints the household key once
/// (remote.ts houseListen); the host serves the page at /listen?key= (Services/ListenPage.cs). Off, the address answers a page that says so.
/// </summary>
public sealed partial class MainWindow
{
    private bool _roomStepOn; private double _roomStepMs;   // the room step as last sent (ui.roomStep): the room is moved on a change of figure, the log hears every word

    private Grid? _listenCard;

    private async void ListenPageCard()
    {
        if (_remote is null) { SetPill("PRISM" + Dot + "the phone remote is not running on this device"); return; }
        CloseListenCard();
        JsonObject? st = null;
        try { st = JsonNode.Parse(await ModelCallAwaitAsync("houseListen", 10_000, (object?)null) ?? "null") as JsonObject; } catch { }
        var on = st?["on"]?.GetValue<bool>() == true;
        var key = st?["key"]?.GetValue<string>() ?? "";

        var scrim = new Grid { Background = Tokens.Scrim };
        Canvas.SetZIndex(scrim, 985);
        var card = new StackPanel { Spacing = 14, Padding = new Thickness(28), Background = HubCard, CornerRadius = new CornerRadius(12), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, MaxWidth = 620 };
        card.Children.Add(new TextBlock { Text = "Listen page", FontSize = 28, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        card.Children.Add(new TextBlock { Text = "A page for the house: what plays on this PC, its lounge scene and its sound, in any browser on your network, with nothing to press. Open it on a kitchen tablet or an Echo Show's browser. Anyone with the address can listen, so it stays off until you turn it on.", FontSize = 16, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        var sw = new ToggleSwitch { Header = "Listen page", OnContent = "On", OffContent = "Off", IsOn = on, FontSize = 15 };
        card.Children.Add(sw);
        // the room in step with a listener (2026-10-31): the switch, the same one the phone's Private Listening tab has
        JsonObject? rs = null; try { rs = JsonNode.Parse(await ModelCallAwaitAsync("roomStep", 5000, (object?)null) ?? "null") as JsonObject; } catch { }
        var step = new ToggleSwitch { Header = "Keep the room in step with a listener", OnContent = "On", OffContent = "Off", IsOn = rs?["on"]?.GetValue<bool>() != false, FontSize = 15 };
        card.Children.Add(step);
        card.Children.Add(new TextBlock { Text = "While a phone or this page listens to music, the PC plays the room a few seconds behind, in time with them. Video is left as it is.", FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        step.Toggled += async (_, __) => { try { rs = JsonNode.Parse(await ModelCallAwaitAsync("roomStep", 5000, step.IsOn) ?? "null") as JsonObject; } catch { rs = null; } var now = rs?["on"]?.GetValue<bool>() != false; if (step.IsOn != now) step.IsOn = now; LogLine("room step switch: " + (now ? "on" : "off")); };
        var addr = new StackPanel { Spacing = 10 };
        card.Children.Add(addr);
        async Task DrawAddressAsync()
        {
            addr.Children.Clear();
            if (!on || key.Length == 0) { addr.Children.Add(new TextBlock { Text = "Turn it on for the address.", FontSize = 15, Foreground = HubInk }); return; }
            var url = _remote.BaseUrl() + "/listen?key=" + key;
            var shortAddr = _remote.BaseUrl().Replace("http://", "") + "/listen";
            addr.Children.Add(new TextBlock { Text = "In the browser, open", FontSize = 15, Foreground = HubInk });
            addr.Children.Add(new TextBlock { Text = shortAddr, FontSize = 24, Foreground = HubAmber, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true });
            addr.Children.Add(new TextBlock { Text = "and type the house code", FontSize = 15, Foreground = HubInk });
            addr.Children.Add(new TextBlock { Text = key.Length == 8 ? key[..4] + "-" + key[4..] : key, FontSize = 34, Foreground = HubAmber, FontFamily = new FontFamily("Consolas"), CharacterSpacing = 150, IsTextSelectionEnabled = true });
            addr.Children.Add(new TextBlock { Text = "Or scan this with a phone: the code is in the address.", FontSize = 15, Foreground = HubInk });
            try { var qr = await QrWithMarkAsync(url, 240); qr.HorizontalAlignment = HorizontalAlignment.Center; addr.Children.Add(qr); }
            catch (Exception ex) { LogLine("listen page: qr " + ex.Message); }
            addr.Children.Add(new TextBlock { Text = "The sound runs a few seconds behind this PC, so it suits another room. The page starts its sound again by itself if it drops.", FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
            // a new address (2026-10-31 review): the old one opens nothing from then on, and whatever is listening on it stops
            var renew = Chip(new TextBlock { Text = "New address", FontSize = 15, Foreground = HubInk }, false);
            ToolTipService.SetToolTip(renew, "Replaces the address. Anything open on the old one stops, and the house opens the new one.");
            var sure = false;
            renew.Click += async (_, __) =>
            {
                if (!sure) { sure = true; ((TextBlock)renew.Content).Text = "Replace the address for sure?"; ((TextBlock)renew.Content).Foreground = HubAmber; return; }
                var before = key;
                try { st = JsonNode.Parse(await ModelCallAwaitAsync("houseListen", 10_000, "new") ?? "null") as JsonObject; } catch { st = null; }
                on = st?["on"]?.GetValue<bool>() == true; key = st?["key"]?.GetValue<string>() ?? "";
                _remote.Listen?.Drop("house");
                // only core's own word counts (2026-10-31 review): no answer, an error, or the same key is a failure said as one
                if (st is null || st["error"] is not null || key.Length == 0 || key == before)
                {
                    try { st = JsonNode.Parse(await ModelCallAwaitAsync("houseListen", 10_000, (object?)null) ?? "null") as JsonObject; } catch { st = null; }
                    on = st?["on"]?.GetValue<bool>() == true; key = st?["key"]?.GetValue<string>() ?? "";
                    LogLine("listen page: new address failed"); SetPill("PRISM" + Dot + "could not replace the listen page's address. It is as it was.");
                    sw.IsOn = on; await DrawAddressAsync(); return;
                }
                LogLine("listen page: new address");
                SetPill("PRISM" + Dot + "the listen page has a new address. The old one opens nothing now.");
                await DrawAddressAsync();
            };
            addr.Children.Add(renew);
        }
        await DrawAddressAsync();
        sw.Toggled += async (_, __) =>
        {
            var wanted = sw.IsOn;
            try { st = JsonNode.Parse(await ModelCallAwaitAsync("houseListen", 10_000, wanted) ?? "null") as JsonObject; } catch { st = null; }
            var failed = st is null || st["error"] is not null || st["on"] is null;
            if (failed) { try { st = JsonNode.Parse(await ModelCallAwaitAsync("houseListen", 10_000, (object?)null) ?? "null") as JsonObject; } catch { st = null; } }   // the state as it stands, not the wish
            on = st?["on"]?.GetValue<bool>() == true; key = st?["key"]?.GetValue<string>() ?? "";
            if (sw.IsOn != on) sw.IsOn = on;   // core's word
            if (!on) _remote.Listen?.Drop("house");   // off cuts the house's streams at once; the rest end at their next check
            if (failed || on != wanted) { LogLine("listen page: switch failed (wanted " + (wanted ? "on" : "off") + ")"); SetPill("PRISM" + Dot + "could not change the listen page. It is " + (on ? "on" : "off") + "."); await DrawAddressAsync(); return; }
            LogLine("listen page: " + (on ? "on" : "off"));
            SetPill("PRISM" + Dot + (on ? "the listen page is on. Anyone on your network with its address can listen." : "the listen page is off. Its address answers nothing now."));
            await DrawAddressAsync();
        };
        var close = Chip(new TextBlock { Text = "Close", FontSize = 18, Foreground = HubInk }, false);
        close.Click += (_, __) => CloseListenCard();
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center };
        buttons.Children.Add(close);
        card.Children.Add(buttons);
        scrim.PointerPressed += (_, __) => CloseListenCard();
        card.PointerPressed += (_, e) => e.Handled = true;
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; CloseListenCard(); };
        scrim.KeyboardAccelerators.Add(esc);
        scrim.Children.Add(card);
        RootGrid.Children.Add(scrim);
        _listenCard = scrim;
    }
    private void CloseListenCard() { if (_listenCard is { } c) { RootGrid.Children.Remove(c); _listenCard = null; } }
}
