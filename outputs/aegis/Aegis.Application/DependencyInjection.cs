using Aegis.Application.Auth.Login;
using Aegis.Application.Auth.Logout;
using Aegis.Application.Auth.Refresh;
using Aegis.Application.Auth.Register;
using Aegis.Application.Auth.VerifyEmail;
using Aegis.Application.Auth.VerifyTwoFactor;
using Aegis.Application.Common.Behaviors;
using FluentValidation;
using MediatR;
using Microsoft.Extensions.DependencyInjection;
using System.Reflection;

namespace Aegis.Application
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddApplication(this IServiceCollection services)
        {
            services.AddMediatR(cfg =>
                cfg.RegisterServicesFromAssembly(Assembly.GetExecutingAssembly()));
            services.AddValidatorsFromAssembly(Assembly.GetExecutingAssembly());
            services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));
            services.AddScoped<RefreshTokenHasher>();
            services.AddScoped<LoginHandle>();
            services.AddScoped<LogoutHandle>();
            services.AddScoped<RegisterHandle>();
            services.AddScoped<VerifyEmailHandler>();
            services.AddScoped<VerifyTwoFactorHandler>();
            return services;
        }
    }
}
