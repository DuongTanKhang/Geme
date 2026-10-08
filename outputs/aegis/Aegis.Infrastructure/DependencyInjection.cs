using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Infrastructure.Device;
using Aegis.Infrastructure.Email;
using Aegis.Infrastructure.Jwt;
using Aegis.Infrastructure.Persistence;
using Aegis.Infrastructure.Persistence.Repositories;
using Aegis.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Aegis.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddDbContext<AegisDbContext>(options =>
            options.UseSqlServer(configuration.GetConnectionString("DefaultConnection")));

        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();
        services.AddScoped<ITokenService, TokenService>();
        services.AddScoped<IAuditLogRepository, AuditLogRepository>();
        services.AddScoped<IPasswordHasher, BCryptPasswordHasher>();
        services.AddScoped<IEmailService, EmailService>();
        services.AddSingleton<OtpEmailQueue>();
        services.AddScoped<IUnitOfWork, UnitOfWork>();
        services.AddScoped<IRoleRepository, RoleRepository>();
        services.AddScoped<ISecurityAuditRepository, SecutiryAuditRepository>();
        services.AddScoped<ISessionRepository, SessionRepository>();
        services.AddScoped<ITokenLifetimeProvider, TokenLifetimeProvider>();
        services.AddScoped<ITokenBlacklistService, TokenBlacklistService>();
        services.AddScoped<ICurrentUserService, CurrentUserService>();
        services.AddScoped<IDeviceService, DeviceService>();
        services.AddScoped<ITrustedDeviceRepository, TrustedDeviceRepository>();
        services.AddScoped<IOtpService, OtpService>();

        services.Configure<JwtOptions>(configuration.GetSection("JwtOptions"));
        services.Configure<EmailOptions>(configuration.GetSection(EmailOptions.SectionName));
        services.Configure<OtpOptions>(configuration.GetSection(OtpOptions.SectionName));
        services.Configure<PasswordHashingOptions>(configuration.GetSection(PasswordHashingOptions.SectionName));
        return services;
    }
}
