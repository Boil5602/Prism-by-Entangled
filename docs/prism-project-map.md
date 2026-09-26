# PRISM by Entangled — Project Map

*Open-source dashboard frames: own the hardware, read the software, keep your attention.*

Everything ships under one name, **Prism**, in three layers: the frames you build, the software that runs them, and the site that guides you. Merge and Prism Photos sit alongside as companion products.

---

## 1 · The devices — **Prism Frames** (five builds, one ecosystem)

| Build | Name | Cost | Character |
|---|---|---|---|
| 1 | **Tablet Base** | ~$130 | 30 minutes, zero tools — 14″ touch frame on a counter |
| 2 | **Tablet Pro** | ~$220–240 | Wall-mounted wood frame, physical remote, wired sound — the Skylight killer |
| 3 | **Pi Frame** | ~$160–300 | Flash PrismOS, any screen/orientation, zero Google — the open appliance |
| 4 | **TV Build** | $20–150 | Your TV becomes the frame; native apps launch at full 4K |
| 5 | **The Videophile** | ~$150–200 | Community Windows recipe — the only 4K-DRM-in-a-tile build |

Shared capabilities across all builds: 2–7 live web tiles · hero layouts with aspect-aware solving · multiple Bluetooth remotes · phone pairing by QR · schedules, night mode, alarm clock · content blocking with attributed lists · VPN (WireGuard) · private listening to phones · living video previews · layout sharing.

## 2 · The software

**prism-core** — the shared TypeScript brain. Every behavior lives here once: the layout solver, audio-focus rules, tile lifecycle, refresh/no-white-frame engine, region focus, adapters runtime, remote API, pairing, alarms, sharing/validation. Shells implement only a thin driver seam; a conformance kit defines what counts as a Prism.

**Prism Shell** — the Android app. Runs Builds 1, 2, and 4 (tablets and TV boxes). Device-owner kiosk mode (Android disappears), WebView tiles with isolated per-tile profiles, intent-launch tiles for native TV apps, d-pad and touch complete.

**PrismOS** — the flashable Linux image (Pi 5 / x86 mini PC). Boots to dashboard in ~30s, Chromium tiles under a Wayland compositor, PIR motion wake on GPIO, HDMI-CEC power, native uBlock-class blocking, fully auditable, no Google anywhere. The Windows kiosk recipe (Build 5) is this daemon with Edge drivers, community-maintained.

**Prism Remote** — the phone PWA. Installed from a QR on the frame: full remote control, layout switching, private listening (frame audio to your headphones), tile sign-ins, one per family member, revocable per phone. iOS and Android, no app store.

**Prism Editor** — the web dashboard designer. The reference solver with live drag-the-hero reflow, device previews (tablet/TV/portrait), per-tile aspect hints and audio policy, region-focus picker, schema JSON export. What you design is pixel-identical on every device.

## 3 · The site — **entangled.world/prism**

**Build Wizard** — the front door. Four questions as four dimensions of a live tesseract; the projection resolves to your build, then guides you end-to-end: parts with criteria (specs over listings), local-sourcing tips, "already have it" cost re-totaling, copyable shopping list, then a step-by-step build guide to "It's alive."

**Layout Gallery** — community dashboards. Shared layouts are sanitized (accounts stripped, personal URLs become slots), validated automatically (fit scores per device computed by the solver; adapter/selector health from real compatibility data), remixable with attribution, CC0.

**Adapter repo (prism-adapters)** — per-site polish as data, not code: cleanup CSS/JS, theater modes, peek recipes, credibility labels (transparent sources only). Community-maintained; fixes ship without app updates.

**Parts list (prism-parts)** — the living sourcing guide: current known-good listings, regional and local options, criteria that outlive any listing.

**Compatibility dashboard** — the public dataset built from opt-in, per-incident, whitelisted broken-tile reports. Anyone can audit everything ever collected; it powers gallery health badges and adapter maintenance.

## 4 · Companion products

**Merge** — the family calendar (the original app, grown up). $59 per household, one-time, for the life of the major version. Multi-tenant sync with phones and Apple/Google calendars, web-first client, calendar tiles on every frame. Promises with teeth: 90-day shutdown notice, export always, server open-sourced if hosting ever ends. Sold only on the site — zero app-store exposure.

**Prism Photos** *(phase two/three concept)* — photos at wholesale: client-encrypted storage in your own bucket or the cooperative pool (rate-formula billing, open books, member votes, unilateral exit), deliberate sharing to family frames, legible client-side algorithms. Starts free today via iCloud Shared Album tiles.

## 5 · The principles underneath (what makes it one product)

- No ads, no data sales, no subscriptions for software, no attention mining
- Every filter and label traceable to a named, user-chosen source
- No telemetry — only inspectable, opt-in, per-incident compatibility reports
- Data minimization as architecture: the published inventory of everything a court order could yield
- Sessions and storage are never wiped by the software; only you delete
- Calm connection: content arrives because a person sent it, foregrounds once, never metricized
- Open source throughout; self-hosting is always the escape hatch; the conformance kit means anyone can build a Prism

*Status: spec complete (25 sections) · editor and wizard prototypes working · hardware guide with sourcing done · next: extract prism-core, build the Android driver seam, first dashboard on a real tablet.*
