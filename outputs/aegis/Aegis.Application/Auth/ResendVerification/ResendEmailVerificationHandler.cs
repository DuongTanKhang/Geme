using Aegis.Application.Common.Enums;
using Aegis.Application.Common.Interfaces;
using MediatR;

namespace Aegis.Application.Auth.ResendVerification;

public sealed class ResendEmailVerificationHandler : IRequestHandler<ResendEmailVerificationCommand, ResendEmailVerificationResult>
{
    private readonly IUserRepository _userRepository;
    private readonly IOtpService _otpService;

    public ResendEmailVerificationHandler(
        IUserRepository userRepository,
        IOtpService otpService)
    {
        _userRepository = userRepository;
        _otpService = otpService;
    }

    public async Task<ResendEmailVerificationResult> Handle(
        ResendEmailVerificationCommand request,
        CancellationToken cancellationToken)
    {
        var user = await _userRepository.GetByEmailAsync(request.Email.Trim().ToLowerInvariant());
        if (user is not null && !user.IsEmailVerified)
        {
            await _otpService.GenerateAndSendOtpAsync(
                user.Id,
                user.Email,
                user.Name,
                OtpPurpose.RegistrationEmailVerification);
        }

        return new ResendEmailVerificationResult(
            _otpService.CodeLength,
            _otpService.LifetimeMinutes,
            _otpService.ResendCooldownSeconds);
    }
}
