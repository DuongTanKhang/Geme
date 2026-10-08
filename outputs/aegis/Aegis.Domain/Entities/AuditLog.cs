using Aegis.Domain.Common;
using Aegis.Domain.Enums;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Entities
{
    public class AuditLog : BaseEntity
    {
        public Guid? UserId { get; private set; }
        public AuditAction Action { get; private set; }
        public string? IpAddress { get; private set; }

        private AuditLog() { }

        public AuditLog(Guid? userId, AuditAction action, string? ipAddress)
        {
            Id = Guid.NewGuid();
            UserId = userId;
            Action = action;
            IpAddress = ipAddress;
            CreatedAt = DateTime.UtcNow;
        }
    }
}
