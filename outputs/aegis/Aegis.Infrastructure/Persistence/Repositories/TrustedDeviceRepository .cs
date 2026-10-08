using Aegis.Application.Common.Interfaces;
using Aegis.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence.Repositories
{
    public class TrustedDeviceRepository : ITrustedDeviceRepository
    {
        private readonly AegisDbContext _context;

        public TrustedDeviceRepository(AegisDbContext context)
        {
            _context = context;
        }

        public async Task<bool> IsTrustedAsync(Guid userId, string deviceId)
        {
            return await _context.TrustedDevices.AnyAsync(x =>
                x.UserId == userId &&
                x.DeviceId == deviceId &&
                x.ExpiryTime > DateTime.UtcNow);
        }

        public async Task AddAsync(TrustedDevice device)
        {
            await _context.TrustedDevices.AddAsync(device);
        }
    }
}
