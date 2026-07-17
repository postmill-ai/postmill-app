import { IsOptional, IsString } from 'class-validator';

export class AssignCommentDto {
  @IsOptional()
  @IsString()
  assigneeId?: string | null;
}
