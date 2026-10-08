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
    public class GetRoleByIdQueryHandler
     : IRequestHandler<GetRoleByIdQuery, RoleResult?>
    {
        private readonly IRoleRepository _repository;

        public GetRoleByIdQueryHandler(IRoleRepository repository)
        {
            _repository = repository;
        }

        public async Task<RoleResult?> Handle(
        GetRoleByIdQuery request,
        CancellationToken cancellationToken)
        {
            var role = await _repository.GetByIdAsync(request.Id);
            return role is null
                ? null
                : new RoleResult
                {
                    Name = role.Name,
                    Description = role.Description
                };

        }
    }
}
