using Aegis.Application.Common.Enums;
using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using MediatR;

namespace Aegis.Application.Auth.VerifyEmail;

public sealed class VerifyRegistrationEmailCodeHandler : IRequestHandler<VerifyRegistrationEmailCodeCommand>
{
    private readonly IUserRepository _userRepository;
    private readonly IOtpService _otpService;

    public VerifyRegistrationEmailCodeHandler(IUserRepository userRepository, IOtpService otpService)
    {
        _userRepository = userRepository;
        _otpService = otpService;
    }

    public async Task Handle(VerifyRegistrationEmailCodeCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var user = await _userRepository.GetByEmailAsync(email);
        if (user is null)
            throw new BadRequestException("Mã xác nhận không đúng, đã hết hạn hoặc đã được sử dụng.");
        if (user.IsEmailVerified)
            throw new BadRequestException("Email này đã được xác nhận. Bạn có thể đăng nhập.");

        var result = await _otpService.VerifyAsync(
            user.Id,
            user.Email,
            request.Otp,
            OtpPurpose.RegistrationEmailVerification);

        switch (result)
        {
            case OtpVerificationResult.Valid:
                user.MarkEmailVerified();
                await _userRepository.UpdateAsync(user);
                return;
            case OtpVerificationResult.Invalid:
                throw new BadRequestException("Mã xác nhận không đúng. Vui lòng kiểm tra lại.");
            case OtpVerificationResult.AttemptsExceeded:
                throw new BadRequestException("Bạn đã nhập sai mã quá số lần cho phép. Hãy gửi lại mã để thử lại.");
            default:
                throw new BadRequestException("Mã xác nhận đã hết hạn hoặc đã được sử dụng. Hãy gửi lại mã mới.");
        }
    }
}
