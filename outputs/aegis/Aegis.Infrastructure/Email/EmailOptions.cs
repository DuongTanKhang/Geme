namespace Aegis.Infrastructure.Email;

public sealed class EmailOptions
{
    public const string SectionName = "Email";

    public string Host { get; init; } = "smtp.gmail.com";
    public int Port { get; init; } = 587;
    public bool EnableSsl { get; init; } = true;
    public string Username { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
    public string FromEmail { get; init; } = string.Empty;
    public string FromName { get; init; } = "Aegis";
    public string PublicBaseUrl { get; init; } = "https://localhost:7045";
    public string SupportEmail { get; init; } = "support@geme.vn";
}
