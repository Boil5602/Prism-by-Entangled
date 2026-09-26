using PrismHost.Surfaces;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// §25 living previews as the host must hold them (dashboard-schema §25,
/// docs/concept-scenes.md §4): one extra renderer at a time, and never a
/// blank where a good still was.
/// </summary>
public sealed class PeekStateTests
{
    [Fact]
    public void OutsideAPeekNothingChanges()
    {
        var peek = new PeekState();
        Assert.Null(peek.Peeking);
        Assert.False(peek.IsPeeking("game2"));
        // §18's ordinary demotion captures the pixels that are on the wall
        Assert.True(peek.MayReplaceStill("game2"));
    }

    [Fact]
    public void ASecondConcurrentPeekIsRefused()
    {
        var peek = new PeekState();
        Assert.True(peek.Begin("game2"));
        Assert.False(peek.Begin("game3"));       // §18: peak cost is exactly one extra renderer
        Assert.Equal("game2", peek.Peeking);
        peek.End("game2");
        Assert.True(peek.Begin("game3"));
    }

    [Fact]
    public void AnAbortedPeekKeepsTheLastStill()
    {
        var peek = new PeekState();
        peek.Begin("game2");
        // no reveal: the revival never reached readiness (PEEK_TIMEOUT_MS)
        Assert.False(peek.MayReplaceStill("game2"));
        // and only for the surface actually peeking
        Assert.True(peek.MayReplaceStill("game3"));
    }

    [Fact]
    public void ACapturedPeekReplacesTheStill()
    {
        var peek = new PeekState();
        peek.Begin("game2");
        peek.NoteReveal("game2");                // §16 crossfade ran: fresh pixels are real
        Assert.True(peek.MayReplaceStill("game2"));
        peek.End("game2");
        Assert.True(peek.MayReplaceStill("game2"));
    }

    [Fact]
    public void AnUnrelatedRevealDoesNotUnlockThePeeksCapture()
    {
        var peek = new PeekState();
        peek.Begin("game2");
        peek.NoteReveal("game3");                // a different surface crossfaded
        Assert.False(peek.MayReplaceStill("game2"));
    }

    [Fact]
    public void EndingSomeoneElsesPeekLeavesTheRunningOneAlone()
    {
        var peek = new PeekState();
        peek.Begin("game2");
        peek.End("game3");
        Assert.Equal("game2", peek.Peeking);
    }

    [Fact]
    public void ARepeatedBeginRestartsTheSameSurfacesBracket()
    {
        var peek = new PeekState();
        peek.Begin("game2");
        peek.NoteReveal("game2");
        Assert.True(peek.Begin("game2"));        // core re-opened the bracket
        Assert.False(peek.MayReplaceStill("game2"));   // the previous reveal does not carry over
    }
}
