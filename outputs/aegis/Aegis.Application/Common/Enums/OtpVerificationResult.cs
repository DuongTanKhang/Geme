namespace Aegis.Application.Common.Enums;

public enum OtpVerificationResult
{
    Valid = 0,
    Invalid = 1,
    ExpiredOrAlreadyUsed = 2,
    AttemptsExceeded = 3
}
