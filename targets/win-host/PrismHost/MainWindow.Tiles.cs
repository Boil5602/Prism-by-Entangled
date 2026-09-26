using PrismHost.Tiles;

namespace PrismHost;

/// <summary>
/// The first-party micro-facets (docs/concept-scenes.md §6): Chores &amp; notes
/// and Timer, served from Assets/tiles at https://tiles.prism/chores/ and
/// https://tiles.prism/timer/.
///
/// The host is transport here and nothing else (§23). A page posts one human
/// edit; this file hands it to core (PrismRuntime.tilesApply), core normalizes,
/// persists through store.set (§10 — the same store.json every other key lives
/// in) and answers with the new document; the answer goes back to every live
/// tiles.prism page. When the edit came from a phone instead (§6 POST /chores),
/// core's store.set arrives on the channel and the same push runs — so the list
/// on the wall changes while someone is still standing in the shop.
///
/// Nothing here parses a chore or a countdown: TilesBridge validates the key
/// and the origin, and core owns the rest.
/// </summary>
public sealed partial class MainWindow
{
    private void WireTiles()
    {
        _surfaces.TilesRequested += (tileId, request) =>
            RootGrid.DispatcherQueue.TryEnqueue(() => _ = ServeTilesRequestAsync(tileId, request));
    }

    private async Task ServeTilesRequestAsync(string tileId, TilesBridge.Request request)
    {
        var answer = await RuntimeEvalAsync(TilesBridge.RuntimeExpression(request));
        if (request.Kind == TilesBridge.RequestKind.Get)
        {
            if (answer is null || answer == "null") { LogLine($"tiles: core had no document for {request.Key} ({tileId})"); return; }
            _surfaces.PostToTiles(TilesBridge.DocMessage(request.Key, answer));
            return;
        }
        var (docJson, error) = TilesBridge.ReadApplyResult(answer);
        if (docJson is not null) _surfaces.PostToTiles(TilesBridge.DocMessage(request.Key, docJson));
        else _surfaces.PostToTiles(TilesBridge.ErrorMessage(request.Key, error ?? "refused"));
    }

    /// <summary>
    /// A micro-facet document was persisted (by this panel, or by a phone over
    /// the §6 remote). Re-read it from core and push it out, so every open page
    /// shows the same list. Called from the store.set arm of the channel.
    /// </summary>
    private void OnTilesKeyStored(string key)
    {
        if (!TilesBridge.KeyAllowed(key)) return;
        _ = ServeTilesRequestAsync("store", new TilesBridge.Request(TilesBridge.RequestKind.Get, key, ""));
    }
}
