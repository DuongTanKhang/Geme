namespace Aegis.Infrastructure.Authentication;

public sealed class SessionOptions
{
    public const string SectionName = "Session";
    public int IdleTimeoutMinutes { get; set; } = 30;
    public int AbsoluteLifetimeDays { get; set; } = 30;
}
