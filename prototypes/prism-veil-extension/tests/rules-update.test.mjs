/*
  Rule updates (0.9.0, src/rules-pack.js + the update part of src/rules.js): a signed data file joins the packaged detection
  rules. What must hold: a good file is applied; a file with a bad signature, a bad schema, an older serial or the wrong version
  range changes nothing; the person's own rules are never lost to an update; the switch off means the packaged rules alone;
  and nothing in the reader can run what a file carries.
*/
import { describe, it, expect, beforeAll } from "vitest";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadVeil, detect } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const R = (x, y, w, h) => `data-rect="${x},${y},${w},${h}"`;
const subtle = webcrypto.subtle;
const OWN = "0.9.0";

let keyA, keyB, keyOther, jwkA, jwkB;
async function makeKey() {
  const k = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { priv: k.privateKey, jwk: await subtle.exportKey("jwk", k.publicKey) };
}
async function signed(obj, key) {
  const bytes = new TextEncoder().encode(typeof obj === "string" ? obj : JSON.stringify(obj));
  const sig = Buffer.from(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.priv, bytes)).toString("base64");
  return { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), sig };
}
beforeAll(async () => {
  keyA = await makeKey(); keyB = await makeKey(); keyOther = await makeKey();
  jwkA = { kty: keyA.jwk.kty, crv: keyA.jwk.crv, x: keyA.jwk.x, y: keyA.jwk.y };
  jwkB = { kty: keyB.jwk.kty, crv: keyB.jwk.crv, x: keyB.jwk.x, y: keyB.jwk.y };
});

const file = (over = {}) => Object.assign({
  format: 1, serial: "2027-01-05.1", date: "2027-01-05", minVeil: "0.9.0",
  display: {
    slots: { add: ["div.qh-promo-unit"] },
    sites: [{ id: "courier-rail", hosts: ["courier.example"], cover: ["[data-qh-unit]"] }],
  },
}, over);
const accept = (RP, s, extra = {}) => RP.accept(Object.assign({ bytes: s.bytes, sig: s.sig, keys: [jwkA, jwkB], ownVersion: OWN, heldSerial: "", subtle }, extra));
const PAGE = `<div class="qh-promo-unit" id="promo" ${R(0, 0, 300, 250)}></div><div data-qh-unit id="rail" ${R(400, 0, 300, 250)}></div><ins class="adsbygoogle" id="g" ${R(0, 300, 300, 250)}></ins>`;
const ids = (out) => out.map((o) => o.id).sort();

describe("a good update", () => {
  it("is accepted and applied: its selector and its site entry cover, the packaged rules still do", async () => {
    const PV = loadVeil({ host: "www.courier.example" });
    const RP = PV.rulesPack;
    expect(ids(detect(PV, PAGE))).toEqual(["g"]);                       // before: the packaged rules alone
    const r = await accept(RP, await signed(file(), keyA));
    expect(r.ok).toBe(true); expect(r.rules.serial).toBe("2027-01-05.1");
    PV.applyRulesFromStore(true, { serial: r.rules.serial, at: 1, file: r.file }, null, OWN);
    const out = detect(PV, PAGE);
    expect(ids(out)).toEqual(["g", "promo", "rail"]);
    expect(out.find((o) => o.id === "rail").why).toBe("update: courier-rail");
    expect(out.find((o) => o.id === "promo").why).toBe("slot-selector: div.qh-promo-unit");
    expect(PV.rulesInfo.serial).toBe("2027-01-05.1");
  });
  it("a site entry applies on its hosts only", async () => {
    const PV = loadVeil({ host: "elsewhere.example" });
    PV.applyRules(PV.rulesPack.validate(file(), OWN).rules, null);
    expect(ids(detect(PV, PAGE))).toEqual(["g", "promo"]);
  });
  it("the spare key verifies a file too", async () => {
    const PV = loadVeil();
    const r = await accept(PV.rulesPack, await signed(file(), keyB));
    expect(r.ok).toBe(true); expect(r.rules.serial).toBe("2027-01-05.1");
  });
  it("closest, text and whole: the card around a label that reads exactly the word", () => {
    const PV = loadVeil({ host: "courier.example" });
    const f = file({ display: { sites: [{ id: "paid-card", hosts: ["courier.example"], cover: [".tag"], closest: ".card", text: { sel: ".tag", equals: ["Paid post"] }, whole: true }] } });
    PV.applyRules(PV.rulesPack.validate(f, OWN).rules, null);
    const out = detect(PV, `<div class="card" id="c1" ${R(0, 0, 300, 200)}><span class="tag" ${R(0, 0, 60, 16)}>paid post</span></div><div class="card" id="c2" ${R(0, 220, 300, 200)}><span class="tag" ${R(0, 220, 60, 16)}>Travel</span></div>`);
    expect(ids(out)).toEqual(["c1"]);
  });
  it("label words, host lists and never", () => {
    let PV = loadVeil({ host: "shop.example" });
    const badgeHtml = `<div id="unit" ${R(0, 0, 300, 250)}><span class="ad-label" ${R(0, 0, 80, 16)}>Partner pick</span><a ${R(0, 20, 300, 200)}><img ${R(0, 20, 300, 200)}></a></div>`;
    const before = detect(PV, badgeHtml).length;
    PV.applyRules(PV.rulesPack.validate(file({ display: { labels: { badge: ["partner pick"] } } }), OWN).rules, null);
    expect(detect(PV, badgeHtml).length).toBeGreaterThan(before);
    PV = loadVeil({ host: "shop.example" });
    PV.applyRules(PV.rulesPack.validate(file({ display: { hosts: { noAds: ["shop.example"] } } }), OWN).rules, null);
    expect(detect(PV, PAGE)).toEqual([]);
    PV = loadVeil({ host: "shop.example" });
    PV.applyRules(PV.rulesPack.validate(file({ display: { sites: [{ id: "keep-g", hosts: ["shop.example"], never: ["#g"] }] } }), OWN).rules, null);
    expect(detect(PV, PAGE)).toEqual([]);                               // the packaged rule's cover is held back here
  });
  it("the kill list switches a packaged site rule off", () => {
    const html = `<div id="d" class="dianomi_context" ${R(0, 0, 980, 600)}></div>`;
    let PV = loadVeil();
    expect(detect(PV, html).map((o) => o.why)).toEqual(["dianomi"]);
    PV = loadVeil();
    PV.applyRules(PV.rulesPack.validate(file({ display: { kill: ["dianomi"] } }), OWN).rules, null);
    expect(detect(PV, html)).toEqual([]);
  });
});

describe("a file that is refused changes nothing", () => {
  it("bad signature: another key, or bytes changed after signing", async () => {
    const PV = loadVeil({ host: "courier.example" });
    const RP = PV.rulesPack;
    let r = await accept(RP, await signed(file(), keyOther));
    expect(r.ok).toBe(false); expect(r.error).toMatch(/signature/);
    const s = await signed(file(), keyA);
    const bent = new Uint8Array(s.bytes.slice(0)); bent[bent.length - 3] ^= 1;
    r = await accept(RP, { bytes: bent.buffer, sig: s.sig });
    expect(r.ok).toBe(false);
    r = await accept(RP, { bytes: s.bytes, sig: "not base64 !!" });
    expect(r.ok).toBe(false);
    expect(ids(detect(PV, PAGE))).toEqual(["g"]);                       // the packaged rules, as before
  });
  it("bad schema, though signed with the right key", async () => {
    const RP = loadVeil().rulesPack;
    const bad = [
      file({ extra: 1 }),                                                             // a field this version does not know
      file({ format: 2 }),
      file({ serial: "tomorrow" }),
      file({ minVeil: undefined }),
      file({ display: { slots: { add: ["div"] } } }),                                 // a bare tag
      file({ display: { slots: { add: ["*"] } } }),
      file({ display: { slots: { add: [".a, .b"] } } }),                              // a list in one string
      file({ display: { slots: { add: [".a:has(.b)"] } } }),
      file({ display: { slots: { add: [".a{color:red}"] } } }),
      file({ display: { slots: { add: ["<script>alert(1)</script>.x"] } } }),
      file({ display: { slots: { add: [42] } } }),
      file({ display: { slots: { add: [".x"], run: "alert(1)" } } }),
      file({ display: { sites: [{ id: "x", hosts: ["a.example"], cover: [".x"], run: "function(){}" }] } }),
      file({ display: { sites: [{ id: "x", hosts: ["a.example"] }] } }),               // nothing to cover, nothing to leave
      file({ display: { sites: [{ id: "x", hosts: ["not a host"], cover: [".x"] }] } }),
      file({ display: { sites: [{ id: "x", hosts: [], cover: [".x"] }] } }),
      file({ display: { sites: [{ id: "x", hosts: ["a.example"], cover: [".x"] }, { id: "x", hosts: ["a.example"], cover: [".y"] }] } }),
      file({ display: { labels: { badge: ["x".repeat(61)] } } }),
      file({ display: { hosts: { noAds: ["/(.*)+$/"] } } }),                          // no patterns
      file({ display: { kill: ["Not An Id"] } }),
      file({ display: { slots: { add: Array.from({ length: 151 }, (_, i) => ".s" + i) } } }),
      file({ display: { sites: Array.from({ length: 101 }, (_, i) => ({ id: "s" + i, hosts: ["a.example"], cover: [".c" + i] })) } }),
      file({ display: { slots: { add: Array.from({ length: 150 }, (_, i) => ".s" + i), off: Array.from({ length: 150 }, (_, i) => ".o" + i) }, stacks: { add: [{ stack: "S", sel: ".one-too-many" }] } } }),   // 301 selectors
      file({ video: "later" }),
      [1, 2, 3],
    ];
    for (const b of bad) {
      const r = await accept(RP, await signed(b, keyA));
      expect(r.ok, JSON.stringify(b).slice(0, 120)).toBe(false);
    }
    const r = await accept(RP, await signed("{ not json", keyA));
    expect(r.ok).toBe(false);
  });
  it("an oversized file is refused before anything else", async () => {
    const RP = loadVeil().rulesPack;
    const big = file({ notes: "ok" });
    const s = await signed(JSON.stringify(big) + " ".repeat(RP.LIMITS.bytes), keyA);
    const r = await accept(RP, s);
    expect(r.ok).toBe(false); expect(r.error).toMatch(/bytes/);
  });
  it("an older or equal serial is not taken, nor one no newer than the package's own rules", async () => {
    const RP = loadVeil().rulesPack;
    let r = await accept(RP, await signed(file({ serial: "2027-01-05.1" }), keyA), { heldSerial: "2027-01-05.2" });
    expect(r.ok).toBe(true); expect(r.same).toBe(true); expect(r.rules).toBeUndefined();
    r = await accept(RP, await signed(file({ serial: "2027-01-05.2" }), keyA), { heldSerial: "2027-01-05.2" });
    expect(r.same).toBe(true);
    r = await accept(RP, await signed(file({ serial: RP.BASE_SERIAL }), keyA));
    expect(r.same).toBe(true);
    r = await accept(RP, await signed(file({ serial: "2027-01-05.3" }), keyA), { heldSerial: "2027-01-05.2" });   // a roll back is a higher serial with the old content
    expect(r.ok).toBe(true); expect(r.rules.serial).toBe("2027-01-05.3");
  });
  it("a file for another version of the extension is refused", async () => {
    const RP = loadVeil().rulesPack;
    let r = await accept(RP, await signed(file({ minVeil: "0.10.0" }), keyA));
    expect(r.ok).toBe(false); expect(r.error).toMatch(/0\.10\.0/);
    r = await accept(RP, await signed(file({ maxVeil: "0.8.9" }), keyA));
    expect(r.ok).toBe(false);
    r = await accept(RP, await signed(file({ maxVeil: "0.9.5" }), keyA));
    expect(r.ok).toBe(true);
  });
  it("a selector the browser refuses is dropped alone", () => {
    const PV = loadVeil({ host: "courier.example" });
    const f = file({ display: { slots: { add: ["div.qh-promo-unit", "[data-x=]"] } } });
    const v = PV.rulesPack.validate(f, OWN);
    expect(v.ok).toBe(true);
    PV.applyRules(v.rules, null);
    expect(PV.rulesInfo.dropped).toEqual(["[data-x=]"]);
    expect(ids(detect(PV, PAGE))).toEqual(["g", "promo"]);
  });
  it("a file may carry a video object, which this version does not read", () => {
    const RP = loadVeil().rulesPack;
    const v = RP.validate(file({ video: { families: [{ name: "x" }] } }), OWN);
    expect(v.ok).toBe(true); expect(v.rules.video).toBeUndefined();
  });
});

describe("the person's own rules", () => {
  const mine = { display: { slots: { add: [".my-own-fix"], off: ["ins.adsbygoogle"] }, sites: [{ id: "courier-rail", hosts: ["courier.example"], cover: ["#mine"] }] } };
  const html = `<div class="my-own-fix" id="fix" ${R(0, 0, 300, 250)}></div><div id="mine" ${R(400, 0, 300, 250)}></div><div data-qh-unit id="rail" ${R(800, 0, 300, 250)}></div><ins class="adsbygoogle" id="g" ${R(0, 300, 300, 250)}></ins>`;
  it("are kept when an update does not have them, and win where the two differ", () => {
    const PV = loadVeil({ host: "courier.example" });
    const upd = file({ display: { slots: { add: ["ins.adsbygoogle"], off: [".my-own-fix"] }, sites: [{ id: "courier-rail", hosts: ["courier.example"], cover: ["[data-qh-unit]"] }] } });
    PV.applyRulesFromStore(true, { serial: upd.serial, at: 1, file: upd }, mine, OWN);
    const out = detect(PV, html);
    expect(ids(out)).toEqual(["fix", "mine"]);        // theirs added, theirs switched off, their site entry in place of the update's
    expect(out.find((o) => o.id === "mine").why).toBe("own-rule: courier-rail");
  });
  it("still apply with the switch off, when nothing of a download does", () => {
    const PV = loadVeil({ host: "courier.example" });
    PV.applyRulesFromStore(false, { serial: "2027-01-05.1", at: 1, file: file() }, mine, OWN);
    expect(ids(detect(PV, html))).toEqual(["fix", "mine"]);
  });
  it("the background never writes them: it sets pv:rules and pv:rules:last and nothing else of the rules", () => {
    const bg = readFileSync(join(here, "..", "bg.js"), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    expect(bg.includes("pv:rules:mine")).toBe(false);
    const keys = Array.from(bg.matchAll(/"(pv:rules[^"]*)"/g)).map((m) => m[1]);
    expect(Array.from(new Set(keys)).sort()).toEqual(["pv:rules", "pv:rules:last"]);
  });
});

describe("the switch", () => {
  it("off: a page loaded afterwards uses the packaged rules alone, though a file is still in storage", async () => {
    const RP = loadVeil().rulesPack;
    const r = await accept(RP, await signed(file(), keyA));
    const held = { serial: r.rules.serial, at: 1, file: r.file };
    let PV = loadVeil({ host: "courier.example" });
    PV.applyRulesFromStore(true, held, null, OWN);
    expect(ids(detect(PV, PAGE))).toEqual(["g", "promo", "rail"]);
    PV = loadVeil({ host: "courier.example" });        // the next page load, the switch now off
    PV.applyRulesFromStore(false, held, null, OWN);
    expect(ids(detect(PV, PAGE))).toEqual(["g"]);
    expect(PV.rulesInfo.serial).toBe("");
    expect(PV.SLOT_SELECTORS.includes("div.qh-promo-unit")).toBe(false);
  });
  it("off: the background removes the kept file", () => {
    const bg = readFileSync(join(here, "..", "bg.js"), "utf8");
    expect(/else \{ chrome\.alarms\.clear\(PACK_ALARM\); chrome\.storage\.local\.remove\(\["pv:rules", "pv:rules:last"\]\); \}/.test(bg)).toBe(true);
  });
  it("a stored file that no longer passes (an older package's file, a changed schema) is not used", () => {
    const PV = loadVeil({ host: "courier.example" });
    PV.applyRulesFromStore(true, { serial: "2027-01-05.1", at: 1, file: file({ surprise: true }) }, null, OWN);
    expect(ids(detect(PV, PAGE))).toEqual(["g"]);
    PV.applyRulesFromStore(true, { serial: "2027-01-05.1", at: 1, file: file({ minVeil: "1.0.0" }) }, null, OWN);
    expect(ids(detect(PV, PAGE))).toEqual(["g"]);
  });
});

describe("data only", () => {
  const code = (f) => readFileSync(join(here, "..", "src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  it("the reader has nothing that could run a file's content", () => {
    const s = code("rules-pack.js");
    for (const re of [/\beval\s*\(/, /\bFunction\s*\(/, /innerHTML|outerHTML|insertAdjacentHTML/, /createElement/, /\bimport\s*\(/, /importScripts/, /setTimeout|setInterval/, /new RegExp/, /\bfetch\s*\(/, /document\./]) expect(re.test(s), String(re)).toBe(false);
  });
  it("in the rules, a file's values go to selector calls and string compares only", () => {
    const s = code("rules.js");
    const a = s.indexOf("var BASE_SLOTS"), b = s.indexOf("function updSites");
    const part = s.slice(a, b) + s.slice(s.indexOf("if (mySites.length) {"), s.indexOf("var base = (root === document)"));
    expect(a > 0 && b > a).toBe(true);
    for (const re of [/\beval\s*\(/, /\bFunction\s*\(/, /innerHTML|outerHTML|insertAdjacentHTML/, /createElement\(/, /new RegExp/, /\.src\b|\.href\b|setAttribute|\.style\b/]) expect(re.test(part), String(re)).toBe(false);
  });
});
