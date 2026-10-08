using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Entities
{
    public class Session
    {
        public Guid Id { get; private set; }
        public Guid UserId { get; private set; }

        public string DeviceName { get; private set; } = null!;
        public string? UserAgent { get; private set; }
        public string? IpAddress { get; private set; }

        public DateTime CreatedAt { get; private set; }
        public DateTime? RevokedAt { get; private set; }

        public DateTime LastActivityAt { get; private set; }

        public bool IsActive => RevokedAt == null;

        public bool IsRevoked => RevokedAt != null;

        private Session() { }

        public Session(Guid userId, string deviceName, string? userAgent, string? ip)
        {
            Id = Guid.NewGuid();
            UserId = userId;
            DeviceName = deviceName;
            UserAgent = userAgent;
            IpAddress = ip;
            CreatedAt = DateTime.UtcNow;
            LastActivityAt = CreatedAt;
        }

        public void Revoke()
        {
            RevokedAt = DateTime.UtcNow;
        }

        public void Touch()
        {
            LastActivityAt = DateTime.UtcNow;
        }
    }
}
