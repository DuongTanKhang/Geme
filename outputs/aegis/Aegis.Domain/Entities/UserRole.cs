using Aegis.Domain.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Entities
{
    public class UserRole
    {
        public Guid UserId { get; private set; }
        public Guid RoleId { get; private set; }

        protected UserRole() { }

        public UserRole(Guid userId, Guid roleId)
        {
            UserId = userId;
            RoleId = roleId;
        }
    }
}
