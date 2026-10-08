using Aegis.Application.Roles.Models;
using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Roles.Queries
{
    public record GetAllRolesQuery()
       : IRequest<IReadOnlyList<RoleResult>>;
}
