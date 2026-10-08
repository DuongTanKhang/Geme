using Aegis.Application.Common.Interfaces;
using Aegis.Application.Roles.Models;
using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Roles.Queries
{
    public class GetAllRolesQueryHandler : IRequestHandler<GetAllRolesQuery, IReadOnlyList<RoleResult>>
    {
        private readonly IRoleRepository _roleRepository;

        public GetAllRolesQueryHandler(IRoleRepository roleRepository)
        {
            _roleRepository = roleRepository;
        }
        public async Task<IReadOnlyList<RoleResult>> Handle(GetAllRolesQuery request, CancellationToken cancellationToken)
        {
            var roles = await _roleRepository.GetAllAsync();
            return roles.Select(r => new RoleResult
            {
                Name = r.Name,
                Description = r.Description
            }).ToList();
        }
    }
}
