/**
 * Poster resolution (spec §31) — posters are FETCHED from the service's own
 * site the way a browser's "install app" does, never bundled. This module is
 * the pure logic: given a page's HTML (fetched by the shell — core never
 * fetches), produce the ordered icon candidates; given nothing usable,
 * produce the wordmark fallback (service name in Prism type on a hue derived
 * from the site's theme-color).
 *
 * Order (normative): web-app manifest icons → apple-touch-icon → og:image →
 * wordmark. The shell caches the winning image per profile; a cache entry is
 * page data on disk, not repo content.
 */

export interface PosterCandidate {
  /** Absolute URL to fetch. */
  url: string;
  /** Where it came from: manifest | apple-touch-icon | og:image. */
  source: "manifest" | "apple-touch-icon" | "og:image";
  /** Declared size (largest wins within a source); 0 = undeclared. */
  size: number;
}

export interface WordmarkFallback {
  kind: "wordmark";
  /** The text rendered in the Prism type. */
  name: string;
  /** Background hue: the page's theme-color when sane, else derived from the name. */
  background: string;
  /** Readable foreground for that background. */
  foreground: string;
}

const ABS = /^https?:\/\//i;

function absolute(href: string, baseUrl: string): string | null {
  try {
    if (ABS.test(href)) return href;
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

function largestDeclared(sizes: string | null): number {
  if (!sizes) return 0;
  let best = 0;
  for (const m of sizes.matchAll(/(\d+)x(\d+)/gi)) best = Math.max(best, Number(m[1]));
  if (/any/i.test(sizes)) best = Math.max(best, 1024);
  return best;
}

/** The page's <link rel="manifest"> href, absolute — the shell fetches it next. */
export function manifestUrl(html: string, baseUrl: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, "rel");
    if (rel && /(^|\s)manifest(\s|$)/i.test(rel)) {
      const href = attr(tag, "href");
      if (href) return absolute(href, baseUrl);
    }
  }
  return null;
}

/** Icon candidates from a fetched web-app manifest's JSON text. */
export function manifestIcons(manifestJson: string, manifestUrl: string): PosterCandidate[] {
  try {
    const m = JSON.parse(manifestJson) as { icons?: Array<{ src?: string; sizes?: string }> };
    const out: PosterCandidate[] = [];
    for (const icon of m.icons ?? []) {
      if (!icon.src) continue;
      const url = absolute(icon.src, manifestUrl);
      if (url) out.push({ url, source: "manifest", size: largestDeclared(icon.sizes ?? null) });
    }
    return out.sort((a, b) => b.size - a.size);
  } catch {
    return [];
  }
}

/** apple-touch-icon + og:image candidates straight from the page HTML. */
export function htmlIcons(html: string, baseUrl: string): PosterCandidate[] {
  const out: PosterCandidate[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, "rel");
    if (!rel || !/apple-touch-icon/i.test(rel)) continue;
    const href = attr(tag, "href");
    const url = href && absolute(href, baseUrl);
    if (url) out.push({ url, source: "apple-touch-icon", size: largestDeclared(attr(tag, "sizes")) });
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const prop = attr(tag, "property") ?? attr(tag, "name");
    if (!prop || !/^og:image(:secure_url)?$/i.test(prop)) continue;
    const content = attr(tag, "content");
    const url = content && absolute(content, baseUrl);
    if (url) out.push({ url, source: "og:image", size: 0 });
  }
  return out.sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || b.size - a.size);
}

/**
 * A service's SYMBOL at card size (2026-09-23, "Is there another fandango logo for the service images with just the big F? The chosen logo is
 * hard to read at this size"): the page's own small icon - <link rel="icon"> at 32-96 px, the size nearest 48 first, then larger ones - before
 * the poster. An app-store tile (Fandango's F over "FANDANGO / Stream for Free. Rent. Buy.") is a poster, not a symbol. Raster only (no SVG).
 */
export function markIcons(html: string, baseUrl: string): PosterCandidate[] {
  const out: PosterCandidate[] = [];
  for (const tag of html.match(/<link[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase().split(" ").filter((w) => w);
    if (!rel.includes("icon") || rel.includes("mask-icon")) continue;
    const href = attr(tag, "href");
    const url = href && absolute(href, baseUrl);
    if (!url || url.toLowerCase().split("?")[0]!.endsWith(".svg")) continue;
    out.push({ url, source: "manifest", size: largestDeclared(attr(tag, "sizes")) });
  }
  const rank = (n: number) => (n >= 32 && n <= 96 ? Math.abs(n - 48) : n > 96 ? 100 + n : 1000);
  return out.sort((a, b) => rank(a.size) - rank(b.size));
}

function sourceRank(s: PosterCandidate["source"]): number {
  return s === "manifest" ? 0 : s === "apple-touch-icon" ? 1 : 2;
}

/** The page's theme-color when present and parseable. */
export function themeColor(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = attr(tag, "name");
    if (!name || !/^theme-color$/i.test(name)) continue;
    const c = attr(tag, "content");
    if (c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim())) return c.trim();
  }
  return null;
}

/** Deterministic hue from a name — the no-information fallback background. */
export function nameHue(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `hsl(${h % 360} 42% 28%)`;
}

/** Readable foreground for a hex background (never grey-on-grey — WCAG bias). */
function foregroundFor(background: string): string {
  const m = background.match(/^#([0-9a-f]{6})$/i);
  if (!m) return "#F2F4F7";
  const v = parseInt(m[1]!, 16);
  const lum = 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
  return lum > 140 ? "#14171C" : "#F2F4F7";
}

/** The §31 wordmark fallback for a page with no usable icon. */
export function wordmark(name: string, html: string | null): WordmarkFallback {
  const theme = html ? themeColor(html) : null;
  const background = theme ?? nameHue(name);
  return { kind: "wordmark", name, background, foreground: foregroundFor(background) };
}
