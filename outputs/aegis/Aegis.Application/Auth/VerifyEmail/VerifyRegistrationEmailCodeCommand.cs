using MediatR;

namespace Aegis.Application.Auth.VerifyEmail;

public sealed record VerifyRegistrationEmailCodeCommand(string Email, string Otp) : IRequest;
