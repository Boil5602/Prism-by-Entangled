# Renting and buying, by the phone

"I think we need to talk about purchases. Maybe we should show a buy option but give them a QR code to perform the transaction on
their phones." (2026-10-11) "Some are fine to point to their native apps. Like Apple TV or music. But I know some only allow
purchasing through a browser because they don't sell through the manufacturer OS to save money."

## What a person does

- On a title's Details page, under Where to watch, the Rent and Buy rows list the services that sell it.
- Pressing a logo there opens a card: **Rent or buy on <service>**, the title, and a code. Scanning it opens the service's own page
  for the title on the phone, where the price is shown and the purchase is made with the account and payment already in use there.
- For one of the household's own services the card also has **Open here instead** (the title on the service's page in the big
  window, which is what the press did before 2026-10-11) and **I've bought it** (the service's lists are read again, so the title
  shows in the Library).
- A service Prism has an adapter for but the household has not set up shows the code alone. A service Prism has no adapter for has
  no card: its logo is information, as before.

## After the purchase (2026-10-11, "How does prism know that a show is available after it is rented or purchased outside of the
application? How do we quickly surface that item to the user?")

- Prism has no feed from a service: it learns of a purchase by reading the service's own pages on a hidden surface, the lists and
  Continue Watching every twenty minutes and the owned pages (the long walk) every six hours. A title bought and never started is
  on no Continue row, so on the timed schedule alone it could take hours to appear.
- **I've bought it, play it**: the service's own page knows a purchase the instant it is made, so the card's button opens the title
  there in the big window, where it plays, and reads the service's owned pages again behind it (`videoRefreshApp(app, true)`).
- **New in your library**: a title that joins a library Prism already knows is new to it for a week (`video.ts` keepOwned,
  newlyOwned; `new-owned` in the store), and the Watch page leads with those, newest first, before Continue watching. The first
  read of a library makes nothing new. Tests: `video-new-owned.test.ts`.
- Prime Video reports no library to Prism, so a purchase there shows only once it is played there. Reading its purchases page is
  an adapter of its own, not written.

## The rules it keeps

- **Prism takes no part in the purchase.** It never handles payment, takes no cut and adds no referral code, and the card says so.
  It never signs anyone up either (docs/third-party-services-policy.md).
- **The code is the service's own address**: its search page for the title (the adapter's `videoSearchUrl`), never a link through an
  availability service, which would carry that service's own tracking. Prism makes no request for it. The phone opens it.
- **No price is shown.** The availability data (JustWatch, through TMDB) says who sells a title, not for how much. The service's page
  shows the price.
- **Where a service sells is the service's own fact**, kept in its adapter with the source it was read from (`purchase: { where,
  note, source }`), and said on the card only when recorded. None is recorded yet. Read on 2026-10-11 and not firm enough to print:
  Apple's own guide describes buying and renting in the Apple TV app and says some other makers' devices cannot. News reports from
  2020 say Prime Video sells in its iPhone app, and 2022 reports say its Android app showed no Rent or Buy. Fandango at Home's
  support site has an article "Can I make purchases within the app?", which a search summary reads as yes on iOS, against what was
  expected, and the article itself would not load. Until one is confirmed the card says, in general words, what to do when the
  phone's app shows no way to buy.

## How it works

- Core `purchase.ts`: `purchaseOffer(adapters, providerId, title)` finds the adapter that claims the TMDB provider id (its
  `tmdbProviders`, or `purchaseProviders` for a store apart from the subscription: Amazon Video, 10, beside Prime Video) and makes
  the address from its `videoSearchUrl`. `runtime.ts` adds it as `buy` to each Rent and Buy offer of a title's details, and marks a
  store's offer as the household's own service.
- Host `MainWindow.PurchaseCard.cs` draws the card. `MainWindow.TitleDetails.cs` opens it from a Rent or Buy logo.
- Dev: `purchase demo`, `purchase close`.

## Tests

`packages/core/tests/purchase.test.ts`: the address and its encoding, a store's own id, where a service sells only when recorded,
nothing for an unknown provider, a service with no search address, or an address that is not https.

## Open

- **Not tried on a phone**: which services open their app from the code, which land on the title, and where the app has no way to
  buy. Each needs a try on an iPhone and an Android phone.
- The address is the service's search for the title, not the title's own page. A search that returns several titles leaves the
  choice to the person.
- The tour's Details page does not mention it yet: that line goes in with the release that carries the feature.
- YouTube and Google Play sell titles too and have no search address in an adapter, so they have no card.
