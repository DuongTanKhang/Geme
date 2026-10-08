using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.Logout
{
    public class LogoutAllCommandHandler : IRequestHandler<LogoutAllCommand>
    {
        private readonly LogoutHandle _logoutHandle;

        public LogoutAllCommandHandler(LogoutHandle logoutHandle)
        {
            _logoutHandle = logoutHandle;
        }

        public async Task Handle(LogoutAllCommand request, CancellationToken ct)
        {
            await _logoutHandle.LogoutAll();
        }
    }

}
