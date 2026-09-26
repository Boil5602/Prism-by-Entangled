using System;
using System.IO;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;

namespace PrismHost;

/// <summary>
/// A page of our own, in a window over everything (2026-09-25, "I want credit links to open a tidy clean modal window to the prism page.
/// X out to return to everything. No interest in allowing traversal outside of the specifically linked domains"): the Credits page's
/// Entangled links open here, and the X (or Esc) closes it, leaving whatever was under it as it was. Only entangled.world and its own
/// addresses load at the top: a link elsewhere does nothing, a new window opens in place when it stays home and never otherwise, and
/// nothing downloads. The page's cookies live in a folder of their own, apart from every service's.
/// </summary>
public sealed partial class MainWindow
{
    private Grid? _linkModal;

    /// <summary>The addresses the window may show at the top: https, entangled.world or one of its own hosts.</summary>
    private static bool LinkModalAllows(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u)) return false;
        if (u.Scheme == "about") return true;
        if (u.Scheme != Uri.UriSchemeHttps) return false;
        var h = u.Host.ToLowerInvariant();
        return h == "entangled.world" || h.EndsWith(".entangled.world", StringComparison.Ordinal);
    }

    public void CloseLinkModal()
    {
        if (_linkModal is null) return;
        var m = _linkModal; _linkModal = null;
        RootGrid.Children.Remove(m);
        foreach (var c in FindWebViews(m)) { try { c.Close(); } catch { } }
        // the page under it takes the keys back (Credits' Esc)
        if (_creditsWin is not null) _creditsWin.Focus(FocusState.Programmatic);
    }
    private static System.Collections.Generic.IEnumerable<WebView2> FindWebViews(DependencyObject root)
    {
        var n = VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < n; i++)
        {
            var c = VisualTreeHelper.GetChild(root, i);
            if (c is WebView2 w) yield return w;
            foreach (var d in FindWebViews(c)) yield return d;
        }
    }

    public async void ShowLinkModal(string url, string title)
    {
        if (!LinkModalAllows(url)) return;
        CloseLinkModal();
        var scrim = new Grid { Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0xD8, 0x05, 0x06, 0x09)) };
        Canvas.SetZIndex(scrim, 980);   // over Credits (960)
        scrim.PointerPressed += (_, __) => CloseLinkModal();
        var esc = new KeyboardAccelerator { Key = Windows.System.VirtualKey.Escape };
        esc.Invoked += (_, e) => { e.Handled = true; CloseLinkModal(); };
        scrim.KeyboardAccelerators.Add(esc);

        var frame = new Grid();
        frame.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        frame.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        var card = new Border
        {
            Background = HubCard, CornerRadius = new CornerRadius(14), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x55, 0xF2, 0xB1, 0x4C)), BorderThickness = new Thickness(1),
            MaxWidth = 1280, MaxHeight = 900, Margin = new Thickness(60, 40, 60, 40), Child = frame,
        };
        card.PointerPressed += (_, e) => e.Handled = true;
        scrim.Children.Add(card);

        var head = new Grid { Margin = new Thickness(20, 12, 12, 12) };
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var where = new TextBlock { Text = title, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
        head.Children.Add(where);
        var close = Chip(new FontIcon { Glyph = "\uE711", FontSize = 13 }, false);
        ToolTipService.SetToolTip(close, "Close (Esc)");
        close.Click += (_, __) => CloseLinkModal();
        Grid.SetColumn(close, 1);
        head.Children.Add(close);
        frame.Children.Add(head);

        var holder = new Border { CornerRadius = new CornerRadius(0, 0, 13, 13), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x0F, 0x12, 0x16)) };
        Grid.SetRow(holder, 1);
        frame.Children.Add(holder);
        var view = new WebView2 { DefaultBackgroundColor = Windows.UI.Color.FromArgb(255, 0x0F, 0x12, 0x16) };
        // a page that isn't there (a page not yet published answers "Access Denied" or "Not Found", 2026-09-25): said plainly, not a raw error page
        var missing = new TextBlock { Text = "This page isn't available right now. Try again later.", FontSize = 16, Foreground = HubInk, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Visibility = Visibility.Collapsed };
        var stack = new Grid();
        stack.Children.Add(view); stack.Children.Add(missing);
        holder.Child = stack;

        RootGrid.Children.Add(scrim);
        _linkModal = scrim;
        scrim.Loaded += (_, __) => scrim.Focus(FocusState.Programmatic);

        try
        {
            var env = await CoreWebView2Environment.CreateWithOptionsAsync(null, Path.Combine(_store.Root, "linkview"), new CoreWebView2EnvironmentOptions());
            await view.EnsureCoreWebView2Async(env);
            if (!ReferenceEquals(_linkModal, scrim)) { view.Close(); return; }
            var core = view.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            // home only, at the top: a link elsewhere does nothing
            core.NavigationStarting += (_, e) => { if (!LinkModalAllows(e.Uri)) e.Cancel = true; };
            // a new window: in place when it stays home, else nothing
            core.NewWindowRequested += (_, e) => { e.Handled = true; if (LinkModalAllows(e.Uri)) core.Navigate(e.Uri); };
            core.DownloadStarting += (_, e) => { e.Cancel = true; };
            core.DocumentTitleChanged += (_, __) => { var t = core.DocumentTitle; where.Text = string.IsNullOrWhiteSpace(t) || t.StartsWith("http", StringComparison.Ordinal) ? title : t; };
            core.NavigationCompleted += (_, e) => { var bad = !e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled || e.HttpStatusCode >= 400; missing.Visibility = bad ? Visibility.Visible : Visibility.Collapsed; view.Opacity = bad ? 0 : 1; };
            core.NavigationCompleted += (_, e) => LogLine("link window: " + core.Source + " ok=" + e.IsSuccess + " status=" + e.HttpStatusCode + " title=" + core.DocumentTitle);
            core.Navigate(url);
        }
        catch (Exception ex) { LogLine("link window: " + ex.Message); }
    }
}
