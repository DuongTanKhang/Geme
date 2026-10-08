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
    public class DeleteRoleCommandHandler
        : IRequestHandler<DeleteRoleCommand>
    {
        private readonly IRoleRepository _repository;

        public DeleteRoleCommandHandler(IRoleRepository repository)
        {
            _repository = repository;
        }

        public async Task Handle(DeleteRoleCommand request, CancellationToken cancellationToken)
        {
            var role = await _repository.GetByIdAsync(request.Id);

            if (role is null)
                throw new NotFoundException("Role not found");

            await _repository.DeleteAsync(role);
            await _repository.SaveChangesAsync();
        }
    }
}
