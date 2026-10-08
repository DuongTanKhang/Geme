import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";

export class MaterialOptionInputDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn(["JEWELRY", "GEMSTONE"])
  scope!: "JEWELRY" | "GEMSTONE";

  @IsOptional()
  @IsIn(["MATERIAL", "STONE"])
  kind?: "MATERIAL" | "STONE";

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300_000)
  imageUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}

export class ImportMaterialOptionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaterialOptionInputDto)
  items!: MaterialOptionInputDto[];
}

export class UpdateMaterialOptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(["JEWELRY", "GEMSTONE"])
  scope?: "JEWELRY" | "GEMSTONE";

  @IsOptional()
  @IsIn(["MATERIAL", "STONE"])
  kind?: "MATERIAL" | "STONE";

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300_000)
  imageUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}
