using FluentValidation;

namespace Aegis.Application.Auth.Register;

public sealed class RegisterCommandValidator : AbstractValidator<RegisterCommand>
{
    public RegisterCommandValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty()
            .MinimumLength(2)
            .MaximumLength(100);

        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress()
            .MaximumLength(254);

        RuleFor(x => x.Password)
            .NotEmpty()
            .MinimumLength(10)
            .MaximumLength(128)
            .Matches("[A-Z]").WithMessage("Mật khẩu phải có chữ hoa.")
            .Matches("[a-z]").WithMessage("Mật khẩu phải có chữ thường.")
            .Matches("[0-9]").WithMessage("Mật khẩu phải có chữ số.")
            .Matches("[^a-zA-Z0-9]").WithMessage("Mật khẩu phải có ký tự đặc biệt.");
    }
}
