using Aegis.Application.Common.Interfaces;
using Aegis.Domain.Common;
using Aegis.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence
{
    public class AegisDbContext : DbContext
    {
        private readonly ICurrentUserService? _currentUser;

        public AegisDbContext(DbContextOptions<AegisDbContext> options)
                     : base(options)
        {
        }

        public AegisDbContext(
            DbContextOptions<AegisDbContext> options,
            ICurrentUserService currentUser) : base(options)
        {
            _currentUser = currentUser;
        }

        public DbSet<User> Users => Set<User>();
        public DbSet<Role> Roles => Set<Role>();
        public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
        public DbSet<Permission> Permissions => Set<Permission>();
        public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
        public DbSet<UserRole> UserRoles => Set<UserRole>();
        public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
        public DbSet<SecurityAudit> SecurityAudits => Set<SecurityAudit>();
        public DbSet<Session> Sessions => Set<Session>();
        public DbSet<TrustedDevice> TrustedDevices => Set<TrustedDevice>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.ApplyConfigurationsFromAssembly(typeof(AegisDbContext).Assembly);
        }

        public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            var userId = _currentUser?.UserId;

            var entries = ChangeTracker.Entries<BaseEntity>();

            foreach (var entry in entries)
            {
                if (entry.State == EntityState.Added)
                {
                    entry.Entity.CreatedBy = userId;
                    entry.Entity.CreatedAt = DateTime.UtcNow;
                }

                if (entry.State == EntityState.Modified)
                {
                    entry.Entity.LastModifiedBy = userId;
                    entry.Entity.LastModifiedAt = DateTime.UtcNow;
                }
            }

            return await base.SaveChangesAsync(cancellationToken);
        }
    }




}
