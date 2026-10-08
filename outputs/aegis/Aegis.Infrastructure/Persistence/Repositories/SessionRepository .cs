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
    public class SessionRepository : ISessionRepository
    {
        private readonly AegisDbContext _dbContext;
        public SessionRepository(AegisDbContext context)
        {
            _dbContext = context;
        }
        public async Task AddAsync(Session session)
        {
            await _dbContext.Sessions.AddAsync(session);
        }

        public async Task<Session?> GetByIdAsync(Guid sessionId)
        {
            return await _dbContext.Sessions.FirstOrDefaultAsync(x => x.Id == sessionId);
        }

        public async Task<List<Session>> GetUserSessionsAsync(Guid userId)
        {
            return await _dbContext.Sessions
                .Where(x => x.UserId == userId)
                .OrderByDescending(x => x.UserId)
                .ToListAsync();

        }

        public async Task RevokeAllByUserId(Guid userId)
        {
            await _dbContext.Sessions
                .Where(s => s.UserId == userId && s.RevokedAt == null)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(s => s.RevokedAt, DateTime.UtcNow));
        }


        public Task UpdateAsync(Session session)
        {
            _dbContext.Sessions.Update(session);
            return Task.CompletedTask;
        }
    }
}
