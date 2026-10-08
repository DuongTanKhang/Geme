using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Enums;
using Aegis.Infrastructure.Email;

namespace Aegis.API;

public sealed class OtpEmailWorker : BackgroundService
{
    private const int WorkerCount = 4;
    private const int MaxAttempts = 3;
    private readonly OtpEmailQueue _queue;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<OtpEmailWorker> _logger;

    public OtpEmailWorker(
        OtpEmailQueue queue,
        IServiceScopeFactory scopeFactory,
        ILogger<OtpEmailWorker> logger)
    {
        _queue = queue;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var workers = Enumerable.Range(0, WorkerCount)
            .Select(_ => ProcessQueueAsync(stoppingToken));
        await Task.WhenAll(workers);
    }

    private async Task ProcessQueueAsync(CancellationToken stoppingToken)
    {
        await foreach (var message in _queue.ReadAllAsync(stoppingToken))
        {
            var delivered = false;
            for (var attempt = 1; attempt <= MaxAttempts && !stoppingToken.IsCancellationRequested; attempt++)
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var otpService = scope.ServiceProvider.GetRequiredService<IOtpService>();
                    if (!await otpService.IsPendingDeliveryAsync(
                            message.UserId, message.Purpose, message.DeliveryId))
                    {
                        delivered = true;
                        break;
                    }

                    var emailService = scope.ServiceProvider.GetRequiredService<IEmailService>();
                    if (message.Purpose == OtpPurpose.RegistrationEmailVerification)
                    {
                        await emailService.SendRegistrationOtpAsync(
                            message.Email, message.CustomerName, message.Code, message.Lifetime);
                    }
                    else
                    {
                        await emailService.SendAsync(
                            message.Email,
                            "Mã xác nhận đăng nhập GEME",
                            $"Mã xác nhận đăng nhập của bạn là: {message.Code}. Mã có hiệu lực trong {(int)message.Lifetime.TotalMinutes} phút.");
                    }

                    delivered = true;
                    break;
                }
                catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
                {
                    if (attempt < MaxAttempts)
                    {
                        await Task.Delay(TimeSpan.FromMilliseconds(250 * attempt), stoppingToken);
                    }
                    else
                    {
                        _logger.LogError(exception,
                            "Failed to deliver OTP email for user {UserId}; no OTP value was logged.",
                            message.UserId);
                    }
                }
            }

            if (!delivered && !stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var otpService = scope.ServiceProvider.GetRequiredService<IOtpService>();
                    await otpService.InvalidatePendingDeliveryAsync(
                        message.UserId, message.Purpose, message.DeliveryId);
                }
                catch (Exception exception)
                {
                    _logger.LogError(exception,
                        "Could not invalidate undelivered OTP for user {UserId}.", message.UserId);
                }
            }
        }
    }
}
