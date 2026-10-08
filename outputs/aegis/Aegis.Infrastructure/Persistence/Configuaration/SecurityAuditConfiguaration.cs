using Aegis.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence.Configuaration
{
    public class SecurityAuditConfiguaration : IEntityTypeConfiguration<SecurityAudit>
    {
        public void Configure(EntityTypeBuilder<SecurityAudit> builder)
        {
            builder.ToTable("SecurityAudits");

            builder.HasKey(e => e.Id);

            builder.Property(e => e.UserId)
                .IsRequired(false);
            builder.Property(e => e.Action)
                .IsRequired()
                .HasMaxLength(256);
            builder.Property(e => e.IpAddress)
                .HasMaxLength(45);


        }
    }
}
