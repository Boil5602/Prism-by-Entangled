using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// App setup mode (docs/scene-model-spec.md §2): the App full-screen in a
/// normal browsing view under its own profile (§10 session, never wiped) -
/// sign in and configure exactly as in a browser; no region, no zoom, no
/// shapes. A status card shows the App, its setup status (signed-in / needs
/// attention / unknown) and when it was last verified; the status is
/// verified passively (the login-redirect heuristic, core's) and saved with
/// modelSaveApp. "Done" returns to the scene. Sign-in popups open in the §30
/// sheet as everywhere; the surface is an ordinary tile so the §26/§27/§30
/// engine is active (win-host-spec §5). Entry point: OpenAppSetup(appId).
/// </summary>
public sealed partial class MainWindow
{
    private bool _asSession;
    private ModelApp? _asApp;
    private string? _asTile;
    private Grid? _asFloat;
    private TextBlock? _asStatusLine, _asUrlLine, _asHint;
    private Border? _asStatusPill;
    private string _asObserved = "unknown";   // what the passive check has seen this session (needs-attention | signed-in | unknown)
    private bool _asNoAccount;                // §31 account:"none" - a first-party page: set up on arrival, never "needs attention"
    private bool _asSignIn;                   // the sign-in wizard (?signin=1): straight to the sign-in page, the session probe decides, no Done
    private int _asProbeRun;                  // serial: a newer navigation or a close cancels an older probe loop
    private Button? _asMark;                  // "I'm signed in - mark it": shown only when the probe saw nothing either way
    private Button? _asDone;                  // Done - hidden in sign-in mode until the page turns out to be signed in already (B-130)
    private bool _asSawSignedOut;             // B-130: the sign-in mode closes itself only for a session it WATCHED begin (signed out, then in)

    /// <summary>Open App setup for an App: its surface popped out, page face, a status card, Done / Cancel. Esc closes (EscapePressed chain).</summary>
    public void OpenAppSetup(string appId) => OpenAppSetup(appId, null);

    /// <summary>B-56 (SM-3 integration): setup mode AT a page - the §6a sheet's "Open full page (setup mode)" and the news picker's rationale links pass the page as prism://app/:id/setup?url=.</summary>
    public async void OpenAppSetup(string appId, string? url, bool signIn = false)
    {
        CloseVideoHub();   // the Watch page (z 930) would stand over the setup page and its sign-in ("the login screen isnt coming up, is it behind the watch menu", 2026-09-20)
        CloseAppSetup();
        CloseFacetEditor();
        if (_viewfinder is not null) CancelViewfinder();
        var app = await FindAppAsync(appId);
        if (app is null) { SetPill("Prism · App \"" + appId + "\" isn't saved yet. Add it under Apps first"); EditorClosed("app-setup", appId, saved: false); return; }
        // the sign-in window opens AT the sign-in page (2026-09-29: opened at the service's home and sent to the sign-in page a moment later, the
        // two loads crossed and the home page won - Tubi's Sign in "did nothing")
        var adapter = AdapterNameFor(app);
        var signInPage = signIn && !AppNeedsNoAccount(app) ? await SignInPageAsync(adapter) : null;
        var tile = await EnsureAppSurfaceAsync(app, url ?? signInPage);
        if (tile is null) { SetPill("Prism · " + app.Name + " has no live surface yet. Try again once it's up"); EditorClosed("app-setup", appId, saved: false); return; }
        if (url is not null && IsHttpUrl(url) && _surfaces.SourceOf(tile) != url) _surfaces.Navigate(tile, url);   // the reference page, in the App's profile (not persisted as the App's home)
        if (_viewfinder is not null) CancelViewfinder();
        // The rail is a FULL-SCREEN 96%-opaque overlay at z 900 on RootGrid, above the
        // tile canvas (z 0) that carries this page. Left open, it covers the surface and
        // eats every click: the page is faintly visible through it and completely dead.
        // Setup takes the wall, so the rail lets go of it.
        CloseRail();
        StepWizardAside(true);   // the wizard's overlay is the same trap one layer up (found live 2026-09-05)
        _asApp = app; _asTile = tile; _asSession = true; _asObserved = "unknown";
        SyncEmptyStage();   // the empty stage stands above the canvas: down while a sign-in is up
        SyncEmptyWallNote();
        _asSignIn = signIn; _asProbeRun++; _asSawSignedOut = false;
        _vfMode = "app"; _vfTile = tile; _vfZoom = 1; _vfPicking = false; _vfPlaced = false;

        // B-41: the App's preview surface is already full window (z 900) in its profile - a browser; natural layout, page zoom 1
        _ = _surfaces.SetViewportAsync(tile, 0, 0);
        // 2026-09-07: the setup panel sits top-right - exactly where every service keeps its Log In control (Pandora's
        // was under it). The page gets the width left of the panel's column instead, so nothing of Prism's is ever
        // over a control the person has to reach; the panel stands beside the page, not on it.
        const double panelColumn = 320 + 18 + 24;
        // VS-1 (2026-09-19, the video services build-out): the service header strip along the top of the page - the same
        // bar the inline app window carries (Sign in / Quick play / Start over / Mute / Done for a music service; Sign in /
        // Watch / Home / Mute / Done for a video one), one component in two kinds. The page starts below it.
        var kind = AppKindOf(app.Id);
        var barH = _asNoAccount || kind == "web" ? 0 : AppBarHeight;
        _surfaces.SetRect(tile, new PrismHost.Channel.ChannelRect(0, barH, Math.Max(1, TileCanvas.ActualWidth - panelColumn), Math.Max(1, TileCanvas.ActualHeight - barH)));

        var panelBg = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE6, 0x12, 0x13, 0x1A));
        var floatHost = new Grid();
        Canvas.SetZIndex(floatHost, 998);
        var card = new StackPanel { Spacing = 8, Width = 320 };
        card.Children.Add(new TextBlock { Text = signIn && !AppNeedsNoAccount(app) ? "Sign in to " + app.Name : app.Name, FontSize = 18, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        var statusRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        _asStatusPill = new Border { CornerRadius = new CornerRadius(10), Padding = new Thickness(10, 2, 10, 2), VerticalAlignment = VerticalAlignment.Center };
        _asStatusLine = new TextBlock { FontSize = 14, Foreground = LeInk, VerticalAlignment = VerticalAlignment.Center };
        _asStatusPill.Child = _asStatusLine;
        statusRow.Children.Add(_asStatusPill);
        card.Children.Add(statusRow);
        _asUrlLine = new TextBlock { FontSize = 12, Foreground = LeDim, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 300 };
        card.Children.Add(_asUrlLine);
        // plain words, light ink (2026-09-29: it read "Profile: tubi, sessions persist, never wiped" in small grey)
        card.Children.Add(new TextBlock { Text = "Your sign-in is kept on this device and stays until you sign out.", FontSize = 14, Foreground = LeInk, TextWrapping = TextWrapping.Wrap });
        // docs/concept-scenes.md §6: a first-party page has no account behind it.
        // Say that instead of offering a sign-in nobody can complete.
        _asNoAccount = AppNeedsNoAccount(app);
        if (_asNoAccount) _asSignIn = false;   // nothing to sign in to: the plain card says so
        _asHint = new TextBlock
        {
            Text = _asNoAccount
                ? "Nothing to set up: this page is part of Prism, runs on this device and reaches no network. What it remembers - your list, your notes, your timer - lives in this device's storage and is never wiped. Done returns to the scene."
                : _asSignIn ? "Sign in here. Prism watches for " + app.Name + " to take you back, then looks for your account on the page before it says signed in."
                : "Browse as you would in a browser: sign in, pick a profile, set preferences. Sign-in popups open in a sheet. The status above follows the page: a sign-in page means needs attention; your own pages mean signed in. Done saves the status and returns to the scene.",
            FontSize = 14, Foreground = LeInk, TextWrapping = TextWrapping.Wrap,
        };
        card.Children.Add(_asHint);

        Button CardButton(string text) => new() { Content = text, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 6, 12, 6) };
        var login = _asNoAccount ? null : await SignInPageAsync(adapter);
        if (login is not null)
        {
            var goLogin = CardButton(_asSignIn ? "↻  Back to the sign-in page" : "→  Go to the sign-in page");
            ToolTipService.SetToolTip(goLogin, login);
            goLogin.Click += (_, __) => { if (_asTile is { } t) _surfaces.Navigate(t, login); };
            card.Children.Add(goLogin);
        }
        var home = CardButton("⌂  Go to " + Shorten(app.BaseUrl, 40));
        home.Click += (_, __) => { if (_asTile is { } t && IsHttpUrl(app.BaseUrl)) _surfaces.Navigate(t, app.BaseUrl); };
        if (!_asSignIn) card.Children.Add(home);
        var facets = CardButton("✂  New Facet of this App…");
        ToolTipService.SetToolTip(facets, "Leave setup and cut a Facet from this App (page + region + zoom for a slot class).");
        facets.Click += (_, __) => { var id = app.Id; CloseAppSetup(); OpenFacetEditor(id); };
        if (!_asSignIn) card.Children.Add(facets);
        var done = CardButton("✓  Done");
        done.Background = Amber; done.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x12, 0x13, 0x1A));
        ToolTipService.SetToolTip(done, "Save the setup status as observed (signed in / needs attention) and return to the scene.");
        done.Click += (_, __) => _ = FinishAppSetupAsync(save: true);
        _asDone = done;
        var cancel = CardButton("Cancel  (Esc)");
        ToolTipService.SetToolTip(cancel, "Return to the scene without changing the saved status. Anything you signed into stays signed in.");
        cancel.Click += (_, __) => _ = FinishAppSetupAsync(save: false);
        if (_asSignIn)
        {
            // the wizard has no Done: the probe finishes it, or a person's word does - and the two are stored differently
            _asMark = CardButton("✓  I'm signed in - mark it");
            ToolTipService.SetToolTip(_asMark, "Prism could not see your account on the page. Your word is recorded as \"marked signed in\", not as verified.");
            _asMark.Visibility = Visibility.Collapsed;
            _asMark.Click += (_, __) => _ = FinishSignInAsync("signed-in", "asserted");
            card.Children.Add(_asMark);
            done.Visibility = Visibility.Collapsed; card.Children.Add(done);   // B-130: appears when the page is signed in already - browse, pick, Done
        }
        else card.Children.Add(done);
        card.Children.Add(cancel);
        floatHost.Children.Add(FloatingPanel((_asSignIn ? "Sign in · " : "App setup · ") + app.Name, card, panelBg, HorizontalAlignment.Right, VerticalAlignment.Top, new Thickness(0, 44, 18, 0)));
        if (barH > 0)
        {
            var strip = AppBar(kind, app.Name, tile, null,
                onSignIn: _asNoAccount ? null : () => { if (_asTile is { } t) _ = SignInOnTileAsync(adapter, app.Name, app.BaseUrl, t); },
                onHome: () => { if (_asTile is { } t && IsHttpUrl(app.BaseUrl)) _surfaces.Navigate(t, app.BaseUrl); },
                onDone: () => _ = FinishAppSetupAsync(save: true),
                onWatch: async () => { _editorContinuations.Remove("app-setup"); CloseWelcome(); await FinishAppSetupAsync(save: true); if (WatchGrip.Visibility == Visibility.Visible) await ShowVideoHubAsync(); });
            strip.Width = Math.Max(1, TileCanvas.ActualWidth - panelColumn); strip.HorizontalAlignment = HorizontalAlignment.Left; strip.VerticalAlignment = VerticalAlignment.Top;
            floatHost.Children.Add(strip);
        }
        RootGrid.Children.Add(floatHost);
        _asFloat = floatHost;
        ApplyVisualizationRevealState();   // a full-screen visualization chrome must not sit over this page's clicks

        RenderSetupStatus(app.Status, app.LastVerified, _surfaces.SourceOf(tile) ?? app.BaseUrl);
        // the wizard goes straight to the sign-in page: a live session redirects back at once and the probe closes
        // the wizard by itself; a dead one lands on the form with nothing in the way
        // (the window opened at the sign-in page: a live session redirects straight back; a dead one lands on the form.) A service that signs
        // in on its own page has its Sign In control pressed, the person having asked to sign in
        if (_asSignIn && login is null && !_asNoAccount && AdapterSession(adapter) is not null) _ = SignInOnTileAsync(adapter, app.Name, null, tile);
        await UpdateSetupCardAsync(app, _surfaces.SourceOf(tile) ?? app.BaseUrl);
        cancel.Focus(FocusState.Programmatic);
    }

    private void RenderSetupStatus(string status, string? lastVerified, string url)
    {
        if (_asStatusLine is null || _asStatusPill is null) return;
        var (text, color) = status switch
        {
            "signed-in" => ("signed in", Windows.UI.Color.FromArgb(0x60, 0x5C, 0xC8, 0xC0)),
            "needs-attention" => ("needs attention", Windows.UI.Color.FromArgb(0x60, 0xD0, 0x6A, 0x5A)),
            _ => ("unknown", Windows.UI.Color.FromArgb(0x60, 0x9A, 0x9C, 0xA8)),
        };
        // the sign-in window says it in a person's words (2026-09-30 walk: "needs attention, verified now (unsaved)" on a first sign-in);
        // the setup window keeps the status vocabulary, and says when Done saves it
        if (_asSignIn) _asStatusLine.Text = status switch { "signed-in" => "Signed in", "needs-attention" => "Not signed in yet", _ => "Checking the page" };
        else _asStatusLine.Text = text + (lastVerified is null ? "" : "  ·  verified " + (lastVerified == "now (unsaved)" ? "just now, saved on Done" : lastVerified));
        _asStatusPill.Background = new SolidColorBrush(color);
        if (_asUrlLine is not null) _asUrlLine.Text = Shorten(url, 70);
        ToolTipService.SetToolTip(_asUrlLine, url);
    }

    /// <summary>The page moved: core's login-redirect heuristic updates what the card shows (saved on Done, or at once for a redirect to sign-in).</summary>
    private async Task UpdateSetupCardAsync(ModelApp app, string url)
    {
        if (!_asSession || _asApp?.Id != app.Id) return;
        if (_asNoAccount)
        {
            // Nothing to observe: there is no sign-in this App could be sent to.
            _asObserved = "signed-in";
            RenderSetupStatus("signed-in", app.LastVerified, url);
            return;
        }
        var adapter = AdapterNameFor(app);
        var r = await LoginRedirectAsync(url, AdapterLoginUrl(adapter), app.BaseUrl);
        if (!_asSession) return;
        var observed = r?.Status ?? (r?.Redirect == "elsewhere" ? _asObserved : "unknown");
        // Signing in happens ON the App's own page (Apple TV: Apple's sheet over tv.apple.com, no sign-in address): being on
        // its pages says nothing about the session - only the page's own account marker does (the probe, at Done).
        if (SignInOnPage(adapter) && r?.Redirect == "app") observed = "unknown";
        // In the sign-in window the page's own account marker decides, not the address (2026-09-29, a new device: Tubi's pages open to anybody,
        // so the card said "signed in" over a line that said "Still signed out"): until the probe has answered, the card claims nothing.
        if (_asSignIn && r?.Redirect == "app" && AdapterSession(adapter) is not null) observed = "unknown";
        _asObserved = observed ?? "unknown";
        RenderSetupStatus(_asObserved == "unknown" ? app.Status : _asObserved, _asObserved == "unknown" ? app.LastVerified : "now (unsaved)", url);
        if (_asHint is not null)
            _asHint.Text = r?.Redirect switch
            {
                "login" => "This is the sign-in page. Sign in here - the session lives in this App's profile and persists. When the site returns you to your own pages the status flips to signed in.",
                "app" when SignInOnPage(adapter) => "Sign in with " + app.Name + "'s own Sign In button on this page. Prism looks for your account on the page before it says signed in.",
                "app" => "You are on " + app.Name + "'s own pages - that reads as signed in. Browse, set preferences, then Done.",
                _ => "The page left " + app.Name + " (a third-party sign-in, or another site). The status keeps its last reading until the App's own pages return.",
            };
        if (r?.Redirect == "login") _asSawSignedOut = true;   // B-130: a sign-in page seen = a session Prism is watching begin
        if (_asSignIn)
        {
            if (r?.Redirect == "app") _ = RunSessionProbeAsync(app, ++_asProbeRun);
            else { _asProbeRun++; if (_asMark is not null) _asMark.Visibility = Visibility.Collapsed; if (_asHint is not null && r?.Redirect == "login") _asHint.Text = "Sign in here. Prism watches for " + app.Name + " to take you back, then looks for your account on the page before it says signed in."; }
        }
    }

    /// <summary>
    /// The sign-in wizard's evidence: the adapter's session probe, a few times while the page settles.
    /// Account seen → saved as probe evidence, back to the scene. Sign-in control seen → still signed out,
    /// say so and stay. Neither → offer "mark it" (stored as asserted, never as verified). No probe at all →
    /// "mark it" straight away. Nothing about the page leaves the device (§19/§22).
    /// </summary>
    private async Task RunSessionProbeAsync(ModelApp app, int run)
    {
        var probe = AdapterSession(AdapterNameFor(app));
        if (probe is null)
        {
            if (_asHint is not null) _asHint.Text = "You are on " + app.Name + "'s own pages. Prism cannot check " + app.Name + "'s session yet, so it won't claim you're signed in. Say so below if you are.";
            if (_asMark is not null) _asMark.Visibility = Visibility.Visible;
            return;
        }
        var js = await RuntimeEvalAsync("PrismRuntime.modelSessionProbeJs(" + Q(probe.Value.SignedIn) + ", " + Q(probe.Value.SignedOut) + ")");
        if (string.IsNullOrEmpty(js) || js.StartsWith("__prism")) return;
        for (var attempt = 0; attempt < 5; attempt++)
        {
            if (!_asSession || !_asSignIn || run != _asProbeRun || _asTile is not { } tile) return;
            var raw = await _surfaces.EvalOnTileAsync(tile, js);
            var verdict = raw is null || raw.StartsWith("__prism") ? null : (await RuntimeEvalAsync("PrismRuntime.modelSessionVerdict(" + Q(raw) + ")"))?.Trim().Trim('"');
            if (verdict == "null") verdict = null;
            LogLine("signin probe " + app.Id + " try " + (attempt + 1) + ": " + (verdict ?? "nothing seen"));
            if (!_asSession || run != _asProbeRun) return;
            if (verdict == "signed-in")
            {
                // B-130 (2026-09-07): closing the moment the account is seen was right for a sign-in Prism WATCHED begin, and
                // a bounce for a page that was signed in on arrival ("took me into pandora, I picked a station, kicked me back
                // out"). Already signed in: record it, stay, and let the person browse and pick - Done when they like; what
                // they start carries on (B-129).
                if (_asSawSignedOut) { await FinishSignInAsync("signed-in", "probe"); return; }
                _asSignIn = false;
                await SaveAppStatusAsync(app, "signed-in", "probe");
                RenderSetupStatus("signed-in", DateTime.Now.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture), _asTile is { } t2 ? _surfaces.SourceOf(t2) ?? app.BaseUrl : app.BaseUrl);
                if (_asHint is not null) _asHint.Text = "You're signed in to " + app.Name + ". Pick something to play, then Done. It keeps playing on the wall.";
                if (_asMark is not null) _asMark.Visibility = Visibility.Collapsed;
                if (_asDone is not null) _asDone.Visibility = Visibility.Visible;
                return;
            }
            if (verdict == "needs-attention")
            {
                _asSawSignedOut = true;
                _asObserved = "needs-attention";
                RenderSetupStatus("needs-attention", "now (unsaved)", _asTile is { } t3 ? _surfaces.SourceOf(t3) ?? app.BaseUrl : app.BaseUrl);
                if (_asHint is not null) _asHint.Text = "Still signed out: " + app.Name + "'s page shows its Sign in control. Use Back to the sign-in page.";
                if (_asMark is not null) _asMark.Visibility = Visibility.Collapsed;
                return;
            }
            await Task.Delay(1500);
        }
        if (!_asSession || run != _asProbeRun) return;
        if (_asHint is not null) _asHint.Text = "Not there yet: you are on " + app.Name + "'s pages but Prism could not see your account. Sign in if you have not, or mark it below.";
        if (_asMark is not null) _asMark.Visibility = Visibility.Visible;
    }

    /// <summary>The App signs in on its own page (a session probe, no sign-in address): the URL can't tell signed in from out.</summary>
    private bool SignInOnPage(string? adapter) => adapter is not null && AdapterSession(adapter) is not null && (AdapterLoginUrl(adapter) is null || (_signInPages.TryGetValue(adapter, out var page) && page is null));

    /// <summary>One reading of the adapter's session probe on the setup page: signed-in | needs-attention | null (nothing seen).</summary>
    private async Task<string?> ProbeSessionOnceAsync(ModelApp app)
    {
        var probe = AdapterSession(AdapterNameFor(app));
        if (probe is null || _asTile is not { } tile) return null;
        var js = await RuntimeEvalAsync("PrismRuntime.modelSessionProbeJs(" + Q(probe.Value.SignedIn) + ", " + Q(probe.Value.SignedOut) + ")");
        if (string.IsNullOrEmpty(js) || js.StartsWith("__prism")) return null;
        var raw = await _surfaces.EvalOnTileAsync(tile, js);
        var verdict = raw is null || raw.StartsWith("__prism") ? null : (await RuntimeEvalAsync("PrismRuntime.modelSessionVerdict(" + Q(raw) + ")"))?.Trim().Trim('"');
        LogLine("setup done probe " + app.Id + ": " + (verdict is null or "null" ? "nothing seen" : verdict));
        return verdict is "signed-in" or "needs-attention" ? verdict : null;
    }

    private async Task FinishSignInAsync(string status, string evidence)
    {
        if (!_asSession || _asApp is null) return;
        var app = _asApp; var appId = app.Id;
        _asProbeRun++;
        var ok = await SaveAppStatusAsync(app, status, evidence);
        SetPill(ok ? "Prism · " + app.Name + ": " + (evidence == "probe" ? "signed in (your account was seen on the page)" : "marked signed in") : "Prism · " + app.Name + ": could not save the status");
        CloseAppSetup();
        EditorClosed("app-setup", appId, ok);
        _brain.Call(HostCalls.RecycleApp, app.Id);   // B-124: the App's wall surface starts over on a fresh engine
    }

    private async Task FinishAppSetupAsync(bool save)
    {
        if (!_asSession || _asApp is null) { CloseAppSetup(); return; }
        var app = _asApp;
        var appId = app.Id;
        if (save)
        {
            var url = _asTile is { } t ? _surfaces.SourceOf(t) : null;
            var r = url is null ? null : await LoginRedirectAsync(url, AdapterLoginUrl(AdapterNameFor(app)), app.BaseUrl);
            var status = r?.Status ?? (_asObserved != "unknown" ? _asObserved : null);
            // Sign-in on the page itself: the address is no evidence (Done on tv.apple.com saved Apple TV "signed in" while it
            // was not, 2026-09-23). Ask the page: its account marker, or its Sign In control, or nothing changes.
            var onPage = SignInOnPage(AdapterNameFor(app)) && r?.Redirect == "app";
            if (onPage) status = await ProbeSessionOnceAsync(app);
            if (status is not null && await SaveAppStatusAsync(app, status, onPage ? "probe" : "url")) SetPill("Prism · " + app.Name + " setup: " + (status == "signed-in" ? "signed in" : "needs attention") + ", verified just now");
            else SetPill("Prism · " + app.Name + " setup: status unchanged (" + app.Status + ")");
        }
        CloseAppSetup();
        EditorClosed("app-setup", appId, save);   // SM-3 integration: the opener (wizard, rail, badge round-trip) resumes
        _brain.Call(HostCalls.RecycleApp, app.Id);   // B-124: the App's wall surface starts over on a fresh engine
    }

    private void CloseAppSetup()
    {
        if (!_asSession) return;
        var tile = _asTile;
        _asSession = false;
        SyncEmptyStage();
        SyncEmptyWallNote();
        StepWizardAside(false);
        _asNoAccount = false;
        _asSignIn = false; _asMark = null; _asProbeRun++;
        _asApp = null; _asTile = null; _asStatusLine = null; _asUrlLine = null; _asHint = null; _asStatusPill = null;
        if (_asFloat is not null) { RootGrid.Children.Remove(_asFloat); _asFloat = null; }
        _vfTile = null; _vfMode = "views";
        ApplyVisualizationRevealState();                                // the wall's chrome comes back over the beams
        _ = ReleaseAppSurfaceAsync(tile);                               // B-41: core destroys the preview surface
    }
}
