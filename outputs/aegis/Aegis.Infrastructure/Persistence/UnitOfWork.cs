using Aegis.Application.Common.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence
{
    public class UnitOfWork : IUnitOfWork
    {
        private readonly AegisDbContext _context;
        public UnitOfWork(AegisDbContext context)
        {
            _context = context;
        }
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            return _context.SaveChangesAsync(cancellationToken);
        }
    }
}
