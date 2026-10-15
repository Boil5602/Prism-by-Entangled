using System;
using System.Collections.Generic;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// A service's own suggestion rows ("Netflix suggests ...") shown under the Services row when its poster is pressed (2026-10-14, "when the user
/// clicks the service from the services list, show the suggestions from that service immediately below the services line. If I deselect the
/// service, those should be removed, or if I click another it should go to that service's suggestions"). The header's Service suggestions
/// switch and its jump are gone; core reads every service's home page for its rows as before. The drawing is in DrawServicesBlock.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>The service whose suggestions are shown, or null; stands across a redraw of the page.</summary>
    private string? _svcSuggApp;
    private Action<string>? _showServiceSuggestions;
    /// <summary>Each signed-in poster's line under it, and what it said before "Suggestions below".</summary>
    private readonly List<(string app, TextBlock label)> _svcSuggLabels = new();
    private readonly Dictionary<string, (string text, Brush ink)> _svcSuggBase = new();
    /// <summary>TMDB's key is in (the watchlist's TMDB score order shows only then).</summary>
    private bool _hubTmdbKey;
}
