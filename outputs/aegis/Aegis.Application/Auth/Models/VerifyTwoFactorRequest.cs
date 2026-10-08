namespace Aegis.Application.Auth.Models;

public sealed record VerifyTwoFactorRequest(Guid UserId, string Otp);
