using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using MediatR;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.VerifyEmail
{
    public class VerifyEmailHandler : IRequestHandler<VerifyEmailCommand>
    {
        private readonly IUserRepository _userRepository;
        public VerifyEmailHandler(IUserRepository userRepository)
        {
            _userRepository = userRepository;
        }
        public async Task Handle(VerifyEmailCommand request, CancellationToken cancellationToken)
        {
            var user = await _userRepository.GetByEmailVerificationTokenAsync(request.Token);
            if (user is null)
            {
                throw new BadRequestException("Invalid verification token.");
            }
            if (user.EmailVerificationTokenExpires < DateTime.UtcNow)
                throw new BadRequestException("Verification token expired");
            user.VerifyEmail(request.Token);
            await _userRepository.UpdateAsync(user);
        }
    }
}
