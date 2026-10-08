using Aegis.Application.Auth.Login;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Domain.Entities;
using Aegis.Domain.Security;

namespace Aegis.Application.Auth.Refresh;

public class RefreshTokenHasher
{
    private readonly IUnitOfWork _unitOfWork;
    private readonly IRefreshTokenRepository _refreshTokenRepository;
    private readonly ITokenService _tokenService;
    private readonly IUserRepository _userRepository;
    private readonly ISessionRepository _sessionRepository;
    private readonly ITokenLifetimeProvider _tokenLifetimeProvider;

    public RefreshTokenHasher(
        IRefreshTokenRepository refreshTokenRepository,
        ITokenService tokenService,
        IUserRepository userRepository,
        IUnitOfWork unitOfWork,
        ISessionRepository sessionRepository,
        ITokenLifetimeProvider tokenLifetimeProvider)
    {
        _refreshTokenRepository = refreshTokenRepository;
        _tokenService = tokenService;
        _userRepository = userRepository;
        _unitOfWork = unitOfWork;
        _sessionRepository = sessionRepository;
        _tokenLifetimeProvider = tokenLifetimeProvider;
    }

    public async Task<LoginResult> Handler(string refreshToken, string? ip)
    {
        var stored = await _refreshTokenRepository.GetByHashAsync(TokenHasher.HashToken(refreshToken))
            ?? throw new UnauthorizedAccessException("Invalid refresh token");

        if (stored.AbsoluteExpiresAt <= DateTime.UtcNow)
            throw new UnauthorizedAccessException("Refresh token expired");

        if (stored.IsRevoked)
        {
            if (stored.ReplacedByTokenId != null)
            {
                await HandleTokenReuse(stored, ip);
                throw new UnauthorizedAccessException("Token reuse detected");
            }
            throw new UnauthorizedAccessException("Refresh token revoked");
        }

        if (stored.IsExpired())
            throw new UnauthorizedAccessException("Refresh token expired");

        var session = await _sessionRepository.GetByIdAsync(stored.SessionId);
        if (session is null || !session.IsActive)
            throw new UnauthorizedAccessException("Session expired");

        var now = DateTime.UtcNow;
        var sessionExpired =
            now - session.LastActivityAt >= TimeSpan.FromMinutes(_tokenLifetimeProvider.SessionIdleTimeoutMinutes)
            || now - session.CreatedAt >= TimeSpan.FromDays(_tokenLifetimeProvider.SessionAbsoluteLifetimeDays);
        if (sessionExpired)
        {
            session.Revoke();
            await _unitOfWork.SaveChangesAsync();
            throw new UnauthorizedAccessException("Session expired");
        }

        var user = await _userRepository.GetByIdAsync(stored.UserId);
        if (user is null || !user.IsActive || user.IsLocked() || !user.IsEmailVerified)
            throw new UnauthorizedAccessException("User inactive");

        session.Touch();
        var newRefreshTokenValue = _tokenService.GenerateRefreshToken();
        var replacement = new RefreshToken(
            stored.UserId,
            stored.SessionId,
            TokenHasher.HashToken(newRefreshTokenValue),
            now.AddDays(_tokenLifetimeProvider.RefreshTokenSlidingDays),
            stored.AbsoluteExpiresAt,
            ip);

        stored.Revoke(ip, replacement.Id);
        await _refreshTokenRepository.AddAsync(replacement);
        await _unitOfWork.SaveChangesAsync();

        var permissions = await _userRepository.GetPermissionsAsync(stored.UserId);
        var accessToken = _tokenService.CreateAccessToken(stored.UserId, session.Id, permissions);
        return new LoginResult(accessToken, newRefreshTokenValue);
    }

    private async Task HandleTokenReuse(RefreshToken token, string? ip)
    {
        await _refreshTokenRepository.RevokeAllAsync(token.UserId, ip);
        var session = await _sessionRepository.GetByIdAsync(token.SessionId);
        session?.Revoke();
        await _unitOfWork.SaveChangesAsync();
    }
}
