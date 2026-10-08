using Aegis.Domain.Common;
using Aegis.Domain.Enums;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Entities
{
    public class SecurityAudit : BaseEntity
    {
        public Guid? UserId { get; private set; }
        public SecurityAuditAction Action { get; private set; }
        public string? IpAddress { get; private set; }

        private SecurityAudit() { }

        public SecurityAudit(Guid? userId, SecurityAuditAction action, string? ip)
        {
            Id = Guid.NewGuid();
            UserId = userId;
            Action = action;
            IpAddress = ip;
            CreatedAt = DateTime.UtcNow;
        }
    }
}
