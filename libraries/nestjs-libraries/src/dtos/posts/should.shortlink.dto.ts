import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ShouldShortlinkDto {
  @ApiProperty({
    type: [String],
    description: 'The post message(s) to check for link-shortening candidates.',
  })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(50000, { each: true })
  messages: string[];
}
