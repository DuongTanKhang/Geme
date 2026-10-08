using Aegis.Domain.Common;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Entities
{
    public class User : BaseEntity
    {
        public string Name { get; private set; } = null!;
        public string Email { get; private set; } = null!;

        public byte[] PasswordHash { get; private set; } = null!;

        public bool IsEmailVerified { get; private set; }
        public string? EmailVerificationToken { get; private set; }
        public DateTime? EmailVerificationTokenExpires { get; private set; }

        public bool IsActive { get; private set; } = true;

        public int FailedLoginCount { get; private set; }
        public DateTime? LockoutEnd { get; private set; }

        public Guid? RoleId { get; private set; }
        public Role? Role { get; private set; }

        private User() { }

        public User(string userName, string email, byte[] passwordHash)
        {
            Name = userName;
            Email = email;
            PasswordHash = passwordHash;
        }

        public void RecordFailedLogin(int maxAttemps, TimeSpan lockoutDuration)
        {
            FailedLoginCount++;
            if (FailedLoginCount >= maxAttemps)
            {
                LockoutEnd = DateTime.UtcNow.Add(lockoutDuration);
                FailedLoginCount = 0;
            }
        }

        public void ResetFailedLogins()
        {
            FailedLoginCount = 0;
            LockoutEnd = null;

        }

        public bool IsLocked() => LockoutEnd.HasValue && LockoutEnd > DateTime.UtcNow;

        public void Disable()
        {
            IsActive = false;
        }

        public void GenerateEmailVerificationToken(string token, DateTime expiresAt)
        {
            EmailVerificationToken = token;
            EmailVerificationTokenExpires = expiresAt;
            IsEmailVerified = false;
        }

        public void VerifyEmail(string token)
        {
            if (EmailVerificationToken != token)
                throw new InvalidOperationException("Invalid verification token");

            if (EmailVerificationTokenExpires < DateTime.UtcNow)
                throw new InvalidOperationException("Verification token expired");

            IsEmailVerified = true;
            EmailVerificationToken = null;
            EmailVerificationTokenExpires = null;
        }

        public void MarkEmailVerified()
        {
            IsEmailVerified = true;
            EmailVerificationToken = null;
            EmailVerificationTokenExpires = null;
        }

        public void LockAccount(TimeSpan duration)
        {
            LockoutEnd = DateTime.UtcNow.Add(duration);
            FailedLoginCount = 0;
        }

        public void ForceLock()
        {
            LockoutEnd = DateTime.MaxValue;
        }



    }
}
