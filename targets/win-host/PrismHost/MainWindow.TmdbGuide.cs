using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// The TMDB guide (2026-10-10, "Are we helping them get to the sign up page using their phone and a QR code to take them there? And login
/// page, and approval page, and api page ... A nice fluid helpful guide"): from no account to a working key without typing a long key
/// with a remote. Each step is a code for the phone - TMDB's sign-up page, its API page, then Prism's own page on the phone, where the
/// key copied a moment ago is pasted and sent (core POST /tmdb/key). The key is tried against TMDB before the guide says it works, and
/// the account's approval (MainWindow.TmdbAccount.cs) follows for whoever wants ratings and playlists. Prism never signs anyone up:
/// the sign-up page opens on the person's own phone (docs/third-party-services-policy.md). Prism works in full without a key; the
/// guide says so first.
/// </summary>
public sealed partial class MainWindow
{
    private const string TmdbSignUpUrl = "https://www.themoviedb.org/signup";
    private const string TmdbApiPageUrl = "https://www.themoviedb.org/settings/api";
    private Grid? _tmdbGuide;
    private TaskCompletionSource<string>? _guidePairing;
    private int _guideRun, _guideShown;   // which opening of the guide, and which of its screens, a waiting timer belongs to

    /// <summary>A pairing address for the guide's last code (the phone's page, opened on its key sheet), or "" when there is no phone remote.</summary>
    private async Task<string> GuidePhoneUrlAsync()
    {
        if (_remote is null) return "";
        var tcs = new TaskCompletionSource<string>();
        _guidePairing = tcs;
        _brain.Call(HostCalls.MintPairing, _remote.BaseUrl(), false);
        var done = await Task.WhenAny(tcs.Task, Task.Delay(4000));
        _guidePairing = null;
        var url = done == tcs.Task ? tcs.Task.Result : "";
        return url.Length == 0 ? "" : url + "#tmdb";
    }

    /// <summary>Whether a key is set, and how many times one was set since the start: a new count is a new key (the phone's arrives through the remote).</summary>
    private async Task<(bool hasKey, int sets)> GuideKeyStateAsync()
    {
        try
        {
            var o = JsonNode.Parse(await ModelCallAsync("tmdbKeyState") ?? "null") as JsonObject;
            return (o?["hasKey"]?.GetValue<bool>() == true, o?["sets"]?.GetValue<int>() ?? 0);
        }
        catch { return (false, 0); }
    }

    /// <summary>The pages under the guide drawn again with the key's new state: Watch settings, the services page, the Watch page.</summary>
    private void GuideRedrawPages()
    {
        if (_settingsWin is not null) _ = ShowWatchSettingsAsync();
        if (_welcome is not null) _ = ShowWelcomeAsync();
        if (VideoHubOpen) _ = ShowVideoHubAsync();
    }

    private void CloseTmdbGuide() { _guideRun++; if (_tmdbGuide is { } g) { RootGrid.Children.Remove(g); _tmdbGuide = null; } }

    private async Task ShowTmdbGuideAsync(int startAt = 0)
    {
        CloseTmdbGuide();
        var run = _guideRun;
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE0, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 986);
        var card = new StackPanel { Spacing = 14, Padding = new Thickness(28), Background = HubCard, CornerRadius = new CornerRadius(12), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Width = 600 };
        scrim.PointerPressed += (_, e) => e.Handled = true;   // a press beside the card does not throw the steps away; Not now and Esc close it
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; CloseTmdbGuide(); };
        scrim.KeyboardAccelerators.Add(esc);
        scrim.Children.Add(card);
        RootGrid.Children.Add(scrim);
        _tmdbGuide = scrim;
        LogLine("tmdb guide: opened");

        TextBlock Title(string t) => new() { Text = t, FontSize = 20, Foreground = HubInk, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap };
        TextBlock Body(string t) => new() { Text = t, FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        TextBlock Step(string t) => new() { Text = t, FontSize = 13, Foreground = HubAmber };
        StackPanel Points(params string[] lines)
        {
            var p = new StackPanel { Spacing = 4, Margin = new Thickness(4, 0, 0, 0) };
            foreach (var l in lines) p.Children.Add(new TextBlock { Text = (char)0x2022 + "  " + l, FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
            return p;
        }
        StackPanel Row(params Button[] buttons)
        {
            var r = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 4, 0, 0) };
            foreach (var b in buttons) r.Children.Add(b);
            return r;
        }
        Button Verb(string text, bool main, Action press)
        {
            var b = Chip(new TextBlock { Text = text, FontSize = 14, Foreground = HubInk }, main);
            b.Click += (_, __) => press();
            return b;
        }
        async Task CodeAsync(string url, string under)
        {
            try { var qr = await QrWithMarkAsync(url, 230); qr.HorizontalAlignment = HorizontalAlignment.Center; card.Children.Add(qr); }
            catch (Exception ex) { LogLine("tmdb guide: qr " + ex.Message); }
            card.Children.Add(new TextBlock { Text = under, FontSize = 12, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center });
        }

        async Task ShowAsync(int step)
        {
            if (run != _guideRun) return;
            var shown = ++_guideShown;
            card.Children.Clear();
            LogLine("tmdb guide: step " + step);
            if (step == 0)
            {
                card.Children.Add(Title("Get a free TMDB key"));
                card.Children.Add(Body("TMDB is the free film and TV database behind Prism's extras. Prism works without it. With your own free key you also get:"));
                card.Children.Add(Points(
                    "Details pages with the cast, and where each title can be watched",
                    "Every cast member's other films and shows, one press away",
                    "One search across all your services",
                    "Your own ratings and playlists, once you link your account"));
                card.Children.Add(Body("It takes about three minutes, and you'll use your phone."));
                card.Children.Add(Row(Verb("Start", true, () => _ = ShowAsync(1)), Verb("I already have a key", false, () => _ = ShowAsync(3)), Verb("Not now", false, CloseTmdbGuide)));
            }
            else if (step == 1)
            {
                card.Children.Add(Step("Step 1 of 3"));
                card.Children.Add(Title("Create your TMDB account"));
                card.Children.Add(Body("Scan this with your phone's camera. It opens TMDB's sign-up page. The account is free. TMDB emails you a link to confirm it, so open that email before the next step."));
                await CodeAsync(TmdbSignUpUrl, "themoviedb.org/signup");
                card.Children.Add(Body("Already have an account? Press Next."));
                card.Children.Add(Row(Verb("Back", false, () => _ = ShowAsync(0)), Verb("Next", true, () => _ = ShowAsync(2)), Verb("Not now", false, CloseTmdbGuide)));
            }
            else if (step == 2)
            {
                card.Children.Add(Step("Step 2 of 3"));
                card.Children.Add(Title("Get your key"));
                card.Children.Add(Body("Scan this to open TMDB's API page, and sign in if it asks. The first time, TMDB has you request a key: choose Developer, accept the terms and fill in the short form. Personal use is fine. Then copy the long value called API Read Access Token."));
                await CodeAsync(TmdbApiPageUrl, "themoviedb.org/settings/api");
                card.Children.Add(Row(Verb("Back", false, () => _ = ShowAsync(1)), Verb("I've copied it", true, () => _ = ShowAsync(3)), Verb("Not now", false, CloseTmdbGuide)));
            }
            else if (step == 3)
            {
                card.Children.Add(Step("Step 3 of 3"));
                card.Children.Add(Title("Send the key to Prism"));
                var phone = await GuidePhoneUrlAsync();
                if (run != _guideRun) return;
                if (phone.Length > 0)
                {
                    card.Children.Add(Body("Scan this code. On the page that opens, paste the key and press Send to Prism. Your phone has to be on the same network as this PC."));
                    await CodeAsync(phone, "Prism on your phone");
                }
                var typed = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
                typed.Children.Add(new TextBlock { Text = phone.Length > 0 ? "Or type it here:" : "Type or paste the key here:", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
                var box = new PasswordBox { PlaceholderText = "API Read Access Token or API Key", Width = 300, FontSize = 13 };
                typed.Children.Add(box);
                var said = new TextBlock { Text = "Waiting for the key" + (char)0x2026, FontSize = 13, Foreground = HubAmber, HorizontalAlignment = HorizontalAlignment.Center, TextWrapping = TextWrapping.Wrap };
                var trying = false;
                // a key that was here before this step is never the guide's to clear, and only a key set after it counts as the one sent
                var before = await GuideKeyStateAsync();
                var hadKey = before.hasKey;
                var seenSets = before.sets;
                var retryAt = 0L;
                // the key, however it came, is checked with TMDB before the guide says it works (core keyCheck). Only TMDB's own no counts as
                // a bad key: a network that is down keeps the key and tries again. A refused key the guide itself took in is cleared, so
                // Watch settings does not show a key that does nothing.
                async Task TryKeyAsync()
                {
                    if (trying) return;
                    trying = true;
                    try
                    {
                        seenSets = (await GuideKeyStateAsync()).sets;
                        said.Text = "Checking the key with TMDB" + (char)0x2026;
                        var answer = "unreachable";
                        try { answer = (JsonNode.Parse(await ModelCallAwaitAsync("tmdbKeyCheck", 20000) ?? "null") as JsonObject)?["result"]?.GetValue<string>() ?? "unreachable"; } catch { }
                        if (run != _guideRun || shown != _guideShown) return;
                        LogLine("tmdb guide: key check " + answer);
                        if (answer == "ok") { await ShowAsync(4); return; }
                        if (answer == "refused")
                        {
                            if (!hadKey) { await ModelCallAsync("lensSetTmdbKey", (string?)null); seenSets = (await GuideKeyStateAsync()).sets; }
                            said.Text = "TMDB didn't accept that key. Copy the whole API Read Access Token again and send it once more.";
                        }
                        else if (answer == "none") said.Text = "Waiting for the key" + (char)0x2026;
                        else { retryAt = Environment.TickCount64 + 10000; said.Text = "Prism has the key but couldn't reach TMDB to check it. It will try again in a moment."; }
                    }
                    finally { trying = false; }
                }
                var save = Verb("Save", true, async () =>
                {
                    var key = box.Password?.Trim() ?? "";
                    if (key.Length == 0) return;
                    box.Password = "";
                    await ModelCallAsync("lensSetTmdbKey", key);
                    await TryKeyAsync();
                });
                typed.Children.Add(save);
                card.Children.Add(typed);
                card.Children.Add(said);
                card.Children.Add(Row(Verb("Back", false, () => _ = ShowAsync(2)), Verb("Not now", false, CloseTmdbGuide)));
                // the phone's Send lands in core; the guide sees a key appear and tries it (a look every second and a half while this step is up)
                var poll = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1.5) };
                poll.Tick += async (sender, args) =>
                {
                    if (run != _guideRun || shown != _guideShown) { poll.Stop(); return; }
                    if (trying) return;
                    var ks = await GuideKeyStateAsync();
                    if (run != _guideRun || shown != _guideShown || trying || !ks.hasKey) return;
                    if (ks.sets != seenSets || (retryAt != 0 && Environment.TickCount64 >= retryAt)) { retryAt = 0; await TryKeyAsync(); }
                };
                poll.Start();
            }
            else
            {
                card.Children.Add(Title("Your key works"));
                card.Children.Add(Body("These are on now:"));
                card.Children.Add(Points(
                    "Details pages with the cast and where to watch. Press any title",
                    "Cast members' other titles. Press a name on a Details page",
                    "Search across all your services, from the Watch page"));
                card.Children.Add(Body("One more step turns on your own ratings and playlists: approving Prism on your TMDB account. It's another code to scan."));
                card.Children.Add(Row(
                    Verb("Link my account", true, async () => { CloseTmdbGuide(); GuideRedrawPages(); await ModelCallAsync("tmdbLinkStart"); await ShowTmdbApprovalAsync(); }),
                    Verb("Finish", false, () => { CloseTmdbGuide(); SetPill("Prism" + Dot + "your TMDB key is in"); GuideRedrawPages(); })));
            }
        }
        await ShowAsync(startAt);
        scrim.Focus(FocusState.Programmatic);
    }
}
