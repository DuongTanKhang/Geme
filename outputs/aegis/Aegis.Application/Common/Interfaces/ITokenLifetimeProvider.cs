namespace Aegis.Application.Common.Interfaces;

public interface ITokenLifetimeProvider
{
    int AccessTokenLifetimeMinutes { get; }
    int RefreshTokenSlidingDays { get; }
    int RefreshTokenAbsoluteDays { get; }
    int SessionIdleTimeoutMinutes { get; }
    int SessionAbsoluteLifetimeDays { get; }
}
