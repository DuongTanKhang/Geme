using MediatR;

namespace Aegis.Application.Roles.Commands
{
    public record CreateRoleCommand(
       string Name,
       string Description
   ) : IRequest<Guid>;
}
