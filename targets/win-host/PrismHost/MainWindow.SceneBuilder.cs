using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using PrismHost.Layouts;

namespace PrismHost;

/// <summary>
/// The scene builder (scene-model-spec §5): choose a layout (thumbnail grid,
/// filtered to this device's canvas class) → each slot shows its class and a
/// picker listing only compatible facets (exact class first, one-step matches
/// labeled stretch / shrink) → floating facets (anchor corner + size fraction;
/// always above slots, veils above them) → hidden facets (loaded, zero-size,
/// in audio focus normally) → visualizations (placeable, fed by a hidden music
/// facet) → per-assignment settings (keepPresentation, onEnd - standing human
/// instructions per dashboard-schema §26) → name, save, set active or schedule.
/// Unassigned slots render the App-poster placeholder, tappable to assign.
/// Everything is written through modelSaveScene / modelApplyScene; the wall
/// reflects an applied scene as layoutMode "fixed".
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _builder;
    private MScene? _sceneDraft;
    private string? _draftSlot;
    private bool _draftAllCanvases;
    private StackPanel? _sbLeft, _sbSlots, _sbExtras;
    private Canvas? _sbPreview;
    private TextBox? _sbName;
    private TextBlock? _sbWarn;

    /// <summary>Open the builder on a scene (null = new; <paramref name="layoutId"/> preselects; <paramref name="slot"/> focuses a slot; pickNow opens its picker).</summary>
    private async void OpenSceneBuilder(string? sceneId, string? layoutId = null, string? slot = null, bool pickNow = false, string? visualization = null)
    {
        await ReadModelAsync();
        var existing = sceneId is null ? null : _model.Scene(sceneId);
        if (sceneId is not null && existing is null) { SetPill("Prism · no scene " + sceneId); return; }
        _sceneDraft = existing?.Clone() ?? new MScene { Name = "" };
        if (layoutId is not null) _sceneDraft.Layout = layoutId;
        if (_sceneDraft.Layout.Length == 0)
        {
            var (cw, ch) = WallSize();
            _sceneDraft.Layout = _model.Layouts.FirstOrDefault(l => !l.Archived && CanvasMatches(l, cw, ch))?.Id ?? "";
        }
        _draftSlot = slot;
        if (_builder is null)
        {
            var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF6, 0x0F, 0x12, 0x16)) };
            Canvas.SetZIndex(overlay, 902);
            overlay.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(460) });
            overlay.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            _sbLeft = new StackPanel { Spacing = 8, Padding = new Thickness(22, 18, 16, 18) };
            overlay.Children.Add(new ScrollViewer { Content = _sbLeft, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
            var right = new Grid { Padding = new Thickness(10, 18, 22, 18) };
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            right.Children.Add(new TextBlock { Text = "Preview. Tap a slot to assign it. Empty slots show the App-poster placeholder on the wall.", FontSize = 12, Foreground = LeDim, Margin = new Thickness(0, 0, 0, 8) });
            _sbPreview = new Canvas { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x0B, 0x0D, 0x12)) };
            var host = new Border { Child = _sbPreview, BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x60, 0xF0, 0xA8, 0x3C)), BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            var hostGrid = new Grid();
            hostGrid.Children.Add(host);
            hostGrid.SizeChanged += (_, e) =>
            {
                var (cw, ch) = WallSize();
                var w = Math.Max(200, e.NewSize.Width - 4); var h = w * ch / cw;
                if (h > e.NewSize.Height - 4) { h = Math.Max(120, e.NewSize.Height - 4); w = h * cw / ch; }
                _sbPreview.Width = w; _sbPreview.Height = h;
                RenderBuilderPreview();
            };
            Grid.SetRow(hostGrid, 1);
            right.Children.Add(hostGrid);
            _sbExtras = new StackPanel { Spacing = 6, Margin = new Thickness(0, 10, 0, 0) };
            Grid.SetRow(_sbExtras, 2);
            right.Children.Add(_sbExtras);
            Grid.SetColumn(right, 1);
            overlay.Children.Add(right);
            RootGrid.Children.Add(overlay);
            _builder = overlay;
        }
        RenderBuilder();
        if (pickNow && slot is not null) _ = Task.Delay(120).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => OpenSlotPicker(slot)));
        if (visualization is not null) _ = Task.Delay(120).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => EditVisualization(visualization)));
    }

    private void CloseSceneBuilder()
    {
        if (_builder is null) return;
        RootGrid.Children.Remove(_builder);
        _builder = null; _sceneDraft = null; _sbLeft = null; _sbSlots = null; _sbExtras = null; _sbPreview = null; _sbName = null; _sbWarn = null;
    }

    private MLayout? DraftLayout() => _sceneDraft is null ? null : _model.Layout(_sceneDraft.Layout);

    private void RenderBuilder()
    {
        if (_builder is null || _sceneDraft is null || _sbLeft is null) return;
        var left = _sbLeft;
        left.Children.Clear();
        var isNew = _sceneDraft.Id.Length == 0;
        left.Children.Add(new TextBlock { Text = isNew ? "New scene" : "Scene builder", FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        left.Children.Add(new TextBlock { Text = "A layout, a facet in each slot, floating and hidden extras, visualizations. Save keeps it; Set active puts it on the wall. Esc returns to the scene.", FontSize = 12, Foreground = LeDim, TextWrapping = TextWrapping.Wrap });
        _sbName = new TextBox { Text = _sceneDraft.Name, PlaceholderText = "Name this scene (Kitchen evening, Game day…)" };
        _sbName.TextChanged += (_, __) => { if (_sceneDraft is not null) _sceneDraft.Name = _sbName!.Text; };
        left.Children.Add(_sbName);

        // 1 · layout, filtered to this canvas class
        var (cw, ch) = WallSize();
        var lhead = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        lhead.Children.Add(Section("1 · LAYOUT  ·  " + CanvasClassLabel(cw, ch)));
        var all = new ToggleButton { Content = _draftAllCanvases ? "all classes" : "this device", IsChecked = _draftAllCanvases, Padding = new Thickness(8, 2, 8, 2), FontSize = 11 };
        all.Click += (_, __) => { _draftAllCanvases = !_draftAllCanvases; RenderBuilder(); };
        lhead.Children.Add(all);
        left.Children.Add(lhead);
        var layouts = _model.Layouts.Where(l => (!l.Archived || l.Id == _sceneDraft.Layout) && (_draftAllCanvases || CanvasMatches(l, cw, ch) || l.Id == _sceneDraft.Layout)).OrderBy(l => l.Name).ToList();
        var lgrid = CardGrid();
        foreach (var l in layouts)
        {
            var lid = l.Id;
            var thumb = new StackPanel { Spacing = 3 };
            thumb.Children.Add(LayoutThumb(l, 118, s => (new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xF0, 0xA8, 0x3C)), null)));
            thumb.Children.Add(new TextBlock { Text = l.Name + (l.Archived ? " (archived)" : ""), FontSize = 11, Foreground = lid == _sceneDraft.Layout ? Amber : LeInk, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 118 });
            var b = new Button { Content = thumb, Padding = new Thickness(6), Background = lid == _sceneDraft.Layout ? LeSlotSel : LeSlot, BorderBrush = lid == _sceneDraft.Layout ? Amber : new SolidColorBrush(Windows.UI.Color.FromArgb(0x24, 0xF0, 0xA8, 0x3C)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6) };
            OwnHover(b);   // its own hover, never the system's (memory: hover-loss-tooltips)
            b.Click += (_, __) => { if (_sceneDraft is not null && _sceneDraft.Layout != lid) { _sceneDraft.Layout = lid; _sceneDraft.Assign.Clear(); _sceneDraft.Settings.Clear(); RenderBuilder(); } };
            lgrid.Children.Add(b);
        }
        var newLayout = new Button { Content = "＋\nNew layout", Width = 130, Height = 96, Padding = new Thickness(6), FontSize = 12 };
        ToolTipService.SetToolTip(newLayout, "Opens the layout editor; the new layout comes back selected here.");
        newLayout.Click += (_, __) => { _editorContinuations["layout"] = (id, saved) => { if (saved && id is not null && _sceneDraft is not null) { _sceneDraft.Layout = id; _sceneDraft.Assign.Clear(); } _ = ReadModelAsync().ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(RenderBuilder)); }; OpenRoute("prism://layouts/new"); };
        lgrid.Children.Add(newLayout);
        left.Children.Add(lgrid);
        if (layouts.Count == 0) left.Children.Add(Meta("No layout for this canvas class yet - New layout, or New Scene from a template makes one."));

        // 2 · slots
        left.Children.Add(Section("2 · SLOTS"));
        _sbSlots = new StackPanel { Spacing = 4 };
        left.Children.Add(_sbSlots);
        RenderBuilderSlots();
        _sbWarn = new TextBlock { Foreground = LeDim, FontSize = 12, TextWrapping = TextWrapping.Wrap };
        left.Children.Add(_sbWarn);

        // 3 · floating · hidden · visualizations · schedule
        left.Children.Add(Section("3 · FLOATING FACETS  (above slots; veils above them)"));
        foreach (var (p, i) in _sceneDraft.Floating.Select((p, i) => (p, i)))
        {
            var idx = i;
            var who = p["facet"]?.GetValue<string>() is { } fid ? (_model.Facet(fid) is { } f ? (_model.App(f.App)?.Name ?? f.App) + " · " + f.Label : fid) : "♪ " + (p["visualization"]?.GetValue<string>() ?? "visualization");
            var row = new Grid { ColumnSpacing = 6, Background = LeSlot, Padding = new Thickness(8, 4, 4, 4), CornerRadius = new CornerRadius(6) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            for (var c = 0; c < 3; c++) row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(new TextBlock { Text = who, FontSize = 12, Foreground = LeInk, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis });
            var anchor = new ComboBox { FontSize = 11, MinWidth = 120 };
            foreach (var a in new[] { "top-left", "top-right", "bottom-left", "bottom-right" }) anchor.Items.Add(a);
            anchor.SelectedItem = p["anchor"]?.GetValue<string>() ?? "bottom-right";
            anchor.SelectionChanged += (_, __) => { p["anchor"] = anchor.SelectedItem as string; p.Remove("rect"); RenderBuilderPreview(); };
            Grid.SetColumn(anchor, 1); row.Children.Add(anchor);
            var size = new Slider { Minimum = 12, Maximum = 60, Value = Math.Round((p["size"]?.GetValue<double>() ?? 0.3) * 100), Width = 110, StepFrequency = 1 };
            ToolTipService.SetToolTip(size, "Width as a fraction of the canvas; height follows the content's class aspect");
            size.ValueChanged += (_, e) => { p["size"] = e.NewValue / 100; p.Remove("rect"); RenderBuilderPreview(); };
            Grid.SetColumn(size, 2); row.Children.Add(size);
            var rm = Small("✕", () => { _sceneDraft?.Floating.RemoveAt(idx); RenderBuilder(); }); rm.Foreground = Danger;
            Grid.SetColumn(rm, 3); row.Children.Add(rm);
            left.Children.Add(row);
        }
        left.Children.Add(Small("＋  Add a floating facet…", () => PickFacetForList("Floating facet", music: false, chosen: fid => { _sceneDraft?.Floating.Add(new JsonObject { ["facet"] = fid, ["anchor"] = "bottom-right", ["size"] = 0.24 }); RenderBuilder(); })));

        left.Children.Add(Section("4 · HIDDEN FACETS  (loaded, zero-size; audio focus as usual - music lives here)"));
        foreach (var (h, i) in _sceneDraft.Hidden.Select((h, i) => (h, i)))
        {
            var idx = i;
            var fid = h["facet"]?.GetValue<string>() ?? "";
            var f = _model.Facet(fid);
            var row = new Grid { ColumnSpacing = 6, Background = LeSlot, Padding = new Thickness(8, 4, 4, 4), CornerRadius = new CornerRadius(6) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(new TextBlock { Text = (f is null ? fid : (_model.App(f.App)?.Name ?? f.App) + " · " + f.Label) + (f?.Music == true ? "  ♪" : ""), FontSize = 12, Foreground = LeInk, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis });
            var audio = new ComboBox { FontSize = 11, MinWidth = 100 };
            foreach (var a in new[] { "exclusive", "mix", "mute" }) audio.Items.Add(a);
            audio.SelectedItem = h["audio"]?.GetValue<string>() ?? "exclusive";
            audio.SelectionChanged += (_, __) => h["audio"] = audio.SelectedItem as string;
            Grid.SetColumn(audio, 1); row.Children.Add(audio);
            var rm = Small("✕", () => { _sceneDraft?.Hidden.RemoveAt(idx); RenderBuilder(); }); rm.Foreground = Danger;
            Grid.SetColumn(rm, 2); row.Children.Add(rm);
            left.Children.Add(row);
        }
        left.Children.Add(Small("＋  Add a hidden facet…", () => PickFacetForList("Hidden facet", music: null, chosen: fid => { _sceneDraft?.Hidden.Add(new JsonObject { ["facet"] = fid, ["audio"] = "exclusive" }); RenderBuilder(); })));

        left.Children.Add(Section("5 · VISUALIZATIONS  (placeable; source = a hidden music facet)"));
        foreach (var (v, i) in _sceneDraft.Visualizations.Select((v, i) => (v, i)))
        {
            var idx = i;
            var vid = v["id"]?.GetValue<string>() ?? "viz";
            var row = new Grid { ColumnSpacing = 6, Background = LeSlot, Padding = new Thickness(8, 4, 4, 4), CornerRadius = new CornerRadius(6) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var placed = _sceneDraft.Assign.FirstOrDefault(kv => kv.Value == vid).Key is { } slotId ? "in " + slotId : _sceneDraft.Floating.Any(p => p["visualization"]?.GetValue<string>() == vid) ? "floating" : "not placed";
            row.Children.Add(new TextBlock { Text = "♪ " + vid + "  ·  " + (v["style"]?.GetValue<string>() ?? "prism-beams") + "  ·  art " + (v["artwork"]?.GetValue<string>() ?? "off") + "  ·  " + placed, FontSize = 12, Foreground = LeInk, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis });
            var edit = Small("Style…", () => EditVisualization(vid));
            Grid.SetColumn(edit, 1); row.Children.Add(edit);
            var rm = Small("✕", () =>
            {
                if (_sceneDraft is null) return;
                _sceneDraft.Visualizations.RemoveAt(idx);
                foreach (var k in _sceneDraft.Assign.Where(kv => kv.Value == vid).Select(kv => kv.Key).ToList()) _sceneDraft.Assign.Remove(k);
                _sceneDraft.Floating.RemoveAll(p => p["visualization"]?.GetValue<string>() == vid);
                RenderBuilder();
            }); rm.Foreground = Danger;
            Grid.SetColumn(rm, 2); row.Children.Add(rm);
            left.Children.Add(row);
        }
        var addViz = Small("＋  Add a visualization…", () => AddVisualization());
        addViz.IsEnabled = _sceneDraft.Hidden.Any(h => _model.Facet(h["facet"]?.GetValue<string>() ?? "")?.Music == true);
        ToolTipService.SetToolTip(addViz, addViz.IsEnabled ? "Prism Beams · Spectrum · Ribbon · Bloom, fed by one of this scene's hidden music facets. Then assign it to a slot or float it." : "Add a hidden music facet first. A visualization needs a source.");
        left.Children.Add(addViz);

        left.Children.Add(Section("6 · SCHEDULE  (§4 scene actions)"));
        foreach (var (e, i) in _sceneDraft.Schedule.Select((e, i) => (e, i)))
        {
            var idx = i;
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            row.Children.Add(new TextBlock { Text = "at " + (e["at"]?.GetValue<string>() ?? "?") + "  →  " + (e["action"]?.GetValue<string>() ?? "") + (e["value"] is { } val ? " " + val : ""), FontSize = 12, Foreground = LeInk, VerticalAlignment = VerticalAlignment.Center, FontFamily = new FontFamily("Consolas") });
            var rm = Small("✕", () => { _sceneDraft?.Schedule.RemoveAt(idx); RenderBuilder(); }); rm.Foreground = Danger;
            row.Children.Add(rm);
            left.Children.Add(row);
        }
        left.Children.Add(Small("＋  Show this scene at a time…", () => _ = AddScheduleAsync()));
        left.Children.Add(Meta("Written as {at, action: \"scene\"} entries; the schedule engine runs scene actions once the channel work lands (ledger B-52)."));

        // save · set active
        left.Children.Add(Section("SAVE"));
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        actions.Children.Add(Small("Save", () => _ = SaveSceneDraftAsync(apply: false)));
        actions.Children.Add(Primary("Save & set active", () => _ = SaveSceneDraftAsync(apply: true)));
        actions.Children.Add(Small("Back to the scene  (Esc)", RouteBack));
        left.Children.Add(actions);
        RenderBuilderPreview();
    }

    private void RenderBuilderSlots()
    {
        if (_sceneDraft is null || _sbSlots is null) return;
        _sbSlots.Children.Clear();
        var layout = DraftLayout();
        if (layout is null) { _sbSlots.Children.Add(Meta("Choose a layout above.")); return; }
        foreach (var slot in layout.Slots)
        {
            var sid = slot.Id;
            var row = new StackPanel { Spacing = 4, Background = sid == _draftSlot ? LeSlotSel : LeSlot, Padding = new Thickness(8, 6, 6, 6), CornerRadius = new CornerRadius(6) };
            var top = new Grid { ColumnSpacing = 6 };
            top.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(150) });
            top.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            top.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var label = new StackPanel();
            label.Children.Add(new TextBlock { Text = slot.Label ?? slot.Id, FontSize = 12, Foreground = LeInk });
            label.Children.Add(ClassBadge(slot.Class, slot.Custom ? "custom — limits facet reuse" : null));
            top.Children.Add(label);
            var pick = new Button { Content = AssignmentText(sid), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 4, 10, 4), FontSize = 12 };
            pick.Click += (_, __) => OpenSlotPicker(sid);
            Grid.SetColumn(pick, 1); top.Children.Add(pick);
            var gear = new Button { Content = new FontIcon { Glyph = "", FontSize = 12 }, Padding = new Thickness(6, 4, 6, 4) };
            ToolTipService.SetToolTip(gear, "Per-assignment settings: keep presentation, on end, audio, touch");
            gear.Flyout = SettingsFlyout(sid);
            gear.IsEnabled = _sceneDraft.Assign.ContainsKey(sid);
            Grid.SetColumn(gear, 2); top.Children.Add(gear);
            row.Children.Add(top);
            if (_sceneDraft.Settings.TryGetValue(sid, out var st))
            {
                var bits = new List<string>();
                if (st["keepPresentation"]?.GetValue<bool>() == true) bits.Add("keep presentation");
                if (st["onEnd"]?.GetValue<string>() is { } oe && oe != "none") bits.Add("on end: " + oe);
                if (st["audio"]?.GetValue<string>() is { } au) bits.Add("audio " + au);
                if (st["touch"]?.GetValue<string>() is { } to) bits.Add("touch " + to);
                if (bits.Count > 0) row.Children.Add(Meta(string.Join("  ·  ", bits)));
            }
            _sbSlots.Children.Add(row);
        }
        if (_sbWarn is not null)
        {
            var assigned = layout.Slots.Count(s => _sceneDraft.Assign.ContainsKey(s.Id));
            _sbWarn.Text = _model.Facets.Count == 0 ? "No facets yet. Every slot's picker offers + New facet for this slot." : assigned == 0 ? "Every slot is empty. Empty slots show the App-poster placeholder on the wall, tappable to assign." : "";
        }
    }

    private string AssignmentText(string slotId)
    {
        if (_sceneDraft is null || !_sceneDraft.Assign.TryGetValue(slotId, out var refId)) return "Empty - tap to assign";
        var viz = _sceneDraft.Visualizations.FirstOrDefault(v => v["id"]?.GetValue<string>() == refId);
        if (viz is not null) return "♪ visualization " + refId + " (" + (viz["style"]?.GetValue<string>() ?? "prism-beams") + ")";
        var f = _model.Facet(refId);
        if (f is null) return refId + "  (missing facet)";
        var layout = DraftLayout(); var slot = layout?.Slots.FirstOrDefault(s => s.Id == slotId);
        var fit = slot is null ? (true, "exact", (string?)null) : FacetFits(f.SlotClass, slot.Class);
        return (_model.App(f.App)?.Name ?? f.App) + " · " + f.Label + "  ·  " + f.SlotClass + (fit.Item3 is { } n ? "  (" + n + ")" : fit.Item1 ? "" : "  (does not fit)");
    }

    /// <summary>The picker for one slot: only compatible facets, exact class first, one-step labeled; the scene's visualizations; + New facet for this slot (create in place).</summary>
    private void OpenSlotPicker(string slotId)
    {
        if (_sceneDraft is null || _builder is null) return;
        var layout = DraftLayout(); var slot = layout?.Slots.FirstOrDefault(s => s.Id == slotId);
        if (slot is null) return;
        _draftSlot = slotId;
        RenderBuilderSlots();
        var fly = new Flyout { Placement = FlyoutPlacementMode.Right };
        var col = new StackPanel { Spacing = 2, Width = 400 };
        col.Children.Add(new TextBlock { Text = "What goes in " + (slot.Label ?? slot.Id) + "?  ·  " + slot.Class, FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk, Margin = new Thickness(0, 0, 0, 6) });
        col.Children.Add(AppRow("Empty", "the App-poster placeholder, tappable on the wall", () => { fly.Hide(); _sceneDraft.Assign.Remove(slotId); _sceneDraft.Settings.Remove(slotId); RenderBuilder(); }));
        var fits = _model.Facets.Where(f => !f.Music).Select(f => (f, fit: FacetFits(f.SlotClass, slot.Class))).Where(x => x.fit.Ok).OrderBy(x => x.fit.Match == "exact" ? 0 : 1).ThenBy(x => _model.App(x.f.App)?.Name ?? x.f.App).ThenBy(x => x.f.Label).ToList();
        if (fits.Count > 0) col.Children.Add(new TextBlock { Text = "COMPATIBLE FACETS", FontSize = 10, Foreground = LeDim, Margin = new Thickness(4, 6, 0, 0), CharacterSpacing = 80 });
        foreach (var (f, fit) in fits)
        {
            var fid = f.Id;
            col.Children.Add(AppRow((_model.App(f.App)?.Name ?? f.App) + " · " + f.Label + (fit.Note is { } n ? "   " + n : ""), f.SlotClass + (fit.Match == "exact" ? "  ·  exact class" : "  ·  one step: " + fit.Note) + "  ·  " + Shorten(f.Url, 36), () =>
            {
                fly.Hide();
                _sceneDraft.Assign[slotId] = fid;
                if (!_sceneDraft.Settings.ContainsKey(slotId)) _sceneDraft.Settings[slotId] = new JsonObject { ["keepPresentation"] = false, ["onEnd"] = "none" };
                RenderBuilder();
            }));
        }
        var vizs = _sceneDraft.Visualizations.ToList();
        if (vizs.Count > 0) col.Children.Add(new TextBlock { Text = "VISUALIZATIONS OF THIS SCENE", FontSize = 10, Foreground = LeDim, Margin = new Thickness(4, 6, 0, 0), CharacterSpacing = 80 });
        foreach (var v in vizs)
        {
            var vid = v["id"]?.GetValue<string>() ?? "";
            col.Children.Add(AppRow("♪ " + vid, (v["style"]?.GetValue<string>() ?? "prism-beams") + "  ·  source " + (v["source"]?.GetValue<string>() ?? "?"), () => { fly.Hide(); _sceneDraft.Assign[slotId] = vid; _sceneDraft.Settings.Remove(slotId); RenderBuilder(); }));
        }
        var others = _model.Facets.Count(f => !f.Music) - fits.Count;
        col.Children.Add(new TextBlock { Text = "CREATE IN PLACE", FontSize = 10, Foreground = LeDim, Margin = new Thickness(4, 8, 0, 0), CharacterSpacing = 80 });
        col.Children.Add(AppRow("＋  New facet for this slot", "cut for " + slot.Class + (others > 0 ? "  ·  " + others + " facet" + (others == 1 ? "" : "s") + " of other classes not offered" : ""), () =>
        {
            fly.Hide();
            _ = NewFacetForSlotAsync(slotId, slot.Class);
        }));
        fly.Content = new ScrollViewer { Content = col, MaxHeight = 560, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        var anchor = _sbSlots?.Children.OfType<StackPanel>().Select((sp, i) => (sp, i)).FirstOrDefault(p => layout!.Slots[p.i].Id == slotId).sp;
        fly.ShowAt(anchor ?? (FrameworkElement)_builder);
    }

    /// <summary>+ New facet for this slot: pick / add the App, then the facet editor preselected to the slot's class; the saved facet lands in the slot.</summary>
    private async Task NewFacetForSlotAsync(string slotId, string slotClass)
    {
        var appId = await PickAppAsync("New facet for " + slotId + " (" + slotClass + ") - which App?");
        if (appId is null) return;
        _editorContinuations["facet"] = (id, saved) =>
        {
            _ = ReadModelAsync().ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() =>
            {
                if (saved && id is not null && _sceneDraft is not null) { _sceneDraft.Assign[slotId] = id; _sceneDraft.Settings.TryAdd(slotId, new JsonObject { ["keepPresentation"] = false, ["onEnd"] = "none" }); }
                RenderBuilder();
            }));
        };
        OpenRoute("prism://facets/new?app=" + Uri.EscapeDataString(appId) + "&class=" + Uri.EscapeDataString(slotClass));
    }

    /// <summary>Choose a facet for the floating / hidden lists; music = true → music only, false → no music (hidden-only), null → any. Add App / new facet in place.</summary>
    private void PickFacetForList(string title, bool? music, Action<string> chosen)
    {
        var fly = new Flyout { Placement = FlyoutPlacementMode.Right };
        var col = new StackPanel { Spacing = 2, Width = 400 };
        col.Children.Add(new TextBlock { Text = title, FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk, Margin = new Thickness(0, 0, 0, 6) });
        var list = _model.Facets.Where(f => music is null || f.Music == music).OrderByDescending(f => f.Music).ThenBy(f => _model.App(f.App)?.Name ?? f.App).ThenBy(f => f.Label).ToList();
        foreach (var f in list)
        {
            var fid = f.Id;
            col.Children.Add(AppRow((_model.App(f.App)?.Name ?? f.App) + " · " + f.Label + (f.Music ? "  ♪ music" : ""), f.SlotClass + "  ·  " + Shorten(f.Url, 40), () => { fly.Hide(); chosen(fid); }));
        }
        if (list.Count == 0) col.Children.Add(Meta(music == true ? "No music facet yet: add the music App (Spotify, Apple Music, Pandora…) and cut a facet marked music." : "No facets yet."));
        col.Children.Add(AppRow("＋  New facet…", "pick the App and the slot class; the facet editor opens", () => { fly.Hide(); _editorContinuations["facet"] = (id, saved) => { if (saved && id is not null) chosen(id); else RenderBuilder(); }; _ = NewFacetAsync(null, null); }));
        fly.Content = new ScrollViewer { Content = col, MaxHeight = 560 };
        fly.ShowAt(_sbLeft ?? (FrameworkElement)_builder!);
    }

    /// <summary>Per-assignment settings (dashboard-schema §26 standing instructions), written to scene.settings[slotId].</summary>
    private Flyout SettingsFlyout(string slotId)
    {
        var fly = new Flyout { Placement = FlyoutPlacementMode.Left };
        var col = new StackPanel { Spacing = 8, Width = 320 };
        if (_sceneDraft is null) { fly.Content = col; return fly; }
        var st = _sceneDraft.Settings.TryGetValue(slotId, out var s0) ? s0 : (_sceneDraft.Settings[slotId] = new JsonObject { ["keepPresentation"] = false, ["onEnd"] = "none" });
        col.Children.Add(new TextBlock { Text = "Settings for " + slotId, FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        var keep = new ToggleSwitch { Header = "Keep presentation", IsOn = st["keepPresentation"]?.GetValue<bool>() == true, OnContent = "on", OffContent = "off" };
        ToolTipService.SetToolTip(keep, "If the player's fullscreen / theater drops at an ad or end boundary (site-initiated), restore the state you established. A drop after your own input (Esc, back, a click) is never fought.");
        keep.Toggled += (_, __) => { st["keepPresentation"] = keep.IsOn; RenderBuilderSlots(); };
        col.Children.Add(keep);
        col.Children.Add(new TextBlock { Text = "On end", FontSize = 12, Foreground = LeDim });
        var onEnd = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var o in new[] { "none", "restart", "restart-fullscreen" }) onEnd.Items.Add(o);
        onEnd.SelectedItem = st["onEnd"]?.GetValue<string>() ?? "none";
        onEnd.SelectionChanged += (_, __) => { st["onEnd"] = onEnd.SelectedItem as string ?? "none"; RenderBuilderSlots(); };
        col.Children.Add(onEnd);
        col.Children.Add(new TextBlock { Text = "Audio (this placement)", FontSize = 12, Foreground = LeDim });
        var audio = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var o in new[] { "(App default)", "exclusive", "mix", "mute" }) audio.Items.Add(o);
        audio.SelectedItem = st["audio"]?.GetValue<string>() ?? "(App default)";
        audio.SelectionChanged += (_, __) => { var v = audio.SelectedItem as string; if (v is null or "(App default)") st.Remove("audio"); else st["audio"] = v; RenderBuilderSlots(); };
        col.Children.Add(audio);
        col.Children.Add(new TextBlock { Text = "Touch", FontSize = 12, Foreground = LeDim });
        var touch = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var o in new[] { "(facet default)", "full", "scroll", "none" }) touch.Items.Add(o);
        touch.SelectedItem = st["touch"]?.GetValue<string>() ?? "(facet default)";
        touch.SelectionChanged += (_, __) => { var v = touch.SelectedItem as string; if (v is null or "(facet default)") st.Remove("touch"); else st["touch"] = v; RenderBuilderSlots(); };
        col.Children.Add(touch);
        col.Children.Add(Meta("Standing instructions: you name the state and the boundary; the shell executes. Nothing here ever touches an ad's own controls."));
        fly.Content = col;
        return fly;
    }

    // ------------------------------------------------ visualizations (§32): id, source, style pack, artwork mode
    private void AddVisualization()
    {
        if (_sceneDraft is null) return;
        var sources = _sceneDraft.Hidden.Select(h => h["facet"]?.GetValue<string>() ?? "").Where(id => _model.Facet(id)?.Music == true).ToList();
        if (sources.Count == 0) return;
        var n = 1; while (_sceneDraft.Visualizations.Any(v => v["id"]?.GetValue<string>() == "viz-" + n)) n++;
        var viz = new JsonObject { ["id"] = "viz-" + n, ["source"] = sources[0], ["style"] = "prism-beams", ["artwork"] = "backdrop", ["label"] = "Visualization " + n };
        _sceneDraft.Visualizations.Add(viz);
        RenderBuilder();
        EditVisualization("viz-" + n);
    }

    private void EditVisualization(string vizId)
    {
        if (_sceneDraft is null || _builder is null) return;
        var viz = _sceneDraft.Visualizations.FirstOrDefault(v => v["id"]?.GetValue<string>() == vizId);
        if (viz is null) return;
        var fly = new Flyout { Placement = FlyoutPlacementMode.Right };
        var col = new StackPanel { Spacing = 8, Width = 360 };
        col.Children.Add(new TextBlock { Text = "Visualization " + vizId, FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        col.Children.Add(new TextBlock { Text = "Style pack", FontSize = 12, Foreground = LeDim });
        var styles = new StackPanel { Spacing = 4 };
        foreach (var pack in Visualizations.StylePacks.All())
        {
            var pid = pack.Id;
            var b = new ToggleButton { Content = pack.Name + "  ·  " + pack.Blurb, IsChecked = viz["style"]?.GetValue<string>() == pid, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 6, 10, 6), FontSize = 12 };
            b.Click += (_, __) => { viz["style"] = pid; foreach (var o in styles.Children.OfType<ToggleButton>()) o.IsChecked = ReferenceEquals(o, b); RenderBuilder(); };
            styles.Children.Add(b);
        }
        col.Children.Add(new ScrollViewer { Content = styles, MaxHeight = 420, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });   // twenty packs
        col.Children.Add(new TextBlock { Text = "Artwork (from Media Session, service-served; no art → the pack's palette)", FontSize = 12, Foreground = LeDim, TextWrapping = TextWrapping.Wrap });
        var art = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        foreach (var mode in new[] { ("off", "off"), ("backdrop", "backdrop - blurred, dimmed, palette tinted"), ("focal", "focal - sharp, centered") })
        {
            var m = mode.Item1;
            var b = new ToggleButton { Content = mode.Item1, IsChecked = (viz["artwork"]?.GetValue<string>() ?? "off") == m, Padding = new Thickness(10, 4, 10, 4) };
            ToolTipService.SetToolTip(b, mode.Item2);
            b.Click += (_, __) => { viz["artwork"] = m; foreach (var o in art.Children.OfType<ToggleButton>()) o.IsChecked = ReferenceEquals(o, b); RenderBuilder(); };
            art.Children.Add(b);
        }
        col.Children.Add(art);
        // 2026-09-05: beams past the tile edge looked good on the wall; it is the household's call, per visualization
        var spill = new ToggleButton { Content = "Spill past the tile", IsChecked = viz["spill"]?.GetValue<bool>() == true, Padding = new Thickness(10, 4, 10, 4) };
        ToolTipService.SetToolTip(spill, "Off (default): the drawing stays inside its slot. On: beams and motes reach across the neighbouring tiles, but the wall's edge still clips them.");
        spill.Click += (_, __) => { if (spill.IsChecked == true) viz["spill"] = true; else viz.Remove("spill"); RenderBuilder(); };
        col.Children.Add(spill);
        col.Children.Add(new TextBlock { Text = "Source (a hidden music facet of this scene)", FontSize = 12, Foreground = LeDim });
        var src = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var h in _sceneDraft.Hidden) if (h["facet"]?.GetValue<string>() is { } fid && _model.Facet(fid)?.Music == true) src.Items.Add(fid);
        src.SelectedItem = viz["source"]?.GetValue<string>();
        src.SelectionChanged += (_, __) => { if (src.SelectedItem is string s) viz["source"] = s; };
        col.Children.Add(src);
        col.Children.Add(new TextBlock { Text = "Place it", FontSize = 12, Foreground = LeDim });
        var place = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var layout = DraftLayout();
        if (layout is not null)
            foreach (var s in layout.Slots)
            {
                var sid = s.Id;
                var b = new Button { Content = "slot " + (s.Label ?? s.Id), Padding = new Thickness(8, 4, 8, 4), FontSize = 11 };
                b.Click += (_, __) => { fly.Hide(); _sceneDraft.Assign[sid] = vizId; _sceneDraft.Settings.Remove(sid); RenderBuilder(); };
                place.Children.Add(b);
            }
        var floatIt = new Button { Content = "floating", Padding = new Thickness(8, 4, 8, 4), FontSize = 11 };
        floatIt.Click += (_, __) => { fly.Hide(); if (!_sceneDraft.Floating.Any(p => p["visualization"]?.GetValue<string>() == vizId)) _sceneDraft.Floating.Add(new JsonObject { ["visualization"] = vizId, ["anchor"] = "bottom-left", ["size"] = 0.28 }); RenderBuilder(); };
        place.Children.Add(floatIt);
        col.Children.Add(place);
        col.Children.Add(Meta("Tap the visualization on the wall to reveal the player (transient - Back tucks it away). Transport lives on its chrome and in the Prism menu → Now playing."));
        fly.Content = new ScrollViewer { Content = col, MaxHeight = 600 };
        fly.ShowAt(_sbLeft ?? (FrameworkElement)_builder);
    }

    private async Task AddScheduleAsync()
    {
        if (_sceneDraft is null) return;
        var at = await PromptTextAsync("Show this scene at…", "17:00", "HH:MM (24h, local)", "Add");
        if (at is null) return;
        if (!System.Text.RegularExpressions.Regex.IsMatch(at, @"^([01]\d|2[0-3]):[0-5]\d$")) { SetPill("Prism · time as HH:MM"); return; }
        _sceneDraft.Schedule.Add(new JsonObject { ["at"] = at, ["action"] = "scene", ["value"] = _sceneDraft.Id.Length > 0 ? _sceneDraft.Id : null });
        RenderBuilder();
    }

    // ------------------------------------------------ preview (normalized rects × the preview size) with floating placements
    private void RenderBuilderPreview()
    {
        if (_sbPreview is null || _sceneDraft is null) return;
        _sbPreview.Children.Clear();
        var layout = DraftLayout();
        if (layout is null) return;
        var W = _sbPreview.Width; var H = _sbPreview.Height;
        // A WinUI element's Width/Height are NaN until it has been laid out, and
        // this method runs once synchronously before the first SizeChanged. The
        // old guard (W <= 0 || H <= 0) let NaN through - NaN <= 0 is FALSE - and
        // NaN reached TextBlock.FontSize, which threw "Value does not fall
        // within the expected range" the FIRST time the builder was opened.
        // Ask whether the size IS renderable; never whether it is not bad.
        if (!PreviewGeometry.IsRenderable(W, H)) return;   // SizeChanged re-renders the moment it is measured
        foreach (var s in layout.Slots)
        {
            var (fill, text) = SlotPaint(_sceneDraft, s);
            var sid = s.Id;
            var box = new Border { Width = PreviewGeometry.Extent(s.W, W, 4, 2), Height = PreviewGeometry.Extent(s.H, H, 4, 2), Background = fill, BorderBrush = sid == _draftSlot ? LeInk : Amber, BorderThickness = new Thickness(sid == _draftSlot ? 2 : 1), CornerRadius = new CornerRadius(4) };
            var col = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            col.Children.Add(new TextBlock { Text = s.Label ?? s.Id, FontSize = PreviewGeometry.LabelFontSize(s.H, H), FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk, HorizontalAlignment = HorizontalAlignment.Center });
            if (s.H * H > 44) col.Children.Add(new TextBlock { Text = text ?? "", FontSize = 11, Foreground = LeInk, HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = PreviewGeometry.Extent(s.W, W, 12, 20) });
            if (s.H * H > 64) col.Children.Add(new TextBlock { Text = s.Class, FontSize = 10, Foreground = LeDim, HorizontalAlignment = HorizontalAlignment.Center, FontFamily = new FontFamily("Consolas") });
            box.Child = col;
            box.Tapped += (_, e) => { e.Handled = true; OpenSlotPicker(sid); };
            box.RightTapped += (_, e) => { e.Handled = true; if (_sceneDraft.Assign.ContainsKey(sid)) SettingsFlyout(sid).ShowAt(box); };
            Canvas.SetLeft(box, s.X * W + 2); Canvas.SetTop(box, s.Y * H + 2);
            _sbPreview.Children.Add(box);
        }
        var (cw, ch) = WallSize();
        foreach (var p in _sceneDraft.Floating)
        {
            var w = Math.Min(1, Math.Max(0.12, p["size"]?.GetValue<double>() ?? 0.3));
            var ratio = 16 / 9.0;
            if (p["facet"]?.GetValue<string>() is { } fid && _model.Facet(fid) is { } f && ParseClass(f.SlotClass) is { } pc) ratio = Ratio(pc.Aspect.Replace("-strip", "").Replace("-ticker", "")) ?? 16 / 9.0;
            var h = Math.Min(1, w * cw / ratio / ch);
            var anchor = p["anchor"]?.GetValue<string>() ?? "bottom-right";
            double x = anchor.EndsWith("left") ? 0.02 : 1 - w - 0.02, y = anchor.StartsWith("top") ? 0.02 : 1 - h - 0.02;
            if (p["rect"] is JsonObject r) { x = r["x"]?.GetValue<double>() ?? x; y = r["y"]?.GetValue<double>() ?? y; w = r["w"]?.GetValue<double>() ?? w; h = r["h"]?.GetValue<double>() ?? h; }
            var who = p["facet"]?.GetValue<string>() is { } ff ? (_model.Facet(ff)?.Label ?? ff) : "♪ " + (p["visualization"]?.GetValue<string>() ?? "");
            var box = new Border { Width = Math.Max(2, w * W), Height = Math.Max(2, h * H), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x70, 0x5C, 0xC8, 0xC0)), BorderBrush = LeTeal, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(4), Child = new TextBlock { Text = who + "  ⤴", FontSize = 11, Foreground = LeInk, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } };
            Canvas.SetLeft(box, x * W); Canvas.SetTop(box, y * H); Canvas.SetZIndex(box, 10);
            _sbPreview.Children.Add(box);
        }
        if (_sceneDraft.Hidden.Count > 0)
        {
            var chip = new Border { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xC0, 0x12, 0x13, 0x1A)), CornerRadius = new CornerRadius(6), Padding = new Thickness(8, 3, 8, 3), Child = new TextBlock { Text = "♪ " + _sceneDraft.Hidden.Count + " hidden facet" + (_sceneDraft.Hidden.Count == 1 ? "" : "s") + " (zero-size, audio only)", FontSize = 11, Foreground = Muted } };
            Canvas.SetLeft(chip, 8); Canvas.SetTop(chip, H - 30); Canvas.SetZIndex(chip, 20);
            _sbPreview.Children.Add(chip);
        }
    }

    // ------------------------------------------------ save / set active
    private async Task SaveSceneDraftAsync(bool apply)
    {
        if (_sceneDraft is null) return;
        if (_sceneDraft.Layout.Length == 0) { SetPill("Prism · choose a layout first"); return; }
        if (string.IsNullOrWhiteSpace(_sceneDraft.Name))
        {
            var name = await PromptTextAsync("Name this scene", "", "Kitchen evening, Game day…", "Save");
            if (name is null) return;
            _sceneDraft.Name = name;
            if (_sbName is not null) _sbName.Text = name;
        }
        foreach (var e in _sceneDraft.Schedule) if (e["value"] is null && _sceneDraft.Id.Length > 0) e["value"] = _sceneDraft.Id;
        var raw = await ModelCallAsync("modelSaveScene", _sceneDraft.ToJson());
        string? id = null; var warnings = new List<string>();
        try
        {
            if (raw is not null && JsonNode.Parse(raw) is JsonObject r)
            {
                if (r["ok"]?.GetValue<bool>() == true) id = (r["value"] as JsonObject)?["id"]?.GetValue<string>();
                else { SetPill("Prism · not saved: " + (r["error"]?.GetValue<string>() ?? "?")); return; }
                if (r["warnings"] is JsonArray w) foreach (var x in w) if (x?.GetValue<string>() is { } s) warnings.Add(s);
            }
        }
        catch { }
        if (id is null) { SetPill("Prism · not saved"); return; }
        if (_sceneDraft.Id.Length == 0)
        {
            _sceneDraft.Id = id;
            if (_sceneDraft.Schedule.Any(e => e["value"] is null)) { foreach (var e in _sceneDraft.Schedule) e["value"] ??= id; await ModelCallAsync("modelSaveScene", _sceneDraft.ToJson()); }
        }
        foreach (var w in warnings) LogLine("scene save warning: " + w);
        SetPill("Prism · saved \"" + _sceneDraft.Name + "\"" + (warnings.Count > 0 ? "  ·  " + warnings.Count + " note" + (warnings.Count == 1 ? "" : "s") + " in host.log" : ""));
        await ReadModelAsync();
        if (apply)
        {
            if (await ApplySceneAsync(id)) RouteBack();
            return;
        }
        RenderBuilder();
    }
}
