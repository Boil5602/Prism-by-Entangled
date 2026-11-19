/**
 * The look-ahead (docs/features/look-ahead.md, 2026-11-17): the big screen plays a live channel a few seconds behind live while a
 * second page on the same channel, never seen, stays at the live edge for the shell's break watch. This file is the rule of when a
 * channel may be delayed. The shell asks it at each change of channel and does what it says; the timing of the covers is the break
 * watch's own (the shell's LookAheadPlan).
 *
 * The rule, in order:
 *  - the service's adapter says its player can be held behind live by the page's own buttons (videoLookAhead), else never;
 *  - a sports channel is never delayed, nor a game on any channel: the score reaches a phone first, and a delay would spoil it.
 *    Sports by the service's own word for the channel, an event row, or PRISM's rule on the channel's name and the programme's title
 *    (live-guide.ts, scores.ts) - the same words the Live tab files a channel under.
 */
import type { AdapterSpec } from "./adapters.js";
import { liveTypeOf } from "./live-guide.js";
import { sportOf } from "./scores.js";
import type { VideoChannel } from "./types.js";

export interface LookAheadAnswer {
  ok: boolean;
  /** "ok", or why not: the service has no look-ahead, or this is sport. */
  why: "ok" | "no-service" | "sports";
  channel: string;
  /** Seconds one press of the page's Back button moves the picture (the adapter's word). */
  backSec: number;
  /** The words the service's page shows when too many streams play on the account, as a pattern (the adapter's), or null. */
  tooMany: string | null;
}

/** Sports channels the Live tab's own rule on a name does not catch (ESPN2, ESPNU, FS1): for this rule a miss is a spoiled game, so the
 *  names are listed. PRISM's own list, as the Live tab's rule is. */
const SPORT_CHANNEL = /\bespn|\bfs[12]\b|\bbtn\b|big ten|\b(sec|acc) network|\bcbssn\b|\bnbcsn|\bbein\b|\btennis\b|\bmsg\b|\bnesn\b|\bsny\b|\byes network|\bmarquee\b|\bfanduel|\bbally/i;

/** A game by its title on a channel that is not a sports channel: two sides and "vs.", or one side "at" the other with a side of two
 *  words or more ("Toronto Maple Leafs at Chicago Blackhawks"; not "Live at Five"). A film with such a title is not delayed either. */
const GAME_TITLE = /[ ]vs?[.]?[ ]|^(?:[A-Z][A-Za-z.'&-]*[ ]){2,}at[ ][A-Z]|^[A-Z][A-Za-z.'&-]*[ ]at[ ](?:[A-Z][A-Za-z.'&-]*[ ])+[A-Z]/;

export function lookAheadFor(
  spec: Pick<AdapterSpec, "videoLookAhead"> | undefined,
  channel: Pick<VideoChannel, "name" | "now" | "url" | "category" | "tmdbType" | "tmdbTitle" | "event"> | null,
  /** The window's own word for its channel when the guide does not know it. */
  name: string,
  /** The programme on now by the guide, "" when unknown. */
  title: string,
): LookAheadAnswer {
  const la = spec?.videoLookAhead;
  const said = channel?.name ?? name;
  const base = { channel: said, backSec: la?.backSec ?? 0, tooMany: la?.tooMany ?? null };
  if (!la || !(la.backSec > 0)) return { ok: false, why: "no-service", ...base };
  const sports = channel
    ? liveTypeOf(channel).type === "Sports" || !!channel.event || !!sportOf(channel.category, channel.name)
    : !!sportOf(name) || liveTypeOf({ name, now: null, url: "", category: null }).type === "Sports";
  if (sports || SPORT_CHANNEL.test(said) || !!sportOf(title) || GAME_TITLE.test(title.trim())) return { ok: false, why: "sports", ...base };
  return { ok: true, why: "ok", ...base };
}
