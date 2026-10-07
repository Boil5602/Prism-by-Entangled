using System.Diagnostics;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// The app menu: a quiet grip hanging from the top-center edge (dim at rest,
/// bright on hover, always above tiles and overlays) that drops a full
/// MenuFlyout - every host action in one discoverable place, hotkeys shown
/// beside the items that have them. F10 opens it from the keyboard. Like the
/// pill (spec 30), the grip must never become the distraction Prism removes:
/// no motion, no color alarms, no unprompted expansion.
///
/// Every item routes through core calls (spec 23): layout, slot count, a
/// slot's address and its region are all document edits core persists.
/// The host draws: the slot picker (which slot?), the viewfinder (the page
/// full screen, a zoom slider, a glowing box shaped like the slot, wheel-
/// sized, click-placed) and the dialogs.
/// </summary>
public sealed partial class MainWindow
{
    private const double GripRestOpacity = 0.45;
    private bool _menuOpen;
    private bool _wallFs;
    private readonly List<string> _armedAdapters = new();

    private static readonly SolidColorBrush Amber = new(Windows.UI.Color.FromArgb(255, 0xF0, 0xA8, 0x3C));
    private static readonly SolidColorBrush Muted = new(Windows.UI.Color.FromArgb(255, 0xC0, 0xC8, 0xD2));
    private static readonly SolidColorBrush Danger = new(Windows.UI.Color.FromArgb(255, 0xD0, 0x6A, 0x5A));

    private void WireMenuGrip()
    {
        MenuGrip.Opacity = GripRestOpacity;
        MenuGrip.PointerEntered += (_, __) => MenuGrip.Opacity = 1;
        MenuGrip.PointerExited += (_, __) => { if (!_menuOpen) MenuGrip.Opacity = GripRestOpacity; };
        MenuGrip.PointerPressed += async (_, e) => { e.Handled = true; await OpenAppMenuAsync(); };
        // the Watch tab at the top is gone (2026-09-28, "The watch button at the top open the watch menu screen is redundant, can we remove it? We have
        // it on the video control area already. Can we add a hotkey like CTRL+SHIFT+W, just as a backup?"): it is never drawn or pressed; its
        // Visibility still says the Video player is the wall (the stage bar, Esc and the home rule read it). Ctrl+Shift+W opens Watch, as the
        // stage bar's Watch and Esc on the bare wall do
        WatchGrip.Opacity = 0;
        WatchGrip.IsHitTestVisible = false;
        var ctrlShiftW = new KeyboardAccelerator { Key = Windows.System.VirtualKey.W, Modifiers = Windows.System.VirtualKeyModifiers.Control | Windows.System.VirtualKeyModifiers.Shift };
        ctrlShiftW.Invoked += async (_, e) => { e.Handled = true; await OpenWatchByKeyAsync(); };
        RootGrid.KeyboardAccelerators.Add(ctrlShiftW);
        var f10 = new KeyboardAccelerator { Key = Windows.System.VirtualKey.F10 };
        f10.Invoked += async (_, e) => { e.Handled = true; await OpenAppMenuAsync(); };
        RootGrid.KeyboardAccelerators.Add(f10);
        var f11 = new KeyboardAccelerator { Key = Windows.System.VirtualKey.F11 };
        f11.Invoked += (_, e) => { e.Handled = true; ToggleWallFullscreen(); };
        RootGrid.KeyboardAccelerators.Add(f11);
        var f8 = new KeyboardAccelerator { Key = Windows.System.VirtualKey.F8 };
        f8.Invoked += (_, e) => { e.Handled = true; BeginSlotRegion(); };
        RootGrid.KeyboardAccelerators.Add(f8);
        WireSceneModelUi();                                            // §6a router, badges, visualizations (MainWindow.QuickActions.cs)
    }

    // ------------------------------------------------------------ the menu
    private async Task OpenAppMenuAsync()
    {
        if (_menuOpen) return;
        var wall = await ReadWallStateAsync();          // layout + tiles from CORE (effective state)
        var veils = _surfaces.VeilStates().ToDictionary(v => v.Id, v => (v.Covered, v.Peeked));
        var anyCovered = veils.Values.Any(v => v.Covered && !v.Peeked);
        var anyPeeked = veils.Values.Any(v => v.Covered && v.Peeked);
        var n = wall.Tiles.Count;

        var menu = new MenuFlyout
        {
            Placement = FlyoutPlacementMode.Bottom,
            MenuFlyoutPresenterStyle = (Style)RootGrid.Resources["PrismMenuPresenter"],
        };
        // WebView2 dismisses a light-dismiss flyout the moment the pointer
        // crosses it (its input path counts as "outside") - the gap under the
        // grip and every gap between cascading submenus is WebView territory.
        // While the menu is open an invisible XAML shield covers the wall, so
        // the pointer never touches a WebView; a click on the shield closes
        // the menu the way clicking away should.
        var shield = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)) };
        Canvas.SetZIndex(shield, 999);
        shield.PointerPressed += (_, e) => { e.Handled = true; menu.Hide(); };
        menu.Opened += (_, __) => { _menuOpen = true; MenuGrip.Opacity = 1; if (!RootGrid.Children.Contains(shield)) RootGrid.Children.Add(shield); };
        menu.Closed += (_, __) => { _menuOpen = false; MenuGrip.Opacity = GripRestOpacity; RootGrid.Children.Remove(shield); };

        // --- the rail (scene-model-spec §6): five nouns in pipeline order, each a list + editor - replaces the configure screens
        var scenesItem = Item("Scenes…", "", null, () => OpenRoute("prism://scenes"));
        ToolTipService.SetToolTip(scenesItem, "What is playing now, the scene grid, + New Scene (the template wizard walks Add App → Facet → Layout → assign).");
        menu.Items.Add(scenesItem);
        var layoutsItem = Item("Layouts…", "", null, () => OpenRoute("prism://layouts"));
        ToolTipService.SetToolTip(layoutsItem, "Named arrangements of classed slots for a canvas class; near-duplicates flagged, archive never deletes.");
        menu.Items.Add(layoutsItem);
        var facetsItem = Item("Facets…", "", null, () => OpenRoute("prism://facets"));
        ToolTipService.SetToolTip(facetsItem, "One face of an App (a page, a region and a zoom) cut for a slot class, grouped by App.");
        menu.Items.Add(facetsItem);
        var appsItem = Item("Apps…", "", null, () => OpenRoute("prism://apps"));
        ToolTipService.SetToolTip(appsItem, "Service identities with their setup status; + Add App from the catalog or any URL; setup mode signs you in once.");
        menu.Items.Add(appsItem);
        var deviceItem = Item("Device…", "", null, () => OpenRoute("prism://device"));
        ToolTipService.SetToolTip(deviceItem, "Canvas class, schedules, remotes, audio, kiosk, updates.");
        menu.Items.Add(deviceItem);
        menu.Items.Add(await BuildNowPlayingMenuAsync());
        // The two players (core players.ts, 2026-09-19): "I imagine it's just a prism menu item" - the wall becomes the
        // household's Music Lounge or its Movie Night in one press, and back again; the Video player carries the lounge's
        // sources hidden so the music stays warm, and the way back resumes what a video paused.
        foreach (var item in await BuildPlayerItemsAsync()) menu.Items.Add(item);
        // the people of this wall, for both players (2026-09-29, "we don't yet have the concept of profiles in the music player ... Ideally it
        // uses the same profiles set on the video side"): the sets, and the Profiles window
        try
        {
            var people = new MenuFlyoutSubItem { Text = "Profiles", Icon = new FontIcon { Glyph = "\uE716" } };
            foreach (var it in await BuildPresetItemsAsync()) people.Items.Add(it);
            if (people.Items.Count > 0) menu.Items.Add(people);
        }
        catch (Exception e) { LogLine("profiles menu: " + e.Message); }
        // VP-3 (2026-09-19): the Video player as a universal player - Watch: the service on the screen with its verbs, "Watch on"
        // across the household's video services, Continue Watching / My List from every service, the profile gate when it is up
        if (await BuildWatchMenuAsync() is { } watch) menu.Items.Add(watch);
        menu.Items.Add(new MenuFlyoutSeparator());
        // --- the pre-scene-model page tools stay reachable until SM-2's editors land (F8: sign in / navigate on the popped-out page)
        var configure = Item("Page tools (sign in, region)…", "", "F8", BeginSlotRegion);
        ToolTipService.SetToolTip(configure, "The popped-out page: sign in, navigate, place a region. Superseded by App setup and the facet editor.");
        menu.Items.Add(configure);
        menu.Items.Add(new MenuFlyoutSeparator());

        // --- slots on the wall: add (catalog / any site), arrange
        menu.Items.Add(Item("Add an app from the catalog…", "", "Ctrl+N", TogglePicker));
        menu.Items.Add(Item("Add a website…", "", null, () => _ = AddWebsiteAsync()));
        menu.Items.Add(Item("Arrange the wall…", "", "Ctrl+A", ToggleArrange));
        menu.Items.Add(new MenuFlyoutSeparator());

        // --- layout: mode, lattice, hero + size (spec 8 / 1)
        menu.Items.Add(BuildLayoutMenu(wall));
        menu.Items.Add(BuildFloatingMenu(wall));

        // --- slots (doc order; Ctrl+digit matches ToggleTileFullscreen's index)
        var slots = new MenuFlyoutSubItem { Text = n == 1 ? "1 slot" : n + " slots", Icon = Glyph("") };
        if (n == 0) slots.Items.Add(new MenuFlyoutItem { Text = "No slots on the wall. Add one above", IsEnabled = false });
        for (var i = 0; i < n; i++)
        {
            var t = wall.Tiles[i];
            var id = t.Id;
            var isHero = id == wall.Hero;
            var zoomed = Math.Abs(t.Zoom - 1) > 0.001;
            var sub = new MenuFlyoutSubItem
            {
                Text = t.Name + (isHero ? "  ★ hero" : "") + (t.HasRegion ? "  ⌗" : "") + (zoomed ? $"  {t.Zoom:0.0#}×" : ""),
            };
            if (isHero) sub.Foreground = Amber;
            var digit = i + 1;
            var hasCover = veils.TryGetValue(id, out var vs) && vs.Covered;
            if (t.Url is { } u)
                sub.Items.Add(new MenuFlyoutItem { Text = Shorten(u, 48), IsEnabled = false });
            sub.Items.Add(Item("Configure app… (sign in, navigate)", null, null, () => BeginViewfinder(id, "app")));
            sub.Items.Add(Item("New facet… (region, shape, zoom)", null, null, () => BeginViewfinder(id, "views")));
            if (t.HasRegion || t.HasSelector)
                sub.Items.Add(Item(t.HasRegion ? "Show the whole page (clear region)" : "Show the whole page (clear focus)", null, null,
                    () => _brain.Call(HostCalls.UpdateTile, id, "{\"focus\":null}")));
            if (zoomed)
                sub.Items.Add(Item($"Reset page zoom ({t.Zoom:0.0#}× → 1×)", null, null,
                    () => _brain.Call(HostCalls.UpdateTile, id, "{\"zoom\":null}")));
            sub.Items.Add(new MenuFlyoutSeparator());
            sub.Items.Add(Item("Fill slot", null, null, () => _ = _surfaces.RequestPlayerFullscreenAsync(id)));
            sub.Items.Add(Item(_screenFsTile == id ? "Exit Full Screen" : "Full Screen", null,
                digit <= 9 ? "Ctrl+" + digit : null, () => ToggleScreenFullscreen(id)));
            if (wall.LayoutMode == "hero" && !isHero)
                sub.Items.Add(Item("Make hero", null, null, () => _brain.Call(HostCalls.PromoteHero, id)));
            if (hasCover)
                sub.Items.Add(Item(vs.Peeked ? "Re-veil" : "Show ad 15s", null, null, () => _surfaces.TogglePeek(id)));
            sub.Items.Add(new MenuFlyoutSeparator());
            var rm = Item("Remove from wall", null, null, () => _brain.Call(HostCalls.RemoveTile, id));
            rm.Foreground = Danger;
            sub.Items.Add(rm);
            slots.Items.Add(sub);
        }
        menu.Items.Add(slots);

        // --- veils (spec 26/30)
        var veilMenu = new MenuFlyoutSubItem { Text = "Veils", Icon = Glyph("") };
        veilMenu.Items.Add(Item("Control Center…", null, null, () => { if (_controls is null) ToggleControls(); }));
        var showAll = Item("Show all ads", null, null, () =>
        {
            foreach (var v in _surfaces.VeilStates()) if (v.Covered && !v.Peeked) _surfaces.TogglePeek(v.Id);
        });
        showAll.IsEnabled = anyCovered;
        veilMenu.Items.Add(showAll);
        var veilAll = Item("Re-veil all", null, null, () =>
        {
            foreach (var v in _surfaces.VeilStates()) if (v.Covered && v.Peeked) _surfaces.TogglePeek(v.Id);
        });
        veilAll.IsEnabled = anyPeeked;
        veilMenu.Items.Add(veilAll);
        veilMenu.Items.Add(new MenuFlyoutSeparator());
        veilMenu.Items.Add(Item("Report an ad…", "", null, StartReportPick));
        menu.Items.Add(veilMenu);
        menu.Items.Add(new MenuFlyoutSeparator());

        // --- window
        var fsOn = _wallFs || _screenFsTile is not null;
        menu.Items.Add(Item(fsOn ? "Exit Full Screen" : "Full-Screen Wall", fsOn ? "" : "", "F11", () =>
        {
            if (_screenFsTile is { } t) ToggleScreenFullscreen(t);
            else ToggleWallFullscreen();
        }));
        menu.Items.Add(Item("Wall shot", "", "Ctrl+Shift+S", () => _ = CaptureWallShotAsync()));
        menu.Items.Add(Item("Open wall shots folder", "", null, () =>
            OpenPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Prism"), ensureDir: true)));
        menu.Items.Add(new MenuFlyoutSeparator());

        // --- diagnostics (spec 12; files stay local)
        var diag = new MenuFlyoutSubItem { Text = "Diagnostics", Icon = Glyph("") };
        diag.Items.Add(Item("Probe DRM (EME) on all tiles", null, "Ctrl+F9", () => _ = ProbeAllAsync()));
        diag.Items.Add(new MenuFlyoutSeparator());
        var diagDir = Path.Combine(_store.Root, "diagnostics");
        diag.Items.Add(Item("Open host.log", "", null, () => OpenPath(Path.Combine(diagDir, "host.log"))));
        diag.Items.Add(Item("Open eme.log", "", null, () => OpenPath(Path.Combine(diagDir, "eme.log"))));
        diag.Items.Add(Item("Open diagnostics folder", "", null, () => OpenPath(diagDir, ensureDir: true)));
        diag.Items.Add(Item("Open Prism data folder", "", null, () => OpenPath(_store.Root, ensureDir: true)));
        menu.Items.Add(diag);
        menu.Items.Add(new MenuFlyoutSeparator());

        // --- app
        // the media hub switch (docs/features/media-hub.md, 2026-10-05): the state as last read, refreshed for the next opening
        var rds = Item(Services.MediaHub.MenuLabel + ": " + (Services.MediaHub.On ? "On" : "Off"), "", null, () => _ = ToggleMediaHubAsync());
        ToolTipService.SetToolTip(rds, Services.MediaHub.Explain + " Press to turn it " + (Services.MediaHub.On ? "off." : "on."));
        menu.Items.Add(rds);
        _ = Services.MediaHub.RefreshAsync();
        menu.Items.Add(Item("Updates" + (UpdateMenuNote() is { Length: > 0 } un ? Mid + un : ""), "\uE895", null, () => _ = ShowUpdatesAsync()));   // section 28 (2026-10-05)
        menu.Items.Add(Item("About Prism", "", null, () => _ = ShowAboutAsync()));
        menu.Items.Add(Item("Quit Prism", "", "Alt+F4", Close));   // Closed handler runs the snapshot pass

        menu.ShowAt(MenuGrip);
    }

    /// <summary>Layout ▸ mode (hero / grid lattice / solo), hero size, hero pick.</summary>
    private MenuFlyoutSubItem BuildLayoutMenu(WallState wall)
    {
        var n = wall.Tiles.Count;
        var layout = new MenuFlyoutSubItem { Text = "This wall now (mode · hero · size)", Icon = Glyph("") };
        if (wall.LayoutMode == "fixed")
        {
            // B-12: a materialized scene - the layout's normalized rects, no solver; the modes below would leave the scene
            var sceneName = _model.ActiveScene is { } sid ? _model.Scene(sid)?.Name ?? sid : "scene";
            layout.Items.Add(Radio("Scene · " + sceneName + "  (fixed rects)", "mode", true, () => OpenRoute("prism://scenes")));
            layout.Items.Add(Item("Edit this scene…", null, null, () => { if (_model.ActiveScene is { } s) OpenRoute("prism://scene/" + Uri.EscapeDataString(s) + "/edit"); }));
            layout.Items.Add(new MenuFlyoutSeparator());
            layout.Items.Add(new MenuFlyoutItem { Text = "Hero / grid / solo below leave the scene for a solved wall", IsEnabled = false });
        }
        layout.Items.Add(Radio("Hero - one anchor, satellites solved around it", "mode", wall.LayoutMode == "hero",
            () => _brain.Call(HostCalls.SetLayout, "{\"mode\":\"hero\"}")));
        var grid = new MenuFlyoutSubItem { Text = "Grid" + (wall.LayoutMode == "grid" ? $"  ({wall.GridCols}×{wall.GridRows})" : "") };
        foreach (var (c, r) in new[] { (1, 1), (2, 1), (1, 2), (2, 2), (3, 2), (4, 2), (3, 3), (4, 3) })
        {
            var cells = c * r;
            var fits = cells >= n;
            var item = Radio($"{c} × {r}" + (fits ? (cells == n ? "   fits exactly" : $"   {cells - n} empty") : $"   {n - cells} slot(s) would not fit"),
                "grid", wall.LayoutMode == "grid" && wall.GridCols == c && wall.GridRows == r,
                () => _brain.Call(HostCalls.SetLayout, JsonSerializer.Serialize(new { mode = "grid", cols = c, rows = r })));
            item.IsEnabled = fits && n > 0;
            grid.Items.Add(item);
        }
        layout.Items.Add(grid);
        layout.Items.Add(Radio("Solo - one app at a time (◀ ▶ switches)", "mode", wall.LayoutMode == "solo",
            () => _brain.Call(HostCalls.SetLayout, "{\"mode\":\"solo\"}")));
        if (wall.LayoutMode == "hero" && n > 0)
        {
            layout.Items.Add(new MenuFlyoutSeparator());
            var size = new MenuFlyoutSubItem { Text = $"Hero size  ({wall.HeroSize * 100:0}%)" };
            foreach (var pct in new[] { 40, 50, 62, 70, 80 })
            {
                var v = pct;
                size.Items.Add(Radio($"{v}% of the long axis", "herosize", Math.Abs(wall.HeroSize * 100 - v) < 1,
                    () => _brain.Call(HostCalls.SetHeroSize, v / 100.0, true)));
            }
            layout.Items.Add(size);
            var hero = new MenuFlyoutSubItem { Text = "Hero slot" + (wall.Hero.Length > 0 ? "  (" + wall.Hero + ")" : "") };
            foreach (var t in wall.Tiles)
            {
                var id = t.Id;
                hero.Items.Add(Radio(t.Name, "hero", id == wall.Hero, () => _brain.Call(HostCalls.PromoteHero, id)));
            }
            layout.Items.Add(hero);
        }
        return layout;
    }

    private static FontIcon Glyph(string glyph) => new() { Glyph = glyph, FontSize = 14 };

    private static MenuFlyoutItem Item(string text, string? glyph, string? shortcut, Action action)
    {
        var item = new MenuFlyoutItem { Text = text };
        if (glyph is not null) item.Icon = Glyph(glyph);
        // shown, not registered: the RootGrid accelerators stay the single binding
        if (shortcut is not null) item.KeyboardAcceleratorTextOverride = shortcut;
        item.Click += (_, __) => action();
        return item;
    }

    private static RadioMenuFlyoutItem Radio(string text, string group, bool isChecked, Action action)
    {
        var item = new RadioMenuFlyoutItem { Text = text, GroupName = group, IsChecked = isChecked };
        item.Click += (_, __) => action();
        return item;
    }

    private static string Shorten(string s, int max) => s.Length <= max ? s : s.Substring(0, max - 1) + "…";

    // ----------------------------------------------------------- wall state
    private sealed record WallTile(string Id, string Name, string? Url, bool HasRegion, bool HasSelector, double Zoom, string App, List<(string Id, string Label, string Url, bool HasRegion, string? Aspect)> Layouts, List<(string Label, string Url)> Places,
        double[]? Region = null, double[]? Viewport = null,    // Region: x,y,w,h in layout CSS px; Viewport: the layout w,h it was measured in
        string? Kind = null, string? Face = null,              // §32: "floating" + its face ("control" | "page")
        bool Hidden = false, bool Placeholder = false, string? Aspect = null,   // §32.7 hidden float; §33 empty slot + its shape
        string? TapAction = null);   // concept-scenes §5: "promote" (absent) | "audio" | "both" - what a single tap here means
    private sealed record WallState(string LayoutMode, int GridCols, int GridRows, string Hero, double HeroSize, string? Framing, List<WallTile> Tiles,
        List<(string Aspect, bool Floating, int Layouts, double W, double H)>? Shapes = null);   // §34 the slot shapes the saved layouts define

    /// <summary>CORE is the single source of the effective layout: getState()
    /// folds the persisted hero override in. Falls back to the stored doc only
    /// when the brain is unavailable.</summary>
    private async Task<WallState> ReadWallStateAsync()
    {
        string mode = "hero", hero = ""; double heroSize = 0.62; int cols = 1, rows = 1; string? framing = null;
        var tiles = new List<WallTile>();
        var shapes = new List<(string Aspect, bool Floating, int Layouts, double W, double H)>();
        try
        {
            var raw = await _brain.EvalAsync("PrismRuntime.state()");
            if (raw is not null && raw != "null")
            {
                string inner;
                using (var outer = JsonDocument.Parse(raw))
                    inner = outer.RootElement.ValueKind == JsonValueKind.String ? outer.RootElement.GetString()! : raw;
                using var st = JsonDocument.Parse(inner);
                var r = st.RootElement;
                // hero | grid | solo | fixed (B-12: "fixed" = a materialized scene-model scene; the menu shows it as such, never as a solver mode)
                if (r.TryGetProperty("layoutMode", out var lm) && lm.ValueKind == JsonValueKind.String) mode = lm.GetString() is "hero" or "grid" or "solo" or "fixed" ? lm.GetString()! : mode;
                if (r.TryGetProperty("hero", out var h) && h.ValueKind == JsonValueKind.String) hero = h.GetString() ?? "";
                if (r.TryGetProperty("heroSize", out var hs) && hs.ValueKind == JsonValueKind.Number) heroSize = hs.GetDouble();
                if (r.TryGetProperty("grid", out var g) && g.ValueKind == JsonValueKind.Object)
                {
                    cols = g.GetProperty("cols").GetInt32();
                    rows = g.GetProperty("rows").GetInt32();
                }
                if (r.TryGetProperty("framing", out var fr) && fr.ValueKind == JsonValueKind.String) framing = fr.GetString();
                foreach (var t in r.GetProperty("tiles").EnumerateArray()) AddTile(t, tiles);
                if (r.TryGetProperty("slotShapes", out var fs) && fs.ValueKind == JsonValueKind.Array)
                    foreach (var s in fs.EnumerateArray())
                        shapes.Add((s.GetProperty("aspect").GetString() ?? "16:9",
                            s.TryGetProperty("floating", out var flg) && flg.ValueKind == JsonValueKind.True,
                            s.TryGetProperty("layouts", out var ln) && ln.ValueKind == JsonValueKind.Number ? ln.GetInt32() : 0,
                            s.TryGetProperty("sample", out var sm) && sm.ValueKind == JsonValueKind.Object ? Num(sm, "w") : 0,
                            sm.ValueKind == JsonValueKind.Object ? Num(sm, "h") : 0));
            }
        }
        catch { /* brain unavailable - fall back below */ }
        if (tiles.Count == 0)
        {
            try
            {
                using var doc = JsonDocument.Parse(CurrentDocJson());
                foreach (var t in doc.RootElement.GetProperty("tiles").EnumerateArray()) AddTile(t, tiles);
                if (doc.RootElement.TryGetProperty("layout", out var lay))
                {
                    if (lay.TryGetProperty("mode", out var m) && m.ValueKind == JsonValueKind.String) mode = m.GetString() ?? mode;
                    if (lay.TryGetProperty("hero", out var h)) hero = h.GetString() ?? "";
                    if (lay.TryGetProperty("heroSize", out var hs) && hs.ValueKind == JsonValueKind.Number) heroSize = hs.GetDouble();
                }
                if (doc.RootElement.TryGetProperty("grid", out var g) && g.ValueKind == JsonValueKind.Object)
                {
                    cols = g.GetProperty("cols").GetInt32();
                    rows = g.GetProperty("rows").GetInt32();
                }
            }
            catch (Exception ex) { SetStatus("wall state: doc unreadable - " + ex.Message); }
        }
        return new WallState(mode, cols, rows, hero, heroSize, framing, tiles, shapes);
    }

    private static void AddTile(JsonElement t, List<WallTile> into)
    {
        if (!t.TryGetProperty("id", out var idEl) || idEl.GetString() is not { } id) return;
        var name = t.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String && n.GetString() is { Length: > 0 } nm ? nm : id;
        var url = t.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String ? u.GetString() : null;
        var hasRegion = false; var hasSelector = false;
        double[]? region = null; double[]? viewport = null;
        if (t.TryGetProperty("focus", out var f) && f.ValueKind == JsonValueKind.Object)
        {
            hasRegion = f.TryGetProperty("region", out var rg) && rg.ValueKind == JsonValueKind.Object;
            hasSelector = !hasRegion && f.TryGetProperty("selector", out var sl) && sl.ValueKind == JsonValueKind.String;
            if (hasRegion)
            {
                region = new[] { Num(rg, "x"), Num(rg, "y"), Num(rg, "w"), Num(rg, "h") };
                if (f.TryGetProperty("viewport", out var vp) && vp.ValueKind == JsonValueKind.Object) viewport = new[] { Num(vp, "w"), Num(vp, "h") };
            }
        }
        var zoom = t.TryGetProperty("zoom", out var zEl) && zEl.ValueKind == JsonValueKind.Number ? zEl.GetDouble() : 1;
        var app = t.TryGetProperty("app", out var aEl) && aEl.ValueKind == JsonValueKind.String ? aEl.GetString() ?? id : id;
        var layouts = new List<(string Id, string Label, string Url, bool HasRegion, string? Aspect)>();
        if (t.TryGetProperty("userShortcuts", out var us) && us.ValueKind == JsonValueKind.Array)
            foreach (var e in us.EnumerateArray())
                if (e.TryGetProperty("id", out var sid) && e.TryGetProperty("label", out var sl))
                    layouts.Add((sid.GetString() ?? "", sl.GetString() ?? "",
                        e.TryGetProperty("url", out var su) ? su.GetString() ?? "" : "",
                        e.TryGetProperty("hasRegion", out var hr) && hr.ValueKind == JsonValueKind.True,
                        e.TryGetProperty("aspectHint", out var ah) && ah.ValueKind == JsonValueKind.String ? ah.GetString() : null));
        var places = new List<(string Label, string Url)>();
        if (t.TryGetProperty("shortcuts", out var ps) && ps.ValueKind == JsonValueKind.Array)
            foreach (var e in ps.EnumerateArray())
                if (e.TryGetProperty("label", out var pl) && e.TryGetProperty("url", out var pu)) places.Add((pl.GetString() ?? "", pu.GetString() ?? ""));
        var kind = t.TryGetProperty("kind", out var kEl) && kEl.ValueKind == JsonValueKind.String ? kEl.GetString() : null;
        var face = t.TryGetProperty("float", out var flEl) && flEl.ValueKind == JsonValueKind.Object && flEl.TryGetProperty("face", out var faEl) && faEl.ValueKind == JsonValueKind.String ? faEl.GetString() : null;
        var hidden = flEl.ValueKind == JsonValueKind.Object && flEl.TryGetProperty("hidden", out var hiEl) && hiEl.ValueKind == JsonValueKind.True;
        var isPlaceholder = t.TryGetProperty("placeholder", out var phEl) && phEl.ValueKind == JsonValueKind.True;
        var aspect = t.TryGetProperty("aspectHint", out var asEl) && asEl.ValueKind == JsonValueKind.String ? asEl.GetString() : null;
        var tapAction = t.TryGetProperty("tapAction", out var taEl) && taEl.ValueKind == JsonValueKind.String ? taEl.GetString() : null;
        into.Add(new WallTile(id, name, url, hasRegion, hasSelector, zoom, app, layouts, places, region, viewport, kind, face, hidden, isPlaceholder, aspect, tapAction));
    }

    private static double Num(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;

    // ------------------------------------------------ Pan: the hand drags the view over the page
    // A framed tile shows a region of the page; dragging moves that region (the slot's
    // window slides over the page - never the page inside the slot, so no substrate shows
    // at an edge). An unframed tile scrolls the page itself.
    private string? _panId;
    private Task? _panLoad;
    private double[]? _panRegion, _panViewport;
    private double _panPendX, _panPendY;
    private DateTime _panSent;
    private bool _panDirty;

    private Task PanLoadAsync(string id)
    {
        if (_panId == id && _panLoad is not null) return _panLoad;
        _panId = id; _panRegion = null; _panViewport = null; _panDirty = false; _panPendX = _panPendY = 0;
        return _panLoad = PanLoadCoreAsync(id);
    }

    private async Task PanLoadCoreAsync(string id)
    {
        try
        {
            var wall = await ReadWallStateAsync();
            if (_panId != id) return;
            var t = wall.Tiles.FirstOrDefault(x => x.Id == id);
            _panRegion = t?.Region is { Length: 4 } r && r[2] > 0 && r[3] > 0 ? (double[])r.Clone() : null;
            _panViewport = t?.Viewport;
        }
        catch { if (_panId == id) _panRegion = null; }
        if (_panId == id && (_panPendX != 0 || _panPendY != 0))
        {
            var (px, py) = (_panPendX, _panPendY);
            _panPendX = _panPendY = 0;
            PanApply(id, px, py, immediate: false);
        }
    }

    private void OnPanStarted(string id) { _panLoad = null; _ = PanLoadAsync(id); }

    private void OnPanMoved(string id, double dx, double dy)
    {
        if (_panId != id) _ = PanLoadAsync(id);
        if (_panLoad is { IsCompleted: false }) { _panPendX += dx; _panPendY += dy; return; }
        PanApply(id, dx, dy, immediate: false);
    }

    private void OnPanEnded(string id)
    {
        if (_panId != id) return;
        if (_panLoad is { IsCompleted: false }) { _ = _panLoad.ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => { if (_panId == id && _panDirty) PanSend(id); _panId = null; })); return; }
        if (_panDirty) PanSend(id);
        _panId = null;   // the next gesture re-reads the tile: layouts or Apply may have changed the region meanwhile
    }

    private void OnPanWheel(string id, int delta)
    {
        if (_panId != id) _ = PanLoadAsync(id);
        var dy = delta > 0 ? 100 : -100;   // wheel up: the page moves down under the hand, like a scroll
        if (_panLoad is { IsCompleted: false }) { _panPendY += dy; return; }
        PanApply(id, 0, dy, immediate: true);
    }

    private void PanApply(string id, double dx, double dy, bool immediate)
    {
        if (_panRegion is { } r && _surfaces.RectOf(id) is { } rect && rect.W > 0 && rect.H > 0)
        {
            // 1 view px = region.w / rect.W layout px; the hand drags the page, so the window over it moves the other way
            var s = r[2] / rect.W;
            r[0] = Math.Max(0, r[0] - dx * s);
            r[1] = Math.Max(0, r[1] - dy * s);
            _panDirty = true;
            if (immediate || (DateTime.UtcNow - _panSent).TotalMilliseconds >= 120) PanSend(id);
        }
        else _ = _surfaces.ScrollTileAsync(id, dx, dy);
    }

    private void PanSend(string id)
    {
        if (_panRegion is not { } r) return;
        _panSent = DateTime.UtcNow; _panDirty = false;
        var focus = _panViewport is { Length: 2 } v
            ? (object)new { region = new { x = r[0], y = r[1], w = r[2], h = r[3] }, viewport = new { w = v[0], h = v[1] } }
            : new { region = new { x = r[0], y = r[1], w = r[2], h = r[3] } };
        _brain.Call(HostCalls.UpdateTile, id, JsonSerializer.Serialize(new { focus }));
    }

    // -------------------------------------------------- generic slot picker
    // "Which slot?" - a labeled click target over each slot, positioned by
    // the tile rects. The whole slot is the target; Esc cancels.
    private Grid? _slotPick;

    private void StartSlotPick(string banner, IEnumerable<string> ids, Func<string, string> label, Action<string> onPick)
    {
        CancelSlotPick();
        var host = new Grid();
        var any = false;
        Button? first = null;
        foreach (var id in ids)
        {
            if (_surfaces.RectOf(id) is not { } r || r.W < 40 || r.H < 40) continue;
            any = true;
            var text = new TextBlock
            {
                Text = label(id),
                Foreground = Amber,
                FontSize = 15,
                TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var target = new Button
            {
                Content = text,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(r.X, r.Y, 0, 0),
                Width = r.W,
                Height = r.H,
                Padding = new Thickness(12),
                // a light tint: the wall stays visible, only the labels and outlines say "pick one"
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x48, 0x12, 0x13, 0x1A)),
                BorderBrush = Amber,
                BorderThickness = new Thickness(1),
            };
            var tid = id;
            target.Click += (_, __) => { CancelSlotPick(); onPick(tid); };
            host.Children.Add(target);
            first ??= target;
        }
        if (!any) { SetPill("Prism · no slots to pick"); return; }
        host.Children.Add(new Border
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 40, 0, 0),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE6, 0x12, 0x13, 0x1A)),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(14, 8, 14, 8),
            Child = new TextBlock { Text = banner, Foreground = Muted, FontSize = 13 },
        });
        RootGrid.Children.Add(host);
        _slotPick = host;
        first?.Focus(FocusState.Programmatic);
    }

    private void CancelSlotPick()
    {
        if (_slotPick is null) return;
        RootGrid.Children.Remove(_slotPick);
        _slotPick = null;
    }

    // ------------------------------------------------------- the viewfinder
    // Spec 31 step 3 as a wall gesture: pick the slot → core pops it out to
    // the whole window, unframed, at its natural layout (the page really
    // re-lays out at window width, like a maximized browser). The human then
    //   · uses the page freely (it is live and interactive: scroll, sign in,
    //     navigate) and zooms it in 10% steps (the layout viewport becomes
    //     window ÷ zoom: out = wider and smaller, in = narrower and bigger,
    //     breakpoints firing live);
    //   · Pick region: a glowing box in the slot's own aspect follows the
    //     pointer (wheel sizes it) until a click PLACES it - from then on it
    //     is a fixed rectangle on screen and the page is live underneath it
    //     again, so zoom and scroll change what falls inside the box;
    //   · Apply region commits whatever the box holds at that moment. Core
    //     persists the rectangle WITH the layout viewport it was measured in
    //     (focus.region + focus.viewport), so the slot reproduces exactly the
    //     layout that was on screen and frames the rectangle.
    private Grid? _viewfinder;
    private Grid? _vfFloat;                 // the floating panels' layer (above the overlay)
    private string? _vfTile;
    private double _vfAspect = 16 / 9.0;
    private double _vfBoxW;
    private Windows.Foundation.Point _vfCenter;
    private Grid? _vfBox;
    private TextBlock? _vfReadout;
    private FrameworkElement? _vfHintPanel, _vfZoomPanel;
    private Button? _vfPickBtn, _vfApplyBtn, _vfControlsBtn;
    private bool _vfPicking, _vfPlaced, _vfControlsHidden;
    // page zoom previewed live during the pick: the layout viewport is window ÷ zoom
    private double _vfZoom = 1;
    private TextBlock? _vfZoomLabel;
    // the box's shape: the slot's own (null) or a chosen "W:H" the layout will ask the solver for
    private string? _vfShape;
    private double _vfSlotAspect = 16 / 9.0;
    private StackPanel? _vfLayouts;
    private Button? _vfSaveBtn;

    /// <summary>The menu's "Frame a region…": ask which slot, then run the viewfinder on it.</summary>
    private void BeginSlotRegion()
    {
        // §33.6: the app list (catalog + everything on the wall), never only the laid-out slots
        if (_viewfinder is not null) return;
        _ = ShowAppListAsync("app");
    }

    /// <summary>Which configure screen the pop-out serves (§34): "app" = sign in / navigate / explore (screen 1);
    /// "views" = page + region per slot shape (screen 3). Same pop-out, different dock.</summary>
    private string _vfMode = "views";
    private TextBox? _vfAddressBox;
    /// <summary>The human typed in the address box (a programmatic sync never sets this) - only then does the box outrank the page showing.</summary>
    private bool _vfAddressEdited, _vfAddressSyncing;

    /// <summary>The page moved while the pop-out is open: the address box follows it unless the human is mid-edit.</summary>
    private void SyncViewfinderAddress(string tileId, string url)
    {
        OnEditorSourceChanged(tileId, url);                                   // the facet editor / App setup follow the page too (login-redirect check)
        if (_vfTile != tileId || _vfAddressBox is null || _vfAddressEdited) return;
        _vfAddressSyncing = true;
        try { _vfAddressBox.Text = url; } finally { _vfAddressSyncing = false; }
    }

    private void BeginViewfinder(string id, string mode = "views")
    {
        if (_viewfinder is not null) CancelViewfinder();
        if (_surfaces.RectOf(id) is not { } r || r.W < 40 || r.H < 40) { SetPill("Prism · " + id + " has no slot yet"); return; }
        _vfMode = mode == "app" ? "app" : "views";
        _vfAspect = r.W / r.H;                                        // the box is shaped like the slot it will fill
        _vfSlotAspect = _vfAspect;
        _vfShape = null;
        _vfTile = id;
        _vfZoom = 1;
        _vfPicking = false;
        _vfPlaced = false;
        _vfControlsHidden = false;

        _brain.Call(HostCalls.StartFraming, id);                     // core: the whole window, unframed, natural layout

        var host = CreateViewfinderHost(id, r.W);

        var panelBg = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE6, 0x12, 0x13, 0x1A));

        // Floating panels live in their own layer above the overlay, so they stay
        // clickable in every state (even while the page owns the pointer) and can
        // be dragged out of the way as a unit.
        var floatHost = new Grid();
        Canvas.SetZIndex(floatHost, 998);

        // --- the dock (left): stacked buttons + the hint/readout (hideable)
        var dock = new StackPanel { Spacing = 6, Width = 300 };
        // --- Page: where this slot points, and what it is
        dock.Children.Add(new TextBlock { Text = "PAGE", Foreground = Muted, FontSize = 11, Opacity = 0.8, Margin = new Thickness(2, 0, 0, 0) });
        var addressRow = new Grid { ColumnSpacing = 6 };
        addressRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        addressRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var addressBox = new TextBox { Text = _surfaces.SourceOf(id) ?? "", PlaceholderText = "https://…", FontSize = 12 };
        _vfAddressBox = addressBox;
        _vfAddressEdited = false;
        addressBox.TextChanged += (_, __) => { if (!_vfAddressSyncing) _vfAddressEdited = true; };
        var go = new Button { Content = "Go", Padding = new Thickness(10, 4, 10, 4) };
        Grid.SetColumn(go, 1);
        void GoAddress() { if (IsHttpUrl(addressBox.Text)) ConfigureAddress(id, new Uri(addressBox.Text.Trim()).ToString()); else SetPill("Prism · http(s) addresses only"); }
        go.Click += (_, __) => GoAddress();
        addressBox.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) { e.Handled = true; GoAddress(); } };
        addressRow.Children.Add(addressBox);
        addressRow.Children.Add(go);
        dock.Children.Add(addressRow);
        var catalogBtn = new Button { Content = "Choose from the catalog…", HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 6, 12, 6) };
        var customBtn = new Button { Content = "Make it a custom website…", HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 6, 12, 6) };
        catalogBtn.Click += (_, __) => ConfigureFromCatalog(id);
        customBtn.Click += (_, __) => _ = ConfigureCustomAsync(id);
        // (not in the dock: the app was chosen on the previous screen; swapping a slot's app is the slot menu's "Change app")
        // --- Views (§34.3): this app's page + region per slot shape - assign one, delete one, or save the placed region as a new one
        var viewsHeader = new TextBlock { Text = "VIEWS", Foreground = Muted, FontSize = 11, Opacity = 0.8, Margin = new Thickness(2, 8, 0, 0) };
        dock.Children.Add(viewsHeader);
        _vfLayouts = new StackPanel { Spacing = 4 };
        dock.Children.Add(_vfLayouts);
        var saveLayout = new Button { Content = "＋  Save the placed region as a facet…", HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 6, 12, 6), IsEnabled = false };
        ToolTipService.SetToolTip(saveLayout, "A facet is this page + the placed region, cut for one slot class. Pick the class below, from the classes in your saved layouts. Sign-in page, Home, Live guide… each page × class is its own facet, and scenes assign facets to slots. The screen stays open: adjust and save another. Earlier facets are never changed.");
        saveLayout.Click += (_, __) => _ = SaveLayoutAsync(id);
        _vfSaveBtn = saveLayout;
        dock.Children.Add(saveLayout);
        _ = RefreshLayoutsAsync(id);
        var regionHeader = new TextBlock { Text = "REGION", Foreground = Muted, FontSize = 11, Opacity = 0.8, Margin = new Thickness(2, 8, 0, 0) };
        dock.Children.Add(regionHeader);
        // box shape: the slot's own, or one of the slot shapes the saved layouts define (§34.3) - the box takes that shape
        var shapes = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        shapes.Children.Add(new TextBlock { Text = "shape", Foreground = Muted, FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(2, 0, 4, 0) });
        var slotClassBtn = new Button { Content = "slot", Padding = new Thickness(6, 2, 6, 2), FontSize = 11 };
        ToolTipService.SetToolTip(slotClassBtn, "This slot's own shape");
        slotClassBtn.Click += (_, __) => SetViewfinderShape(null);
        shapes.Children.Add(slotClassBtn);
        dock.Children.Add(shapes);
        _ = FillShapeRowAsync(shapes);
        Button DockButton(string text) => new()
        {
            Content = text, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12, 6, 12, 6),
        };
        _vfPickBtn = DockButton("⌗  Pick region");
        _vfApplyBtn = DockButton("✓  Apply region");
        _vfApplyBtn.IsEnabled = false;
        var whole = DockButton("▭  Use the whole page");
        _vfControlsBtn = DockButton("Hide controls");
        var cancel = DockButton("Cancel  (Esc)");
        _vfPickBtn.Click += (_, __) => SetViewfinderPicking(!_vfPicking);
        _vfApplyBtn.Click += async (_, __) => await CommitViewfinderAsync();
        whole.Click += (_, __) => ClearViewfinderRegion();
        _vfControlsBtn.Click += (_, __) => SetViewfinderControls(!_vfControlsHidden);
        cancel.Click += (_, __) => CancelViewfinder();
        dock.Children.Add(_vfPickBtn);
        dock.Children.Add(_vfApplyBtn);
        dock.Children.Add(whole);
        dock.Children.Add(_vfControlsBtn);
        dock.Children.Add(cancel);
        _vfReadout = new TextBlock { Foreground = Amber, FontSize = 12, FontFamily = new FontFamily("Consolas"), TextWrapping = TextWrapping.Wrap };
        var hint = new StackPanel { Spacing = 6, Margin = new Thickness(0, 6, 0, 0) };
        hint.Children.Add(_vfReadout);
        ToolTipService.SetToolTip(_vfPickBtn, "A box the slot's exact size follows the pointer. What's inside it is what the slot will show, 1:1 (the wheel shrinks it to magnify). Click to place it. The page is live again beneath the placed box, so zoom or scroll changes what falls inside.");
        ToolTipService.SetToolTip(_vfApplyBtn, "Give this slot the placed facet now and close.");
        ToolTipService.SetToolTip(whole, "No region: the slot shows the page at its own size.");
        ToolTipService.SetToolTip(_vfControlsBtn, "Hide the zoom panel and the readout; the buttons stay.");
        ToolTipService.SetToolTip(cancel, "Leave without changing the slot.");
        ToolTipService.SetToolTip(addressBox, "The page this slot shows. Enter or Go loads it right here. The page is live, so you can scroll, click and sign in.");
        ToolTipService.SetToolTip(catalogBtn, "This slot becomes a catalog app in the same place, with its own account.");
        ToolTipService.SetToolTip(customBtn, "This slot becomes a custom website in the same place, with its own profile and no adapter.");
        ToolTipService.SetToolTip(shapes, "The box's shape: the slot's own, or a shape the layout will ask the wall's solver for when it is assigned.");
        _vfHintPanel = hint;
        dock.Children.Add(hint);
        if (_vfMode == "app")
        {
            // Screen 1 (§34.1): the page, sign-in, navigation - nothing about regions,
            // shapes or zoom. Those define a VIEW and live on screen 3 only.
            foreach (var el in new UIElement[] { viewsHeader, _vfLayouts, saveLayout, regionHeader, shapes, _vfPickBtn, _vfApplyBtn, whole, _vfControlsBtn })
                dock.Children.Remove(el);
            var saveClose = DockButton("✓  Save & close");
            ToolTipService.SetToolTip(saveClose, "The page showing now (or the address typed above) becomes this app's home page. It's set for the whole app, so every facet and scene that uses the app starts there. Then back to the wall.");
            saveClose.Click += (_, __) => _ = SaveAppHomeAndCloseAsync(id);
            dock.Children.Insert(dock.Children.IndexOf(cancel), saveClose);
            cancel.Content = "Close without saving  (Esc)";
            ToolTipService.SetToolTip(cancel, "Back to the wall. The slot keeps the page it is on for now; the app's saved home page is unchanged. Sign-ins persist either way.");
            _vfReadout.Text = "Sign in, browse, find the page this app should open on, then Save & close. Go previews an address without saving it. Sign-in popups open in a sheet. Regions, shapes and zoom are made on Configure app facets.";
        }
        floatHost.Children.Add(FloatingPanel((_vfMode == "app" ? "Configure " : "Views of ") + id, dock, panelBg, HorizontalAlignment.Left, VerticalAlignment.Top, new Thickness(16, 44, 0, 0)));

        _vfZoomPanel = FloatingZoomPanel(panelBg);
        if (_vfMode == "views") floatHost.Children.Add(_vfZoomPanel);   // page zoom is part of a view (its layout viewport) - screen 3 only
        _vfFloat = floatHost;

        RootGrid.Children.Add(floatHost);
        UpdateViewfinderReadout();
        cancel.Focus(FocusState.Programmatic);                     // Esc reaches the XAML accelerator
    }

    /// <summary>The pop-out host shared by the viewfinder dock and the facet editor:
    /// a transparent overlay that takes the pointer only while the box follows it,
    /// the amber box in the current _vfAspect, and the move / wheel / place
    /// handlers. Sets _viewfinder, _vfBox, _vfBoxW, _vfCenter and adds the host to
    /// the root; the caller adds its own floating panels.</summary>
    private Grid CreateViewfinderHost(string id, double boxW)
    {
        // --- the overlay: catches the pointer only while the box follows it
        var host = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), IsHitTestVisible = false };
        var halo = new Border
        {
            BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x60, 0xF0, 0xA8, 0x3C)),
            BorderThickness = new Thickness(7),
            CornerRadius = new CornerRadius(8),
            Margin = new Thickness(-7),
        };
        var edge = new Border
        {
            BorderBrush = Amber,
            BorderThickness = new Thickness(2),
            CornerRadius = new CornerRadius(3),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x16, 0xF0, 0xA8, 0x3C)),
        };
        var box = new Grid { HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, IsHitTestVisible = false, Visibility = Visibility.Collapsed };
        box.Children.Add(halo);
        box.Children.Add(edge);
        _vfBox = box;
        host.Children.Add(box);


        // start: exactly the slot's own size - what is inside the box is what the
        // slot will show, 1:1; the wheel can shrink it to make the slot magnify
        _vfBoxW = boxW;
        _vfCenter = new Windows.Foundation.Point(_w / 2, _h / 2);

        host.PointerMoved += (_, e) => { if (!_vfPicking) return; _vfCenter = e.GetCurrentPoint(host).Position; LayoutViewfinderBox(); };
        host.PointerWheelChanged += (_, e) =>
        {
            if (!_vfPicking) return;
            e.Handled = true;
            var p = e.GetCurrentPoint(host);
            var delta = p.Properties.MouseWheelDelta;
            if (e.KeyModifiers.HasFlag(Windows.System.VirtualKeyModifiers.Control))
            {
                SetViewfinderZoom(_vfZoom + (delta > 0 ? 0.1 : -0.1));  // page zoom, like a browser
                return;
            }
            if (e.KeyModifiers.HasFlag(Windows.System.VirtualKeyModifiers.Shift))
            {
                if (_vfTile is { } tid) _ = _surfaces.EvalOnTileAsync(tid, "window.scrollBy(0," + (delta > 0 ? -120 : 120) + ")");
                return;
            }
            _vfBoxW *= delta > 0 ? 0.92 : 1 / 0.92;                  // up = smaller box = more magnification
            _vfCenter = p.Position;
            LayoutViewfinderBox();
        };
        host.PointerPressed += (_, e) =>
        {
            if (!_vfPicking) return;
            var pt = e.GetCurrentPoint(host);
            if (!pt.Properties.IsLeftButtonPressed) return;
            e.Handled = true;
            _vfCenter = pt.Position;
            LayoutViewfinderBox();
            PlaceViewfinderBox();                                     // the box stays; the page is live again beneath it
        };

        RootGrid.Children.Add(host);
        _viewfinder = host;
        return host;
    }

    /// <summary>The floating page-zoom panel (+ / − in 10% steps, presets, Ctrl+wheel) shared by the viewfinder dock and the facet editor.</summary>
    private Border FloatingZoomPanel(Brush panelBg)
    {
        // --- page zoom (floating, right): + / − in 10% steps and presets. The
        // page really re-lays out (layout viewport = window ÷ zoom), so responsive
        // designs snap to their breakpoints at each step. Hideable.
        var zoomCol = new StackPanel { Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center, MinWidth = 96 };
        var plus = new Button { Content = "+", FontSize = 20, Width = 64, Height = 40, HorizontalAlignment = HorizontalAlignment.Center, Padding = new Thickness(0) };
        var minus = new Button { Content = "−", FontSize = 20, Width = 64, Height = 40, HorizontalAlignment = HorizontalAlignment.Center, Padding = new Thickness(0) };
        plus.Click += (_, __) => SetViewfinderZoom(_vfZoom + 0.1);
        minus.Click += (_, __) => SetViewfinderZoom(_vfZoom - 0.1);
        _vfZoomLabel = new TextBlock { Foreground = Amber, FontSize = 16, FontFamily = new FontFamily("Consolas"), HorizontalAlignment = HorizontalAlignment.Center };
        zoomCol.Children.Add(plus);
        zoomCol.Children.Add(_vfZoomLabel);
        zoomCol.Children.Add(minus);
        var presets = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 6, 0, 0) };
        foreach (var (label, z) in new[] { ("½", 0.5), ("1", 1.0), ("1½", 1.5), ("2", 2.0), ("3", 3.0) })
        {
            var zz = z;
            var b = new Button { Content = label, Padding = new Thickness(7, 2, 7, 2), FontSize = 12 };
            b.Click += (_, __) => SetViewfinderZoom(zz);
            presets.Children.Add(b);
        }
        zoomCol.Children.Add(presets);
        zoomCol.Children.Add(new TextBlock { Text = "Ctrl+wheel steps too", Foreground = Muted, FontSize = 11, Opacity = 0.7, HorizontalAlignment = HorizontalAlignment.Center });
        var panel = FloatingPanel("Page zoom", zoomCol, panelBg, HorizontalAlignment.Right, VerticalAlignment.Top, new Thickness(0, 44, 18, 0));
        ToolTipService.SetToolTip(panel, "Page zoom changes the width the page lays itself out at, like browser zoom. Zoom out for a wider, smaller page (more of it), zoom in for a narrower, bigger one. Responsive designs re-flow at each step. A page that sizes itself to its viewport (a video player) looks the same at every zoom. Only its controls change size. Ctrl+wheel steps too.");
        return panel;
    }

    /// <summary>A floating panel: a drag handle header ("⋮⋮ title") the human
    /// grabs to move the whole panel - buttons and all - out of the way, with
    /// the content beneath. Pointer-captured drag, so it keeps following the
    /// pointer even over the page.</summary>
    private static Border FloatingPanel(string title, UIElement content, Brush background, HorizontalAlignment h, VerticalAlignment v, Thickness margin)
    {
        var handle = new Border
        {
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x30, 0xF0, 0xA8, 0x3C)),
            CornerRadius = new CornerRadius(12, 12, 0, 0),
            Padding = new Thickness(12, 6, 12, 6),
            Child = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                Children =
                {
                    new TextBlock { Text = "⋮⋮", Foreground = Amber, FontSize = 12, Opacity = 0.9, VerticalAlignment = VerticalAlignment.Center },
                    new TextBlock { Text = title, Foreground = Amber, FontSize = 12, VerticalAlignment = VerticalAlignment.Center },
                    new TextBlock { Text = "drag", Foreground = Muted, FontSize = 11, Opacity = 0.7, VerticalAlignment = VerticalAlignment.Center },
                },
            },
        };
        var body = new Border { Padding = new Thickness(14, 10, 14, 14), Child = content };
        var stack = new StackPanel();
        stack.Children.Add(handle);
        stack.Children.Add(body);
        var panel = new Border
        {
            HorizontalAlignment = h,
            VerticalAlignment = v,
            Margin = margin,
            Background = background,
            CornerRadius = new CornerRadius(12),
            BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x50, 0xF0, 0xA8, 0x3C)),
            BorderThickness = new Thickness(1),
            Child = stack,
            RenderTransform = new TranslateTransform(),
        };
        // drag from the handle: capture the pointer so the move survives crossing the page
        Windows.Foundation.Point? last = null;
        handle.PointerPressed += (s, e) =>
        {
            var pt = e.GetCurrentPoint(null);
            if (!pt.Properties.IsLeftButtonPressed) return;
            last = pt.Position;
            handle.CapturePointer(e.Pointer);
            e.Handled = true;
        };
        handle.PointerMoved += (s, e) =>
        {
            if (last is not { } l) return;
            var p = e.GetCurrentPoint(null).Position;
            var t = (TranslateTransform)panel.RenderTransform;
            t.X += p.X - l.X;
            t.Y += p.Y - l.Y;
            last = p;
            e.Handled = true;
        };
        void End(object s, PointerRoutedEventArgs e) { if (last is null) return; last = null; handle.ReleasePointerCapture(e.Pointer); e.Handled = true; }
        handle.PointerReleased += End;
        handle.PointerCanceled += End;
        handle.PointerCaptureLost += (s, e) => last = null;
        return panel;
    }

    /// <summary>Pick region on/off: while on, the overlay takes the pointer and
    /// the box follows it; off, the page is live again (a placed box stays).</summary>
    private void SetViewfinderPicking(bool picking)
    {
        if (_viewfinder is null || _vfBox is null) return;
        _vfPicking = picking;
        _viewfinder.IsHitTestVisible = picking;
        if (picking)
        {
            _vfBox.Visibility = Visibility.Visible;
            LayoutViewfinderBox();
        }
        else if (!_vfPlaced) _vfBox.Visibility = Visibility.Collapsed;
        if (_vfPickBtn is not null) _vfPickBtn.Content = picking ? "☞  Use the page instead" : (_vfPlaced ? "⌗  Move the region" : "⌗  Pick region");
        UpdateViewfinderReadout();
    }

    /// <summary>A click while picking: the box stops following and becomes the
    /// selection; the page underneath is interactive again so zoom and scroll
    /// change what it holds; Apply commits it.</summary>
    private void PlaceViewfinderBox()
    {
        _vfPlaced = true;
        if (_vfApplyBtn is not null) _vfApplyBtn.IsEnabled = true;
        if (_vfSaveBtn is not null) _vfSaveBtn.IsEnabled = true;
        SetViewfinderPicking(false);
    }

    /// <summary>Hide/show the hint and the zoom panel; the dock buttons and the box stay.</summary>
    private void SetViewfinderControls(bool hidden)
    {
        _vfControlsHidden = hidden;
        var v = hidden ? Visibility.Collapsed : Visibility.Visible;
        if (_vfHintPanel is not null) _vfHintPanel.Visibility = v;
        if (_vfZoomPanel is not null) _vfZoomPanel.Visibility = v;
        if (_vfControlsBtn is not null) _vfControlsBtn.Content = hidden ? "Show controls" : "Hide controls";
    }

    /// <summary>Box geometry: the slot's aspect, clamped inside the window, centered on the pointer.</summary>
    private void LayoutViewfinderBox()
    {
        if (_vfBox is null) return;
        var maxW = Math.Min(_w, _h * _vfAspect);
        _vfBoxW = Math.Clamp(_vfBoxW, Math.Min(60, maxW), maxW);
        var w = _vfBoxW;
        var h = w / _vfAspect;
        var x = Math.Clamp(_vfCenter.X - w / 2, 0, _w - w);
        var y = Math.Clamp(_vfCenter.Y - h / 2, 0, _h - h);
        _vfBox.Width = w;
        _vfBox.Height = h;
        _vfBox.Margin = new Thickness(x, y, 0, 0);
        UpdateViewfinderReadout();
    }

    private void UpdateViewfinderReadout()
    {
        if (_vfZoomLabel is not null) _vfZoomLabel.Text = $"{_vfZoom:0.0#}×";
        if (_feSession) { UpdateFacetRegionReadout(); return; }                 // the facet editor owns the readout in its session
        if (_vfReadout is null || _vfTile is not { } id) return;
        var (lw, _, _, _) = _surfaces.LayoutOf(id);
        if (_vfBox is null || (!_vfPicking && !_vfPlaced))
        {
            _vfReadout.Text = $"page laid out {lw:0} px wide · no region yet";
            return;
        }
        var (_, _, rw, rh) = _surfaces.RegionFromView(id, 0, 0, _vfBox.Width, _vfBox.Height, 0, 0);
        _vfReadout.Text = (_vfPicking ? "click to place  ·  " : "placed. Zoom or scroll, then Apply  ·  ")
            + $"region {rw:0} × {rh:0} css px of a {lw:0} px wide page  →  {_w / Math.Max(1, _vfBox.Width):0.0}× in the slot";
    }

    /// <summary>Page zoom in 10% steps: the layout viewport becomes window ÷ zoom
    /// (host presentation; core persists the viewport at Apply). Buttons, presets
    /// and Ctrl+wheel all land here.</summary>
    private void SetViewfinderZoom(double z)
    {
        if (_vfTile is not { } id) return;
        _vfZoom = Math.Round(Math.Clamp(z, 0.5, 3), 2);
        _ = Math.Abs(_vfZoom - 1) < 0.001
            ? _surfaces.SetViewportAsync(id, 0, 0)
            : _surfaces.SetViewportAsync(id, Math.Round(_w / _vfZoom), Math.Round(_h / _vfZoom));
        UpdateViewfinderReadout();
    }

    /// <summary>The placed box as a view: region in layout CSS px + the layout viewport it was measured in.</summary>
    private async Task<(object Region, object Viewport)?> PlacedFocusAsync(string id)
    {
        if (_vfBox is null || !_vfPlaced) return null;
        var bx = _vfBox.Margin.Left; var by = _vfBox.Margin.Top; var bw = _vfBox.Width; var bh = _vfBox.Height;
        // where the page is scrolled right now: the box is viewport-relative, the region is document-relative
        double sx = 0, sy = 0;
        try
        {
            var raw = await _surfaces.EvalOnTileAsync(id, "JSON.stringify([window.scrollX,window.scrollY])");
            if (raw is not null && !raw.StartsWith("__prism_eval_error") && raw != "null")
            {
                using var outer = JsonDocument.Parse(raw);
                var inner = outer.RootElement.ValueKind == JsonValueKind.String ? outer.RootElement.GetString()! : raw;
                using var arr = JsonDocument.Parse(inner);
                sx = arr.RootElement[0].GetDouble();
                sy = arr.RootElement[1].GetDouble();
            }
        }
        catch { /* unscrolled is the common case */ }
        var (rx, ry, rw, rh) = _surfaces.RegionFromView(id, bx, by, bw, bh, sx, sy);
        var (lw, lh, _, _) = _surfaces.LayoutOf(id);
        return (new { x = Math.Max(0, rx), y = Math.Max(0, ry), w = rw, h = rh }, new { w = Math.Round(lw), h = Math.Round(lh) });
    }

    private async Task CommitViewfinderAsync()
    {
        if (_viewfinder is null || _vfTile is not { } id || _vfBox is null || !_vfPlaced) return;
        var magnification = _w / _vfBox.Width;
        var focus = await PlacedFocusAsync(id);
        if (focus is not { } f) return;
        var z = _vfZoom;
        var shape = _vfShape;
        EndViewfinder();
        _brain.Call(HostCalls.FinishFraming, id, JsonSerializer.Serialize(new { region = f.Region, viewport = f.Viewport }));   // core persists + frames it, back in its slot
        if (shape is not null) _brain.Call(HostCalls.UpdateTile, id, JsonSerializer.Serialize(new { aspectHint = shape }));   // and the slot takes the shape
        SetPill($"Prism · {id}: region applied at page zoom {z:0.0#}×, fills the slot at {magnification:0.0}×");
    }

    /// <summary>Box shape: null = the slot's own aspect; otherwise a "W:H" the layout will carry as the slot's aspect hint.</summary>
    private void SetViewfinderShape(string? hint)
    {
        _vfShape = hint;
        if (hint is null) _vfAspect = _vfSlotAspect;
        else
        {
            var parts = hint.Split(':');
            if (parts.Length == 2 && double.TryParse(parts[0], out var w) && double.TryParse(parts[1], out var h) && w > 0 && h > 0) _vfAspect = w / h;
        }
        if (_vfPicking || _vfPlaced) LayoutViewfinderBox();
        UpdateViewfinderReadout();
    }

    // ------------------------------------------------ layouts (this app's named views)
    private async Task RefreshLayoutsAsync(string id)
    {
        if (_vfLayouts is null) return;
        var wall = await ReadWallStateAsync();
        var tile = wall.Tiles.FirstOrDefault(t => t.Id == id);
        if (_vfLayouts is null || _vfTile != id) return;
        _vfLayouts.Children.Clear();
        if (tile is null || (tile.Layouts.Count == 0 && tile.Places.Count == 0))
        {
            _vfLayouts.Children.Add(new TextBlock { Text = "None yet. Place a facet and save it.", Foreground = Muted, FontSize = 12, Opacity = 0.8, Margin = new Thickness(2, 0, 0, 0) });
            return;
        }
        foreach (var (lid, label, lurl, hasRegion, aspect) in tile.Layouts)
        {
            var row = new Grid { ColumnSpacing = 4 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var go = new Button { Content = label + "  ·  " + (hasRegion ? "region" : "whole page") + (aspect is null ? "" : "  ·  " + aspect), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 4, 10, 4), FontSize = 12 };
            ToolTipService.SetToolTip(go, "Use this facet in the slot now: " + lurl);
            var sid = lid;
            go.Click += (_, __) => { _brain.Call(HostCalls.ApplyShortcut, id, sid); SetPill("Prism · " + id + " → " + label); };
            var del = new Button { Content = "✕", Padding = new Thickness(8, 4, 8, 4), FontSize = 12, Foreground = Danger };
            Grid.SetColumn(del, 1);
            del.Click += (_, __) => { _brain.Call(HostCalls.RemoveShortcut, id, sid); var t = RootGrid.DispatcherQueue.CreateTimer(); t.Interval = TimeSpan.FromMilliseconds(400); t.IsRepeating = false; t.Tick += (s2, e2) => { _ = RefreshLayoutsAsync(id); }; t.Start(); };
            row.Children.Add(go);
            row.Children.Add(del);
            _vfLayouts.Children.Add(row);
        }
        foreach (var (label, url) in tile.Places)
        {
            var go = new Button { Content = label + "  (" + tile.App + ")", HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 4, 10, 4), FontSize = 12, Opacity = 0.85 };
            var u = url;
            go.Click += (_, __) => ConfigureAddress(id, u);
            _vfLayouts.Children.Add(go);
        }
    }

    /// <summary>Save the current view as a layout of this app: the page shown now,
    /// the placed box (or the whole page when none is placed) and the chosen shape.</summary>
    private async Task SaveLayoutAsync(string id)
    {
        var focus = await PlacedFocusAsync(id);
        if (focus is not { } f) { SetPill("Prism · place a region first (Pick region, click), then save it as a facet"); return; }
        var shapeName = _vfShape ?? (_vfSlotAspect > 0 ? $"{_vfSlotAspect:0.00}:1 (this slot)" : "this slot");
        var label = await PromptTextAsync("Name this facet  ·  for " + shapeName + " slots", "", "e.g. Home, Sign in, Live guide", "Save facet");
        if (label is null) return;
        // the shape the view is made for: the chosen slot shape, else this slot's own aspect as W:H
        var aspectHint = _vfShape ?? (_vfSlotAspect > 0 ? $"{Math.Round(_vfSlotAspect * 100)}:100" : null);
        object input = new { label, focus = new { region = f.Region, viewport = f.Viewport }, aspectHint };
        _brain.Call(HostCalls.SaveShortcut, id, JsonSerializer.Serialize(input, new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never }));
        SetPill("Prism · saved facet \"" + label + "\" for " + shapeName + " slots. Adjust and save another, or Apply");
        var t = RootGrid.DispatcherQueue.CreateTimer();
        t.Interval = TimeSpan.FromMilliseconds(400);
        t.IsRepeating = false;
        t.Tick += (s2, e2) => { _ = RefreshLayoutsAsync(id); };
        t.Start();
    }

    /// <summary>The text prompt with a checkbox under the box (a playlist public on TMDB, 2026-10-03): the text, or null, and the box's state.</summary>
    private async Task<(string? text, bool on)> PromptTextAsync(string title, string initial, string placeholder, string primary, string checkbox)
    {
        var box = new TextBox { Text = initial, PlaceholderText = placeholder, MinWidth = 380 };
        var check = new CheckBox { Content = checkbox, IsChecked = false, Margin = new Thickness(0, 10, 0, 0) };
        var dlg = new ContentDialog
        {
            Title = title,
            Content = new StackPanel { Children = { box, check } },
            PrimaryButtonText = primary,
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = RootGrid.XamlRoot,
            RequestedTheme = ElementTheme.Dark,
        };
        try
        {
            if (await dlg.ShowAsync() != ContentDialogResult.Primary) return (null, false);
        }
        catch (Exception ex) { SetStatus("dialog: " + ex.Message); return (null, false); }
        var text = box.Text.Trim();
        return (text.Length > 0 ? text : null, check.IsChecked == true);
    }

    private async Task<string?> PromptTextAsync(string title, string initial, string placeholder, string primary)
    {
        var box = new TextBox { Text = initial, PlaceholderText = placeholder, MinWidth = 380 };
        var dlg = new ContentDialog
        {
            Title = title,
            Content = box,
            PrimaryButtonText = primary,
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = RootGrid.XamlRoot,
            RequestedTheme = ElementTheme.Dark,
        };
        try
        {
            if (await dlg.ShowAsync() != ContentDialogResult.Primary) return null;
        }
        catch (Exception ex) { SetStatus("dialog: " + ex.Message); return null; }
        var text = box.Text.Trim();
        return text.Length > 0 ? text : null;
    }

    /// <summary>Use the whole page: no framing at all - the page at the slot's
    /// own size. For a video player page (Peacock, Netflix…) that IS the
    /// video filling the slot, since such players fill whatever viewport
    /// they get; zooming out cannot make them smaller.</summary>
    private void ClearViewfinderRegion()
    {
        if (_viewfinder is null || _vfTile is not { } id) return;
        EndViewfinder();
        _brain.Call(HostCalls.FinishFraming, id, "{\"clear\":true}");  // core clears + persists, back in its slot
        SetPill("Prism · " + id + ": whole page");
    }

    private void CancelViewfinder()
    {
        if (_viewfinder is null || _vfTile is not { } id) return;
        EndViewfinder();
        _brain.Call(HostCalls.FinishFraming, id, null);               // back to its slot, previous framing returns
    }

    private void EndViewfinder()
    {
        if (_viewfinder is not null) RootGrid.Children.Remove(_viewfinder);
        if (_vfFloat is not null) RootGrid.Children.Remove(_vfFloat);
        _viewfinder = null;
        _vfFloat = null;
        _vfTile = null;
        _vfBox = null;
        _vfReadout = null;
        _vfZoomLabel = null;
        _vfHintPanel = null;
        _vfZoomPanel = null;
        _vfPickBtn = null;
        _vfApplyBtn = null;
        _vfControlsBtn = null;
        _vfLayouts = null;
        _vfSaveBtn = null;
        _vfShape = null;
        _vfPicking = false;
        _vfPlaced = false;
        _vfControlsHidden = false;
    }

    // ------------------------------------------------ keys from anywhere
    /// <summary>Esc closes the topmost Prism overlay. Reached from the XAML
    /// accelerator AND from a focused page (the tile bootstrap forwards Esc), so
    /// it works no matter where keyboard focus is.</summary>
    private bool EscapePressed()
    {
        if (_welcome is { Visibility: Visibility.Visible }) { CloseWelcome(); return true; }   // the welcome page (Set up services)
        if (_episodesPanel is not null) { CloseEpisodes(); return true; }   // the Episodes menu over the stage (2026-09-22)
        if (StageCurtain.Visibility == Visibility.Visible) { HideStageCurtain(); return true; }   // the curtain lifts first (the page is there beneath)
        if (_surfaces.CloseTopPopup()) return true;                           // §30 a popup sheet closes first
        if (_sheet is not null) { CloseContextSheet(); return true; }                                     // §6a the context sheet closes first (selection, not a screen)
        if (_feSession || _facetEditor is not null) { CancelFacetEditor(); return true; }   // SM-2 facet editor (chooser or pop-out session) - cancelled, the opener resumes
        if (_asSession) { _ = FinishAppSetupAsync(save: false); return true; }          // SM-2 App setup mode
        if (_layoutEditor is not null) { CloseLayoutEditor(); return true; }             // SM-2 layout editor (a save is Done; Esc closes)
        if (_corner is not null || _newsPicker is not null || _wizard is not null || _builder is not null || _rail is not null || _appCard is not null || _routeStack.Count > 0) { RouteBack(); return true; }   // §6a: Back lands on the scene
        if (_viewfinder is not null) { CancelViewfinder(); return true; }
        if (_slotPick is not null) { CancelSlotPick(); return true; }
        if (_appList is not null) { CloseAppList(); return true; }
        if (_picker is not null) { ClosePicker(); return true; }
        if (_controls is not null) { ToggleControls(); return true; }
        if (_arrange is not null) { ToggleArrange(); return true; }
        // the bare video wall: Escape (a remote's Back) opens the Video player's own page, the way a TV's Home does
        if (WatchGrip.Visibility == Visibility.Visible && !VideoHubOpen) { _ = ShowVideoHubAsync(); return true; }
        return false;
    }

    /// <summary>Ctrl+Shift+W: Watch, from anywhere on the wall while the Video player is up (a press while Watch is open does nothing).</summary>
    private async Task OpenWatchByKeyAsync()
    {
        if (VideoHubOpen) return;
        if (WatchGrip.Visibility != Visibility.Visible) { SetPill("Prism" + Mid + "Watch is the Video player's page. Switch to the Video player first"); return; }
        HideStageBar();
        await ShowVideoHubAsync();
    }

    private void OnHostKey(string key)
    {
        switch (key)
        {
            case "Escape": EscapePressed(); break;
            case "F8": if (_viewfinder is null) BeginSlotRegion(); break;
            case "F10": _ = OpenAppMenuAsync(); break;
            case "F11": ToggleWallFullscreen(); break;
            case "Ctrl+Shift+W": _ = OpenWatchByKeyAsync(); break;   // from a page that has the keyboard
            // the universal player's transport keys, from the stage (the page's prelude forwards them only in its fullscreen)
            case "Space": _ = StageKeyAsync("playpause"); break;
            case "ArrowLeft": _ = StageKeyAsync("seekbackward"); break;
            case "ArrowRight": _ = StageKeyAsync("seekforward"); break;
            case "ArrowUp": case "ArrowDown": case "Enter": _ = ShowStageBarAsync(); break;
        }
    }

    // ------------------------------------------------ the slot context menu
    /// <summary>Right-click on a slot (the page's own menu is replaced): the
    /// slot's tools first - Pan (drag scrolls the page) / Select (the pointer
    /// reaches the page) - then the slot's actions.</summary>
    private async void ShowSlotContextMenu(string id, Windows.Foundation.Point at)
    {
        if (_viewfinder is not null || _slotPick is not null) return;
        var wall = await ReadWallStateAsync();
        var tile = wall.Tiles.FirstOrDefault(t => t.Id == id);
        if (_model.ActiveScene is not null && SceneItemOf(id, tile) is { } sceneItem) { ShowContextSheet(sceneItem, at); return; }   // §6a: long-press / right-click → the context sheet
        var menu = new MenuFlyout { MenuFlyoutPresenterStyle = (Style)RootGrid.Resources["PrismMenuPresenter"] };
        var shield = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)) };
        Canvas.SetZIndex(shield, 999);
        shield.PointerPressed += (_, e) => { e.Handled = true; menu.Hide(); };
        menu.Opened += (_, __) => { if (!RootGrid.Children.Contains(shield)) RootGrid.Children.Add(shield); };
        menu.Closed += (_, __) => RootGrid.Children.Remove(shield);

        if (tile?.Placeholder == true)
        {
            // §33 an empty slot: a shape and a place, no app yet - choose one; the slot's shape and place win
            menu.Items.Add(new MenuFlyoutItem { Text = "Empty slot" + (tile.Aspect is { } asp ? "  ·  " + asp : "") + (tile.Kind == "floating" ? "  ·  floating" : ""), IsEnabled = false });
            menu.Items.Add(Item("Choose an app from the catalog…", "", null, () => ConfigureFromCatalog(id)));
            menu.Items.Add(Item("Custom website…", null, null, () => _ = ConfigureCustomAsync(id)));
            menu.Items.Add(new MenuFlyoutSeparator());
            menu.Items.Add(tile.Kind == "floating"
                ? Item("Dock into the wall", null, null, () => _brain.Call(HostCalls.UpdateTile, id, "{\"kind\":null}"))
                : Item("Float this slot", null, null, () => _brain.Call(HostCalls.UpdateTile, id, "{\"kind\":\"floating\"}")));
            if (tile.Kind != "floating") menu.Items.Add(Item("Make hero", null, null, () => _brain.Call(HostCalls.PromoteHero, id)));
            menu.Items.Add(new MenuFlyoutSeparator());
            var rmp = Item("Remove this slot", null, null, () => _brain.Call(HostCalls.RemoveTile, id));
            rmp.Foreground = Danger;
            menu.Items.Add(rmp);
            menu.ShowAt(RootGrid, new FlyoutShowOptions { Position = at, Placement = FlyoutPlacementMode.BottomEdgeAlignedLeft });
            return;
        }

        menu.Items.Add(new MenuFlyoutItem { Text = id + (tile is not null && tile.App != id ? "  ·  " + tile.App : ""), IsEnabled = false });
        var tool = _surfaces.ToolOf(id);
        menu.Items.Add(Radio("✋  Pan - drag scrolls the page", "tool", tool == "pan", () => _surfaces.SetTool(id, "pan")));
        menu.Items.Add(Radio("↖  Select - the pointer reaches the page", "tool", tool != "pan", () => _surfaces.SetTool(id, "select")));
        menu.Items.Add(new MenuFlyoutSeparator());

        // this app's layouts: assign one to this slot
        var app = tile?.App ?? id;
        var layouts = new MenuFlyoutSubItem { Text = app + " views" };
        if (tile is not null)
        {
            foreach (var (lid, label, _, _, _) in tile.Layouts)
            {
                var sid = lid;
                layouts.Items.Add(Item(label, null, null, () => { _brain.Call(HostCalls.ApplyShortcut, id, sid); SetPill("Prism · " + id + " → " + label); }));
            }
            if (tile.Layouts.Count > 0 && tile.Places.Count > 0) layouts.Items.Add(new MenuFlyoutSeparator());
            foreach (var (label, url) in tile.Places)
            {
                var u = url;
                layouts.Items.Add(Item(label, null, null, () => ConfigureAddress(id, u)));
            }
        }
        if (layouts.Items.Count > 0) layouts.Items.Add(new MenuFlyoutSeparator());
        layouts.Items.Add(Item("New facet of " + app + "…", "", null, () => BeginViewfinder(id, "views")));
        menu.Items.Add(layouts);
        menu.Items.Add(Item("Configure " + app + "…", "\ue7a8", "F8", () => BeginViewfinder(id, "app")));   // screen 1: sign in, navigate
        var change = new MenuFlyoutSubItem { Text = "Change app" };
        change.Items.Add(Item("Choose from the catalog…", null, null, () => ConfigureFromCatalog(id)));
        change.Items.Add(Item("Custom website…", null, null, () => _ = ConfigureCustomAsync(id)));
        menu.Items.Add(change);
        if (tile is not null && (tile.HasRegion || tile.HasSelector))
            menu.Items.Add(Item("Clear region - show the whole page", null, null, () => _brain.Call(HostCalls.UpdateTile, id, "{\"focus\":null}")));
        menu.Items.Add(new MenuFlyoutSeparator());
        menu.Items.Add(Item("Fill slot", null, null, () => _ = _surfaces.RequestPlayerFullscreenAsync(id)));
        menu.Items.Add(Item(_screenFsTile == id ? "Exit Full Screen" : "Full Screen", null, null, () => ToggleScreenFullscreen(id)));
        // §32 floating: out of the wall at its own small footprint (music players), or back into the layout
        if (tile?.Kind == "floating")
        {
            menu.Items.Add(Item("Reveal the player (transient)", null, null, () => OpenRoute("prism://facet/" + Uri.EscapeDataString(id) + "/reveal")));
            menu.Items.Add(Item("Dock into the wall", null, null, () => _brain.Call(HostCalls.UpdateTile, id, "{\"kind\":null}")));
        }
        else
        {
            var floatIt = Item("Float this slot", null, null, () => _brain.Call(HostCalls.UpdateTile, id, "{\"kind\":\"floating\"}"));
            ToolTipService.SetToolTip(floatIt, "Lift this slot out of the wall: it hovers at a small footprint with Prism's own player control up and the page beneath. The wall reflows without it.");
            menu.Items.Add(floatIt);
            menu.Items.Add(Item("Make hero", null, null, () => _brain.Call(HostCalls.PromoteHero, id)));
        }
        var veil = _surfaces.VeilStates().FirstOrDefault(v => v.Id == id);
        if (veil.Covered) menu.Items.Add(Item(veil.Peeked ? "Re-veil" : "Show ad 15s", null, null, () => _surfaces.TogglePeek(id)));
        menu.Items.Add(new MenuFlyoutSeparator());
        var rm = Item("Remove from wall", null, null, () => _brain.Call(HostCalls.RemoveTile, id));
        rm.Foreground = Danger;
        menu.Items.Add(rm);
        menu.ShowAt(RootGrid, new FlyoutShowOptions { Position = at, Placement = FlyoutPlacementMode.BottomEdgeAlignedLeft });
    }

    // ------------------------------------------------ configure: the page
    /// <summary>The slot's address (same tile, same account): core persists and reloads it - right here, full screen.</summary>
    private void ConfigureAddress(string id, string url)
    {
        _brain.Call(HostCalls.UpdateTile, id, JsonSerializer.Serialize(new { url }));
        SetPill("Prism · " + id + " → " + Shorten(url, 60));
    }

    /// <summary>This slot becomes a catalog pick (core runs pickerTile; the slot stays). The configure screen ends - the new tile loads in the slot.</summary>
    private void ConfigureFromCatalog(string id)
    {
        ShowCatalog("This slot becomes the pick - same place, its own account. Esc closes.", entry =>
        {
            ClosePicker();
            if (_viewfinder is not null) { EndViewfinder(); _brain.Call(HostCalls.FinishFraming, id, null); }
            _brain.Call(HostCalls.ReplaceWithCatalogTile, id, entry.Json, "{}", SelectorTableJson(entry.Adapter));
            SetPill("Prism · " + id + " becomes " + entry.Name);
        }, zIndex: 997);
    }

    /// <summary>This slot becomes a custom website tile for a URL (new profile, no adapter; the slot stays).</summary>
    private async Task ConfigureCustomAsync(string id)
    {
        var url = await PromptUrlAsync("Make " + id + " a custom website", "https://", "Make it");
        if (url is null) return;
        if (_viewfinder is not null) { EndViewfinder(); _brain.Call(HostCalls.FinishFraming, id, null); }
        _brain.Call(HostCalls.ReplaceWithCustomTile, id, url);
        SetPill("Prism · " + id + " becomes " + Shorten(url, 50));
    }

    // ------------------------------------------------------------- dialogs
    /// <summary>Set address…: the slot's URL (core persists; the §16 path reloads it).</summary>
    private async Task SetAddressAsync(string id)
    {
        var current = _surfaces.SourceOf(id) ?? "";
        var url = await PromptUrlAsync("Address of " + id, current, "Apply");
        if (url is null) return;
        _brain.Call(HostCalls.UpdateTile, id, JsonSerializer.Serialize(new { url }));
        SetPill("Prism · " + id + " → " + Shorten(url, 60));
    }

    /// <summary>Add a website…: any http(s) URL becomes a plain custom tile (§31 step 2).</summary>
    private async Task AddWebsiteAsync()
    {
        var url = await PromptUrlAsync("Add a website to the wall", "https://", "Add");
        if (url is null) return;
        _brain.Call(HostCalls.AddCustomTile, url, "{}");
        SetPill("Prism · adding " + Shorten(url, 60));
    }

    private async Task<string?> PromptUrlAsync(string title, string initial, string primary)
    {
        var box = new TextBox { Text = initial, PlaceholderText = "https://…", MinWidth = 460, SelectionStart = initial.Length };
        var note = new TextBlock { Text = "http(s) addresses only.", Foreground = Muted, FontSize = 12, Margin = new Thickness(0, 6, 0, 0) };
        var body = new StackPanel();
        body.Children.Add(box);
        body.Children.Add(note);
        var dlg = new ContentDialog
        {
            Title = title,
            Content = body,
            PrimaryButtonText = primary,
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = RootGrid.XamlRoot,
            RequestedTheme = ElementTheme.Dark,
        };
        box.TextChanged += (_, __) => dlg.IsPrimaryButtonEnabled = IsHttpUrl(box.Text);
        dlg.IsPrimaryButtonEnabled = IsHttpUrl(initial);
        try
        {
            if (await dlg.ShowAsync() != ContentDialogResult.Primary) return null;
        }
        catch (Exception ex) { SetStatus("dialog: " + ex.Message); return null; }
        var text = box.Text.Trim();
        return IsHttpUrl(text) ? new Uri(text).ToString() : null;
    }

    private static bool IsHttpUrl(string s) =>
        Uri.TryCreate(s.Trim(), UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http") && u.Host.Length > 0;

    // ---------------------------------------------------------------- window
    /// <summary>F11: the whole wall borderless across the monitor (no tile
    /// maximize - the layout stays as solved). Chrome only; core is not told.</summary>
    private void ToggleWallFullscreen()
    {
        try
        {
            _wallFs = !_wallFs;
            AppWindow.SetPresenter(_wallFs
                ? Microsoft.UI.Windowing.AppWindowPresenterKind.FullScreen
                : Microsoft.UI.Windowing.AppWindowPresenterKind.Overlapped);
        }
        catch (Exception ex) { _wallFs = false; SetStatus("full-screen wall: " + ex.Message); }
    }

    private void OpenPath(string path, bool ensureDir = false)
    {
        try
        {
            if (ensureDir) Directory.CreateDirectory(path);
            if (!File.Exists(path) && !Directory.Exists(path)) { SetPill("Prism · nothing there yet: " + Path.GetFileName(path)); return; }
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        }
        catch (Exception ex) { SetStatus("open failed: " + ex.Message); }
    }

    // ----------------------------------------------------------------- about
    private async Task ShowAboutAsync()
    {
        var ver = AppVersion.Text;
        string wv2;
        try { wv2 = Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString(null); }
        catch { wv2 = "unavailable"; }
        var body = new StackPanel { Spacing = 8, MinWidth = 380 };
        body.Children.Add(new TextBlock { Text = "Open-source dashboard frames. No ads, no subscriptions, no telemetry, no data sales.", TextWrapping = TextWrapping.Wrap });
        var facts = new StackPanel { Spacing = 2, Margin = new Thickness(0, 6, 0, 0) };
        void Fact(string k, string val) => facts.Children.Add(new TextBlock
        {
            Text = k + "  " + val, FontSize = 12, FontFamily = new FontFamily("Consolas"), Foreground = Muted, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true,
        });
        Fact("host      ", "Prism for Windows " + ver + ", " + Services.Updates.TrackLabel(Services.Updates.Channel) + " track (M1 host shell)");
        Fact("webview2  ", wv2);
        Fact("brain     ", _brain.Ready ? "ready" : "starting");
        Fact("adapters  ", _armedAdapters.Count > 0 ? string.Join(", ", _armedAdapters) : "none armed");
        Fact("wall      ", $"{_w:0}×{_h:0}");
        Fact("data      ", _store.Root);
        body.Children.Add(facts);
        body.Children.Add(new TextBlock
        {
            Text = "github.com/Boil5602/Prism-by-Entangled \u00B7 GPLv3 \u00B7 no warranty", FontSize = 12, Foreground = Amber, Margin = new Thickness(0, 6, 0, 0), IsTextSelectionEnabled = true,   // open source under GPLv3 (2026-09-25, "Not MIT. Instead let's do GPLv3"); the comment had swallowed the rest of this line
        });
        var dlg = new ContentDialog
        {
            Title = "PRISM by Entangled",
            Content = body,
            CloseButtonText = "Close",
            XamlRoot = RootGrid.XamlRoot,
            RequestedTheme = ElementTheme.Dark,
        };
        try { await dlg.ShowAsync(); } catch (Exception ex) { SetStatus("about: " + ex.Message); }
    }
}
