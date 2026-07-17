import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VideoDto {
  @ApiProperty({ description: 'Video generator identifier.' })
  @IsString()
  type: string;

  @ApiProperty({
    enum: ['vertical', 'horizontal'],
    description: 'Output orientation.',
  })
  @IsIn(['vertical', 'horizontal'])
  output: 'vertical' | 'horizontal';

  @ApiProperty({
    description: 'Generator-specific parameters.',
    required: false,
    type: Object,
  })
  @IsOptional()
  @IsObject()
  customParams?: Record<string, any>;
}
