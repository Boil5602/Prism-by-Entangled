using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Graphics.Imaging;

using Windows.Storage.Streams;

namespace PrismHost;

/// <summary>
/// Dev-only XAML capture, off unless PRISM_DEV_SHOT=1. The wall's web content is
/// a hardware overlay plane (GDI screen captures of it come back black - the
/// same MPO plane behind the YouTube overlay flash), and PrintWindow is black
/// for a DirectComposition window, so a script cannot see the rail, the wizard
/// or a context sheet from outside. This renders the XAML tree itself
/// (RootGrid, then every open popup as its own file) when a file named
/// `shot.request` appears in the diagnostics folder, and answers with
/// `shot.done` listing the PNGs. No keyboard, no foreground games, no network;
/// web tiles render as their dark substrate, which is exactly what is wanted
/// when the question is "what does the UI say".
/// </summary>
public sealed partial class MainWindow
{
    private FileSystemWatcher? _devShotWatcher;
    private static string _lastRtb = "";

    private void InitDevShot()
    {
        if (Environment.GetEnvironmentVariable("PRISM_DEV_SHOT") != "1") return;
        // where focus goes, for the hover that comes and goes (2026-09-25, "When I put my mouse over show video, it often shows and loses focus"):
        // every move of the keyboard focus, and what took it
        s_devLog = LogLine;
        Surfaces.SurfaceManager.DevTrace = LogLine;
        Microsoft.UI.Xaml.Input.FocusManager.GotFocus += (_, e) =>
        {
            var el = e.NewFocusedElement as FrameworkElement;
            LogLine("focus -> " + (e.NewFocusedElement?.GetType().Name ?? "null") + (el is not null && el.Name.Length > 0 ? " #" + el.Name : "") + (el?.Tag is string tg && tg.Length > 0 ? " [" + tg + "]" : ""));
        };
        var dir = HostPaths.Diagnostics;
        Directory.CreateDirectory(dir);
        _devShotWatcher = new FileSystemWatcher(dir, "shot.request") { EnableRaisingEvents = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite };
        _devShotWatcher.Created += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() => _ = DevShotAsync(dir));
        _devShotWatcher.Changed += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() => _ = DevShotAsync(dir));
        LogLine("dev shot: watching " + Path.Combine(dir, "shot.request"));
        // dev eval, same gate: `eval.request` = tile id on the first line, JavaScript after it; the page's answer
        // (JSON, as WebView2 returns it) lands in `eval.done`. How an adapter's page-side probe is verified against
        // the live player without a browser: nothing leaves the machine, and the request file is consumed.
        _devEvalWatcher = new FileSystemWatcher(dir, "eval.request") { EnableRaisingEvents = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite };
        _devEvalWatcher.Created += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() => _ = DevEvalAsync(dir));
        _devEvalWatcher.Changed += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() => _ = DevEvalAsync(dir));
        // B-221: `mini.request` (any content) opens the mini player for the first stage, `mini.request` holding "close" closes it -
        // the second window has no shot facility, so the log ("mini player: opened at ...") is how a build is checked without a hand on the mouse
        _devMiniWatcher = new FileSystemWatcher(dir, "mini.request") { EnableRaisingEvents = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite };
        _devMiniWatcher.Created += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() => DevMini(dir));
        _devMiniWatcher.Changed += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() => DevMini(dir));
        // VP-4: `hub.request` (any content) opens the Video player's full-screen hub, "close" closes it - a shot.request then renders it
        _devHubWatcher = new FileSystemWatcher(dir, "hub.request") { EnableRaisingEvents = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite };
        _devHubWatcher.Created += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() => DevHub(dir));
        _devHubWatcher.Changed += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() => DevHub(dir));
        // 2026-09-20: `menu.request` opens the Prism menu (any content), "close" closes it - the main menu driven from a script
        _devMenuWatcher = new FileSystemWatcher(dir, "menu.request") { EnableRaisingEvents = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite };
        _devMenuWatcher.Created += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() => DevMenu(dir));
        _devMenuWatcher.Changed += (_, __) => RootGrid.DispatcherQueue.TryEnqueue(() => DevMenu(dir));
    }

    private FileSystemWatcher? _devMiniWatcher;
    private FileSystemWatcher? _devHubWatcher;
    private FileSystemWatcher? _devMenuWatcher;

    private void DevMenu(string dir)
    {
        var req = Path.Combine(dir, "menu.request");
        string text;
        try { if (!File.Exists(req)) return; text = File.ReadAllText(req).Trim(); File.Delete(req); } catch { return; }
        try
        {
            if (text == "close") { EscapePressed(); LogLine("dev menu: escape"); return; }
            if (text.StartsWith("key ", StringComparison.Ordinal) && _videoHub is not null)   // "key Right": the Watch page's arrow walk, from a script
            {
                if (text.Substring(4).Trim() == "Enter") { if (_hubCur is Microsoft.UI.Xaml.Controls.Button hb) { new Microsoft.UI.Xaml.Automation.Peers.ButtonAutomationPeer(hb).Invoke(); LogLine("dev key Enter: pressed " + DescribeFocus()); } return; }   // the item the walk stands on, pressed
                var k = text.Substring(4).Trim() switch { "Left" => Windows.System.VirtualKey.Left, "Right" => Windows.System.VirtualKey.Right, "Up" => Windows.System.VirtualKey.Up, _ => Windows.System.VirtualKey.Down };
                var took = HubArrow(_videoHub, k);
                LogLine("dev key " + k + ": " + (took ? "taken" : "not taken") + " -> " + DescribeFocus());
                return;
            }
            // "player music" / "player video": the menu's player switch as a person presses it, the Watch page left as it stands (B-262)
            if (text.StartsWith("player ", StringComparison.Ordinal)) { var pk = text.Substring(7).Trim(); _ = SwitchPlayerAsync(pk); LogLine("dev menu: player " + pk); return; }
            CloseVideoHub();
            if (text.StartsWith("prism://", StringComparison.Ordinal)) { OpenRoute(text); LogLine("dev menu: route " + text); return; }   // a page of the menu (prism://scenes, prism://apps ...)
            if (text == "stage") { _ = ShowStageBarAsync(); LogLine("dev menu: stage bar"); return; }   // the stage bar, for a shot
            _ = OpenAppMenuAsync();
            LogLine("dev menu: open");
        }
        catch (Exception ex) { LogLine("dev menu failed: " + ex.GetType().Name + ": " + ex.Message); }
    }

    /// <summary>Dev: the Live tab's first channel row's menu opened at a point of the wall, for a shot of where it lands.</summary>
    private async void DevLiveMenuAt(Windows.Foundation.Point at)
    {
        try
        {
            var raw = await ModelCallAsync("videoLiveGuide", null, null);
            var first = (JsonNode.Parse(raw ?? "null") as JsonObject)?["rows"] is JsonArray rows && rows.Count > 0 ? rows[0] as JsonObject : null;
            if (first is null) { LogLine("dev live menu: no channel"); return; }
            LiveMenu(at, first["facet"]?.GetValue<string>() ?? "", first["id"]?.GetValue<string>() ?? "", first["url"]?.GetValue<string>(), first["name"]?.GetValue<string>() ?? "", first["service"]?.GetValue<string>() ?? "", first["logo"]?.GetValue<string>());
        }
        catch (Exception e) { LogLine("dev live menu: " + e.Message); }
    }

    /// <summary>Dev: press the visible, enabled button whose label is (or starts with) the words given - its own Click, through its
    /// automation peer; no pointer, no keys. The log says which button, or that none was found.</summary>
    private void DevPress(string label)
    {
        static string TextOf(DependencyObject o)
        {
            if (o is TextBlock t) return t.Text ?? "";
            if (o is FontIcon fi && fi.Glyph is { Length: > 0 }) return "glyph:" + ((int)fi.Glyph[0]).ToString("X4");   // an icon-only button: "press glyph:E8FD"
            if (o is ContentControl { Content: string s }) return s;
            var sb = new System.Text.StringBuilder();
            var n = VisualTreeHelper.GetChildrenCount(o);
            for (var i = 0; i < n; i++) { var x = TextOf(VisualTreeHelper.GetChild(o, i)); if (x.Length > 0) { if (sb.Length > 0) sb.Append(' '); sb.Append(x); } }
            return sb.ToString();
        }
        var found = new List<Button>();
        void Walk(DependencyObject o)
        {
            if (o is UIElement { Visibility: Visibility.Collapsed }) return;
            if (o is Button b && b.IsEnabled && b.ActualWidth > 0) { var t = TextOf(b).Trim(); if (t.Equals(label, StringComparison.OrdinalIgnoreCase) || t.StartsWith(label, StringComparison.OrdinalIgnoreCase) || t.Contains("  " + label + "  ", StringComparison.OrdinalIgnoreCase)) found.Add(b); }
            var n = VisualTreeHelper.GetChildrenCount(o);
            for (var i = 0; i < n; i++) Walk(VisualTreeHelper.GetChild(o, i));
        }
        Walk(RootGrid);
        // the label itself first, then a chip carrying it between its symbol and its count ("  Movies  4"), then a text that begins with it (a channel row named Movies)
        var hit = found.OrderByDescending(b => Canvas.GetZIndex(b)).FirstOrDefault(b => TextOf(b).Trim().Equals(label, StringComparison.OrdinalIgnoreCase))
            ?? found.FirstOrDefault(b => TextOf(b).Contains("  " + label + "  ", StringComparison.OrdinalIgnoreCase)) ?? found.FirstOrDefault();
        if (hit is null) { LogLine("dev press: no button '" + label + "'"); return; }
        LogLine("dev press: '" + TextOf(hit).Trim() + "' (" + found.Count + " found)");
        if (Microsoft.UI.Xaml.Automation.Peers.FrameworkElementAutomationPeer.CreatePeerForElement(hit) is Microsoft.UI.Xaml.Automation.Peers.ButtonAutomationPeer peer) peer.Invoke();
    }

    private void DevHub(string dir)
    {
        var req = Path.Combine(dir, "hub.request");
        string text;
        try { if (!File.Exists(req)) return; text = File.ReadAllText(req).Trim(); File.Delete(req); } catch { return; }
        try
        {
            if (text == "close") { CloseVideoHub(); return; }
            if (text.StartsWith("press ", StringComparison.Ordinal)) { DevPress(text.Substring(6).Trim()); return; }   // "press <label>": the visible button with that label, pressed (2026-09-29)
            if (text.StartsWith("welcome", StringComparison.Ordinal)) { DevWelcome(text); return; }
            if (text == "shortcuts") { _ = AskShortcutsAsync(false); return; }   // the Shortcuts dialog, as the Device page opens it (2026-10-06)   // the welcome page, driven (2026-09-29)
            if (text == "show video") { _stayOnVideo = true; CloseVideoHub(); return; }   // Show video as pressed (2026-09-25)
            if (text == "readers on" || text == "readers off") { SetReadersDark(text == "readers on"); return; }   // readers dark (2026-10-03)
            if (text.StartsWith("signin add ", StringComparison.Ordinal)) { var sp = text.Substring(11).Split('|'); if (sp.Length == 2) _ = AddSignInAsync(sp[0].Trim(), sp[0].Trim(), sp[1].Trim()); return; }   // "signin add <app>|<name>" (2026-09-29)
            if (text.StartsWith("live menu ", StringComparison.Ordinal)) { var lp = text.Substring(10).Split(','); if (lp.Length == 2 && double.TryParse(lp[0], out var lx) && double.TryParse(lp[1], out var ly)) DevLiveMenuAt(new Windows.Foundation.Point(lx, ly)); return; }   // the first channel's menu, at a point (2026-09-29)
            if (text.StartsWith("mv remove ", StringComparison.Ordinal)) { _ = MvRemoveWindowAsync(text.Substring(10).Trim()); return; }   // a multiview window closed, the host's own way (2026-09-29)
            if (text == "signin label") { _ = AfterSignInAsync(); return; }   // name the sign-ins nobody named from their account pages
            if (text.StartsWith("signin hide ", StringComparison.Ordinal)) { var sp = text.Substring(12).Split('|'); if (sp.Length == 2) _ = HideSignInAsync(sp[0].Trim(), sp[1].Trim(), sp[1].Trim()); return; }
            if (text.StartsWith("signin show ", StringComparison.Ordinal)) { var sp = text.Substring(12).Split('|'); if (sp.Length == 2) _ = ShowSignInAsync(sp[0].Trim(), sp[1].Trim(), sp[1].Trim()); return; }
            if (text.StartsWith("signin rename ", StringComparison.Ordinal)) { var sp = text.Substring(14).Split('|'); if (sp.Length == 3) _ = RenameSignInAsync(sp[0].Trim(), sp[1].Trim(), sp[1].Trim(), sp[2].Trim()); return; }   // "signin rename <app>|<id>|<name>"
            if (text.StartsWith("signin pick ", StringComparison.Ordinal)) { var sp = text.Substring(12).Split('|'); if (sp.Length == 2) { _draftSignIns[sp[0].Trim()] = sp[1].Trim(); DrawProfilesWindow(); } return; }   // the draft's sign-in for a service
            if (text.StartsWith("profiles name ", StringComparison.Ordinal)) { _draftName = text.Substring(14).Trim(); DrawProfilesWindow(); return; }
            if (text == "profiles save") { _ = SaveProfilesDraftAsync(); return; }
            if (text == "profiles") { _ = ShowProfilesWindowAsync(); return; }   // the Profiles window (2026-09-24)
            if (text == "perf") { PerfDumpNow(); return; }   // every process on its own line in host.log (2026-10-03)
            if (text == "pair") { PairPhone(); return; }   // the Pair a phone card (2026-10-04)
            if (text == "profiles close") { CloseProfilesWindow(); return; }
            if (text == "settings") { _ = ShowWatchSettingsAsync("general"); return; }   // Watch settings (2026-09-24)
            if (text == "settings updates") { _ = ShowWatchSettingsAsync("updates"); return; }
            if (text == "settings close") { CloseWatchSettings(); return; }
            if (text == "settings binge") { _ = ShowWatchSettingsAsync("binge"); return; }
            if (text == "settings hidden") { _ = ShowWatchSettingsAsync("hidden"); return; }
            if (text == "credits") { ShowCredits(); return; }
            if (text.StartsWith("order ", StringComparison.Ordinal)) { var op = text.Substring(6).Split(' '); if (op.Length == 2) _ = SetRowOrderAsync(op[0], op[1] is "rev" or "fwd" ? null : op[1], op[1] == "rev" ? true : op[1] == "fwd" ? false : null); return; }   // "order <continue|list> <id|rev|fwd>" (2026-09-26)
            if (text.StartsWith("jump ", StringComparison.Ordinal)) { JumpContinueTo(text.Substring(5)); return; }   // "jump <app>": Continue watching to a service (2026-09-26)
            if (text == "details close") { CloseTitleDetails(); return; }
            if (text.StartsWith("details ", StringComparison.Ordinal)) { var dp = text.Substring(8).Split('|'); ShowTitleDetails(dp[0], dp.Length > 1 ? dp[1] : null, dp.Length > 2 ? dp[2] : null); return; }   // "details <title>|<kind>|<app>" (2026-09-24)
            if (text == "credits close") { CloseCredits(); return; }
            if (text == "link close") { CloseLinkModal(); return; }
            if (text == "dust hide") { DevDustHide(); return; }   // a removal's dust, then the card back (2026-09-26)
            if (text == "curtain close") { HideStageCurtain(); return; }
            if (text.StartsWith("curtain ", StringComparison.Ordinal)) { var cp = text.Substring(8).Split('|'); ShowStageCurtain(cp[0], cp.Length > 1 ? cp[1] : "Hulu", null); return; }   // the start screen, nothing started (2026-09-26)
            if (text == "dust") { DevDust(); return; }
            if (text == "report close") { CloseReportPanel(); return; }
            if (text.StartsWith("report ", StringComparison.Ordinal)) { ShowReportPanel(text.Substring(7).Trim()); return; }   // the report panel for a window, nothing sent (2026-09-26)
            if (text == "group none" || text == "group genre") { _hubGroup = text.Substring(6); _hubTab = "library"; _ = ShowVideoHubAsync(); return; }   // the Library grouped (2026-09-25)   // the removal effect on a card, nothing removed (2026-09-25)
            if (text.StartsWith("link ", StringComparison.Ordinal)) { ShowLinkModal(text.Substring(5).Trim(), text.Substring(5).Trim()); return; }
            if (text == "binge") { _hubTab = "watch"; _bingeOpen = true; _ = ShowVideoHubAsync(); return; }   // The Binge in full (2026-09-24)
            // "scroll <px>": the open page's rows scrolled to that offset (a dev shot of a row below the fold, 2026-09-22)
            if (text.StartsWith("scroll ", StringComparison.Ordinal) && double.TryParse(text.Substring(7), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var px)) { _hubScroller?.ChangeView(null, px, null, true); return; }
            // the Live tab's own tune, as its channel menu runs it: "tune|<window index>|<facet>|<channel id>|<url>|<name>" (2026-09-28)
            if (text.StartsWith("tune|", StringComparison.Ordinal)) { var tp = text.Split('|'); if (tp.Length >= 6 && int.TryParse(tp[1], out var ti)) _ = TuneIntoAsync(ti, tp[2], tp[3], tp[4].Length > 0 ? tp[4] : null, tp[5], "", null); return; }
            if (text == "library" || text == "watch" || text == "browse" || text == "playlists" || text == "live") { _hubTab = text; _ = ShowVideoHubAsync(); return; }   // the page on that tab (2026-09-22)
            if (text.StartsWith("browse "))
            {
                // "browse <genre>" and "browse <genre> <row>" (yours | top | newest | voted), the row opened in full (2026-09-22)
                var parts = text.Substring(7).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
                _hubTab = "browse";
                if (parts.Length > 0) _browseGenre = parts[0];
                _browseRow = parts.Length > 1 ? parts[1] : null;
                _ = ShowVideoHubAsync();
                return;
            }
            // "search <words>": the menu opens with the words in its box and Search everywhere pressed (a dev shot of the results row)
            if (text.StartsWith("search ", StringComparison.Ordinal)) { var q = text.Substring(7).Trim(); _ = ShowVideoHubAsync().ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _hubSearch?.Invoke(q))); return; }
            _ = ShowVideoHubAsync();
        }
        catch (Exception ex) { LogLine("dev hub failed: " + ex.GetType().Name + ": " + ex.Message); }
    }

    private void DevMini(string dir)
    {
        var req = Path.Combine(dir, "mini.request");
        string text;
        try { if (!File.Exists(req)) return; text = File.ReadAllText(req).Trim(); File.Delete(req); } catch { return; }
        try
        {
            if (text == "close") { CloseMiniPlayer(); RestoreMainFromMini(); LogLine("dev mini: closed"); return; }   // the person's return path
            foreach (var (tileId, parts) in _vizParts) { LogLine("dev mini: opening for " + tileId); OpenMiniPlayer(tileId, parts.Source); return; }
            LogLine("dev mini: no stage chrome on the wall");
        }
        catch (Exception ex) { LogLine("dev mini failed: " + ex.GetType().Name + ": " + ex.Message); }
    }

    private FileSystemWatcher? _devEvalWatcher;

    private async Task DevEvalAsync(string dir)
    {
        var req = Path.Combine(dir, "eval.request");
        string text;
        try { if (!File.Exists(req)) return; text = File.ReadAllText(req); File.Delete(req); } catch { return; }
        var nl = text.IndexOf('\n');
        var id = (nl < 0 ? text : text[..nl]).Trim();
        var js = nl < 0 ? "" : text[(nl + 1)..];
        try
        {
            // `brain` as the id evaluates in core's page (PrismRuntime.*): a dev script's way to ask core, or to re-apply
            // `hover` (dev only): "<surface id> <x> <y>" - the trusted move by itself, to see what a page draws for it
            // "scrubhover" (dev only): "<surface id> <x> <y>" - the trusted move on a wall window's own scrubber, to read its preview (2026-09-23)
            if (id == "scrubhover") { var q = js.Trim().Split(' '); await _surfaces.ScrubAsync(q[0], double.Parse(q[1], System.Globalization.CultureInfo.InvariantCulture), double.Parse(q[2], System.Globalization.CultureInfo.InvariantCulture), press: false); File.WriteAllText(Path.Combine(dir, "eval.done"), "moved"); return; }
            if (id == "hover") { var p = js.Trim().Split(' '); await _surfaces.HoverAsync(p[0], double.Parse(p[1], System.Globalization.CultureInfo.InvariantCulture), double.Parse(p[2], System.Globalization.CultureInfo.InvariantCulture)); File.WriteAllText(Path.Combine(dir, "eval.done"), "hovered"); return; }
            var result = id == "brain" ? await RuntimeEvalAsync(js) : id == "tiles" ? _surfaces.DevDump() : id == "nudge" ? "nudged " + _surfaces.Nudge() : id == "revive" ? _surfaces.DevRevive(js.Trim().Split(' ')[0], js.Trim().Split(' ').Last()) : await _surfaces.EvalOnTileAsync(id, js);   // "tiles": the surfaces' own XAML state (B-295)
            File.WriteAllText(Path.Combine(dir, "eval.done"), result ?? "(null)");
            LogLine("dev eval: " + id + " -> " + (result?.Length ?? 0) + " chars");
        }
        catch (Exception ex)
        {
            File.WriteAllText(Path.Combine(dir, "eval.done"), "error=" + ex.Message);
            LogLine("dev eval failed: " + ex.Message);
        }
    }

    private async Task DevShotAsync(string dir)
    {
        var req = Path.Combine(dir, "shot.request");
        if (!File.Exists(req)) return;
        try { File.Delete(req); } catch { return; }   // one shot per request; a racing second event finds nothing
        var stamp = DateTime.Now.ToString("HHmmss");
        var files = new List<string>();
        try
        {
            // RenderTargetBitmap includes children that overflow the window (a lounge's beams reach far past it),
            // which shifts the origin and shrinks everything: clip the root to its own bounds first. Nothing visible changes.
            // RenderTargetBitmap ignores Clip for its bounds: hidden facets are parked a full wall-width to the LEFT of the
            // canvas (SurfaceManager presence), so the bitmap is ~3x the window. Crop to the window's own pixels instead.
            double minX = 0, minY = 0;
            foreach (var c in TileCanvas.Children)
            {
                var l = Microsoft.UI.Xaml.Controls.Canvas.GetLeft(c); var t = Microsoft.UI.Xaml.Controls.Canvas.GetTop(c);
                if (!double.IsNaN(l)) minX = Math.Min(minX, l);
                if (!double.IsNaN(t)) minY = Math.Min(minY, t);
            }
            var sc = RootGrid.XamlRoot?.RasterizationScale ?? 1.0;
            var crop = ((int)Math.Round(-minX * sc), (int)Math.Round(-minY * sc), (int)Math.Round(RootGrid.ActualWidth * sc), (int)Math.Round(RootGrid.ActualHeight * sc));
            var root = await RenderPngAsync(RootGrid, Path.Combine(dir, "shot-" + stamp + ".png"), crop);
            if (root is not null) files.Add(root);
            var i = 0;
            foreach (var popup in VisualTreeHelper.GetOpenPopupsForXamlRoot(RootGrid.XamlRoot))
            {
                if (popup.Child is not FrameworkElement child) continue;
                var p = await RenderPngAsync(child, Path.Combine(dir, "shot-" + stamp + "-popup" + (++i) + ".png"));
                if (p is not null)
                {
                    // where the popup sits, so a script can aim at it: its child's offset within the window
                    var t = child.TransformToVisual(RootGrid).TransformPoint(new Windows.Foundation.Point(0, 0));
                    files.Add(p + "|" + (int)t.X + "," + (int)t.Y + "," + (int)child.ActualWidth + "," + (int)child.ActualHeight);
                }
            }
            var scale = RootGrid.XamlRoot?.RasterizationScale ?? 1.0;
            File.WriteAllText(Path.Combine(dir, "shot.done"), "scale=" + scale.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\n" + string.Join("\n", files) + "\n"
                + "diag: root=" + (int)RootGrid.ActualWidth + "x" + (int)RootGrid.ActualHeight + " minX=" + (int)minX + " minY=" + (int)minY + " crop=" + crop + " rtb=" + _lastRtb + " canvasChildren=" + TileCanvas.Children.Count + "\n");
            LogLine("dev shot: " + files.Count + " file(s), scale " + scale);
        }
        catch (Exception ex)
        {
            File.WriteAllText(Path.Combine(dir, "shot.done"), "error=" + ex.Message + "\n");
            LogLine("dev shot failed: " + ex.Message);
        }
    }

    private static async Task<string?> RenderPngAsync(UIElement element, string path, (int X, int Y, int W, int H)? crop = null)
    {
        var rtb = new RenderTargetBitmap();
        await rtb.RenderAsync(element);
        if (rtb.PixelWidth == 0 || rtb.PixelHeight == 0) return null;
        var pixels = (await rtb.GetPixelsAsync()).ToArray();
        int w = rtb.PixelWidth, h = rtb.PixelHeight;
        _lastRtb = w + "x" + h + (crop is { } cc ? " want=" + cc : "");
        if (crop is { } c0 && c0.W > 0 && c0.H > 0)
        {
            // the bitmap is capped at 4096 px and SCALED to fit (a 5265-wide render came back 4096x766): scale the crop the same way
            var f = h < c0.H ? (double)h / c0.H : 1.0;
            var c = ((int)Math.Round(c0.X * f), (int)Math.Round(c0.Y * f), (int)Math.Round(c0.W * f), (int)Math.Round(c0.H * f));
            if (c.Item1 + c.Item3 > w) c.Item3 = w - c.Item1;
            if (c.Item2 + c.Item4 > h) c.Item4 = h - c.Item2;
            if (c.Item3 > 0 && c.Item4 > 0 && (c.Item3 < w || c.Item4 < h))
            {
                var cut = new byte[c.Item3 * c.Item4 * 4];
                for (var row = 0; row < c.Item4; row++) System.Buffer.BlockCopy(pixels, ((c.Item2 + row) * w + c.Item1) * 4, cut, row * c.Item3 * 4, c.Item3 * 4);
                pixels = cut; w = c.Item3; h = c.Item4;
            }
        }
        using var stream = new InMemoryRandomAccessStream();
        var enc = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
        enc.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)w, (uint)h, 96, 96, pixels);
        await enc.FlushAsync();
        var bytes = new byte[stream.Size];
        stream.Seek(0);
        using (var reader = new DataReader(stream)) { await reader.LoadAsync((uint)stream.Size); reader.ReadBytes(bytes); }
        File.WriteAllBytes(path, bytes);
        return path;
    }
}
