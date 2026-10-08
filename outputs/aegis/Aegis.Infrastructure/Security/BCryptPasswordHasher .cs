using Aegis.Application.Common.Interfaces.Persistence;
using Microsoft.Extensions.Options;

namespace Aegis.Infrastructure.Security
{
    public class BCryptPasswordHasher : IPasswordHasher
    {
        private readonly int _workFactor;

        public BCryptPasswordHasher(IOptions<PasswordHashingOptions> options)
        {
            _workFactor = options.Value.EffectiveWorkFactor;
        }

        public string Hash(string password)
            => BCrypt.Net.BCrypt.HashPassword(password, _workFactor);

        public bool Verify(string password, string hash)
            => BCrypt.Net.BCrypt.Verify(password, hash);
    }
}
