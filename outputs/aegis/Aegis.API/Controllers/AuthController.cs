using Aegis.Application.Auth.Login;
using Aegis.Application.Auth.Logout;
using Aegis.Application.Auth.Models;
using Aegis.Application.Auth.Refresh;
using Aegis.Application.Auth.Register;
using Aegis.Application.Auth.ResendVerification;
using Aegis.Application.Auth.VerifyEmail;
using Aegis.Application.Auth.VerifyTwoFactor;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace Aegis.API.Controllers;

[ApiController]
[Route("auth")]
[EnableRateLimiting("auth")]
public class AuthController : ControllerBase
{
    private const string DeviceCookieName = "device_id";
    private readonly IMediator _mediator;
    private readonly ILogger<AuthController> _logger;
    private readonly IUserRepository _userRepository;
    private readonly ISessionRepository _sessionRepository;
    private readonly IUnitOfWork _unitOfWork;
    private readonly IWebHostEnvironment _environment;

    public AuthController(
        IMediator mediator,
        ILogger<AuthController> logger,
        IUserRepository userRepository,
        ISessionRepository sessionRepository,
        IUnitOfWork unitOfWork,
        IWebHostEnvironment environment)
    {
        _mediator = mediator;
        _logger = logger;
        _userRepository = userRepository;
        _sessionRepository = sessionRepository;
        _unitOfWork = unitOfWork;
        _environment = environment;
    }

    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh([FromBody] RefreshRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
            return BadRequest(new { message = "Refresh token is required." });

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var result = await _mediator.Send(new RefreshCommand(request.RefreshToken, ip));
        return Ok(result);
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var userAgent = Request.Headers.UserAgent.ToString();
        var deviceName = string.IsNullOrWhiteSpace(userAgent) ? "Unknown Device" : userAgent;

        _logger.LogInformation("Login attempt from IP {IP}", ip);
        var result = await _mediator.Send(new LoginCommand(
            request.Email,
            request.Password,
            ip,
            userAgent,
            deviceName));

        if (!result.RequiresTwoFactor && !string.IsNullOrWhiteSpace(result.DeviceId))
            SetDeviceCookie(result.DeviceId);

        return Ok(result);
    }

    [HttpPost("resend-login-otp")]
    public async Task<IActionResult> ResendLoginOtp([FromBody] ResendLoginOtpRequest request)
    {
        var result = await _mediator.Send(new ResendLoginOtpCommand(request.UserId));
        return Ok(new
        {
            message = "Mã đăng nhập mới đã được gửi đến email của bạn.",
            codeLength = result.CodeLength,
            lifetimeMinutes = result.LifetimeMinutes,
            resendCooldownSeconds = result.ResendCooldownSeconds
        });
    }

    [HttpPost("verify-2fa")]
    public async Task<IActionResult> VerifyTwoFactor([FromBody] VerifyTwoFactorRequest request)
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var userAgent = Request.Headers.UserAgent.ToString();
        var deviceName = string.IsNullOrWhiteSpace(userAgent) ? "Unknown Device" : userAgent;
        var result = await _mediator.Send(new VerifyTwoFactorCommand(
            request.UserId,
            request.Otp,
            ip,
            userAgent,
            deviceName));

        SetDeviceCookie(result.DeviceId);
        return Ok(result);
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterCommand request)
    {
        var result = await _mediator.Send(request);
        return Ok(result);
    }

    [HttpPost("verify-email-code")]
    public async Task<IActionResult> VerifyRegistrationEmailCode([FromBody] VerifyRegistrationEmailCodeRequest request)
    {
        await _mediator.Send(new VerifyRegistrationEmailCodeCommand(request.Email, request.Otp));
        return Ok(new { verified = true });
    }

    [HttpPost("resend-verification")]
    public async Task<IActionResult> ResendVerificationCode([FromBody] ResendEmailVerificationRequest request)
    {
        var result = await _mediator.Send(new ResendEmailVerificationCommand(request.Email));
        return Ok(new
        {
            message = "Nếu email chưa được xác minh, mã xác nhận sẽ được gửi đến hộp thư của bạn.",
            codeLength = result.CodeLength,
            lifetimeMinutes = result.LifetimeMinutes,
            resendCooldownSeconds = result.ResendCooldownSeconds
        });
    }

    [HttpGet("verify-email")]
    public async Task<IActionResult> VerifyEmail([FromQuery] string token)
    {
        await _mediator.Send(new VerifyEmailCommand(token));
        return Ok(new { message = "Email verified successfully" });
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me()
    {
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
            ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!Guid.TryParse(sub, out var userId))
            return Unauthorized();

        var user = await _userRepository.GetByIdAsync(userId);
        if (user is null || !user.IsActive || user.IsLocked() || !user.IsEmailVerified)
            return Unauthorized();

        return Ok(new { id = user.Id, name = user.Name, email = user.Email, emailVerified = user.IsEmailVerified });
    }

    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
            ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var sid = User.FindFirst("sid")?.Value;
        if (!Guid.TryParse(sub, out var userId) || !Guid.TryParse(sid, out var sessionId))
            return Unauthorized();

        var session = await _sessionRepository.GetByIdAsync(sessionId);
        if (session is not null && session.UserId == userId && !session.IsRevoked)
        {
            session.Revoke();
            await _sessionRepository.UpdateAsync(session);
            await _unitOfWork.SaveChangesAsync(HttpContext.RequestAborted);
        }

        Response.Cookies.Delete(DeviceCookieName, DeviceCookieOptions());
        return NoContent();
    }

    [HttpPost("logout-all")]
    [Authorize]
    public async Task<IActionResult> LogoutAll()
    {
        await _mediator.Send(new LogoutAllCommand());
        Response.Cookies.Delete(DeviceCookieName, DeviceCookieOptions());
        return NoContent();
    }

    private void SetDeviceCookie(string deviceId)
    {
        Response.Cookies.Append(DeviceCookieName, deviceId, DeviceCookieOptions());
    }

    private CookieOptions DeviceCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = !_environment.IsDevelopment() || Request.IsHttps,
        SameSite = SameSiteMode.Strict,
        Path = "/",
        Expires = DateTimeOffset.UtcNow.AddDays(30)
    };
}

public sealed record VerifyRegistrationEmailCodeRequest(string Email, string Otp);
public sealed record ResendEmailVerificationRequest(string Email);
public sealed record ResendLoginOtpRequest(Guid UserId);
