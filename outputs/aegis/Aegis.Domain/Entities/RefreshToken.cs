using Aegis.Domain.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Entities
{
    public class RefreshToken : BaseEntity
    {
        public Guid UserId { get; private set; }
        public User User { get; private set; } = null!;

        public byte[] TokenHash { get; private set; } = null!;

        public DateTime ExpiresAt { get; private set; }
        public DateTime? RevokedAt { get; private set; }

        public Guid? ReplacedByTokenId { get; private set; }
        public RefreshToken? ReplacedByToken { get; private set; }

        public string? CreatedByIp { get; private set; }
        public string? RevokedByIp { get; private set; }

        public Guid SessionId { get; private set; }
        public Session Session { get; private set; } = null!;

        public DateTime AbsoluteExpiresAt { get; private set; }




        private RefreshToken() { }

        public RefreshToken(Guid userId, Guid sessionId,byte[] tokenHash, DateTime expireAt, DateTime absoluteExpiresAt, string? createdByIp)
        {
            Id = Guid.NewGuid();
            UserId = userId;
            TokenHash = tokenHash;
            SessionId = sessionId;
            ExpiresAt = expireAt;
            AbsoluteExpiresAt = absoluteExpiresAt;
            CreatedByIp = createdByIp;
            CreatedAt = DateTime.UtcNow;

        }

        public bool IsExpired() => DateTime.UtcNow >= ExpiresAt;

        public bool IsRevoked => RevokedAt != null;

        public bool IsActive() => RevokedAt == null && !IsExpired();

        public void Revoke(Guid? replaceByTokenId = null)
        {
            RevokedAt = DateTime.UtcNow;
            ReplacedByTokenId = replaceByTokenId;
        }

        public void Revoke(string? revokedByIp, Guid? replacedByTokenId = null)
        {
            if (IsRevoked) return;

            RevokedAt = DateTime.UtcNow;
            RevokedByIp = revokedByIp;
            ReplacedByTokenId = replacedByTokenId;
        }



    }
}
