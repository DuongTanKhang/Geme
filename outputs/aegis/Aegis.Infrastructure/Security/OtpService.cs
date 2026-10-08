using System.Security.Cryptography;
using System.Text;
using Aegis.Application.Common.Enums;
using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Caching.Memory;
using StackExchange.Redis;
using Aegis.Infrastructure.Email;

namespace Aegis.Infrastructure.Security;

public sealed class OtpService : IOtpService
{
    private const string KeyPrefix = "aegis:otp";

    private readonly IConnectionMultiplexer _redis;
    private readonly IDatabase _database;
    private readonly IMemoryCache _memoryCache;
    private readonly OtpEmailQueue _emailQueue;
    private readonly OtpOptions _options;

    public OtpService(
        IConnectionMultiplexer redis,
        IMemoryCache memoryCache,
        OtpEmailQueue emailQueue,
        IOptions<OtpOptions> options)
    {
        _redis = redis;
        _database = redis.GetDatabase();
        _memoryCache = memoryCache;
        _emailQueue = emailQueue;
        _options = options.Value;
    }

    public int CodeLength => Math.Clamp(_options.CodeLength, 6, 10);
    public int LifetimeMinutes => Math.Max(1, _options.LifetimeMinutes);
    public int ResendCooldownSeconds => Math.Max(1, _options.ResendCooldownSeconds);

    public async Task<int> GenerateAndSendOtpAsync(
        Guid userId,
        string email,
        string customerName,
        OtpPurpose purpose = OtpPurpose.Login)
    {
        EnsureConfigured();

        var cooldownKey = CooldownKey(userId, purpose);
        var cooldown = TimeSpan.FromSeconds(ResendCooldownSeconds);
        var reserved = _redis.IsConnected
            ? await _database.StringSetAsync(cooldownKey, "1", cooldown, When.NotExists)
            : ReserveMemoryCooldown(cooldownKey, cooldown);

        if (!reserved)
            throw new BadRequestException("Vui lòng chờ trước khi yêu cầu mã xác nhận mới.");

        var otp = string.Concat(Enumerable.Range(0, CodeLength)
            .Select(_ => RandomNumberGenerator.GetInt32(0, 10).ToString()));
        var deliveryId = Guid.NewGuid().ToString("N");
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = ComputeHash(userId, email, purpose, otp, salt);
        var value = $"{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
        var lifetime = TimeSpan.FromMinutes(LifetimeMinutes);

        if (_redis.IsConnected)
        {
            await Task.WhenAll(
                _database.StringSetAsync(OtpKey(userId, purpose), value, lifetime),
                _database.StringSetAsync(DeliveryKey(userId, purpose), deliveryId, lifetime),
                _database.KeyDeleteAsync(AttemptsKey(userId, purpose)));
        }
        else
        {
            _memoryCache.Set(OtpKey(userId, purpose), new MemoryOtp(value, deliveryId), lifetime);
        }

        if (!_emailQueue.TryEnqueue(new OtpEmailMessage(
                userId, email, customerName, otp, lifetime, purpose, deliveryId)))
        {
            await DeleteAsync(userId, purpose, includeCooldown: true);
            throw new InvalidOperationException("Email queue is temporarily full. Please retry shortly.");
        }

        return ResendCooldownSeconds;
    }

    public async Task InvalidatePendingDeliveryAsync(
        Guid userId,
        OtpPurpose purpose,
        string deliveryId)
    {
        if (_redis.IsConnected)
        {
            const string invalidateIfCurrent = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4]) else return 0 end";
            await _database.ScriptEvaluateAsync(
                invalidateIfCurrent,
                new RedisKey[]
                {
                    DeliveryKey(userId, purpose),
                    OtpKey(userId, purpose),
                    AttemptsKey(userId, purpose),
                    CooldownKey(userId, purpose)
                },
                new RedisValue[] { deliveryId });
            return;
        }

        var current = _memoryCache.Get<MemoryOtp>(OtpKey(userId, purpose));
        if (current?.DeliveryId == deliveryId)
            await DeleteAsync(userId, purpose, includeCooldown: true);
    }

    public async Task<bool> IsPendingDeliveryAsync(
        Guid userId,
        OtpPurpose purpose,
        string deliveryId)
    {
        if (_redis.IsConnected)
        {
            var current = await _database.StringGetAsync(DeliveryKey(userId, purpose));
            return current == deliveryId;
        }

        return _memoryCache.Get<MemoryOtp>(OtpKey(userId, purpose))?.DeliveryId == deliveryId;
    }

    public async Task<OtpVerificationResult> VerifyAsync(
        Guid userId,
        string email,
        string otp,
        OtpPurpose purpose = OtpPurpose.Login)
    {
        if (string.IsNullOrWhiteSpace(otp) || otp.Length != CodeLength || !otp.All(char.IsDigit))
            return OtpVerificationResult.Invalid;

        EnsureConfigured();

        var stored = _redis.IsConnected
            ? (await _database.StringGetAsync(OtpKey(userId, purpose))).ToString()
            : _memoryCache.Get<MemoryOtp>(OtpKey(userId, purpose))?.Value;
        if (string.IsNullOrWhiteSpace(stored))
            return OtpVerificationResult.ExpiredOrAlreadyUsed;

        var parts = stored.Split('.', 2);
        if (parts.Length != 2)
        {
            await DeleteAsync(userId, purpose, includeCooldown: false);
            return OtpVerificationResult.ExpiredOrAlreadyUsed;
        }

        byte[] salt;
        byte[] expectedHash;
        try
        {
            salt = Convert.FromBase64String(parts[0]);
            expectedHash = Convert.FromBase64String(parts[1]);
        }
        catch (FormatException)
        {
            await DeleteAsync(userId, purpose, includeCooldown: false);
            return OtpVerificationResult.ExpiredOrAlreadyUsed;
        }

        var actualHash = ComputeHash(userId, email, purpose, otp, salt);
        if (!CryptographicOperations.FixedTimeEquals(actualHash, expectedHash))
        {
            var attempts = await IncrementAttemptsAsync(userId, purpose);

            if (attempts >= Math.Max(1, _options.MaxAttempts))
            {
                await DeleteAsync(userId, purpose, includeCooldown: false);
                return OtpVerificationResult.AttemptsExceeded;
            }

            return OtpVerificationResult.Invalid;
        }

        await DeleteAsync(userId, purpose, includeCooldown: true);
        return OtpVerificationResult.Valid;
    }

    private byte[] ComputeHash(Guid userId, string email, OtpPurpose purpose, string otp, byte[] salt)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_options.HashingKey));
        return hmac.ComputeHash(Encoding.UTF8.GetBytes(
            $"{userId:N}:{email.Trim().ToLowerInvariant()}:{purpose}:{Convert.ToBase64String(salt)}:{otp}"));
    }

    private void EnsureConfigured()
    {
        if (string.IsNullOrWhiteSpace(_options.HashingKey) || _options.HashingKey.Length < 32)
            throw new InvalidOperationException("Otp__HashingKey phải có ít nhất 32 ký tự.");
    }

    private static string PurposeKey(Guid userId, OtpPurpose purpose)
        => purpose == OtpPurpose.Login ? $"{KeyPrefix}:{userId:N}" : $"{KeyPrefix}:{purpose}:{userId:N}";
    private static string OtpKey(Guid userId, OtpPurpose purpose) => $"{PurposeKey(userId, purpose)}:value";
    private static string DeliveryKey(Guid userId, OtpPurpose purpose) => $"{PurposeKey(userId, purpose)}:delivery";
    private static string AttemptsKey(Guid userId, OtpPurpose purpose) => $"{PurposeKey(userId, purpose)}:attempts";
    private static string CooldownKey(Guid userId, OtpPurpose purpose) => $"{PurposeKey(userId, purpose)}:cooldown";

    private bool ReserveMemoryCooldown(string key, TimeSpan cooldown)
    {
        if (_memoryCache.TryGetValue(key, out _))
            return false;

        _memoryCache.Set(key, true, cooldown);
        return true;
    }

    private async Task<long> IncrementAttemptsAsync(Guid userId, OtpPurpose purpose)
    {
        if (_redis.IsConnected)
        {
            var attempts = await _database.StringIncrementAsync(AttemptsKey(userId, purpose));
            if (attempts == 1)
                await _database.KeyExpireAsync(AttemptsKey(userId, purpose), TimeSpan.FromMinutes(Math.Max(1, _options.LifetimeMinutes)));
            return attempts;
        }

        var entry = _memoryCache.Get<MemoryOtp>(OtpKey(userId, purpose));
        if (entry is null)
            return 0;

        entry.Attempts++;
        return entry.Attempts;
    }

    private async Task DeleteAsync(Guid userId, OtpPurpose purpose, bool includeCooldown)
    {
        if (_redis.IsConnected)
        {
            var keys = includeCooldown
                ? new RedisKey[] { OtpKey(userId, purpose), DeliveryKey(userId, purpose), AttemptsKey(userId, purpose), CooldownKey(userId, purpose) }
                : new RedisKey[] { OtpKey(userId, purpose), DeliveryKey(userId, purpose), AttemptsKey(userId, purpose) };
            await _database.KeyDeleteAsync(keys);
            return;
        }

        _memoryCache.Remove(OtpKey(userId, purpose));
        if (includeCooldown)
            _memoryCache.Remove(CooldownKey(userId, purpose));
    }

    private sealed class MemoryOtp(string value, string deliveryId)
    {
        public string Value { get; } = value;
        public string DeliveryId { get; } = deliveryId;
        public int Attempts { get; set; }
    }
}
