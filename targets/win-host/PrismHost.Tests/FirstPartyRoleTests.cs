using PrismHost.Core;
using Xunit;

namespace PrismHost.Tests;

/// <summary>
/// docs/concept-scenes.md §1, "first-party roles pre-resolve". The wizard
/// pre-fills a Scene Template role only when the household has nothing to
/// decide: exactly one suggestion, and that App has nothing to sign in to
/// (catalog `account: "none"`). Family Hub's six roles then cost four
/// decisions, not six.
///
/// The narrowness is the point — these tests pin the cases where the wizard
/// must still ask, because pre-filling a role that had a real choice, or
/// claiming an App is set up when it can be signed into, are both worse than
/// one extra question.
/// </summary>
public sealed class FirstPartyRoleTests
{
    private const string NoAccount = """{"id":"prism-chores","name":"Chores & notes","account":"none"}""";
    private const string Account = """{"id":"hulu","name":"Hulu","account":"required"}""";
    private const string Silent = """{"id":"weather","name":"Weather"}""";

    [Fact]
    public void a_single_first_party_suggestion_is_prefilled()
    {
        Assert.True(FirstPartyRole.IsPreresolvable(new[] { "prism-chores" }, NoAccount));
    }

    [Fact]
    public void a_real_choice_is_always_asked_about()
    {
        // two suggestions = the household picks, even if both need no account
        Assert.False(FirstPartyRole.IsPreresolvable(new[] { "prism-chores", "prism-timer" }, NoAccount));
        Assert.False(FirstPartyRole.IsPreresolvable(Array.Empty<string>(), NoAccount));
    }

    [Fact]
    public void an_app_that_can_be_signed_into_is_never_prefilled()
    {
        Assert.False(FirstPartyRole.IsPreresolvable(new[] { "hulu" }, Account));
        Assert.False(FirstPartyRole.IsPreresolvable(new[] { "weather" }, Silent));   // silence is not "no account"
    }

    [Theory]
    [InlineData("none", true)]
    [InlineData("NONE", true)]          // the catalog is data written by hand; case is not a signal
    [InlineData("optional", false)]
    [InlineData("required", false)]
    public void account_none_is_the_only_marker(string account, bool expected)
    {
        Assert.Equal(expected, FirstPartyRole.NoAccount($$"""{"id":"x","account":"{{account}}"}"""));
    }

    [Fact]
    public void an_unreadable_or_missing_entry_is_not_first_party()
    {
        Assert.False(FirstPartyRole.NoAccount(null));
        Assert.False(FirstPartyRole.NoAccount(""));
        Assert.False(FirstPartyRole.NoAccount("{ not json"));
        Assert.False(FirstPartyRole.NoAccount("""{"account":true}"""));   // wrong type, not a string
        Assert.False(FirstPartyRole.IsPreresolvable(new[] { "" }, NoAccount));
    }
}
