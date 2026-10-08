using Aegis.Domain.Entities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Common.Interfaces
{
    public interface ITrustedDeviceRepository
    {
        Task<bool> IsTrustedAsync(Guid userId, string deviceId);

        Task AddAsync(TrustedDevice device);
    }
}
