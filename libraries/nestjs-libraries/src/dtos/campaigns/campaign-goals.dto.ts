import { IsString, IsNumber } from 'class-validator';

export class CampaignGoalDto {
  @IsString()
  metric!: 'impressions' | 'likes' | 'comments' | 'clicks' | 'posts' | 'followers';

  @IsNumber()
  target!: number;
}
