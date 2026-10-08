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
    public class SessionConfiguration : IEntityTypeConfiguration<Session>
    {
        public void Configure(EntityTypeBuilder<Session> builder)
        {
            builder.ToTable("Sessions");

            builder.HasKey(x => x.Id);

            builder.Property(x => x.DeviceName)
                .IsRequired()
                .HasMaxLength(200);

            builder.Property(x => x.UserAgent)
                .HasMaxLength(500);

            builder.Property(x => x.IpAddress)
                .HasMaxLength(45);

            builder.Property(x => x.CreatedAt)
                .IsRequired();

            builder.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.HasIndex(x => x.UserId);
        }
    }
}
