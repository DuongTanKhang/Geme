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
    public class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
    {
        public void Configure(EntityTypeBuilder<RefreshToken> builder)
        {
            builder.ToTable("RefreshTokens");

            builder.HasKey(rt => rt.Id);

            builder.Property(rt => rt.TokenHash)
                .IsRequired()
                .HasColumnType("varbinary(32)");

            builder.HasIndex(rt => rt.TokenHash)
                .IsUnique();

            builder.Property(rt => rt.RevokedAt)
                .IsRequired(false);

            builder.Property(rt => rt.CreatedByIp)
                .HasMaxLength(45);

            builder.Property(rt => rt.RevokedByIp)
                .HasMaxLength(45);

            builder.HasOne(rt => rt.ReplacedByToken)
                .WithMany()
                .HasForeignKey(rt => rt.ReplacedByTokenId)
                .OnDelete(DeleteBehavior.NoAction);

            builder.HasOne(rt => rt.User)
                .WithMany()
                .HasForeignKey(rt => rt.UserId)
                .OnDelete(DeleteBehavior.Restrict);
        }
    }
}
