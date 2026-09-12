import { IsOptional, IsString } from 'class-validator';
export class ListQueryDto {
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() after?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsOptional() @IsString() cycle?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() search?: string;
}
