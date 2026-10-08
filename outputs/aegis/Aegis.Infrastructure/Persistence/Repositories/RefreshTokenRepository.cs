using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence.Repositories
{
    public class RefreshTokenRepository : IRefreshTokenRepository
    {
        private readonly AegisDbContext _dbContext;

        public RefreshTokenRepository(AegisDbContext dbContext)
        {
            _dbContext = dbContext;
        }
        public async Task AddAsync(RefreshToken refreshToken)
        {
            await _dbContext.RefreshTokens.AddAsync(refreshToken);

        }

        public async Task<bool> ExistsAsync(byte[] tokenHash)
        {
            return await _dbContext.RefreshTokens
                .AnyAsync(rt => rt.TokenHash.SequenceEqual(tokenHash));
        }


        public async Task<RefreshToken?> GetByHashAsync(byte[] tokenHash)
        {
            return await _dbContext.RefreshTokens
                .FirstOrDefaultAsync(rt => rt.TokenHash.SequenceEqual(tokenHash));
        }

        public async Task RevokeAllAsync(Guid userId, string? revokedByIp)
        {
            var tokens = await _dbContext.RefreshTokens
                    .Where(rt => rt.UserId == userId && rt.RevokedAt == null)
                    .ToListAsync();
            foreach (var token in tokens)
            {
                token.Revoke(revokedByIp);
            }

        }

        public async Task RevokeAsync(byte[] tokenHash)
        {
            var token = await _dbContext.RefreshTokens
                .FirstOrDefaultAsync(rt => rt.TokenHash.SequenceEqual(tokenHash));

            if (token is null) return;

            token.Revoke();
        }


        public Task UpdateAsync(RefreshToken token)
        {
            _dbContext.RefreshTokens.Update(token);
            return Task.CompletedTask;
        }
    }
}
