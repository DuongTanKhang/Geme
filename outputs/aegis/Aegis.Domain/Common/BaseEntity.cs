using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Common
{
    public abstract class BaseEntity
    {
        public Guid Id { get; protected set; } = Guid.NewGuid();

        public DateTime CreatedAt { get; internal set; } = DateTime.UtcNow;
        public Guid? CreatedBy { get; internal set; }

        public DateTime? LastModifiedAt { get; internal set; }
        public Guid? LastModifiedBy { get; internal set; }
    }
}
