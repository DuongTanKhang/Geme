using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Aegis.Application.Common.Models;
using Aegis.Domain.Entities;
using Aegis.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Aegis.API.Controllers;

[ApiController]
[Route("internal/email")]
public sealed class InternalOrderEmailController : ControllerBase
{
    private const string ApiKeyHeader = "X-GEME-Internal-Key";
    private static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IConfiguration _configuration;
    private readonly AegisDbContext _db;

    public InternalOrderEmailController(IConfiguration configuration, AegisDbContext db)
    {
        _configuration = configuration;
        _db = db;
    }

    [HttpPost("order-confirmation")]
    [EnableRateLimiting("internal-email")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    public async Task<IActionResult> QueueOrderConfirmation([FromBody] OrderConfirmationEmail request, CancellationToken cancellationToken)
    {
        var authError = AuthorizeInternalCaller();
        if (authError is not null) return authError;
        var idempotencyKey = Request.Headers["Idempotency-Key"].ToString();
        if (idempotencyKey.Length is < 16 or > 128 || idempotencyKey.Any(character =>
                !(char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or ':' or '-')))
        {
            return BadRequest(new { message = "A valid Idempotency-Key header is required." });
        }

        var payloadJson = JsonSerializer.Serialize(request, PayloadJsonOptions);
        var requestHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payloadJson))).ToLowerInvariant();
        var existing = await _db.InternalEmailDeliveries.AsNoTracking()
            .SingleOrDefaultAsync(delivery => delivery.IdempotencyKey == idempotencyKey, cancellationToken);
        if (existing is not null) return ExistingResult(existing, requestHash);

        var delivery = new InternalEmailDelivery(idempotencyKey, requestHash, InternalEmailPayloadProtector.Encrypt(payloadJson, _configuration["InternalApi:OrderEmailKey"]!));
        _db.InternalEmailDeliveries.Add(delivery);
        try
        {
            await _db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // A parallel request with the same key may have won the unique-index race.
            _db.ChangeTracker.Clear();
            var raced = await _db.InternalEmailDeliveries.AsNoTracking()
                .SingleOrDefaultAsync(item => item.IdempotencyKey == idempotencyKey, cancellationToken);
            if (raced is null) throw;
            return ExistingResult(raced, requestHash);
        }

        return Accepted(new { queued = true, status = delivery.Status });
    }

    [HttpGet("order-confirmation/{idempotencyKey}")]
    [EnableRateLimiting("internal-email")]
    public async Task<IActionResult> GetOrderConfirmationStatus(string idempotencyKey, CancellationToken cancellationToken)
    {
        var authError = AuthorizeInternalCaller();
        if (authError is not null) return authError;
        if (idempotencyKey.Length is < 16 or > 128 || idempotencyKey.Any(character =>
                !(char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or ':' or '-')))
        {
            return BadRequest(new { message = "The Idempotency-Key is invalid." });
        }

        var delivery = await _db.InternalEmailDeliveries.AsNoTracking()
            .SingleOrDefaultAsync(item => item.IdempotencyKey == idempotencyKey, cancellationToken);
        if (delivery is null) return NotFound();
        var status = PublicStatus(delivery);
        return status == "UNKNOWN"
            ? StatusCode(StatusCodes.Status503ServiceUnavailable, new { status, retryAllowed = false })
            : Ok(new { status, sentAt = delivery.SentAt });
    }

    private IActionResult ExistingResult(InternalEmailDelivery delivery, string requestHash)
    {
        if (!CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(delivery.RequestHash),
                Convert.FromHexString(requestHash)))
        {
            return Conflict(new { message = "The Idempotency-Key was already used with a different request." });
        }

        var status = PublicStatus(delivery);
        if (status == "SENT") return Ok(new { queued = false, status, sentAt = delivery.SentAt });
        if (status == "UNKNOWN") return StatusCode(StatusCodes.Status503ServiceUnavailable, new { status, retryAllowed = false });
        return Accepted(new { queued = true, status });
    }

    private string PublicStatus(InternalEmailDelivery delivery)
    {
        if (delivery.Status == "SENDING" && DateTime.UtcNow - (delivery.LastModifiedAt ?? delivery.CreatedAt) > TimeSpan.FromMinutes(2))
            return "UNKNOWN";
        return delivery.Status;
    }

    private IActionResult? AuthorizeInternalCaller()
    {
        var expectedKey = _configuration["InternalApi:OrderEmailKey"];
        var suppliedKey = Request.Headers[ApiKeyHeader].ToString();
        if (string.IsNullOrWhiteSpace(expectedKey) || Encoding.UTF8.GetByteCount(expectedKey) < 32)
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Internal email is not configured." });
        if (string.IsNullOrEmpty(suppliedKey) || suppliedKey.Length > 512) return Unauthorized();
        var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(suppliedKey));
        var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(expectedKey));
        return CryptographicOperations.FixedTimeEquals(suppliedHash, expectedHash) ? null : Unauthorized();
    }
}
