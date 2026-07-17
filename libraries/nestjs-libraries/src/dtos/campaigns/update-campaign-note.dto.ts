import { IsString, MaxLength } from 'class-validator';

export class UpdateCampaignNoteDto {
  @IsString()
  @MaxLength(20000)
  content!: string;
}
