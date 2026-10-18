import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Sse, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard.js";
import { ApiTags } from "@nestjs/swagger";
import { MaterialOptionScope } from "../generated/prisma/client.js";
import { ImportMaterialOptionsDto, MaterialOptionInputDto, UpdateMaterialOptionDto } from "./dto/material-option.dto.js";
import { MaterialsService } from "./materials.service.js";

@ApiTags("Materials")
@Controller("materials")
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get()
  @Header("Cache-Control", "public, max-age=5, stale-while-revalidate=30")
  list(@Query("scope") scope?: string) {
    if (!scope) return this.materials.list();
    if (scope !== "JEWELRY" && scope !== "GEMSTONE") return this.materials.list();
    return this.materials.list(scope as MaterialOptionScope);
  }

  @Sse("events")
  events() {
    return this.materials.events();
  }

  @Post()
  @UseGuards(AdminAuthGuard)
  create(@Body() input: MaterialOptionInputDto) {
    return this.materials.create(input);
  }

  @Post("import-local")
  @UseGuards(AdminAuthGuard)
  importLocalOptions(@Body() body: ImportMaterialOptionsDto) {
    return this.materials.importLocalOptions(body.items);
  }

  @Patch(":id")
  @UseGuards(AdminAuthGuard)
  update(@Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateMaterialOptionDto) {
    return this.materials.update(id, input);
  }

  @Delete(":id")
  @UseGuards(AdminAuthGuard)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.materials.remove(id);
  }
}
