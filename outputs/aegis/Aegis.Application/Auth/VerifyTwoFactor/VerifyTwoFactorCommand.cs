using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.VerifyTwoFactor
{
    public record VerifyTwoFactorCommand(
    Guid UserId,
    string Otp,
    string? Ip,
    string? UserAgent,
    string DeviceName
) : IRequest<VerifyTwoFactorResult>;
}
