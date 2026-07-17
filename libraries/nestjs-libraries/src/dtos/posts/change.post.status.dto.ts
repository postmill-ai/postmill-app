import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePostStatusDto {
  @ApiProperty({
    enum: ['draft', 'schedule'],
    description: 'New status for the post.',
  })
  @IsIn(['draft', 'schedule'])
  status: 'draft' | 'schedule';
}
