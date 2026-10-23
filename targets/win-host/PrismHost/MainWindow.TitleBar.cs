namespace PrismHost;

/// <summary>
/// The window's own title bar in the host's colours (2026-10-22, "Can we darken the header/title bar of the Prism app? Lets choose a color or
/// colors that fit the apps theme better than the light gray in use"). Windows drew it in the system's light grey over a dark window. It is
/// now the ground the canvas sits on, with ink for the title and the caption buttons, the chip hover and pressed fills under the buttons,
/// and the page colour with dim ink while another window is in front. Every colour is a token (Tokens.cs); the title bar itself stays
/// Windows' own, so a drag, a double-click and the caption buttons behave as they always did.
/// </summary>
public sealed partial class MainWindow
{
    private void ApplyTitleBarColours()
    {
        try
        {
            var tb = AppWindow.TitleBar;
            tb.BackgroundColor = Tokens.GroundColor;
            tb.ForegroundColor = Tokens.InkColor;
            tb.InactiveBackgroundColor = Tokens.PageColor;
            tb.InactiveForegroundColor = Tokens.DimColor;
            tb.ButtonBackgroundColor = Tokens.GroundColor;
            tb.ButtonForegroundColor = Tokens.InkColor;
            tb.ButtonHoverBackgroundColor = Tokens.ChipHoverColor;
            tb.ButtonHoverForegroundColor = Tokens.InkColor;
            tb.ButtonPressedBackgroundColor = Tokens.ChipPressedColor;
            tb.ButtonPressedForegroundColor = Tokens.InkColor;
            tb.ButtonInactiveBackgroundColor = Tokens.PageColor;
            tb.ButtonInactiveForegroundColor = Tokens.DimColor;
        }
        catch (Exception ex) { LogLine("title bar colours: " + ex.Message); }   // an older Windows keeps its own bar; never a failed start
        ApplyWindowIcons();
        // the taskbar takes its button's picture when the button appears, after this constructor: sent at start alone, the button still came up
        // generic (2026-10-23 11:15, "the prism icon is missing again from the taskbar"), and a fresh send to the running window fixed it at once.
        // So the icons go again when the window is first shown, and once more three seconds on.
        Activated += (_, __) =>
        {
            if (_iconsAfterShow) return;
            _iconsAfterShow = true;
            ApplyWindowIcons();
            _iconsAgain = DispatcherQueue.CreateTimer();   // a field: a timer held only by a local can be collected before it fires (it never logged, 2026-10-23)
            _iconsAgain.Interval = TimeSpan.FromSeconds(3); _iconsAgain.IsRepeating = false;
            _iconsAgain.Tick += (_, __) => { ApplyWindowIcons(); LogLine("window icons: sent after the window was shown"); _iconsAgain = null; };
            _iconsAgain.Start();
        };
    }
    private bool _iconsAfterShow;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _iconsAgain;

    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] private static extern IntPtr LoadImage(IntPtr hinst, string name, uint type, int cx, int cy, uint flags);
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);

    /// <summary>The taskbar's icon (2026-10-23, "the prism icon isnt showing for the application while running. It's just a default windows icon"):
    /// with the title bar coloured the taskbar button fell back to Windows' generic window icon, though the title bar itself showed the mark.
    /// The window is handed the icon again at the system's large and small sizes for its DPI (WM_SETICON), drawn from the same prism.ico;
    /// sending exactly that to the running window turned the taskbar button into the Prism mark at once.</summary>
    private void ApplyWindowIcons()
    {
        try
        {
            var ico = Path.Combine(AppContext.BaseDirectory, "Assets", "prism.ico");
            if (!File.Exists(ico)) return;
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var scale = Math.Max(1.0, GetDpiForWindow(hwnd) / 96.0);
            const uint ImageIcon = 1, LoadFromFile = 0x10;
            var big = LoadImage(IntPtr.Zero, ico, ImageIcon, (int)Math.Round(32 * scale), (int)Math.Round(32 * scale), LoadFromFile);
            var small = LoadImage(IntPtr.Zero, ico, ImageIcon, (int)Math.Round(16 * scale), (int)Math.Round(16 * scale), LoadFromFile);
            const int WmSetIcon = 0x80;
            if (big != IntPtr.Zero) SendMessage(hwnd, WmSetIcon, (IntPtr)1, big);
            if (small != IntPtr.Zero) SendMessage(hwnd, WmSetIcon, (IntPtr)0, small);
        }
        catch (Exception ex) { LogLine("window icons: " + ex.Message); }
    }
}
