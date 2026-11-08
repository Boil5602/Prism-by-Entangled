using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace PrismWebView2Poc
{
    /// <summary>
    /// POC only (see docs/reports/webview2-poc.md): two WebView2 tiles
    /// (Netflix / Hulu), persistent per-service profiles, hero switching,
    /// and an EME probe per tile. No solver, no veil, no orchestration.
    /// </summary>
    public partial class MainWindow : Window
    {
        // Persistent, per-service user-data folders so logins survive restarts.
        private static readonly string DataRoot =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PrismWebView2Poc");

        private string _emeNetflix = "probing…", _emeHulu = "probing…";

        public MainWindow()
        {
            InitializeComponent();
            Loaded += async (_, __) => await InitAsync();
        }

        private async Task InitAsync()
        {
            await InitViewAsync(ViewNetflix, "netflix", "https://www.netflix.com/", StatusNetflix, v => _emeNetflix = v, () => _emeNetflix);
            await InitViewAsync(ViewHulu, "hulu", "https://www.hulu.com/", StatusHulu, v => _emeHulu = v, () => _emeHulu);
        }

        private async Task InitViewAsync(WebView2 view, string name, string url,
            System.Windows.Controls.TextBlock status, Action<string> setEme, Func<string> getEme)
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataRoot, name));
                await view.EnsureCoreWebView2Async(env);
                view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                view.CoreWebView2.Settings.IsStatusBarEnabled = false;

                view.CoreWebView2.WebMessageReceived += (_, e) =>
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(e.TryGetWebMessageAsString());
                        if (doc.RootElement.GetProperty("type").GetString() != "eme") return;
                        var pr = Label(doc.RootElement.GetProperty("playready").GetString());
                        var wv = Label(doc.RootElement.GetProperty("widevine").GetString());
                        setEme($"PlayReady: {pr} | Widevine: {wv}");
                        Paint(status, name, view, getEme());
                    }
                    catch { /* not our message */ }
                };
                view.CoreWebView2.NavigationCompleted += async (_, __) =>
                {
                    Paint(status, name, view, getEme());
                    await ProbeAsync(view);
                };
                view.CoreWebView2.SourceChanged += (_, __) => Paint(status, name, view, getEme());
                view.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                status.Text = $"{name}: WebView2 init failed — {ex.Message}";
            }
        }

        // navigator.requestMediaKeySystemAccess per key system; robustness values
        // tried strongest-first. PlayReady recommendation uses "3000" (hardware)
        // and "2000" (software) — mapped to the HW/SW labels in Label().
        private static async Task ProbeAsync(WebView2 view)
        {
            const string js = @"
(async () => {
  async function probe(ks, list) {
    for (const r of list) {
      try {
        const cfg = [{ initDataTypes: ['cenc'],
          videoCapabilities: [{ contentType: 'video/mp4; codecs=""avc1.640028""', robustness: r }],
          audioCapabilities: [{ contentType: 'audio/mp4; codecs=""mp4a.40.2""', robustness: '' }] }];
        const a = await navigator.requestMediaKeySystemAccess(ks, cfg);
        const got = a.getConfiguration().videoCapabilities[0].robustness;
        return got || r || 'accepted-any';
      } catch (e) {}
    }
    return 'rejected';
  }
  const playready = await probe('com.microsoft.playready.recommendation', ['3000', '2000', '']);
  const widevine = await probe('com.widevine.alpha', ['HW_SECURE_ALL', 'SW_SECURE_DECODE', 'SW_SECURE_CRYPTO', '']);
  window.chrome.webview.postMessage(JSON.stringify({ type: 'eme', playready, widevine }));
})();";
            try { await view.CoreWebView2.ExecuteScriptAsync(js); } catch { }
        }

        private static string Label(string raw) => raw switch
        {
            "3000" => "HW_SECURE_ALL (3000)",
            "2000" => "SW_SECURE_DECODE (2000)",
            null or "" => "rejected",
            _ => raw,
        };

        private void Paint(System.Windows.Controls.TextBlock status, string name, WebView2 view, string eme)
        {
            var url = "";
            try { url = view.CoreWebView2?.Source ?? ""; } catch { }
            status.Text = $"{name}: {url}  |  {eme}";
        }

        // ------------------------------------------------------------- hero
        private void SetHero(string who)
        {
            // plain layout change: hero gets 3*, the other 1* (~75% / 25%)
            ColLeft.Width = new GridLength(who == "netflix" ? 3 : 1, GridUnitType.Star);
            ColRight.Width = new GridLength(who == "hulu" ? 3 : 1, GridUnitType.Star);
            HeroLabel.Text = $"hero: {who}";
        }

        private void NetflixHero_Click(object sender, RoutedEventArgs e) => SetHero("netflix");
        private void HuluHero_Click(object sender, RoutedEventArgs e) => SetHero("hulu");
        private void Swap_Click(object sender, RoutedEventArgs e) =>
            SetHero(HeroLabel.Text.Contains("netflix") ? "hulu" : "netflix");
    }
}
