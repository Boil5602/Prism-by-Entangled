using System.Globalization;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// The app list behind "Configure an app" (spec 33.6), floating visibility (spec 32.7)
/// and the small shared controls. The layout editor itself lives in
/// MainWindow.LayoutEditor.cs (scene-model spec 3) since SM-2.
/// The shell draws and forwards; every decision (the solve, the persistence,
/// what applying means) is core's.
/// </summary>
public sealed partial class MainWindow
{
    private static readonly SolidColorBrush LeInk = new(Windows.UI.Color.FromArgb(255, 0xEC, 0xEC, 0xF0));
    private static readonly SolidColorBrush LeDim = new(Windows.UI.Color.FromArgb(255, 0x9A, 0x9C, 0xA8));
    private static readonly SolidColorBrush LeTeal = new(Windows.UI.Color.FromArgb(255, 0x5C, 0xC8, 0xC0));
    private static readonly SolidColorBrush LePanel = new(Windows.UI.Color.FromArgb(255, 0x14, 0x15, 0x1C));
    private static readonly SolidColorBrush LeSlot = new(Windows.UI.Color.FromArgb(255, 0x1E, 0x20, 0x2A));
    private static readonly SolidColorBrush LeSlotSel = new(Windows.UI.Color.FromArgb(255, 0x2E, 0x2A, 0x1E));

    // ------------------------------------------------ Configure an app: the app list (§33.6)
    private Grid? _appList;

    /// <param name="mode">"app" = screen 1 (sign in, navigate); "views" = screen 3 (region, shape, zoom per slot shape).</param>
    private async Task ShowAppListAsync(string mode = "app")
    {
        CloseAppList();
        var wall = await ReadWallStateAsync();
        var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xEE, 0x0F, 0x12, 0x16)) };
        Canvas.SetZIndex(overlay, 900);
        overlay.PointerPressed += (_, e) => { if (ReferenceEquals(e.OriginalSource, overlay)) { CloseAppList(); e.Handled = true; } };
        var panel = new StackPanel
        {
            Width = 560,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Spacing = 10,
            Padding = new Thickness(22),
            Background = LePanel,
            CornerRadius = new CornerRadius(12),
            BorderBrush = Amber,
            BorderThickness = new Thickness(1),
        };
        panel.Children.Add(new TextBlock { Text = mode == "views" ? "Configure app facets" : "Configure an app", FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        panel.Children.Add(new TextBlock
        {
            Text = mode == "views"
                ? "Pick the app whose facets you want to make - a facet is a page + region cut for one slot class (the classes come from your saved layouts). An app that is not on the wall yet is added first. Esc closes."
                : "Pick the app to sign in to, navigate and explore - every catalog app and everything on the wall, not only the slots that happen to be laid out. An app that is not on the wall yet is added first. Esc closes.",
            FontSize = 12, Foreground = LeDim, TextWrapping = TextWrapping.Wrap,
        });
        var list = new StackPanel { Spacing = 4 };
        var onWall = wall.Tiles.Where(t => !t.Placeholder).ToList();
        foreach (var entry in _catalog)
        {
            var slots = onWall.Where(t => t.Id == entry.Id || t.Id.StartsWith(entry.Id + "-", StringComparison.Ordinal) || (entry.Adapter.Length > 0 && t.App == entry.Adapter)).Select(t => t.Id).ToList();
            var status = slots.Count == 0 ? "not on the wall - it will be added first" : slots.Count == 1 ? "on the wall as " + slots[0] : slots.Count + " slots on the wall - the first is configured";
            var e = entry; var f = slots;
            list.Children.Add(AppRow(entry.Name, status, () => { CloseAppList(); _ = ConfigureAppAsync(e, f, mode); }));
        }
        foreach (var t in onWall.Where(t => !_catalog.Any(c => t.Id == c.Id || t.Id.StartsWith(c.Id + "-", StringComparison.Ordinal) || (c.Adapter.Length > 0 && t.App == c.Adapter))))
        {
            var id = t.Id;
            list.Children.Add(AppRow(t.Name, "custom site on the wall as " + id + (t.Url is { } u ? "  ·  " + u : ""), () => { CloseAppList(); BeginViewfinder(id, mode); }));
        }
        list.Children.Add(AppRow("Custom website…", "any URL - added to the wall, then configured", () => { CloseAppList(); _ = ConfigureCustomSiteAsync(mode); }));
        panel.Children.Add(new ScrollViewer { Content = list, MaxHeight = 540, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        overlay.Children.Add(panel);
        RootGrid.Children.Add(overlay);
        _appList = overlay;
    }

    private static Button AppRow(string name, string status, Action click)
    {
        var col = new StackPanel { Spacing = 1 };
        col.Children.Add(new TextBlock { Text = name, FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        col.Children.Add(new TextBlock { Text = status, FontSize = 11, Foreground = LeDim, TextTrimming = TextTrimming.CharacterEllipsis });
        var b = new Button { Content = col, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 8, 12, 8), CornerRadius = new CornerRadius(8) };
        b.Click += (_, __) => click();
        return b;
    }

    /// <summary>§34.1 Save & close: the page showing now (or the address typed) becomes the app's home page -
    /// app-level in core's registry and this slot's page - then back to the wall. No reload when it is already showing.</summary>
    private async Task SaveAppHomeAndCloseAsync(string id)
    {
        var source = _surfaces.SourceOf(id) ?? "";
        var typed = _vfAddressEdited ? _vfAddressBox?.Text.Trim() ?? "" : "";   // the box outranks the page only when the human edited it
        string target;
        if (typed.Length > 0 && typed != source)
        {
            if (!IsHttpUrl(typed)) { SetPill("Prism · http(s) addresses only"); return; }
            target = new Uri(typed).ToString();
        }
        else target = source;
        SetStatus($"save home {id}: source={source} typed={(typed.Length > 0 ? typed : "(unedited)")} → {target}");
        if (!IsHttpUrl(target)) { SetPill("Prism · nothing to save yet. The slot has no page"); return; }
        var reload = target != source;
        _brain.Call(HostCalls.UpdateTile, id, JsonSerializer.Serialize(new { url = target, home = true, reload }));
        await Task.Delay(120);
        CancelViewfinder();
        SetPill("Prism · " + id + " home page saved: " + Shorten(target, 60));
    }

    private void CloseAppList()
    {
        if (_appList is null) return;
        RootGrid.Children.Remove(_appList);
        _appList = null;
    }

    private async Task ConfigureAppAsync(HostCatalogEntry entry, List<string> slots, string mode = "app")
    {
        if (slots.Count > 0) { BeginViewfinder(slots[0], mode); return; }
        var tileId = NewTileId(entry.Id);
        _brain.Call(HostCalls.AddCatalogTile, entry.Json, JsonSerializer.Serialize(new { tileId }), SelectorTableJson(entry.Adapter));
        SetPill("Prism · adding " + entry.Name + ". Its configure screen opens when the page is up");
        if (await WaitForSurfaceAsync(tileId, 25000)) BeginViewfinder(tileId, mode);
        else SetPill("Prism · " + entry.Name + " added; open Configure an app again once it is up");
    }

    private async Task ConfigureCustomSiteAsync(string mode = "app")
    {
        var url = await PromptTextAsync("Custom website", "https://", "https://example.com", "Add and configure");
        if (string.IsNullOrWhiteSpace(url)) return;
        Uri? parsed;
        try { parsed = new Uri(url.Trim()); } catch { SetPill("Prism · that is not a web address"); return; }
        var tileId = NewTileId(HostSlug(parsed.Host));
        _brain.Call(HostCalls.AddCustomTile, parsed.ToString(), JsonSerializer.Serialize(new { tileId }));
        SetPill("Prism · adding " + parsed.Host + ". Its configure screen opens when the page is up");
        if (await WaitForSurfaceAsync(tileId, 25000)) BeginViewfinder(tileId, mode);
        else SetPill("Prism · " + parsed.Host + " added; open Configure an app again once it is up");
    }

    /// <summary>core's catalog hostSlug: "news.ycombinator.com" → "news-ycombinator" (www. dropped, TLD dropped).</summary>
    private static string HostSlug(string host)
    {
        var h = host.ToLowerInvariant();
        if (h.StartsWith("www.", StringComparison.Ordinal)) h = h[4..];
        var parts = h.Split('.', StringSplitOptions.RemoveEmptyEntries).ToList();
        if (parts.Count > 1) parts.RemoveAt(parts.Count - 1);
        var slug = string.Join('-', parts);
        return slug.Length > 0 ? slug : "site";
    }

    private string NewTileId(string baseId)
    {
        var taken = new HashSet<string>();
        try
        {
            var docJson = _store.Get("dashboard");
            if (docJson is not null)
            {
                using var doc = JsonDocument.Parse(docJson);
                foreach (var t in doc.RootElement.GetProperty("tiles").EnumerateArray())
                    if (t.TryGetProperty("id", out var idEl) && idEl.GetString() is { } tid) taken.Add(tid);
            }
        }
        catch { }
        var id = baseId;
        for (var n = 2; taken.Contains(id); n++) id = baseId + "-" + n;
        return id;
    }

    private async Task<bool> WaitForSurfaceAsync(string tileId, int timeoutMs)
    {
        var t0 = Environment.TickCount64;
        while (Environment.TickCount64 - t0 < timeoutMs)
        {
            if (_surfaces.LiveTileIds().Contains(tileId) && _surfaces.RectOf(tileId) is { W: >= 40, H: >= 40 })
            {
                await Task.Delay(1500);   // let the first paint land before the viewfinder pops it out
                return true;
            }
            await Task.Delay(250);
        }
        return false;
    }

    // ------------------------------------------------ §32.7 floating facets: show / hide
    private MenuFlyoutSubItem BuildFloatingMenu(WallState wall)
    {
        var floats = wall.Tiles.Where(t => t.Kind == "floating").ToList();
        var hiddenCount = floats.Count(t => t.Hidden);
        var sub = new MenuFlyoutSubItem { Text = "Floating facets" + (hiddenCount > 0 ? $"  ({hiddenCount} hidden)" : ""), Icon = Glyph("") };
        if (floats.Count == 0)
            sub.Items.Add(new MenuFlyoutItem { Text = "None. Right-click a slot → Float this slot, or add a music player from the catalog", IsEnabled = false });
        foreach (var t in floats)
        {
            var id = t.Id; var hidden = t.Hidden;
            sub.Items.Add(Item((hidden ? "Show  " : "Hide  ") + t.Name + (t.Placeholder ? "  (empty)" : ""), hidden ? "" : "", null,
                () => _brain.Call(HostCalls.UpdateTile, id, hidden ? "{\"float\":{\"hidden\":false}}" : "{\"float\":{\"hidden\":true}}")));
        }
        if (hiddenCount > 1)
        {
            sub.Items.Add(new MenuFlyoutSeparator());
            sub.Items.Add(Item("Show all", null, null, () => { foreach (var t in floats.Where(x => x.Hidden)) _brain.Call(HostCalls.UpdateTile, t.Id, "{\"float\":{\"hidden\":false}}"); }));
        }
        return sub;
    }

    // ------------------------------------------------ shared small controls (the editors and the scene screen)
    /// <summary>An eyebrow: small, spaced, semibold - the same on every page.</summary>
    private static TextBlock Section(string text) => new() { Text = text, FontSize = 10.5, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeDim, Margin = new Thickness(0, 14, 0, 2), CharacterSpacing = 140 };

    private static Button Small(string text, Action click)
    {
        // a quiet secondary: hairline border, no fill, rounded like everything else
        var b = new Button { Content = text, Padding = new Thickness(11, 5, 11, 5), FontSize = 12, CornerRadius = new CornerRadius(7), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x10, 0xFF, 0xFF, 0xFF)), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x2E, 0xFF, 0xFF, 0xFF)), BorderThickness = new Thickness(1) };
        OwnHover(b);   // its own hover, never the system's (memory: hover-loss-tooltips)
        b.Click += (_, __) => click();
        return b;
    }
}
