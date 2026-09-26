import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  IMAGERY_PACK_SCHEMA,
  attributionSentence,
  cardAttribution,
  unfetchedImages,
  validateImageryPack,
} from "../src/imagery-pack.js";
import type { ImageryPack, PackImage } from "../src/imagery-pack.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const bierstadt: PackImage = {
  file: "aic-64818.jpg",
  title: "The Rocky Mountains, Lander's Peak",
  creator: "Albert Bierstadt",
  date: "1863",
  credit: "Art Institute of Chicago, Public Domain",
  license: { id: "public-domain", name: "Public domain (CC0 1.0)", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  attribution: "Albert Bierstadt, The Rocky Mountains, Lander's Peak (1863) — Art Institute of Chicago, public domain",
  sourceUrl: "https://www.artic.edu/artworks/64818",
  sha256: SHA_A,
  w: 1686,
  h: 1024,
};

const pack = (over: Partial<ImageryPack> = {}): ImageryPack => ({
  schema: IMAGERY_PACK_SCHEMA,
  id: "gallery",
  name: "Gallery",
  blurb: "Public-domain paintings from open museum collections.",
  source: { name: "Art Institute of Chicago — Open Access", url: "https://api.artic.edu/" },
  requiresCreator: true,
  images: [bierstadt],
  ...over,
});

describe("imagery pack validation (concept-scenes §3.3)", () => {
  it("accepts a complete pack, with or without its bytes on disk", () => {
    expect(validateImageryPack(pack())).toEqual([]);
    expect(validateImageryPack(pack(), [{ name: "aic-64818.jpg", sha256: SHA_A }])).toEqual([]);
  });

  it("a fresh clone (manifest tracked, bytes git-ignored) is clean, and says what is unfetched", () => {
    expect(validateImageryPack(pack(), [])).toEqual([]);
    expect(unfetchedImages(pack(), [])).toEqual(["aic-64818.jpg"]);
    expect(unfetchedImages(pack(), [{ name: "aic-64818.jpg" }])).toEqual([]);
  });

  it("FAILS on any missing required field", () => {
    for (const field of ["file", "title", "credit", "attribution", "sourceUrl", "sha256"] as const) {
      const image = { ...bierstadt };
      delete (image as Record<string, unknown>)[field];
      const problems = validateImageryPack(pack({ images: [image as PackImage] }));
      expect(problems.some((p) => p.includes(field))).toBe(true);
    }
    const noLicense = { ...bierstadt } as Record<string, unknown>;
    delete noLicense.license;
    expect(validateImageryPack(pack({ images: [noLicense as unknown as PackImage] }))).toContain("gallery/aic-64818.jpg: license is missing");
  });

  it("FAILS when license.id is outside the allowlist", () => {
    const image = { ...bierstadt, license: { ...bierstadt.license, id: "cc-by-nc" as never } };
    const problems = validateImageryPack(pack({ images: [image] }));
    expect(problems.join("\n")).toMatch(/outside the allowlist/);
  });

  it("accepts every allowlisted licence, and demands the attribution CC-BY needs", () => {
    for (const id of ["public-domain", "cc0", "cc-by", "cc-by-sa"] as const) {
      expect(validateImageryPack(pack({ images: [{ ...bierstadt, license: { ...bierstadt.license, id } }] }))).toEqual([]);
    }
    const image = { ...bierstadt, license: { ...bierstadt.license, id: "cc-by" as const }, attribution: "" };
    expect(validateImageryPack(pack({ images: [image] })).join("\n")).toMatch(/cc-by requires the attribution text/);
  });

  it("FAILS when a file on disk has no manifest entry — unlabelled imagery never ships (§5)", () => {
    const problems = validateImageryPack(pack(), [
      { name: "aic-64818.jpg", sha256: SHA_A },
      { name: "mystery.jpg", sha256: SHA_B },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/mystery\.jpg: on disk with no manifest entry/);
  });

  it("FAILS when a present file's sha256 does not match the manifest", () => {
    const problems = validateImageryPack(pack(), [{ name: "aic-64818.jpg", sha256: SHA_B }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/does not match the manifest/);
  });

  it("requires a creator where the pack declares one (a painting has a painter)", () => {
    const anon = { ...bierstadt };
    delete anon.creator;
    expect(validateImageryPack(pack({ images: [anon] })).join("\n")).toMatch(/creator is required/);
    // Cosmos does not declare it: a NASA plate has no painter.
    expect(validateImageryPack(pack({ id: "cosmos", requiresCreator: false, images: [anon] }))).toEqual([]);
  });

  it("catches a wrong schema, duplicate entries, a bad sha and a non-https source", () => {
    expect(validateImageryPack(pack({ schema: "prism.imagery-pack/v9" })).join("\n")).toMatch(/schema is/);
    expect(validateImageryPack(pack({ images: [bierstadt, bierstadt] })).join("\n")).toMatch(/listed twice/);
    expect(validateImageryPack(pack({ images: [{ ...bierstadt, sha256: "nope" }] })).join("\n")).toMatch(/64 lowercase hex/);
    expect(validateImageryPack(pack({ images: [{ ...bierstadt, sourceUrl: "http://example.com/x" }] })).join("\n")).toMatch(/not an https url/);
  });
});

describe("the §26 card corner (§3.2)", () => {
  it("names the title with its creator, the credit and the licence", () => {
    const a = cardAttribution(bierstadt);
    expect(a.headline).toBe("The Rocky Mountains, Lander's Peak · Albert Bierstadt");
    expect(a.line).toBe(
      "The Rocky Mountains, Lander's Peak · Albert Bierstadt · Art Institute of Chicago, Public Domain · Public domain (CC0 1.0)",
    );
    expect(a.sourceUrl).toBe("https://www.artic.edu/artworks/64818");
  });

  it("collapses to the credit alone in minimal mode — collapsed, never hidden", () => {
    const a = cardAttribution(bierstadt, "minimal");
    expect(a.line).toBe("Art Institute of Chicago, Public Domain");
    expect(a.line.length).toBeGreaterThan(0);
    expect(a.sourceUrl).toBe(bierstadt.sourceUrl);
  });

  it("drops the creator when the pack has none (Cosmos)", () => {
    const plate: PackImage = { ...bierstadt, creator: undefined, title: "Saturn Rings", credit: "JPL, NASA — Public domain" };
    expect(cardAttribution(plate).headline).toBe("Saturn Rings");
    expect(cardAttribution(plate).line).toBe("Saturn Rings · JPL, NASA — Public domain · Public domain (CC0 1.0)");
  });

  it("writes the settings sentence per image (§26 'attributed per image')", () => {
    expect(attributionSentence(bierstadt)).toBe(
      "Albert Bierstadt, The Rocky Mountains, Lander's Peak (1863) — Art Institute of Chicago, Public Domain",
    );
  });
});

// ------------------------------------------- CS-10.4: the shipped Gallery pack

describe("the Gallery pack as shipped", () => {
  const gallery = JSON.parse(readFileSync(new URL("../../../packs/gallery/pack.json", import.meta.url), "utf8"));

  it("ships a Bierstadt - the painter the charter names first (CS-10.4)", () => {
    const b = gallery.images.filter((i: PackImage) => (i.creator ?? "").includes("Bierstadt"));
    expect(b.length).toBeGreaterThan(0);
    // The Met holds it; AIC's only public-domain Bierstadt painting is portrait
    // (1832x2250) and cannot pass the fetcher's landscape filter, which is why
    // CS-2 shipped none.
    expect(b[0].title).toBe("The Rocky Mountains, Lander's Peak");
    expect(b[0].creator).toBe("Albert Bierstadt");
    expect(b[0].date).toBe("1863");
    expect(b[0].w / b[0].h).toBeGreaterThanOrEqual(1.15);      // landscape: it hangs on a wall
  });

  it("Gallery declares requiresCreator, and every painting has a painter", () => {
    expect(gallery.requiresCreator).toBe(true);
    for (const i of gallery.images as PackImage[]) expect(i.creator, i.file).toBeTruthy();
  });

  it("the card line carries the LICENCE, not just the credit (§3.2)", () => {
    const b = (gallery.images as PackImage[]).find((i) => (i.creator ?? "").includes("Bierstadt"))!;
    const card = cardAttribution(b, "card");
    expect(card.line).toContain(b.title);
    expect(card.line).toContain("Albert Bierstadt");
    expect(card.line).toContain("The Metropolitan Museum of Art");
    expect(card.line).toContain("Public domain (CC0 1.0)");    // the half the mockup omitted
    // minimal mode collapses to the credit alone - collapsed, never hidden
    expect(cardAttribution(b, "minimal").line).toBe(b.credit);
    expect(card.sourceUrl).toBe("https://www.metmuseum.org/art/collection/search/10154");
  });

  it("the whole pack validates under the §3.1 format", () => {
    expect(validateImageryPack(gallery)).toEqual([]);
  });
});
