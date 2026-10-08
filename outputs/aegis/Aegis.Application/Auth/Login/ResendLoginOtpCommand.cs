using MediatR;

namespace Aegis.Application.Auth.Login;

public sealed record ResendLoginOtpCommand(Guid UserId) : IRequest<LoginOtpDeliverySettings>;
public sealed record LoginOtpDeliverySettings(int CodeLength, int LifetimeMinutes, int ResendCooldownSeconds);
