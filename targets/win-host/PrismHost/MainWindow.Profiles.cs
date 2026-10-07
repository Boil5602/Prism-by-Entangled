using System.Text.Json;
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
    // sign-ins (2026-09-29): the sign-in each service uses for this person, music and video alike; changed on Save & exit
    private JsonObject? _signInView;
    private readonly Dictionary<string, string> _draftSignIns = new();

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
        try { _signInView = JsonNode.Parse(await ModelCallAsync("signInsView", WelcomeEntriesJson()) ?? "null") as JsonObject; } catch (Exception e) { LogLine("sign-ins: " + e.Message); _signInView = null; }
        _draftSignIns.Clear();
        foreach (var s in (_signInView?["services"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
            if (s["current"]?.GetValue<string>() is { Length: > 0 } cur) _draftSignIns[s["app"]?.GetValue<string>() ?? ""] = cur;
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
            MinWidth = 640, MaxWidth = 1180, Margin = new Thickness(60, 40, 60, 40), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
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
            ToolTipService.SetToolTip(chip, (on ? "Loaded. " : "Load " + pname + "'s profiles and exclusions into the window. ") + "Right-click to rename or delete it.");
            var pj = p;
            chip.Click += (_, __) =>
            {
                _draftPicks.Clear(); _draftOff.Clear();
                // the sign-ins start from what is on now, then the preset's own (2026-09-29 review: a preset from before sign-ins loaded after one
                // with them kept the other's sign-ins in the draft)
                _draftSignIns.Clear();
                foreach (var sv in (_signInView?["services"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                    if (sv["current"]?.GetValue<string>() is { Length: > 0 } cur) _draftSignIns[sv["app"]?.GetValue<string>() ?? ""] = cur;
                foreach (var (app, c) in (pj["picks"] as JsonObject) ?? new JsonObject()) if ((c as JsonObject)?["id"]?.GetValue<string>() is { Length: > 0 } id) _draftPicks[app] = id;
                foreach (var a in (pj["off"] as JsonArray)?.OfType<JsonValue>() ?? Enumerable.Empty<JsonValue>()) _draftOff.Add(a.GetValue<string>());
                foreach (var (app, sid) in (pj["signIns"] as JsonObject) ?? new JsonObject()) if (sid?.GetValue<string>() is { Length: > 0 } id) _draftSignIns[app] = id;
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
            var ren = new MenuFlyoutItem { Text = "Rename " + pname + (char)0x2026 };
            ren.Click += async (_, __) =>
            {
                if (await AskNameAsync("Rename " + pname, "A name for this preset", pname) is not { Length: > 0 } to || to == pname) return;
                JsonObject? rr = null;
                try { rr = JsonNode.Parse(await ModelCallAsync("videoPresetRename", pid, to) ?? "null") as JsonObject; } catch (Exception e) { LogLine("preset rename: " + e.Message); }
                if (rr?["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Dot + Sentence(rr?["error"]?.GetValue<string>() ?? "could not rename " + pname)); return; }
                LogLine("profiles: preset " + pname + " renamed " + to);
                if (_triangleWho is not null && _triangleWho.Text == pname) _triangleWho.Text = to;
                await ShowProfilesWindowKeepingDraftAsync();
            };
            menu.Items.Add(ren);
            menu.Items.Add(del);
            chip.ContextFlyout = menu;
            presetRow.Children.Add(chip);
        }
        body.Children.Add(new ScrollViewer { Content = presetRow, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollMode = ScrollMode.Enabled });

        DrawServiceList(body, v);   // every service, one row each: signed in as, profile, exclude (2026-10-06)

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
            ["signIns"] = new JsonObject(_draftSignIns.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, kv.Value))),
        };
        var r = JsonNode.Parse(await ModelCallAsync("videoProfilesCommit", draft.ToJsonString()) ?? "null") as JsonObject;
        if (r?["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Dot + (r?["error"]?.GetValue<string>() ?? "could not save the profiles")); return; }
        CloseProfilesWindow();
        var who = (r["preset"] as JsonObject)?["name"]?.GetValue<string>();
        var n = (r["switched"] as JsonArray)?.Count ?? 0;
        var moved = (r["moved"] as JsonArray)?.Count ?? 0;
        if (moved > 0) { LogLine("profiles: " + moved + " service(s) moved to another sign-in"); await ReadModelAsync(); _ = UpdateWatchGripAsync(); }
        LogLine("profiles: saved" + (who is null ? "" : " as " + who) + ", " + n + " switching");
        if (_triangleWho is not null) _triangleWho.Text = who ?? "";   // the rows follow in place (the live follow); the name under the triangle now
        KickLiveRows();
        _ = FollowProfileSwitchAsync(who, n);
    }

    private const string SomeoneElse = "\u0001someone-else";
    private const string BringBack = "back:";   // a hidden sign-in offered back in the "Signed in as" list

    /// <summary>One service's "Signed in as" cell: the picker, a note under the name, and the menu to rename, hide or bring back a sign-in.</summary>
    private sealed record SignInCell(string Kind, string Name, ComboBox Pick, string Note, bool Changed, MenuFlyout? Menu);

    /// <summary>
    /// Sign-ins (2026-09-29, "if my wife wants to see her own movies and queues in Apple TV, she will need to login as herself, same with Apple
    /// Music. How do we reduce logins where possible" / "we don't yet have the concept of profiles in the music player ... Ideally it uses the
    /// same profiles set on the video side"): every service of the two players, with the sign-ins its account has on this device. An existing
    /// one is always offered first - a sign-in made for Apple TV is there for Apple Music - and "Sign in as someone else" adds one under a
    /// name. A change is part of the draft (Save & exit); a new sign-in opens the service's own sign-in page at once. Drawn as a column of the
    /// one service list since 2026-10-06 (DrawServiceList).
    /// </summary>
    private Dictionary<string, SignInCell> SignInCells()
    {
        var cells = new Dictionary<string, SignInCell>();
        foreach (var s in (_signInView?["services"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var app = s["app"]?.GetValue<string>() ?? ""; var name = s["name"]?.GetValue<string>() ?? app;
            var kind = s["kind"]?.GetValue<string>() ?? "video";
            var now = s["current"]?.GetValue<string>();
            var picked = _draftSignIns.TryGetValue(app, out var dp) ? dp : now;
            var list = (s["signIns"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
            var shares = string.Join(" and ", (s["shares"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0) ?? Array.Empty<string>());
            var changed = picked is not null && picked != now;
            var note = changed ? "changes on Save & exit" : shares.Length > 0 ? "same sign-ins as " + shares : "";
            var pick = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Center, PlaceholderText = "Signed in as" };
            foreach (var x in list) pick.Items.Add(new ComboBoxItem { Content = x["name"]?.GetValue<string>() ?? "", Tag = x["id"]?.GetValue<string>() ?? "" });
            pick.Items.Add(new ComboBoxItem { Content = "Sign in as someone else" + (char)0x2026, Tag = SomeoneElse });
            // a sign-in taken off the list is offered back here too, in plain sight (2026-09-30, "How would you bring back x")
            foreach (var h in (s["hidden"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
                if (h["id"]?.GetValue<string>() is { Length: > 0 } hid) pick.Items.Add(new ComboBoxItem { Content = "Bring back " + (h["name"]?.GetValue<string>() ?? hid), Tag = BringBack + hid });
            pick.SelectedIndex = list.FindIndex(x => x["id"]?.GetValue<string>() == picked);
            var (a2, n2) = (app, name);
            pick.SelectionChanged += (_, __) =>
            {
                if (pick.SelectedItem is not ComboBoxItem it || it.Tag is not string id) return;
                if (id == SomeoneElse) { _ = AddSignInAsync(a2, n2); return; }
                if (id.StartsWith(BringBack, StringComparison.Ordinal)) { var hid = id.Substring(BringBack.Length); _ = ShowSignInAsync(a2, hid, ((pick.SelectedItem as ComboBoxItem)?.Content as string ?? hid).Replace("Bring back ", "")); return; }
                if (_draftSignIns.TryGetValue(a2, out var had) && had == id) return;
                _draftSignIns[a2] = id;
                DrawProfilesWindow();
            };
            ToolTipService.SetToolTip(pick, "Who " + name + " is signed in as. A sign-in already on this device needs no new login. Right-click to rename the one chosen, or take it off the list.");
            // a sign-in's name is the person's to change ("Household" is only where the names begin); a sign-in can be taken off the list
            // (2026-09-30, "hide it as long as it's recoverable"): its login stays on the device, and it comes back from the same menu
            MenuFlyout? sm = null;
            var hiddenOnes = (s["hidden"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
            var pickedRow = picked is not null ? list.FirstOrDefault(x => x["id"]?.GetValue<string>() == picked) : null;
            if (pickedRow is not null || hiddenOnes.Count > 0)
            {
                sm = new MenuFlyout();
                if (pickedRow is not null && picked is not null)
                {
                    var wasName = pickedRow["name"]?.GetValue<string>() ?? picked;
                    var rn = new MenuFlyoutItem { Text = "Rename " + wasName + (char)0x2026 };
                    var pid2 = picked;
                    rn.Click += async (_, __) => await RenameSignInAsync(a2, pid2, wasName);
                    sm.Items.Add(rn);
                    var rm = new MenuFlyoutItem { Text = "Take " + wasName + " off the list" };
                    var inUse = picked == now;
                    var last = list.Count(x => x["hidden"]?.GetValue<bool>() != true) <= 1;
                    rm.IsEnabled = !inUse && !last;   // a verb that cannot act is disabled, its reason in the tooltip
                    ToolTipService.SetToolTip(rm, inUse ? wasName + " is what " + name + " is signed in as now. Choose another sign-in and save first." : last ? wasName + " is the only sign-in " + name + " has." : "Its login stays on this device. Bring it back from this menu any time.");
                    rm.Click += async (_, __) => await HideSignInAsync(a2, pid2, wasName);
                    sm.Items.Add(rm);
                }
                foreach (var h in hiddenOnes)
                {
                    var hid = h["id"]?.GetValue<string>() ?? ""; var hname = h["name"]?.GetValue<string>() ?? hid;
                    if (hid.Length == 0) continue;
                    var back = new MenuFlyoutItem { Text = "Bring back " + hname };
                    back.Click += async (_, __) => await ShowSignInAsync(a2, hid, hname);
                    sm.Items.Add(back);
                }
                pick.ContextFlyout = sm;
            }
            cells[app] = new SignInCell(kind, name, pick, note, changed, sm);
        }
        return cells;
    }

    private const double SignInColW = 220, ProfileColW = 220, ExcludeColW = 120;

    /// <summary>
    /// Every service in one list, a row each (2026-10-06, "Under the profiles window, there is Music Player, Video Player, Services, and Services
    /// without profiles. Can we get this into 1 list, 1 row per service?"): A to Z, the player named under each; Signed in as, Profile (a
    /// picker where the service has profiles) and Exclude (the Video player's services) in columns.
    /// </summary>
    private void DrawServiceList(StackPanel body, JsonObject v)
    {
        var signIns = SignInCells();
        var withProfiles = ((v["services"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>()).ToDictionary(s => s["app"]?.GetValue<string>() ?? "", s => s);
        var without = ((v["others"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>()).ToDictionary(s => s["app"]?.GetValue<string>() ?? "", s => s);
        var apps = signIns.Keys.Concat(withProfiles.Keys).Concat(without.Keys).Where(a => a.Length > 0).Distinct().ToList();
        string NameOf(string a) => signIns.TryGetValue(a, out var c) ? c.Name : withProfiles.TryGetValue(a, out var p) ? p["name"]?.GetValue<string>() ?? a : without.TryGetValue(a, out var o) ? o["name"]?.GetValue<string>() ?? a : a;
        apps = apps.OrderBy(NameOf, StringComparer.CurrentCultureIgnoreCase).ToList();

        Grid Row(double minH)
        {
            var g = new Grid { ColumnSpacing = 14, MinHeight = minH };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(36) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SignInColW) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ProfileColW) });
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ExcludeColW) });
            return g;
        }
        TextBlock Head(string text, string tip, int col, bool center = false)
        {
            var t = new TextBlock { Text = text, FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Bottom, TextAlignment = center ? TextAlignment.Center : TextAlignment.Left, HorizontalAlignment = center ? HorizontalAlignment.Center : HorizontalAlignment.Left };
            ToolTipService.SetToolTip(t, tip);
            Grid.SetColumn(t, col);
            return t;
        }
        var head = Row(0);
        head.Margin = new Thickness(0, 8, 0, 0);
        var svcHead = Head("Service", "Every service on your two players.", 1);
        head.Children.Add(svcHead);
        head.Children.Add(Head("Signed in as", "Who each service is signed in as for this person. Every sign-in stays on this device, so switching never signs anybody out.", 2));
        head.Children.Add(Head("Profile", "On Save & exit, a service whose profile changed is switched: its own " + (char)0x201C + "Who's watching?" + (char)0x201D + " page or profile menu is pressed in the background, then that person's My List and Continue Watching are read again. That takes a minute or so per service, and each profile's last rows show in the meantime.", 3));
        head.Children.Add(Head("Exclude from" + Environment.NewLine + "Continue & My List", "Leaves a service's Continue Watching and My List out of Watch for this person; it still shows in the rows below, the Library, Browse and search. Kept with the preset on Save & exit.", 4, center: true));
        body.Children.Add(head);
        body.Children.Add(new Border { Height = 1, Background = HubTabRule, Margin = new Thickness(0, -8, 0, -8) });

        foreach (var app in apps)
        {
            var name = NameOf(app);
            signIns.TryGetValue(app, out var si);
            withProfiles.TryGetValue(app, out var pv);
            var isVideo = pv is not null || without.ContainsKey(app) || si?.Kind != "music";
            var row = Row(48);
            var mark = ServiceMark(app, name, 30); mark.VerticalAlignment = VerticalAlignment.Center;
            row.Children.Add(mark);

            // the profile cell, and its note
            string profNote = ""; var profAmber = false;
            FrameworkElement? profCell = null;
            if (pv is not null)
            {
                var status = pv["status"]?.GetValue<string>() ?? "";
                var profiles = (pv["profiles"] as JsonArray)?.OfType<JsonObject>().ToList() ?? new();
                var now = (pv["current"] as JsonObject)?["id"]?.GetValue<string>();
                var picked = _draftPicks.TryGetValue(app, out var dp) ? dp : now;
                var switching = pv["switching"]?.GetValue<bool>() == true;
                var changed = picked is not null && picked != now;
                profNote = status != "signed-in" ? "not signed in" : profiles.Count == 0 ? "its profiles show once its " + (char)0x201C + "Who's watching?" + (char)0x201D + " page has been seen" : changed ? "profile changes on Save & exit" : switching ? "switching profile" + (char)0x2026 : "";
                profAmber = changed || switching || status != "signed-in";
                if (profiles.Count > 0 && status == "signed-in")
                {
                    var pick = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Center, PlaceholderText = "Who's watching?" };
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
                    profCell = pick;
                }
            }
            else profCell = new TextBlock { Text = "No profiles", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center };
            if (profCell is not null) { Grid.SetColumn(profCell, 3); row.Children.Add(profCell); }

            // the name, the player under it, and what is about to change
            var label = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            label.Children.Add(new TextBlock { Text = name, FontSize = 15, Foreground = HubInk });
            var notes = new List<string> { isVideo ? "Video player" : "Music player" };
            if (si?.Note is { Length: > 0 } sn) notes.Add(si.Note);
            if (profNote.Length > 0) notes.Add(profNote);
            label.Children.Add(new TextBlock { Text = string.Join(Dot, notes), FontSize = 12, Foreground = (si?.Changed == true || profAmber) ? HubAmber : HubDim, TextWrapping = TextWrapping.Wrap });
            Grid.SetColumn(label, 1);
            row.Children.Add(label);

            if (si is not null) { Grid.SetColumn(si.Pick, 2); row.Children.Add(si.Pick); if (si.Menu is not null) row.ContextFlyout = si.Menu; }
            if (isVideo && (pv is not null || without.ContainsKey(app)))
            {
                var ex = ExcludeBox(app, name);
                Grid.SetColumn(ex, 4);
                row.Children.Add(ex);
            }
            body.Children.Add(row);
        }
        if (apps.Count == 0) body.Children.Add(new TextBlock { Text = "No services on your players yet.", FontSize = 13, Foreground = HubInk });
    }

    /// <summary>"Sign in as someone else": a name, a new sign-in for the service's account, the service moved to it and its own sign-in page
    /// opened. The Profiles window comes back when that closes. Dev: hub.request "signin add app|name" runs the same.</summary>
    private async Task AddSignInAsync(string app, string name, string? preset = null)
    {
        var who = preset;
        // a service whose own account page shows whose account it is needs no name typed: the sign-in is named from that page once the
        // person has signed in (2026-09-29, "Instead of even naming the sign ins, can you just capture the username or likely email")
        if (who is null && AdapterShowsAccount(app)) who = "";
        if (who is null)
        {
            var loaded = (_profView?["presets"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(p => p["id"]?.GetValue<string>() == _draftPreset)?["name"]?.GetValue<string>();
            var box = new TextBox { Text = _draftName.Length > 0 ? _draftName : loaded ?? "", PlaceholderText = "A name for this sign-in", Width = 320, FontSize = 15 };
            var col = new StackPanel { Spacing = 10 };
            col.Children.Add(new TextBlock { Text = "Whose sign-in is this? You can leave the name empty and rename it later. " + name + " switches to it now and opens its sign-in page. The one it uses now stays on this device, and you can switch back any time.", TextWrapping = TextWrapping.Wrap, Foreground = HubInk, FontSize = 14, MaxWidth = 360 });
            col.Children.Add(box);
            var dlg = new ContentDialog { Title = "Sign in to " + name + " as someone else", Content = col, PrimaryButtonText = "Continue", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary, XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
            ContentDialogResult res;
            try { res = await dlg.ShowAsync(); } catch { return; }
            if (res != ContentDialogResult.Primary) { DrawProfilesWindow(); return; }
            who = box.Text?.Trim() ?? "";
        }
        JsonObject? added = null;
        try { added = JsonNode.Parse(await ModelCallAsync("signInAdd", app, who) ?? "null") as JsonObject; } catch (Exception e) { LogLine("sign-in add: " + e.Message); }
        var id = (added?["signIn"] as JsonObject)?["id"]?.GetValue<string>();
        if (added?["ok"]?.GetValue<bool>() != true || id is null) { SetPill("Prism" + Dot + (added?["error"]?.GetValue<string>() ?? "could not add the sign-in")); DrawProfilesWindow(); return; }
        var used = JsonNode.Parse(await ModelCallAsync("signInUse", app, id) ?? "null") as JsonObject;
        who = (added?["signIn"] as JsonObject)?["name"]?.GetValue<string>() ?? who;
        LogLine("sign-in: " + app + " -> " + who + " (" + id + ") " + (used?.ToJsonString() ?? "null"));
        if (used?["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Dot + "could not switch " + name + " to " + who); DrawProfilesWindow(); return; }
        _draftSignIns[app] = id;
        // the list knows the new sign-in at once (it was drawn from what the window read when it opened)
        try { if (JsonNode.Parse(await ModelCallAsync("signInsView", WelcomeEntriesJson()) ?? "null") is JsonObject fresh) _signInView = fresh; } catch { }
        try { if (JsonNode.Parse(await ModelCallAsync("videoProfilesView") ?? "null") is JsonObject pv) _profView = pv; } catch { }
        await ReadModelAsync();
        if (used["status"]?.GetValue<string>() == "signed-in") { await ShowProfilesWindowKeepingDraftAsync(); return; }   // a sign-in of that name was there already, signed in
        // the person signs in, on the service's own page; the window comes back after
        CloseProfilesWindow();
        _editorContinuations["app-setup"] = (doneId, saved) => RootGrid.DispatcherQueue.TryEnqueue(() => { var again = AfterSignInAsync(); });
        SetPill("Prism" + Dot + "Sign in to " + name);
        OpenRoute("prism://app/" + Uri.EscapeDataString(app) + "/setup?return=scene&signin=1");
    }

    private static string Sentence(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];

    /// <summary>A name asked of the person: the text typed, or null when they cancel.</summary>
    private async Task<string?> AskNameAsync(string title, string hint, string now)
    {
        var box = new TextBox { Text = now, PlaceholderText = hint, Width = 320, FontSize = 15 };
        box.SelectAll();
        var dlg = new ContentDialog { Title = title, Content = box, PrimaryButtonText = "Rename", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary, XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        try { return await dlg.ShowAsync() == ContentDialogResult.Primary ? box.Text?.Trim() ?? "" : null; } catch { return null; }
    }

    /// <summary>A sign-in renamed (core signInRename): the account's, so every service that shares it names it the same. Dev: hub.request
    /// "signin rename app|id|name" runs it with the name given.</summary>
    private async Task RenameSignInAsync(string app, string id, string was, string? to = null)
    {
        to ??= await AskNameAsync("Rename " + was, "A name for this sign-in", was);
        if (to is not { Length: > 0 } || to == was) return;
        JsonObject? r = null;
        try { r = JsonNode.Parse(await ModelCallAsync("signInRename", app, id, to) ?? "null") as JsonObject; } catch (Exception e) { LogLine("sign-in rename: " + e.Message); }
        if (r?["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Dot + Sentence(r?["error"]?.GetValue<string>() ?? "could not rename " + was)); return; }
        LogLine("sign-in: " + app + " " + id + " renamed " + to);
        await ShowProfilesWindowKeepingDraftAsync();
    }

    /// <summary>A sign-in taken off the list (core signInHide): its login is kept, untouched; never the one a service is on. Dev: hub.request "signin hide app|id".</summary>
    private async Task HideSignInAsync(string app, string id, string name)
    {
        JsonObject? r = null;
        try { r = JsonNode.Parse(await ModelCallAsync("signInHide", app, id) ?? "null") as JsonObject; } catch (Exception e) { LogLine("sign-in hide: " + e.Message); }
        if (r?["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Dot + Sentence(r?["error"]?.GetValue<string>() ?? "could not take " + name + " off the list")); return; }
        LogLine("sign-in: " + app + " " + id + " off the list");
        if (_draftSignIns.TryGetValue(app, out var drafted) && drafted == id) _draftSignIns.Remove(app);   // never saved onto a sign-in just taken off the list (review)
        SetPill("Prism" + Dot + name + " is off the list. Its login is kept; right-click a sign-in to bring it back");
        await ShowProfilesWindowKeepingDraftAsync();
    }
    /// <summary>A hidden sign-in back on the list (core signInShow). Dev: hub.request "signin show app|id".</summary>
    private async Task ShowSignInAsync(string app, string id, string name)
    {
        JsonObject? r = null;
        try { r = JsonNode.Parse(await ModelCallAsync("signInShow", app, id) ?? "null") as JsonObject; } catch (Exception e) { LogLine("sign-in show: " + e.Message); }
        if (r?["ok"]?.GetValue<bool>() != true) { SetPill("Prism" + Dot + Sentence(r?["error"]?.GetValue<string>() ?? "could not bring back " + name)); return; }
        LogLine("sign-in: " + app + " " + id + " back on the list");
        await ShowProfilesWindowKeepingDraftAsync();
    }

    /// <summary>The service's adapter names an account page (its `account`): a sign-in there is named from what that page shows.</summary>
    private bool AdapterShowsAccount(string appId)
    {
        try
        {
            if (_model.App(appId) is not { } app) return false;
            var adapter = app.Json["adapter"]?.GetValue<string>() is { Length: > 0 } named ? named : appId;
            if (Sources.AdapterPath(adapter) is not { } path) return false;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            return doc.RootElement.TryGetProperty("account", out var a) && a.ValueKind == JsonValueKind.Object;
        }
        catch { return false; }
    }

    /// <summary>The sign-in window closed: the window comes back, core is asked to name the sign-ins nobody named from their account pages,
    /// and the window is drawn again once that has had time to land.</summary>
    private async Task AfterSignInAsync()
    {
        await ShowProfilesWindowKeepingDraftAsync();
        try { LogLine("sign-ins: label " + Shorten(await ModelCallAsync("signInsLabel") ?? "null", 160)); } catch { }
        await Task.Delay(14_000);
        if (_profilesWin is not null) await ShowProfilesWindowKeepingDraftAsync();
    }

    /// <summary>The window again with what was being chosen still chosen (after a sign-in was added).</summary>
    private async Task ShowProfilesWindowKeepingDraftAsync()
    {
        var picks = new Dictionary<string, string>(_draftPicks); var off = new HashSet<string>(_draftOff); var signIns = new Dictionary<string, string>(_draftSignIns);
        var (preset, name) = (_draftPreset, _draftName);
        await ShowProfilesWindowAsync();
        foreach (var kv in picks) _draftPicks[kv.Key] = kv.Value;
        _draftOff.Clear(); foreach (var a in off) _draftOff.Add(a);
        foreach (var kv in signIns) _draftSignIns[kv.Key] = kv.Value;
        _draftPreset = preset; _draftName = name;
        DrawProfilesWindow();
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
        var moved = (r["moved"] as JsonArray)?.Count ?? 0;
        LogLine("profiles: preset " + name + " applied, " + switched + " switching, " + moved + " moved to another sign-in");
        if (moved > 0) { await ReadModelAsync(); _ = UpdateWatchGripAsync(); }
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
        // the sets are the wall's, not the Video player's alone (2026-09-29): with no service that has profiles there are still sign-ins
        if (v is null) return items;
        var active = v["active"]?.GetValue<string>();
        foreach (var p in (v["presets"] as JsonArray)?.OfType<JsonObject>() ?? Enumerable.Empty<JsonObject>())
        {
            var (pid, pname) = (p["id"]?.GetValue<string>() ?? "", p["name"]?.GetValue<string>() ?? "");
            var it = new ToggleMenuFlyoutItem { Text = pname, IsChecked = pid == active };
            ToolTipService.SetToolTip(it, "Switch every service, music and video, to " + pname + "'s sign-ins and profiles.");
            it.Click += async (_, __) => await ApplyProfilePresetAsync(pid, pname);
            items.Add(it);
        }
        var win = new MenuFlyoutItem { Text = "Profiles" + (char)0x2026, Icon = new FontIcon { Glyph = "\uE716" } };
        ToolTipService.SetToolTip(win, "Who each service is signed in as, every service's profile, and the presets that switch them all at once.");
        win.Click += (_, __) => _ = ShowProfilesWindowAsync();
        if (items.Count > 0) items.Add(new MenuFlyoutSeparator());
        items.Add(win);
        return items;
    }
}
