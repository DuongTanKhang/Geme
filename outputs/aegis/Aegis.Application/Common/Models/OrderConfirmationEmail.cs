using System.ComponentModel.DataAnnotations;

namespace Aegis.Application.Common.Models;

public sealed record OrderConfirmationEmail
{
    [Required, EmailAddress, MaxLength(320)]
    public required string Recipient { get; init; }

    [MaxLength(160)]
    public string? CustomerName { get; init; }

    [Required, MaxLength(80)]
    public required string OrderCode { get; init; }

    public DateTimeOffset PlacedAt { get; init; }

    [Required, MaxLength(80)]
    public required string Status { get; init; }

    [Required, MaxLength(80)]
    public required string PaymentMethod { get; init; }

    [MaxLength(80)]
    public string? PaymentStatus { get; init; }

    [MaxLength(2000)]
    public string? ShippingAddress { get; init; }

    [MaxLength(32)]
    public string? CustomerPhone { get; init; }

    [Range(typeof(decimal), "0", "999999999999")]
    public decimal Subtotal { get; init; }

    [Range(typeof(decimal), "0", "999999999999")]
    public decimal DiscountAmount { get; init; }

    [Range(typeof(decimal), "0", "999999999999")]
    public decimal ShippingFee { get; init; }

    [Range(typeof(decimal), "0", "999999999999")]
    public decimal TotalAmount { get; init; }

    [MaxLength(2000)]
    public string? Note { get; init; }

    [Required, MinLength(1), MaxLength(100)]
    public required IReadOnlyList<OrderConfirmationItem> Items { get; init; }
}

public sealed record OrderConfirmationItem
{
    [Required, MaxLength(240)]
    public required string ProductName { get; init; }

    [MaxLength(120)]
    public string? ProductSku { get; init; }

    [MaxLength(120)]
    public string? Quality { get; init; }

    [MaxLength(80)]
    public string? BeadSize { get; init; }

    [Range(1, 99)]
    public int Quantity { get; init; }

    [Range(typeof(decimal), "0", "999999999999")]
    public decimal UnitPrice { get; init; }

    [Range(typeof(decimal), "0", "999999999999")]
    public decimal LineTotal { get; init; }
}
