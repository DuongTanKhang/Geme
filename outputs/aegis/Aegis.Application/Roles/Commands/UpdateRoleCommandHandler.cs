using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Roles.Commands
{
    public class UpdateRoleCommandHandler : IRequestHandler<UpdateRoleCommand>
    {
        private readonly IRoleRepository _roleRepository;

        public UpdateRoleCommandHandler(IRoleRepository roleRepository)
        {
            _roleRepository = roleRepository;
        }
        public async Task Handle(UpdateRoleCommand request, CancellationToken cancellationToken)
        {
            var role = await _roleRepository.GetByIdAsync(request.Id);

            if (role == null)
            {
                throw new NotFoundException($"Role with id {request.Id} not found.");
            }

            role.Update(request.Name, request.Description);

            await _roleRepository.SaveChangesAsync();
        }

    }
}
