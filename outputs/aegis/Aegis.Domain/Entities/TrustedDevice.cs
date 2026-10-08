using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Entities
{
    public class TrustedDevice
    {
        public Guid Id { get; private set; } = Guid.NewGuid();
        public Guid UserId { get; private set; }

        public string DeviceId { get; private set; } = default!;
        public string? DeviceName { get; private set; }
        public string? IpAddress { get; private set; }

        public string? UserAgent { get; private set; }

        public DateTime ExpiryTime { get; private set; }

        public DateTime CreatedAt { get; set; }

        private TrustedDevice() { }

        public TrustedDevice(Guid userId, string deviceId, string? deviceName,
            string? ipAdress, string? userAgent, DateTime expiryTime)
        {
            UserId = userId;
            DeviceId = deviceId;
            DeviceName = deviceName;
            IpAddress = ipAdress;
            UserAgent = userAgent;
            ExpiryTime = expiryTime;
            CreatedAt = CreatedAt = DateTime.UtcNow;

        }
    }
}
