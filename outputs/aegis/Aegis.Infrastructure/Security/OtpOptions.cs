namespace Aegis.Infrastructure.Security;

public sealed class OtpOptions
{
    public const string SectionName = "Otp";

    public string HashingKey { get; init; } = string.Empty;
    public int CodeLength { get; init; } = 6;
    public int LifetimeMinutes { get; init; } = 5;
    public int ResendCooldownSeconds { get; init; } = 60;
    public int MaxAttempts { get; init; } = 5;
}
