using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.Login
{
    public record LoginCommand(
    string Email,
    string Password,
    string? Ip,
    string? UserAgent,
    string DeviceName
) : IRequest<LoginResult>;

}
