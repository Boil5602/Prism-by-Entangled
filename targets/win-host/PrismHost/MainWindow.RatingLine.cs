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
        /// <summary>The star on the picture (2026-10-13, "put a star in the lower right and the TMDB score inside of it. Remove the TMDB and vote count"):
        /// the score alone inside the glyph, the words kept for the details.</summary>
        public Grid? Badge; public TextBlock? BadgeFill; public TextBlock? BadgeDim; public TextBlock? Score;
        /// <summary>The person's own rating beside the star, a small amber star with their number (2026-10-13), and the hover window's lines.</summary>
        public Grid? MineBox; public TextBlock? MineScore; public TextBlock? Explain; public TextBlock? Yours; public Border? BadgePill;
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

    /// <summary>The star on a card's picture, lower right, TMDB's score inside it; the person's own rating its amber share as on the line. Hidden with no score.</summary>
    /// <summary>The star's colour by TMDB's score (2026-10-13, "a color scale system for the stars"): red under 5, orange to 6, yellow to 7, light
    /// green to 8, green from 8 up; no score, a quiet grey.</summary>
    private static SolidColorBrush StarTint(double? score) => new(score is not { } s ? Windows.UI.Color.FromArgb(0xFF, 0x9A, 0xA2, 0xAE)
        : s < 5 ? Windows.UI.Color.FromArgb(0xFF, 0xD2, 0x4E, 0x4E) : s < 6 ? Windows.UI.Color.FromArgb(0xFF, 0xE0, 0x86, 0x3A) : s < 7 ? Windows.UI.Color.FromArgb(0xFF, 0xE6, 0xC3, 0x47)
        : s < 8 ? Windows.UI.Color.FromArgb(0xFF, 0x9C, 0xD0, 0x62) : Windows.UI.Color.FromArgb(0xFF, 0x4E, 0xC4, 0x7C));
    private static readonly System.Text.RegularExpressions.Regex VotesRx = new(@"([\d.,]+\s?[kKmM]?)\s*votes", System.Text.RegularExpressions.RegexOptions.Compiled);
    /// <summary>The words of the hover window: where the number comes from and how many voted.</summary>
    private static string ExplainWords(string text)
    {
        var words = text.StartsWith(RatingStar + " ", StringComparison.Ordinal) ? text.Substring(2) : text;
        var m = ScoreRx.Match(words); var v = VotesRx.Match(words);
        if (!m.Success) return "TMDB members have not rated this title yet.";
        return "TMDB members rate it " + m.Groups[1].Value + " of 10" + (v.Success ? ", from " + v.Groups[1].Value.Trim() + " votes." : ".");
    }

    /// <summary>The star on a card's picture with its hover window (2026-10-13, "on mouse over explain the ratings come from TMDB and how many votes.
    /// Also let people add their score from that modal"): the window opens when the pointer rests on the star and closes when it leaves; the
    /// person's own stars in it are the details page's (AddOwnRatingAsync), writing to TMDB under their linked account.</summary>
    private void AddRatingBadge(Grid art, RatingLineUi ui, string? tmdbKind, int tmdbId)
    {
        var g = MakeRatingBadge(ui);
        g.IsHitTestVisible = true;
        art.Children.Add(g);
        ApplyRatingFill(ui);
        // the hover window
        var content = new StackPanel { Spacing = 8, MinWidth = 280, MaxWidth = 360 };
        var fly = new Flyout { Content = content, Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.Top };
        var overContent = false; var built = false;
        async void Open(Microsoft.UI.Xaml.Controls.Primitives.FlyoutShowMode mode)
        {
            if (!built)
            {
                built = true;
                ui.Explain = new TextBlock { Text = ExplainWords(ui.Text), FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
                ui.Yours = new TextBlock { Text = ui.Mine is { } mv ? "Your rating: " + mv.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + " of 10." : "", FontSize = 13, Foreground = HubAmber, Visibility = ui.Mine is not null ? Visibility.Visible : Visibility.Collapsed };
                content.Children.Add(ui.Explain); content.Children.Add(ui.Yours);
                if (tmdbKind is { Length: > 0 } && tmdbId > 0) await AddOwnRatingAsync(content, tmdbKind, tmdbId, ui);
                else content.Children.Add(new TextBlock { Text = "Prism has not matched this title on TMDB, so there is nothing to rate yet.", FontSize = 12, Foreground = HubDim, TextWrapping = TextWrapping.Wrap });
            }
            try { fly.ShowAt(g, new Microsoft.UI.Xaml.Controls.Primitives.FlyoutShowOptions { ShowMode = mode }); } catch { }
        }
        g.PointerEntered += (_, __) => Open(Microsoft.UI.Xaml.Controls.Primitives.FlyoutShowMode.Transient);
        g.PointerExited += async (_, __) => { await Task.Delay(700); if (!overContent) { try { fly.Hide(); } catch { } } };
        content.PointerEntered += (_, __) => overContent = true;
        content.PointerExited += (_, __) => { overContent = false; try { fly.Hide(); } catch { } };
        g.Tapped += (_, e) => { e.Handled = true; Open(Microsoft.UI.Xaml.Controls.Primitives.FlyoutShowMode.Standard); };
        g.RightTapped += (_, e) => e.Handled = true;
    }
    private static Grid MakeRatingBadge(RatingLineUi ui)
    {
        // a pill, not a star (2026-10-13, "I don't think those numbers in the stars are easily read. Might need to change the shape"): the score
        // large and dark on a ground coloured by the scale, a small star before it; the person's own number on an amber pill beside, marked You
        var ink = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x0F, 0x12, 0x16));
        var dim = new TextBlock { Text = RatingStar, FontSize = 12, Foreground = ink, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 3, 0) };
        var fill = new TextBlock { Text = RatingStar, FontSize = 12, Foreground = ink, VerticalAlignment = VerticalAlignment.Center, Visibility = Visibility.Collapsed };
        var score = new TextBlock { FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = ink, VerticalAlignment = VerticalAlignment.Center };
        var pill = new Border { CornerRadius = new CornerRadius(11), Padding = new Thickness(8, 1, 9, 2), Background = StarTint(null), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0xB0, 0x0B, 0x0E, 0x12)), BorderThickness = new Thickness(1.5),
            Child = new StackPanel { Orientation = Orientation.Horizontal, Children = { dim, score } } };
        var mineScore = new TextBlock { FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = ink, VerticalAlignment = VerticalAlignment.Center };
        var mineBox = new Grid { Visibility = Visibility.Collapsed, Children = { new Border { CornerRadius = new CornerRadius(10), Padding = new Thickness(7, 1, 7, 2), Background = HubAmber, BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0xB0, 0x0B, 0x0E, 0x12)), BorderThickness = new Thickness(1.5),
            Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, Children = { new TextBlock { Text = "You", FontSize = 10, Foreground = ink, VerticalAlignment = VerticalAlignment.Center }, mineScore } } } } };
        ToolTipService.SetToolTip(mineBox, "Your rating on TMDB.");
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Children = { mineBox, pill } };
        var g = new Grid { HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 6, 6), IsHitTestVisible = false, Children = { row } };
        ui.Badge = g; ui.BadgeDim = dim; ui.BadgeFill = fill; ui.Score = score; ui.BadgePill = pill; ui.MineBox = mineBox; ui.MineScore = mineScore;
        SetRatingLine(ui, ui.Text, ui.Mine);
        return g;
    }
    private static readonly System.Text.RegularExpressions.Regex ScoreRx = new(@"^\s*(\d+(?:\.\d)?)", System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>The line's words and the star's fill set; the root hidden when there is nothing to say.</summary>
    private static void SetRatingLine(RatingLineUi ui, string text, double? mine)
    {
        ui.Text = text; ui.Mine = mine;
        var words = text.StartsWith(RatingStar + " ", StringComparison.Ordinal) ? text.Substring(2) : text;
        ui.Words.Text = words;
        ui.Root.Visibility = words.Length > 0 || mine is not null ? Visibility.Visible : Visibility.Collapsed;
        if (ui.Badge is not null && ui.Score is not null)
        {
            var m = ScoreRx.Match(words);
            ui.Score.Text = m.Success ? m.Groups[1].Value : "";
            ui.Badge.Visibility = m.Success ? Visibility.Visible : Visibility.Collapsed;
            if (ui.BadgePill is not null) ui.BadgePill.Background = StarTint(m.Success && double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var sc) ? sc : null);
            if (ui.Explain is not null) ui.Explain.Text = ExplainWords(words);
            if (ui.Yours is not null) { ui.Yours.Text = mine is { } mv ? "Your rating: " + mv.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) + " of 10." : ""; ui.Yours.Visibility = mine is not null ? Visibility.Visible : Visibility.Collapsed; }
        }
        ApplyRatingFill(ui);
    }

    private static void ApplyRatingFill(RatingLineUi ui)
    {
        var w = ui.Dim.ActualWidth; var h = ui.Dim.ActualHeight;
        if (ui.BadgeFill is not null) ui.BadgeFill.Visibility = Visibility.Collapsed;   // the star's colour is TMDB's score; the person's number stands beside it
        if (ui.MineBox is not null && ui.MineScore is not null) { var has = ui.Mine is { } mm && mm > 0; ui.MineBox.Visibility = has ? Visibility.Visible : Visibility.Collapsed; ui.MineScore.Text = has ? ui.Mine!.Value.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture) : ""; }
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
