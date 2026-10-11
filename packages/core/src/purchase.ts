import type { AdapterSpec } from "./adapters.js";
import { providersOf } from "./catalog-search.js";

/**
 * Buying and renting (2026-10-11, "Maybe we should show a buy option but give them a QR code to perform the transaction on their
 * phones"): a title's Rent or Buy offer on a service becomes an address for the person's phone, where the price is shown and the
 * purchase is theirs to make. Prism takes no part in it: it never handles payment, takes no cut and adds no referral code, as it
 * never signs anyone up (docs/third-party-services-policy.md).
 *
 * The address is the service's own search page for the title (the adapter's videoSearchUrl), never a third party's link: a link
 * through an availability service would carry that service's own tracking. A service whose adapter has no search address gets no
 * offer.
 *
 * Where a service sells is the service's own fact ("Some are fine to point to their native apps ... some only allow purchasing through
 * a browser"): an adapter may say so in `purchase`, with the source it was read from, and only then is it said on screen. Where
 * nothing is recorded the card says, in general words, what to do when the phone's app shows no way to buy.
 */
export interface PurchaseOffer {
  /** The service's own search page for the title. */
  url: string;
  /** Where the service sells, when its adapter records it. */
  where?: "app" | "browser";
  /** The adapter's own sentence about it, shown as written. */
  note?: string;
}

function cleanIds(raw: unknown): number[] {
  return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0) : [];
}

/** The provider ids of a service's store, where its adapter names one apart from its subscription (purchaseProviders), cleaned. */
export function storeProvidersOf(spec: AdapterSpec | undefined): number[] { return cleanIds((spec as { purchaseProviders?: unknown } | undefined)?.purchaseProviders); }

/** The offer for a title on the service that owns this TMDB provider id, or null when no adapter with a search address claims it. */
export function purchaseOffer(adapters: Iterable<AdapterSpec | undefined>, providerId: number, title: string): PurchaseOffer | null {
  const name = title.trim();
  if (!name || !Number.isInteger(providerId) || providerId <= 0) return null;
  for (const spec of adapters) {
    if (!spec) continue;
    const s = spec as AdapterSpec & { purchaseProviders?: unknown; purchase?: { where?: unknown; note?: unknown } };
    if (!providersOf(spec).includes(providerId) && !cleanIds(s.purchaseProviders).includes(providerId)) continue;
    const search = typeof spec.videoSearchUrl === "string" ? spec.videoSearchUrl : "";
    if (!search.startsWith("https://") || !search.includes("{q}")) continue;
    const where = s.purchase?.where === "app" || s.purchase?.where === "browser" ? s.purchase.where : undefined;
    const note = typeof s.purchase?.note === "string" && s.purchase.note.trim() ? s.purchase.note.trim() : undefined;
    return { url: search.replace("{q}", encodeURIComponent(name)), ...(where ? { where } : {}), ...(note ? { note } : {}) };
  }
  return null;
}
