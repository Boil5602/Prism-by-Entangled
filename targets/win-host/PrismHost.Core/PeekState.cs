namespace PrismHost.Surfaces;

/// <summary>
/// §25 living previews, host side (dashboard-schema §25, docs/concept-scenes.md §4).
///
/// Core brackets each peek with <c>surface.setPeek(id, true/false)</c> and drives
/// the ordinary seam ops in between — resume → navigate → reveal → freeze →
/// suspend. Two rules the shell must hold across that bracket, and they are the
/// whole of this class:
///
/// 1. <b>Never more than one.</b> Peak cost is exactly one extra renderer
///    (§18 budget). Core serializes peeks, but the host refuses a second
///    concurrent peek rather than trusting it — a second begin is reported.
/// 2. <b>No white frames (§16).</b> A peek's revival is hidden behind its own
///    still. The still may only be REPLACED by pixels that actually reached
///    readiness, i.e. after the reveal for this peek. A freeze arriving from
///    the <c>PEEK_TIMEOUT_MS</c> abort has never revealed, so the last good
///    still is kept rather than a half-loaded page captured over it.
///
/// Pure and headless so PrismHost.Tests can pin it.
/// </summary>
public sealed class PeekState
{
    private string? _peeking;
    private bool _revealed;

    /// <summary>The surface currently mid-peek, or null.</summary>
    public string? Peeking => _peeking;

    public bool IsPeeking(string id) => _peeking == id;

    /// <summary>
    /// Core says a peek starts on <paramref name="id"/>. False when another
    /// peek is already in flight (§18: never two) — the caller reports it as
    /// drift and leaves the running peek alone.
    /// </summary>
    public bool Begin(string id)
    {
        if (_peeking is not null && _peeking != id) return false;
        _peeking = id;
        _revealed = false;
        return true;
    }

    /// <summary>Core says this peek is over (captured, or abandoned).</summary>
    public void End(string id)
    {
        if (_peeking != id) return;
        _peeking = null;
        _revealed = false;
    }

    /// <summary>
    /// The §16 crossfade ran for this surface: fresh pixels reached readiness,
    /// so a capture of them is a legitimate new still.
    /// </summary>
    public void NoteReveal(string id)
    {
        if (_peeking == id) _revealed = true;
    }

    /// <summary>
    /// May a freeze of this surface replace its stored still? Always yes
    /// outside a peek (that is §18's ordinary demotion, whose pixels are the
    /// ones on the wall). During a peek, only after the reveal — the abort
    /// path keeps the last still.
    /// </summary>
    public bool MayReplaceStill(string id) => _peeking != id || _revealed;
}
