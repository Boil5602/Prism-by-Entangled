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
    }
}
