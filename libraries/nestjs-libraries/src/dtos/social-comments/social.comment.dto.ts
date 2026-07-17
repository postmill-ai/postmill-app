import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReplyCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  message: string;

  /**
   * @deprecated Ignored — the output guardrail is now ALWAYS enforced server-side
   * on reply routes (it is a no-op for orgs with no output chain). Kept only for
   * wire back-compat so existing clients that still send it aren't rejected by the
   * whitelist pipe. See social-comments.controller `_maybeGuard` (3.1).
   */
  @IsOptional()
  @IsBoolean()
  guardrail?: boolean;
}

export class LikeCommentDto {
  @IsBoolean()
  like: boolean;
}
