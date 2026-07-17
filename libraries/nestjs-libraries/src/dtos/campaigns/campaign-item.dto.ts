import { IsIn, IsString } from 'class-validator';
import { ENTITY_SLUGS } from '@gitroom/nestjs-libraries/database/prisma/campaigns/campaign-entity.types';

export class CampaignItemDto {
  @IsString()
  @IsIn(ENTITY_SLUGS)
  entityType!: string;

  @IsString()
  entityId!: string;
}
