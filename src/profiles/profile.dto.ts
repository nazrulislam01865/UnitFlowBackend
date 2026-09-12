import { IsOptional, IsString, MaxLength } from 'class-validator';
export class UpdateProfileDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(250) address?: string;
}
