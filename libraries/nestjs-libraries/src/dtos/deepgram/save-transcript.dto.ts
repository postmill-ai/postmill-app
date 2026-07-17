import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class TranscriptSegmentDto {
  @IsNumber()
  start!: number;

  @IsNumber()
  end!: number;

  @IsString()
  @MaxLength(20000)
  text!: string;
}

export class SaveTranscriptDto {
  // 6.3: cap the transcript body so a huge payload can't be persisted unbounded.
  @IsString()
  @MaxLength(200000)
  text!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranscriptSegmentDto)
  segments?: TranscriptSegmentDto[];
}
