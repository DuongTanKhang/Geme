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
    public class RolePermissionConfiguaration : IEntityTypeConfiguration<RolePermission>
    {
        public void Configure(EntityTypeBuilder<RolePermission> builder)
        {
            builder.ToTable("RolePermissions");

            builder.HasKey(rp => new { rp.RoleId, rp.PermissionId });

            builder.HasOne(rp => rp.Role)
                   .WithMany()
                   .HasForeignKey(rp => rp.RoleId);

            builder.HasOne(rp => rp.Permission)
                   .WithMany()
                   .HasForeignKey(rp => rp.PermissionId);

            builder.HasIndex(rp => rp.PermissionId);

        }
    }
}
