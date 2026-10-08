using Aegis.Application.Common.Interfaces;
using Aegis.Application.Roles;
using Aegis.Domain.Entities;
using Microsoft.EntityFrameworkCore;



namespace Aegis.Infrastructure.Persistence.Repositories
{
    public class RoleRepository : IRoleRepository
    {
        private readonly AegisDbContext _dbContext;
        public RoleRepository(AegisDbContext dbContext)
        {
            _dbContext = dbContext;
        }
        public async Task AddAsync(Role role)
        {
            await _dbContext.Roles.AddAsync(role);
        }

        public async Task DeleteAsync(Role role)
        {
            _dbContext.Roles.Remove(role);
            await _dbContext.SaveChangesAsync();
        }

        public async Task<Role?> GetByNameAsync(string name)
        {
            return await _dbContext.Roles
                 .AsNoTracking()
                 .FirstOrDefaultAsync(r => r.Name == name);
        }

        public async Task UpdateAsync(Role role)
        {
            _dbContext.Roles.Update(role);
            await _dbContext.SaveChangesAsync();
        }

        public async Task<IReadOnlyList<Role>> GetAllAsync()
        {
            return await _dbContext.Roles
                .AsNoTracking()
                .ToListAsync();
        }

        public async Task SaveChangesAsync()
        {
            await _dbContext.SaveChangesAsync();
        }

        public async Task<Role?> GetByIdAsync(Guid id)
        {
            return await _dbContext.Roles
                .FirstOrDefaultAsync(r => r.Id == id);
        }
    }
}
