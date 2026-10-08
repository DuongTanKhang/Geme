using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Common.Interfaces
{
    public interface ITokenBlacklistService
    {
        Task BlacklistAsync(string jti, DateTime expiry);
        Task<bool> IsBlacklistedAsync(string jti);
    }
}
