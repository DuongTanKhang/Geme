using Aegis.Domain.Entities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Common.Interfaces.Persistence
{
    public interface ISessionRepository
    {
        Task AddAsync(Session session);
        Task<Session?> GetByIdAsync(Guid sessionId);
        Task<List<Session>> GetUserSessionsAsync(Guid userId);
        Task UpdateAsync(Session session);
        Task RevokeAllByUserId(Guid userId);

    }
}
