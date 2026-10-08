using Aegis.Application.Common.Interfaces;
using Aegis.Domain.Entities;
using Aegis.Domain.Enums;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence.Repositories
{
    public class SecutiryAuditRepository : ISecurityAuditRepository
    {
        private readonly AegisDbContext _dbContext;
        public SecutiryAuditRepository(AegisDbContext context)
        {
            _dbContext = context;
        }
        public async Task AddAsync(Guid? userId, SecurityAuditAction action, string? ip)
        {
            _dbContext.SecurityAudits.Add(new SecurityAudit(userId, action, ip));
            await _dbContext.SaveChangesAsync();
        }
    }
}
