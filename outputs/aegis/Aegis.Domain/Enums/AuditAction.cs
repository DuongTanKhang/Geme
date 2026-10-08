using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Enums
{
    public enum AuditAction
    {
        Create = 1,
        Update = 2,
        Delete = 3,

        Activate = 4,
        Deactivate = 5,

        Approve = 6,
        Reject = 7,

        AssignRole = 8,
        RemoveRole = 9,

        ChangeStatus = 10
    }
}
