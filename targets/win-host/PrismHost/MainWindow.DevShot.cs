using Microsoft.UI.Xaml;
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

    private void DevHub(string dir)
    {
        var req = Path.Combine(dir, "hub.request");
        string text;
        try { if (!File.Exists(req)) return; text = File.ReadAllText(req).Trim(); File.Delete(req); } catch { return; }
        try
        {
            if (text == "close") { CloseVideoHub(); return; }
            if (text == "show video") { _stayOnVideo = true; CloseVideoHub(); return; }   // Show video as pressed (2026-09-25)
            if (text == "profiles") { _ = ShowProfilesWindowAsync(); return; }   // the Profiles window (2026-09-24)
            if (text == "profiles close") { CloseProfilesWindow(); return; }
            if (text == "settings") { _ = ShowWatchSettingsAsync("general"); return; }   // Watch settings (2026-09-24)
            if (text == "settings updates") { _ = ShowWatchSettingsAsync("updates"); return; }
            if (text == "settings close") { CloseWatchSettings(); return; }
            if (text == "settings binge") { _ = ShowWatchSettingsAsync("binge"); return; }
            if (text == "settings hidden") { _ = ShowWatchSettingsAsync("hidden"); return; }
            if (text == "credits") { ShowCredits(); return; }
            if (text == "details close") { CloseTitleDetails(); return; }
            if (text.StartsWith("details ", StringComparison.Ordinal)) { var dp = text.Substring(8).Split('|'); ShowTitleDetails(dp[0], dp.Length > 1 ? dp[1] : null, dp.Length > 2 ? dp[2] : null); return; }   // "details <title>|<kind>|<app>" (2026-09-24)
            if (text == "credits close") { CloseCredits(); return; }
            if (text == "link close") { CloseLinkModal(); return; }
            if (text == "dust") { DevDust(); return; }
            if (text == "group none" || text == "group genre") { _hubGroup = text.Substring(6); _hubTab = "library"; _ = ShowVideoHubAsync(); return; }   // the Library grouped (2026-09-25)   // the removal effect on a card, nothing removed (2026-09-25)
            if (text.StartsWith("link ", StringComparison.Ordinal)) { ShowLinkModal(text.Substring(5).Trim(), text.Substring(5).Trim()); return; }
            if (text == "binge") { _hubTab = "watch"; _bingeOpen = true; _ = ShowVideoHubAsync(); return; }   // The Binge in full (2026-09-24)
            // "scroll <px>": the open page's rows scrolled to that offset (a dev shot of a row below the fold, 2026-09-22)
            if (text.StartsWith("scroll ", StringComparison.Ordinal) && double.TryParse(text.Substring(7), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var px)) { _hubScroller?.ChangeView(null, px, null, true); return; }
            if (text == "library" || text == "watch" || text == "browse") { _hubTab = text; _ = ShowVideoHubAsync(); return; }   // the page on that tab (2026-09-22)
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
