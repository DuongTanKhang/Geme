using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace Aegis.Application.Auth.Models
{
    public record RefreshResult(
        string AccessToken,
        string RefreshToken
    );
}
