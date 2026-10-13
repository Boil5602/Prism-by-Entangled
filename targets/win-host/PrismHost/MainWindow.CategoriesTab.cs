using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// Watch settings, Categories (2026-10-11, "Can we let people create categories using hashtags and choose from a series of transparent
/// algorithms like recent" - "Algorithm for selection has to be clear" - "Yes clear rules only"): the person's own rows on Watch. A
/// category is a name, some hashtags and one rule from a short list, each rule said in full (what is counted, who is counted, who
/// decides, the source), as every row's is. The hashtags offered are the words that recur across what the household's services already
/// list in Prism, counted here, nobody's trend feed ("Can we list popular recent hashtags somehow. Need a source"). Core keeps the
/// categories and fills the rows (core categories.ts).
///
/// Two cards (2026-10-13, "It all kind of runs together" / "Top 2 items (categories and new category) can be a dropdown list. With a new
/// category option. Is it possible to have a hashtag search with autocomplete? What about with item counts by hash tag?"): a picker of
/// the categories you have, with New category as its last choice, and what the pick shows under it (a category's own words and Remove,
/// or the form); then the tags to pick from, grouped, each with its count. The form's Tags field completes a word as it is typed, from the
/// same tags with the same counts.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>The chips' window: 0 for everything in the rows, 30 for titles their service dates within the last 30 days.</summary>
    private int _catDays;
    /// <summary>The picker's choice, kept across the tab's redraws: a category's id, or "new".</summary>
    private string _catPick = "";

    private Func<Task<List<string>>> BuildCategoriesTab(StackPanel body)
    {
        _ = FillCategoriesTabAsync(body);
        return () => Task.FromResult(new List<string>());   // every change here is kept at once
    }

    /// <summary>A section of the tab: a heading, a line under it, and its content on one card, a step lighter than the dialog behind it.</summary>
    private static (Border card, StackPanel content) CatSection(StackPanel body, string heading, string? line)
    {
        var content = new StackPanel { Spacing = 10 };
        var head = new StackPanel { Spacing = 2, Margin = new Thickness(0, 0, 0, 4) };
        head.Children.Add(new TextBlock { Text = heading, FontSize = 18, Foreground = HubInk });
        if (line is { Length: > 0 }) head.Children.Add(new TextBlock { Text = line, FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxWidth = 820 });
        content.Children.Add(head);
        var card = new Border { Child = content, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x2A, 0x30, 0x3A)), CornerRadius = new CornerRadius(10), Padding = new Thickness(16, 12, 16, 14), Margin = new Thickness(0, 0, 0, 16), MaxWidth = 900, HorizontalAlignment = HorizontalAlignment.Left };
        body.Children.Add(card);
        return (card, content);
    }

    /// <summary>A field's label over its control.</summary>
    private static StackPanel CatField(string label, FrameworkElement control)
    {
        var col = new StackPanel { Spacing = 4 };
        col.Children.Add(new TextBlock { Text = label, FontSize = 14, Foreground = HubInk });
        col.Children.Add(control);
        return col;
    }

    /// <summary>A tag on offer: its word (with its # where a creator wrote it), its count in the rows (null where there is none), and where it is from.</summary>
    private sealed record CatTag(string Word, double? Count, string From);

    private async Task FillCategoriesTabAsync(StackPanel body)
    {
        JsonObject? v = null;
        try { v = JsonNode.Parse(await ModelCallAsync("videoCategories", _catDays > 0 ? _catDays.ToString() : "") ?? "null") as JsonObject; } catch (Exception e) { LogLine("categories: " + e.Message); }
        var rules = (v?["rules"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var cats = (v?["categories"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var suggestions = (v?["suggestions"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var creator = (v?["creator"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new List<JsonObject>();
        var readAt = v?["readAt"] is JsonValue rav && rav.TryGetValue<double>(out var rad) && rad > 0 ? DateTimeOffset.FromUnixTimeMilliseconds((long)rad).ToLocalTime().ToString("HH:mm") : "";
        var poolRows = (v?["poolServices"] as JsonArray)?.OfType<JsonObject>().Select(p => S(p, "row")).Where(r => r.Length > 0).ToList() ?? new List<string>();
        string RuleName(string id) => rules.FirstOrDefault(r => S(r, "id") == id) is { } r ? S(r, "name") : id;
        string RuleWords(JsonObject r) => "What is counted: " + S(r, "counted") + "\nWho is counted: " + S(r, "who") + "\nWho decides: " + S(r, "decides") + "\nSource: " + S(r, "source");
        string CatName(JsonObject c) => S(c, "name") is { Length: > 0 } nm ? nm : string.Join(" ", (c["tags"] as JsonArray)?.Select(t => t?.GetValue<string>() ?? "") ?? Array.Empty<string>());

        // every tag on offer, for the field's completion and the chips: a creator's tags with their #, the words of names bare, the topics with #
        var offer = new List<CatTag>();
        foreach (var t in creator) offer.Add(new CatTag("#" + S(t, "tag"), t["n"]?.GetValue<double>(), "creators' tags"));
        foreach (var t in suggestions) offer.Add(new CatTag(S(t, "tag"), t["n"]?.GetValue<double>(), "words in names"));

        // ---- 1. the picker: the categories you have, and New category
        var (_, top) = CatSection(body, "Categories", null);
        var pick = new ComboBox { FontSize = 16, MinWidth = 360 };
        foreach (var c in cats) pick.Items.Add(new ComboBoxItem { Content = CatName(c), Tag = S(c, "id") });
        pick.Items.Add(new ComboBoxItem { Content = "New category\u2026", Tag = "new" });
        var want = cats.Any(c => S(c, "id") == _catPick) ? _catPick : cats.Count > 0 && _catPick != "new" ? S(cats[0], "id") : "new";
        pick.SelectedIndex = Math.Max(0, pick.Items.Cast<ComboBoxItem>().ToList().FindIndex(i => (string)i.Tag == want));
        top.Children.Add(CatField("Category", pick));
        var detail = new StackPanel { Spacing = 10, Margin = new Thickness(0, 4, 0, 0) };
        top.Children.Add(detail);

        // the form, built once; shown under New category
        var nameBox = new TextBox { PlaceholderText = "Star Trek", Width = 260, FontSize = 16 };
        var tagsBox = new AutoSuggestBox { PlaceholderText = "#startrek  trek", Width = 440, FontSize = 16, QueryIcon = null };
        // the word being typed completed from the tags on offer, its count beside each (2026-10-13, "a hashtag search with autocomplete ... with item
        // counts by hash tag"): the words before it stand, the chosen one takes the place of the one typed
        tagsBox.TextChanged += (box, args) =>
        {
            if (args.Reason != AutoSuggestionBoxTextChangeReason.UserInput) return;
            var text = box.Text ?? "";
            var cut = text.LastIndexOf(' ');
            var typed = (cut >= 0 ? text.Substring(cut + 1) : text).TrimStart('#').ToLowerInvariant();
            if (typed.Length == 0) { box.ItemsSource = null; return; }
            var hits = offer.Where(o => o.Word.TrimStart('#').ToLowerInvariant().StartsWith(typed)).OrderByDescending(o => o.Count ?? 0).ThenBy(o => o.Word).Take(12)
                .Select(o => o.Word + (o.Count is { } n ? "   " + n : "") + "   \u00B7 " + o.From).ToList();
            box.ItemsSource = hits.Count > 0 ? hits : null;
        };
        tagsBox.SuggestionChosen += (box, args) =>
        {
            var chosen = (args.SelectedItem as string ?? "").Split(' ')[0];
            var text = box.Text ?? "";
            var cut = text.LastIndexOf(' ');
            box.Text = (cut >= 0 ? text.Substring(0, cut + 1) : "") + chosen + " ";
        };
        var ruleBox = new ComboBox { FontSize = 16, MinWidth = 320 };
        foreach (var r in rules)
        {
            var item = new ComboBoxItem { Content = S(r, "name"), Tag = S(r, "id") };
            ToolTipService.SetToolTip(item, RuleWords(r));
            ruleBox.Items.Add(item);
        }
        if (ruleBox.Items.Count > 0) ruleBox.SelectedIndex = 0;
        var ruleSaid = new TextBlock { FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxWidth = 780 };
        void SayRule() { ruleSaid.Text = ruleBox.SelectedItem is ComboBoxItem { Tag: string rid } && rules.FirstOrDefault(r => S(r, "id") == rid) is { } r ? RuleWords(r) : ""; }
        ruleBox.SelectionChanged += (_, __) => SayRule();
        SayRule();
        var poolBox = new CheckBox { Content = new TextBlock { Text = poolRows.Count > 0 ? "Also from the open pool: " + string.Join(", ", poolRows) : "The open pool needs YouTube or Twitch on this PC", FontSize = 15, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxWidth = 760 }, IsEnabled = poolRows.Count > 0 };
        ToolTipService.SetToolTip(poolBox, "Everything those services list for the tags, not only what you follow.");
        var add = Chip(new TextBlock { Text = "Add this category", FontSize = 16, Foreground = HubAmber }, true);
        var note = new TextBlock { FontSize = 15, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Center };
        add.Click += async (_, __) =>
        {
            var tags = (tagsBox.Text ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(t => t.Trim()).Where(t => t.Length > 0).ToList();
            if (tags.Count == 0) { note.Text = "Give it at least one #tag or word."; return; }
            var id = "c" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString("x");
            var cat = new JsonObject { ["id"] = id, ["name"] = nameBox.Text.Trim(), ["v"] = 2, ["tags"] = new JsonArray(tags.Select(t => (JsonNode)t).ToArray()), ["rule"] = ruleBox.SelectedItem is ComboBoxItem { Tag: string rid } ? rid : "newest", ["pool"] = poolBox.IsChecked == true };
            var r = JsonNode.Parse(await ModelCallAsync("videoCategorySet", cat.ToJsonString()) ?? "null") as JsonObject;
            if (r?["ok"]?.GetValue<bool>() != true) { note.Text = S(r ?? new JsonObject(), "error") is { Length: > 0 } err ? err : "That could not be kept."; return; }
            LogLine("categories: added " + id + " (" + tags.Count + " hashtags)");
            _catPick = id;
            if (VideoHubOpen) _ = ShowVideoHubAsync();
            await ShowWatchSettingsAsync("categories");
        };
        StackPanel Form()
        {
            var form = new StackPanel { Spacing = 10 };
            var fields = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
            fields.Children.Add(CatField("Name (optional)", nameBox));
            var tagsField = CatField("Tags", tagsBox);
            ToolTipService.SetToolTip(tagsField, "#tags creators wrote, plain words for names, spaces between. Type to search them.");
            fields.Children.Add(tagsField);
            form.Children.Add(fields);
            var ruleCol = new StackPanel { Spacing = 6 };
            ruleCol.Children.Add(ruleBox);
            // the rule said in full stays a press away, not on the page (2026-10-13)
            ruleCol.Children.Add(new Expander { Header = new TextBlock { Text = "What this rule counts", FontSize = 14, Foreground = HubInk }, Content = ruleSaid, IsExpanded = false, HorizontalAlignment = HorizontalAlignment.Left });
            form.Children.Add(CatField("Order", ruleCol));
            form.Children.Add(poolBox);
            var line3 = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Margin = new Thickness(0, 4, 0, 0) };
            line3.Children.Add(add); line3.Children.Add(note);
            form.Children.Add(line3);
            return form;
        }
        StackPanel Shown(JsonObject c)
        {
            var tags = (c["tags"] as JsonArray)?.Select(t => t?.GetValue<string>() ?? "").ToList() ?? new List<string>();
            var col = new StackPanel { Spacing = 8 };
            col.Children.Add(CatField("Tags", new TextBlock { Text = string.Join("  ", tags), FontSize = 16, Foreground = HubInk, TextWrapping = TextWrapping.Wrap }));
            var ruleLine = new TextBlock { Text = RuleName(S(c, "rule")), FontSize = 16, Foreground = HubInk };
            var ruleCol = new StackPanel { Spacing = 4 };
            ruleCol.Children.Add(ruleLine);
            if (rules.FirstOrDefault(r => S(r, "id") == S(c, "rule")) is { } rr) ruleCol.Children.Add(new Expander { Header = new TextBlock { Text = "What this rule counts", FontSize = 14, Foreground = HubInk }, Content = new TextBlock { Text = RuleWords(rr), FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, MaxWidth = 780 }, IsExpanded = false, HorizontalAlignment = HorizontalAlignment.Left });
            col.Children.Add(CatField("Order", ruleCol));
            col.Children.Add(CatField("Open pool", new TextBlock { Text = c["pool"]?.GetValue<bool>() == true ? "On: " + (poolRows.Count > 0 ? string.Join(", ", poolRows) : "the services' own pages") : "Off", FontSize = 16, Foreground = HubInk, TextWrapping = TextWrapping.Wrap }));
            var del = Chip(new TextBlock { Text = "Remove this category", FontSize = 15, Foreground = HubInk }, false);
            var cid = S(c, "id");
            del.Click += async (_, __) => { await ModelCallAsync("videoCategoryDelete", cid); _catPick = ""; if (VideoHubOpen) _ = ShowVideoHubAsync(); await ShowWatchSettingsAsync("categories"); };
            del.Margin = new Thickness(0, 4, 0, 0);
            col.Children.Add(del);
            return col;
        }
        void ShowPick()
        {
            detail.Children.Clear();
            var tag = (pick.SelectedItem as ComboBoxItem)?.Tag as string ?? "new";
            _catPick = tag;
            if (tag == "new" || cats.FirstOrDefault(c => S(c, "id") == tag) is not { } c) detail.Children.Add(Form());
            else detail.Children.Add(Shown(c));
        }
        pick.SelectionChanged += (_, __) => ShowPick();
        ShowPick();

        // ---- 2. the tags to pick from, each group under its own heading with its counts; a press puts one in the Tags field
        var (_, picks) = CatSection(body, "Tags to pick from", null);
        var daysRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        var daysBox = new CheckBox { Content = new TextBlock { Text = "Last 30 days only", FontSize = 15, Foreground = HubInk }, IsChecked = _catDays > 0 };
        ToolTipService.SetToolTip(daysBox, "Only titles their service dates within the last 30 days.");
        daysBox.Checked += (_, __) => { _catDays = 30; _ = ShowWatchSettingsAsync("categories"); };
        daysBox.Unchecked += (_, __) => { _catDays = 0; _ = ShowWatchSettingsAsync("categories"); };
        daysRow.Children.Add(daysBox);
        daysRow.Children.Add(new TextBlock { Text = (readAt.Length > 0 ? "From your rows as read at " + readAt : "From your rows") + (v?["counted"] is JsonValue cv && cv.TryGetValue<double>(out var cn) ? ", " + cn + " titles" : ""), FontSize = 14, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center });
        picks.Children.Add(daysRow);
        void PutWord(string word)
        {
            // into the form (the picker goes to New category when it is not there), the word once
            if (_catPick != "new") { pick.SelectedIndex = pick.Items.Count - 1; }
            var t = (tagsBox.Text ?? "").Trim();
            if (!t.Split(' ').Any(x => x.TrimStart('#').Equals(word.TrimStart('#'), StringComparison.OrdinalIgnoreCase))) tagsBox.Text = (t.Length > 0 ? t + " " : "") + word;
        }
        void Group(string heading, string line, Action<StackPanel> fill)
        {
            var g = new StackPanel { Spacing = 6, Margin = new Thickness(0, 6, 0, 0) };
            var h = new TextBlock { Text = heading, FontSize = 15, Foreground = HubInk };
            ToolTipService.SetToolTip(h, line);
            g.Children.Add(h);
            fill(g);
            picks.Children.Add(g);
        }
        void ChipRows(StackPanel into, List<JsonObject> list, bool hash)
        {
            // rows break by width, not by count: a creator's tag can be a sentence (#bestspiderfarmminecraftbedrock)
            var wrap0 = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 }; var wraps0 = new StackPanel { Spacing = 6 }; var width0 = 0.0;
            foreach (var sgg in list.Take(30))
            {
                var tag = S(sgg, "tag");
                var w = 34 + 7.2 * (tag.Length + 4);
                if (width0 + w > 840 && wrap0.Children.Count > 0) { wraps0.Children.Add(wrap0); wrap0 = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 }; width0 = 0; }
                width0 += w + 6;
                var word = hash ? "#" + tag : tag;   // a word of names: no # (2026-10-12)
                var chip = Chip(new TextBlock { Text = word + "  " + (sgg["n"]?.GetValue<double>() ?? 0), FontSize = 14, Foreground = HubInk }, false);
                chip.Click += (_, __) => PutWord(word);
                wrap0.Children.Add(chip);
            }
            if (wrap0.Children.Count > 0) wraps0.Children.Add(wrap0);
            into.Children.Add(wraps0);
        }
        if (creator.Count > 0) Group("Tags the creators wrote", "A stream's tags and category on Twitch, a video's keywords on YouTube, on titles in your rows. Most first.", g => ChipRows(g, creator, true));
        if (suggestions.Count > 0) Group("Words in your rows' names", "Words that recur across what your services list here. Most first.", g => ChipRows(g, suggestions, false));
        var topicsPanel = new StackPanel { Spacing = 6 };
        picks.Children.Add(topicsPanel);

        // the topics the world read yesterday (Wikipedia's public count), as chips: the anti-echo-chamber source, nothing about this household in it
        JsonObject? tp = null;
        // the first read of a day waits its turn behind the other open reads (paced, one at a time); after that it is on disk
        try { tp = JsonNode.Parse(await ModelCallAwaitAsync("videoCategoryTopics", 90000) ?? "null") as JsonObject; } catch (Exception e) { LogLine("categories: topics: " + e.Message); }
        var topics = (tp?["topics"] as JsonArray)?.Select(t => t?.GetValue<string>() ?? "").Where(t => t.Length > 0).ToList() ?? new List<string>();
        if (topics.Count == 0) return;
        topicsPanel.Margin = new Thickness(0, 6, 0, 0);
        var th = new TextBlock { Text = "Topics the world was reading", FontSize = 15, Foreground = HubInk };
        ToolTipService.SetToolTip(th, "Most read first: " + S(tp!, "source") + ". No count: these are not from your rows. A press adds the topic as a word.");
        topicsPanel.Children.Add(th);
        var trow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 }; var tn = 0;
        foreach (var topic in topics.Take(24))
        {
            var tag = new string(topic.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
            if (tag.Length < 2) continue;
            offer.Add(new CatTag("#" + tag, null, "topics"));
            var chip = Chip(new TextBlock { Text = topic, FontSize = 14, Foreground = HubInk }, false);
            ToolTipService.SetToolTip(chip, "#" + tag);
            chip.Click += (_, __) => PutWord("#" + tag);
            trow.Children.Add(chip);
            if (++tn % 6 == 0) { topicsPanel.Children.Add(trow); trow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 }; }
        }
        if (trow.Children.Count > 0) topicsPanel.Children.Add(trow);
    }
}
