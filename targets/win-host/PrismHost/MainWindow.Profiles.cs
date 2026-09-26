using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The Profiles window and profile presets (2026-09-24, "create a Services Profiles Modal that allows the user to see ALL of their configured
/// services as well as selected profiles, where profiles are an option ... allow the user to save any number of profile presets"). The window is
/// a DRAFT ("let me switch and view and make changes without refreshing data UNTIL I save and exit this window. Also give me a save & exit
/// button"): a preset chip loads its profiles and exclusions into the window, the pickers and Exclude boxes change the draft, and Save & exit
/// commits it all at once (videoProfilesCommit); Cancel, the close or Esc drop it. While the services switch, the status holds at the top centre
/// until every one has been read again ("lets keep the status at the top center until completed").
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _profilesWin;
    private static readonly string Dot = " " + (char)0x00B7 + " ";
    private JsonObject? _profView;
    private readonly Dictionary<string, string> _draftPicks = new();
    private readonly HashSet<string> _draftOff = new();
    private string? _draftPreset;
    private string _draftName = "";

    public void CloseProfilesWindow()
    {
        if (_profilesWin is null) return;
        RootGrid.Children.Remove(_profilesWin);
        _profilesWin = null;
    }

    /// <summary>The window opened: the draft starts as things are now.</summary>
    public async Task ShowProfilesWindowAsync()
    {
        JsonObject? v = null;
        try { v = JsonNode.Parse(await ModelCallAsync("videoProfilesView") ?? "null") as JsonObject; } catch (Exception e) { LogLine("profiles: " + e.Message); }
        if (v is null) { SetPill("Prism" + Dot + "profiles could not be read"); return; }
        _profView = v;
        _draftPicks.Clear(); _draftOff.Clear();
        foreach (var s in (v["services"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
            if ((s["current"] as JsonObject)?["id"]?.GetValue<string>() is { Length: > 0 } cur) _draftPicks[s["app"]?.GetValue<string>() ?? ""] = cur;
        foreach (var a in (v["off"] as JsonArray)?.OfType<JsonValue>() ?? Enumerable.Empty<JsonValue>()) _draftOff.Add(a.GetValue<string>());
        _draftPreset = v["active"]?.GetValue<string>();
        _draftName = "";
        DrawProfilesWindow();
    }

    private void DrawProfilesWindow()
    {
        var v = _profView;
        if (v is null) return;
        var scrim = _profilesWin;
        if (scrim is null)
        {
            scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xD8, 0x05, 0x06, 0x09)) };
            Canvas.SetZIndex(scrim, 960);   // over the Watch page, as Details
            scrim.PointerPressed += (_, __) => CloseProfilesWindow();
            var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
            esc.Invoked += (_, e) => { e.Handled = true; CloseProfilesWindow(); };
            scrim.KeyboardAccelerators.Add(esc);
            RootGrid.Children.Add(scrim);
            _profilesWin = scrim;
            scrim.Loaded += (_, __) => scrim.Focus(FocusState.Programmatic);
        }
        scrim.Children.Clear();
        var body = new StackPanel { Spacing = 16, Margin = new Thickness(32, 26, 32, 26) };
        var card = new Border
        {
            Background = HubCard, CornerRadius = new CornerRadius(14), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x55, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(1),
            MinWidth = 640, MaxWidth = 900, Margin = new Thickness(60, 40, 60, 40), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            Child = new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollMode = ScrollMode.Disabled },
        };
        card.PointerPressed += (_, e) => e.Handled = true;
        scrim.Children.Add(card);

        // head: the title and the close (a close drops the draft)
        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(new TextBlock { Text = "Profiles", FontSize = 26, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk });
        var close = Chip(new FontIcon { Glyph = "\uE711", FontSize = 13 }, false);
        ToolTipService.SetToolTip(close, "Close without changing anything (Esc)");
        close.Click += (_, __) => CloseProfilesWindow();
        Grid.SetColumn(close, 1);
        head.Children.Add(close);
        body.Children.Add(head);

        // presets: a chip loads the preset into the window (nothing switches until Save & exit); right-click to delete
        var presets = (v["presets"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        var presetsHead = new TextBlock { Text = "Presets", FontSize = 15, Foreground = HubDim };
        ToolTipService.SetToolTip(presetsHead, "Press a preset to load its profiles and exclusions below. Nothing changes on the services until Save & exit.");
        body.Children.Add(presetsHead);
        var presetRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (presets.Count == 0)
            presetRow.Children.Add(new TextBlock { Text = "None yet. Pick each service's profile below, name it, then Save & exit.", FontSize = 13, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap, MaxWidth = 760 });
        foreach (var p in presets)
        {
            var (pid, pname) = (p["id"]?.GetValue<string>() ?? "", p["name"]?.GetValue<string>() ?? "");
            var on = pid == _draftPreset && _draftName.Length == 0;
            var chip = Chip(new TextBlock { Text = pname, FontSize = 14, Foreground = on ? HubAmber : HubInk }, on);
            ToolTipService.SetToolTip(chip, (on ? "Loaded. " : "Load " + pname + "'s profiles and exclusions into the window. ") + "Right-click to delete it.");
            var pj = p;
            chip.Click += (_, __) =>
            {
                _draftPicks.Clear(); _draftOff.Clear();
                foreach (var (app, c) in (pj["picks"] as JsonObject) ?? new JsonObject()) if ((c as JsonObject)?["id"]?.GetValue<string>() is { Length: > 0 } id) _draftPicks[app] = id;
                foreach (var a in (pj["off"] as JsonArray)?.OfType<JsonValue>() ?? Enumerable.Empty<JsonValue>()) _draftOff.Add(a.GetValue<string>());
                _draftPreset = pid; _draftName = "";
                DrawProfilesWindow();
            };
            var menu = new MenuFlyout();
            var del = new MenuFlyoutItem { Text = "Delete " + pname };
            del.Click += async (_, __) =>
            {
                await ModelCallAsync("videoPresetDelete", pid);
                SetPill("Prism" + Dot + pname + " deleted");
                try { var nv = JsonNode.Parse(await ModelCallAsync("videoProfilesView") ?? "null") as JsonObject; if (nv is not null) { _profView["presets"] = nv["presets"]?.DeepClone(); } } catch { }
                if (_draftPreset == pid) _draftPreset = null;
                DrawProfilesWindow();
            };
            menu.Items.Add(del);
            chip.ContextFlyout = menu;
            presetRow.Children.Add(chip);
        }
        body.Children.Add(new ScrollViewer { Content = presetRow, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled });

        // the services that have profiles, each with its picker and Exclude
        body.Children.Add(ColumnHeads("Services", true));
        var services = (v["services"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        if (services.Count == 0) body.Children.Add(new TextBlock { Text = "None of your services has profiles.", FontSize = 13, Foreground = HubDim });
        foreach (var s in services)
        {
            var app = s["app"]?.GetValue<string>() ?? ""; var name = s["name"]?.GetValue<string>() ?? app;
            var status = s["status"]?.GetValue<string>() ?? "";
            var profiles = (s["profiles"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
            var now = (s["current"] as JsonObject)?["id"]?.GetValue<string>();
            var picked = _draftPicks.TryGetValue(app, out var dp) ? dp : now;
            var switching = s["switching"]?.GetValue<bool>() == true;
            var row = new Grid { ColumnSpacing = 14, MinHeight = 44 };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ProfileColW) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ExcludeColW) });
            var mark = ServiceMark(app, name, 30); mark.VerticalAlignment = VerticalAlignment.Center;
            row.Children.Add(mark);
            var label = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            label.Children.Add(new TextBlock { Text = name, FontSize = 15, Foreground = HubInk });
            var changed = picked is not null && picked != now;
            var note = status != "signed-in" ? "not signed in" : profiles.Count == 0 ? "its profiles show once its " + (char)0x201C + "Who's watching?" + (char)0x201D + " page has been seen" : changed ? "changes on Save & exit" : switching ? "switching" + (char)0x2026 : "";
            if (note.Length > 0) label.Children.Add(new TextBlock { Text = note, FontSize = 12, Foreground = changed || switching ? HubAmber : HubDim });
            Grid.SetColumn(label, 1);
            row.Children.Add(label);
            if (profiles.Count > 0 && status == "signed-in")
            {
                var pick = new ComboBox { MinWidth = 220, VerticalAlignment = VerticalAlignment.Center, PlaceholderText = "Who's watching?" };
                foreach (var p in profiles) pick.Items.Add(new ComboBoxItem { Content = p["name"]?.GetValue<string>() ?? "", Tag = p["id"]?.GetValue<string>() ?? "" });
                pick.SelectedIndex = profiles.FindIndex(p => p["id"]?.GetValue<string>() == picked);
                var a2 = app;
                pick.SelectionChanged += (_, __) =>
                {
                    if (pick.SelectedItem is not ComboBoxItem it || it.Tag is not string pid) return;
                    if (_draftPicks.TryGetValue(a2, out var had) && had == pid) return;
                    _draftPicks[a2] = pid;
                    DrawProfilesWindow();
                };
                Grid.SetColumn(pick, 2);
                row.Children.Add(pick);
            }
            var ex = ExcludeBox(app, name);
            Grid.SetColumn(ex, 3);
            row.Children.Add(ex);
            body.Children.Add(row);
        }
        // the services without profiles: nothing to pick, only Exclude
        var others = (v["others"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
        if (others.Count > 0)
        {
            body.Children.Add(ColumnHeads("Services without profiles", false));
            foreach (var o in others)
            {
                var app = o["app"]?.GetValue<string>() ?? ""; var name = o["name"]?.GetValue<string>() ?? app;
                var row = new Grid { ColumnSpacing = 14, MinHeight = 40 };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ExcludeColW) });
                var mark = ServiceMark(app, name, 26); mark.VerticalAlignment = VerticalAlignment.Center;
                row.Children.Add(mark);
                var label = new TextBlock { Text = name, FontSize = 14, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(label, 1);
                row.Children.Add(label);
                var ex = ExcludeBox(app, name);
                Grid.SetColumn(ex, 2);
                row.Children.Add(ex);
                body.Children.Add(row);
            }
        }

        // the foot: a new preset's name (optional), Cancel, Save & exit
        var foot = new Grid { ColumnSpacing = 10, Margin = new Thickness(0, 10, 0, 0) };
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var loaded = presets.FirstOrDefault(p => p["id"]?.GetValue<string>() == _draftPreset)?["name"]?.GetValue<string>();
        var nameBox = new TextBox { Text = _draftName, PlaceholderText = "Save as a new preset (optional name)", Width = 300, FontSize = 13, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center };
        ToolTipService.SetToolTip(nameBox, "A name here saves these profiles as a new preset (the same name replaces that preset). Left empty, " + (loaded is null ? "the profiles are applied without a preset." : loaded + " is updated with them."));
        nameBox.TextChanged += (_, __) => _draftName = nameBox.Text?.Trim() ?? "";
        foot.Children.Add(nameBox);
        var cancel = Chip(new TextBlock { Text = "Cancel", FontSize = 14, Foreground = HubInk }, false);
        ToolTipService.SetToolTip(cancel, "Close without changing anything.");
        cancel.Click += (_, __) => CloseProfilesWindow();
        Grid.SetColumn(cancel, 1);
        foot.Children.Add(cancel);
        var save = Chip(new TextBlock { Text = "Save & exit", FontSize = 14, Foreground = HubAmber }, true);
        ToolTipService.SetToolTip(save, "Switches the services whose profile changed, sets the exclusions, " + (loaded is null ? "and saves a preset if you named one." : "and updates " + loaded + " (or saves a new preset under the name you typed)."));
        save.Click += async (_, __) => await SaveProfilesDraftAsync();
        nameBox.KeyDown += async (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) { e.Handled = true; await SaveProfilesDraftAsync(); } };
        Grid.SetColumn(save, 2);
        foot.Children.Add(save);
        body.Children.Add(foot);
    }

    /// <summary>Save & exit: the whole draft committed in one call, the window closed, the status held until every switch is read.</summary>
    private async Task SaveProfilesDraftAsync()
    {
        var draft = new JsonObject
        {
            ["picks"] = new JsonObject(_draftPicks.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, kv.Value))),
            ["off"] = new JsonArray(_draftOff.Select(a => (JsonNode?)a).ToArray()),
            ["preset"] = _draftName.Length == 0 ? _draftPreset : null,
            ["name"] = _draftName.Length > 0 ? _draftName : null,
        };
        var r = JsonNode.Parse(await ModelCallAsync("videoProfilesCommit", draft.ToJsonString()) ?? "null") as JsonObject;
        if (r?["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Dot + (r?["error"]?.GetValue<string>() ?? "could not save the profiles")); return; }
        CloseProfilesWindow();
        var who = (r["preset"] as JsonObject)?["name"]?.GetValue<string>();
        var n = (r["switched"] as JsonArray)?.Count ?? 0;
        LogLine("profiles: saved" + (who is null ? "" : " as " + who) + ", " + n + " switching");
        if (_triangleWho is not null) _triangleWho.Text = who ?? "";   // the rows follow in place (the live follow); the name under the triangle now
        KickLiveRows();
        _ = FollowProfileSwitchAsync(who, n);
    }

    private const double ProfileColW = 240, ExcludeColW = 150;
    /// <summary>A section's column heads: the section name, "Profile" (where there are profiles) and "Exclude from Continue & My List", the details in their tooltips.</summary>
    private Grid ColumnHeads(string section, bool profiles)
    {
        var g = new Grid { ColumnSpacing = 14, Margin = new Thickness(0, 8, 0, 0) };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        if (profiles) g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ProfileColW) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ExcludeColW) });
        g.Children.Add(new TextBlock { Text = section, FontSize = 15, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Bottom });
        var col = 1;
        if (profiles)
        {
            var ph = new TextBlock { Text = "Profile", FontSize = 13, Foreground = HubDim, VerticalAlignment = VerticalAlignment.Bottom };
            ToolTipService.SetToolTip(ph, "On Save & exit, a service whose profile changed is switched: its own " + (char)0x201C + "Who's watching?" + (char)0x201D + " page or profile menu is pressed in the background, then that person's My List and Continue Watching are read again. That takes a minute or so per service, and each profile's last rows show in the meantime.");
            Grid.SetColumn(ph, col++);
            g.Children.Add(ph);
        }
        var eh = new TextBlock { Text = "Exclude from" + Environment.NewLine + "Continue & My List", FontSize = 12, Foreground = HubDim, TextAlignment = TextAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom };
        ToolTipService.SetToolTip(eh, "Leaves a service's Continue Watching and My List out of Watch for this person; it still shows in the rows below, the Library, Browse and search. Kept with the preset on Save & exit.");
        Grid.SetColumn(eh, col);
        g.Children.Add(eh);
        return g;
    }
    /// <summary>Exclude in the draft (2026-09-24): the service's cards leave Watch's Continue watching and My list for this person, on Save & exit.</summary>
    private CheckBox ExcludeBox(string app, string name)
    {
        var box = new CheckBox { IsChecked = _draftOff.Contains(app), VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, MinWidth = 0, Padding = new Thickness(0) };
        ToolTipService.SetToolTip(box, "Leave " + name + "'s Continue Watching and My List out of Watch for this person. It still shows in the rows below, the Library, Browse and search.");
        box.Checked += (_, __) => _draftOff.Add(app);
        box.Unchecked += (_, __) => _draftOff.Remove(app);
        return box;
    }

    /// <summary>A preset from the triangle: every service switched at once, the status held until done.</summary>
    private async Task ApplyProfilePresetAsync(string presetId, string name)
    {
        var r = JsonNode.Parse(await ModelCallAsync("videoPresetApply", presetId) ?? "null") as JsonObject;
        if (r?["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Dot + (r?["error"]?.GetValue<string>() ?? "could not switch to " + name)); return; }
        var switched = (r["switched"] as JsonArray)?.Count ?? 0;
        LogLine("profiles: preset " + name + " applied, " + switched + " switching");
        if (_triangleWho is not null) _triangleWho.Text = name;
        KickLiveRows();
        _ = FollowProfileSwitchAsync(name, switched);
    }

    private int _profileSwitchRun;
    /// <summary>The name under the Watch header's triangle (the preset on now).</summary>
    private TextBlock? _triangleWho;
    /// <summary>
    /// The status holds at the top centre while the services switch and are read again - which ones are still working - and Watch is drawn again
    /// as each finishes; the outcome shows when every one is done (3 minutes at most).
    /// </summary>
    private async Task FollowProfileSwitchAsync(string? who, int count)
    {
        var run = ++_profileSwitchRun;
        var label = who is null ? "profiles" : who;
        if (count == 0) { ReleasePill("Prism" + Dot + (who is null ? "profiles saved" : "watching as " + who)); return; }
        for (var i = 0; i < 90 && run == _profileSwitchRun; i++)
        {
            List<string> working = new();
            try
            {
                var v = JsonNode.Parse(await ModelCallAsync("videoProfilesView") ?? "null") as JsonObject;
                working = (v?["services"] as JsonArray)?.OfType<JsonObject>().Where(s => s["switching"]?.GetValue<bool>() == true).Select(s => s["name"]?.GetValue<string>() ?? "").ToList() ?? new();
            }
            catch { }
            if (run != _profileSwitchRun) return;
            if (working.Count == 0) break;
            SetPill("Prism" + Dot + "switching to " + label + Dot + string.Join(", ", working) + (char)0x2026, hold: true);   // (the rows follow in place as each service is read)
            KickLiveRows();
            await Task.Delay(2000);
        }
        if (run != _profileSwitchRun) return;
        ReleasePill("Prism" + Dot + (who is null ? "profiles switched" : "watching as " + who) + Dot + "every service read");
    }

    /// <summary>The large Prism triangle on the Watch header: the preset on now beside it, a press drops down the presets and the Profiles window.</summary>
    private Button PresetTriangle()
    {
        var icon = new Image { Width = 80, Height = 80, HorizontalAlignment = HorizontalAlignment.Center };   // twice as large (2026-09-24)
        try { var p = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "prism-icon.png"); if (System.IO.File.Exists(p)) icon.Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(p)); } catch { }
        // the preset on now named UNDER the triangle, blank when none (2026-09-24, "add the name of the preset under the triangle ... Leave blank for nothing")
        // the name centred under the triangle alone (2026-09-24, "The preset name is not centered under the triangle"); the arrow beside the triangle
        var who = new TextBlock { FontSize = 20, Foreground = HubAmber, HorizontalAlignment = HorizontalAlignment.Center, TextAlignment = TextAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = 140 };
        _triangleWho = who;
        var mark = new StackPanel { Orientation = Orientation.Vertical, Spacing = 0, Children = { icon, who } };
        var face = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { mark, new FontIcon { Glyph = "\uE70D", FontSize = 16, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 32, 0, 0) } } };
        var btn = new Button { Content = face, Background = HubClear, BorderThickness = new Thickness(0), Padding = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center };
        ToolTipService.SetToolTip(btn, "Who's watching: a preset switches every service's profile at once.");
        var menu = new MenuFlyout { Placement = Microsoft.UI.Xaml.Controls.Primitives.FlyoutPlacementMode.BottomEdgeAlignedLeft };
        async Task FillAsync()
        {
            menu.Items.Clear();
            foreach (var it in await BuildPresetItemsAsync()) menu.Items.Add(it);
            if (menu.Items.Count == 0) menu.Items.Add(new MenuFlyoutItem { Text = "No service has profiles", IsEnabled = false });
        }
        // the name of the preset on now, read once as the page draws
        async Task NameAsync()   // on the window's own thread: the brain's calls are made from it
        {
            string? name = null;
            try { var v = JsonNode.Parse(await ModelCallAsync("videoProfilesView") ?? "null") as JsonObject; var a = v?["active"]?.GetValue<string>(); name = (v?["presets"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(p => p["id"]?.GetValue<string>() == a)?["name"]?.GetValue<string>(); } catch (Exception e) { LogLine("triangle: " + e.Message); }
            who.Text = name ?? "";
        }
        _ = NameAsync();
        btn.Click += async (_, __) => { await FillAsync(); menu.ShowAt(btn); };
        return btn;
    }

    /// <summary>The presets (the one on now checked), then the Profiles window - the triangle's drop-down.</summary>
    private async Task<List<MenuFlyoutItemBase>> BuildPresetItemsAsync()
    {
        var items = new List<MenuFlyoutItemBase>();
        JsonObject? v = null;
        try { v = JsonNode.Parse(await ModelCallAsync("videoProfilesView") ?? "null") as JsonObject; } catch { }
        if (v is null || (v["services"] as JsonArray)?.Count is null or 0) return items;
        var active = v["active"]?.GetValue<string>();
        foreach (var p in (v["presets"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var (pid, pname) = (p["id"]?.GetValue<string>() ?? "", p["name"]?.GetValue<string>() ?? "");
            var it = new ToggleMenuFlyoutItem { Text = pname, IsChecked = pid == active };
            ToolTipService.SetToolTip(it, "Switch every service to " + pname + "'s profile.");
            it.Click += async (_, __) => await ApplyProfilePresetAsync(pid, pname);
            items.Add(it);
        }
        var win = new MenuFlyoutItem { Text = "Profiles" + (char)0x2026, Icon = new FontIcon { Glyph = "\uE716" } };
        ToolTipService.SetToolTip(win, "Every service's profile, and the presets that switch them all at once.");
        win.Click += (_, __) => _ = ShowProfilesWindowAsync();
        if (items.Count > 0) items.Add(new MenuFlyoutSeparator());
        items.Add(win);
        return items;
    }
}
