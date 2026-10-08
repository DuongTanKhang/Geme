using System.Threading.Channels;
using Aegis.Application.Common.Enums;

namespace Aegis.Infrastructure.Email;

public sealed record OtpEmailMessage(
    Guid UserId,
    string Email,
    string CustomerName,
    string Code,
    TimeSpan Lifetime,
    OtpPurpose Purpose,
    string DeliveryId);

public sealed class OtpEmailQueue
{
    private readonly Channel<OtpEmailMessage> _channel = Channel.CreateBounded<OtpEmailMessage>(
        new BoundedChannelOptions(256)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = false,
            SingleWriter = false
        });

    public bool TryEnqueue(OtpEmailMessage message) => _channel.Writer.TryWrite(message);

    public IAsyncEnumerable<OtpEmailMessage> ReadAllAsync(CancellationToken cancellationToken)
        => _channel.Reader.ReadAllAsync(cancellationToken);
}
