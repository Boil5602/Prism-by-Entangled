using System;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;

namespace PrismHost;

/// <summary>
/// What needs TMDB is offered only with a key (2026-10-06, "When I right click on an item in my library and go to details, it fails because TMDB
/// isnt setup. The button shouldn't appear unless TMDB is setup then"): the Details page is TMDB's, so its entries - the card menu, the curtain's
/// Details, a search result's Details - appear while a key is set. Core's word (videoSettings tmdbKey), read where the entry is drawn.
/// </summary>
public sealed partial class MainWindow
{
    private bool _tmdbKey;

    private async Task<bool> TmdbKeyAsync()
    {
        try { _tmdbKey = (JsonNode.Parse(await ModelCallAsync("videoSettings") ?? "null") as JsonObject)?["tmdbKey"]?.GetValue<bool>() == true; } catch { }
        return _tmdbKey;
    }

    /// <summary>A Details entry drawn at once: hidden as soon as core says there is no key.</summary>
    private void ShowOnlyWithTmdb(UIElement el)
    {
        if (!_tmdbKey) el.Visibility = Visibility.Collapsed;   // the last answer first, so it does not flash in
        _ = ((Func<Task>)(async () => { el.Visibility = await TmdbKeyAsync() ? Visibility.Visible : Visibility.Collapsed; }))();
    }
}
