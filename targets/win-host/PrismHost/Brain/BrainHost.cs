using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using PrismHost.Channel;
using PrismHost.Storage;

namespace PrismHost.Brain;

/// <summary>
/// The core "brain": prism-core's bundled runtime in a headless WebView2
/// (win-host-spec §2). Headless = 1×1, opacity 0, never user-visible; it must
/// still live in the visual tree for WebView2 to initialize.
///
/// One JSON channel both ways:
///   core → host: PrismBridge.dispatch(json) → chrome.webview.postMessage →
///                WebMessageReceived → OnCommand
///   host → core: PostWebMessageAsJson({fn, args}) → brain.html routes to
///                PrismRuntime[fn](...args)
///
/// storeGet must answer synchronously inside the brain, so the host injects a
/// FULL store snapshot before the runtime loads; store.set commands both
/// persist host-side and mirror into the in-brain snapshot (brain.html), so
/// reads stay coherent without a second channel.
/// </summary>
public sealed class BrainHost
{
    private readonly Canvas _canvas;
    private readonly StoreService _store;
    private readonly Action<string> _onCommand;
    private readonly Action<string> _onStatus;
    private WebView2? _view;

    public bool Ready { get; private set; }
    public event Action? OnReady;

    public BrainHost(Canvas canvas, StoreService store, Action<string> onCommand, Action<string> onStatus)
    {
        _canvas = canvas;
        _store = store;
        _onCommand = onCommand;
        _onStatus = onStatus;
    }

    public async Task StartAsync()
    {
        var env = await CoreWebView2Environment.CreateWithOptionsAsync(
            null, Path.Combine(_store.Root, "brain-profile"), new CoreWebView2EnvironmentOptions());

        var view = new WebView2 { Width = 1, Height = 1, Opacity = 0, IsHitTestVisible = false };
        Canvas.SetLeft(view, 0);
        Canvas.SetTop(view, 0);
        Canvas.SetZIndex(view, -1000);
        _canvas.Children.Add(view);
        _view = view;

        await view.EnsureCoreWebView2Async(env);
        var core = view.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;

        var assets = Path.Combine(AppContext.BaseDirectory, "Assets", "brain");
        core.SetVirtualHostNameToFolderMapping("brain.prism", assets, CoreWebView2HostResourceAccessKind.Allow);

        // The §10 store snapshot + PrismBridge, before any page script runs.
        var snapshot = JsonSerializer.Serialize(_store.All());
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            "window.__prismStoreSnapshot = " + snapshot + ";");

        core.WebMessageReceived += (_, e) =>
        {
            string? json = null;
            try { json = e.TryGetWebMessageAsString(); } catch { }
            if (json is null)
            {
                try { json = e.WebMessageAsJson; } catch { }
            }
            if (json is not null) _onCommand(json);
        };
        core.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess) { _onStatus($"brain failed to load ({e.WebErrorStatus})"); return; }
            Ready = true;
            _onStatus("brain ready - Prism " + AppVersion.Text);
            FlushPending();
            OnReady?.Invoke();
        };
        // the runtime is loaded afresh every start (2026-09-30: WebView2's HTTP cache served a prism-runtime.js from a start before, so a
        // deployed core did not run until the cache's heuristic lifetime passed). The brain profile's disk cache only - nothing stored (section 10)
        try { await core.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache); } catch (Exception e) { _onStatus("brain cache: " + e.Message); }
        core.Navigate("https://brain.prism/brain.html");
    }

    /// <summary>Evaluate JS in the brain and return the raw ExecuteScript
    /// result (JSON-encoded). Used for the few sync PrismRuntime queries
    /// (posterPlan, rects); commands still go over the one JSON channel.</summary>
    public async Task<string?> EvalAsync(string js)
    {
        if (_view?.CoreWebView2 is not { } core) return null;
        try { return await core.ExecuteScriptAsync(js); } catch { return null; }
    }

    // Calls made before the runtime finished loading were dropped (an early
    // tile event beat brain.html's runtime script); queue and flush on ready.
    private readonly List<string> _pending = new();

    /// <summary>Diagnostics tap: every host→core call (fn, args JSON truncated surrogate-safely) - host.log answers "what did the host ask core to do". File only: never render it.</summary>
    public Action<string, string>? OnCall;

    private static string Clip(string s, int max)
    {
        if (s.Length <= max) return s;
        var cut = max;
        if (char.IsHighSurrogate(s[cut - 1])) cut--;   // never split a pair: a lone surrogate in a TextBlock crashes XAML
        return s[..cut] + "…";
    }

    /// <summary>Call into PrismRuntime — the only host→core path.</summary>
    public void Call(string fn, params object?[] args)
    {
        var json = ChannelParser.HostCallJson(fn, args);
        try { OnCall?.Invoke(fn, Clip(json, 400)); } catch { }
        if (!Ready || _view?.CoreWebView2 is not { } core) { _pending.Add(json); return; }
        core.PostWebMessageAsJson(json);
    }

    private void FlushPending()
    {
        if (_view?.CoreWebView2 is not { } core) return;
        foreach (var json in _pending) core.PostWebMessageAsJson(json);
        _pending.Clear();
    }
}
