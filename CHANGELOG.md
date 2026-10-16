# Prism changelog

Every Windows release, newest first. The same notes travel in the update manifest and on the website.

## 0.34.0 - 2026-10-16 (alpha, cf5b09c5)

Simple Watch, a calmer Watch page. Switch it on in Watch settings, or choose Calm when Prism first opens. Continue watching comes first and larger, with a Resume button for the first title in it, then My list and The Binge, and every other row waits behind More to watch. Ratings, ribbons and row controls appear when you point at a card or reach it with the remote, nothing on the page moves by itself, and the small screens dim while you browse. The phone's Watch follows the same switch. Prism also uses much less of the PC when nothing plays, because idle hidden pages no longer hold a processor core each. Also new: Prism's own loading mark over every video window, Netflix's preview pictures over the slider again, three break choices for every YouTube TV channel, a minimum release year for The Binge, The Binge by genre and full rows on the phone, cover pictures from Nature, Cosmos and Museum art sets, and every screen with Play into on the phone's Video tab. Password managers can fill the phone keyboard's sign-in boxes. A title that starts while Watch is open moves into its corner, switching Watch's tabs no longer reloads the small screens, and when a service cannot find a title by itself its own search opens for you to pick from.

- download: https://prism.entangled.world/windows/Prism-0.34.0-cf5b09c5.zip
- sha256: 3c9a898af2c421ca28b7cfce9a89965ea06262a5dbbdc5eca9edb65b21c577fa
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.34.0

## 0.32.0 - 2026-10-15 (alpha, ee723725)

Multiview and ad covers, from a day of watching five streams at once. A title dropped or clicked onto a window replaces what that window shows, the big one included, and titles dropped one after another each get a window of their own. A window whose video has ended closes, and a window whose player slips out of its frame goes back by itself, after a restart or a graphics reset too. Twitch's side-by-side display ads are covered, the cover counts its ads, its muted-audio notice is hidden, and its content warning shows on the small windows with its own Start watching. Netflix's pause ad shows your show's own panel and a Play button with the ad covered, and Netflix's error page is caught and the title opened again once. The cover's pictures are the nature photos by default, with a choice in Watch settings, and Clear all is gone from the playing controls.

- download: https://prism.entangled.world/windows/Prism-0.32.0-ee723725.zip
- sha256: e1a4a2c59dce3120314f9bb2977f42a41497279c6a64445c8017bd1e93c21347
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.32.0

## 0.31.1 - 2026-10-15 (alpha, 87fa0b80)

New pictures, and they move. Prism's picture pool is now 134 hand-picked photos instead of nearly four thousand: coral reefs, Monument Valley, glaciers, wildflowers, lava, nebulae and more, all CC0 or public domain. Pictures that left the pool leave your PC too. The picture over an ad break now drifts slowly, easing in with a gentle pan the way the extension's start page does, and it stays still if Windows' animations are off.

- download: https://prism.entangled.world/windows/Prism-0.31.1-87fa0b80.zip
- sha256: 7708978fe6f8c4b96b8a1acc2f01b9bd7da34b64e999f973ad5f00e1effe7d91
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.31.1

## 0.31.0 - 2026-10-15 (alpha, 16c3b423)

The phone companion catches up with Prism. Watch settings open from the phone's menu in folded panels: your TMDB key and account, the rows' orders, ads and YouTube TV break covering, Prism's own updates with the changelog, each service's reads, The Binge's limits and Kids mode, and your categories. Long-press a card for its menu, with Play, Details, ten stars to rate it on TMDB, and one press to remove it from a service's Continue Watching or hide it from The Binge. Every card shows its TMDB score. Search opens in a sheet of its own with the box at the top, filters for Movies or TV shows, and the top result first. My Watchlist on the phone stays in step with Prism. On the PC, Watch settings are one subject a tab, Continue watching can sort by Last watched, the Pair a phone card can forget a phone, and each row's (i) says in plain words how it's picked, where it comes from and where to change it. Netflix's pause ad is covered, and a Twitch title can be removed from Continue Watching.

- download: https://prism.entangled.world/windows/Prism-0.31.0-16c3b423.zip
- sha256: 3381539e83e8d83c9ab9a763cf82dcc19cad719df20c46499b629e2c64b3cead
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.31.0

## 0.30.1 - 2026-10-13 (alpha, 0bbfddb0)

Fixes to this evening's 0.30.0. Every Continue watching card carries its name over the picture, since a service's continue picture is a still without the name. The name and the score share one line at the picture's foot, the name left and the score at the right. A catalog row's score window offers the rating stars instead of saying the title is unmatched. Remove on a Twitch Continue Watching card works: Prism's own guard against a playing page in the background had refused the one page that has to play, muted, for Twitch to forget the place. Unfollow on a Twitch channel opens the channel's videos page and presses again until the confirm shows.

- download: https://prism.entangled.world/windows/Prism-0.30.1-0bbfddb0.zip
- sha256: 37f70bb6f12bd507e1e77ff8b26ac6c897e3834d5a27c3bd7f0b63df9544e296
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.30.1

## 0.30.0 - 2026-10-13 (alpha, f69480ce)

Watch's cards now carry everything on the picture. A title's name is drawn over a picture that has none, TMDB's score sits on a pill coloured from red to green, your own rating stands beside it once you have rated, and a Continue watching card is washed grey over the part you have watched. Rest the pointer on the score to see where the number comes from and to rate the title on TMDB from there. The channels you follow on Twitch and YouTube are one row with the latest videos from them under it, Unfollow is on a card's menu, and Twitch's Continue Watching joins the row with a Remove of its own. The Live page opens on what is on now as cards with pictures, content creators live now beside the channels, and the timetable one press away. Categories of your own take hashtags and one clear rule each, filled from your services and the open pool, with every row's formula behind an (i) beside its name. YouTube is a Video player service with Watch later, History and your subscriptions. Netflix's and YouTube's ad breaks are covered. The phone manages playlists, opens Details sheets and sets Prism up. The Binge answers a stricter setting at once.

- download: https://prism.entangled.world/windows/Prism-0.30.0-f69480ce.zip
- sha256: f6bc0ac7198fe27f624a90107155e8f185668891fe2b94517c1c6715631170e0
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.30.0

## 0.29.1 - 2026-10-11 (alpha, 59d7d358)

Rent or buy by phone: a Rent or Buy logo on a title's Details page now shows a code that opens the service's own page for that title on your phone, where you see the price and pay with the account you already use there. Prism takes no part in the purchase. A new row on Watch, New in your library, leads with titles that joined your services' libraries this week. Ad covers on live channels: an infomercial that announces itself in its captions or as a sponsored program now holds one steady cover to the end of its half hour, and the big window keeps its channel after a restart. The tour says that a linked TMDB account keeps playlists and ratings the same on every device, speaks of live channels in general, and puts dragging a channel to a window first.

- download: https://prism.entangled.world/windows/Prism-0.29.1-59d7d358.zip
- sha256: a89a3771317b7b2d0c083b48c5a05d852db961e5d051ff843f3fea0a62d936d9
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.29.1

## 0.29.0 - 2026-10-11 (alpha, 84ae95df)

New: How Prism works, a tour of Prism in nine short subjects with a picture on every page. A notice at the top of the screen offers it once, and Show me plays a few seconds showing where it lives in the Prism menu. A page of the tour can open the real thing, and a Back to How Prism works button brings you back. The Prism menu is larger and the screen dims behind it. The words on the pairing card are bigger. On the phone, the Video tab can open a title in the service's own app on that phone, the Keyboard tab's arrows are a proper cross, and its password box shows only for a password.

- download: https://prism.entangled.world/windows/Prism-0.29.0-84ae95df.zip
- sha256: 496f8d9224d7545da15453f7313208e2282e063253d563c687f233b1b8c4a3b3
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.29.0

## 0.28.1 - 2026-10-10 (alpha, 3a8be2aa)

A privacy fix first: Prism's own log on your PC could hold what you typed on the phone keyboard, and it no longer records any of it. Nothing was sent anywhere unless you chose to send a report with a log excerpt. New: Get a free key in Watch settings walks you from no TMDB account to a working key with your phone. It shows a code for TMDB's sign-up page, a code for its key page, and a code that lets your phone send the key to Prism, then checks the key with TMDB before saying it works.

- download: https://prism.entangled.world/windows/Prism-0.28.1-3a8be2aa.zip
- sha256: 9e62176b533e615ed6c726d32a7123b90c9f45e4dbf6a37c560b278778180af0
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.28.1

## 0.28.0 - 2026-10-10 (alpha, ebc0028a)

Right-click a YouTube TV channel in Live to choose how its ad breaks are covered: On, Sure breaks only (just the breaks YouTube TV marks itself, and paid programmes), or Off. A channel moves to Sure breaks only by itself after three Not an ad presses in a week, and Watch settings holds that number. A paid programme now stays covered for its whole half hour. Before, the cover came down after five minutes.

- download: https://prism.entangled.world/windows/Prism-0.28.0-ebc0028a.zip
- sha256: f15d9c23732852556dae7a94834349c265f86796cc981d9367ecafdb9df59026
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.28.0

## 0.27.2 - 2026-10-10 (alpha, 82bb24fb)

The download is 17 MB smaller. Two Microsoft machine-learning libraries that came along with the Windows App SDK, and that Prism never used, are no longer included.

- download: https://prism.entangled.world/windows/Prism-0.27.2-82bb24fb.zip
- sha256: b359bef268a3b49bade5b43233fbb03d6ea29d105bbc4bb7fcbb16436dd98228
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.27.2

## 0.27.1 - 2026-10-09 (alpha, 57da6535)

Profiles and Full screen are back in the Prism menu. The PRISM splash plays its animation over Remote Desktop and on PCs where Windows animations are turned off.

- download: https://prism.entangled.world/windows/Prism-0.27.1-57da6535.zip
- sha256: f6bd7e73d29a45a076633ea4f44522e1fda20789b889d1fc0c71bb35e46bd86c
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.27.1

## 0.27.0 - 2026-10-09 (alpha, 21416c1a)

YouTube TV ad covers are now decided by a detector trained on marked recordings of ten channels. In our tests on hours it had never seen, it covered 93% of ad time and wrongly covered under 1% of the show. Covers start sooner and follow YouTube TV's own ad markers. A paid programme that says so on the screen is covered for its half hour, a phone number standing on the screen keeps a cover up, and NFL Network's breaks in a smaller picture are covered. The Prism menu is shorter: the two players, Set up services, Pair a phone, Remote Desktop Support, Updates, About and Quit. The Live tab answers at once, keeps its place while it loads and has a Top button. A title you pick plays on a service you already have rather than one that sells it. Not an ad is on the intermission menu, and its buttons are easier to read. Linking a TMDB account finishes when you press I approved it, and the Playlists tab says what it needs.

- download: https://prism.entangled.world/windows/Prism-0.27.0-21416c1a.zip
- sha256: 6a08befe6e1864fe805f66d3adf4abed1fd1f1571ffb0195190df8565e536736
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.27.0

## 0.26.28 - 2026-10-07 (alpha, 0ffe6c09)

YouTube TV break covers are more accurate, including live sports. Prism reads a game's commentary in the captions as the show, ignores a stadium's sponsor signs, and covers ads on channels with no logo by their own words. Ads Prism has seen before are recognised by their pictures in order. The big window gets the PC's attention first. In the Live guide a click plays a channel, and you can drag it onto a window. Cancel while a video starts takes the window back to what it was playing. YouTube TV windows show Prism's triangle while they load. An update button appears beside the report flag when an update is waiting. Playlists show only once a TMDB account is linked. Video player windows come back after a trip to the Music player. Swap shows each window's number large in its middle.

- download: https://prism.entangled.world/windows/Prism-0.26.28-0ffe6c09.zip
- sha256: ddabf4b1b53f506e959ecca72a43c30995a059f9991d1a0acd3943cc0c602ecc
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.28

## 0.26.27 - 2026-10-07 (alpha, 9fbd7d30)

A new PC no longer crashes on its first start. YouTube TV break covers are more accurate. A network's own promos stay covered, a show comes back uncovered sooner, and YouTube TV's own ads inside a break no longer lift the cover. Watch settings has a Video ads choice: veiled and muted, muted with the picture visible, or shown. YouTube TV windows stay dark with a loading ring until the channel plays. The report flag has Ad debug for telling Prism about ads it missed or covered by mistake. Updates can show what's changed beside the dialog.

- download: https://prism.entangled.world/windows/Prism-0.26.27-9fbd7d30.zip
- sha256: a2077f729d619fadd358d0f914b36e92af930d22cfa18716cc59d70c5e711fb2
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.27

## 0.26.26 - 2026-10-06 (alpha, 6354f6fb)

YouTube TV channel breaks are now covered. Prism watches the picture for the channel's logo, cuts to black and web addresses or phone numbers on screen, and covers a break it's sure of. Turn it off in Watch settings. Peacock live channel ads are covered. The playback fixer no longer restarts a show that's playing fine, and if it can't fix one it opens the title again where you were.

- download: https://prism.entangled.world/windows/Prism-0.26.26-6354f6fb.zip
- sha256: 8150b883ba4edeed2a845e75b5c310732b5a1cdccf1f95bfa094ae2759d9c11f
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.26

## 0.26.25 - 2026-10-06 (alpha, 49018c1b)

Peacock live channels hide Peacock's own guide and buttons. A show you left paused comes back paused. Live channels disable Next and Back to start and now show their resolution.

- download: https://prism.entangled.world/windows/Prism-0.26.25-49018c1b.zip
- sha256: 3e9bcba76794649b7dcc450e01b171d16b1f657bf2633b00ca172e44bdb8289c
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.25

## 0.26.24 - 2026-10-06 (alpha, f884aea5)

In multiview the controls sit at the bottom of the big window. A title you left paused comes back after a restart instead of the service's home page.

- download: https://prism.entangled.world/windows/Prism-0.26.24-f884aea5.zip
- sha256: 4fc9bc641b5255cabf187558a2826879d29029397fdfe18cf3b749ac252f258b
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.24

## 0.26.23 - 2026-10-06 (alpha, 0ddb5710)

An ad stays covered when another window is reopened in the middle of the break.

- download: https://prism.entangled.world/windows/Prism-0.26.23-0ddb5710.zip
- sha256: e80aa117399e05f63c83706d817552725d9c524f3e07fb3b597eca80c120f80a
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.23

## 0.26.22 - 2026-10-06 (alpha, 53f38662)

Multiview fits a narrow window better, with the big window on top and larger windows below. Details shows only with a TMDB key. A window's close button now hides with the other controls during an ad.

- download: https://prism.entangled.world/windows/Prism-0.26.22-53f38662.zip
- sha256: 0c3dd9f7c64433bfff28172ccef0fc81c11ef94224a939b35ba0a0611630df27
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.22

## 0.26.21 - 2026-10-06 (alpha, c681e940)

YouTube TV's own controls are hidden in favour of Prism's. Peacock profiles are read again, so a profile preset can choose one.

- download: https://prism.entangled.world/windows/Prism-0.26.21-c681e940.zip
- sha256: 42c9a1a6ee686e1e20410eef1e81c2ae4aaf3aaba5c14603e6b846782b966c4c
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.21

## 0.26.20 - 2026-10-06 (alpha, fcdc571a)

Multiview windows that turned see-through after closing Watch are now reliably restored.

- download: https://prism.entangled.world/windows/Prism-0.26.20-fcdc571a.zip
- sha256: b4e96d9e84671e686cd4c84446ec51dba4dcd8b04e6089384e2594fe3c6c9fbd
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.20

## 0.26.19 - 2026-10-06 (alpha, f9714e8c)

Multiview windows no longer turn see-through after a swap or a move.

- download: https://prism.entangled.world/windows/Prism-0.26.19-f9714e8c.zip
- sha256: 4be42658e95c0ea3b9970261b2939180fe1a86faaa69b3b84475ba10b574c396
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.19

## 0.26.18 - 2026-10-06 (alpha, fec4fbdd)

Offline followed channels can't be dragged into a window, while live ones can. A Hide offline box on followed channels rows, also in Watch settings, hides offline channels and the whole row when all are offline.

- download: https://prism.entangled.world/windows/Prism-0.26.18-fec4fbdd.zip
- sha256: 87cf9985bf30b33042f42ec9a9a632425d766969814edb56a1e991615b133419
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.18

## 0.26.17 - 2026-10-06 (alpha, 4b7267c8)

Skip Intro shows at the top centre when the big window is alone. Every Watch window shows its service logo. YouTube TV ads are now detected and covered where YouTube TV marks them.

- download: https://prism.entangled.world/windows/Prism-0.26.17-4b7267c8.zip
- sha256: 2f33c598f0c4fa1b93239179b3603d7c93f6e19e4c173212322b3e70829bb800
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.17

## 0.26.16 - 2026-10-06 (alpha, d9ace385)

A channel whose match hasn't started is no longer reopened after a restart either.

- download: https://prism.entangled.world/windows/Prism-0.26.16-d9ace385.zip
- sha256: 54c47e8125a73bd332aff40c2b85a701c03a10b680038ca4ce79a22083018ca0
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.16

## 0.26.15 - 2026-10-06 (alpha, 8430e5c6)

An ad break longer than two minutes stays covered while its countdown is still running, as on Paramount+.

- download: https://prism.entangled.world/windows/Prism-0.26.15-8430e5c6.zip
- sha256: d585c16ab1c2daadb7f6e6e14fb28dbebf52773d644a90a3986f1db732e2bdc6
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.15

## 0.26.14 - 2026-10-06 (alpha, 81be2f58)

Swap now lets you choose: each press picks the next window, numbers show on every window, and the swap happens three seconds after your last press. Channels whose match hasn't started are no longer reopened again and again.

- download: https://prism.entangled.world/windows/Prism-0.26.14-81be2f58.zip
- sha256: 36cb67209f75e1bac982430ed3fabf3cc0f929fe921319fb6b1c0c77fd7768e5
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.14

## 0.26.13 - 2026-10-06 (alpha, 1d3217ef)

Paramount+ live channels show Pause as unavailable and offer Mute. The Live tab leaves out channels with only an upcoming match. Opening a service's sign-in page no longer stops its playing windows. The Updates window stays usable while an update downloads.

- download: https://prism.entangled.world/windows/Prism-0.26.13-1d3217ef.zip
- sha256: 36271830bc1f3fbb5f79789e4bbb8d28a3db7606fa6f269dac7811a266ea3322
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.13

## 0.26.12 - 2026-10-06 (alpha, 5ebb6406)

A video whose player stalls on its own spinner, as Twitch can, is reopened at the same spot after half a minute. A reopened Apple TV title presses Play instead of sitting on its page.

- download: https://prism.entangled.world/windows/Prism-0.26.12-5ebb6406.zip
- sha256: 7e1a8a956047094fdd78590053f76730eb9c62e82b9ea1d1de9877a7c2de08d8
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.12

## 0.26.11 - 2026-10-06 (alpha, 0da5991d)

The video controls fade again after the mouse leaves the Prism window.

- download: https://prism.entangled.world/windows/Prism-0.26.11-0da5991d.zip
- sha256: 19749228ac497096376a230a5f5014431b1da89c28ef7afc903153a2a8b66cd9
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.11

## 0.26.10 - 2026-10-06 (alpha, aad16dcd)

The Profiles window lists every service once, A to Z, with who it's signed in as, its profile and Exclude on the same row.

- download: https://prism.entangled.world/windows/Prism-0.26.10-aad16dcd.zip
- sha256: bcf8c64fcd1fd8b14c3dbd538a7d96f4afba9e9151e443ab9471872d2a0f7bd8
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.10

## 0.26.9 - 2026-10-06 (alpha, 6d7583f3)

Send to playlist shows only once your TMDB account is linked, since playlists are kept there.

- download: https://prism.entangled.world/windows/Prism-0.26.9-6d7583f3.zip
- sha256: a103ad9b495ef2e34d64a32d0f5881ba141ac175769bd41537b58360029ec3ed
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.9

## 0.26.8 - 2026-10-06 (alpha, c0ff1d0e)

Watch's big window stays on the line under the tabs when you come back to Watch, with or without a title playing.

- download: https://prism.entangled.world/windows/Prism-0.26.8-c0ff1d0e.zip
- sha256: 33bc46ec3d7685a15596110c930e09c328493b764c181dc13b50e7bbc1967a72
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.8

## 0.26.7 - 2026-10-06 (alpha, 536755b7)

YouTube TV's library shelves show every picture. Without a TMDB key the Library is an A to Z grid with a letter strip. The big window's Play and Pause button now matches the player, and the big window lines up with the line under the tabs.

- download: https://prism.entangled.world/windows/Prism-0.26.7-536755b7.zip
- sha256: 0c060ec4e5828bb99586fb25a6fe02850d59a9a0b347facc95f2024ea8e6351d
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.7

## 0.26.6 - 2026-10-06 (alpha, 1e6e1c19)

After a restart, a title Prism brings back no longer shows its service page in Watch's big window. The big window says Starting until the title plays.

- download: https://prism.entangled.world/windows/Prism-0.26.6-1e6e1c19.zip
- sha256: 22ce4f159f459551074608fb41b76fe3b886bfd9c960bd5a8aa9ec002f79fede
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.6

## 0.26.5 - 2026-10-06 (alpha, 14d13929)

Your services is tidier. Music, Video, TMDB, This PC and adding a service are sections that open one at a time, and the TMDB section now shows. A new install asks where you want Prism's shortcuts: Start menu, desktop or taskbar.

- download: https://prism.entangled.world/windows/Prism-0.26.5-14d13929.zip
- sha256: 0ec9d55671b5d3f2242ebcb11df62416a9054c076b44be1db18fee17cbfb161c
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.5

## 0.26.4 - 2026-10-06 (alpha, 3e0ca60f)

A show picked on YouTube TV now starts its newest recording, or the one you left partway. Return to Watch while a title is starting now shows it in the big window once it plays.

- download: https://prism.entangled.world/windows/Prism-0.26.4-3e0ca60f.zip
- sha256: 6c134a8fcbc243c4b06a2c78062e2a2ed4110681e731be746a4ac4072a3018b3
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.4

## 0.26.3 - 2026-10-06 (alpha, bad51a18)

Changing captions or audio from Prism's menu no longer opens the Watch screen or shrinks the video.

- download: https://prism.entangled.world/windows/Prism-0.26.3-bad51a18.zip
- sha256: 0d6e63346120d086418570fa5efa4973ec1ac1ca4bc314f31df2de0e0c2e2dc6
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.3

## 0.26.2 - 2026-10-06 (alpha, 4c7b5e71)

Choose when Prism checks for updates: every day or once a week at a time you set, or never; the Updates dialog says when the next check is. The cover over a starting title now holds when you press Next episode, too. An update's status line says how much was downloaded.

- download: https://prism.entangled.world/windows/Prism-0.26.2-4c7b5e71.zip
- sha256: a11c507d92d808c9680608ed92b13880abe7c83a239dc0e23250b440647fd2cb
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.2

## 0.26.1 - 2026-10-06 (alpha, cbd55b62)

The cover over a starting title holds through a double-click and through moving to the previous episode, so the service's own pages no longer show. A new install says once that Prism is in the Start menu and the downloaded folder can go. The first update that downloads only the changed files.

- download: https://prism.entangled.world/windows/Prism-0.26.1-cbd55b62.zip
- sha256: 63c39a70e43f135aac50c270b4fc911474293051ac7f7294dfbccf4cef27d3a7
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.1

## 0.26.0 - 2026-10-06 (alpha, 76f5bd49)

Prism now installs itself into one folder that never moves, so Windows asks about the firewall once instead of with every update, and updates download only the files that changed. Set up services has a This PC step that asks Windows once for the phone's firewall rule and Remote Desktop Support. The report form takes ideas too, and lists the chosen player's services.

- download: https://prism.entangled.world/windows/Prism-0.26.0-76f5bd49.zip
- sha256: f27b5d8037c35d9307af246602792278a147b59a1cba2716fb431cade5528f7a
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.26.0

## 0.25.0 - 2026-10-06 (alpha, e61bdb1c)

When a new version finishes installing, the status line offers Restart now, and Restart into the new version works again. The Prism menu's switch is now named Remote Desktop Support, with a tooltip saying what it does. Library cards show each store's own poster when there is no TMDB key, instead of a darkened background.

- download: https://prism.entangled.world/windows/Prism-0.25.0-e61bdb1c.zip
- sha256: 8566a24dfb42e0096a663d185894702d00490eb3941201f60f51c2b3faceb0ca
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.25.0

## 0.24.0 - 2026-10-06 (alpha, 59eb49e9)

A flag in the top-right corner reports a problem: ads on the screen or something not working, for the Music or Video player and a chosen service, with an exact preview of what is sent. Quick play can remove the song playing now from your own Apple Music playlist. The Device page and the Prism menu hold a switch that keeps Prism's sound and screen when a remote desktop leaves. Set up services explains what TMDB adds and how its data practices differ from Prism's. Upcoming live events show a week out, and a service's own resume point always wins.

- download: https://prism.entangled.world/windows/Prism-0.24.0-59eb49e9.zip
- sha256: 71e66d4851475fd1ce69cbc56d53420c3e94fb2fdf32169f78a12857659914f7
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.24.0

## 0.23.0 - 2026-10-05 (alpha, fc5f5639)

The phone's low-delay listening plays again. Netflix's ad breaks and its two-screen message reach the phone, with Retry. The phone's Captions button opens the service's own subtitle and audio tracks, Skip shows only when a skip is on offer, and Apple TV's Formula 1 and MLS events sit in its Live section a week out. YouTube TV and Twitch join the Watch screen and the Live tab. The splash reads PRISM with the wordmark's run. The phone chooses which window it hears, and the PC's mute while it listens is the playback device's.

- download: https://prism.entangled.world/windows/Prism-0.23.0-fc5f5639.zip
- sha256: 33c89c01a05a78bc8abc09df9c0bebf69e07e37f317764240953376c81426c9a
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.23.0

## 0.22.0 - 2026-10-05 (alpha, d772ac8e)

First public Windows build: the Music and Video players across your services, the phone companion (keyboard, remote, private listening), one shared browser for every sign-in, playlists on your TMDB account, and updates from the Prism menu.

- download: https://prism.entangled.world/windows/Prism-0.22.0-d772ac8e.zip
- sha256: 9d7b658e115fc6b28e73922ead260ac0a96fbe88e5eb96718f35576193153c46
- release: https://github.com/Boil5602/Prism-by-Entangled/releases/tag/v0.22.0
