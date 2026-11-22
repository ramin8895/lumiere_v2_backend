import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class ProductListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48) pageSize: number = 24;
  @IsOptional() @IsIn(['relevance', 'newest', 'price_asc', 'price_desc', 'offers']) sort: 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'offers' = 'relevance';
  @IsOptional() @IsString() @Length(1, 100) q?: string;
  @IsOptional() @IsString() @Length(1, 100) brand?: string;
  @IsOptional() @IsString() @Length(1, 80) shop?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minPrice?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxPrice?: number;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === '1' || value === true) @IsBoolean() inStock?: boolean;
}

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48) pageSize: number = 24;
}

export class SuggestQuery {
  @IsString() @Length(1, 100) q: string;
}
