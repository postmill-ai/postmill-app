import { IsDefined, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ description: 'The internal comment/note body to attach to the post.' })
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  comment: string;
}
