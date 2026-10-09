using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Infrastructure.Jwt;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;

namespace Aegis.Infrastructure.Middlewares;

public class SessionValidationMiddleware
{
    private readonly RequestDelegate _next;
    public SessionValidationMiddleware(RequestDelegate next) => _next = next;

    public async Task Invoke(
        HttpContext context,
        ISessionRepository repo,
        IUserRepository userRepository,
        IUnitOfWork unitOfWork,
        Microsoft.Extensions.Options.IOptions<JwtOptions> options,
        IMemoryCache memoryCache)
    {
        var sid = context.User.FindFirst("sid")?.Value;
        if (sid is not null && Guid.TryParse(sid, out var sessionId))
        {
            var sub = context.User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value
                ?? context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            var hasUserId = Guid.TryParse(sub, out var userId);
            var cacheKey = hasUserId ? $"session-valid:{sessionId}:{userId}" : null;
            if (cacheKey is not null && memoryCache.TryGetValue<bool>(cacheKey, out var stillValid) && stillValid)
            {
                await _next(context);
                return;
            }

            var session = await repo.GetByIdAsync(sessionId);
            var settings = options.Value;
            var now = DateTime.UtcNow;
            var expired = session is null
                || session.IsRevoked
                || now - session.LastActivityAt >= TimeSpan.FromMinutes(Math.Max(1, settings.SessionIdleTimeoutMinutes))
                || now - session.CreatedAt >= TimeSpan.FromDays(Math.Max(1, settings.SessionAbsoluteLifetimeDays));

            if (!expired && hasUserId)
            {
                var user = await userRepository.GetByIdAsync(userId);
                expired = user is null || !user.IsActive || !user.IsEmailVerified || user.IsLocked();
            }

            if (expired)
            {
                if (session is not null && !session.IsRevoked)
                {
                    session.Revoke();
                    await repo.UpdateAsync(session);
                    await unitOfWork.SaveChangesAsync(context.RequestAborted);
                }

                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                await context.Response.WriteAsync("Session expired", context.RequestAborted);
                return;
            }

            if (cacheKey is not null)
                memoryCache.Set(cacheKey, true, TimeSpan.FromSeconds(2));

            if (now - session!.LastActivityAt >= TimeSpan.FromMinutes(1))
            {
                session.Touch();
                await repo.UpdateAsync(session);
                await unitOfWork.SaveChangesAsync(context.RequestAborted);
            }
        }

        await _next(context);
    }
}
