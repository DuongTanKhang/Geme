using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Common.Interfaces
{
    public interface IEmailService
    {
        Task SendVerifyEmailAsync(string email, string token);
        Task SendAsync(string to, string subject, string body);
        Task SendRegistrationOtpAsync(string email, string customerName, string otp, TimeSpan lifetime);
    }
}
