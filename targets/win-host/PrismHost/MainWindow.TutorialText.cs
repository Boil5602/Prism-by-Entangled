namespace PrismHost;

/// <summary>
/// The subjects of How Prism works and their words (the frame is MainWindow.Tutorial.cs). Every label named here was read from the
/// code on 2026-10-10: a label that changes there changes here in the same commit. A page's picture is Assets/tutorial/NAME.png,
/// where NAME is the page's first field. ASCII only, like the other files of on-screen text.
/// </summary>
public sealed partial class MainWindow
{
    private static TutorialTopic[] TutorialTopics() => new[]
    {
        new TutorialTopic("start", "Getting started", "Add your services, sign in, and find the Prism menu.", new[]
        {
            new TutorialPage("start-services", "Add your services",
                "Prism plays the services you already pay for, side by side. The Set up services page lists them under Music player and Video player.",
                new[]
                {
                    "Press a service's card to add it and sign in.",
                    "Add as many as you like, then press Done.",
                    "Come back any time from the Prism menu, Set up services.",
                },
                "Open Set up services", w => _ = w.ShowWelcomeAsync()),
            new TutorialPage("start-signin", "Sign in on the service's own page",
                "Pressing a card opens that service's real sign-in page inside Prism. Prism never sees your password, and the sign-in stays on this PC until you sign out.",
                new[]
                {
                    "New to a service? Create the account in your browser first, then press its card here.",
                    "Typing a password with a remote is slow. Your phone can be the keyboard. See the subject Your phone.",
                }),
            new TutorialPage("start-menu", "The Prism menu",
                "Press the Prism tab at the top of the screen, or F10. Everything else starts there.",
                new[]
                {
                    "Music player and Video player choose what Prism is showing.",
                    "Set up services, Pair a phone and Profiles.",
                    "Full screen (F11), Updates, How Prism works, About Prism and Quit Prism.",
                }),
        }),
        new TutorialTopic("watch", "Watching", "The Watch page, search, and a title's Details.", new[]
        {
            new TutorialPage("watch-page", "The Watch page",
                "The Video player opens on the Watch page. It gathers what your services offer into one place. You pick a title and Prism opens it on the right service.",
                new[]
                {
                    "The tabs along the top are Watch, Live, Library and Browse. Playlists joins them once a TMDB account is linked.",
                    "Esc on the video screen brings the Watch page back.",
                    "The gear opens Watch settings.",
                }),
            new TutorialPage("watch-search", "Search everywhere",
                "The magnifier beside the tabs searches all your services at once. Type a title, a person or a word.",
                new[]
                {
                    "Press Details on a result for its full page.",
                    "Press My List to keep it for later.",
                }),
            new TutorialPage("watch-details", "A title's Details",
                "Details brings a title together on one page: its trailer, the service to watch it on, and My List.",
                new[]
                {
                    "Watch on starts it on that service.",
                    "With a free TMDB key the page also shows the cast, Where to watch and the TMDB rating. See the subject TMDB extras.",
                }),
        }),
        new TutorialTopic("tmdb", "TMDB extras (optional)", "A free key adds cast pages, where to watch, ratings and playlists.", new[]
        {
            new TutorialPage("tmdb-what", "What a TMDB key adds",
                "TMDB is a free film and TV database. Prism works without it. With your own free key you also get:",
                new[]
                {
                    "Details pages with the cast, and where each title can be watched.",
                    "Every cast member's other films and series, one press away.",
                    "Your own ratings and playlists, once you link your account.",
                    "Getting a key takes about three minutes with your phone. Prism shows a code for each step.",
                },
                "Get a free key", w => _ = w.ShowTmdbGuideAsync()),
            new TutorialPage("tmdb-cast", "Follow the cast",
                "On a Details page, press a cast member's face to see their films and series. Press any of those for its own Details, and keep going from one to the next.",
                new[]
                {
                    "A person's titles sort by Release date or by Name.",
                }),
            new TutorialPage("tmdb-account", "Ratings and playlists",
                "Linking your TMDB account takes one more code to scan. After that you can rate titles from Prism and keep playlists. They are saved on your TMDB account, so they are yours anywhere you sign in to TMDB.",
                new[]
                {
                    "The Playlists tab appears on the Watch page once the account is linked.",
                    "Send to playlist is on a title's Details page.",
                }),
        }),
        new TutorialTopic("live", "Live TV and several windows", "The channel schedule, and up to five things on screen at once.", new[]
        {
            new TutorialPage("live-schedule", "Live",
                "The Live tab on the Watch page is a schedule of your live channels and what is on each.",
                new[]
                {
                    "Press a channel to watch it in the big window.",
                    "Search channels and shows finds one by name.",
                    "Right-click a channel for more: put it in another window, or choose how its ad breaks are covered.",
                }),
            new TutorialPage("live-windows", "Several windows",
                "Prism can show up to five things at once: one big window and four smaller ones.",
                new[]
                {
                    "In Live, right-click a channel and choose Add to window 2.",
                    "Or drag a title or a channel onto the + above the windows.",
                    "Press a small window to make it the big one.",
                    "The X in a window's corner clears it.",
                }),
        }),
        new TutorialTopic("ads", "Ad breaks", "How Prism covers ad breaks, and what to press when it gets one wrong.", new[]
        {
            new TutorialPage("ads-cover", "Intermission",
                "When Prism sees an ad break it covers the picture, mutes the sound, and brings your show back when the break ends. The ad still plays underneath. Prism covers ads and never blocks them.",
                new[]
                {
                    "The cover is a picture with a half-moon mark and its credit. Press the mark to open the cover's card.",
                    "On the card, Show ad 15s lifts the cover for a look.",
                    "Not an ad tells Prism it covered your show by mistake.",
                }),
            new TutorialPage("ads-live", "Live channels on YouTube TV",
                "Live channels don't say when a break starts, so Prism judges it from the picture, the sound and the captions. It is right most of the time and it is still learning.",
                new[]
                {
                    "Press Not an ad when it covers your show. After three presses in a week on one channel, Prism covers only that channel's sure breaks.",
                    "To choose for yourself, right-click the channel in Live and open Ad covers: On, Sure breaks only, or Off.",
                    "When an ad gets through, press the flag at the top right and choose Ads are on my screen.",
                }),
            new TutorialPage("ads-choice", "Your choice",
                "Watch settings decides what happens during a break on every service. Under General, Video ads offers Veiled and muted, Muted, picture visible, or Show.",
                new[]
                {
                    "Under Content updates, Cover breaks on YouTube TV channels turns the live covers on or off for every channel.",
                },
                "Open Watch settings", w => _ = w.ShowWatchSettingsAsync()),
        }),
        new TutorialTopic("music", "Music", "The Music player and its visuals.", new[]
        {
            new TutorialPage("music-player", "The Music player",
                "Choose Music player in the Prism menu, or use the Music and Video switch at the top right.",
                new[]
                {
                    "The visual moves with the music. The corner button, Next visual, goes through Prism Beams, Spectrum, Ribbon and Bloom, and Prism remembers your pick.",
                    "Right-click the stage and choose Visual style for more.",
                }),
        }),
        new TutorialTopic("phone", "Your phone", "A keyboard, a remote and private listening, paired by a code.", new[]
        {
            new TutorialPage("phone-pair", "Pair a phone",
                "Prism menu, Pair a phone shows a code. Scan it with your phone's camera. There is nothing to install: it opens a page in the phone's browser. The phone has to be on the same network as this PC.",
                new string[0],
                "Pair a phone", w => w.PairPhone()),
            new TutorialPage("phone-uses", "What the phone does",
                "The page on your phone has a tab for each job.",
                new[]
                {
                    "Keyboard: type on the phone and it lands in whatever box is focused on the PC. Good for sign-ins and search. Nothing you type is kept.",
                    "Music and Video: see what is playing and control it.",
                    "Private Listening: hear Prism's sound on the phone, for headphones late at night.",
                }),
        }),
        new TutorialTopic("profiles", "Profiles", "Who is signed in where, and presets for different people.", new[]
        {
            new TutorialPage("profiles", "Profiles",
                "Prism menu, Profiles opens a window that lists every service with who it is signed in as.",
                new[]
                {
                    "Sign in as someone else adds another person's sign-in to a service.",
                    "Save the choices as a preset, then switch presets from the Prism menu.",
                },
                "Open Profiles", w => _ = w.ShowProfilesWindowAsync()),
        }),
        new TutorialTopic("updates", "Updates and help", "How Prism updates itself, and how to report a problem.", new[]
        {
            new TutorialPage("updates", "Updates",
                "Prism checks for a new version once a day and installs it overnight. The check says nothing about you or this PC.",
                new[]
                {
                    "Prism menu, Updates has Check now and Show what's changed.",
                    "Track chooses Alpha, Beta or Full. Check chooses Every day, Once a week or Never.",
                },
                "Open Updates", w => _ = w.ShowUpdatesAsync()),
            new TutorialPage("help", "Reporting a problem",
                "The flag at the top right is Report a problem or an idea. Prism has no telemetry: a report goes out only when you write one and send it.",
                new[]
                {
                    "About Prism shows the version and where your data is kept on this PC.",
                }),
        }),
    };
}
