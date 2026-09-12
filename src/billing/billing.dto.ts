import { Allow, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
export class TariffDto {
  @IsString() @MaxLength(120) rate!: string;
  @IsString() @MaxLength(120) fixedCharge!: string;
  @IsString() @MaxLength(120) effectiveCycle!: string;
}
export class ReadingDto {
  @IsString() @MaxLength(120) unitId!: string;
  @IsString() @MaxLength(120) currentKwh!: string;
  @IsString() @MaxLength(120) readingDate!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsOptional() @IsString() @MaxLength(120) requestId?: string;
  @IsOptional() @IsString() @MaxLength(120) photoId?: string;
  // Confirmation fields are compared to server calculation, never used as amounts.
  @Allow() expectedTotalPaisa?: number;
  @Allow() expectedRatePaisa?: number;
  @Allow() expectedFixedPaisa?: number;
}
