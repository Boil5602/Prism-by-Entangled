# Recommended Hardware Builds v0.1

Four builds, one software ecosystem. Every build runs the same dashboards, adapters, remotes, and remote API. Prices are typical US street prices, August 2026. Example links are illustrative, not endorsements — budget-tablet listings churn constantly, so the guide's live parts list should be community-maintained in the repo.

---

## Build 1 — Tablet Base ("30 minutes, zero tools")

*The entry point. Order two things, install one app, done.*

| Part | Price | Example |
|---|---|---|
| 14" Android tablet (1920×1200 IPS, Android 15, 8GB+ RAM, stand case + USB-C PSU included — Maxsignage/URAO class) | ~$130 | [Amazon 14" example listing](https://www.amazon.com/Android-Widevine-10000mAh-Charging-Bluetooth/dp/B0F43F4VXZ) · [browse category](https://www.amazon.com/14-inch-tablet-android/s?k=14+inch+tablet+android) |
| 15.6" alternative: MESWAO-class Android tablet (sheet-music market) | $200–250 | [search "MESWAO 15.6 tablet"](https://www.amazon.com/s?k=MESWAO+15.6+android+tablet) |
| Shell app (open source) + optional hosted sync | $0 | — |
| **Total** | **~$130** | |

**Capabilities:** full touch dashboard, hero layout, 2–7 tiles, YouTube/radio/calendar/photos, BT speaker pairing, phone remote, schedules, motion wake (camera), content blocking.
**Limits:** ~15" max screen, built-in speakers mediocre until BT speaker added, DRM video 720p.
**Assembly:** none. Sits on counter/shelf in its case.

## Build 2 — Tablet Pro ("the weekend upgrade")

*Build 1 plus sound, remote, and wall presence.*

| Part | Price | Example |
|---|---|---|
| Build 1 | ~$130 | see above |
| 8BitDo Micro (keyboard mode) | $25 (often $15–20 on sale) | [Amazon](https://www.amazon.com/8Bitdo-Micro-Bluetooth-Pocket-sized-Controller-Switch-Raspberry-Nintendo/dp/B0CDG2HKBF) · [official shop](https://shop.8bitdo.com/products/8bitdo-micro-bluetooth-gamepad) |
| Powered soundbar or bookshelf pair (3.5mm/USB-C wired) | $30–50 | [search "small powered soundbar aux"](https://www.amazon.com/s?k=small+powered+soundbar+aux+input) |
| Shadow-box or routed wood frame + keyhole hanger | ~$20 | craft store / [search "16x10 shadow box"](https://www.amazon.com/s?k=shadow+box+frame+deep) |
| In-wall cable concealment kit | ~$15 | [search "in-wall cable management kit"](https://www.amazon.com/s?k=in+wall+cable+management+kit+tv) |
| **Total** | **~$220–240** | |

**Adds:** wired audio (no BT latency), physical remote with published key map, wall-mounted picture-frame look, hidden power.
**Limits:** same 720p DRM cap; screen size still 14–15".

## Build 3 — Pi Frame ("the open appliance")

*Flash the image, boot to dashboard. Any screen, any size, no Google anywhere.*

| Part | Price | Example |
|---|---|---|
| Raspberry Pi 5 (8GB) + PSU + SD | ~$100 | [The Pi Hut](https://thepihut.com) · official resellers via raspberrypi.com |
| Display: used monitor ($30–60) / new 15–24" IPS ($80–150) / portrait wall panel | varies | local used market / eBay |
| PIR motion sensor on GPIO (optional) | ~$3 | [search "HC-SR501 PIR"](https://www.amazon.com/s?k=HC-SR501+PIR+motion+sensor) |
| BT remote (8BitDo Micro) or phone-as-remote only | $0–25 | links above |
| Frame/mount materials | $20–40 | — |
| **Total** | **~$160–300** | |
| x86 variant: used Dell/Lenovo/HP mini PC | $120–150 | [eBay search "dell optiplex micro"](https://www.ebay.com/sch/i.html?_nkw=dell+optiplex+micro) |

**Capabilities:** everything in the spec — hero solver, isolated profiles, adapters via DevTools, per-window PipeWire audio, multi-BT remotes, HTTP API, carousel, schedules — plus Pi-only: any display size/orientation (portrait installs), HDMI-CEC display power, GPIO PIR wake, uBlock Origin native (strongest blocking of any build), fully auditable OS, flashable-image distribution.
**Limits:** DRM 720p (Widevine L3); browser video decode is the ceiling — 1080p YouTube fine, 4K not promised; comfort zone is 1 video tile + 4–5 light tiles; touch costs extra ($110+ touchscreen) so default control is phone/remote.
**Variant — x86 mini PC (~$120–150 used Dell/Lenovo tiny):** same image, removes the decode/RAM ceilings, often cheaper than Pi+accessories. Recommended over Pi for 4K displays or 6–7 heavy tiles.
**Assembly:** flash SD, connect display, mount. Weekend-project tier.

## Build 4 — TV Build ("$0 if you own a TV")

*The living room. Frame orchestrates; the TV's own apps play premium video at full quality.*

| Part | Price | Example |
|---|---|---|
| Route A (primary): Android TV box running the shell APK — onn 4K class ($20–30) or Nvidia Shield for 4K/Dolby Vision certification (~$150) | $20–150 | [Walmart search "onn google tv 4k"](https://www.walmart.com/search?q=onn+google+tv+4k+streaming+box) · [Amazon search "nvidia shield tv"](https://www.amazon.com/s?k=nvidia+shield+tv) |
| Route B (no-Google): Pi 5/mini PC → HDMI (the Build 3 image, touchless) | ~$100–150 | Build 3 links |
| Uses TV's remote via HDMI-CEC; BT remotes optional | $0 | — |
| **Total** | **$20–150** | |

**Capabilities:** full dashboard in 10-foot mode (d-pad navigation, scaled fonts, overscan-safe), CEC power control, TV-remote-as-frame-remote. Route A: `launch` tiles open native apps (Netflix, Disney+…) fullscreen via Android intents at full certified quality — including deep links into titles — and Back reliably returns to the dashboard; shell can register as the device launcher. Route B: `launch` tiles deep-link a streaming stick on another input (Roku ECP etc.), one CEC Active Source call returns.
**Limits:** no touch (by design — phone/web editor for setup); native apps launch fullscreen but cannot embed inside a grid tile (Android restriction); Home-button-to-dashboard may need a settings step on newer Google TV devices (Back always works); Route B browser tiles cap at 720p DRM.

---

## Build 5 — The Videophile (community-supported recipe)

*The only build where 4K premium streaming lives inside a tile. Windows + Edge = hardware PlayReady DRM. Community-maintained; Windows quirks are yours.*

| Part | Price | Example |
|---|---|---|
| Used x86 mini PC, 16GB RAM, with 4K-capable iGPU (8th-gen Intel or newer) | $120–180 | [eBay search "dell optiplex micro i5"](https://www.ebay.com/sch/i.html?_nkw=dell+optiplex+micro+i5) |
| 4K display or TV via HDMI | owned or varies | — |
| Windows 11 (typically included on used machines) + Edge kiosk recipe | $0 | recipe in the repo |
| BT remote / phone remote as usual | $0–25 | Build 2 links |
| **Total** | **~$150–200** (display owned) | |

**Capabilities:** everything in the dashboard spec via the Windows shell recipe, plus the unique one — Netflix/Disney+/etc. at 1080p–4K *inside grid tiles* (hardware PlayReady in Edge), no launch-and-leave needed. Full private-listening capture. 16GB = no tile budget constraints.
**Limits:** community-supported, not a core target — kiosk lockdown, auto-login, and update suppression are Windows-jank territory documented in the recipe; not the no-Google/no-Microsoft privacy build; 4K HDR specifics vary by codec/GPU/display chain.

## Cross-build feature matrix

| Feature | 1 Base | 2 Pro | 3 Pi | 4 TV |
|---|---|---|---|---|
| Touch | ● | ● | ○ (add-on) | — |
| Hero layout + carousel | ● | ● | ● | ● |
| Multi-BT remotes | ● | ● | ● | ● |
| Phone remote (WiFi API) | ● | ● | ● | ● |
| Wired hi-fi audio | ○ | ● | ● | ● (TV/soundbar) |
| Voice commands (shell speech) | ● | ● | ◐ (mic add-on) | ◐ |
| Motion wake | ● camera | ● camera | ● PIR | ○ |
| Content blocking | ● | ● | ●● (uBlock native) | ● |
| DRM video ceiling | 720p | 720p | 720p | native app quality |
| No-Google stack | — | — | ● | Route B only |
| Portrait / large displays | — | — | ● | ● (landscape) |
| Assembly effort | none | evening | weekend | none–evening |

● standard ◐ with add-on ○ optional — not applicable

Build 5 (Videophile) matches Build 3's x86 column everywhere, swaps the no-Google property for in-tile 4K DRM, and is community-supported rather than core.

## Source local first

Half this parts list is better bought locally, and the guide says so per part:

- **Used displays are the flagship local part** — Craigslist, Facebook Marketplace, and Buy Nothing groups move IPS monitors for $20–40 constantly, and every one is e-waste diverted from a shredder into a picture frame.
- **Mini PCs**: local IT refurbishers, e-waste recyclers with retail counters, and university surplus sales sell tested off-lease machines cheaper than shipping them.
- **Micro Center** (where present) stocks Pi 5s, SD cards, tablets, and open-box deals in-store.
- **Frames**: craft stores, Habitat ReStore, local frame shops — or a makerspace laser cutter with the community's frame templates. The frame is the most personal part of the build; it should come from your town, not a warehouse.
- **Speakers**: thrift stores are full of quality powered speakers for a few dollars.

The wizard surfaces these per-part. Community local-sourcing tips (regional chains, good refurbishers) belong in the repo's parts list alongside the online links.

## Universal accessories

- **8BitDo Micro** (~$25): the blessed remote, keyboard mode, ships with default key map.
- **BT speaker / powered soundbar** ($25–50): the single highest-value upgrade for kitchen music on any build.
- **Fully Kiosk license** ($8): only needed if using the interim single-WebView path before the shell app ships; the shell replaces it.
