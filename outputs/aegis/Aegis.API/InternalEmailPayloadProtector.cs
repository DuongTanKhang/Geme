using System.Security.Cryptography;
using System.Text;

namespace Aegis.API;

internal static class InternalEmailPayloadProtector
{
    private const byte FormatVersion = 1;
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private static readonly byte[] KeyContext = Encoding.UTF8.GetBytes("GEME internal order email payload v1\0");

    public static string Encrypt(string plaintext, string secret)
    {
        var key = DeriveKey(secret);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var cleartext = Encoding.UTF8.GetBytes(plaintext);
        var ciphertext = new byte[cleartext.Length];
        var tag = new byte[TagSize];
        using (var aes = new AesGcm(key, TagSize)) aes.Encrypt(nonce, cleartext, ciphertext, tag);

        var envelope = new byte[1 + NonceSize + TagSize + ciphertext.Length];
        envelope[0] = FormatVersion;
        nonce.CopyTo(envelope, 1);
        tag.CopyTo(envelope, 1 + NonceSize);
        ciphertext.CopyTo(envelope, 1 + NonceSize + TagSize);
        CryptographicOperations.ZeroMemory(key);
        CryptographicOperations.ZeroMemory(cleartext);
        return Convert.ToBase64String(envelope);
    }

    public static string Decrypt(string encryptedPayload, string secret)
    {
        byte[] envelope;
        try { envelope = Convert.FromBase64String(encryptedPayload); }
        catch (FormatException exception) { throw new CryptographicException("Invalid order email payload envelope.", exception); }
        if (envelope.Length < 1 + NonceSize + TagSize || envelope[0] != FormatVersion)
            throw new CryptographicException("Unsupported order email payload envelope.");

        var key = DeriveKey(secret);
        var nonce = envelope.AsSpan(1, NonceSize);
        var tag = envelope.AsSpan(1 + NonceSize, TagSize);
        var ciphertext = envelope.AsSpan(1 + NonceSize + TagSize);
        var cleartext = new byte[ciphertext.Length];
        try
        {
            using var aes = new AesGcm(key, TagSize);
            aes.Decrypt(nonce, ciphertext, tag, cleartext);
            return Encoding.UTF8.GetString(cleartext);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(cleartext);
        }
    }

    private static byte[] DeriveKey(string secret)
    {
        if (Encoding.UTF8.GetByteCount(secret) < 32) throw new CryptographicException("Internal email secret is too short.");
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(KeyContext);
        hash.AppendData(Encoding.UTF8.GetBytes(secret));
        return hash.GetHashAndReset();
    }
}
