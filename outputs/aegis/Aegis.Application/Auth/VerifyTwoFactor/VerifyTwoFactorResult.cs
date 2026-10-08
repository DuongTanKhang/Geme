using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.VerifyTwoFactor
{
    public sealed class VerifyTwoFactorResult
    {
        public string AccessToken { get; }
        public string RefreshToken { get; }
        public string DeviceId { get; }

        public VerifyTwoFactorResult(
            string accessToken,
            string refreshToken,
            string deviceId)
        {
            AccessToken = accessToken;
            RefreshToken = refreshToken;
            DeviceId = deviceId;
        }
    }


}
