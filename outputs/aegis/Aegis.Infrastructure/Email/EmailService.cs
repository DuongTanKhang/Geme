using System.Net;
using System.Net.Mail;
using System.Globalization;
using System.Text;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Models;
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

    public Task SendOrderConfirmationAsync(OrderConfirmationEmail order)
    {
        var safeName = string.IsNullOrWhiteSpace(order.CustomerName)
            ? "bạn"
            : WebUtility.HtmlEncode(order.CustomerName.Trim());
        var safeOrderCode = WebUtility.HtmlEncode(order.OrderCode);
        var statusLabel = OrderStatusLabel(order.Status);
        var safeStatus = WebUtility.HtmlEncode(statusLabel);
        var safePaymentMethod = WebUtility.HtmlEncode(PaymentMethodLabel(order.PaymentMethod));
        var safePaymentStatus = string.IsNullOrWhiteSpace(order.PaymentStatus)
            ? string.Empty
            : WebUtility.HtmlEncode(PaymentStatusLabel(order.PaymentStatus));
        var safePhone = WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(order.CustomerPhone) ? "Chưa cung cấp" : order.CustomerPhone.Trim());
        var safeAddress = WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(order.ShippingAddress) ? "Chưa cung cấp" : order.ShippingAddress.Trim());
        var safeNote = string.IsNullOrWhiteSpace(order.Note) ? string.Empty : WebUtility.HtmlEncode(order.Note.Trim());
        var supportEmail = WebUtility.HtmlEncode(_options.SupportEmail);
        var year = DateTimeOffset.Now.Year;
        var moneyCulture = CultureInfo.GetCultureInfo("vi-VN");
        string Money(decimal amount) => $"{amount.ToString("N0", moneyCulture)} ₫";

        var itemRows = new StringBuilder();
        var plainItems = new StringBuilder();
        foreach (var item in order.Items)
        {
            var variants = string.Join(" · ", new[] { item.Quality, item.BeadSize }.Where(value => !string.IsNullOrWhiteSpace(value)));
            var itemTitle = WebUtility.HtmlEncode(item.ProductName);
            var itemSku = WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(item.ProductSku) ? "—" : item.ProductSku);
            var safeVariants = WebUtility.HtmlEncode(variants);
            itemRows.Append("<tr><td style=\"padding:13px 8px;border-top:1px solid #E5E9E4;color:#183F36;font-size:14px;line-height:1.45\"><strong style=\"font-weight:600\">")
                .Append(itemTitle)
                .Append("</strong><br><span style=\"font-size:12px;color:#718078\">SKU ").Append(itemSku).Append("</span>");
            if (!string.IsNullOrWhiteSpace(variants)) itemRows.Append("<br><span style=\"font-size:12px;color:#718078\">").Append(safeVariants).Append("</span>");
            itemRows.Append("</td><td align=\"center\" style=\"padding:13px 6px;border-top:1px solid #E5E9E4;color:#42574F;font-size:13px\">")
                .Append(item.Quantity.ToString(moneyCulture))
                .Append("</td><td align=\"right\" style=\"padding:13px 8px;border-top:1px solid #E5E9E4;color:#183F36;font-size:13px;white-space:nowrap\">")
                .Append(Money(item.LineTotal)).Append("</td></tr>");

            plainItems.Append("• ").Append(item.ProductName).Append(" (SKU ").Append(string.IsNullOrWhiteSpace(item.ProductSku) ? "—" : item.ProductSku).Append(")");
            if (!string.IsNullOrWhiteSpace(variants)) plainItems.Append(" · ").Append(variants);
            plainItems.Append(" — ").Append(item.Quantity).Append(" × ").Append(Money(item.UnitPrice)).Append(" = ").Append(Money(item.LineTotal)).AppendLine();
        }

        var itemHtml = itemRows.ToString();
        var noteBlock = string.IsNullOrEmpty(safeNote)
            ? string.Empty
            : $"<tr><td style=\"padding:0 28px 22px\"><div style=\"font-size:12px;color:#718078\">Ghi chú</div><div style=\"margin-top:4px;color:#183F36;font-size:14px\">{safeNote}</div></td></tr>";
        var paymentDetail = string.IsNullOrEmpty(safePaymentStatus) ? safePaymentMethod : $"{safePaymentMethod} · {safePaymentStatus}";

        var html = $$"""
            <!doctype html>
            <html lang="vi">
              <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>GEME đã nhận đơn hàng {{safeOrderCode}}</title></head>
              <body style="margin:0;padding:24px 12px;background:#FAFAF7;color:#103F35;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">
                <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">GEME đã tiếp nhận đơn hàng {{safeOrderCode}}. Thông tin sản phẩm và giao nhận ở bên dưới.</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;margin:0 auto;border:1px solid #D9E2DD;border-collapse:separate;background:#FAFAF7">
                  <tr><td style="padding:27px 28px 23px;border-bottom:1px solid #D9E2DD"><div style="font-family:Georgia,'Times New Roman',serif;font-size:27px;letter-spacing:5px;color:#103F35">✦ GEME</div><div style="margin-top:3px;font-size:11px;letter-spacing:1px;color:#63766F">Natural Gemstones · Fine Jewelry · For You</div></td></tr>
                  <tr><td style="padding:30px 28px 18px"><div style="margin-bottom:9px;font-size:10px;letter-spacing:1.5px;color:#718078">GEME · ĐƠN HÀNG CỦA BẠN</div><h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:29px;font-weight:normal;line-height:1.25;color:#103F35">GEME đã nhận đơn hàng</h1><p style="margin:0 0 12px">Chào {{safeName}},</p><p style="margin:0">Cảm ơn bạn đã chọn một thiết kế GEME. Đơn hàng đã được ghi nhận và đội ngũ GEME sẽ sớm kiểm tra thông tin trước khi chuẩn bị giao đến bạn.</p></td></tr>
                  <tr><td style="padding:10px 28px 22px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#EDF3EE;border:1px solid #D9E5DD"><tr><td style="padding:14px 16px"><div style="font-size:10px;letter-spacing:1px;color:#718078">MÃ ĐƠN HÀNG</div><div style="margin-top:2px;font-family:Georgia,'Times New Roman',serif;font-size:21px;letter-spacing:.4px;color:#103F35">{{safeOrderCode}}</div></td><td align="right" style="padding:14px 16px"><div style="font-size:10px;letter-spacing:1px;color:#718078">TRẠNG THÁI</div><div style="margin-top:4px;color:#103F35;font-size:13px;font-weight:bold">{{safeStatus}}</div></td></tr></table></td></tr>
                  <tr><td style="padding:0 28px 8px"><h2 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:normal;color:#103F35">Sản phẩm trong đơn</h2></td></tr>
                  <tr><td style="padding:0 20px 20px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><thead><tr><th align="left" style="padding:8px;color:#718078;font-size:10px;font-weight:normal;letter-spacing:.7px">SẢN PHẨM</th><th align="center" style="padding:8px;color:#718078;font-size:10px;font-weight:normal;letter-spacing:.7px">SL</th><th align="right" style="padding:8px;color:#718078;font-size:10px;font-weight:normal;letter-spacing:.7px">THÀNH TIỀN</th></tr></thead><tbody>{{itemHtml}}</tbody></table></td></tr>
                  <tr><td style="padding:0 28px 22px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:4px 0;color:#718078;font-size:13px">Tạm tính</td><td align="right" style="padding:4px 0;color:#42574F;font-size:13px">{{Money(order.Subtotal)}}</td></tr>{{(order.DiscountAmount > 0 ? $"<tr><td style=\"padding:4px 0;color:#718078;font-size:13px\">Ưu đãi</td><td align=\"right\" style=\"padding:4px 0;color:#42574F;font-size:13px\">−{Money(order.DiscountAmount)}</td></tr>" : string.Empty)}}<tr><td style="padding:4px 0;color:#718078;font-size:13px">Phí giao hàng</td><td align="right" style="padding:4px 0;color:#42574F;font-size:13px">{{Money(order.ShippingFee)}}</td></tr><tr><td style="padding:10px 0 0;border-top:1px solid #D9E2DD;color:#103F35;font-family:Georgia,'Times New Roman',serif;font-size:17px">Tổng thanh toán</td><td align="right" style="padding:10px 0 0;border-top:1px solid #D9E2DD;color:#103F35;font-size:16px;font-weight:bold">{{Money(order.TotalAmount)}}</td></tr></table></td></tr>
                  <tr><td style="padding:19px 28px;border-top:1px solid #D9E2DD"><h2 style="margin:0 0 13px;font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:normal;color:#103F35">Thông tin giao nhận</h2><div style="font-size:12px;color:#718078">Người nhận</div><div style="margin-bottom:9px;color:#183F36;font-size:14px">{{WebUtility.HtmlEncode(order.CustomerName ?? "bạn")}}</div><div style="font-size:12px;color:#718078">Điện thoại</div><div style="margin-bottom:9px;color:#183F36;font-size:14px">{{safePhone}}</div><div style="font-size:12px;color:#718078">Địa chỉ</div><div style="margin-bottom:9px;color:#183F36;font-size:14px">{{safeAddress}}</div><div style="font-size:12px;color:#718078">Thanh toán</div><div style="color:#183F36;font-size:14px">{{WebUtility.HtmlEncode(paymentDetail)}}</div></td></tr>
                  {{noteBlock}}
                  <tr><td style="padding:19px 28px;border-top:1px solid #D9E2DD"><p style="margin:0 0 12px;color:#42574F">Nếu cần cập nhật thông tin đơn hàng, bạn có thể liên hệ GEME qua {{supportEmail}}.</p><p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-style:italic;color:#49665C">More than just jewelry. It’s a story of you.</p></td></tr>
                  <tr><td style="padding:14px 28px;border-top:1px solid #D9E2DD;font-size:12px;color:#718078">© {{year}} GEME. All rights reserved.</td></tr>
                </table>
              </body>
            </html>
            """;

        var greeting = string.IsNullOrWhiteSpace(order.CustomerName) ? "Chào bạn," : $"Chào {order.CustomerName.Trim()},";
        var plainText = $"""
            GEME
            Natural Gemstones · Fine Jewelry · For You

            GEME đã nhận đơn hàng

            {greeting}

            Cảm ơn bạn đã chọn một thiết kế GEME. Đơn hàng đã được ghi nhận và đội ngũ GEME sẽ sớm kiểm tra thông tin trước khi chuẩn bị giao đến bạn.

            Mã đơn hàng: {order.OrderCode}
            Trạng thái: {statusLabel}

            SẢN PHẨM TRONG ĐƠN
            {plainItems}
            Tạm tính: {Money(order.Subtotal)}
            Ưu đãi: {Money(order.DiscountAmount)}
            Phí giao hàng: {Money(order.ShippingFee)}
            Tổng thanh toán: {Money(order.TotalAmount)}

            Người nhận: {order.CustomerName ?? "bạn"}
            Điện thoại: {order.CustomerPhone ?? "Chưa cung cấp"}
            Địa chỉ: {order.ShippingAddress ?? "Chưa cung cấp"}
            Thanh toán: {PaymentMethodLabel(order.PaymentMethod)}{(string.IsNullOrWhiteSpace(order.PaymentStatus) ? string.Empty : $" · {PaymentStatusLabel(order.PaymentStatus)}")}
            {(string.IsNullOrWhiteSpace(order.Note) ? string.Empty : $"Ghi chú: {order.Note}")}

            More than just jewelry. It’s a story of you.
            Cần hỗ trợ? Liên hệ {_options.SupportEmail}
            © {year} GEME. All rights reserved.
            """;

        return SendInternalAsync(order.Recipient, $"GEME · Đã tiếp nhận đơn hàng {order.OrderCode}", html, plainText);
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
            _logger.LogError(ex, "SMTP rejected email delivery.");
            throw new InvalidOperationException("Không thể gửi email lúc này. Vui lòng thử lại sau.", ex);
        }

        _logger.LogInformation("Email {Subject} sent.", subject);
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

    private static string PaymentMethodLabel(string value) => value.ToUpperInvariant() switch
    {
        "COD" => "Thanh toán khi nhận hàng",
        "BANK_TRANSFER" => "Chuyển khoản",
        "MOMO" => "MoMo",
        "CREDIT_CARD" => "Thẻ ngân hàng",
        _ => value
    };

    private static string PaymentStatusLabel(string value) => value.ToUpperInvariant() switch
    {
        "PENDING" => "Chưa thanh toán",
        "PAID" => "Đã thanh toán",
        "FAILED" => "Thanh toán thất bại",
        "REFUNDED" => "Đã hoàn tiền",
        "PARTIALLY_REFUNDED" => "Đã hoàn một phần",
        _ => value
    };

    private static string OrderStatusLabel(string value) => value.ToUpperInvariant() switch
    {
        "PENDING_CONFIRMATION" => "Chờ GEME xác nhận",
        "PROCESSING" => "Đang chuẩn bị đơn hàng",
        "SHIPPING" => "Đang giao hàng",
        "DELIVERED" => "Đã giao hàng",
        "CANCELLED" => "Đã hủy",
        _ => value
    };
}
