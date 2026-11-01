using MediatR;

namespace Aegis.Application.Auth.PasswordReset;

public sealed record ChangePasswordCommand(
    Guid UserId,
    string CurrentPassword,
    string NewPassword,
    string? IpAddress) : IRequest;
