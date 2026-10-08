using Aegis.Application.Common.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence
{
    public class DesignTimeCurrentUserService : ICurrentUserService
    {
        public Guid? UserId => Guid.Empty;
        public Guid? SessionId => Guid.Empty;
    }
}
