using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Domain.Entities;
using Aegis.Domain.Enums;
using Aegis.Domain.Security;
using System.Text;

namespace Aegis.Application.Auth.Login;

public class LoginHandle
{
    private readonly IPasswordHasher _passwordHasher;
    private readonly ITokenService _tokenService;
    private readonly IUserRepository _userRepository;
    private readonly IRefreshTokenRepository _refreshTokenRepository;
    private readonly ISecurityAuditRepository _securityAuditRepository;
    private readonly ISessionRepository _sessionRepository;
    private readonly ITokenLifetimeProvider _tokenLifetimeProvider;
    private readonly IDeviceService _deviceService;

    public LoginHandle(
        IPasswordHasher passwordHasher,
        ITokenService tokenService,
        IUserRepository userRepository,
        IRefreshTokenRepository refreshTokenRepository,
        ISecurityAuditRepository securityAuditRepository,
        ISessionRepository sessionRepository,
        ITokenLifetimeProvider tokenLifetimeProvider,
        IDeviceService deviceService)
    {
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
        _userRepository = userRepository;
        _refreshTokenRepository = refreshTokenRepository;
        _securityAuditRepository = securityAuditRepository;
        _sessionRepository = sessionRepository;
        _tokenLifetimeProvider = tokenLifetimeProvider;
        _deviceService = deviceService;
    }

    public async Task<LoginResult> Handle(
        string email,
        string password,
        string? ip,
        string? userAgent,
        string deviceName)
    {
        var user = await _userRepository.GetByEmailAsync(email);
        if (user is null || !user.IsActive || user.IsLocked())
        {
            await _securityAuditRepository.AddAsync(user?.Id,
                SecurityAuditAction.LoginFailed, ip);
            throw new UnauthorizedException("Email hoặc mật khẩu không đúng");
        }

        if (!_passwordHasher.Verify(password, Encoding.UTF8.GetString(user.PasswordHash)))
        {
            user.RecordFailedLogin(5, TimeSpan.FromMinutes(15));
            await _securityAuditRepository.AddAsync(
                user.Id,
                SecurityAuditAction.LoginFailed,
                ip);
            throw new UnauthorizedException("Email hoặc mật khẩu không đúng");
        }

        if (!user.IsEmailVerified)
        {
            await _securityAuditRepository.AddAsync(user.Id, SecurityAuditAction.LoginFailed, ip);
            throw new UnauthorizedException("Vui lòng xác minh email trước khi đăng nhập.");
        }

        user.ResetFailedLogins();
        var deviceId = _deviceService.GetDeviceId();
        var permissions = await _userRepository.GetPermissionsAsync(user.Id);
        var session = new Session(user.Id, deviceName, userAgent, ip);
        await _sessionRepository.AddAsync(session);

        var accessToken = _tokenService.CreateAccessToken(user.Id, session.Id, permissions);
        var refreshTokenValue = _tokenService.GenerateRefreshToken();
        var now = DateTime.UtcNow;
        var refreshToken = new RefreshToken(
            user.Id,
            session.Id,
            TokenHasher.HashToken(refreshTokenValue),
            now.AddDays(_tokenLifetimeProvider.RefreshTokenSlidingDays),
            now.AddDays(_tokenLifetimeProvider.RefreshTokenAbsoluteDays),
            ip);

        await _refreshTokenRepository.AddAsync(refreshToken);
        await _securityAuditRepository.AddAsync(user.Id, SecurityAuditAction.LoginSuccess, ip);

        return LoginResult.Success(accessToken, refreshTokenValue, deviceId!);
    }
}
