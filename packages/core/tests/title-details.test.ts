import { describe, expect, it } from "vitest";
import { TMDB_IMG, shapeTitleDetails } from "../src/title-details.js";

// The details card (2026-09-23): TMDB's appended answer shaped into what the card shows - nothing added, nothing invented.
describe("the details card's shape", () => {
  it("a series: created by, seasons, the certification, the run's cast, US providers, the official trailer, the next episode", () => {
    const d = shapeTitleDetails("tv", {
      id: 7, name: "Ted Lasso", first_air_date: "2020-08-14", last_air_date: "2026-09-10", tagline: "Believe.", overview: "An American coach.",
      episode_run_time: [30], number_of_seasons: 4, number_of_episodes: 44, status: "Returning Series", genres: [{ name: "Comedy" }, { name: "Drama" }],
      created_by: [{ name: "Bill Lawrence" }], networks: [{ name: "Apple TV+" }], vote_average: 8.4, vote_count: 3000, poster_path: "/p.jpg", backdrop_path: "/b.jpg",
      content_ratings: { results: [{ iso_3166_1: "GB", rating: "15" }, { iso_3166_1: "US", rating: "TV-MA" }] },
      aggregate_credits: { cast: [{ name: "Jason Sudeikis", roles: [{ character: "Ted Lasso" }], profile_path: "/j.jpg" }] },
      credits: { cast: [{ name: "Someone Else", character: "Guest" }], crew: [] },
      "watch/providers": { results: { US: { flatrate: [{ provider_name: "Apple TV Plus", logo_path: "/a.png" }], buy: [{ provider_name: "Amazon Video", logo_path: null }] } } },
      videos: { results: [{ site: "YouTube", key: "tz", type: "Teaser", name: "Teaser" }, { site: "YouTube", key: "tr", type: "Trailer", official: true, name: "Official Trailer" }] },
      next_episode_to_air: { season_number: 4, episode_number: 8, air_date: "2026-09-24", name: "Next" },
    });
    expect(d).toMatchObject({ kind: "tv", title: "Ted Lasso", year: 2020, certification: "TV-MA", runtime: 30, seasons: 4, episodes: 44, genres: ["Comedy", "Drama"],
      by: { label: "Created by", names: ["Bill Lawrence"] }, makers: ["Apple TV+"], rating: { mean: 8.4, votes: 3000 }, trailer: { youtube: "tr" },
      next: { season: 4, episode: 8, date: "2026-09-24" }, poster: TMDB_IMG + "w342/p.jpg" });
    expect(d.cast[0]).toEqual({ id: null, name: "Jason Sudeikis", character: "Ted Lasso", photo: TMDB_IMG + "w185/j.jpg" });
    expect(d.providers.stream).toEqual([{ name: "Apple TV Plus", logo: TMDB_IMG + "w92/a.png" }]);
    expect(d.providers.buy).toEqual([{ name: "Amazon Video", logo: null }]);
  });
  it("a film: directed by, runtime, the US release certification; nothing where TMDB has nothing", () => {
    const d = shapeTitleDetails("movie", {
      id: 9, title: "Heat", release_date: "1995-12-15", runtime: 170, credits: { crew: [{ job: "Director", name: "Michael Mann" }, { department: "Writing", name: "Michael Mann" }] },
      release_dates: { results: [{ iso_3166_1: "US", release_dates: [{ certification: "" }, { certification: "R" }] }] }, vote_count: 0,
    });
    expect(d).toMatchObject({ title: "Heat", year: 1995, runtime: 170, certification: "R", by: { label: "Directed by", names: ["Michael Mann"] }, writers: ["Michael Mann"], rating: null, trailer: null, next: null });
    expect(d.providers).toEqual({ stream: [], free: [], rent: [], buy: [] });
  });
});
