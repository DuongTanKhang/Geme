using System.Text.Json;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Models;
using Aegis.Domain.Entities;
using Aegis.Infrastructure.Persistence;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;

namespace Aegis.API;

/// <summary>
/// Polls the SQL-backed email outbox. A request is durably claimed before SMTP
/// is called; an ambiguous SMTP result is terminal and is never retried here.
/// </summary>
public sealed class OrderConfirmationEmailWorker : BackgroundService
{
    private static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<OrderConfirmationEmailWorker> _logger;
    private readonly IConfiguration _configuration;

    public OrderConfirmationEmailWorker(IServiceScopeFactory scopeFactory, ILogger<OrderConfirmationEmailWorker> logger, IConfiguration configuration)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _configuration = configuration;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await ProcessOneAsync(stoppingToken)) continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogError("Order email outbox polling failed ({ErrorType}).", exception.GetType().Name);
            }

            await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
        }
    }

    private async Task<bool> ProcessOneAsync(CancellationToken cancellationToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AegisDbContext>();
        var candidateId = await db.InternalEmailDeliveries.AsNoTracking()
            .Where(delivery => delivery.Status == "QUEUED")
            .OrderBy(delivery => delivery.CreatedAt)
            .Select(delivery => delivery.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (candidateId == Guid.Empty) return false;

        var claimedAt = DateTime.UtcNow;
        var claimed = await db.InternalEmailDeliveries
            .Where(delivery => delivery.Id == candidateId && delivery.Status == "QUEUED")
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(delivery => delivery.Status, "SENDING")
                .SetProperty(delivery => delivery.LastModifiedAt, claimedAt), cancellationToken);
        if (claimed != 1) return true;

        var delivery = await db.InternalEmailDeliveries.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == candidateId, cancellationToken);
        if (delivery is null) return true;

        try
        {
            var secret = _configuration["InternalApi:OrderEmailKey"] ?? string.Empty;
            var json = InternalEmailPayloadProtector.Decrypt(delivery.PayloadJson ?? string.Empty, secret);
            var message = JsonSerializer.Deserialize<OrderConfirmationEmail>(json, PayloadJsonOptions)
                ?? throw new JsonException("The stored order email payload is empty.");
            var emailService = scope.ServiceProvider.GetRequiredService<IEmailService>();
            await emailService.SendOrderConfirmationAsync(message);
            await db.InternalEmailDeliveries
                .Where(item => item.Id == delivery.Id && item.Status == "SENDING")
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(item => item.Status, "SENT")
                    .SetProperty(item => item.SentAt, DateTime.UtcNow)
                    .SetProperty(item => item.PayloadJson, (string?)null)
                    .SetProperty(item => item.LastErrorCode, (string?)null)
                    .SetProperty(item => item.LastModifiedAt, DateTime.UtcNow), cancellationToken);
        }
        catch (Exception exception)
        {
            // SMTP may accept a message and still return an error. Never retry automatically.
            await db.InternalEmailDeliveries
                .Where(item => item.Id == delivery.Id && item.Status == "SENDING")
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(item => item.Status, "UNKNOWN")
                    .SetProperty(item => item.PayloadJson, (string?)null)
                    .SetProperty(item => item.LastErrorCode, exception.GetType().Name.Length > 64 ? exception.GetType().Name[..64] : exception.GetType().Name)
                    .SetProperty(item => item.LastModifiedAt, DateTime.UtcNow), cancellationToken);
            _logger.LogWarning("Order confirmation result is unknown for {DeliveryId} ({ErrorType}); automatic retry is disabled.", delivery.Id, exception.GetType().Name);
        }

        return true;
    }
}
