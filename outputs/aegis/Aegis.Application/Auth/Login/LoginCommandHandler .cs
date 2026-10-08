using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.Login
{
    public class LoginCommandHandler : IRequestHandler<LoginCommand, LoginResult>
    {
        private readonly LoginHandle _handle;

        public LoginCommandHandler(LoginHandle loginHandle)
        {
             _handle = loginHandle;
        }
        public async Task<LoginResult> Handle(LoginCommand request, CancellationToken cancellationToken)
        {
            return await _handle.Handle(
            request.Email,
            request.Password,
            request.Ip,
            request.UserAgent,
            request.DeviceName
        );
        }
    }
}
