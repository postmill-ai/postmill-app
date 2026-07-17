import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';

export class CreateCampaignNoteDto {
  @IsString()
  @MaxLength(20000)
  content!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  mentions?: string[];
}
