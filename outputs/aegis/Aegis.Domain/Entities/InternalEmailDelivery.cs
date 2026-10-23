using Aegis.Domain.Common;

namespace Aegis.Domain.Entities;

/// <summary>
/// Durable, at-most-once state for internal GEME order-confirmation email.
/// The temporary payload is cleared as soon as delivery reaches a terminal state.
/// </summary>
public sealed class InternalEmailDelivery : BaseEntity
{
    public string IdempotencyKey { get; private set; } = null!;
    public string RequestHash { get; private set; } = null!;
    public string Status { get; private set; } = null!;
    public string? PayloadJson { get; private set; }
    public DateTime? SentAt { get; private set; }
    public string? LastErrorCode { get; private set; }

    private InternalEmailDelivery() { }

    public InternalEmailDelivery(string idempotencyKey, string requestHash, string payloadJson)
    {
        IdempotencyKey = idempotencyKey;
        RequestHash = requestHash;
        PayloadJson = payloadJson;
        Status = "QUEUED";
    }

    public void MarkSent(DateTime sentAt)
    {
        Status = "SENT";
        SentAt = sentAt;
        PayloadJson = null;
        LastErrorCode = null;
    }

    public void MarkUnknown(string errorCode)
    {
        Status = "UNKNOWN";
        PayloadJson = null;
        LastErrorCode = errorCode.Length > 64 ? errorCode[..64] : errorCode;
    }
}
