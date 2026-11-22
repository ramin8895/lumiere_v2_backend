import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';

export class CreateCategoryDto {
  @IsOptional() @IsInt() parentId?: number | null;
  @IsString() @Length(1, 120) name: string;
  @IsString() @Length(1, 80) slug: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
  @IsOptional() @IsString() @Length(0, 500) imageUrl?: string | null;
  @IsOptional() @IsString() @Length(0, 200) metaTitle?: string | null;
  @IsOptional() @IsString() @Length(0, 400) metaDescription?: string | null;
}

export class UpdateCategoryDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() parentId?: number | null;
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsString() @Length(1, 80) slug?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
  @IsOptional() @IsString() @Length(0, 500) imageUrl?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @Length(0, 200) metaTitle?: string | null;
  @IsOptional() @IsString() @Length(0, 400) metaDescription?: string | null;
}

export class SetMappingDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @Type(() => Number) @IsInt({ each: true }) sourceCategoryIds: number[];
  /** null = remove the mapping */
  @ValidateIf((_, v) => v !== null) @IsInt() categoryId: number | null;
}

export class BlockShopDto {
  @IsBoolean() blocked: boolean;
}
