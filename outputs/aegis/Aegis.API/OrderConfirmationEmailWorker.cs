using Aegis.Application.Common.Interfaces;
using Aegis.Infrastructure.Email;

namespace Aegis.API;

public sealed class OrderConfirmationEmailWorker : BackgroundService
{
    private const int MaxAttempts = 3;
    private readonly OrderConfirmationEmailQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<OrderConfirmationEmailWorker> _logger;

    public OrderConfirmationEmailWorker(
        OrderConfirmationEmailQueue queue,
        IServiceScopeFactory scopeFactory,
        ILogger<OrderConfirmationEmailWorker> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var message in _queue.ReadAllAsync(stoppingToken))
        {
            for (var attempt = 1; attempt <= MaxAttempts && !stoppingToken.IsCancellationRequested; attempt++)
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var emailService = scope.ServiceProvider.GetRequiredService<IEmailService>();
                    await emailService.SendOrderConfirmationAsync(message);
                    break;
                }
                catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
                {
                    if (attempt < MaxAttempts)
                    {
                        await Task.Delay(TimeSpan.FromMilliseconds(300 * attempt), stoppingToken);
                    }
                    else
                    {
                        _logger.LogError(exception,
                            "Could not deliver order confirmation for order {OrderCode}; customer email was not logged.",
                            message.OrderCode);
                    }
                }
            }
        }
    }
}
