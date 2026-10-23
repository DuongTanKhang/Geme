using Aegis.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Aegis.Infrastructure.Persistence.Configuaration;

public sealed class InternalEmailDeliveryConfiguration : IEntityTypeConfiguration<InternalEmailDelivery>
{
    public void Configure(EntityTypeBuilder<InternalEmailDelivery> builder)
    {
        builder.ToTable("InternalEmailDeliveries", table => table.HasCheckConstraint(
            "CK_InternalEmailDeliveries_Status",
            "[Status] IN ('QUEUED', 'SENDING', 'SENT', 'UNKNOWN')"));
        builder.HasKey(x => x.Id);
        builder.Property(x => x.IdempotencyKey).HasMaxLength(128).IsRequired();
        builder.Property(x => x.RequestHash).HasMaxLength(64).IsRequired();
        builder.Property(x => x.Status).HasMaxLength(16).IsRequired();
        builder.Property(x => x.PayloadJson).HasColumnType("nvarchar(max)");
        builder.Property(x => x.LastErrorCode).HasMaxLength(64);
        builder.HasIndex(x => x.IdempotencyKey).IsUnique();
        builder.HasIndex(x => new { x.Status, x.CreatedAt });
    }
}
