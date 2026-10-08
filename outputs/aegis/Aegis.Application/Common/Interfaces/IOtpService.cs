using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Common.Interfaces
{
    public interface IOtpService
    {
        int CodeLength { get; }
        int LifetimeMinutes { get; }
        int ResendCooldownSeconds { get; }
        Task<Aegis.Application.Common.Enums.OtpVerificationResult> VerifyAsync(
            Guid userId,
            string email,
            string otp,
            Aegis.Application.Common.Enums.OtpPurpose purpose = Aegis.Application.Common.Enums.OtpPurpose.Login);
        Task<int> GenerateAndSendOtpAsync(
            Guid userId,
            string email,
            string customerName,
            Aegis.Application.Common.Enums.OtpPurpose purpose = Aegis.Application.Common.Enums.OtpPurpose.Login);
        Task InvalidatePendingDeliveryAsync(
            Guid userId,
            Aegis.Application.Common.Enums.OtpPurpose purpose,
            string deliveryId);
        Task<bool> IsPendingDeliveryAsync(
            Guid userId,
            Aegis.Application.Common.Enums.OtpPurpose purpose,
            string deliveryId);
    }
}
