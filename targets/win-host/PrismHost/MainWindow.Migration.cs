using System.Text;
using System.Text.Json;
using PrismHost.Storage;

namespace PrismHost;

/// <summary>
/// First-boot scene-model migration (docs/scene-model-spec.md §7; SM-6).
///
/// ONCE, after core init: if the store holds a pre-model `dashboard` and no
/// `scene-model:migration` marker, the host hands core a snapshot of the whole
/// store (`PrismRuntime.modelMigrate(storeJson, false)`), core derives the
/// Apps / Facets / Layouts / Scenes and writes ONLY new `scene-model:*` keys
/// (asserted in core before any write; the marker key is one of them), and the
/// host writes the review report to diagnostics\migration-report.md plus one
/// `migration:` line in host.log. The wall keeps running its current
/// `dashboard` document; the migrated entities simply appear in the rail.
///
/// §10: the host never deletes or rewrites a source key here (it writes no
/// store key at all - only the report file). As an independent check it
/// snapshots the store before and after and classifies the difference
/// (StoreDiff): anything but added `scene-model:*` keys is logged loudly.
/// The marker key is core's; once it exists this never runs again (a human
/// re-run is `modelMigrate(…, true)` from the Device screen, not this path).
/// </summary>
public sealed partial class MainWindow
{
    private const string MigrationMarkerKey = "scene-model:migration";
    private const string SceneModelPrefix = "scene-model:";

    private async Task RunFirstBootMigrationAsync()
    {
        try
        {
            if (_store.Get("dashboard") is null) { LogLine("migration: skipped - the store has no `dashboard` (nothing pre-model to migrate)"); return; }
            if (_store.Get(MigrationMarkerKey) is not null) return;   // ran on an earlier boot: core's marker is the one-shot gate
            // a model made on this device is never migrated over (2026-09-29: a new device lost both players on its second boot); core holds the same line
            if (_store.Get(SceneModelPrefix + "scenes") is { Length: > 2 }) { LogLine("migration: skipped - this device already has a scene model of its own"); return; }

            // wait for the wall: state() is non-null once the dashboard is applied, so the
            // canvas size core reports is the real window (else the report says "assumed")
            for (var i = 0; i < 80; i++)
            {
                var st = await _brain.EvalAsync("PrismRuntime.state()");
                if (st is not null && st != "null" && st != "\"null\"") break;
                await Task.Delay(250);
            }
            var has = await _brain.EvalAsync("typeof (PrismRuntime && PrismRuntime.modelMigrate)");
            if (has != "\"function\"") { LogLine("migration: NOT RUN - PrismRuntime.modelMigrate is missing from the runtime bundle"); return; }

            var before = _store.All();
            var snapshot = JsonSerializer.Serialize(new { version = StoreService.CurrentVersion, data = before });
            var raw = await RuntimeEvalAsync("PrismRuntime.modelMigrate(" + Q(snapshot) + ", false)");
            if (raw is null) { LogLine("migration: NOT RUN - modelMigrate returned nothing"); return; }

            // core persists through the channel (store.set messages); wait for the marker to land before the after-snapshot
            for (var i = 0; i < 100 && _store.Get(MigrationMarkerKey) is null; i++) await Task.Delay(50);
            var after = _store.All();
            var diff = StoreDiff.Classify(before, after, SceneModelPrefix);

            string status = "?", counts = "", canvas = "", ambiguousN = "?", sourceKeysN = "?";
            JsonElement? report = null;
            try
            {
                using var doc = JsonDocument.Parse(raw);
                var r = doc.RootElement;
                status = r.TryGetProperty("status", out var s) ? s.GetString() ?? "?" : "?";
                if (r.TryGetProperty("error", out var err)) status += " (" + err.GetString() + ")";
                if (r.TryGetProperty("report", out var rep) && rep.ValueKind == JsonValueKind.Object)
                {
                    report = rep.Clone();
                    if (rep.TryGetProperty("created", out var c))
                        counts = $" apps={c.GetProperty("apps").GetInt32()} facets={c.GetProperty("facets").GetInt32()} layouts={c.GetProperty("layouts").GetInt32()} scenes={c.GetProperty("scenes").GetInt32()}";
                    if (rep.TryGetProperty("canvas", out var cv))
                        canvas = $" canvas={cv.GetProperty("w").GetDouble():0}x{cv.GetProperty("h").GetDouble():0} ({cv.GetProperty("source").GetString()})";
                    if (rep.TryGetProperty("ambiguous", out var am) && am.ValueKind == JsonValueKind.Array) ambiguousN = am.GetArrayLength().ToString();
                    if (rep.TryGetProperty("sourceKeys", out var sk) && sk.ValueKind == JsonValueKind.Array) sourceKeysN = sk.GetArrayLength().ToString();
                }
            }
            catch (Exception ex) { status += " (unparsable result: " + ex.Message + ")"; }

            var verdict = diff.ViolatesNeverRewrite ? "VIOLATION §10 - a source key changed or vanished"
                        : diff.OnlyAddedUnderPrefix ? "ok - only scene-model:* keys added"
                        : "ok - scene-model:* keys added; unrelated keys also moved in the window (not the migration's)";
            LogLine($"migration: status={status}{counts}{canvas} ambiguous={ambiguousN} source-keys-read={sourceKeysN} store-diff: {diff.Summary()} -> {verdict}");

            var path = Path.Combine(_store.Root, "diagnostics", "migration-report.md");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, RenderMigrationReport(status, report, diff, verdict, before.Count, after.Count), new UTF8Encoding(false));
            LogLine("migration: report written to " + path);
            if (status == "migrated") SetPill("Prism · scene model ready: your wall is now a scene (report in diagnostics)");
        }
        catch (Exception ex)
        {
            LogLine("migration: FAILED " + ex.GetType().Name + ": " + ex.Message);
        }
    }

    /// <summary>The review report as Markdown: what was made, what was inferred, what needs a human, and the host's §10 check.</summary>
    private static string RenderMigrationReport(string status, JsonElement? report, StoreDiff diff, string verdict, int keysBefore, int keysAfter)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# Prism scene-model migration report");
        sb.AppendLine();
        sb.AppendLine($"- Written: {DateTime.Now:yyyy-MM-dd HH:mm:ss} (local)");
        sb.AppendLine($"- Status: **{status}**");
        sb.AppendLine($"- Store keys before / after: {keysBefore} / {keysAfter}");
        sb.AppendLine($"- Host §10 check (a store snapshot before vs after may differ only by added `scene-model:*` keys): **{verdict}** — {diff.Summary()}");
        if (report is not { } r)
        {
            sb.AppendLine();
            sb.AppendLine("No report body was returned (status above says why). Nothing was written to the store by the host.");
            return sb.ToString();
        }
        string S(string name) => r.TryGetProperty(name, out var v) ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.GetRawText()) : "";
        sb.AppendLine($"- Report schema: `{S("schema")}` at {S("at")}");
        if (r.TryGetProperty("canvas", out var cv))
            sb.AppendLine($"- Canvas: {cv.GetProperty("w").GetDouble():0} × {cv.GetProperty("h").GetDouble():0} ({cv.GetProperty("source").GetString()})");
        if (r.TryGetProperty("created", out var c))
        {
            sb.AppendLine();
            sb.AppendLine("## Created");
            sb.AppendLine();
            sb.AppendLine($"| Apps | Facets | Layouts | Scenes |");
            sb.AppendLine($"|---|---|---|---|");
            sb.AppendLine($"| {c.GetProperty("apps").GetInt32()} | {c.GetProperty("facets").GetInt32()} | {c.GetProperty("layouts").GetInt32()} | {c.GetProperty("scenes").GetInt32()} |");
        }
        if (r.TryGetProperty("sourceKeys", out var sk) && sk.ValueKind == JsonValueKind.Array)
        {
            sb.AppendLine();
            sb.AppendLine("## Source keys read (never written)");
            sb.AppendLine();
            foreach (var k in sk.EnumerateArray()) sb.AppendLine($"- `{k.GetString()}`");
        }
        if (r.TryGetProperty("writes", out var wr) && wr.ValueKind == JsonValueKind.Array)
        {
            sb.AppendLine();
            sb.AppendLine("## Keys written (all new)");
            sb.AppendLine();
            foreach (var k in wr.EnumerateArray()) sb.AppendLine($"- `{k.GetString()}`");
        }
        if (r.TryGetProperty("inferred", out var inf) && inf.ValueKind == JsonValueKind.Array)
        {
            sb.AppendLine();
            sb.AppendLine("## Inferred slot classes (one row per assigned facet)");
            sb.AppendLine();
            sb.AppendLine("| Dashboard | Tile | Facet | Class | Deviation from bucket |");
            sb.AppendLine("|---|---|---|---|---|");
            foreach (var row in inf.EnumerateArray())
            {
                string F(string n) => row.TryGetProperty(n, out var v) ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.GetRawText()) : "";
                sb.AppendLine($"| {F("dashboard")} | {F("tile")} | `{F("facet")}` | {F("class")} | {F("deviation")} |");
            }
        }
        if (r.TryGetProperty("ambiguous", out var am) && am.ValueKind == JsonValueKind.Array)
        {
            sb.AppendLine();
            sb.AppendLine($"## Needs a human ({am.GetArrayLength()})");
            sb.AppendLine();
            if (am.GetArrayLength() == 0) sb.AppendLine("Nothing - every tile, layout and scene carried over without a judgement call.");
            foreach (var line in am.EnumerateArray()) sb.AppendLine($"- {line.GetString()}");
        }
        if (r.TryGetProperty("lastPages", out var lp) && lp.ValueKind == JsonValueKind.Array && lp.GetArrayLength() > 0)
        {
            sb.AppendLine();
            sb.AppendLine("## Last pages (tile:lasturl:*, kept as data - not migrated into facets)");
            sb.AppendLine();
            sb.AppendLine("| Dashboard | Tile | Last page | Orphan |");
            sb.AppendLine("|---|---|---|---|");
            foreach (var row in lp.EnumerateArray())
                sb.AppendLine($"| {row.GetProperty("dashboard").GetString()} | {row.GetProperty("tile").GetString()} | {row.GetProperty("url").GetString()} | {(row.TryGetProperty("orphan", out var o) && o.ValueKind == JsonValueKind.True ? "yes" : "")} |");
        }
        sb.AppendLine();
        sb.AppendLine("The wall keeps running its `dashboard` document; the migrated Layout, Scene, Facets and Apps appear in the rail. Nothing pre-model was deleted or rewritten (§10).");
        return sb.ToString();
    }
}
