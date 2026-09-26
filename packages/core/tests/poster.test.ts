import { describe, expect, it } from "vitest";
import {
  htmlIcons,
  manifestIcons,
  manifestUrl,
  nameHue,
  themeColor,
  wordmark,
} from "../src/poster.js";

// §31: posters are fetched from the service's own page (manifest →
// apple-touch-icon → og:image), never bundled; the wordmark is the
// no-information fallback. This is the pure resolution logic.
describe("poster resolution (§31)", () => {
  const base = "https://www.example-service.com/watch";

  it("finds the web-app manifest link, relative hrefs resolved", () => {
    expect(manifestUrl('<link rel="manifest" href="/app.webmanifest">', base))
      .toBe("https://www.example-service.com/app.webmanifest");
    expect(manifestUrl('<link href="x.css" rel="stylesheet">', base)).toBeNull();
  });

  it("orders manifest icons largest-first with sizes resolved against the manifest URL", () => {
    const icons = manifestIcons(
      JSON.stringify({ icons: [
        { src: "icon-192.png", sizes: "192x192" },
        { src: "icon-512.png", sizes: "512x512" },
        { src: "vector.svg", sizes: "any" },
      ] }),
      "https://www.example-service.com/app.webmanifest",
    );
    expect(icons.map((i) => i.url)).toEqual([
      "https://www.example-service.com/vector.svg",     // "any" ranks as 1024
      "https://www.example-service.com/icon-512.png",
      "https://www.example-service.com/icon-192.png",
    ]);
    expect(icons[0]!.source).toBe("manifest");
  });

  it("ranks apple-touch-icon above og:image and reads declared sizes", () => {
    const html =
      '<meta property="og:image" content="https://cdn.example.com/social.jpg">' +
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-icon.png">';
    const icons = htmlIcons(html, base);
    expect(icons.map((i) => i.source)).toEqual(["apple-touch-icon", "og:image"]);
    expect(icons[0]!.url).toBe("https://www.example-service.com/apple-icon.png");
    expect(icons[0]!.size).toBe(180);
  });

  it("bad manifest JSON degrades to no candidates, never a throw", () => {
    expect(manifestIcons("not json", "https://x.example/m.json")).toEqual([]);
  });

  it("wordmark uses the page's theme-color when sane", () => {
    const w = wordmark("Netflix", '<meta name="theme-color" content="#141414">');
    expect(w).toEqual({ kind: "wordmark", name: "Netflix", background: "#141414", foreground: "#F2F4F7" });
  });

  it("wordmark derives a stable hue when there is no theme-color", () => {
    const a = wordmark("Some Site", null);
    const b = wordmark("Some Site", "<p>no meta</p>");
    expect(a.background).toBe(b.background);
    expect(a.background).toMatch(/^hsl\(/);
    expect(themeColor("<meta name='theme-color' content='javascript:x'>")).toBeNull();
  });

  it("light theme-colors get dark foreground (contrast, not grey-on-grey)", () => {
    expect(wordmark("X", '<meta name="theme-color" content="#F5F5F5">').foreground).toBe("#14171C");
    expect(nameHue("a")).not.toBe(nameHue("b"));
  });
});
