using PrismHost.Core;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// docs/concept-scenes.md §7a, the wizard's half of core's
/// <c>templateCompletion</c>. These pin the rule that makes Music Lounge one
/// decision: hidden roles are counted, a visualization role is answered by its
/// source and is never a question of its own, and the Create button agrees
/// with core's own refusal (otherwise the household is told "every role is
/// resolved" and then handed an error from instantiateTemplate).
/// </summary>
public sealed class TemplateRolesTests
{
    private static readonly TemplateRoleRef Stage = new("stage", "visualization", "source");
    private static readonly TemplateRoleRef Source = new("source", "music", null);
    private static readonly TemplateRoleRef Clock = new("clock", "utility", null);

    private static IReadOnlyList<TemplateRoleRef> Lounge => new[] { Stage, Source };
    private static IReadOnlyList<TemplateRoleRef> LoungeClock => new[] { Stage, Clock, Source };

    [Fact]
    public void music_lounge_is_one_question_and_it_is_the_service()
    {
        Assert.Equal(new[] { "source" }, TemplateRoles.Unresolved(Lounge, Array.Empty<string>()));
        Assert.False(TemplateRoles.IsComplete(Lounge, Array.Empty<string>()));
        Assert.Empty(TemplateRoles.Unresolved(Lounge, new[] { "source" }));
        Assert.True(TemplateRoles.IsComplete(Lounge, new[] { "source" }));
    }

    [Fact]
    public void the_stage_shows_resolved_the_moment_the_source_is()
    {
        Assert.False(TemplateRoles.IsResolved(Stage, Array.Empty<string>()));
        Assert.True(TemplateRoles.IsResolved(Stage, new[] { "source" }));
        Assert.True(TemplateRoles.IsResolved(Source, new[] { "source" }));
        // resolving the stage id itself means nothing: it is not a facet question
        Assert.False(TemplateRoles.IsResolved(Stage, new[] { "stage" }));
    }

    [Fact]
    public void the_clock_variant_is_two_questions_in_blueprint_order()
    {
        Assert.Equal(new[] { "clock", "source" }, TemplateRoles.Unresolved(LoungeClock, Array.Empty<string>()));
        Assert.Equal(new[] { "source" }, TemplateRoles.Unresolved(LoungeClock, new[] { "clock" }));
        Assert.True(TemplateRoles.IsComplete(LoungeClock, new[] { "clock", "source" }));
    }

    [Fact]
    public void a_visualization_with_nothing_to_source_from_reports_itself()
    {
        var orphan = new[] { Stage };                                  // the hidden role is gone
        Assert.Equal(new[] { "stage" }, TemplateRoles.Unresolved(orphan, Array.Empty<string>()));
        Assert.True(TemplateRoles.IsComplete(orphan, new[] { "source" }));   // resolved anyway: taken at its word
        var blockless = new[] { new TemplateRoleRef("stage", "visualization", null) };
        Assert.Equal(new[] { "stage" }, TemplateRoles.Unresolved(blockless, new[] { "source" }));
    }

    [Fact]
    public void the_templates_that_shipped_before_7a_are_unaffected()
    {
        var kitchen = new[]
        {
            new TemplateRoleRef("hero", "video-hero", null), new TemplateRoleRef("weather", "utility", null),
            new TemplateRoleRef("agenda", "utility", null), new TemplateRoleRef("chores", "utility", null),
            new TemplateRoleRef("ticker", "news", null),
        };
        Assert.Equal(new[] { "hero", "weather", "agenda", "chores", "ticker" }, TemplateRoles.Unresolved(kitchen, Array.Empty<string>()));
        Assert.Equal(new[] { "hero", "ticker" }, TemplateRoles.Unresolved(kitchen, new[] { "weather", "agenda", "chores" }));
        Assert.True(TemplateRoles.IsComplete(kitchen, new[] { "hero", "weather", "agenda", "chores", "ticker" }));
    }

    [Fact]
    public void a_hidden_music_role_is_never_preresolved()
    {
        Assert.True(TemplateRoles.NeverPreresolved("music"));
        Assert.True(TemplateRoles.NeverPreresolved("visualization"));
        Assert.False(TemplateRoles.NeverPreresolved("utility"));   // prism-timer's clock still pre-fills (§1)
        Assert.False(TemplateRoles.NeverPreresolved("video-hero"));
        Assert.False(TemplateRoles.NeverPreresolved(null));
    }

    [Fact]
    public void nothing_here_throws_on_nothing()
    {
        Assert.Empty(TemplateRoles.Unresolved(null, null));
        Assert.True(TemplateRoles.IsComplete(null, null));
        Assert.False(TemplateRoles.IsResolved(null, new[] { "source" }));
        Assert.False(TemplateRoles.IsResolved(Source, null));
    }
}
