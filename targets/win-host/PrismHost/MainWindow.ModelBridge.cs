using System.Globalization;
using System.Text.Json;
using PrismHost.Channel;

namespace PrismHost;

/// <summary>
/// Scene-model plumbing shared by the editors (docs/scene-model-spec.md;
/// SM-2). Everything here is transport: the model state as core reports it
/// (PrismRuntime.modelState), the model calls (modelSave*, modelArchiveLayout,
/// modelLayoutDuplicates) and core's own classing / bucket snapping / preset
/// resolution / element picker as sync host calls (PrismRuntime.model*, B-40) -
/// the shell decides nothing (B-10: the XL line lives in core alone). The App
/// preview surface (B-41) is core's too: modelOpenAppSurface / modelCloseAppSurface.
/// </summary>
public sealed partial class MainWindow
{
    // ------------------------------------------------ records (what the editors read)
    private sealed record ModelApp(string Id, string Name, string BaseUrl, string ProfileId, string? CatalogRef, string? Adapter, string Status, string? LastVerified, string Json, string? Evidence = null);
    private sealed record ModelFacet(string Id, string App, string Url, string SlotClass, string Label, bool HasSelector, bool HasRegion, double Zoom, bool Music, string Json);
    private sealed record ModelSlot(string Id, string Class, bool Custom, double X, double Y, double W, double H, string? Label);
    private sealed record ModelLayout(string Id, string Name, string CanvasLabel, double CanvasRatio, string Resolution, bool Archived, string? SourceMode, List<ModelSlot> Slots, string Json);
    private sealed record SlotClassCount(string Class, int Layouts, bool Custom);
    private sealed record ModelState(List<ModelApp> Apps, List<ModelFacet> Facets, List<ModelLayout> Layouts, List<SlotClassCount> SlotClasses, string? ActiveScene, string Json);

    private static string? StrOf(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static bool BoolOf(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
    private static string Inv(double d) => d.ToString("0.####", CultureInfo.InvariantCulture);

    /// <summary>ExecuteScript returns the value JSON-encoded; core's sync calls return JSON strings, so unwrap the outer string.</summary>
    private static string? Unwrap(string? raw)
    {
        if (raw is null || raw == "null") return null;
        try
        {
            using var outer = JsonDocument.Parse(raw);
            return outer.RootElement.ValueKind == JsonValueKind.String ? outer.RootElement.GetString() : raw;
        }
        catch { return raw; }
    }

    private async Task<string?> RuntimeEvalAsync(string expr)
    {
        try { return Unwrap(await _brain.EvalAsync(expr)); }
        catch { return null; }
    }

    private static string Q(string? s) => JsonSerializer.Serialize(s);

    // ------------------------------------------------ core model calls (PrismRuntime.model*, B-40)
    /// <summary>Evaluate `PrismRuntime.&lt;runtimeFn&gt;(args)` - the sync model host calls (classing, bucket snap, presets, the picker). Inner JSON or null.</summary>
    private async Task<string?> ModelEvalAsync(string runtimeFn, string evalFn, string args)
    {
        try
        {
            var has = await _brain.EvalAsync("typeof (PrismRuntime && PrismRuntime." + runtimeFn + ")");
            if (has != "\"function\"") { SetStatus("model call missing: PrismRuntime." + runtimeFn + " (" + evalFn + ")"); return null; }
            return Unwrap(await _brain.EvalAsync("PrismRuntime." + runtimeFn + "(" + args + ")"));
        }
        catch (Exception ex) { SetStatus("model call " + runtimeFn + ": " + ex.Message); return null; }
    }

    /// <summary>Core classes a draft layout: slots with class strings + the canvas class label. Null when invalid / unavailable.</summary>
    private Task<string?> ClassifyLayoutAsync(string layoutJson) => ModelEvalAsync("modelClassifyLayout", "classifyLayout", Q(layoutJson));

    /// <summary>Nearest aspect bucket for a pixel ratio: {bucket, deviation, ratio}.</summary>
    private async Task<(string Bucket, double Ratio)?> NearestBucketAsync(double ratio)
    {
        var raw = await ModelEvalAsync("modelNearestBucket", "nearestBucket", Inv(ratio));
        if (raw is null) return null;
        try
        {
            using var d = JsonDocument.Parse(raw);
            return (d.RootElement.GetProperty("bucket").GetString() ?? "16:9", d.RootElement.GetProperty("ratio").GetDouble());
        }
        catch { return null; }
    }

    /// <summary>The centered pixel rect a slot class previews at on this window (scene-model §4 "representative size").</summary>
    private async Task<(double X, double Y, double W, double H)?> RepresentativeRectAsync(string slotClass, double w, double h)
    {
        var raw = await ModelEvalAsync("modelRepresentativeRect", "representativeRect", Q(slotClass) + "," + Inv(w) + "," + Inv(h));
        if (raw is null || raw == "null") return null;
        try
        {
            using var d = JsonDocument.Parse(raw);
            var r = d.RootElement;
            return (r.GetProperty("x").GetDouble(), r.GetProperty("y").GetDouble(), r.GetProperty("w").GetDouble(), r.GetProperty("h").GetDouble());
        }
        catch { return null; }
    }

    private async Task<double?> ClassRatioAsync(string slotClass)
    {
        var raw = await ModelEvalAsync("modelClassRatio", "classRatio", Q(slotClass));
        return raw is not null && double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var r) && r > 0 ? r : null;
    }

    /// <summary>{redirect: login|app|elsewhere, status: needs-attention|signed-in|null} for a navigated URL (core's heuristic).</summary>
    private async Task<(string Redirect, string? Status)?> LoginRedirectAsync(string url, string? loginPrefix, string? baseUrl)
    {
        var raw = await ModelEvalAsync("modelLoginRedirect", "loginRedirect", Q(url) + "," + Q(loginPrefix) + "," + Q(baseUrl));
        if (raw is null) return null;
        try
        {
            using var d = JsonDocument.Parse(raw);
            return (d.RootElement.GetProperty("redirect").GetString() ?? "elsewhere", StrOf(d.RootElement, "status"));
        }
        catch { return null; }
    }

    /// <summary>The §31 element picker script (core's), or null when unavailable.</summary>
    private Task<string?> FacetPickerJsAsync() => ModelEvalAsync("modelFacetPickerJs", "facetPickerJs", "");

    // ------------------------------------------------ model state
    private async Task<ModelState?> ModelStateAsync()
    {
        var raw = await RuntimeEvalAsync("PrismRuntime.modelState()");
        if (raw is null) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var r = doc.RootElement;
            var apps = new List<ModelApp>();
            if (r.TryGetProperty("apps", out var ap) && ap.ValueKind == JsonValueKind.Array)
                foreach (var a in ap.EnumerateArray())
                {
                    var setup = a.TryGetProperty("setup", out var s) && s.ValueKind == JsonValueKind.Object ? s : default;
                    apps.Add(new ModelApp(StrOf(a, "id") ?? "", StrOf(a, "name") ?? StrOf(a, "id") ?? "", StrOf(a, "baseUrl") ?? "", StrOf(a, "profileId") ?? StrOf(a, "id") ?? "",
                        StrOf(a, "catalogRef"), StrOf(a, "adapter"), setup.ValueKind == JsonValueKind.Object ? StrOf(setup, "status") ?? "unknown" : "unknown",
                        setup.ValueKind == JsonValueKind.Object ? StrOf(setup, "lastVerified") : null, a.GetRawText(),
                        setup.ValueKind == JsonValueKind.Object ? StrOf(setup, "evidence") : null));
                }
            var facets = new List<ModelFacet>();
            if (r.TryGetProperty("facets", out var fc) && fc.ValueKind == JsonValueKind.Array)
                foreach (var f in fc.EnumerateArray())
                {
                    var focus = f.TryGetProperty("focus", out var fo) && fo.ValueKind == JsonValueKind.Object ? fo : default;
                    facets.Add(new ModelFacet(StrOf(f, "id") ?? "", StrOf(f, "app") ?? "", StrOf(f, "url") ?? "", StrOf(f, "slotClass") ?? "", StrOf(f, "label") ?? StrOf(f, "id") ?? "",
                        focus.ValueKind == JsonValueKind.Object && focus.TryGetProperty("selector", out _), focus.ValueKind == JsonValueKind.Object && focus.TryGetProperty("region", out _),
                        f.TryGetProperty("zoom", out var z) && z.ValueKind == JsonValueKind.Number ? z.GetDouble() : 1, BoolOf(f, "music"), f.GetRawText()));
                }
            var layouts = new List<ModelLayout>();
            if (r.TryGetProperty("layouts", out var ly) && ly.ValueKind == JsonValueKind.Array)
                foreach (var l in ly.EnumerateArray()) layouts.Add(ParseModelLayout(l));
            var classes = new List<SlotClassCount>();
            if (r.TryGetProperty("slotClasses", out var sc) && sc.ValueKind == JsonValueKind.Array)
                foreach (var c in sc.EnumerateArray())
                    classes.Add(new SlotClassCount(StrOf(c, "class") ?? "", c.TryGetProperty("layouts", out var n) && n.ValueKind == JsonValueKind.Number ? n.GetInt32() : 0, BoolOf(c, "custom")));
            return new ModelState(apps, facets, layouts, classes, StrOf(r, "activeScene"), raw);
        }
        catch (Exception ex) { SetStatus("modelState: " + ex.Message); return null; }
    }

    private static ModelLayout ParseModelLayout(JsonElement l)
    {
        var canvas = l.TryGetProperty("canvas", out var cv) && cv.ValueKind == JsonValueKind.Object ? cv : default;
        var ratio = canvas.ValueKind == JsonValueKind.Object && canvas.TryGetProperty("ratio", out var rt) && rt.ValueKind == JsonValueKind.Number ? rt.GetDouble() : 16 / 9.0;
        var res = canvas.ValueKind == JsonValueKind.Object ? StrOf(canvas, "resolution") ?? "1080-class" : "1080-class";
        var aspect = canvas.ValueKind == JsonValueKind.Object ? StrOf(canvas, "aspect") ?? "16:9" : "16:9";
        var portrait = canvas.ValueKind == JsonValueKind.Object && StrOf(canvas, "orientation") == "portrait";
        var label = StrOf(l, "canvasLabel") ?? (aspect + (portrait ? " portrait" : "") + " @ " + res);
        var slots = new List<ModelSlot>();
        if (l.TryGetProperty("slots", out var sl) && sl.ValueKind == JsonValueKind.Array)
            foreach (var s in sl.EnumerateArray())
            {
                if (!s.TryGetProperty("rect", out var rc) || rc.ValueKind != JsonValueKind.Object) continue;
                slots.Add(new ModelSlot(StrOf(s, "id") ?? "", StrOf(s, "class") ?? "?", BoolOf(s, "custom"), Num(rc, "x"), Num(rc, "y"), Num(rc, "w"), Num(rc, "h"), StrOf(s, "label")));
            }
        var source = l.TryGetProperty("source", out var so) && so.ValueKind == JsonValueKind.Object ? StrOf(so, "mode") : null;
        return new ModelLayout(StrOf(l, "id") ?? "", StrOf(l, "name") ?? "Untitled layout", label, ratio, res, BoolOf(l, "archived"), source, slots, l.GetRawText());
    }

    /// <summary>modelSaveApp with the App's JSON patched: setup.status + lastVerified (today). The rest of the App is kept verbatim.</summary>
    private async Task<bool> SaveAppStatusAsync(ModelApp app, string status, string evidence = "url")
    {
        try
        {
            var node = System.Text.Json.Nodes.JsonNode.Parse(app.Json)?.AsObject();
            if (node is null) return false;
            // evidence: probe (the adapter's session probe saw the account) | asserted (a person said so) | url (only the address was seen)
            node["setup"] = new System.Text.Json.Nodes.JsonObject { ["status"] = status, ["lastVerified"] = DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), ["evidence"] = evidence };
            var res = await RuntimeEvalAsync("PrismRuntime.modelSaveApp(" + Q(node.ToJsonString()) + ")");
            return res is not null && res.Contains("\"ok\":true");
        }
        catch (Exception ex) { SetStatus("modelSaveApp: " + ex.Message); return false; }
    }

    /// <summary>The catalog entry an App came from (catalogRef, else adapter, else id).</summary>
    /// <summary>
    /// §31 `account: "none"` - the catalog entry says this App has nothing to
    /// sign in to (the first-party micro-facets, docs/concept-scenes.md §6).
    /// Such an App is set up on arrival: no sign-in button, no needs-attention
    /// badge, and a template role naming it resolves without a decision.
    /// </summary>
    private static bool CatalogSaysNoAccount(string? catalogJson) => PrismHost.Core.FirstPartyRole.NoAccount(catalogJson);

    /// <summary>True when this App's catalog entry declares it needs no account at all.</summary>
    private bool AppNeedsNoAccount(ModelApp app) => CatalogSaysNoAccount(CatalogFor(app)?.Json);

    private HostCatalogEntry? CatalogFor(ModelApp app) =>
        _catalog.FirstOrDefault(c => c.Id == app.CatalogRef) ?? _catalog.FirstOrDefault(c => app.Adapter is { Length: > 0 } && c.Adapter == app.Adapter) ?? _catalog.FirstOrDefault(c => c.Id == app.Id);

    /// <summary>The adapter's login URL (the passive-verification prefix), from the bundled adapter asset.</summary>
    /// <summary>The adapter's session probe (signedIn / signedOut selectors), or null when it has none.</summary>
    private static (string? SignedIn, string? SignedOut)? AdapterSession(string? adapter)
    {
        try
        {
            if (string.IsNullOrEmpty(adapter)) return null;
            var ap = (Sources.AdapterPath(adapter) ?? "");
            if (!File.Exists(ap)) return null;
            using var ad = JsonDocument.Parse(File.ReadAllText(ap));
            if (!ad.RootElement.TryGetProperty("session", out var s) || s.ValueKind != JsonValueKind.Object) return null;
            var (i, o) = (StrOf(s, "signedIn"), StrOf(s, "signedOut"));
            return i is null && o is null ? null : (i, o);
        }
        catch { return null; }
    }

    /// <summary>The adapter an App's pages are read by: the one it names, else the one of its own id (the catalog names none for the music
    /// services; core binds theirs by the page's host).</summary>
    private static string? AdapterNameFor(ModelApp app)
    {
        if (app.Adapter is { Length: > 0 } named) return named;
        try { return File.Exists((Sources.AdapterPath(app.Id) ?? "")) ? app.Id : null; } catch { return null; }
    }

    /// <summary>The adapter's login address when it is a page to open (core's rule, signInPage): null when the sign-in is on the service's own
    /// page - Apple's sign-in host is an error page when opened, Amazon Music's is its home. Kept per adapter once asked.</summary>
    private readonly Dictionary<string, string?> _signInPages = new();
    private async Task<string?> SignInPageAsync(string? adapter)
    {
        if (string.IsNullOrEmpty(adapter)) return null;
        if (_signInPages.TryGetValue(adapter, out var known)) return known;
        var login = AdapterLoginUrl(adapter);
        string? named = null;   // the adapter's own word for the page Sign in opens (signIn), when login is not one
        try { var ap = (Sources.AdapterPath(adapter) ?? ""); if (File.Exists(ap)) { using var ad = JsonDocument.Parse(File.ReadAllText(ap)); named = StrOf(ad.RootElement, "signIn"); } } catch { }
        string? page = null;
        if (login is not null || named is not null)
        {
            var raw = (await RuntimeEvalAsync("PrismRuntime.modelSignInPage(" + Q(login) + ", " + Q(named) + ")"))?.Trim().Trim('"');
            if (raw is null || raw.StartsWith("__prism")) return null;   // no answer (the brain busy): asked again next time, not kept (2026-09-29 review)
            if (raw.Length > 0 && raw.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) page = raw;
        }
        _signInPages[adapter] = page;
        return page;
    }

    /// <summary>
    /// Sign in, on a page that is up (2026-09-29, "There is a sign in and other options along the top bar and several don't work"): the
    /// service's sign-in page when it has one; else the service's own Sign In control on the page, pressed because a person pressed Sign in
    /// (looked for while the page settles); else the service's home.
    /// </summary>
    private async Task SignInOnTileAsync(string? adapter, string name, string? baseUrl, string tileId)
    {
        if (await SignInPageAsync(adapter) is { } page) { LogLine("sign in: " + tileId + " -> " + page); _surfaces.Navigate(tileId, page); return; }
        // the control to press: the adapter's own word for it (loginPress), else its signed-out marker
        string? press = null;
        try { var ap = (Sources.AdapterPath(adapter) ?? ""); if (adapter is not null && File.Exists(ap)) { using var ad = JsonDocument.Parse(File.ReadAllText(ap)); press = StrOf(ad.RootElement, "loginPress"); } } catch { }
        if ((press ?? AdapterSession(adapter)?.SignedOut) is { Length: > 0 } sel)
        {
            var js = await RuntimeEvalAsync("PrismRuntime.modelSignInPressJs(" + Q(sel) + ")");
            if (!string.IsNullOrEmpty(js) && !js.StartsWith("__prism"))
                for (var i = 0; i < 10; i++)
                {
                    if (!_surfaces.LiveTileIds().Contains(tileId)) return;
                    var r = await _surfaces.EvalOnTileAsync(tileId, js);
                    if (r is not null && r.Contains("pressed")) { LogLine("sign in: " + tileId + " -> the page's own Sign In control, pressed"); return; }
                    await Task.Delay(1000);
                }
            LogLine("sign in: " + tileId + " -> no Sign In control seen on the page");
            SetPill("Prism" + Mid + "Use " + name + "'s own Sign In button on the page");
            return;
        }
        if (baseUrl is { Length: > 0 } && IsHttpUrl(baseUrl)) { LogLine("sign in: " + tileId + " -> " + baseUrl); _surfaces.Navigate(tileId, baseUrl); }
    }

    private static string? AdapterLoginUrl(string? adapter)
    {
        try
        {
            if (string.IsNullOrEmpty(adapter)) return null;
            var ap = (Sources.AdapterPath(adapter) ?? "");
            if (!File.Exists(ap)) return null;
            using var ad = JsonDocument.Parse(File.ReadAllText(ap));
            return StrOf(ad.RootElement, "login");
        }
        catch { return null; }
    }

    /// <summary>
    /// The surface an App is browsed / cut in (B-41): core opens a dedicated
    /// preview surface in the App's profile - full window at z 900, outside the
    /// wall, engine active (win-host-spec §5) - and destroys it on close
    /// (ReleaseAppSurface). The wall never churns. Null when the App is unknown
    /// or the surface never came up.
    /// </summary>
    private async Task<string?> EnsureAppSurfaceAsync(ModelApp app, string? preferredUrl = null)
    {
        var id = await RuntimeEvalAsync("PrismRuntime.modelOpenAppSurface(" + Q(app.Id) + ", " + Q(IsHttpUrl(preferredUrl ?? "") ? preferredUrl : null) + ")");
        if (string.IsNullOrEmpty(id)) { SetStatus("modelOpenAppSurface: unknown App " + app.Id); return null; }
        var t0 = Environment.TickCount64;
        while (Environment.TickCount64 - t0 < 25000)
        {
            if (_surfaces.LiveTileIds().Contains(id) && _surfaces.RectOf(id) is { W: >= 40, H: >= 40 }) return id;
            await Task.Delay(150);
        }
        SetStatus("modelOpenAppSurface: " + id + " did not come up");
        await ReleaseAppSurfaceAsync(id);
        return null;
    }

    /// <summary>Close an App preview surface (every editor close path lands here): core destroys it.</summary>
    private async Task ReleaseAppSurfaceAsync(string? surfaceId)
    {
        if (string.IsNullOrEmpty(surfaceId)) return;
        await RuntimeEvalAsync("PrismRuntime.modelCloseAppSurface(" + Q(surfaceId) + ")");
    }

    /// <summary>Editors (rail, context sheet, deep links) refer to Apps by id; an unknown id gets the catalog-or-URL "Add App" path from Agent 3's rail, not here.</summary>
    private async Task<ModelApp?> FindAppAsync(string appId)
    {
        var st = await ModelStateAsync();
        return st?.Apps.FirstOrDefault(a => a.Id == appId);
    }
}
