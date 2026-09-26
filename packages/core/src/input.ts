/**
 * Input mapping (spec §7) and multi-remote rules (§11).
 *
 * Every BT HID remote is a keyboard as far as the shell is concerned; it
 * pushes `{ key, device? }` and core resolves a binding. Resolution order:
 *
 *   1. the dashboard's per-device override  (`inputs["device:<name>"]`)
 *   2. the dashboard's global map            (`inputs[KEY]`)
 *   3. the shipped default map               (DEFAULT_INPUT_MAP)
 *
 * All paired remotes are live at once; last event wins. Per-device
 * overrides are never required. `focusedMedia` targets the last tile that
 * produced audio.
 */

import type { InputBinding, InputMap } from "./types.js";

/** Prefix for per-device override blocks inside `inputs` (§11). */
export const DEVICE_PREFIX = "device:";

/**
 * Shipped default — matches the 8BitDo Micro in keyboard mode (d-pad →
 * arrows; A/B/X/Y → K/J/I/H; L/R → shoulder keys) plus the standard media
 * keys any headset button or media remote emits. Fully user-overridable:
 * a dashboard's `inputs` entry for the same key wins.
 */
export const DEFAULT_INPUT_MAP: InputMap = {
  MEDIA_PLAY_PAUSE: { tile: "focusedMedia", cmd: "play-pause" },
  MEDIA_PLAY: { tile: "focusedMedia", cmd: "play" },
  MEDIA_PAUSE: { tile: "focusedMedia", cmd: "pause" },
  MEDIA_NEXT: { tile: "focusedMedia", cmd: "next" },
  MEDIA_PREVIOUS: { tile: "focusedMedia", cmd: "prev" },
  MEDIA_STOP: { tile: "focusedMedia", cmd: "pause" },
  VOLUME_MUTE: { tile: "focusedMedia", cmd: "mute" },
  ARROW_LEFT: { action: "carousel-prev" },
  ARROW_RIGHT: { action: "carousel-next" },
  // TV d-pad (§12): arrows move the tile focus ring spatially; select
  // ACTIVATES the focused tile — a launch tile opens its app fullscreen, a
  // web tile becomes hero. While an ad's skip affordance is observed, select
  // is the §26 pass-through skip instead (the human chose the moment).
  KEYCODE_DPAD_LEFT: { action: "focus", value: "left" },
  KEYCODE_DPAD_RIGHT: { action: "focus", value: "right" },
  KEYCODE_DPAD_UP: { action: "focus", value: "up" },
  KEYCODE_DPAD_DOWN: { action: "focus", value: "down" },
  KEYCODE_CHANNEL_UP: { action: "carousel-next" },
  KEYCODE_CHANNEL_DOWN: { action: "carousel-prev" },
  DPAD_CENTER: { action: "activate" },
  ENTER: { action: "activate" },
  KEYCODE_DPAD_CENTER: { action: "activate" },
  KEYCODE_ENTER: { action: "activate" },
  KEYCODE_BUTTON_A: { action: "activate" },
  KEY_K: { tile: "focusedMedia", cmd: "play-pause" }, // 8BitDo A
  KEY_J: { tile: "focusedMedia", cmd: "hero" }, // 8BitDo B
  KEY_I: { tile: "focusedMedia", cmd: "next" }, // 8BitDo X
  KEY_H: { tile: "focusedMedia", cmd: "prev" }, // 8BitDo Y
  KEY_L: { action: "carousel-next" }, // 8BitDo R
  KEY_M: { action: "carousel-prev" }, // 8BitDo L
  ESCAPE: { action: "wake" },
  // §6a remote-hold: a HELD select opens the focused item's context sheet (the shell reports a
  // long press as the key name + "_LONG"; selection counts 0 actions in the §6a walk-test)
  ENTER_LONG: { action: "context-sheet" },
  DPAD_CENTER_LONG: { action: "context-sheet" },
  KEYCODE_DPAD_CENTER_LONG: { action: "context-sheet" },
  KEYCODE_ENTER_LONG: { action: "context-sheet" },
  KEYCODE_BUTTON_A_LONG: { action: "context-sheet" },
};

function isBinding(value: unknown): value is InputBinding {
  return typeof value === "object" && value !== null && ("tile" in value || "action" in value);
}

function lookup(map: InputMap | undefined, key: string): InputBinding | undefined {
  const value = map?.[key];
  return isBinding(value) ? value : undefined;
}

/** The per-device override block for a named remote, if the dashboard has one. */
export function deviceMap(inputs: InputMap | undefined, device: string | undefined): InputMap | undefined {
  if (!inputs || !device) return undefined;
  const block = inputs[`${DEVICE_PREFIX}${device}`];
  return typeof block === "object" && block !== null && !isBinding(block)
    ? (block as unknown as InputMap)
    : undefined;
}

/**
 * Resolve a key from a (possibly named) device to a binding, or undefined
 * when nothing — not even the default map — claims it.
 */
export function resolveBinding(
  inputs: InputMap | undefined,
  key: string,
  device?: string,
  defaults: InputMap = DEFAULT_INPUT_MAP,
): InputBinding | undefined {
  return lookup(deviceMap(inputs, device), key) ?? lookup(inputs, key) ?? lookup(defaults, key);
}

export type FocusDirection = "left" | "right" | "up" | "down";

/**
 * Spatial focus navigation over solved rects (§12 d-pad). From the current
 * tile, pick the nearest tile whose center lies in the requested direction
 * — weighted so straight-ahead beats diagonal — or stay put at an edge.
 */
export function nextTileInDirection(
  rects: Record<string, { x: number; y: number; w: number; h: number }>,
  current: string | null,
  direction: FocusDirection,
): string | null {
  const ids = Object.keys(rects);
  if (ids.length === 0) return null;
  if (!current || !rects[current]) return ids[0]!;
  const c = rects[current]!;
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const id of ids) {
    if (id === current) continue;
    const r = rects[id]!;
    const rx = r.x + r.w / 2;
    const ry = r.y + r.h / 2;
    const dx = rx - cx;
    const dy = ry - cy;
    let forward: number;
    let lateral: number;
    switch (direction) {
      case "left": forward = -dx; lateral = Math.abs(dy); break;
      case "right": forward = dx; lateral = Math.abs(dy); break;
      case "up": forward = -dy; lateral = Math.abs(dx); break;
      case "down": forward = dy; lateral = Math.abs(dx); break;
    }
    if (forward <= 0) continue; // not in that direction
    const score = forward + lateral * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best ?? current;
}

/** Named remotes a dashboard has overrides for — surfaced in edit mode (§11). */
export function overriddenDevices(inputs: InputMap | undefined): string[] {
  if (!inputs) return [];
  return Object.keys(inputs)
    .filter((k) => k.startsWith(DEVICE_PREFIX) && deviceMap(inputs, k.slice(DEVICE_PREFIX.length)))
    .map((k) => k.slice(DEVICE_PREFIX.length));
}
