using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Domain.Entities;
using System.Text;
using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Aegis.Application.Auth.Register
{
    public class RegisterHandle
    {
        private readonly IUserRepository _userRepository;
        private readonly IPasswordHasher _passwordHasher;
        private readonly IOtpService _otpService;
        private readonly ILogger<RegisterHandle> _logger;

        public RegisterHandle(
            IUserRepository userRepository,
            IPasswordHasher passwordHasher,
            IOtpService otpService,
            ILogger<RegisterHandle> logger)
        {
            _userRepository = userRepository;
            _passwordHasher = passwordHasher;
            _otpService = otpService;
            _logger = logger;
        }

        public async Task<RegisterResult> Handle(RegisterCommand cmd)
        {
            var email = cmd.Email.Trim().ToLowerInvariant();
            var emailLookupTimer = Stopwatch.StartNew();
            var emailExists = await _userRepository.ExistsByEmailAsync(email);
            emailLookupTimer.Stop();
            if (emailExists)
                throw new ConflictException("Email đã tồn tại");

            var hashTimer = Stopwatch.StartNew();
            var passwordHash =
                Encoding.UTF8.GetBytes(_passwordHasher.Hash(cmd.Password));
            hashTimer.Stop();

            var user = new User(
                cmd.Name.Trim(),
                email,
                passwordHash);

            var persistenceTimer = Stopwatch.StartNew();
            await _userRepository.AddAsync(user);
            persistenceTimer.Stop();
            var otpQueueTimer = Stopwatch.StartNew();
            var cooldownSeconds = await _otpService.GenerateAndSendOtpAsync(
                user.Id,
                user.Email,
                user.Name,
                Aegis.Application.Common.Enums.OtpPurpose.RegistrationEmailVerification);
            otpQueueTimer.Stop();

            _logger.LogDebug(
                "Registration stage timing in ms: emailLookup={EmailLookupMs}, passwordHash={PasswordHashMs}, userSave={UserSaveMs}, otpQueue={OtpQueueMs}.",
                emailLookupTimer.ElapsedMilliseconds,
                hashTimer.ElapsedMilliseconds,
                persistenceTimer.ElapsedMilliseconds,
                otpQueueTimer.ElapsedMilliseconds);

            return new RegisterResult(user.Id, _otpService.CodeLength, _otpService.LifetimeMinutes, cooldownSeconds);
        }
    }

}
