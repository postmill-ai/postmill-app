import { IsIn, IsString } from 'class-validator';
import { VALID_COMMENT_STATUSES } from '@postmill-ai/nestjs-libraries/database/prisma/social-comments/social.comments.service';

export class UpdateCommentStatusDto {
  @IsString()
  @IsIn(VALID_COMMENT_STATUSES as readonly string[])
  status: string;
}
