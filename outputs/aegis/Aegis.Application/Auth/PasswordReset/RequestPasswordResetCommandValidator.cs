using FluentValidation;

namespace Aegis.Application.Auth.PasswordReset;

public sealed class RequestPasswordResetCommandValidator : AbstractValidator<RequestPasswordResetCommand>
{
    public RequestPasswordResetCommandValidator()
    {
        RuleFor(request => request.Email)
            .NotEmpty()
            .EmailAddress()
            .MaximumLength(254);
    }
}
