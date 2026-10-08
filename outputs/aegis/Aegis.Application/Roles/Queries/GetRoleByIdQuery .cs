using Aegis.Application.Roles.Models;
using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Roles.Queries
{
    public class GetRoleByIdQuery : IRequest<RoleResult?>
    {
        public Guid Id { get; set; }
    }
}
