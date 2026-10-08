using Aegis.Domain.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Entities
{
    public class Permission : BaseEntity
    {
        public string Code { get; private set; } = null!;
        public string Description { get; private set; } = null!;

        protected Permission() { }

        public Permission(string code, string description)
        {
            Code = code;
            Description = description;
        }
    }
}
