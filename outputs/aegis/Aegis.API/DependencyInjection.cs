namespace Aegis.API
{
    using Aegis.Application.Auth.Login;
    using Aegis.Application.Auth.Refresh;
    using Aegis.Application.Auth.Register;
    using Aegis.Infrastructure.Security;
    using Microsoft.AspNetCore.Authentication.JwtBearer;
    using Microsoft.IdentityModel.Tokens;
    using System.Text;

    public static class DependencyInjection
    {
        public static IServiceCollection AddJwtAuth(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            var jwtSettings = configuration.GetSection("Jwt").Get<JwtSettings>();

            services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                .AddJwtBearer(options =>
                {
                    options.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidateIssuer = true,
                        ValidateAudience = true,
                        ValidateLifetime = true,
                        ValidateIssuerSigningKey = true,

                        ValidIssuer = jwtSettings!.Issuer,
                        ValidAudience = jwtSettings.Audience,

                        IssuerSigningKey = new SymmetricSecurityKey(
                            Encoding.UTF8.GetBytes(jwtSettings.Key))
                    };
                });


            return services;
        }
    }

}
