using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Domain.Entities;
using Aegis.Domain.Enums;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence.Repositories
{
    public class AuditLogRepository : IAuditLogRepository
    {
        private readonly AegisDbContext _dbContext;
        public AuditLogRepository(AegisDbContext context)
        {
            _dbContext = context;
        }

        public async Task AddAsync(Guid? userId, AuditAction action, string? ipAddress)
        {
            _dbContext.AuditLogs.Add(new AuditLog(userId, action, ipAddress));
            await _dbContext.SaveChangesAsync();
        }
    }
}
