using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The news picker (dashboard-schema §31 "News defaults", normative): the
/// default shelf is DERIVED, not curated - core's <c>newsShelf()</c> is built
/// from a named public dataset under a stated criterion (v1: rated "generally
/// reliable" on Wikipedia's Perennial Sources, CC BY-SA). The attribution line
/// renders verbatim, every entry links to its rating rationale, and "Any URL"
/// is always present - the shelf is a starting point, never a wall. Nothing
/// is opened silently: a rationale link opens in the App-setup browsing
/// surface (the §30 sheet) by explicit tap.
/// </summary>
public sealed partial class MainWindow
{
    private sealed record NewsEntry(string Id, string Name, string Url, string Rating, string RatingUrl, string Summary, bool Stale, string? Aspect);

    private Grid? _newsPicker;
    private const string NewsAttributionLine = "sources rated generally reliable on Wikipedia's Perennial Sources";

    private async Task<(string Attribution, string DatasetUrl, string License, List<NewsEntry> Entries)> ReadNewsShelfAsync()
    {
        var entries = new List<NewsEntry>();
        var raw = await ModelCallAsync("newsShelf");
        string attribution = NewsAttributionLine, dataset = "", license = "";
        try
        {
            if (raw is not null && JsonNode.Parse(raw) is JsonObject r)
            {
                attribution = r["attributionLine"]?.GetValue<string>() ?? attribution;
                if (r["derivedFrom"] is JsonObject d) { dataset = d["url"]?.GetValue<string>() ?? ""; license = d["license"]?.GetValue<string>() ?? ""; }
                if (r["entries"] is JsonArray arr)
                    foreach (var n in arr)
                        if (n is JsonObject e)
                        {
                            var at = e["attribution"] as JsonObject;
                            entries.Add(new NewsEntry(e["id"]?.GetValue<string>() ?? "", e["name"]?.GetValue<string>() ?? "", e["url"]?.GetValue<string>() ?? "",
                                at?["rating"]?.GetValue<string>() ?? "", at?["ratingUrl"]?.GetValue<string>() ?? "", at?["summary"]?.GetValue<string>() ?? "", at?["stale"]?.GetValue<bool>() == true,
                                (e["catalog"] as JsonObject)?["aspectHint"]?.GetValue<string>()));
                        }
            }
        }
        catch (Exception ex) { SetStatus("news shelf unreadable: " + ex.Message); }
        return (attribution, dataset, license, entries);
    }

    /// <summary>Open the picker for a slot class. <paramref name="onPick"/> receives the chosen entry (the wizard resolves a role); null = standalone: an App + facet are created and the facet editor opens.</summary>
    private async void OpenNewsPicker(string? slotClass, Action<NewsEntry>? onPick)
    {
        CloseNewsPicker();
        var (attribution, datasetUrl, license, entries) = await ReadNewsShelfAsync();
        var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF6, 0x0F, 0x12, 0x16)) };
        Canvas.SetZIndex(overlay, 904);
        var panel = new Grid { Padding = new Thickness(26, 18, 26, 18) };
        panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        panel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        var head = new StackPanel { Spacing = 6, Margin = new Thickness(0, 0, 0, 12) };
        head.Children.Add(new TextBlock { Text = "News" + (slotClass is { } c ? "   ·   " + c : ""), FontSize = 22, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        // the attribution line, verbatim and first: the shelf is derived, the criterion is stated, the dataset is named
        var attr = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        attr.Children.Add(new TextBlock { Text = "Default shelf: " + NewsAttributionLine + ".", FontSize = 13, Foreground = Amber, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap });
        var about = Small("About this list", () => _ = ShowShelfAttributionAsync(attribution, datasetUrl, license));
        attr.Children.Add(about);
        head.Children.Add(attr);
        head.Children.Add(Meta("Entangled adds and removes nothing by hand. Each entry links to its rating rationale. The shelf is a starting point, never a wall: Any URL is always here."));
        var search = new TextBox { PlaceholderText = "Filter the shelf…", Width = 320, HorizontalAlignment = HorizontalAlignment.Left };
        head.Children.Add(search);
        panel.Children.Add(head);

        var list = CardGrid();
        var scroller = new ScrollViewer { Content = list, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        Grid.SetRow(scroller, 1);
        panel.Children.Add(scroller);

        void Fill(string filter)
        {
            list.Children.Clear();
            // Any URL is ALWAYS first, whatever the filter says
            var anyBody = new StackPanel { Spacing = 4 };
            anyBody.Children.Add(CardTitle("Any URL"));
            anyBody.Children.Add(Meta("Any site as a news facet. The optional credibility-badge adapter can label it later (off by default)."));
            list.Children.Add(Card(anyBody, 250, () => _ = PickAnyNewsUrlAsync(slotClass, onPick), null));
            foreach (var e in entries.Where(e => filter.Length == 0 || e.Name.Contains(filter, StringComparison.OrdinalIgnoreCase) || e.Url.Contains(filter, StringComparison.OrdinalIgnoreCase)))
            {
                var entry = e;
                var body = new StackPanel { Spacing = 4 };
                body.Children.Add(CardTitle(e.Name));
                body.Children.Add(Meta(Shorten(e.Url.Replace("https://", ""), 34)));
                var rationale = new HyperlinkButton { Content = e.Rating + (e.Stale ? "  ·  older review" : "") + "  ·  why?", FontSize = 11, Padding = new Thickness(0) };
                ToolTipService.SetToolTip(rationale, e.Summary.Length > 0 ? e.Summary : "Opens the rating rationale on the dataset's page");
                rationale.Click += (_, __) => _ = ShowRationaleAsync(entry);
                body.Children.Add(rationale);
                list.Children.Add(Card(body, 250, () => { CloseNewsPicker(); if (onPick is not null) onPick(entry); else _ = NewsFacetStandaloneAsync(entry, slotClass); }, null));
            }
        }
        Fill("");
        search.TextChanged += (_, __) => Fill(search.Text.Trim());
        var close = Small("Back  (Esc)", RouteBack);
        close.HorizontalAlignment = HorizontalAlignment.Right; close.VerticalAlignment = VerticalAlignment.Top; close.Margin = new Thickness(0, 18, 26, 0);
        overlay.Children.Add(panel);
        overlay.Children.Add(close);
        RootGrid.Children.Add(overlay);
        _newsPicker = overlay;
    }

    private void CloseNewsPicker()
    {
        if (_newsPicker is null) return;
        RootGrid.Children.Remove(_newsPicker);
        _newsPicker = null;
    }

    /// <summary>The rationale: the dataset's own words, then an explicit choice to open the rating page - never silently.</summary>
    private async Task ShowRationaleAsync(NewsEntry e)
    {
        var body = new StackPanel { Spacing = 8, MaxWidth = 520 };
        body.Children.Add(new TextBlock { Text = e.Rating, FontSize = 14, Foreground = Amber });
        body.Children.Add(new TextBlock { Text = e.Summary.Length > 0 ? e.Summary : "(no summary in the snapshot)", FontSize = 13, Foreground = LeInk, TextWrapping = TextWrapping.Wrap });
        body.Children.Add(new TextBlock { Text = e.RatingUrl, FontSize = 11, Foreground = LeDim, TextWrapping = TextWrapping.Wrap });
        body.Children.Add(Meta("Wikipedia: Reliable sources/Perennial sources, CC BY-SA 4.0. Opening the page shows it in Prism's browsing surface (the §30 sheet), not a hidden window."));
        var dlg = new ContentDialog { Title = "About " + e.Name + "'s rating", Content = body, PrimaryButtonText = "Open the rating page", CloseButtonText = "Close", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        try
        {
            if (await dlg.ShowAsync() == ContentDialogResult.Primary && IsHttpUrl(e.RatingUrl)) await OpenReferencePageAsync(e.RatingUrl);
        }
        catch (Exception ex) { SetStatus("dialog: " + ex.Message); }
    }

    private async Task ShowShelfAttributionAsync(string attribution, string datasetUrl, string license)
    {
        var body = new StackPanel { Spacing = 8, MaxWidth = 560 };
        body.Children.Add(new TextBlock { Text = attribution, FontSize = 13, Foreground = LeInk, TextWrapping = TextWrapping.Wrap });
        body.Children.Add(Meta("Criterion, dataset and license are repo data (packages/core/data); the shelf is regenerated from the snapshot and checked for equality in CI - no hand edits can survive."));
        body.Children.Add(new TextBlock { Text = datasetUrl + (license.Length > 0 ? "   ·   " + license : ""), FontSize = 11, Foreground = LeDim, TextWrapping = TextWrapping.Wrap });
        var dlg = new ContentDialog { Title = "About the default shelf", Content = body, PrimaryButtonText = "Open the dataset page", CloseButtonText = "Close", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        try { if (await dlg.ShowAsync() == ContentDialogResult.Primary && IsHttpUrl(datasetUrl)) await OpenReferencePageAsync(datasetUrl); }
        catch (Exception ex) { SetStatus("dialog: " + ex.Message); }
    }

    /// <summary>
    /// A reference page (the rating rationale, the dataset) opens in Prism's own
    /// browsing surface - App setup mode of a "Wikipedia" App (its own profile,
    /// created on first use) at that url - never a hidden window, never the
    /// system browser. The setup route carries the page as ?url=.
    /// </summary>
    private async Task OpenReferencePageAsync(string url)
    {
        const string refApp = "wikipedia";
        if (_model.App(refApp) is null)
        {
            var app = new JsonObject { ["id"] = refApp, ["name"] = "Wikipedia", ["baseUrl"] = "https://en.wikipedia.org/", ["profileId"] = refApp, ["setup"] = new JsonObject { ["status"] = "unknown" }, ["render"] = new JsonObject { ["audio"] = "mute" } };
            await ModelCallAsync("modelSaveApp", app);
            await ReadModelAsync();
        }
        OpenRoute("prism://app/" + refApp + "/setup?url=" + Uri.EscapeDataString(url) + "&return=scene");
    }

    private async Task PickAnyNewsUrlAsync(string? slotClass, Action<NewsEntry>? onPick)
    {
        var url = await PromptUrlAsync("Any URL as a news facet", "https://", "Add");
        if (url is null) return;
        CloseNewsPicker();
        var host = new Uri(url).Host.Replace("www.", "");
        var id = new string(host.Select(c => char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : '-').ToArray()).Trim('-');
        var name = host.Split('.').FirstOrDefault() is { Length: > 0 } first ? char.ToUpperInvariant(first[0]) + first[1..] : host;
        var entry = new NewsEntry(id, name, url, "unrated - added by you", "", "", false, "16:9");
        if (onPick is not null) onPick(entry);
        else await NewsFacetStandaloneAsync(entry, slotClass);
    }

    /// <summary>Standalone pick (from the rail): the entry becomes an App (its own profile) and a facet for the class, then the facet editor opens to adjust the region.</summary>
    private async Task NewsFacetStandaloneAsync(NewsEntry entry, string? slotClass)
    {
        var cls = slotClass ?? "8:1-ticker·M";
        if (_model.App(entry.Id) is null)
        {
            var app = new JsonObject { ["id"] = entry.Id, ["name"] = entry.Name, ["baseUrl"] = entry.Url, ["profileId"] = entry.Id, ["setup"] = new JsonObject { ["status"] = "unknown" }, ["render"] = new JsonObject { ["audio"] = "mute" } };
            await ModelCallAsync("modelSaveApp", app);
            await ReadModelAsync();
        }
        var fid = entry.Id + "-headlines-" + cls.Replace(":", "x").Replace("·", "-").Replace("-ticker", "").Replace("-strip", "");
        for (var n = 2; _model.Facet(fid) is not null; n++) fid = entry.Id + "-headlines-" + n;
        var facet = new JsonObject { ["id"] = fid, ["app"] = entry.Id, ["url"] = entry.Url, ["slotClass"] = cls, ["label"] = "Headlines", ["audio"] = "mute", ["touch"] = "scroll" };
        await ModelCallAsync("modelSaveFacet", facet);
        await ReadModelAsync();
        RouteDone();
        OpenRoute("prism://facet/" + Uri.EscapeDataString(fid) + "/edit");
    }
}
