import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
export class AssignMemberDto {
  @IsString() @MaxLength(254) email!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) unitId?: string;
}
export class EditMemberDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsString() @MaxLength(300) reason!: string;
}
export class RemoveMemberDto {
  @IsString() @MaxLength(300) reason!: string;
}

export class CreateManagerDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
