using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace PrismHost;

/// <summary>
/// The host's design tokens (2026-10-17, the designer's pass): every colour the host draws from, in one place, so a surface's own
/// brushes are aliases of these and the one amber is the same amber on the menu grip, the Watch page, the rail, the wizard and the
/// phone. Two ambers had grown (#F2B14C on Watch and Details, #F0A83C on the menu, the pill, the rail and the wizard), four inks,
/// two dims and ten card fills. win-host-spec section 5 says what each colour is for: Ink for information, Amber for the one thing
/// to notice, Dim only for a secondary line under a primary one. The phone page carries the same values as CSS custom properties
/// (Services/RemotePage.cs, the :root rule); the XAML files carry them as literals, since XAML cannot read a C# field. The
/// visualizations' art palettes (Visualizations/Tableaus.cs, StylePacks.cs, StyleRenderer.cs) are pictures, not UI, and keep their
/// own colours. scripts/audit-tokens.mjs (a verify step) fails on a retired value anywhere else.
/// </summary>
public static class Tokens
{
    // ---- ink: what is written
    public static readonly Color InkColor = Color.FromArgb(255, 0xE8, 0xEC, 0xF2);       // information
    public static readonly Color DimColor = Color.FromArgb(255, 0x8A, 0x93, 0xA2);       // a secondary line under a primary one, never a row's only text
    public static readonly Color AmberColor = Color.FromArgb(255, 0xF2, 0xB1, 0x4C);     // the one thing to notice, the lit state
    public static readonly Color AmberInkColor = Color.FromArgb(255, 0x14, 0x17, 0x1C);  // text on an amber fill
    public static readonly Color DangerColor = Color.FromArgb(255, 0xD0, 0x6A, 0x5A);    // a verb that takes something away
    public static readonly Color TealColor = Color.FromArgb(255, 0x5C, 0xC8, 0xC0);      // a verified state (the rail's badges)

    // ---- ground: what is drawn on, darkest first
    public static readonly Color GroundColor = Color.FromArgb(255, 0x14, 0x17, 0x1C);      // the window and the tile canvas
    public static readonly Color PageColor = Color.FromArgb(255, 0x0F, 0x12, 0x16);        // a full page over the canvas (Watch, the curtain)
    public static readonly Color PanelColor = Color.FromArgb(255, 0x12, 0x13, 0x1A);       // a menu, the rail, the pill, a Details card
    public static readonly Color ChipColor = Color.FromArgb(255, 0x1C, 0x21, 0x29);        // a chip at rest, a slot in the rail
    public static readonly Color CardColor = Color.FromArgb(255, 0x22, 0x27, 0x30);        // a card, a window's face, the open tab
    public static readonly Color CardRaisedColor = Color.FromArgb(255, 0x2A, 0x30, 0x3A);  // a card on a card (settings)
    public static readonly Color ChipHoverColor = Color.FromArgb(255, 0x2C, 0x34, 0x42);
    public static readonly Color ChipPressedColor = Color.FromArgb(255, 0x24, 0x2A, 0x35);
    public static readonly Color ChipOnColor = Color.FromArgb(255, 0x3A, 0x2E, 0x14);      // a lit chip
    public static readonly Color ChipOnHoverColor = Color.FromArgb(255, 0x55, 0x43, 0x1C);
    public static readonly Color ChipOnPressedColor = Color.FromArgb(255, 0x47, 0x38, 0x17);

    public static readonly SolidColorBrush Ink = new(InkColor);
    public static readonly SolidColorBrush Dim = new(DimColor);
    public static readonly SolidColorBrush Amber = new(AmberColor);
    public static readonly SolidColorBrush AmberInk = new(AmberInkColor);
    public static readonly SolidColorBrush Danger = new(DangerColor);
    public static readonly SolidColorBrush Teal = new(TealColor);
    public static readonly SolidColorBrush Ground = new(GroundColor);
    public static readonly SolidColorBrush Page = new(PageColor);
    public static readonly SolidColorBrush Panel = new(PanelColor);
    public static readonly SolidColorBrush Chip = new(ChipColor);
    public static readonly SolidColorBrush Card = new(CardColor);
    public static readonly SolidColorBrush CardRaised = new(CardRaisedColor);
    public static readonly SolidColorBrush ChipHover = new(ChipHoverColor);
    public static readonly SolidColorBrush ChipPressed = new(ChipPressedColor);
    public static readonly SolidColorBrush ChipOn = new(ChipOnColor);
    public static readonly SolidColorBrush ChipOnHover = new(ChipOnHoverColor);
    public static readonly SolidColorBrush ChipOnPressed = new(ChipOnPressedColor);

    // ---- lines, rings and scrims: ink or the ground at an alpha
    public static readonly SolidColorBrush Clear = new(Color.FromArgb(0, 0, 0, 0));
    public static readonly SolidColorBrush Rule = new(Color.FromArgb(0x1C, 0xE8, 0xEC, 0xF2));       // a faint line on the page
    public static readonly SolidColorBrush TabRule = new(Color.FromArgb(0x5A, 0xE8, 0xEC, 0xF2));    // the tab strip's rule, the open tab's edge
    public static readonly SolidColorBrush Band = new(Color.FromArgb(0x14, 0xE8, 0xEC, 0xF2));       // a shaded band behind a row
    public static readonly SolidColorBrush Ring = new(Color.FromArgb(0x90, 0xE8, 0xEC, 0xF2));       // a window's ring in the corner
    public static readonly SolidColorBrush Edge = new(Color.FromArgb(0x26, 0xFF, 0xFF, 0xFF));       // a card's edge
    public static readonly SolidColorBrush Scrim = new(Color.FromArgb(0xD8, 0x05, 0x06, 0x09));      // behind a modal
    public static readonly SolidColorBrush LabelBack = new(Color.FromArgb(0xC8, 0x0B, 0x0D, 0x12));  // a label over a picture

    /// <summary>Amber at an alpha: the borders and washes the rail, the wizard and the menu draw (0x18 to 0x66), and a lit edge (0xB0).</summary>
    public static Color AmberColorAt(byte alpha) => Color.FromArgb(alpha, 0xF2, 0xB1, 0x4C);
    public static SolidColorBrush AmberAt(byte alpha) => new(AmberColorAt(alpha));
    public static Color DimColorAt(byte alpha) => Color.FromArgb(alpha, 0x8A, 0x93, 0xA2);
    public static Color TealColorAt(byte alpha) => Color.FromArgb(alpha, 0x5C, 0xC8, 0xC0);
    public static Color PanelColorAt(byte alpha) => Color.FromArgb(alpha, 0x12, 0x13, 0x1A);
    public static SolidColorBrush PanelAt(byte alpha) => new(PanelColorAt(alpha));

    // ---- shape, in DIPs
    public const double RadiusArt = 6;      // a picture's corners
    public const double RadiusCard = 8;     // a card, a window's face, a menu
    public const double RadiusPanel = 12;   // a settings card, a modal, the Resume bar
    public const double RadiusChip = 14;    // a chip (a pill of text)

    // ---- type, in px: the scale the pages are moving to (findings 4, 12 and 21 of the pass). Body is the smallest a row's only text may be.
    public const double TextSmall = 12;     // a secondary line under a primary one, in Dim
    public const double TextBody = 14;      // a line of information
    public const double TextLead = 16;      // a lead line, a chip's label
    public const double TextHead = 19;      // a card heading
    public const double TextRow = 22;       // a row head on Watch
    public const double TextTitle = 28;     // a page's or a dialog's title
    public const double TextDisplay = 40;   // the welcome page's title
}
