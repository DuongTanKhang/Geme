using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Enums
{
    public enum SecurityAuditAction
    {
        LoginSuccess = 1,
        LoginFailed = 2,
        TokenRefreshed = 3,
        TokenRevoked = 4,
        AccountLocked = 5,
        TwoFactorRequired = 6,
        TwoFactorFailed = 7,
        TwoFactorSucceeded = 8
    }
}
