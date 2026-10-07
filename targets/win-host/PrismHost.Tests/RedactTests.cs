using System.Text.RegularExpressions;
using PrismHost.Diagnostics;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// B-91 / dashboard-schema §22: a paired phone's bearer token must never reach
/// a file on disk.
///
/// Two halves, and both matter:
///
///   1. <see cref="Redact.Line"/> removes secrets from the shapes the host
///      actually produces - the channel's JSON, an Authorization header, a
///      query parameter, and a bare token literal.
///   2. The CONFORMANCE half below reads the host's own sources and fails if a
///      diagnostics write does not go through the redactor. That is the half
///      that survives someone adding a seventh log line in six months: a
///      redactor nobody calls is not a control.
///
/// Redaction is at WRITE TIME by design. A scrub pass would mean the token was
/// on disk until something remembered to clean it, and a log that is correct
/// only after a later pass is a log that was wrong when it was written.
/// </summary>
public sealed class RedactTests
{
    // What RemoteApi.randomToken() mints: 16 random bytes as 32 hex characters.
    private const string Token = "9f2c41ab77de05631c8a4e0fb2d97a13";

    [Fact]
    public void TheChannelsHttpCall_TheShapeThatCausedB91_LosesItsToken()
    {
        // §6 remote requests arrive as PrismRuntime.http(requestId, requestJson),
        // and the diagnostics tap records the args. This is the exact line that
        // was landing in host.log with the token in the clear.
        var line = "call {\"fn\":\"http\",\"args\":[\"r7\",\"{\\\"method\\\":\\\"GET\\\",\\\"path\\\":\\\"/state\\\",\\\"token\\\":\\\"" + Token + "\\\"}\"]}";
        var red = Redact.Line(line);

        Assert.False(Redact.Leaks(red, Token));
        Assert.Contains(Redact.Mask, red);
        Assert.Contains("\"fn\"", red);          // the useful half survives: a reader still sees WHICH call
        Assert.Contains("/state", red);
    }

    [Fact]
    public void TheChannelsEscapedQuotes_TheShapeSeen2026_10_04_LoseTheToken()
    {
        // the same http call as above, as the channel actually wrote it: the inner JSON's quotes as the escape backslash-u0022,
        // where neither a quoted-field rule nor a word-boundary hex rule could see the token (it sat between "2" and "u")
        var q = "\\u0022";
        var line = "call {" + q + "fn" + q + ":" + q + "http" + q + "," + q + "args" + q + ":[29," + q + "{" + q + "method" + q + ":" + q + "GET" + q + "," + q + "path" + q + ":" + q + "/now-playing" + q + "," + q + "token" + q + ":" + q + Token + q + "}" + q + "]}";
        var red = Redact.Line(line);

        Assert.False(Redact.Leaks(red, Token));
        Assert.Contains(Redact.Mask, red);
        Assert.Contains("/now-playing", red);
    }

    [Theory]
    // the JSON field, spaced and unspaced, and its aliases
    [InlineData("{\"token\":\"" + Token + "\"}")]
    [InlineData("{\"token\": \"" + Token + "\"}")]
    [InlineData("{\"Authorization\":\"Bearer " + Token + "\"}")]
    [InlineData("{\"bearer\":\"" + Token + "\"}")]
    [InlineData("{\"ticket\":\"" + Token + "\"}")]
    [InlineData("{\"secret\":\"" + Token + "\",\"path\":\"/state\"}")]
    // header shapes
    [InlineData("Authorization: Bearer " + Token)]
    [InlineData("authorization=" + Token)]
    // URL / path shapes
    [InlineData("GET /remote?token=" + Token)]
    [InlineData("https://10.0.0.4:8471/remote?token=" + Token + "&x=1")]
    [InlineData("GET /audio/stream?ticket=" + Token)]
    // and the catch-all: a bare token literal in a line we did not anticipate
    [InlineData("pairing minted " + Token + " for Phone 2")]
    [InlineData("-> http #3 " + Token)]
    public void EverySecretShapeTheHostProducesIsRedacted(string line)
    {
        Assert.False(Redact.Leaks(Redact.Line(line), Token), "leaked: " + line);
    }

    [Fact]
    public void RedactionKeepsTheLineUseful_AndNeverThrows()
    {
        var red = Redact.Line("call {\"fn\":\"applyScene\",\"args\":[\"demo-kitchen-command\"]}");
        Assert.Contains("applyScene", red);
        Assert.Contains("demo-kitchen-command", red);   // a scene id is not a secret
        Assert.DoesNotContain(Redact.Mask, red);        // and nothing was redacted for the sake of it

        Assert.Equal("", Redact.Line(null));
        Assert.Equal("", Redact.Line(""));
        Assert.False(Redact.Leaks("anything", null));
        Assert.False(Redact.Leaks(null, "x"));
    }

    [Fact]
    public void AShortHexIdIsNotMistakenForAToken()
    {
        // 32+ hex is the token shape; a short id or a colour must survive, or
        // the log stops being readable and people stop redacting.
        var red = Redact.Line("tile a1b2c3 painted #F0A83C at 1080p");
        Assert.Contains("a1b2c3", red);
        Assert.Contains("F0A83C", red);
    }

    /// <summary>
    /// The conformance half: every diagnostics write in the host goes through
    /// the redactor. A new log line that forgets it fails HERE rather than on
    /// somebody's disk.
    /// </summary>
    [Fact]
    public void EveryLogWriteInTheHostGoesThroughTheRedactor()
    {
        var hostDir = FindHostDir();
        var offenders = new List<string>();

        foreach (var file in Directory.EnumerateFiles(hostDir, "*.cs", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(hostDir, file).Replace('\\', '/');
            if (rel.StartsWith("bin/") || rel.StartsWith("obj/")) continue;
            var text = File.ReadAllText(file);

            // Each File.AppendAllText / WriteAllText naming a .log file must
            // mention the redactor within the same statement.
            foreach (Match m in Regex.Matches(text, @"File\.(?:AppendAllText|WriteAllText|AppendAllLines)\s*\((?:[^;])*?;", RegexOptions.Singleline))
            {
                var stmt = m.Value;
                if (!stmt.Contains(".log", StringComparison.OrdinalIgnoreCase)) continue;
                if (stmt.Contains("Redact.Line", StringComparison.Ordinal)) continue;
                var line = text[..m.Index].Count(c => c == '\n') + 1;
                offenders.Add($"{rel}:{line}");
            }
        }

        Assert.True(offenders.Count == 0,
            "these diagnostics writes do not redact - a bearer token would reach disk in the clear (B-91, §22):\n  " +
            string.Join("\n  ", offenders));
    }

    private static string FindHostDir()
    {
        var d = AppContext.BaseDirectory;
        for (var i = 0; i < 10 && d is not null; i++)
        {
            var candidate = Path.Combine(d, "PrismHost");
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "App.xaml.cs"))) return candidate;
            d = Path.GetDirectoryName(d);
        }
        throw new DirectoryNotFoundException("could not find the PrismHost source tree from " + AppContext.BaseDirectory);
    }
}
