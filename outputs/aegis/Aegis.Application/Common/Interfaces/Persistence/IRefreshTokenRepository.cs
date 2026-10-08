using Aegis.Domain.Entities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Common.Interfaces.Persistence
{
    public interface IRefreshTokenRepository
    {
        Task<RefreshToken?> GetByHashAsync(byte[] tokenHash);
        Task AddAsync(RefreshToken refreshToken);
        Task<bool> ExistsAsync(byte[] tokenHash);
        Task RevokeAsync(byte[] tokenHash);
        Task RevokeAllAsync(Guid userId, string? revokedByIp);
        Task UpdateAsync(RefreshToken token);
    }
}
