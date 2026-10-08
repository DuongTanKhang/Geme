using Aegis.Application.Common.Interfaces;
using Microsoft.EntityFrameworkCore.Storage;
using StackExchange.Redis;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using static Microsoft.EntityFrameworkCore.DbLoggerCategory.Database;

namespace Aegis.Infrastructure.Security
{
    public class TokenBlacklistService : ITokenBlacklistService
    {
        private readonly StackExchange.Redis.IDatabase _redis;

        public TokenBlacklistService(IConnectionMultiplexer connectionMultiplexer)
        {
            _redis = connectionMultiplexer.GetDatabase();
        }
        public async Task BlacklistAsync(string jti, DateTime expiry)
        {
            var ttl = expiry - DateTime.UtcNow;

            if (ttl > TimeSpan.Zero)
                await _redis.StringSetAsync(jti, "revoked", ttl);
        }

        public async Task<bool> IsBlacklistedAsync(string jti)
        {
            return await _redis.KeyExistsAsync(jti);
        }
    }
}
