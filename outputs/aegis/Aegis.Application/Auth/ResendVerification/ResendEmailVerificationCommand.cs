using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using MediatR;

namespace Aegis.Application.Auth.ResendVerification
{
    public sealed record ResendEmailVerificationCommand(string Email) : IRequest<ResendEmailVerificationResult>;
    public sealed record ResendEmailVerificationResult(int CodeLength, int LifetimeMinutes, int ResendCooldownSeconds);
}
