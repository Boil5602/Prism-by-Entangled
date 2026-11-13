using System.Runtime.InteropServices.WindowsRuntime;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// A recording of the window's own drawing, for clips of PRISM (dev, 2026-11-11, asked for short clips of the visuals for the website).
/// "record SECONDS WIDTH HEIGHT FOLDER" on hub.request: the window's inside is sized to WIDTH x HEIGHT, the XAML tree is drawn to a bitmap
/// as often as the compositor gives a frame for SECONDS, and each bitmap is written raw (BGRA, premultiplied) to FOLDER/frames.bgra with its
/// time in FOLDER/times.txt; then the window gets its size back and FOLDER/record.done says how it went. No sound is recorded, the pointer and
/// the window's frame are not in it, and web pages draw as the dark ground (the dev shot's limits). A script makes the clip from the frames.
/// </summary>
public sealed partial class MainWindow
{
    private bool _devRecording;

    private async Task DevRecordAsync(string arg)
    {
        var a = arg.Split(' ', 4, StringSplitOptions.RemoveEmptyEntries);
        if (_devRecording || a.Length < 4 || !double.TryParse(a[0], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var seconds) || !int.TryParse(a[1], out var w) || !int.TryParse(a[2], out var h)) return;
        var dir = a[3].Trim();
        _devRecording = true;
        var oldPos = AppWindow.Position; var oldSize = AppWindow.Size; var resized = false;
        try
        {
            Directory.CreateDirectory(dir);
            try { File.Delete(Path.Combine(dir, "record.done")); } catch { }
            var sc = RootGrid.XamlRoot?.RasterizationScale ?? 1.0;
            if ((int)Math.Round(RootGrid.ActualWidth * sc) != w || (int)Math.Round(RootGrid.ActualHeight * sc) != h)
            {
                AppWindow.ResizeClient(new Windows.Graphics.SizeInt32(w, h)); resized = true;
                for (var i = 0; i < 40 && ((int)Math.Round(RootGrid.ActualWidth * sc) != w || (int)Math.Round(RootGrid.ActualHeight * sc) != h); i++) await Task.Delay(100);
                await Task.Delay(2500);   // the scene lays itself out again at the new size
            }
            // the stage alone: the visual's element drawn every frame, its chrome (the song's block, the cover) twice a second. The whole
            // tree with its parked pages took half a second a frame.
            var id = _vizChrome.Keys.FirstOrDefault(k => _surfaces.VizOf(k) is not null);
            if (id is null || _surfaces.VizOf(id) is not { } viz) throw new InvalidOperationException("no visual on the screen");
            var chrome = _vizChrome[id];
            var times = new System.Text.StringBuilder();
            var n = 0; int cw = 0, ch = 0, kw = 0, kh = 0, kn = 0;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            using (var fs = new FileStream(Path.Combine(dir, "frames.bgra"), FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 22))
            using (var ks = new FileStream(Path.Combine(dir, "chrome.bgra"), FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 22))
            {
                var rtb = new RenderTargetBitmap(); var rtk = new RenderTargetBitmap();
                var nextChrome = 0.0;
                while (sw.Elapsed.TotalSeconds < seconds)
                {
                    var t = sw.Elapsed.TotalMilliseconds;
                    if (t >= nextChrome)
                    {
                        await rtk.RenderAsync(chrome);
                        var kp = (await rtk.GetPixelsAsync()).ToArray();
                        if (kn == 0) { kw = rtk.PixelWidth; kh = rtk.PixelHeight; }
                        if (kn == 0)
                        {
                            // the same chrome at twice the size, for a still that stays sharp on a large screen
                            var rt2 = new RenderTargetBitmap(); await rt2.RenderAsync(chrome, kw * 2, kh * 2);
                            File.WriteAllBytes(Path.Combine(dir, "chrome2x.bgra"), (await rt2.GetPixelsAsync()).ToArray());
                            File.WriteAllText(Path.Combine(dir, "chrome2x.txt"), rt2.PixelWidth + "x" + rt2.PixelHeight);
                        }
                        if (rtk.PixelWidth != kw || rtk.PixelHeight != kh) break;
                        ks.Write(kp, 0, kp.Length); kn++; nextChrome = t + 500;
                    }
                    await rtb.RenderAsync(viz);
                    var px = (await rtb.GetPixelsAsync()).ToArray();
                    // a scene draws past its own edges (a glow, a train still off the stage) and the bitmap takes all of it in: the stage is the
                    // part every column and row of which is opaque, since the scene's ground covers it
                    int bw = rtb.PixelWidth, bh = rtb.PixelHeight;
                    if (n == 0) { cw = (int)Math.Round(viz.ActualWidth * sc); ch = (int)Math.Round(viz.ActualHeight * sc); }
                    if (bw < cw || bh < ch) break;
                    int x0 = 0, y0 = 0;
                    if (bh > ch)
                    {
                        for (y0 = 0; y0 < bh - ch; y0++) { int op = 0, tot = 0; for (var x = 0; x < bw; x += 16) { tot++; if (px[(y0 * bw + x) * 4 + 3] == 255) op++; } if (op * (long)bw >= tot * (long)cw * 0.9) break; }
                    }
                    if (bw > cw)
                    {
                        for (x0 = 0; x0 < bw - cw; x0++) { int op = 0, tot = 0; for (var y = y0; y < y0 + ch; y += 8) { tot++; if (px[(y * bw + x0) * 4 + 3] == 255) op++; } if (op >= tot * 0.97) break; }
                    }
                    for (var row = 0; row < ch; row++) fs.Write(px, ((y0 + row) * bw + x0) * 4, cw * 4);
                    times.Append(t.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture)).Append(' ').Append(kn - 1).Append('\n');
                    n++;
                }
            }
            File.WriteAllText(Path.Combine(dir, "times.txt"), times.ToString());
            File.WriteAllText(Path.Combine(dir, "record.done"), "frames=" + n + "\nwidth=" + cw + "\nheight=" + ch + "\nseconds=" + sw.Elapsed.TotalSeconds.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + "\nchrome=" + kw + "x" + kh + " x " + kn + "\nwindow=" + (int)RootGrid.ActualWidth + "x" + (int)RootGrid.ActualHeight + "\n");
            LogLine("dev record: " + n + " frame(s) of " + cw + "x" + ch + " in " + sw.Elapsed.TotalSeconds.ToString("0.0") + " s");
        }
        catch (Exception ex)
        {
            try { File.WriteAllText(Path.Combine(dir, "record.done"), "error=" + ex.Message + "\n"); } catch { }
            LogLine("dev record failed: " + ex.Message);
        }
        finally
        {
            if (resized) { try { AppWindow.MoveAndResize(new Windows.Graphics.RectInt32(oldPos.X, oldPos.Y, oldSize.Width, oldSize.Height)); } catch { } }
            _devRecording = false;
        }
    }
}
