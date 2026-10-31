using FluentValidation;

namespace Aegis.Application.Auth.PasswordReset;

public sealed class ResetPasswordCommandValidator : AbstractValidator<ResetPasswordCommand>
{
    public ResetPasswordCommandValidator()
    {
        RuleFor(request => request.Email)
            .NotEmpty()
            .EmailAddress()
            .MaximumLength(254);

        RuleFor(request => request.Otp)
            .NotEmpty()
            .Matches("^[0-9]{6,10}$")
            .WithMessage("Mã xác nhận phải gồm 6 đến 10 chữ số.");

        RuleFor(request => request.NewPassword)
            .NotEmpty()
            .MinimumLength(10)
            .MaximumLength(128)
            .Matches("[A-Z]").WithMessage("Mật khẩu phải có chữ hoa.")
            .Matches("[a-z]").WithMessage("Mật khẩu phải có chữ thường.")
            .Matches("[0-9]").WithMessage("Mật khẩu phải có chữ số.")
            .Matches("[^a-zA-Z0-9]").WithMessage("Mật khẩu phải có ký tự đặc biệt.");
    }
}
