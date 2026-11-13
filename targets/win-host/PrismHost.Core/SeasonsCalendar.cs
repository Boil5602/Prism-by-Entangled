using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PrismHost;

// This file is pure ASCII.

/// <summary>One row of the Seasons visual: a season of the year, or a holiday a household keeps.</summary>
public sealed record SeasonEntry(string Id, string Name, string Group, bool IsSeason);

/// <summary>What a person chose for one row: shown or not, and a date range of their own ("MM-dd", each year) in place of the
/// calendar's. Both ends null: the calendar's range.</summary>
public sealed class SeasonItem
{
    public bool On = true;
    public string? From, To;
}

/// <summary>
/// The Seasons visual's settings (2026-11-12, asked for a seasonal visual a person can set up: which holidays and seasons it
/// shows, and a date range for each). Mode "auto": the rows whose range holds today. Mode "one": always the row named in One.
/// Mode "rotate": the rows that are on, one after the other, a few minutes each. Kept as one JSON string in the host's settings.
/// A row that is not in Items is on, with the calendar's range: every row is on until a person turns it off.
/// </summary>
public sealed class SeasonsSettings
{
    public string Mode = "auto";
    public string One = "";
    public bool South;
    /// <summary>A place from SeasonsCalendar.Places, picked by the person (2026-11-12); it sets South. Empty: only the half of the world is known.</summary>
    public string Place = "";
    public readonly Dictionary<string, SeasonItem> Items = new();

    public SeasonItem Item(string id) => Items.TryGetValue(id, out var i) ? i : new SeasonItem();

    public static SeasonsSettings Parse(string? json)
    {
        var s = new SeasonsSettings();
        try
        {
            if (string.IsNullOrWhiteSpace(json) || JsonNode.Parse(json) is not JsonObject o) return s;
            var mode = o["mode"]?.GetValue<string>(); if (mode is "auto" or "one" or "rotate") s.Mode = mode;
            s.One = o["one"]?.GetValue<string>() ?? ""; if (SeasonsCalendar.Entry(s.One) is null) s.One = "";
            s.South = o["south"]?.GetValue<bool>() ?? false;
            if (SeasonsCalendar.PlaceLat(o["place"]?.GetValue<string>()) is { } lat) { s.Place = o["place"]!.GetValue<string>(); s.South = lat < 0; }
            if (o["items"] is JsonObject items)
                foreach (var (id, v) in items)
                {
                    if (SeasonsCalendar.Entry(id) is null || v is not JsonObject io) continue;
                    var it = new SeasonItem { On = io["on"]?.GetValue<bool>() ?? true };
                    var from = io["from"]?.GetValue<string>(); var to = io["to"]?.GetValue<string>();
                    if (SeasonsCalendar.MonthDay(from) is not null && SeasonsCalendar.MonthDay(to) is not null) { it.From = from; it.To = to; }
                    s.Items[id] = it;
                }
        }
        catch { return new SeasonsSettings(); }
        return s;
    }

    public string ToJson()
    {
        var items = new JsonObject();
        foreach (var (id, it) in Items)
        {
            if (it.On && it.From is null) continue;   // the default: not written
            var io = new JsonObject { ["on"] = it.On };
            if (it.From is not null && it.To is not null) { io["from"] = it.From; io["to"] = it.To; }
            items[id] = io;
        }
        return new JsonObject { ["mode"] = Mode, ["one"] = One, ["south"] = South, ["place"] = Place, ["items"] = items }.ToJsonString(new JsonSerializerOptions { WriteIndented = false });
    }
}

/// <summary>What the Seasons visual shows now: the season of the year the town is in, and the holidays its homes are dressed for.</summary>
public sealed record SeasonsPlan(string Season, IReadOnlyList<string> Holidays)
{
    /// <summary>The sky at the place: "dawn", "day", "dusk" or "night" (2026-11-12, asked for a sun and a moon that follow the place's time of day).</summary>
    public string Sky { get; init; } = "dusk";
    /// <summary>How far the sun is through the day, or the moon through the night: 0 as it rises, 1 as it sets.</summary>
    public double SunAt { get; init; } = 0.5;
    /// <summary>The moon's age: 0 new, 0.5 full.</summary>
    public double Moon { get; init; } = 0.5;
    public string Signature => Season + "|" + string.Join(",", Holidays) + "|" + Sky;
}

/// <summary>
/// The dates of the Seasons visual. Nothing is looked up on a network: every date is computed on this PC.
///
/// Sources of the dates. Fixed days: the civil calendar. Easter: the Gregorian computus (Western churches). Hanukkah, Passover and
/// Rosh Hashanah: the Hebrew calendar (.NET HebrewCalendar). Ramadan and the two Eids: the Umm al-Qura calendar of Saudi Arabia
/// (.NET UmAlQuraCalendar); a country that goes by its own sighting of the moon can be a day off, so each range has a day to
/// spare. Lunar New Year and Mid-Autumn: the Chinese lunisolar calendar (.NET ChineseLunisolarCalendar). Diwali, Holi and Vesak:
/// the new or full moon of their month, computed (Meeus, Astronomical Algorithms, ch. 49) and read at India's clock; a regional
/// calendar can differ by a day, so each range has a day or two to spare. A person can set any range in the settings.
///
/// The seasons are the astronomical ones to the nearest day, turned over for the southern half of the world by a setting; PRISM
/// does not ask where the PC is.
/// </summary>
public static class SeasonsCalendar
{
    /// <summary>The rows, largest communities first, then the days kept across beliefs, then the seasons.</summary>
    public static readonly IReadOnlyList<SeasonEntry> Entries = new SeasonEntry[]
    {
        new("christmas", "Christmas", "Christian", false),
        new("easter", "Easter", "Christian", false),
        new("ramadan", "Ramadan", "Muslim", false),
        new("eid-al-fitr", "Eid al-Fitr", "Muslim", false),
        new("eid-al-adha", "Eid al-Adha", "Muslim", false),
        new("diwali", "Diwali", "Hindu", false),
        new("holi", "Holi", "Hindu", false),
        new("vesak", "Vesak", "Buddhist", false),
        new("lunar-new-year", "Lunar New Year", "East Asian", false),
        new("mid-autumn", "Mid-Autumn Festival", "East Asian", false),
        new("vaisakhi", "Vaisakhi", "Sikh", false),
        new("hanukkah", "Hanukkah", "Jewish", false),
        new("passover", "Passover", "Jewish", false),
        new("rosh-hashanah", "Rosh Hashanah", "Jewish", false),
        new("new-year", "New Year", "Shared", false),
        new("nowruz", "Nowruz", "Shared", false),
        new("kwanzaa", "Kwanzaa", "Shared", false),
        new("day-of-the-dead", "Day of the Dead", "Shared", false),
        new("harvest", "Harvest and Thanksgiving", "Shared", false),
        new("spring", "Spring", "Season", true),
        new("summer", "Summer", "Season", true),
        new("autumn", "Autumn", "Season", true),
        new("winter", "Winter", "Season", true),
    };

    public static SeasonEntry? Entry(string? id) => Entries.FirstOrDefault(e => e.Id == id);

    /// <summary>"MM-dd" as a month and a day, or null. The 29th of February is taken.</summary>
    public static (int M, int D)? MonthDay(string? s)
    {
        if (s is null || s.Length != 5 || s[2] != '-') return null;
        if (!int.TryParse(s.AsSpan(0, 2), out var m) || !int.TryParse(s.AsSpan(3, 2), out var d)) return null;
        if (m < 1 || m > 12 || d < 1 || d > DateTime.DaysInMonth(2024, m)) return null;
        return (m, d);
    }
    public static string MonthDay(DateOnly d) => d.Month.ToString("00", CultureInfo.InvariantCulture) + "-" + d.Day.ToString("00", CultureInfo.InvariantCulture);

    private static DateOnly Day(int y, int m, int d) => new(y, m, Math.Min(d, DateTime.DaysInMonth(y, m)));
    private static (DateOnly From, DateOnly To) Around(DateOnly day, int before, int after) => (day.AddDays(-before), day.AddDays(after));
    private static (DateOnly From, DateOnly To) Fixed(int y, int m1, int d1, int m2, int d2)
    {
        var from = Day(y, m1, d1); var to = Day(y, m2, d2); if (to < from) to = Day(y + 1, m2, d2);
        return (from, to);
    }

    /// <summary>Easter Sunday of the Western churches (the Gregorian computus, in the anonymous form).</summary>
    public static DateOnly Easter(int y)
    {
        int a = y % 19, b = y / 100, c = y % 100, d = b / 4, e = b % 4, f = (b + 8) / 25, g = (b - f + 1) / 3, h = (19 * a + b - d - g + 15) % 30;
        int i = c / 4, k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451;
        int month = (h + l - 7 * m + 114) / 31, day = (h + l - 7 * m + 114) % 31 + 1;
        return new DateOnly(y, month, day);
    }

    private static readonly HebrewCalendar Hebrew = new();
    private static readonly UmAlQuraCalendar Hijri = new();
    private static readonly ChineseLunisolarCalendar Chinese = new();

    /// <summary>A day of the Hebrew year that starts in the autumn of Gregorian year `y - 1` (spring) or `y` (autumn). Nisan is the
    /// seventh month of a common year and the eighth of a leap year in .NET's count from Tishri.</summary>
    private static DateOnly HebrewDay(int hebrewYear, bool nisan, int monthFromTishri, int day)
    {
        var month = nisan ? (Hebrew.IsLeapYear(hebrewYear) ? 8 : 7) : monthFromTishri;
        return DateOnly.FromDateTime(Hebrew.ToDateTime(hebrewYear, month, day, 0, 0, 0, 0));
    }

    /// <summary>The Gregorian days in year `y` of a day of the Islamic year (two in some years: the Islamic year is 11 days shorter).</summary>
    private static IEnumerable<DateOnly> HijriDays(int y, int month, int day)
    {
        var guess = (int)Math.Round((y - 622) * 33.0 / 32.0);
        for (var hy = guess - 1; hy <= guess + 2; hy++)
        {
            DateOnly d;
            try { if (hy < 1320 || hy > 1500) continue; d = DateOnly.FromDateTime(Hijri.ToDateTime(hy, month, day, 0, 0, 0, 0)); } catch { continue; }
            if (d.Year == y) yield return d;
        }
    }
    private static (DateOnly From, DateOnly To) RamadanOf(DateOnly first)
    {
        var dt = first.ToDateTime(TimeOnly.MinValue); var hy = Hijri.GetYear(dt);
        return (first.AddDays(-1), first.AddDays(Hijri.GetDaysInMonth(hy, 9) - 1));
    }

    private static DateOnly? ChineseDay(int y, int month, int day)
    {
        try
        {
            var leap = Chinese.GetLeapMonth(y);   // the place of the leap month in the year's months, 0 for none
            var index = leap > 0 && leap <= month ? month + 1 : month;
            return DateOnly.FromDateTime(Chinese.ToDateTime(y, index, day, 0, 0, 0, 0));
        }
        catch { return null; }
    }

    /// <summary>The instant (UTC) of a new moon (whole k) or a full moon (k + 0.5); k counts lunations from the new moon of
    /// 2000-01-06. Meeus ch. 49 without the planets' terms: good to a few minutes.</summary>
    public static DateTime MoonPhase(double k)
    {
        var full = Math.Abs(k - Math.Floor(k) - 0.5) < 0.01;
        double T = k / 1236.85, T2 = T * T, T3 = T2 * T;
        var jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T2 * T2;
        const double R = Math.PI / 180;
        var E = 1 - 0.002516 * T - 0.0000074 * T2;
        var M = R * (2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3);
        var Mp = R * (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3);
        var F = R * (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3);
        var Om = R * (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3);
        double c;
        if (!full)
            c = -0.40720 * Math.Sin(Mp) + 0.17241 * E * Math.Sin(M) + 0.01608 * Math.Sin(2 * Mp) + 0.01039 * Math.Sin(2 * F) + 0.00739 * E * Math.Sin(Mp - M)
              - 0.00514 * E * Math.Sin(Mp + M) + 0.00208 * E * E * Math.Sin(2 * M) - 0.00111 * Math.Sin(Mp - 2 * F) - 0.00057 * Math.Sin(Mp + 2 * F)
              + 0.00056 * E * Math.Sin(2 * Mp + M) - 0.00042 * Math.Sin(3 * Mp) + 0.00042 * E * Math.Sin(M + 2 * F) + 0.00038 * E * Math.Sin(M - 2 * F)
              - 0.00024 * E * Math.Sin(2 * Mp - M) - 0.00017 * Math.Sin(Om);
        else
            c = -0.40614 * Math.Sin(Mp) + 0.17302 * E * Math.Sin(M) + 0.01614 * Math.Sin(2 * Mp) + 0.01043 * Math.Sin(2 * F) + 0.00734 * E * Math.Sin(Mp - M)
              - 0.00515 * E * Math.Sin(Mp + M) + 0.00209 * E * E * Math.Sin(2 * M) - 0.00111 * Math.Sin(Mp - 2 * F) - 0.00057 * Math.Sin(Mp + 2 * F)
              + 0.00056 * E * Math.Sin(2 * Mp + M) - 0.00042 * Math.Sin(3 * Mp) + 0.00042 * E * Math.Sin(M + 2 * F) + 0.00038 * E * Math.Sin(M - 2 * F)
              - 0.00024 * E * Math.Sin(2 * Mp - M) - 0.00017 * Math.Sin(Om);
        // the clock of the ephemeris runs about 70 s ahead of the civil clock in these decades
        return new DateTime(2000, 1, 1, 12, 0, 0, DateTimeKind.Utc).AddDays(jde + c - 2451545.0).AddSeconds(-70);
    }
    /// <summary>The first new moon (or full moon) at or after an instant.</summary>
    private static DateTime MoonAfter(DateTime utc, bool full)
    {
        var k = Math.Floor((utc - new DateTime(2000, 1, 6, 18, 14, 0, DateTimeKind.Utc)).TotalDays / 29.530588861) - 2 + (full ? 0.5 : 0);
        for (var i = 0; i < 6; i++) { var t = MoonPhase(k + i); if (t >= utc) return t; }
        return MoonPhase(k + 5);
    }
    private static readonly TimeSpan India = new(5, 30, 0);

    /// <summary>The night of the lamps: the day whose evening lies in the dark of the moon of the month of Kartika, read at
    /// India's clock. The new moon that ends that dark falls from the 17th of October to the 15th of November.</summary>
    public static DateOnly Diwali(int y)
    {
        var t = MoonAfter(new DateTime(y, 10, 17, 0, 0, 0, DateTimeKind.Utc), false) + India;
        return DateOnly.FromDateTime(t).AddDays(t.TimeOfDay < new TimeSpan(19, 0, 0) ? -1 : 0);
    }
    /// <summary>The day of colours: the day after the evening of the full moon of the month of Phalguna, read at India's clock.</summary>
    public static DateOnly Holi(int y)
    {
        var t = MoonAfter(new DateTime(y, 2, 26, 12, 0, 0, DateTimeKind.Utc), true) + India;
        return DateOnly.FromDateTime(t).AddDays(t.TimeOfDay < new TimeSpan(18, 0, 0) ? 0 : 1);
    }
    /// <summary>The first full moon of May, as the United Nations keeps the day.</summary>
    public static DateOnly Vesak(int y) => DateOnly.FromDateTime(MoonAfter(new DateTime(y, 4, 30, 18, 30, 0, DateTimeKind.Utc), true) + India);

    /// <summary>The calendar's ranges of a holiday whose main day is in year `y` (none for a season, or outside the calendars' years).</summary>
    public static IReadOnlyList<(DateOnly From, DateOnly To)> Occurrences(string id, int y)
    {
        var r = new List<(DateOnly, DateOnly)>();
        if (y < 1950 || y > 2070) return r;
        try
        {
            switch (id)
            {
                case "christmas": r.Add(Fixed(y, 12, 11, 12, 26)); break;
                case "easter": r.Add(Around(Easter(y), 2, 1)); break;
                case "ramadan": foreach (var d in HijriDays(y, 9, 1)) r.Add(RamadanOf(d)); break;
                case "eid-al-fitr": foreach (var d in HijriDays(y, 10, 1)) r.Add(Around(d, 1, 3)); break;
                case "eid-al-adha": foreach (var d in HijriDays(y, 12, 10)) r.Add(Around(d, 1, 3)); break;
                case "diwali": r.Add(Around(Diwali(y), 2, 2)); break;
                case "holi": r.Add(Around(Holi(y), 1, 1)); break;
                case "vesak": r.Add(Around(Vesak(y), 1, 1)); break;
                case "lunar-new-year": if (ChineseDay(y, 1, 1) is { } ny) r.Add((ny.AddDays(-1), ny.AddDays(14))); break;
                case "mid-autumn": if (ChineseDay(y, 8, 15) is { } ma) r.Add(Around(ma, 1, 1)); break;
                case "vaisakhi": r.Add(Fixed(y, 4, 13, 4, 14)); break;
                case "hanukkah": r.Add(Around(HebrewDay(y + 3761, false, 3, 25), 1, 7)); break;
                case "passover": r.Add(Around(HebrewDay(y + 3760, true, 0, 15), 1, 7)); break;
                case "rosh-hashanah": r.Add(Around(HebrewDay(y + 3761, false, 1, 1), 1, 1)); break;
                case "new-year": r.Add(Fixed(y, 12, 30, 1, 1)); break;
                case "nowruz": r.Add(Fixed(y, 3, 19, 3, 22)); break;
                case "kwanzaa": r.Add(Fixed(y, 12, 26, 1, 1)); break;
                case "day-of-the-dead": r.Add(Fixed(y, 10, 31, 11, 2)); break;
                case "harvest":
                {   // the fourth Thursday of November, with the days around it
                    var first = new DateOnly(y, 11, 1); var thu = first.AddDays(((int)DayOfWeek.Thursday - (int)first.DayOfWeek + 7) % 7 + 21);
                    r.Add(Around(thu, 3, 1)); break;
                }
            }
        }
        catch { }
        return r;
    }

    /// <summary>The range that holds a day, or the next one after it: what the settings show beside a row.</summary>
    public static (DateOnly From, DateOnly To)? Upcoming(string id, DateOnly today)
    {
        for (var y = today.Year - 1; y <= today.Year + 2; y++)
            foreach (var o in Occurrences(id, y)) if (o.To >= today) return o;
        return null;
    }

    private static bool InYearly((int M, int D) from, (int M, int D) to, DateOnly d)
    {
        int a = from.M * 100 + from.D, b = to.M * 100 + to.D, x = d.Month * 100 + d.Day;
        return a <= b ? x >= a && x <= b : x >= a || x <= b;
    }

    /// <summary>The season of the year on a day, before any setting but the half of the world.</summary>
    /// <summary>
    /// Places a person can pick for the seasons, with the latitude of each in whole degrees. The list is on the PC: PRISM does not
    /// ask Windows or a network where the PC is. Today a place decides the half of the world and nothing else.
    /// </summary>
    public static readonly IReadOnlyList<(string Name, int Lat, int Lon)> Places = new (string, int, int)[]
    {
        ("Accra", 6, 0), ("Addis Ababa", 9, 39), ("Anchorage", 61, -150), ("Athens", 38, 24), ("Atlanta", 34, -84), ("Auckland", -37, 175), ("Bangkok", 14, 101),
        ("Beijing", 40, 116), ("Bengaluru", 13, 78), ("Berlin", 52, 13), ("Bogota", 5, -74), ("Buenos Aires", -35, -58), ("Cairo", 30, 31), ("Cape Town", -34, 18),
        ("Caracas", 10, -67), ("Casablanca", 34, -8), ("Chicago", 42, -88), ("Colombo", 7, 80), ("Delhi", 29, 77), ("Denver", 40, -105), ("Dhaka", 24, 90),
        ("Dubai", 25, 55), ("Dublin", 53, -6), ("Hanoi", 21, 106), ("Havana", 23, -82), ("Hong Kong", 22, 114), ("Honolulu", 21, -158), ("Houston", 30, -95),
        ("Istanbul", 41, 29), ("Jakarta", -6, 107), ("Jerusalem", 32, 35), ("Johannesburg", -26, 28), ("Karachi", 25, 67), ("Kathmandu", 28, 85), ("Kinshasa", -4, 15),
        ("Kolkata", 23, 88), ("Kuala Lumpur", 3, 102), ("Kyiv", 50, 31), ("Lagos", 6, 3), ("Lima", -12, -77), ("Lisbon", 39, -9), ("London", 51, 0),
        ("Los Angeles", 34, -118), ("Madrid", 40, -4), ("Manila", 15, 121), ("Melbourne", -38, 145), ("Mexico City", 19, -99), ("Miami", 26, -80), ("Moscow", 56, 38),
        ("Mumbai", 19, 73), ("Nairobi", -1, 37), ("New York", 41, -74), ("Paris", 49, 2), ("Perth", -32, 116), ("Reykjavik", 64, -22), ("Rio de Janeiro", -23, -43),
        ("Riyadh", 25, 47), ("Rome", 42, 12), ("San Francisco", 38, -122), ("Santiago", -33, -71), ("Sao Paulo", -24, -47), ("Seattle", 48, -122), ("Seoul", 38, 127),
        ("Shanghai", 31, 121), ("Singapore", 1, 104), ("Stockholm", 59, 18), ("Sydney", -34, 151), ("Tehran", 36, 51), ("Tokyo", 36, 140), ("Toronto", 44, -79),
        ("Vancouver", 49, -123), ("Warsaw", 52, 21), ("Washington", 39, -77),
    };
    public static int? PlaceLat(string? name) { foreach (var (n, lat, _) in Places) if (n == name) return lat; return null; }
    public static int? PlaceLon(string? name) { foreach (var (n, _, lon) in Places) if (n == name) return lon; return null; }

    /// <summary>Sunrise and sunset in hours of the sun's own clock (noon is 12), for a latitude and a day of the year.</summary>
    public static (double Rise, double Set) SunTimes(double lat, int dayOfYear)
    {
        var decl = 23.44 * Math.Sin(2 * Math.PI * (284 + dayOfYear) / 365.0) * Math.PI / 180;
        var x = Math.Clamp(-Math.Tan(lat * Math.PI / 180) * Math.Tan(decl), -1, 1);
        var h = Math.Acos(x) * 180 / Math.PI / 15;
        return (12 - h, 12 + h);
    }

    /// <summary>The moon's age at an instant: 0 new, 0.5 full (the mean month from a new moon on record, 2000-01-06).</summary>
    public static double MoonAge(DateTime utc)
    {
        var a = (utc - new DateTime(2000, 1, 6, 18, 14, 0, DateTimeKind.Utc)).TotalDays / 29.530588853;
        return a - Math.Floor(a);
    }

    /// <summary>
    /// The sky over the town. Convergence is one town and has one clock, the same on every PC: the time of day in New York
    /// (2026-11-12). The settings' place decides the seasons and not the sky. Dawn and dusk are three quarters of an hour each
    /// side of sunrise and sunset. Where Windows has no record of that time zone, the hour on this PC's clock is used.
    /// </summary>
    public static (string Sky, double At) SkyAt(SeasonsSettings s, DateTime local, DateTime utc)
    {
        var now = local;
        try { now = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), TimeZoneInfo.FindSystemTimeZoneById("Eastern Standard Time")); } catch { }
        var hour = now.TimeOfDay.TotalHours; var (rise, set) = SunTimes(41, now.DayOfYear); const double m = 0.75;
        if (Math.Abs(hour - rise) <= m) return ("dawn", 0);
        if (Math.Abs(hour - set) <= m) return ("dusk", 1);
        if (hour > rise && hour < set) return ("day", (hour - rise) / (set - rise));
        var since = hour >= set ? hour - set : hour + 24 - set;
        return ("night", Math.Clamp(since / (24 - (set - rise)), 0, 1));
    }

    public static string NaturalSeason(DateOnly d, bool south)
    {
        var x = d.Month * 100 + d.Day;
        var n = x >= 320 && x < 621 ? 0 : x >= 621 && x < 922 ? 1 : x >= 922 && x < 1221 ? 2 : 3;
        return SeasonIds[south ? (n + 2) % 4 : n];
    }
    private static readonly string[] SeasonIds = { "spring", "summer", "autumn", "winter" };

    /// <summary>Is a row's range on this day? A season with a range of the person's own is tested by that range.</summary>
    public static bool InRange(SeasonsSettings s, string id, DateOnly d)
    {
        var it = s.Item(id);
        if (MonthDay(it.From) is { } f && MonthDay(it.To) is { } t) return InYearly(f, t, d);
        if (Entry(id) is { IsSeason: true }) return NaturalSeason(d, s.South) == id;
        for (var y = d.Year - 1; y <= d.Year + 1; y++)
            foreach (var o in Occurrences(id, y)) if (d >= o.From && d <= o.To) return true;
        return false;
    }

    /// <summary>The season the town is in: the season of the day; one that is turned off gives way to the one before it, and with
    /// all four off the town is in spring.</summary>
    public static string Season(SeasonsSettings s, DateOnly d)
    {
        foreach (var id in SeasonIds) if (s.Item(id).On && s.Item(id).From is not null && InRange(s, id, d)) return id;
        var n = Array.IndexOf(SeasonIds, NaturalSeason(d, s.South));
        for (var i = 0; i < 4; i++) { var id = SeasonIds[(n - i + 4) % 4]; if (s.Item(id).On) return id; }
        return "spring";
    }

    public static IReadOnlyList<string> ActiveHolidays(SeasonsSettings s, DateOnly d)
        => Entries.Where(e => !e.IsSeason && s.Item(e.Id).On && InRange(s, e.Id, d)).Select(e => e.Id).ToArray();

    /// <summary>Minutes a row is shown in the rotation before the next one.</summary>
    public const int RotateMinutes = 5;

    /// <summary>What to show at a moment of this PC's clock.</summary>
    public static SeasonsPlan Plan(SeasonsSettings s, DateTime local)
    {
        var utc = local.ToUniversalTime(); var (sky, at) = SkyAt(s, local, utc);
        return Rows(s, local) with { Sky = sky, SunAt = at, Moon = MoonAge(utc) };
    }

    private static SeasonsPlan Rows(SeasonsSettings s, DateTime local)
    {
        var d = DateOnly.FromDateTime(local);
        if (s.Mode == "one" && Entry(s.One) is { } one)
            return one.IsSeason ? new SeasonsPlan(one.Id, Array.Empty<string>()) : new SeasonsPlan(Season(s, d), new[] { one.Id });
        if (s.Mode == "rotate")
        {
            var on = Entries.Where(e => s.Item(e.Id).On).ToArray();
            if (on.Length > 0)
            {
                var e = on[(int)((long)(local - new DateTime(2000, 1, 1)).TotalMinutes / RotateMinutes % on.Length)];
                return e.IsSeason ? new SeasonsPlan(e.Id, Array.Empty<string>()) : new SeasonsPlan(Season(s, d), new[] { e.Id });
            }
        }
        return new SeasonsPlan(Season(s, d), ActiveHolidays(s, d));
    }
}
