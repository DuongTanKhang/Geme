using Aegis.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Metadata.Conventions.Infrastructure;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence.Configuaration
{
    public class TrustDeviceConfiguaration : IEntityTypeConfiguration<TrustedDevice>
    {
        public void Configure(EntityTypeBuilder<TrustedDevice> builder)
        {
            builder.ToTable("TrustDevice");

            builder.HasKey(x => x.Id);

            builder.Property(x => x.UserId)
                .IsRequired();

            builder.Property(x => x.DeviceName)
                .HasMaxLength(200);

            builder.Property(x => x.IpAddress)
                .HasMaxLength(45);

            builder.Property(x => x.UserAgent);

            builder.Property(x => x.CreatedAt)
                .IsRequired();

            builder.Property(x => x.ExpiryTime)
                .IsRequired();

            builder.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        }
    }
}
