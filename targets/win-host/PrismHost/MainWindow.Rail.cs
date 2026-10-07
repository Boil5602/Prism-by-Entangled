using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// The five-item rail (scene-model-spec §6): Scenes · Layouts · Facets · Apps ·
/// Device - each a noun with a list and an editor, in pipeline order, no modes
/// behind gear icons. Every picker creates in place (+ New facet for this slot,
/// + New layout, + Add App) so no flow dead-ends. Card → editor; right-click /
/// long-press → rename · duplicate · archive. Everything listed here is core's
/// state read through <c>PrismRuntime.modelState()</c>; the shell draws.
///
/// This file also holds the model reader (records + the sync model calls) the
/// scene builder, the template wizard, the news picker and the quick actions
/// share.
/// </summary>
public sealed partial class MainWindow
{
    // ------------------------------------------------ the scene model, as the host reads it
    private sealed record MApp(string Id, string Name, string BaseUrl, string ProfileId, string? CatalogRef, string? Adapter, string SetupStatus, JsonObject Json, string? Evidence = null);
    private sealed record MFacet(string Id, string App, string Url, string SlotClass, string Label, bool Music, JsonObject Json);
    private sealed record MSlot(string Id, double X, double Y, double W, double H, string Class, bool Custom, string? Label);
    private sealed record MLayout(string Id, string Name, string CanvasAspect, double CanvasRatio, string CanvasResolution, bool Portrait, bool Archived, List<MSlot> Slots, JsonObject Json);

    /// <summary>A scene draft: the §5 shape plus settings / visualizations, editable, serialized back for modelSaveScene.</summary>
    private sealed class MScene
    {
        public string Id = "", Name = "", Layout = "";
        public readonly Dictionary<string, string> Assign = new();
        public readonly Dictionary<string, JsonObject> Settings = new();
        public readonly List<JsonObject> Floating = new();
        public readonly List<JsonObject> Hidden = new();
        public readonly List<JsonObject> Visualizations = new();
        public readonly List<JsonObject> Schedule = new();

        public static MScene From(JsonObject o)
        {
            var s = new MScene { Id = o["id"]?.GetValue<string>() ?? "", Name = o["name"]?.GetValue<string>() ?? "", Layout = o["layout"]?.GetValue<string>() ?? "" };
            if (o["assign"] is JsonObject a) foreach (var (k, v) in a) if (v is JsonValue jv && jv.TryGetValue<string>(out var sv)) s.Assign[k] = sv;
            if (o["settings"] is JsonObject st) foreach (var (k, v) in st) if (v is JsonObject so) s.Settings[k] = (JsonObject)so.DeepClone();
            if (o["floating"] is JsonArray fl) foreach (var v in fl) if (v is JsonObject fo) s.Floating.Add((JsonObject)fo.DeepClone());
            if (o["hidden"] is JsonArray hd) foreach (var v in hd) if (v is JsonObject ho) s.Hidden.Add((JsonObject)ho.DeepClone());
            if (o["visualizations"] is JsonArray vz) foreach (var v in vz) if (v is JsonObject vo) s.Visualizations.Add((JsonObject)vo.DeepClone());
            if (o["schedule"] is JsonArray sc) foreach (var v in sc) if (v is JsonObject eo) s.Schedule.Add((JsonObject)eo.DeepClone());
            return s;
        }

        public JsonObject ToJson()
        {
            var o = new JsonObject { ["id"] = Id, ["name"] = Name, ["layout"] = Layout };
            var a = new JsonObject(); foreach (var (k, v) in Assign) a[k] = v; o["assign"] = a;
            var st = new JsonObject(); foreach (var (k, v) in Settings) st[k] = v.DeepClone(); o["settings"] = st;
            o["floating"] = new JsonArray(Floating.Select(f => f.DeepClone()).ToArray());
            o["hidden"] = new JsonArray(Hidden.Select(h => h.DeepClone()).ToArray());
            o["visualizations"] = new JsonArray(Visualizations.Select(v => v.DeepClone()).ToArray());
            o["schedule"] = Schedule.Count == 0 ? null : new JsonArray(Schedule.Select(e => e.DeepClone()).ToArray());
            return o;
        }

        public MScene Clone() => From(ToJson());
    }

    private sealed record RailModel(List<MApp> Apps, List<MFacet> Facets, List<MLayout> Layouts, List<MScene> Scenes, string? ActiveScene, List<(string Class, int Layouts, bool Custom)> SlotClasses)
    {
        public MApp? App(string id) => Apps.FirstOrDefault(a => a.Id == id);
        public MFacet? Facet(string id) => Facets.FirstOrDefault(f => f.Id == id);
        public MLayout? Layout(string id) => Layouts.FirstOrDefault(l => l.Id == id);
        public MScene? Scene(string id) => Scenes.FirstOrDefault(s => s.Id == id);
        public static readonly RailModel Empty = new(new(), new(), new(), new(), null, new());
    }

    private RailModel _model = RailModel.Empty;

    /// <summary>
    /// A sync PrismRuntime call (modelState, modelSaveScene, newsShelf …) made
    /// through the brain's script evaluator: string args travel as JS string
    /// literals, objects are serialized to JSON first. Every call is logged
    /// as <c>call {"fn":…}</c> in host.log like the fire-and-forget channel
    /// calls, so the flight recorder sees the model traffic too.
    /// </summary>
    private async Task<string?> ModelCallAsync(string fn, params object?[] args)
    {
        var parts = new List<string>();
        foreach (var a in args)
        {
            parts.Add(a switch
            {
                null => "null",
                bool b => b ? "true" : "false",
                string s => JsonSerializer.Serialize(s),
                JsonNode n => JsonSerializer.Serialize(n.ToJsonString()),
                _ => JsonSerializer.Serialize(JsonSerializer.Serialize(a)),
            });
        }
        var argsJson = "[" + string.Join(",", parts) + "]";
        LogLine("call " + ClipForLog("{\"fn\":\"" + fn + "\",\"args\":" + argsJson + "}", 400));
        string? raw;
        try { raw = await _brain.EvalAsync("PrismRuntime." + fn + "(" + string.Join(",", parts) + ")"); }
        catch (Exception ex) { SetStatus(fn + ": " + ex.Message); return null; }
        if (raw is null) return null;
        PerfNoteCall(fn, raw.Length);
        try
        {
            using var outer = JsonDocument.Parse(raw);
            return outer.RootElement.ValueKind == JsonValueKind.String ? outer.RootElement.GetString() : raw;
        }
        catch { return raw; }
    }

    /// <summary>
    /// <see cref="ModelCallAsync"/> for an api function that answers a promise (updateCheck, updateInstallNow, updateSetChannel): WebView2's
    /// ExecuteScript does not await, so the plain call handed back "{}" and the Updates dialog read "last check never" right after a check
    /// (2026-10-05). The promise's answer is parked on the brain's window under a ticket and polled for, up to <paramref name="timeoutMs"/>.
    /// </summary>
    private async Task<string?> ModelCallAwaitAsync(string fn, int timeoutMs, params object?[] args)
    {
        var parts = new List<string>();
        foreach (var a in args)
        {
            parts.Add(a switch
            {
                null => "null",
                bool b => b ? "true" : "false",
                string s => JsonSerializer.Serialize(s),
                JsonNode n => JsonSerializer.Serialize(n.ToJsonString()),
                _ => JsonSerializer.Serialize(JsonSerializer.Serialize(a)),
            });
        }
        var ticket = "t" + Interlocked.Increment(ref _awaitTicket);
        LogLine("call " + ClipForLog("{\"fn\":\"" + fn + "\",\"args\":[" + string.Join(",", parts) + "],\"await\":\"" + ticket + "\"}", 400));
        var js = "(function(){ var w = window; w.__prismAwait = w.__prismAwait || {}; Promise.resolve().then(function(){ return PrismRuntime." + fn + "(" + string.Join(",", parts) + "); })"
               + ".then(function(r){ w.__prismAwait[" + JsonSerializer.Serialize(ticket) + "] = typeof r === 'string' ? r : JSON.stringify(r === undefined ? null : r); }, function(e){ w.__prismAwait[" + JsonSerializer.Serialize(ticket) + "] = JSON.stringify({ error: String(e) }); }); return true; })()";
        try { await _brain.EvalAsync(js); } catch (Exception ex) { SetStatus(fn + ": " + ex.Message); return null; }
        var take = "(function(){ var w = window, k = " + JsonSerializer.Serialize(ticket) + "; if (!w.__prismAwait || !(k in w.__prismAwait)) return null; var r = w.__prismAwait[k]; delete w.__prismAwait[k]; return r; })()";
        var started = Environment.TickCount64;
        while (Environment.TickCount64 - started < timeoutMs)
        {
            await Task.Delay(120);
            string? raw;
            try { raw = await _brain.EvalAsync(take); } catch { return null; }
            if (raw is null || raw == "null") continue;
            PerfNoteCall(fn, raw.Length);
            try
            {
                using var outer = JsonDocument.Parse(raw);
                return outer.RootElement.ValueKind == JsonValueKind.String ? outer.RootElement.GetString() : raw;
            }
            catch { return raw; }
        }
        LogLine("call " + fn + ": no answer in " + timeoutMs + " ms");
        return null;
    }
    private static int _awaitTicket;

    private static string ClipForLog(string s, int max)
    {
        if (s.Length <= max) return s;
        var cut = max;
        if (char.IsHighSurrogate(s[cut - 1])) cut--;
        return s[..cut] + "…";
    }

    /// <summary>Read every scene-model store into <see cref="_model"/>.</summary>
    private async Task<RailModel> ReadModelAsync()
    {
        var raw = await ModelCallAsync("modelState");
        var apps = new List<MApp>(); var facets = new List<MFacet>(); var layouts = new List<MLayout>(); var scenes = new List<MScene>();
        var classes = new List<(string, int, bool)>();
        string? active = null;
        try
        {
            if (raw is not null && JsonNode.Parse(raw) is JsonObject r)
            {
                if (r["apps"] is JsonArray ap) foreach (var n in ap) if (n is JsonObject o)
                    apps.Add(new MApp(S(o, "id"), S(o, "name"), S(o, "baseUrl"), S(o, "profileId"), N(o, "catalogRef"), N(o, "adapter"), o["setup"] is JsonObject su ? S(su, "status") : "unknown", o, o["setup"] is JsonObject su2 ? N(su2, "evidence") : null));
                if (r["facets"] is JsonArray fa) foreach (var n in fa) if (n is JsonObject o)
                    facets.Add(new MFacet(S(o, "id"), S(o, "app"), S(o, "url"), S(o, "slotClass"), S(o, "label"), o["music"]?.GetValue<bool>() == true, o));
                if (r["layouts"] is JsonArray la) foreach (var n in la) if (n is JsonObject o)
                {
                    var slots = new List<MSlot>();
                    if (o["slots"] is JsonArray sl) foreach (var sn in sl) if (sn is JsonObject so && so["rect"] is JsonObject rc)
                        slots.Add(new MSlot(S(so, "id"), D(rc, "x"), D(rc, "y"), D(rc, "w"), D(rc, "h"), S(so, "class"), so["custom"]?.GetValue<bool>() == true, N(so, "label")));
                    var cv = o["canvas"] as JsonObject;
                    layouts.Add(new MLayout(S(o, "id"), S(o, "name"), cv is null ? "16:9" : S(cv, "aspect"), cv is null ? 16 / 9.0 : D(cv, "ratio"), cv is null ? "1080-class" : S(cv, "resolution"),
                        cv is not null && S(cv, "orientation") == "portrait", o["archived"]?.GetValue<bool>() == true, slots, o));
                }
                if (r["scenes"] is JsonArray sa) foreach (var n in sa) if (n is JsonObject o) scenes.Add(MScene.From(o));
                active = r["activeScene"] is JsonValue av && av.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
                if (r["slotClasses"] is JsonArray sc) foreach (var n in sc) if (n is JsonObject o)
                    classes.Add((S(o, "class"), (int)D(o, "layouts"), o["custom"]?.GetValue<bool>() == true));
            }
        }
        catch (Exception ex) { SetStatus("model state unreadable: " + ex.Message); }
        _model = new RailModel(apps, facets, layouts, scenes, active, classes);
        return _model;

        static string S(JsonObject o, string k) => o[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";
        static string? N(JsonObject o, string k) => o[k] is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0 ? s : null;
        static double D(JsonObject o, string k) => o[k] is JsonValue v && v.TryGetValue<double>(out var d) ? d : 0;
    }

    // ------------------------------------------------ mirrors of two core rules the host needs before a call exists (ledger B-53)
    // canvasClassMatches / facetFitsSlot live in packages/core/src/scene-model.ts; the runtime exposes no sync call for
    // either yet (SM-4 adds modelLayoutsFor / modelFacetsForSlot), so the pickers filter with these one-line copies.
    private static string ResolutionBucketOf(double w, double h) { var l = Math.Max(w, h); return l >= 3200 ? "4K-class" : l >= 2200 ? "1440-class" : "1080-class"; }

    private static readonly (string Label, double Ratio)[] CanvasAspectLabels =
    {
        ("16:9", 16 / 9.0), ("16:10", 1.6), ("4:3", 4 / 3.0), ("3:2", 1.5), ("21:9", 21 / 9.0), ("32:9", 32 / 9.0), ("1:1", 1),
        ("9:16", 9 / 16.0), ("10:16", 0.625), ("3:4", 0.75), ("2:3", 2 / 3.0), ("9:21", 9 / 21.0),
    };

    /// <summary>"16:9 @ 1080-class" for the wall (core's formatCanvasClass(canvasClassOf(w, h))).</summary>
    private static string CanvasClassLabel(double w, double h)
    {
        if (w <= 0 || h <= 0) return "unknown";
        var ratio = w / h; var best = CanvasAspectLabels[0]; var bestDev = double.MaxValue;
        foreach (var c in CanvasAspectLabels) { var dev = Math.Abs(Math.Log(ratio / c.Ratio)); if (dev < bestDev) { bestDev = dev; best = c; } }
        return best.Label + (w < h ? " portrait" : "") + " @ " + ResolutionBucketOf(w, h);
    }

    private static bool CanvasMatches(MLayout l, double w, double h) =>
        w > 0 && h > 0 && l.CanvasResolution == ResolutionBucketOf(w, h) && Math.Abs((w / h) / l.CanvasRatio - 1) <= 0.02;

    private static readonly string[] Tiers = { "S", "M", "L", "XL" };

    private static (string Aspect, string Tier)? ParseClass(string cls)
    {
        var i = cls.LastIndexOf('·');
        if (i <= 0) return null;
        var tier = cls[(i + 1)..].Trim();
        return Array.IndexOf(Tiers, tier) < 0 ? null : (cls[..i].Trim(), tier);
    }

    /// <summary>Compatibility (spec §4): same aspect bucket AND tier within one step; exact / one-step ("stretch" | "shrink") / none.</summary>
    private static (bool Ok, string Match, string? Note) FacetFits(string facetClass, string slotClass)
    {
        var f = ParseClass(facetClass); var s = ParseClass(slotClass);
        if (f is null || s is null || f.Value.Aspect != s.Value.Aspect) return (false, "none", null);
        var fi = Array.IndexOf(Tiers, f.Value.Tier); var si = Array.IndexOf(Tiers, s.Value.Tier);
        if (fi == si) return (true, "exact", null);
        if (Math.Abs(fi - si) == 1) return (true, "one-step", si > fi ? "stretch" : "shrink");
        return (false, "none", null);
    }

    private (double W, double H) WallSize()
    {
        var (cw, ch) = _surfaces.CanvasSize;
        if (cw < 1 || ch < 1) { cw = _w > 0 ? _w : 1920; ch = _h > 0 ? _h : 1080; }
        return (cw, ch);
    }

    // ------------------------------------------------ the rail
    private Grid? _rail;
    private string _railSection = "scenes";
    private Grid? _railContent;
    private readonly Dictionary<string, Button> _railButtons = new();
    private bool _railAllCanvases;

    private static readonly (string Id, string Label, string Glyph)[] RailItems =
    {
        ("scenes", "Scenes", ""), ("layouts", "Layouts", ""), ("facets", "Facets", ""), ("apps", "Apps", ""), ("device", "Device", ""),
    };

    /// <summary>Open the rail on a section (the router's list routes land here). Reopening switches sections.</summary>
    private async void OpenRail(string section)
    {
        _railSection = RailItems.Any(i => i.Id == section) ? section : "scenes";
        await ReadModelAsync();
        if (_rail is null)
        {
            var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF6, 0x0F, 0x12, 0x16)) };
            Canvas.SetZIndex(overlay, 900);
            overlay.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(216) });
            overlay.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var rail = new StackPanel { Spacing = 3, Padding = new Thickness(14, 20, 12, 18), Background = LePanel };
            rail.Children.Add(new TextBlock { Text = "Prism", FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Amber, Margin = new Thickness(12, 0, 0, 0), FontFamily = new FontFamily("Segoe UI Variable Display, Segoe UI") });
            rail.Children.Add(new TextBlock { Text = "SET UP THE WALL", FontSize = 9.5, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeDim, CharacterSpacing = 160, Margin = new Thickness(12, 0, 0, 14) });
            _railButtons.Clear();
            foreach (var (id, label, glyph) in RailItems)
            {
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
                row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 15, Margin = new Thickness(0, 1, 0, 0) });
                row.Children.Add(new TextBlock { Text = label, FontSize = 13.5, FontWeight = Microsoft.UI.Text.FontWeights.Medium });
                var b = new Button { Content = row, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 9, 12, 9), CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(0), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)) };
                var sid = id;
                b.Click += (_, __) => { _railSection = sid; _ = RenderRailAsync(); };
                _railButtons[id] = b;
                rail.Children.Add(b);
            }
            var spacer = new Grid { VerticalAlignment = VerticalAlignment.Stretch };
            rail.Children.Add(spacer);
            var back = new Button { Content = "◀  Back to the scene   (Esc)", HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 8, 12, 8), CornerRadius = new CornerRadius(8), FontSize = 12.5, Margin = new Thickness(0, 24, 0, 0) };
            back.Click += (_, __) => RouteBack();
            rail.Children.Add(back);
            overlay.Children.Add(rail);
            _railContent = new Grid { Padding = new Thickness(32, 22, 32, 22) };
            Grid.SetColumn(_railContent, 1);
            overlay.Children.Add(_railContent);
            RootGrid.Children.Add(overlay);
            _rail = overlay;
        }
        await RenderRailAsync();
    }

    private void CloseRail()
    {
        if (_rail is null) return;
        RootGrid.Children.Remove(_rail);
        _rail = null; _railContent = null;
        _railButtons.Clear();
    }

    private async Task RenderRailAsync()
    {
        if (_rail is null || _railContent is null) return;
        foreach (var (id, b) in _railButtons)
        {
            var on = id == _railSection;
            b.Background = new SolidColorBrush(on ? Windows.UI.Color.FromArgb(0x30, 0xF0, 0xA8, 0x3C) : Windows.UI.Color.FromArgb(0, 0, 0, 0));
            b.Foreground = on ? Amber : LeInk;
        }
        _railContent.Children.Clear();
        UIElement body = _railSection switch
        {
            "layouts" => RailLayouts(),
            "facets" => RailFacets(),
            "apps" => RailApps(),
            "device" => RailDevice(),
            _ => RailScenes(),
        };
        // a reading width: on a 3840-wide wall the cards must not fan out across the whole window
        var avail = _railContent.ActualWidth > 0 ? _railContent.ActualWidth : RootGrid.ActualWidth - 216;   // first render happens before layout: derive it
        var column = new Grid { HorizontalAlignment = HorizontalAlignment.Left, Width = Math.Max(640, Math.Min(1480, avail - 64)) };
        column.Children.Add(body);
        _railContent.Children.Add(new ScrollViewer { Content = column, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled });
        await Task.CompletedTask;
    }

    private static StackPanel RailHeader(string title, string blurb, params FrameworkElement[] actions)
    {
        var head = new StackPanel { Spacing = 6, Margin = new Thickness(0, 0, 0, 18) };
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.Children.Add(new TextBlock { Text = title, FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk, VerticalAlignment = VerticalAlignment.Center, FontFamily = new FontFamily("Segoe UI Variable Display, Segoe UI") });
        var acts = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        foreach (var a in actions) acts.Children.Add(a);
        Grid.SetColumn(acts, 1);
        row.Children.Add(acts);
        head.Children.Add(row);
        head.Children.Add(new TextBlock { Text = blurb, FontSize = 12.5, Foreground = LeDim, TextWrapping = TextWrapping.Wrap, MaxWidth = 860, HorizontalAlignment = HorizontalAlignment.Left, LineHeight = 18 });
        head.Children.Add(new Border { Height = 1, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x1C, 0xFF, 0xFF, 0xFF)), Margin = new Thickness(0, 6, 0, 0) });
        return head;
    }

    private static Button Primary(string text, Action click)
    {
        var b = new Button { Content = text, Padding = new Thickness(16, 8, 16, 8), FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, CornerRadius = new CornerRadius(8), Background = Amber, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x12, 0x13, 0x1A)), BorderThickness = new Thickness(0) };
        OwnHover(b);   // its own hover, never the system's (memory: hover-loss-tooltips)
        b.Click += (_, __) => click();
        return b;
    }

    /// <summary>A card: content + click → editor, right-click → the entity's context menu (rename · duplicate · archive …).</summary>
    private static Button Card(UIElement content, double width, Action open, Func<MenuFlyout>? context)
    {
        var b = new Button { Content = content, Width = width, Padding = new Thickness(12), HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Top, Background = LeSlot, BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x24, 0xF0, 0xA8, 0x3C)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10) };
        OwnHover(b);   // its own hover, never the system's (memory: hover-loss-tooltips)
        b.Click += (_, __) => open();
        if (context is not null)
        {
            b.RightTapped += (_, e) => { e.Handled = true; context().ShowAt(b, new FlyoutShowOptions { Position = e.GetPosition(b) }); };
            b.Holding += (_, e) => { if (e.HoldingState == Microsoft.UI.Input.HoldingState.Started) { e.Handled = true; context().ShowAt(b); } };
        }
        return b;
    }

    private static FlowPanel CardGrid() => new() { HorizontalSpacing = 14, VerticalSpacing = 14 };

    /// <summary>A layout's slots drawn small (normalized rects on a canvas of the layout's aspect).</summary>
    private static Canvas LayoutThumb(MLayout l, double width, Func<MSlot, (Brush Fill, string? Text)>? paint = null)
    {
        var height = Math.Max(20, width / Math.Max(0.2, l.CanvasRatio));
        var c = new Canvas { Width = width, Height = height, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x0B, 0x0D, 0x12)) };
        foreach (var s in l.Slots)
        {
            var (fill, text) = paint?.Invoke(s) ?? (new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xF0, 0xA8, 0x3C)), null);
            var box = new Border { Width = Math.Max(2, s.W * width - 2), Height = Math.Max(2, s.H * height - 2), Background = fill, BorderBrush = Amber, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(2) };
            if (text is not null && s.H * height > 16) box.Child = new TextBlock { Text = text, FontSize = 9, Foreground = LeInk, TextTrimming = TextTrimming.CharacterEllipsis, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, TextAlignment = TextAlignment.Center };
            Canvas.SetLeft(box, s.X * width + 1); Canvas.SetTop(box, s.Y * height + 1);
            c.Children.Add(box);
        }
        return c;
    }

    private static TextBlock Meta(string text) => new() { Text = text, FontSize = 11.5, Foreground = LeDim, TextWrapping = TextWrapping.Wrap, LineHeight = 16 };
    private static TextBlock CardTitle(string text) => new() { Text = text, FontSize = 14.5, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk, TextTrimming = TextTrimming.CharacterEllipsis, FontFamily = new FontFamily("Segoe UI Variable Display, Segoe UI") };

    private static Border ClassBadge(string cls, string? note = null)
    {
        return new Border
        {
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x30, 0x5C, 0xC8, 0xC0)), CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 1, 6, 1), Margin = new Thickness(0, 2, 4, 0),
            Child = new TextBlock { Text = cls + (note is null ? "" : "  ·  " + note), FontSize = 10, Foreground = LeTeal, FontFamily = new FontFamily("Consolas") },
        };
    }

    /// <summary>A first-party App has nothing to sign in to; "not verified" / "unknown" on it was noise (B-93).</summary>
    private bool IsBuiltIn(MApp app) => app.CatalogRef is { } cr && _catalog.FirstOrDefault(c => c.Id == cr) is { } e && PrismHost.Core.FirstPartyRole.NoAccount(e.Json);
    private string StatusWord(MApp app) => IsBuiltIn(app) ? "built in" : StatusText(app.SetupStatus, app.Evidence);
    /// <summary>The honest word for a status: "signed in" only on the probe's evidence or a person's word; an address alone is "reachable".</summary>
    private static string StatusText(string status, string? evidence) => status switch
    {
        "signed-in" => evidence == "probe" ? "signed in ✓" : evidence == "asserted" ? "marked signed in" : "reachable · not verified",
        "needs-attention" => "needs attention",
        _ => "not verified",
    };
    private Border StatusBadgeFor(MApp app) => IsBuiltIn(app)
        ? BuiltInBadge()
        : StatusBadge(app.SetupStatus, app.Evidence);

    private static Border BuiltInBadge()
    {
        var b = new Border { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x30, 0xF0, 0xA8, 0x3C)), CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 1, 6, 1), Child = new TextBlock { Text = "built in", FontSize = 10, Foreground = LeInk } };
        ToolTipService.SetToolTip(b, "Part of Prism: runs on this device, nothing to sign in to.");
        return b;
    }

    private static Border StatusBadge(string status, string? evidence = null)
    {
        var (text, color) = status switch
        {
            "signed-in" => (StatusText(status, evidence), evidence == "probe" || evidence == "asserted" ? Windows.UI.Color.FromArgb(0x30, 0x5C, 0xC8, 0xC0) : Windows.UI.Color.FromArgb(0x30, 0x9A, 0x9C, 0xA8)),
            "needs-attention" => ("needs attention", Windows.UI.Color.FromArgb(0x50, 0xD0, 0x6A, 0x5A)),
            _ => ("not verified", Windows.UI.Color.FromArgb(0x30, 0x9A, 0x9C, 0xA8)),
        };
        return new Border { Background = new SolidColorBrush(color), CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 1, 6, 1), Child = new TextBlock { Text = text, FontSize = 10, Foreground = LeInk } };
    }

    // ------------------------------------------------ Scenes
    private UIElement RailScenes()
    {
        var col = new StackPanel();
        var active = _model.ActiveScene is { } aid ? _model.Scene(aid) : null;
        col.Children.Add(RailHeader("Scenes", active is null
            ? "Nothing is playing from a scene yet. New Scene walks you through it: pick a template, add the apps it needs, and the wall becomes the scene."
            : "Playing now: " + active.Name + ". A scene is a layout with a facet in each slot, plus floating and hidden facets and any visualizations.",
            Primary("＋  New Scene", () => OpenRoute("prism://templates")),
            Small("＋  Blank scene", () => OpenSceneBuilder(null))));
        if (_model.Scenes.Count == 0)
        {
            col.Children.Add(Meta("No scenes yet."));
            return col;
        }
        var grid = CardGrid();
        foreach (var s in _model.Scenes.OrderBy(x => x.Id == _model.ActiveScene ? 0 : 1).ThenBy(x => x.Name))
        {
            var layout = _model.Layout(s.Layout);
            var body = new StackPanel { Spacing = 6 };
            if (layout is not null) body.Children.Add(LayoutThumb(layout, layout.Portrait ? 112 : 220, slot => SlotPaint(s, slot)));   // a portrait thumb at 220 wide is 390 tall and stretches its whole row
            else body.Children.Add(Meta("layout " + s.Layout + " is missing"));
            body.Children.Add(CardTitle(s.Name + (s.Id == _model.ActiveScene ? "   ● playing" : "")));
            var assigned = layout is null ? 0 : layout.Slots.Count(sl => s.Assign.ContainsKey(sl.Id));
            body.Children.Add(Meta((layout?.Name ?? s.Layout) + "  ·  " + assigned + "/" + (layout?.Slots.Count ?? 0) + " slots" + (s.Floating.Count > 0 ? "  ·  " + s.Floating.Count + " floating" : "") + (s.Hidden.Count > 0 ? "  ·  " + s.Hidden.Count + " hidden" : "") + (s.Schedule.Count > 0 ? "  ·  scheduled" : "")));
            var sid = s.Id;
            grid.Children.Add(Card(body, 244, () => OpenRoute("prism://scene/" + Uri.EscapeDataString(sid) + "/edit"), () => SceneContextMenu(s)));
        }
        col.Children.Add(grid);
        return col;
    }

    private (Brush, string?) SlotPaint(MScene s, MSlot slot)
    {
        if (!s.Assign.TryGetValue(slot.Id, out var refId)) return (new SolidColorBrush(Windows.UI.Color.FromArgb(0x18, 0xF0, 0xA8, 0x3C)), "tap to assign");
        var viz = s.Visualizations.FirstOrDefault(v => v["id"]?.GetValue<string>() == refId);
        if (viz is not null) return (new SolidColorBrush(Windows.UI.Color.FromArgb(0x60, 0xC8, 0x6C, 0xF0)), "♪ " + (viz["style"]?.GetValue<string>() ?? "visualization"));
        var f = _model.Facet(refId);
        // a ref with no facet behind it is an empty slot on the wall (the seed's App-poster placeholder): say what the slot is FOR, never the internal ref
        return (new SolidColorBrush(Windows.UI.Color.FromArgb(0x50, 0x5C, 0xC8, 0xC0)), f is null ? "Empty · " + (slot.Label ?? slot.Id) : (_model.App(f.App)?.Name ?? f.App) + " · " + f.Label);
    }

    // ------------------------------------------------ reset / restore (HostPaths: move, never delete; applied on the next start)
    private async Task ResetToDefaultsAsync()
    {
        var dlg = new ContentDialog
        {
            Title = "Reset to defaults?",
            Content = "Everything on this wall (scenes, layouts, facets, Apps and their sign-ins) is moved to a dated backup folder beside the store, and Prism restarts empty with the New scene wizard. Nothing is deleted: Restore a backup… brings it back.",
            PrimaryButtonText = "Reset and restart", CloseButtonText = "Cancel", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark,
        };
        try { if (await dlg.ShowAsync() != ContentDialogResult.Primary) return; } catch { return; }
        LogLine("reset: requested by the household - restarting");
        HostPaths.RequestReset();
        HostPaths.Restart();
    }

    private async Task RestoreBackupAsync()
    {
        var backups = HostPaths.Backups();
        if (backups.Count == 0) { SetPill("Prism · no backups beside " + HostPaths.DataDir); return; }
        var list = new StackPanel { Spacing = 4 };
        var tcs = new TaskCompletionSource<string?>();
        var dlg = new ContentDialog { Title = "Restore a backup", Content = new ScrollViewer { Content = list, MaxHeight = 480 }, CloseButtonText = "Cancel", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        list.Children.Add(Meta("The current wall is parked as a new backup first, so a restore can itself be undone."));
        foreach (var b in backups) { var path = b; list.Children.Add(AppRow(Path.GetFileName(b), BackupNote(b), () => { tcs.TrySetResult(path); dlg.Hide(); })); }
        dlg.Closed += (_, __) => tcs.TrySetResult(null);
        try { _ = dlg.ShowAsync(); } catch { return; }
        var chosen = await tcs.Task;
        if (chosen is null) return;
        LogLine("restore: " + chosen + " - restarting");
        HostPaths.RequestRestore(chosen);
        HostPaths.Restart();
    }

    private static string BackupNote(string dir)
    {
        try
        {
            var s = Path.Combine(dir, "store.json");
            if (!File.Exists(s)) return "no store.json";
            var fi = new FileInfo(s);
            return fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm") + "  ·  " + Math.Max(1, fi.Length / 1024) + " KB store";
        }
        catch { return ""; }
    }

    private MenuFlyout SceneContextMenu(MScene s)
    {
        var m = new MenuFlyout { MenuFlyoutPresenterStyle = (Style)RootGrid.Resources["PrismMenuPresenter"] };
        m.Items.Add(Item("Set as the active scene", "", null, () => OpenRoute("prism://scene/" + Uri.EscapeDataString(s.Id))));
        m.Items.Add(Item("Edit…", "", null, () => OpenRoute("prism://scene/" + Uri.EscapeDataString(s.Id) + "/edit")));
        // a template scene re-opens its wizard on itself: the apps change, the layout and the scene stay (2026-09-05 audit)
        if (TemplateOfScene(s) is { } tplId) m.Items.Add(Item("Change apps…", null, null, () => OpenRoute("prism://template/" + Uri.EscapeDataString(tplId) + "?scene=" + Uri.EscapeDataString(s.Id))));
        m.Items.Add(new MenuFlyoutSeparator());
        m.Items.Add(Item("Rename…", null, null, () => _ = RenameSceneAsync(s)));
        m.Items.Add(Item("Duplicate", null, null, () => _ = DuplicateSceneAsync(s)));
        m.Items.Add(new MenuFlyoutSeparator());
        var rm = Item("Remove scene", null, null, () => _ = RemoveSceneAsync(s));
        rm.Foreground = Danger;
        m.Items.Add(rm);
        return m;
    }

    private async Task RenameSceneAsync(MScene s)
    {
        var name = await PromptTextAsync("Rename scene", s.Name, "Scene name", "Rename");
        if (name is null) return;
        var copy = s.Clone(); copy.Name = name;
        await ModelCallAsync("modelSaveScene", copy.ToJson());
        await ReadModelAsync(); await RenderRailAsync();
    }

    private async Task DuplicateSceneAsync(MScene s)
    {
        var copy = s.Clone(); copy.Id = ""; copy.Name = s.Name + " copy"; copy.Schedule.Clear();
        await ModelCallAsync("modelSaveScene", copy.ToJson());
        await ReadModelAsync(); await RenderRailAsync();
    }

    private async Task RemoveSceneAsync(MScene s)
    {
        var dlg = new ContentDialog { Title = "Remove \"" + s.Name + "\"?", Content = "The scene is removed. Its layout, facets and Apps stay (nothing else is deleted).", PrimaryButtonText = "Remove", CloseButtonText = "Keep", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        try { if (await dlg.ShowAsync() != ContentDialogResult.Primary) return; } catch { return; }
        await ModelCallAsync("modelRemoveScene", s.Id);
        await ReadModelAsync(); await RenderRailAsync();
    }

    // ------------------------------------------------ Layouts
    private UIElement RailLayouts()
    {
        var col = new StackPanel();
        var (cw, ch) = WallSize();
        var filter = new ToggleButton { Content = _railAllCanvases ? "Every canvas class" : "This device: " + CanvasClassLabel(cw, ch), IsChecked = !_railAllCanvases, Padding = new Thickness(10, 5, 10, 5) };
        filter.Click += (_, __) => { _railAllCanvases = !_railAllCanvases; _ = RenderRailAsync(); };
        col.Children.Add(RailHeader("Layouts", "A layout is a named arrangement of slots for a canvas class; each slot has a class (aspect bucket × size tier) facets are cut for. Near-duplicates are flagged, never blocked; archived layouts hide from pickers and never delete.",
            filter, Primary("＋  New Layout", () => OpenRoute("prism://layouts/new"))));
        var shown = _model.Layouts.Where(l => _railAllCanvases || CanvasMatches(l, cw, ch)).OrderBy(l => l.Archived ? 1 : 0).ThenBy(l => l.Name).ToList();
        if (shown.Count == 0) { col.Children.Add(Meta(_model.Layouts.Count == 0 ? "No layouts yet - New Layout opens the editor, or New Scene makes one from a template." : "No layouts for this canvas class - switch the filter to see every class.")); return col; }
        var grid = CardGrid();
        foreach (var l in shown)
        {
            var body = new StackPanel { Spacing = 6, Opacity = l.Archived ? 0.55 : 1 };
            body.Children.Add(LayoutThumb(l, l.Portrait ? 112 : 220, s => (new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xF0, 0xA8, 0x3C)), s.Class)));
            body.Children.Add(CardTitle(l.Name + (l.Archived ? "   (archived)" : "")));
            var meta = l.CanvasAspect + (l.Portrait ? " portrait" : "") + " @ " + l.CanvasResolution + "  ·  " + l.Slots.Count + " slot" + (l.Slots.Count == 1 ? "" : "s");
            var uses = _model.Scenes.Count(s => s.Layout == l.Id);
            if (uses > 0) meta += "  ·  " + uses + " scene" + (uses == 1 ? "" : "s");
            body.Children.Add(Meta(meta));
            var dupHost = new StackPanel();
            body.Children.Add(dupHost);
            _ = FillDuplicateBadgeAsync(l, dupHost);
            var lid = l.Id;
            grid.Children.Add(Card(body, 244, () => OpenRoute("prism://layout/" + Uri.EscapeDataString(lid) + "/edit"), () => LayoutContextMenu(l)));
        }
        col.Children.Add(grid);
        return col;
    }

    private async Task FillDuplicateBadgeAsync(MLayout l, StackPanel host)
    {
        var raw = await ModelCallAsync("modelLayoutDuplicates", l.Json);
        if (raw is null) return;
        try
        {
            if (JsonNode.Parse(raw) is not JsonArray arr || arr.Count == 0) return;
            var names = arr.OfType<JsonObject>().Select(o => o["name"]?.GetValue<string>() ?? "?").ToList();
            RootGrid.DispatcherQueue.TryEnqueue(() => host.Children.Add(new Border
            {
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xF0, 0xA8, 0x3C)), CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 1, 6, 1), HorizontalAlignment = HorizontalAlignment.Left,
                Child = new TextBlock { Text = "possibly duplicates ⟨" + string.Join("⟩, ⟨", names) + "⟩", FontSize = 10, Foreground = Amber, TextWrapping = TextWrapping.Wrap },
            }));
        }
        catch { }
    }

    private MenuFlyout LayoutContextMenu(MLayout l)
    {
        var m = new MenuFlyout { MenuFlyoutPresenterStyle = (Style)RootGrid.Resources["PrismMenuPresenter"] };
        m.Items.Add(Item("Edit…", "", null, () => OpenRoute("prism://layout/" + Uri.EscapeDataString(l.Id) + "/edit")));
        m.Items.Add(Item("Use in a new scene", "", null, () => OpenSceneBuilder(null, l.Id)));
        m.Items.Add(new MenuFlyoutSeparator());
        m.Items.Add(Item("Rename…", null, null, () => _ = RenameLayoutAsync(l)));
        m.Items.Add(Item("Duplicate", null, null, () => _ = DuplicateLayoutAsync(l)));
        m.Items.Add(Item(l.Archived ? "Unarchive" : "Archive (hide from pickers)", null, null, async () =>
        {
            await ModelCallAsync("modelArchiveLayout", l.Id, !l.Archived);
            await ReadModelAsync(); await RenderRailAsync();
        }));
        return m;
    }

    private async Task RenameLayoutAsync(MLayout l)
    {
        var name = await PromptTextAsync("Rename layout", l.Name, "Layout name", "Rename");
        if (name is null) return;
        var o = (JsonObject)l.Json.DeepClone(); o["name"] = name;
        await ModelCallAsync("modelSaveLayout", o);
        await ReadModelAsync(); await RenderRailAsync();
    }

    private async Task DuplicateLayoutAsync(MLayout l)
    {
        var o = (JsonObject)l.Json.DeepClone(); o["id"] = ""; o["name"] = l.Name + " copy"; o.Remove("archived");
        var raw = await ModelCallAsync("modelSaveLayout", o);
        if (raw is not null && JsonNode.Parse(raw) is JsonObject r && r["value"] is JsonObject v && v["duplicateFlag"] is JsonValue f && f.TryGetValue<string>(out var flag) && flag.Length > 0)
            SetPill("Prism · saved: " + flag);
        await ReadModelAsync(); await RenderRailAsync();
    }

    // ------------------------------------------------ Facets
    private UIElement RailFacets()
    {
        var col = new StackPanel();
        col.Children.Add(RailHeader("Facets", "A facet is one face of an App - a page, a region and a zoom, cut for a slot class. Different pages are different facets; music facets are hidden-only and feed visualizations.",
            Primary("＋  New Facet", () => _ = NewFacetAsync(null, null))));
        if (_model.Facets.Count == 0) { col.Children.Add(Meta(_model.Apps.Count == 0 ? "No facets yet - add an App first (Apps → Add App), then cut a facet for a slot class." : "No facets yet - New Facet picks the App and the slot class.")); return col; }
        foreach (var group in _model.Facets.GroupBy(f => f.App).OrderBy(g => _model.App(g.Key)?.Name ?? g.Key))
        {
            var app = _model.App(group.Key);
            var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, 10, 0, 6) };
            head.Children.Add(new TextBlock { Text = app?.Name ?? group.Key, FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Amber, VerticalAlignment = VerticalAlignment.Center });
            if (app is not null) head.Children.Add(StatusBadgeFor(app));
            var add = Small("＋ facet", () => _ = NewFacetAsync(group.Key, null));
            head.Children.Add(add);
            col.Children.Add(head);
            var grid = CardGrid();
            foreach (var f in group.OrderBy(x => x.Label))
            {
                var body = new StackPanel { Spacing = 4 };
                body.Children.Add(CardTitle(f.Label));
                var badges = new StackPanel { Orientation = Orientation.Horizontal };
                badges.Children.Add(ClassBadge(f.SlotClass));
                if (f.Music) badges.Children.Add(new Border { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x30, 0xC8, 0x6C, 0xF0)), CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 1, 6, 1), Margin = new Thickness(0, 2, 0, 0), Child = new TextBlock { Text = "♪ music · hidden-only", FontSize = 10, Foreground = LeInk } });
                body.Children.Add(badges);
                body.Children.Add(Meta(Shorten(f.Url, 46)));
                var uses = _model.Scenes.Count(s => s.Assign.ContainsValue(f.Id) || s.Floating.Any(p => p["facet"]?.GetValue<string>() == f.Id) || s.Hidden.Any(h => h["facet"]?.GetValue<string>() == f.Id));
                if (uses > 0) body.Children.Add(Meta("in " + uses + " scene" + (uses == 1 ? "" : "s")));
                var fid = f.Id;
                grid.Children.Add(Card(body, 232, () => OpenRoute("prism://facet/" + Uri.EscapeDataString(fid) + "/edit"), () => FacetContextMenu(f)));
            }
            col.Children.Add(grid);
        }
        return col;
    }

    private MenuFlyout FacetContextMenu(MFacet f)
    {
        var m = new MenuFlyout { MenuFlyoutPresenterStyle = (Style)RootGrid.Resources["PrismMenuPresenter"] };
        m.Items.Add(Item("Edit…", "", null, () => OpenRoute("prism://facet/" + Uri.EscapeDataString(f.Id) + "/edit")));
        m.Items.Add(Item("App setup / sign in…", "", null, () => OpenRoute("prism://app/" + Uri.EscapeDataString(f.App) + "/setup")));
        m.Items.Add(new MenuFlyoutSeparator());
        m.Items.Add(Item("Rename…", null, null, async () =>
        {
            var label = await PromptTextAsync("Rename facet", f.Label, "Facet label", "Rename");
            if (label is null) return;
            var o = (JsonObject)f.Json.DeepClone(); o["label"] = label;
            await ModelCallAsync("modelSaveFacet", o);
            await ReadModelAsync(); await RenderRailAsync();
        }));
        m.Items.Add(Item("Duplicate", null, null, async () =>
        {
            var o = (JsonObject)f.Json.DeepClone(); o["id"] = ""; o["label"] = f.Label + " copy";
            await ModelCallAsync("modelSaveFacet", o);
            await ReadModelAsync(); await RenderRailAsync();
        }));
        m.Items.Add(new MenuFlyoutSeparator());
        var rm = Item("Remove facet", null, null, async () =>
        {
            var r = await ModelCallAsync("modelRemoveFacet", f.Id);
            if (r == "referenced") SetPill("Prism · " + f.Label + " is used by a scene. Swap it out there first (scenes keep working)");
            await ReadModelAsync(); await RenderRailAsync();
        });
        rm.Foreground = Danger;
        m.Items.Add(rm);
        return m;
    }

    /// <summary>"+ New Facet": pick the App (or add one), then the slot class from the classes real layouts define, then the editor.</summary>
    private async Task NewFacetAsync(string? appId, string? slotClass)
    {
        if (appId is null)
        {
            appId = await PickAppAsync("New facet - which App?");
            if (appId is null) return;
        }
        if (slotClass is null)
        {
            slotClass = await PickSlotClassAsync("New facet of " + (_model.App(appId)?.Name ?? appId) + " - for which slot class?");
            if (slotClass is null) return;
        }
        OpenRoute("prism://facets/new?app=" + Uri.EscapeDataString(appId) + "&class=" + Uri.EscapeDataString(slotClass));
    }

    /// <summary>Choose an App from the saved ones, or add one in place (catalog / any URL). Null = cancelled.</summary>
    private async Task<string?> PickAppAsync(string title)
    {
        var tcs = new TaskCompletionSource<string?>();
        var list = new StackPanel { Spacing = 4, MinWidth = 420 };
        var dlg = new ContentDialog { Title = title, Content = new ScrollViewer { Content = list, MaxHeight = 480 }, CloseButtonText = "Cancel", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        foreach (var a in _model.Apps.OrderBy(x => x.Name))
        {
            var id = a.Id;
            list.Children.Add(AppRow(a.Name, a.BaseUrl + "  ·  " + StatusWord(a), () => { tcs.TrySetResult(id); dlg.Hide(); }));
        }
        list.Children.Add(AppRow("＋  Add App…", "from the catalog or any URL", () => { dlg.Hide(); _ = AddAppAsync().ContinueWith(t => tcs.TrySetResult(t.Result)); }));
        try { await dlg.ShowAsync(); } catch { }
        tcs.TrySetResult(null);
        return await tcs.Task;
    }

    /// <summary>Slot classes that actually exist in saved layouts, with counts (spec §4), plus the template classes so a first facet is never blocked.</summary>
    private async Task<string?> PickSlotClassAsync(string title)
    {
        var tcs = new TaskCompletionSource<string?>();
        var list = new StackPanel { Spacing = 4, MinWidth = 420 };
        var dlg = new ContentDialog { Title = title, Content = new ScrollViewer { Content = list, MaxHeight = 480 }, CloseButtonText = "Cancel", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        var seen = new HashSet<string>();
        foreach (var (cls, n, custom) in _model.SlotClasses)
        {
            seen.Add(cls);
            var c = cls;
            list.Children.Add(AppRow(cls, "used in " + n + " layout" + (n == 1 ? "" : "s") + (custom ? "  ·  custom - limits facet reuse" : ""), () => { tcs.TrySetResult(c); dlg.Hide(); }));
        }
        foreach (var cls in new[] { "16:9·XL", "3:4·M", "4:3·M", "8:1-ticker·M", "16:9·M", "1:1·S" })
        {
            if (!seen.Add(cls)) continue;
            var c = cls;
            list.Children.Add(AppRow(cls, "no saved layout uses it yet (a template class)", () => { tcs.TrySetResult(c); dlg.Hide(); }));
        }
        try { await dlg.ShowAsync(); } catch { }
        tcs.TrySetResult(null);
        return await tcs.Task;
    }

    // ------------------------------------------------ Apps
    private UIElement RailApps()
    {
        var col = new StackPanel();
        col.Children.Add(RailHeader("Apps", "An App is a service identity: its address, its profile (the session that persists - never wiped) and its setup state. Setup mode opens the App full screen in a normal browsing view: sign in there, once.",
            Primary("＋  Add App", () => _ = AddAppAsync())));
        if (_model.Apps.Count == 0) { col.Children.Add(Meta("No Apps yet.")); return col; }
        var grid = CardGrid();
        foreach (var a in _model.Apps.OrderBy(x => x.SetupStatus == "needs-attention" ? 0 : 1).ThenBy(x => x.Name))
        {
            var body = new StackPanel { Spacing = 6 };
            var poster = new Grid { Height = 96, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x2A, 0x2F, 0x38)), CornerRadius = new CornerRadius(6) };
            poster.Children.Add(new TextBlock { Text = a.Name, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
            var img = new Image { Stretch = Stretch.UniformToFill };
            poster.Children.Add(img);
            _ = LoadAppPosterAsync(a, img, poster);
            body.Children.Add(poster);
            var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            titleRow.Children.Add(CardTitle(a.Name));
            titleRow.Children.Add(StatusBadgeFor(a));
            body.Children.Add(titleRow);
            var facets = _model.Facets.Count(f => f.App == a.Id);
            body.Children.Add(Meta(Shorten(a.BaseUrl, 40) + "  ·  profile " + a.ProfileId + "  ·  " + facets + " facet" + (facets == 1 ? "" : "s")));
            if (a.SetupStatus == "needs-attention")
            {
                var fix = Small("Sign in now →", () => OpenRoute(NeedsAttentionRoute(a.Id)));
                fix.Foreground = Danger;
                body.Children.Add(fix);
            }
            var aid = a.Id;
            grid.Children.Add(Card(body, 244, () => OpenRoute("prism://app/" + Uri.EscapeDataString(aid) + "/setup"), () => AppContextMenu(a)));
        }
        col.Children.Add(grid);
        return col;
    }

    private async Task LoadAppPosterAsync(MApp a, Image img, Grid poster)
    {
        try
        {
            var info = await _posters.GetAsync(a.Id, a.Name, a.BaseUrl);
            RootGrid.DispatcherQueue.TryEnqueue(() =>
            {
                if (info.ImagePath is { } path) { try { img.Source = new BitmapImage(new Uri(path)); } catch { } }
                else if (info.BackgroundColor is { } bg && bg.Length == 7 && bg[0] == '#')
                    poster.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, Convert.ToByte(bg.Substring(1, 2), 16), Convert.ToByte(bg.Substring(3, 2), 16), Convert.ToByte(bg.Substring(5, 2), 16)));
            });
        }
        catch { }
    }

    private MenuFlyout AppContextMenu(MApp a)
    {
        var m = new MenuFlyout { MenuFlyoutPresenterStyle = (Style)RootGrid.Resources["PrismMenuPresenter"] };
        m.Items.Add(Item("Setup mode (sign in, browse)…", "", null, () => OpenRoute("prism://app/" + Uri.EscapeDataString(a.Id) + "/setup")));
        m.Items.Add(Item("App settings…", "", null, () => OpenRoute("prism://app/" + Uri.EscapeDataString(a.Id) + "/settings")));
        m.Items.Add(Item("New facet of " + a.Name + "…", "", null, () => _ = NewFacetAsync(a.Id, null)));
        m.Items.Add(new MenuFlyoutSeparator());
        m.Items.Add(Item("Rename…", null, null, async () =>
        {
            var name = await PromptTextAsync("Rename App", a.Name, "App name", "Rename");
            if (name is null) return;
            var o = (JsonObject)a.Json.DeepClone(); o["name"] = name;
            await ModelCallAsync("modelSaveApp", o);
            await ReadModelAsync(); await RenderRailAsync();
        }));
        return m;
    }

    /// <summary>"+ Add App": the catalog (§31 poster grid) or any URL → an App record (its own profile) → setup mode. Returns the App id.</summary>
    private async Task<string?> AddAppAsync(string? presetUrl = null)
    {
        var tcs = new TaskCompletionSource<string?>();
        var body = new StackPanel { Spacing = 8, MinWidth = 460 };
        body.Children.Add(new TextBlock { Text = "From the catalog", FontSize = 12, Foreground = LeDim });
        var grid = new FlowPanel { HorizontalSpacing = 6, VerticalSpacing = 6 };
        var dlg = new ContentDialog { Title = "Add App", CloseButtonText = "Cancel", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        foreach (var e in _catalog)
        {
            var entry = e;
            var b = new Button { Content = entry.Name + (entry.Badge.Length > 0 ? "  ·  " + entry.Badge : ""), Padding = new Thickness(10, 6, 10, 6) };
            b.Click += async (_, __) => { dlg.Hide(); tcs.TrySetResult(await SaveAppFromCatalogAsync(entry)); };
            grid.Children.Add(b);
        }
        body.Children.Add(grid);
        body.Children.Add(new TextBlock { Text = "Any URL", FontSize = 12, Foreground = LeDim, Margin = new Thickness(0, 8, 0, 0) });
        var url = new TextBox { Text = presetUrl ?? "", PlaceholderText = "https://…" };
        var go = new Button { Content = "Add this website", Padding = new Thickness(10, 6, 10, 6) };
        go.Click += async (_, __) =>
        {
            if (!IsHttpUrl(url.Text)) { SetPill("Prism · http(s) addresses only"); return; }
            dlg.Hide();
            tcs.TrySetResult(await SaveAppFromUrlAsync(new Uri(url.Text.Trim()).ToString()));
        };
        body.Children.Add(url);
        body.Children.Add(go);
        dlg.Content = new ScrollViewer { Content = body, MaxHeight = 520 };
        try { await dlg.ShowAsync(); } catch { }
        tcs.TrySetResult(null);
        var id = await tcs.Task;
        if (id is not null) OpenRoute("prism://app/" + Uri.EscapeDataString(id) + "/setup?return=scene");
        return id;
    }

    /// <summary>An App from a catalog entry: id = catalog id (adapter key, so the profile folder lines up), profile = id.</summary>
    private async Task<string?> SaveAppFromCatalogAsync(HostCatalogEntry entry)
    {
        if (_model.App(entry.Id) is not null) return entry.Id;
        // docs/concept-scenes.md §1/§6: an App with nothing to sign in to (the
        // first-party micro-facets) is set up the moment it is added - it must
        // never sit in the rail wearing a "needs attention" badge for an account
        // that does not exist.
        var noAccount = CatalogSaysNoAccount(entry.Json);
        // services that sign in with one account share a profile (core's rule, player-setup profileFor): one sign-in serves them
        var profile = entry.Id;
        try
        {
            var one = WelcomeEntriesJson(e => e.Id == entry.Id);
            var asked = (await ModelCallAsync("playerProfileFor", JsonNode.Parse(one) is JsonArray { Count: > 0 } arr ? arr[0]!.ToJsonString() : "{}", WelcomeEntriesJson()))?.Trim().Trim('"');
            if (asked is { Length: > 0 }) profile = asked;
        }
        catch { }
        var app = new JsonObject
        {
            ["id"] = entry.Id, ["name"] = entry.Name, ["baseUrl"] = entry.Url, ["profileId"] = profile, ["catalogRef"] = entry.Id,
            ["setup"] = noAccount
                ? new JsonObject { ["status"] = "signed-in", ["lastVerified"] = DateTime.Now.ToString("yyyy-MM-dd") }
                : new JsonObject { ["status"] = "unknown" },
        };
        if (entry.Adapter.Length > 0) app["adapter"] = entry.Adapter;
        try
        {
            using var doc = JsonDocument.Parse(entry.Json);
            var render = new JsonObject();
            if (doc.RootElement.TryGetProperty("audio", out var au) && au.ValueKind == JsonValueKind.String) render["audio"] = au.GetString();
            if (render.Count > 0) app["render"] = render;
        }
        catch { }
        var raw = await ModelCallAsync("modelSaveApp", app);
        await ReadModelAsync();
        return raw is not null && raw.Contains("\"ok\":true") ? entry.Id : null;
    }

    private async Task<string?> SaveAppFromUrlAsync(string url)
    {
        var host = new Uri(url).Host.Replace("www.", "");
        var slug = new string(host.Select(c => char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : '-').ToArray()).Trim('-');
        var id = slug; for (var n = 2; _model.App(id) is not null; n++) id = slug + "-" + n;
        var name = host.Split('.').FirstOrDefault() is { Length: > 0 } first ? char.ToUpperInvariant(first[0]) + first[1..] : host;
        var app = new JsonObject { ["id"] = id, ["name"] = name, ["baseUrl"] = url, ["profileId"] = id, ["setup"] = new JsonObject { ["status"] = "unknown" } };
        var raw = await ModelCallAsync("modelSaveApp", app);
        await ReadModelAsync();
        return raw is not null && raw.Contains("\"ok\":true") ? id : null;
    }

    // ------------------------------------------------ Device
    /// <summary>The media hub switch's state in words, for the Device page (2026-10-06).</summary>
    private static string MediaHubStateLine(bool on) => on
        ? "Remote Desktop Support: On. When a remote desktop leaves, Prism keeps its sound and its screen."
        : "Remote Desktop Support: Off. A remote desktop that leaves takes Prism's sound and screen until someone signs in at the PC.";

    private UIElement RailDevice()
    {
        var col = new StackPanel { Spacing = 8 };
        var (cw, ch) = WallSize();
        col.Children.Add(RailHeader("Device", "This frame: its canvas class, schedules, remotes, audio, kiosk and updates. Nothing here leaves the device."));
        col.Children.Add(Section("CANVAS"));
        col.Children.Add(new TextBlock { Text = CanvasClassLabel(cw, ch) + $"   ·   {cw:0} × {ch:0} logical px", Foreground = LeInk, FontSize = 14 });
        col.Children.Add(Meta("Layouts authored for this class run here exactly; the Layouts picker filters to it by default."));
        col.Children.Add(Section("SCHEDULES"));
        var scheduled = _model.Scenes.Where(s => s.Schedule.Count > 0).ToList();
        if (scheduled.Count == 0) col.Children.Add(Meta("No schedules. Schedules belong to scenes: open a scene → Schedule → \"Show this scene at…\"."));
        foreach (var s in scheduled)
            foreach (var e in s.Schedule)
                col.Children.Add(new TextBlock { Text = (e["at"]?.GetValue<string>() ?? "?") + "   " + (e["action"]?.GetValue<string>() ?? "") + "   " + s.Name, Foreground = LeInk, FontSize = 13, FontFamily = new FontFamily("Consolas") });
        col.Children.Add(Section("REMOTES"));
        col.Children.Add(Meta("Phone pairing (the QR, the now-playing card, the same tap and context-sheet actions per item) lands with the remote API parity work (SM-4). Core mints the token; this page will show the QR."));
        col.Children.Add(Section("AUDIO"));
        var audioRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        audioRow.Children.Add(Small("Mute everything", async () => { var wall = await ReadWallStateAsync(); foreach (var t in wall.Tiles) _brain.Call(HostCalls.TileCommand, t.Id, "mute"); }));
        var vizTest = new ToggleButton { Content = "Visualization test signal", IsChecked = _vizTestSignal, Padding = new Thickness(10, 5, 10, 5) };
        vizTest.Click += (_, __) => SetVisualizationTestSignal(vizTest.IsChecked == true);
        // The dev readout along the bottom edge (viewport rects, EME probe results,
        // brain state). Off on a product wall - it covered the visualization's own
        // progress bar - and one toggle away when something needs watching.
        // A wall is an appliance: the desktop's reduced-motion setting is the
        // default here, not the law. With it on, the renderer runs at 10fps with
        // no beat and clamped attack/release, and a lively band feed draws flat.
        var fullMotion = new ToggleButton { Content = "Full motion (ignore system reduced-motion)", IsChecked = PrismHost.Surfaces.Visualization.VisualizationHost.ForceFullMotion, Padding = new Thickness(10, 5, 10, 5) };
        ToolTipService.SetToolTip(fullMotion, "On by default, since a wall isn't an accessibility surface. Off honours Windows' reduced-motion setting (10 fps, no beat, clamped attack). Remembered on this machine. PRISM_FULL_MOTION=0/1 overrides it.");
        fullMotion.Click += (_, __) => { var on = fullMotion.IsChecked == true; PrismHost.Surfaces.Visualization.VisualizationHost.ForceFullMotion = on; HostPrefs.Set("fullMotion", on); };

        var diagLine = new ToggleButton { Content = "Diagnostics on the wall", IsChecked = StatusLine.Visibility == Visibility.Visible, Padding = new Thickness(10, 5, 10, 5) };
        ToolTipService.SetToolTip(diagLine, "Show the viewport / brain-state readout along the bottom of the wall. It is written to host.log either way.");
        diagLine.Click += (_, __) => StatusLine.Visibility = diagLine.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
        audioRow.Children.Add(vizTest);
        audioRow.Children.Add(diagLine);
        audioRow.Children.Add(fullMotion);
        col.Children.Add(audioRow);
        col.Children.Add(Meta("Boot is silent; the first human play lifts exactly the facet it happened in (§3). The test signal drives visualizations without audio, for development; the WASAPI feed replaces it when the source plays."));
        col.Children.Add(Section("KIOSK"));
        col.Children.Add(Small(_wallFs ? "Exit full-screen wall  (F11)" : "Full-screen wall  (F11)", ToggleWallFullscreen));
        // the media hub switch in the options (2026-10-06, "It does need to be available to be turned off in some options screen"): its state as
        // Windows has it (the task's existence), and the same dialog as the Prism menu's item to turn it off or on (docs/features/media-hub.md)
        // the phone's firewall rule beside it (2026-10-06, Services/DeviceSetup): set at first run on Set up services, checked and set again here
        col.Children.Add(Section("PHONE REMOTE"));
        var fwIn = Services.DeviceSetup.FirewallRuleInPlace();
        col.Children.Add(new TextBlock { Text = fwIn ? "Windows Firewall lets phones on your home network reach Prism (port " + Services.DeviceSetup.RemotePort + ", the installed Prism only)." : "Windows Firewall has no rule for Prism's phone remote yet, so Windows may ask the first time a phone connects.", Foreground = LeInk, FontSize = 14, TextWrapping = TextWrapping.Wrap });
        if (!fwIn) col.Children.Add(Small("Allow phones through Windows Firewall" + (char)0x2026, async () => { var ok = await Services.DeviceSetup.SetUpAsync(true, false, LogLine); SetPill("Prism" + Mid + (ok ? "phones can reach Prism" : "Windows did not allow it. Nothing changed.")); if (_railSection == "device") await RenderRailAsync(); }));
        col.Children.Add(Section("REMOTE DESKTOP SUPPORT"));
        var hubState = new TextBlock { Text = MediaHubStateLine(Services.MediaHub.On), Foreground = LeInk, FontSize = 14, TextWrapping = TextWrapping.Wrap };
        col.Children.Add(hubState);
        col.Children.Add(Meta("When a Remote Desktop connection to this PC is closed, Windows takes the sound and the screen away from this sign-in. With this on, a scheduled task puts the session back on the PC's own screen, so Prism carries on. The PC's screen then shows the desktop signed in."));
        col.Children.Add(Small(Services.MediaHub.On ? "Turn off" + (char)0x2026 : "Turn on" + (char)0x2026, async () => { await ToggleMediaHubAsync(); if (_railSection == "device") await RenderRailAsync(); }));
        _ = Services.MediaHub.RefreshAsync(force: true).ContinueWith(t => DispatcherQueue.TryEnqueue(() => hubState.Text = MediaHubStateLine(t.Result)));
        col.Children.Add(Section("SHORTCUTS"));
        col.Children.Add(new TextBlock { Text = ShortcutsLine(), Foreground = LeInk, FontSize = 14, TextWrapping = TextWrapping.Wrap });
        col.Children.Add(Small("Choose shortcuts" + (char)0x2026, async () => { await AskShortcutsAsync(false); if (_railSection == "device") await RenderRailAsync(); }));
        col.Children.Add(Section("RESET"));
        var resetRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        resetRow.Children.Add(Small("Reset to defaults…", () => _ = ResetToDefaultsAsync()));
        resetRow.Children.Add(Small("Restore a backup…", () => _ = RestoreBackupAsync()));
        col.Children.Add(resetRow);
        col.Children.Add(Meta("Reset moves everything this wall knows - scenes, layouts, facets, Apps and their sign-ins - into a dated backup folder beside the store and restarts empty, at the New scene wizard. Nothing is deleted (§10); Restore brings a backup back the same way."));
        col.Children.Add(Section("UPDATES & ABOUT"));
        var about = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        about.Children.Add(Small("About Prism…", () => _ = ShowAboutAsync()));
        about.Children.Add(Small("Open diagnostics folder", () => OpenPath(Path.Combine(_store.Root, "diagnostics"), ensureDir: true)));
        col.Children.Add(about);
        col.Children.Add(Meta("Update checks are unparameterized (§22): the same URL for every device, nothing appended."));
        return col;
    }

    /// <summary>A wrapping panel (WinUI ships none without the toolkit): children flow left to right, wrapping at the width.</summary>
    private sealed class FlowPanel : Panel
    {
        public double HorizontalSpacing { get; set; } = 8;
        public double VerticalSpacing { get; set; } = 8;

        protected override Windows.Foundation.Size MeasureOverride(Windows.Foundation.Size available)
        {
            double x = 0, y = 0, rowH = 0, width = 0;
            var maxW = double.IsInfinity(available.Width) ? double.MaxValue : available.Width;
            foreach (var child in Children)
            {
                child.Measure(new Windows.Foundation.Size(maxW, double.PositiveInfinity));
                var d = child.DesiredSize;
                if (x > 0 && x + d.Width > maxW) { y += rowH + VerticalSpacing; x = 0; rowH = 0; }
                x += d.Width + HorizontalSpacing;
                rowH = Math.Max(rowH, d.Height);
                width = Math.Max(width, x - HorizontalSpacing);
            }
            return new Windows.Foundation.Size(double.IsInfinity(available.Width) ? width : Math.Min(width, available.Width), y + rowH);
        }

        protected override Windows.Foundation.Size ArrangeOverride(Windows.Foundation.Size final)
        {
            double x = 0, y = 0, rowH = 0;
            foreach (var child in Children)
            {
                var d = child.DesiredSize;
                if (x > 0 && x + d.Width > final.Width) { y += rowH + VerticalSpacing; x = 0; rowH = 0; }
                child.Arrange(new Windows.Foundation.Rect(x, y, d.Width, d.Height));
                x += d.Width + HorizontalSpacing;
                rowH = Math.Max(rowH, d.Height);
            }
            return final;
        }
    }
}
