using Aegis.Application.Roles.Commands;
using Aegis.Application.Roles.Queries;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Aegis.API.Controllers;

[ApiController]
[Route("api/role")]
[Authorize]
public class RoleController : ControllerBase
{
    private readonly IMediator _mediator;
    public RoleController(IMediator mediator) => _mediator = mediator;

    [HttpGet]
    [Authorize(Policy = "roles.read")]
    public async Task<IActionResult> GetAll() =>
        Ok(await _mediator.Send(new GetAllRolesQuery()));

    [HttpPost("get-by-id")]
    [Authorize(Policy = "roles.read")]
    public async Task<IActionResult> GetById([FromBody] GetRoleByIdQuery query)
    {
        var result = await _mediator.Send(query);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost("delete")]
    [Authorize(Policy = "roles.manage")]
    public async Task<IActionResult> Delete([FromBody] DeleteRoleCommand command)
    {
        await _mediator.Send(command);
        return NoContent();
    }

    [HttpPost]
    [Authorize(Policy = "roles.manage")]
    public async Task<IActionResult> Create(CreateRoleCommand command)
    {
        var id = await _mediator.Send(command);
        return StatusCode(StatusCodes.Status201Created, id);
    }

    [HttpPut]
    [Authorize(Policy = "roles.manage")]
    public async Task<IActionResult> Update(UpdateRoleCommand command)
    {
        await _mediator.Send(command);
        return NoContent();
    }
}
