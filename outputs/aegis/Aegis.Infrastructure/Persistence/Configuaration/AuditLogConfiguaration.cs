using Aegis.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;


namespace Aegis.Infrastructure.Persistence.Configuaration
{
    public class AuditLogConfiguaration : IEntityTypeConfiguration<AuditLog>
    {
        public void Configure(EntityTypeBuilder<AuditLog> builder)
        {
            builder.ToTable("AuditLogs");

            builder.HasKey(al => al.Id);

            builder.Property(al => al.UserId).IsRequired(false);

            builder.Property(al => al.Action).IsRequired();

            builder.Property(al => al.IpAddress).HasMaxLength(45);
        }
    }
}
