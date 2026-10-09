using System.Security.Cryptography;
using System.Text;
using Aegis.Application.Common.Models;
using Aegis.Infrastructure.Email;
using Microsoft.AspNetCore.Mvc;

namespace Aegis.API.Controllers;

[ApiController]
[Route("internal/email")]
public sealed class InternalOrderEmailController : ControllerBase
{
    private const string ApiKeyHeader = "X-GEME-Internal-Key";
    private readonly IConfiguration _configuration;
    private readonly OrderConfirmationEmailQueue _queue;

    public InternalOrderEmailController(IConfiguration configuration, OrderConfirmationEmailQueue queue)
    {
        _configuration = configuration;
        _queue = queue;
    }

    [HttpPost("order-confirmation")]
    [ProducesResponseType(StatusCodes.Status202Accepted)]
    public IActionResult QueueOrderConfirmation([FromBody] OrderConfirmationEmail request)
    {
        var expectedKey = _configuration["InternalApi:OrderEmailKey"];
        var suppliedKey = Request.Headers[ApiKeyHeader].ToString();
        if (string.IsNullOrWhiteSpace(expectedKey))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable);
        }

        if (!KeysMatch(suppliedKey, expectedKey))
        {
            return Unauthorized();
        }

        if (!_queue.TryEnqueue(request))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Email queue is temporarily full." });
        }

        return Accepted(new { queued = true });
    }

    private static bool KeysMatch(string supplied, string expected)
    {
        if (string.IsNullOrEmpty(supplied) || supplied.Length > 512) return false;
        var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(supplied));
        var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(expected));
        return CryptographicOperations.FixedTimeEquals(suppliedHash, expectedHash);
    }
}
