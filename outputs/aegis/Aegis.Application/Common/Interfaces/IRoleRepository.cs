
using Aegis.Domain.Entities;

namespace Aegis.Application.Common.Interfaces
{
    public interface IRoleRepository
    {
        Task AddAsync(Role role);
        Task<IReadOnlyList<Role>> GetAllAsync();
        Task <Role?> GetByNameAsync(string name);
        Task DeleteAsync(Role role);
        Task UpdateAsync(Role role);
        Task<Role?> GetByIdAsync(Guid id);
        Task SaveChangesAsync();

    }
}
