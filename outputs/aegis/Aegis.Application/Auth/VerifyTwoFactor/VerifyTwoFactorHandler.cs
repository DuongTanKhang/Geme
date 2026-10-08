using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Domain.Entities;
using Aegis.Domain.Enums;
using Aegis.Domain.Security;
using MediatR;

namespace Aegis.Application.Auth.VerifyTwoFactor;

public class VerifyTwoFactorHandler : IRequestHandler<VerifyTwoFactorCommand, VerifyTwoFactorResult>
{
    private readonly IOtpService _otpService;
    private readonly IUserRepository _userRepository;
    private readonly ITrustedDeviceRepository _trustedDeviceRepository;
    private readonly IDeviceService _deviceService;
    private readonly ITokenService _tokenService;
    private readonly IRefreshTokenRepository _refreshTokenRepository;
    private readonly ISessionRepository _sessionRepository;
    private readonly ITokenLifetimeProvider _tokenLifetimeProvider;
    private readonly ISecurityAuditRepository _securityAuditRepository;
    private readonly IUnitOfWork _unitOfWork;

    public VerifyTwoFactorHandler(
        IOtpService otpService,
        IUserRepository userRepository,
        ITrustedDeviceRepository trustedDeviceRepository,
        IDeviceService deviceService,
        ISessionRepository sessionRepository,
        ITokenService tokenService,
        IRefreshTokenRepository refreshTokenRepository,
        ITokenLifetimeProvider tokenLifetimeProvider,
        ISecurityAuditRepository securityAuditRepository,
        IUnitOfWork unitOfWork)
    {
        _otpService = otpService;
        _userRepository = userRepository;
        _trustedDeviceRepository = trustedDeviceRepository;
        _deviceService = deviceService;
        _tokenService = tokenService;
        _refreshTokenRepository = refreshTokenRepository;
        _sessionRepository = sessionRepository;
        _tokenLifetimeProvider = tokenLifetimeProvider;
        _securityAuditRepository = securityAuditRepository;
        _unitOfWork = unitOfWork;
    }

    public async Task<VerifyTwoFactorResult> Handle(
        VerifyTwoFactorCommand request,
        CancellationToken cancellationToken)
    {
        var user = await _userRepository.GetByIdAsync(request.UserId)
            ?? throw new UnauthorizedException("Email hoặc mật khẩu không đúng");

        if (!user.IsActive || user.IsLocked() || !user.IsEmailVerified)
            throw new UnauthorizedException("Email hoặc mật khẩu không đúng");

        var otpResult = await _otpService.VerifyAsync(user.Id, user.Email, request.Otp);
        if (otpResult != Aegis.Application.Common.Enums.OtpVerificationResult.Valid)
        {
            await _securityAuditRepository.AddAsync(
                user.Id,
                SecurityAuditAction.TwoFactorFailed,
                request.Ip);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
            throw new UnauthorizedException("OTP không hợp lệ");
        }

        var deviceId = _deviceService.GetDeviceId();
        if (string.IsNullOrWhiteSpace(deviceId))
            deviceId = Guid.NewGuid().ToString();

        var trustedDevice = new TrustedDevice(
            user.Id,
            deviceId,
            request.DeviceName,
            request.Ip,
            request.UserAgent,
            DateTime.UtcNow.AddDays(30));
        await _trustedDeviceRepository.AddAsync(trustedDevice);

        var session = new Session(user.Id, request.DeviceName, request.UserAgent, request.Ip);
        await _sessionRepository.AddAsync(session);

        var permissions = await _userRepository.GetPermissionsAsync(user.Id);
        var accessToken = _tokenService.CreateAccessToken(user.Id, session.Id, permissions);
        var refreshTokenValue = _tokenService.GenerateRefreshToken();
        var now = DateTime.UtcNow;
        var refreshToken = new RefreshToken(
            user.Id,
            session.Id,
            TokenHasher.HashToken(refreshTokenValue),
            now.AddDays(_tokenLifetimeProvider.RefreshTokenSlidingDays),
            now.AddDays(_tokenLifetimeProvider.RefreshTokenAbsoluteDays),
            request.Ip);

        await _refreshTokenRepository.AddAsync(refreshToken);
        await _securityAuditRepository.AddAsync(user.Id, SecurityAuditAction.TwoFactorSucceeded, request.Ip);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return new VerifyTwoFactorResult(accessToken, refreshTokenValue, deviceId);
    }
}
