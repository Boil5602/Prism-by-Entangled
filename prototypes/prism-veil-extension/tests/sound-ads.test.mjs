// Sound ads on a music service (2026-11-12): the service's own marks of an ad, as the PRISM app's adapters read them, turn the
// tab's sound off for an ad that has no video, and give it back when the ad is over.
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadVeil } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, "..", "src", "sound-ads.js"), "utf8");

let PV, sent, veil, off;
function load(host) {
  PV = loadVeil({ host });
  sent = []; veil = null; off = false;
  PV.vidVeil = () => veil; PV.suppressed = () => off; PV.recordError = () => {}; PV.keepOnTop = () => {};
  PV.__noSoundAdStart = true;
  window.chrome.runtime.sendMessage = (m, cb) => { sent.push(m.muted); cb && cb({ ok: true }); };
  PV.soundAdSigns = undefined;
  (0, eval)(code);
  return PV;
}
const B = 'data-rect="0,0,300,40"';

describe("the signs of a sound ad", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("a host with no row gets nothing", () => {
    load("example.com");
    expect(PV.soundAdSigns("example.com", document)).toBe(null);
    expect(PV.soundAdSigns("notpandora.com", document)).toBe(null);
  });

  it("Pandora: the tuner's title reading Advertisement is an ad by itself; Why ads alone is not", () => {
    load("www.pandora.com");
    document.body.innerHTML = `<div data-qa="mini_track_title" ${B}>Low Water</div><button data-qa="why_ads_button" ${B}>Why ads?</button>`;
    expect(PV.soundAdSigns("www.pandora.com", document).ad).toBe(false);
    document.querySelector('[data-qa="mini_track_title"]').textContent = " Advertisement ";
    expect(PV.soundAdSigns("www.pandora.com", document).ad).toBe(true);
  });

  it("Pandora: Why ads with a disabled Skip is an ad; a song is not", () => {
    load("www.pandora.com");
    document.body.innerHTML = `<button data-qa="why_ads_button" ${B}>Why ads?</button><button data-qa="skip_button" disabled ${B}></button>`;
    expect(PV.soundAdSigns("www.pandora.com", document).ad).toBe(true);
    document.body.innerHTML = `<div data-qa="mini_track_title" ${B}>Low Water</div><button data-qa="skip_button" ${B}></button>`;
    expect(PV.soundAdSigns("www.pandora.com", document).ad).toBe(false);
  });

  it("Spotify: two marks at once make an ad, with the time left and the count", () => {
    load("open.spotify.com");
    document.body.innerHTML = `<div data-testid="context-ad-logo" ${B}></div>`;
    expect(PV.soundAdSigns("open.spotify.com", document).ad).toBe(false);
    document.body.innerHTML += `<div data-testid="ad-countdown-timer" ${B}>0:27</div><div data-testid="context-item-info-ad-subtitle" ${B}>Advertisement 2 of 3</div>`;
    const r = PV.soundAdSigns("open.spotify.com", document);
    expect(r.ad).toBe(true); expect(r.remaining).toBe(27); expect(r.count).toBe("2 of 3");
    expect(PV.soundAdLine(r)).toBe("Ad 2 of 3 · sound off · 0:27 left");
  });

  it("Spotify: marks with no box are not seen", () => {
    load("open.spotify.com");
    document.body.innerHTML = `<div data-testid="context-ad-logo"></div><div data-testid="ad-controls"></div>`;
    expect(PV.soundAdSigns("open.spotify.com", document).ad).toBe(false);
  });

  it("Amazon Music: a playing element whose file is on the picture host is an ad", () => {
    load("music.amazon.com");
    const a = document.createElement("audio"); document.body.appendChild(a);
    Object.defineProperty(a, "paused", { value: false, configurable: true });
    Object.defineProperty(a, "currentSrc", { value: "https://m.media-amazon.com/images/S/ad.mp3", configurable: true });
    Object.defineProperty(a, "duration", { value: 30, configurable: true });
    expect(PV.soundAdSigns("music.amazon.com", document)).toMatchObject({ ad: true, remaining: 30 });
    Object.defineProperty(a, "currentSrc", { value: "blob:https://music.amazon.com/1", configurable: true });
    expect(PV.soundAdSigns("music.amazon.co.uk", document).ad).toBe(false);
  });
});

describe("the tab's sound under a sound ad", () => {
  const adOn = () => { document.body.innerHTML = `<div data-qa="mini_track_title" ${B}>Advertisement</div>`; };
  const adOff = () => { document.body.innerHTML = `<div data-qa="mini_track_title" ${B}>Low Water</div>`; };

  it("off at the ad's start, once, and back at its end", () => {
    load("www.pandora.com");
    adOff(); PV.__soundAdTick(); expect(sent).toEqual([]);
    adOn(); PV.__soundAdTick(); PV.__soundAdTick();
    expect(sent).toEqual([true]); expect(PV.soundAdOn()).toBe(true);
    adOff(); PV.__soundAdTick();
    expect(sent).toEqual([true, false]); expect(PV.soundAdOn()).toBe(false);
  });

  it("a video veil that is still up keeps the mute when the sound ad ends", () => {
    load("www.pandora.com");
    adOn(); PV.__soundAdTick(); veil = {};
    adOff(); PV.__soundAdTick();
    expect(sent).toEqual([true]);
  });

  it("Escape during an ad gives the sound back for that ad, and the next ad is muted again", () => {
    load("www.pandora.com");
    adOn(); PV.__soundAdTick();
    off = true; PV.__soundAdTick(); expect(sent).toEqual([true, false]);
    off = false; PV.__soundAdTick(); expect(sent).toEqual([true, false]);
    adOff(); PV.__soundAdTick(); adOn(); PV.__soundAdTick();
    expect(sent).toEqual([true, false, true]);
  });

  it("nothing is muted while PRISM is off", () => {
    load("www.pandora.com");
    off = true; adOn(); PV.__soundAdTick();
    expect(sent).toEqual([]);
  });

  it("the elements are muted only until the tab is silent", () => {
    load("www.pandora.com");
    const a = document.createElement("audio"); adOn(); document.body.appendChild(a);
    let answer = null;
    window.chrome.runtime.sendMessage = (m, cb) => { sent.push(m.muted); answer = cb; };
    PV.__soundAdTick();
    expect(a.muted).toBe(true);
    answer({ ok: true });
    expect(a.muted).toBe(false);
  });
});
