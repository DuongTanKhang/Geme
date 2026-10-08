using System.Diagnostics;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using Aegis.Domain.Entities;
using Aegis.Infrastructure.Persistence;

namespace Aegis.API;

public sealed class AuthenticationWarmupService : IHostedService
{
    private const string ProbeEmail = "aegis-auth-warmup@invalid.local";
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AuthenticationWarmupService> _logger;

    public AuthenticationWarmupService(
        IServiceScopeFactory scopeFactory,
        ILogger<AuthenticationWarmupService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        using var scope = _scopeFactory.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<IUserRepository>();
        var passwordHasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();

        await users.ExistsByEmailAsync(ProbeEmail);
        await users.GetByEmailAsync(ProbeEmail);
        cancellationToken.ThrowIfCancellationRequested();

        const string warmupPassword = "Warmup-only-password-not-for-users!";
        var hash = passwordHasher.Hash(warmupPassword);
        _ = passwordHasher.Verify(warmupPassword, hash);

        // Exercise EF's first INSERT/SaveChanges path before the first real signup.
        // The transaction is always rolled back, so no synthetic account is retained.
        var dbContext = scope.ServiceProvider.GetRequiredService<AegisDbContext>();
        await using (var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken))
        {
            var warmupUser = new User(
                "Authentication warmup",
                $"aegis-auth-warmup-{Guid.NewGuid():N}@example.invalid",
                System.Text.Encoding.UTF8.GetBytes(hash));
            await users.AddAsync(warmupUser);
            await transaction.RollbackAsync(cancellationToken);
        }

        stopwatch.Stop();
        _logger.LogInformation(
            "Authentication warmup completed in {ElapsedMs} ms.", stopwatch.ElapsedMilliseconds);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
