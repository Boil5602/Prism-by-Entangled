using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// §6a quick actions and deep links (scene-model-spec, normative). Every
/// entity screen is a <c>prism://</c> route from core's registry
/// (packages/core/routes.registry.json, shipped as an asset); this router
/// opens them and keeps the back stack core's <c>RouteStack</c> defines:
/// Back / Esc lands on the scene whatever is stacked, Done resumes the opener.
///
/// On-scene interactions: single tap on a video / music item → promote /
/// reveal; long-press / right-click / remote-hold → the compact context
/// sheet (Open full page (setup mode) · Edit facet · App settings / sign in ·
/// Swap facet in this slot · Mute), each a deep link, the sheet closes on
/// action; the needs-attention badge IS the shortcut to the App's setup; a
/// corner affordance during full-page / reveal offers Edit this facet and
/// App settings. Rule: editor ≤ 1 action, App settings ≤ 2 (scripts/walk-test-6a.mjs).
/// </summary>
public sealed partial class MainWindow
{
    // ------------------------------------------------ the registry (core's data, read once)
    private sealed record RouteDefRow(string Id, string Route, string Kind, string Entity, bool Transient, string[] Segments);
    private List<RouteDefRow>? _routes;

    private List<RouteDefRow> Routes()
    {
        if (_routes is not null) return _routes;
        var list = new List<RouteDefRow>();
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "Assets", "routes.registry.json");
            if (JsonNode.Parse(File.ReadAllText(path)) is JsonObject reg && reg["routes"] is JsonArray arr)
                foreach (var n in arr)
                    if (n is JsonObject o && o["route"]?.GetValue<string>() is { } route)
                        list.Add(new RouteDefRow(o["id"]?.GetValue<string>() ?? route, route, o["kind"]?.GetValue<string>() ?? "view", o["entity"]?.GetValue<string>() ?? "", o["transient"]?.GetValue<bool>() == true,
                            route["prism://".Length..].Split('/', StringSplitOptions.RemoveEmptyEntries)));
        }
        catch (Exception ex) { SetStatus("route registry unreadable: " + ex.Message); }
        _routes = list;
        return list;
    }

    private sealed record RouteHit(RouteDefRow Def, Dictionary<string, string> Params, Dictionary<string, string> Query, string Url)
    {
        public string P(string k) => Params.TryGetValue(k, out var v) ? v : "";
        public string? Q(string k) => Query.TryGetValue(k, out var v) && v.Length > 0 ? v : null;
    }

    /// <summary>Match a prism:// url against the registry (the same first-wins matching as core's matchRoute).</summary>
    private RouteHit? MatchRoute(string url)
    {
        if (!url.StartsWith("prism://", StringComparison.Ordinal)) return null;
        var rest = url["prism://".Length..];
        var q = rest.IndexOf('?');
        var path = q >= 0 ? rest[..q] : rest;
        var query = new Dictionary<string, string>();
        if (q >= 0)
            foreach (var pair in rest[(q + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var eq = pair.IndexOf('=');
                var k = Uri.UnescapeDataString(eq >= 0 ? pair[..eq] : pair);
                if (k.Length > 0) query[k] = eq >= 0 ? Uri.UnescapeDataString(pair[(eq + 1)..]) : "";
            }
        if (path.EndsWith('/')) path = path[..^1];
        var segs = path.Split('/');
        if (segs.Any(s => s.Length == 0)) return null;
        foreach (var def in Routes())
        {
            if (def.Segments.Length != segs.Length) continue;
            var ps = new Dictionary<string, string>();
            var ok = true;
            for (var i = 0; i < segs.Length; i++)
            {
                if (def.Segments[i].StartsWith(':')) ps[def.Segments[i][1..]] = Uri.UnescapeDataString(segs[i]);
                else if (def.Segments[i] != segs[i]) { ok = false; break; }
            }
            if (ok) return new RouteHit(def, ps, query, url);
        }
        return null;
    }

    // ------------------------------------------------ the back stack (core's RouteStack, mirrored: push / back → scene / done → opener)
    private readonly List<RouteHit> _routeStack = new();
    /// <summary>What resumes after an editor completes (the wizard, the builder's slot picker …). Keyed by the editor kind.</summary>
    private readonly Dictionary<string, Action<string?, bool>> _editorContinuations = new();

    private string? SceneRoute() => _model.ActiveScene is { } id ? "prism://scene/" + Uri.EscapeDataString(id) : null;

    /// <summary>Open a deep link. Unknown routes are refused on the pill (never a silent no-op). Routes the host's own UI opens are reported to core (ui.route) so the flight recorder shows one shape for every deep link; routes that ARRIVED from core (remote, remote-hold) are not echoed.</summary>
    private void OpenRoute(string url, string source = "ui")
    {
        var hit = MatchRoute(url);
        if (hit is null) { SetPill("Prism · not a route: " + Shorten(url, 60)); LogLine("route refused " + url); return; }
        LogLine("route " + url + " (" + source + ")");
        if (source == "ui") ReportUiRoute(url, "ui");
        if (hit.Def.Transient && _routeStack.Count > 0 && _routeStack[^1].Def.Transient) { CollapseTransient(_routeStack[^1]); _routeStack.RemoveAt(_routeStack.Count - 1); }
        _routeStack.Add(hit);
        _ = DispatchRouteAsync(hit);
    }

    /// <summary>Back / Esc: every Prism screen closes; the scene is what remains (§6a).</summary>
    private void RouteBack()
    {
        foreach (var h in Enumerable.Reverse(_routeStack)) if (h.Def.Transient) CollapseTransient(h);
        // 2026-09-14: "I opened the full page for Pandora and Done won't close it" - Done ran RouteBack with an EMPTY route
        // stack (the log: "Done clicked (route stack 0)"), so no facet.reveal hit was there to collapse and the window stayed.
        // A revealed player is collapsed on the way back whether or not its route is still on the stack.
        if (_revealedTile is not null) CollapseRevealNow();
        _routeStack.Clear();
        _editorContinuations.Clear();
        CloseAllSceneModelScreens();
        if (_screenFsTile is { } fs) ToggleScreenFullscreen(fs);
        SetPill("Prism");
    }

    /// <summary>Done on the top screen: it closes; the opener resumes (a wizard continues at its next role) or the scene shows.</summary>
    private void RouteDone()
    {
        if (_routeStack.Count > 0) _routeStack.RemoveAt(_routeStack.Count - 1);
        if (_routeStack.Count == 0) { CloseAllSceneModelScreens(); return; }
        var top = _routeStack[^1];
        if (top.Def.Id is "template.wizard" or "scene.edit") { /* the opener is still on screen underneath */ }
        else _ = DispatchRouteAsync(top);
    }

    private void CloseAllSceneModelScreens()
    {
        CloseContextSheet();
        CloseCornerAffordance();
        CloseNewsPicker();
        CloseTemplateWizard();
        CloseSceneBuilder();
        CloseRail();
        CloseAppSettingsCard();
    }

    /// <summary>
    /// Editors (SM-2) call this on Save / Done / Cancel - the rail → editor
    /// contract (MainWindow.EditorStubs.cs documents the three entry points).
    /// A flow that opened the editor gets its continuation; otherwise Done
    /// semantics apply (the opener resumes, or the scene shows).
    /// </summary>
    private void EditorClosed(string kind, string? entityId, bool saved)
    {
        LogLine("editor closed " + kind + " " + (entityId ?? "-") + (saved ? " saved" : " cancelled"));
        if (_routeStack.Count > 0 && _routeStack[^1].Def.Entity == (kind == "app-setup" ? "app" : kind)) _routeStack.RemoveAt(_routeStack.Count - 1);
        if (_editorContinuations.Remove(kind, out var k)) { k(entityId, saved); return; }
        if (saved && kind == "app-setup" && entityId is { } app) _ = ReturnFromSetupAsync(app);
        if (_rail is not null) _ = ReadModelAsync().ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => _ = RenderRailAsync()));
    }

    /// <summary>Completing sign-in returns to the scene with the App's facets reloading (§16 crossfade) - the badge's round trip.</summary>
    private async Task ReturnFromSetupAsync(string appId)
    {
        await ReadModelAsync();
        if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } scene) return;
        var wall = await ReadWallStateAsync();
        foreach (var (slot, facetId) in scene.Assign)
        {
            if (_model.Facet(facetId) is not { } f || f.App != appId) continue;
            if (wall.Tiles.Any(t => t.Id == slot)) _brain.Call(HostCalls.RefreshTile, slot);
        }
        if (_routeStack.Count == 0) RefreshSceneBadges();
    }

    private async Task DispatchRouteAsync(RouteHit hit)
    {
        switch (hit.Def.Id)
        {
            case "scenes": OpenRail("scenes"); break;
            case "layouts": OpenRail("layouts"); break;
            case "facets": OpenRail("facets"); break;
            case "apps": OpenRail("apps"); break;
            case "device": OpenRail("device"); break;
            case "scene.view": await ApplySceneAsync(hit.P("id")); RouteBack(); break;
            case "scene.edit": OpenSceneBuilder(hit.P("id"), null, hit.Q("slot")); break;
            case "item.swap": if (_model.ActiveScene is { } swapScene) OpenSceneBuilder(swapScene, null, hit.P("item"), pickNow: true); else { SetPill("Prism · no active scene"); _routeStack.Remove(hit); } break;
            case "item.mute": await ToggleItemMuteAsync(hit.P("item")); _routeStack.Remove(hit); break;
            case "item.visualNext": await CycleVisualizationStyleAsync(hit.P("item")); _routeStack.Remove(hit); break;
            case "item.musicService": _routeStack.Remove(hit); _ = ChangeMusicServiceAsync(hit.P("item")); break;
            case "item.musicAdd": _routeStack.Remove(hit); _ = ChangeMusicServiceAsync(hit.P("item"), add: true); break;   // multi-service lounge (2026-09-07)
            case "item.musicRemove": _routeStack.Remove(hit); _ = RemoveMusicServiceAsync(hit.P("item")); break;   // B-195 (2026-09-09)
            case "item.musicAds": _routeStack.Remove(hit); _ = AdsSoundModalAsync(hit.P("item")); break;   // section 26 ambient audio (2026-09-07)
            case "item.visualStyle": _routeStack.Remove(hit); _ = VisualStyleModalAsync(hit.P("item")); break;   // a modal on the spot, applied live (2026-09-06)
            case "item.sheet":
            {
                _routeStack.Remove(hit);   // the sheet is selection, not a screen (B-32): it does not stack
                var wall = await ReadWallStateAsync();
                var tile = wall.Tiles.FirstOrDefault(t => t.Id == hit.P("item"));
                var item = SceneItemOf(hit.P("item"), tile);
                if (item is null) { SetPill("Prism · " + hit.P("item") + " is not on the scene"); break; }
                var r = _surfaces.RectOf(item.Item);
                ShowContextSheet(item, r is { } rr ? new Windows.Foundation.Point(rr.X + rr.W / 2 - 150, rr.Y + rr.H / 2 - 120) : new Windows.Foundation.Point(_w / 2 - 150, _h / 2 - 120));
                break;
            }
            case "scene.visualization.edit": OpenSceneBuilder(hit.P("id"), null, null, visualization: hit.P("viz")); break;
            case "templates": OpenTemplateWizard(null, customLayoutId: hit.Q("layout")); break;
            case "template.wizard": OpenTemplateWizard(hit.P("id"), hit.Q("scene"), hit.Q("role")); break;
            case "layout.new": OpenLayoutEditor(null); break;
            case "layout.edit": OpenLayoutEditor(hit.P("id")); break;
            case "facet.new": OpenFacetEditor(hit.Q("app") ?? "", hit.Q("class"), null); break;
            case "facet.edit":
            {
                await ReadModelAsync();
                var f = _model.Facet(hit.P("id"));
                if (f is null) { SetPill("Prism · no facet " + hit.P("id")); _routeStack.Remove(hit); break; }
                OpenFacetEditor(f.App, f.SlotClass, f.Id);
                break;
            }
            case "facet.full": await PromoteFacetAsync(hit.P("id")); break;
            case "facet.reveal": await RevealMusicFacetAsync(hit.P("id"), hit.Q("mode") == "window", hit.Q("signin") == "1"); break;
            case "app.new": _ = AddAppAsync(hit.Q("url")); _routeStack.Remove(hit); break;
            case "app.setup": OpenAppSetup(hit.P("id"), hit.Q("url"), signIn: hit.Q("signin") == "1"); break;   // B-56: setup mode at a page when the link names one; signin=1: the sign-in wizard
            case "app.settings": await OpenAppSettingsCardAsync(hit.P("id")); break;
            case "news.pick": OpenNewsPicker(hit.Q("class"), null); break;
            default: SetPill("Prism · route not wired: " + hit.Def.Id); _routeStack.Remove(hit); break;
        }
    }

    // ------------------------------------------------ apply a scene (the wall becomes it; layoutMode "fixed")
    private async Task<bool> ApplySceneAsync(string sceneId)
    {
        var raw = await ModelCallAsync("modelApplyScene", sceneId);
        var ok = raw is not null && raw.Contains("\"ok\":true");
        if (!ok) { SetPill("Prism · could not apply scene " + sceneId + (raw is null ? "" : ": " + Shorten(raw, 80))); return false; }
        await SceneAppliedAsync(sceneId, raw!);
        return true;
    }

    /// <summary>
    /// The two players (core players.ts, 2026-09-19): "Music player" / "Video player" in the Prism menu. Core names the
    /// household's scene for each (its Music Lounge, its Movie Night) and which one the wall is; the item switches, the
    /// tooltip says what the switch keeps (the music sources ride along hidden; the way back resumes what a video paused).
    /// </summary>
    private async Task<List<MenuFlyoutItem>> BuildPlayerItemsAsync()
    {
        string? active = null, musicName = null, videoName = null;
        try
        {
            var raw = await ModelCallAsync("players");
            if (raw is not null && JsonNode.Parse(raw) is JsonObject p)
            {
                active = p["active"]?.GetValue<string>();
                musicName = (p["music"] as JsonObject)?["name"]?.GetValue<string>();
                videoName = (p["video"] as JsonObject)?["name"]?.GetValue<string>();
            }
        }
        catch (Exception e) { LogLine("players: " + e.Message); }
        var items = new List<MenuFlyoutItem>();
        foreach (var (kind, label, glyph, name) in new[] { ("music", "Music player", "", musicName), ("video", "Video player", "", videoName) })
        {
            var on = active == kind;
            var k = kind;
            var item = Item(label + (name is null ? "" : "  ·  " + Shorten(name, 28)), on ? "" : glyph, null, () => _ = SwitchPlayerAsync(k));
            ToolTipService.SetToolTip(item, kind == "music"
                ? (name is null ? "No Music player yet: opens the Music Lounge template to make one." : on ? "The wall is your Music player now." : "The wall becomes \"" + name + "\"; music a video paused plays on from where it was.")
                : (name is null ? "No Video player yet: opens the Movie Night template to make one." : on ? "The wall is your Video player now." : "The wall becomes \"" + name + "\". Your music sources ride along hidden and keep playing until a video takes the sound."));
            items.Add(item);
        }
        return items;
    }

    /// <summary>
    /// VP-3 (2026-09-19): "our movie player would seemingly play from any service, LIKE THE MUSIC PLAYER" - and VP-3b:
    /// "with the page adapters we've written in music, we've basically created the menu structure for starting things.
    /// Can we do the same thing here?" The Watch submenu has the music Quick play's shape: the screen first (who is up,
    /// what plays, the verbs through the adapter's own player), then ONE SUBMENU PER SERVICE - its recents (the last five
    /// titles the wall saw play there), Continue watching, My list, and the page's own rows as shelves, then "Who's
    /// watching?" while the service asks, then Open the player / Sign in - and "Add a video service…" at the foot. A
    /// pick on a service that is not up switches the screen to it and plays once its page is up. Null when the
    /// household has no video service.
    /// </summary>
    private async Task<MenuFlyoutSubItem?> BuildWatchMenuAsync()
    {
        JsonObject? sv = null; JsonArray? vs = null;
        try
        {
            sv = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject;
            vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray;
        }
        catch (Exception e) { LogLine("watch menu: " + e.Message); }
        if (sv?["services"] is not JsonArray services || services.Count == 0) return null;
        var ink = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xE8, 0xEC, 0xF2));
        var amber = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xF2, 0xB1, 0x4C));
        MenuFlyoutItem Label(string text, bool notice = false) => new() { Text = text, Foreground = notice ? amber : ink, IsHitTestVisible = false };
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        var sub = new MenuFlyoutSubItem { Text = "Watch", Icon = Glyph("") };
        var active = sv["active"]?.GetValue<bool>() == true;
        var screen = sv["screen"] as JsonObject;
        var screenSlot = screen?["slot"]?.GetValue<string>();
        var screenFacet = screen?["facet"]?.GetValue<string>();
        JsonObject? tile = null;
        if (vs is not null && screenSlot is not null) foreach (var t in vs) if (t is JsonObject o && o["id"]?.GetValue<string>() == screenSlot) tile = o;

        // VP-4: the full-screen hub - the same rows as this menu, as artwork cards merged across services (MainWindow.VideoHub.cs)
        var hub = Item("Browse everything (full screen)…", "", null, () => _ = ShowVideoHubAsync());
        ToolTipService.SetToolTip(hub, "The Video player's own page over the screen: Continue watching and My list from every service, each service's rows, who's watching. Esc closes it.");
        sub.Items.Add(hub);
        sub.Items.Add(new MenuFlyoutSeparator());

        // ---- the screen: who is up, what plays, the verbs
        if (active && screen is not null)
        {
            var appName = "";
            foreach (var s in services) if (s is JsonObject so && so["facet"]?.GetValue<string>() == screenFacet) appName = S(so, "name");
            var video = tile?["video"] as JsonObject;
            var playing = tile?["playing"]?.GetValue<bool>() == true;
            var pending = tile?["pending"] as JsonObject;
            string face;
            if (pending is not null) face = pending["failed"] is not null ? "could not start " + S(pending, "name") : "loading " + S(pending, "name") + "…";
            else if (video is not null && (S(video, "title").Length > 0 || S(video, "series").Length > 0))
            {
                var series = S(video, "series"); var title = S(video, "title");
                var ep = EpisodeLabel(video);
                face = string.Join("  ·  ", new[] { series, ep, title }.Where(x => !string.IsNullOrEmpty(x)));
            }
            else face = "nothing playing";
            sub.Items.Add(Label(appName + "  ·  " + Shorten(face, 60), pending?["failed"] is not null));
            var canCmd = (tile?["can"] as JsonObject)?["cmd"]?.GetValue<bool>() == true;
            var hasFace = video is not null;
            void Verb(string text, string glyph, string cmd, bool enabled, string why)
            {
                var it = Item(text, glyph, null, () => _brain.Call(HostCalls.TileCommand, screenSlot!, cmd));
                it.IsEnabled = enabled;
                ToolTipService.SetToolTip(it, enabled ? text : text + " - " + why);
                sub.Items.Add(it);
            }
            Verb(playing ? "Pause" : "Play", playing ? GlyphPause : GlyphPlay, playing ? "pause" : "play", true, "");
            Verb("Back 10 s", "", "seekbackward", hasFace, "nothing is playing");
            Verb("Forward 10 s", "", "seekforward", hasFace, "nothing is playing");
            Verb("Next episode", GlyphNext, "nextepisode", canCmd && hasFace, canCmd ? "nothing is playing" : "this service's adapter has no player script yet");
            Verb("Skip intro / recap", "", "skipintro", canCmd && hasFace, canCmd ? "nothing is playing" : "this service's adapter has no player script yet");
            Verb("Captions", "", "captions", canCmd && hasFace, canCmd ? "nothing is playing" : "this service's adapter has no player script yet");
            sub.Items.Add(new MenuFlyoutSeparator());
        }

        // ---- one submenu per service, the music Quick play's shape
        foreach (var s in services)
        {
            if (s is not JsonObject so) continue;
            var facet = S(so, "facet"); var app = S(so, "app"); var name = S(so, "name"); var status = S(so, "status");
            var on = active && so["onScreen"]?.GetValue<bool>() == true;
            var signedIn = status == "signed-in";
            var svc = new MenuFlyoutSubItem { Text = name + (on ? "  ·  on the screen" : signedIn ? "" : "  ·  sign in"), Icon = Glyph(on ? "" : signedIn ? "" : "") };
            var any = false;
            // recents: the last five titles the wall saw play here
            if (so["recent"] is JsonArray recent && recent.Count > 0)
            {
                foreach (var r in recent)
                {
                    if (r is not JsonObject ro) continue;
                    var id = S(ro, "id"); var title = S(ro, "title"); var series = S(ro, "series"); var kind = S(ro, "kind"); var url = ro["url"]?.GetValue<string>();
                    var text = series.Length > 0 && series != title ? series + "  ·  " + title : title;
                    var it = Item(Shorten(text, 48), GlyphRecent, null, () => _ = PlayOnAsync(facet, kind.Length > 0 ? kind : "title", id.Length > 0 ? id : url ?? title, url, text));
                    ToolTipService.SetToolTip(it, "Played here before. Press to play it again on " + name + ".");
                    svc.Items.Add(it); any = true;
                }
            }
            // the library: Continue watching, My list, then the page's own rows as shelves
            var lib = so["library"] as JsonObject;
            var groups = new List<(string head, JsonArray items)>();
            if (lib?["continue"] is JsonArray c && c.Count > 0) groups.Add(("Continue watching", c));
            if (lib?["list"] is JsonArray l && l.Count > 0) groups.Add(("My list", l));
            if (lib?["shelves"] is JsonArray shelves) foreach (var sh in shelves) if (sh is JsonObject sho && sho["items"] is JsonArray si && si.Count > 0) groups.Add((S(sho, "title"), si));
            if (groups.Count > 0 && any) svc.Items.Add(new MenuFlyoutSeparator());
            foreach (var (head, items) in groups)
            {
                var g = new MenuFlyoutSubItem { Text = Shorten(head, 36) + "  (" + items.Count + ")" };
                foreach (var x in items)
                {
                    if (x is not JsonObject xo) continue;
                    var id = S(xo, "id"); var title = S(xo, "title"); var kind = S(xo, "kind"); var url = xo["url"]?.GetValue<string>(); var subt = S(xo, "subtitle");
                    var prog = xo["progress"] is JsonValue pv && pv.TryGetValue<double>(out var pd) && pd > 0 ? "  ·  " + (int)Math.Round(pd * 100) + "%" : "";
                    var it = Item(Shorten(title, 44) + (subt.Length > 0 ? "  ·  " + Shorten(subt, 20) : "") + prog, null, null, () => _ = PlayOnAsync(facet, kind, id, url, title));
                    ToolTipService.SetToolTip(it, "Plays " + title + " on " + name + (on ? "" : " (the screen switches to " + name + " first)") + ".");
                    g.Items.Add(it);
                }
                svc.Items.Add(g); any = true;
            }
            // the profile gate ("Who's watching?"), while the service asks: a pick is a human's press; "always" a standing choice
            if (on && tile?["profiles"] is JsonObject prof && prof["gate"]?.GetValue<bool>() == true && prof["profiles"] is JsonArray plist && plist.Count > 0)
            {
                if (any) svc.Items.Add(new MenuFlyoutSeparator());
                svc.Items.Add(Label("Who's watching?", true));
                foreach (var p in plist)
                {
                    if (p is not JsonObject po) continue;
                    var pid = S(po, "id"); var pname = S(po, "name");
                    var pick = new MenuFlyoutSubItem { Text = "Watch as " + pname, Icon = Glyph("") };
                    pick.Items.Add(Item("This time", null, null, () => _ = ModelCallAsync("videoProfile", screenSlot!, pid, false)));
                    var always = Item("Always, on " + name, null, null, () => _ = ModelCallAsync("videoProfile", screenSlot!, pid, true));
                    ToolTipService.SetToolTip(always, "A standing choice: whenever " + name + " asks who is watching, the wall answers " + pname + ". Forget it from this menu.");
                    pick.Items.Add(always);
                    svc.Items.Add(pick);
                }
                any = true;
            }
            if (on && tile?["profileChoice"] is JsonObject ch && ch["always"]?.GetValue<bool>() == true)
            {
                svc.Items.Add(Item("Stop always watching as " + S(ch, "name"), "", null, () => _ = ModelCallAsync("videoForgetProfile", screenSlot!)));
                any = true;
            }
            if (!any) svc.Items.Add(Label(signedIn ? "Nothing yet - watch something here once and its rows fill in" : "Signed out - sign in to see its rows"));
            svc.Items.Add(new MenuFlyoutSeparator());
            if (!signedIn) svc.Items.Add(Item("Sign in to " + name + "…", "", null, () => OpenRoute("prism://app/" + Uri.EscapeDataString(app) + "/setup?return=scene")));
            else if (!on) svc.Items.Add(Item("Watch on " + name, "", null, () => _ = SwitchScreenAsync(facet)));
            else svc.Items.Add(Item("Open " + name + "'s page (setup mode)", "", null, () => OpenRoute("prism://app/" + Uri.EscapeDataString(app) + "/setup?return=scene")));
            sub.Items.Add(svc);
        }
        sub.Items.Add(new MenuFlyoutSeparator());
        var add = Item("Add a video service…", "", null, () => OpenRoute("prism://apps"));
        ToolTipService.SetToolTip(add, "Apps: add a service from the catalog and sign in once; it joins this menu.");
        sub.Items.Add(add);
        return sub;
    }

    private async Task SwitchScreenAsync(string facetId)
    {
        var raw = await ModelCallAsync("videoSwitch", facetId);
        JsonObject? r = null;
        try { r = raw is null ? null : JsonNode.Parse(raw) as JsonObject; } catch { }
        if (r?["ok"]?.GetValue<bool>() == true) { await SceneAppliedAsync(r["sceneId"]?.GetValue<string>() ?? "", raw!); return; }
        if (r?["reason"]?.GetValue<string>() == "no-scene") { SetPill("Prism · no Video player yet. Make one from the Movie Night template"); OpenTemplateWizard("movie-night"); return; }
        SetPill("Prism · could not switch the screen" + (raw is null ? "" : ": " + Shorten(raw, 80)));
    }

    private async Task PlayOnAsync(string facetId, string kind, string id, string? url, string name)
    {
        var raw = await ModelCallAsync("videoPlayOn", facetId, kind, id, url, name);
        JsonObject? r = null;
        try { r = raw is null ? null : JsonNode.Parse(raw) as JsonObject; } catch { }
        if (r?["ok"]?.GetValue<bool>() == true)
        {
            if (r["switched"]?.GetValue<bool>() == true && r["sceneId"]?.GetValue<string>() is { } sceneId) await SceneAppliedAsync(sceneId, raw!);
            SetPill("Prism · playing " + name);
            return;
        }
        SetPill("Prism · could not play " + name + (raw is null ? "" : ": " + Shorten(raw, 80)));
    }

    private async Task SwitchPlayerAsync(string kind)
    {
        var raw = await ModelCallAsync("switchPlayer", kind);
        JsonObject? r = null;
        try { r = raw is null ? null : JsonNode.Parse(raw) as JsonObject; } catch { }
        if (r?["ok"]?.GetValue<bool>() == true)
        {
            await SceneAppliedAsync(r["sceneId"]?.GetValue<string>() ?? "", raw!);
            return;
        }
        if (r?["reason"]?.GetValue<string>() == "no-scene")
        {
            var video = kind == "video";
            SetPill("Prism · no " + (video ? "Video" : "Music") + " player yet. Make one from the " + (video ? "Movie Night" : "Music Lounge") + " template");
            OpenTemplateWizard(r["template"]?.GetValue<string>() ?? (video ? "movie-night" : "music-lounge"));
            return;
        }
        SetPill("Prism · could not switch to the " + kind + " player" + (raw is null ? "" : ": " + Shorten(raw, 80)));
    }

    /// <summary>After core has taken the wall to a scene: the model re-read, the pill, chrome and badges placed now and again once rects exist.</summary>
    private async Task SceneAppliedAsync(string sceneId, string raw)
    {
        await ReadModelAsync();
        _ = UpdateWatchGripAsync();
        var name = _model.Scene(sceneId)?.Name ?? sceneId;
        SetPill("Prism · the wall is now \"" + name + "\"");
        try
        {
            if (JsonNode.Parse(raw!) is JsonObject r && r["notes"] is JsonArray notes) foreach (var n in notes) LogLine("apply note: " + n);
        }
        catch { }
        // surfaces are created on the §16 path after the apply returns: place chrome / badges once now and again when rects exist
        _ = SyncVisualizationsAsync();
        _ = SyncTapCatchersAsync();
        RefreshSceneBadges();
        RefreshListeningChips();
        foreach (var delay in new[] { 1500, 4000 })
            _ = Task.Delay(delay).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(() => { _ = SyncVisualizationsAsync(); _ = SyncTapCatchersAsync(); RefreshSceneBadges(); RefreshListeningChips(); }));
    }

    /// <summary>
    /// concept-scenes §5: Prism claims the single tap exactly where the
    /// placement asked for it (<c>tapAction</c> "audio" or "both") and nowhere
    /// else - a <c>promote</c> slot (§6a's default) keeps handing the pointer
    /// to the page, unchanged. Right-click / press-and-hold still raise the
    /// §6a context sheet in every mode.
    ///
    /// The verb itself is core's: the catcher only reports the tap
    /// (<c>tapItem</c>), and core answers with <c>ui.tapResult</c>.
    /// </summary>
    /// <summary>
    /// Place the scene-model chrome once core has answered. On launch nothing
    /// calls ApplySceneAsync - core restores the active scene from the store -
    /// so this is the only path that builds visualization chrome (B-98), and it
    /// has to survive core still booting. Attempts are AWAITED one at a time:
    /// overlapping them deadlocks the brain WebView.
    /// </summary>
    /// <summary>
    /// First run: a store with no scenes is a wall with nothing on it and a household that
    /// has not found F10 yet. Open the New scene wizard for them, once, with a welcome line.
    /// </summary>
    private bool _firstRunShown;
    private async Task FirstRunAsync()
    {
        foreach (var delay in new[] { 1500, 3000, 6000, 8000, 12000 })
        {
            await Task.Delay(delay);
            // B-249 (2026-09-19): the first beats land before the brain is ready, and a model read then answers empty - the
            // wizard opened on every boot of a wall that has scenes ("Welcome to Prism ... nothing is on the wall yet" under
            // the video menu). Only a model the brain itself answered counts.
            if (!_brain.Ready) continue;
            try
            {
                await ReadModelAsync();
                if (_model.Scenes.Count > 0 || _firstRunShown) return;
                _firstRunShown = true;
                LogLine("first run: no scenes - opening the New scene wizard");
                OpenRoute("prism://templates");
                return;
            }
            catch { /* core not ready: next beat */ }
        }
    }

    private async Task StartupSyncAsync()
    {
        foreach (var delay in new[] { 0, 800, 2000, 4000, 8000 })
        {
            if (delay > 0) await Task.Delay(delay);
            try
            {
                await SyncVisualizationsAsync();
                await SyncTapCatchersAsync();
                RefreshSceneBadges();
                RefreshListeningChips();
            }
            catch { /* core not ready yet: try the next beat */ }
            if (_vizChrome.Count > 0) return;   // chrome is up; the 2s poll owns it from here
        }
    }

    private async Task SyncTapCatchersAsync()
    {
        var wall = await ReadWallStateAsync();
        var claimed = 0;
        foreach (var t in wall.Tiles)
        {
            var claim = t.TapAction is "audio" or "both";
            if (claim) claimed++;
            _surfaces.SetTapCatcher(t.Id, claim);
        }
        if (claimed > 0) LogLine($"tap: Prism owns the single tap on {claimed} item(s) (concept-scenes §5)");
    }

    // ------------------------------------------------ what is on the scene: tile id → item
    private sealed record SceneItem(string Kind, string Scene, string Item, string? Facet, string? App, string? Visualization, string? Url, bool Muted, string? Template = null, string? Role = null);

    /// <summary>The scene's music services as core last listed them (PrismRuntime.musicSources), refreshed with the transport - the sheet and the menu read this.</summary>
    private List<(string tile, string app, string name, string? session, bool active)> _musicSources = new();
    private async Task RefreshMusicSourcesAsync()
    {
        try
        {
            var raw = await RuntimeEvalAsync("PrismRuntime.musicSources()");
            var list = new List<(string, string, string, string?, bool)>();
            if (raw is not null && System.Text.Json.Nodes.JsonNode.Parse(raw) is System.Text.Json.Nodes.JsonArray arr)
                foreach (var s in arr.OfType<System.Text.Json.Nodes.JsonObject>())
                    if (s["tile"]?.GetValue<string>() is { } t && s["app"]?.GetValue<string>() is { } a) list.Add((t, a, s["name"]?.GetValue<string>() ?? a, s["session"]?.GetValue<string>(), s["active"]?.GetValue<bool>() == true));
            _musicSources = list;
        }
        catch { }
    }

    /// <summary>The template a scene was built from (its layout's provenance), or null for a drawn / hero / grid layout.</summary>
    private string? SlotLabelOf(string sceneId, string slotId)
        => _model.Scene(sceneId) is { } sc ? _model.Layout(sc.Layout)?.Slots.FirstOrDefault(s => s.Id == slotId)?.Label : null;

    private string? TemplateOfScene(MScene scene)
        => _model.Layout(scene.Layout)?.Json["source"] is JsonObject src && src["mode"]?.GetValue<string>() == "template" ? src["template"]?.GetValue<string>() : null;

    /// <summary>Resolve a wall tile to its scene item (slot facet, floating, hidden, visualization slot, placeholder). Null off-scene.</summary>
    private SceneItem? SceneItemOf(string tileId, WallTile? tile)
    {
        if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } scene) return null;
        var muted = tile?.Kind != null && false; // the wall state carries audio policy, not the live mute; the sheet's Mute toggles by command
        if (scene.Assign.TryGetValue(tileId, out var refId))
        {
            var viz = scene.Visualizations.FirstOrDefault(v => v["id"]?.GetValue<string>() == refId);
            if (viz is not null)
            {
                var src = viz["source"]?.GetValue<string>();
                var sf = src is null ? null : _model.Facet(src);
                // which hidden role the stage draws from: the wizard re-opens there ("Choose the music service…")
                var hidx = src is null ? -1 : scene.Hidden.FindIndex(h => h["facet"]?.GetValue<string>() == src);
                return new SceneItem("music-visualization", sid, tileId, src, sf?.App, refId, sf?.Url, muted, TemplateOfScene(scene), "hidden:" + Math.Max(0, hidx));
            }
            var f = _model.Facet(refId);
            if (f is null) return new SceneItem("placeholder-slot", sid, tileId, null, null, null, null, muted, TemplateOfScene(scene), tileId);
            var video = IsVideoFacet(f);
            return new SceneItem(video ? "video-facet" : "utility-facet", sid, tileId, f.Id, f.App, null, tile?.Url ?? f.Url, muted);
        }
        if (_model.Layout(scene.Layout)?.Slots.Any(s => s.Id == tileId) == true) return new SceneItem("placeholder-slot", sid, tileId, null, null, null, null, muted, TemplateOfScene(scene), tileId);
        // floating / hidden tiles carry the facet id (uniq'd with -2, -3 when repeated)
        var baseId = System.Text.RegularExpressions.Regex.Replace(tileId, @"-\d+$", "");
        foreach (var p in scene.Floating)
            if (p["facet"]?.GetValue<string>() is { } fid && (fid == tileId || fid == baseId) && _model.Facet(fid) is { } ff)
                return new SceneItem("floating-facet", sid, tileId, ff.Id, ff.App, null, tile?.Url ?? ff.Url, muted);
        foreach (var h in scene.Hidden)
            if (h["facet"]?.GetValue<string>() is { } hid && (hid == tileId || hid == baseId) && _model.Facet(hid) is { } hf)
                return new SceneItem("hidden-facet", sid, tileId, hf.Id, hf.App, null, tile?.Url ?? hf.Url, muted);
        return null;
    }

    /// <summary>A video facet: the App's catalog entry says exclusive audio, or the facet's own audio policy does. Utilities are mute + scroll.</summary>
    private bool IsVideoFacet(MFacet f)
    {
        if (f.Music) return false;
        if (f.Json["audio"]?.GetValue<string>() is { } a) return a == "exclusive";
        var app = _model.App(f.App);
        if (app?.Json["render"] is JsonObject r && r["audio"]?.GetValue<string>() is { } ra) return ra == "exclusive";
        return app?.CatalogRef is { } cref && _catalog.Any(c => c.Id == cref && c.Json.Contains("\"exclusive\""));
    }

    // ------------------------------------------------ the context sheet (long-press / right-click / remote-hold)
    private Grid? _sheet;

    /// <summary>The §6a sheet for an item: five entries, each a deep link (disabled with a note when it does not apply - never hidden); closes on action.</summary>
    private void ShowContextSheet(SceneItem item, Windows.Foundation.Point at)
    {
        CloseContextSheet();
        var host = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x30, 0, 0, 0)) };
        Canvas.SetZIndex(host, 950);
        host.PointerPressed += (_, e) => { if (ReferenceEquals(e.OriginalSource, host)) { e.Handled = true; CloseContextSheet(); _routeStack.Clear(); } };
        var panel = new StackPanel { Spacing = 2, Width = 300, Padding = new Thickness(8), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF2, 0x12, 0x13, 0x1A)), CornerRadius = new CornerRadius(10), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x3A, 0xF0, 0xA8, 0x3C)), BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
        var title = item.Kind switch
        {
            "placeholder-slot" => "Empty slot · " + (SlotLabelOf(item.Scene, item.Item) ?? item.Item),
            "music-visualization" => "Visualization · " + (item.App is { } a1 && _model.App(a1) is { } ap1 ? ap1.Name : "no music service yet"),
            _ => (item.App is { } a2 && _model.App(a2) is { } ap2 ? ap2.Name : item.App ?? "") + (item.Facet is { } f && _model.Facet(f) is { } mf ? " · " + mf.Label : ""),
        };
        panel.Children.Add(new TextBlock { Text = title, FontSize = 12, Foreground = Amber, Margin = new Thickness(8, 4, 8, 6), TextTrimming = TextTrimming.CharacterEllipsis });
        void Entry(string label, string? route, string? note, string? glyph)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
            if (glyph is not null) row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 13 });
            var col = new StackPanel();
            col.Children.Add(new TextBlock { Text = label, FontSize = 13 });
            if (note is not null) col.Children.Add(new TextBlock { Text = note, FontSize = 10, Foreground = LeDim });
            row.Children.Add(col);
            var b = new Button { Content = row, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(10, 6, 10, 6), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0)), IsEnabled = route is not null };
            if (route is { } r) b.Click += (_, __) => { CloseContextSheet(); OpenRoute(r); };
            panel.Children.Add(b);
        }
        var esc = (string s) => Uri.EscapeDataString(s);
        if (item.Kind == "placeholder-slot")
        {
            // core contextSheetActions: a template scene answers an empty slot with the wizard, at that role
            Entry("Choose an app…", item.Template is { } tp ? "prism://template/" + esc(tp) + "?scene=" + esc(item.Scene) + "&role=" + esc(item.Role ?? item.Item) : null, item.Template is null ? "not a template scene - use Assign a facet" : null, "");
            Entry("Assign a facet", "prism://item/" + esc(item.Item) + "/swap", null, "");
            Entry("Edit scene", "prism://scene/" + esc(item.Scene) + "/edit?slot=" + esc(item.Item), null, "");
        }
        else
        {
            if (item.Kind == "music-visualization")
            {
                // B-146 (2026-09-08): the source's own group first - sign in, and its page as an inline window with Prism's menu bar
                if (item.App is { } ga && item.Facet is { } gf)
                {
                    var gname = _model.App(ga)?.Name ?? ga;
                    // B-197 (2026-09-09): the header says where the account stands; "Sign in to..." is offered only while it is out
                    var gsession = _musicSources.FirstOrDefault(s => s.app == ga).session;
                    var gstate = gsession == "signed-in" ? "signed in" : gsession == "signed-out" ? "signed out" : "sign-in unknown";
                    panel.Children.Add(new TextBlock { Text = gname + "  ·  " + gstate, FontSize = 10, Foreground = LeDim, Margin = new Thickness(10, 2, 10, 2) });
                    if (gsession != "signed-in") Entry("Sign in to " + gname + "…", "prism://facet/" + esc(gf) + "/reveal?mode=window&signin=1", null, "\uE77B");   // B-193: the inline window, on the sign-in page
                    Entry("Open the full app", "prism://facet/" + esc(gf) + "/reveal?mode=window", "in the middle of the wall - Done tucks it away", "\uE8A7");
                    panel.Children.Add(new Border { Height = 1, Margin = new Thickness(8, 6, 8, 6), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x2A, 0xF0, 0xA8, 0x3C)) });
                }
                // core contextSheetActions: a stage's sheet is about music, not facets (decision 2026-09-06)
                Entry(item.App is null ? "Choose the music service…" : "Change the music service…", "prism://item/" + esc(item.Item) + "/music/service", null, "");
                Entry("Add a music service…", "prism://item/" + esc(item.Item) + "/music/add", null, "");
                if (_musicSources.Count > 0) Entry("Remove a music service…", "prism://item/" + esc(item.Item) + "/music/remove", null, "");   // B-195
                Entry("Intermission…", "prism://item/" + esc(item.Item) + "/music/ads", null, "");   // named for what it is (user, 2026-09-09)
                Entry("Next visual", "prism://item/" + esc(item.Item) + "/visual/next", null, "");
                Entry("Visual style…", "prism://item/" + esc(item.Item) + "/visual/style", null, "");
                // the other services on this wall (2026-09-07): each one's player, straight to sign-in - "App settings" alone went to the source's
                foreach (var s in _musicSources) if (s.app != item.App) Entry(s.session == "signed-out" ? "Sign in to " + s.name + "…" : "Open " + s.name + "…", "prism://facet/" + esc(s.tile) + "/reveal?mode=window" + (s.session == "signed-out" ? "&signin=1" : ""), null, "");   // the same inline window as "Open the full app" (2026-09-08)
                Entry("App settings / sign in", item.App is { } am2 ? "prism://app/" + esc(am2) + "/setup?return=scene" : null, item.App is null ? "no music service yet" : null, "");
                Entry(item.Muted ? "Unmute" : "Mute", "prism://item/" + esc(item.Item) + "/mute", null, "");
            }
            else
            {
            var inSlot = item.Kind is "video-facet" or "utility-facet";
            Entry("Open full page (setup mode)", item.App is { } a ? "prism://app/" + esc(a) + "/setup?return=scene" + (item.Url is { } u ? "&url=" + esc(u) : "") : null, item.App is null ? "no App for this item" : null, "");
            Entry("Edit facet", item.Facet is { } f ? "prism://facet/" + esc(f) + "/edit" : null, item.Facet is null ? "no facet for this item" : null, "");
            Entry("App settings / sign in", item.App is { } a3 ? "prism://app/" + esc(a3) + "/setup?return=scene" : null, item.App is null ? "no App for this item" : null, "");
            Entry("Swap facet in this slot", inSlot ? "prism://item/" + esc(item.Item) + "/swap" : null, inSlot ? null : "not in a slot", "");
            Entry(item.Muted ? "Unmute" : "Mute", "prism://item/" + esc(item.Item) + "/mute", null, "");
            }
        }
        // Concept-scenes §3.2: while a veil is up, the image's provenance is
        // reachable from the sheet - what it is, who holds it, under what licence,
        // and the object page. Read from the local pack manifest; nothing about
        // the image ever reaches the network (§19/§22). Not an action, so it adds
        // no route and the §6a five entries above are unchanged.
        if (_surfaces.VeilAttribution(item.Item) is { } art)
        {
            panel.Children.Add(new Border { Height = 1, Margin = new Thickness(8, 6, 8, 6), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x2A, 0xF0, 0xA8, 0x3C)) });
            panel.Children.Add(new TextBlock { Text = "On the veil now", FontSize = 10, Foreground = LeDim, Margin = new Thickness(10, 0, 10, 2) });
            panel.Children.Add(new TextBlock { Text = art.Line, FontSize = 11, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(10, 0, 10, 4), IsTextSelectionEnabled = true });
            panel.Children.Add(new TextBlock { Text = art.SourceUrl, FontSize = 10, Foreground = LeDim, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(10, 0, 10, 6), IsTextSelectionEnabled = true });
        }
        panel.Margin = new Thickness(Math.Max(0, Math.Min(at.X, _w - 320)), Math.Max(0, Math.Min(at.Y, _h - 300)), 0, 0);
        host.Children.Add(panel);
        RootGrid.Children.Add(host);
        _sheet = host;
    }

    private void CloseContextSheet()
    {
        if (_sheet is null) return;
        RootGrid.Children.Remove(_sheet);
        _sheet = null;
    }

    private async Task ToggleItemMuteAsync(string tileId)
    {
        var wall = await ReadWallStateAsync();
        var raw = await _brain.EvalAsync("PrismRuntime.state()");
        var muted = false;
        try
        {
            if (raw is not null)
            {
                string inner;
                using (var outer = JsonDocument.Parse(raw)) inner = outer.RootElement.ValueKind == JsonValueKind.String ? outer.RootElement.GetString()! : raw;
                using var st = JsonDocument.Parse(inner);
                foreach (var t in st.RootElement.GetProperty("tiles").EnumerateArray())
                    if (t.GetProperty("id").GetString() == tileId && t.TryGetProperty("audio", out var au)) muted = au.GetString() == "mute";
            }
        }
        catch { }
        if (!wall.Tiles.Any(t => t.Id == tileId)) { SetPill("Prism · " + tileId + " is not on the wall"); return; }
        _brain.Call(HostCalls.TileCommand, tileId, muted ? "unmute" : "mute");
        SetPill("Prism · " + tileId + (muted ? " unmuted" : " muted"));
    }

    // ------------------------------------------------ single tap: promote a video facet / reveal a music facet (transient, §16)
    private string? _promotedTile;
    private string? _revealedTile;

    private async Task PromoteFacetAsync(string facetId)
    {
        await ReadModelAsync();
        var (tileId, item) = await TileOfFacetAsync(facetId);
        if (tileId is null || item is null) { SetPill("Prism · " + facetId + " is not on the scene"); _routeStack.RemoveAll(h => h.Def.Id == "facet.full"); return; }
        _promotedTile = tileId;
        _brain.Call(HostCalls.ToggleFullscreen, tileId);            // core maximizes the tile; the pixels move, they don't cut (§16)
        ShowCornerAffordance(item, "Full page · Back returns to the scene");
    }

    /// <summary>
    /// §32 reveal: the hidden facet's native player as a TEMPORARY overlay -
    /// hero-sized - through core's revealMusic (the §16 presence path; the
    /// document is never touched, audio never interrupted); collapseMusic
    /// puts it back to hidden. A visitor, never a resident.
    /// </summary>
    private async Task RevealMusicFacetAsync(string facetOrTileId, bool window = false, bool signIn = false)
    {
        await ReadModelAsync();
        var (tileId, item) = await TileOfFacetAsync(facetOrTileId);
        if (tileId is null || item is null)
        {
            var wall = await ReadWallStateAsync();
            var tile = wall.Tiles.FirstOrDefault(t => t.Id == facetOrTileId);
            item = tile is null ? null : SceneItemOf(tile.Id, tile);
            tileId = tile?.Id;
        }
        if (tileId is null || item is null) { SetPill("Prism · " + facetOrTileId + " is not a hidden facet of this scene"); _routeStack.RemoveAll(h => h.Def.Id == "facet.reveal"); return; }
        _revealedTile = tileId;
        _brain.Call(HostCalls.RevealMusic, tileId, window ? "window" : "hero");
        // concept-scenes §2.5.3: the visualization keeps running underneath, but its chrome steps aside
        // so the player owns its own pixels and taps for as long as it is up.
        ApplyVisualizationRevealState();
        if (window) ShowAppWindowBar(item, tileId); else ShowCornerAffordance(item, "Player revealed · Back tucks it away");
        // B-193 (2026-09-09): "why not just use the same window for login" - a sign-in happens in this window, on the service's
        // own sign-in page; the full-screen setup mode with its status card stays for the rail's App setup
        if (signIn) NavigateToSignIn(item.App, tileId);
    }

    /// <summary>The service's sign-in address from its adapter (Assets/adapters/&lt;app&gt;.json, `login`), else the App's own page.</summary>
    private void NavigateToSignIn(string? appId, string tileId)
    {
        string? login = null;
        try
        {
            if (appId is { Length: > 0 })
            {
                var path = Path.Combine(AppContext.BaseDirectory, "Assets", "adapters", appId + ".json");
                if (File.Exists(path)) { using var doc = JsonDocument.Parse(File.ReadAllText(path)); if (doc.RootElement.TryGetProperty("login", out var l) && l.ValueKind == JsonValueKind.String) login = l.GetString(); }
            }
        }
        catch { }
        login ??= appId is { } a && _model.App(a) is { } app ? app.BaseUrl : null;
        if (login is { Length: > 0 }) { LogLine("sign in: " + tileId + " -> " + login); _surfaces.Navigate(tileId, login); }
    }

    /// <summary>B-194 (2026-09-09): the source the add flow just put on the wall, until its sign-in window closes - signed in, it stays; not, the add is undone.</summary>
    private (string facet, string scene, string app, string name)? _pendingAdd;

    private async Task ResolvePendingAddAsync(string tileId)
    {
        if (_pendingAdd is not { } pa || pa.facet != tileId) return;
        _pendingAdd = null;
        await RefreshMusicSourcesAsync();
        var src = _musicSources.FirstOrDefault(s => s.tile == pa.facet || s.app == pa.app);
        if (src.session == "signed-in") { SetPill("Prism · " + pa.name + " is signed in and on this wall. Open Quick play (⟲) to pick something"); return; }
        await ReadModelAsync();
        if (_model.Scene(pa.scene) is not { } scene) return;
        var s = scene.Clone();
        var before = s.Hidden.Count;
        s.Hidden.RemoveAll(h => h["facet"]?.GetValue<string>() == pa.facet);
        if (s.Hidden.Count == before) return;
        foreach (var v in s.Visualizations) if (v["source"]?.GetValue<string>() == pa.facet) v["source"] = s.Hidden.FirstOrDefault()?["facet"]?.GetValue<string>();
        var raw = await ModelCallAsync("modelSaveScene", s.ToJson());
        LogLine("call {\"fn\":\"music.service.cancel\",\"scene\":\"" + pa.scene + "\",\"app\":\"" + pa.app + "\",\"facet\":\"" + pa.facet + "\"}");
        SetPill("Prism · " + pa.name + " wasn't added because the sign-in was cancelled. The App stays under Apps in the rail");
        await ReadModelAsync();
        await ApplySceneAsync(pa.scene);
    }

    /// <summary>Tuck a revealed player away (the facet.reveal collapse) with or without its route on the stack.</summary>
    private void CollapseRevealNow()
    {
        if (_revealedTile is null) { CloseCornerAffordance(); CloseAppWindowBar(); return; }
        _brain.Call(HostCalls.CollapseMusic);       // section 16 crossfade back to hidden; the audio never stopped
        var closed = _revealedTile;
        _revealedTile = null;
        if (_pendingAdd is { } pa && pa.facet == closed) _ = ResolvePendingAddAsync(closed);   // B-194: the add flow's sign-in window closed
        ApplyVisualizationRevealState();            // the beams were never stopped - the chrome simply comes back over them
        CloseCornerAffordance();
        CloseAppWindowBar();
    }

    private void CollapseTransient(RouteHit hit)
    {
        if (hit.Def.Id == "facet.full" && _promotedTile is { } p) { if (_screenFsTile is null) _brain.Call(HostCalls.ToggleFullscreen, p); _promotedTile = null; }
        if (hit.Def.Id == "facet.reveal" && _revealedTile is not null)
        {
            _brain.Call(HostCalls.CollapseMusic);       // §16 crossfade back to hidden; the audio never stopped
            var closed = _revealedTile;
            _revealedTile = null;
            if (_pendingAdd is { } pa && pa.facet == closed) _ = ResolvePendingAddAsync(closed);   // B-194: the add flow's sign-in window closed
            ApplyVisualizationRevealState();            // the beams were never stopped - the chrome simply comes back over them
        }
        CloseCornerAffordance();
        CloseAppWindowBar();
    }

    private async Task<(string? TileId, SceneItem? Item)> TileOfFacetAsync(string facetId)
    {
        var wall = await ReadWallStateAsync();
        foreach (var t in wall.Tiles)
        {
            var item = SceneItemOf(t.Id, t);
            if (item is not null && item.Facet == facetId) return (t.Id, item);
        }
        return (null, null);
    }

    // ------------------------------------------------ the corner affordance during full-page / reveal
    private Border? _corner;

    private void ShowCornerAffordance(SceneItem item, string caption)
    {
        CloseCornerAffordance();
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        row.Children.Add(new TextBlock { Text = caption, Foreground = Muted, FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(4, 0, 6, 0) });
        var esc = (string s) => Uri.EscapeDataString(s);
        // a revealed music player is a visitor (§2.5.3): its page is not a facet anyone crops, so the bar offers settings and Back only
        var edit = Small("Edit this facet", () => { if (item.Facet is { } f) OpenRoute("prism://facet/" + esc(f) + "/edit"); });
        edit.IsEnabled = item.Facet is not null;
        if (item.Kind == "music-visualization" || item.Kind == "hidden-facet") edit.Visibility = Visibility.Collapsed;
        var settings = Small("App settings", () => { if (item.App is { } a) OpenRoute("prism://app/" + esc(a) + "/setup?return=scene"); });
        settings.IsEnabled = item.App is not null;
        var back = Small("Back", RouteBack);
        row.Children.Add(edit); row.Children.Add(settings); row.Children.Add(back);
        _corner = new Border
        {
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 10, 12, 0),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xCC, 0x12, 0x13, 0x1A)), CornerRadius = new CornerRadius(8), Padding = new Thickness(6), Opacity = 0.85,
            BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x3A, 0xF0, 0xA8, 0x3C)), BorderThickness = new Thickness(1), Child = row,
        };
        Canvas.SetZIndex(_corner, 940);
        RootGrid.Children.Add(_corner);
    }

    // ------------------------------------------------ B-146: the inline app window's menu bar and frame
    private Grid? _appWindow;
    private (SceneItem item, string tileId)? _appWindowFor;   // B-196: what the bar frames, so a resize can lay it out again

    /// <summary>B-196 (2026-09-09): the wall resized while the inline app window was up - the bar and frame are laid out again from
    /// the new size (core moves the page itself to its reveal rect for the new viewport).</summary>
    private void RelayoutAppWindowBar()
    {
        if (_appWindow is null || _appWindowFor is not { } f) return;
        ShowAppWindowBar(f.item, f.tileId);
    }

    /// <summary>
    /// "Open the full app" (2026-09-08): the hidden source's page as a window in the middle of the wall - core places the
    /// surface (presence "window", three quarters of the wall) - with a bar of Prism's own along its top: the service's
    /// name, Sign in, Quick play, Start over, Mute, Done. Not a separate OS window: nothing on the taskbar. Done (or Back,
    /// or Esc) tucks the page away again; the audio never stops.
    /// </summary>
    private void ShowAppWindowBar(SceneItem item, string tileId)
    {
        CloseAppWindowBar();
        var vw = TileCanvas.ActualWidth > 0 ? TileCanvas.ActualWidth : _w; var vh = TileCanvas.ActualHeight > 0 ? TileCanvas.ActualHeight : _h;
        var w = Math.Round(vw * 0.74); var h = Math.Round(vh * 0.76);
        var x = Math.Round((vw - w) / 2); var y = Math.Round((vh - h) / 2) + 20;   // core's windowRevealRect, the same numbers
        const double barH = 40;
        var name = item.App is { } a && _model.App(a) is { } ap ? ap.Name : "Player";
        var esc = (string s) => Uri.EscapeDataString(s);
        var host = new Grid { IsHitTestVisible = true, Background = null };
        Canvas.SetZIndex(host, 940);
        // the frame: a hairline around the page, no fill - the page's pixels and taps are its own
        var frame = new Border { Width = w + 2, Height = h + barH + 2, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(x - 1, y - barH - 1, 0, 0), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x66, 0xF0, 0xA8, 0x3C)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), IsHitTestVisible = false };
        host.Children.Add(frame);
        // VS-1: the same strip App setup draws (AppBar), in this window's kind
        var bar = AppBar(AppKindOf(item.App), name, tileId, item, null, onHome: null, onDone: () => { LogLine("app window bar: Done clicked (route stack " + _routeStack.Count + ")"); RouteBack(); });
        bar.Width = w; bar.HorizontalAlignment = HorizontalAlignment.Left; bar.VerticalAlignment = VerticalAlignment.Top; bar.Margin = new Thickness(x, y - barH, 0, 0); bar.CornerRadius = new CornerRadius(8, 8, 0, 0);
        var done = (Button)((StackPanel)bar.Child).Children[^1];
        host.Children.Add(bar);
        RootGrid.Children.Add(host);
        _appWindow = host;
        _appWindowFor = (item, tileId);
        // 2026-09-08 diagnostics for "can't click anything including Done": what the bar actually receives, handled or not
        static string Describe(object? o) => o is Button b ? "Button '" + (b.Content as string ?? "?") + "'" : o?.GetType().Name ?? "-";
        host.AddHandler(UIElement.PointerPressedEvent, new Microsoft.UI.Xaml.Input.PointerEventHandler((_, e) => LogLine("app window bar: pressed on " + Describe(e.OriginalSource) + " handled=" + e.Handled)), true);
        host.AddHandler(UIElement.PointerReleasedEvent, new Microsoft.UI.Xaml.Input.PointerEventHandler((_, e) => LogLine("app window bar: released on " + Describe(e.OriginalSource) + " handled=" + e.Handled)), true);
        done.PointerCaptureLost += (_, __) => LogLine("app window bar: Done lost pointer capture");
    }

    private const double AppBarHeight = 40;

    /// <summary>
    /// VS-1 (2026-09-19): what kind of App this is for the header strip - "music" (any facet of it is a music facet),
    /// "video" (its pages carry exclusive audio: the App's own render word, or its catalog entry's), else "web".
    /// </summary>
    private string AppKindOf(string? appId)
    {
        if (appId is null) return "web";
        if (_model.Facets.Any(f => f.App == appId && f.Music)) return "music";
        var app = _model.App(appId);
        if (app?.Json["render"] is JsonObject r && r["audio"]?.GetValue<string>() == "exclusive") return "video";
        if (app?.CatalogRef is { } cref && _catalog.Any(c => c.Id == cref && c.Json.Contains("\"exclusive\""))) return "video";
        return "web";
    }

    /// <summary>
    /// The service header strip, one component in two kinds (VS-1): the service's name, then for a MUSIC service Sign in ·
    /// Quick play · Start over · Mute · Done, for a VIDEO service Sign in · Watch · Home · Mute · Done (Watch opens the hub,
    /// Home the App's own page), for anything else Sign in · Home · Done. The inline app window and App setup both draw it;
    /// the last child of its row is always Done.
    /// </summary>
    private Border AppBar(string kind, string name, string tileId, SceneItem? item, string? loginUrl, Action? onHome, Action onDone)
    {
        var esc = (string s) => Uri.EscapeDataString(s);
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new TextBlock { Text = name.ToUpperInvariant(), Foreground = Amber, FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 10, 0), CharacterSpacing = 120 });
        if (item is not null) row.Children.Add(Small("Sign in", () => NavigateToSignIn(item.App, tileId)));   // B-193: here, not the setup mode
        else if (loginUrl is not null) row.Children.Add(Small("Sign in", () => _surfaces.Navigate(tileId, loginUrl)));
        if (kind == "music" && item is not null)
        {
            var quick = Small("Quick play", () => { });
            quick.Click += (_, __) => _ = ShowQuickPlayAsync(quick, tileId);
            row.Children.Add(quick);
            row.Children.Add(Small("Start over", () => _brain.Call(HostCalls.TileCommand, tileId, "restart")));
        }
        if (kind == "video")
        {
            var watch = Small("Watch", () => _ = ShowVideoHubAsync());
            ToolTipService.SetToolTip(watch, "The Video player's page: Continue watching and My list from every service, each service's rows.");
            row.Children.Add(watch);
        }
        if (onHome is not null) row.Children.Add(Small("Home", onHome));
        if (kind != "web")
        {
            if (item is not null) row.Children.Add(Small("Mute / unmute", () => OpenRoute("prism://item/" + esc(item.Item) + "/mute")));
            else { var muted = false; row.Children.Add(Small("Mute / unmute", () => { muted = !muted; _surfaces.SetMuted(tileId, muted); })); }
        }
        var done = Small("Done", onDone);
        done.Margin = new Thickness(12, 0, 0, 0);
        row.Children.Add(done);
        return new Border { Height = AppBarHeight, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xF0, 0x12, 0x13, 0x1A)), Padding = new Thickness(6, 0, 6, 0), Child = row };
    }

    private void CloseAppWindowBar()
    {
        if (_appWindow is null) return;
        RootGrid.Children.Remove(_appWindow);
        _appWindow = null;
        _appWindowFor = null;
    }

    private void CloseCornerAffordance()
    {
        if (_corner is null) return;
        RootGrid.Children.Remove(_corner);
        _corner = null;
    }

    // ------------------------------------------------ needs-attention badges (the badge IS the shortcut)
    private readonly Dictionary<string, Button> _badges = new();

    private static string NeedsAttentionRoute(string appId) => "prism://app/" + Uri.EscapeDataString(appId) + "/setup?return=scene&signin=1";   // core needsAttentionRoute: the sign-in wizard

    /// <summary>Re-place a badge on every scene item whose App needs attention; tap → prism://app/&lt;id&gt;/setup, sign-in returns with the facet reloading.</summary>
    private async void RefreshSceneBadges()
    {
        try { await RefreshSceneBadgesCore(); }
        catch (Exception ex) { LogLine("badge refresh failed: " + ex.GetType().Name + ": " + ex.Message); }   // async void: an escape would end the process
    }

    /// <summary>B-217: core writes an App's status from a session report only once it has stood for 15 s (a signed-in at once);
    /// the badges re-read the model and redraw once that wait has passed, so a badge never outlives the status it shows.</summary>
    private void NoteSessionEvent(string eventJson)
    {
        if (!eventJson.Contains("\"type\":\"session\"", StringComparison.Ordinal)) return;
        _ = Task.Delay(16_500).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(RefreshSceneBadges));
    }

    private async Task RefreshSceneBadgesCore()
    {
        foreach (var b in _badges.Values) RootGrid.Children.Remove(b);
        _badges.Clear();
        await ReadModelAsync();   // B-217: the App's status as core holds it now, not as the boot read it
        if (_model.ActiveScene is null) return;
        var wall = await ReadWallStateAsync();
        foreach (var t in wall.Tiles)
        {
            var item = SceneItemOf(t.Id, t);
            if (item?.App is not { } appId || _model.App(appId) is not { } app) continue;
            // B-133 (2026-09-07): a hidden music source parked off the stage is not the wall's business to flag - Quick play
            // marks it "sign in" where it matters; the badge is for a page a room can see
            if (item.Kind == "hidden-facet") continue;
            var attention = app.SetupStatus == "needs-attention" || (t.Url is { } u && u.Contains("login", StringComparison.OrdinalIgnoreCase));
            if (!attention || _surfaces.RectOf(t.Id) is not { } r || r.W < 40) continue;
            var badge = new Button
            {
                Content = new TextBlock { Text = "⚠  " + app.Name + " needs attention. Please sign in", FontSize = 11 },
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xE0, 0xD0, 0x6A, 0x5A)), Foreground = LeInk, Padding = new Thickness(8, 3, 8, 3), CornerRadius = new CornerRadius(6),
                HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(r.X + 8, r.Y + 8, 0, 0),
            };
            ToolTipService.SetToolTip(badge, "One tap: the App's setup opens; finishing sign-in returns here with the facet reloading.");
            badge.Click += (_, __) => OpenRoute(NeedsAttentionRoute(appId));
            Canvas.SetZIndex(badge, 930);
            RootGrid.Children.Add(badge);
            _badges[t.Id] = badge;
        }
    }

    // ------------------------------------------------ §14 split-listening chips

    private readonly List<FrameworkElement> _listenChips = new();

    /// <summary>
    /// docs/dashboard-schema.md §14, bottom-left of the wall: who is listening
    /// privately, and the slot they are hearing.
    ///
    /// EVERY listener hears the SAME slot. §14 streams the frame's own audio -
    /// one capture of system output - so a private listener hears whatever owns
    /// audio under §3, and the chips all name it. Two phones on two different
    /// games would need per-surface capture (B-25's process-loopback upgrade)
    /// and a §14 amendment; the maintainer's decision of 2026-09-03 was to draw
    /// what §14 supports rather than imply a capability it has not got, and the
    /// website mockup was redrawn to match (concept-scenes §2.2).
    ///
    /// Core composes the chips (`listeningChips`); the pairing token stays
    /// core-side and never reaches a label - a chip is on a wall a room can see.
    /// </summary>
    private async void RefreshListeningChips()
    {
        foreach (var c in _listenChips) RootGrid.Children.Remove(c);
        _listenChips.Clear();

        var json = await ModelCallAsync(HostCalls.ListeningChips);
        if (string.IsNullOrWhiteSpace(json)) return;
        List<ListeningChipRow> chips;
        try { chips = ListeningChipRow.Parse(json); } catch { return; }
        if (chips.Count == 0) return;                       // nobody listening: the wall carries nothing

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal, Spacing = 6,
            HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(12, 0, 0, 12), IsHitTestVisible = false,
        };
        foreach (var c in chips)
        {
            var text = c.Label + (c.Slot is { Length: > 0 } slot ? "  ▸  " + SlotLabel(slot) : "");
            var paused = c.State == "paused";
            var chip = new Border
            {
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(paused ? (byte)0x99 : (byte)0xCC, 0x12, 0x13, 0x1A)),
                BorderBrush = paused ? VizDimInk : Amber,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(9, 3, 9, 3),
            };
            var label = new TextBlock
            {
                Text = "♪  " + text + (paused ? "  (paused)" : ""),
                FontSize = 11,
                Foreground = paused ? VizDimInk : LeInk,
            };
            chip.Child = label;
            ToolTipService.SetToolTip(chip, paused
                ? "This phone's stream stopped unexpectedly. The speakers stay muted for the grace period rather than blaring mid-movie (§14)."
                : "Listening on " + c.Label + " over " + c.Transport + ". §14 streams the wall's own audio, so every phone hears whatever owns the sound.");
            row.Children.Add(chip);
        }
        Canvas.SetZIndex(row, 925);
        RootGrid.Children.Add(row);
        _listenChips.Add(row);
    }

    /// <summary>A slot's human label for a chip: the scene's name for it, else the id.</summary>
    private string SlotLabel(string slotId)
    {
        if (_model.ActiveScene is { } sceneId && _model.Scene(sceneId) is { } scene)
        {
            if (_model.Layout(scene.Layout) is { } layout)
            {
                foreach (var s in layout.Slots)
                    if (s.Id == slotId) return s.Id;
            }
        }
        return slotId;
    }

    private sealed record ListeningChipRow(string Id, string Label, string? Slot, string Transport, string State)
    {
        public static List<ListeningChipRow> Parse(string json)
        {
            var outp = new List<ListeningChipRow>();
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return outp;
            foreach (var e in doc.RootElement.EnumerateArray())
            {
                var label = e.TryGetProperty("label", out var l) ? l.GetString() ?? "" : "";
                if (label.Length == 0) continue;
                outp.Add(new ListeningChipRow(
                    e.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "",
                    label,
                    e.TryGetProperty("slot", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null,
                    e.TryGetProperty("transport", out var t) ? t.GetString() ?? "" : "",
                    e.TryGetProperty("state", out var st) ? st.GetString() ?? "" : ""));
            }
            return outp;
        }
    }

    // ------------------------------------------------ App settings card (prism://app/:id/settings)
    private Grid? _appCard;

    private async Task OpenAppSettingsCardAsync(string appId)
    {
        CloseAppSettingsCard();
        await ReadModelAsync();
        var app = _model.App(appId);
        if (app is null) { SetPill("Prism · no App " + appId); return; }
        var overlay = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xEE, 0x0F, 0x12, 0x16)) };
        Canvas.SetZIndex(overlay, 905);
        overlay.PointerPressed += (_, e) => { if (ReferenceEquals(e.OriginalSource, overlay)) { e.Handled = true; RouteDone(); CloseAppSettingsCard(); } };
        var panel = new StackPanel { Width = 520, Spacing = 8, Padding = new Thickness(22), Background = LePanel, CornerRadius = new CornerRadius(12), BorderBrush = Amber, BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        head.Children.Add(new TextBlock { Text = app.Name, FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = LeInk });
        head.Children.Add(StatusBadgeFor(app));
        panel.Children.Add(head);
        panel.Children.Add(Meta(app.BaseUrl));
        panel.Children.Add(Meta("Profile: " + app.ProfileId + "  (the session lives here and is never wiped - §10)" + (app.Adapter is { } ad ? "  ·  adapter " + ad : "") + (app.CatalogRef is { } cr ? "  ·  catalog " + cr : "")));
        panel.Children.Add(Section("SETUP"));
        panel.Children.Add(Primary("Setup mode - sign in, browse, configure…", () => OpenRoute("prism://app/" + Uri.EscapeDataString(appId) + "/setup?return=scene")));
        panel.Children.Add(Meta("Status is verified passively: a facet landing on a login page flips the App to needs attention."));
        panel.Children.Add(Section("FACETS"));
        var facets = _model.Facets.Where(f => f.App == appId).ToList();
        if (facets.Count == 0) panel.Children.Add(Meta("No facets yet."));
        foreach (var f in facets)
        {
            var fid = f.Id;
            panel.Children.Add(AppRow(f.Label, f.SlotClass + "  ·  " + Shorten(f.Url, 50), () => OpenRoute("prism://facet/" + Uri.EscapeDataString(fid) + "/edit")));
        }
        panel.Children.Add(Small("＋  New facet of " + app.Name + "…", () => _ = NewFacetAsync(appId, null)));
        panel.Children.Add(Section("AUDIO DEFAULT"));
        var audioRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var current = app.Json["render"] is JsonObject r0 && r0["audio"]?.GetValue<string>() is { } a0 ? a0 : "(unset)";
        foreach (var pol in new[] { "exclusive", "mix", "mute" })
        {
            var p = pol;
            var b = new ToggleButton { Content = pol, IsChecked = pol == current, Padding = new Thickness(10, 4, 10, 4) };
            b.Click += async (_, __) =>
            {
                var o = (JsonObject)app.Json.DeepClone();
                var render = o["render"] as JsonObject ?? new JsonObject();
                render["audio"] = p; o["render"] = render;
                await ModelCallAsync("modelSaveApp", o);
                await OpenAppSettingsCardAsync(appId);
            };
            audioRow.Children.Add(b);
        }
        panel.Children.Add(audioRow);
        panel.Children.Add(Meta("Every facet of the App inherits this unless its placement says otherwise (templates set the hero exclusive, utilities mute)."));
        var done = Small("Done", () => { RouteDone(); CloseAppSettingsCard(); });
        done.Margin = new Thickness(0, 10, 0, 0);
        panel.Children.Add(done);
        overlay.Children.Add(panel);
        RootGrid.Children.Add(overlay);
        _appCard = overlay;
    }

    private void CloseAppSettingsCard()
    {
        if (_appCard is null) return;
        RootGrid.Children.Remove(_appCard);
        _appCard = null;
    }

    // ------------------------------------------------ music transport (§32 layer 3): pass-through, disabled-not-hidden
    private sealed record TransportState(string TileId, string Facet, bool Playing, bool Play, bool Pause, bool Prev, bool Next, bool SeekBack, bool SeekFwd, string? Title, string? Artist, string? Artwork, double? Position, double? Duration, string? Album = null, string? Collection = null, string? Pending = null, string? PendingFailed = null, string? Session = null, string? CollectionKind = null, bool Intermission = false, bool Rate = false, int Rating = 0, string? Offer = null, string? AdCount = null, string? ResumeTitle = null, string? ResumeArtist = null, string? ResumeLabel = null, string? Order = null, string? OrderName = null, string? OrderSpot = null, string? OrderKind = null, string? OrderId = null, string? CollectionId = null, bool Repeat = false, int? OrderPass = null, string? Work = null);

    /// <summary>The hidden music facets of the active scene with what their pages published (Media Session via the tile's nowPlaying) - what transport may offer.</summary>
    private async Task<List<TransportState>> ReadTransportAsync()
    {
        var out_ = new List<TransportState>();
        if (_model.ActiveScene is not { } sid || _model.Scene(sid) is not { } scene) return out_;
        var raw = await _brain.EvalAsync("PrismRuntime.state()");
        if (raw is null) return out_;
        try
        {
            string inner;
            using (var outer = JsonDocument.Parse(raw)) inner = outer.RootElement.ValueKind == JsonValueKind.String ? outer.RootElement.GetString()! : raw;
            using var st = JsonDocument.Parse(inner);
            foreach (var t in st.RootElement.GetProperty("tiles").EnumerateArray())
            {
                var id = t.GetProperty("id").GetString() ?? "";
                var item = SceneItemOf(id, null);
                if (item?.Kind != "hidden-facet" || item.Facet is null) continue;
                var playing = false; string? title = null, artist = null, art = null, album = null, collection = null, collectionKind = null, pending = null, pendingFailed = null, offer = null; double? pos = null, dur = null; var actions = new HashSet<string>();
                var session = t.TryGetProperty("session", out var se) && se.ValueKind == JsonValueKind.String ? se.GetString() : null;   // B-123
                var inBreak = t.TryGetProperty("intermission", out var ib) && ib.ValueKind == JsonValueKind.True;   // B-143: the break the wall covers
                var canRate = t.TryGetProperty("rate", out var rt) && rt.ValueKind == JsonValueKind.True;   // B-155
                var adCount = t.TryGetProperty("adCount", out var acn) && acn.ValueKind == JsonValueKind.String ? acn.GetString() : null;   // 2026-09-15: the page's own "2 of 3" for the break it is under
                var rating = 0;
                // B-204 (2026-09-15): nothing loaded, but core remembers what this tile played - Play resumes it and the block names it
                string? resumeTitle = null, resumeArtist = null, resumeLabel = null;
                // Play orders (2026-09-17): the standing order this tile plays in, and the collection it applies to
                string? order = null, orderName = null, orderSpot = null, orderKind = null, orderId = null, collectionId = null; int? orderPass = null;
                var repeat = t.TryGetProperty("musicRepeat", out var mr) && mr.ValueKind == JsonValueKind.True;   // 2026-09-18: the standing repeat
                // 2026-09-18: the work in hand (a long track-list read) for the status feed
                string? work = null;
                if (t.TryGetProperty("musicWork", out var mw) && mw.ValueKind == JsonValueKind.Object)
                {
                    var what = mw.TryGetProperty("what", out var mww) && mww.ValueKind == JsonValueKind.String ? mww.GetString() : "working";
                    var wname = mw.TryGetProperty("name", out var mwn) && mwn.ValueKind == JsonValueKind.String ? mwn.GetString() : null;
                    var wcount = mw.TryGetProperty("count", out var mwc) && mwc.ValueKind == JsonValueKind.Number ? mwc.GetInt32() : (int?)null;
                    var wtotal = mw.TryGetProperty("total", out var mwt) && mwt.ValueKind == JsonValueKind.Number ? mwt.GetInt32() : (int?)null;
                    var werr = mw.TryGetProperty("error", out var mwe) && mwe.ValueKind == JsonValueKind.String ? mwe.GetString() : null;
                    work = werr is { Length: > 0 }
                        ? "!" + what + (wname is { Length: > 0 } ? " of " + wname : "") + " - " + werr
                        : what + (wname is { Length: > 0 } ? " of " + wname : "") + (wcount is int wc ? "  " + wc.ToString("n0") + (wtotal is int wt && wt > 0 ? " of " + wt.ToString("n0") : "") : "") + "…";
                }
                if (t.TryGetProperty("musicOrder", out var mo) && mo.ValueKind == JsonValueKind.Object)
                {
                    order = mo.TryGetProperty("label", out var mol) && mol.ValueKind == JsonValueKind.String ? mol.GetString() : null;
                    orderName = mo.TryGetProperty("name", out var mon) && mon.ValueKind == JsonValueKind.String ? mon.GetString() : null;
                    orderKind = mo.TryGetProperty("kind", out var mok) && mok.ValueKind == JsonValueKind.String ? mok.GetString() : null;
                    orderId = mo.TryGetProperty("id", out var moi) && moi.ValueKind == JsonValueKind.String ? moi.GetString() : null;
                    if (order == "in order") order = null;
                    // the saved spot: "412 of 1612" - a Prism-ordered play's place in its list
                    if (mo.TryGetProperty("spot", out var mos) && mos.ValueKind == JsonValueKind.Number && mo.TryGetProperty("count", out var moc) && moc.ValueKind == JsonValueKind.Number) orderSpot = mos.GetInt32() + " of " + moc.GetInt32();
                    if (mo.TryGetProperty("pass", out var mop) && mop.ValueKind == JsonValueKind.Number) orderPass = mop.GetInt32();
                }
                if (t.TryGetProperty("resume", out var rsm) && rsm.ValueKind == JsonValueKind.Object)
                {
                    resumeTitle = rsm.TryGetProperty("title", out var rst) && rst.ValueKind == JsonValueKind.String ? rst.GetString() : null;
                    resumeArtist = rsm.TryGetProperty("artist", out var rsa) && rsa.ValueKind == JsonValueKind.String ? rsa.GetString() : null;
                    resumeLabel = rsm.TryGetProperty("label", out var rsl) && rsl.ValueKind == JsonValueKind.String ? rsl.GetString() : null;
                }
                // a quick-play pick the page has not started yet: the loading signal (core's musicPending)
                if (t.TryGetProperty("musicPending", out var mp) && mp.ValueKind == JsonValueKind.Object)
                {
                    pending = mp.TryGetProperty("name", out var pn) && pn.ValueKind == JsonValueKind.String ? pn.GetString() : null;
                    pendingFailed = mp.TryGetProperty("failed", out var pf) && pf.ValueKind == JsonValueKind.String ? pf.GetString() : null;
                }
                if (t.TryGetProperty("nowPlaying", out var np) && np.ValueKind == JsonValueKind.Object)
                {
                    playing = np.TryGetProperty("playing", out var p) && p.ValueKind == JsonValueKind.True;   // the page's own word (B-134: ORing the playback signal made the button stick on Pause)
                    title = np.TryGetProperty("title", out var ti) && ti.ValueKind == JsonValueKind.String ? ti.GetString() : null;
                    artist = np.TryGetProperty("artist", out var ar) && ar.ValueKind == JsonValueKind.String ? ar.GetString() : null;
                    album = np.TryGetProperty("album", out var al) && al.ValueKind == JsonValueKind.String ? al.GetString() : null;
                    if (np.TryGetProperty("context", out var cx) && cx.ValueKind == JsonValueKind.Object)
                    {
                        if (cx.TryGetProperty("label", out var cl) && cl.ValueKind == JsonValueKind.String) collection = cl.GetString();
                        if (cx.TryGetProperty("kind", out var ck) && ck.ValueKind == JsonValueKind.String) collectionKind = ck.GetString();   // B-141: Start over's wording
                        if (cx.TryGetProperty("id", out var cid) && cid.ValueKind == JsonValueKind.String) collectionId = cid.GetString();   // the order button acts on it (2026-09-17)
                        if (cx.TryGetProperty("rating", out var cr) && cr.ValueKind == JsonValueKind.Number) rating = cr.GetInt32();   // B-155
                        // 2026-09-14: the service's own offer on screen (Pandora's "Get more skips" at the skip limit) - shown as a
                        // button on the player; a press is tileCommand("offer"), and the ad it starts is a break like any other
                        if (cx.TryGetProperty("offer", out var co) && co.ValueKind == JsonValueKind.Object && co.TryGetProperty("label", out var col) && col.ValueKind == JsonValueKind.String) offer = col.GetString();
                    }
                    art = np.TryGetProperty("artwork", out var aw) && aw.ValueKind == JsonValueKind.String ? aw.GetString() : null;
                    if (np.TryGetProperty("actions", out var ac) && ac.ValueKind == JsonValueKind.Array) foreach (var a in ac.EnumerateArray()) if (a.GetString() is { } s) actions.Add(s);
                    if (np.TryGetProperty("position", out var po) && po.ValueKind == JsonValueKind.Number) pos = po.GetDouble();
                    if (np.TryGetProperty("duration", out var du) && du.ValueKind == JsonValueKind.Number) dur = du.GetDouble();
                }
                // core's transportAvailability: registered actions enable, play/pause also follow the state; the rest render disabled
                out_.Add(new TransportState(id, item.Facet, playing, actions.Contains("play") || !playing && title is not null || resumeTitle is not null, actions.Contains("pause") || playing, actions.Contains("previoustrack"), actions.Contains("nexttrack"), actions.Contains("seekbackward"), actions.Contains("seekforward"), title, artist, art, pos, dur, album, collection, pending, pendingFailed, session, collectionKind, inBreak, canRate, rating, offer, adCount, resumeTitle, resumeArtist, resumeLabel, order, orderName, orderSpot, orderKind, orderId, collectionId, repeat, orderPass, work));
            }
        }
        catch { }
        return out_;
    }

    /// <summary>The transport row for one source: play/pause · prev · next · reveal, every control present, unmapped ones disabled.</summary>
    private StackPanel TransportRow(TransportState s, bool showReveal = true)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        Button Ctl(string glyph, string tip, bool enabled, Action click)
        {
            var b = new Button { Content = new FontIcon { Glyph = glyph, FontSize = 14 }, Padding = new Thickness(8, 5, 8, 5), IsEnabled = enabled };
            ToolTipService.SetToolTip(b, enabled ? tip : tip + ". The player didn't register this action (§32 layer 3: pass-through only, never simulated)");
            b.Click += (_, __) => click();
            return b;
        }
        row.Children.Add(Ctl(GlyphPrevious, "Previous", s.Prev, () => _brain.Call(HostCalls.TileCommand, s.TileId, "prev")));
        row.Children.Add(Ctl(s.Playing ? GlyphPause : GlyphPlay, s.Playing ? "Pause" : "Play", s.Playing ? s.Pause : s.Play, () => _brain.Call(HostCalls.TileCommand, s.TileId, s.Playing ? "pause" : "play")));
        row.Children.Add(Ctl(GlyphNext, "Next", s.Next, () => _brain.Call(HostCalls.TileCommand, s.TileId, "next")));
        if (showReveal)
        {
            var reveal = Ctl("", "Reveal the player (transient - Back tucks it away)", true, () => OpenRoute("prism://facet/" + Uri.EscapeDataString(s.Facet) + "/reveal"));
            row.Children.Add(reveal);
        }
        return row;
    }

    /// <summary>The app menu's Now playing: one row per hidden music facet (§32: controls in the pill / Control Center too); long-press-equivalent = the row's own submenu with the §6a sheet actions.</summary>
    private async Task<MenuFlyoutSubItem> BuildNowPlayingMenuAsync()
    {
        var sub = new MenuFlyoutSubItem { Text = "Now playing", Icon = Glyph("") };
        var sources = await ReadTransportAsync();
        if (sources.Count == 0) { sub.Items.Add(new MenuFlyoutItem { Text = "No hidden music facet in this scene", IsEnabled = false }); return sub; }
        foreach (var s in sources)
        {
            var app = _model.Facet(s.Facet) is { } f ? _model.App(f.App)?.Name ?? f.App : s.Facet;
            sub.Items.Add(new MenuFlyoutItem { Text = app + "  ·  " + (s.Title is { } t ? t + (s.Artist is { } a ? " - " + a : "") : "nothing playing"), IsEnabled = false });
            var play = Item(s.Playing ? "Pause" : "Play", s.Playing ? GlyphPause : GlyphPlay, null, () => _brain.Call(HostCalls.TileCommand, s.TileId, s.Playing ? "pause" : "play"));
            play.IsEnabled = s.Playing ? s.Pause : s.Play;
            sub.Items.Add(play);
            var prev = Item("Previous", GlyphPrevious, null, () => _brain.Call(HostCalls.TileCommand, s.TileId, "prev")); prev.IsEnabled = s.Prev; sub.Items.Add(prev);
            var next = Item("Next", GlyphNext, null, () => _brain.Call(HostCalls.TileCommand, s.TileId, "next")); next.IsEnabled = s.Next; sub.Items.Add(next);
            sub.Items.Add(Item("Reveal the player (transient)", "", null, () => OpenRoute("prism://facet/" + Uri.EscapeDataString(s.Facet) + "/reveal")));
            sub.Items.Add(Item("Edit facet", "", null, () => OpenRoute("prism://facet/" + Uri.EscapeDataString(s.Facet) + "/edit")));
            if (_model.Facet(s.Facet) is { } ff) sub.Items.Add(Item("App settings / sign in", "", null, () => OpenRoute("prism://app/" + Uri.EscapeDataString(ff.App) + "/setup?return=scene")));
            sub.Items.Add(new MenuFlyoutSeparator());
        }
        return sub;
    }

    // ------------------------------------------------ wiring (called from WireMenuGrip, the host's Loaded hook the menu owns)
    private void WireSceneModelUi()
    {
        WireVisualizations();
        // §6a routes arriving from core (a phone's tap / sheet / action, a held remote key): the same router, not echoed back
        UiRouteRequested += (route, source, id) => RootGrid.DispatcherQueue.TryEnqueue(() => OpenRoute(route, source));
        TileCanvas.SizeChanged += (_, __) => { if (_model.ActiveScene is not null) { _ = SyncVisualizationsAsync(); RefreshSceneBadges(); } };
        // Startup: core restores the active scene from the store, so nothing calls
        // ApplySceneAsync and this is the ONLY path that builds visualization
        // chrome. It used to fire once and give up if _model.ActiveScene was still
        // null - which it is while core is booting - so a wall launched straight
        // into a Music Lounge had beams and NO chrome: no transport, no metadata,
        // nothing to tap, until you happened to apply a scene or resize the window.
        // Retry on the same cadence an apply uses, and do not gate on ActiveScene:
        // SyncVisualizationsAsync reads core's state itself and no-ops when there
        // is nothing to place.
        // SERIALIZED. This was five fire-and-forget Task.Delay callbacks, each
        // starting SyncVisualizationsAsync - which awaits ExecuteScript round
        // trips into the brain WebView. Concurrent ExecuteScript from the UI
        // thread deadlocks it, and the wall froze ~10s after launch with the log
        // stopped and the CPU idle (2026-09-04, four times). The tell was two
        // "viz sync" lines 3ms apart. One attempt at a time, awaited, stopping
        // as soon as the chrome exists.
        _ = StartupSyncAsync();
        _ = FirstRunAsync();
        WatchTmdbKeyFile();
        _ = UpdateWatchGripAsync();
    }

    // ---------------------------------------------------------------- §4a: the TMDB key by file (a remote household, 2026-09-20)
    // "Proceed with tmdb" from a person away from the wall: the key is theirs and never crosses a chat, so besides the menu's
    // own box the host takes it from %LOCALAPPDATA%\Prism	mdb.key - read once, handed to core (kept in the wall's store), and
    // the file deleted so the key lives in one place. An empty file clears the key.
    private FileSystemWatcher? _tmdbKeyWatcher;
    private void WatchTmdbKeyFile()
    {
        try
        {
            var dir = HostPaths.DataDir;
            Directory.CreateDirectory(dir);
            _ = ImportTmdbKeyFileAsync(Path.Combine(dir, "tmdb.key"));
            _ = ImportProductTmdbKeyAsync();
            _tmdbKeyWatcher = new FileSystemWatcher(dir, "tmdb.key") { EnableRaisingEvents = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size };
            _tmdbKeyWatcher.Created += (_, e) => RootGrid.DispatcherQueue.TryEnqueue(() => _ = ImportTmdbKeyFileAsync(e.FullPath));
            _tmdbKeyWatcher.Changed += (_, e) => RootGrid.DispatcherQueue.TryEnqueue(() => _ = ImportTmdbKeyFileAsync(e.FullPath));
        }
        catch (Exception ex) { LogLine("tmdb key file: watcher failed: " + ex.Message); }
    }
    /// <summary>The PRODUCT's TMDB key (2026-09-20, "I don't want people to have to obtain a key for TMDB, this is only for me as the
    /// developer"): the developer's own application key, shipped as a build asset (Assets	mdb.key - never in the repository) so
    /// a household gets ratings without a key of its own. Taken only when no key is set; a household's own key, entered later,
    /// stands over it. Every wall still calls TMDB directly under it; nothing goes through Entangled (section 22).</summary>
    private async Task ImportProductTmdbKeyAsync()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "Assets", "tmdb.key");
            if (!File.Exists(path)) return;
            var t0 = DateTime.UtcNow;
            while (!_brain.Ready && (DateTime.UtcNow - t0).TotalSeconds < 60) await Task.Delay(500);
            if (!_brain.Ready) return;
            if ((await ModelCallAsync("lensHasKey"))?.Trim().Trim('"') == "true") return;
            var key = (await File.ReadAllTextAsync(path)).Trim();
            if (key.Length == 0) return;
            await ModelCallAsync("lensSetTmdbKey", key);
            LogLine("tmdb key: the product's key from Assets/tmdb.key (" + key.Length + " chars) - no household key was set");
        }
        catch (Exception ex) { LogLine("tmdb product key: " + ex.Message); }
    }
    private async Task ImportTmdbKeyFileAsync(string path)
    {
        try
        {
            if (!File.Exists(path)) return;
            await Task.Delay(400);   // the writer's last byte
            if (!File.Exists(path)) return;
            var key = (await File.ReadAllTextAsync(path)).Trim();
            try { File.Delete(path); } catch { }
            var t0 = DateTime.UtcNow;
            while (!_brain.Ready && (DateTime.UtcNow - t0).TotalSeconds < 60) await Task.Delay(500);
            if (!_brain.Ready) { LogLine("tmdb key file: brain not ready, key dropped"); return; }
            var raw = await ModelCallAsync("lensSetTmdbKey", key.Length > 0 ? key : null);
            LogLine("tmdb key file: " + (key.Length > 0 ? "key taken from the file (" + key.Length + " chars), file deleted" : "empty file: key cleared") + " -> " + Shorten(raw ?? "?", 40));
            SetPill(key.Length > 0 ? "Prism · TMDB key kept on this device (the file is gone)" : "Prism · TMDB key cleared");
            if (VideoHubOpen) _ = ShowVideoHubAsync();
        }
        catch (Exception ex) { LogLine("tmdb key file: " + ex.Message); }
    }
}
