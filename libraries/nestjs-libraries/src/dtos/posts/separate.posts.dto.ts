import { IsDefined, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SeparatePostsDto {
  @ApiProperty({ description: 'The full text to split into separate posts.' })
  @IsDefined()
  @IsString()
  @MaxLength(100000)
  content: string;

  @ApiProperty({ description: 'Max character length per split post.' })
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(100000)
  len: number;
}
