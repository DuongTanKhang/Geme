using Aegis.Domain.Enums;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Common.Interfaces
{
    public interface ISecurityAuditRepository
    {
        Task AddAsync(Guid? userId, SecurityAuditAction action, string? ip);
    }
}
