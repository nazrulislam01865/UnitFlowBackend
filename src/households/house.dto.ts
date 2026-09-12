import { IsString, MaxLength } from 'class-validator';
export class CreateHouseDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(250) address!: string;
  @IsString() @MaxLength(120) rate!: string;
  @IsString() @MaxLength(120) fixedCharge!: string;
}
