using Aegis.Domain.Enums;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Common.Interfaces.Persistence
{
    public interface IAuditLogRepository
    {
        Task AddAsync(Guid? userId, AuditAction action, string? ipAddress);
    }
}
