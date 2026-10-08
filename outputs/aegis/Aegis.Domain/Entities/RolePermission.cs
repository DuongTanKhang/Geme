using Aegis.Domain.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Entities
{
    public class RolePermission
    {
        public Guid RoleId { get; private set; }
        public Role Role { get; private set; } = null!;

        public Guid PermissionId { get; private set; }
        public Permission Permission { get; private set; } = null!;

        protected RolePermission() { }

        public RolePermission(Guid roleId, Guid permissionId)
        {
            RoleId = roleId;
            PermissionId = permissionId;
        }
    }


}
