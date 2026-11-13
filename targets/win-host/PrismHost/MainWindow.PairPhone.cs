using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using PrismHost.Channel;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// Pair a phone (2026-10-03): the PRISM menu's item mints a
/// pairing address (core, section 6) and shows it as a QR over the wall; the phone opens the page the host serves (Services/RemotePage.cs) -
/// a keyboard for the wall and private listening. The card closes itself when the phone connects. The token is in the QR alone: never
/// on the status line, never in the log.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _pairCard;
    private bool _pairCardWanted;

    private void PairPhone()
    {
        if (_remote is null) { SetPill("PRISM" + Dot + "the phone remote is not running on this device"); return; }
        _pairCardWanted = true;
        _brain.Call(HostCalls.MintPairing, _remote.BaseUrl(), false);   // a fresh code each time the menu asks
    }

    /// <summary>core's remote.pairing: the address the QR encodes (the menu asked for it), or the boot's quiet mint (nothing shown).</summary>
    private async void OnPairingMinted(string url)
    {
        if (_guidePairing is { } guide) { guide.TrySetResult(url); return; }   // the TMDB guide asked: its last code opens the phone's page on the key sheet
        if (_welcomePairing is { } welcome) { welcome.TrySetResult(url); return; }   // the Nothing is set up yet screen asked (2026-10-11)
        if (!_pairCardWanted || url.Length == 0) return;
        _pairCardWanted = false;
        ClosePairCard();
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE0, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 985);
        var card = new StackPanel { Spacing = 14, Padding = new Thickness(28), Background = HubCard, CornerRadius = new CornerRadius(12), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, MaxWidth = 660 };
        // read from the sofa, phone in hand (2026-10-10)
        card.Children.Add(new TextBlock { Text = "Pair your phone", FontSize = 28, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        card.Children.Add(new TextBlock { Text = "Scan this with the phone's camera. The page that opens types into whatever is focused in PRISM, and plays PRISM's sound on the phone while the PC stays quiet. The phone must be on the same network as this PC.", FontSize = 20, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        try
        {
            card.Children.Add(await QrWithMarkAsync(url, 300));   // the code with the PRISM mark in its middle (MainWindow.Qr.cs)
        }
        catch (Exception ex) { LogLine("pair phone: qr " + ex.Message); }
        card.Children.Add(new TextBlock { Text = "Waiting for the phone" + (char)0x2026, FontSize = 18, Foreground = HubAmber, HorizontalAlignment = HorizontalAlignment.Center });
        // the phones paired now, each with Forget (2026-10-14): a forgotten phone's next request is refused, and it scans a new code to come back; a second press makes sure
        var paired = new StackPanel { Spacing = 6 };
        card.Children.Add(paired);
        async Task DrawPairedAsync()
        {
            paired.Children.Clear();
            JsonObject? pv = null;
            try { pv = JsonNode.Parse(await ModelCallAsync("remoteDevices") ?? "null") as JsonObject; } catch { }
            var devices = (pv?["devices"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
            if (devices.Count == 0) return;
            paired.Children.Add(new TextBlock { Text = "Paired now", FontSize = 16, Foreground = HubInk, Margin = new Thickness(0, 6, 0, 0) });
            foreach (var d in devices)
            {
                var name = d["name"]?.GetValue<string>() ?? "Phone"; var created = d["created"]?.GetValue<string>() ?? ""; var seen = d["lastSeen"]?.GetValue<string>() ?? "";
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
                row.Children.Add(new TextBlock { Text = name + "  \u00B7  paired " + created + (seen.Length > 0 ? ", last seen " + seen : ""), FontSize = 15, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
                var forget = Chip(new TextBlock { Text = "Forget", FontSize = 14, Foreground = HubInk }, false);
                ToolTipService.SetToolTip(forget, name + " can no longer type, listen or browse here until it scans a new code.");
                var sure = false;
                forget.Click += async (_, __) =>
                {
                    if (!sure) { sure = true; ((TextBlock)forget.Content).Text = "Forget " + name + " for sure?"; ((TextBlock)forget.Content).Foreground = HubAmber; return; }
                    try { await ModelCallAsync("remoteForget", name, created, seen.Length > 0 ? seen : null); } catch { }
                    LogLine("pair phone: forgot " + name + " (" + created + ")");
                    SetPill("PRISM" + Dot + name + " forgotten");
                    await DrawPairedAsync();
                };
                row.Children.Add(forget);
                paired.Children.Add(row);
            }
        }
        _ = DrawPairedAsync();
        var close = Chip(new TextBlock { Text = "Close", FontSize = 18, Foreground = HubInk }, false);
        close.Click += (_, __) => ClosePairCard();
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center };
        // opened from How PRISM works: the card says the way back itself (2026-10-10)
        if (TourOwed) { var back = Chip(new TextBlock { Text = "Back to How PRISM works", FontSize = 18, Foreground = HubInk }, true); back.Click += (_, __) => TourReturn(); buttons.Children.Add(back); }
        buttons.Children.Add(close);
        card.Children.Add(buttons);
        scrim.PointerPressed += (_, __) => ClosePairCard();
        card.PointerPressed += (_, e) => e.Handled = true;
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; ClosePairCard(); };
        scrim.KeyboardAccelerators.Add(esc);
        scrim.Children.Add(card);
        RootGrid.Children.Add(scrim);
        _pairCard = scrim;
    }
    private void ClosePairCard() { if (_pairCard is { } c) { RootGrid.Children.Remove(c); _pairCard = null; if (TourOwed) TourReturn(); } }   // closed after the tour opened it: back to the tour

    // ---- private listening: the wall quiet while a phone listens, its volume back when the last one leaves
    private double? _listenSavedVolume;
    private bool? _endpointWasMuted;
    /// <summary>The default playback device's master mute (the TV, the soundbar): on while a phone listens, back to what it was after.</summary>
    private void EndpointMute(bool on)
    {
        try
        {
            using var en = new NAudio.CoreAudioApi.MMDeviceEnumerator();
            using var dev = en.GetDefaultAudioEndpoint(NAudio.CoreAudioApi.DataFlow.Render, NAudio.CoreAudioApi.Role.Multimedia);
            if (on) { _endpointWasMuted ??= dev.AudioEndpointVolume.Mute; dev.AudioEndpointVolume.Mute = true; }
            else { dev.AudioEndpointVolume.Mute = _endpointWasMuted ?? false; _endpointWasMuted = null; }
            LogLine("listen: device mute " + (on ? "on" : "off"));
        }
        catch (Exception ex) { LogLine("listen: device mute failed: " + ex.Message); }
    }
    /// <summary>What the room hears of the room-in-step playback (B-472 review): nothing under the person's mute, else the wall's volume - the
    /// delayed capture is at full scale, so without this the room would sound past the mute while a listener had it in step.</summary>
    private void PushRoomLevel() => _remote?.Listen?.SetRoomLevel(_surfaces.SessionMute.RoomMuted ? 0f : (float)_surfaces.WallVolume);
    private void OnListeners(int n)
    {
        RootGrid.DispatcherQueue.TryEnqueue(() =>
        {
            // volume separation (2026-10-04; B-472, 2026-11-01): the wall keeps playing for the room at PRISM's own mute and volume, which the
            // phone's stream undoes - the phone hears PRISM at full and has its own volume; the playback device is never touched
            if (n > 0 && _listenSavedVolume is null) { _listenSavedVolume = 1; _surfaces.PrivateListening = true; SetPill("PRISM" + Dot + "a phone is listening. Mute PRISM here and the phone still hears it"); }
            else if (n == 0 && _listenSavedVolume is not null)
            {
                _surfaces.PrivateListening = false; _listenSavedVolume = null; SetPill("PRISM" + Dot + "no phone is listening now");
                _ = ModelCallAwaitAsync("listenWindow", 5000, (string?)null);   // the window a phone chose to hear (2026-10-05) gives the sound back to the big one
            }
        });
    }
}
