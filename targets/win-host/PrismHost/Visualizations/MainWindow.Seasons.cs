using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using PrismHost.Visualizations;

namespace PrismHost;

// This file is pure ASCII.
// UNDER CONSTRUCTION (2026-11-12): Seasons is not ready and is held back from releases (StylePacks.Held). It shows only in a development start.

public sealed partial class MainWindow
{
    /// <summary>The Seasons visual's settings (host-prefs viz.seasons, one JSON string), read once and kept.</summary>
    private static SeasonsSettings? _seasons;
    private static SeasonsSettings Seasons => _seasons ??= SeasonsSettings.Parse(HostPrefs.GetString("viz.seasons", ""));
    private static readonly string GlyphSeasons = ((char)0xE787).ToString();   // the calendar

    /// <summary>What the Seasons visual shows at this moment of the PC's clock; the scene asks every few seconds.</summary>
    private static SeasonsPlan SeasonsPlanNow() => SeasonsCalendar.Plan(Seasons, DateTime.Now);

    private static string DayText(DateOnly d, bool year = false) => d.Day + " " + System.Globalization.CultureInfo.InvariantCulture.DateTimeFormat.GetAbbreviatedMonthName(d.Month) + (year ? " " + d.Year : "");
    private static string RangeText(SeasonsSettings s, SeasonEntry e)
    {
        var it = s.Item(e.Id);
        if (SeasonsCalendar.MonthDay(it.From) is { } f && SeasonsCalendar.MonthDay(it.To) is { } t)
            return DayText(new DateOnly(2024, f.M, f.D)) + " to " + DayText(new DateOnly(2024, t.M, t.D)) + ", each year";
        if (e.IsSeason)
        {
            var n = Array.IndexOf(new[] { "spring", "summer", "autumn", "winter" }, e.Id); if (s.South) n = (n + 2) % 4;
            return new[] { "20 Mar to 20 Jun", "21 Jun to 21 Sep", "22 Sep to 20 Dec", "21 Dec to 19 Mar" }[n];
        }
        return SeasonsCalendar.Upcoming(e.Id, DateOnly.FromDateTime(DateTime.Now)) is { } o ? DayText(o.From) + " to " + DayText(o.To, true) : "no date";
    }

    /// <summary>
    /// The Seasons visual's settings (2026-11-12, asked for a window that turns each holiday and season on or off and sets a date
    /// range for each): how the scene is picked, the half of the world for the seasons, and a row for each holiday and season
    /// with its switch and its dates. A press on a row's dates opens two day pickers and a way back to the calendar's dates.
    /// Nothing is kept until Save.
    /// </summary>
    private async Task ShowSeasonsSettingsAsync()
    {
        var s = SeasonsSettings.Parse(Seasons.ToJson());   // a copy to work on
        var body = new StackPanel { Spacing = 10, MinWidth = 560 };
        TextBlock Label(string t) => new() { Text = t, Foreground = Tokens.Ink, FontSize = 15, VerticalAlignment = VerticalAlignment.Center };

        var mode = new ComboBox { MinWidth = 280 };
        foreach (var (id, name) in new[] { ("auto", "By the date"), ("one", "Always one"), ("rotate", "A rotation, " + SeasonsCalendar.RotateMinutes + " minutes each") }) mode.Items.Add(new ComboBoxItem { Content = name, Tag = id });
        mode.SelectedIndex = s.Mode == "one" ? 1 : s.Mode == "rotate" ? 2 : 0;
        var one = new ComboBox { MinWidth = 280 };
        foreach (var e in SeasonsCalendar.Entries) one.Items.Add(new ComboBoxItem { Content = e.Name, Tag = e.Id });
        one.SelectedIndex = Math.Max(0, SeasonsCalendar.Entries.ToList().FindIndex(e => e.Id == s.One));
        one.Visibility = s.Mode == "one" ? Visibility.Visible : Visibility.Collapsed;
        mode.SelectionChanged += (_, __) => one.Visibility = mode.SelectedIndex == 1 ? Visibility.Visible : Visibility.Collapsed;
        var top = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 }; top.Children.Add(Label("Show")); top.Children.Add(mode); top.Children.Add(one);
        body.Children.Add(top);

        var rows = new StackPanel { Spacing = 2 };
        var texts = new Dictionary<string, Button>();
        // where the person is: the half of the world, or a place from the list on the PC (2026-11-12, asked for a place to pick)
        var place = new ComboBox { MinWidth = 280, IsTextSearchEnabled = true };
        place.Items.Add(new ComboBoxItem { Content = "Northern half of the world", Tag = "" }); place.Items.Add(new ComboBoxItem { Content = "Southern half of the world", Tag = "" });
        foreach (var (pn, _, _) in SeasonsCalendar.Places) place.Items.Add(new ComboBoxItem { Content = pn, Tag = pn });
        var at = SeasonsCalendar.Places.ToList().FindIndex(x => x.Name == s.Place);
        place.SelectedIndex = at >= 0 ? at + 2 : s.South ? 1 : 0;
        ToolTipService.SetToolTip(place, "The seasons follow this place. The list is on this PC and nothing is looked up.");
        place.SelectionChanged += (_, __) =>
        {
            var i = place.SelectedIndex; if (i < 0) return;
            s.Place = i >= 2 ? SeasonsCalendar.Places[i - 2].Name : ""; s.South = i >= 2 ? SeasonsCalendar.Places[i - 2].Lat < 0 : i == 1;
            foreach (var e in SeasonsCalendar.Entries.Where(x => x.IsSeason)) texts[e.Id].Content = RangeText(s, e);
        };
        var where = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 }; where.Children.Add(Label("Seasons of")); where.Children.Add(place);
        body.Children.Add(where);

        string? group = null;
        foreach (var e in SeasonsCalendar.Entries)
        {
            if (e.Group != group)
            {
                group = e.Group;
                rows.Children.Add(new TextBlock { Text = (e.IsSeason ? "The seasons" : group == "Shared" ? "Kept across beliefs" : group).ToUpperInvariant(), Foreground = Tokens.Amber, FontSize = 12, CharacterSpacing = 80, Margin = new Thickness(0, 10, 0, 2) });
            }
            var entry = e;
            if (!s.Items.ContainsKey(entry.Id)) s.Items[entry.Id] = new SeasonItem();
            var item = s.Items[entry.Id];
            var row = new Grid { ColumnSpacing = 10 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(64) }); row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var sw = new ToggleSwitch { IsOn = item.On, OnContent = "", OffContent = "", MinWidth = 0 };
            sw.Toggled += (_, __) => item.On = sw.IsOn;
            ToolTipService.SetToolTip(sw, "Show " + entry.Name + " in the Seasons visual");
            var name = Label(entry.Name); Grid.SetColumn(name, 1);
            var dates = new Button { Content = RangeText(s, entry), Foreground = Tokens.Ink, MinWidth = 190, HorizontalContentAlignment = HorizontalAlignment.Left };
            ToolTipService.SetToolTip(dates, "Set dates of your own for " + entry.Name);
            texts[entry.Id] = dates; Grid.SetColumn(dates, 2);
            dates.Click += (_, __) =>
            {
                var now = DateOnly.FromDateTime(DateTime.Now);
                var cur = SeasonsCalendar.MonthDay(item.From) is { } f && SeasonsCalendar.MonthDay(item.To) is { } t ? (new DateOnly(2024, f.M, f.D), new DateOnly(2024, t.M, t.D))
                    : SeasonsCalendar.Upcoming(entry.Id, now) is { } o ? (o.From, o.To) : (now, now.AddDays(3));
                var from = new DatePicker { YearVisible = false, Header = "From", SelectedDate = new DateTimeOffset(new DateTime(2024, cur.Item1.Month, cur.Item1.Day)) };
                var to = new DatePicker { YearVisible = false, Header = "To", SelectedDate = new DateTimeOffset(new DateTime(2024, cur.Item2.Month, cur.Item2.Day)) };
                var use = new Button { Content = "Use these dates each year", Foreground = Tokens.Ink };
                var back = new Button { Content = "Use the calendar's dates", Foreground = Tokens.Ink };
                var panel = new StackPanel { Spacing = 10 }; panel.Children.Add(from); panel.Children.Add(to);
                var verbs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 }; verbs.Children.Add(use); verbs.Children.Add(back); panel.Children.Add(verbs);
                var fly = new Flyout { Content = panel };
                use.Click += (_, __) =>
                {
                    if (from.SelectedDate is { } a && to.SelectedDate is { } b) { item.From = SeasonsCalendar.MonthDay(DateOnly.FromDateTime(a.DateTime)); item.To = SeasonsCalendar.MonthDay(DateOnly.FromDateTime(b.DateTime)); }
                    dates.Content = RangeText(s, entry); fly.Hide();
                };
                back.Click += (_, __) => { item.From = item.To = null; dates.Content = RangeText(s, entry); fly.Hide(); };
                fly.ShowAt(dates);
            };
            row.Children.Add(sw); row.Children.Add(name); row.Children.Add(dates);
            rows.Children.Add(row);
        }
        body.Children.Add(new ScrollViewer { Content = rows, MaxHeight = 440, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(0, 0, 14, 0) });

        var dlg = new ContentDialog
        {
            Title = "Seasons",
            Content = body,
            PrimaryButtonText = "Save",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = RootGrid.XamlRoot,
            RequestedTheme = ElementTheme.Dark,
        };
        dlg.Resources["ContentDialogMaxWidth"] = 720.0;
        try { if (await dlg.ShowAsync() != ContentDialogResult.Primary) return; }
        catch (Exception ex) { SetStatus("dialog: " + ex.Message); return; }
        s.Mode = (mode.SelectedItem as ComboBoxItem)?.Tag as string ?? "auto";
        s.One = s.Mode == "one" ? (one.SelectedItem as ComboBoxItem)?.Tag as string ?? "" : "";
        var json = s.ToJson();
        HostPrefs.Set("viz.seasons", json);
        _seasons = SeasonsSettings.Parse(json);
        LogLine("seasons: settings saved, " + SeasonsPlanNow().Signature);
    }
}
