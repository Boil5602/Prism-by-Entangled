using System.Text.RegularExpressions;

namespace PrismHost.Diagnostics;

/// <summary>
/// Secret redaction for anything the host writes to disk (B-91, dashboard-schema
/// §22).
///
/// The host's diagnostics tap records every host→core call with its arguments,
/// and §6 remote requests arrive as <c>PrismRuntime.http(requestId,
/// requestJson)</c> — so a paired phone's BEARER TOKEN was landing in
/// <c>host.log</c> in plain text. The file never leaves the device and is never
/// transmitted, but §22's inventory is "no identifiers, ever", and a bearer
/// token on disk is a credential a support bundle, a screenshot or a shared log
/// would carry straight out of the house.
///
/// **Redaction happens at WRITE TIME, never as a later scrub.** A scrub pass
/// implies the secret was on disk first, and a log that is cleaned afterwards
/// is a log that was wrong until someone remembered. Every sink calls
/// <see cref="Line"/> before the text is written, so the plaintext never exists
/// in a file at all.
///
/// What is redacted, in the shapes the host actually produces:
///   - a JSON field named token / bearer / authorization / auth / secret /
///     password / ticket / apiKey (case-insensitive, with or without spaces)
///   - an Authorization header value, "Bearer x" or "Basic x"
///   - a `token=` / `ticket=` query parameter in a URL or path
///   - a bare 32+ hex-character run, which is what randomToken() mints — the
///     catch-all for a token that reaches a log by some shape not listed above
///
/// It is deliberately blunt: over-redacting a diagnostics line costs a support
/// session some context, while under-redacting costs a credential.
/// </summary>
public static class Redact
{
    /// <summary>What replaces a secret. Distinctive, so a reader knows redaction ran rather than the field being empty.</summary>
    public const string Mask = "[redacted]";

    private static readonly RegexOptions Opts = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled;

    /// <summary>`"token": "abc"` / `"authorization":"Bearer abc"` — the JSON the channel carries.</summary>
    private static readonly Regex JsonField = new(
        "(\"(?:token|bearer|authorization|auth|secret|password|passwd|apikey|api_key|ticket)\"\\s*:\\s*)\"[^\"]*\"", Opts);

    /// <summary>A header line or value: `Authorization: Bearer abc`.</summary>
    private static readonly Regex HeaderValue = new(
        "((?:authorization|proxy-authorization)\\s*[:=]\\s*)(?:bearer|basic|token)?\\s*[A-Za-z0-9._~+/=-]+", Opts);

    /// <summary>`?token=abc` / `&amp;ticket=abc` in a URL or a path.</summary>
    private static readonly Regex QueryParam = new(
        "([?&](?:token|ticket|auth|key)=)[^&\\s\"']+", Opts);

    /// <summary>A bare token literal: what randomToken() mints is 32 hex characters.</summary>
    private static readonly Regex BareHex = new("\\b[0-9a-f]{32,}\\b", Opts);

    /// <summary>
    /// Redact one line before it is written. Never throws: a diagnostics line
    /// is not worth an exception, and a redactor that can fail is a redactor
    /// that gets wrapped in a try/catch that swallows the redaction too.
    /// </summary>
    public static string Line(string? text)
    {
        if (string.IsNullOrEmpty(text)) return text ?? "";
        try
        {
            var s = JsonField.Replace(text, "$1\"" + Mask + "\"");
            s = HeaderValue.Replace(s, "$1" + Mask);
            s = QueryParam.Replace(s, "$1" + Mask);
            s = BareHex.Replace(s, Mask);
            return s;
        }
        catch
        {
            // A regex that somehow failed must not leak the raw line: drop the
            // content rather than write an unredacted one.
            return Mask;
        }
    }

    /// <summary>
    /// True when <paramref name="text"/> still contains <paramref name="secret"/>.
    /// The conformance check's assertion, kept here so the test and the sink
    /// agree on what "leaked" means.
    /// </summary>
    public static bool Leaks(string? text, string? secret)
        => !string.IsNullOrEmpty(secret) && (text ?? "").Contains(secret!, StringComparison.Ordinal);
}
