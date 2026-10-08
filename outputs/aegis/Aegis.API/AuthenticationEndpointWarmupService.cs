using System.Net;
using System.Text;

namespace Aegis.API;

public sealed class AuthenticationEndpointWarmupService : IHostedService
{
    private readonly IHostApplicationLifetime _applicationLifetime;
    private readonly ILogger<AuthenticationEndpointWarmupService> _logger;

    public AuthenticationEndpointWarmupService(
        IHostApplicationLifetime applicationLifetime,
        ILogger<AuthenticationEndpointWarmupService> logger)
    {
        _applicationLifetime = applicationLifetime;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _applicationLifetime.ApplicationStarted.Register(() =>
            _ = WarmRegistrationEndpointAsync(_applicationLifetime.ApplicationStopping));
        return Task.CompletedTask;
    }

    private async Task WarmRegistrationEndpointAsync(CancellationToken cancellationToken)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        const string body = "{\"name\":\"\",\"email\":\"\",\"password\":\"\"}";

        try
        {
            for (var attempt = 0; attempt < 5 && !cancellationToken.IsCancellationRequested; attempt++)
            {
                try
                {
                    using var content = new StringContent(body, Encoding.UTF8, "application/json");
                    using var response = await client.PostAsync("http://127.0.0.1:5130/auth/register", content, cancellationToken);
                    if (response.StatusCode == HttpStatusCode.BadRequest)
                    {
                        _logger.LogInformation("Registration endpoint warmup completed.");
                        return;
                    }
                }
                catch (HttpRequestException) when (attempt < 4)
                {
                    await Task.Delay(100, cancellationToken);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The host is shutting down.
        }
        catch (Exception exception)
        {
            // Warmup must never prevent the API from serving authentication requests.
            _logger.LogDebug(exception, "Registration endpoint warmup was skipped.");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
