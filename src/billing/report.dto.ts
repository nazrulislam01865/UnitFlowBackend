import { IsOptional, IsString, Matches } from 'class-validator';
export class ReportQueryDto {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}$/) from?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}$/) to?: string;
}
