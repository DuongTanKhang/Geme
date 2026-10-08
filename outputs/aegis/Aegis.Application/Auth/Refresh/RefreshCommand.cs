using Aegis.Application.Auth.Login;
using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.Refresh
{
    public record RefreshCommand(string RefreshToken, string? Ip)
    : IRequest<LoginResult>;

}
