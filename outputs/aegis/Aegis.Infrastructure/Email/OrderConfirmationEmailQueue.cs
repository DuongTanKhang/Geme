using System.Threading.Channels;
using Aegis.Application.Common.Models;

namespace Aegis.Infrastructure.Email;

public sealed class OrderConfirmationEmailQueue
{
    private readonly Channel<OrderConfirmationEmail> _channel = Channel.CreateBounded<OrderConfirmationEmail>(
        new BoundedChannelOptions(256)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false
        });

    public bool TryEnqueue(OrderConfirmationEmail message) => _channel.Writer.TryWrite(message);

    public IAsyncEnumerable<OrderConfirmationEmail> ReadAllAsync(CancellationToken cancellationToken)
        => _channel.Reader.ReadAllAsync(cancellationToken);
}
