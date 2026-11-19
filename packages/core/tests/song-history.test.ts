import { describe, expect, it } from "vitest";
import { HISTORY_MAX, SongHistory, readHistory } from "../src/song-history.js";

const song = (title: string, playing = true, id?: string) => ({ playing, title, artist: "Paper Boats", album: "Tall Grass", artwork: "https://img.example/c.jpg", ...(id ? { id } : {}) });

describe("song history: record", () => {
  it("records a song with its service, names, cover and id, newest first", () => {
    const h = new SongHistory();
    h.note("one", "Service One", song("Road Mix", true, "t.1"), 0);
    const e = h.note("one", "Service One", song("Road Mix", true, "t.1"), 30_000);
    expect(e).toMatchObject({ tile: "one", service: "Service One", title: "Road Mix", artist: "Paper Boats", album: "Tall Grass", artwork: "https://img.example/c.jpg", id: "t.1", at: 30_000 });
    h.note("two", "Service Two", song("Evening Beats"), 40_000);
    h.note("two", "Service Two", song("Evening Beats"), 75_000);
    expect(h.songs().map((s) => s.title)).toEqual(["Evening Beats", "Road Mix"]);
  });
  it("records one play once, however long it goes on, and again when the song comes back after another", () => {
    const h = new SongHistory();
    for (let t = 0; t <= 200_000; t += 5_000) h.note("one", "S", song("Road Mix"), t);
    expect(h.songs()).toHaveLength(1);
    for (let t = 205_000; t <= 240_000; t += 5_000) h.note("one", "S", song("Evening Beats"), t);
    for (let t = 245_000; t <= 280_000; t += 5_000) h.note("one", "S", song("Road Mix"), t);
    expect(h.songs().map((s) => s.title)).toEqual(["Road Mix", "Evening Beats", "Road Mix"]);
  });
  it("keeps a cover only when its address is https, and no empty fields", () => {
    const h = new SongHistory();
    h.note("one", "S", { playing: true, title: "Road Mix", artist: " ", artwork: "http://img.example/c.jpg" }, 0);
    const e = h.note("one", "S", { playing: true, title: "Road Mix", artist: " ", artwork: "http://img.example/c.jpg" }, 31_000)!;
    expect(e.artwork).toBeUndefined();
    expect("artist" in e).toBe(false);
  });
});

describe("song history: the 30-second rule", () => {
  it("does not record before 30 seconds of play", () => {
    const h = new SongHistory();
    h.note("one", "S", song("Road Mix"), 0);
    expect(h.note("one", "S", song("Road Mix"), 29_999)).toBeNull();
    expect(h.songs()).toHaveLength(0);
    expect(h.note("one", "S", song("Road Mix"), 30_000)).not.toBeNull();
  });
  it("does not count time while paused", () => {
    const h = new SongHistory();
    h.note("one", "S", song("Road Mix"), 0);
    h.note("one", "S", song("Road Mix", false), 20_000);       // 20 s played, then paused
    expect(h.note("one", "S", song("Road Mix", false), 90_000)).toBeNull();
    expect(h.note("one", "S", song("Road Mix"), 100_000)).toBeNull();   // resumed: still 20 s
    expect(h.note("one", "S", song("Road Mix"), 109_999)).toBeNull();
    expect(h.note("one", "S", song("Road Mix"), 110_000)).not.toBeNull();
  });
  it("starts the count again for another song, and never records a skipped one", () => {
    const h = new SongHistory();
    h.note("one", "S", song("Road Mix"), 0);
    h.note("one", "S", song("Evening Beats"), 25_000);
    expect(h.note("one", "S", song("Evening Beats"), 50_000)).toBeNull();
    expect(h.note("one", "S", song("Evening Beats"), 55_000)).toMatchObject({ title: "Evening Beats" });
    expect(h.songs().map((s) => s.title)).toEqual(["Evening Beats"]);
  });
  it("counts each service on its own, and nothing for a page with no title", () => {
    const h = new SongHistory();
    h.note("one", "S1", song("Road Mix"), 0);
    h.note("two", "S2", song("Evening Beats"), 20_000);
    expect(h.note("one", "S1", song("Road Mix"), 30_000)).not.toBeNull();
    expect(h.note("two", "S2", song("Evening Beats"), 30_000)).toBeNull();
    expect(h.note("two", "S2", { playing: true }, 80_000)).toBeNull();
    expect(h.note("two", "S2", null, 90_000)).toBeNull();
    expect(h.songs()).toHaveLength(1);
  });
});

describe("song history: the 500 cap", () => {
  it("keeps the newest 500 and drops the oldest", () => {
    const h = new SongHistory();
    for (let i = 0; i < HISTORY_MAX + 20; i++) { h.note("one", "S", song("Song " + i), i * 40_000); h.note("one", "S", song("Song " + i), i * 40_000 + 30_000); }
    const list = h.songs();
    expect(list).toHaveLength(500);
    expect(list[0]!.title).toBe("Song 519");
    expect(list[499]!.title).toBe("Song 20");
  });
  it("reads a stored list to the cap and leaves out what is not an entry", () => {
    const stored = JSON.stringify([{ tile: "one", service: "S", title: "Road Mix", at: 5 }, { tile: "one", title: "", at: 4 }, "x", null, { title: "No tile", at: 3 }]);
    expect(readHistory(stored).map((s) => s.title)).toEqual(["Road Mix"]);
    expect(readHistory("not json")).toEqual([]);
    expect(readHistory(null)).toEqual([]);
    const many = JSON.stringify(Array.from({ length: 600 }, (_, i) => ({ tile: "one", service: "S", title: "Song " + i, at: i })));
    expect(readHistory(many)).toHaveLength(500);
    expect(new SongHistory(readHistory(many)).songs()).toHaveLength(500);
  });
});

describe("song history: clear", () => {
  it("empties the list, and the song playing now is not recorded again for this play", () => {
    const h = new SongHistory();
    h.note("one", "S", song("Road Mix"), 0);
    h.note("one", "S", song("Road Mix"), 30_000);
    h.clear();
    expect(h.songs()).toEqual([]);
    expect(h.note("one", "S", song("Road Mix"), 90_000)).toBeNull();
    h.note("one", "S", song("Evening Beats"), 100_000);
    expect(h.note("one", "S", song("Evening Beats"), 130_000)).not.toBeNull();
    expect(h.songs()).toHaveLength(1);
  });
});
