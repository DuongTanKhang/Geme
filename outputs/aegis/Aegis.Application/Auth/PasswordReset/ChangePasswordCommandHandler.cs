using System.Text;
using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Domain.Enums;
using MediatR;

namespace Aegis.Application.Auth.PasswordReset;

public sealed class ChangePasswordCommandHandler : IRequestHandler<ChangePasswordCommand>
{
    private readonly IUserRepository _userRepository;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IRefreshTokenRepository _refreshTokenRepository;
    private readonly ISessionRepository _sessionRepository;
    private readonly ISecurityAuditRepository _securityAuditRepository;

    public ChangePasswordCommandHandler(
        IUserRepository userRepository,
        IPasswordHasher passwordHasher,
        IRefreshTokenRepository refreshTokenRepository,
        ISessionRepository sessionRepository,
        ISecurityAuditRepository securityAuditRepository)
    {
        _userRepository = userRepository;
        _passwordHasher = passwordHasher;
        _refreshTokenRepository = refreshTokenRepository;
        _sessionRepository = sessionRepository;
        _securityAuditRepository = securityAuditRepository;
    }

    public async Task Handle(ChangePasswordCommand request, CancellationToken cancellationToken)
    {
        var user = await _userRepository.GetByIdAsync(request.UserId);
        if (user is null || !user.IsActive || !user.IsEmailVerified)
            throw new UnauthorizedException("Tài khoản không thể đổi mật khẩu.");

        var currentHash = Encoding.UTF8.GetString(user.PasswordHash);
        if (!_passwordHasher.Verify(request.CurrentPassword, currentHash))
        {
            await _securityAuditRepository.AddAsync(user.Id, SecurityAuditAction.PasswordChangeFailed, request.IpAddress);
            throw new UnauthorizedException("Mật khẩu hiện tại không đúng.");
        }

        if (_passwordHasher.Verify(request.NewPassword, currentHash))
            throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");

        user.ResetPassword(Encoding.UTF8.GetBytes(_passwordHasher.Hash(request.NewPassword)));
        await _userRepository.UpdateAsync(user);

        // Changing a password invalidates every device session and refresh credential.
        await _refreshTokenRepository.RevokeAllAsync(user.Id, request.IpAddress);
        await _sessionRepository.RevokeAllByUserId(user.Id);
        await _securityAuditRepository.AddAsync(user.Id, SecurityAuditAction.PasswordChangeSucceeded, request.IpAddress);
    }
}
