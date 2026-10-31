using System.Text;
using Aegis.Application.Common.Enums;
using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Domain.Enums;
using MediatR;

namespace Aegis.Application.Auth.PasswordReset;

public sealed class ResetPasswordCommandHandler : IRequestHandler<ResetPasswordCommand>
{
    private const string InvalidCodeMessage = "Mã xác nhận không đúng, đã hết hạn hoặc đã được sử dụng.";

    private readonly IUserRepository _userRepository;
    private readonly IOtpService _otpService;
    private readonly IPasswordHasher _passwordHasher;
    private readonly ISessionRepository _sessionRepository;
    private readonly ISecurityAuditRepository _securityAuditRepository;

    public ResetPasswordCommandHandler(
        IUserRepository userRepository,
        IOtpService otpService,
        IPasswordHasher passwordHasher,
        ISessionRepository sessionRepository,
        ISecurityAuditRepository securityAuditRepository)
    {
        _userRepository = userRepository;
        _otpService = otpService;
        _passwordHasher = passwordHasher;
        _sessionRepository = sessionRepository;
        _securityAuditRepository = securityAuditRepository;
    }

    public async Task Handle(ResetPasswordCommand request, CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var user = await _userRepository.GetByEmailAsync(email);
        if (user is null || !user.IsActive || !user.IsEmailVerified)
            throw new BadRequestException(InvalidCodeMessage);

        var verification = await _otpService.VerifyAsync(
            user.Id,
            user.Email,
            request.Otp,
            OtpPurpose.PasswordReset);

        if (verification != OtpVerificationResult.Valid)
        {
            await _securityAuditRepository.AddAsync(
                user.Id,
                SecurityAuditAction.PasswordResetFailed,
                request.IpAddress);

            throw new BadRequestException(InvalidCodeMessage);
        }

        var passwordHash = Encoding.UTF8.GetBytes(_passwordHasher.Hash(request.NewPassword));
        user.ResetPassword(passwordHash);
        await _userRepository.UpdateAsync(user);

        // A password recovery invalidates every existing browser/device session.
        await _sessionRepository.RevokeAllByUserId(user.Id);
        await _securityAuditRepository.AddAsync(
            user.Id,
            SecurityAuditAction.PasswordResetSucceeded,
            request.IpAddress);
    }
}
