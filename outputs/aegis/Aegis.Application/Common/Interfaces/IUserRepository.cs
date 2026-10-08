using Aegis.Domain.Entities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Common.Interfaces
{
    public interface IUserRepository
    {
        Task<User?> GetByEmailAsync(string username);
        Task<IReadOnlyList<string>> GetPermissionsAsync(Guid userId);
        Task AddAsync(User user);
        Task<User?> GetByEmailVerificationTokenAsync(string token);
        Task UpdateAsync(User user);
        Task<bool> ExistsByEmailAsync(string email);
        Task<User> GetByIdAsync(Guid id);

    }
}
