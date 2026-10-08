namespace Aegis.Infrastructure.Security;

public sealed class PasswordHashingOptions
{
    public const string SectionName = "PasswordHashing";

    // OWASP's minimum bcrypt work factor is 10; higher factors can be set per host.
    public int WorkFactor { get; init; } = 10;

    public int EffectiveWorkFactor => Math.Clamp(WorkFactor, 10, 16);
}
