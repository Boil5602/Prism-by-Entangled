using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// The Seasons visual's dates (2026-11-12): each holiday's day against days that are on record, and the rules of the settings.
/// The moon-reckoned days are allowed the one day a regional calendar can differ by; the ranges have that day to spare.
/// </summary>
public sealed class SeasonsCalendarTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);
    private static void Near(DateOnly want, DateOnly got) => Assert.True(Math.Abs(want.DayNumber - got.DayNumber) <= 1, $"wanted {want} within a day, got {got}");
    private static (DateOnly From, DateOnly To) One(string id, int y) => Assert.Single(SeasonsCalendar.Occurrences(id, y));

    [Fact]
    public void Easter_is_the_computus()
    {
        Assert.Equal(D(2024, 3, 31), SeasonsCalendar.Easter(2024));
        Assert.Equal(D(2025, 4, 20), SeasonsCalendar.Easter(2025));
        Assert.Equal(D(2026, 4, 5), SeasonsCalendar.Easter(2026));
        Assert.Equal(D(2027, 3, 28), SeasonsCalendar.Easter(2027));
    }

    [Fact]
    public void The_Hebrew_days()
    {
        Assert.Equal(D(2026, 12, 4), One("hanukkah", 2026).From);      // the first candle is lit on the evening of the 4th
        Assert.Equal(D(2026, 12, 12), One("hanukkah", 2026).To);
        Assert.Equal(D(2025, 12, 14), One("hanukkah", 2025).From);
        Assert.Equal(D(2026, 4, 1), One("passover", 2026).From);       // the first seder is on the evening of the 1st
        Assert.Equal(D(2027, 4, 21), One("passover", 2027).From);
        Assert.Equal(D(2026, 9, 11), One("rosh-hashanah", 2026).From); // it starts on the evening of the 11th
        Assert.Equal(D(2026, 9, 13), One("rosh-hashanah", 2026).To);
    }

    [Fact]
    public void The_Islamic_days_by_the_Umm_al_Qura_calendar()
    {
        var ram = One("ramadan", 2026); Assert.Equal(D(2026, 2, 17), ram.From); Assert.Equal(D(2026, 3, 19), ram.To);
        Assert.Equal(D(2026, 3, 19), One("eid-al-fitr", 2026).From);   // the day is the 20th
        Assert.Equal(D(2026, 5, 26), One("eid-al-adha", 2026).From);   // the day is the 27th
        Assert.Equal(D(2025, 3, 29), One("eid-al-fitr", 2025).From);   // the day was the 30th
    }

    [Fact]
    public void The_Chinese_days()
    {
        Assert.Equal(D(2026, 2, 16), One("lunar-new-year", 2026).From);   // the day is the 17th
        Assert.Equal(D(2027, 2, 5), One("lunar-new-year", 2027).From);    // the day is the 6th
        Assert.Equal(D(2025, 1, 28), One("lunar-new-year", 2025).From);   // the day was the 29th
        Assert.Equal(D(2026, 9, 24), One("mid-autumn", 2026).From);       // the day is the 25th
        Assert.Equal(D(2025, 10, 5), One("mid-autumn", 2025).From);       // the day was the 6th, after a leap sixth month
    }

    [Fact]
    public void The_moon_reckoned_days()
    {
        Near(D(2024, 10, 31), SeasonsCalendar.Diwali(2024)); Near(D(2025, 10, 20), SeasonsCalendar.Diwali(2025));
        Near(D(2026, 11, 8), SeasonsCalendar.Diwali(2026)); Near(D(2027, 10, 29), SeasonsCalendar.Diwali(2027)); Near(D(2028, 10, 17), SeasonsCalendar.Diwali(2028));
        Near(D(2024, 3, 25), SeasonsCalendar.Holi(2024)); Near(D(2025, 3, 14), SeasonsCalendar.Holi(2025));
        Near(D(2026, 3, 4), SeasonsCalendar.Holi(2026)); Near(D(2027, 3, 22), SeasonsCalendar.Holi(2027));
        Near(D(2024, 5, 23), SeasonsCalendar.Vesak(2024)); Near(D(2025, 5, 12), SeasonsCalendar.Vesak(2025)); Near(D(2026, 5, 1), SeasonsCalendar.Vesak(2026));
    }

    [Fact]
    public void A_new_moon_on_record()
    {
        // a new moon of November 2026 and a full moon of March 2027, each at its instant in an almanac
        var t = Enumerable.Range(320, 20).Select(k => SeasonsCalendar.MoonPhase(k)).First(x => x > new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc));
        Assert.True(Math.Abs((t - new DateTime(2026, 11, 9, 7, 2, 0, DateTimeKind.Utc)).TotalMinutes) < 20, t.ToString("u"));
        var f = Enumerable.Range(320, 20).Select(k => SeasonsCalendar.MoonPhase(k + 0.5)).First(x => x > new DateTime(2027, 3, 10, 0, 0, 0, DateTimeKind.Utc));
        Assert.True(Math.Abs((f - new DateTime(2027, 3, 22, 10, 44, 0, DateTimeKind.Utc)).TotalMinutes) < 20, f.ToString("u"));
    }

    [Fact]
    public void The_fixed_days_and_the_harvest()
    {
        Assert.Equal((D(2026, 12, 30), D(2027, 1, 1)), One("new-year", 2026));
        Assert.Equal((D(2026, 11, 23), D(2026, 11, 27)), One("harvest", 2026));   // the fourth Thursday is the 26th
        Assert.Empty(SeasonsCalendar.Occurrences("spring", 2026));
    }

    [Fact]
    public void Everything_is_on_until_turned_off()
    {
        var s = new SeasonsSettings();
        Assert.Equal(new[] { "christmas", "kwanzaa" }, SeasonsCalendar.ActiveHolidays(s, D(2026, 12, 26)));
        Assert.Contains("hanukkah", SeasonsCalendar.ActiveHolidays(s, D(2026, 12, 11)));
        Assert.Contains("christmas", SeasonsCalendar.ActiveHolidays(s, D(2026, 12, 11)));
        s.Items["christmas"] = new SeasonItem { On = false };
        Assert.Equal(new[] { "kwanzaa" }, SeasonsCalendar.ActiveHolidays(s, D(2026, 12, 26)));
        Assert.Empty(SeasonsCalendar.ActiveHolidays(new SeasonsSettings(), D(2026, 7, 20)));
        Assert.Contains("new-year", SeasonsCalendar.ActiveHolidays(new SeasonsSettings(), D(2027, 1, 1)));   // a range over the year's end
    }

    [Fact]
    public void A_range_of_the_persons_own_replaces_the_calendars()
    {
        var s = new SeasonsSettings(); s.Items["diwali"] = new SeasonItem { From = "07-01", To = "07-05" };
        Assert.Contains("diwali", SeasonsCalendar.ActiveHolidays(s, D(2026, 7, 3)));
        Assert.DoesNotContain("diwali", SeasonsCalendar.ActiveHolidays(s, D(2026, 11, 8)));
        s.Items["new-year"] = new SeasonItem { From = "12-28", To = "01-03" };
        Assert.Contains("new-year", SeasonsCalendar.ActiveHolidays(s, D(2027, 1, 3)));
        Assert.DoesNotContain("new-year", SeasonsCalendar.ActiveHolidays(s, D(2027, 1, 4)));
    }

    [Fact]
    public void The_seasons_turn_over_in_the_south_and_give_way_when_off()
    {
        var s = new SeasonsSettings();
        Assert.Equal("autumn", SeasonsCalendar.Season(s, D(2026, 11, 12)));
        Assert.Equal("winter", SeasonsCalendar.Season(s, D(2026, 12, 25)));
        Assert.Equal("winter", SeasonsCalendar.Season(s, D(2027, 1, 15)));
        s.South = true; Assert.Equal("spring", SeasonsCalendar.Season(s, D(2026, 11, 12)));
        s.South = false; s.Items["autumn"] = new SeasonItem { On = false };
        Assert.Equal("summer", SeasonsCalendar.Season(s, D(2026, 11, 12)));
        foreach (var id in new[] { "spring", "summer", "winter" }) s.Items[id] = new SeasonItem { On = false };
        Assert.Equal("spring", SeasonsCalendar.Season(s, D(2026, 11, 12)));
    }

    [Fact]
    public void A_place_sets_the_half_of_the_world()
    {
        var s = SeasonsSettings.Parse("{\"place\":\"Sydney\"}");
        Assert.Equal("Sydney", s.Place); Assert.True(s.South); Assert.Equal("spring", SeasonsCalendar.Season(s, D(2026, 11, 12)));
        Assert.Equal("Sydney", SeasonsSettings.Parse(s.ToJson()).Place);
        var n = SeasonsSettings.Parse("{\"south\":true,\"place\":\"Toronto\"}"); Assert.False(n.South);
        var odd = SeasonsSettings.Parse("{\"south\":true,\"place\":\"Nowhere\"}"); Assert.Equal("", odd.Place); Assert.True(odd.South);
        Assert.Equal(SeasonsCalendar.Places.Count, SeasonsCalendar.Places.Select(x => x.Name).Distinct().Count());
    }

    [Fact]
    public void The_sky_follows_the_place()
    {
        var (rise, set) = SeasonsCalendar.SunTimes(41, 172);                // New York at midsummer: about fifteen hours of day
        Assert.InRange(rise, 4.3, 4.8); Assert.InRange(set, 19.2, 19.7);
        (rise, set) = SeasonsCalendar.SunTimes(0, 80); Assert.InRange(rise, 5.9, 6.1); Assert.InRange(set, 17.9, 18.1);
        var here = new SeasonsSettings { Place = "Tokyo" }; var any = new DateTime(2026, 11, 12, 9, 0, 0);   // one clock for the town, whatever the place
        DateTime U(int mo, int d, int h, int mi) => new(2026, mo, d, h, mi, 0, DateTimeKind.Utc);
        Assert.Equal("day", SeasonsCalendar.SkyAt(here, any, U(11, 12, 17, 0)).Sky);       // noon in New York
        Assert.Equal("night", SeasonsCalendar.SkyAt(here, any, U(11, 12, 4, 0)).Sky);      // eleven at night there
        Assert.Equal("dusk", SeasonsCalendar.SkyAt(here, any, U(11, 12, 21, 50)).Sky);     // ten to five
        Assert.Equal("dawn", SeasonsCalendar.SkyAt(here, any, U(11, 12, 12, 10)).Sky);     // ten past seven
        Assert.InRange(SeasonsCalendar.SkyAt(here, any, U(6, 21, 16, 0)).At, 0.45, 0.55); // noon at midsummer, daylight time
        Assert.Equal(SeasonsCalendar.SkyAt(new SeasonsSettings(), any, U(11, 12, 17, 0)), SeasonsCalendar.SkyAt(here, any, U(11, 12, 17, 0)));
        var age = SeasonsCalendar.MoonAge(new DateTime(2026, 11, 9, 7, 2, 0, DateTimeKind.Utc)); Assert.True(age < 0.03 || age > 0.97, age.ToString());
        Assert.InRange(SeasonsCalendar.MoonAge(new DateTime(2027, 3, 22, 10, 44, 0, DateTimeKind.Utc)), 0.47, 0.53);
        Assert.NotEqual(SeasonsCalendar.Plan(here, U(11, 12, 17, 0).ToLocalTime()).Signature, SeasonsCalendar.Plan(here, U(11, 12, 4, 0).ToLocalTime()).Signature);
    }

    [Fact]
    public void The_modes()
    {
        var s = new SeasonsSettings { Mode = "one", One = "diwali" };
        var p = SeasonsCalendar.Plan(s, new DateTime(2026, 7, 1, 12, 0, 0));
        Assert.Equal("summer", p.Season); Assert.Equal(new[] { "diwali" }, p.Holidays);
        s.One = "winter"; p = SeasonsCalendar.Plan(s, new DateTime(2026, 7, 1, 12, 0, 0));
        Assert.Equal("winter", p.Season); Assert.Empty(p.Holidays);
        s.Mode = "rotate";
        var a = SeasonsCalendar.Plan(s, new DateTime(2026, 7, 1, 12, 0, 0)); var b = SeasonsCalendar.Plan(s, new DateTime(2026, 7, 1, 12, 5, 0)); var a2 = SeasonsCalendar.Plan(s, new DateTime(2026, 7, 1, 12, 4, 59));
        Assert.NotEqual(a.Signature, b.Signature); Assert.Equal(a.Signature, a2.Signature);
        s.Mode = "auto"; p = SeasonsCalendar.Plan(s, new DateTime(2026, 12, 5, 20, 0, 0));
        Assert.Equal("autumn", p.Season); Assert.Equal(new[] { "hanukkah" }, p.Holidays);
    }

    [Fact]
    public void The_settings_round_trip_and_refuse_what_they_do_not_know()
    {
        var s = new SeasonsSettings { Mode = "rotate", South = true };
        s.Items["holi"] = new SeasonItem { On = false }; s.Items["vesak"] = new SeasonItem { From = "05-01", To = "05-09" }; s.Items["easter"] = new SeasonItem();
        var json = s.ToJson(); var r = SeasonsSettings.Parse(json);
        Assert.Equal("rotate", r.Mode); Assert.True(r.South); Assert.False(r.Item("holi").On); Assert.Equal("05-09", r.Item("vesak").To);
        Assert.DoesNotContain("easter", json);   // a row left as it comes is not written
        var odd = SeasonsSettings.Parse("{\"mode\":\"x\",\"one\":\"nothing\",\"items\":{\"made-up\":{\"on\":false},\"holi\":{\"from\":\"13-40\",\"to\":\"01-01\"}}}");
        Assert.Equal("auto", odd.Mode); Assert.Equal("", odd.One); Assert.Empty(odd.Items.Keys.Where(k => k == "made-up")); Assert.Null(odd.Item("holi").From);
        Assert.Equal("auto", SeasonsSettings.Parse("not json").Mode);
    }

    [Fact]
    public void Every_holiday_has_a_range_in_each_of_the_next_fifteen_years()
    {
        foreach (var e in SeasonsCalendar.Entries.Where(x => !x.IsSeason))
            for (var y = 2026; y <= 2041; y++)
            {
                var o = SeasonsCalendar.Occurrences(e.Id, y);
                if (e.Group != "Muslim") Assert.Single(o); else Assert.InRange(o.Count, 0, 2);   // the Islamic year is shorter: a day can fall twice in a year, or not at all
                foreach (var (from, to) in o) Assert.InRange(to.DayNumber - from.DayNumber, 1, 31);
            }
        Assert.NotNull(SeasonsCalendar.Upcoming("ramadan", new DateOnly(2026, 11, 12)));
    }
}
