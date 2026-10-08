using System.Net;
using System.Net.Mail;
using Aegis.Application.Common.Interfaces;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Aegis.Infrastructure.Email;

public sealed class EmailService : IEmailService
{
    private readonly EmailOptions _options;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IOptions<EmailOptions> options, ILogger<EmailService> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public Task SendVerifyEmailAsync(string email, string token)
    {
        var baseUrl = _options.PublicBaseUrl.TrimEnd('/');
        var verifyLink = $"{baseUrl}/auth/verify-email?token={Uri.EscapeDataString(token)}";
        var encodedLink = WebUtility.HtmlEncode(verifyLink);

        var html = $$"""
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033">
              <h2 style="color:#3157d5">Xác nhận email Aegis</h2>
              <p>Nhấn nút bên dưới để xác nhận địa chỉ email của bạn.</p>
              <p style="margin:28px 0">
                <a href="{{encodedLink}}" style="background:#3157d5;color:white;padding:12px 20px;text-decoration:none;border-radius:8px">Xác nhận email</a>
              </p>
              <p style="font-size:13px;color:#667085">Liên kết hết hạn sau 24 giờ. Nếu bạn không tạo tài khoản, hãy bỏ qua email này.</p>
            </div>
            """;

        return SendInternalAsync(email, "Xác nhận email Aegis", html, $"Xác nhận email tại: {verifyLink}");
    }

    public Task SendRegistrationOtpAsync(string email, string customerName, string otp, TimeSpan lifetime)
    {
        var safeName = string.IsNullOrWhiteSpace(customerName)
            ? "bạn"
            : WebUtility.HtmlEncode(customerName.Trim());
        var safeSupportEmail = WebUtility.HtmlEncode(_options.SupportEmail);
        var durationMinutes = Math.Max(1, (int)Math.Ceiling(lifetime.TotalMinutes));
        var duration = $"{durationMinutes} phút";
        var year = DateTime.Now.Year;
        var safeOtp = WebUtility.HtmlEncode(otp);

        var html = $$"""
            <!doctype html>
            <html lang="vi">
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <meta name="color-scheme" content="light">
                <title>Mã xác nhận tài khoản GEME</title>
              </head>
              <body style="margin:0;padding:24px 12px;background:#FAFAF7;color:#103F35;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6">
                <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Sử dụng mã trong email để hoàn tất đăng ký tài khoản GEME.</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;margin:0 auto;border:1px solid #D9E2DD;border-collapse:separate;background:#FAFAF7">
                  <tr>
                    <td style="padding:28px 32px 24px;border-bottom:1px solid #D9E2DD">
                      <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:5px;color:#103F35">✦ GEME</div>
                      <div style="margin-top:2px;font-size:11px;letter-spacing:1.2px;color:#63766F">Natural Gemstones · Fine Jewelry · For You</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:28px 32px 32px">
                      <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:normal;line-height:1.25;color:#103F35">Xác nhận email của bạn</h1>
                      <p style="margin:0 0 12px">Chào {{safeName}},</p>
                      <p style="margin:0 0 12px">Cảm ơn bạn đã bắt đầu câu chuyện cùng GEME.</p>
                      <p style="margin:0 0 20px">Vui lòng nhập mã dưới đây tại màn hình xác nhận để hoàn tất đăng ký tài khoản:</p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 18px;background:#EAF1EC;border:1px solid #D3E1D9">
                        <tr><td align="center" style="padding:17px 12px;font-family:Arial,Helvetica,sans-serif;font-size:34px;font-weight:bold;letter-spacing:8px;line-height:1.3;color:#103F35;white-space:nowrap">{{safeOtp}}</td></tr>
                      </table>
                      <p style="margin:0 0 12px">Mã có hiệu lực trong {{duration}} và chỉ sử dụng một lần.</p>
                      <p style="margin:0 0 12px">Để bảo vệ tài khoản, vui lòng không chia sẻ mã này với bất kỳ ai.</p>
                      <p style="margin:0 0 22px">Nếu bạn không yêu cầu tạo tài khoản GEME, bạn có thể bỏ qua email này.</p>
                      <p style="margin:0">Hẹn gặp bạn tại GEME,<br>Đội ngũ GEME</p>
                      <p style="margin:22px 0 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;color:#49665C">More than just jewelry. It’s a story of you.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 32px;border-top:1px solid #D9E2DD;font-size:13px;color:#63766F">
                      Cần hỗ trợ? Liên hệ {{safeSupportEmail}}<br>
                      © {{year}} GEME. All rights reserved.
                    </td>
                  </tr>
                </table>
              </body>
            </html>
            """;

        var greeting = string.IsNullOrWhiteSpace(customerName) ? "Chào bạn," : $"Chào {customerName.Trim()},";
        var plainText = $"""
GEME
Natural Gemstones · Fine Jewelry · For You

Xác nhận email của bạn

{greeting}

Cảm ơn bạn đã bắt đầu câu chuyện cùng GEME.

Vui lòng nhập mã dưới đây tại màn hình xác nhận để hoàn tất đăng ký tài khoản:

{otp}

Mã có hiệu lực trong {duration} và chỉ sử dụng một lần.

Để bảo vệ tài khoản, vui lòng không chia sẻ mã này với bất kỳ ai.

Nếu bạn không yêu cầu tạo tài khoản GEME, bạn có thể bỏ qua email này.

Hẹn gặp bạn tại GEME,
Đội ngũ GEME

More than just jewelry. It’s a story of you.

Cần hỗ trợ? Liên hệ {_options.SupportEmail}
© {year} GEME. All rights reserved.
""";

        return SendInternalAsync(email, "Mã xác nhận tài khoản GEME", html, plainText);
    }

    public Task SendAsync(string to, string subject, string body)
    {
        var encodedBody = WebUtility.HtmlEncode(body);
        var html = $$"""
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#172033">
              <h2 style="color:#3157d5">Aegis Security</h2>
              <div style="font-size:17px;line-height:1.6">{{encodedBody}}</div>
              <p style="font-size:13px;color:#667085;margin-top:28px">Không chia sẻ mã này với bất kỳ ai.</p>
            </div>
            """;

        return SendInternalAsync(to, subject, html, body);
    }

    private async Task SendInternalAsync(string to, string subject, string html, string plainText)
    {
        EnsureConfigured();

        using var message = new MailMessage
        {
            From = new MailAddress(_options.FromEmail, _options.FromName),
            Subject = subject,
            Body = html,
            IsBodyHtml = true
        };
        message.To.Add(new MailAddress(to));
        message.AlternateViews.Add(
            AlternateView.CreateAlternateViewFromString(plainText, null, "text/plain"));

        using var client = new SmtpClient(_options.Host, _options.Port)
        {
            EnableSsl = _options.EnableSsl,
            UseDefaultCredentials = false,
            Credentials = new NetworkCredential(_options.Username, _options.Password),
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Timeout = 15000
        };

        try
        {
            await client.SendMailAsync(message);
        }
        catch (SmtpException ex)
        {
            _logger.LogError(ex, "SMTP rejected email to {Recipient}", to);
            throw new InvalidOperationException("Không thể gửi email lúc này. Vui lòng thử lại sau.", ex);
        }

        _logger.LogInformation("Email {Subject} sent to {Recipient}", subject, to);
    }

    private void EnsureConfigured()
    {
        if (string.IsNullOrWhiteSpace(_options.Host) ||
            string.IsNullOrWhiteSpace(_options.Username) ||
            string.IsNullOrWhiteSpace(_options.Password) ||
            string.IsNullOrWhiteSpace(_options.FromEmail))
        {
            throw new InvalidOperationException(
                "Email chưa được cấu hình. Hãy đặt Email:Username, Email:Password và Email:FromEmail.");
        }
    }
}
