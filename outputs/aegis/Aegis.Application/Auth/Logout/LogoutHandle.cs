using Aegis.Application.Common.Exceptions;
using Aegis.Application.Common.Interfaces;
using Aegis.Application.Common.Interfaces.Persistence;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Xml;

namespace Aegis.Application.Auth.Logout
{
    public class LogoutHandle
    {
        private readonly ISessionRepository _sessionRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserService _currentUserService;

        public LogoutHandle(ISessionRepository sessionRepository, IUnitOfWork unitOfWork, ICurrentUserService currentUserService)
        {
            _sessionRepository = sessionRepository;
            _unitOfWork = unitOfWork;
            _currentUserService = currentUserService;
        }

        public async Task Logout(Guid sessionId)
        {
            var session = await _sessionRepository.GetByIdAsync(sessionId);

            if (session is null || session.UserId != _currentUserService.UserId)
                throw new ForbiddenException("Error");

            session.Revoke();

            await _unitOfWork.SaveChangesAsync();
        }

        public async Task LogoutAll()
        {
            if (_currentUserService.UserId is null)
                return;

            await _sessionRepository.RevokeAllByUserId(_currentUserService.UserId.Value);

            await _unitOfWork.SaveChangesAsync();
        }

    }
}
