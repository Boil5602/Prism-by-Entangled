using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// A rating line that carries both numbers in the room of one (2026-10-03, "Do we show our rating under the title with the community
/// average? If so maybe we should come up with an overlay color pattern to make it display both combined somehow without taking up extra
/// space"): the star glyph is the person's - dim with no rating of theirs, filled amber from the left by their rating's share of ten - and
/// the words beside it are TMDB's, the members' mean and the vote count, as before. The same title on any service shows the same star.
/// </summary>
public sealed partial class MainWindow
{
    private sealed class RatingLineUi
    {
        public required StackPanel Root;
        public required TextBlock Dim;
        public required TextBlock Fill;
        public required TextBlock Words;
        public double? Mine;
        public string Text = "";
    }
    private static readonly string RatingStar = ((char)0x2605).ToString();

    /// <summary>The line: the star, then TMDB's words (the leading star of core's label dropped, since the glyph here is it).</summary>
    private static RatingLineUi MakeRatingLine(string text, double? mine, double size, SolidColorBrush words)
    {
        var dim = new TextBlock { Text = RatingStar, FontSize = size, Foreground = words };
        var fill = new TextBlock { Text = RatingStar, FontSize = size, Foreground = HubAmber };
        var star = new Grid { Children = { dim, fill }, VerticalAlignment = VerticalAlignment.Center };
        var w = new TextBlock { FontSize = size, Foreground = words, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
        var root = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, Children = { star, w } };
        var ui = new RatingLineUi { Root = root, Dim = dim, Fill = fill, Words = w };
        star.SizeChanged += (_, __) => ApplyRatingFill(ui);
        SetRatingLine(ui, text, mine);
        return ui;
    }

    /// <summary>The line's words and the star's fill set; the root hidden when there is nothing to say.</summary>
    private static void SetRatingLine(RatingLineUi ui, string text, double? mine)
    {
        ui.Text = text; ui.Mine = mine;
        var words = text.StartsWith(RatingStar + " ", StringComparison.Ordinal) ? text.Substring(2) : text;
        ui.Words.Text = words;
        ui.Root.Visibility = words.Length > 0 || mine is not null ? Visibility.Visible : Visibility.Collapsed;
        ApplyRatingFill(ui);
    }

    private static void ApplyRatingFill(RatingLineUi ui)
    {
        var w = ui.Dim.ActualWidth; var h = ui.Dim.ActualHeight;
        if (ui.Mine is not { } m || m <= 0) { ui.Fill.Visibility = Visibility.Collapsed; return; }
        ui.Fill.Visibility = Visibility.Visible;
        if (w <= 0) return;
        ui.Fill.Clip = new RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, Math.Max(0, w * Math.Clamp(m / 10.0, 0, 1)), Math.Max(h, 1)) };
    }

    /// <summary>The tooltip's words for a line: TMDB's mean and the person's own, each named.</summary>
    private static string RatingWords(string text, double? mine)
    {
        var words = text.StartsWith(RatingStar + " ", StringComparison.Ordinal) ? text.Substring(2) : text;
        return (words.Length > 0 ? "TMDB members: " + words + ". " : "") + (mine is { } m ? "Your rating on TMDB: " + m.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + " of 10, the amber share of the star." : "");
    }
}
