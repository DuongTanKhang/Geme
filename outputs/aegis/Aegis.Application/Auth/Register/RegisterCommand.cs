using Aegis.Application.Auth.Login;
using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.Register
{
    public class RegisterCommand : IRequest<RegisterResult>
    {
        public string Name { get; init; } = default!;
        public string Email { get; init; } = default!;
        public string Password { get; init; } = default!;

        public RegisterCommand(string name, string email, string password)
        {
            Name = name;
            Email = email;
            Password = password;
        }
    }
}
