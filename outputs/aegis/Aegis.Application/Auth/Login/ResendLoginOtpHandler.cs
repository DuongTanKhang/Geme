using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Enums;
using MediatR;

namespace Aegis.Application.Auth.Login;

public sealed class ResendLoginOtpHandler : IRequestHandler<ResendLoginOtpCommand, LoginOtpDeliverySettings>
{
    private readonly IUserRepository _userRepository;
    private readonly IOtpService _otpService;

    public ResendLoginOtpHandler(IUserRepository userRepository, IOtpService otpService)
    {
        _userRepository = userRepository;
        _otpService = otpService;
    }

    public async Task<LoginOtpDeliverySettings> Handle(ResendLoginOtpCommand request, CancellationToken cancellationToken)
    {
        var user = await _userRepository.GetByIdAsync(request.UserId);
        if (!user.IsActive || user.IsLocked() || !user.IsEmailVerified)
            throw new UnauthorizedException("Không thể gửi mã xác minh cho tài khoản này.");

        var cooldownSeconds = await _otpService.GenerateAndSendOtpAsync(
            user.Id,
            user.Email,
            user.Name,
            OtpPurpose.Login);

        return new LoginOtpDeliverySettings(_otpService.CodeLength, _otpService.LifetimeMinutes, cooldownSeconds);
    }
}
