using MediatR;

namespace Aegis.Application.Auth.PasswordReset;

public sealed record ResetPasswordCommand(
    string Email,
    string Otp,
    string NewPassword,
    string? IpAddress) : IRequest;
