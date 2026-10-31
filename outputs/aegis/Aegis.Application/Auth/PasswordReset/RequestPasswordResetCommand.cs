using MediatR;

namespace Aegis.Application.Auth.PasswordReset;

public sealed record RequestPasswordResetCommand(string Email)
    : IRequest<PasswordResetRequestResult>;

public sealed record PasswordResetRequestResult(
    int CodeLength,
    int LifetimeMinutes,
    int ResendCooldownSeconds);
