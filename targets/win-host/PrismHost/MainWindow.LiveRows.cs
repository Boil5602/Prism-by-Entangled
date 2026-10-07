using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;

namespace PrismHost;

/// <summary>
/// Watch's Continue watching and My list kept current in place (2026-09-24, "What can we do to make all the data loading and refreshing more
/// current and seamless to the users?"): while the Watch tab is up, core's rows are read every few seconds; a row whose cards changed is
/// brought to them without being rebuilt - a new card fades in at its place, a gone one leaves, the rest slide - and never while the pointer
/// or focus is on it. The services' posters carry a small dot while that service's pages are being read, and say when they last were.
/// </summary>
public sealed partial class MainWindow
{
    /// <summary>The two live rows of the Watch page on screen: their head, the host their carousel sits in, and whether their cards carry badges.</summary>
    private readonly Dictionary<string, (FrameworkElement head, StackPanel host, bool badge)> _liveRows = new();
    /// <summary>The live rows the pointer is on (never changed under it).</summary>
    private readonly HashSet<string> _liveOver = new();
    /// <summary>Each service poster's refresh dot, its button and its own tooltip.</summary>
    private readonly Dictionary<string, (Border dot, Button button, string tip)> _svcDots = new();
    private int _liveRun;
    private const int LiveFollowMs = 3000;
    private int _plDockTick;
    /// <summary>A pass wanted now, not at the next three seconds (a profile switch, a service read - 2026-09-24, "make this profile switch a very
    /// fluid activity, animated movie swapouts for those top 2 rows").</summary>
    private bool _liveKick;
    private void KickLiveRows() => _liveKick = true;

    /// <summary>A live card's key: the card and its picture - a picture that changes (a service's tall poster swapped for TMDB's wide backdrop once it is
    /// read, 2026-09-24) swaps the card in place.</summary>
    private static string LiveKey(JsonObject card) => CardKey(card) + "|" + ((card["item"] as JsonObject)?["artwork"]?.GetValue<string>() ?? "");
    /// <summary>A live row's cards from core's menu, with the flags their cards' menus read (Remove on the service).</summary>
    private static IEnumerable<JsonObject> LiveCards(JsonObject menu, string key)
    {
        if (menu[key] is not JsonArray arr) return Enumerable.Empty<JsonObject>();
        var flag = key == "continue" ? "__continue" : "__mylist";
        return arr.OfType<JsonObject>().Take(48).Select(c => { c[flag] = true; return c; }).ToList();
    }

    private async Task FollowLiveRowsAsync(Grid overlay)
    {
        var run = ++_liveRun;
        bool Here() => run == _liveRun && ReferenceEquals(_videoHub, overlay) && _hubTab == "watch" && !_bingeOpen;
        while (Here())
        {
            for (var waited = 0; waited < LiveFollowMs && !_liveKick; waited += 250) await Task.Delay(250);
            _liveKick = false;
            if (!Here()) return;
            JsonObject? menu = null, fresh = null;
            // the rows alone, not the whole menu with the Library in it (2026-10-03, perf: 1.5 MB parsed every three seconds was the host's churn)
            try { menu = JsonNode.Parse(await ModelCallAsync("videoMenuRows", false) ?? "null") as JsonObject; } catch { }
            try { fresh = JsonNode.Parse(await ModelCallAsync("videoFreshness") ?? "null") as JsonObject; } catch { }
            if (!Here()) return;
            if (_plDock is not null && !_plDockBusy && ++_plDockTick % 2 == 0) _ = FillPlaylistDockAsync();   // the playlist panel kept current too: what Play starts with moves as episodes are watched (2026-09-27)
            if (menu is not null)
            {
                var now = menu["now"] is JsonValue nv && nv.TryGetValue<double>(out var nd) ? nd : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                SyncRowOrders(menu);   // a profile set's own orders (2026-09-27)
                foreach (var key in new[] { "continue", "list" })
                {
                    if (!_liveRows.TryGetValue(key, out var r)) continue;
                    var cards = LiveCards(menu, key).ToList();
                    var sig = string.Join("|", cards.Select(LiveKey));
                    if (r.host.Tag as string == sig) continue;
                    if (_liveOver.Contains(key) || KeyboardFocusWithin(r.host)) continue;   // never under the person: the next pass
                    try
                    {
                        r.head.Visibility = cards.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
                        var line = FindChild<ScrollViewer>(r.host)?.Content as StackPanel;
                        if (line is null) { r.host.Children.Clear(); Button? f = null; if (cards.Count > 0) r.host.Children.Add(CardRow(cards, r.badge, now, ref f)); }
                        else UpdateCardRowInPlace(line, cards, r.badge, now);
                        r.host.Tag = sig;
                        if (key == "continue") FillContinueJumps(cards);   // the services it holds now
                    }
                    catch (Exception e) { LogLine("live rows: " + e.GetType().Name + ": " + e.Message); }
                }
            }
            if (fresh is not null) UpdateServiceDots(fresh);
            await RefreshHubHeadAsync();
        }
    }

    /// <summary>The head's line kept true (2026-09-25: it read "Hulu - playing" long after the screen sat on Hulu's home page - it was written once, as
    /// Watch opened, while the home page's preview played): the words follow the screen as the rows do; the verbs beside them stay as drawn.</summary>
    private async Task RefreshHubHeadAsync()
    {
        if (_hubHeadLine is not { } line || line.Children.Count == 0 || line.Children[0] is not TextBlock head) return;
        JsonObject? menu = null; JsonArray? vs = null;
        try { menu = JsonNode.Parse(await ModelCallAsync("videoServices") ?? "null") as JsonObject; vs = JsonNode.Parse(await ModelCallAsync("videoState") ?? "[]") as JsonArray; } catch { return; }
        var screenSlot = (menu?["screen"] as JsonObject)?["slot"]?.GetValue<string>();
        if (screenSlot is null || !ReferenceEquals(_hubHeadLine, line)) return;
        string S(JsonNode? n, string k) => (n as JsonObject)?[k]?.GetValue<string>() ?? "";
        JsonObject? tile = null;
        if (vs is not null) foreach (var t in vs) if (t is JsonObject o && o["id"]?.GetValue<string>() == screenSlot) tile = o;
        var onName = "";
        if (menu?["services"] is JsonArray svcs) foreach (var sv in svcs) if (sv is JsonObject so && so["onScreen"]?.GetValue<bool>() == true) onName = S(so, "name");
        var video = tile?["video"] as JsonObject;
        var playing = tile?["playing"]?.GetValue<bool>() == true;
        var pending = tile?["pending"] as JsonObject;
        string face;
        var pageErr = tile?["error"]?.GetValue<string>();
        if (pageErr is { Length: > 0 }) face = pageErr;
        else if (pending is not null) face = pending["failed"] is not null ? "could not start " + S(pending, "name") : "loading " + S(pending, "name") + "\u2026";
        else if (video is not null && (S(video, "title").Length > 0 || S(video, "series").Length > 0))
            face = string.Join("  \u00B7  ", new[] { S(video, "series"), EpisodeLabel(video), S(video, "title") }.Where(x => !string.IsNullOrEmpty(x)));
        else face = "nothing playing";
        if (face == "nothing playing" && (video is not null || playing)) face = playing ? "playing" : "paused";
        var text = face == "nothing playing" ? "Nothing playing" : onName + "  \u00B7  " + Shorten(face, 60);
        if (head.Text != text) head.Text = text;
    }

    /// <summary>A person's KEYBOARD focus is in this row (arrowing through it) - not the focus a mouse click leaves on a card, which had kept the
    /// row from ever updating after a card opened Details (2026-09-24: an add to My List did not show).</summary>
    private bool KeyboardFocusWithin(DependencyObject host)
    {
        try
        {
            if (RootGrid.XamlRoot is null || FocusManager.GetFocusedElement(RootGrid.XamlRoot) is not Control c || c.FocusState != FocusState.Keyboard) return false;
            for (DependencyObject? d = c; d is not null; d = Microsoft.UI.Xaml.Media.VisualTreeHelper.GetParent(d)) if (ReferenceEquals(d, host)) return true;
        }
        catch { }
        return false;
    }

    /// <summary>Continue watching / My list brought to a new list of cards in place (keyed by CardKey, AutomationId "row:&lt;key&gt;"). A card that
    /// changes place slides there (2026-09-25, "when I add something to my list, it adds it to the front, and then it sorts it back later ... can
    /// we also make that move/sort action be more fluid/slide into place? quick but fluid"): a kept card moved, and a card whose key changed but is
    /// the same title on the same service (the service's own id or picture read after the add), glide from where they were to where they go.</summary>
    private void UpdateCardRowInPlace(StackPanel line, List<JsonObject> cards, bool badge, double now)
    {
        var want = cards.Select(LiveKey).ToList();
        var wanted = new HashSet<string>(want);
        var wantSoft = new HashSet<string>(want.Select(SoftKey));
        var have = new Dictionary<string, UIElement>();
        // where every card is now, before anything moves
        var was = new Dictionary<UIElement, double>();
        foreach (var el in line.Children) { try { was[el] = el.TransformToVisual(line).TransformPoint(new Windows.Foundation.Point(0, 0)).X; } catch { } }
        // a card leaving whose title comes back under a new key: its place is where the new card starts from, and it goes at once (no fade)
        var from = new Dictionary<string, double>();
        foreach (var el in line.Children.ToList())
        {
            var id = RowId(el);
            if (id.Length > 0 && wanted.Contains(id) && !have.ContainsKey(id)) { have[id] = el; continue; }
            var soft = id.Length > 0 ? SoftKey(id) : "";
            if (soft.Length > 0 && wantSoft.Contains(soft) && !from.ContainsKey(soft) && was.TryGetValue(el, out var x0)) { from[soft] = x0; line.Children.Remove(el); continue; }
            FadeOut(line, el);
        }
        var glide = new List<(UIElement el, double x0)>();
        var at = 0;
        for (var i = 0; i < cards.Count; i++)
        {
            if (have.TryGetValue(want[i], out var el))
            {
                var idx = line.Children.IndexOf(el);
                if (idx != at)
                {
                    // moved: its own slide (the implicit one does not follow a card taken out and put back)
                    try { Microsoft.UI.Xaml.Hosting.ElementCompositionPreview.GetElementVisual(el).ImplicitAnimations = null; } catch { }
                    line.Children.Move((uint)idx, (uint)at);
                    if (was.TryGetValue(el, out var x0)) glide.Add((el, x0));
                }
                at++;
                continue;
            }
            var btn = MenuCardButton(cards[i], badge, now);
            if (btn is null) continue;
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(btn, "row:" + want[i]);
            line.Children.Insert(at, btn);
            if (from.TryGetValue(SoftKey(want[i]), out var start))
            {
                glide.Add((btn, start));   // the same title: it slides from the old card's place, already shown
            }
            else
            {
                btn.Opacity = 0;
                SlideOnMove(btn);
                var fade = new DoubleAnimation { From = 0, To = 1, Duration = new Duration(TimeSpan.FromMilliseconds(450)), EnableDependentAnimation = true };
                Storyboard.SetTarget(fade, btn); Storyboard.SetTargetProperty(fade, "Opacity");
                var sb = new Storyboard(); sb.Children.Add(fade); sb.Begin();
            }
            at++;
        }
        if (glide.Count == 0) return;
        line.UpdateLayout();
        foreach (var (el, x0) in glide) Glide(line, el, x0);
    }

    /// <summary>A card's key, "row:" dropped ("" for one that is not a live card).</summary>
    private static string RowId(UIElement el) =>
        Microsoft.UI.Xaml.Automation.AutomationProperties.GetAutomationId(el) is { Length: > 4 } a && a.StartsWith("row:", StringComparison.Ordinal) ? a.Substring(4) : "";
    /// <summary>The same title on the same service, whatever its id or picture: the service and the title's letters and digits (LiveKey is app|id|title|art).</summary>
    private static string SoftKey(string liveKey)
    {
        var parts = liveKey.Split('|');
        if (parts.Length < 3) return "";
        var t = new string(parts[2].ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
        return t.Length == 0 ? "" : parts[0] + "|" + t;
    }
    /// <summary>A card slides from where it was (x0, in the row) to where it now is: quick, easing out, and then it follows its row's moves again.</summary>
    private static void Glide(StackPanel line, UIElement el, double x0)
    {
        double x1;
        try { x1 = el.TransformToVisual(line).TransformPoint(new Windows.Foundation.Point(0, 0)).X; } catch { SlideOnMove(el); return; }
        var dx = x0 - x1;
        if (Math.Abs(dx) < 1) { SlideOnMove(el); return; }
        var tt = new Microsoft.UI.Xaml.Media.TranslateTransform { X = dx };
        el.RenderTransform = tt;
        var move = new DoubleAnimation { From = dx, To = 0, Duration = new Duration(TimeSpan.FromMilliseconds(Math.Clamp(220 + Math.Abs(dx) * 0.12, 260, 480))), EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
        Storyboard.SetTarget(move, tt); Storyboard.SetTargetProperty(move, "X");
        var sb = new Storyboard(); sb.Children.Add(move);
        sb.Completed += (_, __) => { el.RenderTransform = null; SlideOnMove(el); };
        sb.Begin();
    }

    /// <summary>A card leaving its row: it turns to dust (2026-09-25, "What about a disintegration effect for cards being removed?") - a picture of
    /// the card breaks into small pieces that drift up and away, left edge first, while its place closes and the cards after it slide in. A card
    /// that cannot be pictured fades and shrinks as before.</summary>
    private void FadeOut(StackPanel line, UIElement el)
    {
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetAutomationId(el, "gone");   // never matched again while it goes
        el.IsHitTestVisible = false;
        _ = DisintegrateAsync(line, el);
    }

    /// <summary>`hidden` (a person's own removal, 2026-09-26): the card is hidden, not taken out, and whole again underneath - a removal the service
    /// refuses brings it back. Otherwise it is taken out of its row.</summary>
    private async Task DisintegrateAsync(StackPanel line, UIElement el, bool remove = true, Action? hidden = null)
    {
        var fe = el as FrameworkElement;
        Microsoft.UI.Xaml.Media.Imaging.RenderTargetBitmap? shot = null;
        Windows.Foundation.Point at = default;
        try
        {
            if (fe is null || fe.ActualWidth < 8 || fe.ActualHeight < 8 || RootGrid.XamlRoot is null) throw new InvalidOperationException();
            at = fe.TransformToVisual(RootGrid).TransformPoint(new Windows.Foundation.Point(0, 0));
            shot = new Microsoft.UI.Xaml.Media.Imaging.RenderTargetBitmap();
            await shot.RenderAsync(fe);
            if (shot.PixelWidth == 0) shot = null;
        }
        catch { shot = null; }
        LogLine("card dust: " + (shot is null ? "no picture, it fades" : shot.PixelWidth + "x" + shot.PixelHeight) + (remove ? "" : " (a look)"));
        if (shot is null || fe is null) { if (remove) ShrinkAway(line, el, 0, true, hidden is null ? null : () => HideWhole(el, hidden)); return; }

        // the picture as a plain bitmap (a RenderTargetBitmap shown in many Images drew nothing in a look, 2026-09-25)
        Microsoft.UI.Xaml.Media.ImageSource src = shot;
        try
        {
            var px = await shot.GetPixelsAsync();
            var wb = new Microsoft.UI.Xaml.Media.Imaging.WriteableBitmap(shot.PixelWidth, shot.PixelHeight);
            using (var st = System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsStream(wb.PixelBuffer)) { var bytes = System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.ToArray(px); await st.WriteAsync(bytes, 0, bytes.Length); }
            wb.Invalidate();
            src = wb;
        }
        catch (Exception e) { LogLine("card dust: bitmap copy " + e.GetType().Name); }
        double w = fe.ActualWidth, h = fe.ActualHeight;
        var dust = new Canvas { Width = w, Height = h, IsHitTestVisible = false, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(at.X, at.Y, 0, 0) };
        Canvas.SetZIndex(dust, 990);
        const int cols = 14, rows = 9;
        double pw = w / cols, ph = h / rows;
        var rnd = new Random();
        var sb = new Storyboard();
        TimeSpan last = TimeSpan.Zero;
        for (var r = 0; r < rows; r++)
            for (var c = 0; c < cols; c++)
            {
                // each piece: the whole picture, shifted and cut to its own square
                var img = new Image { Source = src, Width = w, Height = h, Stretch = Stretch.Fill };
                var piece = new Canvas { Width = pw + 0.6, Height = ph + 0.6, Clip = new Microsoft.UI.Xaml.Media.RectangleGeometry { Rect = new Windows.Foundation.Rect(0, 0, pw + 0.6, ph + 0.6) } };
                Canvas.SetLeft(img, -c * pw); Canvas.SetTop(img, -r * ph);
                piece.Children.Add(img);
                Canvas.SetLeft(piece, c * pw); Canvas.SetTop(piece, r * ph);
                var tr = new Microsoft.UI.Xaml.Media.CompositeTransform();
                piece.RenderTransform = tr; piece.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
                dust.Children.Add(piece);
                // the left edge goes first, a scatter within each column; each piece drifts up and to the right, turning and fading
                const int slow = 1;
                var delay = TimeSpan.FromMilliseconds((c * 38 + rnd.Next(0, 90)) * slow);
                var dur = TimeSpan.FromMilliseconds((420 + rnd.Next(0, 260)) * slow);
                if (delay + dur > last) last = delay + dur;
                var ease = new QuadraticEase { EasingMode = EasingMode.EaseIn };
                void Anim(DependencyObject target, string prop, double to, EasingFunctionBase? e = null)
                {
                    var a = new DoubleAnimation { To = to, BeginTime = delay, Duration = new Duration(dur), EasingFunction = e };
                    Storyboard.SetTarget(a, target); Storyboard.SetTargetProperty(a, prop); sb.Children.Add(a);
                }
                Anim(tr, "TranslateX", 30 + rnd.NextDouble() * 70, ease);
                Anim(tr, "TranslateY", -(20 + rnd.NextDouble() * 60), ease);
                Anim(tr, "Rotation", rnd.NextDouble() * 120 - 60);
                Anim(tr, "ScaleX", 0.3); Anim(tr, "ScaleY", 0.3);
                Anim(piece, "Opacity", 0, ease);
            }
        RootGrid.Children.Add(dust);
        el.Opacity = 0;   // the dust stands where the card was
        sb.Completed += (_, __) => { RootGrid.Children.Remove(dust); if (!remove) el.Opacity = 1; };
        sb.Begin();
        if (remove) ShrinkAway(line, el, 260, false, hidden is null ? null : () => HideWhole(el, hidden));   // the gap closes while the dust drifts
    }

    /// <summary>Dev: the first card of a live row goes as a person's removal does, then comes back as a refused one does (hub.request "dust hide").</summary>
    internal void DevDustHide()
    {
        foreach (var key in new[] { "list", "continue" })
        {
            if (!_liveRows.TryGetValue(key, out var r) || FindChild<ScrollViewer>(r.host)?.Content is not StackPanel line || line.Children.OfType<Button>().FirstOrDefault(b => b.Visibility == Visibility.Visible) is not { } card) continue;
            HideCardForRemoval(card);
            _ = Task.Delay(3000).ContinueWith(_ => DispatcherQueue.TryEnqueue(() => { card.Visibility = Visibility.Visible; LogLine("dust hide: back, width " + card.ActualWidth); }));
            return;
        }
    }

    /// <summary>Dev: the first card of a live row turns to dust and comes back (hub.request "dust", a look at the effect with nothing removed).</summary>
    internal void DevDust()
    {
        foreach (var key in new[] { "list", "continue" })
        {
            if (!_liveRows.TryGetValue(key, out var r) || FindChild<ScrollViewer>(r.host)?.Content is not StackPanel line || line.Children.Count == 0) continue;
            _ = DisintegrateAsync(line, line.Children[0], remove: false);
            return;
        }
    }

    /// <summary>A card turned to dust by a person's removal, hidden and whole again: its size and look back as they were, so it can return.</summary>
    private static void HideWhole(UIElement el, Action after)
    {
        el.Visibility = Visibility.Collapsed;
        el.Opacity = 1;
        el.IsHitTestVisible = true;
        after();
    }

    /// <summary>The card's place in its row closes (the cards after it slide in), and it is taken out - or, with `done`, left in the row hidden
    /// (the animation stopped, so its width is its own again); `fade` fades it too (no dust).</summary>
    private static void ShrinkAway(StackPanel line, UIElement el, int afterMs, bool fade, Action? done = null)
    {
        var sb = new Storyboard();
        if (fade)
        {
            var f = new DoubleAnimation { To = 0, Duration = new Duration(TimeSpan.FromMilliseconds(280)), EnableDependentAnimation = true };
            Storyboard.SetTarget(f, el); Storyboard.SetTargetProperty(f, "Opacity");
            sb.Children.Add(f);
        }
        if (el is FrameworkElement fe)
        {
            var shrink = new DoubleAnimation { From = fe.ActualWidth, To = 0, Duration = new Duration(TimeSpan.FromMilliseconds(320)), BeginTime = TimeSpan.FromMilliseconds(fade ? 180 : afterMs), EnableDependentAnimation = true, EasingFunction = new CubicEase { EasingMode = EasingMode.EaseInOut } };
            Storyboard.SetTarget(shrink, fe); Storyboard.SetTargetProperty(shrink, "Width");
            sb.Children.Add(shrink);
        }
        sb.Completed += (_, __) => { if (done is null) line.Children.Remove(el); else { sb.Stop(); done(); } };
        sb.Begin();
    }

    /// <summary>A dot on a service's poster while its pages are being read; its tooltip says when its lists were last read.</summary>
    private void UpdateServiceDots(JsonObject fresh)
    {
        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var (app, d) in _svcDots)
        {
            var f = fresh[app] as JsonObject;
            var working = f?["working"]?.GetValue<bool>() == true;
            d.dot.Visibility = working ? Visibility.Visible : Visibility.Collapsed;
            string when = "";
            if (working) when = "Its lists are being read now.";
            else if (f?["readAt"] is JsonValue rv && rv.TryGetValue<double>(out var ra) && ra > 0)
            {
                var mins = (int)Math.Round((nowMs - ra) / 60000.0);
                when = "Its lists were read " + (mins <= 0 ? "just now." : mins == 1 ? "a minute ago." : mins < 90 ? mins + " minutes ago." : (mins / 60) + " hours ago.");
            }
            ToolTipService.SetToolTip(d.button, when.Length > 0 ? d.tip + "\n\n" + when : d.tip);
        }
    }
}
