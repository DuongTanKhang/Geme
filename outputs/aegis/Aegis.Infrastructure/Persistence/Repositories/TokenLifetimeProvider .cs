using Aegis.Application.Common.Interfaces;
using Aegis.Infrastructure.Jwt;
using Microsoft.Extensions.Options;

namespace Aegis.Infrastructure.Persistence.Repositories;

public class TokenLifetimeProvider : ITokenLifetimeProvider
{
    private readonly JwtOptions _options;
    public TokenLifetimeProvider(IOptions<JwtOptions> options) => _options = options.Value;

    public int AccessTokenLifetimeMinutes => Math.Max(1, _options.AccessTokenLifetimeMinutes);
    public int RefreshTokenSlidingDays => Math.Max(1, _options.RefreshTokenSlidingDays);
    public int RefreshTokenAbsoluteDays => Math.Max(RefreshTokenSlidingDays, _options.RefreshTokenAbsoluteDays);
    public int SessionIdleTimeoutMinutes => Math.Max(1, _options.SessionIdleTimeoutMinutes);
    public int SessionAbsoluteLifetimeDays => Math.Max(1, _options.SessionAbsoluteLifetimeDays);
}
