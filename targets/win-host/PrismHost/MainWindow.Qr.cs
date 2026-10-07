using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace PrismHost;

/// <summary>
/// The QR codes the wall shows (pairing a phone, approving Prism on TMDB), with the Prism mark in the middle (2026-10-05, "Sometimes I see
/// designs in QR codes. Can we fit a prism one in there?"). The code is made at error-correction level H, which survives 30% of its modules
/// being unreadable; the mark sits on a white tile covering about a fifth of the width, well inside that, so a phone's camera reads it as
/// before. The mark is the same prism-icon.png the app icon and the phone's home-screen icon derive from (B-190).
/// Level H costs modules (a pairing address: 49 a side where level M took 37), so the cards grew from 260 and 220 px to 300 and 250 so
/// each module stays as big on the wall as before. Checked off-screen with OpenCV: the composition decodes at renders down to about 140 px
/// (the plain code to about 110), whatever the tile's size between 16% and 21%; the card is twice that.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>A white, rounded tile holding the code with the mark in its middle, <paramref name="side"/> px square.</summary>
    private async Task<FrameworkElement> QrWithMarkAsync(string url, double side)
    {
        var png = new QRCoder.PngByteQRCode(new QRCoder.QRCodeGenerator().CreateQrCode(url, QRCoder.QRCodeGenerator.ECCLevel.H)).GetGraphic(8);
        var bmp = new BitmapImage();
        using (var ms = new Windows.Storage.Streams.InMemoryRandomAccessStream())
        {
            await ms.WriteAsync(System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsBuffer(png));
            ms.Seek(0);
            await bmp.SetSourceAsync(ms);
        }
        var g = new Grid { Width = side, Height = side };
        g.Children.Add(new Image { Source = bmp, Width = side, Height = side });
        try
        {
            var mark = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "prism-icon.png");
            if (System.IO.File.Exists(mark))
            {
                var tile = Math.Round(side * 0.21);
                g.Children.Add(new Border
                {
                    Width = tile, Height = tile, CornerRadius = new CornerRadius(tile * 0.18), Background = new SolidColorBrush(Microsoft.UI.Colors.White),
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Padding = new Thickness(tile * 0.08),
                    Child = new Image { Source = new BitmapImage(new Uri(mark)), Stretch = Stretch.Uniform },
                });
            }
        }
        catch (Exception ex) { LogLine("qr: mark " + ex.Message); }
        return new Border { Background = new SolidColorBrush(Microsoft.UI.Colors.White), Padding = new Thickness(10), CornerRadius = new CornerRadius(8), HorizontalAlignment = HorizontalAlignment.Center, Child = g };
    }
}
