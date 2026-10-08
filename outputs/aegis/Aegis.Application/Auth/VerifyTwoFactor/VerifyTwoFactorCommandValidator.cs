using FluentValidation;

namespace Aegis.Application.Auth.VerifyTwoFactor;

public sealed class VerifyTwoFactorCommandValidator : AbstractValidator<VerifyTwoFactorCommand>
{
    public VerifyTwoFactorCommandValidator()
    {
        RuleFor(x => x.UserId).NotEmpty();
        RuleFor(x => x.Otp)
            .NotEmpty()
            .Matches("^[0-9]{6}$")
            .WithMessage("OTP phải gồm đúng 6 chữ số.");
    }
}
