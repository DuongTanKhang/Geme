using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Domain.Security
{
    public static class TokenHasher
    {
        public static byte[] HashToken(string token)
        {
            using var sha = SHA256.Create();
            return sha.ComputeHash(Encoding.UTF8.GetBytes(token));
        }

    }
}
