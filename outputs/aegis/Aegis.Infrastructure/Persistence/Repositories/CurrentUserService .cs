using Aegis.Application.Common.Interfaces;
using Microsoft.AspNetCore.Http;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Infrastructure.Persistence.Repositories
{
    public class CurrentUserService : ICurrentUserService
    {
        private readonly IHttpContextAccessor _httpContextAccessor;

        public CurrentUserService(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }
        public Guid? UserId =>
        Guid.TryParse(
            _httpContextAccessor.HttpContext?.User?.FindFirst("sub")?.Value,
            out var id) ? id : null;

        public Guid? SessionId =>
        Guid.TryParse(
            _httpContextAccessor.HttpContext?.User?.FindFirst("sid")?.Value,
            out var id) ? id : null;
    }
}
