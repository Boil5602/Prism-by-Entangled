import { describe, expect, it } from "vitest";
import { dayBefore, freshValue, orderFresh } from "../src/fresh-rows.js";

describe("fresh rows", () => {
  it("orders oldest first, so a title about to age out is on the left", () => {
    const rows = orderFresh([{ title: "B", date: "2026-09-21" }, { title: "A", date: "2026-09-17" }, { title: "C", date: "2026-09-21" }]);
    expect(rows.map((r) => r.title)).toEqual(["A", "B", "C"]);
  });
  it("names the date and its source; counts the window in local days", () => {
    expect(freshValue("New ep", "2026-09-21")).toBe("New ep Sep 21 · TMDB");
    expect(freshValue("Released", "bad")).toBe("");
    const now = new Date(2026, 8, 23, 22, 0).getTime();
    expect(dayBefore(now, 0)).toBe("2026-09-23");
    expect(dayBefore(now, 7)).toBe("2026-09-16");
    expect(dayBefore(now, 30)).toBe("2026-08-24");
  });
});
