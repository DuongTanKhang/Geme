using Aegis.Application.Common.Interfaces;
using Aegis.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence.Repositories
{
    public class UserRepository : IUserRepository
    {
        private readonly AegisDbContext _dbContext;

        public UserRepository(AegisDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        public async Task AddAsync(User user)
        {
            _dbContext.Users.Add(user);
            await _dbContext.SaveChangesAsync();
        }

        public async Task<bool> ExistsByEmailAsync(string email)
        {
            return await _dbContext.Users
                .AnyAsync(u => u.Email == email);
        }


        public async Task<User?> GetByEmailAsync(string email)
        {
            return await _dbContext.Users
                .FirstOrDefaultAsync(u => u.Email == email);
        }

        public async Task<User?> GetByEmailVerificationTokenAsync(string token)
        {
            return await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.EmailVerificationToken == token);
        }

        public async Task<User> GetByIdAsync(Guid id)
        {
            return await _dbContext.Users.AsNoTracking().FirstAsync(u => u.Id == id);
        }

        public async Task<IReadOnlyList<string>> GetPermissionsAsync(Guid userId)
        {
            return await _dbContext.UserRoles
                .Where(ur => ur.UserId == userId)
                .Join(
                    _dbContext.RolePermissions,
                    ur => ur.RoleId,
                    rp => rp.RoleId,
                    (ur, rp) => rp.PermissionId
                )
                .Join(
                    _dbContext.Permissions,
                    permissionId => permissionId,
                    p => p.Id,
                    (permissionId, p) => p.Code
                )
                .Distinct()
                .ToListAsync();
        }

        public async Task UpdateAsync(User user)
        {
            _dbContext.Users.Update(user);
            await _dbContext.SaveChangesAsync();
        }
    }
}
