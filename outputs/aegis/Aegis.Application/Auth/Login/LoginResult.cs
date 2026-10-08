using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.Login
{
    public sealed class LoginResult
    {
        public bool RequiresTwoFactor { get; private set; }
        public Guid? UserId { get; private set; }
        public int? CodeLength { get; private set; }
        public int? LifetimeMinutes { get; private set; }
        public int? ResendCooldownSeconds { get; private set; }

        public string? AccessToken { get; private set; }
        public string? RefreshToken { get; private set; }
        public string? DeviceId { get; private set; }


        private LoginResult() { }

        public LoginResult(string accessToken, string refreshToken)
        {
            AccessToken = accessToken;
            RefreshToken = refreshToken;
        }

        public static LoginResult TwoFactorRequired(
            Guid userId,
            int codeLength,
            int lifetimeMinutes,
            int resendCooldownSeconds)
            => new()
            {
                RequiresTwoFactor = true,
                UserId = userId,
                CodeLength = codeLength,
                LifetimeMinutes = lifetimeMinutes,
                ResendCooldownSeconds = resendCooldownSeconds
            };

        public static LoginResult Success(
    string accessToken,
    string refreshToken,
    string deviceId)
    => new()
    {
        AccessToken = accessToken,
        RefreshToken = refreshToken,
        DeviceId = deviceId
    };

    }

}
