using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

using PrismHost.Visualizations;

namespace PrismHost;

/// <summary>
/// The Scene Template wizard (dashboard-schema §31 "Scene Templates", the
/// §6 golden path): a template names slot ROLES, never apps. Role by role:
/// catalog suggestions + "any app" → App setup in place (sign in once) →
/// the role's tuned facet for that slot class (accept, or adjust in the
/// facet editor) → next role. Never instantiable with an unresolved role
/// (core's templateCompletion; Create stays disabled). Audio defaults come
/// from the template (exactly one exclusive owner - the hero; utilities
/// mute + scroll) and are written per assignment by core's
/// instantiateTemplate. Back from any wizard screen returns to the scene.
///
/// docs/concept-scenes.md §7a adds two role shapes. A template may carry
/// HIDDEN roles (Music Lounge's music service: loaded, zero-size, the scene's
/// exclusive audio owner) and VISUALIZATION roles (its stage: it resolves to a
/// Visualization sourced to the hidden facet, never to a facet of its own).
/// The household therefore answers one question - which service - and the
/// hidden facet and the visualization are created together on the way back
/// from sign-in; the stage shows resolved the moment the source is.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>§7a: what a visualization role places - a style, an artwork mode and the hidden role that feeds it.</summary>
    private sealed record TViz(string Style, string Artwork, string Source);
    private sealed record TRole(string Id, string Label, string Class, string Kind, List<string> Suggestions, string? TunedPreset, string Audio, string Touch, TViz? Visualization);
    private sealed record TTemplate(string Id, string Name, string Blurb, string CanvasAspect, List<TRole> Roles, List<TRole> Hidden, List<(string Role, double X, double Y, double W, double H)> Slots);

    private Grid? _wizard;
    private List<TTemplate> _templates = new();
    private TTemplate? _tpl;
    private readonly Dictionary<string, string> _tplResolved = new();      // role id → facet id
    private readonly Dictionary<string, string> _tplApp = new();           // role id → App id (while the role is in progress)
    private string? _tplRole;
    private string? _tplScene;   // "Change apps…": the existing scene the wizard is answering for; Save writes into it instead of creating one
    private MLayout? _tplLayout; // custom scene: the layout the roles were made from (no core template behind them)
    private bool _tplPickLayout; // the custom-scene wizard's first step: choose a layout
    private StackPanel? _wzLeft, _wzMain;

    /// <summary>One role of a template as core published it; a malformed visualization block is dropped, never fatal (§7a).</summary>
    private static TRole ReadRole(JsonObject r)
    {
        TViz? viz = null;
        if (r["visualization"] is JsonObject vo && vo["source"]?.GetValue<string>() is { Length: > 0 } src)
            viz = new TViz(vo["style"]?.GetValue<string>() ?? "prism-beams", vo["artwork"]?.GetValue<string>() ?? "off", src);
        return new TRole(r["id"]?.GetValue<string>() ?? "", r["label"]?.GetValue<string>() ?? "", r["class"]?.GetValue<string>() ?? "", r["kind"]?.GetValue<string>() ?? "any",
            (r["suggestions"] as JsonArray)?.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0).ToList() ?? new(), r["tunedPreset"]?.GetValue<string>(),
            r["audio"]?.GetValue<string>() ?? "mute", r["touch"]?.GetValue<string>() ?? "scroll", viz);
    }

    private async Task<List<TTemplate>> ReadTemplatesAsync()
    {
        var list = new List<TTemplate>();
        var raw = await ModelCallAsync("modelTemplates");
        try
        {
            if (raw is not null && JsonNode.Parse(raw) is JsonArray arr)
                foreach (var n in arr)
                {
                    if (n is not JsonObject o) continue;
                    var roles = new List<TRole>();
                    if (o["roles"] is JsonArray ra) foreach (var rn in ra) if (rn is JsonObject r) roles.Add(ReadRole(r));
                    var hidden = new List<TRole>();
                    if (o["hidden"] is JsonArray ha) foreach (var hn in ha) if (hn is JsonObject h) hidden.Add(ReadRole(h));
                    var slots = new List<(string, double, double, double, double)>();
                    if (o["slots"] is JsonArray sa) foreach (var sn in sa) if (sn is JsonObject s && s["rect"] is JsonObject rc)
                        slots.Add((s["role"]?.GetValue<string>() ?? "", rc["x"]?.GetValue<double>() ?? 0, rc["y"]?.GetValue<double>() ?? 0, rc["w"]?.GetValue<double>() ?? 0, rc["h"]?.GetValue<double>() ?? 0));
                    list.Add(new TTemplate(o["id"]?.GetValue<string>() ?? "", o["name"]?.GetValue<string>() ?? "", o["blurb"]?.GetValue<string>() ?? "", o["canvasAspect"]?.GetValue<string>() ?? "16:9", roles, hidden, slots));
                }
        }
        catch (Exception ex) { SetStatus("templates unreadable: " + ex.Message); }
        return list;
    }

    // ------------------------------------------------ §7a: the roles the wizard walks, and what "resolved" means for each

    /// <summary>Every role of a template: the slot roles, then the hidden ones.</summary>
    private static List<TRole> WalkRoles(TTemplate t) => t.Roles.Concat(t.Hidden).ToList();

    /// <summary>The roles the household is actually asked about - a visualization role is answered by its source.</summary>
    private static List<TRole> AskableRoles(TTemplate t) => WalkRoles(t).Where(r => r.Kind != PrismHost.Core.TemplateRoles.Visualization).ToList();

    private static PrismHost.Core.TemplateRoleRef Ref(TRole r) => new(r.Id, r.Kind, r.Visualization?.Source);

    /// <summary>The visualization role this role feeds, if any (§7a: the stage is sourced to the hidden music role).</summary>
    private TRole? VisualizationRoleFor(TRole source) =>
        _tpl?.Roles.FirstOrDefault(r => r.Kind == PrismHost.Core.TemplateRoles.Visualization && r.Visualization?.Source == source.Id);

    /// <summary>Answered? A visualization role is, exactly when the hidden role it names is (core's templateCompletion).</summary>
    private bool RoleResolved(TRole r) => PrismHost.Core.TemplateRoles.IsResolved(Ref(r), _tplResolved.Keys);

    /// <summary>The still-open roles, as core would report them.</summary>
    private List<TRole> OpenRoles(TTemplate t)
    {
        var open = PrismHost.Core.TemplateRoles.Unresolved(WalkRoles(t).Select(Ref).ToList(), _tplResolved.Keys);
        return open.Select(id => WalkRoles(t).First(r => r.Id == id)).ToList();
    }

    /// <summary>Open the wizard: the template grid ("Kitchen Classic" first, as core lists them), or straight into one template.</summary>
    private async void OpenTemplateWizard(string? templateId, string? sceneId = null, string? roleId = null, string? customLayoutId = null)
    {
        await ReadModelAsync();
        _templates = await ReadTemplatesAsync();
        _tpl = templateId is null ? null : _templates.FirstOrDefault(t => t.Id == templateId);
        if (templateId is not null && _tpl is null) { SetPill("Prism · no template " + templateId); return; }
        _tplLayout = null; _tplPickLayout = false;
        if (templateId is null && customLayoutId is { Length: > 0 })
        {
            // a custom scene: the layout's slots become the roles, walked exactly like a template's
            var lay = _model.Layout(customLayoutId);
            if (lay is null) { SetPill("Prism · no layout " + customLayoutId); return; }
            _tplLayout = lay; _tpl = CustomTemplateFor(lay);
        }
        if (_tpl is not null)
        {
            _tplResolved.Clear(); _tplApp.Clear();
            // Change apps (2026-09-05 audit): re-open the wizard ON a scene it built. What the scene already
            // has answers its roles; placeholders and visualization ids stay open, exactly as the wizard asks.
            _tplScene = sceneId is { Length: > 0 } && _model.Scene(sceneId) is not null ? sceneId : null;
            if (_tplScene is { } sid0 && _model.Scene(sid0) is { } sc0)
            {
                foreach (var r in _tpl.Roles)
                    if (r.Kind != PrismHost.Core.TemplateRoles.Visualization && sc0.Assign.TryGetValue(r.Id, out var fid0) && _model.Facet(fid0) is not null) _tplResolved[r.Id] = fid0;
                for (var i = 0; i < _tpl.Hidden.Count && i < sc0.Hidden.Count; i++)
                    if (sc0.Hidden[i]["facet"]?.GetValue<string>() is { } hf0 && _model.Facet(hf0) is not null) _tplResolved[_tpl.Hidden[i].Id] = hf0;
            }
            LogLine("call {\"fn\":\"template.start\",\"template\":\"" + _tpl.Id + "\"}");
            await PreresolveFirstPartyRolesAsync();                                            // §1: the roles with nothing to decide
            var askable = AskableRoles(_tpl);
            _tplRole = (askable.FirstOrDefault(r => !_tplResolved.ContainsKey(r.Id)) ?? askable.FirstOrDefault())?.Id;
            // a deep link names the role to land on: a slot id, or hidden:N for the N-th hidden role (a stage's source)
            if (roleId is { Length: > 0 })
            {
                var want = roleId.StartsWith("hidden:") && int.TryParse(roleId.AsSpan(7), out var hn) && hn >= 0 && hn < _tpl.Hidden.Count ? _tpl.Hidden[hn].Id : roleId;
                if (WalkRoles(_tpl).Any(r => r.Id == want)) _tplRole = want;
            }
        }
        if (_wizard is null)
        {
            var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF6, 0x0F, 0x12, 0x16)) };
            Canvas.SetZIndex(overlay, 903);
            overlay.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(400) });
            overlay.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            _wzLeft = new StackPanel { Spacing = 8, Padding = new Thickness(26, 22, 18, 22) };
            overlay.Children.Add(new ScrollViewer { Content = _wzLeft, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
            _wzMain = new StackPanel { Spacing = 10, Padding = new Thickness(20, 22, 30, 22), MaxWidth = 840, HorizontalAlignment = HorizontalAlignment.Left };
            var sv = new ScrollViewer { Content = _wzMain, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            Grid.SetColumn(sv, 1);
            overlay.Children.Add(sv);
            RootGrid.Children.Add(overlay);
            _wizard = overlay;
        }
        RenderWizard();
    }

    /// <summary>
    /// App setup and the facet editor take the wall: their page lives on the tile canvas at z 0, and the
    /// wizard's opaque overlay (z 903) would sit on top of it - the rail's B-100 trap one layer up, found
    /// live on 2026-09-05 (the wizard was fully visible over youtube.com's sign-in page). The wizard steps
    /// aside while they are up; the editor continuation re-renders it when they close.
    /// </summary>
    private void StepWizardAside(bool aside) { if (_wizard is not null) _wizard.Visibility = aside ? Visibility.Collapsed : Visibility.Visible; }

    private void CloseTemplateWizard()
    {
        if (_wizard is null) return;
        RootGrid.Children.Remove(_wizard);
        _wizard = null; _wzLeft = null; _wzMain = null; _tpl = null; _tplRole = null; _tplScene = null; _tplLayout = null; _tplPickLayout = false;
        _tplResolved.Clear(); _tplApp.Clear();
    }

    private void RenderWizard()
    {
        if (_wizard is null || _wzLeft is null || _wzMain is null) return;
        _wzLeft.Children.Clear(); _wzMain.Children.Clear();
        _wzMain.MaxWidth = _tpl is null ? 1480 : 840;   // the template grid wants the room; a role panel wants a reading width
        if (_tpl is null && _tplPickLayout) { RenderLayoutPicker(); return; }
        var firstRun = _tpl is null && _model.Scenes.Count == 0;
        _wzLeft.Children.Add(new TextBlock { Text = _tplScene is { } tsid && _model.Scene(tsid) is { } tsc ? "Change apps · " + tsc.Name : firstRun ? "Welcome to Prism" : _tplLayout is not null ? "Custom scene" : "New scene", FontFamily = new FontFamily("Segoe UI Variable Display, Segoe UI"), FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        if (_tpl is null)
        {
            if (firstRun) _wzLeft.Children.Add(new TextBlock { Text = "Nothing is on the wall yet. Pick a scene below; the wizard asks only which services you use, signs you in once, and cuts everything else to fit.", FontSize = 13, Foreground = LeInk, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 6) });
            _wzLeft.Children.Add(new TextBlock { Text = "Start from a template: it names the roles a scene needs, never the apps. You pick each app, and the wizard signs you in and cuts the facet as it goes. Or build a blank scene slot by slot.", FontSize = 12, Foreground = LeDim, TextWrapping = TextWrapping.Wrap });
            _wzLeft.Children.Add(Small("Custom scene from a layout…", () => { _tplPickLayout = true; RenderWizard(); }));
            _wzLeft.Children.Add(Small("Back to the scene  (Esc)", RouteBack));
            var grid = CardGrid();
            foreach (var t in _templates)
            {
                var body = new StackPanel { Spacing = 6 };
                body.Children.Add(TemplateThumb(t, Ratio(t.CanvasAspect) is { } tr && tr < 1 ? 150 : 300));   // a portrait blueprint at 300 wide is 530 tall
                body.Children.Add(CardTitle(t.Name));
                body.Children.Add(Meta(t.Blurb));
                body.Children.Add(Meta(string.Join("  ·  ", t.Roles.Select(r => r.Label + " " + r.Class))));
                var tid = t.Id;
                grid.Children.Add(Card(body, 324, () => OpenRoute("prism://template/" + Uri.EscapeDataString(tid)), null));
            }
            _wzMain.Children.Add(grid);
            return;
        }
        var tpl = _tpl;
        _wzLeft.Children.Add(new TextBlock { Text = tpl.Name, FontSize = 15, Foreground = Amber });
        _wzLeft.Children.Add(TemplateThumb(tpl, 330, roleId => tpl.Roles.FirstOrDefault(r => r.Id == roleId) is { } tr && RoleResolved(tr) ? RoleResolvedText(tr) : roleId == _tplRole ? "◀ now" : null));
        _wzLeft.Children.Add(Section("ROLES"));
        foreach (var r in WalkRoles(tpl))
        {
            var rid = r.Id;
            var done = RoleResolved(r);
            var row = new StackPanel { Spacing = 1 };
            row.Children.Add(new TextBlock { Text = (done ? "✓  " : rid == _tplRole ? "▶  " : "○  ") + r.Label + (tpl.Hidden.Contains(r) ? "   (hidden)" : ""), FontSize = 13, Foreground = done ? LeTeal : rid == _tplRole ? Amber : LeInk });
            var line = r.Kind == PrismHost.Core.TemplateRoles.Visualization
                ? "visualization  ·  " + r.Class + "  ·  audio " + r.Audio
                : (tpl.Hidden.Contains(r) ? "hidden facet  ·  audio " + r.Audio : r.Class + "  ·  audio " + r.Audio + "  ·  touch " + r.Touch);
            row.Children.Add(new TextBlock { Text = line + (done ? "  ·  " + RoleResolvedText(r) : ""), FontSize = 10, Foreground = LeDim, TextTrimming = TextTrimming.CharacterEllipsis });
            var b = new Button { Content = row, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 6, 10, 6), Background = rid == _tplRole ? LeSlotSel : LeSlot };
            OwnHover(b);   // its own hover, never the system's (memory: hover-loss-tooltips)
            b.Click += (_, __) => { _tplRole = rid; RenderWizard(); };
            _wzLeft.Children.Add(b);
        }
        var unresolved = OpenRoles(tpl).Select(r => r.Label).ToList();
        _wzLeft.Children.Add(Section(_tplScene is null ? "CREATE" : "SAVE"));
        var create = Primary(_tplScene is null ? "Create scene" : "Save to this scene", () => _ = _tplScene is null ? (_tplLayout is null ? CreateFromTemplateAsync() : CreateCustomSceneAsync()) : SaveToSceneAsync());
        // a custom scene may be created with slots still empty: they show as tappable Empty slots on the wall
        create.IsEnabled = unresolved.Count == 0 || _tplLayout is not null;
        ToolTipService.SetToolTip(create, unresolved.Count == 0 ? "Every role is resolved: the layout and the scene are created and the wall becomes the scene." : "Not yet: " + string.Join(", ", unresolved) + " still unresolved (a template is never instantiable with an open role).");
        _wzLeft.Children.Add(create);
        _wzLeft.Children.Add(Meta(unresolved.Count == 0 ? (_tplScene is not null ? "Every role answered. Save writes them into this scene and the wall becomes it." : "All roles resolved. Name defaults to \"" + tpl.Name + "\".") : unresolved.Count + " role" + (unresolved.Count == 1 ? "" : "s") + " to go: " + string.Join(", ", unresolved)));
        _wzLeft.Children.Add(Small("Back to the scene  (Esc)", RouteBack));

        var role = WalkRoles(tpl).FirstOrDefault(r => r.Id == _tplRole);
        if (role is null) return;
        RenderRolePanel(role);
    }

    private string ResolvedText(string roleId)
    {
        if (!_tplResolved.TryGetValue(roleId, out var fid)) return "";
        var f = _model.Facet(fid);
        return f is null ? fid : (_model.App(f.App)?.Name ?? f.App) + " · " + f.Label;
    }

    /// <summary>What a resolved role shows: the facet it became, or - for a visualization role - the style and the source it draws from.</summary>
    private string RoleResolvedText(TRole role)
    {
        if (role.Kind != PrismHost.Core.TemplateRoles.Visualization) return ResolvedText(role.Id);
        if (role.Visualization is not { } v) return "";
        return StyleName(v.Style) + " · " + v.Artwork + " · from " + ResolvedText(v.Source);
    }

    /// <summary>A visualization pack by its human name (§32) - the twenty shipped packs and any community pack the host loaded.</summary>
    private static string StyleName(string style) => StylePacks.All().FirstOrDefault(p => p.Id == style)?.Name ?? style;

    private static Canvas TemplateThumb(TTemplate t, double width, Func<string, string?>? text = null)
    {
        var ratio = Ratio(t.CanvasAspect) ?? 16 / 9.0;
        var height = width / ratio;
        var c = new Canvas { Width = width, Height = height, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x0B, 0x0D, 0x12)) };
        foreach (var (roleId, x, y, w, h) in t.Slots)
        {
            var role = t.Roles.FirstOrDefault(r => r.Id == roleId);
            var box = new Border { Width = Math.Max(2, w * width - 2), Height = Math.Max(2, h * height - 2), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xF0, 0xA8, 0x3C)), BorderBrush = Amber, BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(3) };
            var col = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            col.Children.Add(new TextBlock { Text = role?.Label ?? roleId, FontSize = 11, Foreground = LeInk, HorizontalAlignment = HorizontalAlignment.Center });
            if (h * height > 30) col.Children.Add(new TextBlock { Text = role?.Class ?? "", FontSize = 9, Foreground = LeDim, HorizontalAlignment = HorizontalAlignment.Center, FontFamily = new FontFamily("Consolas") });
            if (text?.Invoke(roleId) is { } tx && h * height > 44) col.Children.Add(new TextBlock { Text = tx, FontSize = 9, Foreground = LeTeal, HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, MaxWidth = Math.Max(20, w * width - 8) });
            box.Child = col;
            Canvas.SetLeft(box, x * width + 1); Canvas.SetTop(box, y * height + 1);
            c.Children.Add(box);
        }
        return c;
    }

    // ------------------------------------------------ one role: suggestions + any app → setup → the tuned facet
    private void RenderRolePanel(TRole role)
    {
        if (_wzMain is null) return;
        var main = _wzMain;
        main.Children.Add(new TextBlock { Text = role.Label + "   ·   " + role.Class, FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        main.Children.Add(new TextBlock
        {
            Text = role.Kind switch
            {
                "video-hero" => "The scene's one audio owner (exclusive). Pick the video service you subscribe to; sign in once in setup mode; the facet is cut for the hero slot with keep-presentation on.",
                "news" => "A headline river cut for the ticker strip. The default shelf is derived, not curated - sources rated generally reliable on Wikipedia's Perennial Sources - and any URL is always addable.",
                "music" => "A hidden music facet: it supplies the audio and the Media Session state, and it is this scene's exclusive owner. It never takes a slot - what shows is the visualization. Sign in once, here in the tile: the Widevine-audio POC found no capability reason to hand music off to a browser window (docs/reports/music-webview2-poc.md).",
                "visualization" => "A visualization, not an app: it draws what the hidden music facet is playing. Nothing to pick - it is created with the facet, sourced to it, the moment you have chosen the service.",
                _ => "A utility: muted, scrolls. Pick the app; sign in if it needs it; the facet is cut for " + role.Class + " from the role's tuned preset.",
            },
            FontSize = 12, Foreground = LeDim, TextWrapping = TextWrapping.Wrap,
        });
        if (role.Kind == PrismHost.Core.TemplateRoles.Visualization) { RenderVisualizationRolePanel(role); return; }
        if (_tplResolved.TryGetValue(role.Id, out var facetId))
        {
            main.Children.Add(Section("RESOLVED"));
            var f = _model.Facet(facetId);
            main.Children.Add(new TextBlock { Text = "✓  " + ResolvedText(role.Id) + (f is null ? "" : "   ·   " + f.SlotClass), FontSize = 14, Foreground = LeTeal });
            // §1: say so when Prism filled this in rather than the household choosing it.
            if (role.Suggestions.Count == 1 && _catalog.FirstOrDefault(c => c.Id == role.Suggestions[0]) is { } fp
                && !PrismHost.Core.TemplateRoles.NeverPreresolved(role.Kind)
                && PrismHost.Core.FirstPartyRole.IsPreresolvable(role.Suggestions, fp.Json))
                main.Children.Add(Meta("Filled in for you: " + fp.Name + " is part of Prism - there is nothing to sign in to. Change it below if you would rather use something else."));
            if (VisualizationRoleFor(role) is { } fed && fed.Visualization is { } fv)
                main.Children.Add(Meta("Hidden in this scene - loaded, zero-size, in audio focus - with " + fed.Label + " showing it as a " + StyleName(fv.Style) + " visualization sourced to it."));
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            if (f is not null) row.Children.Add(Small("Adjust in the facet editor…", () => { _editorContinuations["facet"] = (id, saved) => { if (saved && id is not null) _tplResolved[role.Id] = id; _ = ReadModelAsync().ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(RenderWizard)); }; OpenRoute("prism://facet/" + Uri.EscapeDataString(f.Id) + "/edit"); }));
            row.Children.Add(Small("Choose a different app", () => { _tplResolved.Remove(role.Id); _tplApp.Remove(role.Id); RenderWizard(); }));
            var next = NextRole(role.Id);
            if (next is not null) row.Children.Add(Primary("Next role: " + next.Label + " →", () => { _tplRole = next.Id; RenderWizard(); }));
            main.Children.Add(row);
            return;
        }
        if (_tplApp.TryGetValue(role.Id, out var appId) && _model.App(appId) is { } app)
        {
            RenderFacetProposal(role, app);
            return;
        }
        main.Children.Add(Section("SUGGESTIONS"));
        var chips = CardGrid();
        foreach (var sug in role.Suggestions)
        {
            var entry = _catalog.FirstOrDefault(c => c.Id == sug);
            var known = _model.App(sug);
            var b = new Button { Content = (entry?.Name ?? known?.Name ?? sug) + (entry?.Badge is { Length: > 0 } bd ? "  ·  " + bd : "") + (known is not null ? "  ·  " + StatusWord(known) : ""), Padding = new Thickness(12, 8, 12, 8) };
            if (entry is null && known is null) { b.IsEnabled = false; ToolTipService.SetToolTip(b, "Not in this catalog yet (the adapter repo adds it); use Any app below."); }
            else b.Click += (_, __) => _ = ChooseAppForRoleAsync(role, entry, known?.Id);
            chips.Children.Add(b);
        }
        if (role.Kind == "news")
        {
            var shelf = Primary("Choose from the news shelf…", () => OpenNewsPicker(role.Class, entry => _ = ResolveNewsRoleAsync(role, entry)));
            chips.Children.Add(shelf);
        }
        var any = new Button { Content = "Any app…", Padding = new Thickness(12, 8, 12, 8) };
        ToolTipService.SetToolTip(any, "Every catalog entry, every App you already have, or any URL");
        any.Click += async (_, __) =>
        {
            var id = await PickAppAsync(role.Label + " - which App?");
            if (id is not null) await ChooseAppForRoleAsync(role, _catalog.FirstOrDefault(c => c.Id == (_model.App(id)?.CatalogRef ?? "")), id);
        };
        chips.Children.Add(any);
        main.Children.Add(chips);
        if (_model.Apps.Count > 0)
        {
            main.Children.Add(Section("YOUR APPS"));
            var mine = CardGrid();
            foreach (var a in _model.Apps.OrderBy(x => x.Name))
            {
                var aid = a.Id;
                var b = new Button { Content = a.Name + "  ·  " + StatusWord(a), Padding = new Thickness(12, 8, 12, 8) };
                b.Click += (_, __) => _ = ChooseAppForRoleAsync(role, _catalog.FirstOrDefault(c => c.Id == (a.CatalogRef ?? "")), aid);
                mine.Children.Add(b);
            }
            main.Children.Add(mine);
        }
    }

    /// <summary>
    /// §7a: a visualization role is never picked for - it is resolved by its
    /// source. The panel says what it will be and, once the source is chosen,
    /// what it became; the only actions are the ones that change the source.
    /// </summary>
    private void RenderVisualizationRolePanel(TRole role)
    {
        if (_wzMain is null || _tpl is null || role.Visualization is not { } viz) return;
        var main = _wzMain;
        var source = WalkRoles(_tpl).FirstOrDefault(r => r.Id == viz.Source);
        var done = RoleResolved(role);
        main.Children.Add(Section(done ? "RESOLVED" : "SOURCE"));
        var card = new StackPanel { Spacing = 6, Padding = new Thickness(14), Background = LeSlot, CornerRadius = new CornerRadius(8) };
        card.Children.Add(new TextBlock { Text = StyleName(viz.Style) + " · artwork " + viz.Artwork + "   ·   " + role.Class, FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = done ? LeTeal : LeInk });
        card.Children.Add(Meta(done
            ? "Sourced to " + ResolvedText(viz.Source) + " - the hidden facet, this scene's audio. Tap the wall to reveal its player; tap again to send it back."
            : "Waiting on " + (source?.Label ?? viz.Source) + ". Choose the service and this is created with it, sourced to it - no second decision."));
        card.Children.Add(Meta("Audio " + role.Audio + "  ·  touch " + role.Touch + " - the template's defaults, written per assignment."));
        main.Children.Add(card);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (source is not null)
            row.Children.Add(done
                ? Small("Choose a different service", () => { _tplResolved.Remove(source.Id); _tplApp.Remove(source.Id); _tplRole = source.Id; RenderWizard(); })
                : Primary("Choose the service: " + source.Label + " →", () => { _tplRole = source.Id; RenderWizard(); }));
        var next = NextRole(role.Id);
        if (next is not null) row.Children.Add(Small("Next role: " + next.Label + " →", () => { _tplRole = next.Id; RenderWizard(); }));
        main.Children.Add(row);
        main.Children.Add(Meta("The style and the artwork mode are the template's; change them in the scene builder afterwards (Visualizations), where the four packs and off / backdrop / focal live."));
    }

    private TRole? NextRole(string afterId)
    {
        if (_tpl is null) return null;
        var roles = AskableRoles(_tpl);
        if (roles.Count == 0) return null;
        var idx = roles.FindIndex(r => r.Id == afterId);
        for (var i = 1; i <= roles.Count; i++)
        {
            var r = roles[((idx < 0 ? 0 : idx) + i) % roles.Count];
            if (!_tplResolved.ContainsKey(r.Id)) return r;
        }
        return null;
    }

    /// <summary>An app for the role: the App record (from the catalog entry or an existing App), then setup mode in place; the facet proposal follows on return.</summary>
    /// <summary>
    /// docs/concept-scenes.md §1: a role whose suggestions are a single
    /// first-party App (catalog `account: "none"` - nothing to sign in to) is
    /// pre-filled, so Family Hub's six roles are four real decisions and
    /// Kitchen Command's five are four. The App is created if it is missing and
    /// the role's tuned facet is cut exactly as "Use this facet" would cut it;
    /// an existing compatible facet is reused rather than duplicated.
    ///
    /// Never final: the resolved card still offers "Choose a different app",
    /// and a role with a real choice (two suggestions, or an App that can be
    /// signed into) is always asked about.
    /// </summary>
    private async Task<int> PreresolveFirstPartyRolesAsync()
    {
        if (_tpl is null) return 0;
        var filled = 0;
        foreach (var role in WalkRoles(_tpl))
        {
            if (_tplResolved.ContainsKey(role.Id)) continue;
            // §2.5.1: a hidden music role is never pre-resolved - it needs a
            // sign-in - and a visualization role is not an App question at all.
            if (PrismHost.Core.TemplateRoles.NeverPreresolved(role.Kind)) continue;
            var entry = role.Suggestions.Count == 1 ? _catalog.FirstOrDefault(c => c.Id == role.Suggestions[0]) : null;
            if (entry is null || !PrismHost.Core.FirstPartyRole.IsPreresolvable(role.Suggestions, entry.Json)) continue;

            var appId = _model.App(entry.Id)?.Id ?? await SaveAppFromCatalogAsync(entry);
            if (appId is null) continue;                                  // could not add it: the role stays a question
            await ReadModelAsync();
            if (_model.App(appId) is not { } app) continue;

            var reuse = _model.Facets
                .Where(f => f.App == app.Id && !f.Music && FacetFits(f.SlotClass, role.Class).Ok)
                .OrderBy(f => FacetFits(f.SlotClass, role.Class).Match == "exact" ? 0 : 1)
                .FirstOrDefault();
            var facetId = reuse?.Id;
            if (facetId is null)
            {
                var (presetId, presetLabel, selector, url, zoom) = TunedPreset(app, role);
                facetId = await SaveTunedFacetAsync(role, app, presetId, presetLabel, selector, url, zoom);
            }
            if (facetId is null) continue;
            _tplResolved[role.Id] = facetId;
            filled++;
            LogLine("call {\"fn\":\"template.preresolve\",\"role\":\"" + role.Id + "\",\"app\":\"" + app.Id + "\",\"facet\":\"" + facetId + "\"}");
        }
        return filled;
    }

    private async Task ChooseAppForRoleAsync(TRole role, HostCatalogEntry? entry, string? existingAppId)
    {
        var appId = existingAppId ?? (entry is null ? null : await SaveAppFromCatalogAsync(entry));
        if (appId is null) { SetPill("Prism · could not add that App"); return; }
        _tplApp[role.Id] = appId;
        await ReadModelAsync();
        _editorContinuations["app-setup"] = (id, saved) => _ = ReadModelAsync().ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(RenderWizard));
        RenderWizard();
        OpenRoute("prism://app/" + Uri.EscapeDataString(appId) + "/setup?return=scene&signin=1");   // the sign-in wizard: straight to the sign-in page, the probe decides
    }

    /// <summary>The role's tuned facet for its slot class: the catalog preset named by the role (by NAME, resolved against the adapter's selector table) or the App's home page.</summary>
    private void RenderFacetProposal(TRole role, MApp app)
    {
        if (_wzMain is null) return;
        var main = _wzMain;
        main.Children.Add(Section("APP"));
        var appRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        appRow.Children.Add(new TextBlock { Text = app.Name, FontSize = 15, Foreground = LeInk, VerticalAlignment = VerticalAlignment.Center });
        appRow.Children.Add(StatusBadgeFor(app));
        appRow.Children.Add(Small("Setup mode (sign in)…", () => { _editorContinuations["app-setup"] = (id, saved) => _ = ReadModelAsync().ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(RenderWizard)); OpenRoute("prism://app/" + Uri.EscapeDataString(app.Id) + "/setup?return=scene&signin=1"); }));
        appRow.Children.Add(Small("Different app", () => { _tplApp.Remove(role.Id); RenderWizard(); }));
        main.Children.Add(appRow);

        var wantsMusic = role.Kind == PrismHost.Core.TemplateRoles.Music;
        main.Children.Add(Section(wantsMusic ? "HIDDEN MUSIC FACET" : "FACET FOR " + role.Class.ToUpperInvariant()));
        // §32: a music role reuses only music facets, and no other role ever offers one.
        var existing = _model.Facets.Where(f => f.App == app.Id && f.Music == wantsMusic && FacetFits(f.SlotClass, role.Class).Ok).OrderBy(f => FacetFits(f.SlotClass, role.Class).Match == "exact" ? 0 : 1).ToList();
        foreach (var f in existing)
        {
            var fid = f.Id;
            var fit = FacetFits(f.SlotClass, role.Class);
            main.Children.Add(AppRow("Use " + f.Label, f.SlotClass + (fit.Note is { } n ? "  ·  " + n : "  ·  exact class") + "  ·  " + Shorten(f.Url, 50), () => { _tplResolved[role.Id] = fid; _tplApp.Remove(role.Id); LogLine("call {\"fn\":\"template.resolve\",\"role\":\"" + role.Id + "\",\"facet\":\"" + fid + "\"}"); AdvanceWizard(role); }));
        }
        var (presetId, presetLabel, selector, url, zoom) = TunedPreset(app, role);
        var card = new StackPanel { Spacing = 6, Padding = new Thickness(14), Background = LeSlot, CornerRadius = new CornerRadius(8) };
        card.Children.Add(new TextBlock { Text = app.Name + " · " + presetLabel + "   ·   " + role.Class, FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        card.Children.Add(Meta(url + (selector is not null ? "   ·   region: " + presetId + " (adapter selector by name)" : "   ·   whole page") + (zoom != 1 ? $"   ·   zoom {zoom:0.##}×" : "")));
        card.Children.Add(Meta("Audio " + role.Audio + "  ·  touch " + role.Touch + (role.Kind == "video-hero" ? "  ·  keep presentation on" : "") + " - the template's defaults, written per assignment."));
        if (wantsMusic && VisualizationRoleFor(role) is { } vizRole && vizRole.Visualization is { } vz)
            card.Children.Add(Meta("It goes into the scene HIDDEN - loaded, zero-size, in audio focus - and " + vizRole.Label + " is created with it as a " + StyleName(vz.Style) + " visualization sourced to it. One step, not two."));
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(Primary(wantsMusic ? "Use this facet & make the visualization" : "Use this facet", () => _ = AcceptProposalAsync(role, app, presetId, presetLabel, selector, url, zoom, adjust: false)));
        row.Children.Add(Small("Adjust in the facet editor…", () => _ = AcceptProposalAsync(role, app, presetId, presetLabel, selector, url, zoom, adjust: true)));
        card.Children.Add(row);
        main.Children.Add(card);
        main.Children.Add(Meta("A facet is one face of the App cut for the slot class: page + region + zoom. Different pages are different facets; the App's sign-in is shared by all of them."));
    }

    /// <summary>The catalog preset the role names (`tunedPreset`), else the first named preset, else the home page; selector resolved by name in the adapter table.</summary>
    private (string PresetId, string Label, string? Selector, string Url, double Zoom) TunedPreset(MApp app, TRole role)
    {
        var entry = app.CatalogRef is { } cref ? _catalog.FirstOrDefault(c => c.Id == cref) : null;
        var url = app.BaseUrl; var zoom = 1.0;
        string presetId = "home", label = "Home"; string? selectorName = null;
        if (entry is not null)
        {
            try
            {
                using var doc = JsonDocument.Parse(entry.Json);
                var r = doc.RootElement;
                if (r.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String) url = u.GetString() ?? url;
                if (r.TryGetProperty("zoom", out var z) && z.ValueKind == JsonValueKind.Number) zoom = z.GetDouble();
                if (r.TryGetProperty("focusPresets", out var fp) && fp.ValueKind == JsonValueKind.Array)
                {
                    JsonElement? pick = null;
                    foreach (var p in fp.EnumerateArray()) if (role.TunedPreset is { } tp && p.TryGetProperty("id", out var pid) && pid.GetString() == tp) pick = p;
                    if (pick is null) foreach (var p in fp.EnumerateArray()) if (p.TryGetProperty("selector", out var sel) && sel.ValueKind == JsonValueKind.String) { pick = p; break; }
                    if (pick is { } pe)
                    {
                        presetId = pe.TryGetProperty("id", out var pid2) ? pid2.GetString() ?? presetId : presetId;
                        label = pe.TryGetProperty("label", out var pl) ? pl.GetString() ?? label : label;
                        selectorName = pe.TryGetProperty("selector", out var ps) && ps.ValueKind == JsonValueKind.String ? ps.GetString() : null;
                    }
                }
            }
            catch { }
        }
        string? selector = null;
        if (selectorName is not null && app.Adapter is { } ad && SelectorTableJson(ad) is { } table)
        {
            try { using var t = JsonDocument.Parse(table); if (t.RootElement.TryGetProperty(selectorName, out var css) && css.ValueKind == JsonValueKind.String) selector = css.GetString(); }
            catch { }
            selector ??= selectorName.Contains(' ') || selectorName.Contains('.') || selectorName.Contains('#') ? selectorName : null;
        }
        return (presetId, label, selector, url, zoom);
    }

    /// <summary>Cut the role's facet from the tuned preset and save it - the one place a template's facet is written, so the wizard's proposal and §1 pre-resolution produce the same facet.</summary>
    private async Task<string?> SaveTunedFacetAsync(TRole role, MApp app, string presetId, string label, string? selector, string url, double zoom)
    {
        var classSlug = role.Class.Replace(":", "x").Replace("·", "-").Replace("-ticker", "").Replace("-strip", "");
        var id = app.Id + "-" + presetId + "-" + classSlug;
        for (var n = 2; _model.Facet(id) is not null; n++) id = app.Id + "-" + presetId + "-" + classSlug + "-" + n;
        var facet = new JsonObject { ["id"] = id, ["app"] = app.Id, ["url"] = url, ["slotClass"] = role.Class, ["label"] = label, ["audio"] = role.Audio, ["touch"] = role.Touch };
        if (selector is not null) facet["focus"] = new JsonObject { ["selector"] = selector, ["pad"] = 8 };
        if (Math.Abs(zoom - 1) > 0.001) facet["zoom"] = zoom;
        if (role.Kind == "music") facet["music"] = true;
        var raw = await ModelCallAsync("modelSaveFacet", facet);
        if (raw is null || !raw.Contains("\"ok\":true")) { SetPill("Prism · facet not saved" + (raw is null ? "" : ": " + Shorten(raw, 80))); return null; }
        await ReadModelAsync();
        return id;
    }

    private async Task AcceptProposalAsync(TRole role, MApp app, string presetId, string label, string? selector, string url, double zoom, bool adjust)
    {
        var id = await SaveTunedFacetAsync(role, app, presetId, label, selector, url, zoom);
        if (id is null) return;
        _tplResolved[role.Id] = id;
        _tplApp.Remove(role.Id);
        if (adjust)
        {
            _editorContinuations["facet"] = (fid, saved) => { if (saved && fid is not null) _tplResolved[role.Id] = fid; _ = ReadModelAsync().ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => AdvanceWizard(role))); };
            RenderWizard();
            OpenRoute("prism://facet/" + Uri.EscapeDataString(id) + "/edit");
            return;
        }
        AdvanceWizard(role);
    }

    private void AdvanceWizard(TRole role)
    {
        var next = NextRole(role.Id);
        // nothing left to ask: land on the visualization this role just fed, so
        // the household sees what its one decision produced (§7a).
        _tplRole = next?.Id ?? VisualizationRoleFor(role)?.Id ?? role.Id;
        RenderWizard();
    }

    /// <summary>The news role from the derived shelf: the entry becomes an App (its own profile) and a ticker-class facet.</summary>
    private async Task ResolveNewsRoleAsync(TRole role, NewsEntry entry)
    {
        var appId = _model.App(entry.Id)?.Id;
        if (appId is null)
        {
            var app = new JsonObject { ["id"] = entry.Id, ["name"] = entry.Name, ["baseUrl"] = entry.Url, ["profileId"] = entry.Id, ["setup"] = new JsonObject { ["status"] = "unknown" }, ["render"] = new JsonObject { ["audio"] = "mute" } };
            var raw = await ModelCallAsync("modelSaveApp", app);
            if (raw is null || !raw.Contains("\"ok\":true")) { SetPill("Prism · could not add " + entry.Name); return; }
            appId = entry.Id;
            await ReadModelAsync();
        }
        _tplApp[role.Id] = appId;
        RenderWizard();
    }

    // ------------------------------------------------ custom scene: a layout's slots walked like a template's roles
    /// <summary>
    /// A template synthesised from a layout. Each slot is a role: its class decides the kind - an XL
    /// wide slot is a video hero (the services, exclusive audio, keep-presentation), a ticker strip is
    /// news (the shelf), anything else is a utility (Any app… and the household's own Apps). No hidden
    /// roles, no visualization: those are the builder's, after.
    /// </summary>
    private TTemplate CustomTemplateFor(MLayout l)
    {
        var roles = new List<TRole>(); var slots = new List<(string, double, double, double, double)>();
        var heroGiven = false;
        foreach (var s in l.Slots)
        {
            var cls = s.Class ?? "";
            var aspect = cls.Split('·')[0]; var tier = cls.Contains('·') ? cls.Split('·')[1] : "";
            var label = string.IsNullOrWhiteSpace(s.Label) ? char.ToUpperInvariant(s.Id[0]) + s.Id[1..].Replace('-', ' ') : s.Label!;
            TRole role;
            if (aspect.EndsWith("-ticker"))
                role = new TRole(s.Id, label, cls, "news", new(), "headline-river", "mute", "scroll", null);
            else if (tier == "XL" && aspect is "16:9" or "4:3" or "3:2" or "21:9")
            {
                role = new TRole(s.Id, label, cls, "video-hero", new() { "netflix", "hulu", "youtube", "twitch" }, null, heroGiven ? "mute" : "exclusive", "full", null);
                heroGiven = true;
            }
            else role = new TRole(s.Id, label, cls, "any", new(), null, "mute", "scroll", null);
            roles.Add(role);
            slots.Add((s.Id, s.X, s.Y, s.W, s.H));
        }
        return new TTemplate("custom:" + l.Id, l.Name, "A scene on your own layout: one app per slot, walked the way a template is.", l.CanvasAspect, roles, new(), slots);
    }

    /// <summary>Step one of the custom-scene wizard: which layout. The household's layouts, or draw one (the layout editor returns here).</summary>
    private void RenderLayoutPicker()
    {
        if (_wzLeft is null || _wzMain is null) return;
        _wzLeft.Children.Add(new TextBlock { Text = "Custom scene", FontFamily = new FontFamily("Segoe UI Variable Display, Segoe UI"), FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        _wzLeft.Children.Add(new TextBlock { Text = "Pick the layout first. Every slot then becomes a question (which app goes here?) answered the way a template's roles are, with a service, a sign-in and a facet cut to the slot. Slots you skip stay empty and tappable on the wall.", FontSize = 12, Foreground = LeDim, TextWrapping = TextWrapping.Wrap });
        _wzLeft.Children.Add(Small("Templates instead…", () => { _tplPickLayout = false; RenderWizard(); }));
        _wzLeft.Children.Add(Small("Build it by hand in the scene builder…", () => { CloseTemplateWizard(); OpenSceneBuilder(null); }));
        _wzLeft.Children.Add(Small("Back to the scene  (Esc)", RouteBack));
        _wzMain.Children.Add(Section("YOUR LAYOUTS"));
        var grid = CardGrid();
        foreach (var l in _model.Layouts.Where(x => !x.Archived).OrderBy(x => x.Name))
        {
            var body = new StackPanel { Spacing = 6 };
            body.Children.Add(LayoutThumb(l, l.Portrait ? 112 : 220, s => (new SolidColorBrush(Windows.UI.Color.FromArgb(0x40, 0xF0, 0xA8, 0x3C)), s.Label ?? s.Class)));
            body.Children.Add(CardTitle(l.Name));
            body.Children.Add(Meta(l.CanvasAspect + " · " + l.CanvasResolution + "  ·  " + l.Slots.Count + " slot" + (l.Slots.Count == 1 ? "" : "s") + "  ·  " + string.Join(", ", l.Slots.Select(s => s.Class).Distinct())));
            var lid = l.Id;
            grid.Children.Add(Card(body, 244, () => OpenRoute("prism://templates?layout=" + Uri.EscapeDataString(lid)), null));
        }
        var draw = new StackPanel { Spacing = 6, MinHeight = 120, VerticalAlignment = VerticalAlignment.Center };
        draw.Children.Add(new TextBlock { Text = "＋", FontSize = 30, Foreground = Amber, HorizontalAlignment = HorizontalAlignment.Center });
        draw.Children.Add(CardTitle("Draw a new layout…"));
        draw.Children.Add(Meta("The layout editor opens; when you save, the wizard continues on it."));
        grid.Children.Add(Card(draw, 244, () =>
        {
            _editorContinuations["layout"] = (id, saved) => RootGrid.DispatcherQueue.TryEnqueue(() => { if (saved && id is not null) OpenRoute("prism://templates?layout=" + Uri.EscapeDataString(id)); else RenderWizard(); });
            OpenRoute("prism://layouts/new");
        }, null));
        _wzMain.Children.Add(grid);
    }

    /// <summary>Create the custom scene: assignments + the role defaults as per-slot settings, saved through modelSaveScene, then the wall becomes it.</summary>
    private async Task CreateCustomSceneAsync()
    {
        if (_tpl is null || _tplLayout is null) return;
        var tpl = _tpl; var lay = _tplLayout;
        var suggested = lay.Name;
        for (var n = 2; _model.Scenes.Any(s => s.Name == suggested); n++) suggested = lay.Name + " " + n;
        var name = await PromptTextAsync("Name the scene", suggested, suggested, "Create");
        if (name is null) return;
        var s = new MScene { Id = "", Name = name, Layout = lay.Id };
        foreach (var role in tpl.Roles)
        {
            if (!_tplResolved.TryGetValue(role.Id, out var fid)) continue;
            s.Assign[role.Id] = fid;
            var st = new JsonObject { ["audio"] = role.Audio, ["touch"] = role.Touch };
            if (role.Kind == "video-hero") { st["keepPresentation"] = true; st["tapAction"] = "promote"; }
            s.Settings[role.Id] = st;
        }
        var raw = await ModelCallAsync("modelSaveScene", s.ToJson());
        string? id = null;
        try { if (raw is not null && JsonNode.Parse(raw) is JsonObject r && r["ok"]?.GetValue<bool>() == true) id = (r["value"] as JsonObject)?["id"]?.GetValue<string>(); } catch { }
        if (id is null) { SetPill("Prism · could not create the scene"); return; }
        LogLine("call {\"fn\":\"template.custom\",\"scene\":\"" + id + "\",\"layout\":\"" + lay.Id + "\"}");
        await ReadModelAsync();
        if (await ApplySceneAsync(id)) RouteBack();
    }

    // ------------------------------------------------ the music-service modal (2026-09-06): pick, sign in if needed, done - no wizard screen
    /// <summary>
    /// Right-click the stage → Change the music service… → this dialog. The services the template
    /// suggests (plus Any app…); picking one adds the App from the catalog if needed, runs the sign-in
    /// wizard when the App is not verified signed in, cuts the role's tuned facet, writes it into the
    /// scene's hidden role and the stage's source, and applies the scene. The template wizard is not shown.
    /// </summary>
    /// <summary>
    /// The music service modal (2026-09-06), and since 2026-09-07 also "Add a music service": with <paramref name="add"/>
    /// the pick becomes a SECOND hidden source in the scene (its own profile, its own sign-in), listed under its own
    /// heading in Quick play; the stage keeps drawing the current service until a pick moves it (the visual follows
    /// the music). Without it, the pick replaces the scene's music role as before.
    /// </summary>
    /// <summary>A catalog entry is a music service when its adapter declares the media-session capability. The catalog names no
    /// adapter for the music services (core binds one by the page's host), so the adapter is found by the entry's id, else by
    /// its URL's host against the shipped adapters' match lists (2026-09-09: the first cut looked only at a field that is empty).</summary>
    private static List<(string id, string[] hosts, bool mediaSession)>? _adapterIndex;
    private static bool EntryIsMusicService(HostCatalogEntry entry)
    {
        try
        {
            if (_adapterIndex is null)
            {
                _adapterIndex = new();
                    foreach (var f in Sources.Adapters.Values.Select(e => e.Path))
                    {
                        using var doc = JsonDocument.Parse(File.ReadAllText(f));
                        var r = doc.RootElement;
                        var hosts = r.TryGetProperty("match", out var m) && m.ValueKind == JsonValueKind.Array ? m.EnumerateArray().Select(x => x.GetString() ?? "").ToArray() : Array.Empty<string>();
                        var speaks = r.TryGetProperty("capabilities", out var caps) && caps.ValueKind == JsonValueKind.Array && caps.EnumerateArray().Any(c => c.GetString() == "media-session");
                        _adapterIndex.Add((Path.GetFileNameWithoutExtension(f), hosts, speaks));
                    }
            }
            var byName = _adapterIndex.FirstOrDefault(a => a.id.Equals(entry.Adapter, StringComparison.OrdinalIgnoreCase) || a.id.Equals(entry.Id, StringComparison.OrdinalIgnoreCase));
            if (byName.id is not null) return byName.mediaSession;
            var host = Uri.TryCreate(entry.Url, UriKind.Absolute, out var u) ? u.Host : "";
            return host.Length > 0 && _adapterIndex.Any(a => a.mediaSession && a.hosts.Any(h => host.Equals(h, StringComparison.OrdinalIgnoreCase) || host.EndsWith("." + h, StringComparison.OrdinalIgnoreCase)));
        }
        catch { return false; }
    }

    private async Task ChangeMusicServiceAsync(string tileId, bool add = false)
    {
        await ReadModelAsync();
        if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } scene) { SetPill("Prism · no active scene"); return; }
        var tplId = TemplateOfScene(scene);
        _templates = await ReadTemplatesAsync();
        var tpl = tplId is null ? null : _templates.FirstOrDefault(t => t.Id == tplId);
        var role = tpl?.Hidden.FirstOrDefault(r => r.Kind == PrismHost.Core.TemplateRoles.Music) ?? tpl?.Hidden.FirstOrDefault();
        if (tpl is null || role is null) { SetPill("Prism · this scene has no music role. Edit the scene's hidden facet instead"); return; }
        var hidx = Math.Max(0, tpl.Hidden.IndexOf(role));
        var current = hidx < scene.Hidden.Count ? scene.Hidden[hidx]["facet"]?.GetValue<string>() : null;
        var currentApp = current is null ? null : _model.Facet(current)?.App;

        var list = new StackPanel { Spacing = 4 };
        var tcs = new TaskCompletionSource<(HostCatalogEntry? entry, string? appId)?>();
        var present = new HashSet<string>(scene.Hidden.Select(h => h["facet"]?.GetValue<string>()).Where(f => f is not null).Select(f => _model.Facet(f!)?.App).Where(a => a is not null)!);
        var dlg = new ContentDialog { Title = add ? "Add a music service" : "Music service", Content = new ScrollViewer { Content = list, MaxHeight = 480 }, CloseButtonText = "Cancel", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        list.Children.Add(Meta(add ? "A second service for this wall: sign in once, and its playlists and stations join Quick play under their own heading." : "Which service plays on this wall. You sign in once; the beams do the rest."));
        foreach (var sug in role.Suggestions)
        {
            var entry = _catalog.FirstOrDefault(c => c.Id == sug); var known = _model.App(sug);
            if (entry is null && known is null) continue;
            var name = entry?.Name ?? known!.Name;
            if (add && present.Contains(sug)) continue;   // already one of this wall's services
            var note = (known is not null ? StatusWord(known) : "not added yet") + (currentApp == sug ? "  ·  playing now" : "");
            var e = entry; var k = known?.Id;
            list.Children.Add(AppRow(name, note, () => { tcs.TrySetResult((e, k)); dlg.Hide(); }));
        }
        // 2026-09-09 ("why do I have to click Any App?"): every music service the catalog knows is on this list, not only the
        // role's suggestions - a service whose adapter speaks the Media Session is a music service. The suggestions are the ones
        // the Widevine-audio POC cleared for the tile; the rest say so, and Prism reads them live once they are signed in.
        foreach (var entry in _catalog)
        {
            if (role.Suggestions.Contains(entry.Id) || (add && present.Contains(entry.Id))) continue;
            if (!EntryIsMusicService(entry)) continue;
            var known = _model.App(entry.Id);
            var note = (known is not null ? StatusWord(known) : "not added yet") + "  ·  not yet verified on the wall" + (currentApp == entry.Id ? "  ·  playing now" : "");
            var e = entry; var k = known?.Id;
            list.Children.Add(AppRow(entry.Name, note, () => { tcs.TrySetResult((e, k)); dlg.Hide(); }));
        }
        list.Children.Add(AppRow("Any app…", "from the catalog or any URL", () => { tcs.TrySetResult((null, null)); dlg.Hide(); }));
        dlg.Closed += (_, __) => tcs.TrySetResult(null);
        try { _ = dlg.ShowAsync(); } catch { return; }
        var pick = await tcs.Task;
        if (pick is null) return;
        var appId = pick.Value.appId ?? (pick.Value.entry is { } ce ? await SaveAppFromCatalogAsync(ce) : await AddAppAsync());
        if (appId is null) return;
        await ReadModelAsync();
        if (_model.App(appId) is not { } app) return;

        // the rest is automatic: cut and save, then - for a service not signed in - the same inline window "Open the full app"
        // shows, opened on the service's sign-in page (B-193, 2026-09-09: "why not just use the same window for login")
        async Task<string?> FinishAsync()
        {
            await ReadModelAsync();
            if (_model.App(appId) is not { } a2) return null;
            var (presetId, presetLabel, selector, url, zoom) = TunedPreset(a2, role);
            var reuse = _model.Facets.Where(f => f.App == a2.Id && f.Music && FacetFits(f.SlotClass, role.Class).Ok).OrderBy(f => FacetFits(f.SlotClass, role.Class).Match == "exact" ? 0 : 1).FirstOrDefault();
            var facetId = reuse?.Id ?? await SaveTunedFacetAsync(role, a2, presetId, presetLabel, selector, url, zoom);
            if (facetId is null) { SetPill("Prism · could not cut a facet for " + a2.Name); return null; }
            await ReadModelAsync();
            if (_model.Scene(sid) is not { } sc) return null;
            var s = sc.Clone();
            if (add)
            {
                // a second source: appended, the stage untouched - the first pick on it moves the visual there
                if (!s.Hidden.Any(h => h["facet"]?.GetValue<string>() == facetId)) s.Hidden.Add(new JsonObject { ["facet"] = facetId, ["audio"] = role.Audio });
            }
            else
            {
                // B-168 (2026-09-08): "Change the music service" is which service the stage draws - never which services the
                // wall keeps. It overwrote the first hidden entry (Apple) with the pick, even one already listed (Spotify,
                // twice): Apple vanished from the music services. Now: the service joins the list if absent, and the stages move to it.
                if (!s.Hidden.Any(h => h["facet"]?.GetValue<string>() == facetId)) s.Hidden.Add(new JsonObject { ["facet"] = facetId, ["audio"] = role.Audio });
                foreach (var v in s.Visualizations) v["source"] = facetId;   // every stage in this scene draws this service
            }
            var raw = await ModelCallAsync("modelSaveScene", s.ToJson());
            try { if (raw is not null && JsonNode.Parse(raw) is JsonObject r && r["ok"]?.GetValue<bool>() != true) { SetPill("Prism · could not save the scene"); return null; } } catch { }
            LogLine("call {\"fn\":\"music.service\",\"scene\":\"" + sid + "\",\"app\":\"" + a2.Id + "\",\"facet\":\"" + facetId + "\"}");
            SetPill(add ? "Prism · " + a2.Name + " joined this wall's music. Open Quick play (⟲) to pick something" : "Prism · " + a2.Name + " is this wall's music. Tap the stage to pick something, then Play");
            await ReadModelAsync();
            await ApplySceneAsync(sid);
            return facetId;
        }
        var signedIn = app.SetupStatus == "signed-in" && (app.Evidence == "probe" || app.Evidence == "asserted");
        var facet = await FinishAsync();
        if (facet is null || signedIn || IsBuiltIn(app)) return;   // IsBuiltIn: the rail model's first-party check (catalog account: none)
        // the source's surface comes up with the scene; wait for it, then the window on it, opened on the sign-in page
        for (var i = 0; i < 12; i++)
        {
            var wall = await ReadWallStateAsync();
            if (wall.Tiles.Any(t => t.Id == facet)) break;
            await Task.Delay(400);
        }
        // B-194: a Cancel (Done or Esc with the account still out) undoes the add - "I hit cancel ... and it has added it to my list anyway"
        _pendingAdd = (facet, sid, app.Id, app.Name);
        SetPill("Prism · sign in to " + app.Name + " here, then Done. Done without signing in cancels");
        OpenRoute("prism://facet/" + Uri.EscapeDataString(facet) + "/reveal?mode=window&signin=1");
    }

    /// <summary>
    /// B-195 (2026-09-09): "I see no workflow to remove an app." A music service leaves this wall the way it joined: a list of
    /// the wall's services, a pick, a confirmation; its hidden entry comes out of the scene, a stage that drew it moves to the
    /// first remaining service, and the scene re-applies. The App record and its sign-in stay under Apps in the rail, so adding
    /// the service back is one pick with no second sign-in.
    /// </summary>
    private async Task RemoveMusicServiceAsync(string tileId)
    {
        await ReadModelAsync();
        await RefreshMusicSourcesAsync();
        if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } scene) { SetPill("Prism · no active scene"); return; }
        var sources = _musicSources.ToList();
        if (sources.Count == 0) { SetPill("Prism · this wall has no music service to remove"); return; }
        var list = new StackPanel { Spacing = 3, Width = 440 };
        var tcs = new TaskCompletionSource<(string tile, string app, string name)?>();
        var dlg = new ContentDialog { Title = "Remove a music service", Content = new ScrollViewer { Content = list, MaxHeight = 480 }, CloseButtonText = "Cancel", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        list.Children.Add(Meta("What leaves is the service's facet in this scene - its place on this wall, and its playlists and stations in Quick play. The App itself (the sign-in, the settings) stays under Apps, so it comes back with one pick."));
        foreach (var s in sources)
        {
            var known = _model.App(s.app);
            var note = (known is not null ? StatusWord(known) : "") + (s.active ? "  ·  on the stage now" : "");
            var pick = s;
            list.Children.Add(AppRow(s.name, note, () => { tcs.TrySetResult((pick.tile, pick.app, pick.name)); dlg.Hide(); }));
        }
        dlg.Closed += (_, __) => tcs.TrySetResult(null);
        try { _ = dlg.ShowAsync(); } catch { return; }
        var chosen = await tcs.Task;
        if (chosen is not { } c) return;
        var confirm = new ContentDialog { Title = "Remove " + c.name + "?", Content = "Its facet leaves this scene. The App stays signed in, and Add a music service… brings it back with one pick.", PrimaryButtonText = "Remove", CloseButtonText = "Keep", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        if (await confirm.ShowAsync() != ContentDialogResult.Primary) return;
        await ReadModelAsync();
        if (_model.Scene(sid) is not { } sc) return;
        var next = sc.Clone();
        var before = next.Hidden.Count;
        next.Hidden.RemoveAll(h => h["facet"]?.GetValue<string>() == c.tile);
        if (next.Hidden.Count == before) { SetPill("Prism · " + c.name + " is not one of this wall's services"); return; }
        var fallback = next.Hidden.FirstOrDefault()?["facet"]?.GetValue<string>();
        foreach (var v in next.Visualizations) if (v["source"]?.GetValue<string>() == c.tile) v["source"] = fallback;
        var raw = await ModelCallAsync("modelSaveScene", next.ToJson());
        try { if (raw is not null && JsonNode.Parse(raw) is JsonObject r && r["ok"]?.GetValue<bool>() != true) { SetPill("Prism · could not save the scene"); return; } } catch { }
        LogLine("call {\"fn\":\"music.service.remove\",\"scene\":\"" + sid + "\",\"app\":\"" + c.app + "\",\"facet\":\"" + c.tile + "\"}");
        SetPill("Prism · " + c.name + "'s facet left this scene. The App stays under Apps" + (fallback is null ? ". This wall has no music service now" : ""));
        await ReadModelAsync();
        await ApplySceneAsync(sid);
    }

    // ------------------------------------------------ change apps: the same answers, written back into the scene that already exists
    private async Task SaveToSceneAsync()
    {
        if (_tpl is null || _tplScene is null) return;
        var tpl = _tpl;
        if (OpenRoles(tpl).Count > 0) { SetPill("Prism · every role must be resolved first"); return; }
        await ReadModelAsync();
        if (_model.Scene(_tplScene) is not { } scene) { SetPill("Prism · that scene is gone"); return; }
        var s = scene.Clone();
        foreach (var role in tpl.Roles)
        {
            if (role.Kind == PrismHost.Core.TemplateRoles.Visualization)
            {
                // the stage keeps its visualization (style / artwork are the household's to change in the builder); only the source moves
                if (role.Visualization is not { } v || !_tplResolved.TryGetValue(v.Source, out var src)) continue;
                var vizId = s.Assign.TryGetValue(role.Id, out var existing) ? existing : null;
                var viz = vizId is null ? null : s.Visualizations.FirstOrDefault(x => x["id"]?.GetValue<string>() == vizId);
                if (viz is null) { viz = new JsonObject { ["id"] = role.Id + "-viz", ["style"] = v.Style, ["artwork"] = v.Artwork, ["label"] = role.Label }; s.Visualizations.Add(viz); s.Assign[role.Id] = role.Id + "-viz"; }
                viz["source"] = src;
                continue;
            }
            if (_tplResolved.TryGetValue(role.Id, out var fid)) s.Assign[role.Id] = fid;
        }
        for (var i = 0; i < tpl.Hidden.Count; i++)
        {
            if (!_tplResolved.TryGetValue(tpl.Hidden[i].Id, out var hf)) continue;
            while (s.Hidden.Count <= i) s.Hidden.Add(new JsonObject { ["facet"] = hf, ["audio"] = tpl.Hidden[i].Audio });
            s.Hidden[i]["facet"] = hf;
        }
        var raw = await ModelCallAsync("modelSaveScene", s.ToJson());
        try { if (raw is not null && JsonNode.Parse(raw) is JsonObject r && r["ok"]?.GetValue<bool>() != true) { SetPill("Prism · " + (r["error"]?.GetValue<string>() ?? "could not save the scene")); return; } } catch { }
        LogLine("call {\"fn\":\"template.save\",\"scene\":\"" + s.Id + "\",\"template\":\"" + tpl.Id + "\"}");
        await ReadModelAsync();
        if (await ApplySceneAsync(s.Id)) RouteBack();
    }

    // ------------------------------------------------ create: core instantiates (layout + scene, roles' audio defaults), then the wall becomes it
    private async Task CreateFromTemplateAsync()
    {
        if (_tpl is null) return;
        var tpl = _tpl;
        if (OpenRoles(tpl).Count > 0) { SetPill("Prism · every role must be resolved first"); return; }
        // Running the wizard twice must not silently make two scenes with the same
        // name (found in the 2026-09-05 audit): suggest the first unused one.
        var suggested = tpl.Name;
        for (var n = 2; _model.Scenes.Any(s => s.Name == suggested); n++) suggested = tpl.Name + " " + n;
        var name = await PromptTextAsync("Name the scene", suggested, suggested, "Create");
        if (name is null) return;
        // §7a: what core needs is one facet id per slot role AND per hidden
        // role; a visualization role is never in here - instantiateTemplate
        // derives it from the hidden role its block names.
        var resolved = new JsonObject();
        foreach (var (k, v) in _tplResolved) resolved[k] = v;
        var raw = await ModelCallAsync("modelInstantiateTemplate", tpl.Id, resolved, name);
        string? sceneId = null;
        try
        {
            if (raw is not null && JsonNode.Parse(raw) is JsonObject r)
            {
                if (r["ok"]?.GetValue<bool>() != true) { SetPill("Prism · " + (r["error"]?.GetValue<string>() ?? "could not create the scene")); return; }
                sceneId = (r["value"] as JsonObject)?["scene"] is JsonObject sc ? sc["id"]?.GetValue<string>() : null;
                if (r["warnings"] is JsonArray w) foreach (var x in w) LogLine("template note: " + x);
            }
        }
        catch { }
        if (sceneId is null) { SetPill("Prism · the template produced no scene"); return; }
        await ReadModelAsync();
        if (await ApplySceneAsync(sceneId)) RouteBack();
    }
}
