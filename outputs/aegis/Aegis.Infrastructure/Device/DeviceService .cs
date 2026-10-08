using Aegis.Application.Common.Interfaces;
using Microsoft.AspNetCore.Http;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Device
{
    public class DeviceService : IDeviceService
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public DeviceService(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }

        public string GetDeviceId()
        {
            var context = _httpContextAccessor.HttpContext!;

            var deviceId = context.Request.Cookies["device_id"];

            if (string.IsNullOrEmpty(deviceId))
                deviceId = Guid.NewGuid().ToString();

            return deviceId;
        }
    }
}
