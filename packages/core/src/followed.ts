/**
 * The channels a household follows, as one row across services (2026-10-12, "I want youtube subs and twitch followed merged into 1 line"):
 * Twitch's Followed channels and YouTube's Subscriptions, the live ones first, each card still its service's. A Twitch channel says whether it
 * is live on its own card; a YouTube channel is live when the service's latest-videos row carries a LIVE video of that channel ("give youtube
 * that functionality": YouTube's Subscriptions page names no on-air state, its feed does). Hide offline on the row leaves the rest out.
 */
import type { VideoItem } from "./types.js";
import { publishedAt } from "./categories.js";

export interface FollowedCard { app: string; service: string; facet: string; item: VideoItem }

const isChannel = (i: VideoItem): boolean => i.kind === "channel" || i.kind === "live";
/** A channel row: a service's own row whose items are channels. */
export function isChannelRow(r: { items: ReadonlyArray<VideoItem> }): boolean { return r.items.length > 0 && r.items.every(isChannel); }
const key = (s: string): string => s.toLowerCase().replace(/^https?:\/\/[^/]+\//, "").replace(/\/+$/, "").replace(/^@/, "").replace(/[^a-z0-9]+/g, "");
export const isLiveCard = (i: VideoItem): boolean => i.kind === "live" || i.badge === "LIVE";

export function followedRow(services: ReadonlyArray<{ app: string; name: string; facet: string; own: ReadonlyArray<{ title: string; items: VideoItem[] }> }>): FollowedCard[] {
  const out: FollowedCard[] = [];
  for (const s of services) {
    const channelRows = s.own.filter(isChannelRow);
    if (!channelRows.length) continue;
    // the channels live now, by the service's own LIVE mark on a video of theirs in its other rows (the channel's name, handle or address)
    const liveNow = new Set<string>();
    for (const r of s.own) {
      if (isChannelRow(r)) continue;
      for (const v of r.items) {
        if (!isLiveCard(v)) continue;
        const named = v.channel ?? (v.subtitle ?? "").split(" · ")[0] ?? "";
        if (named) liveNow.add(key(named));
        if (v.channelUrl) liveNow.add(key(v.channelUrl));
      }
    }
    for (const r of channelRows) {
      for (const it of r.items) {
        const live = isLiveCard(it) || liveNow.has(key(it.title)) || liveNow.has(key(it.id)) || (!!it.url && liveNow.has(key(it.url)));
        // the kind stays the service's (a YouTube channel plays as a channel); the mark and the line under say it is live
        const item = live && !isLiveCard(it) ? { ...it, badge: "LIVE", subtitle: ["Live", it.subtitle].filter((x): x is string => !!x).join(" · ") } : it;
        out.push({ app: s.app, service: s.name, facet: s.facet, item });
      }
    }
  }
  // live first; within each group the services' own order, as given (a stable sort)
  return out.map((c, i) => ({ c, i })).sort((a, b) => (isLiveCard(b.c.item) ? 1 : 0) - (isLiveCard(a.c.item) ? 1 : 0) || a.i - b.i).map((x) => x.c);
}

/**
 * The latest videos from the channels a household follows, one row across services (2026-10-13, "I want there to just be 1 category for Latest
 * videos from channels you follow (not 1 for channels in twitch and 1 for youtube)"): every service that lists followed channels gives its
 * other own rows (Twitch's latest videos from followed channels, YouTube's latest from subscriptions), live first, then newest first by the
 * date each service shows beside its video, each card still its service's.
 */
export function latestRow(services: ReadonlyArray<{ app: string; name: string; facet: string; own: ReadonlyArray<{ title: string; items: VideoItem[] }> }>, now: number): FollowedCard[] {
  const out: Array<{ c: FollowedCard; at: number; i: number }> = [];
  for (const s of services) {
    if (!s.own.some(isChannelRow)) continue;
    for (const r of s.own) {
      if (isChannelRow(r)) continue;
      for (const v of r.items) out.push({ c: { app: s.app, service: s.name, facet: s.facet, item: v }, at: publishedAt(v.subtitle, now) ?? publishedAt(v.badge, now) ?? 0, i: out.length });
    }
  }
  return out.sort((a, b) => (isLiveCard(b.c.item) ? 1 : 0) - (isLiveCard(a.c.item) ? 1 : 0) || b.at - a.at || a.i - b.i).map((x) => x.c).slice(0, 80);
}
