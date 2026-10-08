using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using FluentValidation;
using System.Net;
using System.Text.Json;
using ForbiddenException = Aegis.Application.Common.Exceptions.ForbiddenException;
using NotFoundException = Aegis.Application.Common.Exceptions.NotFoundException;
using BadRequestException = Aegis.Application.Common.Exceptions.BadRequestException;
using ConflictException = Aegis.Application.Common.Exceptions.ConflictException;
using UnauthorizedException = Aegis.Application.Common.Exceptions.UnauthorizedException;


namespace Aegis.Infrastructure.Middlewares
{
    public class GlobalExceptionMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger<GlobalExceptionMiddleware> _logger;

        public GlobalExceptionMiddleware(
            RequestDelegate next,
            ILogger<GlobalExceptionMiddleware> logger)
        {
            _next = next;
            _logger = logger;
        }

        public async Task Invoke(HttpContext context)
        {
            try
            {
                await _next(context);
            }
            catch (ValidationException ex)
            {
                var fields = string.Join(", ", ex.Errors
                    .Select(error => error.PropertyName)
                    .Where(name => !string.IsNullOrWhiteSpace(name))
                    .Distinct());
                _logger.LogWarning(
                    "Request validation failed for {RequestPath}. Fields: {Fields}",
                    context.Request.Path,
                    fields);
                await HandleExceptionAsync(context, ex);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, ex.Message);
                await HandleExceptionAsync(context, ex);
            }
        }

        private static Task HandleExceptionAsync(
            HttpContext context,
            Exception exception)
        {
            var statusCode = HttpStatusCode.InternalServerError;
            var message = "An unexpected error occurred.";

            switch (exception)
            {
                case UnauthorizedAccessException:
                case UnauthorizedException:
                    statusCode = HttpStatusCode.Unauthorized;
                    message = exception.Message;
                    break;

                case ForbiddenException:
                    statusCode = HttpStatusCode.Forbidden;
                    message = exception.Message;
                    break;

                case NotFoundException:
                    statusCode = HttpStatusCode.NotFound;
                    message = exception.Message;
                    break;

                case ValidationException:
                case BadRequestException:
                    statusCode = HttpStatusCode.BadRequest;
                    message = exception is ValidationException
                        ? "Thông tin bạn nhập chưa hợp lệ."
                        : exception.Message;
                    break;

                case ConflictException:
                    statusCode = HttpStatusCode.Conflict;
                    message = exception.Message;
                    break;
            }

            var response = new
            {
                success = false,
                error = message,
                statusCode = (int)statusCode
            };

            context.Response.ContentType = "application/json";
            context.Response.StatusCode = (int)statusCode;

            return context.Response.WriteAsync(
                JsonSerializer.Serialize(response)
            );
        }
    }
}
