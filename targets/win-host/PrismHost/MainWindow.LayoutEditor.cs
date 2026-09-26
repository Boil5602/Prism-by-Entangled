using System.Globalization;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using PrismHost.Layouts;

namespace PrismHost;

/// <summary>
/// The Layout editor (docs/scene-model-spec.md §3): the hero/grid solver
/// editor PLUS free-slot drawing on the preview, live slot-class badges from
/// core, the canvas class, save / rename / duplicate / archive (never delete),
/// and the duplicate question on save ("possibly duplicates ⟨name⟩ — use that
/// instead / save anyway / replace it", never a block). Persists through the
/// scene-model store (modelSaveLayout / modelArchiveLayout), not the old
/// master-layouts key. Entry point for the rail: OpenLayoutEditor(layoutId).
/// The shell draws and forwards; every class, snap and verdict is core's.
/// </summary>
public sealed partial class MainWindow
{
    private sealed class LeSlotDraft
    {
        public string Id = "";
        /// <summary>Solver purpose (hero / grid modes) - the shape the solver fights for.</summary>
        public string Purpose = "video";
        public string? Aspect = "16:9";
        public bool Hero;
        /// <summary>Normalized rect (canvas fractions): the truth in drawn mode; the solver's answer otherwise.</summary>
        public double X, Y, W, H;
        /// <summary>Core's class for the rect ("16:9·XL"); "?" until core has answered.</summary>
        public string Class = "?";
        /// <summary>Drawn slot kept at its own shape (spec §3 "custom — limits facet reuse") instead of snapping.</summary>
        public bool Custom;
        public string? Label;
    }

    private sealed class LeDraft
    {
        public string Id = "";
        public string Name = "";
        /// <summary>hero | grid (solver) | drawn (free rects).</summary>
        public string Mode = "hero";
        public int Cols = 2, Rows = 2;
        public double HeroSize = 0.62;
        public List<LeSlotDraft> Slots = new();
        public string CanvasLabel = "";
    }

    private sealed record Purpose(string Id, string Label, string? Aspect, string Blurb, bool Floating);

    /// <summary>Fallback only: the list comes from core (PrismRuntime.slotPurposes) - the shell adds nothing.</summary>
    private static readonly Purpose[] PurposeFallback =
    {
        new("video", "Video 16:9", "16:9", "Movies, streams, YouTube - the widescreen slot", false),
        new("web", "Web page 16:10", "16:10", "Dashboards, news, mail", false),
        new("square", "Square 1:1", "1:1", "Album art, clocks, a camera", false),
        new("custom", "Custom W:H", null, "Any shape you name", false),
    };

    private Grid? _layoutEditor;
    private LeDraft _le = new();
    private int _leSel = -1;
    private List<Purpose> _purposes = PurposeFallback.ToList();
    private Canvas? _lePreview;
    private Border? _lePreviewHost;
    private StackPanel? _leSlotList, _leSaved, _leHeroRow, _leGridRow, _leDupPanel;
    private TextBox? _leName;
    private TextBlock? _leWarn, _leHeroLabel, _leGridLabel, _leCanvas, _leHint;
    private RadioButton? _leHeroMode, _leGridMode, _leDrawnMode;
    private int _leSeq;
    private bool _leSaving;
    private string? _leSavedId;   // SM-3 integration: the last layout saved this session (EditorClosed reports it on close)

    private static LeDraft DefaultLeDraft() => new()
    {
        Mode = "hero", HeroSize = 0.62,
        Slots =
        {
            new LeSlotDraft { Id = "slot-1", Purpose = "video", Aspect = "16:9", Hero = true },
            new LeSlotDraft { Id = "slot-2", Purpose = "web", Aspect = "16:10" },
            new LeSlotDraft { Id = "slot-3", Purpose = "square", Aspect = "1:1" },
        },
    };

    /// <summary>Rail / menu entry (parameterless overload keeps `Item(..., OpenLayoutEditor)` compiling).</summary>
    public void OpenLayoutEditor() => OpenLayoutEditor(null);

    /// <summary>Open the Layout editor; with an id, that saved layout loads into the draft. Esc closes (EscapePressed chain).</summary>
    public async void OpenLayoutEditor(string? layoutId = null)
    {
        if (_layoutEditor is not null) { if (layoutId is null) { CloseLayoutEditor(); return; } CloseLayoutEditor(notify: false); }
        _leSavedId = null;
        await LoadPurposesAsync();
        _le = DefaultLeDraft();
        _leSel = -1;
        BuildLayoutEditorChrome();
        if (layoutId is not null)
        {
            var st = await ModelStateAsync();
            var l = st?.Layouts.FirstOrDefault(x => x.Id == layoutId);
            if (l is not null) LoadModelLayout(l); else SetPill("Prism · layout " + layoutId + " isn't saved, so this is a new one");
        }
        RenderLayoutEditor();
        _ = RefreshSavedLayoutsAsync();
    }

    private void CloseLayoutEditor() => CloseLayoutEditor(notify: true);

    /// <summary>Close; with notify, the opener learns whether a layout was saved this session (a save keeps the editor open; Done / Esc close it).</summary>
    private void CloseLayoutEditor(bool notify)
    {
        if (_layoutEditor is null) return;
        RootGrid.Children.Remove(_layoutEditor);
        _layoutEditor = null;
        var savedId = _leSavedId;
        if (notify) EditorClosed("layout", savedId, saved: savedId is not null);
        _lePreview = null; _lePreviewHost = null; _leSlotList = null; _leSaved = null; _leName = null; _leWarn = null; _leCanvas = null; _leHint = null; _leDupPanel = null;
        _leHeroMode = null; _leGridMode = null; _leDrawnMode = null; _leHeroRow = null; _leGridRow = null;
    }

    private void BuildLayoutEditorChrome()
    {
        var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF4, 0x0F, 0x12, 0x16)) };
        Canvas.SetZIndex(overlay, 900);
        overlay.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(400) });
        overlay.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        // ---- left: the draft
        var left = new StackPanel { Spacing = 10, Padding = new Thickness(22, 18, 16, 18) };
        left.Children.Add(new TextBlock { Text = "Layout editor", FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        left.Children.Add(new TextBlock
        {
            Text = "A Layout is a named set of Slots for this canvas class, with no Apps yet. Let the solver arrange them (Hero / Grid) or draw Slots on the preview. Every Slot shows its class (aspect bucket · size tier), which is what Facets are cut for. Esc closes.",
            FontSize = 12, Foreground = LeDim, TextWrapping = TextWrapping.Wrap,
        });
        _leName = new TextBox { PlaceholderText = "Name this Layout (e.g. Movie night, Morning wall)", Text = _le.Name };
        _leName.TextChanged += (_, __) => _le.Name = _leName.Text;
        left.Children.Add(_leName);
        _leCanvas = new TextBlock { FontSize = 12, Foreground = LeTeal };
        left.Children.Add(_leCanvas);

        left.Children.Add(Section("MODE"));
        var modes = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
        _leHeroMode = new RadioButton { Content = "Hero", GroupName = "lemode" };
        _leGridMode = new RadioButton { Content = "Grid", GroupName = "lemode" };
        _leDrawnMode = new RadioButton { Content = "Drawn", GroupName = "lemode" };
        _leHeroMode.Checked += (_, __) => SwitchMode("hero");
        _leGridMode.Checked += (_, __) => SwitchMode("grid");
        _leDrawnMode.Checked += (_, __) => SwitchMode("drawn");
        ToolTipService.SetToolTip(_leHeroMode, "One anchor Slot; the others are solved around it, each fighting for its shape (spec 8).");
        ToolTipService.SetToolTip(_leGridMode, "A fixed lattice; Slots take cells in order.");
        ToolTipService.SetToolTip(_leDrawnMode, "Free rects: drag on the preview to draw a Slot, drag a Slot to move it, its corner to resize. A drawn Slot snaps to the nearest aspect bucket unless you mark it custom.");
        modes.Children.Add(_leHeroMode);
        modes.Children.Add(_leGridMode);
        modes.Children.Add(_leDrawnMode);
        left.Children.Add(modes);

        _leHeroRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        _leHeroLabel = new TextBlock { Foreground = LeInk, VerticalAlignment = VerticalAlignment.Center, Width = 150 };
        _leHeroRow.Children.Add(_leHeroLabel);
        _leHeroRow.Children.Add(Small("−", () => { _le.HeroSize = Math.Max(0.3, Math.Round(_le.HeroSize - 0.04, 2)); RenderLayoutEditor(); }));
        _leHeroRow.Children.Add(Small("+", () => { _le.HeroSize = Math.Min(0.85, Math.Round(_le.HeroSize + 0.04, 2)); RenderLayoutEditor(); }));
        left.Children.Add(_leHeroRow);

        _leGridRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        _leGridLabel = new TextBlock { Foreground = LeInk, VerticalAlignment = VerticalAlignment.Center, Width = 150 };
        _leGridRow.Children.Add(_leGridLabel);
        _leGridRow.Children.Add(Small("cols −", () => { _le.Cols = Math.Max(1, _le.Cols - 1); RenderLayoutEditor(); }));
        _leGridRow.Children.Add(Small("cols +", () => { _le.Cols = Math.Min(8, _le.Cols + 1); RenderLayoutEditor(); }));
        _leGridRow.Children.Add(Small("rows −", () => { _le.Rows = Math.Max(1, _le.Rows - 1); RenderLayoutEditor(); }));
        _leGridRow.Children.Add(Small("rows +", () => { _le.Rows = Math.Min(8, _le.Rows + 1); RenderLayoutEditor(); }));
        left.Children.Add(_leGridRow);

        left.Children.Add(Section("SLOTS"));
        _leSlotList = new StackPanel { Spacing = 4 };
        left.Children.Add(_leSlotList);
        var add = new Button { Content = "＋  Add a Slot…", HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 6, 12, 6) };
        ToolTipService.SetToolTip(add, "What is this Slot for? Each purpose brings the shape the solver should fight for. In Drawn mode you can also just drag a rect on the preview.");
        add.Flyout = PurposeFlyout(p => AddLeSlot(p));
        left.Children.Add(add);
        _leHint = new TextBlock { FontSize = 11, Foreground = LeDim, TextWrapping = TextWrapping.Wrap };
        left.Children.Add(_leHint);
        _leWarn = new TextBlock { Foreground = Danger, FontSize = 12, TextWrapping = TextWrapping.Wrap };
        left.Children.Add(_leWarn);

        left.Children.Add(Section("SAVE"));
        _leDupPanel = new StackPanel { Spacing = 6, Visibility = Visibility.Collapsed, Padding = new Thickness(10), Background = LeSlot, CornerRadius = new CornerRadius(8) };
        left.Children.Add(_leDupPanel);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var save = new Button { Content = "Save Layout", Padding = new Thickness(14, 7, 14, 7), Background = Amber, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x12, 0x13, 0x1A)) };
        OwnHover(save);   // its own hover, never the system's (memory: hover-loss-tooltips)
        ToolTipService.SetToolTip(save, "Saved by name into the scene model. Near-duplicates (every Slot pairing at IoU ≥ 0.85) are flagged and asked about, never refused. Scenes pick from saved Layouts.");
        save.Click += (_, __) => _ = SaveLeDraftAsync();
        var dup = new Button { Content = "Duplicate", Padding = new Thickness(14, 7, 14, 7) };
        ToolTipService.SetToolTip(dup, "Continue as a copy: the draft gets a new id and \"(copy)\". The saved Layout is untouched.");
        dup.Click += (_, __) => DuplicateLeDraft();
        var close = new Button { Content = "Close", Padding = new Thickness(14, 7, 14, 7) };
        close.Click += (_, __) => CloseLayoutEditor();
        actions.Children.Add(save);
        actions.Children.Add(dup);
        actions.Children.Add(close);
        left.Children.Add(actions);

        left.Children.Add(Section("SAVED LAYOUTS"));
        _leSaved = new StackPanel { Spacing = 4 };
        left.Children.Add(_leSaved);

        overlay.Children.Add(new ScrollViewer { Content = left, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });

        // ---- right: the preview - the canvas at the window's real size, scaled; draw here
        var right = new Grid { Padding = new Thickness(10, 18, 22, 18) };
        right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        var cap = new TextBlock { Text = "Preview of what this canvas solves to (spec 8). Click a Slot to select it. Drag on empty canvas to draw a new Slot (this switches to Drawn).", FontSize = 12, Foreground = LeDim, Margin = new Thickness(0, 0, 0, 8), TextWrapping = TextWrapping.Wrap };
        right.Children.Add(cap);
        _lePreview = new Canvas { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x0B, 0x0D, 0x12)) };
        WireDrawing(_lePreview);
        _lePreviewHost = new Border { Child = _lePreview, BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x60, 0xF0, 0xA8, 0x3C)), BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var previewHostGrid = new Grid();
        previewHostGrid.Children.Add(_lePreviewHost);
        previewHostGrid.SizeChanged += (_, e) => { FitLePreview(e.NewSize.Width, e.NewSize.Height); DrawLePreview(); };
        Grid.SetRow(previewHostGrid, 1);
        right.Children.Add(previewHostGrid);
        Grid.SetColumn(right, 1);
        overlay.Children.Add(right);

        RootGrid.Children.Add(overlay);
        _layoutEditor = overlay;
    }

    private (double W, double H) LeCanvasSize()
    {
        var (cw, ch) = _surfaces.CanvasSize;
        if (cw < 1 || ch < 1) { cw = 1600; ch = 900; }
        return (cw, ch);
    }

    private void FitLePreview(double availW, double availH)
    {
        if (_lePreview is null) return;
        var (cw, ch) = LeCanvasSize();
        var w = Math.Max(200, availW - 4);
        var h = w * ch / cw;
        if (h > availH - 4) { h = Math.Max(120, availH - 4); w = h * cw / ch; }
        _lePreview.Width = w;
        _lePreview.Height = h;
    }

    // ------------------------------------------------ purposes (core's SLOT_PURPOSES; the shell adds nothing)
    private async Task LoadPurposesAsync()
    {
        try
        {
            var inner = await RuntimeEvalAsync("PrismRuntime.slotPurposes()");
            if (inner is null) return;
            using var doc = JsonDocument.Parse(inner);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return;
            var list = new List<Purpose>();
            foreach (var p in doc.RootElement.EnumerateArray())
            {
                var id = StrOf(p, "id") ?? "";
                var floating = BoolOf(p, "floating");
                if (floating) continue;   // scene-model §3: floating / hidden are scene-level, never Layout slots
                list.Add(new Purpose(id, StrOf(p, "label") ?? id, StrOf(p, "aspect"), StrOf(p, "blurb") ?? "", false));
            }
            if (list.Count > 0) _purposes = list;
        }
        catch { }
    }

    /// <summary>"What is this Slot for?" - the purposes with their blurbs, plus a custom W:H.</summary>
    private Flyout PurposeFlyout(Action<Purpose> pick)
    {
        var fly = new Flyout { Placement = FlyoutPlacementMode.Right };
        var col = new StackPanel { Spacing = 2, Width = 360 };
        col.Children.Add(new TextBlock { Text = "What is this Slot for?", FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk, Margin = new Thickness(0, 0, 0, 6) });
        foreach (var p in _purposes.Where(p => p.Aspect is not null))
        {
            var pp = p;
            col.Children.Add(AppRow(p.Label, p.Blurb, () => { fly.Hide(); pick(pp); }));
        }
        var custom = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(0, 6, 0, 0) };
        var box = new TextBox { PlaceholderText = "W:H  e.g. 3:2", Width = 150 };
        var use = new Button { Content = "Use custom shape" };
        use.Click += (_, __) =>
        {
            var v = box.Text.Trim();
            var parts = v.Split(':');
            if (parts.Length != 2 || !double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var w) || !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var h) || w <= 0 || h <= 0) { box.Text = ""; box.PlaceholderText = "W:H, two positive numbers"; return; }
            fly.Hide();
            pick(new Purpose("custom", "Custom " + v, v, "Any shape you name", false));
        };
        custom.Children.Add(box);
        custom.Children.Add(use);
        col.Children.Add(custom);
        fly.Content = col;
        return fly;
    }

    private void AddLeSlot(Purpose p)
    {
        var n = _le.Slots.Count + 1;
        var id = "slot-" + n;
        while (_le.Slots.Any(s => s.Id == id)) id = "slot-" + (++n);
        var s = new LeSlotDraft { Id = id, Purpose = p.Id, Aspect = p.Aspect };
        if (_le.Mode == "drawn")
        {
            // a fresh rect in a free-looking spot at the purpose's shape, a quarter of the canvas wide
            var (cw, ch) = LeCanvasSize();
            var ratio = Ratio(p.Aspect) ?? 16 / 9.0;
            s.W = 0.25; s.H = Math.Min(0.9, 0.25 * cw / ratio / ch);
            var k = _le.Slots.Count;
            s.X = Math.Min(1 - s.W, 0.05 + 0.08 * k); s.Y = Math.Min(1 - s.H, 0.05 + 0.08 * k);
        }
        if (!_le.Slots.Any(x => x.Hero)) s.Hero = true;
        _le.Slots.Add(s);
        _leSel = _le.Slots.Count - 1;
        RenderLayoutEditor();
    }

    /// <summary>Mode switch: entering Drawn freezes the solver's current rects (they become the truth); leaving it re-solves from purposes.</summary>
    private void SwitchMode(string mode)
    {
        if (_le.Mode == mode) return;
        if (mode == "drawn" && _le.Slots.All(s => s.W > 0 && s.H > 0)) { /* rects already hold the last solve */ }
        _le.Mode = mode;
        RenderLayoutEditor();
    }

    // ------------------------------------------------ render: list + preview (+ the two async answers from core)
    private void RenderLayoutEditor()
    {
        if (_layoutEditor is null) return;
        if (_leDupPanel is not null) { _leDupPanel.Visibility = Visibility.Collapsed; _leDupPanel.Children.Clear(); }   // the draft changed: the duplicate question is asked again on save
        var mode = _le.Mode;
        if (_leHeroRow is not null) _leHeroRow.Visibility = mode == "hero" ? Visibility.Visible : Visibility.Collapsed;
        if (_leGridRow is not null) _leGridRow.Visibility = mode == "grid" ? Visibility.Visible : Visibility.Collapsed;
        if (_leHeroLabel is not null) _leHeroLabel.Text = $"Hero size  {_le.HeroSize * 100:0}%";
        if (_leGridLabel is not null) _leGridLabel.Text = $"Lattice  {_le.Cols} × {_le.Rows}";
        if (_leHeroMode is not null && mode == "hero" && _leHeroMode.IsChecked != true) _leHeroMode.IsChecked = true;
        if (_leGridMode is not null && mode == "grid" && _leGridMode.IsChecked != true) _leGridMode.IsChecked = true;
        if (_leDrawnMode is not null && mode == "drawn" && _leDrawnMode.IsChecked != true) _leDrawnMode.IsChecked = true;
        if (_leHint is not null)
            _leHint.Text = mode == "drawn"
                ? "Drawn: drag on empty canvas to add a Slot; drag a Slot to move, its corner to resize. Shapes snap to the nearest aspect bucket; \"custom\" keeps the drawn shape (custom — limits facet reuse)."
                : "The solver places these; drawing on the preview freezes its rects into a Drawn layout you can then adjust.";
        RenderLeSlotList();
        _ = SolveAndClassifyAsync();
    }

    private void RenderLeSlotList()
    {
        if (_leSlotList is null) return;
        _leSlotList.Children.Clear();
        var mode = _le.Mode;
        for (var i = 0; i < _le.Slots.Count; i++)
        {
            var idx = i; var s = _le.Slots[i];
            var row = new Grid { ColumnSpacing = 4, Background = idx == _leSel ? LeSlotSel : LeSlot, Padding = new Thickness(6, 3, 4, 3), CornerRadius = new CornerRadius(6) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            for (var c = 0; c < 4; c++) row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var badge = new Border { Background = s.Custom ? new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xD0, 0x6A, 0x5A)) : new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0x5C, 0xC8, 0xC0)), CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 1, 6, 1), VerticalAlignment = VerticalAlignment.Center, Child = new TextBlock { Text = s.Class, FontSize = 11, Foreground = LeInk } };
            ToolTipService.SetToolTip(badge, s.Custom ? "custom — limits facet reuse" : "Slot class = aspect bucket · size tier (core's classing at this canvas). Facets are cut for a class.");
            var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            head.Children.Add(badge);
            var purposeLabel = mode == "drawn"
                ? $"{s.W * 100:0}×{s.H * 100:0}% at ({s.X * 100:0}, {s.Y * 100:0})"
                : (_purposes.FirstOrDefault(p => p.Id == s.Purpose)?.Label ?? ("Custom " + s.Aspect));
            var pick = new Button
            {
                Content = $"{idx + 1}.  {purposeLabel}" + (s.Hero && mode == "hero" ? "  ★" : ""),
                HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left,
                Padding = new Thickness(8, 4, 8, 4), FontSize = 12, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), BorderThickness = new Thickness(0),
            };
            if (mode != "drawn")
            {
                ToolTipService.SetToolTip(pick, "Change what this Slot is for (its solver shape)");
                pick.Flyout = PurposeFlyout(p => { s.Purpose = p.Id; s.Aspect = p.Aspect; _leSel = idx; RenderLayoutEditor(); });
            }
            pick.Click += (_, __) => { _leSel = idx; RenderLeSlotList(); DrawLePreview(); };
            head.Children.Add(pick);
            row.Children.Add(head);
            if (mode == "hero")
            {
                var star = Small(s.Hero ? "★" : "☆", () => { foreach (var x in _le.Slots) x.Hero = false; s.Hero = true; RenderLayoutEditor(); });
                ToolTipService.SetToolTip(star, "Make this the hero");
                Grid.SetColumn(star, 1);
                row.Children.Add(star);
            }
            if (mode == "drawn")
            {
                var cust = Small(s.Custom ? "custom" : "snap", () => { s.Custom = !s.Custom; _leSel = idx; _ = SnapSlotAsync(s, thenRender: true); });
                ToolTipService.SetToolTip(cust, s.Custom ? "Kept at its drawn shape. A custom shape limits facet reuse. Click to snap it to the nearest aspect bucket." : "Snapped to the nearest aspect bucket (reusable Facets). Click to keep the exact drawn shape instead.");
                Grid.SetColumn(cust, 2);
                row.Children.Add(cust);
            }
            var rm = Small("✕", () => { _le.Slots.RemoveAt(idx); if (!_le.Slots.Any(x => x.Hero) && _le.Slots.Count > 0) _le.Slots[0].Hero = true; _leSel = -1; RenderLayoutEditor(); });
            ToolTipService.SetToolTip(rm, "Remove this Slot from the Layout");
            Grid.SetColumn(rm, 4);
            row.Children.Add(rm);
            _leSlotList.Children.Add(row);
        }
    }

    /// <summary>The old master-layout shape core's previewLayout solves (hero / grid modes) - purposes, aspects, the hero.</summary>
    private string SolverDraftJson()
    {
        var slots = _le.Slots.Select(s =>
        {
            var d = new Dictionary<string, object?> { ["id"] = s.Id, ["purpose"] = s.Purpose };
            if (s.Aspect is not null) d["aspectHint"] = s.Aspect;
            if (s.Hero) d["hero"] = true;
            return d;
        }).ToList();
        return JsonSerializer.Serialize(new Dictionary<string, object?> { ["id"] = _le.Id, ["label"] = _le.Name, ["mode"] = _le.Mode == "grid" ? "grid" : "hero", ["cols"] = _le.Cols, ["rows"] = _le.Rows, ["heroSize"] = _le.HeroSize, ["gap"] = 8, ["slots"] = slots });
    }

    /// <summary>The scene-model Layout (normalized rects, provenance) - what modelSaveLayout / modelLayoutDuplicates / classifyLayout read.</summary>
    private string ModelLayoutJson(bool withClasses)
    {
        var (cw, ch) = LeCanvasSize();
        var slots = _le.Slots.Where(s => s.W > 0 && s.H > 0).Select(s =>
        {
            var d = new Dictionary<string, object?> { ["id"] = s.Id, ["rect"] = new { x = s.X, y = s.Y, w = s.W, h = s.H } };
            if (s.Custom)
            {
                // custom class = the drawn W:H (integers) + the tier core assigns; core keeps custom classes as marked
                var ratio = (s.W * cw) / (s.H * ch);
                d["custom"] = true;
                d["class"] = $"{Math.Round(ratio * 100)}:100·M";
            }
            else if (withClasses && s.Class != "?") d["class"] = s.Class;
            if (!string.IsNullOrEmpty(s.Label)) d["label"] = s.Label;
            return d;
        }).ToList();
        object source = _le.Mode switch
        {
            "hero" => new { mode = "hero", hero = _le.Slots.FirstOrDefault(s => s.Hero)?.Id ?? _le.Slots.FirstOrDefault()?.Id ?? "", heroSize = _le.HeroSize, satellites = "auto" },
            "grid" => new { mode = "grid", cols = _le.Cols, rows = _le.Rows },
            _ => new { mode = "drawn" },
        };
        return JsonSerializer.Serialize(new Dictionary<string, object?> { ["id"] = _le.Id, ["name"] = string.IsNullOrWhiteSpace(_le.Name) ? "Untitled layout" : _le.Name, ["canvasSize"] = new { w = cw, h = ch }, ["slots"] = slots, ["source"] = source });
    }

    /// <summary>Solve (hero / grid) then class every Slot through core; drawn layouts skip the solve.</summary>
    private async Task SolveAndClassifyAsync()
    {
        if (_layoutEditor is null) return;
        var seq = ++_leSeq;
        var (cw, ch) = LeCanvasSize();
        if (_le.Mode != "drawn")
        {
            if (_le.Slots.Count == 0) { DrawLePreview(); return; }
            var inner = await RuntimeEvalAsync("PrismRuntime.previewLayout(" + Q(SolverDraftJson()) + "," + Inv(cw) + "," + Inv(ch) + ")");
            if (seq != _leSeq || _layoutEditor is null) return;
            if (inner is null) { if (_leWarn is not null) _leWarn.Text = "core could not solve this draft"; DrawLePreview(); return; }
            try
            {
                using var doc = JsonDocument.Parse(inner);
                var root = doc.RootElement;
                foreach (var s in _le.Slots) { s.W = 0; s.H = 0; }
                if (root.TryGetProperty("rects", out var rects) && rects.ValueKind == JsonValueKind.Object)
                    foreach (var p in rects.EnumerateObject())
                    {
                        var s = _le.Slots.FirstOrDefault(x => x.Id == p.Name);
                        if (s is null) continue;
                        s.X = Num(p.Value, "x") / cw; s.Y = Num(p.Value, "y") / ch; s.W = Num(p.Value, "w") / cw; s.H = Num(p.Value, "h") / ch;
                    }
                var unplaced = root.TryGetProperty("unplaced", out var up) && up.ValueKind == JsonValueKind.Array ? up.GetArrayLength() : 0;
                if (_leWarn is not null) _leWarn.Text = unplaced > 0 ? $"{unplaced} Slot(s) do not fit the {_le.Cols} × {_le.Rows} lattice. Add cells, remove Slots, or use Hero mode" : "";
            }
            catch { }
        }
        else if (_leWarn is not null) _leWarn.Text = _le.Slots.Count == 0 ? "Drag on the preview to draw the first Slot" : "";
        DrawLePreview();
        // classes + canvas class: core's classing of the normalized rects at this canvas (B-10 lives in core)
        var classed = await ClassifyLayoutAsync(ModelLayoutJson(withClasses: false));
        if (seq != _leSeq || _layoutEditor is null) return;
        if (classed is null || classed == "null")
        {
            if (_leCanvas is not null) _leCanvas.Text = classed is null ? "Canvas class: (core's classing is unavailable until the model-eval bundle is built)" : "";
            return;
        }
        try
        {
            var l = ParseModelLayout(JsonDocument.Parse(classed).RootElement);
            _le.CanvasLabel = l.CanvasLabel;
            foreach (var ms in l.Slots)
            {
                var s = _le.Slots.FirstOrDefault(x => x.Id == ms.Id);
                if (s is not null) s.Class = ms.Class;
            }
            if (_leCanvas is not null) _leCanvas.Text = "Canvas class: " + l.CanvasLabel + $"   ({cw:0} × {ch:0})";
        }
        catch { }
        RenderLeSlotList();
        DrawLePreview();
    }

    // ------------------------------------------------ the preview: draw, select, move, resize, sketch new slots
    private void DrawLePreview()
    {
        if (_lePreview is null) return;
        _lePreview.Children.Clear();
        var pw = _lePreview.Width; var ph = _lePreview.Height;
        // Same trap the scene builder hit: an unmeasured element is NaN, and
        // `pw <= 0` is FALSE for NaN, so NaN reached a computed FontSize and
        // threw. Ask whether the size IS renderable.
        if (!PreviewGeometry.IsRenderable(pw, ph)) return;
        for (var i = 0; i < _le.Slots.Count; i++)
        {
            var s = _le.Slots[i];
            if (s.W <= 0 || s.H <= 0) continue;
            double x = s.X * pw, y = s.Y * ph, w = s.W * pw, h = s.H * ph;
            var selected = i == _leSel;
            var box = new Border
            {
                Width = Math.Max(2, w - 4), Height = Math.Max(2, h - 4),
                BorderBrush = s.Custom ? Danger : Amber, BorderThickness = new Thickness(selected ? 3 : 1),
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(selected ? (byte)0x40 : (byte)0x22, 0xF0, 0xA8, 0x3C)),
                CornerRadius = new CornerRadius(4),
            };
            var col = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, IsHitTestVisible = false };
            col.Children.Add(new TextBlock { Text = (i + 1).ToString() + (s.Hero && _le.Mode == "hero" ? " ★" : ""), FontSize = PreviewGeometry.ClampFont(h / 5, 12, 28), FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk, HorizontalAlignment = HorizontalAlignment.Center });
            if (h > 40)
            {
                var badge = new Border { Background = s.Custom ? new SolidColorBrush(Windows.UI.Color.FromArgb(0x80, 0xD0, 0x6A, 0x5A)) : new SolidColorBrush(Windows.UI.Color.FromArgb(0x80, 0x5C, 0xC8, 0xC0)), CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 1, 6, 1), HorizontalAlignment = HorizontalAlignment.Center, Child = new TextBlock { Text = s.Class, FontSize = 11, Foreground = LeInk } };
                col.Children.Add(badge);
            }
            if (h > 64 && s.Custom) col.Children.Add(new TextBlock { Text = "custom — limits facet reuse", FontSize = 10, Foreground = LeDim, HorizontalAlignment = HorizontalAlignment.Center });
            box.Child = col;
            var idx = i;
            if (_le.Mode == "drawn") WireSlotDrag(box, s, idx);
            else box.PointerPressed += (_, ev) => { ev.Handled = true; _leSel = idx; RenderLeSlotList(); DrawLePreview(); };
            Canvas.SetLeft(box, x + 2);
            Canvas.SetTop(box, y + 2);
            Canvas.SetZIndex(box, selected ? 5 : 1);
            _lePreview.Children.Add(box);
            if (_le.Mode == "drawn")
            {
                // resize grip at the bottom-right corner
                var grip = new Border { Width = 14, Height = 14, Background = s.Custom ? Danger : Amber, CornerRadius = new CornerRadius(3) };
                ToolTipService.SetToolTip(grip, "Drag to resize (snaps to the nearest aspect bucket unless custom)");
                WireSlotResize(grip, s, idx);
                Canvas.SetLeft(grip, x + w - 16);
                Canvas.SetTop(grip, y + h - 16);
                Canvas.SetZIndex(grip, 9);
                _lePreview.Children.Add(grip);
            }
        }
    }

    private void WireSlotDrag(Border box, LeSlotDraft slot, int idx)
    {
        Windows.Foundation.Point? start = null; double sl = 0, st = 0; var moved = false;
        box.PointerPressed += (_, ev) =>
        {
            var pt = ev.GetCurrentPoint(_lePreview);
            if (!pt.Properties.IsLeftButtonPressed) return;
            ev.Handled = true;
            start = pt.Position; sl = Canvas.GetLeft(box); st = Canvas.GetTop(box); moved = false;
            box.CapturePointer(ev.Pointer);
            _leSel = idx;
        };
        box.PointerMoved += (_, ev) =>
        {
            if (start is not { } d || _lePreview is null) return;
            var p = ev.GetCurrentPoint(_lePreview).Position;
            if (Math.Abs(p.X - d.X) + Math.Abs(p.Y - d.Y) > 2) moved = true;
            Canvas.SetLeft(box, Math.Max(2, Math.Min(_lePreview.Width - box.Width - 2, sl + p.X - d.X)));
            Canvas.SetTop(box, Math.Max(2, Math.Min(_lePreview.Height - box.Height - 2, st + p.Y - d.Y)));
            ev.Handled = true;
        };
        void End(object _, PointerRoutedEventArgs ev)
        {
            if (start is null || _lePreview is null) return;
            start = null;
            box.ReleasePointerCapture(ev.Pointer);
            ev.Handled = true;
            if (moved)
            {
                slot.X = Math.Max(0, Math.Min(1 - slot.W, (Canvas.GetLeft(box) - 2) / _lePreview.Width));
                slot.Y = Math.Max(0, Math.Min(1 - slot.H, (Canvas.GetTop(box) - 2) / _lePreview.Height));
            }
            RenderLayoutEditor();
        }
        box.PointerReleased += End;
        box.PointerCanceled += End;
    }

    private void WireSlotResize(Border grip, LeSlotDraft slot, int idx)
    {
        Windows.Foundation.Point? start = null; double w0 = 0, h0 = 0;
        grip.PointerPressed += (_, ev) =>
        {
            var pt = ev.GetCurrentPoint(_lePreview);
            if (!pt.Properties.IsLeftButtonPressed) return;
            ev.Handled = true;
            start = pt.Position; w0 = slot.W; h0 = slot.H;
            grip.CapturePointer(ev.Pointer);
            _leSel = idx;
        };
        grip.PointerMoved += (_, ev) =>
        {
            if (start is not { } d || _lePreview is null) return;
            var p = ev.GetCurrentPoint(_lePreview).Position;
            slot.W = Math.Max(0.04, Math.Min(1 - slot.X, w0 + (p.X - d.X) / _lePreview.Width));
            slot.H = Math.Max(0.04, Math.Min(1 - slot.Y, h0 + (p.Y - d.Y) / _lePreview.Height));
            Canvas.SetLeft(grip, (slot.X + slot.W) * _lePreview.Width - 16);
            Canvas.SetTop(grip, (slot.Y + slot.H) * _lePreview.Height - 16);
            ev.Handled = true;
        };
        void End(object _, PointerRoutedEventArgs ev)
        {
            if (start is null) return;
            start = null;
            grip.ReleasePointerCapture(ev.Pointer);
            ev.Handled = true;
            _ = SnapSlotAsync(slot, thenRender: true);
        }
        grip.PointerReleased += End;
        grip.PointerCanceled += End;
    }

    /// <summary>Drag on empty canvas: sketch a rect; on release it becomes a Slot (the layout turns Drawn, the solver's rects frozen).</summary>
    private void WireDrawing(Canvas preview)
    {
        Windows.Foundation.Point? start = null;
        Border? rubber = null;
        preview.PointerPressed += (_, ev) =>
        {
            if (!ReferenceEquals(ev.OriginalSource, preview)) return;   // a Slot took it
            var pt = ev.GetCurrentPoint(preview);
            if (!pt.Properties.IsLeftButtonPressed) return;
            ev.Handled = true;
            start = pt.Position;
            rubber = new Border { BorderBrush = LeTeal, BorderThickness = new Thickness(2), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x30, 0x5C, 0xC8, 0xC0)), CornerRadius = new CornerRadius(4), IsHitTestVisible = false, Width = 1, Height = 1 };
            Canvas.SetLeft(rubber, start.Value.X); Canvas.SetTop(rubber, start.Value.Y); Canvas.SetZIndex(rubber, 20);
            preview.Children.Add(rubber);
            preview.CapturePointer(ev.Pointer);
        };
        preview.PointerMoved += (_, ev) =>
        {
            if (start is not { } d || rubber is null) return;
            var p = ev.GetCurrentPoint(preview).Position;
            var x = Math.Max(0, Math.Min(d.X, p.X)); var y = Math.Max(0, Math.Min(d.Y, p.Y));
            var x2 = Math.Min(preview.Width, Math.Max(d.X, p.X)); var y2 = Math.Min(preview.Height, Math.Max(d.Y, p.Y));
            Canvas.SetLeft(rubber, x); Canvas.SetTop(rubber, y);
            rubber.Width = Math.Max(1, x2 - x); rubber.Height = Math.Max(1, y2 - y);
            ev.Handled = true;
        };
        void End(object _, PointerRoutedEventArgs ev)
        {
            if (start is not { } d || rubber is null) return;
            var p = ev.GetCurrentPoint(preview).Position;
            preview.ReleasePointerCapture(ev.Pointer);
            preview.Children.Remove(rubber);
            rubber = null; start = null;
            ev.Handled = true;
            var x = Math.Max(0, Math.Min(d.X, p.X)); var y = Math.Max(0, Math.Min(d.Y, p.Y));
            var x2 = Math.Min(preview.Width, Math.Max(d.X, p.X)); var y2 = Math.Min(preview.Height, Math.Max(d.Y, p.Y));
            if (x2 - x < 24 || y2 - y < 24) return;   // a click, not a sketch
            if (_le.Mode != "drawn") { _le.Mode = "drawn"; SetPill("Prism · drawn Slot. The solver's rects are frozen into a Drawn layout"); }
            var n = _le.Slots.Count + 1;
            var id = "slot-" + n;
            while (_le.Slots.Any(s => s.Id == id)) id = "slot-" + (++n);
            var slot = new LeSlotDraft { Id = id, Purpose = "custom", Aspect = null, X = x / preview.Width, Y = y / preview.Height, W = (x2 - x) / preview.Width, H = (y2 - y) / preview.Height };
            if (!_le.Slots.Any(s => s.Hero)) slot.Hero = true;
            _le.Slots.Add(slot);
            _leSel = _le.Slots.Count - 1;
            _ = SnapSlotAsync(slot, thenRender: true);
        }
        preview.PointerReleased += End;
        preview.PointerCanceled += End;
    }

    /// <summary>Snap a drawn Slot to the nearest aspect bucket (core's nearestAspectBucket): keep the width and the top-left, fit the height; custom Slots keep their shape.</summary>
    private async Task SnapSlotAsync(LeSlotDraft slot, bool thenRender)
    {
        if (!slot.Custom)
        {
            var (cw, ch) = LeCanvasSize();
            var ratio = (slot.W * cw) / (slot.H * ch);
            var near = await NearestBucketAsync(ratio);
            if (near is { } b)
            {
                var h = (slot.W * cw) / b.Ratio / ch;
                if (slot.Y + h > 1) { h = 1 - slot.Y; slot.W = (h * ch * b.Ratio) / cw; if (slot.X + slot.W > 1) slot.X = 1 - slot.W; }
                slot.H = h;
                slot.Aspect = b.Bucket == "21:9-strip" ? "21:9" : b.Bucket == "8:1-ticker" ? "8:1" : b.Bucket;
            }
        }
        if (thenRender) RenderLayoutEditor();
    }

    // ------------------------------------------------ save / duplicate question / duplicate / archive / load
    private async Task SaveLeDraftAsync(string? replaceId = null, bool force = false)
    {
        if (_leSaving) return;
        if (_le.Slots.Count(s => s.W > 0 && s.H > 0) == 0) { SetPill("Prism · add at least one Slot"); return; }
        if (string.IsNullOrWhiteSpace(_le.Name))
        {
            var name = await PromptTextAsync("Name this Layout", "", "e.g. Movie night, Morning wall", "Save");
            if (string.IsNullOrWhiteSpace(name)) return;
            _le.Name = name.Trim();
            if (_leName is not null) _leName.Text = _le.Name;
        }
        if (replaceId is not null) _le.Id = replaceId;
        if (string.IsNullOrEmpty(_le.Id)) _le.Id = "layout-" + DateTime.UtcNow.Ticks.ToString("x", CultureInfo.InvariantCulture);
        _leSaving = true;
        try
        {
            var json = ModelLayoutJson(withClasses: false);
            if (!force)
            {
                // spec §3: same canvas class, every Slot pairing at IoU ≥ 0.85 → ask, never block
                var dupsRaw = await RuntimeEvalAsync("PrismRuntime.modelLayoutDuplicates(" + Q(json) + ")");
                var dups = new List<(string Id, string Name, bool Archived)>();
                try
                {
                    if (dupsRaw is not null)
                        using (var d = JsonDocument.Parse(dupsRaw))
                            if (d.RootElement.ValueKind == JsonValueKind.Array)
                                foreach (var e in d.RootElement.EnumerateArray()) dups.Add((StrOf(e, "id") ?? "", StrOf(e, "name") ?? "?", BoolOf(e, "archived")));
                }
                catch { }
                if (dups.Count > 0) { ShowDuplicateQuestion(dups); return; }
            }
            var res = await RuntimeEvalAsync("PrismRuntime.modelSaveLayout(" + Q(json) + ")");
            if (res is null || !res.Contains("\"ok\":true")) { SetPill("Prism · could not save the Layout" + (res is null ? "" : ": " + Shorten(res, 80))); return; }
            try
            {
                using var d = JsonDocument.Parse(res);
                var value = d.RootElement.GetProperty("value");
                var saved = ParseModelLayout(value);
                _le.Id = saved.Id;
                foreach (var ms in saved.Slots) { var s = _le.Slots.FirstOrDefault(x => x.Id == ms.Id); if (s is not null) s.Class = ms.Class; }
                if (_leCanvas is not null) _leCanvas.Text = "Canvas class: " + saved.CanvasLabel;
            }
            catch { }
            _leSavedId = _le.Id;
            SetPill("Prism · saved Layout \"" + _le.Name + "\"");
            RenderLeSlotList();
            DrawLePreview();
            await RefreshSavedLayoutsAsync();
        }
        finally { _leSaving = false; }
    }

    /// <summary>"possibly duplicates ⟨name⟩ — use that instead / save anyway / replace it" (spec §3). Inline, three real choices, never a block.</summary>
    private void ShowDuplicateQuestion(List<(string Id, string Name, bool Archived)> dups)
    {
        if (_leDupPanel is null) return;
        _leDupPanel.Children.Clear();
        var names = string.Join(", ", dups.Select(d => "⟨" + d.Name + (d.Archived ? " (archived)" : "") + "⟩"));
        _leDupPanel.Children.Add(new TextBlock { Text = "possibly duplicates " + names, FontSize = 13, Foreground = Amber, TextWrapping = TextWrapping.Wrap });
        _leDupPanel.Children.Add(new TextBlock { Text = "Every Slot pairs with one of its Slots within tolerance (IoU ≥ 0.85).", FontSize = 11, Foreground = LeDim, TextWrapping = TextWrapping.Wrap });
        var first = dups[0];
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var use = Small("Use " + Shorten(first.Name, 22) + " instead", () =>
        {
            _leDupPanel!.Visibility = Visibility.Collapsed;
            _ = LoadSavedLayoutAsync(first.Id, first.Archived);
        });
        ToolTipService.SetToolTip(use, "Drop this draft and open the existing Layout" + (first.Archived ? " (it's archived and will be restored)" : ""));
        var anyway = Small("Save anyway", () => { _leDupPanel!.Visibility = Visibility.Collapsed; _ = SaveLeDraftAsync(force: true); });
        var replace = Small("Replace it", () => { _leDupPanel!.Visibility = Visibility.Collapsed; _ = SaveLeDraftAsync(replaceId: first.Id, force: true); });
        ToolTipService.SetToolTip(replace, "Overwrite " + first.Name + " with this draft (same id, so scenes using it follow)");
        row.Children.Add(use);
        row.Children.Add(anyway);
        row.Children.Add(replace);
        _leDupPanel.Children.Add(row);
        _leDupPanel.Visibility = Visibility.Visible;
        SetPill("Prism · this may duplicate " + names + ". Choose below");
    }

    private void DuplicateLeDraft()
    {
        _le.Id = "";
        _le.Name = string.IsNullOrWhiteSpace(_le.Name) ? "" : _le.Name + " (copy)";
        if (_leName is not null) _leName.Text = _le.Name;
        SetPill("Prism · continuing as a copy. Save Layout stores it as a new one");
        RenderLayoutEditor();
    }

    private async Task LoadSavedLayoutAsync(string id, bool restore = false)
    {
        if (restore) await RuntimeEvalAsync("PrismRuntime.modelArchiveLayout(" + Q(id) + ", false)");
        var st = await ModelStateAsync();
        var l = st?.Layouts.FirstOrDefault(x => x.Id == id);
        if (l is null) { SetPill("Prism · that Layout is not saved"); return; }
        LoadModelLayout(l);
        RenderLayoutEditor();
        await RefreshSavedLayoutsAsync();
    }

    /// <summary>A saved Layout into the draft: provenance restores the solver mode where it was one; the rects are always the truth.</summary>
    private void LoadModelLayout(ModelLayout l)
    {
        var d = new LeDraft { Id = l.Id, Name = l.Name, Mode = l.SourceMode == "hero" || l.SourceMode == "grid" ? l.SourceMode : "drawn", CanvasLabel = l.CanvasLabel };
        try
        {
            using var doc = JsonDocument.Parse(l.Json);
            if (doc.RootElement.TryGetProperty("source", out var so) && so.ValueKind == JsonValueKind.Object)
            {
                if (so.TryGetProperty("heroSize", out var hs) && hs.ValueKind == JsonValueKind.Number) d.HeroSize = hs.GetDouble();
                if (so.TryGetProperty("cols", out var c) && c.ValueKind == JsonValueKind.Number) d.Cols = Math.Max(1, c.GetInt32());
                if (so.TryGetProperty("rows", out var r) && r.ValueKind == JsonValueKind.Number) d.Rows = Math.Max(1, r.GetInt32());
                var hero = StrOf(so, "hero");
                foreach (var s in l.Slots)
                {
                    // the solver hint = the class's aspect bucket (a Layout stores classes, not purposes)
                    var aspect = s.Class.Split('·')[0];
                    aspect = aspect == "21:9-strip" ? "21:9" : aspect == "8:1-ticker" ? "8:1" : aspect;
                    var purpose = _purposes.FirstOrDefault(p => p.Aspect == aspect)?.Id ?? "custom";
                    d.Slots.Add(new LeSlotDraft { Id = s.Id, Purpose = purpose, Aspect = aspect, Hero = s.Id == hero, X = s.X, Y = s.Y, W = s.W, H = s.H, Class = s.Class, Custom = s.Custom, Label = s.Label });
                }
            }
            else foreach (var s in l.Slots) d.Slots.Add(new LeSlotDraft { Id = s.Id, Purpose = "custom", Aspect = s.Class.Split('·')[0], X = s.X, Y = s.Y, W = s.W, H = s.H, Class = s.Class, Custom = s.Custom, Label = s.Label });
        }
        catch { }
        if (d.Mode == "hero" && !d.Slots.Any(s => s.Hero) && d.Slots.Count > 0) d.Slots[0].Hero = true;
        _le = d;
        _leSel = -1;
        if (_leName is not null) _leName.Text = d.Name;
        SetPill("Prism · editing Layout \"" + d.Name + "\"" + (l.Archived ? " (archived)" : ""));
    }

    private async Task RefreshSavedLayoutsAsync()
    {
        if (_leSaved is null) return;
        var st = await ModelStateAsync();
        if (_leSaved is null) return;
        _leSaved.Children.Clear();
        if (st is null || st.Layouts.Count == 0)
        {
            _leSaved.Children.Add(new TextBlock { Text = "None yet. Save the draft above.", FontSize = 12, Foreground = LeDim });
            return;
        }
        foreach (var l in st.Layouts.OrderBy(x => x.Archived).ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase))
        {
            var row = new Grid { ColumnSpacing = 4, Background = LeSlot, Padding = new Thickness(8, 3, 4, 3), CornerRadius = new CornerRadius(6), Opacity = l.Archived ? 0.6 : 1 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            for (var c = 0; c < 2; c++) row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var n = l.Slots.Count;
            var text = new TextBlock { Text = $"{l.Name}   ·   {n} slot{(n == 1 ? "" : "s")}   ·   {l.CanvasLabel}" + (l.Archived ? "   ·   archived" : "") + (l.Id == _le.Id ? "   (editing)" : ""), FontSize = 12, Foreground = LeInk, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
            ToolTipService.SetToolTip(text, string.Join("  ·  ", l.Slots.Select(s => s.Class)));
            row.Children.Add(text);
            var lid = l.Id; var archived = l.Archived;
            var edit = Small("Edit", () => _ = LoadSavedLayoutAsync(lid));
            ToolTipService.SetToolTip(edit, "Load this Layout into the editor");
            Grid.SetColumn(edit, 1); row.Children.Add(edit);
            var arch = Small(archived ? "Restore" : "Archive", () => { _ = RuntimeEvalAsync("PrismRuntime.modelArchiveLayout(" + Q(lid) + ", " + (archived ? "false" : "true") + ")").ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = RefreshSavedLayoutsAsync())); });
            ToolTipService.SetToolTip(arch, archived ? "Back into the pickers" : "Hide from pickers. Never deleted: Scenes using it keep working, and Restore brings it back.");
            Grid.SetColumn(arch, 2); row.Children.Add(arch);
            _leSaved.Children.Add(row);
        }
    }
}
