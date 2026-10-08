using Aegis.Application.Auth.Login;
using MediatR;

namespace Aegis.Application.Auth.Refresh;

public class RefreshCommandHandle
    : IRequestHandler<RefreshCommand, LoginResult>
{
    private readonly RefreshTokenHasher _refreshHandler;

    public RefreshCommandHandle(RefreshTokenHasher refreshHandler)
    {
        _refreshHandler = refreshHandler;
    }

    public async Task<LoginResult> Handle(
        RefreshCommand request,
        CancellationToken cancellationToken)
    {
        return await _refreshHandler.Handler(
            request.RefreshToken,
            request.Ip
        );
    }
}
