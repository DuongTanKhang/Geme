using FluentValidation;

namespace Aegis.Application.Auth.PasswordReset;

public sealed class ChangePasswordCommandValidator : AbstractValidator<ChangePasswordCommand>
{
    public ChangePasswordCommandValidator()
    {
        RuleFor(request => request.UserId).NotEmpty();
        RuleFor(request => request.CurrentPassword).NotEmpty().MaximumLength(128);
        RuleFor(request => request.NewPassword)
            .NotEmpty()
            .MinimumLength(10)
            .MaximumLength(128)
            .Matches("[A-Z]").WithMessage("Mật khẩu phải có chữ hoa.")
            .Matches("[a-z]").WithMessage("Mật khẩu phải có chữ thường.")
            .Matches("[0-9]").WithMessage("Mật khẩu phải có chữ số.")
            .Matches("[^a-zA-Z0-9]").WithMessage("Mật khẩu phải có ký tự đặc biệt.")
            .Must((command, password) => !string.Equals(password, command.CurrentPassword, StringComparison.Ordinal))
            .WithMessage("Mật khẩu mới phải khác mật khẩu hiện tại.");
    }
}
