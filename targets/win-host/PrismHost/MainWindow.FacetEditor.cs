using System.Globalization;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// The Facet editor (docs/scene-model-spec.md §4, dashboard-schema §31):
/// App → slot class (from the classes that exist in saved Layouts, with
/// counts) → the App's surface popped out with a box at the class's
/// representative shape → region: tap an element (hover outline, tap records
/// a stable selector - core's picker) or draw a box (the viewfinder box), or
/// the whole page → zoom (the aspect hint follows the framed region) → label
/// → modelSaveFacet. Catalog facet presets for the class appear as chips.
/// A page landing on a login redirect flips the App to "needs attention".
/// Entry point for the rail / context sheet: OpenFacetEditor(appId, slotClass?, facetId?).
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _facetEditor;          // the class chooser overlay (step 1) - null once the session runs on the pop-out
    private bool _feSession;             // the pop-out session is live (its chrome is the viewfinder host + _vfFloat)
    private ModelApp? _feApp;
    private ModelFacet? _feFacet;
    private string _feClass = "";
    private string? _feTile;
    private string? _feSelector;         // §31 tap: the recorded selector (null = box / whole page)
    private bool _feWhole;
    private string? _feAspectHint;
    private TextBox? _feLabel, _feAddress;
    private TextBlock? _feStatus, _feRegion;
    private StackPanel? _fePresets;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _fePickTimer;
    private bool _feAddressEdited, _feAddressSyncing;

    /// <summary>Open the Facet editor for an App; with a class it skips the chooser, with a facet id it edits that facet.</summary>
    public async void OpenFacetEditor(string appId, string? slotClass = null, string? facetId = null)
    {
        CloseFacetEditor();
        CloseAppSetup();
        CloseRail(); StepWizardAside(true);   // same reason as App setup: the rail's full-screen overlay would cover this editor's live preview surface
        if (_viewfinder is not null) CancelViewfinder();
        var st = await ModelStateAsync();
        var app = st?.Apps.FirstOrDefault(a => a.Id == appId);
        if (app is null) { SetPill("Prism · App \"" + appId + "\" isn't saved yet. Add it under Apps first"); EditorClosed("facet", null, saved: false); return; }
        var facet = facetId is null ? null : st!.Facets.FirstOrDefault(f => f.Id == facetId && f.App == appId);
        var cls = slotClass ?? facet?.SlotClass;
        if (cls is not null) { await BeginFacetSessionAsync(app, cls, facet); return; }
        ShowFacetClassChooser(app, st!, facet);
    }

    // ------------------------------------------------ step 1: the slot class (from real Layouts, with counts)
    private void ShowFacetClassChooser(ModelApp app, ModelState st, ModelFacet? facet)
    {
        var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xEE, 0x0F, 0x12, 0x16)) };
        Canvas.SetZIndex(overlay, 900);
        overlay.PointerPressed += (_, e) => { if (ReferenceEquals(e.OriginalSource, overlay)) { CancelFacetEditor(); e.Handled = true; } };
        var panel = new StackPanel { Width = 560, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, Spacing = 10, Padding = new Thickness(22), Background = LePanel, CornerRadius = new CornerRadius(12), BorderBrush = Amber, BorderThickness = new Thickness(1) };
        panel.Children.Add(new TextBlock { Text = (facet is null ? "New Facet of " : "Edit Facet of ") + app.Name, FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        panel.Children.Add(new TextBlock
        {
            Text = "A Facet is one face of an App: a page, a region and a zoom, cut for a slot class. Pick the class it's for. These are the classes your saved Layouts actually contain. Esc closes.",
            FontSize = 12, Foreground = LeDim, TextWrapping = TextWrapping.Wrap,
        });
        var list = new StackPanel { Spacing = 4 };
        var classes = st.SlotClasses.ToList();
        if (facet is not null && classes.All(c => c.Class != facet.SlotClass)) classes.Insert(0, new SlotClassCount(facet.SlotClass, 0, false));
        if (classes.Count == 0)
        {
            list.Children.Add(new TextBlock { Text = "No Layouts yet. A Facet is cut for a slot class, and classes come from Layouts.", FontSize = 13, Foreground = LeInk, TextWrapping = TextWrapping.Wrap });
            list.Children.Add(AppRow("Open the Layout editor…", "make a Layout first; its Slots define the classes", () => { CloseFacetEditor(); OpenLayoutEditor(null); }));
        }
        foreach (var c in classes)
        {
            var cc = c;
            var used = c.Layouts == 0 ? "not in any saved Layout" + (facet is not null && c.Class == facet.SlotClass ? " (this Facet's class)" : "") : c.Layouts == 1 ? "used in 1 layout" : "used in " + c.Layouts + " layouts";
            list.Children.Add(AppRow(c.Class + "  —  " + used, c.Custom ? "custom — limits facet reuse" : "aspect bucket · size tier", () => { CloseFacetEditor(); _ = BeginFacetSessionAsync(app, cc.Class, facet); }));
        }
        panel.Children.Add(new ScrollViewer { Content = list, MaxHeight = 480, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        overlay.Children.Add(panel);
        RootGrid.Children.Add(overlay);
        _facetEditor = overlay;
    }

    // ------------------------------------------------ step 2: the session on the App's popped-out surface
    private async Task BeginFacetSessionAsync(ModelApp app, string slotClass, ModelFacet? facet)
    {
        var tile = await EnsureAppSurfaceAsync(app, facet?.Url);
        if (tile is null) { SetPill("Prism · " + app.Name + " has no live surface to cut from. Try again once it's up"); EditorClosed("facet", null, saved: false); return; }
        if (_viewfinder is not null) CancelViewfinder();
        _feApp = app; _feFacet = facet; _feClass = slotClass; _feTile = tile; _feSelector = null; _feWhole = false; _feAspectHint = null; _feSession = true;
        _vfMode = "facet";
        _vfTile = tile;
        _vfZoom = facet?.Zoom > 0 ? facet.Zoom : 1;
        _vfPicking = false; _vfPlaced = false; _vfControlsHidden = false; _vfShape = null;

        // B-41: the App's preview surface is already full window (z 900) in its profile, natural layout; core opened it at the facet's page
        _ = _surfaces.SetViewportAsync(tile, 0, 0);

        // the box at the class's representative shape on this window (core's shape)
        var ratio = await ClassRatioAsync(slotClass) ?? 16 / 9.0;
        _vfAspect = ratio; _vfSlotAspect = ratio;
        var rep = await RepresentativeRectAsync(slotClass, _w, _h);
        var host = CreateViewfinderHost(tile, rep?.W ?? Math.Min(_w * 0.5, _h * 0.5 * ratio));
        Canvas.SetZIndex(host, 901);                                   // above the preview surface (z 900) so the box and the pick land on it
        _vfCenter = new Windows.Foundation.Point(_w / 2, _h / 2);

        var panelBg = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE6, 0x12, 0x13, 0x1A));
        var floatHost = new Grid();
        Canvas.SetZIndex(floatHost, 998);
        var dock = new StackPanel { Spacing = 6, Width = 320 };

        // PAGE
        dock.Children.Add(new TextBlock { Text = "PAGE", Foreground = Muted, FontSize = 11, Opacity = 0.8, Margin = new Thickness(2, 0, 0, 0) });
        var addressRow = new Grid { ColumnSpacing = 6 };
        addressRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        addressRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _feAddress = new TextBox { Text = facet?.Url ?? _surfaces.SourceOf(tile) ?? app.BaseUrl, PlaceholderText = "https://…", FontSize = 12 };
        _feAddressEdited = false;
        _feAddress.TextChanged += (_, __) => { if (!_feAddressSyncing) _feAddressEdited = true; };
        var go = new Button { Content = "Go", Padding = new Thickness(10, 4, 10, 4) };
        Grid.SetColumn(go, 1);
        void GoAddress() { if (_feTile is { } t && IsHttpUrl(_feAddress!.Text)) { _surfaces.Navigate(t, new Uri(_feAddress.Text.Trim()).ToString()); _feAddressEdited = false; } else SetPill("Prism · http(s) addresses only"); }
        go.Click += (_, __) => GoAddress();
        _feAddress.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) { e.Handled = true; GoAddress(); } };
        ToolTipService.SetToolTip(_feAddress, "The page this Facet shows. Navigate freely (the page is live, so scroll and click) or type an address and press Go. The page at save time is the Facet's page.");
        addressRow.Children.Add(_feAddress);
        addressRow.Children.Add(go);
        dock.Children.Add(addressRow);

        // PRESETS (catalog facetPresets for this class, by name through the adapter's table - core resolves)
        _fePresets = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        dock.Children.Add(_fePresets);
        _ = FillFacetPresetChipsAsync(app, slotClass);

        // REGION
        dock.Children.Add(new TextBlock { Text = "REGION  ·  " + slotClass, Foreground = Muted, FontSize = 11, Opacity = 0.8, Margin = new Thickness(2, 8, 0, 0) });
        Button DockButton(string text) => new() { Content = text, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 6, 12, 6) };
        var pickEl = DockButton("☞  Tap an element");
        var drawBox = DockButton("⌗  Draw a box");
        var whole = DockButton("▭  Whole page");
        ToolTipService.SetToolTip(pickEl, "Hover the page: the element under the pointer is outlined with its selector; tap to record it. The Facet follows that element wherever it moves (spec 17); the box shows its size now.");
        ToolTipService.SetToolTip(drawBox, "A box in the class's shape follows the pointer (wheel sizes it); click to place. What's inside is what the Facet shows, a fixed rectangle of this page layout.");
        ToolTipService.SetToolTip(whole, "No region: the Facet shows the page at its slot's size.");
        pickEl.Click += (_, __) => _ = StartElementPickAsync();
        drawBox.Click += (_, __) => { StopElementPick(); _feSelector = null; _feWhole = false; SetViewfinderPicking(!_vfPicking); UpdateFacetRegionReadout(); };
        whole.Click += (_, __) => { StopElementPick(); _feSelector = null; _feWhole = true; _vfPlaced = false; SetViewfinderPicking(false); if (_vfBox is not null) _vfBox.Visibility = Visibility.Collapsed; UpdateFacetRegionReadout(); };
        dock.Children.Add(pickEl);
        dock.Children.Add(drawBox);
        dock.Children.Add(whole);
        _feRegion = new TextBlock { Foreground = Amber, FontSize = 12, FontFamily = new FontFamily("Consolas"), TextWrapping = TextWrapping.Wrap };
        dock.Children.Add(_feRegion);

        // LABEL + SAVE
        dock.Children.Add(new TextBlock { Text = "LABEL", Foreground = Muted, FontSize = 11, Opacity = 0.8, Margin = new Thickness(2, 8, 0, 0) });
        _feLabel = new TextBox { Text = facet?.Label ?? "", PlaceholderText = "e.g. Live TV guide, Current conditions", FontSize = 12 };
        dock.Children.Add(_feLabel);
        var saveBtn = DockButton("✓  Save Facet");
        saveBtn.Background = Amber; saveBtn.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x12, 0x13, 0x1A));
        ToolTipService.SetToolTip(saveBtn, "Saves {App, page, slot class, region, zoom, label} into the scene model. Scenes then offer this Facet for every compatible Slot.");
        saveBtn.Click += (_, __) => _ = SaveFacetAsync();
        var cancel = DockButton("Cancel  (Esc)");
        ToolTipService.SetToolTip(cancel, "Back to the scene; nothing saved. The App keeps its session either way.");
        cancel.Click += (_, __) => CancelFacetEditor();
        dock.Children.Add(saveBtn);
        dock.Children.Add(cancel);
        _feStatus = new TextBlock { Foreground = LeDim, FontSize = 11, TextWrapping = TextWrapping.Wrap };
        dock.Children.Add(_feStatus);

        floatHost.Children.Add(FloatingPanel("Facet · " + app.Name + " · " + slotClass, dock, panelBg, HorizontalAlignment.Left, VerticalAlignment.Top, new Thickness(16, 44, 0, 0)));
        _vfZoomPanel = FloatingZoomPanel(panelBg);
        floatHost.Children.Add(_vfZoomPanel);
        _vfFloat = floatHost;
        RootGrid.Children.Add(floatHost);

        // an existing facet's focus: its selector re-verified on the page, or its zoom / whole-page state
        if (facet is not null)
        {
            try
            {
                using var d = JsonDocument.Parse(facet.Json);
                if (d.RootElement.TryGetProperty("focus", out var fo) && fo.ValueKind == JsonValueKind.Object && StrOf(fo, "selector") is { } sel) _ = AdoptSelectorAsync(sel);
                else if (!facet.HasRegion) _feWhole = true;
                if (StrOf(d.RootElement, "aspectHint") is { } ah) _feAspectHint = ah;
            }
            catch { }
        }
        if (Math.Abs(_vfZoom - 1) > 0.001) SetViewfinderZoom(_vfZoom);
        UpdateFacetRegionReadout();
        cancel.Focus(FocusState.Programmatic);
        _ = host;
    }

    private async Task FillFacetPresetChipsAsync(ModelApp app, string slotClass)
    {
        if (_fePresets is null) return;
        var entry = CatalogFor(app);
        if (entry is null) return;
        var raw = await ModelEvalAsync("modelFacetPresets", "facetPresets", Q(entry.Json) + "," + Q(slotClass));
        if (raw is null || _fePresets is null) return;
        try
        {
            using var d = JsonDocument.Parse(raw);
            if (d.RootElement.ValueKind != JsonValueKind.Array || d.RootElement.GetArrayLength() == 0) return;
            _fePresets.Children.Add(new TextBlock { Text = "preset", Foreground = Muted, FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(2, 0, 4, 0) });
            foreach (var p in d.RootElement.EnumerateArray())
            {
                var id = StrOf(p, "id") ?? ""; var label = StrOf(p, "label") ?? id; var notes = StrOf(p, "notes");
                var chip = new Button { Content = label, Padding = new Thickness(8, 2, 8, 2), FontSize = 11 };
                ToolTipService.SetToolTip(chip, "Catalog preset for " + slotClass + ": page, region and zoom tuned for this class." + (notes is null ? "" : " " + notes));
                chip.Click += (_, __) => _ = ApplyFacetPresetAsync(entry, id);
                _fePresets.Children.Add(chip);
            }
        }
        catch { }
    }

    /// <summary>A preset chip: core resolves it to a plain facet (selector by NAME through the adapter table); the editor adopts its page, region, zoom and label.</summary>
    private async Task ApplyFacetPresetAsync(HostCatalogEntry entry, string presetId)
    {
        if (_feApp is null || _feTile is null) return;
        var raw = await ModelEvalAsync("modelPresetFacet", "presetFacet", Q(entry.Json) + "," + Q(presetId) + "," + Q(_feApp.Id) + "," + Q(_feClass) + "," + Q(SelectorTableJson(entry.Adapter)) + "," + Q(_feFacet?.Id));
        if (raw is null || raw == "null") { SetPill("Prism · that preset could not be resolved"); return; }
        try
        {
            using var d = JsonDocument.Parse(raw);
            var r = d.RootElement;
            var url = StrOf(r, "url");
            if (url is not null && IsHttpUrl(url) && url != (_surfaces.SourceOf(_feTile) ?? "")) { _surfaces.Navigate(_feTile, url); if (_feAddress is not null) { _feAddressSyncing = true; _feAddress.Text = url; _feAddressSyncing = false; _feAddressEdited = false; } }
            if (_feLabel is not null && string.IsNullOrWhiteSpace(_feLabel.Text)) _feLabel.Text = StrOf(r, "label") ?? "";
            if (r.TryGetProperty("zoom", out var z) && z.ValueKind == JsonValueKind.Number) SetViewfinderZoom(z.GetDouble()); else SetViewfinderZoom(1);
            _feAspectHint = StrOf(r, "aspectHint");
            var sel = r.TryGetProperty("focus", out var fo) && fo.ValueKind == JsonValueKind.Object ? StrOf(fo, "selector") : null;
            if (sel is null) { _feSelector = null; _feWhole = true; _vfPlaced = false; if (_vfBox is not null) _vfBox.Visibility = Visibility.Collapsed; UpdateFacetRegionReadout(); }
            else
            {
                // the page may still be loading: verify the selector a few times before giving up
                for (var attempt = 0; attempt < 12; attempt++)
                {
                    if (await AdoptSelectorAsync(sel, quiet: attempt < 11)) break;
                    await Task.Delay(500);
                    if (_feTile is null) return;
                }
            }
            SetPill("Prism · preset " + presetId + " applied. Adjust, then Save Facet");
        }
        catch (Exception ex) { SetStatus("preset: " + ex.Message); }
    }

    // ------------------------------------------------ §31 region pick: tap an element
    private async Task StartElementPickAsync()
    {
        if (_feTile is null) return;
        StopElementPick();
        SetViewfinderPicking(false);
        var js = await FacetPickerJsAsync();
        if (js is null) { SetPill("Prism · the element picker is unavailable (core's model-eval bundle is missing). Draw a box instead"); return; }
        var res = await _surfaces.EvalOnTileAsync(_feTile, js);
        if (res is not null && res.StartsWith("__prism_eval_error")) { SetPill("Prism · " + res); return; }
        if (_feStatus is not null) _feStatus.Text = "Hover the page and the element under the pointer is outlined with its selector. Tap to record it, or press Esc on the page to cancel.";
        var poll = await ModelEvalAsync("modelFacetPickPollJs", "facetPickPollJs", "") ?? "JSON.stringify(window.__prismFacetPick||null)";
        var t = RootGrid.DispatcherQueue.CreateTimer();
        t.Interval = TimeSpan.FromMilliseconds(150);
        t.IsRepeating = true;
        t.Tick += async (_, __) =>
        {
            if (_feTile is null || !_feSession) { StopElementPick(); return; }
            var raw = Unwrap(await _surfaces.EvalOnTileAsync(_feTile, poll));
            if (raw is null || raw == "null" || raw.StartsWith("__prism_eval_error")) return;
            StopElementPick();
            try
            {
                using var d = JsonDocument.Parse(raw);
                var r = d.RootElement;
                var sel = StrOf(r, "selector");
                var unique = BoolOf(r, "unique");
                if (sel is not null && unique) { await AdoptSelectorAsync(sel); return; }
                // no stable unique selector: fall back to the element's rectangle as a drawn box (spec 31: drag-rect fallback)
                if (r.TryGetProperty("client", out var c) && c.ValueKind == JsonValueKind.Object) { PlaceBoxAtClient(Num(c, "x"), Num(c, "y"), Num(c, "w"), Num(c, "h")); _feSelector = null; _feWhole = false; }
                SetPill("Prism · that element has no stable selector, so its rectangle is used as a box instead");
                UpdateFacetRegionReadout();
            }
            catch (Exception ex) { SetStatus("pick: " + ex.Message); }
        };
        t.Start();
        _fePickTimer = t;
    }

    private void StopElementPick()
    {
        if (_fePickTimer is { } t) { t.Stop(); _fePickTimer = null; }
        if (_feTile is { } tile) _ = StopPickOnPageAsync(tile);
        if (_feStatus is not null && _feStatus.Text.StartsWith("Hover")) _feStatus.Text = "";
    }

    private async Task StopPickOnPageAsync(string tile)
    {
        var js = await ModelEvalAsync("modelFacetPickStopJs", "facetPickStopJs", "") ?? "(function(){if(window.__prismFacetPickStop)window.__prismFacetPickStop();return true;})()";
        await _surfaces.EvalOnTileAsync(tile, js);
    }

    /// <summary>Record a selector: verified on the page to resolve to exactly one element; the box shows that element's rectangle now.</summary>
    private async Task<bool> AdoptSelectorAsync(string selector, bool quiet = false)
    {
        if (_feTile is null) return false;
        var verify = await ModelEvalAsync("modelSelectorRectJs", "selectorRectJs", Q(selector));
        if (verify is null) return false;
        var raw = Unwrap(await _surfaces.EvalOnTileAsync(_feTile, verify));
        if (raw is null || raw.StartsWith("__prism_eval_error")) return false;
        try
        {
            using var d = JsonDocument.Parse(raw);
            var count = d.RootElement.TryGetProperty("count", out var c) && c.ValueKind == JsonValueKind.Number ? c.GetInt32() : 0;
            if (count != 1)
            {
                if (!quiet) SetPill("Prism · selector matches " + count + " elements right now, so it wasn't used");
                return false;
            }
            _feSelector = selector; _feWhole = false;
            var rc = d.RootElement.GetProperty("rect");
            // document px → the box: fetch the scroll and place at the client rect
            var scrollRaw = Unwrap(await _surfaces.EvalOnTileAsync(_feTile, "JSON.stringify([window.scrollX,window.scrollY])"));
            double sx = 0, sy = 0;
            try { if (scrollRaw is not null) { using var a = JsonDocument.Parse(scrollRaw); sx = a.RootElement[0].GetDouble(); sy = a.RootElement[1].GetDouble(); } } catch { }
            PlaceBoxAtClient(Num(rc, "x") - sx, Num(rc, "y") - sy, Num(rc, "w"), Num(rc, "h"));
            UpdateFacetRegionReadout();
            return true;
        }
        catch { return false; }
    }

    /// <summary>Show the box around a page rectangle given in the page's client (viewport) px; the aspect hint follows the framed region.</summary>
    private void PlaceBoxAtClient(double cx, double cy, double cw, double ch)
    {
        if (_vfBox is null || _feTile is null || cw <= 0 || ch <= 0) return;
        var (_, _, fit, bodyScaled) = _surfaces.LayoutOf(_feTile);
        var scale = bodyScaled ? 1 : fit;   // body-scale mode: client px are already view px; XAML mode: view = layout × fit
        var off = _surfaces.RectOf(_feTile);
        var x = (off?.X ?? 0) + cx * scale; var y = (off?.Y ?? 0) + cy * scale; var w = cw * scale; var h = ch * scale;
        _vfBox.Visibility = Visibility.Visible;
        _vfBox.Width = Math.Max(4, w); _vfBox.Height = Math.Max(4, h);
        _vfBox.Margin = new Thickness(Math.Max(0, x), Math.Max(0, y), 0, 0);
        _vfPlaced = true;
        _vfPicking = false;
        if (_viewfinder is not null) _viewfinder.IsHitTestVisible = false;
        _feAspectHint = $"{Math.Round(cw / ch * 100)}:100";
    }

    private void UpdateFacetRegionReadout()
    {
        if (_feRegion is null || _feTile is null) return;
        var (lw, _, _, _) = _surfaces.LayoutOf(_feTile);
        if (_feSelector is not null)
            _feRegion.Text = "element  " + Shorten(_feSelector, 60) + (_vfBox is not null ? $"  ·  {_vfBox.Width:0}×{_vfBox.Height:0} on screen" : "") + $"  ·  page {lw:0} px wide at {_vfZoom:0.0#}×";
        else if (_feWhole)
            _feRegion.Text = $"whole page  ·  laid out {lw:0} px wide at {_vfZoom:0.0#}×";
        else if (_vfBox is not null && (_vfPicking || _vfPlaced))
        {
            var (_, _, rw, rh) = _surfaces.RegionFromView(_feTile, 0, 0, _vfBox.Width, _vfBox.Height, 0, 0);
            _feRegion.Text = (_vfPicking ? "click to place  ·  " : "box placed  ·  ") + $"{rw:0} × {rh:0} css px of a {lw:0} px wide page";
            _feAspectHint = _vfBox.Height > 0 ? $"{Math.Round(_vfBox.Width / _vfBox.Height * 100)}:100" : _feAspectHint;
        }
        else _feRegion.Text = $"no region yet  ·  page laid out {lw:0} px wide  ·  tap an element, draw a box, or use the whole page";
        if (_vfZoomLabel is not null) _vfZoomLabel.Text = $"{_vfZoom:0.0#}×";
    }

    // ------------------------------------------------ save
    private async Task SaveFacetAsync()
    {
        if (_feApp is null || _feTile is null) return;
        var label = _feLabel?.Text.Trim() ?? "";
        if (label.Length == 0)
        {
            label = await PromptTextAsync("Name this Facet", "", "e.g. Live TV guide, Current conditions", "Save Facet") ?? "";
            if (label.Length == 0) return;
            if (_feLabel is not null) _feLabel.Text = label;
        }
        var url = _feAddressEdited && IsHttpUrl(_feAddress?.Text ?? "") ? new Uri(_feAddress!.Text.Trim()).ToString() : (_surfaces.SourceOf(_feTile) ?? _feApp.BaseUrl);
        if (!IsHttpUrl(url)) { SetPill("Prism · the page has no http(s) address yet"); return; }
        // a facet never needs a login page (spec §2/§4): warn, and flip the App to needs attention
        var redirect = await LoginRedirectAsync(url, AdapterLoginUrl(_feApp.Adapter), _feApp.BaseUrl);
        if (redirect?.Redirect == "login")
        {
            await SaveAppStatusAsync(_feApp, "needs-attention");
            SetPill("Prism · that is " + _feApp.Name + "'s sign-in page. Sign in under App setup instead. The App is marked needs attention");
            return;
        }
        object? focus = null;
        if (_feSelector is not null) focus = new { selector = _feSelector, pad = 8 };
        else if (!_feWhole && _vfPlaced && await PlacedFocusAsync(_feTile) is { } f) focus = new { region = f.Region, viewport = f.Viewport };
        var id = _feFacet?.Id ?? await NewFacetIdAsync(_feApp.Id, label, _feClass);
        var input = new Dictionary<string, object?>
        {
            ["id"] = id, ["app"] = _feApp.Id, ["url"] = url, ["slotClass"] = _feClass, ["label"] = label,
        };
        if (focus is not null) input["focus"] = focus;
        if (Math.Abs(_vfZoom - 1) > 0.001) input["zoom"] = _vfZoom;
        if (_feAspectHint is not null) input["aspectHint"] = _feAspectHint;
        if (_feFacet is not null)
        {
            // keep what the editor does not touch (music, audio, touch, refresh)
            try
            {
                using var d = JsonDocument.Parse(_feFacet.Json);
                foreach (var k in new[] { "music", "audio", "touch", "refresh" })
                    if (d.RootElement.TryGetProperty(k, out var v)) input[k] = v.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, JsonValueKind.Number => v.GetDouble(), JsonValueKind.String => v.GetString(), _ => null };
            }
            catch { }
        }
        var res = await RuntimeEvalAsync("PrismRuntime.modelSaveFacet(" + Q(JsonSerializer.Serialize(input)) + ")");
        if (res is null || !res.Contains("\"ok\":true")) { SetPill("Prism · could not save the Facet" + (res is null ? "" : ": " + Shorten(res, 90))); return; }
        var warnings = "";
        try { using var d = JsonDocument.Parse(res); if (d.RootElement.TryGetProperty("warnings", out var w) && w.ValueKind == JsonValueKind.Array && w.GetArrayLength() > 0) warnings = "  ·  " + string.Join("; ", w.EnumerateArray().Select(x => x.GetString())); } catch { }
        var appRef = _feApp; var cls = _feClass;
        CloseFacetEditor();
        SetPill("Prism · saved Facet \"" + label + "\" of " + appRef.Name + " for " + cls + warnings);
        EditorClosed("facet", id, saved: true);   // SM-3 integration: the slot picker / wizard / rail resumes with the saved facet
    }

    /// <summary>A human cancel (button, overlay dismiss, Esc): close and tell the opener nothing was saved. Internal closes stay silent.</summary>
    private void CancelFacetEditor()
    {
        var wasOpen = _feSession || _facetEditor is not null;
        CloseFacetEditor();
        if (wasOpen) EditorClosed("facet", null, saved: false);
    }

    private async Task<string> NewFacetIdAsync(string appId, string label, string slotClass)
    {
        var slug = new string(label.ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray()).Trim('-');
        while (slug.Contains("--")) slug = slug.Replace("--", "-");
        var cls = slotClass.ToLowerInvariant().Replace("·", "-").Replace(":", "x");
        var baseId = appId + "-" + (slug.Length > 0 ? slug : "facet") + "-" + cls;
        var st = await ModelStateAsync();
        var taken = st?.Facets.Select(f => f.Id).ToHashSet() ?? new HashSet<string>();
        var id = baseId;
        for (var n = 2; taken.Contains(id); n++) id = baseId + "-" + n;
        return id;
    }

    // ------------------------------------------------ close / navigation hooks
    private void CloseFacetEditor()
    {
        if (_facetEditor is not null) { RootGrid.Children.Remove(_facetEditor); _facetEditor = null; }
        if (!_feSession) return;
        StopElementPick();
        var tile = _feTile;
        _feSession = false;
        StepWizardAside(false);
        _feApp = null; _feFacet = null; _feTile = null; _feSelector = null; _feWhole = false; _feAspectHint = null;
        _feLabel = null; _feAddress = null; _feStatus = null; _feRegion = null; _fePresets = null;
        EndViewfinder();
        _ = ReleaseAppSurfaceAsync(tile);                               // B-41: core destroys the preview surface; the wall was never touched
        _vfMode = "views";
    }

    /// <summary>The page moved under an editor: the address follows, and a login redirect flips the App to "needs attention" (scene-model §2).</summary>
    private void OnEditorSourceChanged(string tileId, string url)
    {
        if (_feSession && _feTile == tileId)
        {
            if (_feAddress is not null && !_feAddressEdited) { _feAddressSyncing = true; try { _feAddress.Text = url; } finally { _feAddressSyncing = false; } }
            if (_feApp is { } app) _ = FlagLoginRedirectAsync(app, url, fromFacet: true);
        }
        if (_asTile == tileId && _asApp is { } sapp)
        {
            _ = UpdateSetupCardAsync(sapp, url);
        }
    }

    private async Task FlagLoginRedirectAsync(ModelApp app, string url, bool fromFacet)
    {
        var r = await LoginRedirectAsync(url, AdapterLoginUrl(app.Adapter), app.BaseUrl);
        if (r?.Redirect != "login") return;
        if (app.Status != "needs-attention" && await SaveAppStatusAsync(app, "needs-attention"))
            SetPill("Prism · " + app.Name + " asked to sign in, so it's marked needs attention. Sign in under App setup");
        if (fromFacet && _feStatus is not null) _feStatus.Text = "This is a sign-in page. Sign in here if you like (sign-ins are kept), then go to the page the Facet should show. A Facet is never a login page.";
    }
}
