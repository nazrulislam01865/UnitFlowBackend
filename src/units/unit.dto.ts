import { IsString, MaxLength } from 'class-validator';
export class CreateUnitDto {
  @IsString() @MaxLength(30) label!: string;
  @IsString() @MaxLength(60) meter!: string;
  @IsString() @MaxLength(120) openingKwh!: string;
  @IsString() @MaxLength(120) openingDate!: string;
}
export class AssignResidentDto {
  @IsString() @MaxLength(128) residentUid!: string;
}
