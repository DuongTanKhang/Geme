using Aegis.Application.Common.Enums;
using Aegis.Application.Common.Interfaces;
using MediatR;
using Microsoft.Extensions.Logging;

namespace Aegis.Application.Auth.PasswordReset;

public sealed class RequestPasswordResetCommandHandler
    : IRequestHandler<RequestPasswordResetCommand, PasswordResetRequestResult>
{
    private readonly IUserRepository _userRepository;
    private readonly IOtpService _otpService;
    private readonly ILogger<RequestPasswordResetCommandHandler> _logger;

    public RequestPasswordResetCommandHandler(
        IUserRepository userRepository,
        IOtpService otpService,
        ILogger<RequestPasswordResetCommandHandler> logger)
    {
        _userRepository = userRepository;
        _otpService = otpService;
        _logger = logger;
    }

    public async Task<PasswordResetRequestResult> Handle(
        RequestPasswordResetCommand request,
        CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var user = await _userRepository.GetByEmailAsync(email);

        if (user is not null && user.IsActive && user.IsEmailVerified)
        {
            try
            {
                await _otpService.GenerateAndSendOtpAsync(
                    user.Id,
                    user.Email,
                    user.Name,
                    OtpPurpose.PasswordReset);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // Keep the public response identical for existing and unknown emails.
                // The queue worker logs delivery failures without exposing OTPs.
                _logger.LogWarning(exception,
                    "Could not queue a password reset email for user {UserId}.", user.Id);
            }
        }

        return new PasswordResetRequestResult(
            _otpService.CodeLength,
            _otpService.LifetimeMinutes,
            _otpService.ResendCooldownSeconds);
    }
}
