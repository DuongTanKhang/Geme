namespace Aegis.Infrastructure.Jwt;

public sealed class JwtOptions
{
    public int AccessTokenLifetimeMinutes { get; set; } = 15;
    public int RefreshTokenSlidingDays { get; set; } = 7;
    public int RefreshTokenAbsoluteDays { get; set; } = 30;
    public int SessionIdleTimeoutMinutes { get; set; } = 30;
    public int SessionAbsoluteLifetimeDays { get; set; } = 30;
}
