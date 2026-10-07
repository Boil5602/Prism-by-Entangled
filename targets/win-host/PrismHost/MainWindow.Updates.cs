using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace PrismHost;

/// <summary>
/// The Updates dialog (dashboard-schema section 28; docs/features/updates.md; 2026-10-05): what runs, what the update server offers, a check
/// now, an install now, a restart into a staged version; and, for a fork, the server address and the public key that signs its manifests.
/// Core decides what is newer and when the night window installs; Services/Updates.cs moves the bytes.
/// </summary>
public sealed partial class MainWindow
{
    private JsonObject? _updateStatus;
    private ContentDialog? _updatesDlg;   // the open Updates dialog (a dev request can close it)

    /// <summary>The note beside the menu item: a version ready, or one waiting for a restart.</summary>
    private string UpdateMenuNote()
    {
        if (Services.Updates.Staged() is { } st) return st.version + " installed, restart to switch";
        var av = (_updateStatus?["available"] as JsonObject)?["version"]?.GetValue<string>();
        return av is { Length: > 0 } ? av + " is ready to install" : "";
    }

    /// <summary>Said once on the status line when a release is there (after core's first check) or staged.</summary>
    private void RefreshUpdateNotice()
    {
        SyncUpdateButton();   // the update beside the flag (MainWindow.UpdateButton.cs)
        // staged: the notice is the restart offer, with its button (2026-10-06); ready to install: the line alone, as before
        if (Services.Updates.Staged() is not null) { OfferRestartIfStaged(); return; }
        var note = UpdateMenuNote();
        if (note.Length > 0) SetPill("Prism" + Mid + note + ". Prism menu, Updates.");
    }

    private async Task PollUpdateStatusAsync()
    {
        try { _updateStatus = JsonNode.Parse(await ModelCallAsync("updateStatus") ?? "null") as JsonObject; } catch { _updateStatus = null; }
    }

    private async Task ShowUpdatesAsync()
    {
        await PollUpdateStatusAsync();
        // in three parts (2026-10-07, "Release notes dont word wrap, just run off the screen. Please organize this window a little better"):
        // this Prism and what the server offers, with its verbs; which track and when to check, taken the moment they change; the update
        // server for a fork, saved on its own. The column has a width of its own, so the notes wrap, and the changelog feed sits beside it.
        var ell = ((char)0x2026).ToString();
        var body = new StackPanel { Spacing = 16, Width = 600 };
        TextBlock Section(string text) => new() { Text = text, FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, Margin = new Thickness(0, 0, 0, 2) };
        // each part on a card of its own (2026-10-07, "The whole window looks like everything runs together so needs better
        // organization/columns/borders/etc"): a ground a shade lighter than the dialog, a hairline edge, room inside
        Border Card(UIElement child) => new()
        {
            Child = child, Padding = new Thickness(20, 16, 20, 18), CornerRadius = new CornerRadius(10), BorderThickness = new Thickness(1),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x12, 0xFF, 0xFF, 0xFF)),
            BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x2E, 0xFF, 0xFF, 0xFF)),
        };

        // 1. this Prism, and what the update server offers
        var now = new StackPanel { Spacing = 10 };
        var running = new TextBlock { FontSize = 18, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        void SayRunning() => running.Text = "Prism " + AppVersion.Text + " on the " + Services.Updates.TrackLabel(Services.Updates.Channel) + " track";
        SayRunning();
        var line = new TextBlock { FontSize = 14, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        var notes = new TextBlock { FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        var notesCard = new Border
        {
            Child = notes, Padding = new Thickness(14, 10, 14, 10), CornerRadius = new CornerRadius(8), Visibility = Visibility.Collapsed,
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x24, 0x0A, 0x0C, 0x0F)),
            BorderThickness = new Thickness(3, 0, 0, 0), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0xF2, 0xB1, 0x4C)),
        };
        var verbs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var check = Chip(new TextBlock { Text = "Check now", FontSize = 14, Foreground = HubInk }, false);
        var install = Chip(new TextBlock { Text = "Install now", FontSize = 14, Foreground = HubAmber }, true);
        var restart = Chip(new TextBlock { Text = "Restart into the new version", FontSize = 14, Foreground = HubAmber }, true);
        verbs.Children.Add(check); verbs.Children.Add(install); verbs.Children.Add(restart);
        // the changelog feed beside the dialog (2026-10-07, "can we have the option to see a change log feed on the side of that modal window?
        // Maybe just a checkbox to turn it on with the changelog for the latest version"): off by default, the choice kept; the releases come
        // in the signed manifest's history (docs/features/updates.md), so showing them fetches nothing
        var showChanges = new CheckBox { Content = new TextBlock { Text = "Show what's changed", FontSize = 14, Foreground = HubInk }, IsChecked = HostPrefs.GetBool("updates.showChanges", false), MinWidth = 0 };
        now.Children.Add(Section("This Prism"));
        now.Children.Add(running); now.Children.Add(line); now.Children.Add(notesCard); now.Children.Add(verbs); now.Children.Add(showChanges);
        body.Children.Add(Card(now));

        var feed = new StackPanel { Spacing = 16 };
        var feedPane = Card(new ScrollViewer { Content = feed, MaxHeight = 600, Padding = new Thickness(0, 0, 14, 0), HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled });
        feedPane.Width = 430; feedPane.Margin = new Thickness(16, 0, 0, 0); feedPane.VerticalAlignment = VerticalAlignment.Top;
        void DrawFeed()
        {
            feed.Children.Clear();
            feed.Children.Add(Section("What's changed"));
            var st = _updateStatus;
            var src = (st?["available"] as JsonObject) ?? (st?["latest"] as JsonObject);
            var runningVersion = st?["currentVersion"]?.GetValue<string>() ?? "";
            var list = new List<(string version, string date, string notes)>();
            if (src?["history"] is JsonArray hs)
                foreach (var h in hs)
                    if (h is JsonObject ho && ho["version"]?.GetValue<string>() is { } hv && ho["notes"]?.GetValue<string>() is { } hn)
                        list.Add((hv, ho["date"]?.GetValue<string>() ?? "", hn));
            if (list.Count == 0 && src?["version"]?.GetValue<string>() is { } sv && src["notes"]?.GetValue<string>() is { Length: > 0 } sn)
                list.Add((sv, src["date"]?.GetValue<string>() ?? "", sn));   // a manifest from before the feed: its one release
            if (list.Count == 0)
            {
                feed.Children.Add(new TextBlock { Text = "The update server hasn't sent a changelog yet. Check now asks it.", FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
                return;
            }
            foreach (var (v, d, n) in list)
            {
                var cmp = CompareVersions(v, runningVersion);
                var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
                head.Children.Add(new TextBlock { Text = "Prism " + v, FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = cmp > 0 ? HubAmber : HubInk });
                if (DateTime.TryParse(d, out var dd)) head.Children.Add(new TextBlock { Text = dd.ToString("MMM d"), FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Bottom });
                if (cmp > 0) head.Children.Add(new TextBlock { Text = "New", FontSize = 13, Foreground = HubAmber, VerticalAlignment = VerticalAlignment.Bottom });
                else if (cmp == 0) head.Children.Add(new TextBlock { Text = "Running now", FontSize = 13, Foreground = HubInk, VerticalAlignment = VerticalAlignment.Bottom });
                var item = new StackPanel { Spacing = 4, Padding = new Thickness(0, 0, 0, 14), BorderThickness = new Thickness(0, 0, 0, 1), BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x22, 0xFF, 0xFF, 0xFF)) };
                item.Children.Add(head);
                item.Children.Add(new TextBlock { Text = n, FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
                feed.Children.Add(item);
            }
        }

        void Draw()
        {
            var st = _updateStatus;
            var av = st?["available"] as JsonObject;
            var staged = Services.Updates.Staged();
            var last = st?["lastCheck"]?.GetValue<string>();
            var res = st?["lastResult"]?.GetValue<string>();
            string when = last is { Length: > 0 } && DateTime.TryParse(last, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt) ? dt.ToLocalTime().ToString("ddd HH:mm") : "never";
            if (staged is { } s2) line.Text = "Prism " + s2.version + " is installed and runs at the next start.";
            else if (av is not null) line.Text = "Prism " + (av["version"]?.GetValue<string>() ?? "?") + " is ready to install. Last check " + when + ".";
            else line.Text = (res is "unreachable" ? "The update server could not be reached. Last tried " + when + "."
                : res is "invalid" ? "The update server's answer did not verify, so nothing was taken from it. Last tried " + when + "."
                : last is { Length: > 0 } ? "This is the newest version on the " + Services.Updates.TrackLabel(Services.Updates.Channel) + " track. Last check " + when + "."
                : "Not checked yet. Prism checks on its schedule, and Check now asks right away.");
            // the release's notes in a card under the line, unless the feed beside the dialog already shows them
            var n = av?["notes"]?.GetValue<string>();
            notes.Text = n ?? "";
            notesCard.Visibility = string.IsNullOrWhiteSpace(n) || showChanges.IsChecked == true ? Visibility.Collapsed : Visibility.Visible;
            install.Visibility = av is not null && staged is null ? Visibility.Visible : Visibility.Collapsed;
            restart.Visibility = staged is not null ? Visibility.Visible : Visibility.Collapsed;
            feedPane.Visibility = showChanges.IsChecked == true ? Visibility.Visible : Visibility.Collapsed;
            DrawFeed();
        }
        showChanges.Checked += (_, __) => { HostPrefs.Set("updates.showChanges", true); Draw(); };
        showChanges.Unchecked += (_, __) => { HostPrefs.Set("updates.showChanges", false); Draw(); };
        Draw();
        check.Click += async (_, __) => { line.Text = "Checking" + ell; try { _updateStatus = JsonNode.Parse(await ModelCallAwaitAsync("updateCheck", 30_000) ?? "null") as JsonObject; } catch { } Draw(); };
        install.Click += async (_, __) => { line.Text = "Downloading and checking" + ell + " The status line says how far."; install.IsEnabled = false; try { _updateStatus = JsonNode.Parse(await ModelCallAwaitAsync("updateInstallNow", 15 * 60_000) ?? "null") as JsonObject; } catch { } install.IsEnabled = true; Draw(); OfferRestartIfStaged(); };
        restart.Click += (_, __) => RestartIntoStaged();

        // 2. which track, and when to check: taken the moment they change
        var checking = new StackPanel { Spacing = 10 };
        checking.Children.Add(Section("Checking for updates"));
        var track = new ComboBox { Header = "Track", FontSize = 13, MinWidth = 300 };
        foreach (var (id, label, note) in new[] { ("alpha", "Alpha", "what ships while Prism is built"), ("beta", "Beta", "the release candidate"), ("stable", "Full", "the full release") })
            track.Items.Add(new ComboBoxItem { Content = label + Mid + note, Tag = id });
        track.SelectedIndex = Services.Updates.Channel == "alpha" ? 0 : Services.Updates.Channel == "beta" ? 1 : 2;
        track.SelectionChanged += async (_, __) =>
        {
            var ch = (track.SelectedItem as ComboBoxItem)?.Tag as string ?? Services.Updates.BuildTrack;
            if (ch == Services.Updates.Channel) return;
            Services.Updates.Channel = ch;
            line.Text = "Checking the " + Services.Updates.TrackLabel(ch) + " track" + ell;
            try { _updateStatus = JsonNode.Parse(await ModelCallAwaitAsync("updateSetChannel", 30_000, ch) ?? "null") as JsonObject; } catch { }
            SayRunning(); Draw();
            LogLine("updates: track " + ch);
        };
        // when the check runs (2026-10-06, "Let the user check for updates at a scheduled time"): daily or one day a week at a time of day, or
        // never; taken at once, and the line under it says when the next check is
        var how = new ComboBox { Header = "Check", FontSize = 13, MinWidth = 160 };
        foreach (var (id, label) in new[] { ("daily", "Every day"), ("weekly", "Once a week"), ("never", "Never") }) how.Items.Add(new ComboBoxItem { Content = label, Tag = id });
        how.SelectedIndex = !Services.Updates.Enabled ? 2 : Services.Updates.CheckWeekday >= 0 ? 1 : 0;
        var day = new ComboBox { Header = "On", FontSize = 13, MinWidth = 140 };
        foreach (var (d, label) in new[] { (1, "Monday"), (2, "Tuesday"), (3, "Wednesday"), (4, "Thursday"), (5, "Friday"), (6, "Saturday"), (0, "Sunday") }) day.Items.Add(new ComboBoxItem { Content = label, Tag = d });
        var wd = Services.Updates.CheckWeekday;
        day.SelectedIndex = wd >= 1 ? wd - 1 : wd == 0 ? 6 : 0;
        TimeSpan at0 = TimeSpan.TryParse(Services.Updates.CheckAt, out var parsedAt) ? parsedAt : new TimeSpan(4, 0, 0);
        var at = new TimePicker { Header = "At", Time = at0, MinuteIncrement = 5, FontSize = 13 };
        var nextLine = new TextBlock { FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        var whenRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        whenRow.Children.Add(how); whenRow.Children.Add(day); whenRow.Children.Add(at);
        void SayNext()
        {
            var nx = _updateStatus?["nextCheck"]?.GetValue<string>();
            nextLine.Text = !Services.Updates.Enabled ? "Prism checks only when you press Check now."
                : nx is { Length: > 0 } && DateTime.TryParse(nx, null, System.Globalization.DateTimeStyles.RoundtripKind, out var nd) ? "Next check " + nd.ToLocalTime().ToString("dddd") + " at " + nd.ToLocalTime().ToString("t") + "."
                : "";
        }
        async Task ApplyWhen()
        {
            var mode = (how.SelectedItem as ComboBoxItem)?.Tag as string ?? "daily";
            day.Visibility = mode == "weekly" ? Visibility.Visible : Visibility.Collapsed;
            at.Visibility = mode == "never" ? Visibility.Collapsed : Visibility.Visible;
            Services.Updates.Enabled = mode != "never";
            Services.Updates.CheckAt = at.Time.ToString("hh") + ":" + at.Time.ToString("mm");
            Services.Updates.CheckWeekday = mode == "weekly" ? ((day.SelectedItem as ComboBoxItem)?.Tag as int? ?? 1) : -1;
            var sched = System.Text.Json.JsonSerializer.Serialize(Services.Updates.Schedule);
            try { _updateStatus = JsonNode.Parse(await ModelCallAwaitAsync("updateSetSchedule", 10_000, sched, Services.Updates.Enabled) ?? "null") as JsonObject; } catch { }
            SayNext();
            LogLine("updates: check " + (mode == "never" ? "never" : (mode == "weekly" ? "weekly, day " + Services.Updates.CheckWeekday : "daily") + " at " + Services.Updates.CheckAt));
        }
        day.Visibility = how.SelectedIndex == 1 ? Visibility.Visible : Visibility.Collapsed;
        at.Visibility = how.SelectedIndex == 2 ? Visibility.Collapsed : Visibility.Visible;
        how.SelectionChanged += async (_, __) => await ApplyWhen();
        day.SelectionChanged += async (_, __) => await ApplyWhen();
        at.TimeChanged += async (_, __) => await ApplyWhen();
        SayNext();
        checking.Children.Add(track); checking.Children.Add(whenRow); checking.Children.Add(nextLine);
        body.Children.Add(Card(checking));

        // 3. the update server: shown, not edited (2026-10-05, "Why is the public key editable"): the key decides which releases this Prism will
        // install, so a page or a message saying "paste this" must not find an open field. Change the update server reveals the fields, for a
        // fork of Prism someone runs themselves, with the warning first; its Save saves those two alone.
        var fork = new Expander { Header = new TextBlock { Text = "Update server" + (Services.Updates.ServerIsCustom ? "  " + Mid + "  not Entangled's" : ""), FontSize = 14, Foreground = Services.Updates.ServerIsCustom ? HubAmber : HubInk }, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch };
        var inner = new StackPanel { Spacing = 10 };
        inner.Children.Add(new TextBlock { Text = "Prism checks one static file at this address, with nothing about this machine in the request, and takes a release only when the file's signature matches this key. A fork of Prism sets its own address and key here.", FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap });
        var shown = new StackPanel { Spacing = 4 };
        shown.Children.Add(new TextBlock { Text = "Address: " + Services.Updates.Url, FontSize = 12, Foreground = HubInk, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true });
        shown.Children.Add(new TextBlock { Text = "Key: " + (Services.Updates.Key.Length > 0 ? Services.Updates.Key : "none (no signature check)"), FontSize = 12, Foreground = Services.Updates.Key.Length > 0 ? HubInk : HubAmber, TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true });
        var change = Chip(new TextBlock { Text = "Change the update server", FontSize = 13, Foreground = HubInk }, false);
        var editor = new StackPanel { Spacing = 10, Visibility = Visibility.Collapsed };
        editor.Children.Add(new TextBlock { Text = "Only for a fork of Prism you run yourself. Whoever holds the private key for the key below decides what this Prism installs. Never change these because a page, a message or a caller told you to.", FontSize = 13, Foreground = HubAmber, TextWrapping = TextWrapping.Wrap });
        var url = new TextBox { Text = Services.Updates.Url, Header = "Manifest address", FontSize = 13 };
        var key = new TextBox { Text = Services.Updates.Key, Header = "Public key (JWK). Empty: no signature check", FontSize = 12, TextWrapping = TextWrapping.Wrap, AcceptsReturn = true };
        var reset = Chip(new TextBlock { Text = "Back to Entangled's", FontSize = 13, Foreground = HubInk }, false);
        reset.Click += (_, __) => { url.Text = Services.Updates.DefaultUrl; key.Text = Services.Updates.DefaultKey; };
        change.Click += (_, __) => { editor.Visibility = Visibility.Visible; change.Visibility = Visibility.Collapsed; };
        var save = Chip(new TextBlock { Text = "Save the update server", FontSize = 14, Foreground = HubAmber }, true);
        var saved = new TextBlock { FontSize = 13, Foreground = HubInk, TextWrapping = TextWrapping.Wrap };
        save.Click += (_, __) =>
        {
            var u = url.Text.Trim();
            if (u.Contains('?') || u.Contains('#') || !(u.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || u.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase) || u.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase))) { saved.Text = "The address must be https and carry no query."; saved.Foreground = HubAmber; return; }
            if (key.Text.Trim().Length > 0)
            {
                JsonObject? jk = null; try { jk = JsonNode.Parse(key.Text.Trim()) as JsonObject; } catch { }
                if (jk is null || (jk["kty"]?.GetValue<string>() ?? "") != "EC" || (jk["crv"]?.GetValue<string>() ?? "") != "P-256" || jk["x"] is null || jk["y"] is null) { saved.Text = "The key must be a public EC P-256 JWK, as sign-manifest.mjs prints it."; saved.Foreground = HubAmber; return; }
            }
            Services.Updates.Url = u; Services.Updates.Key = key.Text.Trim();
            saved.Text = "Saved. The address and key take effect at the next start."; saved.Foreground = HubInk;
            LogLine("updates: server saved (address " + u + ", key " + (key.Text.Trim().Length > 0 ? "set" : "empty") + ")");
        };
        var editVerbs = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        editVerbs.Children.Add(save); editVerbs.Children.Add(reset);
        editor.Children.Add(url); editor.Children.Add(key); editor.Children.Add(editVerbs); editor.Children.Add(saved);
        inner.Children.Add(shown); inner.Children.Add(change); inner.Children.Add(editor);
        fork.Content = inner;
        body.Children.Add(Card(fork));

        var sides = new Grid();
        sides.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        sides.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        sides.Children.Add(new ScrollViewer { Content = body, MaxHeight = 640, Padding = new Thickness(0, 0, 14, 0), HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled });
        Grid.SetColumn(feedPane, 1);
        sides.Children.Add(feedPane);
        var dlg = new ContentDialog { Title = "Updates", Content = sides, CloseButtonText = "Close", XamlRoot = RootGrid.XamlRoot, RequestedTheme = ElementTheme.Dark };
        dlg.Resources["ContentDialogMaxWidth"] = 1160.0;   // room for the feed beside the three parts
        _updatesDlg = dlg;
        try { await dlg.ShowAsync(); } catch (Exception ex) { SetStatus("updates: " + ex.Message); }
        finally { _updatesDlg = null; }
    }

    /// <summary>Numeric version order (0.26.9 before 0.26.10); anything after a '+' or a space is not compared.</summary>
    private static int CompareVersions(string a, string b)
    {
        static int[] Parts(string v) => v.Split('+', ' ')[0].TrimStart('v').Split('.', '-').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
        var x = Parts(a); var y = Parts(b);
        for (var i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            var d = (i < x.Length ? x[i] : 0) - (i < y.Length ? y[i] : 0);
            if (d != 0) return d < 0 ? -1 : 1;
        }
        return 0;
    }

    /// <summary>The staged version started, this one closed (the hand-off App.OnLaunched makes at every start, here by the person's press).</summary>
    private void RestartIntoStaged()
    {
        var st = Services.Updates.Staged();
        if (st is null) { SetPill("Prism" + Mid + "nothing is staged"); return; }
        // the staged copy installs itself into the install folder once this one has closed (--prism-promote), then starts Prism from there
        if (Services.Updates.StartPromotion(LogLine)) Close();
        else SetPill("Prism" + Mid + "could not start " + st.Value.version);
    }

    // ---- the restart offer (2026-10-06, "can you show a restart now button temporarily with the status that comes up suggesting restart"): when a
    // new version has finished installing - Install now, or the night window (RefreshUpdateNotice) - the status line says so with a Restart now button beside it, once
    // per version, for 45 seconds; any other status line takes its place. The Updates dialog and the menu's note still say it after.
    private Button? _pillAction;
    private string? _pillActionFor;
    private string? _restartOffered;

    private void OfferRestartIfStaged()
    {
        if (Services.Updates.Staged() is not { } st || st.version == _restartOffered) return;
        _restartOffered = st.version;
        ShowPillOffer("Prism" + Mid + st.version + " is installed. Restart to switch to it", "Restart now", RestartIntoStaged, 45);
        LogLine("updates: " + st.version + " installed, restart offered");
    }

    /// <summary>A status line with one button beside it, held for a while; any other status line takes its place and the button goes with it.</summary>
    private void ShowPillOffer(string text, string button, Action press, int seconds)
    {
        SetPill(text, hold: true);
        RootGrid.DispatcherQueue.TryEnqueue(() =>
        {
            if (_pillAction is not null) PillRow.Children.Remove(_pillAction);
            var b = Chip(new TextBlock { Text = button, FontSize = 12, Foreground = HubAmber }, true);
            b.Padding = new Thickness(10, 2, 10, 2);
            b.Click += (_, __) => press();
            PillRow.Children.Add(b);
            _pillAction = b; _pillActionFor = text;
            var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(seconds) };
            t.Tick += (_, __) => { t.Stop(); if (_pillActionFor == text) ReleasePill(""); };
            t.Start();
        });
    }

    /// <summary>
    /// The first-run note (2026-10-06, "add the first-run note"): a download installs itself silently into the fixed folder on its first run, so
    /// the installed copy says once where Prism now lives - the Start menu - and that the folder it was unzipped into can be deleted, with a
    /// button that opens that folder. Someone moved over from an older Prism's update folder gets the first half only: that folder is
    /// removed by Prism itself. Shown a few seconds into the start, after the splash, for a minute.
    /// </summary>
    private void ShowInstalledNoteIfAny()
    {
        if (Services.Updates.InstalledFrom() is not { } from) return;
        var oldUpdate = Services.Updates.IsOldUpdateFolder(from);
        LogLine("updates: first-run note (installed from " + (oldUpdate ? "an older update folder" : from) + ")");
        // the shortcuts asked first (2026-10-06, "we should prompt the user to see whether they want to add a shortcut to their desktop, taskbar,
        // start menu"); someone moved over from an older Prism's update folder already had theirs, repointed at the install folder
        _ = Task.Delay(TimeSpan.FromSeconds(6)).ContinueWith(_ => RootGrid.DispatcherQueue.TryEnqueue(async () =>
        {
            if (!oldUpdate) await AskShortcutsAsync(true);
            if (oldUpdate || !System.IO.Directory.Exists(from))
                SetPill("Prism" + Mid + "installed. It updates itself from now on.");
            else
                ShowPillOffer("Prism" + Mid + "installed. You can delete the folder you downloaded it to.", "Show that folder", () => OpenPath(from), 60);
        }));
    }
}
