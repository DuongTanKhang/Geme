using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.Register
{
    public class RegisterResult
    {
        public Guid UserId { get; }
        public int CodeLength { get; }
        public int LifetimeMinutes { get; }
        public int ResendCooldownSeconds { get; }

        public RegisterResult(Guid userId, int codeLength, int lifetimeMinutes, int resendCooldownSeconds)
        {
            UserId = userId;
            CodeLength = codeLength;
            LifetimeMinutes = lifetimeMinutes;
            ResendCooldownSeconds = resendCooldownSeconds;
        }
    }
}
