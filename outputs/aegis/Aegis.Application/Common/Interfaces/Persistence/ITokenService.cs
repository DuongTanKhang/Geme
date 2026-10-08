using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Common.Interfaces.Persistence
{
    public interface ITokenService
    {
        string CreateAccessToken(Guid userId, Guid sessionId, IReadOnlyList<string> permissions);
        string GenerateRefreshToken();
    }
}
