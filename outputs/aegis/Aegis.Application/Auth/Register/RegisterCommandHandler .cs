using Aegis.Application.Auth.Login;
using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.Register
{
    public class RegisterCommandHandler : IRequestHandler<RegisterCommand, RegisterResult>
    {
        private readonly RegisterHandle _handle;

        public RegisterCommandHandler(RegisterHandle handle)
        {
            _handle = handle;
        }
        public async Task<RegisterResult> Handle(RegisterCommand request, CancellationToken cancellationToken)
        {
            return await _handle.Handle(request);
        }
    }
}
